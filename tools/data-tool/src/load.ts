/** Reads the `data/` folder of a game into memory and checks the form of each file. */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, join } from 'node:path';
import { decodeUtf8, parseCsv, type CsvCell, type CsvRecord } from './csv.ts';
import { type Diagnostics, filePlace } from './diag.ts';
import type { Column, FlatFile, FlatRecord, Row, Table } from './model.ts';
import { BUILD_TARGETS, isSnakeCase, parseColumnType, type BuildTarget } from './types.ts';

export const SYSTEM_TABLES = ['game_setting', 'reserved_id', 'reserved_string', 'reserved_sound'] as const;

/** The schema of the system tables (`data` skill `## system table`). */
export const SYSTEM_SCHEMA: Readonly<Record<string, readonly [string, string, BuildTarget][]>> = {
  game_setting: [['id', 'id(key)', 'All'], ['target', 'string', 'None'], ['data_type', 'string', 'None'], ['value', 'string', 'All']],
  reserved_id: [['id', 'id(key)', 'All'], ['target', 'string', 'None'], ['value', 'string', 'All']],
  reserved_string: [['id', 'id(key)', 'All'], ['text', 'tstring<id>', 'All']],
  reserved_sound: [['id', 'id(key)', 'All'], ['sound', 'reskey', 'Client']],
};

function isBlank(r: CsvRecord): boolean {
  return r.cells.length === 1 && r.cells[0]?.text === '';
}

/**
 * Reads a CSV file into records; null (with a `structure` line) when it is not UTF-8 RFC 4180. Blank lines after the
 * first `headerRows` records are not records.
 */
export function readCsvFile(path: string, file: string, diags: Diagnostics, headerRows: number): CsvRecord[] | null {
  const text = decodeUtf8(readFileSync(path));
  if (text === null) {
    diags.add('structure', filePlace(file), 'the file is not UTF-8');
    return null;
  }
  const parsed = parseCsv(text);
  if (!parsed.ok) {
    diags.add('structure', { file, line: parsed.line, col: parsed.col }, `the file is not RFC 4180 CSV: ${parsed.message}`);
    return null;
  }
  return parsed.records.filter((r, i) => i < headerRows || !isBlank(r));
}

function headerCell(records: CsvRecord[], row: number, col: number): CsvCell {
  return records[row]?.cells[col] ?? { text: '', line: row + 1, col: col + 1 };
}

function readColumn(file: string, records: CsvRecord[], index: number, diags: Diagnostics): Column | null {
  const name = headerCell(records, 3, index);
  const target = headerCell(records, 1, index);
  const type = headerCell(records, 2, index);
  if (name.text.startsWith('#')) {
    if (target.text !== '' || type.text !== '') diags.add('structure', { file, line: target.line, col: index + 1 }, `comment column ${name.text} has a build target or a type`);
    return null;
  }
  const at = { file, line: name.line, col: index + 1 };
  if (!isSnakeCase(name.text)) diags.add('bad_name', at, `column name ${JSON.stringify(name.text)} is not snake_case`);
  if (!BUILD_TARGETS.includes(target.text as BuildTarget)) diags.add('structure', { file, line: target.line, col: index + 1 }, `build target ${JSON.stringify(target.text)} is not Client, Server, All or None`);
  const parsed = parseColumnType(type.text);
  const place = { file, line: type.line, col: index + 1 };
  if (parsed === null) diags.add('structure', place, `${JSON.stringify(type.text)} is not a column type`);
  return {
    index, name: name.text, description: headerCell(records, 0, index).text,
    target: BUILD_TARGETS.includes(target.text as BuildTarget) ? (target.text as BuildTarget) : 'None',
    typeText: type.text, type: parsed, place,
  };
}

function checkFirstColumn(file: string, columns: Column[], records: CsvRecord[], diags: Diagnostics): void {
  const first = columns[0];
  const firstCell = headerCell(records, 3, 0);
  if (first?.index !== 0 || first.name !== 'id' || first.type?.k !== 'id' || first.target !== 'All') {
    diags.add('structure', { file, line: firstCell.line, col: 1 }, 'the first column is not id with type id or id(key) and build target All');
  }
}

function isKeyColumn(col: Column | undefined): boolean {
  const k = col?.type?.k;
  return k === 'id' || k === 'int' || k === 'long' || k === 'enum';
}

