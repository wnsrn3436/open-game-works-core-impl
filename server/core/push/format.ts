/**
 * Push text: format arguments, formatters and culture rules of the `data` skill `### format`, for the value kinds
 * a `PushArg` carries (`integer` and `string`).
 */

/** A format argument value: `integer` (`bigint`) or `string`. */
export type ArgValue = bigint | string;

/** A format argument or input prompt token of a text: `{name}` or `{name:formatter}`. */
export interface Token {
  readonly name: string;
  readonly formatter: string | null;
  readonly start: number;
  readonly end: number;
}

/** The same token pattern as the data tool's `translation_format` check. */
const TOKEN = /\{([^{}:]*)(?::([^{}]*))?\}/g;

/** The format arguments of a text, in order. Input prompt tokens (`{action:...}`) are left out. */
export function format_tokens(text: string): Token[] {
  const out: Token[] = [];
  for (const m of text.matchAll(TOKEN)) {
    const name = m[1] ?? '';
    if (name === 'action') continue;
    out.push({ name, formatter: m[2] ?? null, start: m.index, end: m.index + m[0].length });
  }
  return out;
}

const PARTICLES: Readonly<Record<string, readonly [string, string]>> = {
  '은/는': ['은', '는'],
  '이/가': ['이', '가'],
  '을/를': ['을', '를'],
  '와/과': ['과', '와'],
  '으로/로': ['으로', '로'],
};

const PLURAL = /^plural:([^/]*)\/([^/]*)$/;

/** Whether a formatter takes a value kind (`### format` table); false for a text that is not a formatter. */
export function formatter_takes(formatter: string | null, kind: 'integer' | 'string'): boolean {
  if (formatter === null || formatter in PARTICLES) return true;
  if (formatter === 'compact') return true;
  if (formatter === 'n' || PLURAL.test(formatter)) return kind === 'integer';
  if (formatter === 'ordinal' || formatter === 'date' || formatter === 'datetime' || formatter === 'duration') return kind === 'integer';
  return false;
}

/** A contract big integer: `0`, or an optional `-` and ASCII digits starting with 1 to 9. */
export function is_big_integer(text: string): boolean {
  return /^(0|-?[1-9][0-9]*)$/.test(text);
}

interface Culture {
  readonly ordinal: (n: string, abs: bigint) => string;
  readonly duration: readonly [string, string, string, string];
  readonly compact: readonly (readonly [number, string])[];
  readonly date: string;
  readonly datetime: string;
}

function en_ordinal(n: string, abs: bigint): string {
  const two = abs % 100n;
  const one = abs % 10n;
  if (two >= 11n && two <= 13n) return `${n}th`;
  return `${n}${one === 1n ? 'st' : one === 2n ? 'nd' : one === 3n ? 'rd' : 'th'}`;
}

const CULTURES: Readonly<Record<string, Culture>> = {
  ko: { ordinal: (n) => `${n}번째`, duration: ['일', '시간', '분', '초'], compact: [[4, '만'], [8, '억'], [12, '조'], [16, '경']], date: 'yyyy.MM.dd', datetime: 'yyyy.MM.dd HH:mm' },
  en: { ordinal: en_ordinal, duration: ['d', 'h', 'm', 's'], compact: [[3, 'K'], [6, 'M'], [9, 'B'], [12, 'T']], date: 'MM/dd/yyyy', datetime: 'MM/dd/yyyy HH:mm' },
  ja: { ordinal: (n) => `${n}番目`, duration: ['日', '時間', '分', '秒'], compact: [[4, '万'], [8, '億'], [12, '兆'], [16, '京']], date: 'yyyy/MM/dd', datetime: 'yyyy/MM/dd HH:mm' },
  'zh-Hans': { ordinal: (n) => `第${n}`, duration: ['天', '小时', '分钟', '秒'], compact: [[4, '万'], [8, '亿'], [12, '万亿']], date: 'yyyy/M/d', datetime: 'yyyy/M/d HH:mm' },
};

/** The culture rule of a language `code`: the code, then without its last subtag, and so on; `en` at the end. */
function culture_of(language: string): Culture {
  let code = language;
  for (;;) {
    const found = CULTURES[code];
    if (found !== undefined) return found;
    const cut = code.lastIndexOf('-');
    if (cut < 0) return CULTURES.en as Culture;
    code = code.slice(0, cut);
  }
}

