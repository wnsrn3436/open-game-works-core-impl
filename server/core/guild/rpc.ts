/**
 * The core `rpc` handlers of guild (`## API`, `## behavior`). A handler returns its response message, a `GameError`
 * from a hook, or a `CoreError`; a lock wait limit is `INTERNAL`.
 */
import * as CoreContract from '../../generated/contract/core_contract.ts';
import type { RequestCtx } from '../storage/index.ts';
import {
  CoreError,
  LOCK_FAILED,
  cooldown_ends_at,
  core_log,
  description_check,
  guild_db,
  join_requested,
  lock,
  member_changed,
  name_length_ok,
  prepare_create_guild,
  validate_guild_join,
  type CoreErrorValue,
  type GuildCore,
  type TextCheck,
} from './core.ts';
import { add_member, apply_role, disband, insert_new_guild, leader_succession, officer_limit, remove_member } from './members.ts';
import { by_role, info_of, type GuildDb, type GuildRow, type MemberRow } from './tables.ts';

const Role = CoreContract.GuildRole;
const JoinType = CoreContract.GuildJoinType;

/** A response message, or a `CoreError` or `GameError` value. */
type Result<T> = T | number;

const INTERNAL = CoreError.CORE_ERROR_INTERNAL;
const INVALID_REQUEST = CoreError.CORE_ERROR_INVALID_REQUEST;
const NOT_MEMBER = CoreError.CORE_ERROR_GUILD_NOT_MEMBER;
const PERMISSION = CoreError.CORE_ERROR_GUILD_PERMISSION;

/**
 * `TEXT_INVALID` or `TEXT_BANNED` of a name or description, or null when it passes (`CreateGuild` step 2).
 * `length_ok` false is `TEXT_INVALID`.
 */
function text_error(core: GuildCore, ctx: RequestCtx, check: TextCheck, length_ok: boolean): CoreErrorValue | null {
  if (check.result === 'INVALID' || !length_ok) return CoreError.CORE_ERROR_TEXT_INVALID;
  if (check.result === 'BANNED') {
    core_log(core, ctx, 'info', 'guild text has a banned word', { banned_word: check.banned_word_id });
    return CoreError.CORE_ERROR_TEXT_BANNED;
  }
  return null;
}

function check_description(core: GuildCore, ctx: RequestCtx, description: string): CoreErrorValue | null {
  return text_error(core, ctx, description_check(core, description), true);
}

/** The cooldown step of `CreateGuild` and `JoinGuild`. */
function in_cooldown(core: GuildCore, ctx: RequestCtx, db: GuildDb): boolean {
  return cooldown_ends_at(core, ctx, db, ctx.user_id) !== 0n;
}

/** The last write of a processing that found the guild by the user's member row (`### leader succession`). */
function touch(core: GuildCore, ctx: RequestCtx, db: GuildDb, guild_id: bigint): void {
  db.set_active_at(ctx.user_id, guild_id, core.time.now(ctx));
}

/** The guild rows a processing that finds the guild by the user's member row works on, locked and read again. */
interface Found {
  readonly db: GuildDb;
  readonly guild: GuildRow;
  readonly me: MemberRow;
  /** The other member rows locked with the user's, read again; null when a user has no row. */
  readonly others: ReadonlyMap<bigint, MemberRow | null>;
}

/**
 * Reads the user's member row, locks the guild row and the member rows of the user and `others` in lock order, and
 * reads them again. `GUILD_NOT_MEMBER` when the user's row is gone or moved to another guild.
 */
function find_my_guild(core: GuildCore, ctx: RequestCtx, others: readonly bigint[]): Found | CoreErrorValue {
  const db = guild_db(core, ctx);
  const first = db.member(ctx.user_id);
  if (first === null) return NOT_MEMBER;
  if (lock(core, ctx, first.guild_id, [ctx.user_id, ...others]) === LOCK_FAILED) return INTERNAL;
  const me = db.member(ctx.user_id);
  const guild = db.guild(first.guild_id);
  if (me?.guild_id !== first.guild_id || guild === null) return NOT_MEMBER;
  return { db, guild, me, others: new Map(others.map((id) => [id, db.member(id)])) };
}

