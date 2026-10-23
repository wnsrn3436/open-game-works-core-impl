import type { DbHandle, Storage } from '../storage/index.ts';

/** A value bound to or read from a query: `int64` is `bigint`, `int32` is `number`. */
export type DbValue = bigint | number | string | boolean | Uint8Array | null;
type DbRow = Readonly<Record<string, DbValue>>;
type ColumnDef = { readonly name: string; readonly type: 'int64' | 'int32' | 'string' | 'bytes' };

export const CLIENT_ERROR = 'logging_client_error';
export const CLIENT_EVENT = 'logging_client_event';
export const SERVER_EVENT = 'logging_server_event';
export const REPORT_COUNTER = 'logging_report_counter';
export const ANALYTICS_DELETION = 'logging_analytics_deletion';

/** The tables whose rows the admin list operations return. */
export type ListedTable = typeof CLIENT_ERROR | typeof CLIENT_EVENT | typeof SERVER_EVENT;

const COLUMNS: Readonly<Record<string, readonly ColumnDef[]>> = {
  [CLIENT_ERROR]: [
    { name: 'user_id', type: 'int64' },
    { name: 'seq', type: 'int64' },
    { name: 'time_at', type: 'int64' },
    { name: 'received_at', type: 'int64' },
    { name: 'client_version', type: 'string' },
    { name: 'platform', type: 'string' },
    { name: 'level', type: 'string' },
    { name: 'tag', type: 'string' },
    { name: 'message', type: 'string' },
    { name: 'stack_trace', type: 'string' },
    { name: 'expires_at', type: 'int64' },
  ],
  [CLIENT_EVENT]: [
    { name: 'user_id', type: 'int64' },
    { name: 'seq', type: 'int64' },
    { name: 'time_at', type: 'int64' },
    { name: 'received_at', type: 'int64' },
    { name: 'client_version', type: 'string' },
    { name: 'platform', type: 'string' },
    { name: 'name', type: 'string' },
    { name: 'params', type: 'bytes' },
    { name: 'expires_at', type: 'int64' },
  ],
  [SERVER_EVENT]: [
    { name: 'user_id', type: 'int64' },
    { name: 'seq', type: 'int64' },
    { name: 'time_at', type: 'int64' },
    { name: 'request_id', type: 'string' },
    { name: 'client_version', type: 'string' },
    { name: 'platform', type: 'string' },
    { name: 'name', type: 'string' },
    { name: 'params', type: 'bytes' },
    { name: 'expires_at', type: 'int64' },
  ],
  [REPORT_COUNTER]: [
    { name: 'user_id', type: 'int64' },
    { name: 'window_start', type: 'int64' },
    { name: 'count', type: 'int64' },
    { name: 'expires_at', type: 'int64' },
  ],
  [ANALYTICS_DELETION]: [
    { name: 'user_id', type: 'int64' },
    { name: 'attempts', type: 'int32' },
    { name: 'created_at', type: 'int64' },
  ],
};

/** Registers the logging tables with `storage.register_table`. */
export function register_tables(storage: Storage): void {
  for (const table of [CLIENT_ERROR, CLIENT_EVENT, SERVER_EVENT]) {
    storage.register_table(table, 'user', COLUMNS[table] as readonly ColumnDef[], ['user_id', 'seq'], 'expires_at', false, 'user_id', [['time_at', 'user_id', 'seq']]);
  }
  storage.register_table(REPORT_COUNTER, 'user', COLUMNS[REPORT_COUNTER] as readonly ColumnDef[], ['user_id'], 'expires_at', false);
  storage.register_table(ANALYTICS_DELETION, 'game', COLUMNS[ANALYTICS_DELETION] as readonly ColumnDef[], ['user_id'], null, null, null, [['created_at']]);
}

/**
 * An insert of one row of a log table in one statement: `seq` is the user's highest `seq` in the table plus 1, so the
 * row is written without writing back a value read before. Params: the columns in table order without `seq`.
 */
function insert_sql(table: string): string {
  const columns = (COLUMNS[table] as readonly ColumnDef[]).map((c) => c.name);
  let n = 0;
  const values = columns.map((c) => (c === 'seq' ? `(SELECT COALESCE(MAX(seq), 0) + 1 FROM ${table} WHERE user_id = $1)` : `$${String((n += 1))}`));
  return `INSERT INTO ${table} (${columns.join(', ')}) VALUES (${values.join(', ')})`;
}

