/** `sum_items`: merged items by item ID value ascending, and the amount limit of big and other items. */
import { amounts, id, item, loot_server, result_of, type LootServer } from './helpers.ts';

const MAX_SAFE = 2n ** 53n - 1n;
/** `[loot_big]` has `max_digits` 20 in the core test data. */
const BIG_LIMIT = 10n ** 20n - 1n;

let s: LootServer;

beforeAll(async () => {
  s = await loot_server();
});

afterAll(async () => {
  await s.stop();
});

describe('sum_items', () => {
  test('the same item is merged, by item ID value ascending', () => {
    const [gold, gem, big] = [id('[loot_gold]'), id('[loot_gem]'), id('[loot_big]')];
    const summed = s.loot.sum_items([
      result_of([item(gem, 2n), item(gold, 1n)]),
      result_of([]),
      result_of([item(big, 4n), item(gold, 10n)]),
      result_of([item(gem, 3n)]),
    ]);
    if (typeof summed === 'string') throw new Error(summed);
    const expected = new Map([[gold, 11n], [gem, 5n], [big, 4n]]);
    expect(amounts(summed)).toEqual([...expected].sort((a, b) => a[0] - b[0]));
    expect(s.loot.sum_items([])).toEqual([]);
  });

  test('a big item sum over 2^53-1 up to its amount limit is that sum, and over the limit is AMOUNT_OVERFLOW', () => {
    const big = id('[loot_big]');
    const over_safe = s.loot.sum_items([result_of([item(big, MAX_SAFE)]), result_of([item(big, MAX_SAFE)]), result_of([item(big, 2n)])]);
    if (typeof over_safe === 'string') throw new Error(over_safe);
    expect(amounts(over_safe)).toEqual([[big, 2n ** 54n]]);
    expect(over_safe[0]?.amount).toBe(0n);
    expect(over_safe[0]?.big_amount).toBe((2n ** 54n).toString());
    const at_limit = s.loot.sum_items([result_of([item(big, BIG_LIMIT - 1n)]), result_of([item(big, 1n)])]);
    if (typeof at_limit === 'string') throw new Error(at_limit);
    expect(amounts(at_limit)).toEqual([[big, BIG_LIMIT]]);
    const before = s.error_logs().length;
    expect(s.loot.sum_items([result_of([item(big, BIG_LIMIT)]), result_of([item(big, 1n)])])).toBe('AMOUNT_OVERFLOW');
    expect(s.error_logs().length - before).toBe(1);
  });

  test('a sum over 2^53-1 of an item that is not big is AMOUNT_OVERFLOW, and 2^53-1 is not', () => {
    const gold = id('[loot_gold]');
    const at_limit = s.loot.sum_items([result_of([item(gold, MAX_SAFE - 1n)]), result_of([item(gold, 1n)])]);
    if (typeof at_limit === 'string') throw new Error(at_limit);
    expect(amounts(at_limit)).toEqual([[gold, MAX_SAFE]]);
    expect(at_limit[0]?.big_amount).toBe('');
    const before = s.error_logs().length;
    expect(s.loot.sum_items([result_of([item(gold, MAX_SAFE)]), result_of([item(gold, 1n)])])).toBe('AMOUNT_OVERFLOW');
    expect(s.error_logs().length - before).toBe(1);
  });

  test('an item ID value with no item row has the item-ledger amount limit 0, so its sum is AMOUNT_OVERFLOW', () => {
    // `[loot_main]` is a loot table ID name, so its ID value has no `item` row.
    const unknown = id('[loot_main]');
    const gold = id('[loot_gold]');
    const before = s.error_logs().length;
    expect(s.loot.sum_items([result_of([item(gold, 1n), item(unknown, 5n)])])).toBe('AMOUNT_OVERFLOW');
    expect(s.error_logs().length - before).toBe(1);
  });

  test('sum_items of roll results is the sum of their items', async () => {
    const main = id('[loot_main]');
    const rolled = await s.run((ctx) => s.loot.roll(ctx, main, 10), 5n);
    if (typeof rolled === 'string') throw new Error(rolled);
    const summed = s.loot.sum_items(rolled.results);
    if (typeof summed === 'string') throw new Error(summed);
    const expected = new Map<number, bigint>();
    for (const r of rolled.results) for (const [k, v] of amounts(r.items)) expected.set(k, (expected.get(k) ?? 0n) + v);
    expect(amounts(summed)).toEqual([...expected].sort((a, b) => a[0] - b[0]));
  });
});
