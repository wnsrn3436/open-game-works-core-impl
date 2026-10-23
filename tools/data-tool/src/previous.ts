/**
 * Checks against the PROD data tag data of `--previous`: `protocol_change` and `prod_change` (`data` skill
 * `## data version`, `resource` skill `## resource key`).
 */
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { valueContext } from './check-tables.ts';
import type { RunContext } from './context.ts';
import { readDataFolder, type DataFolder } from './data.ts';
import { Diagnostics, filePlace } from './diag.ts';
import { readFlatFile } from './load.ts';
import { cellText, column, flatText, type FlatFile, type Row, type Table } from './model.ts';
import { targetsOf, type Target } from './schema.ts';
import { parseCell, valueKey } from './values.ts';

const ACCESSOR_TABLES = ['game_setting', 'reserved_id', 'reserved_string', 'reserved_sound'];
const UNCHECKED_ID_TABLES = new Set(['requirement', 'banned_word']);
const RESOURCES_FILE = 'resource/resources.csv';

export interface Previous {
  root: string;
  data: DataFolder;
  /** `resource/resources.csv` of the PROD data tag; null when it did not read. */
  resources: FlatFile | null;
  /** Protocol hash of each build target's `data_version`; null when it has none. */
  protocols: Record<Target, string | null>;
  /** `client/build/data/data_version` of the previous build. */
  clientVersion: string | null;
}

function readVersion(path: string): string | null {
  if (!existsSync(path)) return null;
  const v = readFileSync(path, 'utf8').trim();
  return /^[0-9a-f]{64}-[0-9a-f]{64}$/.test(v) ? v : null;
}

/**
 * Files of the `--previous` folder the checks against it read and that did not read: a table, `data/simulation_tables.csv`
 * or `resource/resources.csv` that is not UTF-8 RFC 4180 or whose header is cut short.
 */
function unreadFiles(data: DataFolder, resources: FlatFile | null): Set<string> {
  const out = new Set<string>();
  for (const name of data.unread) {
    const system = `data/system/${name}.csv`;
    out.add(existsSync(join(data.root, system)) ? system : `data/tables/${name}.csv`);
  }
  if (data.simulationTables === null) out.add('data/simulation_tables.csv');
  if (resources === null) out.add(RESOURCES_FILE);
  return out;
}

/**
 * Reads the `--previous` folder; a string when it is not a folder with a finished binary build, that is, without the
 * server `data_version` of the data version form. Other problems with its data files do not make lines, since it was
 * built before, except a file the checks against it read that does not read: the checks would pass without it, so it
 * is a `structure` ERROR line at that file of the `--previous` folder.
 */
export function readPrevious(root: string, ctx: RunContext, clientBuildDir: string): Previous | string {
  if (!existsSync(root) || !statSync(root).isDirectory()) return `${root} is not a folder`;
  const serverFile = join(root, 'server', 'build', 'data', 'data_version');
  if (!existsSync(serverFile)) return `${root} has no finished binary build: ${serverFile} is not there`;
  const server = readVersion(serverFile);
  if (server === null) return `${serverFile} is not a data version`;
  const read = new Diagnostics(false);
  const data = readDataFolder(root, ctx.languages, ctx.sourceLanguage, read);
  const resources = readFlatFile(root, RESOURCES_FILE, ['key'], read);
  const unread = unreadFiles(data, resources);
  for (const d of read.items) {
    if (d.code !== 'structure' || !unread.has(d.file)) continue;
    ctx.diags.add('structure', { ...d, file: join(root, d.file) }, `the PROD data tag file of --previous does not read, so the checks against it cannot run: ${d.message}`);
  }
  const client = readVersion(join(root, clientBuildDir, 'data_version'));
  return { root, data, resources, protocols: { Server: server.split('-')[0] ?? null, Client: client?.split('-')[0] ?? null }, clientVersion: client };
}

function idOf(table: Table, row: Row): string {
  const id = table.columns[0];
  return id ? cellText(row, id) : '';
}

function checkAccessorRows(ctx: RunContext, prev: Previous, sameProtocol: readonly Target[]): void {
  for (const name of ACCESSOR_TABLES) {
    const before = prev.data.tables.get(name);
    const now = ctx.data.tables.get(name);
    if (!before) continue;
    const nowRows = new Map((now?.rows ?? []).map((r) => [idOf(now as Table, r), r]));
    for (const row of before.rows) {
      const id = idOf(before, row);
      const target = column(before, 'target');
      const inSame = target ? sameProtocol.some((t) => targetsOf(cellText(row, target)).has(t)) : sameProtocol.length > 0;
      if (!inSame) continue;
      const current = nowRows.get(id);
      const place = filePlace(now?.file ?? before.file);
      if (!current || !now) {
        ctx.diags.add('protocol_change', place, `${name} row ${id} that an accessor reads was deleted under the same protocol hash`);
        continue;
      }
      checkSettingRow(ctx, name, before, row, now, current);
    }
  }
}

