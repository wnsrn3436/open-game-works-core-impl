import * as CoreContract from '../../../generated/contract/core_contract.ts';
import {
  E,
  admin,
  anonymous,
  auto_login,
  call,
  current_agreements,
  guest,
  hold_next_transaction,
  log_text,
  login_token_rows,
  probe,
  refresh,
  session_of,
  start,
  testing,
  token_hash,
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

async function session_from(result: CoreContract.AuthResult | null): Promise<TestSession> {
  if (result === null) throw new Error('no AuthResult');
  return session_of(await anonymous(server), result);
}

function payload_of(access_token: string): { exp: number; sid: string; uid: string } {
  return JSON.parse(Buffer.from(access_token.split('.')[1] ?? '', 'base64url').toString()) as { exp: number; sid: string; uid: string };
}

describe('login token rotation', () => {
  it('after the next token is used by RefreshToken or AutoLogin, the requested token is UNAUTHORIZED', async () => {
    for (const use of ['RefreshToken', 'AutoLogin'] as const) {
      const user = await guest(server);
      const next = await auto_login(server, user.result.login_token);
      expect(next.code).toBe(0);
      const next_session = await session_from(next.response.result);
      if (use === 'RefreshToken') expect((await refresh(next_session)).code).toBe(0);
      else expect((await auto_login(server, next_session.login_token)).code).toBe(0);
      expect((await auto_login(server, user.result.login_token)).code).toBe(E.CORE_ERROR_UNAUTHORIZED);
    }
  });

  it('before the next token is used, the requested token logs in again and the unused next token becomes UNAUTHORIZED', async () => {
    const user = await guest(server);
    const first = await auto_login(server, user.result.login_token);
    const second = await auto_login(server, user.result.login_token);
    expect([first.code, second.code]).toEqual([0, 0]);
    expect((await auto_login(server, first.response.result?.login_token ?? '')).code).toBe(E.CORE_ERROR_UNAUTHORIZED);
    expect((await auto_login(server, second.response.result?.login_token ?? '')).code).toBe(0);
  });

  it('RefreshToken of the requested token before the next token is used gives the session AutoLogin opened; then the next token works', async () => {
    const user = await guest(server);
    const next = await auto_login(server, user.result.login_token);
    const next_session = await session_from(next.response.result);
    const old = { ...(await session_from(user.result)), session_signing_key: next_session.session_signing_key };
    const refreshed = await refresh(old);
    expect(refreshed.code).toBe(0);
    expect(payload_of(refreshed.response.access_token).sid).toBe(payload_of(next_session.access_token).sid);
    expect((await refresh(next_session)).code).toBe(0);
    expect((await auto_login(server, next_session.login_token)).code).toBe(0);
  });

  it('two devices keep both login tokens; the first device is SESSION_REPLACED until its AutoLogin, which closes the second', async () => {
    const first = await testing.login(server, 'two_devices');
    const second = await testing.login(server, 'two_devices');
    expect(first.user_id).toBe(second.user_id);
    expect(await probe(first)).toBe(E.CORE_ERROR_SESSION_REPLACED);
    expect((await refresh(first)).code).toBe(E.CORE_ERROR_SESSION_REPLACED);
    // A DevLogin user has no agreement records, so its AutoLogin agrees to the current terms.
    const back = await auto_login(server, first.login_token, current_agreements());
    expect(back.code).toBe(0);
    expect(await probe(await session_from(back.response.result))).toBe(0);
    expect(await probe(second)).toBe(E.CORE_ERROR_SESSION_REPLACED);
    expect((await auto_login(server, second.login_token, current_agreements())).code).toBe(0);
  });

  it('Logout makes its login token and access token refused', async () => {
    const user = await guest(server);
    expect((await call(user.session, 'core/Logout', new CoreContract.LogoutRequest())).code).toBe(0);
    expect(await probe(user.session)).toBe(E.CORE_ERROR_UNAUTHORIZED);
    expect((await auto_login(server, user.result.login_token)).code).toBe(E.CORE_ERROR_UNAUTHORIZED);
  });

  it('an AutoLogin or RefreshToken that read its login token row before a Logout of it commits is UNAUTHORIZED and leaves no login token row', async () => {
    for (const request of ['core/AutoLogin', 'core/RefreshToken'] as const) {
      const user = await guest(server);
      expect(await login_token_rows(server, user.result.user_id)).toHaveLength(1);
      const hold = hold_next_transaction(server, request);
      const pending = request === 'core/AutoLogin' ? auto_login(server, user.result.login_token) : refresh(user.session);
      await hold.reached;
      expect((await call(user.session, 'core/Logout', new CoreContract.LogoutRequest())).code).toBe(0);
      hold.release();
      expect((await pending).code).toBe(E.CORE_ERROR_UNAUTHORIZED);
      expect(await login_token_rows(server, user.result.user_id)).toEqual([]);
    }
  });
});

describe('access token', () => {
  it('an expired access token is TOKEN_EXPIRED; a changed signature or a changed payload is UNAUTHORIZED', async () => {
    const ttl = 60_000n;
    const own = await start({ settings: { 'auth.accessTokenTtlMs': Number(ttl) } });
    try {
      const user = await guest(own);
      const [h, p, s] = user.session.access_token.split('.') as [string, string, string];
      expect(await probe({ ...user.session, access_token: `${h}.${p}.${s.startsWith('A') ? 'B' : 'A'}${s.slice(1)}` })).toBe(E.CORE_ERROR_UNAUTHORIZED);
      const other = Buffer.from(JSON.stringify({ exp: payload_of(user.session.access_token).exp, sid: 'x', uid: user.result.user_id.toString() })).toString('base64url');
      expect(await probe({ ...user.session, access_token: `${h}.${other}.${s}` })).toBe(E.CORE_ERROR_UNAUTHORIZED);
      testing.advance_time(own, ttl - 1n);
      expect(await probe(user.session)).toBe(0);
      testing.advance_time(own, 1n);
      expect(await probe(user.session)).toBe(E.CORE_ERROR_TOKEN_EXPIRED);
    } finally {
      await testing.stop_test_server(own);
    }
  });

  it('RefreshToken gives a new access token of the same session ID and keeps the session signing key', async () => {
    const user = await guest(server);
    const refreshed = await refresh(user.session);
    expect(refreshed.code).toBe(0);
    expect(payload_of(refreshed.response.access_token).sid).toBe(payload_of(user.session.access_token).sid);
    expect(await probe({ ...user.session, access_token: refreshed.response.access_token })).toBe(0);
  });

  it('a RefreshToken with a wrong signature is UNAUTHORIZED', async () => {
    const user = await guest(server);
    expect((await refresh(user.session, { 'X-Ogw-Signature': '0'.repeat(64) })).code).toBe(E.CORE_ERROR_UNAUTHORIZED);
    expect((await refresh({ ...user.session, session_signing_key: 'another-key' })).code).toBe(E.CORE_ERROR_UNAUTHORIZED);
  });

  it('RefreshToken carries the pending delta of out-of-request changes and leaves none', async () => {
    const user = await guest(server);
    const gold = testing.load_data().dev.find_id_value('[gold]');
    const items = [{ item_id: gold, amount: '5' }];
    const granted = await admin(server, 'grant_items', { operation_id: `auth-${user.result.user_id.toString()}`, user_id: user.result.user_id.toString(), items });
    expect(granted.status).toBe(200);
    const refreshed = await refresh(user.session);
    expect(refreshed.code).toBe(0);
    expect(refreshed.envelope.pending_user_state?.entries.map((e) => e.kind)).toContain('ItemBalanceUserState');
    const next = await call(user.session, 'core/Resync', new CoreContract.ResyncRequest());
    expect(next.envelope.pending_user_state?.entries ?? []).toEqual([]);
  });

  it('keeps no login token in the DB rows, only its SHA-256 lowercase hex, and none in the log', async () => {
    const user = await guest(server);
    const next = (await auto_login(server, user.result.login_token)).response.result;
    if (next === null) throw new Error('AutoLogin failed');
    const tokens = [user.result.login_token, next.login_token];
    const rows = await login_token_rows(server, user.result.user_id);
    expect(rows.map((row) => row.token_hash).sort()).toEqual(tokens.map(token_hash).sort());
    const stored = JSON.stringify(rows, (_key, value: unknown) => (typeof value === 'bigint' ? value.toString() : value));
    for (const token of tokens) expect(stored).not.toContain(token);
    const text = log_text(server);
    expect(text).not.toContain(user.result.login_token);
    expect(text).not.toContain(user.result.access_token);
  });
});
