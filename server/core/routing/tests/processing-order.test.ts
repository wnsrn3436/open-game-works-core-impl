import { randomUUID } from 'node:crypto';
import * as CoreContract from '../../../generated/contract/core_contract.ts';
import { SetTimeOffsetRequest } from '../../../dev/generated/contract/core_cheat_contract.ts';
import * as GameDataDev from '../../../dev/generated/data/game_data_dev.ts';
import { utc_year_month } from '../../auth/consent.ts';
import { DB_KIND, lock_holder, stop_all, storage_module, type RunningServer } from '../../storage/tests/helpers.ts';
import {
  admin,
  advance,
  client_data_version,
  code,
  E,
  echo,
  envelope_of,
  game_register,
  GAME_ERROR_LISTED,
  GAME_ERROR_UNLISTED,
  login,
  logs,
  missing,
  new_calls,
  peer,
  plain_headers,
  raw,
  read_user_state,
  send,
  send_cheat,
  signed_headers,
  signed_raw,
  user_time,
  start,
  stop,
  wait_background,
  type GameCalls,
  type Register,
  type Sent,
  type TestServer,
  type TestSession,
} from './support.ts';

/** A mail with an attachment and an `extra_id` that `send_mail` of `admin-api` sends to the session's user; its mail ID. */
async function mail_with_extra(server: TestServer, session: TestSession): Promise<bigint> {
  const mail = {
    template_id: GameDataDev.find_id_value('[mail_mailbox_plain]'),
    attachments: [{ item_id: GameDataDev.find_id_value('[gold]'), amount: '5' }],
    extra_id: 1,
  };
  const sent = await admin(server, 'send_mail', { operation_id: `extra-${randomUUID()}`, user_id: session.user_id.toString(), mail });
  expect(sent.status).toBe(200);
  return BigInt(String((sent.body as { mail_id: unknown }).mail_id));
}

function claim(session: TestSession, mail_id: bigint): Promise<Sent> {
  const request = new CoreContract.ClaimMailRequest();
  request.mail_id = mail_id;
  return send(session, 'core/ClaimMail', request);
}

/** The envelope bytes with `server_time_at` 0. */
function without_time(envelope: CoreContract.ResponseEnvelope): Uint8Array {
  const copy = CoreContract.ResponseEnvelope.decode(envelope.encode()) ?? new CoreContract.ResponseEnvelope();
  copy.server_time_at = 0n;
  return copy.encode();
}

vi.mock('../../../generated/contract/game_contract.ts', async (import_original) => (await import('./game_contract_mock.ts')).mock_game_contract(await import_original()));

const servers: TestServer[] = [];

async function server_with(calls: GameCalls, overrides: Record<string, unknown> = {}, more?: Register): Promise<TestServer> {
  const server = await start({ overrides, register: game_register(calls, more) });
  servers.push(server);
  return server;
}

afterEach(async () => {
  for (const server of servers.splice(0)) await stop(server);
});

