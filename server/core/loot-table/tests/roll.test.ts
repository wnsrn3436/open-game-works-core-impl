/** `roll`: seeded results, roll order, nested tables, substitution lists, and the failures that use no random. */
import type { LootRollFailure, LootRollOk, LootSubstitution } from '../index.ts';
import { amounts, data, id, loot_server, replay, type LootServer } from './helpers.ts';

/** `UtilCore` test vector: the first `next_uint32` of `create_random(42)`. */
const FIRST_U32_OF_42 = 565663470;

let s: LootServer;

beforeAll(async () => {
  s = await loot_server({ 'loot-table.maxRollCount': 1000 });
});

afterAll(async () => {
  await s.stop();
});

function ok(result: LootRollOk | LootRollFailure): LootRollOk {
  if (typeof result === 'string') throw new Error(`roll failed with ${result}`);
  return result;
}

describe('roll', () => {
  test('two requests with the same seed roll the same, and seed 42 matches the UtilCore test vector', async () => {
    const seed_table = id('[loot_seed]');
    const first = ok(await s.run((ctx) => s.loot.roll(ctx, seed_table, 10), 42n));
    const second = ok(await s.run((ctx) => s.loot.roll(ctx, seed_table, 10), 42n));
    expect(second).toEqual(first);
    // `[loot_seed]` weights are 1, 3, 6: the same picks as `pick_weighted([1, 0, 3, 6])` (sum 10) of the vector,
    // `0, 3, 3, 3, 3, 3, 3, 0, 3, 2`, which are orders 1, 3, 3, 3, 3, 3, 3, 1, 3, 2. Order k gives k `[loot_gold]`.
    const orders = [1, 3, 3, 3, 3, 3, 3, 1, 3, 2];
    expect(first.results.map((r) => r.entries.map((e) => [e.table_id, e.order]))).toEqual(orders.map((o) => [[seed_table, o]]));
    expect(first.results.map((r) => amounts(r.items))).toEqual(orders.map((o) => [[id('[loot_gold]'), BigInt(o)]]));
    expect(first.results.map((r) => r.tables)).toEqual(orders.map(() => [seed_table]));
  });

  test('every Guaranteed entry is picked each roll and exactly one Weighted entry', async () => {
    const main = id('[loot_main]');
    const rolled = ok(await s.run((ctx) => s.loot.roll(ctx, main, 200), 11n));
    expect(rolled.results).toHaveLength(200);
    for (const result of rolled.results) {
      const top = result.entries.filter((e) => e.table_id === main).map((e) => e.order);
      expect(top.filter((o) => o === 1 || o === 4)).toEqual([1, 4]);
      expect(top.filter((o) => o === 2 || o === 3 || o === 5)).toHaveLength(1);
    }
  });

  test('nested tables are rolled and tables and entries follow the roll order', async () => {
    const main = id('[loot_main]');
    const rolled = ok(await s.run((ctx) => s.loot.roll(ctx, main, 200), 12n));
    const sub_b = id('[loot_sub_b]');
    let reached_sub_b = 0;
    for (const result of rolled.results) {
      replay(main, result);
      if (result.tables.includes(sub_b)) reached_sub_b++;
    }
    expect(reached_sub_b).toBeGreaterThan(0);
    // The items of a result are one sum per item, by item ID value ascending.
    for (const result of rolled.results) {
      const ids = result.items.map((i) => i.item_id);
      expect(ids).toEqual([...ids].sort((a, b) => a - b));
      expect(new Set(ids).size).toBe(ids.length);
    }
    const one = ok(await s.run((ctx) => s.loot.roll(ctx, id('[loot_sub_b]'), 1), 1n)).results[0];
    // `[loot_sub_b]`: Guaranteed 1 (3 gem), then Weighted 2 (7 gold) with its nested `[loot_sub_a]`.
    expect(one?.tables.slice(0, 2)).toEqual([sub_b, id('[loot_sub_a]')]);
    expect(one?.entries.slice(0, 2).map((e) => [e.table_id, e.order])).toEqual([[sub_b, 1], [sub_b, 2]]);
  });

  test('entries are picked by order ascending whatever the row order of the data', async () => {
    const unsorted = id('[loot_unsorted]');
    // The build keeps the file row order, so only loot-table orders these rows.
    expect(data.LootTableTable.get_rows(unsorted).map((r) => r.order)).toEqual([4, 3, 1, 2]);
    const rolled = ok(await s.run((ctx) => s.loot.roll(ctx, unsorted, 50), 21n));
    // The Weighted weights by order are 1 (order 2) and 3 (order 3), so the same seed picks as `random_weighted([1, 3])`.
    const picks = await s.run((ctx) => Array.from({ length: 50 }, () => s.storage.random_weighted(ctx, [1, 3])), 21n);
    const orders = picks.map((i) => [2, 3][i] as number);
    expect(new Set(orders)).toEqual(new Set([2, 3]));
    expect(rolled.results.map((r) => r.entries.map((e) => [e.table_id, e.order]))).toEqual(orders.map((o) => [[unsorted, 1], [unsorted, 4], [unsorted, o]]));
    expect(rolled.results.map((r) => r.tables)).toEqual(orders.map(() => [unsorted]));
    const gem = id('[loot_gem]');
    const gold = id('[loot_gold]');
    expect(rolled.results.map((r) => amounts(r.items))).toEqual(
      orders.map((o) => ([[gem, 1n], [gold, BigInt(4 + o)]] as [number, bigint][]).sort((a, b) => a[0] - b[0])),
    );
  });

  test('a substitution list rolls the to table in place of the from table, and not again on the to table', async () => {
    const main = id('[loot_main]');
    const sub_a = id('[loot_sub_a]');
    const sub_c = id('[loot_sub_c]');
    const sub_d = id('[loot_sub_d]');
    const subs: LootSubstitution[] = [[sub_a, sub_d], [sub_d, sub_c]];
    const rolled = ok(await s.run((ctx) => s.loot.roll(ctx, main, 100, subs), 13n));
    for (const result of rolled.results) {
      replay(main, result, [[sub_a, sub_d]]);
      expect(result.tables).toContain(sub_d);
      expect(result.tables).not.toContain(sub_a);
      expect(result.tables).not.toContain(sub_c);
    }
    // The first table is substituted too.
    const first = ok(await s.run((ctx) => s.loot.roll(ctx, sub_a, 1, [[sub_a, sub_c]]), 14n)).results[0];
    expect(first?.tables).toEqual([sub_c]);
    expect(first?.entries.map((e) => [e.table_id, e.order])).toEqual([[sub_c, 1]]);
    expect(amounts(first?.items ?? [])).toEqual([[id('[loot_gold]'), 100n]]);
  });

  test('an item sum of one LootResult over the amount limit is AMOUNT_OVERFLOW; a big item sum up to its limit is not', async () => {
    const big = ok(await s.run((ctx) => s.loot.roll(ctx, id('[loot_big_sum]'), 1), 1n)).results[0];
    expect(amounts(big?.items ?? [])).toEqual([[id('[loot_big]'), 2n * (2n ** 53n - 1n)]]);
    expect(big?.items[0]?.amount).toBe(0n);
    expect(big?.items[0]?.big_amount).toBe('18014398509481982');
    const before = s.error_logs().length;
    expect(await s.run((ctx) => s.loot.roll(ctx, id('[loot_over]'), 1), 1n)).toBe('AMOUNT_OVERFLOW');
    expect(await s.run((ctx) => s.loot.roll(ctx, id('[loot_big_over]'), 1), 1n)).toBe('AMOUNT_OVERFLOW');
    expect(s.error_logs().length - before).toBe(2);
  });
});

