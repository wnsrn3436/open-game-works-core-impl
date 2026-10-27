/**
 * Users, raw rows, export, expiry and `upgrade_user_rows` (`storage` `### base table`, `### raw row`, `### expiry`,
 * `### storage format`).
 */
import { network_time_limit } from '../server-time/network_time_limit.ts';
import { is_db_failure, type DbError, type DbValue, type Dialect, type Row } from './db/types.ts';
import { adapter_of, any_state_of, big, bytes, DbHandle, q, StorageMisuse, user_state_of, writable, type StorageCore, type TxState } from './core.ts';
import { ConversionFailed, read_value } from './state.ts';
import { from_json_value, json_value, quote, type TableDef } from './schema.ts';
import { delete_item, write_item } from './state.ts';
import { lock_row } from './tx.ts';
import { normalize_public_code, pick_public_code, pick_user_id } from './public_code.ts';

/** One row of a snapshot (`### raw row`). */
export interface RawRow {
  readonly table: string;
  readonly key: string;
  readonly contract_version: bigint;
  readonly value: Uint8Array;
}

export interface UserRecord {
  /** Empty only for a row that a server of an earlier core version made after this server's start fill. */
  readonly public_code: string;
  readonly created_at: bigint;
  readonly withdrawn_at: bigint | null;
}

const STATE_TABLES = ['server_state', 'user_state'] as const;
const STATE_KEY = /^([a-z][a-z0-9_]*)\/(0|[1-9][0-9]*)$/;
const INT64_MAX = 2n ** 63n - 1n;

/** The kind column value and the number of a `<kind>/<number>` raw row key; null when it is not one or the number is above int64. */
function state_key(key: unknown): { column: string; id: bigint } | null {
  const match = typeof key === 'string' ? STATE_KEY.exec(key) : null;
  if (match === null) return null;
  const id = BigInt(match[2] ?? '');
  return id > INT64_MAX ? null : { column: match[1] ?? '', id };
}

function handle(value: unknown): DbHandle {
  if (!(value instanceof DbHandle)) throw new StorageMisuse('storage: not a DB handle');
  return value;
}

function byte_compare(a: string, b: string): number {
  const x = Buffer.from(a, 'utf8');
  const y = Buffer.from(b, 'utf8');
  return Buffer.compare(x, y);
}

export interface NewUser {
  readonly user_id: bigint;
  readonly public_code: string;
}

/** Inserts nothing on a taken user ID or public code (a withdrawn user's row included), and then picks both again. */
export function create_user(core: StorageCore, tx: unknown): NewUser {
  const state = any_state_of(core, tx);
  if (state.kind !== 'game') throw new StorageMisuse('storage: create_user needs a game tx');
  writable(state);
  const now = core.time.clock_now();
  for (;;) {
    const user_id = pick_user_id();
    const public_code = pick_public_code();
    const inserted = q(state, 'INSERT INTO "user" (user_id, public_code, created_at) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING RETURNING user_id', [user_id, public_code, now]);
    if (inserted.length > 0) return { user_id, public_code };
  }
}

export function delete_user(core: StorageCore, ctx: unknown): void {
  const state = user_state_of(core, ctx);
  writable(state);
  const user_tables = [...core.tables.values()].filter((t) => t.scope === 'user').map((t) => quote(t.name));
  for (const table of [...user_tables, 'user_state', 'server_state', 'pending_delta']) q(state, `DELETE FROM ${table} WHERE user_id = $1`, [state.user_id]);
  const ctx_object = state.ctx;
  if (ctx_object === null) return;
  q(state, 'UPDATE "user" SET withdrawn_at = $1 WHERE user_id = $2', [ctx_object.request_time, state.user_id]);
  ctx_object.user_deleted = true;
  // New objects, not cleared ones: a savepoint that rolls back puts the objects of before it back.
  state.touched = new Map();
  state.item_changes = [];
  state.item_mails = [];
}

export function get_user_record(db: unknown, user_id: unknown): UserRecord | null {
  if (typeof user_id !== 'bigint') throw new StorageMisuse('storage: the user ID is not a bigint');
  const row = handle(db).query('SELECT public_code, created_at, withdrawn_at FROM "user" WHERE user_id = $1', [user_id])[0];
  if (row === undefined) return null;
  return { public_code: typeof row.public_code === 'string' ? row.public_code : '', created_at: big(row.created_at), withdrawn_at: row.withdrawn_at === null ? null : big(row.withdrawn_at) };
}