describe('request processing order', () => {
  it('ends a request that fails a step with that step\'s error and does not call the handler', async () => {
    const calls = new_calls();
    const server = await server_with(calls, { 'routing.maxBodyBytes': 64 });
    const session = await login(server, 'steps');
    const user = session.user_id.toString();

    // 2. body limit
    expect(code(await send(session, 'Echo', echo(), { body: new Uint8Array(65) }))).toBe(E.CORE_ERROR_INVALID_REQUEST);
    expect(code(await send(session, 'Echo', echo(), { headers: { 'Content-Encoding': 'gzip' } }))).toBe(E.CORE_ERROR_INVALID_REQUEST);
    expect(code(await send(session, 'Echo', echo(), { headers: { 'Content-Type': 'application/json' } }))).toBe(E.CORE_ERROR_INVALID_REQUEST);
    // 3. common header
    expect(code(await send(session, 'Echo', echo(), { headers: { 'X-Ogw-Platform': 'ps5' } }))).toBe(E.CORE_ERROR_INVALID_REQUEST);
    // 5. authentication
    expect(code(await send(session, 'Echo', echo(), { headers: { Authorization: 'Bearer not-a-token' } }))).toBe(E.CORE_ERROR_UNAUTHORIZED);
    // 7. data version
    expect(code(await send(session, 'Echo', echo(), { headers: { 'X-Ogw-Data-Version': `${'0'.repeat(64)}-${'0'.repeat(64)}` } }))).toBe(E.CORE_ERROR_APP_UPDATE_REQUIRED);
    // 10. decode
    const garbage = await signed_raw(server, session, 'Echo', new Uint8Array([0xff, 0xff, 0xff]));
    expect(envelope_of(garbage).error?.code).toBe(E.CORE_ERROR_INVALID_REQUEST);
    // 11. field validation
    const invalid = new CoreContract.ResyncRequest();
    invalid.full = true;
    expect(code(await send(session, 'Echo', invalid))).toBe(E.CORE_ERROR_INVALID_REQUEST);
    // 9. kill switch
    expect((await admin(server, 'set_kill_switch', { request_name: 'Echo', enabled: true })).status).toBe(200);
    expect(code(await send(session, 'Echo', echo()))).toBe(E.CORE_ERROR_FEATURE_DISABLED);
    await admin(server, 'set_kill_switch', { request_name: 'Echo', enabled: false });
    // 6. ban
    expect((await admin(server, 'ban_user', { user_id: user, until_at: '0', reason: 'test' })).status).toBe(200);
    expect(code(await send(session, 'Echo', echo()))).toBe(E.CORE_ERROR_BANNED);
    await admin(server, 'unban_user', { user_id: user });
    // 4. maintenance
    await admin(server, 'set_maintenance', { enabled: true });
    expect(code(await send(session, 'Echo', echo()))).toBe(E.CORE_ERROR_MAINTENANCE);
    await admin(server, 'set_maintenance', { enabled: false });
    expect(calls.echo).toBe(0);

    // 5. a committed request ID with another request name (step 14 is in 'reaches step 14 ...' below)
    const request_id = '7f0b7d8e-2a4b-4c6d-8e0f-1a2b3c4d5e6f';
    expect(code(await send(session, 'Echo', echo(), { request_id }))).toBe(0);
    expect(code(await send(session, 'Fail', echo(), { request_id }))).toBe(E.CORE_ERROR_INVALID_REQUEST);
    expect(calls.fail).toBe(0);
    // 15. handler
    expect(code(await send(session, 'Fail', echo()))).toBe(GAME_ERROR_LISTED);
    expect(code(await send(session, 'Crash', echo()))).toBe(E.CORE_ERROR_INTERNAL);
  });

  it('checks the common header before maintenance, and maintenance before authentication', async () => {
    const calls = new_calls();
    const server = await server_with(calls);
    const session = await login(server, 'order');
    await admin(server, 'set_maintenance', { enabled: true });
    expect(code(await send(session, 'Echo', echo(), { headers: { 'X-Ogw-Request-Id': 'not-a-uuid' } }))).toBe(E.CORE_ERROR_INVALID_REQUEST);
    advance(server, 400n * 24n * 3600n * 1000n);
    expect(code(await send(session, 'Echo', echo()))).toBe(E.CORE_ERROR_MAINTENANCE);
    await admin(server, 'set_maintenance', { enabled: false });
    expect(code(await send(session, 'Echo', echo()))).toBe(E.CORE_ERROR_TOKEN_EXPIRED);
  });

  it('leaves no saved state after a handler GameError or exception', async () => {
    const calls = new_calls();
    const server = await server_with(calls);
    const sender = await login(server, 'sender');
    const target = await login(server, 'target');
    calls.probe_target = target.user_id;
    const before = await read_user_state(server, sender.user_id);
    calls.probe_mode = 'game_error';
    expect(code(await send(sender, 'Probe', echo()))).toBe(GAME_ERROR_LISTED);
    calls.probe_mode = 'throw';
    expect(code(await send(sender, 'Probe', echo()))).toBe(E.CORE_ERROR_INTERNAL);
    await wait_background(server);
    expect(calls.applied).toBe(0);
    expect(await read_user_state(server, sender.user_id)).toEqual(before);
    const internal = logs(server, 'error').filter((line) => line.request === 'Probe');
    expect(internal.length).toBeGreaterThan(0);
    expect(String(internal[0]?.stack_trace)).toContain('crash after a write');
    calls.probe_mode = 'response';
    expect(code(await send(sender, 'Probe', echo()))).toBe(0);
    await wait_background(server);
    expect(calls.applied).toBe(1);
  });

  it('keeps no write of a core rpc handler that returns a CoreError after a write', async () => {
    const server = await server_with(new_calls());
    const session = await login(server, 'claim_core_error');
    // ClaimMail adds the attachments, then finds no grant_mail_extra hook for the extra_id: INTERNAL.
    const mail_id = await mail_with_extra(server, session);
    const before = await read_user_state(server, session.user_id);
    expect(code(await claim(session, mail_id))).toBe(E.CORE_ERROR_INTERNAL);
    expect(await read_user_state(server, session.user_id)).toEqual(before);
  });

  it('answers a hook GameError listed in the core rpc\'s core_errors, and INTERNAL with an error log for an unlisted one', async () => {
    let answer = GAME_ERROR_LISTED;
    let hook_calls = 0;
    const server = await server_with(new_calls(), {}, (core) => {
      core.routing.register_hook('mailbox', 'grant_mail_extra', () => {
        hook_calls += 1;
        return answer;
      });
    });
    const session = await login(server, 'hooked');
    const mail_id = await mail_with_extra(server, session);
    const before = await read_user_state(server, session.user_id);
    expect(code(await claim(session, mail_id))).toBe(GAME_ERROR_LISTED);
    expect(await read_user_state(server, session.user_id)).toEqual(before);
    answer = GAME_ERROR_UNLISTED;
    expect(code(await claim(session, mail_id))).toBe(E.CORE_ERROR_INTERNAL);
    expect(hook_calls).toBe(2);
    const error = logs(server, 'error').find((line) => line.request === 'core/ClaimMail');
    expect(String(error?.message)).toContain(String(GAME_ERROR_UNLISTED));
    expect(await read_user_state(server, session.user_id)).toEqual(before);
  });

  it('calls a hook registered with register_hook at the module\'s hook time, and the default without one', async () => {
    let hook_calls = 0;
    const hooked = await server_with(new_calls(), {}, (core) => {
      core.routing.register_hook('mailbox', 'grant_mail_extra', () => {
        hook_calls += 1;
        return 'pass';
      });
    });
    const plain = await server_with(new_calls());
    const user = await login(hooked, 'a');
    expect(code(await claim(user, await mail_with_extra(hooked, user)))).toBe(0);
    expect(hook_calls).toBe(1);
    // grant_mail_extra's default: a mail with an extra_id is INTERNAL.
    const other = await login(plain, 'a');
    expect(code(await claim(other, await mail_with_extra(plain, other)))).toBe(E.CORE_ERROR_INTERNAL);
    expect(hook_calls).toBe(1);
  });

  it('calls the request start operations before the transaction and puts their changes in the same request\'s response delta', async () => {
    const calls = new_calls();
    const server = await server_with(calls);
    const session = await login(server, 'request_start');
    const now = await user_time(session);
    const mail = { template_id: GameDataDev.find_id_value('[mail_ad_reward_mail]'), args: [], attachments: [], extra_id: 0, expire_ms: 0, no_expiry: false, once_key: '' };
    expect((await admin(server, 'broadcast_mail', { operation_id: 'routing-broadcast-1', mail, start_at: now.toString() })).status).toBe(200);
    // mailbox's request start delivers the broadcast mail in its own transaction: a pending delta of this request.
    const sent = await send(session, 'Echo', echo());
    expect(code(sent)).toBe(0);
    expect(calls.echo).toBe(1);
    expect(sent.envelope.pending_user_state?.entries.some((entry) => entry.kind === 'MailUserState')).toBe(true);
    expect(logs(server, 'error').filter((line) => line.message === 'on_request_start failed')).toEqual([]);
  });

  it('answers a request with server_time_at equal to the handler\'s server-time.now, and the cheat time offset in the error and RefreshToken times', async () => {
    const calls = new_calls();
    const server = await server_with(calls);
    const session = await login(server, 'time');
    const sent = await send(session, 'Echo', echo());
    expect(sent.envelope.server_time_at).toBe(calls.echo_time);

    // A request that ends at step 5 answers clock_now.
    const clock = (await send(session, 'Echo', echo(), { headers: { Authorization: 'Bearer nope' } })).envelope.server_time_at;
    const request = new SetTimeOffsetRequest();
    request.offset_ms = 5000n;
    expect(code(await send_cheat(session, 'core/cheat/SetTimeOffset', request))).toBe(0);
    await admin(server, 'set_kill_switch', { request_name: 'Echo', enabled: true });
    const killed = await send(session, 'Echo', echo(), { timestamp: clock + 5000n });
    expect(code(killed)).toBe(E.CORE_ERROR_FEATURE_DISABLED);
    expect(killed.envelope.server_time_at).toBe(clock + 5000n);
    const unauthorized = await send(session, 'Echo', echo(), { headers: { Authorization: 'Bearer nope' } });
    expect(unauthorized.envelope.server_time_at).toBe(clock);
    if (!missing('notice')) {
      const after = await raw(server, 'POST', '/core/GetNotices', plain_headers(), new CoreContract.GetNoticesRequest().encode());
      expect(envelope_of(after).server_time_at).toBe(clock);
    }
    const refresh = await send({ ...session, access_token: session.login_token }, 'core/RefreshToken', new CoreContract.RefreshTokenRequest(), { timestamp: clock + 5000n });
    expect(code(refresh)).toBe(0);
    expect(refresh.envelope.server_time_at).toBe(clock + 5000n);
  });
});

