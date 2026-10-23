/** The `gacha` data check (`src/checks/gacha.ts`): each `gacha_banner` rule of the spec `## data` is `out_of_range`. */
import { describe, expect, test } from 'vitest';
import { enums, fixture, lines, run, specModule, specTable, table } from './helpers.ts';

const BUNDLE = 'array<{item_id: ref<item.id>, amount: long}>';

const BANNER_COLUMNS = [
  'id|id(key)|All', 'name|tstring<id>|Client', 'loot_table|ref<loot_table.id>|All', `single_cost|${BUNDLE}|All`, 'multi_count|int?|All',
  `multi_cost|${BUNDLE}|All`, 'multi_guaranteed_table|ref<loot_table.id>?|All', 'ticket_item|ref<item.id>?|All', 'pity_count|int?|All',
  'pity_table|ref<loot_table.id>?|All', 'rate_up_table|ref<loot_table.id>?|All', 'rate_up_guarantee|bool|All', 'pity_banner|ref<gacha_banner.id>?|All',
  'start_at|datetime?|All', 'end_at|datetime?|All', 'live_event|ref<live_event.id>?|All', 'requirement|requirement|All',
];
const LOOT_COLUMNS = ['id|id|All', 'order|int|All', 'kind|enum<LootEntryKind>|All', 'weight|int|Server', `items|${BUNDLE}|All`, 'table|ref<loot_table.id>?|All'];

const SPEC = {
  version: '1.0.0',
  modules: [
    specModule({ name: 'gacha', tables: [specTable('gacha_banner', BANNER_COLUMNS)] }),
    specModule({ name: 'loot-table', tables: [specTable('loot_table', LOOT_COLUMNS)], enums: [{ type: 'LootEntryKind', elements: ['Weighted', 'Guaranteed'] }] }),
  ],
};

/**
 * Loot tables: `lt_normal` reaches `lt_pity` (which reaches `lt_rate_up`) and `lt_side`. `lt_multi` reaches `lt_pity`,
 * `lt_multi2` reaches `lt_normal`. `lt_normal2` reaches `lt_rate_up` without `lt_pity`. `lt_other` is reached from none.
 */
const LOOT_ROWS = [
  ['[lt_normal]', '1', 'Weighted', '80', '[gold] 1', 'null'],
  ['[lt_normal]', '2', 'Weighted', '10', '', '[lt_pity]'],
  ['[lt_normal]', '3', 'Weighted', '10', '', '[lt_side]'],
  ['[lt_pity]', '1', 'Weighted', '50', '', '[lt_rate_up]'],
  ['[lt_pity]', '2', 'Weighted', '50', '[gold] 5', 'null'],
  ['[lt_rate_up]', '1', 'Guaranteed', '0', '[hero] 1', 'null'],
  ['[lt_side]', '1', 'Guaranteed', '0', '[gold] 2', 'null'],
  ['[lt_multi]', '1', 'Weighted', '1', '', '[lt_pity]'],
  ['[lt_multi]', '2', 'Weighted', '1', '[gold] 1', 'null'],
  ['[lt_multi2]', '1', 'Weighted', '1', '', '[lt_normal]'],
  ['[lt_multi2]', '2', 'Weighted', '1', '[gold] 1', 'null'],
  ['[lt_normal2]', '1', 'Weighted', '1', '', '[lt_pity]'],
  ['[lt_normal2]', '2', 'Weighted', '1', '', '[lt_rate_up]'],
  ['[lt_other]', '1', 'Guaranteed', '0', '[gold] 1', 'null'],
];

interface Banner {
  loot?: string;
  multi_count?: string;
  multi_cost?: string;
  multi_table?: string;
  pity_count?: string;
  pity_table?: string;
  rate_up_table?: string;
  rate_up_guarantee?: string;
  pity_banner?: string;
}

/** A banner row: a valid banner with pity 90, rate-up guarantee and a `MULTI` guarantee, changed by `b`. */
function banner(id: string, b: Banner = {}): string[] {
  return [
    id, 'Banner', b.loot ?? '[lt_normal]', '[gem] 1', b.multi_count ?? '10', b.multi_cost ?? '[gem] 10', b.multi_table ?? '[lt_multi]', 'null',
    b.pity_count ?? '90', b.pity_table ?? '[lt_pity]', b.rate_up_table ?? '[lt_rate_up]', b.rate_up_guarantee ?? 'true', b.pity_banner ?? 'null',
    'null', 'null', 'null', '',
  ];
}

