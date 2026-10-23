/** `server.fetch` without an override: a server that requires HTTP/2 gets HTTP/2 (`server-core` `## module`). */
import { outgoing_fetch } from '../outgoing_http.ts';
import { http1_connect, start_http2_test_server, type Http2TestServer } from '../../testing/dev/index.ts';

let server: Http2TestServer | null = null;

afterEach(async () => {
  await server?.close();
  server = null;
});

describe('outgoing HTTP adapter', () => {
  it('sends over HTTP/2 to a server that refuses HTTP/1.1, with the method, headers and body, and reads the reply', async () => {
    const h2 = await start_http2_test_server((r) => ({ status: r.headers[':path'] === '/gone' ? 410 : 200, body: JSON.stringify({ echo: r.body }) }));
    server = h2;
    expect(await http1_connect(h2.origin)).toBe('ERR_SSL_TLSV1_ALERT_NO_APPLICATION_PROTOCOL');
    const ok = await outgoing_fetch(`${h2.origin}/ok`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-test': 'one' }, body: '{"a":1}' });
    expect([ok.status, await ok.json()]).toEqual([200, { echo: '{"a":1}' }]);
    const gone = await outgoing_fetch(`${h2.origin}/gone`, { method: 'POST', body: '' });
    expect(gone.status).toBe(410);
    await gone.text();
    expect(h2.requests.map((r) => [r.alpn, r.headers[':method'], r.headers[':path']])).toEqual([['h2', 'POST', '/ok'], ['h2', 'POST', '/gone']]);
    expect(h2.requests[0]?.headers['x-test']).toBe('one');
  });
});
