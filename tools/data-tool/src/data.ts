/** The whole `data/` folder of a game, read and written as a unit. */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { writeCsv } from './csv.ts';
import { type Diagnostics, filePlace } from './diag.ts';
import { csvFiles, otherFiles, readFlatFile, readTable, SYSTEM_SCHEMA, SYSTEM_TABLES } from './load.ts';
import { renumber, type FlatFile, type Table } from './model.ts';
import { parseColumnType } from './types.ts';

export const ENUMS_HEADER = ['type', 'element', 'value', '#comment'];
export const INVARIANTS_HEADER = ['kind', 'table', 'column', 'group', 'min', 'max', 'child_table', 'child_column'] as const;
export const REQUIREMENT_TYPES_HEADER = ['element', 'target', 'value', '#comment'];
export const SIMULATION_TABLES_HEADER = ['table'];
export const TRANSLATION_HEADER = ['key', 'source', 'source_hash', 'current_hash', 'text'];

export function glossaryHeader(languages: readonly string[]): string[] {
  return ['source', 'id_name', 'note', 'source_hash', ...languages];
}

export interface DataFolder {
  /** The game folder. */
  root: string;
  /** System tables and the tables of `data/tables/`, by table name. */
  tables: Map<string, Table>;
  enums: FlatFile | null;
  invariants: FlatFile | null;
  requirementTypes: FlatFile | null;
  simulationTables: FlatFile | null;
  glossary: FlatFile | null;
  /** Translation files by language tag of `supportedLanguages`. */
  translations: Map<string, FlatFile | null>;
  /** Names of the tables whose file is there but did not read: no core data goes in and the file is not written. */
  unread: Set<string>;
}

function readSystemTables(root: string, data: DataFolder, diags: Diagnostics): void {
  const dir = join(root, 'data', 'system');
  for (const f of otherFiles(dir)) diags.add('structure', filePlace(`data/system/${f}`), 'data/system/ holds only the system table CSV files');
  for (const f of csvFiles(dir)) {
    const file = `data/system/${f}`;
    const name = f.slice(0, -4);
    if (!(SYSTEM_TABLES as readonly string[]).includes(name)) {
      diags.add('structure', filePlace(file), `${name} is not a system table`);
      continue;
    }
    const table = readTable(join(dir, f), file, 'system', diags);
    if (table) data.tables.set(name, table);
    else data.unread.add(name);
  }
}

function readGameTables(root: string, data: DataFolder, diags: Diagnostics): void {
  const dir = join(root, 'data', 'tables');
  for (const f of csvFiles(dir)) {
    const file = `data/tables/${f}`;
    const name = f.slice(0, -4);
    if (name === 'requirement') {
      diags.add('structure', filePlace(file), 'data/tables/requirement.csv is made by the data tool and is not a file');
      continue;
    }
    if (data.tables.has(name)) {
      diags.add('duplicate', filePlace(file), `table ${name} is also a system table`);
      continue;
    }
    const table = readTable(join(dir, f), file, 'tables', diags);
    if (table) data.tables.set(name, table);
    else data.unread.add(name);
  }
}

/** Reads the data folder of a game. */
export function readDataFolder(root: string, languages: readonly string[], sourceLanguage: string, diags: Diagnostics): DataFolder {
  const data: DataFolder = {
    root, tables: new Map(), enums: null, invariants: null, requirementTypes: null, simulationTables: null,
    glossary: null, translations: new Map(), unread: new Set(),
  };
  readSystemTables(root, data, diags);
  readGameTables(root, data, diags);
  data.enums = readFlatFile(root, 'data/enums.csv', ENUMS_HEADER, diags);
  data.invariants = readFlatFile(root, 'data/invariants.csv', INVARIANTS_HEADER, diags);
  data.requirementTypes = readFlatFile(root, 'data/requirement_types.csv', REQUIREMENT_TYPES_HEADER, diags);
  data.simulationTables = readFlatFile(root, 'data/simulation_tables.csv', SIMULATION_TABLES_HEADER, diags);
  data.glossary = readFlatFile(root, 'data/glossary.csv', glossaryHeader(languages.filter((l) => l !== sourceLanguage)), diags);
  for (const lang of languages) data.translations.set(lang, readFlatFile(root, `data/translations/${lang}.csv`, TRANSLATION_HEADER, diags));
  return data;
}

/** A new system table with its schema header and no records. */
export function newSystemTable(name: string): Table {
  const schema = SYSTEM_SCHEMA[name] ?? [];
  const header = [schema.map(() => ''), schema.map((c) => c[2]), schema.map((c) => c[1]), schema.map((c) => c[0])];
  return newTable(name, `data/system/${name}.csv`, 'system', header);
}

/** A new table from header rows (description, build target, type, name), marked changed. */
export function newTable(name: string, file: string, kind: Table['kind'], header: string[][]): Table {
  const names = header[3] ?? [];
  const columns = names.map((n, index) => ({
    index, name: n, description: header[0]?.[index] ?? '', target: (header[1]?.[index] ?? 'None') as Table['columns'][number]['target'],
    typeText: header[2]?.[index] ?? '', type: parseColumnType(header[2]?.[index] ?? ''), place: { file, line: 3, col: index + 1 },
  }));
  return { name, file, kind, columns, header, records: [], rows: [], changed: true };
}

function tableText(table: Table): string {
  return writeCsv([...table.header, ...table.records.map((r) => r.map((c) => c.text))]);
}

function flatText(file: FlatFile): string {
  return writeCsv([file.header, ...file.records.map((r) => file.header.map((h) => r.cells.get(h)?.text ?? ''))]);
}

/**
 * The files the run changed, as path relative to the game folder and new text. While a table did not read, its texts
 * are unknown, so the translation files are not written either: their keys of that table would be deleted.
 */
export function changedFiles(data: DataFolder): Map<string, string> {
  const out = new Map<string, string>();
  for (const t of data.tables.values()) if (t.changed && t.file !== '' && !data.unread.has(t.name)) out.set(t.file, tableText(t));
  const translations = data.unread.size === 0 ? [...data.translations.values()] : [];
  const flats = [data.enums, data.invariants, data.requirementTypes, data.glossary, ...translations];
  for (const f of flats) {
    if (!f?.changed) continue;
    renumber(f);
    out.set(f.file, flatText(f));
  }
  for (const [file, text] of out) {
    const path = join(data.root, file);
    if (existsSync(path) && readFileSync(path, 'utf8') === text) out.delete(file);
  }
  return out;
}

/** Writes the changed files. */
export function writeChangedFiles(root: string, files: ReadonlyMap<string, string>): void {
  for (const [file, text] of files) {
    const path = join(root, file);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, text);
  }
}