describe('idempotency inside the transaction', () => {
  it('reaches step 14 when a same-ID request of another name commits while this one waits, and answers INVALID_REQUEST without the handler', async () => {
    const calls = new_calls();
    calls.probe_handler = () => new CoreContract.ResyncResponse();
    const server = await server_with(calls);
    const session = await login(server, 'step14');
    const request_id = '2b3c4d5e-6f7a-4b8c-9d0e-1f2a3b4c5d6e';
    // Both requests pass step 5 (no stored response yet) and wait at step 13 until the gate opens.
    const storage = (server as unknown as { running(): { instance: { modules(): ReadonlyMap<string, Record<string, unknown>> } } }).running().instance.modules().get('storage') as {
      run_request_transaction: (user_id: bigint, fields: { request_id: string }, fn: unknown) => Promise<unknown>;
    };
    const run_request_transaction = storage.run_request_transaction;
    let open = (): void => undefined;
    const gate = new Promise<void>((resolve) => {
      open = resolve;
    });
    let waiting = 0;
    storage.run_request_transaction = async (user_id, fields, fn) => {
      if (fields.request_id === request_id) {
        waiting += 1;
        await gate;
      }
      return run_request_transaction.call(storage, user_id, fields, fn);
    };
    try {
      const echoed = send(session, 'Echo', echo(), { request_id });
      const probed = send(session, 'Probe', echo(), { request_id });
      for (let i = 0; i < 100 && waiting < 2; i += 1) {
        await new Promise((resolve) => {
          setTimeout(resolve, 20);
        });
      }
      expect(waiting).toBe(2);
      open();
      const results = await Promise.all([echoed, probed]);
      // The first to commit runs its handler; the other finds the committed response of another name at step 14.
      expect(results.map((sent) => code(sent)).sort((x, y) => x - y)).toEqual([0, E.CORE_ERROR_INVALID_REQUEST]);
      expect(calls.echo + calls.probe).toBe(1);
      const rejected = results.find((sent) => code(sent) !== 0);
      expect(rejected?.envelope.error?.detail).toMatch(/^step 14/);
      expect(logs(server, 'security').filter((line) => line.reason === 'request_name_mismatch')).toHaveLength(1);
    } finally {
      open();
      storage.run_request_transaction = run_request_transaction;
    }
  });
});

