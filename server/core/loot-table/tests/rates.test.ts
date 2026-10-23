/** `get_rates` and `GetLootRates`: paths and probabilities from the data that `roll` uses. */
import * as CoreContract from '../../../generated/contract/core_contract.ts';
import { send } from '../../testing/dev/index.ts';
import { amounts, id, loot_server, path_key, replay, type LootServer } from './helpers.ts';

const N = 100_000;

let s: LootServer;

beforeAll(async () => {
  s = await loot_server({ 'loot-table.maxRollCount': N });
});

afterAll(async () => {
  await s.stop();
});

/** `a/b + c/d` without reducing. */
function add([a, b]: [bigint, bigint], [c, d]: [bigint, bigint]): [bigint, bigint] {
  return [a * d + c * b, b * d];
}

function rows(rates: readonly CoreContract.LootRate[]): [string, [number, bigint][], bigint, bigint][] {
  return rates.map((r) => [path_key(r.path), amounts(r.items), r.numerator, r.denominator]);
}

function key(...steps: [string, number][]): string {
  return path_key(steps.map(([name, order]) => ({ table_id: id(name), order })));
}

describe('get_rates', () => {
  test('paths in depth-first roll order with their items and unreduced probabilities', async () => {
    const rates = await s.run((ctx) => s.loot.get_rates(ctx, id('[loot_main]')));
    const gold = id('[loot_gold]');
    const gem = id('[loot_gem]');
    expect(rows(rates)).toEqual([
      [key(['[loot_main]', 1]), [[gem, 1n]], 1n, 1n],
      [key(['[loot_main]', 1], ['[loot_sub_a]', 1]), [[gold, 1n]], 1n, 4n],
      [key(['[loot_main]', 1], ['[loot_sub_a]', 2]), [[gem, 2n]], 3n, 4n],
      [key(['[loot_main]', 4]), [[gold, 5n]], 1n, 1n],
      [key(['[loot_main]', 2]), [[gold, 10n]], 1n, 4n],
      [key(['[loot_main]', 3]), [], 1n, 4n],
      [key(['[loot_main]', 3], ['[loot_sub_b]', 1]), [[gem, 3n]], 1n, 4n],
      [key(['[loot_main]', 3], ['[loot_sub_b]', 2]), [[gold, 7n]], 1n, 4n],
      [key(['[loot_main]', 3], ['[loot_sub_b]', 2], ['[loot_sub_a]', 1]), [[gold, 1n]], 1n, 16n],
      [key(['[loot_main]', 3], ['[loot_sub_b]', 2], ['[loot_sub_a]', 2]), [[gem, 2n]], 3n, 16n],
      [key(['[loot_main]', 5]), [], 2n, 4n],
    ]);
  });

  test('paths are in order ascending whatever the row order of the data', async () => {
    const rates = await s.run((ctx) => s.loot.get_rates(ctx, id('[loot_unsorted]')));
    const gold = id('[loot_gold]');
    expect(rows(rates)).toEqual([
      [key(['[loot_unsorted]', 1]), [[id('[loot_gem]'), 1n]], 1n, 1n],
      [key(['[loot_unsorted]', 4]), [[gold, 4n]], 1n, 1n],
      [key(['[loot_unsorted]', 2]), [[gold, 2n]], 1n, 4n],
      [key(['[loot_unsorted]', 3]), [[gold, 3n]], 3n, 4n],
    ]);
  });

  test(`path counts of ${String(N)} seeded rolls are within 2√N of the probability × N`, async () => {
    const main = id('[loot_main]');
    const [rolled, rates] = await s.run((ctx) => [s.loot.roll(ctx, main, N), s.loot.get_rates(ctx, main)] as const, 20240601n);
    if (typeof rolled === 'string') throw new Error(`roll failed with ${rolled}`);
    const counts = new Map<string, number>();
    for (const result of rolled.results) for (const k of replay(main, result)) counts.set(k, (counts.get(k) ?? 0) + 1);
    const expected = new Map(rates.map((r) => [path_key(r.path), (N * Number(r.numerator)) / Number(r.denominator)]));
    expect([...counts.keys()].filter((k) => !expected.has(k))).toEqual([]);
    for (const [k, e] of expected) expect(Math.abs((counts.get(k) ?? 0) - e)).toBeLessThanOrEqual(2 * Math.sqrt(N));
  });

  test('without Guaranteed entries the probabilities of the ending paths add up to 1', async () => {
    const flat = await s.run((ctx) => s.loot.get_rates(ctx, id('[loot_seed]')));
    expect(flat).toHaveLength(3);
    const [n1, d1] = flat.reduce<[bigint, bigint]>((sum, r) => add(sum, [r.numerator, r.denominator]), [0n, 1n]);
    expect(n1).toBe(d1);
    // `[loot_nest_w]` entry 1 goes on to `[loot_seed]`; the paths that end at an entry without `table` add up to 1.
    const nested = await s.run((ctx) => s.loot.get_rates(ctx, id('[loot_nest_w]')));
    const ending = nested.filter((r) => {
      const last = r.path[r.path.length - 1];
      return last !== undefined && !(last.table_id === id('[loot_nest_w]') && last.order === 1);
    });
    const [n2, d2] = ending.reduce<[bigint, bigint]>((sum, r) => add(sum, [r.numerator, r.denominator]), [0n, 1n]);
    expect(n2).toBe(d2);
  });

  test('a substitution list computes the to table', async () => {
    const rates = await s.run((ctx) => s.loot.get_rates(ctx, id('[loot_nest_w]'), [[id('[loot_seed]'), id('[loot_sub_a]')]]));
    expect(rows(rates)).toEqual([
      [key(['[loot_nest_w]', 1]), [], 2n, 3n],
      [key(['[loot_nest_w]', 1], ['[loot_sub_a]', 1]), [[id('[loot_gold]'), 1n]], 2n, 12n],
      [key(['[loot_nest_w]', 1], ['[loot_sub_a]', 2]), [[id('[loot_gem]'), 2n]], 6n, 12n],
      [key(['[loot_nest_w]', 2]), [[id('[loot_gem]'), 1n]], 1n, 3n],
    ]);
    // The first table is substituted too.
    const first = await s.run((ctx) => s.loot.get_rates(ctx, id('[loot_seed]'), [[id('[loot_seed]'), id('[loot_sub_c]')]]));
    expect(rows(first)).toEqual([[key(['[loot_sub_c]', 1]), [[id('[loot_gold]'), 100n]], 1n, 1n]]);
  });

  test('an unknown table and an INVALID_INPUT substitution list give an empty list and an error log', async () => {
    const before = s.error_logs().length;
    const sub_a = id('[loot_sub_a]');
    const outputs = await s.run((ctx) => [
      s.loot.get_rates(ctx, id('[loot_gold]')),
      s.loot.get_rates(ctx, id('[loot_main]'), [[sub_a, id('[loot_sub_c]')], [sub_a, id('[loot_sub_d]')]]),
      s.loot.get_rates(ctx, id('[loot_main]'), [[sub_a, id('[loot_sub_b]')]]),
    ]);
    expect(outputs).toEqual([[], [], []]);
    expect(s.error_logs().length - before).toBe(3);
  });
});

