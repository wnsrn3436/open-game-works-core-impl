/** ID names, `ref` values, `ref` cycles, resource keys and `data/simulation_tables.csv`. */
import type { RunContext } from './context.ts';
import { SIMULATION_TABLES_HEADER } from './data.ts';
import { filePlace, type Place } from './diag.ts';
import { cellPlace, cellText, column, flatPlace, flatText, type Column, type Table } from './model.ts';
import type { ColumnType } from './types.ts';
import { ID_NAME, idNamesIn, valueKey, type Value } from './values.ts';

export type Reference =
  | { kind: 'ref'; table: string; column: string; value: Value }
  | { kind: 'idname'; name: string }
  | { kind: 'text'; text: string }
  | { kind: 'reskey'; key: string };

/**
 * Calls `fn` for every reference inside a value of a column type. The `id` cell of a table's first column is the row's
 * own ID name, not a reference: callers do not pass it.
 */
export function forEachReference(value: Value, t: ColumnType, fn: (r: Reference) => void): void {
  if (value.k === 'null') return;
  if (t.k === 'ref') fn({ kind: 'ref', table: t.table, column: t.column, value });
  else if (value.k === 'idname') fn({ kind: 'idname', name: value.name });
  else if (t.k === 'string' && value.k === 'text') fn({ kind: 'text', text: value.v });
  else if (t.k === 'reskey' && value.k === 'text') fn({ kind: 'reskey', key: value.v });
  else if (value.k === 'list') forEachListReference(value.items, t, fn);
}

function forEachListReference(items: readonly Value[], t: ColumnType, fn: (r: Reference) => void): void {
  if (t.k === 'array' || t.k === 'array2') {
    const elem: ColumnType = t.k === 'array2' ? { k: 'array', elem: t.elem } : t.elem;
    for (const item of items) forEachReference(item, elem, fn);
    return;
  }
  if (t.k !== 'bundle') return;
  for (const item of items) {
    if (item.k !== 'tuple') continue;
    for (const [i, f] of t.fields.entries()) {
      const v = item.fields[i];
      if (v) forEachReference(v, f.type, fn);
    }
  }
}

/** Collects the tables of every ID name: `id` columns and the `requirement` rows. */
export function collectIds(ctx: RunContext): void {
  ctx.ids.clear();
  const add = (name: string, table: string): void => {
    const set = ctx.ids.get(name) ?? new Set<string>();
    set.add(table);
    ctx.ids.set(name, set);
  };
  for (const table of ctx.data.tables.values()) {
    const id = table.columns[0];
    if (id?.type?.k !== 'id') continue;
    for (const row of table.rows) {
      const v = row.values.get('id');
      if (v?.k === 'idname') add(v.name, table.name);
    }
  }
  for (const r of ctx.requirementRows) add(r.name, 'requirement');
}

function targetValues(ctx: RunContext, table: string, col: string, cache: Map<string, Set<string>>): Set<string> {
  const key = `${table}.${col}`;
  let set = cache.get(key);
  if (!set) {
    const t = ctx.data.tables.get(table);
    set = new Set(t ? t.rows.map((r) => r.values.get(col)).filter((v) => v !== undefined).map(valueKey) : []);
    cache.set(key, set);
  }
  return set;
}

function checkIdName(ctx: RunContext, name: string, place: Place, label: string): void {
  if (!ID_NAME.test(name)) ctx.diags.add('bad_name', place, `${label}: ID name ${name} is not [a-z0-9_]+ in brackets`);
  else if (!ctx.ids.has(name)) ctx.diags.add('ref_missing', place, `${label}: ID name ${name} is not in any table`);
}

function checkReference(ctx: RunContext, r: Reference, place: Place, label: string, cache: Map<string, Set<string>>): void {
  if (r.kind === 'idname') checkIdName(ctx, r.name, place, label);
  else if (r.kind === 'text') for (const name of idNamesIn(r.text)) checkIdName(ctx, name, place, label);
  else if (r.kind === 'reskey') {
    if (!ctx.resources.has(r.key)) ctx.diags.add('resource_missing', place, `${label}: resource ${r.key} is not in resource/resources.csv`);
  } else {
    const target = ctx.data.tables.get(r.table);
    const isId = target?.columns[0]?.name === r.column;
    const found = isId && r.value.k === 'idname'
      ? (ctx.ids.get(r.value.name)?.has(r.table) ?? false)
      : targetValues(ctx, r.table, r.column, cache).has(valueKey(r.value));
    if (!found) ctx.diags.add('ref_missing', place, `${label}: ${valueKey(r.value)} is not a value of ${r.table}.${r.column}`);
  }
}

function checkReservedIdValues(ctx: RunContext, table: Table): void {
  const value = column(table, 'value');
  const id = table.columns[0];
  if (!value || !id) return;
  for (const row of table.rows) {
    const text = cellText(row, value);
    if (text === '') continue;
    const place = cellPlace(table, row, value);
    const name = cellText(row, id);
    const tables = ctx.ids.get(text);
    if (!tables || [...tables].every((t) => t === 'reserved_id')) {
      ctx.diags.add('ref_missing', place, `${name} value ${text} is not in the id column of another table`);
      continue;
    }
    const rowOf = ctx.core.allReserved.find((r) => r.table === 'reserved_id' && r.id === name)?.rowOf ?? null;
    if (rowOf !== null && !tables.has(rowOf)) ctx.diags.add('ref_missing', place, `${name} value ${text} is not a row of ${rowOf}`);
  }
}

