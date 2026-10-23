/**
 * Draw records (`### draw record`): one row per draw, in the table `gacha_draw_record` registered with
 * `storage.register_table`. A row whose `expires_at` is at or before `server-time.clock_now` counts as no row.
 */
import * as CoreContract from '../../generated/contract/core_contract.ts';
import type { ColumnInput, DbHandle, Storage } from '../storage/index.ts';

export const RECORD_TABLE = 'gacha_draw_record';

const COLUMNS: readonly ColumnInput[] = [
  { name: 'user_id', type: 'int64' },
  { name: 'draw_seq', type: 'int64' },
  { name: 'drawn_at', type: 'int64' },
  { name: 'request_id', type: 'string' },
  { name: 'banner_id', type: 'int32' },
  { name: 'draw_index', type: 'int32' },
  { name: 'kind', type: 'string' },
  { name: 'rate_up', type: 'bool' },
  { name: 'items', type: 'string' },
  { name: 'pity_count_before', type: 'int32' },
  { name: 'cost', type: 'string' },
  { name: 'data_version', type: 'string' },
  { name: 'expires_at', type: 'int64' },
];

const SELECTED = 'user_id, draw_seq, drawn_at, request_id, banner_id, draw_index, kind, rate_up, items, pity_count_before, cost, data_version, expires_at';

// draw_seq is the user's largest draw_seq + 1, taken in the same statement as the write (`storage` `### expiry`).
// Rows that expired but are not swept yet still count, so the new key never meets an existing row.
const INSERT =
  `INSERT INTO ${RECORD_TABLE} (${SELECTED}) VALUES ` +
  `($1, (SELECT COALESCE(MAX(draw_seq), 0) + 1 FROM ${RECORD_TABLE} WHERE user_id = $1), $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) RETURNING draw_seq`;

// A banner's rows are read by RECORD_BANNER_INDEX: those queries hold the banner as a plain equality so the index applies.
const LIST_LATEST = `SELECT ${SELECTED} FROM ${RECORD_TABLE} WHERE user_id = $1 AND expires_at > $2 ORDER BY draw_seq DESC LIMIT $3`;
const LIST_BEFORE = `SELECT ${SELECTED} FROM ${RECORD_TABLE} WHERE user_id = $1 AND expires_at > $2 AND draw_seq < $4 ORDER BY draw_seq DESC LIMIT $3`;
const LIST_BANNER_LATEST =
  `SELECT ${SELECTED} FROM ${RECORD_TABLE} WHERE user_id = $1 AND banner_id = $4 AND expires_at > $2 ORDER BY draw_seq DESC LIMIT $3`;
const LIST_BANNER_BEFORE =
  `SELECT ${SELECTED} FROM ${RECORD_TABLE} WHERE user_id = $1 AND banner_id = $4 AND expires_at > $2 AND draw_seq < $5 ORDER BY draw_seq DESC LIMIT $3`;
const LIST_RANGE =
  `SELECT ${SELECTED} FROM ${RECORD_TABLE} WHERE user_id = $1 AND expires_at > $2 AND drawn_at >= $3 AND drawn_at < $4 AND draw_seq > $5 ` +
  'ORDER BY draw_seq ASC LIMIT $6';

/** The index `ListGachaHistory` reads one banner's rows by. */
export const RECORD_BANNER_INDEX: readonly string[] = ['user_id', 'banner_id', 'draw_seq'];
/** The index `list_gacha_history` reads its `drawn_at` range by. */
export const RECORD_TIME_INDEX: readonly string[] = ['user_id', 'drawn_at'];

/**
 * Registers the draw record table: scope `user`, key `(user_id, draw_seq)`, expiry column `expires_at`, in snapshots,
 * indexes `(user_id, banner_id, draw_seq)` and `(user_id, drawn_at)`.
 */
export function register_record_table(storage: Pick<Storage, 'register_table'>): void {
  storage.register_table(RECORD_TABLE, 'user', COLUMNS, ['user_id', 'draw_seq'], 'expires_at', true, null, [RECORD_BANNER_INDEX, RECORD_TIME_INDEX]);
}

/** A draw record to write; `draw_seq` comes from the insert. */
export interface NewRecord {
  readonly user_id: bigint;
  readonly drawn_at: bigint;
  readonly request_id: string;
  readonly banner_id: number;
  readonly draw_index: number;
  readonly kind: CoreContract.GachaDrawKind;
  readonly rate_up: boolean;
  readonly items: readonly CoreContract.ItemAmount[];
  readonly pity_count_before: number;
  readonly cost: readonly CoreContract.ItemAmount[];
  readonly data_version: string;
  readonly expires_at: bigint;
}

/** One draw record as read. `kind` is the `GachaDrawKind` element name; `items` and `cost` are `ItemAmount` lists. */
export interface StoredRecord {
  readonly user_id: bigint;
  readonly draw_seq: bigint;
  readonly drawn_at: bigint;
  readonly request_id: string;
  readonly banner_id: number;
  readonly draw_index: number;
  readonly kind: string;
  readonly rate_up: boolean;
  readonly items: CoreContract.ItemAmount[];
  readonly pity_count_before: number;
  readonly cost: CoreContract.ItemAmount[];
  readonly data_version: string;
  readonly expires_at: bigint;
}

const KIND_NAMES: ReadonlyMap<number, string> = new Map(Object.entries(CoreContract.GachaDrawKind).map(([name, value]) => [value, name]));

