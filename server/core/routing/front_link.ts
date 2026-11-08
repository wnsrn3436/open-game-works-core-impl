/**
 * The front link of a worker instance (`### server process` of `routing`): the messages between the front and a
 * worker instance on the message port of the front link, and the worker side that hands each request of the front to
 * the request handling of the server instance as if it had received the connection itself.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { MessagePort } from 'node:worker_threads';
import { Duplex, Readable } from 'node:stream';
import type { MetricFamily } from '../logging/index.ts';
import { create_system_clock } from '../server-time/adapters/system_clock.ts';

/** The front link: the message port to the front and the DB wait state array (`Int32Array` over a `SharedArrayBuffer`). */
export interface FrontLink {
  readonly port: MessagePort;
  readonly db_wait: Int32Array;
}

/** The peer address of the TCP connection of a request. */
export interface Peer {
  readonly address: string | null;
  readonly port: number | null;
}

/** A message of the front to a worker instance. */
export type ToWorker =
  /** A request of `--port`; `upgrade` for a WebSocket upgrade request, with the bytes read after its head. */
  | {
      readonly t: 'req';
      readonly id: number;
      readonly method: string;
      readonly url: string;
      readonly headers: Readonly<Record<string, string | string[] | undefined>>;
      readonly distinct: Readonly<Record<string, string[] | undefined>>;
      readonly peer: Peer;
      readonly upgrade: Uint8Array | null;
    }
  /** Body bytes as they arrive, or for an upgrade the bytes of the connection. */
  | { readonly t: 'data'; readonly id: number; readonly chunk: Uint8Array }
  /** The end of the body, or for an upgrade the end of the client side of the connection. */
  | { readonly t: 'end'; readonly id: number }
  /** The client connection closed before the answer ended. */
  | { readonly t: 'abort'; readonly id: number };

/** A message of a worker instance to the front. */
export type ToFront =
  /** The whole answer of a request. */
  | { readonly t: 'res'; readonly id: number; readonly status: number; readonly headers: Readonly<Record<string, string | number | readonly string[]>>; readonly body: Uint8Array | null }
  /** Bytes the server instance writes to an upgraded connection. */
  | { readonly t: 'sdata'; readonly id: number; readonly chunk: Uint8Array }
  /** The server instance ended its side of an upgraded connection. */
  | { readonly t: 'send'; readonly id: number }
  /** The server instance closed an upgraded connection (or closed it without a response). */
  | { readonly t: 'sclose'; readonly id: number }
  /** The ops report of job `routing_ops_report` (`### ops path`). */
  | { readonly t: 'report'; readonly db_ok: boolean; readonly metrics: readonly MetricFamily[] };

/** Bytes in a buffer of their own, so the message can transfer it. */
export function own_bytes(chunk: Uint8Array | string): Uint8Array {
  return typeof chunk === 'string' ? new Uint8Array(Buffer.from(chunk)) : new Uint8Array(chunk);
}

/** Posts bytes to the other side, moving their buffer. */
export function post_bytes(port: MessagePort, message: ToWorker | ToFront, chunk: Uint8Array): void {
  port.postMessage(message, [chunk.buffer as ArrayBuffer]);
}

const real_clock = create_system_clock();

/**
 * The real clock when the worker instance received each request from the front: the start of `duration_ms`
 * (`logging`). A request the server instance received itself is not in it.
 */
export const RECEIVED_AT = new WeakMap<object, bigint>();

/** The request as the request handling reads it: method, URL, headers, the peer address and the body stream. */
class FrontRequest extends Readable {
  readonly method: string;
  readonly url: string;
  readonly headers: Readonly<Record<string, string | string[] | undefined>>;
  readonly headersDistinct: Readonly<Record<string, string[] | undefined>>;
  readonly socket: { readonly remoteAddress: string | undefined; readonly remotePort: number | undefined };

  constructor(message: Extract<ToWorker, { t: 'req' }>) {
    super();
    this.method = message.method;
    this.url = message.url;
    this.headers = message.headers;
    this.headersDistinct = message.distinct;
    this.socket = { remoteAddress: message.peer.address ?? undefined, remotePort: message.peer.port ?? undefined };
  }

  override _read(): void {}
}

/** The answer of a request: the status and headers of `writeHead` and the body of `end`, sent to the front at `end`. */
class FrontResponse {
  private readonly link: MessagePort;
  private readonly id: number;
  private status = 200;
  private head: Record<string, string | number | readonly string[]> = {};
  private sent = false;
  private ended = false;

  constructor(link: MessagePort, id: number) {
    this.link = link;
    this.id = id;
  }

  get headersSent(): boolean {
    return this.sent;
  }