/** The member entries of a guild in `GetGuild` order, with public profiles; a member without a profile is left out. */
function member_entries(core: GuildCore, ctx: RequestCtx, rows: readonly MemberRow[]): CoreContract.GuildMemberEntry[] {
  const profiles = profiles_of(core, ctx, rows.map((r) => r.user_id));
  const entries: CoreContract.GuildMemberEntry[] = [];
  for (const row of [...rows].sort(by_role)) {
    const profile = profiles.get(row.user_id);
    if (profile === undefined) continue;
    const entry = new CoreContract.GuildMemberEntry();
    entry.profile = profile;
    entry.role = row.role;
    entry.joined_at = row.joined_at;
    entries.push(entry);
  }
  return entries;
}

/** Public profiles by user ID, from one `get_public_profiles` call. */
function profiles_of(core: GuildCore, ctx: RequestCtx, user_ids: readonly bigint[]): Map<bigint, CoreContract.PublicProfileEntry> {
  return new Map(core.profile.get_public_profiles(ctx, user_ids).map((entry) => [entry.user_id, entry]));
}

export function CreateGuild(core: GuildCore, ctx: RequestCtx, request: CoreContract.CreateGuildRequest): Result<CoreContract.CreateGuildResponse> {
  if (request.join_type === JoinType.GUILD_JOIN_TYPE_UNSPECIFIED) return INVALID_REQUEST;
  const name = core.validation.check_text(request.name, core.settings.max_name_length, false);
  const text = text_error(core, ctx, name, name_length_ok(core, request.name)) ?? check_description(core, ctx, request.description);
  if (text !== null) return text;
  if (lock(core, ctx, null, [ctx.user_id]) === LOCK_FAILED) return INTERNAL;
  const db = guild_db(core, ctx);
  if (db.member(ctx.user_id) !== null) return CoreError.CORE_ERROR_GUILD_ALREADY_MEMBER;
  if (in_cooldown(core, ctx, db)) return CoreError.CORE_ERROR_GUILD_COOLDOWN;
  const hook = prepare_create_guild(core, ctx, request.name);
  if (hook !== 'pass') return hook;
  const guild_id = insert_new_guild(core, ctx, db, {
    name: request.name,
    description: request.description,
    join_type: request.join_type,
    join_value: request.join_value,
    max_members: core.settings.max_members,
    members: [{ user_id: ctx.user_id, role: Role.GUILD_ROLE_LEADER }],
    now: core.time.now(ctx),
  });
  if (guild_id === LOCK_FAILED) return INTERNAL;
  if (guild_id === 'name_taken') return CoreError.CORE_ERROR_GUILD_NAME_TAKEN;
  member_changed(core, ctx, guild_id, ctx.user_id, 'Joined');
  const response = new CoreContract.CreateGuildResponse();
  response.guild_id = guild_id;
  return response;
}

export function UpdateGuild(core: GuildCore, ctx: RequestCtx, request: CoreContract.UpdateGuildRequest): Result<CoreContract.UpdateGuildResponse> {
  const found = find_my_guild(core, ctx, []);
  if (typeof found === 'number') return found;
  if (found.me.role !== Role.GUILD_ROLE_LEADER) return PERMISSION;
  if (request.join_type === JoinType.GUILD_JOIN_TYPE_UNSPECIFIED) return INVALID_REQUEST;
  const text = check_description(core, ctx, request.description);
  if (text !== null) return text;
  found.db.set_settings(found.guild, request.description, request.join_type, request.join_value);
  touch(core, ctx, found.db, found.guild.guild_id);
  return new CoreContract.UpdateGuildResponse();
}

export function GetGuild(core: GuildCore, ctx: RequestCtx, request: CoreContract.GetGuildRequest): Result<CoreContract.GetGuildResponse> {
  const db = guild_db(core, ctx);
  const guild = db.guild(request.guild_id);
  if (guild === null) return CoreError.CORE_ERROR_GUILD_NOT_FOUND;
  const response = new CoreContract.GetGuildResponse();
  response.guild = info_of(guild);
  response.members = member_entries(core, ctx, db.members(guild.guild_id));
  return response;
}

export function GetMyGuild(core: GuildCore, ctx: RequestCtx): Result<CoreContract.GetMyGuildResponse> {
  const db = guild_db(core, ctx);
  const first = db.member(ctx.user_id);
  if (first !== null && leader_succession(core, ctx, first.guild_id) === LOCK_FAILED) return INTERNAL;
  const response = new CoreContract.GetMyGuildResponse();
  const me = db.member(ctx.user_id);
  const guild = me === null ? null : db.guild(me.guild_id);
  response.guild = guild === null ? new CoreContract.GuildInfo() : info_of(guild);
  if (me !== null && guild !== null) {
    response.members = member_entries(core, ctx, db.members(guild.guild_id));
    if (me.role === Role.GUILD_ROLE_LEADER || me.role === Role.GUILD_ROLE_OFFICER) {
      const requests = db.requests_of_guild(guild.guild_id);
      const profiles = profiles_of(core, ctx, requests.map((r) => r.user_id));
      response.join_requests = requests.flatMap((r) => profiles.get(r.user_id) ?? []);
    }
  }
  response.my_join_requests = db.requests_of_user(ctx.user_id).map((r) => r.guild_id);
  response.cooldown_ends_at = cooldown_ends_at(core, ctx, db, ctx.user_id);
  if (me !== null) touch(core, ctx, db, me.guild_id);
  return response;
}

