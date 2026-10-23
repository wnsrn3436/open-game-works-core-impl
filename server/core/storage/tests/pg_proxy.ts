/**
 * Worker thread of `pg_proxy` (db-adapter.test.ts): a TCP proxy to PostgreSQL that can stop answering like a network
 * partition. While frozen it keeps every connection open, accepts new ones, and drops what either side sends.
 */
import { connect, createServer, type AddressInfo, type Socket } from 'node:net';
import { parentPort, workerData } from 'node:worker_threads';

export interface ProxyInput {
  readonly host: string;
  readonly port: number;
}

export type ProxyRequest = { readonly op: 'freeze' } | { readonly op: 'thaw' };

const input = workerData as ProxyInput;
const port = parentPort;
if (port === null) throw new Error('pg_proxy runs as a worker thread');

let frozen = false;

function pair(client: Socket): void {
  const upstream = connect({ host: input.host, port: input.port });
  const end = (): void => {
    client.destroy();
    upstream.destroy();
  };
  client.on('data', (chunk: Buffer) => {
    if (!frozen) upstream.write(chunk);
  });
  upstream.on('data', (chunk: Buffer) => {
    if (!frozen) client.write(chunk);
  });
  for (const socket of [client, upstream]) {
    socket.on('close', end);
    socket.on('error', end);
  }
}

const server = createServer(pair);
server.listen(0, '127.0.0.1', () => {
  port.postMessage({ op: 'ready', port: (server.address() as AddressInfo).port });
});

port.on('message', (request: ProxyRequest) => {
  frozen = request.op === 'freeze';
  port.postMessage({ op: request.op });
});