  get writableEnded(): boolean {
    return this.ended;
  }

  setHeader(name: string, value: string | number | readonly string[]): this {
    this.head[name] = value;
    return this;
  }

  writeHead(status: number, headers?: Readonly<Record<string, string | number | readonly string[]>>): this {
    this.status = status;
    if (headers !== undefined) this.head = { ...this.head, ...headers };
    this.sent = true;
    return this;
  }

  end(body?: Uint8Array | string | null): this {
    if (this.ended) return this;
    this.ended = true;
    this.sent = true;
    const bytes = body === undefined || body === null ? null : own_bytes(body);
    const message: ToFront = { t: 'res', id: this.id, status: this.status, headers: this.head, body: bytes };
    if (bytes === null) this.link.postMessage(message);
    else post_bytes(this.link, message, bytes);
    return this;
  }
}

/** An upgraded connection: what the server instance writes goes to the front, which relays it to the client. */
class BridgeSocket extends Duplex {
  private readonly link: MessagePort;
  private readonly id: number;
  readonly remoteAddress: string | undefined;
  readonly remotePort: number | undefined;
  /** True when the front said the client connection closed. */
  closed_by_front = false;

  constructor(link: MessagePort, id: number, peer: Peer) {
    super({ allowHalfOpen: true });
    this.link = link;
    this.id = id;
    this.remoteAddress = peer.address ?? undefined;
    this.remotePort = peer.port ?? undefined;
  }

  override _read(): void {}

  override _write(chunk: Buffer, _encoding: BufferEncoding, callback: (error?: Error | null) => void): void {
    const bytes = own_bytes(chunk);
    post_bytes(this.link, { t: 'sdata', id: this.id, chunk: bytes }, bytes);
    callback();
  }

  override _final(callback: (error?: Error | null) => void): void {
    this.link.postMessage({ t: 'send', id: this.id } satisfies ToFront);
    callback();
  }

  override _destroy(error: Error | null, callback: (error?: Error | null) => void): void {
    if (!this.closed_by_front) this.link.postMessage({ t: 'sclose', id: this.id } satisfies ToFront);
    callback(error);
  }
}

/** What the worker side calls for each request: the request handling of the server instance. */
export interface FrontHandlers {
  handle(req: IncomingMessage, res: ServerResponse): void;
  handle_upgrade(req: IncomingMessage, socket: Duplex, head: Buffer): void;
}

/** The worker side of a front link: takes the requests of the front until `detach`. */
export class FrontAttachment {
  private readonly link: MessagePort;
  private readonly handlers: FrontHandlers;
  private readonly requests = new Map<number, FrontRequest>();
  private readonly sockets = new Map<number, BridgeSocket>();
  private readonly on_message = (message: ToWorker): void => {
    this.receive(message);
  };

  constructor(link: MessagePort, handlers: FrontHandlers) {
    this.link = link;
    this.handlers = handlers;
    link.on('message', this.on_message);
  }

  private receive(message: ToWorker): void {
    if (message.t === 'req') {
      this.start(message);
      return;
    }
    const socket = this.sockets.get(message.id);
    const request = this.requests.get(message.id);
    if (message.t === 'data') {
      if (socket !== undefined) socket.push(Buffer.from(message.chunk));
      else request?.push(Buffer.from(message.chunk));
      return;
    }
    if (message.t === 'end') {
      if (socket !== undefined) socket.push(null);
      else request?.push(null);
      this.requests.delete(message.id);
      return;
    }
    // abort: the client connection closed.
    this.requests.delete(message.id);
    request?.destroy();
    if (socket !== undefined) {
      this.sockets.delete(message.id);
      socket.closed_by_front = true;
      socket.destroy();
    }
  }

  private start(message: Extract<ToWorker, { t: 'req' }>): void {
    const received = real_clock.now();
    const request = new FrontRequest(message);
    RECEIVED_AT.set(request, received);
    const req = request as unknown as IncomingMessage;
    if (message.upgrade !== null) {
      const socket = new BridgeSocket(this.link, message.id, message.peer);
      this.sockets.set(message.id, socket);
      socket.on('close', () => this.sockets.delete(message.id));
      request.push(null);
      this.handlers.handle_upgrade(req, socket, Buffer.from(message.upgrade));
      return;
    }
    this.requests.set(message.id, request);
    this.handlers.handle(req, new FrontResponse(this.link, message.id) as unknown as ServerResponse);
  }

  /** Stops taking requests and drops the ones in progress. */
  detach(): void {
    this.link.off('message', this.on_message);
    for (const request of this.requests.values()) request.destroy();
    this.requests.clear();
    for (const socket of this.sockets.values()) socket.destroy();
    this.sockets.clear();
  }
}
