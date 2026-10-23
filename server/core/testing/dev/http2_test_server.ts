/**
 * `start_http2_test_server` and `http1_connect`: the HTTP/2 test server that several modules' core tests share. It is
 * a local TLS server that takes only HTTP/2 (`allowHTTP1` false: a client that does not offer `h2` by ALPN is
 * refused), with the self-signed test certificate of `http2-test-tls.json`. While it runs, the process default CA
 * certificates also trust that certificate, so the global `fetch` reaches it without other options. Servers may run at
 * the same time: the first one to start saves the default CA certificates and the last one to close sets them back.
 */
import { readFileSync } from 'node:fs';
import { createSecureServer, type IncomingHttpHeaders, type ServerHttp2Session, type ServerHttp2Stream } from 'node:http2';
import type { AddressInfo } from 'node:net';
import { connect, getCACertificates, setDefaultCACertificates } from 'node:tls';

const TLS = JSON.parse(readFileSync(new URL('./http2-test-tls.json', import.meta.url), 'utf8')) as { key: string; cert: string };

/** The servers that have started and not closed, and the default CA certificates from before the first of them. */
let running = 0;
let saved_defaults: string[] = [];

function trust_test_certificate(): void {
  if (running === 0) {
    saved_defaults = getCACertificates('default');
    setDefaultCACertificates([...saved_defaults, TLS.cert]);
  }
  running += 1;
}

function untrust_test_certificate(): void {
  running -= 1;
  if (running === 0) setDefaultCACertificates(saved_defaults);
}

/** One request the server received. */
export interface Http2Request {
  /** The ALPN protocol of its connection: always `h2` on this server. */
  readonly alpn: string;
  readonly headers: IncomingHttpHeaders;
  readonly body: string;
}

export interface Http2Reply {
  readonly status: number;
  readonly body: string;
}

export interface Http2TestServer {
  /** `https://localhost:<port>`. */
  readonly origin: string;
  readonly requests: Http2Request[];
  close(): Promise<void>;
}

/** `start_http2_test_server`: starts the server; `reply` answers each request. */
export async function start_http2_test_server(reply: (request: Http2Request) => Http2Reply): Promise<Http2TestServer> {
  const server = createSecureServer({ key: TLS.key, cert: TLS.cert, allowHTTP1: false });
  const sessions = new Set<ServerHttp2Session>();
  const requests: Http2Request[] = [];
  server.on('session', (session: ServerHttp2Session) => {
    sessions.add(session);
    session.on('close', () => sessions.delete(session));
  });
  server.on('stream', (stream: ServerHttp2Stream, headers: IncomingHttpHeaders) => {
    const chunks: Buffer[] = [];
    stream.on('data', (chunk: Buffer) => chunks.push(chunk));
    stream.on('end', () => {
      const request: Http2Request = { alpn: String(stream.session?.alpnProtocol), headers, body: Buffer.concat(chunks).toString('utf8') };
      requests.push(request);
      const r = reply(request);
      stream.respond({ ':status': r.status, 'content-type': 'application/json' });
      stream.end(r.body);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  trust_test_certificate();
  let closed = false;
  return {
    origin: `https://localhost:${String((server.address() as AddressInfo).port)}`,
    requests,
    close: async () => {
      if (!closed) {
        closed = true;
        untrust_test_certificate();
      }
      for (const session of sessions) session.destroy();
      await new Promise<void>((resolve) => {
        server.close(() => {
          resolve();
        });
      });
    },
  };
}

/** `http1_connect`: a TLS connection that offers only HTTP/1.1 by ALPN: `connected`, or the error code that refused it. */
export function http1_connect(origin: string): Promise<string> {
  const url = new URL(origin);
  return new Promise((resolve) => {
    const socket = connect({ host: url.hostname, port: Number(url.port), servername: url.hostname, ca: TLS.cert, ALPNProtocols: ['http/1.1'] });
    socket.once('secureConnect', () => {
      socket.destroy();
      resolve('connected');
    });
    socket.once('error', (error: NodeJS.ErrnoException) => {
      resolve(error.code ?? error.message);
    });
  });
}
