/**
 * The operations of other modules that matchmaker calls, as structural types from their spec `## API` rows.
 * `storage`, `server-time` and `logging` are the merged modules' own types.
 */
import type * as CoreContract from '../../generated/contract/core_contract.ts';
import type * as GameData from '../../generated/data/game_data.ts';
import type { Logging } from '../logging/index.ts';
import type { ServerTimeApi } from '../server-time/index.ts';
import type { RequestCtx, Storage } from '../storage/index.ts';

export type Pass = 'pass';
/** A `CoreError` or `GameError` value of the generated code. */
export type ErrorCode = number;

/** `auth.verify_access_token`: `(user ID, session ID)`, or `UNAUTHORIZED`, `TOKEN_EXPIRED`. */
export interface MatchmakerAuth {
  verify_access_token(token: string): { readonly user_id: bigint; readonly session_id: string } | ErrorCode;
}

/** `session.check_current`: `pass`, `UNAUTHORIZED` or `SESSION_REPLACED`. */
export interface MatchmakerSession {
  check_current(user_id: bigint, session_id: string): Pass | ErrorCode;
}

/** The ban result of `admin-api.is_banned`: whether the user is banned, and the ban's `until_at` when banned. */
export interface BanResult {
  readonly banned: boolean;
  readonly until_at: bigint;
}

export interface MatchmakerAdminApi {
  is_maintenance(): boolean;
  is_banned(user_id: bigint): BanResult;
  is_kill_switched(name: string): boolean;
}

/** `validation.validate_message`: `pass`, or the field path and rule of the failure. */
export interface MatchmakerValidation {
  validate_message(message_name: string, message: unknown): Pass | CoreContract.ValidationFailure;
}

export interface MatchmakerGameUpdate {
  is_data_update_ready(app_version: string): boolean;
}

/** The authenticated `/realtime` WebSocket matchmaker passes to `p2p-signaling`: user, frame sending, closing. */
export interface Connection {
  readonly user_id: bigint;
  send(frame: CoreContract.MatchmakerFrame): void;
  close(): void;
}

/** A participant change of `p2p-signaling`. */
export interface ParticipantChange {
  readonly match_id: string;
  readonly index: number;
  readonly kind: 'LEFT' | 'DISCONNECTED' | 'REJOINED';
}

export interface MatchmakerP2pSignaling {
  prepare_transport(match_id: string, start_at: bigint, max_duration: bigint): Promise<CoreContract.Transport>;
  open_match_session(
    match_id: string,
    players: readonly CoreContract.MatchPlayer[],
    connections: readonly Connection[],
    transport: CoreContract.Transport,
    expires_at: bigint,
  ): readonly ParticipantChange[];
  handle_frame(connection: Connection, frame: CoreContract.MatchmakerFrame): ParticipantChange | null;
  connection_closed(connection: Connection): ParticipantChange | null;
}

/** `block-report.list_blocked_ids`: the user IDs the user blocked, ascending. */
export interface MatchmakerBlockReport {
  list_blocked_ids(ctx: RequestCtx, user_id: bigint): readonly bigint[];
}

/** `rating.get_rating`: `RatingView`; matchmaker reads `rating`. */
export interface MatchmakerRating {
  get_rating(ctx: RequestCtx, rule_id: number): { readonly rating: bigint };
}

export type MatchmakerStorage = Pick<
  Storage,
  | 'register_table'
  | 'run_rollback_transaction'
  | 'run_user_transaction'
  | 'run_game_transaction'
  | 'run_savepoint'
  | 'with_hook_change_source'
  | 'check_hook_output'
  | 'lock_game_row'
  | 'after_commit'
  | 'db'
  | 'read_db'
  | 'create_random'
  | 'make_purpose_seed'
>;

export type MatchmakerServerTime = Pick<ServerTimeApi, 'clock_now' | 'schedule_job' | 'network_time_limit'>;

export type MatchmakerLogging = Pick<Logging, 'write'>;

/** The fields of the module input `server` (`server-core` `## module`) that matchmaker reads. */
export interface MatchmakerServer {
  readonly env: string;
  readonly dev: boolean;
  readonly matchmaker: boolean;
  readonly server_modules: readonly string[];
  readonly data: GameData.DataSet;
  readonly data_version: string;
  readonly client_data_version: string;
  readonly compat_client_data_version: string | null;
}
