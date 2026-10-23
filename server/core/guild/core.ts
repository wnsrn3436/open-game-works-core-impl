/**
 * The state of one `guild` instance shared by the operation files: dependency modules, settings, hook slots, disband
 * listeners, and the lock, hook and log steps every operation uses.
 */
import * as CoreContract from '../../generated/contract/core_contract.ts';
import type { Logging, LogFields } from '../logging/index.ts';
import type { ServerTimeApi } from '../server-time/index.ts';
import type { RequestCtx, Storage } from '../storage/index.ts';
import { GuildDb, GUILD, MEMBER, SEQUENCE, code_points, compare, type CtxOrTx, type MemberRow } from './tables.ts';

/** `validation`'s `TextCheckResult` element and the matched `banned_word` ID value (`check_text`). */
export interface TextCheck {
  readonly result: 'OK' | 'INVALID' | 'BANNED';
  readonly banned_word_id: number;
}

/** The `validation` operations guild calls (`validation` `## API`). */
export interface GuildValidation {
  is_plain_text(text: string, max_code_points: number): boolean;
  normalize_text(text: string): string;
  check_text(text: string, max_code_points: number, allow_newline: boolean): TextCheck;
}

/** The `public-profile` operation guild calls (`public-profile` `## API`). */
export interface GuildPublicProfile {
  get_public_profiles(ctx: RequestCtx, user_ids: readonly bigint[]): CoreContract.PublicProfileEntry[];
}

export type GuildStorage = Pick<Storage, 'register_table' | 'db' | 'read_db' | 'lock_game_row' | 'get_user_record' | 'check_hook_output'>;
export type GuildServerTime = Pick<ServerTimeApi, 'now' | 'is_reached_strict' | 'clock_now'>;
export type GuildLogging = Pick<Logging, 'write'>;

/** `GuildMemberChange`: the change an `on_guild_member_changed` call reports. */
export type GuildMemberChange = 'Joined' | 'Left' | 'Kicked' | 'Disbanded' | 'RoleChanged';

/** `pass` or a `GameError` value. */
export type HookResult = 'pass' | number;

/** The hooks of `## hook`, as content registers them through `routing.register_hook`. */
export interface GuildHooks {
  prepare_create_guild: ((ctx: RequestCtx, name: string) => HookResult) | null;
  validate_guild_join: ((ctx: RequestCtx, guild_id: bigint, join_value: bigint) => HookResult) | null;
  on_guild_member_changed: ((ctx: RequestCtx, guild_id: bigint, user_id: bigint, change: GuildMemberChange) => unknown) | null;
  on_guild_join_requested: ((ctx: RequestCtx, guild_id: bigint) => unknown) | null;
}

/** A function `register_disband_listener` takes. */
export type DisbandListener = (ctx_or_tx: CtxOrTx, guild_id: bigint) => unknown;

/** The settings of `## settings`. */
export interface GuildSettings {
  readonly max_members: number;
  readonly max_members_limit: number;
  readonly max_officers: number;
  readonly min_name_length: number;
  readonly max_name_length: number;
  readonly max_description_length: number;
  readonly max_search_results: number;
  readonly max_join_requests_per_user: number;
  readonly max_join_requests_per_guild: number;
  readonly rejoin_cooldown_ms: bigint;
  /** null: no leader succession. */
  readonly leader_inactive_ms: bigint | null;
}

export interface GuildCore {
  readonly storage: GuildStorage;
  readonly time: GuildServerTime;
  readonly logging: GuildLogging;
  readonly validation: GuildValidation;
  readonly profile: GuildPublicProfile;
  readonly settings: GuildSettings;
  readonly env: string;
  readonly hooks: GuildHooks;
  readonly listeners: DisbandListener[];
  readonly start_errors: string[];
  phase: 'created' | 'starting' | 'started' | 'stopped';
}

/**
 * The length rule every guild name check shares (`CreateGuild` step 2, `rename_guild`, `import_guild`): at least
 * `guild.minNameLength` code points. The callers' `check_text` and `is_plain_text` reject a name empty once normalized.
 */
export function name_length_ok(core: GuildCore, name: string): boolean {
  return code_points(name) >= core.settings.min_name_length;
}

/**
 * The description rule every guild description check shares (`CreateGuild` step 2, `UpdateGuild`,
 * `set_guild_description`, `import_guild`): the empty string is `OK`, any other text is `validation.check_text` within
 * `guild.maxDescriptionLength` with newlines allowed.
 */
export function description_check(core: GuildCore, description: string): TextCheck {
  return description === '' ? { result: 'OK', banned_word_id: 0 } : core.validation.check_text(description, core.settings.max_description_length, true);
}

