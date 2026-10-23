import * as CoreContract from '../../../generated/contract/core_contract.ts';
import { network_time_limit } from '../../server-time/network_time_limit.ts';
import type { TestServer } from './test_server.ts';

type Received = { readonly frame: CoreContract.MatchmakerFrame | null } | { readonly closed: true };

/** A WebSocket connection to a test server's `GET /realtime` (`connect`). */
export class RealtimeConnection {
  private readonly queue: Received[] = [];
  private waiter: (() => void) | null = null;
  closed = false;
  readonly socket: WebSocket;

  constructor(socket: WebSocket) {
    this.socket = socket;
    socket.binaryType = 'arraybuffer';
    socket.addEventListener('message', (event) => {
      const data: unknown = event.data;
      const frame = data instanceof ArrayBuffer ? CoreContract.MatchmakerFrame.decode(new Uint8Array(data)) : null;
      this.push({ frame });
    });
    socket.addEventListener('close', () => {
      this.closed = true;
      this.push({ closed: true });
    });
  }

  private push(item: Received): void {
    this.queue.push(item);
    this.waiter?.();
    this.waiter = null;
  }

  /** The next received item, waiting until one comes or `signal` aborts. */
  async next(signal: AbortSignal): Promise<Received> {
    for (;;) {
      const item = this.queue.shift();
      if (item !== undefined) return item;
      if (this.closed) return { closed: true };
      if (signal.aborted) throw new Error('testing: read_frame got no frame within the time');
      await new Promise<void>((resolve) => {
        this.waiter = resolve;
        signal.addEventListener('abort', () => {
          resolve();
        }, { once: true });
      });
    }
  }
}

/** `connect`: a WebSocket connection to the test server's `GET /realtime`. Only a matchmaker test server takes it. */
export async function connect(server: TestServer): Promise<RealtimeConnection> {
  server.running();
  if (!server.matchmaker) throw new Error('testing: connect needs a test server started with matchmaker true');
  const socket = new WebSocket(`ws://127.0.0.1:${String(server.port)}/realtime`);
  await new Promise<void>((resolve, reject) => {
    socket.addEventListener('open', () => {
      resolve();
    }, { once: true });
    socket.addEventListener('error', () => {
      reject(new Error('testing: the realtime WebSocket did not open'));
    }, { once: true });
  });
  return new RealtimeConnection(socket);
}

/** `send_frame`: one binary frame, a `MatchmakerFrame` or raw bytes. A closed connection throws. */
export function send_frame(connection: RealtimeConnection, frame: CoreContract.MatchmakerFrame | Uint8Array): void {
  if (connection.closed || connection.socket.readyState !== WebSocket.OPEN) throw new Error('testing: the realtime connection is closed');
  connection.socket.send(frame instanceof Uint8Array ? frame : frame.encode());
}

/**
 * `read_frame`: the next received `MatchmakerFrame`, or null when the connection closed. A frame that does not
 * decode as `MatchmakerFrame` is skipped. No frame within `max_wait_ms` of real time throws.
 */
export async function read_frame(connection: RealtimeConnection, max_wait_ms: bigint): Promise<CoreContract.MatchmakerFrame | null> {
  const signal = network_time_limit(max_wait_ms < 1n ? 1n : max_wait_ms);
  for (;;) {
    const item = await connection.next(signal);
    if ('closed' in item) return null;
    if (item.frame !== null) return item.frame;
  }
}

/** `close`: closes the connection. */
export function close(connection: RealtimeConnection): void {
  connection.socket.close();
}
