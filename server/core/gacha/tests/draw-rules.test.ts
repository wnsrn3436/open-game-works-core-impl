import * as CoreContract from '../../../generated/contract/core_contract.ts';
import { next_pity, pick_table, pity_owner, reaches, substitutions_of, tier_of, type BannerRule } from '../draw.ts';
import { items_of_text, items_text } from '../records.ts';

const Kind = CoreContract.GachaDrawKind;

/** Loot tables by ID value: the child tables of their entries. 1 → 2 → 3, 2 → 4, 5 alone, 6 → 6 is a self loop. */
const GRAPH: Record<number, number[]> = { 1: [0, 2], 2: [3, 4], 3: [0], 4: [0], 5: [0], 6: [6] };
const ROWS = { get_rows: (table: number) => (GRAPH[table] ?? []).map((child) => ({ table: child })) };

const BANNER: BannerRule = {
  loot_table: 1,
  multi_count: 10,
  multi_guaranteed_table: 7,
  pity_count: 3,
  pity_table: 2,
  rate_up_table: 3,
  rate_up_guarantee: true,
};

describe('pity tier and MULTI tier', () => {
  it('a tier is the table and every table reached through the table column; null has an empty tier', () => {
    expect([...tier_of(ROWS, 2)].sort()).toEqual([2, 3, 4]);
    expect([...tier_of(ROWS, 1)].sort()).toEqual([1, 2, 3, 4]);
    expect([...tier_of(ROWS, 6)]).toEqual([6]);
    expect(tier_of(ROWS, 0).size).toBe(0);
  });

  it('a draw reaches a tier when its rolled tables have a table of the tier', () => {
    const tier = tier_of(ROWS, 2);
    expect(reaches([1, 2, 4], tier)).toBe(true);
    expect(reaches([1, 3], tier)).toBe(true);
    expect(reaches([1, 5], tier)).toBe(false);
  });
});

describe('the table and kind of a draw', () => {
  it('PITY when count + 1 reaches pity_count, MULTI_GUARANTEE for the last MULTI draw when no earlier draw reached G, else NORMAL', () => {
    expect(pick_table(BANNER, false, 1, 1, 0, false)).toEqual({ table: 1, kind: Kind.GACHA_DRAW_KIND_NORMAL });
    expect(pick_table(BANNER, false, 1, 1, 2, false)).toEqual({ table: 2, kind: Kind.GACHA_DRAW_KIND_PITY });
    expect(pick_table(BANNER, true, 10, 10, 0, false)).toEqual({ table: 7, kind: Kind.GACHA_DRAW_KIND_MULTI_GUARANTEE });
    expect(pick_table(BANNER, true, 10, 10, 0, true)).toEqual({ table: 1, kind: Kind.GACHA_DRAW_KIND_NORMAL });
    expect(pick_table(BANNER, true, 9, 10, 0, false)).toEqual({ table: 1, kind: Kind.GACHA_DRAW_KIND_NORMAL });
    expect(pick_table(BANNER, true, 10, 10, 2, false)).toEqual({ table: 2, kind: Kind.GACHA_DRAW_KIND_PITY });
    expect(pick_table({ ...BANNER, multi_guaranteed_table: 0 }, true, 10, 10, 0, false)).toEqual({ table: 1, kind: Kind.GACHA_DRAW_KIND_NORMAL });
    expect(pick_table({ ...BANNER, pity_count: 0, pity_table: 0 }, false, 1, 1, 1000, false)).toEqual({ table: 1, kind: Kind.GACHA_DRAW_KIND_NORMAL });
  });
});

describe('pity update', () => {
  it('reaching P sets the count to 0 and, with rate_up_guarantee, g to the negation of rate_up; missing P adds 1', () => {
    expect(next_pity(BANNER, { count: 1, rate_up_guaranteed: false }, false, false)).toEqual({ count: 2, rate_up_guaranteed: false });
    expect(next_pity(BANNER, { count: 2, rate_up_guaranteed: false }, true, false)).toEqual({ count: 0, rate_up_guaranteed: true });
    expect(next_pity(BANNER, { count: 2, rate_up_guaranteed: true }, true, true)).toEqual({ count: 0, rate_up_guaranteed: false });
    expect(next_pity({ ...BANNER, rate_up_guarantee: false }, { count: 2, rate_up_guaranteed: false }, true, false)).toEqual({ count: 0, rate_up_guaranteed: false });
  });

  it('the substitution list is (pity_table, rate_up_table) only while g is true', () => {
    expect(substitutions_of(BANNER, true)).toEqual([[2, 3]]);
    expect(substitutions_of(BANNER, false)).toBeUndefined();
    expect(substitutions_of({ ...BANNER, rate_up_table: 0 }, true)).toBeUndefined();
  });

  it('the pity owner is pity_banner when set, else the banner itself', () => {
    expect(pity_owner({ id: 11, pity_banner: 0 })).toBe(11);
    expect(pity_owner({ id: 12, pity_banner: 11 })).toBe(11);
  });
});

describe('stored item lists', () => {
  it('an ItemAmount list is stored as its proto3 JSON text and round-trips, a big amount included', () => {
    const small = new CoreContract.ItemAmount();
    small.item_id = 5;
    small.amount = 9_007_199_254_740_991n;
    const big = new CoreContract.ItemAmount();
    big.item_id = 6;
    big.big_amount = '123456789012345678901234567890';
    expect(items_text([small, big])).toBe('[{"item_id":5,"amount":"9007199254740991"},{"item_id":6,"big_amount":"123456789012345678901234567890"}]');
    const back = items_of_text(items_text([small, big]));
    expect(back.map((i) => [i.item_id, i.amount, i.big_amount])).toEqual([
      [5, 9_007_199_254_740_991n, ''],
      [6, 0n, '123456789012345678901234567890'],
    ]);
    expect(items_of_text(items_text([]))).toEqual([]);
  });
});
