/**
 * The server side of a WebSocket (RFC 6455) on the socket `routing` hands over for `GET /realtime`: the opening
 * handshake, client frame reading with the frame size and read time limits, and unmasked server frames.
 */
import { createHash } from 'node:crypto';
import type { Duplex } from 'node:stream';

const ACCEPT_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
const OP_TEXT = 0x1;
const OP_BINARY = 0x2;
const OP_CLOSE = 0x8;
const OP_PING = 0x9;
const OP_PONG = 0xa;
const CLOSE_NORMAL = 1000;

/** Why the reader stopped a connection. */
export type Violation = 'frame_too_large' | 'frame_read_timeout' | 'protocol';

export interface WebSocketHandlers {
  /** The largest payload a client frame may have. */
  readonly max_frame_bytes: number;
  /** A real time limit for one frame; the frame read fails when it aborts before the frame ends. */
  frame_time_limit(): AbortSignal;
  /** Every complete client frame before it is handled; false stops reading (the handler closed the connection). */
  frame(): boolean;
  binary(payload: Uint8Array): void;
  text(): void;
  /** A frame the reader refuses; the connection closes right after. */
  violation(reason: Violation): void;
  /** The connection ended, from either side. Called once. */
  closed(): void;
}

function header(headers: Readonly<Record<string, unknown>>, name: string): string {
  const value = headers[name];
  if (typeof value === 'string') return value;
  if (Array.isArray(value) && typeof value[0] === 'string') return value[0];
  return '';
}

/** The `101` response of a valid WebSocket upgrade request, or null when the request is not one. */
export function handshake_response(headers: Readonly<Record<string, unknown>>): string | null {
  const upgrade = header(headers, 'upgrade').toLowerCase();
  const key = header(headers, 'sec-websocket-key').trim();
  if (!upgrade.split(',').some((v) => v.trim() === 'websocket')) return null;
  if (header(headers, 'sec-websocket-version').trim() !== '13') return null;
  if (Buffer.from(key, 'base64').length !== 16) return null;
  const accept = createHash('sha1').update(key + ACCEPT_GUID).digest('base64');
  return `HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`;
}

/** A server frame: FIN, the opcode, no mask. */
export function encode_frame(opcode: number, payload: Uint8Array): Buffer {
  const length = payload.byteLength;
  let head: Buffer;
  if (length < 126) {
    head = Buffer.from([0x80 | opcode, length]);
  } else if (length < 0x10000) {
    head = Buffer.alloc(4);
    head[0] = 0x80 | opcode;
    head[1] = 126;
    head.writeUInt16BE(length, 2);
  } else {
    head = Buffer.alloc(10);
    head[0] = 0x80 | opcode;
    head[1] = 127;
    head.writeBigUInt64BE(BigInt(length), 2);
  }
  return Buffer.concat([head, payload]);
}

interface FrameHead {
  readonly fin: boolean;
  readonly opcode: number;
  readonly masked: boolean;
  readonly reserved: boolean;
  readonly length: number;
  readonly head_bytes: number;
}

/** The frame head at the start of `buf`, null when not all of it is there, or `too_large` past `max` bytes. */
export function read_head(buf: Buffer, max: number): FrameHead | null | 'too_large' {
  if (buf.length < 2) return null;
  const b0 = buf[0] ?? 0;
  const b1 = buf[1] ?? 0;
  const masked = (b1 & 0x80) !== 0;
  const len7 = b1 & 0x7f;
  const extra = len7 === 126 ? 2 : len7 === 127 ? 8 : 0;
  const head_bytes = 2 + extra + (masked ? 4 : 0);
  if (buf.length < 2 + extra) return null;
  let length: bigint;
  if (len7 === 126) length = BigInt(buf.readUInt16BE(2));
  else if (len7 === 127) length = buf.readBigUInt64BE(2);
  else length = BigInt(len7);
  if (length > BigInt(max)) return 'too_large';
  if (buf.length < head_bytes) return null;
  return { fin: (b0 & 0x80) !== 0, opcode: b0 & 0x0f, masked, reserved: (b0 & 0x70) !== 0, length: Number(length), head_bytes };
}

/** One accepted WebSocket. */
export class WebSocketConnection {
  readonly #socket: Duplex;
  readonly #on: WebSocketHandlers;
  #buffer: Buffer = Buffer.alloc(0);
  #ended = false;
  /** Counts complete frames, so a frame time limit knows whether its frame ended. */
  #frames = 0;
  #timed_frame = -1;

