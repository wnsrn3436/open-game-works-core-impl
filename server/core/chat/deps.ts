/**
 * The operations of other modules that chat calls, in the TypeScript form of `server-core` `## module`. Each type
 * picks only the operations of that module's spec `## API` that chat calls.
 */
import type * as CoreContract from '../../generated/contract/core_contract.ts';
import type { Logging } from '../logging/index.ts';
import type { ServerTimeApi } from '../server-time/index.ts';
import type { RequestCtx, Storage } from '../storage/index.ts';
import type { Validation } from '../validation/index.ts';

export type ChatStorage = Pick<Storage, 'register_table' | 'get_state' | 'db' | 'lock_game_row' | 'check_hook_output'>;

export type ChatServerTime = Pick<ServerTimeApi, 'now' | 'is_reached_strict'>;

export type ChatLogging = Pick<Logging, 'write'>;

export type ChatValidation = Pick<Validation, 'check_text'>;

/** One `(user ID, nickname)` of `nickname.get_nicknames`. */
export interface NicknameEntry {
  readonly user_id: bigint;
  readonly nickname: string;
}

export interface ChatNickname {
  get_nicknames(ctx: RequestCtx, user_ids: readonly bigint[]): readonly NicknameEntry[];
}

export interface ChatPublicProfile {
  get_public_profiles(ctx: RequestCtx, user_ids: readonly bigint[]): readonly CoreContract.PublicProfileEntry[];
  is_active_user(ctx: RequestCtx, user_id: bigint): boolean;
}

/** A `ReportResult` element. */
export type ReportResult = 'OK' | 'LIMIT' | 'INVALID_INPUT';

export interface ChatBlockReport {
  is_blocked_either(ctx: RequestCtx, a: bigint, b: bigint): boolean;
  list_blocked_ids(ctx: RequestCtx, user_id: bigint): readonly bigint[];
  add_report(
    ctx: RequestCtx,
    target_id: bigint,
    reason_id: number,
    context: CoreContract.ReportContext,
    ref: string,
    comment: string,
    evidence: string,
  ): ReportResult;
}

export interface ChatFriend {
  are_friends(ctx: RequestCtx, a: bigint, b: bigint): boolean;
  list_friend_ids(ctx: RequestCtx, user_id: bigint): readonly bigint[];
}

/** `guild.get_member`: `(guild ID, GuildRole, joined_at)`. */
export interface GuildMember {
  readonly guild_id: bigint;
  readonly role: CoreContract.GuildRole;
  readonly joined_at: bigint;
}

export interface ChatGuild {
  get_member(ctx: RequestCtx, user_id: bigint): GuildMember | null;
  /** The locked guild's `GuildInfo`, null when the guild does not exist, `FAILED` on a lock wait timeout. */
  lock_guild(ctx: RequestCtx, guild_id: bigint): CoreContract.GuildInfo | null | 'FAILED';
}

/** The module objects chat gets in `modules`. `friend` and `guild` are there only when they are server modules. */
export interface ChatModules {
  readonly storage: ChatStorage;
  readonly server_time: ChatServerTime;
  readonly logging: ChatLogging;
  readonly validation: ChatValidation;
  readonly nickname: ChatNickname;
  readonly public_profile: ChatPublicProfile;
  readonly block_report: ChatBlockReport;
  readonly friend: ChatFriend | null;
  readonly guild: ChatGuild | null;
}

/** The module object of `name` with each of `methods`; null when an optional module is not a server module. */
function module_of(modules: Readonly<Record<string, unknown>>, name: string, methods: readonly string[], optional: boolean): object | null {
  const module = modules[name];
  if (module === undefined && optional) return null;
  if (typeof module !== 'object' || module === null) throw new TypeError(`chat: module ${name} is missing`);
  const record = module as Record<string, unknown>;
  const missing = methods.find((method) => typeof record[method] !== 'function');
  if (missing !== undefined) throw new TypeError(`chat: module ${name} has no ${missing}`);
  return module;
}

function required(modules: Readonly<Record<string, unknown>>, name: string, methods: readonly string[]): object {
  return module_of(modules, name, methods, false) ?? {};
}

/** Reads the module objects of the module input. A missing dependency or operation throws. */
export function read_modules(modules: Readonly<Record<string, unknown>>): ChatModules {
  return {
    storage: required(modules, 'storage', ['register_table', 'get_state', 'db', 'lock_game_row', 'check_hook_output']) as ChatStorage,
    server_time: required(modules, 'server-time', ['now', 'is_reached_strict']) as ChatServerTime,
    logging: required(modules, 'logging', ['write']) as ChatLogging,
    validation: required(modules, 'validation', ['check_text']) as ChatValidation,
    nickname: required(modules, 'nickname', ['get_nicknames']) as ChatNickname,
    public_profile: required(modules, 'public-profile', ['get_public_profiles', 'is_active_user']) as ChatPublicProfile,
    block_report: required(modules, 'block-report', ['is_blocked_either', 'list_blocked_ids', 'add_report']) as ChatBlockReport,
    friend: module_of(modules, 'friend', ['are_friends', 'list_friend_ids'], true) as ChatFriend | null,
    guild: module_of(modules, 'guild', ['get_member', 'lock_guild'], true) as ChatGuild | null,
  };
}