describe('GetLootRates', () => {
  test('a public loot table gets the get_rates paths, items and probabilities in the same order', async () => {
    const main = id('[loot_main]');
    const request = new CoreContract.GetLootRatesRequest();
    request.loot_table_id = main;
    const { envelope, response } = await send(s.session, 'core/GetLootRates', request);
    expect(envelope.error).toBeNull();
    const rates = await s.run((ctx) => s.loot.get_rates(ctx, main));
    const got = (response as CoreContract.GetLootRatesResponse).rates;
    expect(got.map((r) => Buffer.from(r.encode()).toString('hex'))).toEqual(rates.map((r) => Buffer.from(r.encode()).toString('hex')));
    expect(got).toHaveLength(11);
  });

  test('a loot table that is not public is INVALID_REQUEST', async () => {
    const request = new CoreContract.GetLootRatesRequest();
    request.loot_table_id = id('[loot_seed]');
    const { envelope, response } = await send(s.session, 'core/GetLootRates', request);
    expect(envelope.error?.code).toBe(CoreContract.CoreError.CORE_ERROR_INVALID_REQUEST);
    expect(response).toBeNull();
  });

  test('the handler itself returns INVALID_REQUEST for a loot table that is not public', async () => {
    const request = new CoreContract.GetLootRatesRequest();
    request.loot_table_id = id('[loot_seed]');
    const result = await s.run((ctx) => s.loot.GetLootRates(ctx, request));
    expect(result).toBe(CoreContract.CoreError.CORE_ERROR_INVALID_REQUEST);
  });
});
