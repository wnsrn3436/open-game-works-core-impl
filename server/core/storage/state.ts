/**
 * UserState, server state and game state operations (`storage` `## API`, `### storage format`, `### public state`,
 * `### game state`).
 */
import type { DbValue } from './db/types.ts';
import {
  big,
  bytes,
  handle_of,
  q,
  StorageMisuse,
  user_state_of,
  user_state_writable,
  writable,
  type StorageCore,
  type TxState,
} from './core.ts';
import { decode_kind, item_id_of, type Kind, type KindValue } from './kinds.ts';

export interface StoredRow {
  readonly value: Uint8Array;
  readonly version: bigint;
}

/** One user's value of a public kind: a value for a single kind, the values in item ID order for a list kind. */
export interface PublicStateEntry {
  readonly user_id: bigint;
  readonly value: KindValue | KindValue[];
}

function touch_key(column: string, item_id: bigint): string {
  return `${column}\u0000${String(item_id)}`;
}

function table_of(kind: Kind): 'user_state' | 'server_state' {
  return kind.info.store === 'server_state' ? 'server_state' : 'user_state';
}

/** The kind of a kind class for UserState and server state operations; misuse otherwise. */
export function user_kind(core: StorageCore, kind_class: unknown): Kind {
  const kind = core.kinds.of_class(kind_class);
  if (kind === null || kind.info.store === 'game_state') throw new StorageMisuse('storage: not a UserState or server state kind');
  return kind;
}

export function game_kind(core: Pick<StorageCore, 'kinds'>, kind_class: unknown): Kind {
  const kind = core.kinds.of_class(kind_class);
  if (kind?.info.store !== 'game_state') throw new StorageMisuse('storage: not a game state kind');
  return kind;
}

export function check_item_id(kind: Kind, item_id: unknown): bigint {
  if (typeof item_id !== 'bigint') throw new StorageMisuse(`storage: item ID of ${kind.info.name} is not a bigint`);
  if (kind.info.store === 'game_state' && item_id < 0n) throw new StorageMisuse(`storage: negative game state key ${String(item_id)}`);
  if (kind.info.store !== 'game_state' && kind.info.is_list && item_id < 0n) throw new StorageMisuse(`storage: negative item ID ${String(item_id)} of list kind ${kind.info.name}`);
  if (kind.info.store !== 'game_state' && !kind.info.is_list && item_id !== 0n) throw new StorageMisuse(`storage: item ID ${String(item_id)} of single kind ${kind.info.name} is not 0`);
  return item_id;
}

/** The kind of a kind value; misuse when it is not a kind message. */
export function kind_of_value(core: StorageCore, value: unknown): Kind {
  const kind = core.kinds.of_value(value);
  if (kind === null) throw new StorageMisuse('storage: the value is not a kind message');
  return kind;
}

function stored(row: Record<string, DbValue> | undefined): StoredRow | null {
  return row === undefined ? null : { value: bytes(row.value), version: big(row.contract_version) };
}

export function raw_item(state: TxState, kind: Kind, item_id: bigint): StoredRow | null {
  const table = table_of(kind);
  return stored(q(state, `SELECT value, contract_version FROM ${table} WHERE user_id = $1 AND kind = $2 AND item_id = $3`, [state.user_id, kind.info.column, item_id])[0]);
}

/** Records the stored bytes of a UserState item before its first write in the transaction. */
function touch(state: TxState, kind: Kind, item_id: bigint): void {
  if (kind.info.store !== 'user_state') return;
  const key = touch_key(kind.info.column, item_id);
  if (state.touched.has(key)) return;
  state.touched.set(key, { column: kind.info.column, item_id, initial: raw_item(state, kind, item_id)?.value ?? null });
}