const INT64_MIN = -(2n ** 63n);
const INT64_MAX = 2n ** 63n - 1n;

function abs(v: bigint): bigint {
  return v < 0n ? -v : v;
}

/** Thousands separators on the digits of a non-negative integer. */
function group(digits: string): string {
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

function n_format(v: bigint): string {
  return `${v < 0n ? '-' : ''}${group(abs(v).toString())}`;
}

/** `digits` cut toward 0 to 3 significant digits with `point` after `int_len` digits, trailing zeros removed. */
function three_digits(digits: string, int_len: number): string {
  const int_part = digits.slice(0, int_len);
  const frac = digits.slice(int_len, Math.max(int_len, 3)).replace(/0+$/, '');
  return frac === '' ? int_part : `${int_part}.${frac}`;
}

function compact_format(v: bigint, culture: Culture): string {
  const a = abs(v);
  const sign = v < 0n ? '-' : '';
  const digits = a.toString();
  let unit: readonly [number, string] | null = null;
  for (const u of culture.compact) if (10n ** BigInt(u[0]) <= a) unit = u;
  if (unit === null) return `${sign}${group(digits)}`;
  const [e, label] = unit;
  const int_len = digits.length - e;
  const last = unit === culture.compact[culture.compact.length - 1];
  if (last && int_len >= 5) return `${sign}${three_digits(digits, 1)}e${String(digits.length - 1)}`;
  return `${sign}${three_digits(digits, int_len)}${label}`;
}

function duration_format(v: bigint, culture: Culture): string {
  const sizes = [86_400_000n, 3_600_000n, 60_000n, 1000n];
  const a = abs(v);
  const parts = sizes.map((size, i) => (i === 0 ? a / size : (a % (sizes[i - 1] as bigint)) / size));
  const first = parts.findIndex((p) => p !== 0n);
  if (first < 0) return `0${culture.duration[3]}`;
  const out = [`${String(parts[first])}${culture.duration[first] as string}`];
  const next = parts[first + 1];
  if (next !== undefined && next !== 0n) out.push(`${String(next)}${culture.duration[first + 1] as string}`);
  return `${v < 0n ? '-' : ''}${out.join(' ')}`;
}

const DAY_MS = 86_400_000n;

function floor_div(a: bigint, b: bigint): bigint {
  const q = a / b;
  return (a % b !== 0n && (a < 0n) !== (b < 0n)) ? q - 1n : q;
}

/** The proleptic Gregorian UTC date of a day number since 1970-01-01 (days-from-civil, inverted). */
function civil_of(days: bigint): { year: bigint; month: bigint; day: bigint } {
  const z = days + 719_468n;
  const era = floor_div(z, 146_097n);
  const doe = z - era * 146_097n;
  const yoe = (doe - doe / 1460n + doe / 36_524n - doe / 146_096n) / 365n;
  const doy = doe - (365n * yoe + yoe / 4n - yoe / 100n);
  const mp = (5n * doy + 2n) / 153n;
  const day = doy - (153n * mp + 2n) / 5n + 1n;
  const month = mp < 10n ? mp + 3n : mp - 9n;
  return { year: yoe + era * 400n + (month <= 2n ? 1n : 0n), month, day };
}

function pad(v: bigint, width: number): string {
  return v.toString().padStart(width, '0');
}

/** `date` or `datetime` text, or null when the year is not 1 to 9999. */
function date_format(ms: bigint, offset_ms: bigint, pattern: string): string | null {
  const local = ms + offset_ms;
  const days = floor_div(local, DAY_MS);
  const in_day = local - days * DAY_MS;
  const { year, month, day } = civil_of(days);
  if (year < 1n || year > 9999n) return null;
  const values: Readonly<Record<string, string>> = {
    yyyy: pad(year, 4),
    MM: pad(month, 2),
    M: month.toString(),
    dd: pad(day, 2),
    d: day.toString(),
    HH: pad(in_day / 3_600_000n, 2),
    mm: pad((in_day % 3_600_000n) / 60_000n, 2),
  };
  return pattern.replace(/yyyy|MM|M|dd|d|HH|mm/g, (part) => values[part] ?? part);
}

const DIGIT_BATCHIM: Readonly<Record<string, 'none' | 'rieul' | 'other'>> = {
  '0': 'other', '1': 'rieul', '2': 'none', '3': 'other', '4': 'none', '5': 'none', '6': 'other', '7': 'rieul', '8': 'rieul', '9': 'none',
};

/** The last code point of a text, or null for an empty text. */
function last_code_point(text: string): number | null {
  if (text === '') return null;
  const at = text.length - 1;
  const unit = text.charCodeAt(at);
  const start = unit >= 0xdc00 && unit <= 0xdfff && at > 0 ? at - 1 : at;
  return text.codePointAt(start) ?? null;
}

/** The final consonant of the last character as read in Korean: none, ㄹ, or another one. */
function batchim(text: string): 'none' | 'rieul' | 'other' {
  const code = last_code_point(text);
  if (code === null) return 'none';
  const last = String.fromCodePoint(code);
  if (code >= 0xac00 && code <= 0xd7a3) {
    const final = (code - 0xac00) % 28;
    return final === 0 ? 'none' : final === 8 ? 'rieul' : 'other';
  }
  const digit = DIGIT_BATCHIM[last];
  if (digit !== undefined) return digit;
  const letter = last.toUpperCase();
  if (letter === 'L' || letter === 'R') return 'rieul';
  if (letter === 'M' || letter === 'N') return 'other';
  return 'none';
}

function particle_format(text: string, formatter: string): string {
  const [with_final, without] = PARTICLES[formatter] as readonly [string, string];
  const final = batchim(text);
  if (formatter === '으로/로') return `${text}${final === 'other' ? with_final : without}`;
  return `${text}${final === 'none' ? without : with_final}`;
}

/** The formatters that take only an integer, by name. */
const INTEGER_FORMATTERS: Readonly<Record<string, (v: bigint, culture: Culture, offset_ms: bigint) => string | null>> = {
  n: (v) => n_format(v),
  ordinal: (v, culture) => culture.ordinal(v.toString(), abs(v)),
  duration: (v, culture) => duration_format(v, culture),
  date: (v, culture, offset_ms) => date_format(v, offset_ms, culture.date),
  datetime: (v, culture, offset_ms) => date_format(v, offset_ms, culture.datetime),
};

function integer_format(v: bigint, formatter: string, culture: Culture, offset_ms: bigint): string | null {
  const named = INTEGER_FORMATTERS[formatter];
  if (named !== undefined) return named(v, culture, offset_ms);
  const plural = PLURAL.exec(formatter);
  if (plural !== null) return v === 1n ? (plural[1] ?? '') : (plural[2] ?? '');
  return null;
}

/** Formats one value; null when the formatter does not take it or the result has no value (an error slot). */
export function format_value(arg: ArgValue, formatter: string | null, language: string, offset_ms: bigint): string | null {
  const value = arg === INT64_MIN ? INT64_MAX : arg;
  const plain = typeof value === 'bigint' ? value.toString() : value;
  if (formatter === null) return plain;
  if (formatter in PARTICLES) return particle_format(plain, formatter);
  const culture = culture_of(language);
  if (formatter === 'compact') {
    if (typeof value === 'bigint') return compact_format(value, culture);
    return is_big_integer(value) ? compact_format(BigInt(value), culture) : null;
  }
  return typeof value === 'bigint' ? integer_format(value, formatter, culture, offset_ms) : null;
}

/** A formatted text and the names of the arguments whose slot is empty because they did not format. */
export interface Formatted {
  readonly text: string;
  readonly errors: readonly string[];
}

/** Fills the format arguments of `text` from `args`. A slot that does not format is empty and named in `errors`. */
export function format_text(text: string, args: ReadonlyMap<string, ArgValue>, language: string, offset_ms: bigint): Formatted {
  let out = '';
  let at = 0;
  const errors: string[] = [];
  for (const token of format_tokens(text)) {
    out += text.slice(at, token.start);
    at = token.end;
    const value = args.get(token.name);
    const result = value === undefined ? null : format_value(value, token.formatter, language, offset_ms);
    if (result === null) errors.push(token.name);
    else out += result;
  }
  return { text: out + text.slice(at), errors };
}
