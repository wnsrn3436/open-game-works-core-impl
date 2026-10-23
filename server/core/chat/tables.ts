/**
 * The chat tables (`chat` `### tables`) and the SQL chat runs on them. `kind` and `message_kind` columns hold the
 * base proto enum values of `ChatChannelKind` and `ChatMessageKind`.
 */
import * as CoreContract from '../../generated/contract/core_contract.ts';
import type { ColumnInput, DbHandle } from '../storage/index.ts';
import type { ChatStorage } from './deps.ts';

export const CHANNEL = 'chat_channel';
export const MESSAGE = 'chat_message';
export const SENDER = 'chat_sender';
export const MUTE = 'chat_mute';
export const DELETION = 'chat_deletion';

const CHANNEL_KEY: readonly ColumnInput[] = [
  { name: 'kind', type: 'int32' },
  { name: 'key_a', type: 'int64' },
  { name: 'key_b', type: 'int64' },
];

/** Registers the five chat tables (`storage.register_table`). */
export function register_tables(storage: ChatStorage): void {
  storage.register_table(
    CHANNEL,
    'game',
    [...CHANNEL_KEY, { name: 'last_seq', type: 'int64' }, { name: 'last_at', type: 'int64' }, { name: 'last_delete_seq', type: 'int64' }],
    ['kind', 'key_a', 'key_b'],
    null,
    null,
    null,
    [['kind', 'key_b']],
  );
  storage.register_table(
    MESSAGE,
    'game',
    [
      ...CHANNEL_KEY,
      { name: 'seq', type: 'int64' },
      { name: 'sender_id', type: 'int64' },
      { name: 'message_kind', type: 'int32' },
      { name: 'text', type: 'string' },
      { name: 'deleted', type: 'bool' },
      { name: 'created_at', type: 'int64' },
      { name: 'expires_at', type: 'int64' },
    ],
    ['kind', 'key_a', 'key_b', 'seq'],
    'expires_at',
    null,
    'sender_id',
    [['sender_id']],
  );
  storage.register_table(SENDER, 'user', [{ name: 'user_id', type: 'int64' }, { name: 'last_sent_at', type: 'int64' }], ['user_id'], null, false);
  storage.register_table(
    MUTE,
    'user',
    [
      { name: 'user_id', type: 'int64' },
      { name: 'until_at', type: 'int64' },
      { name: 'reason', type: 'string' },
      { name: 'muted_at', type: 'int64' },
    ],
    ['user_id'],
    null,
    false,
  );
  storage.register_table(
    DELETION,
    'game',
    [...CHANNEL_KEY, { name: 'delete_seq', type: 'int64' }, { name: 'seq', type: 'int64' }, { name: 'expires_at', type: 'int64' }],
    ['kind', 'key_a', 'key_b', 'delete_seq'],
    'expires_at',
    null,
  );
}

/** A stored channel `(kind, key_a, key_b)`. */
export interface ChannelKey {
  readonly kind: CoreContract.ChatChannelKind;
  readonly key_a: bigint;
  readonly key_b: bigint;
}

/** The `ChatChannelKind` element names by base proto enum value. */
const CHANNEL_KIND_NAMES: ReadonlyMap<CoreContract.ChatChannelKind, string> = new Map([
  [CoreContract.ChatChannelKind.CHAT_CHANNEL_KIND_WORLD, 'World'],
  [CoreContract.ChatChannelKind.CHAT_CHANNEL_KIND_GUILD, 'Guild'],
  [CoreContract.ChatChannelKind.CHAT_CHANNEL_KIND_DIRECT, 'Direct'],
]);

/** The element name of a base proto enum value: the full enum value name (`core` `## spec`), or '' for an unknown value. */
function proto_element_name(values: Readonly<Record<string, number>>, value: number): string {
  for (const [name, v] of Object.entries(values)) if (v === value) return name;
  return '';
}

/** The `ChatChannelKind` element name of a stored `kind`, e.g. `CHAT_CHANNEL_KIND_WORLD` (a report `ref`). */
export function channel_kind_element(kind: CoreContract.ChatChannelKind): string {
  return proto_element_name(CoreContract.ChatChannelKind, kind);
}

/** The admin operation `channel_kind` value of a stored `kind` (`World`, `Guild`, `Direct`). */
export function channel_kind_name(kind: CoreContract.ChatChannelKind): string {
  return CHANNEL_KIND_NAMES.get(kind) ?? '';
}

/** The stored `kind` of an admin operation `channel_kind` value, or null. */
export function channel_kind_of(name: string): CoreContract.ChatChannelKind | null {
  for (const [kind, element] of CHANNEL_KIND_NAMES) if (element === name) return kind;
  return null;
}

