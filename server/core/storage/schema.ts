/**
 * Base tables, module tables (`register_table`) and the schema step of server start (`storage` `### base table`,
 * `### schema`).
 */
import { createHash } from 'node:crypto';
import type { DbConn, DbTxConn, Dialect } from './db/types.ts';

/** The highest core schema version this `storage` applies. Same value as the file `core-schema-version`. */
export const CORE_SCHEMA_VERSION = 1;

/** The key of the schema lock (`pg_advisory_xact_lock`). */
const SCHEMA_LOCK_KEY = 0x6f6777n;

export type BaseType = 'int64' | 'int32' | 'bool' | 'string' | 'bytes';
export type ColumnType = BaseType | `${BaseType}?`;
export type Scope = 'user' | 'game';

const COLUMN_TYPES: ReadonlySet<string> = new Set(['int64', 'int32', 'bool', 'string', 'bytes'].flatMap((t) => [t, `${t}?`]));

export interface Column {
  readonly name: string;
  readonly type: ColumnType;
}

/** A module table as `register_table` received it, after the checks. */
export interface TableDef {
  readonly name: string;
  readonly scope: Scope;
  readonly columns: readonly Column[];
  readonly key: readonly string[];
  readonly expiry: string | null;
  readonly snapshot: boolean;
  readonly personal: string | null;
  readonly indexes: readonly (readonly string[])[];
}

/** The `definition` of a module table's `storage_schema` row. */
interface Definition {
  scope: Scope;
  columns: Column[];
  key: string[];
  indexes: string[][];
}

export const BASE_TABLES: ReadonlySet<string> = new Set(['user', 'user_state', 'server_state', 'pending_delta', 'storage_schema', 'game_state', 'user_change']);

/** A module table name: snake_case with at least one `_` (`<module>_<name>`). */
const TABLE_NAME = /^[a-z][a-z0-9]*(_[a-z0-9]+)+$/;
const COLUMN_NAME = /^[a-z][a-z0-9_]*$/;

export function is_nullable(type: ColumnType): boolean {
  return type.endsWith('?');
}

export function base_type(type: ColumnType): BaseType {
  return type.replace('?', '') as BaseType;
}

export function quote(name: string): string {
  return `"${name}"`;
}

export function index_name(table: string, columns: readonly string[]): string {
  return `ix_${createHash('sha256').update(`${table}:${columns.join(',')}`, 'utf8').digest('hex').slice(0, 16)}`;
}

function sql_type(dialect: Dialect, type: ColumnType): string {
  const sqlite: Record<BaseType, string> = { int64: 'BIGINT', int32: 'INT', bool: 'BOOLEAN', string: 'TEXT', bytes: 'BLOB' };
  // `string` compares and orders by UTF-8 byte order in both DBs: SQLite's default `BINARY`, PostgreSQL's `C`.
  const postgresql: Record<BaseType, string> = { int64: 'BIGINT', int32: 'INTEGER', bool: 'BOOLEAN', string: 'TEXT COLLATE "C"', bytes: 'BYTEA' };
  return (dialect === 'sqlite' ? sqlite : postgresql)[base_type(type)];
}

function text_type(dialect: Dialect): string {
  return sql_type(dialect, 'string');
}

function column_sql(dialect: Dialect, column: Column): string {
  return `${quote(column.name)} ${sql_type(dialect, column.type)}${is_nullable(column.type) ? '' : ' NOT NULL'}`;
}

/** The raw input of `register_table`. A column is `{name, type}`. */
export interface TableInput {
  name: unknown;
  scope: unknown;
  columns: unknown;
  key: unknown;
  expiry: unknown;
  snapshot: unknown;
  personal: unknown;
  indexes: unknown;
}

function columns_of(value: unknown): Column[] | string {
  if (!Array.isArray(value) || value.length === 0) return 'the column list is empty or not a list';
  const out: Column[] = [];
  for (const item of value as unknown[]) {
    if (typeof item !== 'object' || item === null || Array.isArray(item)) return `column ${describe(item)} is not {name, type}`;
    const { name, type } = item as { name?: unknown; type?: unknown };
    if (typeof name !== 'string' || !COLUMN_NAME.test(name)) return `column name ${String(name)} is not snake_case`;
    if (typeof type !== 'string' || !COLUMN_TYPES.has(type)) return `column ${name} has type ${String(type)}, not a column type`;
    if (out.some((c) => c.name === name)) return `column ${name} is in the list twice`;
    out.push({ name, type: type as ColumnType });
  }
  return out;
}