/** A lock wait limit was passed (`storage.lock_game_row` `FAILED`). */
export const LOCK_FAILED = 'FAILED';
export type LockFailed = typeof LOCK_FAILED;

export const CoreError = CoreContract.CoreError;
export type CoreErrorValue = CoreContract.CoreError;

export function guild_db(core: GuildCore, ctx_or_tx: CtxOrTx): GuildDb {
  return new GuildDb(core.storage.db(ctx_or_tx));
}

/** Locks the guild row, then the member rows of `user_ids` in user ID order (`### tables` lock order). */
export function lock(core: GuildCore, ctx_or_tx: CtxOrTx, guild_id: bigint | null, user_ids: readonly bigint[]): LockFailed | null {
  if (guild_id !== null && core.storage.lock_game_row(ctx_or_tx, GUILD, [guild_id]) === LOCK_FAILED) return LOCK_FAILED;
  for (const user_id of [...new Set(user_ids)].sort(compare)) {
    if (core.storage.lock_game_row(ctx_or_tx, MEMBER, [user_id]) === LOCK_FAILED) return LOCK_FAILED;
  }
  return null;
}

/**
 * Locks the guild row, then the member rows of that guild read after it and of `user_ids` in user ID order, and returns
 * the guild's member rows read again.
 */
export function lock_with_members(core: GuildCore, ctx_or_tx: CtxOrTx, guild_id: bigint, user_ids: readonly bigint[] = []): MemberRow[] | LockFailed {
  if (lock(core, ctx_or_tx, guild_id, []) === LOCK_FAILED) return LOCK_FAILED;
  const db = guild_db(core, ctx_or_tx);
  if (lock(core, ctx_or_tx, null, [...db.members(guild_id).map((r) => r.user_id), ...user_ids]) === LOCK_FAILED) return LOCK_FAILED;
  return db.members(guild_id);
}

/** ID issue: locks the `guild_sequence` row, raises its last guild ID by one and returns that ID. */
export function issue_guild_id(core: GuildCore, ctx_or_tx: CtxOrTx): bigint | LockFailed {
  if (core.storage.lock_game_row(ctx_or_tx, SEQUENCE, [0n]) === LOCK_FAILED) return LOCK_FAILED;
  const db = guild_db(core, ctx_or_tx);
  const guild_id = db.last_guild_id() + 1n;
  db.set_last_guild_id(guild_id);
  return guild_id;
}

function wrong_output(name: string, output: unknown): Error {
  return new TypeError(`guild: hook ${name} returned a value of type ${typeof output}, not its output form`);
}

function check_none(name: string, output: unknown): void {
  if (output !== undefined && output !== null) throw wrong_output(name, output);
}

export function prepare_create_guild(core: GuildCore, ctx: RequestCtx, name: string): HookResult {
  const hook = core.hooks.prepare_create_guild;
  return hook === null ? 'pass' : core.storage.check_hook_output('guild.prepare_create_guild', hook(ctx, name));
}

export function validate_guild_join(core: GuildCore, ctx: RequestCtx, guild_id: bigint, join_value: bigint): HookResult {
  const hook = core.hooks.validate_guild_join;
  return hook === null ? 'pass' : core.storage.check_hook_output('guild.validate_guild_join', hook(ctx, guild_id, join_value));
}

export function member_changed(core: GuildCore, ctx: RequestCtx, guild_id: bigint, user_id: bigint, change: GuildMemberChange): void {
  const hook = core.hooks.on_guild_member_changed;
  if (hook !== null) check_none('on_guild_member_changed', hook(ctx, guild_id, user_id, change));
}

export function join_requested(core: GuildCore, ctx: RequestCtx, guild_id: bigint): void {
  const hook = core.hooks.on_guild_join_requested;
  if (hook !== null) check_none('on_guild_join_requested', hook(ctx, guild_id));
}

/** A `core` log line of guild in the request or change of `ctx`. */
export function core_log(core: GuildCore, ctx: RequestCtx, level: 'info' | 'error', message: string, fields: LogFields): void {
  core.logging.write({
    kind: level === 'error' ? 'error' : 'core',
    level,
    message,
    user_id: ctx.user_id,
    request_id: ctx.request_id === '' ? null : ctx.request_id,
    request: ctx.request_name === '' ? null : ctx.request_name,
    fields: level === 'error' ? { module: 'guild', stack_trace: null, ...fields } : { module: 'guild', ...fields },
  });
}

/** The `ends_at` of the user's cooldown while the request time has not reached it, else 0. */
export function cooldown_ends_at(core: GuildCore, ctx: RequestCtx, db: GuildDb, user_id: bigint): bigint {
  const ends_at = db.cooldown(user_id);
  return ends_at === null || core.time.is_reached_strict(ctx, ends_at) ? 0n : ends_at;
}
