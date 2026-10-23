/**
 * The real adapters `push-fcm` and `push-apns` against a recorded outgoing HTTP adapter, without a network, and
 * `push-apns` through the runtime's global `fetch` (what `server.fetch` is when `create_server` is given none) against
 * a local server that takes only HTTP/2.
 */
import { generateKeyPairSync, verify } from 'node:crypto';
import type { PushPayload, SendFailure } from '../adapter.ts';
import { create_apns_adapter } from '../adapters/apns.ts';
import { create_fcm_adapter } from '../adapters/fcm.ts';
import type { Fetch } from '../adapters/http.ts';
import { start_http2_test_server } from '../../testing/dev/index.ts';

const PAYLOAD: PushPayload = { title: 'T', body: 'B', data: { message_id: '7', push_id: '99' } };

interface Seen {
  readonly url: string;
  readonly headers: Record<string, string>;
  readonly body: string;
}

/** An outgoing HTTP adapter that records requests and answers each with `reply(url, body)`. */
function recorder(reply: (url: string, body: string) => { status: number; body: string }): { fetch: Fetch; seen: Seen[] } {
  const seen: Seen[] = [];
  const fetch: Fetch = (url, init) => {
    const body = typeof init.body === 'string' ? init.body : '';
    seen.push({ url, headers: init.headers as Record<string, string>, body });
    const r = reply(url, body);
    return Promise.resolve(new Response(r.body, { status: r.status }));
  };
  return { fetch, seen };
}

function jwt_parts(token: string): { header: Record<string, unknown>; claims: Record<string, unknown>; input: string; signature: Buffer } {
  const [h, c, s] = token.split('.') as [string, string, string];
  return {
    header: JSON.parse(Buffer.from(h, 'base64url').toString()) as Record<string, unknown>,
    claims: JSON.parse(Buffer.from(c, 'base64url').toString()) as Record<string, unknown>,
    input: `${h}.${c}`,
    signature: Buffer.from(s, 'base64url'),
  };
}

const signal = (): AbortSignal => new AbortController().signal;

const failed = (reason: string): SendFailure => ({ result: 'FAILED', reason });

/** An FCM `INVALID_ARGUMENT` error response whose `BadRequest` detail has a field violation on `field`. */
function invalid_argument(field: string): string {
  return JSON.stringify({ error: { status: 'INVALID_ARGUMENT', details: [
    { '@type': 'type.googleapis.com/google.firebase.fcm.v1.FcmError', errorCode: 'INVALID_ARGUMENT' },
    { '@type': 'type.googleapis.com/google.rpc.BadRequest', fieldViolations: [{ field, description: 'invalid' }] },
  ] } });
}
const NOW = 1_800_000_000_000n;