export function write_item(core: StorageCore, state: TxState, kind: Kind, item_id: bigint, value: Uint8Array): void {
  touch(state, kind, item_id);
  q(
    state,
    `INSERT INTO ${table_of(kind)} (user_id, kind, item_id, value, contract_version, updated_at) VALUES ($1, $2, $3, $4, $5, $6) ` +
      'ON CONFLICT (user_id, kind, item_id) DO UPDATE SET value = excluded.value, contract_version = excluded.contract_version, updated_at = excluded.updated_at',
    [state.user_id, kind.info.column, item_id, value, core.kinds.version, core.time.clock_now()],
  );
}

export function delete_item(state: TxState, kind: Kind, item_id: bigint): void {
  touch(state, kind, item_id);
  q(state, `DELETE FROM ${table_of(kind)} WHERE user_id = $1 AND kind = $2 AND item_id = $3`, [state.user_id, kind.info.column, item_id]);
}

/** How a converted row is written back: nothing (read only), a UserState or server state row, a game state row. */
interface Persist {
  save(bytes: Uint8Array): void;
  remove(): void;
}

/**
 * The read conversion of a stored row (`### storage format`): a lower contract version goes through the registered
 * converter and, with `persist`, is written back at the current version or deleted. A higher version is converted
 * and never written. `FAILED` throws and leaves the row as it was.
 */
/** The throw of a read whose item converter returned `FAILED` (`### storage format`). */
export class ConversionFailed extends Error {}

export function read_value(core: StorageCore, state: TxState, kind: Kind, item_id: bigint, row: StoredRow, persist: Persist | null): KindValue | null {
  const current = core.kinds.version;
  if (row.version === current || core.converter === null) return decode_kind(kind, row.value);
  const result = core.converter(handle_of(state), kind.info.kind_class, item_id, row.version, row.value);
  if (result === 'FAILED') throw new ConversionFailed(`storage: the item converter failed on ${kind.info.name} item ${String(item_id)} of contract version ${String(row.version)}`);
  if (result === 'DELETE') {
    if (row.version < current) persist?.remove();
    return null;
  }
  const value = decode_kind(kind, result);
  if (row.version < current) persist?.save(result);
  return value;
}

function user_persist(core: StorageCore, state: TxState, kind: Kind, item_id: bigint): Persist | null {
  if (state.read_only > 0) return null;
  return {
    save: (b) => {
      write_item(core, state, kind, item_id, b);
    },
    remove: () => {
      delete_item(state, kind, item_id);
    },
  };
}

/** Reads one item with the read conversion (written back unless read only). */
export function read_item(core: StorageCore, state: TxState, kind: Kind, item_id: bigint): KindValue | null {
  const row = raw_item(state, kind, item_id);
  return row === null ? null : read_value(core, state, kind, item_id, row, user_persist(core, state, kind, item_id));
}

export function get_state(core: StorageCore, ctx: unknown, kind_class: unknown, item_id: unknown): KindValue | null {
  const state = user_state_of(core, ctx);
  const kind = user_kind(core, kind_class);
  return read_item(core, state, kind, check_item_id(kind, item_id));
}

export function list_state(core: StorageCore, ctx: unknown, kind_class: unknown): KindValue[] {
  const state = user_state_of(core, ctx);
  const kind = user_kind(core, kind_class);
  if (!kind.info.is_list) throw new StorageMisuse(`storage: list_state of single kind ${kind.info.name}`);
  const rows = q(state, `SELECT item_id, value, contract_version FROM ${table_of(kind)} WHERE user_id = $1 AND kind = $2 ORDER BY item_id`, [state.user_id, kind.info.column]);
  const out: KindValue[] = [];
  for (const row of rows) {
    const id = big(row.item_id);
    const value = read_value(core, state, kind, id, { value: bytes(row.value), version: big(row.contract_version) }, user_persist(core, state, kind, id));
    if (value !== null) out.push(value);
  }
  return out;
}