describe('ban', () => {
  it('lets a banned user\'s IssueDeletionCode through and answers other requests BANNED with the ban detail', async () => {
    const calls = new_calls();
    const server = await server_with(calls);
    const session = await login(server, 'banned');
    await admin(server, 'ban_user', { user_id: session.user_id.toString(), until_at: '99999999999999', reason: 'test' });
    const issued = await send(session, 'core/IssueDeletionCode', new CoreContract.IssueDeletionCodeRequest());
    expect(code(issued)).toBe(0);
    const banned = await send(session, 'Echo', echo());
    expect(code(banned)).toBe(E.CORE_ERROR_BANNED);
    const ban = banned.envelope.error?.ban;
    expect(ban?.user_id).toBe(session.user_id);
    const storage = storage_module(server as unknown as RunningServer);
    expect(ban?.public_code).toBe(storage.get_user_record(storage.read_db(), session.user_id)?.public_code);
    expect(ban?.public_code).toMatch(/^[0-9A-HJKMNP-TV-Z]{8}$/);
    expect(ban?.until_at).toBe(99999999999999n);
    expect(ban?.deletion_url).toMatch(/^http:\/\/127\.0\.0\.1:[0-9]+\/account\/deletion$/);
    expect(ban?.deletion_url).toBe((issued.response as CoreContract.IssueDeletionCodeResponse).url);
    expect(ban?.access_token).toBe('');
    expect(ban?.session_signing_key).toBe('');
    expect(calls.echo).toBe(0);
  });
});

