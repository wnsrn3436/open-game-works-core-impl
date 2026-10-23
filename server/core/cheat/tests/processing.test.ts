import * as CoreContract from '../../../generated/contract/core_contract.ts';
import * as CoreCheatContract from '../../../dev/generated/contract/core_cheat_contract.ts';
import * as GameContract from '../../../generated/contract/game_contract.ts';
import * as testing from '../../testing/dev/index.ts';
import type { TestServer, TestSession } from '../../testing/dev/index.ts';
import {
  E,
  GAME_ERROR_CORE_TEST,
  START_AT,
  STEP,
  cheat_audits,
  code,
  gold,
  new_calls,
  raw_cheat,
  raw_dev_login,
  set_time_offset,
  set_user_state,
  start,
  stop_all,
  user_time,
  type Calls,
} from './served.ts';

vi.mock('../../../dev/generated/contract/game_cheat_contract.ts', async () => (await import('./game_cheat_contract_mock.ts')).mock_game_cheat_contract());

afterEach(stop_all);

const SET_TIME_OFFSET = 'core/cheat/SetTimeOffset';

function game(session: TestSession): Promise<testing.SendResult> {
  return testing.send(session, 'RunCoreTest', new GameContract.RunCoreTestRequest());
}

async function admin(server: TestServer, operation: string, body: unknown): Promise<void> {
  const reply = await testing.send_admin(server, operation, body);
  expect([operation, reply.status]).toEqual([operation, 200]);
}

async function items(server: TestServer, user_id: bigint): Promise<testing.StateItem[]> {
  return (await testing.read_user_state(server, user_id)).filter((item) => item.kind === 'ItemBalanceUserState');
}

describe('cheat request processing', () => {
  it('counts cheat requests on the game request user counter and changes no UserState or offset when RATE_LIMITED', async () => {
    const calls = new_calls(gold());
    const server = await start({ calls, settings: { 'routing.userRateLimitPerMinute': 3 } });
    const session = await testing.login(server, 'qa');
    expect(code(await game(session))).toBe(0);
    expect(code(await game(session))).toBe(0);
    expect(code(await testing.send_cheat(session, SET_TIME_OFFSET, set_time_offset(STEP)))).toBe(0);
    expect(code(await testing.send_cheat(session, SET_TIME_OFFSET, set_time_offset(2n * STEP)))).toBe(E.CORE_ERROR_RATE_LIMITED);
    expect(code(await testing.send_cheat(session, 'cheat/Grant', set_time_offset(0n)))).toBe(E.CORE_ERROR_RATE_LIMITED);
    expect(code(await game(session))).toBe(E.CORE_ERROR_RATE_LIMITED);
    expect(calls.count.get('Grant')).toBeUndefined();
    expect(cheat_audits(server).filter((l) => l['request'] !== 'core/cheat/DevLogin')).toHaveLength(1);

    testing.advance_time(server, 60_000n);
    expect(await items(server, session.user_id)).toEqual([]);
    expect(await user_time(session)).toBe(START_AT + 60_000n + STEP);
  });

  it('processes cheat requests during maintenance, ban and kill switch, and answers DevLogin with MAINTENANCE and BANNED', async () => {
    const server = await start({ calls: new_calls(gold()) });
    const session = await testing.login(server, 'qa');
    const banned = await testing.login(server, 'banned');

    await admin(server, 'set_maintenance', { enabled: true });
    expect(code(await game(session))).toBe(E.CORE_ERROR_MAINTENANCE);
    expect(code(await testing.send_cheat(session, SET_TIME_OFFSET, set_time_offset(STEP)))).toBe(0);
    expect((await raw_dev_login(server, 'qa')).error?.code).toBe(E.CORE_ERROR_MAINTENANCE);
    await admin(server, 'set_maintenance', { enabled: false });
    expect(await user_time(session)).toBe(START_AT + STEP);

    await admin(server, 'ban_user', { user_id: banned.user_id.toString(), until_at: '0', reason: 'test' });
    expect(code(await game(banned))).toBe(E.CORE_ERROR_BANNED);
    expect(code(await testing.send_cheat(banned, SET_TIME_OFFSET, set_time_offset(2n * STEP)))).toBe(0);
    expect((await raw_dev_login(server, 'banned')).error?.code).toBe(E.CORE_ERROR_BANNED);

    await admin(server, 'set_kill_switch', { request_name: 'RunCoreTest', enabled: true });
    expect(code(await game(session))).toBe(E.CORE_ERROR_FEATURE_DISABLED);
    expect(code(await testing.send_cheat(session, SET_TIME_OFFSET, set_time_offset(3n * STEP)))).toBe(0);
    expect(await user_time(session)).toBe(START_AT + 3n * STEP);
  });

  it('answers an unknown cheat name and a body that is not the cheat request message with INVALID_REQUEST', async () => {
    const server = await start({ calls: new_calls(gold()) });
    const session = await testing.login(server, 'qa');
    expect((await raw_cheat(server, session, 'cheat/NoSuchCheat', set_time_offset(STEP))).error?.code).toBe(E.CORE_ERROR_INVALID_REQUEST);
    expect((await raw_cheat(server, session, SET_TIME_OFFSET, set_time_offset(STEP), { body: Uint8Array.of(0xff) })).error?.code).toBe(E.CORE_ERROR_INVALID_REQUEST);
    expect(code(await testing.send_cheat(session, 'core/cheat/SetUserState', set_user_state('ItemBalanceUserState', 1n, '{"id": "1"}')))).toBe(E.CORE_ERROR_INVALID_REQUEST);
    expect(await user_time(session)).toBe(START_AT);
  });
});