export function SearchGuilds(core: GuildCore, ctx: RequestCtx, request: CoreContract.SearchGuildsRequest): Result<CoreContract.SearchGuildsResponse> {
  const response = new CoreContract.SearchGuildsResponse();
  const prefix = core.validation.normalize_text(request.name);
  if (prefix === '') return response;
  response.guilds = guild_db(core, ctx).guilds_with_prefix(prefix, core.settings.max_search_results).map(info_of);
  return response;
}

export function ListJoinableGuilds(core: GuildCore, ctx: RequestCtx, request: CoreContract.ListJoinableGuildsRequest): Result<CoreContract.ListJoinableGuildsResponse> {
  const response = new CoreContract.ListJoinableGuildsResponse();
  response.guilds = guild_db(core, ctx).joinable(request.max_join_value, core.settings.max_search_results).map(info_of);
  return response;
}

export function JoinGuild(core: GuildCore, ctx: RequestCtx, request: CoreContract.JoinGuildRequest): Result<CoreContract.JoinGuildResponse> {
  const db = guild_db(core, ctx);
  if (lock(core, ctx, request.guild_id, []) === LOCK_FAILED) return INTERNAL;
  const guild = db.guild(request.guild_id);
  if (guild === null) return CoreError.CORE_ERROR_GUILD_NOT_FOUND;
  if (lock(core, ctx, null, [ctx.user_id]) === LOCK_FAILED) return INTERNAL;
  if (db.member(ctx.user_id) !== null) return CoreError.CORE_ERROR_GUILD_ALREADY_MEMBER;
  if (in_cooldown(core, ctx, db)) return CoreError.CORE_ERROR_GUILD_COOLDOWN;
  if (guild.join_type === JoinType.GUILD_JOIN_TYPE_CLOSED) return CoreError.CORE_ERROR_GUILD_CLOSED;
  const hook = validate_guild_join(core, ctx, guild.guild_id, guild.join_value);
  if (hook !== 'pass') return hook;
  const response = new CoreContract.JoinGuildResponse();
  if (guild.join_type === JoinType.GUILD_JOIN_TYPE_OPEN) {
    if (guild.member_count >= guild.max_members) return CoreError.CORE_ERROR_GUILD_FULL;
    add_member(core, ctx, db, guild, ctx.user_id);
    response.joined = true;
    return response;
  }
  if (db.join_request(guild.guild_id, ctx.user_id) !== null) return response;
  if (db.count_requests_of_user(ctx.user_id) >= core.settings.max_join_requests_per_user || db.count_requests_of_guild(guild.guild_id) >= core.settings.max_join_requests_per_guild) {
    return CoreError.CORE_ERROR_GUILD_REQUEST_LIMIT;
  }
  db.insert_request({ guild_id: guild.guild_id, user_id: ctx.user_id, created_at: core.time.now(ctx) });
  join_requested(core, ctx, guild.guild_id);
  return response;
}

export function CancelGuildJoinRequest(core: GuildCore, ctx: RequestCtx, request: CoreContract.CancelGuildJoinRequestRequest): Result<CoreContract.CancelGuildJoinRequestResponse> {
  if (lock(core, ctx, null, [ctx.user_id]) === LOCK_FAILED) return INTERNAL;
  const db = guild_db(core, ctx);
  if (db.join_request(request.guild_id, ctx.user_id) === null) return CoreError.CORE_ERROR_GUILD_REQUEST_NOT_FOUND;
  db.delete_request(request.guild_id, ctx.user_id);
  return new CoreContract.CancelGuildJoinRequestResponse();
}

/** Steps 1 to 3 of `AcceptGuildJoinRequest`, which `RejectGuildJoinRequest` shares. */
function find_join_request(core: GuildCore, ctx: RequestCtx, user_id: bigint): Found | CoreErrorValue {
  const found = find_my_guild(core, ctx, [user_id]);
  if (typeof found === 'number') return found;
  if (found.me.role !== Role.GUILD_ROLE_LEADER && found.me.role !== Role.GUILD_ROLE_OFFICER) return PERMISSION;
  if (found.db.join_request(found.guild.guild_id, user_id) === null) return CoreError.CORE_ERROR_GUILD_REQUEST_NOT_FOUND;
  return found;
}

