/** The history table and the `once_key` table (`## behavior` storage and client delivery). */
import { createHash } from 'node:crypto';
import * as CoreContract from '../../generated/contract/core_contract.ts';
import type { ColumnType, DbHandle, Storage } from '../storage/index.ts';
import { read_big, write_big } from './items.ts';

type DbValue = bigint | number | string | boolean | Uint8Array | null;
type DbRow = Readonly<Record<string, DbValue>>;
type TableColumn = { readonly name: string; readonly type: ColumnType };

export const HISTORY_TABLE = 'item_ledger_history';
export const ONCE_KEY_TABLE = 'item_ledger_once_key';
/** The history counter: the last `seq` given per user. */
export const HISTORY_SEQ_TABLE = 'item_ledger_history_seq';

const HISTORY_COLUMNS: readonly TableColumn[] = [
  { name: 'user_id', type: 'int64' },
  { name: 'seq', type: 'int64' },
  { name: 'time', type: 'int64' },
  { name: 'item_id', type: 'int32' },
  { name: 'delta', type: 'int64' },
  { name: 'balance_after', type: 'int64' },
  { name: 'overflow', type: 'int64' },
  { name: 'shortfall', type: 'int64' },
  { name: 'source', type: 'string' },
  { name: 'ref', type: 'string' },
  { name: 'once_key', type: 'string' },
  { name: 'request_id', type: 'string?' },
  { name: 'ends_at_after', type: 'int64' },
  { name: 'big_delta', type: 'string?' },
  { name: 'big_balance_after', type: 'string?' },
  { name: 'big_overflow', type: 'string?' },
  { name: 'big_shortfall', type: 'string?' },
  { name: 'expires_at', type: 'int64' },
];

const HISTORY_SEQ_COLUMNS: readonly TableColumn[] = [
  { name: 'user_id', type: 'int64' },
  { name: 'last_seq', type: 'int64' },
];

const ONCE_KEY_COLUMNS: readonly TableColumn[] = [
  { name: 'user_id', type: 'int64' },
  { name: 'once_key', type: 'string' },
  { name: 'expires_at', type: 'int64' },
];

/** The index `list_history` reads its time range by. */
export const HISTORY_TIME_INDEX: readonly string[] = ['user_id', 'time'];

export function register_tables(storage: Storage): void {
  // Personal data user column `user_id`: the history is the user's purchase and spending record.
  storage.register_table(HISTORY_TABLE, 'user', HISTORY_COLUMNS, ['user_id', 'seq'], 'expires_at', false, 'user_id', [HISTORY_TIME_INDEX]);
  storage.register_table(HISTORY_SEQ_TABLE, 'user', HISTORY_SEQ_COLUMNS, ['user_id'], null, false);
  storage.register_table(ONCE_KEY_TABLE, 'user', ONCE_KEY_COLUMNS, ['user_id', 'once_key'], 'expires_at', true);
}

/**
 * One history row as `list_history` gives it. The table keeps `source` as the `ItemChangeSource` element name; here it is
 * the enum value, 0 for a saved name that is no element of this build's `ItemChangeSource`.
 */
export interface HistoryRow {
  seq: bigint;
  time: bigint;
  user_id: bigint;
  item_id: number;
  /** Signed. Every value is the whole value; the table splits the ones over 2^53−1 into the `big_` columns. */
  delta: bigint;
  balance_after: bigint;
  overflow: bigint;
  shortfall: bigint;
  source: CoreContract.ItemChangeSource;
  ref: string;
  once_key: string;
  request_id: string | null;
  ends_at_after: bigint;
}

/** A history row before `seq` and `time` are given, with `source` the element name the table keeps. */
export type NewHistoryRow = Omit<HistoryRow, 'seq' | 'time' | 'user_id' | 'request_id' | 'source'> & { source: string };

const SOURCE_NAMES: ReadonlyMap<number, string> = new Map(Object.entries(CoreContract.ItemChangeSource).map(([k, v]) => [v, k]));

export function source_name(source: CoreContract.ItemChangeSource): string {
  return SOURCE_NAMES.get(source) ?? String(source);
}

/** The `ItemChangeSource` value of a saved element name; 0 for a name that is no element of this build's enum. */
export function source_value(name: unknown): CoreContract.ItemChangeSource {
  if (typeof name !== 'string' || !Object.hasOwn(CoreContract.ItemChangeSource, name)) return CoreContract.ItemChangeSource.ITEM_CHANGE_SOURCE_UNSPECIFIED;
  return CoreContract.ItemChangeSource[name as keyof typeof CoreContract.ItemChangeSource];
}

/**
 * The form the `once_key` table keeps a `once_key` in: the lowercase hex SHA-256 of its UTF-8 bytes, a key of 64
 * characters for a `once_key` of any length. The caller refuses a `once_key` with an unpaired surrogate first.
 */
export function once_key_hash(once_key: string): string {
  return createHash('sha256').update(once_key, 'utf8').digest('hex');
}

/** A value as its column pair: the `big_` column is null when the value fits in the int64 column. */
function split(v: bigint): [bigint, string | null] {
  const pair = write_big(v);
  return [pair.small, pair.big === '' ? null : pair.big];
}

