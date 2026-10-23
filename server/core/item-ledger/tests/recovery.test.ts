import {
  balance, balance_entries, change_rows, fixture, flush, history, id, items, put_row, request, row, set_balance, set_time, start, stop, tx, user, type Env,
} from './helpers.ts';
import type { FixtureCase } from './helpers.ts';

const MINUTE = 60_000n;

let env: Env;
let now: bigint;

beforeAll(async () => {
  env = await start({ start_at: 10_000_000_000n });
  now = 10_000_000_000n;
});

afterAll(() => {
  stop();
});

/** Moves the test clock forward to `t`. */
function at(t: bigint): void {
  if (t < now) throw new Error('the clock goes forward only in this file');
  set_time(env, t);
  now = t;
}

function later(ms: bigint): bigint {
  at(now + ms);
  return now;
}

/** A case of core test fixture `item-recovery`. */
interface RecoveryInput {
  readonly item: string;
  readonly cap_bonus_balance: number;
  readonly amount: number;
  readonly recovery_started_at: number;
  readonly time: number;
}

interface RecoveryExpected {
  readonly balance: number;
  readonly next_recovery_at: number;
  readonly cap_reached_at: number;
}

describe('recovery item', () => {
  test('does not grow just before a recovery_interval boundary, grows by recovery_amount at it, by n for n intervals, and stops at recovery_cap', async () => {
    const { user_id } = await user(env);
    const s = later(1n);
    await put_row(env, user_id, '[stamina]', { amount: 5n, recovery_started_at: s });
    at(s + MINUTE - 1n);
    expect(await balance(env, user_id, '[stamina]')).toBe(5n);
    at(s + MINUTE);
    expect(await balance(env, user_id, '[stamina]')).toBe(6n);
    at(s + MINUTE * 4n);
    expect(await balance(env, user_id, '[stamina]')).toBe(9n);
    at(s + MINUTE * 100n);
    expect(await balance(env, user_id, '[stamina]')).toBe(20n);
  });

  test('at recovery_cap or more it does not grow; add_items goes past recovery_cap up to max_amount', async () => {
    const { user_id } = await user(env);
    await put_row(env, user_id, '[stamina]', { amount: 20n, recovery_started_at: 0n });
    later(MINUTE * 10n);
    expect(await balance(env, user_id, '[stamina]')).toBe(20n);
    expect(await tx(env, user_id, (ctx) => env.ledger.add_items(ctx, items(['[stamina]', 150])))).toBe('OK');
    expect(await balance(env, user_id, '[stamina]')).toBe(170n);
    expect((await row(env, user_id, '[stamina]'))?.recovery_started_at).toBe(0n);
    later(MINUTE * 10n);
    expect(await balance(env, user_id, '[stamina]')).toBe(170n);
    expect(await tx(env, user_id, (ctx) => env.ledger.add_items(ctx, items(['[stamina]', 100])))).toBe('OK');
    expect(await balance(env, user_id, '[stamina]')).toBe(200n);
  });

  test('a stored A over a smaller recovery_cap stays A as time passes', async () => {
    const { user_id } = await user(env);
    await put_row(env, user_id, '[stamina]', { amount: 25n, recovery_started_at: later(1n) });
    later(MINUTE * 30n);
    expect(await balance(env, user_id, '[stamina]')).toBe(25n);
  });

  test('subtracting while recovering keeps the interval; subtracting from the cap to below it starts the interval at that request time', async () => {
    const { user_id } = await user(env);
    const s = later(1n);
    await put_row(env, user_id, '[stamina]', { amount: 10n, recovery_started_at: s });
    at(s + MINUTE + 30_000n);
    expect(await tx(env, user_id, (ctx) => env.ledger.subtract_items(ctx, items(['[stamina]', 1])))).toBe('OK');
    const kept = await row(env, user_id, '[stamina]');
    expect([kept?.amount, kept?.recovery_started_at]).toEqual([10n, s + MINUTE]);
    at(s + MINUTE * 2n);
    expect(await balance(env, user_id, '[stamina]')).toBe(11n);

    const other = await user(env);
    await put_row(env, other.user_id, '[stamina]', { amount: 20n, recovery_started_at: 0n });
    const t = later(12_345n);
    expect(await tx(env, other.user_id, (ctx) => env.ledger.subtract_items(ctx, items(['[stamina]', 5])))).toBe('OK');
    expect((await row(env, other.user_id, '[stamina]'))?.recovery_started_at).toBe(t);
    at(t + MINUTE - 1n);
    expect(await balance(env, other.user_id, '[stamina]')).toBe(15n);
    at(t + MINUTE);
    expect(await balance(env, other.user_id, '[stamina]')).toBe(16n);
  });

  test('recovery leaves a Recovery history row and no item_changes; only recovery sends no delta', async () => {
    const { user_id } = await user(env);
    const s = later(1n);
    await put_row(env, user_id, '[stamina]', { amount: 10n, recovery_started_at: s });
    await flush(env, user_id);
    at(s + MINUTE * 2n);
    const quiet = await flush(env, user_id);
    expect(balance_entries(quiet.user_state)).toEqual([]);
    expect(balance_entries(quiet.pending_user_state)).toEqual([]);
    const r = await request(env, user_id, (ctx) => env.ledger.subtract_items(ctx, items(['[stamina]', 1])));
    expect(change_rows(r.delta.item_changes).map((c) => [c[0], c[1]])).toEqual([[id('[stamina]'), -1n]]);
    expect(history(env, user_id).map((h) => [h.source, h.ref, h.delta, h.balance_after])).toEqual([
      ['ITEM_CHANGE_SOURCE_RECOVERY', '', 2n, 12n], ['ITEM_CHANGE_SOURCE_REQUEST', 'core/Test', -1n, 11n],
    ]);
  });

  test('an operation without a recovering item in its list or Convert grant leaves no recovery record and keeps A and S; a Convert replacement recovery item is reflected', async () => {
    const { user_id } = await user(env);
    const s = later(1n);
    await put_row(env, user_id, '[stamina]', { amount: 10n, recovery_started_at: s });
    at(s + MINUTE * 3n);
    expect(await tx(env, user_id, (ctx) => env.ledger.add_items(ctx, items(['[gold]', 1])))).toBe('OK');
    const same = await row(env, user_id, '[stamina]');
    expect([same?.amount, same?.recovery_started_at]).toEqual([10n, s]);
    expect(history(env, user_id).map((h) => h.source)).toEqual(['ITEM_CHANGE_SOURCE_REQUEST']);

    await set_balance(env, user_id, '[stamina_shard]', 5);
    expect(await tx(env, user_id, (ctx) => env.ledger.add_items(ctx, items(['[stamina_shard]', 2])))).toBe('OK');
    const reflected = await row(env, user_id, '[stamina]');
    expect([reflected?.amount, reflected?.recovery_started_at]).toEqual([15n, s + MINUTE * 3n]);
    expect(history(env, user_id).filter((h) => h.source === 'ITEM_CHANGE_SOURCE_RECOVERY').map((h) => [h.item_id, h.delta])).toEqual([[id('[stamina]'), 3n]]);
  });

  test('without a row the balance is initial_amount; below recovery_cap it recovers from the user creation time; a recovery item at 0 keeps its row', async () => {
    const created = later(1000n);
    const { user_id } = await user(env);
    expect(await balance(env, user_id, '[stamina]')).toBe(20n);
    expect(await balance(env, user_id, '[energy]')).toBe(0n);
    at(created + 300_000n * 2n);
    expect(await balance(env, user_id, '[energy]')).toBe(4n);
    expect(await tx(env, user_id, (ctx) => env.ledger.subtract_items(ctx, items(['[energy]', 4])))).toBe('OK');
    const zero = await row(env, user_id, '[energy]');
    expect(zero?.amount).toBe(0n);
    expect(zero?.recovery_started_at).toBe(created + 300_000n * 2n);
  });

  test('get_recovery gives the time get_balance first grows and the time it reaches recovery_cap', async () => {
    const { user_id } = await user(env);
    const s = later(7n);
    await put_row(env, user_id, '[energy]', { amount: 3n, recovery_started_at: s });
    later(1n);
    const { next_at: next, cap_at: cap } = await tx(env, user_id, (ctx) => env.ledger.get_recovery(ctx, id('[energy]')));
    expect([next, cap]).toEqual([s + 300_000n, s + 300_000n * 4n]);
    at(next - 1n);
    expect(await balance(env, user_id, '[energy]')).toBe(3n);
    at(next);
    expect(await balance(env, user_id, '[energy]')).toBe(5n);
    at(cap - 1n);
    expect(await balance(env, user_id, '[energy]')).toBe(9n);
    at(cap);
    expect(await balance(env, user_id, '[energy]')).toBe(10n);
    expect(await tx(env, user_id, (ctx) => env.ledger.get_recovery(ctx, id('[energy]')))).toEqual({ next_at: 0n, cap_at: 0n });
  });

  test('cap_bonus_item: grows to recovery_cap + the bonus balance; adding bonus at C with S 0 starts recovery at the request time in the same delta; subtracting bonus to at or under the balance stops it', async () => {
    const { user_id } = await user(env);
    await set_balance(env, user_id, '[stamina_bonus]', 10);
    const s = later(1n);
    await put_row(env, user_id, '[stamina]', { amount: 18n, recovery_started_at: s });
    at(s + MINUTE * 11n);
    expect(await balance(env, user_id, '[stamina]')).toBe(29n);
    at(s + MINUTE * 50n);
    expect(await balance(env, user_id, '[stamina]')).toBe(30n);

    const other = await user(env);
    await put_row(env, other.user_id, '[stamina]', { amount: 20n, recovery_started_at: 0n });
    const t = later(5n);
    const r = await request(env, other.user_id, (ctx) => env.ledger.add_items(ctx, items(['[stamina_bonus]', 5])));
    expect(r.out).toBe('OK');
    const sent = balance_entries(r.delta.user_state);
    expect(sent.map(([i]) => i).sort()).toEqual([id('[stamina]'), id('[stamina_bonus]')].sort());
    const stamina = sent.find(([i]) => i === id('[stamina]'))?.[1];
    expect(stamina !== 'deleted' && [stamina?.amount, stamina?.recovery_started_at]).toEqual([20n, t]);
    at(t + MINUTE * 3n);
    expect(await balance(env, other.user_id, '[stamina]')).toBe(23n);

    const third = await user(env);
    await set_balance(env, third.user_id, '[stamina_bonus]', 10);
    const u = later(1n);
    await put_row(env, third.user_id, '[stamina]', { amount: 18n, recovery_started_at: u });
    at(u + MINUTE * 4n);
    expect(await tx(env, third.user_id, (ctx) => env.ledger.subtract_items(ctx, items(['[stamina_bonus]', 10])))).toBe('OK');
    const stopped = await row(env, third.user_id, '[stamina]');
    expect([stopped?.amount, stopped?.recovery_started_at]).toEqual([22n, 0n]);
    later(MINUTE * 10n);
    expect(await balance(env, third.user_id, '[stamina]')).toBe(22n);
  });

  test('core test fixture item-recovery: get_balance and get_recovery', async () => {
    for (const c of fixture('item-recovery') as FixtureCase<RecoveryInput, RecoveryExpected>[]) {
      const { user_id } = await user(env);
      if (c.input.cap_bonus_balance > 0) await set_balance(env, user_id, '[stamina_bonus]', c.input.cap_bonus_balance);
      await put_row(env, user_id, c.input.item, { amount: BigInt(c.input.amount), recovery_started_at: BigInt(c.input.recovery_started_at) });
      // The cases' times are before this file's clock: the clock goes to the case time for the read and comes back.
      const out = await readAt(user_id, c.input.item, BigInt(c.input.time));
      expect(out, c.name).toEqual([BigInt(c.expected.balance), BigInt(c.expected.next_recovery_at), BigInt(c.expected.cap_reached_at)]);
    }
  });
});

/** get_balance and get_recovery at a test clock time; the clock comes back after. */
async function readAt(user_id: bigint, name: string, t: bigint): Promise<bigint[]> {
  const back = now;
  set_time(env, t);
  try {
    return await tx(env, user_id, (ctx) => {
      const times = env.ledger.get_recovery(ctx, id(name));
      return [env.ledger.get_balance(ctx, id(name)), times.next_at, times.cap_at];
    });
  } finally {
    set_time(env, back);
  }
}
