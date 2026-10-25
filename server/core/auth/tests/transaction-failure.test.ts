import { randomUUID } from 'node:crypto';
import * as CoreContract from '../../../generated/contract/core_contract.ts';
import * as CoreCheatContract from '../../../dev/generated/contract/core_cheat_contract.ts';
import { DbError } from '../../storage/db/types.ts';
import {
  E,
  P,
  T0,
  admin,
  anonymous,
  auto_login,
  call,
  current_agreements,
  guest,
  hold_next_transaction,
  login_token_rows,
  logs,
  personal_rows,
  probe,
  refresh,
  social,
  start,
  testing,
  user_ids,
  user_record,
  type Reply,
  type TestServer,
} from './helpers.ts';

let server: TestServer;
beforeAll(async () => {
  server = await start({ settings: { 'auth.deletionAttemptsPerMinute': 1000 } });
});
afterAll(async () => {
  await testing.stop_test_server(server);
});

/** A lock wait failure as the DB adapter throws it: storage rolls the transaction back and answers `FAILED`. */
function lock_failure(): DbError {
  return new DbError('lock', 'test', 'auth test: the lock wait was exceeded');
}

type Patchable = Record<string, unknown>;

function module_of(name: string): Patchable {
  const module = server.running().instance.modules().get(name);
  if (module === undefined) throw new Error(`auth test: no ${name} module`);
  return module;
}

/**
 * Makes the next call of `module.method` on the test server's instance throw a lock failure, inside the transaction
 * that calls it. The returned function puts the method back when no call came.
 */
function fail_next_call(module_name: string, method: string): () => void {
  const module = module_of(module_name);
  const original = module[method] as (...args: unknown[]) => unknown;
  module[method] = () => {
    module[method] = original;
    throw lock_failure();
  };
  return () => {
    module[method] = original;
  };
}

interface QueryHandle {
  query(sql: string, params: readonly unknown[]): unknown;
}

/**
 * Makes the next query whose SQL starts with `prefix`, on a DB handle of a transaction (`storage.db`), throw a lock
 * failure. The returned function puts `storage.db` back when no such query came.
 */
function fail_next_query(prefix: string): () => void {
  const storage = module_of('storage');
  const original = storage.db as (ctx: unknown) => QueryHandle;
  const restore = (): void => {
    storage.db = original;
  };
  storage.db = (ctx: unknown) => {
    const db = original.call(storage, ctx);
    return new Proxy(db, {
      get(target, key) {
        const value = Reflect.get(target, key, target) as unknown;
        if (key !== 'query') return typeof value === 'function' ? (value as (...args: unknown[]) => unknown).bind(target) : value;
        return (sql: string, params: readonly unknown[]) => {
          if (storage.db !== original && sql.startsWith(prefix)) {
            restore();
            throw lock_failure();
          }
          return target.query(sql, params);
        };
      },
    });
  };
  return restore;
}

/** Runs `send` with one failure armed, and gives its reply and the `error` log lines it left. */
async function with_failure<R>(arm: () => () => void, send: () => Promise<R>): Promise<{ reply: R; errors: Record<string, unknown>[] }> {
  const errors_before = logs(server, 'error').length;
  const restore = arm();
  let reply: R;
  try {
    reply = await send();
  } finally {
    restore();
  }
  return { reply, errors: logs(server, 'error').slice(errors_before) };
}

async function event_names(user_id: bigint): Promise<string[]> {
  const reply = await admin(server, 'list_server_events', { user_id: user_id.toString(), from_at: T0.toString(), to_at: (T0 + 86_400_000n).toString(), limit: 100 });
  return ((reply.body.entries ?? []) as { name: string }[]).map((e) => e.name);
}

/** The users made since `before`. */
async function made_since(before: Set<bigint>): Promise<bigint[]> {
  return [...(await user_ids(server))].filter((id) => !before.has(id));
}

async function guest_login(request_id: string): Promise<Reply<CoreContract.LoginResponse>> {
  const request = Object.assign(new CoreContract.LoginRequest(), { provider: P.LOGIN_PROVIDER_GUEST, credential: '', agreements: current_agreements() });
  return call(await anonymous(server), 'core/Login', request, { request_id });
}

async function social_login(account: string, request_id: string): Promise<Reply<CoreContract.LoginResponse>> {
  const request = Object.assign(new CoreContract.LoginRequest(), { provider: P.LOGIN_PROVIDER_GOOGLE, credential: `fake:${account}`, agreements: current_agreements() });
  return call(await anonymous(server), 'core/Login', request, { request_id });
}

async function dev_login(name: string): Promise<number> {
  const request = Object.assign(new CoreCheatContract.DevLoginRequest(), { account_name: name });
  const sent = await testing.send_cheat(await anonymous(server), 'core/cheat/DevLogin', request);
  return sent.envelope.error?.code ?? 0;
}

async function ban(user_id: bigint): Promise<void> {
  expect((await admin(server, 'ban_user', { user_id: user_id.toString(), until_at: '0', reason: 'test' })).status).toBe(200);
}