function kind_name(kind: CoreContract.GachaDrawKind): string {
  const name = KIND_NAMES.get(kind);
  if (name === undefined) throw new RangeError(`gacha: ${String(kind)} is not a GachaDrawKind`);
  return name;
}

function kind_value(name: string): CoreContract.GachaDrawKind {
  const value = (CoreContract.GachaDrawKind as Readonly<Record<string, CoreContract.GachaDrawKind>>)[name];
  if (value === undefined) throw new RangeError(`gacha: stored kind ${name} is not a GachaDrawKind element name`);
  return value;
}

/** An `ItemAmount` list as stored: the proto3 JSON text of the list (a JSON array of `ItemAmount` objects). */
export function items_text(items: readonly CoreContract.ItemAmount[]): string {
  return JSON.stringify(items.map((item) => item.to_json()));
}

export function items_of_text(text: string): CoreContract.ItemAmount[] {
  const parsed: unknown = JSON.parse(text);
  if (!Array.isArray(parsed)) throw new TypeError('gacha: a stored item list is not an array');
  return parsed.map((entry: unknown) => {
    const item = CoreContract.ItemAmount.from_json(entry);
    if (item === null) throw new TypeError('gacha: a stored item is not an ItemAmount');
    return item;
  });
}

function int64(value: unknown): bigint {
  if (typeof value === 'bigint') return value;
  if (typeof value === 'number' && Number.isSafeInteger(value)) return BigInt(value);
  if (typeof value === 'string' && /^-?\d+$/.test(value)) return BigInt(value);
  throw new TypeError(`gacha: ${String(value)} is not an int64 column value`);
}

function int32(value: unknown): number {
  return Number(int64(value));
}

function bool(value: unknown): boolean {
  return value === true || value === 1 || value === 1n;
}

function text(value: unknown): string {
  if (typeof value !== 'string') throw new TypeError('gacha: a string column value is not a string');
  return value;
}

function stored(row: Readonly<Record<string, unknown>>): StoredRecord {
  return {
    user_id: int64(row.user_id),
    draw_seq: int64(row.draw_seq),
    drawn_at: int64(row.drawn_at),
    request_id: text(row.request_id),
    banner_id: int32(row.banner_id),
    draw_index: int32(row.draw_index),
    kind: text(row.kind),
    rate_up: bool(row.rate_up),
    items: items_of_text(text(row.items)),
    pity_count_before: int32(row.pity_count_before),
    cost: items_of_text(text(row.cost)),
    data_version: text(row.data_version),
    expires_at: int64(row.expires_at),
  };
}

/** Writes one draw record and returns its `draw_seq`. */
export function insert_record(db: DbHandle, record: NewRecord): bigint {
  const rows = db.query(INSERT, [
    record.user_id,
    record.drawn_at,
    record.request_id,
    record.banner_id,
    record.draw_index,
    kind_name(record.kind),
    record.rate_up,
    items_text(record.items),
    record.pity_count_before,
    items_text(record.cost),
    record.data_version,
    record.expires_at,
  ]);
  return int64(rows[0]?.draw_seq);
}

/**
 * `ListGachaHistory`: the user's live rows by `draw_seq` descending, of one banner or of all (banner 0), from the
 * largest `draw_seq` (cursor 0) or below the cursor.
 */
export function list_latest(db: DbHandle, user_id: bigint, now: bigint, banner_id: number, cursor: bigint, max_rows: number): StoredRecord[] {
  if (banner_id === 0) {
    const rows = cursor === 0n ? db.query(LIST_LATEST, [user_id, now, max_rows]) : db.query(LIST_BEFORE, [user_id, now, max_rows, cursor]);
    return rows.map(stored);
  }
  const rows = cursor === 0n ? db.query(LIST_BANNER_LATEST, [user_id, now, max_rows, banner_id]) : db.query(LIST_BANNER_BEFORE, [user_id, now, max_rows, banner_id, cursor]);
  return rows.map(stored);
}

/** `list_gacha_history`: the user's live rows with `from_at` ≤ `drawn_at` < `to_at` after `after_seq`, by `draw_seq` ascending. */
export function list_range(db: DbHandle, user_id: bigint, now: bigint, from_at: bigint, to_at: bigint, after_seq: bigint, limit: number): StoredRecord[] {
  return db.query(LIST_RANGE, [user_id, now, from_at, to_at, after_seq, limit]).map(stored);
}

/** A row as a `GachaHistoryEntry` of `ListGachaHistory`. */
export function history_entry(record: StoredRecord): CoreContract.GachaHistoryEntry {
  const entry = new CoreContract.GachaHistoryEntry();
  entry.draw_seq = record.draw_seq;
  entry.drawn_at = record.drawn_at;
  entry.banner_id = record.banner_id;
  entry.draw_index = record.draw_index;
  entry.kind = kind_value(record.kind);
  entry.rate_up = record.rate_up;
  entry.items = record.items;
  return entry;
}

/**
 * A row with every column as the admin output JSON object: `items` and `cost` are their proto3 JSON arrays, not
 * text; admin-api writes the bigints as decimal strings.
 */
export function admin_entry(record: StoredRecord): Record<string, unknown> {
  return { ...record, items: record.items.map((item) => item.to_json()), cost: record.cost.map((item) => item.to_json()) };
}
