/** Puts missing core data into the data folder and makes the `banned_word` rows (`data` skill `## core data`). */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { CsvCell } from './csv.ts';
import type { CoreData } from './corespec.ts';
import { type DataFolder, ENUMS_HEADER, INVARIANTS_HEADER, newSystemTable, newTable } from './data.ts';
import { rowsOf } from './load.ts';
import { flatText, newFlatRecord, type FlatFile, type Table } from './model.ts';

function cellsOf(table: Table, values: Record<string, string>): CsvCell[] {
  const width = table.header[3]?.length ?? 0;
  const line = table.records.length + 5;
  return Array.from({ length: width }, (_, i) => ({ text: values[table.header[3]?.[i] ?? ''] ?? '', line, col: i + 1 }));
}

/** Appends a record to a table and its rows. */
export function appendRecord(table: Table, values: Record<string, string>): void {
  const cells = cellsOf(table, values);
  table.records.push(cells);
  table.rows.push({ line: cells[0]?.line ?? 0, cells, values: new Map() });
  table.changed = true;
}

function ensureFlat(file: FlatFile | null, header: readonly string[]): FlatFile | null {
  if (file === null) return null;
  if (!file.exists && file.header.length === 0) file.header = [...header];
  return file;
}

function insertTables(data: DataFolder, core: CoreData): void {
  for (const name of core.tables) {
    if (data.tables.has(name) || data.unread.has(name)) continue;
    const spec = core.allTables.get(name)?.table;
    if (!spec) continue;
    const header = [spec.columns.map((c) => c.description), spec.columns.map((c) => c.target), spec.columns.map((c) => c.type), spec.columns.map((c) => c.name)];
    data.tables.set(name, newTable(name, `data/tables/${name}.csv`, 'tables', header));
  }
}

function insertEnums(data: DataFolder, core: CoreData): void {
  const file = ensureFlat(data.enums, ENUMS_HEADER);
  if (file === null) return;
  for (const [type, elements] of core.enums) {
    for (const [i, element] of elements.entries()) {
      if (file.records.some((r) => flatText(r, 'type') === type && flatText(r, 'element') === element)) continue;
      file.records.push(newFlatRecord({ type, element, value: String(i + 1) }));
      file.changed = true;
    }
  }
}

function insertInvariants(data: DataFolder, core: CoreData): void {
  const file = ensureFlat(data.invariants, INVARIANTS_HEADER);
  if (file === null) return;
  for (const inv of core.invariants) {
    const same = file.records.some((r) => INVARIANTS_HEADER.every((h) => flatText(r, h) === (inv[h] ?? '')));
    if (same) continue;
    file.records.push(newFlatRecord(Object.fromEntries(INVARIANTS_HEADER.map((h) => [h, inv[h] ?? '']))));
    file.changed = true;
  }
}

function insertReserved(data: DataFolder, core: CoreData): void {
  for (const r of core.reserved) {
    if (data.unread.has(r.table)) continue;
    let table = data.tables.get(r.table);
    if (!table) {
      table = newSystemTable(r.table);
      table.changed = false;
      data.tables.set(r.table, table);
    }
    const idCol = table.header[3]?.indexOf('id') ?? -1;
    if (idCol < 0 || table.records.some((cells) => cells[idCol]?.text === r.id)) continue;
    appendRecord(table, r.table === 'reserved_id' ? { id: r.id, target: r.target } : { id: r.id });
  }
}

/** Puts the missing core data into the folder (in memory). */
export function insertCoreData(data: DataFolder, core: CoreData): void {
  insertTables(data, core);
  insertEnums(data, core);
  insertInvariants(data, core);
  insertReserved(data, core);
}

/** `<language key>` of a language tag: lower case with `-` as `_`. */
export function languageKey(tag: string): string {
  return tag.toLowerCase().replaceAll('-', '_');
}

/** The words of a banned word list file: lines without U+000D and outer spaces that are not empty, with line numbers. */
export function bannedWords(text: string): { line: number; word: string }[] {
  return text.split('\n').map((l, i) => ({ line: i + 1, word: l.replace(/\r$/, '').trim() })).filter((w) => w.word !== '');
}

/** Remakes the `banned_word` rows from `records/setup/banned-words/<language>.txt` when it is core data. */
export function makeBannedWords(data: DataFolder, core: CoreData, languages: readonly string[]): void {
  const table = data.tables.get('banned_word');
  if (!core.tables.has('banned_word') || !table) return;
  const before = table.records.map((r) => r.map((c) => c.text).join('\u0000')).join('\n');
  table.records = [];
  table.rows = [];
  for (const lang of languages) {
    const path = join(data.root, 'records', 'setup', 'banned-words', `${lang}.txt`);
    if (!existsSync(path)) continue;
    for (const w of bannedWords(readFileSync(path, 'utf8'))) {
      table.records.push(cellsOf(table, { id: `[banned_${languageKey(lang)}_${String(w.line)}]`, word: w.word, match: 'Contains' }));
    }
  }
  table.rows = rowsOf(table.records.map((cells, i) => ({ line: i + 5, cells: cells.map((c) => ({ ...c, line: i + 5 })) })));
  table.records = table.rows.map((r) => r.cells);
  const after = table.records.map((r) => r.map((c) => c.text).join('\u0000')).join('\n');
  if (after !== before) table.changed = true;
}
