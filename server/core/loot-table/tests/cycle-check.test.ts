/** The substitution cycle check before a roll: it reads no table without a substitution list and keeps its result. */
import type { LootRollOk, LootSubstitution } from '../index.ts';
import { id, loot_server, type LootServer } from './helpers.ts';

let s: LootServer;

beforeAll(async () => {
  // A server of its own, so no loot table rows are read before these tests.
  s = await loot_server({ 'loot-table.maxRollCount': 10 });
});

afterAll(async () => {
  await s.stop();
});

/** The first seed whose first `random_weighted(weights)` is `index`. */
async function seed_picking(weights: readonly number[], index: number): Promise<bigint> {
  for (let seed = 1n; seed <= 100n; seed++) {
    if ((await s.run((ctx) => s.storage.random_weighted(ctx, weights), seed)) === index) return seed;
  }
  throw new Error(`no seed picks ${String(index)} of ${JSON.stringify(weights)}`);
}

describe('cycle check', () => {
  test('a roll without a substitution list reads only the tables it rolls', async () => {
    const nest_w = id('[loot_nest_w]');
    // `[loot_nest_w]` weights are 2 (order 1, rolls `[loot_seed]`) and 1 (order 2): pick order 2.
    const seed = await seed_picking([2, 1], 1);
    const [rolled, read] = await s.run((ctx) => {
      const spy = vi.spyOn(ctx.data.LootTableTable, 'get_rows');
      try {
        return [s.loot.roll(ctx, nest_w, 1), spy.mock.calls.map(([table]) => table)] as const;
      } finally {
        spy.mockRestore();
      }
    }, seed);
    expect((rolled as LootRollOk).results[0]?.tables).toEqual([nest_w]);
    expect(read).toEqual([nest_w]);
  });

  test('a substitution list checked once gives the same result on later rolls', async () => {
    const main = id('[loot_main]');
    const cycle: LootSubstitution[] = [[id('[loot_sub_a]'), id('[loot_sub_b]')]];
    const valid: LootSubstitution[] = [[id('[loot_sub_a]'), id('[loot_sub_d]')]];
    const before = s.error_logs().length;
    const outputs = await s.run((ctx) => [
      s.loot.roll(ctx, main, 1, cycle),
      s.loot.roll(ctx, main, 1, cycle),
      s.loot.get_rates(ctx, main, cycle),
      typeof s.loot.roll(ctx, main, 1, valid),
      typeof s.loot.roll(ctx, main, 1, valid),
    ]);
    expect(outputs).toEqual(['INVALID_INPUT', 'INVALID_INPUT', [], 'object', 'object']);
    const logs = s.error_logs().slice(before);
    expect(logs.map((l) => l.message)).toEqual(Array(3).fill('substitution list makes a cycle'));
    // The same pairs on another first table are another check: `[loot_sub_b]` itself rolls `[loot_sub_a]` → `[loot_sub_b]`.
    expect(await s.run((ctx) => s.loot.roll(ctx, id('[loot_sub_c]'), 1, cycle))).not.toBe('INVALID_INPUT');
    expect(await s.run((ctx) => s.loot.roll(ctx, id('[loot_sub_b]'), 1, cycle))).toBe('INVALID_INPUT');
  });
});
