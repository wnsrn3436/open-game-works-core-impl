/**
 * The guild tables (`### tables`) and the row reads and writes on them. Every statement takes its values as
 * parameters and gives the same result on SQLite and PostgreSQL.
 */
import * as CoreContract from '../../generated/contract/core_contract.ts';
import type { ColumnInput, DbHandle, GameTx, RequestCtx, Storage } from '../storage/index.ts';

export type CtxOrTx = RequestCtx | GameTx;

const Role = CoreContract.GuildRole;
export type GuildRole = CoreContract.GuildRole;
export type GuildJoinType = CoreContract.GuildJoinType;

export const GUILD = 'guild_guild';
export const NAME = 'guild_name';
export const MEMBER = 'guild_member';
export const JOIN_REQUEST = 'guild_join_request';
export const COOLDOWN = 'guild_cooldown';
export const SEQUENCE = 'guild_sequence';

const int64 = (name: string): ColumnInput => ({ name, type: 'int64' });
const int32 = (name: string): ColumnInput => ({ name, type: 'int32' });
const text = (name: string): ColumnInput => ({ name, type: 'string' });
const bool = (name: string): ColumnInput => ({ name, type: 'bool' });

/** Registers the six tables (`### tables`): scope `game`, the user tables with personal data user column `user_id`. */
export function register_tables(storage: Pick<Storage, 'register_table'>): void {
  storage.register_table(
    GUILD,
    'game',
    [
      int64('guild_id'),
      text('name'),
      text('normalized_name'),
      text('description'),
      int32('join_type'),
      int64('join_value'),
      int64('leader_id'),
      int32('member_count'),
      int32('max_members'),
      bool('joinable'),
      int64('created_at'),
      int64('updated_at'),
    ],
    ['guild_id'],
    null,
    null,
    null,
    [['normalized_name'], ['joinable', 'updated_at']],
  );
  storage.register_table(NAME, 'game', [text('normalized_name'), int64('guild_id')], ['normalized_name'], null, null);
  storage.register_table(
    MEMBER,
    'game',
    [int64('user_id'), int64('guild_id'), int32('role'), int64('joined_at'), int64('active_at')],
    ['user_id'],
    null,
    null,
    'user_id',
    [['guild_id']],
  );
  storage.register_table(JOIN_REQUEST, 'game', [int64('guild_id'), int64('user_id'), int64('created_at')], ['guild_id', 'user_id'], null, null, 'user_id', [['user_id']]);
  storage.register_table(COOLDOWN, 'game', [int64('user_id'), int64('ends_at')], ['user_id'], 'ends_at', null, 'user_id');
  storage.register_table(SEQUENCE, 'game', [int64('id'), int64('last_guild_id')], ['id'], null, null);
}

export interface GuildRow {
  readonly guild_id: bigint;
  readonly name: string;
  readonly normalized_name: string;
  readonly description: string;
  readonly join_type: GuildJoinType;
  readonly join_value: bigint;
  readonly leader_id: bigint;
  readonly member_count: number;
  readonly max_members: number;
  readonly joinable: boolean;
  readonly created_at: bigint;
  readonly updated_at: bigint;
}

/** A guild row to insert: `joinable` comes from its `join_type`, `member_count` and `max_members`. */
export type NewGuildRow = Omit<GuildRow, 'joinable'>;

export interface MemberRow {
  readonly user_id: bigint;
  readonly guild_id: bigint;
  readonly role: GuildRole;
  readonly joined_at: bigint;
  readonly active_at: bigint;
}

export interface JoinRequestRow {
  readonly guild_id: bigint;
  readonly user_id: bigint;
  readonly created_at: bigint;
}

type Row = Readonly<Record<string, unknown>>;

const big = (value: unknown): bigint => (typeof value === 'bigint' ? value : BigInt(value as number | string));
const num = (value: unknown): number => (typeof value === 'number' ? value : Number(value));
const str = (value: unknown): string => (typeof value === 'string' ? value : JSON.stringify(value));
const flag = (value: unknown): boolean => value === true || value === 1 || value === 1n;

/** `joinable`: `join_type` is not `Closed` and `member_count` < `max_members`. */
export function is_joinable(join_type: GuildJoinType, member_count: number, max_members: number): boolean {
  return join_type !== CoreContract.GuildJoinType.GUILD_JOIN_TYPE_CLOSED && member_count < max_members;
}

