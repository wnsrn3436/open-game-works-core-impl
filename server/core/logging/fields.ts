import { COMMON_FIELDS, type LogFields } from './log_line.ts';

const SNAKE_CASE = /^[a-z][a-z0-9_]*$/;

/** Fields `routing` writes into every `request` log line; `annotate_request_log` does not set them. */
const REQUEST_FIELDS: ReadonlySet<string> = new Set(['error_code', 'duration_ms', 'client_version', 'platform', 'seed', 'request_body']);

/** A field value of a field object: an integer, a string or a bool. */
export type FieldValue = bigint | number | string | boolean;

export type FieldObject = Readonly<Record<string, unknown>>;

export function is_snake_case(text: string): boolean {
  return SNAKE_CASE.test(text);
}

/** Code points of a string. */
export function code_points(text: string): number {
  return Array.from(text).length;
}

/** True when a `number` is an integer inside int64. */
export function is_int64_number(value: number): boolean {
  return Number.isInteger(value) && value >= -(2 ** 63) && value < 2 ** 63;
}

export function is_field_value(value: unknown): value is FieldValue {
  if (typeof value === 'number') return is_int64_number(value);
  return typeof value === 'bigint' || typeof value === 'string' || typeof value === 'boolean';
}

/** The problem of one field of a `log` field object, or null. */
function field_problem(key: string, value: unknown): string | null {
  if (!is_snake_case(key)) return 'key is not snake_case';
  if (COMMON_FIELDS.has(key)) return 'key is a common field';
  if (!is_field_value(value)) return 'value is not an integer, a string or a bool';
  return null;
}

/** Splits a `log` field object into the fields kept and the keys dropped (`## API`). */
export function split_fields(fields: FieldObject): { kept: LogFields; dropped: string[] } {
  const kept: Record<string, FieldValue> = {};
  const dropped: string[] = [];
  for (const [key, value] of Object.entries(fields)) {
    if (field_problem(key, value) === null) kept[key] = value as FieldValue;
    else dropped.push(key);
  }
  return { kept, dropped };
}

/** The first rule an `annotate_request_log` field object breaks, or null. */
export function annotation_problem(fields: FieldObject): string | null {
  for (const [key, value] of Object.entries(fields)) {
    const problem = REQUEST_FIELDS.has(key) ? 'key is a field routing writes' : field_problem(key, value);
    if (problem !== null) return `field ${JSON.stringify(key)}: ${problem}`;
  }
  return null;
}
