/** Cell values by column type (`data` skill `## type`). */
import type { CheckCode } from './diag.ts';
import { isCommaType, isRefTargetType, type ColumnType } from './types.ts';

export type Value =
  | { k: 'null' }
  /** `int`, `long`, `datetime` (Unix ms) and `duration` (ms). */
  | { k: 'int'; v: bigint }
  /** An ID name in an `id`, `ref` or integer cell, with the brackets. */
  | { k: 'idname'; name: string }
  /** `float` and `double`, with the cell text. */
  | { k: 'float'; v: number; text: string }
  | { k: 'bool'; v: boolean }
  /** `string`, `tstring` and `reskey` text. */
  | { k: 'text'; v: string }
  | { k: 'enum'; element: string }
  | { k: 'vector'; v: number[] }
  | { k: 'list'; items: Value[] }
  | { k: 'tuple'; fields: Value[] }
  /** `requirement`: the ID name of the top `requirement` row, null for no condition. */
  | { k: 'req'; name: string | null };

export type Parsed = { ok: true; value: Value } | { ok: false; code: CheckCode; message: string };

/** What the parser needs to know about the rest of the data. */
export interface ValueContext {
  /** Elements of each enum type. */
  enumElements(type: string): ReadonlySet<string> | undefined;
  /** The type of a `ref` target column; undefined when there is no such column. */
  refTarget(table: string, column: string): ColumnType | null | undefined;
}

const INT32_MIN = -(2n ** 31n);
const INT32_MAX = 2n ** 31n - 1n;
const INT64_MIN = -(2n ** 63n);
const INT64_MAX = 2n ** 63n - 1n;
const FLOAT_MAX = 3.4028234663852886e38;

export const ID_NAME = /^\[([a-z0-9_]+)\]$/;
const BRACKETED = /^\[[^[\]]*\]$/;

export const RESOURCE_TYPES: ReadonlySet<string> = new Set([
  'image', 'sprite_sheet', 'texture_atlas', 'icon', 'background', 'nine_slice', 'model', 'rig', 'material', 'texture',
  'skybox', 'sprite_animation', 'rig_animation_2d', 'animation_3d', 'tween', 'particle', 'shader', 'sfx', 'bgm',
  'voice', 'haptic', 'font', 'tileset', 'scene', 'prefab', 'app_icon', 'splash',
]);

const NAME_WORD = /^[a-z0-9]+(_[a-z0-9]+)*$/;

/** Whether a text is a resource key `<type>/<name>` (`resource` skill `## resource key`). */
export function isResourceKey(text: string): boolean {
  const parts = text.split('/');
  if (parts.length < 2 || !RESOURCE_TYPES.has(parts[0] as string)) return false;
  return parts.slice(1).every((p) => NAME_WORD.test(p));
}

function ok(value: Value): Parsed {
  return { ok: true, value };
}

function fail(code: CheckCode, message: string): Parsed {
  return { ok: false, code, message };
}

/** An ID name cell: `[a-z0-9_]+` in brackets. */
export function parseIdName(text: string): Parsed {
  if (ID_NAME.test(text)) return ok({ k: 'idname', name: text });
  if (BRACKETED.test(text)) return fail('bad_name', `ID name ${text} is not [a-z0-9_]+ in brackets`);
  return fail('value_type', `${JSON.stringify(text)} is not an ID name`);
}

function parseInteger(text: string, min: bigint, max: bigint, allowIdName: boolean): Parsed {
  if (allowIdName && text.startsWith('[')) return parseIdName(text);
  if (!/^-?[0-9]+$/.test(text)) return fail('value_type', `${JSON.stringify(text)} is not an integer`);
  const v = BigInt(text);
  if (v < min || v > max) return fail('value_type', `${text} is out of the range of the type`);
  return ok({ k: 'int', v });
}

/** An integer in the int64 range, written as an integer cell is; null when it is not one. */
export function parseInt64(text: string): bigint | null {
  const p = parseInteger(text, INT64_MIN, INT64_MAX, false);
  return p.ok && p.value.k === 'int' ? p.value.v : null;
}

function parseReal(text: string, single: boolean): Parsed {
  if (!/^-?[0-9]+(\.[0-9]+)?$/.test(text)) return fail('value_type', `${JSON.stringify(text)} is not a real number with a decimal point`);
  const v = Number(text);
  if (!Number.isFinite(v) || (single && Math.abs(v) > FLOAT_MAX)) return fail('value_type', `${text} is out of the range of the type`);
  return ok({ k: 'float', v: single ? Math.fround(v) : v, text });
}

const DATETIME = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?Z$/;

