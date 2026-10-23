import { generateKeyPairSync, sign, type KeyObject, type webcrypto } from 'node:crypto';
import { parse_desktop_credential } from '../adapters/common.ts';
import { create_login_apple } from '../adapters/login_apple.ts';
import { create_login_google } from '../adapters/login_google.ts';
import { FakeLoginAdapter } from '../dev/adapters/fake.ts';
import type { HttpAdapter, HttpRequest, KeySource } from '../deps.ts';

const NOW = 1_800_000_000_000n;
const LATER = Number(NOW / 1000n) + 3600;

interface Key {
  kid: string;
  private_key: KeyObject;
  jwk: webcrypto.JsonWebKey & { kid: string };
}

function rsa(kid: string): Key {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  return { kid, private_key: privateKey, jwk: { ...publicKey.export({ format: 'jwk' }), kid } };
}

function token(key: Key, claims: Record<string, unknown>): string {
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', kid: key.kid })).toString('base64url');
  const payload = Buffer.from(JSON.stringify(claims)).toString('base64url');
  return `${header}.${payload}.${sign('RSA-SHA256', Buffer.from(`${header}.${payload}`), key.private_key).toString('base64url')}`;
}

function source(keys: Key[], calls: { n: number }): KeySource {
  return () => {
    calls.n += 1;
    return Promise.resolve({ ok: true, keys: keys.map((k) => k.jwk) });
  };
}

const offline: HttpAdapter = () => Promise.resolve({ ok: false, failure: 'communication' });
const signal = new AbortController().signal;

const GOOGLE = { server_client_id: 'server-id', ios_client_id: '', desktop_client_id: 'desktop-id', desktop_client_secret: 'secret', jwks_cache_ms: 60_000n, max_response_bytes: 65_536 };