function checkKeyColumns(columns: Column[], diags: Diagnostics): void {
  const keyed = columns[0]?.type?.k === 'id' && columns[0].type.key;
  for (const col of columns) {
    const t = col.type;
    if (t === null || (t.k !== 'tstring' && t.k !== 'requirement')) continue;
    if (t.k === 'requirement' && (t.keyCols === null) === !keyed) {
      diags.add('structure', col.place, keyed ? 'a table whose first column is id(key) uses requirement<...>' : 'a table whose first column is id uses requirement without key columns');
    }
    for (const name of t.keyCols ?? []) {
      if (!isKeyColumn(columns.find((c) => c.name === name))) diags.add('structure', col.place, `key column ${name} of ${col.typeText} is not an ID name, integer or enum column`);
    }
  }
}

/** Reads the 4-row header table of a CSV file. */
export function readTable(path: string, file: string, kind: 'system' | 'tables', diags: Diagnostics): Table | null {
  const name = basename(file, '.csv');
  if (!isSnakeCase(name)) diags.add('bad_name', filePlace(file), `table name ${JSON.stringify(name)} is not snake_case`);
  const records = readCsvFile(path, file, diags, 4);
  if (records === null) return null;
  if (records.length < 4) {
    diags.add('structure', filePlace(file), 'the header is not 4 rows');
    return null;
  }
  const width = (records[3] as CsvRecord).cells.length;
  for (const r of records) {
    if (r.cells.length !== width) diags.add('structure', { file, line: r.line, col: 1 }, `the record has ${String(r.cells.length)} fields, not ${String(width)}`);
  }
  const columns: Column[] = [];
  for (let i = 0; i < width; i += 1) {
    const col = readColumn(file, records, i, diags);
    if (col === null) continue;
    if (columns.some((c) => c.name === col.name)) diags.add('duplicate', { file, line: 4, col: i + 1 }, `column ${col.name} is in the header twice`);
    columns.push(col);
  }
  checkFirstColumn(file, columns, records, diags);
  checkKeyColumns(columns, diags);
  const data = records.slice(4).map((r) => r.cells);
  return {
    name, file, kind, columns, header: records.slice(0, 4).map((r) => r.cells.map((c) => c.text)),
    records: data, rows: rowsOf(records.slice(4)), changed: false,
  };
}

/** The built rows of records: the ones whose first cell does not start with `#`. */
export function rowsOf(records: readonly CsvRecord[]): Row[] {
  return records.filter((r) => !(r.cells[0]?.text ?? '').startsWith('#')).map((r) => ({ line: r.line, cells: r.cells, values: new Map() }));
}

/** Whether a fixed-format file has exactly this header. */
export function sameHeader(file: FlatFile, header: readonly string[]): boolean {
  return file.header.length === header.length && file.header.every((h, i) => h === header[i]);
}

/** Reads a file with a 1-row header; a file that is not there reads as the header without records. */
export function readFlatFile(root: string, file: string, header: readonly string[], diags: Diagnostics): FlatFile | null {
  const path = join(root, file);
  if (!existsSync(path)) return { file, header: [...header], records: [], exists: false, changed: false };
  const records = readCsvFile(path, file, diags, 1);
  if (records === null) return null;
  const head = records[0]?.cells.map((c) => c.text) ?? [];
  const flat: FlatRecord[] = records.slice(1).map((r) => {
    const cells = new Map<string, CsvCell>();
    for (const [i, name] of head.entries()) {
      const cell = r.cells[i];
      if (cell) cells.set(name, cell);
    }
    return { line: r.line, cells };
  });
  for (const r of records.slice(1)) {
    if (r.cells.length !== head.length) diags.add('structure', { file, line: r.line, col: 1 }, `the record has ${String(r.cells.length)} fields, not ${String(head.length)}`);
  }
  return { file, header: head, records: flat, exists: true, changed: false };
}

/** CSV file names of a folder, sorted; empty when the folder is not there. */
export function csvFiles(dir: string): string[] {
  if (!existsSync(dir) || !statSync(dir).isDirectory()) return [];
  return readdirSync(dir).filter((f) => f.endsWith('.csv')).sort();
}

/** Files of a folder that are not CSV files. */
export function otherFiles(dir: string): string[] {
  if (!existsSync(dir) || !statSync(dir).isDirectory()) return [];
  return readdirSync(dir).filter((f) => !f.endsWith('.csv')).sort();
}
