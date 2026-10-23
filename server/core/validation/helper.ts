/** Check helpers for conditions a contract cannot declare: range, data table ID, uniqueness, kind consistency, platform, version. */
import type * as GameData from '../../generated/data/game_data.ts';

/** Fields of a message used by each kind element: kind enum value → field names. */
export type KindFields = ReadonlyMap<number, readonly string[]>;

interface IdContainer {
  has_row?: (id: number) => boolean;
  has_rows?: (id: number) => boolean;
}

const TABLE_NAME = /^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$/;

/** An integer as `bigint`; null for a `number` that is not an integer (NaN and infinity included). */
function integerOf(value: number | bigint): bigint | null {
  if (typeof value === 'bigint') return value;
  return Number.isInteger(value) ? BigInt(value) : null;
}

/** True when `min` ≤ `value` ≤ `max`, compared as `bigint`. */
export function isInRange(value: number | bigint, min: number | bigint, max: number | bigint): boolean {
  const v = integerOf(value);
  const lo = integerOf(min);
  const hi = integerOf(max);
  return v !== null && lo !== null && hi !== null && lo <= v && v <= hi;
}

/** The container `<Table>Table` of a table name in the data set, or null when the data set has none. */
function containerOf(data: GameData.DataSet, table: string): IdContainer | null {
  if (!TABLE_NAME.test(table)) return null;
  const property = `${table.split('_').map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join('')}Table`;
  if (!Object.hasOwn(data, property)) return null;
  const container = (data as unknown as Readonly<Record<string, unknown>>)[property] as IdContainer | null;
  if (container === null || typeof container !== 'object') return null;
  return typeof container.has_row === 'function' || typeof container.has_rows === 'function' ? container : null;
}

/** True when the table of the server build data has the ID value in `id`. Throws for a table it does not have. */
export function hasTableId(data: GameData.DataSet, table: string, id: number): boolean {
  const container = containerOf(data, table);
  if (container === null) throw new Error(`has_table_id: the server build data has no table ${JSON.stringify(table)}`);
  if (!Number.isSafeInteger(id) || id <= 0) return false;
  return container.has_row !== undefined ? container.has_row(id) : container.has_rows?.(id) === true;
}

/** A key of `is_unique` as text that is the same only for equal integers or equal strings. */
function uniqueKey(key: unknown): string {
  if (typeof key === 'string') return `s${key}`;
  if (typeof key === 'bigint') return `i${key.toString()}`;
  if (typeof key === 'number' && Number.isInteger(key)) return `i${BigInt(key).toString()}`;
  throw new TypeError('is_unique: the key function returned a value that is not an integer or a string');
}

/** True when the keys of the list are all different. */
export function isUnique<T>(list: readonly T[], key: (item: T) => number | bigint | string): boolean {
  const seen = new Set<string>();
  for (const item of list) {
    const k = uniqueKey(key(item));
    if (seen.has(k)) return false;
    seen.add(k);
  }
  return true;
}

/** A new message of the same generated class: every field at its default value. */
function defaultsOf(message: object): Readonly<Record<string, unknown>> {
  const ctor: unknown = (Object.getPrototypeOf(message) as { constructor?: unknown } | null)?.constructor;
  if (typeof ctor !== 'function') throw new TypeError('is_kind_consistent: the message is not a generated message');
  return new (ctor as new () => object)() as Readonly<Record<string, unknown>>;
}

function isDefault(value: unknown, defaultValue: unknown): boolean {
  if (defaultValue === null) return value === null;
  if (Array.isArray(defaultValue)) return Array.isArray(value) && value.length === 0;
  if (defaultValue instanceof Uint8Array) return value instanceof Uint8Array && value.length === 0;
  return Object.is(value, defaultValue);
}

function checkFieldNames(defaults: Readonly<Record<string, unknown>>, names: readonly string[]): void {
  for (const name of names) {
    if (!Object.hasOwn(defaults, name)) throw new TypeError(`is_kind_consistent: the message has no field ${JSON.stringify(name)}`);
  }
}

/** True when every field except the kind field and the fields of the selected kind is at its default value. */
export function isKindConsistent(message: object, kindField: string, fieldsByKind: KindFields): boolean {
  const defaults = defaultsOf(message);
  checkFieldNames(defaults, [kindField]);
  for (const names of fieldsByKind.values()) checkFieldNames(defaults, names);
  const record = message as Readonly<Record<string, unknown>>;
  const kind = record[kindField];
  if (typeof kind !== 'number') throw new TypeError(`is_kind_consistent: field ${JSON.stringify(kindField)} is not an enum field`);
  const selected = kind === 0 ? undefined : fieldsByKind.get(kind);
  if (selected === undefined) return false;
  return Object.keys(defaults).every((name) => name === kindField || selected.includes(name) || isDefault(record[name], defaults[name]));
}

/** An app version or core version `<major>.<minor>.<patch>`. */
export interface Version {
  readonly major: bigint;
  readonly minor: bigint;
  readonly patch: bigint;
}

const PLATFORMS: ReadonlySet<string> = new Set(['android', 'ios', 'web', 'windows', 'macos', 'linux']);

/** Each part `0` or a decimal integer that does not start with `0`. */
const VERSION = /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/;

/** True for `android`, `ios`, `web`, `windows`, `macos` and `linux`. */
export function isPlatform(text: string): boolean {
  return PLATFORMS.has(text);
}

/** The parts of a version, or null when the text is not one. */
export function parseVersion(text: string): Version | null {
  const match = VERSION.exec(text);
  if (match === null) return null;
  return { major: BigInt(match[1] as string), minor: BigInt(match[2] as string), patch: BigInt(match[3] as string) };
}

/** Major, minor, patch integer comparison: negative when `a` is lower, 0 when equal, positive when higher. */
export function compareVersions(a: Version, b: Version): number {
  for (const part of ['major', 'minor', 'patch'] as const) {
    if (a[part] !== b[part]) return a[part] < b[part] ? -1 : 1;
  }
  return 0;
}