describe('a FAILED transaction of Login', () => {
  it('the game transaction of storage.create_user: INTERNAL with one error log, and no user', async () => {
    const before = await user_ids(server);
    const request_id = randomUUID();
    const { reply, errors } = await with_failure(() => fail_next_call('storage', 'create_user'), () => guest_login(request_id));
    expect(reply.code).toBe(E.CORE_ERROR_INTERNAL);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatchObject({ request_id, request: 'core/Login' });
    expect(await made_since(before)).toEqual([]);
  });

  it('run_user_transaction of the new user: INTERNAL with one error log; the new user stays, unlinked and without core_user_created', async () => {
    const before = await user_ids(server);
    const request_id = randomUUID();
    const { reply, errors } = await with_failure(() => fail_next_query('INSERT INTO auth_social_link'), () => social_login('failed-link', request_id));
    expect(reply.code).toBe(E.CORE_ERROR_INTERNAL);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatchObject({ request_id, request: 'core/Login' });
    const made = await made_since(before);
    expect(made).toHaveLength(1);
    const stayed = made[0] as bigint;
    expect((await user_record(server, stayed))?.withdrawn_at).toBeNull();
    expect(await personal_rows(server, stayed, 'auth_social_link')).toEqual([]);
    expect(await event_names(stayed)).toEqual([]);
    // The account was not linked: the next Login of it makes and links another user.
    const again = await social(server, P.LOGIN_PROVIDER_GOOGLE, 'failed-link');
    expect(again.result.user_id).not.toBe(stayed);
  });

  it('run_request_transaction: INTERNAL with one error log; the new user stays without a login token, core_user_created or core_session_started', async () => {
    const before = await user_ids(server);
    const request_id = randomUUID();
    const { reply, errors } = await with_failure(() => fail_next_query('INSERT INTO auth_login_token'), () => guest_login(request_id));
    expect(reply.code).toBe(E.CORE_ERROR_INTERNAL);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatchObject({ request_id, request: 'core/Login' });
    const made = await made_since(before);
    expect(made).toHaveLength(1);
    const stayed = made[0] as bigint;
    expect((await user_record(server, stayed))?.withdrawn_at).toBeNull();
    expect(await login_token_rows(server, stayed)).toEqual([]);
    expect(await event_names(stayed)).toEqual([]);
  });
});

describe('a FAILED transaction of AutoLogin, RefreshToken', () => {
  it('AutoLogin: INTERNAL with one error log, the login token rows unchanged, and the same token logs in afterwards', async () => {
    const user = await guest(server);
    const rows = await login_token_rows(server, user.result.user_id);
    const { reply, errors } = await with_failure(() => fail_next_query('INSERT INTO auth_login_token'), () => auto_login(server, user.result.login_token));
    expect(reply.code).toBe(E.CORE_ERROR_INTERNAL);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatchObject({ request: 'core/AutoLogin', user_id: user.result.user_id.toString() });
    expect(await login_token_rows(server, user.result.user_id)).toEqual(rows);
    expect((await auto_login(server, user.result.login_token)).code).toBe(0);
  });

  it('RefreshToken: INTERNAL with one error log, the login token rows unchanged, and RefreshToken succeeds afterwards', async () => {
    const user = await guest(server);
    testing.advance_time(server, 1_000n);
    const rows = await login_token_rows(server, user.result.user_id);
    const { reply, errors } = await with_failure(() => fail_next_query('UPDATE auth_login_token'), () => refresh(user.session));
    expect(reply.code).toBe(E.CORE_ERROR_INTERNAL);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatchObject({ request: 'core/RefreshToken', user_id: user.result.user_id.toString() });
    expect(await login_token_rows(server, user.result.user_id)).toEqual(rows);
    expect((await refresh(user.session)).code).toBe(0);
  });
});

describe('a FAILED transaction of DevLogin', () => {
  it('each of storage.create_user, the new user transaction and run_request_transaction is INTERNAL with one error log', async () => {
    const arms = [() => fail_next_call('storage', 'create_user'), () => fail_next_query('INSERT INTO auth_dev_account'), () => fail_next_query('INSERT INTO auth_login_token')];
    for (const [i, arm] of arms.entries()) {
      const { reply, errors } = await with_failure(arm, () => dev_login(`failed_dev_${String(i)}`));
      expect(reply).toBe(E.CORE_ERROR_INTERNAL);
      expect(errors).toHaveLength(1);
      expect(errors[0]).toMatchObject({ request: 'core/cheat/DevLogin' });
      // Nothing was left that the name points to wrongly: the same name logs in afterwards.
      expect(await dev_login(`failed_dev_${String(i)}`)).toBe(0);
    }
  });
});