function guild_row(row: Row): GuildRow {
  return {
    guild_id: big(row.guild_id),
    name: str(row.name),
    normalized_name: str(row.normalized_name),
    description: str(row.description),
    join_type: num(row.join_type) as GuildJoinType,
    join_value: big(row.join_value),
    leader_id: big(row.leader_id),
    member_count: num(row.member_count),
    max_members: num(row.max_members),
    joinable: flag(row.joinable),
    created_at: big(row.created_at),
    updated_at: big(row.updated_at),
  };
}

function member_row(row: Row): MemberRow {
  return { user_id: big(row.user_id), guild_id: big(row.guild_id), role: num(row.role) as GuildRole, joined_at: big(row.joined_at), active_at: big(row.active_at) };
}

function request_row(row: Row): JoinRequestRow {
  return { guild_id: big(row.guild_id), user_id: big(row.user_id), created_at: big(row.created_at) };
}

/** `GuildInfo` of a guild row. */
export function info_of(row: GuildRow): CoreContract.GuildInfo {
  const info = new CoreContract.GuildInfo();
  info.guild_id = row.guild_id;
  info.name = row.name;
  info.description = row.description;
  info.join_type = row.join_type;
  info.join_value = row.join_value;
  info.leader_id = row.leader_id;
  info.member_count = row.member_count;
  info.max_members = row.max_members;
  info.created_at = row.created_at;
  return info;
}

const GUILD_COLUMNS = 'guild_id, name, normalized_name, description, join_type, join_value, leader_id, member_count, max_members, joinable, created_at, updated_at';
const MEMBER_COLUMNS = 'user_id, guild_id, role, joined_at, active_at';

/** The most IDs one `IN ($1, ...)` statement takes. */
const IN_CHUNK = 500;

export class GuildDb {
  readonly handle: DbHandle;

  constructor(handle: DbHandle) {
    this.handle = handle;
  }

  guild(guild_id: bigint): GuildRow | null {
    const row = this.handle.query(`SELECT ${GUILD_COLUMNS} FROM ${GUILD} WHERE guild_id = $1`, [guild_id])[0];
    return row === undefined ? null : guild_row(row);
  }

  guilds(guild_ids: readonly bigint[]): GuildRow[] {
    const rows: GuildRow[] = [];
    const ids = [...new Set(guild_ids)];
    for (let i = 0; i < ids.length; i += IN_CHUNK) {
      const chunk = ids.slice(i, i + IN_CHUNK);
      const marks = chunk.map((_, n) => `$${String(n + 1)}`).join(', ');
      for (const row of this.handle.query(`SELECT ${GUILD_COLUMNS} FROM ${GUILD} WHERE guild_id IN (${marks})`, chunk)) rows.push(guild_row(row));
    }
    return rows.sort((a, b) => compare(a.guild_id, b.guild_id));
  }

  /**
   * Guilds whose normalized name starts with `prefix`, in byte order of the normalized name: the first `limit` rows whose
   * normalized name is `prefix` or above, then only those that start with it.
   */
  guilds_with_prefix(prefix: string, limit: number): GuildRow[] {
    return this.handle
      .query(`SELECT ${GUILD_COLUMNS} FROM ${GUILD} WHERE normalized_name >= $1 ORDER BY normalized_name ASC LIMIT $2`, [prefix, limit])
      .map(guild_row)
      .filter((row) => row.normalized_name.startsWith(prefix));
  }

  /**
   * `ListJoinableGuilds`: the first `limit` rows whose `joinable` is `true`, `updated_at` descending then guild ID
   * ascending, then only those whose `join_value` ≤ `max_join_value` unless it is 0.
   */
  joinable(max_join_value: bigint, limit: number): GuildRow[] {
    return this.handle
      .query(`SELECT ${GUILD_COLUMNS} FROM ${GUILD} WHERE joinable = $1 ORDER BY updated_at DESC, guild_id ASC LIMIT $2`, [true, limit])
      .map(guild_row)
      .filter((row) => max_join_value === 0n || row.join_value <= max_join_value);
  }

  insert_guild(row: NewGuildRow): void {
    this.handle.query(`INSERT INTO ${GUILD} (${GUILD_COLUMNS}) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`, [
      row.guild_id,
      row.name,
      row.normalized_name,
      row.description,
      row.join_type,
      row.join_value,
      row.leader_id,
      row.member_count,
      row.max_members,
      is_joinable(row.join_type, row.member_count, row.max_members),
      row.created_at,
      row.updated_at,
    ]);
  }

  /** Writes `member_count`, `updated_at` and `joinable` of the locked row `guild`, and returns the row as written. */
  set_member_count(guild: GuildRow, member_count: number, updated_at: bigint): GuildRow {
    const joinable = is_joinable(guild.join_type, member_count, guild.max_members);
    this.handle.query(`UPDATE ${GUILD} SET member_count = $2, updated_at = $3, joinable = $4 WHERE guild_id = $1`, [guild.guild_id, member_count, updated_at, joinable]);
    return { ...guild, member_count, updated_at, joinable };
  }

