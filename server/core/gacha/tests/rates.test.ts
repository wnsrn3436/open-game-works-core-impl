import * as CoreContract from '../../../generated/contract/core_contract.ts';
import { send } from '../../testing/dev/index.ts';
import type { RequestCtx } from '../../storage/index.ts';
import { pick_table, substitutions_of } from '../draw.ts';
import type { GachaLootTable } from '../index.ts';
import { MULTI_GUARANTEE, NORMAL, PITY, amounts, draw_request, error_code, id, login, start, stop_all, type Core } from './helpers.ts';

afterEach(async () => {
  await stop_all();
});

type Substitution = readonly [number, number];
type GetRates = (ctx: unknown, table: number, substitutions?: readonly Substitution[]) => readonly CoreContract.LootRate[];

async function rates(session: Parameters<typeof send>[0], banner: string): Promise<CoreContract.GetGachaRatesResponse> {
  const request = new CoreContract.GetGachaRatesRequest();
  request.banner_id = id(banner);
  const result = await send(session, 'core/GetGachaRates', request);
  expect(error_code(result)).toBe(0);
  return result.response as CoreContract.GetGachaRatesResponse;
}

/**
 * `(item ID value, amount)` lists of n rolls of the roll path a `SINGLE` `DrawGacha` of a banner without pity takes in
 * `roll_draws` (draw order 6): `loot-table.roll` of count 1 on the `pick_table` table with the `substitutions_of` list.
 * Without pity the pity state stays `(count, false)`, so the table and the list are the same for every draw.
 */
function single_rolls(ctx: RequestCtx, core: Core, banner_name: string, n: number): [number, bigint][][] {
  const loot = core['loot-table'] as unknown as GachaLootTable;
  const banner = ctx.data.GachaBannerTable.get_row(id(banner_name));
  if (banner.pity_count !== 0) throw new Error(`${banner_name} has pity`);
  const { table } = pick_table(banner, false, 1, 1, 0, false);
  const substitutions = substitutions_of(banner, false);
  const out: [number, bigint][][] = [];
  for (let i = 0; i < n; i += 1) {
    const roll = loot.roll(ctx, table, 1, substitutions);
    if (typeof roll === 'string') throw new Error(`loot-table.roll failed with ${roll}`);
    if (roll.results.length !== 1) throw new Error(`loot-table.roll gave ${String(roll.results.length)} results`);
    out.push(amounts(roll.results[0]?.items ?? []));
  }
  return out;
}

/** `[kind, rate_up_guaranteed, [items, numerator, denominator, rate_up] per rate]` of a section list. */
function shape(sections: readonly CoreContract.GachaRateSection[]): unknown[] {
  return sections.map((s) => [s.kind, s.rate_up_guaranteed, s.rates.map((r) => [amounts(r.items), r.numerator, r.denominator, r.rate_up])]);
}

