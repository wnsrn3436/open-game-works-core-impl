import * as CoreContract from '../../../generated/contract/core_contract.ts';
import {
  E,
  EXP_LATER,
  P,
  T0,
  admin,
  call,
  fake,
  guest,
  id_token,
  log_text,
  login,
  next_user_id,
  personal_rows,
  rsa_key,
  social,
  start,
  testing,
  withdraw,
  type TestServer,
  type TestSession,
} from './helpers.ts';

let server: TestServer;
beforeAll(async () => {
  server = await start();
});
afterAll(async () => {
  await testing.stop_test_server(server);
});

function link(session: TestSession, provider: CoreContract.LoginProvider, credential: string): Promise<{ code: number; response: CoreContract.LinkAccountResponse }> {
  const request = Object.assign(new CoreContract.LinkAccountRequest(), { provider, credential });
  return call<CoreContract.LinkAccountResponse>(session, 'core/LinkAccount', request);
}

describe('social Login', () => {
  it('the same fake credential twice is the same user; another credential is another user', async () => {
    const a = await social(server, P.LOGIN_PROVIDER_GOOGLE, 'same-1');
    const b = await social(server, P.LOGIN_PROVIDER_GOOGLE, 'same-1');
    const c = await social(server, P.LOGIN_PROVIDER_GOOGLE, 'same-2');
    expect(b.result.user_id).toBe(a.result.user_id);
    expect(c.result.user_id).not.toBe(a.result.user_id);
    expect(a.result.linked_providers).toEqual([P.LOGIN_PROVIDER_GOOGLE]);
  });

  it('the social account of a withdrawn user logs in as a new user ID', async () => {
    const a = await social(server, P.LOGIN_PROVIDER_GOOGLE, 'withdrawn-1');
    expect(await withdraw(a.session)).toBe(0);
    const b = await social(server, P.LOGIN_PROVIDER_GOOGLE, 'withdrawn-1');
    expect(b.result.user_id).not.toBe(a.result.user_id);
  });

  it('an adapter past its time limit is EXTERNAL_SERVICE_FAILED at auth.socialVerifyTimeoutMs and makes no user', async () => {
    // Two servers with different settings: each request ends at its own server's setting, not at a fixed value.
    for (const limit_ms of [300, 1500]) {
      const own = await start({ settings: { 'auth.socialVerifyTimeoutMs': limit_ms } });
      try {
        const before = await next_user_id(own);
        fake(own, 'login-google').set_failure('verify', 'timeout');
        const started = performance.now();
        expect((await login(own, P.LOGIN_PROVIDER_GOOGLE, 'fake:slow')).code).toBe(E.CORE_ERROR_EXTERNAL_SERVICE_FAILED);
        // The fake call ends only when the time limit signal aborts, so the request takes the time limit.
        const elapsed = performance.now() - started;
        expect(elapsed).toBeGreaterThanOrEqual(limit_ms - 5);
        expect(elapsed).toBeLessThan(limit_ms + 600);
        fake(own, 'login-google').set_failure('verify', null);
        expect(await next_user_id(own)).toBe(before + 1n);
      } finally {
        await testing.stop_test_server(own);
      }
    }
  });

  it('two concurrent Logins of a new social account get one user; the losing new user is withdrawn and only the winner records core_user_created', async () => {
    const first = await next_user_id(server);
    const [a, b] = await Promise.all([login(server, P.LOGIN_PROVIDER_GOOGLE, 'fake:race-1'), login(server, P.LOGIN_PROVIDER_GOOGLE, 'fake:race-1')]);
    expect([a.code, b.code]).toEqual([0, 0]);
    expect(a.response.result?.user_id).toBe(b.response.result?.user_id);
    const made = [first + 1n, first + 2n];
    // Both requests may make a new user, or the second may already find the first one's link.
    const records = await Promise.all(made.map((id) => admin(server, 'get_user', { user_id: id.toString() })));
    expect(records.filter((r) => r.status === 200 && r.body.withdrawn_at === null)).toHaveLength(1);
    const winner = a.response.result?.user_id ?? 0n;
    const events = async (user_id: bigint): Promise<string[]> => {
      const reply = await admin(server, 'list_server_events', { user_id: user_id.toString(), from_at: T0.toString(), to_at: (T0 + 86_400_000n).toString(), limit: 100 });
      return ((reply.body.entries ?? []) as { name: string }[]).map((e) => e.name);
    };
    expect((await events(winner)).filter((n) => n === 'core_user_created')).toHaveLength(1);
    const loser = made.find((_, i) => records[i]?.status === 200 && records[i].body.withdrawn_at !== null);
    if (loser === undefined) return;
    expect(await personal_rows(server, loser, 'auth_social_link')).toEqual([]);
    expect(await events(loser)).not.toContain('core_user_created');
  });

  it('a GOOGLE desktop credential goes through exchange_desktop and then verify of the ID token it gives', async () => {
    const google = fake(server, 'login-google');
    const credential = JSON.stringify({ authorization_code: 'desktop-acct', code_verifier: 'verifier-secret', redirect_uri: 'http://127.0.0.1:45000' });
    const before = google.calls().length;
    const reply = await login(server, P.LOGIN_PROVIDER_GOOGLE, credential);
    expect(reply.code).toBe(0);
    expect(google.calls().slice(before).map((c) => c.operation)).toEqual(['exchange_desktop', 'verify']);
    expect(google.calls().at(-1)?.input).toBe('fake:desktop-acct');
  });

  it('a desktop credential whose redirect_uri is not http://127.0.0.1:<port> is SOCIAL_LOGIN_INVALID and the log has no code or verifier', async () => {
    const credential = JSON.stringify({ authorization_code: 'secret-code-77', code_verifier: 'secret-verifier-77', redirect_uri: 'https://127.0.0.1:45000' });
    expect((await login(server, P.LOGIN_PROVIDER_GOOGLE, credential)).code).toBe(E.CORE_ERROR_SOCIAL_LOGIN_INVALID);
    const text = log_text(server);
    expect(text).not.toContain('secret-code-77');
    expect(text).not.toContain('secret-verifier-77');
  });

  it('APPLE Login and LinkAccount call exchange and keep its refresh token; a refused exchange is SOCIAL_LOGIN_INVALID with no user', async () => {
    const apple = fake(server, 'login-apple');
    const a = await social(server, P.LOGIN_PROVIDER_APPLE, 'apple-1');
    expect(apple.calls().filter((c) => c.operation === 'exchange').map((c) => c.input)).toContain('fake:apple-1');
    expect((await personal_rows(server, a.result.user_id, 'auth_apple_token')).map((r) => r.refresh_token)).toEqual(['fake:apple-1']);
    const g = await guest(server);
    expect((await link(g.session, P.LOGIN_PROVIDER_APPLE, 'fake:apple-2')).code).toBe(0);
    expect((await personal_rows(server, g.result.user_id, 'auth_apple_token')).map((r) => r.refresh_token)).toEqual(['fake:apple-2']);
    const before = await next_user_id(server);
    apple.set_failure('exchange', 'rejected');
    expect((await login(server, P.LOGIN_PROVIDER_APPLE, 'fake:apple-3')).code).toBe(E.CORE_ERROR_SOCIAL_LOGIN_INVALID);
    apple.set_failure('exchange', null);
    expect(await next_user_id(server)).toBe(before + 1n);
  });

  it('Withdraw of an APPLE user revokes its refresh token once; a failed revoke keeps the Withdraw and leaves an error log', async () => {
    const apple = fake(server, 'login-apple');
    const a = await social(server, P.LOGIN_PROVIDER_APPLE, 'apple-revoke-1');
    expect(await withdraw(a.session)).toBe(0);
    await testing.wait_background(server);
    expect(apple.calls().filter((c) => c.operation === 'revoke' && c.input === 'fake:apple-revoke-1')).toHaveLength(1);
    const b = await social(server, P.LOGIN_PROVIDER_APPLE, 'apple-revoke-2');
    apple.set_failure('revoke', 'communication_failure');
    expect(await withdraw(b.session)).toBe(0);
    await testing.wait_background(server);
    apple.set_failure('revoke', null);
    const errors = testing.read_logs(server, 'error') as { message: string; user_id: unknown }[];
    expect(errors.some((l) => l.message.includes('revoke') && String(l.user_id) === b.result.user_id.toString())).toBe(true);
  });

  it('keeps no refresh token in the log', async () => {
    await social(server, P.LOGIN_PROVIDER_APPLE, 'apple-log-1');
    expect(log_text(server)).not.toContain('fake:apple-log-1');
  });
});

