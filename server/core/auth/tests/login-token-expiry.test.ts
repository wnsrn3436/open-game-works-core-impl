import { E, P, auto_login, guest, logs, login_token_rows, refresh, social, start, testing, token_hash, type TestServer } from './helpers.ts';

/** `auth.loginTokenIdleTtlMs` of this file's server: 4 hours, at least 2 × the default `auth.accessTokenTtlMs`. */
const TTL = 14_400_000n;

let server: TestServer;
let accounts = 0;
beforeAll(async () => {
  server = await start({ settings: { 'auth.loginTokenIdleTtlMs': Number(TTL) } });
});
afterAll(async () => {
  await testing.stop_test_server(server);
});

/** A new GOOGLE user of its own social account, and `last_used_at` of its login token row. */
async function linked_user(): Promise<{ account: string; user: Awaited<ReturnType<typeof social>>; last_used_at: bigint }> {
  accounts += 1;
  const account = `expiry_${String(accounts)}`;
  const user = await social(server, P.LOGIN_PROVIDER_GOOGLE, account);
  const row = (await login_token_rows(server, user.result.user_id)).find((r) => r.token_hash === token_hash(user.result.login_token));
  if (row === undefined) throw new Error('no login token row');
  return { account, user, last_used_at: row.last_used_at as bigint };
}

describe('login token expiry of a user with an auth_social_link row', () => {
  it('AutoLogin and RefreshToken succeed 1ms before last_used_at + auth.loginTokenIdleTtlMs', async () => {
    const first = await linked_user();
    testing.set_time(server, first.last_used_at + TTL - 1n);
    expect((await auto_login(server, first.user.result.login_token)).code).toBe(0);
    const second = await linked_user();
    testing.set_time(server, second.last_used_at + TTL - 1n);
    expect((await refresh(second.user.session)).code).toBe(0);
  });

  it('at last_used_at + auth.loginTokenIdleTtlMs both are UNAUTHORIZED with no security log and no new login token row', async () => {
    const { user, last_used_at } = await linked_user();
    const rows = await login_token_rows(server, user.result.user_id);
    testing.set_time(server, last_used_at + TTL);
    const security = logs(server, 'security').length;
    expect((await auto_login(server, user.result.login_token)).code).toBe(E.CORE_ERROR_UNAUTHORIZED);
    expect((await refresh(user.session)).code).toBe(E.CORE_ERROR_UNAUTHORIZED);
    expect(logs(server, 'security')).toHaveLength(security);
    expect(await login_token_rows(server, user.result.user_id)).toEqual(rows);
  });

  it('a RefreshToken at t renews it: AutoLogin with the same login token succeeds at t + auth.loginTokenIdleTtlMs - 1', async () => {
    const { user, last_used_at } = await linked_user();
    const t = last_used_at + TTL / 2n;
    testing.set_time(server, t);
    expect((await refresh(user.session)).code).toBe(0);
    testing.set_time(server, t + TTL - 1n);
    expect((await auto_login(server, user.result.login_token)).code).toBe(0);
  });

  it('after the expiry, Login with that social account gives the same user ID and a login token that AutoLogin accepts', async () => {
    const { account, user, last_used_at } = await linked_user();
    testing.set_time(server, last_used_at + TTL);
    expect((await auto_login(server, user.result.login_token)).code).toBe(E.CORE_ERROR_UNAUTHORIZED);
    const again = await social(server, P.LOGIN_PROVIDER_GOOGLE, account);
    expect(again.result.user_id).toBe(user.result.user_id);
    expect((await auto_login(server, again.result.login_token)).code).toBe(0);
  });
});

describe('login token of a user without an auth_social_link row', () => {
  it('does not expire however far the clock moves: AutoLogin and RefreshToken succeed', async () => {
    const user = await guest(server);
    testing.advance_time(server, 10n * 365n * 86_400_000n);
    expect((await refresh(user.session)).code).toBe(0);
    expect((await auto_login(server, user.result.login_token)).code).toBe(0);
  });
});