/** The `ChatMessageKind` element name of a stored `message_kind`, e.g. `CHAT_MESSAGE_KIND_TEXT`. */
export function message_kind_name(kind: CoreContract.ChatMessageKind): string {
  return proto_element_name(CoreContract.ChatMessageKind, kind);
}

/** The `lock_game_row` key of a `chat_channel` row. The value types are the same at every lock of the row. */
export function channel_lock_key(key: ChannelKey): readonly unknown[] {
  return [key.kind, key.key_a, key.key_b];
}

export interface ChannelRow extends ChannelKey {
  readonly last_seq: bigint;
  readonly last_at: bigint;
  readonly last_delete_seq: bigint;
}

export interface MessageRow extends ChannelKey {
  readonly seq: bigint;
  readonly sender_id: bigint;
  readonly message_kind: CoreContract.ChatMessageKind;
  readonly text: string;
  readonly deleted: boolean;
  readonly created_at: bigint;
  readonly expires_at: bigint;
}

function big(row: Record<string, unknown>, name: string): bigint {
  const value = row[name];
  if (typeof value === 'bigint') return value;
  if (typeof value === 'number' && Number.isSafeInteger(value)) return BigInt(value);
  throw new TypeError(`chat: column ${name} is not an integer`);
}

function int(row: Record<string, unknown>, name: string): number {
  return Number(big(row, name));
}

function channel_of(row: Record<string, unknown>): ChannelRow {
  return {
    kind: int(row, 'kind') as CoreContract.ChatChannelKind,
    key_a: big(row, 'key_a'),
    key_b: big(row, 'key_b'),
    last_seq: big(row, 'last_seq'),
    last_at: big(row, 'last_at'),
    last_delete_seq: big(row, 'last_delete_seq'),
  };
}

function message_of(row: Record<string, unknown>): MessageRow {
  const deleted = row['deleted'];
  return {
    kind: int(row, 'kind') as CoreContract.ChatChannelKind,
    key_a: big(row, 'key_a'),
    key_b: big(row, 'key_b'),
    seq: big(row, 'seq'),
    sender_id: big(row, 'sender_id'),
    message_kind: int(row, 'message_kind') as CoreContract.ChatMessageKind,
    text: String(row['text']),
    deleted: deleted === true || deleted === 1 || deleted === 1n,
    created_at: big(row, 'created_at'),
    expires_at: big(row, 'expires_at'),
  };
}

const KEY_WHERE = 'kind = $1 AND key_a = $2 AND key_b = $3';
const CHANNEL_COLUMNS = 'kind, key_a, key_b, last_seq, last_at, last_delete_seq';
const MESSAGE_COLUMNS = 'kind, key_a, key_b, seq, sender_id, message_kind, text, deleted, created_at, expires_at';

/** A query parameter (a `storage` DB handle value). */
type Param = bigint | number | boolean | string | null;

function key_params(key: ChannelKey): Param[] {
  return [key.kind, key.key_a, key.key_b];
}

function query(db: DbHandle, sql: string, params: readonly Param[]): Record<string, unknown>[] {
  return db.query(sql, params);
}

export function read_channel(db: DbHandle, key: ChannelKey): ChannelRow | null {
  const row = query(db, `SELECT ${CHANNEL_COLUMNS} FROM ${CHANNEL} WHERE ${KEY_WHERE}`, key_params(key))[0];
  return row === undefined ? null : channel_of(row);
}

/** Raises `last_seq` by 1 (a new row starts at 1) and writes `last_at`. Returns the new `last_seq`. */
export function next_seq(db: DbHandle, key: ChannelKey, at: bigint): bigint {
  const rows = query(
    db,
    `INSERT INTO ${CHANNEL} (kind, key_a, key_b, last_seq, last_at, last_delete_seq) VALUES ($1, $2, $3, 1, $4, 0) ` +
      `ON CONFLICT (kind, key_a, key_b) DO UPDATE SET last_seq = ${CHANNEL}.last_seq + 1, last_at = $4 RETURNING last_seq`,
    [...key_params(key), at],
  );
  const row = rows[0];
  if (row === undefined) throw new Error('chat: the channel upsert returned no row');
  return big(row, 'last_seq');
}

/** Raises `last_delete_seq` by 1 (a new row starts at 1). Returns the new `last_delete_seq`. */
export function next_delete_seq(db: DbHandle, key: ChannelKey): bigint {
  const rows = query(
    db,
    `INSERT INTO ${CHANNEL} (kind, key_a, key_b, last_seq, last_at, last_delete_seq) VALUES ($1, $2, $3, 0, 0, 1) ` +
      `ON CONFLICT (kind, key_a, key_b) DO UPDATE SET last_delete_seq = ${CHANNEL}.last_delete_seq + 1 RETURNING last_delete_seq`,
    key_params(key),
  );
  const row = rows[0];
  if (row === undefined) throw new Error('chat: the channel upsert returned no row');
  return big(row, 'last_delete_seq');
}