describe('stored responses', () => {
  it('answers a Withdraw sent again with the same access token and request ID with the first response, without authentication or handler', async () => {
    const server = await server_with(new_calls());
    const session = await login(server, 'withdraw');
    const request_id = '5d3c2b1a-0f9e-4d8c-a7b6-c5d4e3f2a1b0';
    const first = await send(session, 'core/Withdraw', new CoreContract.WithdrawRequest(), { request_id });
    expect(code(first)).toBe(0);
    advance(server, 1000n);
    const again = await send(session, 'core/Withdraw', new CoreContract.WithdrawRequest(), { request_id });
    expect(code(again)).toBe(0);
    expect(without_time(again.envelope)).toEqual(without_time(first.envelope));
    expect(code(await send(session, 'core/Withdraw', new CoreContract.WithdrawRequest()))).not.toBe(0);
    advance(server, 86400000n + 1n);
    expect(code(await send(session, 'core/Withdraw', new CoreContract.WithdrawRequest(), { request_id }))).not.toBe(0);
  });

  it('answers a ConfirmAge below the minimum age sent again with the same access token and request ID with the first response, as Withdraw', async () => {
    const server = await server_with(new_calls(), { 'consent.minimumAge': 14, 'consent.ageConfirmation': true });
    const session = await login(server, 'below_minimum_age');
    const request = new CoreContract.ConfirmAgeRequest();
    request.birth_year_month = utc_year_month(await user_time(session)) - 13 * 100;
    const request_id = '7c6b5a49-3827-4615-a4b3-c2d1e0f9a8b7';
    const first = await send(session, 'core/ConfirmAge', request, { request_id });
    expect(code(first)).toBe(0);
    expect((first.response as CoreContract.ConfirmAgeResponse).consent?.below_minimum_age).toBe(true);
    // The user is withdrawn: another request ID fails authentication.
    expect(code(await send(session, 'core/ConfirmAge', request))).not.toBe(0);
    advance(server, 1000n);
    const again = await send(session, 'core/ConfirmAge', request, { request_id });
    expect(code(again)).toBe(0);
    expect(without_time(again.envelope)).toEqual(without_time(first.envelope));
  });

  it('answers a committed request sent again with its stored response through ban, data version, rate limit and kill switch, but not maintenance', async () => {
    const calls = new_calls();
    const server = await server_with(calls, { 'routing.userRateLimitPerMinute': 3 });
    const session = await login(server, 'again');
    const request_id = '1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d';
    const first = await send(session, 'Echo', echo(), { request_id });
    expect(code(first)).toBe(0);
    const same = (sent: { envelope: CoreContract.ResponseEnvelope; response: unknown }): void => {
      expect(code(sent)).toBe(0);
      expect(sent.envelope.body).toEqual(first.envelope.body);
    };
    await admin(server, 'ban_user', { user_id: session.user_id.toString(), until_at: '0', reason: 'test' });
    same(await send(session, 'Echo', echo(), { request_id }));
    await admin(server, 'unban_user', { user_id: session.user_id.toString() });
    await admin(server, 'set_kill_switch', { request_name: 'Echo', enabled: true });
    same(await send(session, 'Echo', echo(), { request_id }));
    await admin(server, 'set_kill_switch', { request_name: 'Echo', enabled: false });
    // The same protocol hash with another data hash and no client version: DATA_UPDATE_REQUIRED without a stored response.
    const [protocol = '', data_hash = ''] = client_data_version().split('-');
    const stale = { 'X-Ogw-Data-Version': `${protocol}-${data_hash.startsWith('0') ? '1' : '0'}${data_hash.slice(1)}`, 'X-Ogw-Client-Version': '' };
    expect(code(await send(session, 'Echo', echo(), { headers: stale }))).toBe(E.CORE_ERROR_DATA_UPDATE_REQUIRED);
    same(await send(session, 'Echo', echo(), { request_id, headers: stale }));
    same(await send(session, 'Echo', echo(), { request_id }));
    same(await send(session, 'Echo', echo(), { request_id }));
    expect(calls.echo).toBe(1);
    // The resends did not count: two new requests fit in the limit of 3 with the first.
    expect(code(await send(session, 'Echo', echo()))).toBe(0);
    expect(code(await send(session, 'Echo', echo()))).toBe(0);
    expect(code(await send(session, 'Echo', echo()))).toBe(E.CORE_ERROR_RATE_LIMITED);
    await admin(server, 'set_maintenance', { enabled: true });
    expect(code(await send(session, 'Echo', echo(), { request_id }))).toBe(E.CORE_ERROR_MAINTENANCE);
  });
});

