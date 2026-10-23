/** Data check result lines: `<file>:<line>:<column> <ERROR|WARN> <code> <message>`. */

export type Severity = 'ERROR' | 'WARN';

export type CheckCode =
  | 'structure'
  | 'bad_name'
  | 'reserved_name'
  | 'value_type'
  | 'empty_required'
  | 'duplicate'
  | 'ref_missing'
  | 'required_missing'
  | 'out_of_range'
  | 'order'
  | 'cycle'
  | 'resource_missing'
  | 'translation_format'
  | 'translation_missing'
  | 'translation_stale'
  | 'glossary_missing'
  | 'banned_word_missing'
  | 'protocol_change'
  | 'prod_change';

export interface Diagnostic {
  file: string;
  line: number;
  col: number;
  severity: Severity;
  code: CheckCode;
  message: string;
}

/** A place in a data file. */
export interface Place {
  file: string;
  line: number;
  col: number;
}

/** Codes that are always WARN. `resource_missing` is WARN unless the run is strict. */
const ALWAYS_WARN: ReadonlySet<CheckCode> = new Set(['translation_missing', 'translation_stale', 'banned_word_missing']);

export class Diagnostics {
  readonly items: Diagnostic[] = [];
  private readonly strict: boolean;

  constructor(strict: boolean) {
    this.strict = strict;
  }

  /** Adds a line; the severity follows the code. */
  add(code: CheckCode, place: Place, message: string): void {
    const warn = ALWAYS_WARN.has(code) || (code === 'resource_missing' && !this.strict);
    this.items.push({ ...place, severity: warn ? 'WARN' : 'ERROR', code, message });
  }

  hasErrors(): boolean {
    return this.items.some((d) => d.severity === 'ERROR');
  }

  /** True when an ERROR line of `code` was added for `file`. */
  hasError(code: CheckCode, file: string): boolean {
    return this.items.some((d) => d.severity === 'ERROR' && d.code === code && d.file === file);
  }

  /** The result lines in file, line, column order. */
  lines(): string[] {
    const sorted = [...this.items].sort((a, b) => compareBytes(a.file, b.file) || a.line - b.line || a.col - b.col);
    const seen = new Set<string>();
    const out: string[] = [];
    for (const d of sorted) {
      const line = `${d.file}:${String(d.line)}:${String(d.col)} ${d.severity} ${d.code} ${d.message}`;
      if (seen.has(line)) continue;
      seen.add(line);
      out.push(line);
    }
    return out;
  }
}

const encoder = new TextEncoder();

/** Byte order of the UTF-8 encodings of two strings. */
export function compareBytes(a: string, b: string): number {
  if (a === b) return 0;
  const x = encoder.encode(a);
  const y = encoder.encode(b);
  const n = Math.min(x.length, y.length);
  for (let i = 0; i < n; i += 1) {
    const d = (x[i] as number) - (y[i] as number);
    if (d !== 0) return d;
  }
  return x.length - y.length;
}

/** The place of a whole file. */
export function filePlace(file: string): Place {
  return { file, line: 1, col: 1 };
}