function string_list(value: unknown): string[] | null {
  if (!Array.isArray(value) || !(value as unknown[]).every((v) => typeof v === 'string')) return null;
  return value as string[];
}

function indexes_of(value: unknown, columns: readonly Column[]): string[][] | string {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) return 'the index list is not a list';
  const out: string[][] = [];
  for (const item of value as unknown[]) {
    const index = string_list(item);
    if (index === null || index.length === 0) return 'an index has no column';
    const missing = index.find((c) => !columns.some((col) => col.name === c));
    if (missing !== undefined) return `index column ${missing} is not a column`;
    if (out.some((o) => o.join(',') === index.join(','))) return `index (${index.join(', ')}) is given twice`;
    out.push(index);
  }
  return out;
}

function describe(value: unknown): string {
  if (value === undefined) return 'undefined';
  return typeof value === 'string' ? value : JSON.stringify(value);
}

/** Key, expiry and personal data user columns are columns of the table. */
function check_references(input: TableInput, columns: readonly Column[], key: readonly string[]): string | null {
  const has = (name: string): boolean => columns.some((c) => c.name === name);
  const missing_key = key.find((k) => !has(k));
  if (missing_key !== undefined) return `key column ${missing_key} is not a column`;
  if (input.expiry !== null && input.expiry !== undefined) {
    const expiry = columns.find((c) => c.name === input.expiry);
    if (expiry === undefined || base_type(expiry.type) !== 'int64') return `expiry column ${describe(input.expiry)} is not an int64 column`;
  }
  if (input.personal !== null && input.personal !== undefined && (typeof input.personal !== 'string' || !has(input.personal))) {
    return `personal data user column ${describe(input.personal)} is not a column`;
  }
  return null;
}

/** The scope rules: a user scope table starts with `user_id` and has a snapshot flag; a game scope table has none. */
function check_scope(input: TableInput, columns: readonly Column[], key: readonly string[]): string | null {
  if (input.scope !== 'user') return input.snapshot !== null && input.snapshot !== undefined ? 'a game scope table has a snapshot flag' : null;
  const first = columns[0];
  if (first?.name !== 'user_id' || first.type !== 'int64') return 'the first column of a user scope table is not user_id (int64)';
  if (typeof input.snapshot !== 'boolean') return 'a user scope table has no snapshot flag';
  if (input.snapshot && !key.includes('user_id')) return 'a snapshot table has no user_id in its key';
  return null;
}

function check_shape(input: TableInput, columns: readonly Column[], key: readonly string[]): string | null {
  return check_references(input, columns, key) ?? check_scope(input, columns, key);
}

/** Checks a `register_table` input. Returns the table, or why server start fails. */
export function table_def(input: TableInput): TableDef | string {
  const name = typeof input.name === 'string' ? input.name : '';
  if (!TABLE_NAME.test(name) || BASE_TABLES.has(name)) return `table name ${describe(input.name)} is not a module table name`;
  const fail = (reason: string): string => `table ${name}: ${reason}`;
  if (input.scope !== 'user' && input.scope !== 'game') return fail(`scope ${describe(input.scope)} is not user or game`);
  const columns = columns_of(input.columns);
  if (typeof columns === 'string') return fail(columns);
  const key = string_list(input.key);
  if (key === null || key.length === 0) return fail('the key column list is empty');
  const indexes = indexes_of(input.indexes, columns);
  if (typeof indexes === 'string') return fail(indexes);
  const shape = check_shape(input, columns, key);
  if (shape !== null) return fail(shape);
  return {
    name,
    scope: input.scope,
    columns,
    key,
    expiry: typeof input.expiry === 'string' ? input.expiry : null,
    snapshot: input.snapshot === true,
    personal: typeof input.personal === 'string' ? input.personal : null,
    indexes,
  };
}

function create_table_sql(dialect: Dialect, name: string, columns: readonly Column[], key: readonly string[]): string {
  return `CREATE TABLE ${quote(name)} (${columns.map((c) => column_sql(dialect, c)).join(', ')}, PRIMARY KEY (${key.map(quote).join(', ')}))`;
}

function create_index_sql(table: string, columns: readonly string[]): string {
  return `CREATE INDEX ${quote(index_name(table, columns))} ON ${quote(table)} (${columns.map(quote).join(', ')})`;
}