  constructor(socket: Duplex, head: Uint8Array, handlers: WebSocketHandlers) {
    this.#socket = socket;
    this.#on = handlers;
    socket.on('data', (chunk: Buffer) => {
      this.#read(chunk);
    });
    socket.on('close', () => {
      this.#end();
    });
    socket.on('error', () => {
      socket.destroy();
      this.#end();
    });
    if (head.byteLength > 0) this.#read(Buffer.from(head));
  }

  get ended(): boolean {
    return this.#ended;
  }

  send(payload: Uint8Array): void {
    if (this.#ended) return;
    this.#socket.write(encode_frame(OP_BINARY, payload));
  }

  /** Sends a close frame with the status code and the UTF-8 reason (at most 123 bytes) and ends the connection. */
  close(code = CLOSE_NORMAL, reason = ''): void {
    if (this.#ended) return;
    const text = Buffer.from(reason, 'utf8');
    const body = Buffer.alloc(2 + text.length);
    body.writeUInt16BE(code, 0);
    text.copy(body, 2);
    const socket = this.#socket;
    socket.end(encode_frame(OP_CLOSE, body), () => {
      socket.destroy();
    });
    this.#end();
  }

  #end(): void {
    if (this.#ended) return;
    this.#ended = true;
    this.#buffer = Buffer.alloc(0);
    this.#on.closed();
  }

  #refuse(reason: Violation): void {
    this.#on.violation(reason);
    this.close();
  }

  #read(chunk: Buffer): void {
    if (this.#ended) return;
    this.#buffer = this.#buffer.length === 0 ? chunk : Buffer.concat([this.#buffer, chunk]);
    while (this.#next_frame()) {
      // Each complete frame is handled by #next_frame.
    }
    if (this.#open() && this.#buffer.length > 0) this.#time_frame();
  }

  /** False once the connection ended; a method so that handlers ending it between reads are seen. */
  #open(): boolean {
    return !this.#ended;
  }

  /** Takes and handles one complete frame from the buffer; false when there is none or the connection ended. */
  #next_frame(): boolean {
    if (!this.#open()) return false;
    const head = read_head(this.#buffer, this.#on.max_frame_bytes);
    if (head === 'too_large') {
      this.#refuse('frame_too_large');
      return false;
    }
    if (head === null || this.#buffer.length < head.head_bytes + head.length) return false;
    const frame = this.#buffer.subarray(0, head.head_bytes + head.length);
    this.#buffer = this.#buffer.subarray(head.head_bytes + head.length);
    this.#frames += 1;
    this.#frame(head, frame);
    return true;
  }

  /** Starts the read time limit of the frame now partly read, once per frame. */
  #time_frame(): void {
    if (this.#timed_frame === this.#frames) return;
    const frame = this.#frames;
    this.#timed_frame = frame;
    this.#on.frame_time_limit().addEventListener('abort', () => {
      if (!this.#ended && this.#frames === frame && this.#buffer.length > 0) this.#refuse('frame_read_timeout');
    }, { once: true });
  }

  /** False for a client frame RFC 6455 does not allow: unmasked, reserved bits, a long or fragmented control frame. */
  static #allowed(head: FrameHead): boolean {
    if (!head.masked || head.reserved) return false;
    return head.opcode < OP_CLOSE || (head.fin && head.length <= 125);
  }

  #frame(head: FrameHead, frame: Buffer): void {
    if (!WebSocketConnection.#allowed(head)) {
      this.#refuse('protocol');
      return;
    }
    const mask = frame.subarray(head.head_bytes - 4, head.head_bytes);
    const payload = Buffer.from(frame.subarray(head.head_bytes));
    for (let i = 0; i < payload.length; i += 1) payload[i] = (payload[i] ?? 0) ^ (mask[i % 4] ?? 0);
    if (!this.#on.frame() || !this.#open()) return;
    this.#dispatch(head, payload);
  }

  #dispatch(head: FrameHead, payload: Buffer): void {
    const data = head.opcode === OP_BINARY || head.opcode === OP_TEXT;
    if (data && !head.fin) {
      this.#refuse('protocol');
      return;
    }
    switch (head.opcode) {
      case OP_BINARY:
        this.#on.binary(new Uint8Array(payload.buffer, payload.byteOffset, payload.byteLength));
        return;
      case OP_TEXT:
        this.#on.text();
        return;
      case OP_CLOSE:
        this.close();
        return;
      case OP_PING:
        this.#socket.write(encode_frame(OP_PONG, payload));
        return;
      case OP_PONG:
        return;
      default:
        this.#refuse('protocol');
    }
  }
}
