/**
 * `guild`: guild creation, search, joining and join requests, leaving, kicking, roles and guild information.
 */
import type * as CoreContract from '../../generated/contract/core_contract.ts';
import type { RequestCtx } from '../storage/index.ts';
import * as Admin from './admin.ts';
import {
  LOCK_FAILED,
  core_log,
  guild_db,
  lock,
  type DisbandListener,
  type GuildCore,
  type GuildHooks,
  type GuildLogging,
  type GuildPublicProfile,
  type GuildServerTime,
  type GuildSettings,
  type GuildStorage,
  type GuildValidation,
  type LockFailed,
} from './core.ts';
import { change_role, remove_user } from './members.ts';
import * as Rpc from './rpc.ts';
import { info_of, register_tables, type CtxOrTx, type GuildRole } from './tables.ts';

export type { AdminFailure, AdminOperation } from './admin.ts';
export type { DisbandListener, GuildHooks, GuildMemberChange, GuildPublicProfile, GuildValidation, HookResult, TextCheck } from './core.ts';
export type { CtxOrTx } from './tables.ts';

/** `get_member`'s output. */
export interface GuildMember {
  readonly guild_id: bigint;
  readonly role: GuildRole;
  readonly joined_at: bigint;
}

/** The module input (`server-core` `## module`). guild reads `env` of `server`. */
export interface GuildInput {
  readonly settings: Readonly<Record<string, unknown>>;
  readonly modules: Readonly<Record<string, unknown>>;
  readonly server: { readonly env: string };
}

/** A core `rpc` handler: the response message, or a `CoreError` or `GameError` value. */
type Rpc<Request, Response> = (ctx: RequestCtx, request: Request) => Response | number;

/** The operations content handlers and hooks call (`caller` content handler, hook). */
export interface GuildContent {
  get_member(ctx: RequestCtx, user_id: bigint): GuildMember | null;
  /** Throws on a lock wait limit. */
  lock_guild(ctx: RequestCtx, guild_id: bigint): CoreContract.GuildInfo | null;
  list_member_ids(ctx_or_tx: CtxOrTx, guild_id: bigint): bigint[];
  get_guild_infos(ctx_or_tx: CtxOrTx, guild_ids: readonly bigint[]): CoreContract.GuildInfo[];
  set_guild_max_members(ctx: RequestCtx, guild_id: bigint, max_members: number | bigint): boolean;
  set_member_role(ctx: RequestCtx, guild_id: bigint, user_id: bigint, role: GuildRole): boolean;
}

/** The `guild` module object: core `rpc` handlers, internal operations, admin operations, hook slots and lifecycle. */
export interface Guild {
  CreateGuild: Rpc<CoreContract.CreateGuildRequest, CoreContract.CreateGuildResponse>;
  UpdateGuild: Rpc<CoreContract.UpdateGuildRequest, CoreContract.UpdateGuildResponse>;
  GetGuild: Rpc<CoreContract.GetGuildRequest, CoreContract.GetGuildResponse>;
  GetMyGuild: Rpc<CoreContract.GetMyGuildRequest, CoreContract.GetMyGuildResponse>;
  SearchGuilds: Rpc<CoreContract.SearchGuildsRequest, CoreContract.SearchGuildsResponse>;
  ListJoinableGuilds: Rpc<CoreContract.ListJoinableGuildsRequest, CoreContract.ListJoinableGuildsResponse>;
  JoinGuild: Rpc<CoreContract.JoinGuildRequest, CoreContract.JoinGuildResponse>;
  CancelGuildJoinRequest: Rpc<CoreContract.CancelGuildJoinRequestRequest, CoreContract.CancelGuildJoinRequestResponse>;
  AcceptGuildJoinRequest: Rpc<CoreContract.AcceptGuildJoinRequestRequest, CoreContract.AcceptGuildJoinRequestResponse>;
  RejectGuildJoinRequest: Rpc<CoreContract.RejectGuildJoinRequestRequest, CoreContract.RejectGuildJoinRequestResponse>;
  LeaveGuild: Rpc<CoreContract.LeaveGuildRequest, CoreContract.LeaveGuildResponse>;
  KickGuildMember: Rpc<CoreContract.KickGuildMemberRequest, CoreContract.KickGuildMemberResponse>;
  SetGuildMemberRole: Rpc<CoreContract.SetGuildMemberRoleRequest, CoreContract.SetGuildMemberRoleResponse>;
  get_member(ctx: RequestCtx, user_id: bigint): GuildMember | null;
  /** The core module form (`chat`, `ranking`): `FAILED` on a lock wait limit. */
  lock_guild(ctx: RequestCtx, guild_id: bigint): CoreContract.GuildInfo | null | LockFailed;
  list_member_ids(ctx_or_tx: CtxOrTx, guild_id: bigint): bigint[];
  get_guild_infos(ctx_or_tx: CtxOrTx, guild_ids: readonly bigint[]): CoreContract.GuildInfo[];
  register_disband_listener(listener: DisbandListener): null;
  set_guild_max_members(ctx: RequestCtx, guild_id: bigint, max_members: number | bigint): boolean;
  set_member_role(ctx: RequestCtx, guild_id: bigint, user_id: bigint, role: GuildRole): boolean;
  remove_user(ctx: RequestCtx): LockFailed | null;
  readonly get_guild: Admin.AdminOperation;
  readonly rename_guild: Admin.AdminOperation;
  readonly set_guild_description: Admin.AdminOperation;
  readonly set_guild_member_role: Admin.AdminOperation;
  readonly kick_guild_member: Admin.AdminOperation;
  readonly disband_guild: Admin.AdminOperation;
  readonly import_guild: Admin.AdminOperation;
  /** `routing` fills a slot with the hook content registered through `register_hook`; an empty slot is null. */
  readonly hook_slots: GuildHooks;
  readonly content: GuildContent;
  begin_start(): void;
  complete_start(): string | null;
  stop(): void;
}