describe('roll failures', () => {
  const sub_a = (): number => id('[loot_sub_a]');
  const sub_b = (): number => id('[loot_sub_b]');
  const cases: [string, LootRollFailure, () => [number, number, LootSubstitution[] | undefined]][] = [
    ['an ID value that is no loot table', 'UNKNOWN_TABLE', () => [id('[loot_gold]'), 1, undefined]],
    ['ID value 0', 'UNKNOWN_TABLE', () => [0, 1, undefined]],
    ['a substitution to table that is no loot table', 'UNKNOWN_TABLE', () => [id('[loot_main]'), 1, [[sub_a(), id('[loot_gem]')]]]],
    ['a substitution from table that is no loot table', 'UNKNOWN_TABLE', () => [id('[loot_main]'), 1, [[id('[loot_gem]'), sub_a()]]]],
    ['count 0', 'INVALID_COUNT', () => [id('[loot_main]'), 0, undefined]],
    ['count -1', 'INVALID_COUNT', () => [id('[loot_main]'), -1, undefined]],
    ['count 1.5', 'INVALID_COUNT', () => [id('[loot_main]'), 1.5, undefined]],
    ['count over loot-table.maxRollCount', 'INVALID_COUNT', () => [id('[loot_main]'), 1001, undefined]],
    ['the same from table twice', 'INVALID_INPUT', () => [id('[loot_main]'), 1, [[sub_a(), id('[loot_sub_c]')], [sub_a(), id('[loot_sub_d]')]]]],
    // `[loot_sub_b]` entry 2 rolls `[loot_sub_a]`, which the list turns back into `[loot_sub_b]`.
    ['a substitution that comes back to the from table under the to table', 'INVALID_INPUT', () => [id('[loot_main]'), 1, [[sub_a(), sub_b()]]]],
    ['a substitution cycle from the first table', 'INVALID_INPUT', () => [sub_a(), 1, [[sub_a(), sub_b()]]]],
  ];

  for (const [name, failure, input] of cases) {
    test(`${name} is ${failure} with an error log and no random`, async () => {
      const [table, count, subs] = input();
      const before = s.error_logs().length;
      const [result, next] = await s.run((ctx) => [s.loot.roll(ctx, table, count, subs), s.storage.random_u32(ctx)] as const, 42n);
      expect(result).toBe(failure);
      expect(next).toBe(FIRST_U32_OF_42);
      const logs = s.error_logs().slice(before);
      expect(logs).toHaveLength(1);
      expect(logs[0]?.kind).toBe('error');
      expect(logs[0]?.level).toBe('error');
      expect(logs[0]?.request).toBe('RunCoreTest');
    });
  }

  test('a count of loot-table.maxRollCount rolls', async () => {
    const rolled = ok(await s.run((ctx) => s.loot.roll(ctx, id('[loot_seed]'), 1000), 3n));
    expect(rolled.results).toHaveLength(1000);
  });
});
