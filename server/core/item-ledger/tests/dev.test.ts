import * as CoreCheatContract from '../../../dev/generated/contract/core_cheat_contract.ts';
import * as CoreContract from '../../../generated/contract/core_contract.ts';
import { advance_time, balance, balance_entries, history, id, row, send_set_item_balance, set_balance, start, stop, tx, user, type Env } from './helpers.ts';

const MINUTE = 60_000n;
const HOUR = 60n * MINUTE;

let env: Env;

beforeAll(async () => {
  env = await start();
});

afterAll(() => {
  stop();
});

afterEach(() => {
  env.hooks.validate = null;
});

function cheat(item: number, value: bigint): CoreCheatContract.SetItemBalanceRequest {
  const req = new CoreCheatContract.SetItemBalanceRequest();
  req.item_id = item;
  req.balance = value;
  return req;
}

describe('DEV', () => {
  test('SetItemBalance sets the balance and its response delta has the ItemBalanceUserState', async () => {
    const { user_id } = await user(env);
    const { code, delta } = await send_set_item_balance(env, user_id, cheat(id('[gold]'), 77n));
    expect(code).toBe(0);
    const rows = balance_entries(delta?.user_state);
    expect(rows.map(([i, r]) => [i, r === 'deleted' ? r : r.amount])).toEqual([[id('[gold]'), 77n]]);
    expect(await balance(env, user_id, '[gold]')).toBe(77n);
    expect(history(env, user_id).at(-1)?.source).toBe('ITEM_CHANGE_SOURCE_CHEAT');
  });

  test('an unknown item and a balance out of range are INVALID_REQUEST', async () => {
    const { user_id } = await user(env);
    for (const req of [cheat(999999, 1n), cheat(id('[gold]'), 1_000_001n), cheat(id('[gem]'), 1n)]) {
      const { code } = await send_set_item_balance(env, user_id, req);
      expect(code).toBe(CoreContract.CoreError.CORE_ERROR_INVALID_REQUEST);
    }
    expect(await balance(env, user_id, '[gold]')).toBe(0n);
  });

  test('set_balance as routing dev calls it: UNKNOWN_ITEM leaves the state as it was', async () => {
    const { user_id } = await user(env);
    expect(await set_balance(env, user_id, '[gold]', 5)).toBe('OK');
    expect(await set_balance(env, user_id, 999999, 1n)).toBe('UNKNOWN_ITEM');
    expect(await set_balance(env, user_id, '[stamina]', 3)).toBe('OK');
    expect(await balance(env, user_id, '[stamina]')).toBe(3n);
    expect(await balance(env, user_id, '[gold]')).toBe(5n);
  });

  test('set_balance does not call validate_item_change; a timed item ends at request time + b × duration and b = 0 deletes the row', async () => {
    const { user_id } = await user(env);
    let calls = 0;
    env.hooks.validate = () => {
      calls += 1;
      return 'pass';
    };
    expect(await set_balance(env, user_id, '[gold]', 4)).toBe('OK');
    const now = env.server.clock.now();
    expect(await set_balance(env, user_id, '[boost_discard]', 2)).toBe('OK');
    expect((await row(env, user_id, '[boost_discard]'))?.ends_at).toBe(now + 2n * HOUR);
    expect(await tx(env, user_id, (ctx) => [env.ledger.get_balance(ctx, id('[boost_discard]')), env.ledger.get_ends_at(ctx, id('[boost_discard]'))])).toEqual([1n, now + 2n * HOUR]);
    expect(history(env, user_id).at(-1)).toMatchObject({ item_id: id('[boost_discard]'), delta: 2n, source: 'ITEM_CHANGE_SOURCE_CHEAT', ends_at_after: now + 2n * HOUR });
    expect(await set_balance(env, user_id, '[boost_discard]', 4)).toBe('INVALID_AMOUNT');
    expect(await set_balance(env, user_id, '[boost_discard]', 0)).toBe('OK');
    expect(await row(env, user_id, '[boost_discard]')).toBeNull();
    expect(await balance(env, user_id, '[boost_discard]')).toBe(0n);
    expect(calls).toBe(0);
  });

  test('set_balance of a recovery item reflects the recovery first and sets recovery_started_at by the after-change S rule', async () => {
    const created = env.server.clock.now();
    const { user_id } = await user(env);
    // [energy]: 2 per 5 minutes up to 10, initial_amount 0, so recovery starts at user creation.
    advance_time(env, 16n * MINUTE);
    expect(await set_balance(env, user_id, '[energy]', 3)).toBe('OK');
    let stored = await row(env, user_id, '[energy]');
    expect([stored?.amount, stored?.recovery_started_at]).toEqual([3n, created + 15n * MINUTE]);
    expect(history(env, user_id).map((h) => [h.source, h.delta, h.balance_after])).toEqual([
      ['ITEM_CHANGE_SOURCE_RECOVERY', 6n, 6n],
      ['ITEM_CHANGE_SOURCE_CHEAT', -3n, 3n],
    ]);
    expect(await set_balance(env, user_id, '[energy]', 10)).toBe('OK');
    stored = await row(env, user_id, '[energy]');
    expect([stored?.amount, stored?.recovery_started_at]).toEqual([10n, 0n]);
    advance_time(env, MINUTE);
    const now = env.server.clock.now();
    expect(await set_balance(env, user_id, '[energy]', 4)).toBe('OK');
    stored = await row(env, user_id, '[energy]');
    expect([stored?.amount, stored?.recovery_started_at]).toEqual([4n, now]);
    advance_time(env, 5n * MINUTE);
    expect(await balance(env, user_id, '[energy]')).toBe(6n);
  });
});