export const INSERT_CLIENT_ERROR = insert_sql(CLIENT_ERROR);
export const INSERT_CLIENT_EVENT = insert_sql(CLIENT_EVENT);
export const INSERT_SERVER_EVENT = insert_sql(SERVER_EVENT);

/**
 * The report counter upsert: a new minute window starts at 1, the same window counts up. Reads the count it wrote.
 * Params: user ID, window start, window end.
 */
export const UPSERT_REPORT_COUNTER = `INSERT INTO ${REPORT_COUNTER} (user_id, window_start, count, expires_at) VALUES ($1, $2, 1, $3)
ON CONFLICT (user_id) DO UPDATE SET
  count = CASE WHEN ${REPORT_COUNTER}.window_start = excluded.window_start THEN ${REPORT_COUNTER}.count + 1 ELSE 1 END,
  window_start = excluded.window_start,
  expires_at = excluded.expires_at
RETURNING count`;

/** Params: user ID, created at. */
export const INSERT_ANALYTICS_DELETION = `INSERT INTO ${ANALYTICS_DELETION} (user_id, attempts, created_at) VALUES ($1, 0, $2) ON CONFLICT (user_id) DO NOTHING`;
/** Params: limit. */
export const SELECT_ANALYTICS_DELETIONS = `SELECT user_id FROM ${ANALYTICS_DELETION} ORDER BY created_at, user_id LIMIT $1`;
/** Params: user ID. */
export const DELETE_ANALYTICS_DELETION = `DELETE FROM ${ANALYTICS_DELETION} WHERE user_id = $1`;
/** Params: user ID. */
export const COUNT_ANALYTICS_DELETION_ATTEMPT = `UPDATE ${ANALYTICS_DELETION} SET attempts = attempts + 1 WHERE user_id = $1 RETURNING attempts`;

export function int64_of(value: DbValue | undefined): bigint {
  if (typeof value === 'bigint') return value;
  if (typeof value === 'number' || typeof value === 'string') return BigInt(value);
  throw new TypeError(`logging: ${String(value)} is not an int64 value`);
}

/** The filter and cursor of an admin list operation. */
export interface ListQuery {
  readonly user_id: bigint | null;
  readonly name: string | null;
  readonly from_at: bigint;
  readonly to_at: bigint;
  readonly after: { readonly time_at: bigint; readonly user_id: bigint; readonly seq: bigint } | null;
  readonly limit: number;
  /** `server-time.clock_now`: rows whose `expires_at` is at or before it are absent. */
  readonly now: bigint;
}

/** The rows of `[from_at, to_at)` that have not expired, by `(time_at, user_id, seq)`, after the cursor, at most `limit`. */
export function list_rows(db: DbHandle, table: ListedTable, query: ListQuery): readonly DbRow[] {
  const params: DbValue[] = [query.from_at, query.to_at, query.now];
  const where = ['time_at >= $1', 'time_at < $2', 'expires_at > $3'];
  const param = (value: DbValue): string => {
    params.push(value);
    return `$${String(params.length)}`;
  };
  if (query.user_id !== null) where.push(`user_id = ${param(query.user_id)}`);
  if (query.name !== null) where.push(`name = ${param(query.name)}`);
  if (query.after !== null) {
    const t1 = param(query.after.time_at);
    const t2 = param(query.after.time_at);
    const u1 = param(query.after.user_id);
    const u2 = param(query.after.user_id);
    const s = param(query.after.seq);
    where.push(`(time_at > ${t1} OR (time_at = ${t2} AND (user_id > ${u1} OR (user_id = ${u2} AND seq > ${s}))))`);
  }
  const limit = param(query.limit);
  const columns = (COLUMNS[table] as readonly ColumnDef[]).map((c) => c.name).join(', ');
  return db.query(`SELECT ${columns} FROM ${table} WHERE ${where.join(' AND ')} ORDER BY time_at, user_id, seq LIMIT ${limit}`, params);
}

/** A row as an admin `entries` element: every column, `int64` as a decimal string, bytes as standard base64. */
export function entry_of(table: ListedTable, row: DbRow): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const column of COLUMNS[table] as readonly ColumnDef[]) {
    const value = row[column.name] ?? null;
    if (column.type === 'int64') out[column.name] = int64_of(value).toString();
    else if (column.type === 'bytes') out[column.name] = Buffer.from(value instanceof Uint8Array ? value : new Uint8Array(0)).toString('base64');
    else out[column.name] = value;
  }
  return out;
}
