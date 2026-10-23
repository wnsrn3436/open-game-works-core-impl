/**
 * The parts of `DrawGacha` and `GetGachaRates` that read only a banner row and the loot table rows: the tiers P and G,
 * the table and kind of each draw, the pity update and the disclosed rate sections (`### pity state`,
 * `### draw order` 6, `### disclosed rates`).
 */
import * as CoreContract from '../../generated/contract/core_contract.ts';
import type * as GameData from '../../generated/data/game_data.ts';

const Kind = CoreContract.GachaDrawKind;

/** A substitution list entry of `loot-table`: `(from loot table ID value, to loot table ID value)`. */
export type Substitution = readonly [number, number];

/** The pity state `(count, rate_up_guaranteed)` of a pity owner. */
export interface PityState {
  readonly count: number;
  readonly rate_up_guaranteed: boolean;
}

/** What draw order 6 needs of a banner row. 0 is null for the nullable columns. */
export type BannerRule = Pick<
  GameData.GachaBannerRow,
  'loot_table' | 'multi_count' | 'multi_guaranteed_table' | 'pity_count' | 'pity_table' | 'rate_up_table' | 'rate_up_guarantee'
>;

/** The loot table rows by ID value, as `DataSet.LootTableTable` gives them. */
export interface LootRows {
  get_rows(id: number): readonly Pick<GameData.LootTableRow, 'table'>[];
}

/** A table and every table reached from it through the `table` column; empty for 0 (null). */
export function tier_of(rows: LootRows, table: number): ReadonlySet<number> {
  const tier = new Set<number>();
  if (table === 0) return tier;
  const stack = [table];
  while (stack.length > 0) {
    const next = stack.pop() as number;
    if (tier.has(next)) continue;
    tier.add(next);
    for (const row of rows.get_rows(next)) if (row.table !== 0 && !tier.has(row.table)) stack.push(row.table);
  }
  return tier;
}

/** True when a draw's rolled tables reach the tier. */
export function reaches(tables: readonly number[], tier: ReadonlySet<number>): boolean {
  return tables.some((table) => tier.has(table));
}

/** The substitution list of a roll: `(pity_table, rate_up_table)` while the next pity tier is a rate-up for sure. */
export function substitutions_of(banner: BannerRule, rate_up_guaranteed: boolean): Substitution[] | undefined {
  if (!rate_up_guaranteed || banner.pity_table === 0 || banner.rate_up_table === 0) return undefined;
  return [[banner.pity_table, banner.rate_up_table]];
}

/** The table and kind of draw `index` (1-based) of `count` draws, after the pity count `pity_count` and earlier draws. */
export function pick_table(
  banner: BannerRule,
  multi: boolean,
  index: number,
  count: number,
  pity_count: number,
  earlier_reached_g: boolean,
): { readonly table: number; readonly kind: CoreContract.GachaDrawKind } {
  if (banner.pity_count > 0 && pity_count + 1 >= banner.pity_count) return { table: banner.pity_table, kind: Kind.GACHA_DRAW_KIND_PITY };
  if (multi && index === count && banner.multi_guaranteed_table !== 0 && !earlier_reached_g) {
    return { table: banner.multi_guaranteed_table, kind: Kind.GACHA_DRAW_KIND_MULTI_GUARANTEE };
  }
  return { table: banner.loot_table, kind: Kind.GACHA_DRAW_KIND_NORMAL };
}

/** The pity state after a draw: reaching P resets the count and, with `rate_up_guarantee`, sets g to "missed the rate-up". */
export function next_pity(banner: BannerRule, before: PityState, reached_p: boolean, rate_up: boolean): PityState {
  if (!reached_p) return { count: before.count + 1, rate_up_guaranteed: before.rate_up_guaranteed };
  return { count: 0, rate_up_guaranteed: banner.rate_up_guarantee ? !rate_up : before.rate_up_guaranteed };
}

/** The pity owner of a banner: its `pity_banner`, or the banner itself. */
export function pity_owner(banner: Pick<GameData.GachaBannerRow, 'id' | 'pity_banner'>): number {
  return banner.pity_banner !== 0 ? banner.pity_banner : banner.id;
}

/** `loot-table.get_rates`, as `GetGachaRates` calls it. */
export type RatesOf = (table: number, substitutions: Substitution[] | undefined) => readonly CoreContract.LootRate[];

/** One `GachaRateSection` from the `LootRate` list of a table: `rate_up` when the path has a `rate_up_table` entry. */
function section(
  kind: CoreContract.GachaDrawKind,
  rate_up_guaranteed: boolean,
  rate_up_table: number,
  rates: readonly CoreContract.LootRate[],
): CoreContract.GachaRateSection {
  const out = new CoreContract.GachaRateSection();
  out.kind = kind;
  out.rate_up_guaranteed = rate_up_guaranteed;
  out.rates = rates.map((rate) => {
    const item = new CoreContract.GachaRate();
    item.items = rate.items;
    item.numerator = rate.numerator;
    item.denominator = rate.denominator;
    item.rate_up = rate_up_table !== 0 && rate.path.some((entry) => entry.table_id === rate_up_table);
    return item;
  });
  return out;
}

/**
 * The sections of `GetGachaRates` in `### disclosed rates` order: `NORMAL`, then `PITY` with `pity_count`, then
 * `MULTI_GUARANTEE` with `multi_count` and `multi_guaranteed_table`. A `rate_up_guarantee` banner has a `false` and a
 * `true` section per kind; the `true` one is computed with the substitution list `(pity_table, rate_up_table)`.
 */
export function rate_sections(banner: BannerRule, rates_of: RatesOf): CoreContract.GachaRateSection[] {
  const kinds: [CoreContract.GachaDrawKind, number][] = [[Kind.GACHA_DRAW_KIND_NORMAL, banner.loot_table]];
  if (banner.pity_count > 0) kinds.push([Kind.GACHA_DRAW_KIND_PITY, banner.pity_table]);
  if (banner.multi_count > 0 && banner.multi_guaranteed_table !== 0) kinds.push([Kind.GACHA_DRAW_KIND_MULTI_GUARANTEE, banner.multi_guaranteed_table]);
  const out: CoreContract.GachaRateSection[] = [];
  for (const [kind, table] of kinds) {
    out.push(section(kind, false, banner.rate_up_table, rates_of(table, undefined)));
    if (banner.rate_up_guarantee) out.push(section(kind, true, banner.rate_up_table, rates_of(table, substitutions_of(banner, true))));
  }
  return out;
}