function put(core: StorageCore, ctx: unknown, value: unknown, core_kind: boolean): void {
  const state = user_state_of(core, ctx);
  const kind = kind_of_value(core, value);
  if (kind.info.store === 'game_state') throw new StorageMisuse(`storage: ${kind.info.name} is a game state kind`);
  if (kind.core !== core_kind) throw new StorageMisuse(core_kind ? `storage: put_core_state of non-core kind ${kind.info.name}` : `storage: put_state of core kind ${kind.info.name}`);
  if (kind.info.store === 'user_state') user_state_writable(state);
  else writable(state);
  const v = value as KindValue;
  write_item(core, state, kind, check_item_id(kind, item_id_of(kind, v)), v.encode());
}

function remove(core: StorageCore, ctx: unknown, kind_class: unknown, item_id: unknown, core_kind: boolean): void {
  const state = user_state_of(core, ctx);
  const kind = user_kind(core, kind_class);
  if (kind.core !== core_kind) throw new StorageMisuse(core_kind ? `storage: delete_core_state of non-core kind ${kind.info.name}` : `storage: delete_state of core kind ${kind.info.name}`);
  if (kind.info.store === 'user_state') user_state_writable(state);
  else writable(state);
  delete_item(state, kind, check_item_id(kind, item_id));
}

export function put_state(core: StorageCore, ctx: unknown, value: unknown): void {
  put(core, ctx, value, false);
}

export function put_core_state(core: StorageCore, ctx: unknown, value: unknown): void {
  put(core, ctx, value, true);
}

export function delete_state(core: StorageCore, ctx: unknown, kind_class: unknown, item_id: unknown): void {
  remove(core, ctx, kind_class, item_id, false);
}

export function delete_core_state(core: StorageCore, ctx: unknown, kind_class: unknown, item_id: unknown): void {
  remove(core, ctx, kind_class, item_id, true);
}

export function read_public_state(core: StorageCore, ctx: unknown, user_ids: unknown, kind_class: unknown): PublicStateEntry[] {
  const state = user_state_of(core, ctx);
  const kind = core.kinds.of_class(kind_class);
  if (kind?.info.store !== 'user_state' || !kind.info.is_public) throw new StorageMisuse('storage: read_public_state of a kind that is not public');
  if (!Array.isArray(user_ids) || !(user_ids as unknown[]).every((u) => typeof u === 'bigint')) throw new StorageMisuse('storage: read_public_state user IDs are not bigints');
  const ids = [...new Set(user_ids as bigint[])].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  if (ids.length > core.settings.max_public_read_count) throw new StorageMisuse(`storage: read_public_state of ${String(ids.length)} users, over storage.maxPublicReadCount`);
  if (ids.length === 0) return [];
  const list = ids.map((_, i) => `$${String(i + 2)}`).join(', ');
  const rows = q(
    state,
    `SELECT s.user_id, s.item_id, s.value, s.contract_version FROM user_state s JOIN "user" u ON u.user_id = s.user_id ` +
      `WHERE s.kind = $1 AND u.withdrawn_at IS NULL AND s.user_id IN (${list}) ORDER BY s.user_id, s.item_id`,
    [kind.info.column, ...ids],
  );
  const by_user = new Map<bigint, KindValue[]>();
  for (const row of rows) {
    const value = read_value(core, state, kind, big(row.item_id), { value: bytes(row.value), version: big(row.contract_version) }, null);
    if (value === null) continue;
    const user = big(row.user_id);
    const values = by_user.get(user);
    if (values === undefined) by_user.set(user, [value]);
    else values.push(value);
  }
  return [...by_user.entries()].map(([user_id, values]) => ({ user_id, value: kind.info.is_list ? values : (values[0] as KindValue) }));
}

const LIVE = '(expires_at IS NULL OR expires_at > $3)';