  /** Writes `description`, `join_type`, `join_value` and `joinable` of the locked row `guild`. */
  set_settings(guild: GuildRow, description: string, join_type: GuildJoinType, join_value: bigint): void {
    const joinable = is_joinable(join_type, guild.member_count, guild.max_members);
    this.handle.query(`UPDATE ${GUILD} SET description = $2, join_type = $3, join_value = $4, joinable = $5 WHERE guild_id = $1`, [guild.guild_id, description, join_type, join_value, joinable]);
  }

  set_description(guild_id: bigint, description: string): void {
    this.handle.query(`UPDATE ${GUILD} SET description = $2 WHERE guild_id = $1`, [guild_id, description]);
  }

  set_name(guild_id: bigint, name: string, normalized_name: string, updated_at: bigint): void {
    this.handle.query(`UPDATE ${GUILD} SET name = $2, normalized_name = $3, updated_at = $4 WHERE guild_id = $1`, [guild_id, name, normalized_name, updated_at]);
  }

  set_leader(guild_id: bigint, leader_id: bigint): void {
    this.handle.query(`UPDATE ${GUILD} SET leader_id = $2 WHERE guild_id = $1`, [guild_id, leader_id]);
  }

  /** Writes `max_members` and `joinable` of the locked row `guild`. */
  set_max_members(guild: GuildRow, max_members: number): void {
    const joinable = is_joinable(guild.join_type, guild.member_count, max_members);
    this.handle.query(`UPDATE ${GUILD} SET max_members = $2, joinable = $3 WHERE guild_id = $1`, [guild.guild_id, max_members, joinable]);
  }

  delete_guild(guild_id: bigint): void {
    this.handle.query(`DELETE FROM ${GUILD} WHERE guild_id = $1`, [guild_id]);
  }

  /** Name registration: inserts the name row unless its key exists, then reads the key's guild ID. */
  register_name(normalized_name: string, guild_id: bigint): bigint {
    this.handle.query(`INSERT INTO ${NAME} (normalized_name, guild_id) VALUES ($1, $2) ON CONFLICT (normalized_name) DO NOTHING`, [normalized_name, guild_id]);
    const row = this.handle.query(`SELECT guild_id FROM ${NAME} WHERE normalized_name = $1`, [normalized_name])[0];
    return row === undefined ? 0n : big(row.guild_id);
  }

  delete_name(normalized_name: string, guild_id: bigint): void {
    this.handle.query(`DELETE FROM ${NAME} WHERE normalized_name = $1 AND guild_id = $2`, [normalized_name, guild_id]);
  }

  member(user_id: bigint): MemberRow | null {
    const row = this.handle.query(`SELECT ${MEMBER_COLUMNS} FROM ${MEMBER} WHERE user_id = $1`, [user_id])[0];
    return row === undefined ? null : member_row(row);
  }

  /** The member rows of a guild, by user ID. */
  members(guild_id: bigint): MemberRow[] {
    return this.handle.query(`SELECT ${MEMBER_COLUMNS} FROM ${MEMBER} WHERE guild_id = $1 ORDER BY user_id`, [guild_id]).map(member_row);
  }

  insert_member(row: MemberRow): void {
    this.handle.query(`INSERT INTO ${MEMBER} (${MEMBER_COLUMNS}) VALUES ($1, $2, $3, $4, $5)`, [row.user_id, row.guild_id, row.role, row.joined_at, row.active_at]);
  }

  set_role(user_id: bigint, role: GuildRole): void {
    this.handle.query(`UPDATE ${MEMBER} SET role = $2 WHERE user_id = $1`, [user_id, role]);
  }

  /** The `active_at` write: only the row of that guild, so a row another transaction deleted stays deleted. */
  set_active_at(user_id: bigint, guild_id: bigint, active_at: bigint): void {
    this.handle.query(`UPDATE ${MEMBER} SET active_at = $3 WHERE user_id = $1 AND guild_id = $2`, [user_id, guild_id, active_at]);
  }

  delete_member(user_id: bigint): void {
    this.handle.query(`DELETE FROM ${MEMBER} WHERE user_id = $1`, [user_id]);
  }

  delete_members(guild_id: bigint): void {
    this.handle.query(`DELETE FROM ${MEMBER} WHERE guild_id = $1`, [guild_id]);
  }

