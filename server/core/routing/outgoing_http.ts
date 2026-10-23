import type { HttpFetch } from './context.ts';

/**
 * The outgoing HTTP adapter of a server instance that `create_server` did not give one (`server.fetch`): the
 * runtime's global `fetch`. Over TLS it offers HTTP/2 by ALPN and uses it with a server that takes it, so a server
 * that requires HTTP/2 (APNs) gets HTTP/2. The core test `outgoing_http.test.ts` checks this against a server that
 * refuses HTTP/1.1, so a runtime whose `fetch` cannot speak HTTP/2 fails the core test.
 */
export const outgoing_fetch: HttpFetch = (url, init) => fetch(url, init);