describe('SetTimeOffset response', () => {
  it('answers server_time_at clock + new offset, and a next request signed with that timestamp passes', async () => {
    const server = await start({ calls: new_calls(gold()) });
    const session = await testing.login(server, 'qa');
    testing.advance_time(server, 1_000n);
    // Past the request signature window, inside the access token lifetime.
    const offset = 20n * STEP;
    const sent = await testing.send_cheat(session, SET_TIME_OFFSET, set_time_offset(offset));
    expect(code(sent)).toBe(0);
    expect(sent.envelope.server_time_at).toBe(START_AT + 1_000n + offset);
    const next = await testing.send(session, 'core/Resync', new CoreContract.ResyncRequest(), undefined, sent.envelope.server_time_at);
    expect(code(next)).toBe(0);
    const stale = await testing.send(session, 'core/Resync', new CoreContract.ResyncRequest(), undefined, START_AT + 1_000n);
    expect(code(stale)).toBe(E.CORE_ERROR_UNAUTHORIZED);
  });

  it('finds server_time_at after the commit, so time that passes before the commit is in it', async () => {
    const server = await start({ calls: new_calls(gold()) });
    const session = await testing.login(server, 'qa');
    const idempotency = server.running().instance.modules().get('idempotency') as unknown as { save_response(ctx: unknown, bytes: Uint8Array): void };
    const save_response = idempotency.save_response.bind(idempotency);
    // The response bytes are made inside the request transaction; the clock moves on before the commit.
    vi.spyOn(idempotency, 'save_response').mockImplementation((ctx, bytes) => {
      save_response(ctx, bytes);
      testing.advance_time(server, 5_000n);
    });
    const sent = await testing.send_cheat(session, SET_TIME_OFFSET, set_time_offset(STEP));
    expect(code(sent)).toBe(0);
    expect(sent.envelope.server_time_at).toBe(START_AT + 5_000n + STEP);
  });
});

describe('content cheat handlers', () => {
  it('keeps the saved state after a handler GameError or exception', async () => {
    for (const mode of ['game_error', 'throw'] as const) {
      const calls: Calls = { ...new_calls(gold()), break_mode: mode };
      const server = await start({ calls });
      const session = await testing.login(server, 'qa');
      const sent = await testing.send_cheat(session, 'cheat/Break', set_time_offset(0n));
      expect(code(sent)).toBe(mode === 'game_error' ? GAME_ERROR_CORE_TEST : E.CORE_ERROR_INTERNAL);
      expect(sent.envelope.item_changes).toEqual([]);
      expect(calls.count.get('Break')).toBe(1);
      expect(await items(server, session.user_id)).toEqual([]);
      expect(await user_time(session)).toBe(START_AT);
    }
  });

  it('gives the ItemChange and history of a content cheat handler item-ledger.add_items source Cheat and ref the cheat name', async () => {
    const calls = new_calls(gold());
    const server = await start({ calls });
    const session = await testing.login(server, 'qa');
    const sent = await testing.send_cheat(session, 'cheat/Grant', set_time_offset(0n));
    expect(code(sent)).toBe(0);
    expect(calls.grant_source).toEqual({ source: CoreContract.ItemChangeSource.ITEM_CHANGE_SOURCE_CHEAT, ref: 'Grant' });
    expect(sent.envelope.item_changes.map((c) => [c.item_id, c.delta, c.source, c.ref])).toEqual([[gold(), 5n, CoreContract.ItemChangeSource.ITEM_CHANGE_SOURCE_CHEAT, 'Grant']]);
    const history = await testing.send_admin(server, 'list_item_history', { user_id: session.user_id.toString(), from_at: String(START_AT - 3_600_000n), to_at: String(START_AT + 3_600_000n), after_seq: '0', limit: 100 });
    expect(history.status).toBe(200);
    const rows = (history.json as { entries: Record<string, unknown>[] }).entries;
    expect(rows.map((row) => [row['item_id'], String(row['delta']), row['source'], row['ref']])).toEqual([[gold(), '5', 'ITEM_CHANGE_SOURCE_CHEAT', 'Grant']]);
  });

  it('keeps a service Cheat rpc named like a core cheat apart from that core cheat', async () => {
    const calls = new_calls(gold());
    const server = await start({ calls });
    const session = await testing.login(server, 'qa');
    expect(code(await testing.send_cheat(session, 'cheat/SetTimeOffset', set_time_offset(STEP)))).toBe(0);
    expect(calls.count.get('SetTimeOffset')).toBe(1);
    expect(await user_time(session)).toBe(START_AT);
    expect(code(await testing.send_cheat(session, SET_TIME_OFFSET, set_time_offset(STEP)))).toBe(0);
    expect(calls.count.get('SetTimeOffset')).toBe(1);
    expect(await user_time(session)).toBe(START_AT + STEP);

    const balance = new CoreCheatContract.SetItemBalanceRequest();
    balance.item_id = gold();
    balance.balance = 7n;
    expect(code(await testing.send_cheat(session, 'cheat/SetItemBalance', balance))).toBe(0);
    expect(calls.count.get('SetItemBalance')).toBe(1);
    expect(await items(server, session.user_id)).toEqual([]);
    expect(code(await testing.send_cheat(session, 'core/cheat/SetItemBalance', balance))).toBe(0);
    expect(calls.count.get('SetItemBalance')).toBe(1);
    expect((await items(server, session.user_id)).map((item) => item.item_id)).toEqual([BigInt(gold())]);
  });
});
