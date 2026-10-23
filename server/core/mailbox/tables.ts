/**
 * The four tables of `mailbox` (`## behavior` table) and every query on them. Writes that make a row or raise a
 * counter are one upsert statement that reads the value it wrote (`storage` `### expiry`).
 */
import type { DbHandle, Storage } from '../storage/index.ts';

type DbRow = Readonly<Record<string, unknown>>;

export const MAIL_COUNTER = 'mailbox_mail_counter';
export const ONCE_KEY = 'mailbox_once_key';
export const BROADCAST = 'mailbox_broadcast';
export const BROADCAST_COUNTER = 'mailbox_broadcast_counter';

/** Registers the four tables (`storage.register_table`). */
export function register_tables(storage: Storage): void {
  storage.register_table(
    MAIL_COUNTER,
    'user',
    [
      { name: 'user_id', type: 'int64' },
      { name: 'last_mail_id', type: 'int64' },
      { name: 'next_expires_at', type: 'int64' },
    ],
    ['user_id'],
    null,
    true,
  );
  storage.register_table(
    ONCE_KEY,
    'user',
    [
      { name: 'user_id', type: 'int64' },
      { name: 'once_key', type: 'string' },
      { name: 'mail_id', type: 'int64' },
    ],
    ['user_id', 'once_key'],
    null,
    true,
  );
  storage.register_table(
    BROADCAST,
    'game',
    [
      { name: 'broadcast_id', type: 'int64' },
      { name: 'mail', type: 'string' },
      { name: 'start_at', type: 'int64' },
      { name: 'cancelled', type: 'bool' },
      { name: 'created_at', type: 'int64' },
      { name: 'expires_at', type: 'int64' },
    ],
    ['broadcast_id'],
    'expires_at',
    null,
  );
  storage.register_table(
    BROADCAST_COUNTER,
    'game',
    [
      { name: 'id', type: 'int64' },
      { name: 'last_broadcast_id', type: 'int64' },
    ],
    ['id'],
    null,
    null,
  );
}

function int64(row: DbRow | undefined, column: string): bigint {
  const value = row?.[column];
  if (typeof value === 'bigint') return value;
  if (typeof value === 'number' && Number.isSafeInteger(value)) return BigInt(value);
  throw new TypeError(`mailbox: column ${column} is not an int64`);
}

/** The next mail ID of the user: `last_mail_id` + 1, written back in the same statement. */
export function next_mail_id(db: DbHandle, user_id: bigint): bigint {
  const rows = db.query(
    `INSERT INTO ${MAIL_COUNTER} (user_id, last_mail_id, next_expires_at) VALUES ($1, 1, 0) ` +
      `ON CONFLICT (user_id) DO UPDATE SET last_mail_id = ${MAIL_COUNTER}.last_mail_id + 1 RETURNING last_mail_id`,
    [user_id],
  );
  return int64(rows[0], 'last_mail_id');
}

/** The user's `next_expires_at`: 0 when the user has no counter row. */
export function read_next_expires_at(db: DbHandle, user_id: bigint): bigint {
  const rows = db.query(`SELECT next_expires_at FROM ${MAIL_COUNTER} WHERE user_id = $1`, [user_id]);
  return rows.length === 0 ? 0n : int64(rows[0], 'next_expires_at');
}

/** Lowers the user's `next_expires_at` to `expires_at` (≠ 0) when it is 0 or larger. The counter row exists. */
export function lower_next_expires_at(db: DbHandle, user_id: bigint, expires_at: bigint): void {
  db.query(
    `UPDATE ${MAIL_COUNTER} SET next_expires_at = $2 WHERE user_id = $1 AND (next_expires_at = 0 OR next_expires_at > $3)`,
    [user_id, expires_at, expires_at],
  );
}

export function set_next_expires_at(db: DbHandle, user_id: bigint, next_expires_at: bigint): void {
  db.query(`UPDATE ${MAIL_COUNTER} SET next_expires_at = $2 WHERE user_id = $1`, [user_id, next_expires_at]);
}

/** The `mail_id` of the user's `once_key` row, or null when the row does not exist. */
export function find_once_key(db: DbHandle, user_id: bigint, once_key: string): bigint | null {
  const rows = db.query(`SELECT mail_id FROM ${ONCE_KEY} WHERE user_id = $1 AND once_key = $2`, [user_id, once_key]);
  return rows.length === 0 ? null : int64(rows[0], 'mail_id');
}