export function AcceptGuildJoinRequest(core: GuildCore, ctx: RequestCtx, request: CoreContract.AcceptGuildJoinRequestRequest): Result<CoreContract.AcceptGuildJoinRequestResponse> {
  const found = find_join_request(core, ctx, request.user_id);
  if (typeof found === 'number') return found;
  const { db, guild } = found;
  if ((found.others.get(request.user_id) ?? null) !== null) return CoreError.CORE_ERROR_GUILD_REQUEST_NOT_FOUND;
  if (guild.member_count >= guild.max_members) return CoreError.CORE_ERROR_GUILD_FULL;
  add_member(core, ctx, db, guild, request.user_id);
  touch(core, ctx, db, guild.guild_id);
  return new CoreContract.AcceptGuildJoinRequestResponse();
}

export function RejectGuildJoinRequest(core: GuildCore, ctx: RequestCtx, request: CoreContract.RejectGuildJoinRequestRequest): Result<CoreContract.RejectGuildJoinRequestResponse> {
  const found = find_join_request(core, ctx, request.user_id);
  if (typeof found === 'number') return found;
  found.db.delete_request(found.guild.guild_id, request.user_id);
  touch(core, ctx, found.db, found.guild.guild_id);
  return new CoreContract.RejectGuildJoinRequestResponse();
}

export function LeaveGuild(core: GuildCore, ctx: RequestCtx): Result<CoreContract.LeaveGuildResponse> {
  const found = find_my_guild(core, ctx, []);
  if (typeof found === 'number') return found;
  const { db, guild, me } = found;
  if (guild.member_count <= 1) {
    disband(core, ctx, db, guild, ctx.user_id);
    return new CoreContract.LeaveGuildResponse();
  }
  if (me.role === Role.GUILD_ROLE_LEADER) return CoreError.CORE_ERROR_GUILD_LEADER_CANNOT_LEAVE;
  remove_member(core, ctx, db, guild, ctx.user_id, true);
  member_changed(core, ctx, guild.guild_id, ctx.user_id, 'Left');
  return new CoreContract.LeaveGuildResponse();
}

export function KickGuildMember(core: GuildCore, ctx: RequestCtx, request: CoreContract.KickGuildMemberRequest): Result<CoreContract.KickGuildMemberResponse> {
  if (request.user_id === ctx.user_id) return INVALID_REQUEST;
  const found = find_my_guild(core, ctx, [request.user_id]);
  if (typeof found === 'number') return found;
  const { db, guild, me } = found;
  const target = found.others.get(request.user_id);
  if (target?.guild_id !== guild.guild_id) return NOT_MEMBER;
  const allowed = me.role === Role.GUILD_ROLE_LEADER || (me.role === Role.GUILD_ROLE_OFFICER && target.role === Role.GUILD_ROLE_MEMBER);
  if (!allowed) return PERMISSION;
  remove_member(core, ctx, db, guild, target.user_id, true);
  member_changed(core, ctx, guild.guild_id, target.user_id, 'Kicked');
  touch(core, ctx, db, guild.guild_id);
  return new CoreContract.KickGuildMemberResponse();
}

export function SetGuildMemberRole(core: GuildCore, ctx: RequestCtx, request: CoreContract.SetGuildMemberRoleRequest): Result<CoreContract.SetGuildMemberRoleResponse> {
  if (request.user_id === ctx.user_id || request.role === Role.GUILD_ROLE_UNSPECIFIED) return INVALID_REQUEST;
  const found = find_my_guild(core, ctx, [request.user_id]);
  if (typeof found === 'number') return found;
  const { db, guild, me } = found;
  const target = found.others.get(request.user_id);
  if (target?.guild_id !== guild.guild_id) return NOT_MEMBER;
  if (me.role !== Role.GUILD_ROLE_LEADER) return PERMISSION;
  if (officer_limit(core, db, guild.guild_id, target, request.role)) return CoreError.CORE_ERROR_GUILD_OFFICER_LIMIT;
  apply_role(core, ctx, db, guild, target, request.role, Role.GUILD_ROLE_OFFICER);
  touch(core, ctx, db, guild.guild_id);
  return new CoreContract.SetGuildMemberRoleResponse();
}
