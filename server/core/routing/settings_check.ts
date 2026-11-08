/**
 * The settings check of server start (`### server start` of `routing`): the merged core settings and the game
 * settings values core reads, with the overrides of `create_server` applied, against the settings schema
 * `server/generated/core_settings_schema.json`. It is the one check of settings values in server core.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/** The settings schema file (`## generated code` of the `server-core` SKILL). */
export const SETTINGS_SCHEMA_FILE = fileURLToPath(new URL('../../generated/core_settings_schema.json', import.meta.url));

/** A property of the settings schema, as far as the settings check reads it. */
interface SchemaProperty {
  readonly type?: string | readonly string[];
  readonly minimum?: number;
  readonly maximum?: number;
  readonly exclusiveMinimum?: number;
  readonly items?: SchemaProperty;
  readonly minItems?: number;
}

/** The settings schema: a property per key, and the keys in `required`. */
export interface SettingsSchema {
  readonly properties: Readonly<Record<string, SchemaProperty>>;
  readonly required: readonly string[];
}

/** One key that failed and the schema keyword it broke. */
export interface SettingsFailure {
  readonly key: string;
  readonly keyword: string;
}

function is_record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Reads the settings schema; a string is the reason it cannot be read. */
export function read_settings_schema(path: string = SETTINGS_SCHEMA_FILE): SettingsSchema | string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return `the settings schema ${path} cannot be read as JSON`;
  }
  if (!is_record(parsed) || !is_record(parsed.properties)) return `the settings schema ${path} has no properties object`;
  const required = Array.isArray(parsed.required) ? parsed.required.filter((k): k is string => typeof k === 'string') : [];
  return { properties: parsed.properties as Record<string, SchemaProperty>, required };
}

/** Whether `value` is of the JSON type `type`. */
function is_type(value: unknown, type: string): boolean {
  switch (type) {
    case 'null':
      return value === null;
    case 'boolean':
      return typeof value === 'boolean';
    case 'string':
      return typeof value === 'string';
    case 'integer':
      return typeof value === 'number' && Number.isInteger(value);
    case 'number':
      return typeof value === 'number' && Number.isFinite(value);
    case 'array':
      return Array.isArray(value);
    case 'object':
      return is_record(value);
    default:
      return false;
  }
}

/** The number keyword of `property` that `value` breaks; null when it passes them. */
function broken_number_keyword(value: number, property: SchemaProperty): string | null {
  if (property.minimum !== undefined && value < property.minimum) return 'minimum';
  if (property.maximum !== undefined && value > property.maximum) return 'maximum';
  if (property.exclusiveMinimum !== undefined && value <= property.exclusiveMinimum) return 'exclusiveMinimum';
  return null;
}

/** The array keyword of `property` that `value` breaks; null when it passes them. */
function broken_array_keyword(value: readonly unknown[], property: SchemaProperty): string | null {
  if (property.minItems !== undefined && value.length < property.minItems) return 'minItems';
  const items = property.items;
  if (items !== undefined && value.some((item) => broken_keyword(item, items) !== null)) return 'items';
  return null;
}

/** The first keyword of `property` that `value` breaks; null when it passes. */
function broken_keyword(value: unknown, property: SchemaProperty): string | null {
  if (property.type !== undefined) {
    const types = typeof property.type === 'string' ? [property.type] : property.type;
    if (!types.some((t) => is_type(value, t))) return 'type';
  }
  if (typeof value === 'number') return broken_number_keyword(value, property);
  if (Array.isArray(value)) return broken_array_keyword(value, property);
  return null;
}

const ENV_PREFIX = 'environments.<ENV>.';

/**
 * Checks the settings values: every key is a property of the schema, every property in `required` has a value, and
 * every value passes its property. `values` are the merged core settings and game settings values core reads;
 * `overrides` are the overrides of `create_server`. An override key with `<ENV>` is checked against the property of
 * that path with `DEV` in the place of `<ENV>`. The failures are in byte order of key.
 */
export function check_settings(schema: SettingsSchema, values: Readonly<Record<string, unknown>>, overrides: Readonly<Record<string, unknown>> | null | undefined): SettingsFailure[] {
  const checked = new Map<string, { property_key: string; value: unknown }>();
  for (const [key, value] of Object.entries(values)) checked.set(key, { property_key: key, value });
  for (const [key, value] of Object.entries(overrides ?? {})) {
    const property_key = key.startsWith(ENV_PREFIX) ? `environments.DEV.${key.slice(ENV_PREFIX.length)}` : key;
    checked.set(key, { property_key, value });
  }
  const failures: SettingsFailure[] = [];
  const has = (key: string): boolean => Object.prototype.hasOwnProperty.call(schema.properties, key);
  for (const [key, { property_key, value }] of checked) {
    if (!has(property_key)) {
      failures.push({ key, keyword: 'additionalProperties' });
      continue;
    }
    const keyword = broken_keyword(value, schema.properties[property_key] as SchemaProperty);
    if (keyword !== null) failures.push({ key, keyword });
  }
  for (const key of schema.required) if (!checked.has(key)) failures.push({ key, keyword: 'required' });
  return failures.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
}

/** The failure reason of a settings check: each key that failed and its keyword, and no value. */
export function settings_failure_reason(failures: readonly SettingsFailure[]): string {
  return `settings check failed: ${failures.map((f) => `${f.key} (${f.keyword})`).join(', ')}`;
}

/** The settings check of the values `create_server` gets: null when it passes, otherwise the failure reason. */
export function run_settings_check(values: Readonly<Record<string, unknown>>, overrides: Readonly<Record<string, unknown>> | null | undefined): string | null {
  const schema = read_settings_schema();
  if (typeof schema === 'string') return `settings check failed: ${schema}`;
  const failures = check_settings(schema, values, overrides);
  return failures.length === 0 ? null : settings_failure_reason(failures);
}