/** The ones of `once_keys` that have a row of the user, in one query. */
export function find_once_keys(db: DbHandle, user_id: bigint, once_keys: readonly string[]): Set<string> {
  if (once_keys.length === 0) return new Set();
  const params = once_keys.map((_, index) => `$${String(index + 2)}`).join(', ');
  const rows = db.query(`SELECT once_key FROM ${ONCE_KEY} WHERE user_id = $1 AND once_key IN (${params})`, [user_id, ...once_keys]);
  return new Set(rows.map((row) => row.once_key).filter((key): key is string => typeof key === 'string'));
}

export function insert_once_key(db: DbHandle, user_id: bigint, once_key: string, mail_id: bigint): void {
  db.query(`INSERT INTO ${ONCE_KEY} (user_id, once_key, mail_id) VALUES ($1, $2, $3)`, [user_id, once_key, mail_id]);
}

/**
 * The mail IDs of the k-th keys from `from_k` up to the first k without a row, in order. The first key is `once_key`
 * and the k-th key (k ≥ 2) is `<once_key>:<k>`.
 */
export function once_key_mail_ids(db: DbHandle, user_id: bigint, once_key: string, from_k = 1): bigint[] {
  const out: bigint[] = [];
  for (let k = from_k; ; k += 1) {
    const mail_id = find_once_key(db, user_id, k === 1 ? once_key : `${once_key}:${String(k)}`);
    if (mail_id === null) return out;
    out.push(mail_id);
  }
}

/** The next broadcast ID: `last_broadcast_id` + 1 of the `id` 0 row, written back in the same statement. */
export function next_broadcast_id(db: DbHandle): bigint {
  const rows = db.query(
    `INSERT INTO ${BROADCAST_COUNTER} (id, last_broadcast_id) VALUES (0, 1) ` +
      `ON CONFLICT (id) DO UPDATE SET last_broadcast_id = ${BROADCAST_COUNTER}.last_broadcast_id + 1 RETURNING last_broadcast_id`,
    [],
  );
  return int64(rows[0], 'last_broadcast_id');
}

export interface BroadcastRow {
  readonly broadcast_id: bigint;
  readonly mail: string;
  readonly start_at: bigint;
  readonly cancelled: boolean;
  readonly expires_at: bigint;
}

function broadcast_row(row: DbRow): BroadcastRow {
  const mail = row.mail;
  if (typeof mail !== 'string') throw new TypeError('mailbox: column mail is not a string');
  return {
    broadcast_id: int64(row, 'broadcast_id'),
    mail,
    start_at: int64(row, 'start_at'),
    cancelled: row.cancelled === true || row.cancelled === 1 || row.cancelled === 1n,
    expires_at: int64(row, 'expires_at'),
  };
}

export function insert_broadcast(db: DbHandle, row: BroadcastRow, created_at: bigint): void {
  db.query(
    `INSERT INTO ${BROADCAST} (broadcast_id, mail, start_at, cancelled, created_at, expires_at) VALUES ($1, $2, $3, $4, $5, $6)`,
    [row.broadcast_id, row.mail, row.start_at, row.cancelled, created_at, row.expires_at],
  );
}

/** The broadcast row, or null when it does not exist or `expires_at` ≤ `clock_now` (`storage` `### expiry`). */
export function find_broadcast(db: DbHandle, broadcast_id: bigint, clock_now: bigint): BroadcastRow | null {
  const rows = db.query(`SELECT broadcast_id, mail, start_at, cancelled, expires_at FROM ${BROADCAST} WHERE broadcast_id = $1`, [broadcast_id]);
  const row = rows[0];
  if (row === undefined) return null;
  const found = broadcast_row(row);
  return found.expires_at <= clock_now ? null : found;
}

export function cancel_broadcast_row(db: DbHandle, broadcast_id: bigint): void {
  db.query(`UPDATE ${BROADCAST} SET cancelled = $1 WHERE broadcast_id = $2`, [true, broadcast_id]);
}

/**
 * The broadcast rows not cancelled with `start_at` ≤ `time` < `expires_at` and `expires_at` > `clock_now`, in
 * broadcast ID order.
 */
export function active_broadcasts(db: DbHandle, time: bigint, clock_now: bigint): BroadcastRow[] {
  const rows = db.query(
    `SELECT broadcast_id, mail, start_at, cancelled, expires_at FROM ${BROADCAST} ` +
      'WHERE start_at <= $1 AND expires_at > $2 AND expires_at > $3 ORDER BY broadcast_id',
    [time, time, clock_now],
  );
  return rows.map(broadcast_row).filter((row) => !row.cancelled);
}
