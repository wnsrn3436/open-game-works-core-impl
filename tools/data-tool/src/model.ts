/** The data folder in memory: tables with the 4-row header and the fixed-format files. */
import type { CsvCell } from './csv.ts';
import type { Place } from './diag.ts';
import type { BuildTarget, ColumnType } from './types.ts';
import type { Value } from './values.ts';

export interface Column {
  /** 0-based index of the column in the CSV record. */
  index: number;
  name: string;
  description: string;
  target: BuildTarget;
  typeText: string;
  /** null when the type cell is not a type. */
  type: ColumnType | null;
  /** Place of the type cell (header line 3). */
  place: Place;
}

export interface Row {
  line: number;
  cells: CsvCell[];
  /** Parsed cell values by column name, filled by the value check. */
  values: Map<string, Value>;
}

export type TableKind = 'system' | 'tables' | 'requirement' | 'empty';

export interface Table {
  name: string;
  /** Path relative to the game folder, `data/...`. Empty for tables that have no file. */
  file: string;
  kind: TableKind;
  /** Columns that are not comment columns, in header order. */
  columns: Column[];
  /** Header rows as read (4 rows of cells), used to keep comment columns when the file is written. */
  header: string[][];
  /** Rows that are built: their `id` cell does not start with `#`. */
  rows: Row[];
  /** Every data record, including the ones that are not built. Rows share these cell arrays. */
  records: CsvCell[][];
  /** True when the in-memory table differs from the file. */
  changed: boolean;
}

export function column(table: Table, name: string): Column | undefined {
  return table.columns.find((c) => c.name === name);
}

/** The text of a row's cell; empty when the record is short. */
export function cellText(row: Row, col: Column): string {
  return row.cells[col.index]?.text ?? '';
}

/** The place of a row's cell. */
export function cellPlace(table: Table, row: Row, col: Column): Place {
  return { file: table.file, line: row.cells[col.index]?.line ?? row.line, col: col.index + 1 };
}

export function rowPlace(table: Table, row: Row): Place {
  return { file: table.file, line: row.line, col: 1 };
}

/** One record of a file with a 1-row header, as cells keyed by header name. */
export interface FlatRecord {
  line: number;
  cells: Map<string, CsvCell>;
}

export interface FlatFile {
  file: string;
  /** Header names as read. */
  header: string[];
  records: FlatRecord[];
  /** False when the file was not there; such a file reads as a header without records. */
  exists: boolean;
  changed: boolean;
}

export function flatText(record: FlatRecord, name: string): string {
  return record.cells.get(name)?.text ?? '';
}

export function flatPlace(file: FlatFile, record: FlatRecord, name: string): Place {
  const cell = record.cells.get(name);
  return { file: file.file, line: cell?.line ?? record.line, col: cell?.col ?? 1 };
}

/** Sets a cell of a flat record, keeping its place when it has one. */
export function setFlat(record: FlatRecord, name: string, text: string): void {
  const cell = record.cells.get(name);
  if (cell) cell.text = text;
  else record.cells.set(name, { text, line: record.line, col: 1 });
}

export function newFlatRecord(values: Record<string, string>): FlatRecord {
  const cells = new Map<string, CsvCell>();
  for (const [k, v] of Object.entries(values)) cells.set(k, { text: v, line: 0, col: 1 });
  return { line: 0, cells };
}

/** Sets the line and column of every record and cell to where they are when the file is written. */
export function renumber(file: FlatFile): void {
  let line = 2;
  for (const r of file.records) {
    r.line = line;
    let breaks = 0;
    for (const [i, name] of file.header.entries()) {
      const cell = r.cells.get(name);
      if (!cell) continue;
      cell.line = line;
      cell.col = i + 1;
      breaks += cell.text.split('\n').length - 1;
    }
    line += 1 + breaks;
  }
}