export interface NewMessage {
  readonly seq: bigint;
  readonly sender_id: bigint;
  readonly message_kind: CoreContract.ChatMessageKind;
  readonly text: string;
  readonly created_at: bigint;
  readonly expires_at: bigint;
}

export function insert_message(db: DbHandle, key: ChannelKey, message: NewMessage): void {
  query(
    db,
    `INSERT INTO ${MESSAGE} (${MESSAGE_COLUMNS}) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
    [...key_params(key), message.seq, message.sender_id, message.message_kind, message.text, false, message.created_at, message.expires_at],
  );
}

export function read_message(db: DbHandle, key: ChannelKey, seq: bigint): MessageRow | null {
  const row = query(db, `SELECT ${MESSAGE_COLUMNS} FROM ${MESSAGE} WHERE ${KEY_WHERE} AND seq = $4`, [...key_params(key), seq])[0];
  return row === undefined ? null : message_of(row);
}

/** How `select_messages` picks rows (`chat` `### receive`). */
export type Pick = { readonly after: bigint } | { readonly before: bigint } | { readonly latest: true };

/** Up to `limit` message rows of the channel, in the order of the pick. */
export function select_messages(db: DbHandle, key: ChannelKey, pick: Pick, limit: number): MessageRow[] {
  let sql = `SELECT ${MESSAGE_COLUMNS} FROM ${MESSAGE} WHERE ${KEY_WHERE}`;
  const params = key_params(key);
  if ('after' in pick) {
    sql += ' AND seq > $4 ORDER BY seq ASC LIMIT $5';
    params.push(pick.after, limit);
  } else if ('before' in pick) {
    sql += ' AND seq < $4 ORDER BY seq DESC LIMIT $5';
    params.push(pick.before, limit);
  } else {
    sql += ' ORDER BY seq DESC LIMIT $4';
    params.push(limit);
  }
  return query(db, sql, params).map(message_of);
}

/**
 * The most senders `last_live_seq` leaves out with one bind parameter each. A statement takes at most 32767
 * parameters on PostgreSQL (an int16 count in Bind) and 32766 on SQLite, and `block-report.maxBlocks` has no maximum.
 */
export const MAX_EXCLUDED_PARAMS = 1000;

/** The highest seq of the channel's rows that are not deleted, not expired at `now` and not sent by a user in `excluded`, or null. */
export function last_live_seq(db: DbHandle, key: ChannelKey, now: bigint, excluded: readonly bigint[]): bigint | null {
  const live = `FROM ${MESSAGE} WHERE ${KEY_WHERE} AND deleted = $4 AND expires_at > $5`;
  const params: Param[] = [...key_params(key), false, now];
  if (excluded.length <= MAX_EXCLUDED_PARAMS) {
    const marks = excluded.map((_, i) => `$${String(i + 6)}`).join(', ');
    const not_sent_by = excluded.length === 0 ? '' : ` AND sender_id NOT IN (${marks})`;
    const row = query(db, `SELECT seq ${live}${not_sent_by} ORDER BY seq DESC LIMIT 1`, [...params, ...excluded])[0];
    return row === undefined ? null : big(row, 'seq');
  }
  // The latest seq of each sender, newest first. Of the first `left_out.size + 1` senders, one at least is not left
  // out, and the first such sender has the highest seq of all senders not left out.
  const left_out = new Set(excluded);
  const rows = query(db, `SELECT sender_id, MAX(seq) AS max_seq ${live} GROUP BY sender_id ORDER BY max_seq DESC LIMIT $6`, [...params, left_out.size + 1]);
  const row = rows.find((r) => !left_out.has(big(r, 'sender_id')));
  return row === undefined ? null : big(row, 'max_seq');
}

/** Admin `list_chat_messages`: rows with seq above `after_seq`, by seq ascending, deleted rows included. */
export function list_messages(db: DbHandle, key: ChannelKey, after_seq: bigint, limit: number): MessageRow[] {
  return select_messages(db, key, { after: after_seq }, limit);
}

/** The `chat_deletion` rows of the channel with `delete_seq` above `after`, by `delete_seq` ascending. */
export function select_deletions(db: DbHandle, key: ChannelKey, after: bigint, limit: number): { delete_seq: bigint; seq: bigint }[] {
  return query(db, `SELECT delete_seq, seq FROM ${DELETION} WHERE ${KEY_WHERE} AND delete_seq > $4 ORDER BY delete_seq ASC LIMIT $5`, [
    ...key_params(key),
    after,
    limit,
  ]).map((row) => ({ delete_seq: big(row, 'delete_seq'), seq: big(row, 'seq') }));
}

/** Message deletion (`chat` `### delete`) after the channel row is locked. */
export function delete_message(db: DbHandle, message: MessageRow): void {
  query(db, `UPDATE ${MESSAGE} SET deleted = $5 WHERE ${KEY_WHERE} AND seq = $4`, [...key_params(message), message.seq, true]);
  const delete_seq = next_delete_seq(db, message);
  query(db, `INSERT INTO ${DELETION} (kind, key_a, key_b, delete_seq, seq, expires_at) VALUES ($1, $2, $3, $4, $5, $6)`, [
    ...key_params(message),
    delete_seq,
    message.seq,
    message.expires_at,
  ]);
}

/** All the `Direct` channel rows that hold the user. */
export function direct_channels(db: DbHandle, direct: CoreContract.ChatChannelKind, user_id: bigint): ChannelRow[] {
  const by_a = query(db, `SELECT ${CHANNEL_COLUMNS} FROM ${CHANNEL} WHERE kind = $1 AND key_a = $2`, [direct, user_id]);
  const by_b = query(db, `SELECT ${CHANNEL_COLUMNS} FROM ${CHANNEL} WHERE kind = $1 AND key_b = $2`, [direct, user_id]);
  return [...by_a, ...by_b].map(channel_of);
}

/**
 * The `Direct` channel rows that hold the user with `last_at` above `after_at`: of each key column that holds the user,
 * the first `limit` rows by `last_at` descending, then the other user ID ascending.
 */
export function recent_direct_channels(db: DbHandle, direct: CoreContract.ChatChannelKind, user_id: bigint, after_at: bigint, limit: number): ChannelRow[] {
  const params: Param[] = [direct, user_id, after_at, limit];
  const recent = (mine: 'key_a' | 'key_b', other: 'key_a' | 'key_b'): Record<string, unknown>[] =>
    query(db, `SELECT ${CHANNEL_COLUMNS} FROM ${CHANNEL} WHERE kind = $1 AND ${mine} = $2 AND last_at > $3 ORDER BY last_at DESC, ${other} ASC LIMIT $4`, params);
  return [...recent('key_a', 'key_b'), ...recent('key_b', 'key_a')].map(channel_of);
}

/** Deletes a channel row with its message rows and `chat_deletion` rows. */
export function delete_channel(db: DbHandle, key: ChannelKey): void {
  const params = key_params(key);
  query(db, `DELETE FROM ${MESSAGE} WHERE ${KEY_WHERE}`, params);
  query(db, `DELETE FROM ${DELETION} WHERE ${KEY_WHERE}`, params);
  query(db, `DELETE FROM ${CHANNEL} WHERE ${KEY_WHERE}`, params);
}

export function delete_sent_messages(db: DbHandle, sender_id: bigint): void {
  query(db, `DELETE FROM ${MESSAGE} WHERE sender_id = $1`, [sender_id]);
}

export function read_last_sent_at(db: DbHandle, user_id: bigint): bigint | null {
  const row = query(db, `SELECT last_sent_at FROM ${SENDER} WHERE user_id = $1`, [user_id])[0];
  return row === undefined ? null : big(row, 'last_sent_at');
}

export function write_last_sent_at(db: DbHandle, user_id: bigint, at: bigint): void {
  query(db, `INSERT INTO ${SENDER} (user_id, last_sent_at) VALUES ($1, $2) ON CONFLICT (user_id) DO UPDATE SET last_sent_at = excluded.last_sent_at`, [user_id, at]);
}

export function read_mute_until(db: DbHandle, user_id: bigint): bigint | null {
  const row = query(db, `SELECT until_at FROM ${MUTE} WHERE user_id = $1`, [user_id])[0];
  return row === undefined ? null : big(row, 'until_at');
}

export function write_mute(db: DbHandle, user_id: bigint, until_at: bigint, reason: string, muted_at: bigint): void {
  query(
    db,
    `INSERT INTO ${MUTE} (user_id, until_at, reason, muted_at) VALUES ($1, $2, $3, $4) ` +
      'ON CONFLICT (user_id) DO UPDATE SET until_at = excluded.until_at, reason = excluded.reason, muted_at = excluded.muted_at',
    [user_id, until_at, reason, muted_at],
  );
}

export function delete_mute(db: DbHandle, user_id: bigint): void {
  query(db, `DELETE FROM ${MUTE} WHERE user_id = $1`, [user_id]);
}