const NO_PITY: Banner = { pity_count: 'null', pity_table: 'null', rate_up_table: 'null', rate_up_guarantee: 'false' };
const NO_MULTI: Banner = { multi_count: 'null', multi_cost: '', multi_table: 'null' };

function check(rows: string[][]): string[] {
  const r = run(fixture({
    coreSpec: SPEC,
    modules: ['gacha'],
    files: {
      'data/tables/gacha_banner.csv': table(BANNER_COLUMNS.map((c) => c), rows),
      'data/tables/loot_table.csv': table(LOOT_COLUMNS, LOOT_ROWS),
      'data/tables/item.csv': table(['id|id(key)|All'], [['[gold]'], ['[gem]'], ['[hero]']]),
      'data/tables/live_event.csv': table(['id|id(key)|All']),
      'data/enums.csv': enums([['LootEntryKind', 'Weighted', 1], ['LootEntryKind', 'Guaranteed', 2]]),
    },
  }));
  return lines(r, 'out_of_range').map((l) => l.split(' ').slice(0, 3).join(' '));
}

const AT = (line: number, col: number): string => `data/tables/gacha_banner.csv:${String(line)}:${String(col)} ERROR out_of_range`;

describe('gacha_banner data check', () => {
  test('a banner with pity, rate-up guarantee, MULTI guarantee and a pity_banner that follow every rule has no line', () => {
    expect(check([banner('[b_ok]'), banner('[b_shared]', { pity_banner: '[b_ok]' }), banner('[b_plain]', { ...NO_PITY, ...NO_MULTI })])).toEqual([]);
  });

  test('multi_count below 2; multi_cost or multi_guaranteed_table without multi_count', () => {
    expect(check([
      banner('[b_one]', { multi_count: '1' }),
      banner('[b_cost]', { multi_count: 'null', multi_table: 'null' }),
      banner('[b_table]', { multi_count: 'null', multi_cost: '' }),
    ])).toEqual([AT(5, 5), AT(6, 6), AT(7, 7)]);
  });

  test('G not reached from loot_table, G with loot_table, pity_table outside G', () => {
    expect(check([
      banner('[b_unreached]', { ...NO_PITY, multi_table: '[lt_other]' }),
      banner('[b_has_loot]', { multi_table: '[lt_multi2]' }),
      banner('[b_no_pity]', { multi_table: '[lt_side]' }),
    ])).toEqual([AT(5, 7), AT(6, 7), AT(7, 7)]);
  });

  test('pity_count without pity_table, pity_count 0, pity_table not reached from loot_table, P with loot_table, P reached around pity_table', () => {
    const pity_only = { pity_table: 'null', rate_up_table: 'null', rate_up_guarantee: 'false' };
    const bare_pity = { ...NO_MULTI, rate_up_table: 'null', rate_up_guarantee: 'false' };
    expect(check([
      banner('[b_pair]', pity_only),
      banner('[b_zero]', { pity_count: '0' }),
      banner('[b_far]', { ...bare_pity, pity_table: '[lt_other]' }),
      banner('[b_self]', { ...bare_pity, pity_table: '[lt_normal]' }),
      banner('[b_bypass]', { ...NO_MULTI, loot: '[lt_normal2]' }),
    ])).toEqual([AT(5, 10), AT(6, 9), AT(7, 10), AT(8, 10), AT(9, 10)]);
  });

  test('rate_up_table without pity_table or outside P; rate_up_guarantee without rate_up_table', () => {
    expect(check([
      banner('[b_alone]', { ...NO_PITY, rate_up_table: '[lt_rate_up]' }),
      banner('[b_outside]', { rate_up_table: '[lt_side]' }),
      banner('[b_guarantee]', { rate_up_table: 'null' }),
    ])).toEqual([AT(5, 11), AT(6, 11), AT(7, 12)]);
  });

  test('a pity_banner that has a pity_banner, or other pity_count, pity_table or rate_up_guarantee', () => {
    expect(check([
      banner('[b_owner]'),
      banner('[b_shared]', { pity_banner: '[b_owner]' }),
      banner('[b_nested]', { pity_banner: '[b_shared]' }),
      banner('[b_count]', { pity_banner: '[b_owner]', pity_count: '80' }),
      banner('[b_guarantee]', { pity_banner: '[b_owner]', rate_up_guarantee: 'false', rate_up_table: '[lt_rate_up]' }),
    ])).toEqual([AT(7, 13), AT(8, 13), AT(9, 13)]);
  });
});