function int64(v: DbValue | undefined): bigint {
  return typeof v === 'bigint' ? v : BigInt((v as number | null) ?? 0);
}

function join(small: DbValue | undefined, big: DbValue | undefined): bigint {
  const v = read_big(int64(small), typeof big === 'string' ? big : '');
  if (v === null) throw new Error(`item-ledger: history big column ${String(big)} is not a big integer`);
  return v;
}

const HISTORY_INSERT =
  `INSERT INTO ${HISTORY_TABLE} (user_id, seq, time, item_id, delta, balance_after, overflow, shortfall, source, ref, once_key, request_id, ends_at_after, big_delta, big_balance_after, big_overflow, big_shortfall, expires_at) ` +
  'VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)';

/**
 * Takes `count` `seq` values from the history counter in one upsert and returns the last one. A user without a counter
 * row starts from `now`, so the first `seq` is `now` + 1. No history row is read.
 */
function take_seq(db: DbHandle, user_id: bigint, count: bigint, now: bigint): bigint {
  const rows = db.query(
    `INSERT INTO ${HISTORY_SEQ_TABLE} (user_id, last_seq) VALUES ($1, $2) ON CONFLICT (user_id) DO UPDATE SET last_seq = ${HISTORY_SEQ_TABLE}.last_seq + $3 RETURNING last_seq`,
    [user_id, now + count, count],
  ) as readonly DbRow[];
  const last = rows[0]?.['last_seq'];
  if (last === undefined) throw new Error('item-ledger: the history counter upsert returned no row');
  return int64(last);
}

/**
 * Appends rows in the given order with the `seq` values the history counter gives, each with a plain insert: the history
 * is never written over, and a row that already has a key to write fails the statement, so the transaction rolls back.
 */
export function insert_history(
  db: DbHandle, user_id: bigint, time: bigint, request_id: string | null, expires_at: bigint, now: bigint, rows: readonly NewHistoryRow[],
): void {
  if (rows.length === 0) return;
  const count = BigInt(rows.length);
  let seq = take_seq(db, user_id, count, now) - count;
  for (const r of rows) {
    seq += 1n;
    const [delta, big_delta] = split(r.delta);
    const [balance_after, big_balance_after] = split(r.balance_after);
    const [overflow, big_overflow] = split(r.overflow);
    const [shortfall, big_shortfall] = split(r.shortfall);
    db.query(HISTORY_INSERT, [user_id, seq, time, r.item_id, delta, balance_after, overflow, shortfall, r.source, r.ref, r.once_key, request_id,
      r.ends_at_after, big_delta, big_balance_after, big_overflow, big_shortfall, expires_at]);
  }
}

/**
 * Rows with from ≤ `time` < to and `seq` > after, `seq` ascending, at most `limit`, read by the time range of
 * `HISTORY_TIME_INDEX`. Expired rows are not there.
 */
export function select_history(db: DbHandle, user_id: bigint, from: bigint, to: bigint, after: bigint, limit: number, now: bigint): HistoryRow[] {
  const rows = db.query(
    `SELECT * FROM ${HISTORY_TABLE} WHERE user_id = $1 AND time >= $2 AND time < $3 AND seq > $4 AND expires_at > $5 ORDER BY seq ASC LIMIT $6`,
    [user_id, from, to, after, now, BigInt(limit)],
  ) as readonly DbRow[];
  return rows.map(read_row);
}

function read_row(r: DbRow): HistoryRow {
  return {
    seq: int64(r['seq']), time: int64(r['time']), user_id: int64(r['user_id']), item_id: Number(r['item_id']),
    delta: join(r['delta'], r['big_delta']), balance_after: join(r['balance_after'], r['big_balance_after']),
    overflow: join(r['overflow'], r['big_overflow']), shortfall: join(r['shortfall'], r['big_shortfall']),
    source: source_value(r['source']), ref: String(r['ref']), once_key: String(r['once_key']),
    request_id: r['request_id'] === null || r['request_id'] === undefined ? null : String(r['request_id']),
    ends_at_after: int64(r['ends_at_after']),
  };
}

/** True when the user has a `once_key` row of the SHA-256 form of `once_key` that has not expired. */
export function has_once_key(db: DbHandle, user_id: bigint, once_key: string, now: bigint): boolean {
  return db.query(`SELECT 1 AS found FROM ${ONCE_KEY_TABLE} WHERE user_id = $1 AND once_key = $2 AND expires_at > $3`, [user_id, once_key_hash(once_key), now]).length > 0;
}

/**
 * Writes the `once_key` row of the SHA-256 form of `once_key` in one upsert: an expired row that the sweep has not
 * removed yet is written over.
 */
export function put_once_key(db: DbHandle, user_id: bigint, once_key: string, expires_at: bigint): void {
  db.query(
    `INSERT INTO ${ONCE_KEY_TABLE} (user_id, once_key, expires_at) VALUES ($1, $2, $3) ON CONFLICT (user_id, once_key) DO UPDATE SET expires_at = excluded.expires_at`,
    [user_id, once_key_hash(once_key), expires_at],
  );
}
