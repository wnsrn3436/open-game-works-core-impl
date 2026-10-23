/** Table headers against their schema, cell values, `id(key)` and requirement cells. */
import { enumSet, sameJson, settingAt, type RunContext } from './context.ts';
import { filePlace, type Place } from './diag.ts';
import { SYSTEM_SCHEMA } from './load.ts';
import { cellPlace, cellText, column, rowPlace, type Column, type Row, type Table } from './model.ts';
import { parseRequirement, requirementRows, rowKeyPart } from './requirement.ts';
import { isRefTargetType, parseColumnType, refsOf, type BuildTarget, type ColumnType } from './types.ts';
import { targetsOf } from './schema.ts';
import { keyPart } from './translation.ts';
import { parseCell, type Value, type ValueContext } from './values.ts';

function sameColumns(table: Table, want: readonly [string, string, BuildTarget][]): boolean {
  return table.columns.length === want.length
    && want.every(([name, type, target], i) => table.columns[i]?.name === name && table.columns[i].typeText === type && table.columns[i].target === target);
}

/** System tables and core data tables have the schema of the `data` skill and of `core-spec.json`. */
export function checkSchemas(ctx: RunContext): void {
  for (const table of ctx.data.tables.values()) {
    if (table.kind === 'system') {
      const want = SYSTEM_SCHEMA[table.name] ?? [];
      if (!sameColumns(table, want)) ctx.diags.add('structure', filePlace(table.file), `the columns are not ${want.map((c) => `${c[0]}:${c[1]}:${c[2]}`).join(', ')}`);
      continue;
    }
    const spec = ctx.core.allTables.get(table.name);
    if (!spec) continue;
    if (!ctx.core.tables.has(table.name)) {
      ctx.diags.add('reserved_name', filePlace(table.file), `${table.name} is a core table of module ${spec.module} that the game does not use`);
      continue;
    }
    const want = spec.table.columns.map((c) => [c.name, c.type, c.target] as [string, string, BuildTarget]);
    if (!sameColumns(table, want)) ctx.diags.add('structure', filePlace(table.file), `the header is not the core data header ${want.map((c) => `${c[0]}:${c[1]}:${c[2]}`).join(', ')}`);
  }
}

export function valueContext(ctx: RunContext): ValueContext {
  return {
    enumElements: (type) => enumSet(ctx, type),
    refTarget: (table, col) => {
      const t = ctx.data.tables.get(table);
      if (t === undefined) return undefined;
      return column(t, col)?.type;
    },
  };
}

function rowKey(table: Table, row: Row, keyCols: readonly string[] | null): string {
  if (keyCols === null) return rowKeyPart('id', cellText(row, table.columns[0] as Column));
  return keyCols.map((name) => {
    const part = keyPart(table, row, name);
    return rowKeyPart(part.kind, part.text);
  }).join('__');
}

/** Reads a requirement cell into `requirement` rows; the value is the top row's ID name. */
function readRequirementCell(ctx: RunContext, table: Table, row: Row, col: Column, keyCols: readonly string[] | null, target: BuildTarget, prefixes: Set<string>): void {
  const text = cellText(row, col);
  const place = cellPlace(table, row, col);
  if (text.trim() === '') {
    row.values.set(col.name, { k: 'req', name: null });
    return;
  }
  const parsed = parseRequirement(text);
  if (!parsed.ok) {
    ctx.diags.add('value_type', place, `requirement expression: ${parsed.message}`);
    return;
  }
  const prefix = `req__${table.name}__${col.name}__${rowKey(table, row, keyCols)}`;
  if (prefixes.has(prefix)) {
    ctx.diags.add('duplicate', place, `two rows of ${table.name}.${col.name} have the row key of [${prefix}__1]`);
    return;
  }
  prefixes.add(prefix);
  const rows = requirementRows(parsed.node, prefix, ctx.requirementForms, (t) => enumSet(ctx, t), place, targetsOf(target));
  if ('code' in rows) {
    ctx.diags.add(rows.code, place, `requirement expression: ${rows.message}`);
    return;
  }
  ctx.requirementRows.push(...rows);
  row.values.set(col.name, { k: 'req', name: (rows[0] as { name: string }).name });
}

/**
 * Why following the `ref` types from a column, column to column, is wrong: it comes back to a column it went
 * through, or it reaches a column that is not one value. Null when it is neither.
 */
function refProblem(ctx: RunContext, start: string): string | null {
  const done = new Set<string>();
  const walk = (key: string, path: Set<string>): string | null => {
    if (path.has(key)) return 'following its ref type comes back to a column it went through';
    if (done.has(key)) return null;
    const dot = key.indexOf('.');
    const table = ctx.data.tables.get(key.slice(0, dot));
    const type = table ? column(table, key.slice(dot + 1))?.type : undefined;
    if (path.size > 0 && type != null && !isRefTargetType(type)) return `following its ref type reaches ${key}, a column that is not one value`;
    path.add(key);
    let hit: string | null = null;
    for (const r of type == null ? [] : refsOf(type)) {
      hit = walk(`${r.table}.${r.column}`, path);
      if (hit !== null) break;
    }
    path.delete(key);
    done.add(key);
    return hit;
  };
  return walk(start, new Set());
}