function integer(settings: Readonly<Record<string, unknown>>, key: string): number {
  const value = settings[key];
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) throw new TypeError(`guild: setting ${key} is not an integer`);
  return value;
}

function read_settings(settings: Readonly<Record<string, unknown>>): GuildSettings {
  const inactive = settings['guild.leaderInactiveMs'];
  return {
    max_members: integer(settings, 'guild.maxMembers'),
    max_members_limit: integer(settings, 'guild.maxMembersLimit'),
    max_officers: integer(settings, 'guild.maxOfficers'),
    min_name_length: integer(settings, 'guild.minNameLength'),
    max_name_length: integer(settings, 'guild.maxNameLength'),
    max_description_length: integer(settings, 'guild.maxDescriptionLength'),
    max_search_results: integer(settings, 'guild.maxSearchResults'),
    max_join_requests_per_user: integer(settings, 'guild.maxJoinRequestsPerUser'),
    max_join_requests_per_guild: integer(settings, 'guild.maxJoinRequestsPerGuild'),
    rejoin_cooldown_ms: BigInt(integer(settings, 'guild.rejoinCooldownMs')),
    leader_inactive_ms: inactive === null ? null : BigInt(integer(settings, 'guild.leaderInactiveMs')),
  };
}

/** The module object of a dependency; throws when it is missing or lacks a method guild calls. */
function module_of(modules: Readonly<Record<string, unknown>>, name: string, methods: readonly string[]): unknown {
  const value = modules[name] as Record<string, unknown> | undefined | null;
  if (value === undefined || value === null) throw new TypeError(`guild: module ${name} is missing`);
  for (const method of methods) if (typeof value[method] !== 'function') throw new TypeError(`guild: module ${name} has no ${method}`);
  return value;
}

