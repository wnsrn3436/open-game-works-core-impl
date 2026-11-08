import * as CoreContract from '../../../generated/contract/core_contract.ts';
import {
  E,
  P,
  admin,
  anonymous,
  auto_login,
  call,
  current_agreements,
  guest,
  hold_next_transaction,
  login_token_rows,
  logs,
  probe,
  refresh,
  session_of,
  social,
  start,
  testing,
  token_hash,
  withdraw,
  type TestServer,
  type TestSession,
} from './helpers.ts';

let server: TestServer;
let accounts = 0;
beforeAll(async () => {
  server = await start();
});
afterAll(async () => {
  await testing.stop_test_server(server);
});

function account(): string {
  accounts += 1;
  return `devices_${String(accounts)}`;
}

async function session_from(result: CoreContract.AuthResult | null | undefined): Promise<TestSession> {
  if (result === null || result === undefined) throw new Error('no AuthResult');
  return session_of(await anonymous(server), result);
}

async function logout_other_devices(session: TestSession): Promise<number> {
  return (await call(session, 'core/LogoutOtherDevices', new CoreContract.LogoutOtherDevicesRequest())).code;
}

describe('LogoutOtherDevices', () => {
  it('ends the login tokens of A and C; B keeps its access token and both its requested and its next login token', async () => {
    const id = account();
    const a = await social(server, P.LOGIN_PROVIDER_GOOGLE, id);
    const b = await social(server, P.LOGIN_PROVIDER_GOOGLE, id);
    const c = await social(server, P.LOGIN_PROVIDER_GOOGLE, id);
    // B comes back with AutoLogin: its session is current and its next login token is not used yet.
    const back = await auto_login(server, b.result.login_token);
    expect(back.code).toBe(0);
    const b_next = await session_from(back.response.result);
    expect(await logout_other_devices(b_next)).toBe(0);
    for (const other of [a, c]) {
      expect((await auto_login(server, other.result.login_token)).code).toBe(E.CORE_ERROR_UNAUTHORIZED);
      expect((await refresh(other.session)).code).toBe(E.CORE_ERROR_UNAUTHORIZED);
    }
    const hashes = (await login_token_rows(server, a.result.user_id)).map((row) => row.token_hash);
    expect(hashes.sort()).toEqual([token_hash(b.result.login_token), token_hash(b_next.login_token)].sort());
    expect(await probe(b_next)).toBe(0);
    // The requested token of B: RefreshToken signed with the session key of the session its AutoLogin opened.
    expect((await refresh({ ...b_next, login_token: b.result.login_token })).code).toBe(0);
    expect((await refresh(b_next)).code).toBe(0);
    expect((await auto_login(server, b_next.login_token)).code).toBe(0);
  });

  it('keeps the login token of the sending device on a guest account and on an account without a social link', async () => {
    const user = await guest(server);
    expect(await logout_other_devices(user.session)).toBe(0);
    expect(await probe(user.session)).toBe(0);
    expect((await refresh(user.session)).code).toBe(0);
    expect((await auto_login(server, user.result.login_token)).code).toBe(0);

    const first = await testing.login(server, 'devices_dev');
    const second = await testing.login(server, 'devices_dev');
    expect(await logout_other_devices(second)).toBe(0);
    expect((await auto_login(server, first.login_token, current_agreements())).code).toBe(E.CORE_ERROR_UNAUTHORIZED);
    expect((await auto_login(server, second.login_token, current_agreements())).code).toBe(0);
  });

  it('is SESSION_REPLACED and deletes nothing when an AutoLogin of A commits after step 5 and before its transaction opens', async () => {
    const id = account();
    const a = await social(server, P.LOGIN_PROVIDER_GOOGLE, id);
    const b = await social(server, P.LOGIN_PROVIDER_GOOGLE, id);
    const hold = hold_next_transaction(server, 'core/LogoutOtherDevices');
    const pending = logout_other_devices(b.session);
    await hold.reached;
    const back = await auto_login(server, a.result.login_token);
    expect(back.code).toBe(0);
    const a_next = await session_from(back.response.result);
    const rows = await login_token_rows(server, a.result.user_id);
    hold.release();
    expect(await pending).toBe(E.CORE_ERROR_SESSION_REPLACED);
    expect(await login_token_rows(server, a.result.user_id)).toEqual(rows);
    expect(rows.map((row) => row.token_hash)).toContain(token_hash(b.result.login_token));
    expect(await probe(a_next)).toBe(0);
    // A copy of the login token of A stays valid after LogoutOtherDevices of A.
    expect(await logout_other_devices(a_next)).toBe(0);
    expect((await auto_login(server, a_next.login_token)).code).toBe(0);
    expect((await auto_login(server, b.result.login_token)).code).toBe(E.CORE_ERROR_UNAUTHORIZED);
  });
});

describe('revoke_login_tokens', () => {
  it('leaves a user with a social link no login token row and no session; Login with that social account gives the same user ID', async () => {
    const id = account();
    const a = await social(server, P.LOGIN_PROVIDER_GOOGLE, id);
    const b = await social(server, P.LOGIN_PROVIDER_GOOGLE, id);
    const reply = await admin(server, 'revoke_login_tokens', { user_id: b.result.user_id.toString() });
    expect(reply).toEqual({ status: 200, body: {} });
    expect(await login_token_rows(server, b.result.user_id)).toEqual([]);
    expect(await probe(b.session)).toBe(E.CORE_ERROR_UNAUTHORIZED);
    for (const device of [a, b]) {
      expect((await auto_login(server, device.result.login_token)).code).toBe(E.CORE_ERROR_UNAUTHORIZED);
      expect((await refresh(device.session)).code).toBe(E.CORE_ERROR_UNAUTHORIZED);
    }
    const again = await social(server, P.LOGIN_PROVIDER_GOOGLE, id);
    expect(again.result.user_id).toBe(b.result.user_id);
    expect(await probe(again.session)).toBe(0);
  });

  it('is 409 conflict for a user without an auth_social_link row and leaves its login token rows and session unchanged', async () => {
    const user = await guest(server);
    const rows = await login_token_rows(server, user.result.user_id);
    const reply = await admin(server, 'revoke_login_tokens', { user_id: user.result.user_id.toString() });
    expect(reply.status).toBe(409);
    expect(reply.body.error).toBe('conflict');
    expect(await login_token_rows(server, user.result.user_id)).toEqual(rows);
    expect(await probe(user.session)).toBe(0);
    expect((await auto_login(server, user.result.login_token)).code).toBe(0);
  });

  it('is 404 not_found for a nonexistent or withdrawn user, with an audit log', async () => {
    const user = await social(server, P.LOGIN_PROVIDER_GOOGLE, account());
    expect(await withdraw(user.session)).toBe(0);
    for (const user_id of [user.result.user_id, 987654321n]) {
      const audits = logs(server, 'audit').length;
      const reply = await admin(server, 'revoke_login_tokens', { user_id: user_id.toString() });
      expect(reply.status).toBe(404);
      expect(reply.body.error).toBe('not_found');
      expect(logs(server, 'audit').length).toBeGreaterThan(audits);
    }
  });
});