  join_request(guild_id: bigint, user_id: bigint): JoinRequestRow | null {
    const row = this.handle.query(`SELECT guild_id, user_id, created_at FROM ${JOIN_REQUEST} WHERE guild_id = $1 AND user_id = $2`, [guild_id, user_id])[0];
    return row === undefined ? null : request_row(row);
  }

  /** The join requests a user sent: `created_at`, then guild ID, ascending. */
  requests_of_user(user_id: bigint): JoinRequestRow[] {
    return this.handle.query(`SELECT guild_id, user_id, created_at FROM ${JOIN_REQUEST} WHERE user_id = $1 ORDER BY created_at, guild_id`, [user_id]).map(request_row);
  }

  /** The join requests to a guild: `created_at`, then user ID, ascending. */
  requests_of_guild(guild_id: bigint): JoinRequestRow[] {
    return this.handle.query(`SELECT guild_id, user_id, created_at FROM ${JOIN_REQUEST} WHERE guild_id = $1 ORDER BY created_at, user_id`, [guild_id]).map(request_row);
  }

  count_requests_of_user(user_id: bigint): number {
    return num(this.handle.query(`SELECT COUNT(*) AS n FROM ${JOIN_REQUEST} WHERE user_id = $1`, [user_id])[0]?.n ?? 0);
  }

  count_requests_of_guild(guild_id: bigint): number {
    return num(this.handle.query(`SELECT COUNT(*) AS n FROM ${JOIN_REQUEST} WHERE guild_id = $1`, [guild_id])[0]?.n ?? 0);
  }

  insert_request(row: JoinRequestRow): void {
    this.handle.query(`INSERT INTO ${JOIN_REQUEST} (guild_id, user_id, created_at) VALUES ($1, $2, $3)`, [row.guild_id, row.user_id, row.created_at]);
  }

  delete_request(guild_id: bigint, user_id: bigint): void {
    this.handle.query(`DELETE FROM ${JOIN_REQUEST} WHERE guild_id = $1 AND user_id = $2`, [guild_id, user_id]);
  }

  delete_requests_of_user(user_id: bigint): void {
    this.handle.query(`DELETE FROM ${JOIN_REQUEST} WHERE user_id = $1`, [user_id]);
  }

  delete_requests_of_guild(guild_id: bigint): void {
    this.handle.query(`DELETE FROM ${JOIN_REQUEST} WHERE guild_id = $1`, [guild_id]);
  }

  /** The `ends_at` of a user's cooldown row, or null. An expired row is the caller's to judge. */
  cooldown(user_id: bigint): bigint | null {
    const row = this.handle.query(`SELECT ends_at FROM ${COOLDOWN} WHERE user_id = $1`, [user_id])[0];
    return row === undefined ? null : big(row.ends_at);
  }

  /** One upsert statement (`storage` `### expiry`). */
  set_cooldown(user_id: bigint, ends_at: bigint): void {
    this.handle.query(`INSERT INTO ${COOLDOWN} (user_id, ends_at) VALUES ($1, $2) ON CONFLICT (user_id) DO UPDATE SET ends_at = excluded.ends_at`, [user_id, ends_at]);
  }

  delete_cooldown(user_id: bigint): void {
    this.handle.query(`DELETE FROM ${COOLDOWN} WHERE user_id = $1`, [user_id]);
  }

  last_guild_id(): bigint {
    const row = this.handle.query(`SELECT last_guild_id FROM ${SEQUENCE} WHERE id = $1`, [0n])[0];
    return row === undefined ? 0n : big(row.last_guild_id);
  }

  set_last_guild_id(guild_id: bigint): void {
    this.handle.query(`INSERT INTO ${SEQUENCE} (id, last_guild_id) VALUES ($1, $2) ON CONFLICT (id) DO UPDATE SET last_guild_id = excluded.last_guild_id`, [0n, guild_id]);
  }
}

export function compare(a: bigint, b: bigint): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Rank of a role in member lists: `Leader`, `Officer`, `Member`. */
function role_rank(role: GuildRole): number {
  return role === Role.GUILD_ROLE_LEADER ? 0 : role === Role.GUILD_ROLE_OFFICER ? 1 : 2;
}

/** Member order of `GetGuild`: role, `joined_at`, user ID. */
export function by_role(a: MemberRow, b: MemberRow): number {
  return role_rank(a.role) - role_rank(b.role) || compare(a.joined_at, b.joined_at) || compare(a.user_id, b.user_id);
}

/** Succession order: earliest `joined_at`, then the smaller user ID. */
export function by_seniority(a: MemberRow, b: MemberRow): number {
  return compare(a.joined_at, b.joined_at) || compare(a.user_id, b.user_id);
}

export function code_points(text: string): number {
  return Array.from(text).length;
}
