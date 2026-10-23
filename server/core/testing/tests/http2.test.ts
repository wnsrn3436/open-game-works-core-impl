import { X509Certificate } from 'node:crypto';
import { getCACertificates } from 'node:tls';
import { http1_connect, start_http2_test_server } from '../dev/index.ts';

/**
 * The fingerprints of the process default CA certificates. Setting them back gives the same certificates in another
 * order and PEM line wrapping, so the certificates are compared, not the PEM text.
 */
function default_ca(): string[] {
  return getCACertificates('default').map((pem) => new X509Certificate(pem).fingerprint256).sort();
}

describe('HTTP/2 test server', () => {
  it('the global fetch reaches it over HTTP/2 and its requests are recorded; http1_connect is refused; close restores the default CA certificates', async () => {
    const before = default_ca();
    const h2 = await start_http2_test_server((r) => ({ status: 201, body: JSON.stringify({ path: r.headers[':path'], echo: r.body }) }));
    try {
      expect(h2.origin).toMatch(/^https:\/\/localhost:\d+$/);
      const reply = await fetch(`${h2.origin}/one`, { method: 'POST', headers: { 'x-test': 'a' }, body: 'hello' });
      expect([reply.status, await reply.json()]).toEqual([201, { path: '/one', echo: 'hello' }]);
      expect(h2.requests).toHaveLength(1);
      expect(h2.requests[0]?.alpn).toBe('h2');
      expect(h2.requests[0]?.headers[':method']).toBe('POST');
      expect(h2.requests[0]?.headers['x-test']).toBe('a');
      expect(h2.requests[0]?.body).toBe('hello');
      expect(await http1_connect(h2.origin)).toBe('ERR_SSL_TLSV1_ALERT_NO_APPLICATION_PROTOCOL');
      expect(h2.requests).toHaveLength(1);
    } finally {
      await h2.close();
    }
    expect(default_ca()).toEqual(before);
  });

  it('with two servers running at once, closing the first keeps the second reachable, and closing both restores the default CA certificates', async () => {
    const before = default_ca();
    const a = await start_http2_test_server(() => ({ status: 200, body: '"a"' }));
    let b_closed = false;
    const b = await start_http2_test_server(() => ({ status: 200, body: '"b"' }));
    try {
      await a.close();
      await a.close();
      expect(default_ca()).not.toEqual(before);
      const reply = await fetch(`${b.origin}/after-a-closed`);
      expect([reply.status, await reply.json()]).toEqual([200, 'b']);
      await b.close();
      b_closed = true;
      expect(default_ca()).toEqual(before);
    } finally {
      await a.close();
      if (!b_closed) await b.close();
    }
    expect(default_ca()).toEqual(before);
  });
});
