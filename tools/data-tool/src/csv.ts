/** RFC 4180 CSV reading and writing with the position of every cell. */

export interface CsvCell {
  text: string;
  /** 1-based line of the first character of the cell. */
  line: number;
  /** 1-based column number of the cell in its record. */
  col: number;
}

export interface CsvRecord {
  line: number;
  cells: CsvCell[];
}

export type CsvResult = { ok: true; records: CsvRecord[] } | { ok: false; line: number; col: number; message: string };

const decoder = new TextDecoder('utf-8', { fatal: true });

/** Decodes UTF-8 bytes; null when the bytes are not UTF-8. A leading byte order mark is dropped. */
export function decodeUtf8(bytes: Uint8Array): string | null {
  try {
    const text = decoder.decode(bytes);
    return text.startsWith('﻿') ? text.slice(1) : text;
  } catch {
    return null;
  }
}

interface ParseState {
  text: string;
  pos: number;
  line: number;
  records: CsvRecord[];
  cells: CsvCell[];
  recordLine: number;
}

function endRecord(s: ParseState): void {
  s.records.push({ line: s.recordLine, cells: s.cells });
  s.cells = [];
}

/** Reads a quoted field starting at the opening quote; returns an error message or null. */
function readQuoted(s: ParseState, cell: CsvCell): string | null {
  s.pos += 1;
  let value = '';
  for (;;) {
    if (s.pos >= s.text.length) return 'unterminated quoted field';
    const ch = s.text[s.pos] as string;
    if (ch === '"') {
      if (s.text[s.pos + 1] === '"') {
        value += '"';
        s.pos += 2;
        continue;
      }
      s.pos += 1;
      break;
    }
    if (ch === '\n') s.line += 1;
    value += ch;
    s.pos += 1;
  }
  cell.text = value;
  const next = s.text[s.pos];
  if (next !== undefined && next !== ',' && next !== '\n' && next !== '\r') return 'character after the closing quote';
  return null;
}

/** Reads an unquoted field; returns an error message or null. */
function readPlain(s: ParseState, cell: CsvCell): string | null {
  const start = s.pos;
  while (s.pos < s.text.length) {
    const ch = s.text[s.pos];
    if (ch === ',' || ch === '\n' || ch === '\r') break;
    if (ch === '"') return 'quote in an unquoted field';
    s.pos += 1;
  }
  cell.text = s.text.slice(start, s.pos);
  return null;
}

/** Consumes the separator after a field; true when the record ended. */
function readSeparator(s: ParseState): boolean | string {
  const ch = s.text[s.pos];
  if (ch === undefined) return true;
  if (ch === ',') {
    s.pos += 1;
    return false;
  }
  if (ch === '\r') {
    if (s.text[s.pos + 1] !== '\n') return 'carriage return without line feed';
    s.pos += 1;
  }
  s.pos += 1;
  s.line += 1;
  return true;
}

/** Parses CSV text. A final line break does not start a record. */
export function parseCsv(text: string): CsvResult {
  const s: ParseState = { text, pos: 0, line: 1, records: [], cells: [], recordLine: 1 };
  while (s.pos < text.length) {
    if (s.cells.length === 0) s.recordLine = s.line;
    const cell: CsvCell = { text: '', line: s.line, col: s.cells.length + 1 };
    const error = text[s.pos] === '"' ? readQuoted(s, cell) : readPlain(s, cell);
    if (error !== null) return { ok: false, line: s.line, col: cell.col, message: error };
    s.cells.push(cell);
    const ended = readSeparator(s);
    if (typeof ended === 'string') return { ok: false, line: s.line, col: cell.col, message: ended };
    if (ended) {
      endRecord(s);
      continue;
    }
    if (s.pos >= text.length) {
      s.cells.push({ text: '', line: s.line, col: s.cells.length + 1 });
      endRecord(s);
    }
  }
  return { ok: true, records: s.records };
}

function quote(field: string): string {
  return /[",\r\n]/.test(field) ? `"${field.replaceAll('"', '""')}"` : field;
}

/** Writes records as CSV with LF line breaks and a final line break. */
export function writeCsv(rows: readonly (readonly string[])[]): string {
  return rows.map((row) => row.map(quote).join(',')).join('\n') + (rows.length > 0 ? '\n' : '');
}
