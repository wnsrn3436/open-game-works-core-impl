import * as CoreContract from '../../../generated/contract/core_contract.ts';
import { fields, login, new_user, request, SESSION_TABLE, signed, start, stop_all, verify, type Instance } from './session_kit.ts';

const UNAUTHORIZED = CoreContract.CoreError.CORE_ERROR_UNAUTHORIZED;
const SESSION_REPLACED = CoreContract.CoreError.CORE_ERROR_SESSION_REPLACED;

afterEach(() => {
  stop_all();
});

/** A `Logout` of `session_id`: `end_session` in a request transaction whose ctx `session_id` is that session. */
async function logout(instance: Instance, user: bigint, session_id: string): Promise<void> {
  const result = await instance.storage.run_request_transaction(user, fields('core/Logout', session_id), (ctx) => {
    instance.session.end_session(ctx);
  });
  if (result === 'FAILED' || result === 'WITHDRAWN') throw new Error(`Logout: ${String(result)}`);
}

function session_ids(instance: Instance, user: bigint): unknown[] {
  return instance.storage.read_db().query(`SELECT session_id FROM ${SESSION_TABLE} WHERE user_id = $1`, [user]).map((row) => row.session_id);
}

describe('session record', () => {
  it('holds a 16-byte session ID, a 32-byte signing key as base64url and started_at = server-time.now(ctx)', async () => {
    const instance = await start();
    const user = await new_user(instance.storage);
    instance.clock.advance(1234n);
    const { started, request_time } = await request(instance.storage, user, 'core/Login', (ctx) => ({
      started: instance.session.start_session(ctx),
      request_time: ctx.request_time,
    }));
    expect(started.session_id).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(Buffer.from(started.session_id, 'base64url')).toHaveLength(16);
    expect(started.signing_key).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(Buffer.from(started.signing_key, 'base64url')).toHaveLength(32);
    const rows = instance.storage.read_db().query(`SELECT user_id, session_id, signing_key, started_at FROM ${SESSION_TABLE} WHERE user_id = $1`, [user]);
    expect(rows).toEqual([{ user_id: user, session_id: started.session_id, signing_key: started.signing_key, started_at: request_time }]);
    expect(request_time).toBe(instance.time.clock_now());
  });

  it('is one row per user: a new session replaces the record', async () => {
    const instance = await start();
    const user = await new_user(instance.storage);
    await login(instance, user);
    const second = await login(instance, user);
    const rows = instance.storage.read_db().query(`SELECT session_id FROM ${SESSION_TABLE} WHERE user_id = $1`, [user]);
    expect(rows).toEqual([{ session_id: second.session_id }]);
  });

  it('is not in the user snapshot', async () => {
    const instance = await start();
    const user = await new_user(instance.storage);
    await login(instance, user);
    const rows = await request(instance.storage, user, 'Test', (ctx) => instance.storage.read_user_rows(ctx));
    expect(rows.filter((row) => row.table === SESSION_TABLE)).toEqual([]);
  });

  it('is read from committed rows by check_current: an uncommitted start_session is not seen', async () => {
    const instance = await start();
    const user = await new_user(instance.storage);
    const first = await login(instance, user);
    const inside = await request(instance.storage, user, 'core/Login', (ctx) => {
      const next = instance.session.start_session(ctx);
      return { old: instance.session.check_current(user, first.session_id), next: instance.session.check_current(user, next.session_id), id: next.session_id };
    });
    expect(inside.old).toBe('pass');
    expect(inside.next).toBe(SESSION_REPLACED);
    expect(instance.session.check_current(user, inside.id)).toBe('pass');
  });

  it('is not written when the login transaction rolls back', async () => {
    const instance = await start();
    const user = await new_user(instance.storage);
    const first = await login(instance, user);
    const result = await instance.storage.run_request_transaction(user, { request_name: 'core/Login', request_id: 'r', silent: false, retry: false, session_id: '', client_version: '', platform: '' }, (ctx) => {
      instance.session.start_session(ctx);
      return UNAUTHORIZED;
    });
    expect(result).toBe(UNAUTHORIZED);
    expect(instance.session.check_current(user, first.session_id)).toBe('pass');
  });
});