describe('GetGachaRates', () => {
  it('its sections are loot-table.get_rates of the same data, with the substitution list in the rate_up_guaranteed sections', async () => {
    const started = await start();
    const session = await login(started.server, 'rates');
    const core: Core = started.core();
    const get_rates = core['loot-table']?.get_rates as unknown as GetRates;
    const rate_up_table = id('[gacha_lt_rate_up]');
    const subs: Substitution[] = [[id('[gacha_lt_pity]'), rate_up_table]];
    const expected = await started.run(session, (ctx) => {
      const section = (kind: CoreContract.GachaDrawKind, guaranteed: boolean, table: string): unknown => [
        kind,
        guaranteed,
        get_rates(ctx, id(table), guaranteed ? subs : undefined).map((r) => [amounts(r.items), r.numerator, r.denominator, r.path.some((p) => p.table_id === rate_up_table)]),
      ];
      return [
        section(NORMAL, false, '[gacha_lt_normal]'),
        section(NORMAL, true, '[gacha_lt_normal]'),
        section(PITY, false, '[gacha_lt_pity]'),
        section(PITY, true, '[gacha_lt_pity]'),
        section(MULTI_GUARANTEE, false, '[gacha_lt_multi]'),
        section(MULTI_GUARANTEE, true, '[gacha_lt_multi]'),
      ];
    });
    const main = await rates(session, '[gacha_banner_main]');
    expect(shape(main.sections)).toEqual(expected);
    expect([main.pity_count, main.rate_up_guarantee, main.multi_count]).toEqual([3, true, 10]);
    // the rate_up_guaranteed PITY section rolls rate_up_table in place of pity_table: one path, rate 1/1
    expect(shape([main.sections[3] as CoreContract.GachaRateSection])).toEqual([[PITY, true, [[[[id('[gacha_hero_a]'), 1n]], 1n, 1n, true]]]]);

    // the plain banner's only section follows its loot_table rows: weights 1, 3, 6
    const plain = await rates(session, '[gacha_banner_plain]');
    expect(shape(plain.sections)).toEqual([
      [NORMAL, false, [
        [[[id('[gacha_star]'), 1n]], 1n, 10n, false],
        [[[id('[gacha_star2]'), 1n]], 3n, 10n, false],
        [[[id('[gacha_star3]'), 1n]], 6n, 10n, false],
      ]],
    ]);
    expect([plain.pity_count, plain.rate_up_guarantee, plain.multi_count]).toEqual([0, false, 0]);
  });

  it(
    'with a fixed seed, the counts of N = 100000 rolls of the draw roll path of a banner without pity are within 2√N of the NORMAL section rate × N',
    async () => {
      const N = 100_000;
      const started = await start();
      const session = await login(started.server, 'many');
      const drawn = await started.run(session, (ctx) => single_rolls(ctx, started.core(), '[gacha_banner_plain]', N), 71n);
      const counts = new Map<number, number>();
      for (const items of drawn) {
        expect(items.length).toBe(1);
        const item_id = items[0]?.[0] ?? 0;
        counts.set(item_id, (counts.get(item_id) ?? 0) + 1);
      }
      const section = (await rates(session, '[gacha_banner_plain]')).sections.find((s) => s.kind === NORMAL && !s.rate_up_guaranteed);
      expect(section?.rates.length).toBe(3);
      let total = 0;
      for (const rate of section?.rates ?? []) {
        const item_id = rate.items[0]?.item_id ?? 0;
        const count = counts.get(item_id) ?? 0;
        total += count;
        const expected = (N * Number(rate.numerator)) / Number(rate.denominator);
        expect(Math.abs(count - expected)).toBeLessThanOrEqual(2 * Math.sqrt(N));
      }
      expect(total).toBe(N);
    },
  );

  it('with a fixed seed, 1000 SINGLE DrawGacha calls of a banner without pity give the item order of 1000 rolls of the draw roll path with the same seed', async () => {
    const N = 1000;
    const seed = 72n;
    // grant_gacha_result grants nothing, so the N draws write no item rows
    const started = await start({ hooks: { grant_gacha_result: () => [] } });
    const session = await login(started.server, 'order');
    const draw_gacha = started.core().gacha?.DrawGacha as unknown as (ctx: unknown, request: CoreContract.DrawGachaRequest) => CoreContract.DrawGachaResponse | number;
    // one RunCoreTest request with the seed draws the plain banner N times in its ctx
    const drawn = await started.run(
      session,
      (ctx) => {
        const request = draw_request('[gacha_banner_plain]');
        const out: [number, bigint][][] = [];
        for (let i = 0; i < N; i += 1) {
          const response = draw_gacha(ctx, request);
          if (typeof response === 'number') throw new Error(`DrawGacha failed with ${String(response)}`);
          if (response.results.length !== 1) throw new Error(`DrawGacha gave ${String(response.results.length)} results`);
          out.push(amounts(response.results[0]?.items ?? []));
        }
        return out;
      },
      seed,
    );
    const rolled = await started.run(session, (ctx) => single_rolls(ctx, started.core(), '[gacha_banner_plain]', N), seed);
    expect(drawn.length).toBe(N);
    expect(new Set(drawn.map((items) => items[0]?.[0])).size).toBe(3);
    expect(drawn).toEqual(rolled);
  });
});