describe('LinkAccount', () => {
  it('a second link of the same provider and a social account linked to another user are ALREADY_LINKED', async () => {
    const owner = await social(server, P.LOGIN_PROVIDER_GOOGLE, 'linked-1');
    const user = await guest(server);
    expect((await link(user.session, P.LOGIN_PROVIDER_GOOGLE, 'fake:linked-1')).code).toBe(E.CORE_ERROR_ALREADY_LINKED);
    const linked = await link(user.session, P.LOGIN_PROVIDER_GOOGLE, 'fake:linked-2');
    expect(linked.code).toBe(0);
    expect(linked.response.linked_providers).toEqual([P.LOGIN_PROVIDER_GOOGLE]);
    expect((await link(user.session, P.LOGIN_PROVIDER_GOOGLE, 'fake:linked-3')).code).toBe(E.CORE_ERROR_ALREADY_LINKED);
    expect(owner.result.user_id).not.toBe(user.result.user_id);
  });

  it('checks the credential outside the user transaction; a refusal is SOCIAL_LOGIN_INVALID with no link row', async () => {
    const user = await guest(server);
    const google = fake(server, 'login-google');
    google.set_failure('verify', 'rejected');
    expect((await link(user.session, P.LOGIN_PROVIDER_GOOGLE, 'fake:refused')).code).toBe(E.CORE_ERROR_SOCIAL_LOGIN_INVALID);
    google.set_failure('verify', null);
    expect(await personal_rows(server, user.result.user_id, 'auth_social_link')).toEqual([]);
  });

  it('GUEST, UNSPECIFIED and values outside LoginProvider are INVALID_REQUEST with no link row', async () => {
    const user = await guest(server);
    for (const provider of [P.LOGIN_PROVIDER_GUEST, P.LOGIN_PROVIDER_UNSPECIFIED, 77 as CoreContract.LoginProvider]) {
      expect((await link(user.session, provider, 'fake:x')).code).toBe(E.CORE_ERROR_INVALID_REQUEST);
    }
    expect(await personal_rows(server, user.result.user_id, 'auth_social_link')).toEqual([]);
  });

  it('two users linking the same social account at once: one is linked and the other is ALREADY_LINKED', async () => {
    const a = await guest(server);
    const b = await guest(server);
    const results = await Promise.all([link(a.session, P.LOGIN_PROVIDER_GOOGLE, 'fake:contested'), link(b.session, P.LOGIN_PROVIDER_GOOGLE, 'fake:contested')]);
    expect(results.map((r) => r.code).sort()).toEqual([0, E.CORE_ERROR_ALREADY_LINKED].sort());
  });
});