describe('the ban login transaction', () => {
  it('FAILED: INTERNAL with one error log and no session; the next AutoLogin is BANNED', async () => {
    const user = await guest(server);
    await ban(user.result.user_id);
    const rows = await login_token_rows(server, user.result.user_id);
    const { reply, errors } = await with_failure(() => fail_next_call('session', 'start_session'), () => auto_login(server, user.result.login_token));
    expect(reply.code).toBe(E.CORE_ERROR_INTERNAL);
    expect(reply.envelope.error?.ban ?? null).toBeNull();
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatchObject({ request: 'core/AutoLogin', user_id: user.result.user_id.toString() });
    expect(await login_token_rows(server, user.result.user_id)).toEqual(rows);
    expect((await auto_login(server, user.result.login_token)).code).toBe(E.CORE_ERROR_BANNED);
  });

  it('WITHDRAWN: a Login or AutoLogin of a ban target withdrawn before its ban login transaction opens is UNAUTHORIZED without an error log', async () => {
    for (const request of ['core/Login', 'core/AutoLogin'] as const) {
      const user = await social(server, P.LOGIN_PROVIDER_GOOGLE, `banned-withdrawn-${request}`);
      await ban(user.result.user_id);
      const errors_before = logs(server, 'error').length;
      const hold = hold_next_transaction(server, request);
      const pending = request === 'core/Login' ? social_login(`banned-withdrawn-${request}`, randomUUID()) : auto_login(server, user.result.login_token);
      await hold.reached;
      expect((await admin(server, 'withdraw_user', { user_id: user.result.user_id.toString() })).status).toBe(200);
      hold.release();
      const reply = await pending;
      expect(reply.code).toBe(E.CORE_ERROR_UNAUTHORIZED);
      expect(reply.envelope.error?.ban ?? null).toBeNull();
      expect(logs(server, 'error').slice(errors_before)).toEqual([]);
    }
  });
});

describe('a FAILED transaction of POST /account/deletion', () => {
  const post = (fields: Record<string, string>): Promise<{ status: number; body: Uint8Array }> =>
    testing.send_raw(server, 'POST', '/account/deletion', { 'Content-Type': 'application/x-www-form-urlencoded' }, new TextEncoder().encode(new URLSearchParams({ confirm: 'yes', ...fields }).toString()));
  const text = (body: Uint8Array): string => new TextDecoder().decode(body).replace(/nonce="[^"]*"/g, 'nonce=""');

  /** The [auth_deletion_retry] result page, from a POST during maintenance. */
  async function retry_page(fields: Record<string, string>): Promise<string> {
    expect((await admin(server, 'set_maintenance', { enabled: true })).status).toBe(200);
    const page = await post(fields);
    expect((await admin(server, 'set_maintenance', { enabled: false })).status).toBe(200);
    expect(page.status).toBe(503);
    return text(page.body);
  }

  async function code_form(): Promise<{ user: Awaited<ReturnType<typeof guest>>; fields: Record<string, string> }> {
    const user = await guest(server);
    const issued = await call<CoreContract.IssueDeletionCodeResponse>(user.session, 'core/IssueDeletionCode', new CoreContract.IssueDeletionCodeRequest());
    expect(issued.code).toBe(0);
    return { user, fields: { method: 'code', public_code: user.result.public_code, code: issued.response.code } };
  }

  it('run_game_transaction of step 1: 500 [auth_deletion_retry] with one error log, and nothing deleted', async () => {
    const { user, fields } = await code_form();
    const { reply, errors } = await with_failure(() => fail_next_query('INSERT INTO auth_deletion_ip_counter'), () => post(fields));
    expect(reply.status).toBe(500);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatchObject({ request: 'POST /account/deletion' });
    expect(text(reply.body)).toBe(await retry_page(fields));
    expect(await probe(user.session)).toBe(0);
    expect((await post(fields)).status).toBe(200);
  });

  it('run_user_transaction of step 4, code method: 500 [auth_deletion_retry] with one error log; no attempt counted and nothing deleted', async () => {
    const { user, fields } = await code_form();
    const before = await personal_rows(server, user.result.user_id, 'auth_deletion_code');
    const { reply, errors } = await with_failure(() => fail_next_query('SELECT code_hash'), () => post(fields));
    expect(reply.status).toBe(500);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatchObject({ request: 'POST /account/deletion', user_id: user.result.user_id.toString() });
    expect(text(reply.body)).toBe(await retry_page(fields));
    expect(await personal_rows(server, user.result.user_id, 'auth_deletion_code')).toEqual(before);
    expect(await probe(user.session)).toBe(0);
    expect((await post(fields)).status).toBe(200);
  });

  it('run_user_transaction of step 4, google method: 500 [auth_deletion_retry] with one error log, and nothing deleted', async () => {
    const user = await social(server, P.LOGIN_PROVIDER_GOOGLE, 'deletion-failed-google');
    const fields = { method: 'google', credential: 'fake:deletion-failed-google' };
    const { reply, errors } = await with_failure(() => fail_next_query('SELECT refresh_token FROM auth_apple_token'), () => post(fields));
    expect(reply.status).toBe(500);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatchObject({ request: 'POST /account/deletion', user_id: user.result.user_id.toString() });
    expect(text(reply.body)).toBe(await retry_page(fields));
    expect(await probe(user.session)).toBe(0);
    expect((await post(fields)).status).toBe(200);
    expect(await probe(user.session)).toBe(E.CORE_ERROR_UNAUTHORIZED);
  });
});
