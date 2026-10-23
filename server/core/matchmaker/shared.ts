/** What the parts of matchmaker share: the settings, the hook slots, the dependencies and the log lines. */
import { randomBytes } from 'node:crypto';
import * as CoreContract from '../../generated/contract/core_contract.ts';
import type * as GameData from '../../generated/data/game_data.ts';
import type { LogFields } from '../logging/index.ts';
import type { Random, RequestCtx } from '../storage/index.ts';
import type {
  ErrorCode,
  MatchmakerAdminApi,
  MatchmakerAuth,
  MatchmakerBlockReport,
  MatchmakerGameUpdate,
  MatchmakerLogging,
  MatchmakerP2pSignaling,
  MatchmakerRating,
  MatchmakerServer,
  MatchmakerServerTime,
  MatchmakerSession,
  MatchmakerStorage,
  MatchmakerValidation,
  Pass,
} from './deps.ts';
import type { MatchRecordInput } from './records.ts';

export const CoreError = CoreContract.CoreError;
export const FrameKind = CoreContract.MatchmakerFrameKind;

/** The `## settings` values matchmaker uses; times and durations are bigint. */
export interface MatchmakerSettings {
  readonly tick_ms: bigint;
  readonly max_players: number;
  readonly report_margin_ms: bigint;
  readonly sweep_interval_ms: bigint;
  readonly record_retention_ms: bigint;
  readonly apply_retry_initial_ms: bigint;
  readonly apply_retry_factor_permille: bigint;
  readonly apply_retry_max_interval_ms: bigint;
  readonly apply_retry_max_attempts: number;
  readonly max_frame_bytes: number;
  readonly frame_read_timeout_ms: bigint;
  readonly frames_per_second: number;
  readonly pre_auth_accepts_per_second: number;
  readonly pre_auth_frames_per_second: number;
  readonly pre_auth_connections: number;
  readonly hello_timeout_ms: bigint;
  readonly room_code_alphabet: string;
  readonly room_code_length: number;
  readonly lockstep_max_duration_ms: bigint;
}

function integer(settings: Readonly<Record<string, unknown>>, key: string): number {
  const value = settings[key];
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) throw new TypeError(`matchmaker: setting ${key} is not an integer`);
  return value;
}

function text(settings: Readonly<Record<string, unknown>>, key: string): string {
  const value = settings[key];
  if (typeof value !== 'string') throw new TypeError(`matchmaker: setting ${key} is not a string`);
  return value;
}

/** Reads the core settings of `## settings`; a missing key or a value of another type throws. */
export function read_settings(settings: Readonly<Record<string, unknown>>): MatchmakerSettings {
  const ms = (key: string): bigint => BigInt(integer(settings, key));
  return {
    tick_ms: ms('matchmaker.tickMs'),
    max_players: integer(settings, 'matchmaker.maxPlayers'),
    report_margin_ms: ms('matchmaker.reportMarginMs'),
    sweep_interval_ms: ms('matchmaker.sweepIntervalMs'),
    record_retention_ms: ms('matchmaker.recordRetentionMs'),
    apply_retry_initial_ms: ms('matchmaker.applyRetryInitialMs'),
    apply_retry_factor_permille: ms('matchmaker.applyRetryFactorPermille'),
    apply_retry_max_interval_ms: ms('matchmaker.applyRetryMaxIntervalMs'),
    apply_retry_max_attempts: integer(settings, 'matchmaker.applyRetryMaxAttempts'),
    max_frame_bytes: integer(settings, 'matchmaker.maxFrameBytes'),
    frame_read_timeout_ms: ms('matchmaker.frameReadTimeoutMs'),
    frames_per_second: integer(settings, 'matchmaker.framesPerSecond'),
    pre_auth_accepts_per_second: integer(settings, 'matchmaker.preAuthAcceptsPerSecond'),
    pre_auth_frames_per_second: integer(settings, 'matchmaker.preAuthFramesPerSecond'),
    pre_auth_connections: integer(settings, 'matchmaker.preAuthConnections'),
    hello_timeout_ms: ms('matchmaker.helloTimeoutMs'),
    room_code_alphabet: text(settings, 'matchmaker.roomCodeAlphabet'),
    room_code_length: integer(settings, 'matchmaker.roomCodeLength'),
    lockstep_max_duration_ms: ms('matchmaker.lockstepMaxDurationMs'),
  };
}

/** The server start failure of the room code settings, or null. */
export function room_code_failure(alphabet: string, length: number): string | null {
  if (alphabet === '') return 'matchmaker: matchmaker.roomCodeAlphabet is empty';
  if (!/^[A-Z0-9]+$/.test(alphabet)) return 'matchmaker: matchmaker.roomCodeAlphabet has a character that is not an ASCII capital letter or digit';
  if (new Set(alphabet).size !== alphabet.length) return 'matchmaker: matchmaker.roomCodeAlphabet has a repeated character';
  if (length < 1) return 'matchmaker: matchmaker.roomCodeLength is less than 1';
  return null;
}

