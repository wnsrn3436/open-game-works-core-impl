/**
 * The WebSocket layer of `/realtime` on a plain socket, and the settings rules matchmaker computes itself: the frame
 * size and read time limits of `### security`, the room code settings and the apply retry interval g.
 */
import { connect, createServer, type Server, type Socket } from 'node:net';
import { network_time_limit } from '../../server-time/network_time_limit.ts';
import { read_settings, retry_delay, room_code_failure } from '../shared.ts';
import { WebSocketConnection, encode_frame, handshake_response, read_head, type Violation } from '../websocket.ts';

const KEY = 'dGhlIHNhbXBsZSBub25jZQ==';

/** A masked client frame. */
function client_frame(opcode: number, payload: Uint8Array, fin = true): Buffer {
  const mask = Buffer.from([1, 2, 3, 4]);
  const length = payload.length;
  const head = length < 126 ? Buffer.from([(fin ? 0x80 : 0) | opcode, 0x80 | length]) : Buffer.from([(fin ? 0x80 : 0) | opcode, 0x80 | 126, length >> 8, length & 0xff]);
  const body = Buffer.from(payload.map((v, i) => v ^ (mask[i % 4] ?? 0)));
  return Buffer.concat([head, mask, body]);
}

interface Seen {
  binary: Uint8Array[];
  text: number;
  violations: Violation[];
  closed: number;
}

interface Pair {
  readonly client: Socket;
  readonly seen: Seen;
  readonly received: Buffer[];
  readonly ws: Promise<WebSocketConnection>;
}

let server: Server | null = null;

afterEach(async () => {
  const s = server;
  server = null;
  if (s !== null) await new Promise<void>((resolve) => {
      s.close(() => {
        resolve();
      });
    });
});

