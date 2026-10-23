/**
 * admin-api's tables (`admin_api_ip_counter`, `admin_api_operation`, `admin_api_ban`, `admin_api_switch`): their
 * `storage.register_table` definitions and every query admin-api runs on them.
 */
import type { DbHandle, Storage } from '../storage/index.ts';

/** A column value of a `DbHandle.query` result row. */
type DbValue = ReturnType<DbHandle['query']>[number][string];

export const IP_COUNTER = 'admin_api_ip_counter';
export const OPERATION = 'admin_api_operation';
export const BAN = 'admin_api_ban';
export const SWITCH = 'admin_api_switch';

export const MAINTENANCE_KIND = 'maintenance';
export const KILL_SWITCH_KIND = 'kill_switch';

export function register_tables(storage: Pick<Storage, 'register_table'>): void {
  storage.register_table(
    IP_COUNTER,
    'game',
    [
      { name: 'ip', type: 'string' },
      { name: 'window_start', type: 'int64' },
      { name: 'count', type: 'int64' },
      { name: 'expires_at', type: 'int64' },
    ],
    ['ip', 'window_start'],
    'expires_at',
    null,
  );
  storage.register_table(
    OPERATION,
    'game',
    [
      { name: 'operation', type: 'string' },
      { name: 'operation_id', type: 'string' },
      { name: 'input_sha256', type: 'string' },
      { name: 'output', type: 'string' },
      { name: 'created_at', type: 'int64' },
      { name: 'expires_at', type: 'int64' },
    ],
    ['operation', 'operation_id'],
    'expires_at',
    null,
  );
  storage.register_table(
    BAN,
    'game',
    [
      { name: 'user_id', type: 'int64' },
      { name: 'until_at', type: 'int64' },
      { name: 'reason', type: 'string' },
      { name: 'banned_at', type: 'int64' },
    ],
    ['user_id'],
    null,
    null,
    'user_id',
  );
  storage.register_table(
    SWITCH,
    'game',
    [
      { name: 'kind', type: 'string' },
      { name: 'target', type: 'string' },
      { name: 'updated_at', type: 'int64' },
    ],
    ['kind', 'target'],
    null,
    null,
  );
}

function int64(value: DbValue | undefined): bigint {
  if (typeof value === 'bigint') return value;
  if (typeof value === 'number') return BigInt(value);
  throw new Error(`expected an int64 column value, got ${typeof value}`);
}

/** The auth failure count of an IP in a minute window. An expired row counts as no row. */
export function read_ip_failures(db: DbHandle, ip: string, window_start: bigint, now: bigint): bigint {
  const rows = db.query(`SELECT count FROM ${IP_COUNTER} WHERE ip = $1 AND window_start = $2 AND expires_at > $3`, [ip, window_start, now]);
  return rows.length === 0 ? 0n : int64(rows[0]?.count);
}

/** Adds one auth failure to an IP's minute window with one upsert. */
export function add_ip_failure(db: DbHandle, ip: string, window_start: bigint, window_end: bigint): void {
  db.query(
    `INSERT INTO ${IP_COUNTER} (ip, window_start, count, expires_at) VALUES ($1, $2, 1, $3) ` +
      `ON CONFLICT (ip, window_start) DO UPDATE SET count = ${IP_COUNTER}.count + 1`,
    [ip, window_start, window_end],
  );
}

export interface OperationRow {
  readonly input_sha256: string;
  readonly output: string;
}

/** The `operation_id` record of an operation; an expired row counts as no row. */
export function read_operation(db: DbHandle, operation: string, operation_id: string, now: bigint): OperationRow | null {
  const rows = db.query(
    `SELECT input_sha256, output FROM ${OPERATION} WHERE operation = $1 AND operation_id = $2 AND expires_at > $3`,
    [operation, operation_id, now],
  );
  const row = rows[0];
  if (row === undefined) return null;
  return { input_sha256: String(row.input_sha256), output: String(row.output) };
}

/** Writes an `operation_id` record, replacing an expired row of the same key. */
export function write_operation(db: DbHandle, operation: string, operation_id: string, input_sha256: string, output: string, created_at: bigint, expires_at: bigint): void {
  db.query(
    `INSERT INTO ${OPERATION} (operation, operation_id, input_sha256, output, created_at, expires_at) VALUES ($1, $2, $3, $4, $5, $6) ` +
      'ON CONFLICT (operation, operation_id) DO UPDATE SET input_sha256 = excluded.input_sha256, output = excluded.output, ' +
      'created_at = excluded.created_at, expires_at = excluded.expires_at',
    [operation, operation_id, input_sha256, output, created_at, expires_at],
  );
}

export interface BanRow {
  readonly until_at: bigint;
  readonly reason: string;
  readonly banned_at: bigint;
}

export function read_ban(db: DbHandle, user_id: bigint): BanRow | null {
  const row = db.query(`SELECT until_at, reason, banned_at FROM ${BAN} WHERE user_id = $1`, [user_id])[0];
  if (row === undefined) return null;
  return { until_at: int64(row.until_at), reason: String(row.reason), banned_at: int64(row.banned_at) };
}

/** The ban is in force at `now`: `until_at` is 0 or still ahead. */
export function ban_in_force(ban: BanRow | null, now: bigint): ban is BanRow {
  return ban !== null && (ban.until_at === 0n || now < ban.until_at);
}

export function write_ban(db: DbHandle, user_id: bigint, ban: BanRow): void {
  db.query(
    `INSERT INTO ${BAN} (user_id, until_at, reason, banned_at) VALUES ($1, $2, $3, $4) ` +
      'ON CONFLICT (user_id) DO UPDATE SET until_at = excluded.until_at, reason = excluded.reason, banned_at = excluded.banned_at',
    [user_id, ban.until_at, ban.reason, ban.banned_at],
  );
}

export function delete_ban(db: DbHandle, user_id: bigint): void {
  db.query(`DELETE FROM ${BAN} WHERE user_id = $1`, [user_id]);
}

export interface SwitchState {
  readonly maintenance: boolean;
  readonly kill_switches: readonly string[];
}

/** The switches that are on. Kill switch targets are in byte order. */
export function read_switches(db: DbHandle): SwitchState {
  const rows = db.query(`SELECT kind, target FROM ${SWITCH}`, []);
  let maintenance = false;
  const kill_switches: string[] = [];
  for (const row of rows) {
    if (row.kind === MAINTENANCE_KIND) maintenance = true;
    else if (row.kind === KILL_SWITCH_KIND) kill_switches.push(String(row.target));
  }
  kill_switches.sort((a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b)));
  return { maintenance, kill_switches };
}

/** Turns a switch on (insert, or a new `updated_at`) or off (delete). */
export function write_switch(db: DbHandle, kind: string, target: string, enabled: boolean, updated_at: bigint): void {
  if (!enabled) {
    db.query(`DELETE FROM ${SWITCH} WHERE kind = $1 AND target = $2`, [kind, target]);
    return;
  }
  db.query(
    `INSERT INTO ${SWITCH} (kind, target, updated_at) VALUES ($1, $2, $3) ON CONFLICT (kind, target) DO UPDATE SET updated_at = excluded.updated_at`,
    [kind, target, updated_at],
  );
}