/**
 * `structure` for each column whose `ref` type comes back to a column it follows or reaches a column that is not one
 * value; its cells are not read.
 */
function badRefColumns(ctx: RunContext): Set<Column> {
  const out = new Set<Column>();
  for (const table of ctx.data.tables.values()) {
    for (const col of table.columns) {
      if (col.type === null || refsOf(col.type).length === 0) continue;
      const problem = refProblem(ctx, `${table.name}.${col.name}`);
      if (problem === null) continue;
      ctx.diags.add('structure', col.place, `${table.name}.${col.name}: ${problem}`);
      out.add(col);
    }
  }
  return out;
}

/** Whether `test` holds for a cell value or a value inside it, with its type: array elements and bundle fields too. */
function someTyped(value: Value, t: ColumnType, test: (v: Value, t: ColumnType) => boolean): boolean {
  if (test(value, t)) return true;
  if (value.k !== 'list') return false;
  if (t.k === 'array' || t.k === 'array2') {
    const elem: ColumnType = t.k === 'array2' ? { k: 'array', elem: t.elem } : t.elem;
    return value.items.some((item) => someTyped(item, elem, test));
  }
  if (t.k !== 'bundle') return false;
  return value.items.some((item) => item.k === 'tuple' && t.fields.some((f, i) => {
    const v = item.fields[i];
    return v !== undefined && someTyped(v, f.type, test);
  }));
}

/** A `datetime?` value that is not null, anywhere in the cell, is more than 0: 0 is the value code reads as null. */
function checkNullableDatetimes(ctx: RunContext, place: Place, label: string, value: Value, t: ColumnType): void {
  const bad = someTyped(value, t, (v, vt) => vt.k === 'datetime' && vt.nullable && v.k === 'int' && v.v <= 0n);
  if (bad) ctx.diags.add('out_of_range', place, `${label}: a datetime? value that is not null is more than 0`);
}

function readCell(ctx: RunContext, vc: ValueContext, table: Table, row: Row, col: Column, prefixes: Set<string>): void {
  const t = col.type;
  if (t === null) return;
  if (t.k === 'requirement') {
    readRequirementCell(ctx, table, row, col, t.keyCols, col.target, prefixes);
    return;
  }
  const p = parseCell(cellText(row, col), t, vc);
  if (!p.ok) {
    ctx.diags.add(p.code, cellPlace(table, row, col), `${table.name}.${col.name}: ${p.message}`);
    return;
  }
  checkNullableDatetimes(ctx, cellPlace(table, row, col), `${table.name}.${col.name}`, p.value, t);
  row.values.set(col.name, p.value);
}

function checkKeys(ctx: RunContext, table: Table): void {
  const id = table.columns[0];
  if (id?.type?.k !== 'id' || !id.type.key) return;
  const seen = new Set<string>();
  for (const row of table.rows) {
    const name = cellText(row, id);
    if (seen.has(name)) ctx.diags.add('duplicate', cellPlace(table, row, id), `${name} is in the id(key) column twice`);
    seen.add(name);
  }
}

const SETTING_TARGETS = ['All', 'Client', 'Server'];

function settingType(ctx: RunContext, table: Table, row: Row): ColumnType | null {
  const col = column(table, 'data_type');
  if (!col) return null;
  const text = cellText(row, col);
  const t = parseColumnType(text);
  const bad = t === null || t.k === 'tstring' || ('nullable' in t && t.nullable) || (t.k === 'requirement' && t.keyCols !== null)
    || t.k === 'array2' || t.k === 'bundle';
  if (bad) {
    ctx.diags.add('value_type', cellPlace(table, row, col), `data_type ${JSON.stringify(text)} is not a type game_setting takes`);
    return null;
  }
  return t;
}

function rowTarget(ctx: RunContext, table: Table, row: Row): BuildTarget | null {
  const col = column(table, 'target');
  if (!col) return null;
  const text = cellText(row, col);
  if (SETTING_TARGETS.includes(text)) return text as BuildTarget;
  ctx.diags.add('value_type', cellPlace(table, row, col), `target ${JSON.stringify(text)} is not All, Client or Server`);
  return null;
}

function readGameSetting(ctx: RunContext, vc: ValueContext, table: Table, row: Row, prefixes: Set<string>): void {
  const target = rowTarget(ctx, table, row);
  const type = settingType(ctx, table, row);
  const value = column(table, 'value');
  const id = table.columns[0];
  if (type === null || target === null || !value || !id) return;
  ctx.settingTypes.set(cellText(row, id), type);
  if (type.k === 'requirement') {
    readRequirementCell(ctx, table, row, value, null, target, prefixes);
    return;
  }
  const p = parseCell(cellText(row, value), type, vc);
  if (!p.ok) {
    ctx.diags.add(p.code, cellPlace(table, row, value), `game_setting value: ${p.message}`);
    return;
  }
  checkNullableDatetimes(ctx, cellPlace(table, row, value), 'game_setting value', p.value, type);
  row.values.set('value', p.value);
}