/** A server socket wrapped in `WebSocketConnection` and the raw client socket at the other end. */
async function pair(max_frame_bytes = 64, frame_time_ms = 200n, allow = 1000): Promise<Pair> {
  const seen: Seen = { binary: [], text: 0, violations: [], closed: 0 };
  let resolve_ws: (ws: WebSocketConnection) => void = () => {};
  const ws = new Promise<WebSocketConnection>((resolve) => {
    resolve_ws = resolve;
  });
  let frames = 0;
  server = createServer((socket) => {
    resolve_ws(new WebSocketConnection(socket, new Uint8Array(0), {
      max_frame_bytes,
      frame_time_limit: () => network_time_limit(frame_time_ms),
      frame: () => (frames += 1) <= allow,
      binary: (payload) => seen.binary.push(payload),
      text: () => {
        seen.text += 1;
      },
      violation: (reason) => seen.violations.push(reason),
      closed: () => {
        seen.closed += 1;
      },
    }));
  });
  await new Promise<void>((resolve) => {
    server?.listen(0, '127.0.0.1', () => {
      resolve();
    });
  });
  const address = server.address();
  const port = typeof address === 'object' && address !== null ? address.port : 0;
  const client = connect(port, '127.0.0.1');
  const received: Buffer[] = [];
  client.on('data', (chunk: Buffer) => received.push(chunk));
  await new Promise<void>((resolve) => {
    client.on('connect', () => {
      resolve();
    });
  });
  return { client, seen, received, ws };
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function until(check: () => boolean, ms = 2000): Promise<void> {
  const end = Date.now() + ms;
  while (!check()) {
    if (Date.now() > end) throw new Error('condition not met in time');
    await wait(5);
  }
}

describe('WebSocket handshake and frames', () => {
  it('answers a valid upgrade with the RFC 6455 accept value and refuses others', () => {
    const response = handshake_response({ upgrade: 'websocket', 'sec-websocket-key': KEY, 'sec-websocket-version': '13' });
    expect(response).toContain('Sec-WebSocket-Accept: s3pPLMBiTxaQ9kYGzzhZRbK+xOo=');
    expect(handshake_response({ upgrade: 'websocket', 'sec-websocket-key': KEY, 'sec-websocket-version': '8' })).toBeNull();
    expect(handshake_response({ upgrade: 'h2c', 'sec-websocket-key': KEY, 'sec-websocket-version': '13' })).toBeNull();
    expect(handshake_response({ upgrade: 'websocket', 'sec-websocket-key': 'short', 'sec-websocket-version': '13' })).toBeNull();
  });

  it('reads the length of a frame head before its payload and refuses one past the limit', () => {
    expect(read_head(Buffer.from([0x82]), 64)).toBeNull();
    const head = read_head(client_frame(2, new Uint8Array(10)), 64);
    expect(head).toMatchObject({ fin: true, opcode: 2, masked: true, length: 10, head_bytes: 6 });
    expect(read_head(Buffer.from([0x82, 0x80 | 126, 0x01, 0x00]), 64)).toBe('too_large');
    expect(encode_frame(2, new Uint8Array(300)).subarray(0, 4)).toEqual(Buffer.from([0x82, 126, 0x01, 0x2c]));
  });

  it('hands over binary frames and server frames reach the client unmasked', async () => {
    const p = await pair();
    p.client.write(client_frame(2, new Uint8Array([7, 8, 9])));
    await until(() => p.seen.binary.length === 1);
    expect([...(p.seen.binary[0] ?? [])]).toEqual([7, 8, 9]);
    (await p.ws).send(new Uint8Array([1, 2]));
    await until(() => Buffer.concat(p.received).length >= 4);
    expect(Buffer.concat(p.received)).toEqual(Buffer.from([0x82, 2, 1, 2]));
    p.client.destroy();
  });

  it('closes on a frame over max_frame_bytes without handing it over', async () => {
    const p = await pair(8);
    p.client.write(client_frame(2, new Uint8Array(9)));
    await until(() => p.seen.closed === 1);
    expect(p.seen.violations).toEqual(['frame_too_large']);
    expect(p.seen.binary).toEqual([]);
  });

  it('closes when a frame is not complete within the frame read time limit', async () => {
    const p = await pair(64, 100n);
    p.client.write(client_frame(2, new Uint8Array(20)).subarray(0, 10));
    await until(() => p.seen.closed === 1);
    expect(p.seen.violations).toEqual(['frame_read_timeout']);
  });

  it('closes on an unmasked frame and on a fragmented data frame', async () => {
    const a = await pair();
    a.client.write(Buffer.from([0x82, 1, 5]));
    await until(() => a.seen.closed === 1);
    expect(a.seen.violations).toEqual(['protocol']);
    const s = server;
    server = null;
    await new Promise<void>((resolve) => {
      s?.close(() => {
        resolve();
      });
    });
    const b = await pair();
    b.client.write(client_frame(2, new Uint8Array([1]), false));
    await until(() => b.seen.closed === 1);
    expect(b.seen.violations).toEqual(['protocol']);
  });

  it('reports text frames, answers ping with pong, and stops reading when the frame counter refuses', async () => {
    const p = await pair(64, 200n, 2);
    p.client.write(client_frame(1, Buffer.from('hi')));
    p.client.write(client_frame(9, new Uint8Array([4])));
    await until(() => Buffer.concat(p.received).length >= 3);
    expect(p.seen.text).toBe(1);
    expect(Buffer.concat(p.received)).toEqual(Buffer.from([0x8a, 1, 4]));
    p.client.write(client_frame(2, new Uint8Array([1])));
    await wait(50);
    expect(p.seen.binary).toEqual([]);
    p.client.destroy();
  });
});

describe('settings rules', () => {
  it('refuses an empty room code alphabet, a lowercase or repeated character, and a length below 1', () => {
    expect(room_code_failure('ABC123', 6)).toBeNull();
    expect(room_code_failure('', 6)).not.toBeNull();
    expect(room_code_failure('ABc', 6)).not.toBeNull();
    expect(room_code_failure('ABA', 6)).not.toBeNull();
    expect(room_code_failure('AB-', 6)).not.toBeNull();
    expect(room_code_failure('ABC', 0)).not.toBeNull();
  });

  it('computes g(1) as the initial interval and g(a) as min(g(a - 1) × factor ÷ 1000, max interval)', () => {
    const settings = read_settings(base_settings({ 'matchmaker.applyRetryInitialMs': 1000, 'matchmaker.applyRetryFactorPermille': 2500, 'matchmaker.applyRetryMaxIntervalMs': 5000 }));
    expect([1, 2, 3, 4].map((a) => retry_delay(settings, a))).toEqual([1000n, 2500n, 5000n, 5000n]);
  });

  it('throws on a missing or non-integer setting', () => {
    const settings = base_settings({});
    delete settings['matchmaker.tickMs'];
    expect(() => read_settings(settings)).toThrow();
    expect(() => read_settings(base_settings({ 'matchmaker.maxPlayers': 1.5 }))).toThrow();
  });
});

function base_settings(overrides: Record<string, unknown>): Record<string, unknown> {
  return {
    'matchmaker.tickMs': 1000,
    'matchmaker.maxPlayers': 16,
    'matchmaker.reportMarginMs': 60000,
    'matchmaker.sweepIntervalMs': 10000,
    'matchmaker.recordRetentionMs': 604800000,
    'matchmaker.applyRetryInitialMs': 5000,
    'matchmaker.applyRetryFactorPermille': 2000,
    'matchmaker.applyRetryMaxIntervalMs': 600000,
    'matchmaker.applyRetryMaxAttempts': 10,
    'matchmaker.maxFrameBytes': 65536,
    'matchmaker.frameReadTimeoutMs': 10000,
    'matchmaker.framesPerSecond': 50,
    'matchmaker.preAuthAcceptsPerSecond': 10,
    'matchmaker.preAuthFramesPerSecond': 5,
    'matchmaker.preAuthConnections': 5,
    'matchmaker.helloTimeoutMs': 10000,
    'matchmaker.roomCodeAlphabet': 'ABC',
    'matchmaker.roomCodeLength': 6,
    'matchmaker.lockstepMaxDurationMs': 3600000,
    ...overrides,
  };
}