/** Unix ms of an ISO 8601 UTC datetime with `Z`; null when it is not one. */
export function parseDatetime(text: string): bigint | null {
  const m = DATETIME.exec(text);
  if (!m) return null;
  const [y, mo, d, h, mi] = m.slice(1, 6).map(Number) as [number, number, number, number, number];
  const s = Number(m[6] ?? '0');
  const ms = Number((m[7] ?? '0').padEnd(3, '0'));
  const t = Date.UTC(y, mo - 1, d, h, mi, s, ms);
  const date = new Date(t);
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== mo - 1 || date.getUTCDate() !== d) return null;
  if (h > 23 || mi > 59 || s > 59) return null;
  return BigInt(t);
}

const DURATION_UNITS: readonly [string, bigint][] = [['d', 86_400_000n], ['h', 3_600_000n], ['m', 60_000n], ['s', 1000n], ['ms', 1n]];

/** ms of a duration like `1d2h30m`; null when it is not one. Units go from large to small, each at most once. */
export function parseDuration(text: string): bigint | null {
  const re = /(\d+)(ms|d|h|m|s)/y;
  let total = 0n;
  let last = -1;
  let pos = 0;
  while (pos < text.length) {
    re.lastIndex = pos;
    const m = re.exec(text);
    if (!m) return null;
    const unit = DURATION_UNITS.findIndex(([u]) => u === m[2]);
    if (unit <= last) return null;
    last = unit;
    total += BigInt(m[1] as string) * (DURATION_UNITS[unit] as [string, bigint])[1];
    pos = re.lastIndex;
  }
  return last < 0 ? null : total;
}

function parseTime(text: string, kind: 'datetime' | 'duration'): Parsed {
  const v = kind === 'datetime' ? parseDatetime(text) : parseDuration(text);
  if (v === null) return fail('value_type', `${JSON.stringify(text)} is not a ${kind}`);
  if (v > INT64_MAX) return fail('value_type', `${text} is out of the range of the type`);
  return ok({ k: 'int', v });
}

function parseEnum(text: string, enumType: string, ctx: ValueContext): Parsed {
  const elements = ctx.enumElements(enumType);
  if (text === '' || text === 'None') return fail('value_type', `enum ${enumType} cell is empty or None`);
  if (elements === undefined || !elements.has(text)) return fail('value_type', `${JSON.stringify(text)} is not an element of ${enumType}`);
  return ok({ k: 'enum', element: text });
}

/** The element texts of a vector cell: comma separated, trimmed. */
export function splitVector(text: string): string[] {
  return text.split(',').map((p) => p.trim());
}

function parseVector(text: string, size: number, elem: 'int' | 'float'): Parsed {
  const parts = splitVector(text);
  if (parts.length !== size) return fail('value_type', `${JSON.stringify(text)} does not have ${String(size)} elements`);
  const v: number[] = [];
  for (const part of parts) {
    const p = elem === 'int' ? parseInteger(part, INT32_MIN, INT32_MAX, false) : parseReal(part, true);
    if (!p.ok) return p;
    v.push(p.value.k === 'int' ? Number(p.value.v) : (p.value as { v: number }).v);
  }
  return ok({ k: 'vector', v });
}

/** `seen`: the `ref` target columns the parse goes through; one that comes back is not read again. */
function parseRef(text: string, t: Extract<ColumnType, { k: 'ref' }>, ctx: ValueContext, seen: ReadonlySet<string>): Parsed {
  const key = `${t.table}.${t.column}`;
  if (seen.has(key)) return fail('structure', `ref target ${key} comes back to itself`);
  const target = ctx.refTarget(t.table, t.column);
  if (target === undefined || target === null) return fail('ref_missing', `ref target ${key} is not a column`);
  if (!isRefTargetType(target)) return fail('structure', `ref target ${key} is not a column of one value`);
  return parseScalar(text, target, ctx, new Set([...seen, key]));
}

/** Splits an array cell: comma for comma types, line breaks otherwise. Elements are trimmed. */
export function splitElements(text: string, elem: ColumnType): string[] {
  if (text === '') return [];
  return isCommaType(elem) ? text.split(',').map((p) => p.trim()) : text.split(/\r?\n/);
}

function parseList(text: string, elem: ColumnType, ctx: ValueContext, seen: ReadonlySet<string>): Parsed {
  const items: Value[] = [];
  for (const part of splitElements(text, elem)) {
    const p = parseCell(part, elem, ctx, seen);
    if (!p.ok) return p;
    items.push(p.value);
  }
  return ok({ k: 'list', items });
}

function parseNested(text: string, elem: ColumnType, ctx: ValueContext, seen: ReadonlySet<string>): Parsed {
  if (text === '') return ok({ k: 'list', items: [] });
  const items: Value[] = [];
  for (const line of text.split(/\r?\n/)) {
    const p = parseList(line, elem, ctx, seen);
    if (!p.ok) return p;
    items.push(p.value);
  }
  return ok({ k: 'list', items });
}

