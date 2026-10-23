/**
 * Data check of `loot-table` `## data`: entry `weight` by `kind`, a `Guaranteed` entry that gives something, the
 * `weight` sum of a table, the `denominator` of every path, and `public_loot_table` rows that are loot tables. A
 * `table` that comes back to its table is the data tool's ref `cycle`, and `order` is the invariant `order_column`.
 */
import type { ModuleCheck } from '../module-check.ts';
import { cellPlace, column, rowPlace, type Column, type Row, type Table } from '../model.ts';
import type { Value } from '../values.ts';

const MAX_WEIGHT_SUM = 2n ** 32n;
const MAX_DENOMINATOR = 2n ** 53n - 1n;

function idName(value: Value | undefined): string | null {
  return value?.k === 'idname' ? value.name : null;
}

interface Entry {
  row: Row;
  weighted: boolean;
  weight: bigint;
  table: string | null;
}

/** The `weight` and `Guaranteed` rules of one entry row; the entry, or null for a row that did not parse. */
function entryOf(loot: Table, row: Row, kindCol: Column, weightCol: Column, report: Report): { id: string; entry: Entry } | null {
  const id = idName(row.values.get('id'));
  const kind = row.values.get('kind');
  const weight = row.values.get('weight');
  if (id === null || kind?.k !== 'enum' || weight?.k !== 'int') return null;
  const items = row.values.get('items');
  const table = idName(row.values.get('table'));
  const weighted = kind.element === 'Weighted';
  if (weighted && weight.v < 1n) report('out_of_range', cellPlace(loot, row, weightCol), `Weighted entry of ${id} has weight ${String(weight.v)}, not 1 or more`);
  if (kind.element === 'Guaranteed') {
    if (weight.v !== 0n) report('out_of_range', cellPlace(loot, row, weightCol), `Guaranteed entry of ${id} has weight ${String(weight.v)}, not 0`);
    const noItems = items === undefined || (items.k === 'list' && items.items.length === 0);
    if (noItems && table === null) report('out_of_range', cellPlace(loot, row, kindCol), `Guaranteed entry of ${id} has no items and no table`);
  }
  return { id, entry: { row, weighted, weight: weight.v, table } };
}

/** The entries of each loot table, after the entry rules. */
function collectEntries(loot: Table, report: Report): Map<string, Entry[]> {
  const tables = new Map<string, Entry[]>();
  const kindCol = column(loot, 'kind');
  const weightCol = column(loot, 'weight');
  if (!kindCol || !weightCol) return tables;
  for (const row of loot.rows) {
    const found = entryOf(loot, row, kindCol, weightCol, report);
    if (found === null) continue;
    const list = tables.get(found.id) ?? [];
    list.push(found.entry);
    tables.set(found.id, list);
  }
  return tables;
}

/** Every `public_loot_table` row is a loot table. */
function checkPublic(pub: Table, tables: ReadonlyMap<string, Entry[]>, report: Report): void {
  const pubId = column(pub, 'id');
  if (!pubId) return;
  for (const row of pub.rows) {
    const id = idName(row.values.get('id'));
    if (id !== null && !tables.has(id)) report('ref_missing', cellPlace(pub, row, pubId), `public loot table ${id} is not a loot_table id`);
  }
}

export const check: ModuleCheck = (input) => {
  const { data, report } = input;
  const loot = data.tables.get('loot_table');
  const tables = loot ? collectEntries(loot, report) : new Map<string, Entry[]>();
  if (loot) {
    checkWeightSums(loot, tables, report);
    checkDenominators(loot, tables, report);
  }
  const pub = data.tables.get('public_loot_table');
  if (pub) checkPublic(pub, tables, report);
};

type Report = Parameters<ModuleCheck>[0]['report'];

/** The first row of a table in the file. */
function firstRow(entries: readonly Entry[]): Row {
  return entries.reduce((a, b) => (b.row.line < a.row.line ? b : a)).row;
}

function weightSum(entries: readonly Entry[]): bigint {
  return entries.reduce((sum, e) => (e.weighted ? sum + e.weight : sum), 0n);
}

function checkWeightSums(loot: Table, tables: ReadonlyMap<string, Entry[]>, report: Report): void {
  for (const [id, entries] of tables) {
    const sum = weightSum(entries);
    if (sum > MAX_WEIGHT_SUM) report('out_of_range', rowPlace(loot, firstRow(entries)), `Weighted weight sum of ${id} is ${String(sum)}, over 2^32`);
  }
}

/**
 * The largest path `denominator` from each table: the product of the weight sums of the tables of the `Weighted`
 * entries on the path. Tables on a `table` cycle are skipped; the ref check reports the cycle.
 */
function checkDenominators(loot: Table, tables: ReadonlyMap<string, Entry[]>, report: Report): void {
  const largest = new Map<string, bigint | null>();
  const visiting = new Set<string>();
  const walk = (id: string): bigint | null => {
    if (largest.has(id)) return largest.get(id) as bigint | null;
    if (visiting.has(id)) return null;
    const entries = tables.get(id);
    if (entries === undefined) return 1n;
    visiting.add(id);
    const total = weightSum(entries);
    let max: bigint | null = 1n;
    for (const e of entries) {
      const below = e.table === null ? 1n : walk(e.table);
      if (below === null) {
        max = null;
        break;
      }
      const d = (e.weighted ? total : 1n) * below;
      if (d > max) max = d;
    }
    visiting.delete(id);
    largest.set(id, max);
    return max;
  };
  for (const [id, entries] of tables) {
    const d = walk(id);
    if (d !== null && d > MAX_DENOMINATOR) report('out_of_range', rowPlace(loot, firstRow(entries)), `a path from ${id} has denominator ${String(d)}, over 2^53-1`);
  }
}