describe('push-fcm', () => {
  const keys = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const pem = keys.privateKey.export({ type: 'pkcs8', format: 'pem' });

  it('exchanges an RS256 service account JWT for an access token, and sends each token to messages:send of the project', async () => {
    const { fetch, seen } = recorder((url, body) => {
      if (url === 'https://oauth2.googleapis.com/token') return { status: 200, body: JSON.stringify({ access_token: 'at-1', expires_in: 3600 }) };
      const token = (JSON.parse(body) as { message: { token: string } }).message.token;
      if (token === 'gone') return { status: 404, body: JSON.stringify({ error: { status: 'NOT_FOUND', details: [{ errorCode: 'UNREGISTERED' }] } }) };
      if (token === 'bad') return { status: 400, body: invalid_argument('message.token') };
      if (token === 'busy') return { status: 503, body: '' };
      return { status: 200, body: '{"name":"m"}' };
    });
    const adapter = create_fcm_adapter({ project_id: 'proj-1', service_account_email: 'sa@proj-1.iam.gserviceaccount.com', private_key_pem: pem, fetch, max_response_bytes: 4096, now: () => NOW });
    expect(await adapter.send(['ok', 'gone', 'bad', 'busy'], PAYLOAD, signal())).toEqual(['OK', 'INVALID_TOKEN', 'INVALID_TOKEN', failed('HTTP 503')]);
    const exchange = seen[0] as Seen;
    expect(exchange.url).toBe('https://oauth2.googleapis.com/token');
    const form = new URLSearchParams(exchange.body);
    expect(form.get('grant_type')).toBe('urn:ietf:params:oauth:grant-type:jwt-bearer');
    const jwt = jwt_parts(form.get('assertion') ?? '');
    expect(jwt.header.alg).toBe('RS256');
    expect(jwt.claims).toEqual({
      iss: 'sa@proj-1.iam.gserviceaccount.com', scope: 'https://www.googleapis.com/auth/firebase.messaging', aud: 'https://oauth2.googleapis.com/token',
      iat: 1_800_000_000, exp: 1_800_003_600,
    });
    expect(verify('sha256', Buffer.from(jwt.input), keys.publicKey, jwt.signature)).toBe(true);
    const send = seen[1] as Seen;
    expect(send.url).toBe('https://fcm.googleapis.com/v1/projects/proj-1/messages:send');
    expect(send.headers.authorization).toBe('Bearer at-1');
    expect(JSON.parse(send.body)).toEqual({ message: { token: 'ok', notification: { title: 'T', body: 'B' }, data: { message_id: '7', push_id: '99' } } });
    await adapter.send(['ok'], PAYLOAD, signal());
    expect(seen.filter((s) => s.url === 'https://oauth2.googleapis.com/token')).toHaveLength(1);
  });

  it('INVALID_ARGUMENT is INVALID_TOKEN only for a field violation on message.token; a payload problem and a 404 without UNREGISTERED are FAILED with the HTTP status and FCM error code', async () => {
    const { fetch } = recorder((url, body) => {
      if (url === 'https://oauth2.googleapis.com/token') return { status: 200, body: JSON.stringify({ access_token: 'at-1', expires_in: 3600 }) };
      const token = (JSON.parse(body) as { message: { token: string } }).message.token;
      if (token === 'bad') return { status: 400, body: invalid_argument('message.token') };
      if (token === 'big') return { status: 400, body: invalid_argument('message') };
      if (token === 'plain') return { status: 400, body: JSON.stringify({ error: { status: 'INVALID_ARGUMENT', details: [{ errorCode: 'INVALID_ARGUMENT' }] } }) };
      if (token === 'project') return { status: 404, body: JSON.stringify({ error: { status: 'NOT_FOUND' } }) };
      return { status: 404, body: JSON.stringify({ error: { status: 'NOT_FOUND', details: [{ errorCode: 'UNREGISTERED' }] } }) };
    });
    const adapter = create_fcm_adapter({ project_id: 'p', service_account_email: 'e', private_key_pem: pem, fetch, max_response_bytes: 4096, now: () => NOW });
    expect(await adapter.send(['bad', 'big', 'plain', 'project', 'gone'], PAYLOAD, signal())).toEqual([
      'INVALID_TOKEN', failed('HTTP 400 INVALID_ARGUMENT'), failed('HTTP 400 INVALID_ARGUMENT'), failed('HTTP 404 NOT_FOUND'), 'INVALID_TOKEN',
    ]);
  });

  it('a failed token exchange, a network failure and a response over routing.externalMaxResponseBytes are FAILED with the reason', async () => {
    const refused = create_fcm_adapter({
      project_id: 'p', service_account_email: 'e', private_key_pem: pem, max_response_bytes: 4096, now: () => NOW,
      fetch: recorder(() => ({ status: 401, body: '{"error":"invalid_grant","error_description":"Invalid JWT Signature."}' })).fetch,
    });
    expect(await refused.send(['a', 'b'], PAYLOAD, signal())).toEqual([failed('token exchange HTTP 401 invalid_grant'), failed('token exchange HTTP 401 invalid_grant')]);
    const offline = create_fcm_adapter({ project_id: 'p', service_account_email: 'e', private_key_pem: pem, max_response_bytes: 4096, now: () => NOW, fetch: () => Promise.reject(new Error('offline')) });
    expect(await offline.send(['a'], PAYLOAD, signal())).toEqual([failed('token exchange network error Error')]);
    const large = create_fcm_adapter({
      project_id: 'p', service_account_email: 'e', private_key_pem: pem, max_response_bytes: 64, now: () => NOW,
      fetch: recorder(() => ({ status: 200, body: JSON.stringify({ access_token: 'x'.repeat(100), expires_in: 3600 }) })).fetch,
    });
    expect(await large.send(['a'], PAYLOAD, signal())).toEqual([failed('token exchange HTTP 200 response over routing.externalMaxResponseBytes')]);
    const no_token = create_fcm_adapter({
      project_id: 'p', service_account_email: 'e', private_key_pem: pem, max_response_bytes: 4096, now: () => NOW,
      fetch: recorder(() => ({ status: 200, body: '{}' })).fetch,
    });
    expect(await no_token.send(['a'], PAYLOAD, signal())).toEqual([failed('token exchange HTTP 200 without access_token and expires_in')]);
  });

  it('a network failure of a send is FAILED with the system error code and without the URL, the token or the error message', async () => {
    const fetch: Fetch = (url) => {
      if (url === 'https://oauth2.googleapis.com/token') return Promise.resolve(new Response(JSON.stringify({ access_token: 'at-1', expires_in: 3600 }), { status: 200 }));
      return Promise.reject(new TypeError(`fetch failed for ${url} token-secret-1`, { cause: Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' }) }));
    };
    const adapter = create_fcm_adapter({ project_id: 'p', service_account_email: 'e', private_key_pem: pem, fetch, max_response_bytes: 4096, now: () => NOW });
    const results = await adapter.send(['token-secret-1'], PAYLOAD, signal());
    expect(results).toEqual([failed('network error ECONNREFUSED')]);
  });
});

describe('push-apns', () => {
  const keys = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const pem = keys.privateKey.export({ type: 'pkcs8', format: 'pem' });

  it('sends to the production or development endpoint with an ES256 provider token, apns-topic appId, and maps the results', async () => {
    for (const [name, host] of [['push-apns', 'https://api.push.apple.com'], ['push-apns-sandbox', 'https://api.sandbox.push.apple.com']] as const) {
      const { fetch, seen } = recorder((url) => {
        if (url.endsWith('/gone')) return { status: 410, body: JSON.stringify({ reason: 'Unregistered' }) };
        if (url.endsWith('/bad')) return { status: 400, body: JSON.stringify({ reason: 'BadDeviceToken' }) };
        if (url.endsWith('/big')) return { status: 413, body: JSON.stringify({ reason: 'PayloadTooLarge' }) };
        return { status: 200, body: '' };
      });
      const adapter = create_apns_adapter({ name, key_id: 'KEY1234567', team_id: 'TEAM123456', topic: 'com.example.coretest', private_key_pem: pem, fetch, max_response_bytes: 4096, now: () => NOW });
      expect(await adapter.send(['ok', 'gone', 'bad', 'big'], PAYLOAD, signal())).toEqual(['OK', 'INVALID_TOKEN', 'INVALID_TOKEN', failed('HTTP 413 PayloadTooLarge')]);
      const first = seen[0] as Seen;
      expect(first.url).toBe(`${host}/3/device/ok`);
      expect(first.headers['apns-topic']).toBe('com.example.coretest');
      expect(first.headers['apns-push-type']).toBe('alert');
      expect(JSON.parse(first.body)).toEqual({ aps: { alert: { title: 'T', body: 'B' } }, message_id: '7', push_id: '99' });
      const jwt = jwt_parts((first.headers.authorization ?? '').replace(/^bearer /, ''));
      expect(jwt.header).toEqual(expect.objectContaining({ alg: 'ES256', kid: 'KEY1234567' }));
      expect(jwt.claims).toEqual({ iss: 'TEAM123456', iat: 1_800_000_000 });
      expect(verify('sha256', Buffer.from(jwt.input), { key: keys.publicKey, dsaEncoding: 'ieee-p1363' }, jwt.signature)).toBe(true);
    }
  });
  it('sends over HTTP/2 through the global fetch to a server that refuses HTTP/1.1, and maps its replies', async () => {
    const h2 = await start_http2_test_server((r) => {
      const token = String(r.headers[':path']).slice('/3/device/'.length);
      if (token === 'gone') return { status: 410, body: JSON.stringify({ reason: 'Unregistered', timestamp: 1 }) };
      if (token === 'bad') return { status: 400, body: JSON.stringify({ reason: 'BadDeviceToken' }) };
      if (token === 'busy') return { status: 503, body: JSON.stringify({ reason: 'ServiceUnavailable' }) };
      return { status: 200, body: '' };
    });
    try {
      // The development endpoint's origin goes to the local server; everything else is the adapter's own request.
      const to_local: Fetch = (url, init) => fetch(url.replace('https://api.sandbox.push.apple.com', h2.origin), init);
      const adapter = create_apns_adapter({ name: 'push-apns-sandbox', key_id: 'KEY1234567', team_id: 'TEAM123456', topic: 'com.example.coretest', private_key_pem: pem, fetch: to_local, max_response_bytes: 4096, now: () => NOW });
      expect(await adapter.send(['ok', 'gone', 'bad', 'busy'], PAYLOAD, signal())).toEqual(['OK', 'INVALID_TOKEN', 'INVALID_TOKEN', failed('HTTP 503 ServiceUnavailable')]);
      expect(h2.requests.map((r) => r.alpn)).toEqual(['h2', 'h2', 'h2', 'h2']);
      const ok = h2.requests.find((r) => r.headers[':path'] === '/3/device/ok');
      expect(ok?.headers[':method']).toBe('POST');
      expect(ok?.headers['apns-topic']).toBe('com.example.coretest');
      expect(ok?.headers['apns-push-type']).toBe('alert');
      expect(JSON.parse(ok?.body ?? '')).toEqual({ aps: { alert: { title: 'T', body: 'B' } }, message_id: '7', push_id: '99' });
      const jwt = jwt_parts(String(ok?.headers.authorization).replace(/^bearer /, ''));
      expect(verify('sha256', Buffer.from(jwt.input), { key: keys.publicKey, dsaEncoding: 'ieee-p1363' }, jwt.signature)).toBe(true);
    } finally {
      await h2.close();
    }
  });

  it('a network failure, an abort and a response over routing.externalMaxResponseBytes are FAILED with the reason and without the token', async () => {
    const make = (fetch: Fetch, max = 4096): ReturnType<typeof create_apns_adapter> =>
      create_apns_adapter({ name: 'push-apns', key_id: 'K', team_id: 'T', topic: 'com.example.coretest', private_key_pem: pem, fetch, max_response_bytes: max, now: () => NOW });
    const refused: Fetch = (url) => Promise.reject(new TypeError(`fetch failed: ${url}`, { cause: { code: 'UND_ERR_SOCKET' } }));
    expect(await make(refused).send(['apns-secret-token'], PAYLOAD, signal())).toEqual([failed('network error UND_ERR_SOCKET')]);
    const controller = new AbortController();
    controller.abort();
    const aborting: Fetch = (_url, init) => (init.signal?.aborted === true ? Promise.reject(new DOMException('aborted', 'AbortError')) : Promise.resolve(new Response('')));
    expect(await make(aborting).send(['apns-secret-token'], PAYLOAD, controller.signal)).toEqual([failed('aborted')]);
    const large = recorder(() => ({ status: 400, body: JSON.stringify({ reason: 'x'.repeat(100) }) })).fetch;
    expect(await make(large, 64).send(['apns-secret-token'], PAYLOAD, signal())).toEqual([failed('HTTP 400 response over routing.externalMaxResponseBytes')]);
    const odd = recorder(() => ({ status: 500, body: JSON.stringify({ reason: 'apns-secret-token is bad' }) })).fetch;
    expect(await make(odd).send(['apns-secret-token'], PAYLOAD, signal())).toEqual([failed('HTTP 500')]);
  });
});