/** The user ID of the row whose public code is the code of that public code input (a withdrawn user's included). */
export function find_user_by_public_code(db: unknown, text: unknown): bigint | null {
  const db_handle = handle(db);
  const code = normalize_public_code(text);
  if (code === null) return null;
  const row = db_handle.query('SELECT user_id FROM "user" WHERE public_code = $1', [code])[0];
  return row === undefined ? null : big(row.user_id);
}

export function set_user_created_at(core: StorageCore, ctx: unknown, time: unknown): void {
  const state = user_state_of(core, ctx);
  writable(state);
  if (typeof time !== 'bigint') throw new StorageMisuse('storage: the time is not a bigint');
  q(state, 'UPDATE "user" SET created_at = $1 WHERE user_id = $2', [time, state.user_id]);
}

export function scan_users(db: unknown, after: unknown, max: unknown, version?: unknown): bigint[] {
  if (typeof after !== 'bigint' || typeof max !== 'number' || !Number.isSafeInteger(max) || max < 1) throw new StorageMisuse('storage: scan_users input is not (bigint, integer >= 1)');
  if (version !== undefined && version !== null && typeof version !== 'bigint' && typeof version !== 'number') throw new StorageMisuse('storage: scan_users version is not an integer');
  const lower = version === undefined || version === null ? null : BigInt(version);
  const filter =
    lower === null
      ? ''
      : ' AND (EXISTS (SELECT 1 FROM user_state s WHERE s.user_id = u.user_id AND s.contract_version < $3) OR EXISTS (SELECT 1 FROM server_state s WHERE s.user_id = u.user_id AND s.contract_version < $3))';
  const params: DbValue[] = lower === null ? [after, max] : [after, max, lower];
  return handle(db)
    .query(`SELECT u.user_id FROM "user" u WHERE u.user_id > $1 AND u.withdrawn_at IS NULL${filter} ORDER BY u.user_id LIMIT $2`, params)
    .map((row) => big(row.user_id));
}

/**
 * `sample_users`: one query that orders the users that are not withdrawn by a secure random value of each row and
 * takes the first `max`. SQLite `randomblob` and PostgreSQL `gen_random_uuid` draw from the DB's CSPRNG.
 */
