/**
 * The IPv4 loopback address of the listening port. A LOCAL server instance and a test server are reached at
 * `http://127.0.0.1:<port>`. On macOS (and other systems with BSD socket semantics) a listener on all addresses
 * (`::`, or `0.0.0.0` without IPv6) does not hold `127.0.0.1` on its port: another socket can bind `127.0.0.1` on
 * that port, before or after the listener, and then takes every connection to `127.0.0.1:<port>`. Docker Desktop
 * does this when it publishes a container port on `127.0.0.1`. There the server instance also listens on
 * `127.0.0.1:<port>` itself. On Linux the listener on all addresses already holds it.
 */
import { createServer, type AddressInfo, type Server } from 'node:net';

export const LOOPBACK = '127.0.0.1';

/** Listens on `port` (all addresses when `host` is not given): the port it listens on, or the listen error. */
export function listen_on(server: Server | import('node:http').Server, port: number, host?: string): Promise<number | Error> {
  return new Promise((resolve) => {
    const on_error = (error: Error): void => {
      resolve(error);
    };
    const on_listening = (): void => {
      server.off('error', on_error);
      resolve((server.address() as AddressInfo).port);
    };
    server.once('error', on_error);
    if (host === undefined) server.listen(port, on_listening);
    else server.listen(port, host, on_listening);
  });
}

/** Stops listening; resolves once the server is closed. */
export function close_server(server: Server): Promise<void> {
  return new Promise((resolve) => {
    server.close(() => {
      resolve();
    });
  });
}

async function check_loopback_free(): Promise<boolean> {
  const all = createServer();
  const port = await listen_on(all, 0);
  if (typeof port !== 'number') return false;
  const loopback = createServer();
  const bound = await listen_on(loopback, port, LOOPBACK);
  if (typeof bound === 'number') await close_server(loopback);
  await close_server(all);
  return typeof bound === 'number';
}

let loopback_free: Promise<boolean> | null = null;

/**
 * Whether another socket can bind `127.0.0.1` on a port a listener on all addresses holds: true on macOS, false on
 * Linux, and false where `127.0.0.1` cannot be bound. Checked once per process.
 */
export function loopback_left_free(): Promise<boolean> {
  loopback_free ??= check_loopback_free();
  return loopback_free;
}

/** How many ports `--port` 0 chooses before listening fails, when each is held on all addresses (`listen_port`). */
const PORT_CHOICES = 16;

/** A server that listens on a port: the port, and the listener on `127.0.0.1:<port>` when it needs one. */
export interface Listening {
  readonly port: number;
  readonly loopback: Server | null;
}

/**
 * Listens on `port` on all addresses with the HTTP (or net) server `server`. Where that leaves `127.0.0.1` on the
 * port free for another socket, it also listens on `127.0.0.1:<port>` with a net server that hands its connections to
 * `server` (`connection` event), so the port is its own on `127.0.0.1` too. It listens on `127.0.0.1:<port>` first,
 * then on all addresses on the port that listener got. With `port` 0 the OS chooses the port on `127.0.0.1` only, and
 * another socket can hold it on all addresses (`EADDRINUSE`); then it chooses again, up to `PORT_CHOICES` times.
 * A string is the failure reason; nothing listens then.
 */
export async function listen_port(server: Server | import('node:http').Server, port: number): Promise<Listening | string> {
  const failed = (host: string | null, error: Error): string => `listen on port ${String(port)} failed: ${host === null ? '' : `${host}: `}${error.message}`;
  if (!(await loopback_left_free())) {
    const listening = await listen_on(server, port);
    return typeof listening === 'number' ? { port: listening, loopback: null } : failed(null, listening);
  }
  for (let choice = 1; ; choice += 1) {
    const loopback = createServer({ allowHalfOpen: true, noDelay: true }, (socket) => {
      server.emit('connection', socket);
    });
    const held = await listen_on(loopback, port, LOOPBACK);
    if (typeof held !== 'number') return failed(LOOPBACK, held);
    const listening = await listen_on(server, held);
    if (typeof listening === 'number') return { port: listening, loopback };
    await close_server(loopback);
    if (port !== 0 || (listening as NodeJS.ErrnoException).code !== 'EADDRINUSE' || choice === PORT_CHOICES) return failed(null, listening);
  }
}