describe('check_current', () => {
  it('is SESSION_REPLACED for the first session after a second login, for its access token and its login token', async () => {
    const instance = await start();
    const user = await new_user(instance.storage);
    const first = await login(instance, user);
    expect(instance.session.check_current(user, first.session_id)).toBe('pass');
    const second = await login(instance, user);
    // An access token request and a `RefreshToken` with a login token both check the session ID they carry.
    expect(instance.session.check_current(user, first.session_id)).toBe(SESSION_REPLACED);
    expect(instance.session.check_current(user, second.session_id)).toBe('pass');
  });

  it('is UNAUTHORIZED after end_session (Logout), and the signature of that session fails', async () => {
    const instance = await start();
    const user = await new_user(instance.storage);
    const started = await login(instance, user);
    await logout(instance, user, started.session_id);
    expect(instance.session.check_current(user, started.session_id)).toBe(UNAUTHORIZED);
    expect(verify(instance, user, started.session_id, signed(started.signing_key, 'core/Resync', instance.time.clock_now()))).toBe(UNAUTHORIZED);
  });

  it('keeps a session S2 committed after routing step 5 of a Logout of S1: S2 is pass and S1 is SESSION_REPLACED', async () => {
    const instance = await start();
    const user = await new_user(instance.storage);
    const s1 = await login(instance, user);
    // `routing` step 5 of the Logout of S1 passes before the other device's AutoLogin commits S2.
    expect(instance.session.check_current(user, s1.session_id)).toBe('pass');
    const s2 = await login(instance, user);
    await logout(instance, user, s1.session_id);
    expect(session_ids(instance, user)).toEqual([s2.session_id]);
    expect(instance.session.check_current(user, s2.session_id)).toBe('pass');
    expect(verify(instance, user, s2.session_id, signed(s2.signing_key, 'core/Resync', instance.time.clock_now()))).toBe('pass');
    expect(instance.session.check_current(user, s1.session_id)).toBe(SESSION_REPLACED);
  });

  it('does nothing in end_session of a user without a session record', async () => {
    const instance = await start();
    const user = await new_user(instance.storage);
    await logout(instance, user, 'AAAAAAAAAAAAAAAAAAAAAA');
    const result = await instance.storage.run_user_transaction(user, (ctx) => {
      instance.session.end_session(ctx);
      return 'pass';
    });
    expect(result).toBe('COMMITTED');
    expect(session_ids(instance, user)).toEqual([]);
  });

  it('ends the session whatever its session ID in an out-of-request change (revoke_login_tokens, user-snapshot-clone)', async () => {
    const instance = await start();
    const user = await new_user(instance.storage);
    const first = await login(instance, user);
    const second = await login(instance, user);
    const result = await instance.storage.run_user_transaction(user, (ctx) => {
      expect(ctx.session_id).toBe('');
      instance.session.end_session(ctx);
      return 'pass';
    });
    expect(result).toBe('COMMITTED');
    expect(session_ids(instance, user)).toEqual([]);
    expect(instance.session.check_current(user, first.session_id)).toBe(UNAUTHORIZED);
    expect(instance.session.check_current(user, second.session_id)).toBe(UNAUTHORIZED);
  });

  it('is UNAUTHORIZED for a user without a session', async () => {
    const instance = await start();
    const user = await new_user(instance.storage);
    expect(instance.session.check_current(user, 'AAAAAAAAAAAAAAAAAAAAAA')).toBe(UNAUTHORIZED);
  });

  it('keeps other users’ sessions when one user logs in again or out', async () => {
    const instance = await start();
    const a = await new_user(instance.storage);
    const b = await new_user(instance.storage);
    const session_a = await login(instance, a);
    const session_b = await login(instance, b);
    const again = await login(instance, a);
    await logout(instance, a, again.session_id);
    expect(instance.session.check_current(b, session_b.session_id)).toBe('pass');
    expect(instance.session.check_current(a, session_a.session_id)).toBe(UNAUTHORIZED);
  });

  it('ends with the session record when the user is withdrawn', async () => {
    const instance = await start();
    const user = await new_user(instance.storage);
    const started = await login(instance, user);
    await request(instance.storage, user, 'core/Withdraw', (ctx) => {
      instance.storage.delete_user(ctx);
    });
    expect(instance.session.check_current(user, started.session_id)).toBe(UNAUTHORIZED);
  });
});

describe('RefreshToken', () => {
  it('keeps the session: the same session signing key still signs after it', async () => {
    const instance = await start();
    const user = await new_user(instance.storage);
    const started = await login(instance, user);
    expect(verify(instance, user, started.session_id, signed(started.signing_key, 'core/RefreshToken', instance.time.clock_now()))).toBe('pass');
    // `RefreshToken` checks the login token's session and changes no session state.
    await request(instance.storage, user, 'core/RefreshToken', () => instance.session.check_current(user, started.session_id));
    instance.clock.advance(60_000n);
    expect(instance.session.check_current(user, started.session_id)).toBe('pass');
    expect(verify(instance, user, started.session_id, signed(started.signing_key, 'ClaimQuestReward', instance.time.clock_now()))).toBe('pass');
  });
});

describe('module input', () => {
  it('throws without session.signatureWindowMs or a dependency module', async () => {
    const instance = await start();
    const { create_session } = await import('../index.ts');
    const modules = { storage: instance.storage, 'server-time': instance.time };
    expect(() => create_session({ settings: {}, modules })).toThrow(/signatureWindowMs/);
    expect(() => create_session({ settings: { 'session.signatureWindowMs': -1 }, modules })).toThrow(/signatureWindowMs/);
    expect(() => create_session({ settings: { 'session.signatureWindowMs': 1000 }, modules: { storage: instance.storage } })).toThrow(/server-time/);
    expect(() => create_session({ settings: { 'session.signatureWindowMs': 1000 }, modules: { 'server-time': instance.time } })).toThrow(/storage/);
  });
});