/** Base table statements of core schema version 1. */
function base_v1(dialect: Dialect): string[] {
  const id = dialect === 'sqlite' ? 'INTEGER PRIMARY KEY AUTOINCREMENT' : 'BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY';
  const bytes = dialect === 'sqlite' ? 'BLOB' : 'BYTEA';
  const int32 = dialect === 'sqlite' ? 'INT' : 'INTEGER';
  const text = text_type(dialect);
  const state = (name: string): string =>
    `CREATE TABLE ${name} (user_id BIGINT NOT NULL, kind ${text} NOT NULL, item_id BIGINT NOT NULL, value ${bytes} NOT NULL, contract_version BIGINT NOT NULL, updated_at BIGINT NOT NULL, PRIMARY KEY (user_id, kind, item_id))`;
  return [
    `CREATE TABLE "user" (user_id ${id}, created_at BIGINT NOT NULL, withdrawn_at BIGINT)`,
    state('user_state'),
    state('server_state'),
    `CREATE TABLE pending_delta (user_id BIGINT NOT NULL, seq BIGINT NOT NULL, delta ${bytes} NOT NULL, created_at BIGINT NOT NULL, PRIMARY KEY (user_id, seq))`,
    `CREATE TABLE game_state (kind ${text} NOT NULL, "key" BIGINT NOT NULL, value ${bytes} NOT NULL, contract_version BIGINT NOT NULL, updated_at BIGINT NOT NULL, expires_at BIGINT, PRIMARY KEY (kind, "key"))`,
    `CREATE INDEX ix_game_state_expires_at ON game_state (expires_at)`,
    `CREATE TABLE user_change (change_id ${id}, name ${text} NOT NULL, sender_id BIGINT NOT NULL, target_id BIGINT NOT NULL, payload ${bytes} NOT NULL, phase ${text} NOT NULL, fail_reason ${text} NOT NULL, fail_code ${int32} NOT NULL, attempts ${int32} NOT NULL, next_attempt_at BIGINT NOT NULL, created_at BIGINT NOT NULL)`,
    `CREATE INDEX ix_user_change_next_attempt_at ON user_change (next_attempt_at)`,
  ];
}

/** Core schema changes by version: index 0 is version 1. A new version adds its statements at the end. */
const CORE_SCHEMA: readonly ((dialect: Dialect) => string[])[] = [base_v1];

function storage_schema_exists(conn: DbConn, dialect: Dialect): boolean {
  const sql =
    dialect === 'sqlite'
      ? `SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'table' AND name = 'storage_schema'`
      : `SELECT COUNT(*) AS n FROM pg_catalog.pg_tables WHERE schemaname = current_schema() AND tablename = 'storage_schema'`;
  return conn.query(sql).some((row) => row.n !== 0n);
}

function read_definition(conn: DbConn, name: string): string | null {
  const row = conn.query('SELECT definition FROM storage_schema WHERE name = $1', [name])[0];
  return row === undefined ? null : String(row.definition);
}

function write_definition(conn: DbConn, name: string, definition: string): void {
  conn.query('INSERT INTO storage_schema (name, definition) VALUES ($1, $2) ON CONFLICT (name) DO UPDATE SET definition = excluded.definition', [name, definition]);
}

/** Creates the base tables or applies the core schema changes up to `CORE_SCHEMA_VERSION`. */
function apply_base(conn: DbConn, dialect: Dialect): string | null {
  let applied = 0;
  if (!storage_schema_exists(conn, dialect)) {
    const text = text_type(dialect);
    conn.query(`CREATE TABLE storage_schema (name ${text} NOT NULL PRIMARY KEY, definition ${text} NOT NULL)`);
  } else {
    const text = read_definition(conn, 'base');
    applied = text === null ? 0 : Number(text);
    if (!Number.isSafeInteger(applied) || applied < 0) return `the base row of storage_schema holds ${String(text)}, not a core schema version`;
  }
  if (applied > CORE_SCHEMA_VERSION) {
    return `the database is at core schema version ${String(applied)}, higher than ${String(CORE_SCHEMA_VERSION)}, the highest core schema version of this core release`;
  }
  for (let version = applied + 1; version <= CORE_SCHEMA_VERSION; version += 1) {
    for (const sql of (CORE_SCHEMA[version - 1] as (dialect: Dialect) => string[])(dialect)) conn.query(sql);
  }
  write_definition(conn, 'base', String(CORE_SCHEMA_VERSION));
  return null;
}

function parse_definition(text: string): Definition | null {
  try {
    const value = JSON.parse(text) as Definition;
    if (!Array.isArray(value.columns) || !Array.isArray(value.key) || !Array.isArray(value.indexes)) return null;
    return value;
  } catch {
    return null;
  }
}