describe('real social adapters', () => {
  it('login-google takes tokens of the key source key for the server and desktop client IDs and refuses the rest; login-apple refuses another aud and fails at exchange', async () => {
    const real = await start({
      social: false,
      real: { 'login-google': 'login-google', 'login-apple': 'login-apple' },
      settings: {
        'loginGoogle.serverClientId': 'server-client',
        'loginGoogle.desktopClientId': 'desktop-client',
        'loginApple.keyId': 'KEYID00001',
        appleTeamId: 'TEAMID0001',
      },
    });
    try {
      const key = rsa_key('test-google');
      const other = rsa_key('test-google');
      expect((await login(real, P.LOGIN_PROVIDER_GOOGLE, id_token(key, { iss: 'https://accounts.google.com', aud: 'server-client', exp: EXP_LATER, sub: 'g' }))).code).toBe(
        E.CORE_ERROR_EXTERNAL_SERVICE_FAILED,
      );
      testing.set_key_source(real, 'login-google', { keys: [key.jwk] });
      const ok = { iss: 'https://accounts.google.com', aud: 'server-client', exp: EXP_LATER, sub: 'real-google-1' };
      expect((await login(real, P.LOGIN_PROVIDER_GOOGLE, id_token(key, ok))).code).toBe(0);
      expect((await login(real, P.LOGIN_PROVIDER_GOOGLE, id_token(key, { ...ok, aud: 'desktop-client', iss: 'accounts.google.com' }))).code).toBe(0);
      for (const bad of [{ ...ok, aud: 'nobody' }, { ...ok, iss: 'https://evil.example' }, { ...ok, exp: Number(T0 / 1000n) - 1 }]) {
        expect((await login(real, P.LOGIN_PROVIDER_GOOGLE, id_token(key, bad))).code).toBe(E.CORE_ERROR_SOCIAL_LOGIN_INVALID);
      }
      expect((await login(real, P.LOGIN_PROVIDER_GOOGLE, id_token(other, ok))).code).toBe(E.CORE_ERROR_SOCIAL_LOGIN_INVALID);
      const apple_key = rsa_key('test-apple');
      testing.set_key_source(real, 'login-apple', { keys: [apple_key.jwk] });
      const app_id = 'com.example.coretest';
      const apple = (aud: string): string => JSON.stringify({ identity_token: id_token(apple_key, { iss: 'https://appleid.apple.com', aud, exp: EXP_LATER, sub: 'real-apple-1' }), authorization_code: 'code' });
      expect((await login(real, P.LOGIN_PROVIDER_APPLE, apple('com.example.other'))).code).toBe(E.CORE_ERROR_SOCIAL_LOGIN_INVALID);
      expect((await login(real, P.LOGIN_PROVIDER_APPLE, apple(app_id))).code).toBe(E.CORE_ERROR_EXTERNAL_SERVICE_FAILED);
    } finally {
      await testing.stop_test_server(real);
    }
  });
});