/** Makes the `guild` module of one server instance (`server-core` `## module`). Registers the guild tables. */
export function create_guild(input: GuildInput): Guild {
  const { modules } = input;
  const core: GuildCore = {
    storage: module_of(modules, 'storage', ['register_table', 'db', 'read_db', 'lock_game_row', 'get_user_record', 'check_hook_output']) as GuildStorage,
    time: module_of(modules, 'server-time', ['now', 'is_reached_strict', 'clock_now']) as GuildServerTime,
    logging: module_of(modules, 'logging', ['write']) as GuildLogging,
    validation: module_of(modules, 'validation', ['is_plain_text', 'normalize_text', 'check_text']) as GuildValidation,
    profile: module_of(modules, 'public-profile', ['get_public_profiles']) as GuildPublicProfile,
    settings: read_settings(input.settings),
    env: input.server.env,
    hooks: { prepare_create_guild: null, validate_guild_join: null, on_guild_member_changed: null, on_guild_join_requested: null },
    listeners: [],
    start_errors: [],
    phase: 'created',
  };
  register_tables(core.storage);

  const lock_guild = (ctx: RequestCtx, guild_id: bigint): CoreContract.GuildInfo | null | LockFailed => {
    if (lock(core, ctx, guild_id, []) === LOCK_FAILED) return LOCK_FAILED;
    const guild = guild_db(core, ctx).guild(guild_id);
    return guild === null ? null : info_of(guild);
  };
  const get_member = (ctx: RequestCtx, user_id: bigint): GuildMember | null => {
    const row = guild_db(core, ctx).member(user_id);
    return row === null ? null : { guild_id: row.guild_id, role: row.role, joined_at: row.joined_at };
  };
  const list_member_ids = (ctx_or_tx: CtxOrTx, guild_id: bigint): bigint[] => guild_db(core, ctx_or_tx).members(guild_id).map((m) => m.user_id);
  const get_guild_infos = (ctx_or_tx: CtxOrTx, guild_ids: readonly bigint[]): CoreContract.GuildInfo[] => guild_db(core, ctx_or_tx).guilds(guild_ids).map(info_of);
  const set_guild_max_members = (ctx: RequestCtx, guild_id: bigint, max_members: number | bigint): boolean => {
    const value = typeof max_members === 'bigint' ? max_members : Number.isSafeInteger(max_members) ? BigInt(max_members) : -1n;
    const in_range = value >= 1n && value <= BigInt(core.settings.max_members_limit);
    if (in_range) {
      if (lock(core, ctx, guild_id, []) === LOCK_FAILED) throw new Error(`guild: set_guild_max_members: the guild ${String(guild_id)} lock wait passed its limit`);
      const db = guild_db(core, ctx);
      const guild = db.guild(guild_id);
      if (guild !== null) {
        db.set_max_members(guild, Number(value));
        return true;
      }
    }
    core_log(core, ctx, 'error', in_range ? 'set_guild_max_members: no such guild' : 'set_guild_max_members: max members out of range', { guild_id, max_members: String(max_members) });
    return false;
  };
  const set_member_role = (ctx: RequestCtx, guild_id: bigint, user_id: bigint, role: GuildRole): boolean => {
    const result = change_role(core, ctx, guild_id, user_id, role);
    if (result === LOCK_FAILED) throw new Error(`guild: set_member_role: the guild ${String(guild_id)} lock wait passed its limit`);
    return result === null;
  };
  const content: GuildContent = {
    get_member,
    lock_guild: (ctx, guild_id) => {
      const result = lock_guild(ctx, guild_id);
      if (result === LOCK_FAILED) throw new Error(`guild: lock_guild: the guild ${String(guild_id)} lock wait passed its limit`);
      return result;
    },
    list_member_ids,
    get_guild_infos,
    set_guild_max_members,
    set_member_role,
  };

  return {
    CreateGuild: (ctx, request) => Rpc.CreateGuild(core, ctx, request),
    UpdateGuild: (ctx, request) => Rpc.UpdateGuild(core, ctx, request),
    GetGuild: (ctx, request) => Rpc.GetGuild(core, ctx, request),
    GetMyGuild: (ctx) => Rpc.GetMyGuild(core, ctx),
    SearchGuilds: (ctx, request) => Rpc.SearchGuilds(core, ctx, request),
    ListJoinableGuilds: (ctx, request) => Rpc.ListJoinableGuilds(core, ctx, request),
    JoinGuild: (ctx, request) => Rpc.JoinGuild(core, ctx, request),
    CancelGuildJoinRequest: (ctx, request) => Rpc.CancelGuildJoinRequest(core, ctx, request),
    AcceptGuildJoinRequest: (ctx, request) => Rpc.AcceptGuildJoinRequest(core, ctx, request),
    RejectGuildJoinRequest: (ctx, request) => Rpc.RejectGuildJoinRequest(core, ctx, request),
    LeaveGuild: (ctx) => Rpc.LeaveGuild(core, ctx),
    KickGuildMember: (ctx, request) => Rpc.KickGuildMember(core, ctx, request),
    SetGuildMemberRole: (ctx, request) => Rpc.SetGuildMemberRole(core, ctx, request),
    get_member,
    lock_guild,
    list_member_ids,
    get_guild_infos,
    register_disband_listener: (listener) => {
      const closed = core.phase === 'started' || core.phase === 'stopped';
      const problem = closed
        ? 'register_disband_listener: called after server start'
        : typeof listener !== 'function'
          ? 'register_disband_listener: not a function'
          : core.listeners.includes(listener)
            ? 'register_disband_listener: the same function is registered twice'
            : null;
      if (problem === null) {
        core.listeners.push(listener);
        return null;
      }
      core.logging.write({ kind: 'error', level: 'error', message: problem, user_id: null, request_id: null, request: null, fields: { module: 'guild', stack_trace: null } });
      if (closed) throw new Error(`guild: ${problem}`);
      core.start_errors.push(problem);
      return null;
    },
    set_guild_max_members,
    set_member_role,
    remove_user: (ctx) => remove_user(core, ctx),
    get_guild: Admin.get_guild(core),
    rename_guild: Admin.rename_guild(core),
    set_guild_description: Admin.set_guild_description(core),
    set_guild_member_role: Admin.set_guild_member_role(core),
    kick_guild_member: Admin.kick_guild_member(core),
    disband_guild: Admin.disband_guild(core),
    import_guild: Admin.import_guild(core),
    hook_slots: core.hooks,
    content,
    begin_start: () => {
      core.phase = 'starting';
    },
    complete_start: () => {
      core.phase = 'started';
      return core.start_errors.length > 0 ? `guild: ${core.start_errors.join('; ')}` : null;
    },
    stop: () => {
      core.phase = 'stopped';
    },
  };
}