/** Why a stored table definition cannot take the registered one, or null. */
function conflict(table: TableDef, stored: Definition): string | null {
  if (stored.scope !== table.scope) return `table ${table.name}: scope changes from ${stored.scope} to ${table.scope}`;
  if (stored.key.join(',') !== table.key.join(',')) return `table ${table.name}: key columns change from (${stored.key.join(', ')}) to (${table.key.join(', ')})`;
  for (const column of table.columns) {
    const old = stored.columns.find((c) => c.name === column.name);
    if (old === undefined && !is_nullable(column.type)) return `table ${table.name}: added column ${column.name} is not a ? type`;
    if (old !== undefined && old.type !== column.type) return `table ${table.name}: column ${column.name} changes type from ${old.type} to ${column.type}`;
  }
  const dropped = stored.columns.find((c) => !is_nullable(c.type) && !table.columns.some((t) => t.name === c.name));
  if (dropped !== undefined) return `table ${table.name}: stored column ${dropped.name} is not ? and is not in the registered columns`;
  return null;
}

function apply_table(conn: DbConn, dialect: Dialect, table: TableDef): string | null {
  const text = read_definition(conn, table.name);
  if (text === null) {
    conn.query(create_table_sql(dialect, table.name, table.columns, table.key));
    for (const index of table.indexes) conn.query(create_index_sql(table.name, index));
    const definition: Definition = { scope: table.scope, columns: [...table.columns], key: [...table.key], indexes: table.indexes.map((i) => [...i]) };
    write_definition(conn, table.name, JSON.stringify(definition));
    return null;
  }
  const stored = parse_definition(text);
  if (stored === null) return `table ${table.name}: the storage_schema definition is not readable`;
  const reason = conflict(table, stored);
  if (reason !== null) return reason;
  const added = table.columns.filter((c) => !stored.columns.some((s) => s.name === c.name));
  for (const column of added) conn.query(`ALTER TABLE ${quote(table.name)} ADD COLUMN ${column_sql(dialect, column)}`);
  const new_indexes = table.indexes.filter((i) => !stored.indexes.some((s) => s.join(',') === i.join(',')));
  for (const index of new_indexes) conn.query(create_index_sql(table.name, index));
  const definition: Definition = { scope: table.scope, columns: [...stored.columns, ...added], key: [...table.key], indexes: [...stored.indexes, ...new_indexes.map((i) => [...i])] };
  write_definition(conn, table.name, JSON.stringify(definition));
  return null;
}

/** The first statement of the schema transaction: the schema lock (SQLite holds it by `BEGIN IMMEDIATE`). */
export function schema_lock(dialect: Dialect): { sql: string; params: readonly bigint[] } | null {
  return dialect === 'sqlite' ? null : { sql: 'SELECT pg_advisory_xact_lock(CAST($1 AS BIGINT)) AS locked', params: [SCHEMA_LOCK_KEY] };
}

/** Applies the base tables and the module tables in an open schema transaction. Returns why server start fails. */
export function apply_schema(conn: DbTxConn, dialect: Dialect, tables: readonly TableDef[]): string | null {
  const base = apply_base(conn, dialect);
  if (base !== null) return base;
  for (const table of tables) {
    const reason = apply_table(conn, dialect, table);
    if (reason !== null) return reason;
  }
  return null;
}

/** A column value to its snapshot and export JSON form: int64 as a decimal string, bytes as standard base64. */
export function json_value(type: ColumnType, value: unknown): unknown {
  if (value === null || value === undefined) return null;
  switch (base_type(type)) {
    case 'int64':
      return (value as bigint).toString();
    case 'bytes':
      return Buffer.from(value as Uint8Array).toString('base64');
    default:
      return value;
  }
}

const INT64 = /^-?(0|[1-9][0-9]*)$/;
const BASE64 = /^[A-Za-z0-9+/]*={0,2}$/;

const FROM_JSON: Record<BaseType, (value: unknown) => unknown> = {
  int64: (value) => (typeof value === 'string' && INT64.test(value) && BigInt.asIntN(64, BigInt(value)) === BigInt(value) ? BigInt(value) : undefined),
  int32: (value) => (typeof value === 'number' && Number.isInteger(value) && value >= -(2 ** 31) && value < 2 ** 31 ? value : undefined),
  bool: (value) => (typeof value === 'boolean' ? value : undefined),
  string: (value) => (typeof value === 'string' ? value : undefined),
  bytes: (value) => (typeof value === 'string' && BASE64.test(value) && value.length % 4 === 0 ? Uint8Array.from(Buffer.from(value, 'base64')) : undefined),
};

/** Reads a snapshot JSON value of a column; undefined when it is not that column's form. */
export function from_json_value(type: ColumnType, value: unknown): unknown {
  if (value === null) return is_nullable(type) ? null : undefined;
  return FROM_JSON[base_type(type)](value);
}