describe('rate limit', () => {
  it('answers RATE_LIMITED over the user counter limit and takes requests again in the next minute window', async () => {
    const calls = new_calls();
    const server = await server_with(calls, { 'routing.userRateLimitPerMinute': 2 });
    const session = await login(server, 'limited');
    expect(code(await send(session, 'Fail', echo()))).toBe(GAME_ERROR_LISTED);
    expect(code(await send(session, 'Echo', echo()))).toBe(0);
    expect(code(await send(session, 'Echo', echo()))).toBe(E.CORE_ERROR_RATE_LIMITED);
    expect(calls.echo).toBe(1);
    advance(server, 60000n);
    expect(code(await send(session, 'Echo', echo()))).toBe(0);
    expect(logs(server, 'security').some((line) => line.reason === 'rate_limited_user')).toBe(true);
  });

  it('does not count a request that ended BANNED at step 6', async () => {
    const calls = new_calls();
    const server = await server_with(calls, { 'routing.userRateLimitPerMinute': 1 });
    const session = await login(server, 'banned_count');
    await admin(server, 'ban_user', { user_id: session.user_id.toString(), until_at: '0', reason: 'test' });
    for (let i = 0; i < 3; i += 1) expect(code(await send(session, 'Echo', echo()))).toBe(E.CORE_ERROR_BANNED);
    await admin(server, 'unban_user', { user_id: session.user_id.toString() });
    expect(code(await send(session, 'Echo', echo()))).toBe(0);
  });

  it('counts every request of the same user sent to two server instances on one DB at once', async () => {
    const calls = new_calls();
    const server = await server_with(calls, { 'routing.userRateLimitPerMinute': 6 });
    // Stopping the original test server stops its peer too.
    const other = await peer(server);
    const session = await login(server, 'shared');
    const time = await user_time(session);
    const body = echo().encode();
    const results = await Promise.all([
      ...[0, 1, 2, 3].map(async () => code(await send(session, 'Echo', echo()))),
      ...[0, 1, 2, 3].map(async () => envelope_of(await raw(other, 'POST', '/Echo', signed_headers(session, 'Echo', body, time), body)).error?.code ?? 0),
    ]);
    // Resync and the eight requests count 9: the requests that counted 7, 8 and 9 are over the limit of 6.
    expect(results.filter((r) => r === E.CORE_ERROR_RATE_LIMITED)).toHaveLength(3);
    expect(results.filter((r) => r === 0)).toHaveLength(5);
  });

  it('answers RATE_LIMITED to the next authentication failure of an IP over the IP limit, and still takes that IP\'s valid token', async () => {
    const calls = new_calls();
    const server = await server_with(calls, { 'routing.ipRateLimitPerMinute': 2 });
    const session = await login(server, 'ip');
    advance(server, 60000n);
    const bad = { headers: { Authorization: 'Bearer wrong-token' } };
    expect(code(await send(session, 'Echo', echo(), bad))).toBe(E.CORE_ERROR_UNAUTHORIZED);
    expect(code(await send(session, 'Echo', echo(), bad))).toBe(E.CORE_ERROR_UNAUTHORIZED);
    expect(code(await send(session, 'Echo', echo(), bad))).toBe(E.CORE_ERROR_RATE_LIMITED);
    expect(code(await send(session, 'Echo', echo()))).toBe(0);
    expect(logs(server, 'security').some((line) => line.reason === 'rate_limited_ip')).toBe(true);
  });

  it('answers INTERNAL with an error log and does not call the handler when the rate counter transaction is FAILED', async () => {
    const calls = new_calls();
    const server = await server_with(calls, { 'storage.userLockWaitMs': 200 });
    const session = await login(server, 'counter_failed');
    const now = await user_time(session);
    // Another connection holds what the user counter's game transaction waits for, past storage.userLockWaitMs.
    const database = (server as unknown as { shared: { database: { db_argument: string; connection: string | null } } }).shared.database;
    const holder = await lock_holder({ kind: DB_KIND, db: database.db_argument, secrets: database.connection === null ? {} : { db: database.connection } });
    try {
      if (DB_KIND === 'sqlite') await holder.ok('BEGIN IMMEDIATE');
      else {
        const window_start = (now / 60000n) * 60000n;
        await holder.ok('BEGIN');
        // The user_time request made the row of this minute window; the holder locks it.
        await holder.ok('SELECT count FROM routing_rate_counter WHERE kind = $1 AND target = $2 AND window_start = $3 FOR UPDATE', ['user', session.user_id.toString(), window_start]);
      }
      expect(code(await send(session, 'Echo', echo()))).toBe(E.CORE_ERROR_INTERNAL);
      expect(calls.echo).toBe(0);
      expect(logs(server, 'error').some((line) => line.message === 'rate counter transaction failed')).toBe(true);
      await holder.ok('ROLLBACK');
      expect(code(await send(session, 'Echo', echo()))).toBe(0);
    } finally {
      stop_all();
    }
  });

  it('answers TOKEN_EXPIRED to expired access tokens over the IP limit, without a security log', async () => {
    const server = await server_with(new_calls(), { 'routing.ipRateLimitPerMinute': 2 });
    const session = await login(server, 'expired');
    advance(server, 400n * 24n * 3600n * 1000n);
    const before = logs(server, 'security').length;
    for (let i = 0; i < 5; i += 1) expect(code(await send(session, 'Echo', echo()))).toBe(E.CORE_ERROR_TOKEN_EXPIRED);
    expect(logs(server, 'security')).toHaveLength(before);
  });

  // `notice` is not in this core yet.
  it.skipIf(missing('notice'))('serves GetNotices without an access token during maintenance, and answers RATE_LIMITED over the IP limit', async () => {
    const server = await server_with(new_calls(), { 'routing.ipRateLimitPerMinute': 2 });
    await admin(server, 'set_maintenance', { enabled: true });
    const body = new CoreContract.GetNoticesRequest().encode();
    const ios = await raw(server, 'POST', '/core/GetNotices', plain_headers({ 'X-Ogw-Platform': 'ios', 'X-Ogw-Client-Version': '2.0.0' }), body);
    expect(envelope_of(ios).error).toBeNull();
    expect(envelope_of(await raw(server, 'POST', '/core/GetNotices', plain_headers(), body)).error).toBeNull();
    expect(envelope_of(await raw(server, 'POST', '/core/GetNotices', plain_headers(), body)).error?.code).toBe(E.CORE_ERROR_RATE_LIMITED);
  });

  // Skipped in a core without `notice`.
  it.skipIf(missing('notice'))('gives the GetNotices handler the X-Ogw-Platform and X-Ogw-Client-Version values', async () => {
    // One supported language, so the notices below have a text for every supported language.
    const server = await server_with(new_calls(), { 'routing.ipRateLimitPerMinute': 100, supportedLanguages: ['en'] });
    const put = async (fields: Record<string, unknown>): Promise<string> => {
      const input = {
        operation_id: `routing-notice-${randomUUID()}`,
        notice_id: '0',
        kind: 'Notice',
        priority: 0,
        start_at: '0',
        end_at: '99999999999999',
        platforms: [],
        languages: [],
        min_client_version: '',
        max_client_version: '',
        texts: [{ language: 'en', title: 'Title', body: 'Body' }],
        image_url: '',
        shortcut_id: 0,
        link_url: '',
        ...fields,
      };
      const result = await admin(server, 'put_notice', input);
      expect(result.status).toBe(200);
      return String((result.body as { notice_id: unknown }).notice_id);
    };
    const ios_only = await put({ platforms: ['ios'] });
    const from_2 = await put({ min_client_version: '2.0.0' });
    const shown = async (platform: string, client_version: string): Promise<string[]> => {
      const reply = await raw(server, 'POST', '/core/GetNotices', plain_headers({ 'X-Ogw-Platform': platform, 'X-Ogw-Client-Version': client_version }), new CoreContract.GetNoticesRequest().encode());
      const envelope = envelope_of(reply);
      expect(envelope.error).toBeNull();
      const response = CoreContract.GetNoticesResponse.decode(envelope.body);
      return (response?.notices ?? []).map((notice) => notice.id.toString()).sort();
    };
    expect(await shown('ios', '2.0.0')).toEqual([ios_only, from_2].sort());
    expect(await shown('ios', '1.0.0')).toEqual([ios_only]);
    expect(await shown('android', '2.0.0')).toEqual([from_2]);
    expect(await shown('android', '1.0.0')).toEqual([]);
  });

  it('answers MAINTENANCE to a Login over the IP limit during maintenance, and RATE_LIMITED with an undecodable body otherwise', async () => {
    const server = await server_with(new_calls(), { 'routing.ipRateLimitPerMinute': 1 });
    const garbage = new Uint8Array([0xff, 0xff]);
    expect(envelope_of(await raw(server, 'POST', '/core/Login', plain_headers(), garbage)).error?.code).toBe(E.CORE_ERROR_INVALID_REQUEST);
    expect(envelope_of(await raw(server, 'POST', '/core/Login', plain_headers(), garbage)).error?.code).toBe(E.CORE_ERROR_RATE_LIMITED);
    await admin(server, 'set_maintenance', { enabled: true });
    expect(envelope_of(await raw(server, 'POST', '/core/Login', plain_headers(), garbage)).error?.code).toBe(E.CORE_ERROR_MAINTENANCE);
  });
});