/**
 * g(attempts): the wait before the next apply after `attempts` failed applies. g(1) is
 * `matchmaker.applyRetryInitialMs`; g(a) is the smaller of ⌊g(a − 1) × `applyRetryFactorPermille` ÷ 1000⌋ and
 * `applyRetryMaxIntervalMs`.
 */
export function retry_delay(settings: MatchmakerSettings, attempts: number): bigint {
  let g = settings.apply_retry_initial_ms;
  for (let a = 2; a <= attempts; a += 1) {
    const next = (g * settings.apply_retry_factor_permille) / 1000n;
    g = next < settings.apply_retry_max_interval_ms ? next : settings.apply_retry_max_interval_ms;
  }
  return g;
}

/** `prepare_match_request`: the queue rating (bigint) or a `GameError`. */
export type PrepareMatchRequestHook = (ctx: RequestCtx, mode_id: number, user_ids: readonly bigint[]) => bigint | ErrorCode;
/** `validate_party`: members in room order with the ratings member rating resolution read. */
export type ValidatePartyHook = (
  mode_id: number,
  members: readonly { readonly user_id: bigint; readonly rating: bigint }[],
  request: CoreContract.MatchmakerFrameKind,
) => Pass | ErrorCode;
export type ApplyMatchResultHook = (ctx: RequestCtx, record: MatchRecordInput, index: number, result: Uint8Array) => Pass | ErrorCode;
export type ApplyMatchMismatchHook = (ctx: RequestCtx, record: MatchRecordInput, index: number) => Pass | ErrorCode;
export type ReplayMatchHook = (
  record: MatchRecordInput,
  input_log: Uint8Array,
  random: Random,
  data: GameData.DataSet,
  data_version: string,
) => Uint8Array | 'reject';

/** The member `hook_slots`: `routing` puts the registered hooks in after `register`. */
export interface HookSlots {
  prepare_match_request: PrepareMatchRequestHook | null;
  validate_party: ValidatePartyHook | null;
  apply_match_result: ApplyMatchResultHook | null;
  apply_match_mismatch: ApplyMatchMismatchHook | null;
  replay_match: ReplayMatchHook | null;
}

export interface Env {
  readonly settings: MatchmakerSettings;
  readonly server: MatchmakerServer;
  readonly storage: MatchmakerStorage;
  readonly server_time: MatchmakerServerTime;
  readonly logging: MatchmakerLogging;
  readonly auth: MatchmakerAuth;
  readonly session: MatchmakerSession;
  readonly admin: MatchmakerAdminApi;
  readonly p2p: MatchmakerP2pSignaling;
  readonly validation: MatchmakerValidation;
  readonly game_update: MatchmakerGameUpdate;
  readonly block_report: MatchmakerBlockReport | null;
  readonly rating: MatchmakerRating | null;
  readonly hooks: HookSlots;
  /** True once the server instance stopped. */
  stopped(): boolean;
}

/** An `error` log line of matchmaker. */
export function log_error(env: Env, message: string, fields: LogFields, user_id: bigint | null = null, ctx: RequestCtx | null = null): void {
  env.logging.write({
    kind: 'error',
    level: 'error',
    message,
    user_id: ctx?.user_id ?? user_id,
    request_id: ctx !== null && ctx.request_id !== '' ? ctx.request_id : null,
    request: ctx !== null && ctx.request_name !== '' ? ctx.request_name : null,
    fields: { module: 'matchmaker', ...fields },
  });
}

/** A `security` log line of a `/realtime` connection; `logging` truncates the IP. */
export function log_security(env: Env, reason: string, ip: string, user_id: bigint | null): void {
  env.logging.write({
    kind: 'security',
    level: 'warn',
    message: `realtime connection refused: ${reason}`,
    user_id,
    request_id: null,
    request: null,
    fields: { ip, reason },
  });
}

/** Whether `admin-api.is_banned` says the user is banned now. */
export function is_banned(env: Env, user_id: bigint): boolean {
  return env.admin.is_banned(user_id).banned;
}

/** The `match_mode` row of a mode ID value, or null. */
export function mode_of(env: Env, mode_id: number): GameData.MatchModeRow | null {
  const table = env.server.data.MatchModeTable;
  return table.has_row(mode_id) ? table.get_row(mode_id) : null;
}

/** The `max_duration` a match of the mode runs for: `matchmaker.lockstepMaxDurationMs` for a lockstep match. */
export function duration_of(env: Env, mode: GameData.MatchModeRow, lockstep: boolean): bigint {
  return lockstep ? env.settings.lockstep_max_duration_ms : mode.max_duration;
}

/** A secure random `int64` from 0 up to but not including 2^63. */
export function new_seed(): bigint {
  return randomBytes(8).readBigUInt64BE(0) & 0x7fff_ffff_ffff_ffffn;
}