function parseBundle(text: string, t: Extract<ColumnType, { k: 'bundle' }>, ctx: ValueContext, seen: ReadonlySet<string>): Parsed {
  if (text.trim() === '') return ok({ k: 'list', items: [] });
  const items: Value[] = [];
  for (const group of text.split(',')) {
    const parts = group.trim().split(/\s+/);
    if (parts.length !== t.fields.length) return fail('value_type', `${JSON.stringify(group.trim())} does not have ${String(t.fields.length)} fields`);
    const fields: Value[] = [];
    for (const [i, f] of t.fields.entries()) {
      const p = t.itemAmount && f.name === 'amount' ? parseBigInteger(parts[i] as string) : parseCell(parts[i] as string, f.type, ctx, seen);
      if (!p.ok) return p;
      fields.push(p.value);
    }
    items.push({ k: 'tuple', fields });
  }
  return ok({ k: 'list', items });
}

/** A contract big integer: `0`, or an optional `-` and ASCII digits starting with 1 to 9. */
export function parseBigInteger(text: string): Parsed {
  if (!/^(0|-?[1-9][0-9]*)$/.test(text)) return fail('value_type', `${JSON.stringify(text)} is not a big integer`);
  return ok({ k: 'int', v: BigInt(text) });
}

const SIMPLE_PARSERS: Readonly<Record<string, (text: string) => Parsed>> = {
  int: (text) => parseInteger(text, INT32_MIN, INT32_MAX, true),
  long: (text) => parseInteger(text, INT64_MIN, INT64_MAX, true),
  float: (text) => parseReal(text, true),
  double: (text) => parseReal(text, false),
  datetime: (text) => parseTime(text, 'datetime'),
  duration: (text) => parseTime(text, 'duration'),
  bool: (text) => (text === 'true' || text === 'false' ? ok({ k: 'bool', v: text === 'true' }) : fail('value_type', `${JSON.stringify(text)} is not true or false`)),
  string: (text) => ok({ k: 'text', v: text }),
  tstring: (text) => ok({ k: 'text', v: text }),
  reskey: (text) => (isResourceKey(text) ? ok({ k: 'text', v: text }) : fail('value_type', `${JSON.stringify(text)} is not a resource key`)),
  id: parseIdName,
  requirement: () => fail('value_type', 'requirement cells are read by the requirement reader'),
};

function parseScalar(text: string, t: ColumnType, ctx: ValueContext, seen: ReadonlySet<string>): Parsed {
  switch (t.k) {
    case 'enum': return parseEnum(text, t.enumType, ctx);
    case 'vector': return parseVector(text, t.size, t.elem);
    case 'ref': return parseRef(text, t, ctx, seen);
    case 'array': return parseList(text, t.elem, ctx, seen);
    case 'array2': return parseNested(text, t.elem, ctx, seen);
    case 'bundle': return parseBundle(text, t, ctx, seen);
    default: return (SIMPLE_PARSERS[t.k] as (text: string) => Parsed)(text);
  }
}

/** Whether an empty cell of the type is an error. */
function emptyIsError(t: ColumnType): boolean {
  return !['string', 'tstring', 'array', 'array2', 'bundle', 'requirement'].includes(t.k);
}

/** Parses a cell of a column type; `requirement` cells are not read here. */
export function parseCell(text: string, t: ColumnType, ctx: ValueContext, seen: ReadonlySet<string> = new Set()): Parsed {
  if (text === 'null' && 'nullable' in t && t.nullable) return ok({ k: 'null' });
  if (text === '' && t.k === 'enum') return fail('value_type', `enum ${t.enumType} cell is empty`);
  if (text === '' && emptyIsError(t)) return fail('empty_required', 'the cell is empty');
  return parseScalar(text, t, ctx, seen);
}

/** ID names inside a text: every `[...]`. */
export function idNamesIn(text: string): string[] {
  return [...text.matchAll(/\[[^[\]]*\]/g)].map((m) => m[0]);
}

/** Calls `fn` for every value inside a value, the value itself first. */
export function walkValue(value: Value, fn: (v: Value) => void): void {
  fn(value);
  if (value.k === 'list') for (const item of value.items) walkValue(item, fn);
  if (value.k === 'tuple') for (const field of value.fields) walkValue(field, fn);
}

/** A canonical text of a value, for comparing values written differently. */
export function valueKey(value: Value): string {
  switch (value.k) {
    case 'null': return 'null';
    case 'int': return `i${value.v.toString()}`;
    case 'idname': return value.name;
    case 'float': return `f${String(value.v)}`;
    case 'bool': return String(value.v);
    case 'text': return JSON.stringify(value.v);
    case 'enum': return `e${value.element}`;
    case 'vector': return `v${value.v.join(',')}`;
    case 'list': return `[${value.items.map(valueKey).join(';')}]`;
    case 'tuple': return `(${value.fields.map(valueKey).join(' ')})`;
    case 'req': return `r${value.name ?? ''}`;
  }
}
