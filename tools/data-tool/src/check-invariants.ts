/** `data/invariants.csv` (`data` skill `## enum and invariant`). */
import type { RunContext } from './context.ts';
import { INVARIANTS_HEADER } from './data.ts';
import { filePlace, type Place } from './diag.ts';
import { sameHeader } from './load.ts';
import { cellText, column, flatPlace, flatText, type FlatFile, type Table } from './model.ts';
import { valueKey, type Value } from './values.ts';

type Inv = Record<(typeof INVARIANTS_HEADER)[number], string>;

function intOf(v: Value | undefined): bigint | null {
  return v?.k === 'int' ? v.v : null;
}

/** An invariant bound: an integer, or a `game_setting` ID name of an integer row. */
function bound(ctx: RunContext, text: string): bigint | null {
  if (/^-?[0-9]+$/.test(text)) return BigInt(text);
  const table = ctx.data.tables.get('game_setting');
  const id = table?.columns[0];
  const row = table && id ? table.rows.find((r) => cellText(r, id) === text) : undefined;
  return intOf(row?.values.get('value'));
}

function groups(table: Table, group: string): Map<string, Table['rows']> {
  const out = new Map<string, Table['rows']>();
  const col = group === '' ? undefined : column(table, group);
  for (const row of table.rows) {
    const key = col ? cellText(row, col) : '';
    const list = out.get(key);
    if (list) list.push(row);
    else out.set(key, [row]);
  }
  return out;
}

function keyRange(ctx: RunContext, inv: Inv, table: Table, place: Place): void {
  const min = bound(ctx, inv.min);
  const max = bound(ctx, inv.max);
  if (min === null || max === null) {
    ctx.diags.add('structure', place, 'key_range min and max are integers or integer game_setting ID names');
    return;
  }
  for (const [g, rows] of groups(table, inv.group)) {
    const have = new Set(rows.map((r) => intOf(r.values.get(inv.column))).filter((v) => v !== null));
    for (let k = min; k <= max; k += 1n) {
      if (have.has(k)) continue;
      ctx.diags.add('required_missing', place, `key_range ${inv.table}.${inv.column}${g === '' ? '' : ` group ${g}`} has no ${k.toString()}`);
      break;
    }
  }
}

function childExists(ctx: RunContext, inv: Inv, table: Table, place: Place): void {
  const child = ctx.data.tables.get(inv.child_table);
  if (!child || !column(child, inv.child_column)) {
    ctx.diags.add('ref_missing', place, `child_exists ${inv.child_table}.${inv.child_column} is not a column`);
    return;
  }
  const have = new Set(child.rows.map((r) => r.values.get(inv.child_column)).filter((v) => v !== undefined).map(valueKey));
  for (const row of table.rows) {
    const v = row.values.get(inv.column);
    if (v === undefined || have.has(valueKey(v))) continue;
    const col = column(table, inv.column);
    ctx.diags.add('required_missing', { file: table.file, line: row.line, col: (col?.index ?? 0) + 1 }, `child_exists: ${valueKey(v)} of ${inv.table}.${inv.column} has no ${inv.child_table}.${inv.child_column} row`);
  }
}

function orderColumn(ctx: RunContext, inv: Inv, table: Table): void {
  const col = column(table, inv.column);
  for (const [g, rows] of groups(table, inv.group)) {
    const values = rows.map((r) => intOf(r.values.get(inv.column)));
    const sorted = values.filter((v) => v !== null).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    const ok = sorted.length === rows.length && sorted.every((v, i) => v === BigInt(i + 1));
    if (!ok) {
      const row = rows[0];
      ctx.diags.add('order', { file: table.file, line: row?.line ?? 1, col: (col?.index ?? 0) + 1 }, `order_column ${inv.table}.${inv.column}${g === '' ? '' : ` group ${g}`} is not 1 to ${String(rows.length)} without gaps`);
    }
  }
}

function checkOne(ctx: RunContext, file: FlatFile, r: FlatFile['records'][number]): void {
  const inv = Object.fromEntries(INVARIANTS_HEADER.map((h) => [h, flatText(r, h)])) as Inv;
  const place = flatPlace(file, r, 'kind');
  const table = ctx.data.tables.get(inv.table);
  if (!table || !column(table, inv.column) || (inv.group !== '' && !column(table, inv.group))) {
    ctx.diags.add('ref_missing', place, `invariant ${inv.kind} names ${inv.table}.${inv.column}${inv.group === '' ? '' : ` group ${inv.group}`}, which is not a column`);
    return;
  }
  if (inv.kind === 'key_range') keyRange(ctx, inv, table, place);
  else if (inv.kind === 'child_exists') childExists(ctx, inv, table, place);
  else if (inv.kind === 'order_column') orderColumn(ctx, inv, table);
  else ctx.diags.add('structure', place, `kind ${JSON.stringify(inv.kind)} is not key_range, child_exists or order_column`);
}

/** Checks the form of `data/invariants.csv` and every invariant. */
export function checkInvariants(ctx: RunContext): void {
  const file = ctx.data.invariants;
  if (file === null) return;
  if (!sameHeader(file, INVARIANTS_HEADER)) {
    ctx.diags.add('structure', filePlace(file.file), `the header is not ${INVARIANTS_HEADER.join(',')}`);
    return;
  }
  for (const r of file.records) checkOne(ctx, file, r);
}
