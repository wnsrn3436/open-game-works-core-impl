import type { ItemBalanceChange } from '../index.ts';
import { change_rows, fixture, history, id, items, put_row, request, row, set_time, Source, start, stop, tx, user, type Env } from './helpers.ts';
import type { FixtureCase } from './helpers.ts';

const HOUR = 3_600_000n;
const T0 = 50_000_000_000n;

let env: Env;

beforeAll(async () => {
  env = await start({ start_at: T0 });
});

afterAll(() => {
  stop();
});

afterEach(() => {
  env.hooks.validate = null;
  env.hooks.after = null;
});

async function read(user_id: bigint, name: string): Promise<[bigint, bigint]> {
  return tx(env, user_id, (ctx) => [env.ledger.get_balance(ctx, id(name)), env.ledger.get_ends_at(ctx, id(name))]);
}

/** A case of core test fixture `item-timed`: `ends_at` 0 is no row. */
interface TimedInput {
  readonly item: string;
  readonly ends_at: number;
  readonly time: number;
  readonly amount: number;
}

interface TimedExpected {
  readonly result: string;
  readonly ends_at: number;
  readonly delta: number;
  readonly overflow: number;
}

describe('timed item', () => {
  test('adding during the effect extends the end by n × duration; after the effect it ends at request time + n × duration; get_balance and get_ends_at around the end', async () => {
    const { user_id } = await user(env);
    set_time(env, T0);
    expect(await tx(env, user_id, (ctx) => env.ledger.add_items(ctx, items(['[boost_reject]', 1])))).toBe('OK');
    const end = T0 + HOUR;
    expect(await read(user_id, '[boost_reject]')).toEqual([1n, end]);
    set_time(env, T0 + 1000n);
    expect(await tx(env, user_id, (ctx) => env.ledger.add_items(ctx, items(['[boost_reject]', 1])))).toBe('OK');
    expect(await read(user_id, '[boost_reject]')).toEqual([1n, end + HOUR]);
    set_time(env, end + HOUR - 1n);
    expect(await read(user_id, '[boost_reject]')).toEqual([1n, end + HOUR]);
    set_time(env, end + HOUR);
    expect(await read(user_id, '[boost_reject]')).toEqual([0n, 0n]);
    const t = end + HOUR + 5000n;
    set_time(env, t);
    expect(await tx(env, user_id, (ctx) => env.ledger.add_items(ctx, items(['[boost_reject]', 2])))).toBe('OK');
    expect(await read(user_id, '[boost_reject]')).toEqual([1n, t + 2n * HOUR]);
    expect(history(env, user_id).at(-1)?.ends_at_after).toBe(t + 2n * HOUR);
  });

  test('past max_amount × duration: Reject is LIMIT_EXCEEDED, Discard adds what fits and records the rest as overflow; subtracting is UNSUPPORTED_ITEM', async () => {
    const { user_id } = await user(env);
    set_time(env, T0);
    await put_row(env, user_id, '[boost_reject]', { ends_at: T0 + 2n * HOUR });
    expect(await tx(env, user_id, (ctx) => env.ledger.add_items(ctx, items(['[boost_reject]', 2])))).toBe('LIMIT_EXCEEDED');
    expect(await read(user_id, '[boost_reject]')).toEqual([1n, T0 + 2n * HOUR]);
    await put_row(env, user_id, '[boost_discard]', { ends_at: T0 + HOUR + HOUR / 2n });
    const r = await request(env, user_id, (ctx) => env.ledger.add_items(ctx, items(['[boost_discard]', 3])));
    expect(change_rows(r.delta.item_changes).map((c) => [c[0], c[1], c[2]])).toEqual([[id('[boost_discard]'), 1n, 2n]]);
    expect(await read(user_id, '[boost_discard]')).toEqual([1n, T0 + 2n * HOUR + HOUR / 2n]);
    expect(await tx(env, user_id, (ctx) => env.ledger.subtract_items(ctx, items(['[boost_discard]', 1])))).toBe('UNSUPPORTED_ITEM');
    expect(await tx(env, user_id, (ctx) => env.ledger.exchange_items(ctx, items(['[boost_discard]', 1]), items(['[gold]', 1])))).toBe('UNSUPPORTED_ITEM');
  });

  test('revoke_items shortens the remaining time and returns the amount past it as shortfall', async () => {
    const { user_id } = await user(env);
    set_time(env, T0);
    await put_row(env, user_id, '[boost_reject]', { ends_at: T0 + HOUR + HOUR / 2n });
    expect(await tx(env, user_id, (ctx) => env.ledger.revoke_items(ctx, items(['[boost_reject]', 1])))).toEqual([{ item_id: id('[boost_reject]'), shortfall: 0n }]);
    expect(await read(user_id, '[boost_reject]')).toEqual([1n, T0 + HOUR / 2n]);
    expect(await tx(env, user_id, (ctx) => env.ledger.revoke_items(ctx, items(['[boost_reject]', 3])))).toEqual([{ item_id: id('[boost_reject]'), shortfall: 2n }]);
    expect(await read(user_id, '[boost_reject]')).toEqual([0n, 0n]);
    expect(await row(env, user_id, '[boost_reject]')).toBeNull();
    expect(history(env, user_id).slice(-2).map((h) => [h.delta, h.shortfall])).toEqual([[-1n, 0n], [-1n, 2n]]);
  });

  test('core test fixture item-timed: add_items and preview_add_items', async () => {
    for (const c of fixture('item-timed') as FixtureCase<TimedInput, TimedExpected>[]) {
      for (const mode of ['preview', 'add'] as const) {
        const { user_id } = await user(env);
        if (c.input.ends_at !== 0) await put_row(env, user_id, c.input.item, { ends_at: BigInt(c.input.ends_at) });
        set_time(env, BigInt(c.input.time));
        try {
          const list = items([c.input.item, c.input.amount]);
          if (mode === 'preview') {
            const rows = await tx(env, user_id, (ctx) => env.ledger.preview_add_items(ctx, list));
            const e = c.expected;
            const expected = e.result === 'LIMIT_EXCEEDED'
              ? { item_id: id(c.input.item), outcome: 'Mailed', applied: 0n, overflow: 0n, replacements: [] }
              : { item_id: id(c.input.item), outcome: e.overflow > 0 ? 'Discarded' : 'Applied', applied: BigInt(e.delta), overflow: BigInt(e.overflow), replacements: [] };
            expect(rows, `${c.name} preview`).toEqual([expected]);
          } else {
            const r = await request(env, user_id, (ctx) => env.ledger.add_items(ctx, list));
            expect(r.out, c.name).toBe(c.expected.result);
            const stored = await row(env, user_id, c.input.item);
            expect(stored?.ends_at ?? 0n, c.name).toBe(BigInt(c.expected.ends_at));
            if (c.expected.result === 'OK') expect(change_rows(r.delta.item_changes).map((x) => [x[1], x[2]]), c.name).toEqual([[BigInt(c.expected.delta), BigInt(c.expected.overflow)]]);
          }
        } finally {
          set_time(env, T0);
        }
      }
    }
  });

  test('in the validate_item_change and after_item_change lists a timed item has the remaining ms before and after', async () => {
    const t = T0 + 1000n * HOUR;
    set_time(env, t);
    const { user_id } = await user(env);
    const seen: [string, readonly ItemBalanceChange[]][] = [];
    env.hooks.validate = (_ctx, _source, list) => {
      seen.push(['validate', list]);
      return 'pass';
    };
    env.hooks.after = (_ctx, _source, list) => {
      seen.push(['after', list]);
      return null;
    };
    expect(await tx(env, user_id, (ctx) => env.ledger.add_items(ctx, items(['[boost_reject]', 2])))).toBe('OK');
    set_time(env, t + HOUR / 2n);
    expect(await tx(env, user_id, (ctx) => env.module.revoke_items(ctx, items(['[boost_reject]', 1]), { source: Source.ITEM_CHANGE_SOURCE_ADMIN, ref: 'revoke_items' }))).toEqual([
      { item_id: id('[boost_reject]'), shortfall: 0n },
    ]);
    const item_id = id('[boost_reject]');
    expect(seen).toEqual([
      ['validate', [{ item_id, before: 0n, after: 2n * HOUR }]],
      ['after', [{ item_id, before: 0n, after: 2n * HOUR }]],
      ['after', [{ item_id, before: HOUR * 3n / 2n, after: HOUR / 2n }]],
    ]);
  });
});
