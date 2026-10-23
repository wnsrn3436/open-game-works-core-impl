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
export function listen_on(server: Server, port: number, host?: string): Promise<number | Error> {
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