function columnTypeOf(ctx: RunContext, table: Table, col: Column, rowId: string): ColumnType | null {
  if (table.name === 'game_setting' && col.name === 'value') return ctx.settingTypes.get(rowId) ?? null;
  if (table.name === 'reserved_id' && col.name === 'value') return null;
  return col.type;
}

/** Checks every ID name and `ref` value, and the `requirement` row targets. */
export function checkReferences(ctx: RunContext): void {
  const cache = new Map<string, Set<string>>();
  for (const table of ctx.data.tables.values()) {
    if (table.name === 'reserved_id') checkReservedIdValues(ctx, table);
    for (const row of table.rows) {
      const rowId = table.columns[0] ? cellText(row, table.columns[0]) : '';
      for (const col of table.columns.slice(1)) {
        const t = columnTypeOf(ctx, table, col, rowId);
        const v = row.values.get(col.name);
        if (t === null || v === undefined) continue;
        const place = cellPlace(table, row, col);
        forEachReference(v, t, (r) => { checkReference(ctx, r, place, `${table.name}.${col.name}`, cache); });
      }
    }
  }
  for (const r of ctx.requirementRows) {
    if (r.targetForm.kind !== 'ref' || r.target === null) continue;
    if (!(ctx.ids.get(r.target)?.has(r.targetForm.table) ?? false)) ctx.diags.add('ref_missing', r.place, `requirement target ${r.target} is not a row of ${r.targetForm.table}`);
  }
}

/** ID names that data uses must not start like the names the data tool makes. */
export function checkMadeNames(ctx: RunContext): void {
  for (const table of ctx.data.tables.values()) {
    const id = table.columns[0];
    if (!id) continue;
    for (const row of table.rows) {
      if (cellText(row, id).startsWith('[req__')) ctx.diags.add('reserved_name', cellPlace(table, row, id), `${cellText(row, id)} starts like the requirement row names the data tool makes`);
    }
  }
}

function refEdges(ctx: RunContext, table: Table): Map<string, string[]> {
  const edges = new Map<string, string[]>();
  const id = table.columns[0];
  if (!id) return edges;
  for (const row of table.rows) {
    const from = `${table.name}\u0000${cellText(row, id)}`;
    const list = edges.get(from) ?? [];
    for (const col of table.columns.slice(1)) {
      const v = row.values.get(col.name);
      if (col.type === null || v === undefined) continue;
      forEachReference(v, col.type, (r) => {
        const target = r.kind === 'ref' ? ctx.data.tables.get(r.table) : undefined;
        if (r.kind === 'ref' && r.value.k === 'idname' && target?.columns[0]?.name === r.column) list.push(`${r.table}\u0000${r.value.name}`);
      });
    }
    edges.set(from, list);
  }
  return edges;
}

/** `cycle`: following `ref` values comes back to the same row. A depth-first walk with an explicit stack. */
export function checkCycles(ctx: RunContext): void {
  const edges = new Map<string, string[]>();
  const places = new Map<string, Place>();
  for (const table of ctx.data.tables.values()) {
    for (const [k, v] of refEdges(ctx, table)) edges.set(k, [...(edges.get(k) ?? []), ...v]);
    const id = table.columns[0];
    if (id) for (const row of table.rows) places.set(`${table.name}\u0000${cellText(row, id)}`, cellPlace(table, row, id));
  }
  const state = new Map<string, 1 | 2>();
  const reported = new Set<string>();
  const report = (path: readonly string[], next: string): void => {
    const cycle = path.slice(path.lastIndexOf(next));
    const first = [...cycle].sort()[0] as string;
    if (reported.has(first)) return;
    reported.add(first);
    ctx.diags.add('cycle', places.get(first) ?? filePlace(''), `ref values come back: ${[...cycle, next].map((n) => n.replace('\u0000', ' ')).join(' -> ')}`);
  };
  for (const start of edges.keys()) {
    if (state.has(start)) continue;
    const path: string[] = [start];
    const next: number[] = [0];
    state.set(start, 1);
    while (path.length > 0) {
      const node = path[path.length - 1] as string;
      const i = next[next.length - 1] as number;
      const out = edges.get(node) ?? [];
      if (i >= out.length) {
        state.set(node, 2);
        path.pop();
        next.pop();
        continue;
      }
      next[next.length - 1] = i + 1;
      const to = out[i] as string;
      if (state.get(to) === 1) report(path, to);
      else if (!state.has(to)) {
        state.set(to, 1);
        path.push(to);
        next.push(0);
      }
    }
  }
}

/** `data/simulation_tables.csv`: header `table`, existing tables, each once. */
export function checkSimulationTables(ctx: RunContext): void {
  const file = ctx.data.simulationTables;
  if (file === null || !file.exists) return;
  if (file.header.length !== 1 || file.header[0] !== SIMULATION_TABLES_HEADER[0]) {
    ctx.diags.add('structure', filePlace(file.file), 'the header is not table');
    return;
  }
  const seen = new Set<string>();
  for (const r of file.records) {
    const name = flatText(r, 'table');
    if (!ctx.data.tables.has(name)) ctx.diags.add('ref_missing', flatPlace(file, r, 'table'), `table ${name} is not there`);
    if (seen.has(name)) ctx.diags.add('duplicate', flatPlace(file, r, 'table'), `table ${name} is in the file twice`);
    seen.add(name);
  }
}

/** Tables of `data/simulation_tables.csv`. */
export function simulationTables(ctx: RunContext): Set<string> {
  return new Set((ctx.data.simulationTables?.records ?? []).map((r) => flatText(r, 'table')));
}