export function sample_users(core: StorageCore, db: unknown, max: unknown): bigint[] {
  if (typeof max !== 'number' || !Number.isSafeInteger(max) || max < 1) throw new StorageMisuse('storage: sample_users maximum is not an integer >= 1');
  const random = adapter_of(core).dialect === 'postgresql' ? 'gen_random_uuid()' : 'randomblob(16)';
  return handle(db)
    .query(`SELECT user_id FROM "user" WHERE withdrawn_at IS NULL ORDER BY ${random} LIMIT $1`, [max])
    .map((row) => big(row.user_id))
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

/** The JSON object of a module table row without `user_id`, and its key array. */
function row_json(table: TableDef, row: Row): { key: string; value: string } {
  const value: Record<string, unknown> = {};
  for (const column of table.columns) if (column.name !== 'user_id') value[column.name] = json_value(column.type, row[column.name]);
  const key = table.key.filter((k) => k !== 'user_id').map((k) => value[k]);
  return { key: JSON.stringify(key), value: JSON.stringify(value) };
}

function snapshot_tables(core: StorageCore): TableDef[] {
  return [...core.tables.values()].filter((t) => t.scope === 'user' && t.snapshot);
}

export function read_user_rows(core: StorageCore, ctx: unknown): RawRow[] {
  const state = user_state_of(core, ctx);
  const out: RawRow[] = [];
  for (const table of STATE_TABLES) {
    for (const row of q(state, `SELECT kind, item_id, value, contract_version FROM ${table} WHERE user_id = $1`, [state.user_id])) {
      out.push({ table, key: `${String(row.kind)}/${String(big(row.item_id))}`, contract_version: big(row.contract_version), value: bytes(row.value) });
    }
  }
  for (const table of snapshot_tables(core)) {
    for (const row of q(state, `SELECT * FROM ${quote(table.name)} WHERE user_id = $1`, [state.user_id])) {
      const json = row_json(table, row);
      out.push({ table: table.name, key: json.key, contract_version: 0n, value: new TextEncoder().encode(json.value) });
    }
  }
  return out.sort((a, b) => byte_compare(a.table, b.table) || byte_compare(a.key, b.key));
}

/** A module table raw row as column values, or why it is not one. */
function table_row(table: TableDef, raw: RawRow): Map<string, unknown> | string {
  let value: unknown;
  try {
    value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(raw.value));
  } catch {
    return `${table.name} raw row value is not JSON`;
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return `${table.name} raw row value is not a JSON object`;
  const fields = value as Record<string, unknown>;
  const out = new Map<string, unknown>();
  for (const name of Object.keys(fields)) if (name === 'user_id' || !table.columns.some((c) => c.name === name)) return `${table.name} raw row has column ${name}`;
  for (const column of table.columns) {
    if (column.name === 'user_id') continue;
    const read = from_json_value(column.type, column.name in fields ? fields[column.name] : null);
    if (read === undefined) return `${table.name} raw row column ${column.name} is missing or not ${column.type}`;
    out.set(column.name, read);
  }
  const key = table.key.filter((k) => k !== 'user_id').map((k) => json_value(table.columns.find((c) => c.name === k)?.type ?? 'string', out.get(k)));
  if (JSON.stringify(key) !== raw.key) return `${table.name} raw row key ${raw.key} is not its key columns`;
  return out;
}

type Insert = { sql: string; params: DbValue[] };

function insert_of(core: StorageCore, user_id: bigint, raw: RawRow): Insert | string {
  if (typeof raw !== 'object' || typeof raw.table !== 'string' || typeof raw.key !== 'string' || typeof raw.contract_version !== 'bigint' || !(raw.value instanceof Uint8Array)) {
    return 'a raw row is not (table, key, contract_version, value)';
  }
  if (raw.table === 'user_state' || raw.table === 'server_state') {
    const key = state_key(raw.key);
    if (key === null) return `${raw.table} raw row key ${raw.key} is not <kind>/<item_id> with an int64 item_id`;
    return {
      sql: `INSERT INTO ${raw.table} (user_id, kind, item_id, value, contract_version, updated_at) VALUES ($1, $2, $3, $4, $5, $6)`,
      params: [user_id, key.column, key.id, raw.value, raw.contract_version, core.time.clock_now()],
    };
  }
  const table = core.tables.get(raw.table);
  if (table?.scope !== 'user' || !table.snapshot) return `raw row table ${raw.table} is not a snapshot table`;
  const values = table_row(table, raw);
  if (typeof values === 'string') return values;
  const columns = ['user_id', ...values.keys()];
  return {
    sql: `INSERT INTO ${quote(table.name)} (${columns.map(quote).join(', ')}) VALUES (${columns.map((_, i) => `$${String(i + 1)}`).join(', ')})`,
    params: [user_id, ...(values.values() as Iterable<DbValue>)],
  };
}

export function replace_user_rows(core: StorageCore, ctx: unknown, rows: unknown): number {
  const state = user_state_of(core, ctx);
  writable(state);
  if (!Array.isArray(rows)) throw new StorageMisuse('storage: replace_user_rows needs a raw row list');
  const inserts: Insert[] = [];
  const seen = new Set<string>();
  for (const raw of rows as RawRow[]) {
    const insert = insert_of(core, state.user_id, raw);
    if (typeof insert === 'string') throw new StorageMisuse(`storage: replace_user_rows: ${insert}`);
    const id = JSON.stringify([raw.table, raw.key]);
    if (seen.has(id)) throw new StorageMisuse(`storage: replace_user_rows: two raw rows have table ${raw.table} and key ${raw.key}`);
    seen.add(id);
    inserts.push(insert);
  }
  for (const table of [...STATE_TABLES, 'pending_delta', ...snapshot_tables(core).map((t) => quote(t.name))]) q(state, `DELETE FROM ${table} WHERE user_id = $1`, [state.user_id]);
  for (const insert of inserts) q(state, insert.sql, insert.params);
  return inserts.length;
}

function game_raw(row: Row): RawRow {
  return { table: 'game_state', key: `${String(row.kind)}/${String(big(row.key))}`, contract_version: big(row.contract_version), value: bytes(row.value) };
}

function game_column(core: StorageCore, kind_class: unknown): string {
  const kind = core.kinds.of_class(kind_class);
  if (kind?.info.store !== 'game_state') throw new StorageMisuse('storage: not a game state kind');
  return kind.info.column;
}

export function read_game_rows(core: StorageCore, db: unknown, kind_class: unknown, keys: unknown): RawRow[] {
  const column = game_column(core, kind_class);
  if (!Array.isArray(keys) || !(keys as unknown[]).every((k) => typeof k === 'bigint')) throw new StorageMisuse('storage: read_game_rows keys are not bigints');
  const list = [...new Set(keys as bigint[])];
  if (list.length === 0) return [];
  const rows = handle(db).query(
    `SELECT kind, "key", value, contract_version FROM game_state WHERE kind = $1 AND (expires_at IS NULL OR expires_at > $2) AND "key" IN (${list.map((_, i) => `$${String(i + 3)}`).join(', ')})`,
    [column, core.time.clock_now(), ...list],
  );
  return rows.map(game_raw).sort((a, b) => byte_compare(a.key, b.key));
}

/** `sample_game_rows`: one query, like `sample_users`, ordered by a secure random value of each row. */
export function sample_game_rows(core: StorageCore, db: unknown, kind_class: unknown, max: unknown): RawRow[] {
  const column = game_column(core, kind_class);
  if (typeof max !== 'number' || !Number.isSafeInteger(max) || max < 0) throw new StorageMisuse('storage: sample_game_rows maximum is not an integer');
  const random = adapter_of(core).dialect === 'postgresql' ? 'gen_random_uuid()' : 'randomblob(16)';
  const rows = handle(db).query(
    `SELECT kind, "key", value, contract_version FROM game_state WHERE kind = $1 AND (expires_at IS NULL OR expires_at > $2) ORDER BY ${random} LIMIT $3`,
    [column, core.time.clock_now(), max],
  );
  return rows.map(game_raw).sort((a, b) => byte_compare(a.key, b.key));
}

export function replace_game_rows(core: StorageCore, tx: unknown, rows: unknown): number | 'FAILED' {
  const state = any_state_of(core, tx);
  if (state.kind !== 'game') throw new StorageMisuse('storage: replace_game_rows needs a game tx');
  writable(state);
  if (!Array.isArray(rows)) throw new StorageMisuse('storage: replace_game_rows needs a raw row list');
  const parsed = (rows as RawRow[]).map((raw) => {
    const key = state_key(raw.key);
    const kind = key === null ? null : core.kinds.of_column(key.column);
    if (key === null || raw.table !== 'game_state' || kind?.info.store !== 'game_state' || typeof raw.contract_version !== 'bigint' || !(raw.value instanceof Uint8Array)) {
      throw new StorageMisuse(`storage: replace_game_rows: ${JSON.stringify(raw.table)} ${JSON.stringify(raw.key)} is not a game_state raw row`);
    }
    return { column: kind.info.column, key: key.id, raw };
  });
  const keys = new Set<string>();
  for (const row of parsed) {
    if (keys.has(row.raw.key)) throw new StorageMisuse(`storage: replace_game_rows: two raw rows have key ${row.raw.key}`);
    keys.add(row.raw.key);
  }
  // The same lock as `lock_game_row(game_state, [kind, key])`, taken in key byte order.
  for (const row of [...parsed].sort((a, b) => byte_compare(a.raw.key, b.raw.key))) {
    if (lock_row(state, 'game_state', [row.column, row.key]) === 'FAILED') return 'FAILED';
  }
  for (const row of parsed) {
    q(state, 'DELETE FROM game_state WHERE kind = $1 AND "key" = $2', [row.column, row.key]);
    q(state, 'INSERT INTO game_state (kind, "key", value, contract_version, updated_at, expires_at) VALUES ($1, $2, $3, $4, $5, NULL)', [
      row.column,
      row.key,
      row.raw.value,
      row.raw.contract_version,
      core.time.clock_now(),
    ]);
  }
  return parsed.length;
}

export function export_user_rows(core: StorageCore, db: unknown, user_id: unknown): Record<string, Record<string, unknown>[]> {
  if (typeof user_id !== 'bigint') throw new StorageMisuse('storage: the user ID is not a bigint');
  const out: Record<string, Record<string, unknown>[]> = {};
  for (const table of core.tables.values()) {
    if (table.personal === null) continue;
    const order = table.key.map(quote).join(', ');
    const rows = handle(db).query(`SELECT * FROM ${quote(table.name)} WHERE ${quote(table.personal)} = $1 ORDER BY ${order}`, [user_id]);
    out[table.name] = rows.map((row) => Object.fromEntries(table.columns.map((c) => [c.name, json_value(c.type, row[c.name])])));
  }
  return out;
}

/** `upgrade_user_rows`: the read conversion of every lower-version row of the user. */
export function upgrade_user_rows(core: StorageCore, ctx: unknown): number | 'FAILED' {
  const state = user_state_of(core, ctx);
  writable(state);
  let changed = 0;
  for (const table of STATE_TABLES) {
    const rows = q(state, `SELECT kind, item_id, value, contract_version FROM ${table} WHERE user_id = $1 AND contract_version < $2`, [state.user_id, core.kinds.version]);
    for (const row of rows) {
      const kind = core.kinds.of_column(String(row.kind));
      if (kind === null || kind.info.store === 'game_state') continue;
      const item_id = big(row.item_id);
      if (!upgrade_one(core, state, kind, item_id, { value: bytes(row.value), version: big(row.contract_version) })) return 'FAILED';
      changed += 1;
    }
  }
  return changed;
}

function upgrade_one(core: StorageCore, state: TxState, kind: Parameters<typeof write_item>[2], item_id: bigint, row: { value: Uint8Array; version: bigint }): boolean {
  try {
    read_value(core, state, kind, item_id, row, {
      save: (b) => {
        write_item(core, state, kind, item_id, b);
      },
      remove: () => {
        delete_item(state, kind, item_id);
      },
    });
    if (core.converter === null) write_item(core, state, kind, item_id, row.value);
    return true;
  } catch (error) {
    // Only the converter's FAILED makes the upgrade FAILED; a DB failure, a misuse or another throw goes on up.
    if (error instanceof ConversionFailed) return false;
    throw error;
  }
}

/** A table whose expiry delete was `FAILED` in a `sweep_expired` run, with the DB error code. */
export interface SweepFailure {
  readonly table: string;
  readonly code: string;
}

/** What one `sweep_expired` run did: the rows it deleted and the tables it stopped at. */
export interface SweepResult {
  readonly deleted: number;
  readonly failed: readonly SweepFailure[];
}

/** The DB error code of a failed delete: a PostgreSQL SQLSTATE or a SQLite result code; empty without a DB answer. */
function db_error_code(dialect: Dialect, error: DbError): string {
  const answered = dialect === 'postgresql' ? /^[0-9A-Z]{5}$/.test(error.code) : /^[0-9]+$/.test(error.code);
  return answered ? error.code : '';
}

/**
 * One batch delete of the expired rows of a table, by row address: `$1` is the time, `$2` the batch size. The outer
 * expiry condition keeps a PostgreSQL row that an upsert rewrote after the inner select.
 */
function sweep_sql(dialect: Dialect, table: string, expiry: string): string {
  const expired = `${quote(expiry)} <= $1`;
  if (dialect === 'postgresql') {
    return `DELETE FROM ${quote(table)} WHERE ctid = ANY(ARRAY(SELECT ctid FROM ${quote(table)} WHERE ${expired} LIMIT $2)) AND ${expired}`;
  }
  return `DELETE FROM ${quote(table)} WHERE rowid IN (SELECT rowid FROM ${quote(table)} WHERE ${expired} LIMIT $2) AND ${expired}`;
}

/** Resolves in a later event loop turn, after the timers that are due have run. */
function next_turn(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

/**
 * `sweep_expired`: batch deletes per table with an expiry column, each in its own transaction; no user lock and no
 * row lock. A table stops at a delete of fewer rows than the batch size, at the end of its time budget, or at a
 * `FAILED` delete, which goes to the failed table list.
 */
export async function sweep_expired(core: StorageCore): Promise<SweepResult> {
  const targets = [{ name: 'game_state', expiry: 'expires_at' }, ...[...core.tables.values()].filter((t) => t.expiry !== null).map((t) => ({ name: t.name, expiry: t.expiry ?? '' }))];
  const adapter = adapter_of(core);
  const batch = core.settings.sweep_batch_size;
  const failed: SweepFailure[] = [];
  let deleted = 0;
  for (const target of targets) {
    const budget = network_time_limit(BigInt(core.settings.sweep_table_budget_ms));
    const sql = sweep_sql(adapter.dialect, target.name, target.expiry);
    const now = core.time.clock_now();
    try {
      for (;;) {
        const count = await adapter.autocommit({ sql, params: [now, BigInt(batch)] }, core.settings.user_lock_wait_ms);
        deleted += count;
        if (count < batch) break;
        // An uncontended SQLite statement resolves without leaving the event loop turn, so the budget's timer could
        // never fire (and no other request could run) without this turn of the event loop.
        await next_turn();
        if (budget.aborted) break;
      }
    } catch (error) {
      if (!is_db_failure(error)) throw error;
      failed.push({ table: target.name, code: db_error_code(adapter.dialect, error) });
    }
  }
  return { deleted, failed };
}
