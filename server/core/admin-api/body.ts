/**
 * Body rules (processing order step 5): a JSON body or, for a binary body operation, the query string checked
 * against the operation's input fields, with the rules admin-api sets by field name.
 */
import { is_integer_text, is_plain_object, JsonNumber, plain_json, utf8_length } from './json.ts';
import type { AdminInput, FieldMap, FieldType } from './types.ts';

export interface BodyLimits {
  readonly max_string_bytes: number;
  readonly max_search_range_ms: bigint;
  readonly max_search_rows: number;
}

const INT64_MIN = -(2n ** 63n);
const INT64_MAX = 2n ** 63n - 1n;
const INT32_MIN = -(2 ** 31);
const INT32_MAX = 2 ** 31 - 1;
const BIG_INTEGER = /^(0|-?[1-9][0-9]*)$/;
/** A request name: `<Name>`, `core/<Name>`, `cheat/<Name>`, `core/cheat/<Name>`. */
const REQUEST_NAME = /^(core\/)?(cheat\/)?[A-Za-z][A-Za-z0-9_]*$/;
export const MATCH_REQUEST = 'MATCH_REQUEST';

/** True when the text is a contract big integer. */
export function is_big_integer(text: string): boolean {
  return BIG_INTEGER.test(text);
}

/** True when the text is a contract request name or `MATCH_REQUEST`. */
export function is_request_name(text: string): boolean {
  return text === MATCH_REQUEST || REQUEST_NAME.test(text);
}

/** A failed check. Returned, never thrown. */
const INVALID = Symbol('invalid');

/** The text of an integer: a JSON number, or a string where the field takes one. */
function integer_text(raw: unknown, query: boolean, string_ok: boolean): string | null {
  if (raw instanceof JsonNumber && !query) return raw.source;
  if (typeof raw === 'string' && string_ok) return raw;
  return null;
}

/** `int64`: a JSON integer or a decimal integer string (the query string has only strings). */
function int64_of(raw: unknown, query: boolean): unknown {
  const text = integer_text(raw, query, true);
  if (text === null || !is_integer_text(text)) return INVALID;
  const value = BigInt(text);
  return value >= INT64_MIN && value <= INT64_MAX ? value : INVALID;
}

/** `int32`: a JSON integer, or a decimal integer string in the query string. */
function int32_of(raw: unknown, query: boolean): unknown {
  const text = integer_text(raw, query, query);
  if (text === null || !is_integer_text(text)) return INVALID;
  const value = Number(text);
  return value >= INT32_MIN && value <= INT32_MAX ? value : INVALID;
}

function string_of(raw: unknown, limits: BodyLimits): unknown {
  return typeof raw === 'string' && utf8_length(raw) <= limits.max_string_bytes ? raw : INVALID;
}

function enum_of(raw: unknown, elements: readonly string[]): unknown {
  return typeof raw === 'string' && elements.includes(raw) ? raw : INVALID;
}

/** The rules admin-api sets on a field by its name. */
function name_rule(name: string, value: unknown, limits: BodyLimits): boolean {
  switch (name) {
    case 'user_id':
      return typeof value === 'bigint' && value >= 1n;
    case 'after_seq':
      return typeof value === 'bigint' && value >= 0n;
    case 'limit':
      return typeof value === 'number' && value >= 1 && value <= limits.max_search_rows;
    case 'operation_id':
      return typeof value === 'string' && value !== '';
    case 'big_amount':
      return typeof value === 'string' && (value === '' || is_big_integer(value));
    case 'request_name':
      return typeof value === 'string' && is_request_name(value);
    default:
      return true;
  }
}

function array_of(element: FieldType, raw: unknown, limits: BodyLimits, query: boolean): unknown {
  if (!Array.isArray(raw)) return INVALID;
  const items: unknown[] = [];
  for (const item of raw) {
    const checked = check_value(element, item, '', limits, query);
    if (checked === INVALID) return INVALID;
    items.push(checked);
  }
  return items;
}

/** An `object union`: exactly one of the listed keys. */
function union_of(fields: Readonly<Record<string, FieldType>>, raw: unknown, limits: BodyLimits, query: boolean): unknown {
  if (!is_plain_object(raw)) return INVALID;
  const keys = Object.keys(raw);
  const key = keys[0];
  if (keys.length !== 1 || key === undefined || !Object.hasOwn(fields, key)) return INVALID;
  const checked = check_value(fields[key] as FieldType, raw[key], key, limits, query);
  return checked === INVALID ? INVALID : { [key]: checked };
}

function value_of(type: FieldType, raw: unknown, limits: BodyLimits, query: boolean): unknown {
  switch (type.kind) {
    case 'int64':
      return int64_of(raw, query);
    case 'int32':
      return int32_of(raw, query);
    case 'bool':
      return typeof raw === 'boolean' ? raw : INVALID;
    case 'string':
      return string_of(raw, limits);
    case 'enum':
      return enum_of(raw, type.elements);
    case 'array':
      return array_of(type.element, raw, limits, query);
    case 'object':
      return check_object(type.fields, raw, limits, query) ?? INVALID;
    case 'object_union':
      return union_of(type.fields, raw, limits, query);
    case 'json':
      return plain_json(raw);
  }
}

function check_value(type: FieldType, raw: unknown, name: string, limits: BodyLimits, query: boolean): unknown {
  const value = value_of(type, raw, limits, query);
  return value !== INVALID && name_rule(name, value, limits) ? value : INVALID;
}

function check_object(fields: FieldMap, raw: unknown, limits: BodyLimits, query: boolean): Record<string, unknown> | null {
  if (!is_plain_object(raw)) return null;
  for (const key of Object.keys(raw)) if (!Object.hasOwn(fields, key)) return null;
  const out: Record<string, unknown> = {};
  for (const [name, spec] of Object.entries(fields)) {
    if (!Object.hasOwn(raw, name)) {
      if (spec.optional === true) continue;
      return null;
    }
    const checked = check_value(spec.type, raw[name], name, limits, query);
    if (checked === INVALID) return null;
    out[name] = checked;
  }
  return out;
}

/** The time range rule: `from_at` ≤ t < `to_at`, with `to_at` − `from_at` from 1 to `admin-api.maxSearchRangeMs`. */
function range_rule(input: Record<string, unknown>, limits: BodyLimits): boolean {
  const from = input.from_at;
  const to = input.to_at;
  if (typeof from !== 'bigint' || typeof to !== 'bigint') return true;
  const length = to - from;
  return length >= 1n && length <= limits.max_search_range_ms;
}

/** Checks a parsed JSON body against the input fields. Null breaks the body rules. */
export function check_json_body(fields: FieldMap, body: unknown, limits: BodyLimits): AdminInput | null {
  const input = check_object(fields, body, limits, false);
  return input !== null && range_rule(input, limits) ? input : null;
}

/** Checks the query string of a binary body operation. A field given twice breaks the body rules. */
export function check_query(fields: FieldMap, search: URLSearchParams, limits: BodyLimits): AdminInput | null {
  const raw: Record<string, unknown> = {};
  for (const [key, value] of search) {
    if (Object.hasOwn(raw, key)) return null;
    raw[key] = value;
  }
  for (const spec of Object.values(fields)) {
    if (!['int64', 'int32', 'string'].includes(spec.type.kind)) return null;
  }
  const input = check_object(fields, raw, limits, true);
  return input !== null && range_rule(input, limits) ? input : null;
}