function checkSettingRow(ctx: RunContext, name: string, before: Table, row: Row, now: Table, current: Row): void {
  const id = idOf(before, row);
  const place = { file: now.file, line: current.line, col: 1 };
  const type = column(before, 'data_type');
  const nowType = column(now, 'data_type');
  if (name === 'game_setting' && type && nowType && cellText(row, type) !== cellText(current, nowType)) {
    ctx.diags.add('protocol_change', place, `game_setting ${id} data_type changed under the same protocol hash`);
  }
  const target = column(before, 'target');
  const nowTarget = column(now, 'target');
  if (target && nowTarget) {
    const was = targetsOf(cellText(row, target));
    const is = targetsOf(cellText(current, nowTarget));
    if ([...was].some((t) => !is.has(t))) ctx.diags.add('protocol_change', place, `${name} ${id} target shrank under the same protocol hash`);
  }
}

function checkKeyKinds(ctx: RunContext, prev: Previous): void {
  for (const [name, before] of prev.data.tables) {
    const now = ctx.data.tables.get(name);
    const a = before.columns[0]?.type;
    const b = now?.columns[0]?.type;
    if (now && a?.k === 'id' && b?.k === 'id' && a.key !== b.key) ctx.diags.add('protocol_change', filePlace(now.file), `${name} first column changed between id and id(key) under the same protocol hash`);
  }
}

function checkDeletedIds(ctx: RunContext, prev: Previous): void {
  for (const [name, before] of prev.data.tables) {
    if (UNCHECKED_ID_TABLES.has(name)) continue;
    const now = ctx.data.tables.get(name);
    const have = new Set((now?.rows ?? []).map((r) => idOf(now as Table, r)));
    for (const row of before.rows) {
      const id = idOf(before, row);
      if (!have.has(id)) ctx.diags.add('protocol_change', filePlace(now?.file ?? before.file), `${id} of table ${name} in the PROD data tag data is not in the table`);
    }
  }
}

function cellKey(ctx: RunContext, table: Table, row: Row, name: string): string {
  const col = column(table, name);
  if (!col) return '';
  const text = cellText(row, col);
  if (col.type === null || col.type.k === 'requirement') return text;
  const p = parseCell(text, col.type, valueContext(ctx));
  return p.ok ? valueKey(p.value) : text;
}

function groupsOf(table: Table): Map<string, Row[]> {
  const out = new Map<string, Row[]>();
  for (const row of table.rows) {
    const list = out.get(idOf(table, row));
    if (list) list.push(row);
    else out.set(idOf(table, row), [row]);
  }
  return out;
}

function checkSimulationRows(ctx: RunContext, prev: Previous): void {
  const names = new Set([
    ...(ctx.data.simulationTables?.records ?? []).map((r) => flatText(r, 'table')),
    ...(prev.data.simulationTables?.records ?? []).map((r) => flatText(r, 'table')),
  ]);
  for (const name of names) {
    const before = prev.data.tables.get(name);
    const now = ctx.data.tables.get(name);
    if (before && now) compareTableRows(ctx, name, before, now);
  }
}

/** Sorted cell keys of the rows of a group; each entry is one row's keys of `names` when `names` has several. */
function sortedKeys(ctx: RunContext, table: Table, rows: readonly Row[], names: readonly string[]): string[] {
  return rows.map((r) => JSON.stringify(names.map((n) => cellKey(ctx, table, r, n)))).sort();
}

/** Each ID name group, as a multiset of rows of the compared columns: row order has no meaning. */
function compareTableRows(ctx: RunContext, name: string, before: Table, now: Table): void {
  const columns = before.columns.slice(1).filter((c) => c.target !== 'None' && column(now, c.name) !== undefined && column(now, c.name)?.target !== 'None').map((c) => c.name);
  const nowGroups = groupsOf(now);
  const same = (a: readonly string[], b: readonly string[]): boolean => a.length === b.length && a.every((x, i) => x === b[i]);
  for (const [id, rows] of groupsOf(before)) {
    const current = nowGroups.get(id) ?? [];
    if (current.length === 0 || same(sortedKeys(ctx, before, rows, columns), sortedKeys(ctx, now, current, columns))) continue;
    const line = current[0]?.line ?? 1;
    const changed = columns.filter((c) => !same(sortedKeys(ctx, before, rows, [c]), sortedKeys(ctx, now, current, [c])));
    for (const c of changed) ctx.diags.add('prod_change', { file: now.file, line, col: (column(now, c)?.index ?? 0) + 1 }, `${name} ${id} ${c} changed; the table is in data/simulation_tables.csv`);
    if (changed.length === 0) ctx.diags.add('prod_change', { file: now.file, line, col: 1 }, `${name} ${id} rows changed; the table is in data/simulation_tables.csv`);
  }
}

function checkResources(ctx: RunContext, prev: Previous): void {
  for (const r of prev.resources?.records ?? []) {
    const key = flatText(r, 'key');
    if (key !== '' && !ctx.resources.has(key)) ctx.diags.add('prod_change', filePlace(RESOURCES_FILE), `resource key ${key} of the PROD data tag was deleted`);
  }
}

/** Every check against the PROD data tag data. */
export function checkPrevious(ctx: RunContext, prev: Previous, protocols: Record<Target, string>): void {
  const same = (['Client', 'Server'] as const).filter((t) => prev.protocols[t] !== null && prev.protocols[t] === protocols[t]);
  if (same.length > 0) {
    checkAccessorRows(ctx, prev, same);
    checkKeyKinds(ctx, prev);
  }
  checkDeletedIds(ctx, prev);
  checkSimulationRows(ctx, prev);
  checkResources(ctx, prev);
}
