/**
 * Data check of `gacha` (spec `## data`): the `gacha_banner` rules. Every broken rule is `out_of_range`.
 *
 * P is `pity_table` and every table reached from it through the `loot_table` `table` column; G is
 * `multi_guaranteed_table` and every table reached from it.
 */
import { cellPlace, column, type Row, type Table } from '../model.ts';
import type { ModuleCheck, ModuleCheckInput } from '../module-check.ts';
import type { Value } from '../values.ts';

/** The ID name of a ref cell, or null for `null`, an empty cell and a cell that did not parse. */
function ref(row: Row, name: string): string | null {
  const value: Value | undefined = row.values.get(name);
  return value?.k === 'idname' ? value.name : null;
}

/** The integer of an `int?` cell, or null. */
function int(row: Row, name: string): bigint | null {
  const value = row.values.get(name);
  return value?.k === 'int' ? value.v : null;
}

function bool(row: Row, name: string): boolean {
  const value = row.values.get(name);
  return value?.k === 'bool' && value.v;
}

function list_length(row: Row, name: string): number {
  const value = row.values.get(name);
  return value?.k === 'list' ? value.items.length : 0;
}

/** Child tables of each loot table: the `table` cells of its entries. */
function loot_graph(loot: Table | undefined): Map<string, string[]> {
  const graph = new Map<string, string[]>();
  for (const row of loot?.rows ?? []) {
    const id = ref(row, 'id');
    if (id === null) continue;
    const children = graph.get(id) ?? [];
    const child = ref(row, 'table');
    if (child !== null) children.push(child);
    graph.set(id, children);
  }
  return graph;
}

/** The tables reached from `start` (itself included), never entering `skip`. */
function reach(graph: ReadonlyMap<string, readonly string[]>, start: string, skip: string | null = null): Set<string> {
  const seen = new Set<string>();
  const stack = start === skip ? [] : [start];
  while (stack.length > 0) {
    const next = stack.pop() as string;
    if (seen.has(next)) continue;
    seen.add(next);
    for (const child of graph.get(next) ?? []) if (child !== skip && !seen.has(child)) stack.push(child);
  }
  return seen;
}

/** The cells of one banner row the rules read, and where a broken rule is reported. */
interface Banner {
  readonly id: string;
  readonly row: Row;
  readonly loot_table: string | null;
  readonly multi_count: bigint | null;
  readonly multi_table: string | null;
  readonly pity_count: bigint | null;
  readonly pity_table: string | null;
  readonly rate_up_table: string | null;
  readonly from_loot: ReadonlySet<string>;
  readonly pity_tier: ReadonlySet<string>;
  readonly at: (name: string, message: string) => void;
}

/** `multi_count` is 2 or more; without it `multi_cost` is empty and `multi_guaranteed_table` is null; G's rules. */
function check_multi(b: Banner, graph: ReadonlyMap<string, readonly string[]>): void {
  const { id, at, multi_count, multi_table, loot_table, pity_table } = b;
  if (multi_count !== null && multi_count < 2n) at('multi_count', `${id}: multi_count is below 2`);
  if (multi_count === null && list_length(b.row, 'multi_cost') > 0) at('multi_cost', `${id}: multi_cost is not empty while multi_count is null`);
  if (multi_count === null && multi_table !== null) at('multi_guaranteed_table', `${id}: multi_guaranteed_table is set while multi_count is null`);
  if (multi_table === null || loot_table === null) return;
  const multi_tier = reach(graph, multi_table);
  if (![...multi_tier].some((table) => b.from_loot.has(table))) at('multi_guaranteed_table', `${id}: no table of multi_guaranteed_table's tier is reached from loot_table`);
  if (multi_tier.has(loot_table)) at('multi_guaranteed_table', `${id}: multi_guaranteed_table's tier has loot_table`);
  if (pity_table !== null && !multi_tier.has(pity_table)) at('multi_guaranteed_table', `${id}: pity_table is not in multi_guaranteed_table's tier`);
}

