/** The history table and the `once_key` table (`## behavior` storage and client delivery). */
import * as CoreContract from '../../generated/contract/core_contract.ts';
import type { ColumnType, DbHandle, Storage } from '../storage/index.ts';
import { read_big, write_big } from './items.ts';

type DbValue = bigint | number | string | boolean | Uint8Array | null;
type DbRow = Readonly<Record<string, DbValue>>;
type TableColumn = { readonly name: string; readonly type: ColumnType };

export const HISTORY_TABLE = 'item_ledger_history';
export const ONCE_KEY_TABLE = 'item_ledger_once_key';

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

const ONCE_KEY_COLUMNS: readonly TableColumn[] = [
  { name: 'user_id', type: 'int64' },
  { name: 'once_key', type: 'string' },
  { name: 'expires_at', type: 'int64' },
];

/** The index `list_history` reads its time range by. */
export const HISTORY_TIME_INDEX: readonly string[] = ['user_id', 'time'];

export function register_tables(storage: Storage): void {
  storage.register_table(HISTORY_TABLE, 'user', HISTORY_COLUMNS, ['user_id', 'seq'], 'expires_at', false, null, [HISTORY_TIME_INDEX]);
  storage.register_table(ONCE_KEY_TABLE, 'user', ONCE_KEY_COLUMNS, ['user_id', 'once_key'], 'expires_at', true);
}

/** One history row. `source` is the `ItemChangeSource` element name. */
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
  source: string;
  ref: string;
  once_key: string;
  request_id: string | null;
  ends_at_after: bigint;
}

/** A history row before `seq` and `time` are given. */
export type NewHistoryRow = Omit<HistoryRow, 'seq' | 'time' | 'user_id' | 'request_id'>;

const SOURCE_NAMES: ReadonlyMap<number, string> = new Map(Object.entries(CoreContract.ItemChangeSource).map(([k, v]) => [v, k]));

export function source_name(source: CoreContract.ItemChangeSource): string {
  return SOURCE_NAMES.get(source) ?? String(source);
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

/**
 * Writes rows in the given order, each in one statement whose `seq` is the user's largest + 1 (1 when there is none),
 * so no value read before is written back while the expiry sweep may delete rows.
 */
export function insert_history(
  db: DbHandle, user_id: bigint, time: bigint, request_id: string | null, expires_at: bigint, rows: readonly NewHistoryRow[],
): void {
  for (const r of rows) {
    const [delta, big_delta] = split(r.delta);
    const [balance_after, big_balance_after] = split(r.balance_after);
    const [overflow, big_overflow] = split(r.overflow);
    const [shortfall, big_shortfall] = split(r.shortfall);
    db.query(
      `INSERT INTO ${HISTORY_TABLE} (user_id, seq, time, item_id, delta, balance_after, overflow, shortfall, source, ref, once_key, request_id, ends_at_after, big_delta, big_balance_after, big_overflow, big_shortfall, expires_at) VALUES ($1, (SELECT COALESCE(MAX(seq), 0) + 1 FROM ${HISTORY_TABLE} WHERE user_id = $1), $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)`,
      [user_id, time, r.item_id, delta, balance_after, overflow, shortfall, r.source, r.ref, r.once_key, request_id, r.ends_at_after,
        big_delta, big_balance_after, big_overflow, big_shortfall, expires_at],
    );
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
    source: String(r['source']), ref: String(r['ref']), once_key: String(r['once_key']),
    request_id: r['request_id'] === null || r['request_id'] === undefined ? null : String(r['request_id']),
    ends_at_after: int64(r['ends_at_after']),
  };
}

/** True when the user has a `once_key` row that has not expired. */
export function has_once_key(db: DbHandle, user_id: bigint, once_key: string, now: bigint): boolean {
  return db.query(`SELECT 1 AS found FROM ${ONCE_KEY_TABLE} WHERE user_id = $1 AND once_key = $2 AND expires_at > $3`, [user_id, once_key, now]).length > 0;
}

/** Writes the `once_key` row in one upsert: an expired row that the sweep has not removed yet is written over. */
export function put_once_key(db: DbHandle, user_id: bigint, once_key: string, expires_at: bigint): void {
  db.query(
    `INSERT INTO ${ONCE_KEY_TABLE} (user_id, once_key, expires_at) VALUES ($1, $2, $3) ON CONFLICT (user_id, once_key) DO UPDATE SET expires_at = excluded.expires_at`,
    [user_id, once_key, expires_at],
  );
}
