/**
 * The data check of `loot-table` (`src/checks/loot-table.ts`) and the data tool checks its `## data` relies on:
 * every rule breaks to an ERROR, so the binary build fails and the server does not start.
 */
import { describe, expect, test } from 'vitest';
import { enums, fixture, lines, run, specModule, specTable, table } from './helpers.ts';

const LOOT_COLUMNS = [
  'id|id|All', 'order|int|All', 'kind|enum<LootEntryKind>|All', 'weight|int|Server',
  'items|array<{item_id: ref<item.id>, amount: long}>|All', 'table|ref<loot_table.id>?|All',
];

const SPEC = {
  version: '1.0.0',
  modules: [
    specModule({ name: 'item-ledger', tables: [specTable('item', ['id|id(key)|All'])] }),
    specModule({
      name: 'loot-table', dependencies: ['item-ledger'],
      tables: [specTable('loot_table', LOOT_COLUMNS), specTable('public_loot_table', ['id|id(key)|All'])],
      usedTables: ['item'],
      enums: [{ type: 'LootEntryKind', elements: ['Weighted', 'Guaranteed'] }],
      invariants: [{ kind: 'order_column', table: 'loot_table', column: 'order', group: 'id', min: '', max: '', child_table: '', child_column: '' }],
    }),
  ],
};

const ITEM = table(['id|id(key)|All'], [['[gold]'], ['[gem]']]);

/** A data check run with loot_table rows `[id, order, kind, weight, items, table]` and public_loot_table IDs. */
function check(rows: string[][], publicIds: string[] = []): ReturnType<typeof run> {
  return run(fixture({
    coreSpec: SPEC, modules: ['item-ledger', 'loot-table'],
    files: {
      'data/enums.csv': enums([['LootEntryKind', 'Weighted', 1], ['LootEntryKind', 'Guaranteed', 2]]),
      'data/invariants.csv': 'kind,table,column,group,min,max,child_table,child_column\norder_column,loot_table,order,id,,,,\n',
      'data/tables/item.csv': ITEM,
      'data/tables/loot_table.csv': table(LOOT_COLUMNS, rows),
      'data/tables/public_loot_table.csv': table(['id|id(key)|All'], publicIds.map((id) => [id])),
    },
  }));
}

/** The lines, without the message, of a code. */
function at(r: ReturnType<typeof run>, code: string): string[] {
  return lines(r, code).map((l) => l.split(' ').slice(0, 3).join(' '));
}

const GOOD = [
  ['[box]', '1', 'Guaranteed', '0', '[gold] 10', 'null'],
  ['[box]', '2', 'Weighted', '1', '[gem] 1', 'null'],
  ['[box]', '3', 'Weighted', '3', '', '[inner]'],
  ['[box]', '4', 'Weighted', '6', '', 'null'],
  ['[inner]', '1', 'Weighted', '1', '[gold] 1', 'null'],
  ['[inner]', '2', 'Weighted', '2', '[gem] 2', 'null'],
];

describe('loot-table data check', () => {
  test('valid data has no ERROR', () => {
    const r = check(GOOD, ['[box]']);
    expect(r.stdout.filter((l) => l.includes(' ERROR '))).toEqual([]);
    expect(r.code).toBe(0);
  });

  test('a gap in order is order', () => {
    const r = check([['[box]', '1', 'Weighted', '1', '[gold] 1', 'null'], ['[box]', '3', 'Weighted', '1', '[gem] 1', 'null']]);
    expect(at(r, 'order')).toHaveLength(1);
    expect(r.code).toBe(1);
  });

  test('a Weighted weight under 1, a Guaranteed weight that is not 0, a Guaranteed entry with nothing are out_of_range', () => {
    const r = check([
      ['[box]', '1', 'Weighted', '0', '[gold] 1', 'null'],
      ['[box]', '2', 'Guaranteed', '2', '[gem] 1', 'null'],
      ['[box]', '3', 'Guaranteed', '0', '', 'null'],
      ['[box]', '4', 'Weighted', '-1', '', 'null'],
    ]);
    expect(at(r, 'out_of_range')).toEqual([
      'data/tables/loot_table.csv:5:4 ERROR out_of_range',
      'data/tables/loot_table.csv:6:4 ERROR out_of_range',
      'data/tables/loot_table.csv:7:3 ERROR out_of_range',
      'data/tables/loot_table.csv:8:4 ERROR out_of_range',
    ]);
    expect(r.code).toBe(1);
  });

  test('a Weighted weight sum over 2^32 is out_of_range, and 2^32 is not', () => {
    const at32 = check([['[box]', '1', 'Weighted', '2147483647', '[gold] 1', 'null'], ['[box]', '2', 'Weighted', '2147483647', '[gem] 1', 'null'], ['[box]', '3', 'Weighted', '2', '', 'null']]);
    expect(at(at32, 'out_of_range')).toEqual([]);
    const over = check([['[box]', '1', 'Weighted', '2147483647', '[gold] 1', 'null'], ['[box]', '2', 'Weighted', '2147483647', '[gem] 1', 'null'], ['[box]', '3', 'Weighted', '3', '', 'null']]);
    expect(lines(over, 'out_of_range').map((l) => l.split(' ').slice(0, 3).join(' '))).toEqual(['data/tables/loot_table.csv:5:1 ERROR out_of_range']);
    expect(lines(over, 'out_of_range')[0]).toContain('weight sum of [box]');
    expect(over.code).toBe(1);
  });

  test('a table that comes back to itself is cycle', () => {
    const r = check([
      ['[a]', '1', 'Weighted', '1', '', '[b]'],
      ['[b]', '1', 'Guaranteed', '0', '', '[a]'],
    ]);
    expect(at(r, 'cycle')).toHaveLength(1);
    expect(r.code).toBe(1);
  });

  test('a path denominator over 2^53-1 is out_of_range, and up to 2^53-1 is not', () => {
    // Weight sums 2^26 and 2^27 - 1 multiply to 2^53 - 2^26; with 2^27 the product is 2^53.
    const nest = (inner: string): string[][] => [
      ['[top]', '1', 'Weighted', '67108863', '', '[mid]'],
      ['[top]', '2', 'Weighted', '1', '[gold] 1', 'null'],
      ['[mid]', '1', 'Weighted', inner, '[gem] 1', 'null'],
      ['[mid]', '2', 'Weighted', '1', '[gold] 1', 'null'],
    ];
    expect(at(check(nest('134217726')), 'out_of_range')).toEqual([]);
    const over = check(nest('134217727'));
    expect(at(over, 'out_of_range')).toEqual(['data/tables/loot_table.csv:5:1 ERROR out_of_range']);
    expect(lines(over, 'out_of_range')[0]).toContain('denominator 9007199254740992');
    expect(over.code).toBe(1);
  });

  test('a public_loot_table row that is not a loot table is ref_missing', () => {
    const r = check(GOOD, ['[box]', '[gold]']);
    expect(at(r, 'ref_missing')).toEqual(['data/tables/public_loot_table.csv:6:1 ERROR ref_missing']);
    expect(r.code).toBe(1);
  });
});