function requiredTarget(ctx: RunContext, idName: string): 'Client' | 'Server' | 'All' | null {
  return ctx.core.reserved.find((r) => r.table === 'reserved_id' && r.id === idName)?.target ?? null;
}

function readReservedId(ctx: RunContext, table: Table, row: Row): void {
  const target = rowTarget(ctx, table, row);
  const id = table.columns[0];
  const value = column(table, 'value');
  if (!id || !value) return;
  const name = cellText(row, id);
  const need = requiredTarget(ctx, name);
  if (need !== null && target !== null && target !== 'All' && target !== need) {
    ctx.diags.add('out_of_range', cellPlace(table, row, column(table, 'target') as Column), `${name} target holds ${need}`);
  }
  const text = cellText(row, value);
  if (text === '') {
    const spec = ctx.core.allReserved.find((r) => r.table === 'reserved_id' && r.id === name);
    const when = spec?.requiredWhen ?? null;
    if (when === null || sameJson(settingAt(ctx.settings, when.path), when.value)) ctx.diags.add('empty_required', cellPlace(table, row, value), `${name} value is empty`);
    row.values.set('value', { k: 'text', v: '' });
    return;
  }
  if (!/^\[[^[\]]*\]$/.test(text)) ctx.diags.add('value_type', cellPlace(table, row, value), `${name} value ${JSON.stringify(text)} is not an ID name`);
  row.values.set('value', { k: 'text', v: text });
}

function readSystemRow(ctx: RunContext, vc: ValueContext, table: Table, row: Row, prefixes: Set<string>): void {
  const id = table.columns[0];
  if (id) readCell(ctx, vc, table, row, id, prefixes);
  if (table.name === 'game_setting') readGameSetting(ctx, vc, table, row, prefixes);
  else if (table.name === 'reserved_id') readReservedId(ctx, table, row);
  else for (const col of table.columns.slice(1)) readCell(ctx, vc, table, row, col, prefixes);
  if (table.name === 'reserved_string') {
    const text = column(table, 'text');
    if (text && cellText(row, text) === '') ctx.diags.add('empty_required', cellPlace(table, row, text), `${cellText(row, id as Column)} text is empty`);
  }
}

function checkRequiredReserved(ctx: RunContext): void {
  for (const r of ctx.core.reserved) {
    const table = ctx.data.tables.get(r.table);
    const id = table?.columns[0];
    if (table && id && table.rows.some((row) => cellText(row, id) === r.id)) continue;
    ctx.diags.add('required_missing', filePlace(table?.file ?? `data/system/${r.table}.csv`), `reserved row ${r.id} is not there`);
  }
}

/** The form of a BCP 47 tag: subtags of ASCII letters and digits joined by `-`, the first of letters. */
export const LANGUAGE_TAG = /^[A-Za-z]{1,8}(-[A-Za-z0-9]{1,8})*$/;

/**
 * `language.code` is a BCP 47 tag, and no two rows have the same one in lower case. The data tool checks it whatever
 * the modules are, because it names the translation binary `translation_<code>.bin` with it.
 */
function checkLanguageCodes(ctx: RunContext): void {
  const table = ctx.data.tables.get('language');
  const code = table ? column(table, 'code') : undefined;
  if (!table || !code) return;
  const seen = new Map<string, string>();
  for (const row of table.rows) {
    const text = cellText(row, code);
    const place = cellPlace(table, row, code);
    if (!LANGUAGE_TAG.test(text)) {
      ctx.diags.add('value_type', place, `language code ${JSON.stringify(text)} is not a BCP 47 tag`);
      continue;
    }
    const other = seen.get(text.toLowerCase());
    if (other !== undefined) ctx.diags.add('duplicate', place, `language code ${text} is the code ${other} of another row in lower case`);
    seen.set(text.toLowerCase(), text);
  }
}

/** Reads every cell of every table into values and checks them. */
export function checkValues(ctx: RunContext): void {
  const vc = valueContext(ctx);
  const prefixes = new Set<string>();
  const badRefs = badRefColumns(ctx);
  for (const table of ctx.data.tables.values()) {
    checkKeys(ctx, table);
    const columns = table.columns.filter((c) => !badRefs.has(c));
    for (const row of table.rows) {
      if (row.cells.length < table.columns.length) ctx.diags.add('structure', rowPlace(table, row), 'the record is short');
      if (table.kind === 'system') readSystemRow(ctx, vc, table, row, prefixes);
      else for (const col of columns) readCell(ctx, vc, table, row, col, prefixes);
    }
  }
  checkRequiredReserved(ctx);
  checkLanguageCodes(ctx);
}