describe('request prepare', () => {
  it.skipIf(missing('coupon'))('commits the RedeemCoupon attempt counter before the transaction, and stops at the limit without the handler', async () => {
    const server = await server_with(new_calls(), { 'coupon.maxAttemptsPerWindow': 2 });
    const session = await login(server, 'coupon');
    const redeem = new CoreContract.RedeemCouponRequest();
    redeem.code = 'NOSUCHCODE';
    expect(code(await send(session, 'core/RedeemCoupon', redeem))).toBe(E.CORE_ERROR_COUPON_INVALID);
    expect(code(await send(session, 'core/RedeemCoupon', redeem))).toBe(E.CORE_ERROR_COUPON_INVALID);
    expect(code(await send(session, 'core/RedeemCoupon', redeem))).toBe(E.CORE_ERROR_RATE_LIMITED);
  });

  it.skipIf(missing('coupon'))('does not count a RedeemCoupon resent with a stored response, and answers it with the first response', async () => {
    const server = await server_with(new_calls(), { 'coupon.maxAttemptsPerWindow': 2 });
    const created = await admin(server, 'create_coupon', { operation_id: 'routing-1', kind: 'shared', code: 'ROUTINGCODE', count: 0, max_uses: 10, start_at: '0', end_at: '99999999999999', items: [{ item_id: GameDataDev.find_id_value('[gold]'), amount: '5' }], extra_id: 0, memo: '' });
    expect(created.status).toBe(200);
    const session = await login(server, 'coupon_ok');
    const redeem = new CoreContract.RedeemCouponRequest();
    redeem.code = 'ROUTINGCODE';
    const request_id = '9e8d7c6b-5a4f-4e3d-9c2b-1a0f9e8d7c6b';
    const first = await send(session, 'core/RedeemCoupon', redeem, { request_id });
    expect(code(first)).toBe(0);
    const again = await send(session, 'core/RedeemCoupon', redeem, { request_id });
    expect(without_time(again.envelope)).toEqual(without_time(first.envelope));
    const other = new CoreContract.RedeemCouponRequest();
    other.code = 'NOSUCHCODE';
    expect(code(await send(session, 'core/RedeemCoupon', other))).toBe(E.CORE_ERROR_COUPON_INVALID);
  });

  it('calls a prepare operation outside the transaction: the same user\'s other request goes on, and a CoreError skips the handler', async () => {
    const calls = new_calls();
    const server = await start({ real_adapters: { 'login-google': 'login-google' }, register: game_register(calls) });
    servers.push(server);
    const session = await login(server, 'link');
    const link = new CoreContract.LinkAccountRequest();
    link.provider = CoreContract.LoginProvider.LOGIN_PROVIDER_GOOGLE;
    // An ID token of a key the key source must give: its fetch fails before set_key_source.
    const part = (value: object): string => Buffer.from(JSON.stringify(value)).toString('base64url');
    link.credential = `${part({ alg: 'RS256', kid: 'routing-key', typ: 'JWT' })}.${part({ sub: 'x' })}.c2lnbmF0dXJl`;
    const linking = send(session, 'core/LinkAccount', link);
    const other = await send(session, 'Echo', echo());
    expect(code(other)).toBe(0);
    expect(code(await linking)).toBe(E.CORE_ERROR_EXTERNAL_SERVICE_FAILED);
  });
});

describe('security log reasons', () => {
  it('names the user counter, the IP counter, the request name mismatch and the replaced session', async () => {
    const server = await server_with(new_calls(), { 'routing.userRateLimitPerMinute': 1 });
    const first = await login(server, 'reasons');
    const request_id = '3c4d5e6f-7a8b-4c9d-8e0f-1a2b3c4d5e6f';
    expect(code(await send(first, 'Echo', echo(), { request_id }))).toBe(0);
    expect(code(await send(first, 'Fail', echo(), { request_id }))).toBe(E.CORE_ERROR_INVALID_REQUEST);
    expect(code(await send(first, 'Echo', echo()))).toBe(E.CORE_ERROR_RATE_LIMITED);
    await login(server, 'reasons');
    expect(code(await send(first, 'Echo', echo()))).toBe(E.CORE_ERROR_SESSION_REPLACED);
    const reasons = logs(server, 'security').map((line) => line.reason);
    for (const reason of ['request_name_mismatch', 'rate_limited_user', 'session_replaced']) expect(reasons).toContain(reason);
    expect(JSON.stringify(logs(server))).not.toContain(first.access_token);
  });
});