describe('login-google verify', () => {
  const key = rsa('g1');
  const other = rsa('g1');
  const google = create_login_google(GOOGLE, offline, source([key], { n: 0 }), () => NOW);
  const claims = { iss: 'https://accounts.google.com', aud: 'server-id', exp: LATER, sub: 'google-sub' };

  it('takes a token of a provider key whose aud is the server or the desktop client ID', async () => {
    expect(await google.verify(token(key, claims), signal)).toEqual({ ok: true, value: 'google-sub' });
    expect(await google.verify(token(key, { ...claims, aud: 'desktop-id', iss: 'accounts.google.com' }), signal)).toEqual({ ok: true, value: 'google-sub' });
  });

  it('refuses another aud, another iss, an expired token and another key', async () => {
    const refused = { ok: false, failure: 'rejected' };
    expect(await google.verify(token(key, { ...claims, aud: 'someone-else' }), signal)).toEqual(refused);
    expect(await google.verify(token(key, { ...claims, aud: '' }), signal)).toEqual(refused);
    expect(await google.verify(token(key, { ...claims, iss: 'https://evil.example' }), signal)).toEqual(refused);
    expect(await google.verify(token(key, { ...claims, exp: Number(NOW / 1000n) }), signal)).toEqual(refused);
    expect(await google.verify(token(other, claims), signal)).toEqual(refused);
  });

  it('keeps the JWKS for jwksCacheMs and fetches again for an unknown kid or after that', async () => {
    const calls = { n: 0 };
    let now = NOW;
    const cached = create_login_google(GOOGLE, offline, source([key], calls), () => now);
    await cached.verify(token(key, claims), signal);
    await cached.verify(token(key, claims), signal);
    expect(calls.n).toBe(1);
    await cached.verify(token(rsa('unknown'), claims), signal);
    expect(calls.n).toBe(2);
    now += 60_000n;
    await cached.verify(token(key, { ...claims, exp: LATER + 120 }), signal);
    expect(calls.n).toBe(3);
  });

  it('reports a key source failure as that failure', async () => {
    const failing = create_login_google(GOOGLE, offline, () => Promise.resolve({ ok: false, failure: 'timeout' }), () => NOW);
    expect(await failing.verify(token(key, claims), signal)).toEqual({ ok: false, failure: 'timeout' });
  });

  it('exchanges a desktop credential at the Google token endpoint and keeps only the ID token', async () => {
    const requests: HttpRequest[] = [];
    const http: HttpAdapter = (request) => {
      requests.push(request);
      return Promise.resolve({ ok: true, status: 200, body: new TextEncoder().encode(JSON.stringify({ id_token: 'the-id-token', access_token: 'x', refresh_token: 'y' })) });
    };
    const exchanging = create_login_google(GOOGLE, http, source([key], { n: 0 }), () => NOW);
    const credential = JSON.stringify({ authorization_code: 'code-1', code_verifier: 'verifier-1', redirect_uri: 'http://127.0.0.1:53682' });
    expect(await exchanging.exchange_desktop(credential, signal)).toEqual({ ok: true, value: 'the-id-token' });
    expect(requests).toHaveLength(1);
    const form = new URLSearchParams(new TextDecoder().decode(requests[0]?.body ?? new Uint8Array()));
    expect(requests[0]?.url).toBe('https://oauth2.googleapis.com/token');
    expect(Object.fromEntries(form)).toEqual({ grant_type: 'authorization_code', code: 'code-1', code_verifier: 'verifier-1', redirect_uri: 'http://127.0.0.1:53682', client_id: 'desktop-id', client_secret: 'secret' });
  });

  it('refuses a desktop credential whose redirect_uri is not http://127.0.0.1:<port> without calling Google', async () => {
    const requests: HttpRequest[] = [];
    const http: HttpAdapter = (request) => {
      requests.push(request);
      return Promise.resolve({ ok: false, failure: 'communication' });
    };
    const exchanging = create_login_google(GOOGLE, http, source([key], { n: 0 }), () => NOW);
    for (const redirect_uri of ['http://localhost:5000', 'https://127.0.0.1:5000', 'http://127.0.0.1:0', 'http://127.0.0.1:65536', 'http://127.0.0.1:80/x']) {
      const credential = JSON.stringify({ authorization_code: 'c', code_verifier: 'v', redirect_uri });
      expect(await exchanging.exchange_desktop(credential, signal)).toEqual({ ok: false, failure: 'rejected' });
    }
    expect(await exchanging.exchange_desktop('{"authorization_code":"c"}', signal)).toEqual({ ok: false, failure: 'rejected' });
    expect(requests).toHaveLength(0);
    expect(parse_desktop_credential(JSON.stringify({ authorization_code: 'c', code_verifier: 'v', redirect_uri: 'http://127.0.0.1:65535' }))).not.toBeNull();
  });
});

describe('login-apple', () => {
  const key = rsa('a1');
  const pem = generateKeyPairSync('ec', { namedCurve: 'P-256' }).privateKey.export({ format: 'pem', type: 'pkcs8' });
  const config = { app_id: 'com.example.game', team_id: 'TEAM123456', key_id: 'KEY1234567', private_key_pem: pem, jwks_cache_ms: 60_000n, max_response_bytes: 65_536 };
  const claims = { iss: 'https://appleid.apple.com', aud: 'com.example.game', exp: LATER, sub: 'apple-sub' };
  const credential = (claim: Record<string, unknown>): string => JSON.stringify({ identity_token: token(key, claim), authorization_code: 'code-a' });

  it('takes an identity token whose aud is the app ID and refuses another aud', async () => {
    const apple = create_login_apple(config, offline, source([key], { n: 0 }), () => NOW);
    expect(apple).not.toBeNull();
    expect(await apple?.verify(credential(claims), signal)).toEqual({ ok: true, value: 'apple-sub' });
    expect(await apple?.verify(credential({ ...claims, aud: 'com.example.other' }), signal)).toEqual({ ok: false, failure: 'rejected' });
    expect(await apple?.verify('fake:x', signal)).toEqual({ ok: false, failure: 'rejected' });
  });

  it('exchanges the authorization code with an ES256 client secret and reports a communication failure', async () => {
    const requests: HttpRequest[] = [];
    const http: HttpAdapter = (request) => {
      requests.push(request);
      return Promise.resolve({ ok: false, failure: 'communication' });
    };
    const apple = create_login_apple(config, http, source([key], { n: 0 }), () => NOW);
    expect(await apple?.exchange(credential(claims), signal)).toEqual({ ok: false, failure: 'communication' });
    const form = new URLSearchParams(new TextDecoder().decode(requests[0]?.body ?? new Uint8Array()));
    expect(form.get('client_id')).toBe('com.example.game');
    const [header, payload] = (form.get('client_secret') ?? '').split('.') as [string, string];
    expect(JSON.parse(Buffer.from(header, 'base64url').toString())).toEqual({ alg: 'ES256', kid: 'KEY1234567' });
    expect(JSON.parse(Buffer.from(payload, 'base64url').toString())).toMatchObject({ iss: 'TEAM123456', sub: 'com.example.game', aud: 'https://appleid.apple.com' });
  });

  it('does not make an adapter of a key that is not an EC private key', () => {
    expect(create_login_apple({ ...config, private_key_pem: 'nope' }, offline, source([key], { n: 0 }), () => NOW)).toBeNull();
  });
});

