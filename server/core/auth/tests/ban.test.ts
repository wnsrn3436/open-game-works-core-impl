import * as CoreContract from '../../../generated/contract/core_contract.ts';
import { E, P, T0, admin, anonymous, auto_login, call, guest, login, login_token_rows, probe, social, start, testing, type TestServer } from './helpers.ts';

let server: TestServer;
beforeAll(async () => {
  server = await start();
});
afterAll(async () => {
  await testing.stop_test_server(server);
});

async function ban(user_id: bigint, until_at: bigint): Promise<void> {
  const reply = await admin(server, 'ban_user', { user_id: user_id.toString(), until_at: until_at.toString(), reason: 'test' });
  expect(reply.status).toBe(200);
}

describe('ban', () => {
  it('AutoLogin during a ban is BANNED and keeps the login token row; after the ban the same token logs in', async () => {
    const user = await guest(server);
    const until = T0 + 3_600_000n;
    await ban(user.result.user_id, until);
    const before = await login_token_rows(server, user.result.user_id);
    testing.advance_time(server, 1_000n);
    expect((await auto_login(server, user.result.login_token)).code).toBe(E.CORE_ERROR_BANNED);
    expect((await auto_login(server, user.result.login_token)).code).toBe(E.CORE_ERROR_BANNED);
    expect(await login_token_rows(server, user.result.user_id)).toEqual(before);
    testing.set_time(server, until);
    expect((await auto_login(server, user.result.login_token)).code).toBe(0);
  });

  it('a banned Login and AutoLogin carry the ban detail with a new session that can only get a deletion code', async () => {
    const user = await social(server, P.LOGIN_PROVIDER_GOOGLE, 'banned-account');
    await ban(user.result.user_id, 0n);
    const before = await login_token_rows(server, user.result.user_id);
    expect(before).toHaveLength(1);
    // A later request time: a ban login that touched the row would change its last_used_at.
    testing.advance_time(server, 1_000n);
    // One after the other: each ban login opens a new session that replaces the session of the one before.
    for (const send_login of [() => login(server, P.LOGIN_PROVIDER_GOOGLE, 'fake:banned-account'), () => auto_login(server, user.result.login_token)]) {
      const reply = await send_login();
      expect(reply.code).toBe(E.CORE_ERROR_BANNED);
      const detail = reply.envelope.error?.ban;
      expect(detail?.user_id).toBe(user.result.user_id);
      expect(detail?.until_at).toBe(0n);
      expect(detail?.deletion_url).toMatch(/\/account\/deletion$/);
      expect(detail?.access_token).not.toBe('');
      expect(detail?.session_signing_key).not.toBe('');
      const banned = { ...(await anonymous(server)), user_id: user.result.user_id, access_token: detail?.access_token ?? '', session_signing_key: detail?.session_signing_key ?? '' };
      const code = await call<CoreContract.IssueDeletionCodeResponse>(banned, 'core/IssueDeletionCode', new CoreContract.IssueDeletionCodeRequest());
      expect(code.code).toBe(0);
      expect(code.response.code).not.toBe('');
      expect(await probe(banned)).toBe(E.CORE_ERROR_BANNED);
    }
    // Every login token row of the user is as it was: no new row, and the AutoLogin's row is not touched.
    expect(await login_token_rows(server, user.result.user_id)).toEqual(before);
    expect((await admin(server, 'unban_user', { user_id: user.result.user_id.toString() })).status).toBe(200);
    const after = await auto_login(server, user.result.login_token);
    expect(after.code).toBe(0);
  });
});
