/**
 * The tables of game-update (`game-update` `### table`) and the parameter SQL on them. Every function takes the DB
 * handle of the transaction it runs in, or `storage.read_db`'s handle.
 */
import type { ColumnInput } from '../storage/index.ts';
import type { DbHandle } from './deps.ts';

export const FILE_TABLE = 'game_update_file';
export const DEPLOY_LIST_TABLE = 'game_update_deploy_list';
export const CDN_UPLOAD_TABLE = 'game_update_cdn_upload';

/** The `game_update_deploy_list` key `lock_game_row` takes to order publishes and prunes. No row has it. */
export const LOCK_KEY: readonly bigint[] = [0n];

/** One `storage.register_table` call: scope `game`, no expiry column, no snapshot setting. */
export interface TableDefinition {
  readonly name: string;
  readonly columns: readonly ColumnInput[];
  readonly key: readonly string[];
}

export const TABLES: readonly TableDefinition[] = [
  { name: FILE_TABLE, columns: [{ name: 'sha256', type: 'string' }, { name: 'size', type: 'int64' }, { name: 'content', type: 'bytes' }, { name: 'created_at', type: 'int64' }], key: ['sha256'] },
  { name: DEPLOY_LIST_TABLE, columns: [{ name: 'sequence', type: 'int64' }, { name: 'deploy_list', type: 'bytes' }, { name: 'signature', type: 'string' }, { name: 'published_at', type: 'int64' }], key: ['sequence'] },
  { name: CDN_UPLOAD_TABLE, columns: [{ name: 'sha256', type: 'string' }, { name: 'uploaded_at', type: 'int64' }], key: ['sha256'] },
];

type Value = ReturnType<DbHandle['query']>[number][string];

/** A stored deploy list: the signed bytes and the signature JSON. */
export interface StoredDeployList {
  readonly sequence: bigint;
  readonly deploy_list: Uint8Array;
  readonly signature: string;
  readonly published_at: bigint;
}

function as_bigint(value: Value | undefined): bigint {
  if (typeof value === 'bigint') return value;
  if (typeof value === 'number' && Number.isSafeInteger(value)) return BigInt(value);
  throw new TypeError(`game-update: ${String(value)} is not an int64 column value`);
}

function as_bytes(value: Value | undefined): Uint8Array {
  if (value instanceof Uint8Array) return value;
  throw new TypeError('game-update: not a bytes column value');
}

/** Stores a file unless a file of that `sha256` is there. Stored files do not change. */
export function insert_file(db: DbHandle, sha256: string, content: Uint8Array, now: bigint): void {
  db.query(`INSERT INTO ${FILE_TABLE} (sha256, size, content, created_at) VALUES ($1, $2, $3, $4) ON CONFLICT (sha256) DO NOTHING`, [
    sha256,
    BigInt(content.byteLength),
    content,
    now,
  ]);
}

/** The stored size of each given `sha256` that is stored. */
export function file_sizes(db: DbHandle, sha256s: readonly string[]): Map<string, bigint> {
  const out = new Map<string, bigint>();
  for (const sha256 of new Set(sha256s)) {
    const row = db.query(`SELECT size FROM ${FILE_TABLE} WHERE sha256 = $1`, [sha256])[0];
    if (row !== undefined) out.set(sha256, as_bigint(row.size));
  }
  return out;
}

/** The bytes of a stored file, or null. */
export function file_content(db: DbHandle, sha256: string): Uint8Array | null {
  const row = db.query(`SELECT content FROM ${FILE_TABLE} WHERE sha256 = $1`, [sha256])[0];
  return row === undefined ? null : as_bytes(row.content);
}

/** Every stored file `sha256`. */
export function file_sha256s(db: DbHandle): string[] {
  return db.query(`SELECT sha256 FROM ${FILE_TABLE} ORDER BY sha256`, []).map((row) => String(row.sha256));
}

export function delete_file(db: DbHandle, sha256: string): void {
  db.query(`DELETE FROM ${FILE_TABLE} WHERE sha256 = $1`, [sha256]);
}

/** The current deploy list: the row of the largest `sequence`, or null. */
export function current_deploy_list(db: DbHandle): StoredDeployList | null {
  const row = db.query(`SELECT sequence, deploy_list, signature, published_at FROM ${DEPLOY_LIST_TABLE} ORDER BY sequence DESC LIMIT 1`, [])[0];
  if (row === undefined) return null;
  return { sequence: as_bigint(row.sequence), deploy_list: as_bytes(row.deploy_list), signature: String(row.signature), published_at: as_bigint(row.published_at) };
}

/** Every stored deploy list's bytes. */
export function all_deploy_lists(db: DbHandle): Uint8Array[] {
  return db.query(`SELECT deploy_list FROM ${DEPLOY_LIST_TABLE} ORDER BY sequence`, []).map((row) => as_bytes(row.deploy_list));
}

export function insert_deploy_list(db: DbHandle, list: StoredDeployList): void {
  db.query(`INSERT INTO ${DEPLOY_LIST_TABLE} (sequence, deploy_list, signature, published_at) VALUES ($1, $2, $3, $4)`, [
    list.sequence,
    list.deploy_list,
    list.signature,
    list.published_at,
  ]);
}

/** Deletes every deploy list but the newest `keep`. */
export function keep_newest_deploy_lists(db: DbHandle, keep: number): void {
  const rows = db.query(`SELECT sequence FROM ${DEPLOY_LIST_TABLE} ORDER BY sequence DESC`, []);
  for (const row of rows.slice(keep)) db.query(`DELETE FROM ${DEPLOY_LIST_TABLE} WHERE sequence = $1`, [as_bigint(row.sequence)]);
}

/** The given `sha256`s that have an upload record. */
export function uploaded_sha256s(db: DbHandle, sha256s: readonly string[]): Set<string> {
  const out = new Set<string>();
  for (const sha256 of new Set(sha256s)) {
    if (db.query(`SELECT sha256 FROM ${CDN_UPLOAD_TABLE} WHERE sha256 = $1`, [sha256]).length > 0) out.add(sha256);
  }
  return out;
}

export function insert_upload(db: DbHandle, sha256: string, now: bigint): void {
  db.query(`INSERT INTO ${CDN_UPLOAD_TABLE} (sha256, uploaded_at) VALUES ($1, $2) ON CONFLICT (sha256) DO NOTHING`, [sha256, now]);
}