describe('fake social adapter', () => {
  /** A signal that does not abort during the test. */
  const open = (): AbortSignal => new AbortController().signal;

  it('takes fake:<text> as the account <text> and refuses other forms', async () => {
    const adapter = new FakeLoginAdapter('login-apple');
    expect(await adapter.verify('fake:abc', open())).toEqual({ ok: true, value: 'abc' });
    expect(await adapter.verify('abc', open())).toEqual({ ok: false, failure: 'rejected' });
    expect(await adapter.exchange('fake:abc', open())).toEqual({ ok: true, value: 'fake:abc' });
    expect(await adapter.revoke('fake:abc', open())).toEqual({ ok: true, value: true });
    expect(adapter.calls().map((c) => c.operation)).toEqual(['verify', 'verify', 'exchange', 'revoke']);
  });

  it('uses a set result and a set failure condition on every call until set again; the failure condition wins', async () => {
    const adapter = new FakeLoginAdapter('login-google');
    adapter.set_result('verify', 'chosen');
    expect(await adapter.verify('fake:a', open())).toEqual({ ok: true, value: 'chosen' });
    expect(await adapter.verify('fake:b', open())).toEqual({ ok: true, value: 'chosen' });
    adapter.set_failure('verify', 'communication_failure');
    expect(await adapter.verify('fake:a', open())).toEqual({ ok: false, failure: 'communication' });
    adapter.set_failure('verify', 'rejected');
    expect(await adapter.verify('fake:a', open())).toEqual({ ok: false, failure: 'rejected' });
    adapter.set_failure('verify', null);
    expect(await adapter.verify('fake:a', open())).toEqual({ ok: true, value: 'chosen' });
    expect(adapter.calls().map((c) => c.input)).toEqual(['fake:a', 'fake:b', 'fake:a', 'fake:a', 'fake:a']);
  });

  it('ends a call with the timeout failure condition only when its signal aborts, then gives timeout', async () => {
    for (const operation of ['verify', 'exchange', 'revoke', 'exchange_desktop'] as const) {
      const adapter = new FakeLoginAdapter(operation === 'exchange_desktop' ? 'login-google' : 'login-apple');
      adapter.set_failure(operation, 'timeout');
      const limit = new AbortController();
      let settled = false;
      const call = adapter[operation]('fake:a', limit.signal).then((result) => {
        settled = true;
        return result;
      });
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(settled).toBe(false);
      limit.abort();
      expect(await call).toEqual({ ok: false, failure: 'timeout' });
    }
  });

  it('checks the desktop credential like the real adapter in exchange_desktop', async () => {
    const adapter = new FakeLoginAdapter('login-google');
    const good = JSON.stringify({ authorization_code: 'acct', code_verifier: 'v', redirect_uri: 'http://127.0.0.1:4000' });
    const bad = JSON.stringify({ authorization_code: 'acct', code_verifier: 'v', redirect_uri: 'http://example.com:4000' });
    expect(await adapter.exchange_desktop(good, open())).toEqual({ ok: true, value: 'fake:acct' });
    expect(await adapter.exchange_desktop(bad, open())).toEqual({ ok: false, failure: 'rejected' });
  });
});