/** `pity_count` and `pity_table` are both null or both set; `pity_count` is 1 or more; P's rules. */
function check_pity(b: Banner, graph: ReadonlyMap<string, readonly string[]>): void {
  const { id, at, pity_count, pity_table, loot_table, multi_table, pity_tier } = b;
  if ((pity_count === null) !== (pity_table === null)) at(pity_count === null ? 'pity_count' : 'pity_table', `${id}: pity_count and pity_table are not both null or both set`);
  if (pity_count !== null && pity_count < 1n) at('pity_count', `${id}: pity_count is below 1`);
  if (pity_table === null || loot_table === null) return;
  if (!b.from_loot.has(pity_table)) at('pity_table', `${id}: pity_table is not reached from loot_table`);
  if (pity_tier.has(loot_table)) at('pity_table', `${id}: pity_table's tier has loot_table`);
  const starts = multi_table === null ? [loot_table] : [loot_table, multi_table];
  if (starts.some((start) => [...reach(graph, start, pity_table)].some((table) => pity_tier.has(table)))) {
    at('pity_table', `${id}: a table of pity_table's tier is reached from loot_table or multi_guaranteed_table without passing pity_table`);
  }
}

/** `rate_up_table` needs `pity_table` and is in P; `rate_up_guarantee` needs `rate_up_table`. */
function check_rate_up(b: Banner): void {
  const { id, at, rate_up_table, pity_table } = b;
  if (rate_up_table !== null && pity_table === null) at('rate_up_table', `${id}: rate_up_table is set while pity_table is null`);
  if (rate_up_table !== null && pity_table !== null && !b.pity_tier.has(rate_up_table)) at('rate_up_table', `${id}: rate_up_table is not in pity_table's tier`);
  if (bool(b.row, 'rate_up_guarantee') && rate_up_table === null) at('rate_up_guarantee', `${id}: rate_up_guarantee is true while rate_up_table is null`);
}

/** The `pity_banner` banner has no `pity_banner` and the same `pity_count`, `pity_table` and `rate_up_guarantee`. */
function check_pity_banner(b: Banner, by_id: ReadonlyMap<string, Row>): void {
  const owner_name = ref(b.row, 'pity_banner');
  const owner = owner_name === null ? undefined : by_id.get(owner_name);
  if (owner_name === null || owner === undefined) return;
  if (ref(owner, 'pity_banner') !== null) b.at('pity_banner', `${b.id}: pity_banner ${owner_name} has a pity_banner`);
  const same = int(owner, 'pity_count') === b.pity_count && ref(owner, 'pity_table') === b.pity_table && bool(owner, 'rate_up_guarantee') === bool(b.row, 'rate_up_guarantee');
  if (!same) b.at('pity_banner', `${b.id}: pity_count, pity_table or rate_up_guarantee differs from pity_banner ${owner_name}`);
}

function banner_of(input: ModuleCheckInput, banners: Table, row: Row, graph: ReadonlyMap<string, readonly string[]>): Banner {
  const loot_table = ref(row, 'loot_table');
  const pity_table = ref(row, 'pity_table');
  return {
    id: ref(row, 'id') ?? '',
    row,
    loot_table,
    multi_count: int(row, 'multi_count'),
    multi_table: ref(row, 'multi_guaranteed_table'),
    pity_count: int(row, 'pity_count'),
    pity_table,
    rate_up_table: ref(row, 'rate_up_table'),
    from_loot: loot_table === null ? new Set<string>() : reach(graph, loot_table),
    pity_tier: pity_table === null ? new Set<string>() : reach(graph, pity_table),
    at: (name, message) => {
      const col = column(banners, name);
      if (col) input.report('out_of_range', cellPlace(banners, row, col), message);
    },
  };
}

function check_row(input: ModuleCheckInput, banners: Table, row: Row, graph: ReadonlyMap<string, readonly string[]>, by_id: ReadonlyMap<string, Row>): void {
  const banner = banner_of(input, banners, row, graph);
  check_multi(banner, graph);
  check_pity(banner, graph);
  check_rate_up(banner);
  check_pity_banner(banner, by_id);
}

export const check: ModuleCheck = (input) => {
  const banners = input.data.tables.get('gacha_banner');
  if (!banners) return;
  const graph = loot_graph(input.data.tables.get('loot_table'));
  const by_id = new Map<string, Row>();
  for (const row of banners.rows) {
    const id = ref(row, 'id');
    if (id !== null) by_id.set(id, row);
  }
  for (const row of banners.rows) check_row(input, banners, row, graph, by_id);
};