function game_persist(core: StorageCore, state: TxState, kind: Kind, key: bigint, row: StoredRow): Persist | null {
  if (state.read_only > 0) return null;
  const skip_locked = core.adapter?.dialect === 'postgresql';
  const same = 'kind = $1 AND "key" = $2 AND contract_version = $3 AND value = $4';
  const target = skip_locked ? `(kind, "key") IN (SELECT kind, "key" FROM game_state WHERE ${same} FOR UPDATE SKIP LOCKED)` : same;
  return {
    save: (b) => {
      q(state, `UPDATE game_state SET value = $5, contract_version = $6, updated_at = $7 WHERE ${target}`, [kind.info.column, key, row.version, row.value, b, core.kinds.version, core.time.clock_now()]);
    },
    remove: () => {
      q(state, `DELETE FROM game_state WHERE ${target}`, [kind.info.column, key, row.version, row.value]);
    },
  };
}

function game_value(core: StorageCore, state: TxState, kind: Kind, key: bigint, row: StoredRow): KindValue | null {
  return read_value(core, state, kind, key, row, game_persist(core, state, kind, key, row));
}

export function get_game_state(core: StorageCore, ctx: unknown, kind_class: unknown, key: unknown): KindValue | null {
  const state = user_state_of(core, ctx);
  const kind = game_kind(core, kind_class);
  const k = check_item_id(kind, key);
  const row = stored(q(state, `SELECT value, contract_version FROM game_state WHERE kind = $1 AND "key" = $2 AND ${LIVE}`, [kind.info.column, k, core.time.clock_now()])[0]);
  return row === null ? null : game_value(core, state, kind, k, row);
}

export function list_game_state(core: StorageCore, ctx: unknown, kind_class: unknown, after_key: unknown, max: unknown): KindValue[] {
  const state = user_state_of(core, ctx);
  const kind = game_kind(core, kind_class);
  if (typeof after_key !== 'bigint') throw new StorageMisuse('storage: list_game_state key is not a bigint');
  if (typeof max !== 'number' || !Number.isSafeInteger(max) || max < 1 || max > core.settings.max_game_state_list) {
    throw new StorageMisuse(`storage: list_game_state maximum ${String(max)} is not in [1, storage.maxGameStateList]`);
  }
  const rows = q(state, `SELECT "key", value, contract_version FROM game_state WHERE kind = $1 AND "key" > $2 AND ${LIVE} ORDER BY "key" LIMIT $4`, [
    kind.info.column,
    after_key,
    core.time.clock_now(),
    max,
  ]);
  const out: KindValue[] = [];
  for (const row of rows) {
    const value = game_value(core, state, kind, big(row.key), { value: bytes(row.value), version: big(row.contract_version) });
    if (value !== null) out.push(value);
  }
  return out;
}

export function put_game_state(core: StorageCore, ctx: unknown, value: unknown, expires_at: unknown): void {
  const state = user_state_of(core, ctx);
  const kind = kind_of_value(core, value);
  if (kind.info.store !== 'game_state') throw new StorageMisuse(`storage: put_game_state of ${kind.info.name}, not a game state kind`);
  if (typeof expires_at !== 'bigint' || expires_at < 0n) throw new StorageMisuse('storage: put_game_state expiry is not a bigint of 0 or more');
  writable(state);
  const v = value as KindValue;
  const key = check_item_id(kind, item_id_of(kind, v));
  q(
    state,
    'INSERT INTO game_state (kind, "key", value, contract_version, updated_at, expires_at) VALUES ($1, $2, $3, $4, $5, $6) ' +
      'ON CONFLICT (kind, "key") DO UPDATE SET value = excluded.value, contract_version = excluded.contract_version, updated_at = excluded.updated_at, expires_at = excluded.expires_at',
    [kind.info.column, key, v.encode(), core.kinds.version, core.time.clock_now(), expires_at === 0n ? null : expires_at],
  );
}

export function delete_game_state(core: StorageCore, ctx: unknown, kind_class: unknown, key: unknown): void {
  const state = user_state_of(core, ctx);
  const kind = game_kind(core, kind_class);
  const k = check_item_id(kind, key);
  writable(state);
  q(state, 'DELETE FROM game_state WHERE kind = $1 AND "key" = $2', [kind.info.column, k]);
}
