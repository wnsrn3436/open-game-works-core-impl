import type * as CoreContract from '../../generated/contract/core_contract.ts';
import type * as GameData from '../../generated/data/game_data.ts';
import type { RequestCtx } from '../storage/index.ts';
import type { RankingModules } from './deps.ts';

/** `RankingResult` (`## API`). */
export type RankingResult = 'OK' | 'UNKNOWN_BOARD' | 'OUT_OF_RANGE' | 'INVALID_DISPLAY' | 'ENTITY_MISMATCH' | 'UNKNOWN_GUILD' | 'SEASON_CLOSED';

/** The output of hook `ranking_season_reward`. An empty list and 0 is no reward. */
export interface SeasonReward {
  readonly attachments: readonly CoreContract.ItemAmount[];
  readonly extra_id: number;
}

/** Hook `ranking_season_reward`: ctx of the rewarded user, board ID value, season, season end, entry. */
export type SeasonRewardHook = (ctx: RequestCtx, board_id: number, season: bigint, season_end_at: bigint, entry: CoreContract.RankingEntry) => SeasonReward;

/** The hook slots `routing` fills after content `register`. */
export interface RankingHookSlots {
  ranking_season_reward: SeasonRewardHook | null;
}

/** The core settings values of `## settings`. */
export interface RankingSettings {
  readonly max_page_size: number;
  readonly around_count: number;
  readonly top_cache_ms: bigint;
  readonly max_display_bytes: number;
  readonly season_check_interval_ms: bigint;
  readonly season_job_lease_ms: bigint;
  readonly reward_retry_initial_ms: bigint;
  readonly reward_retry_factor_permille: bigint;
  readonly reward_retry_max_interval_ms: bigint;
  readonly reward_retry_max_attempts: number;
  readonly season_retention_ms: bigint;
  readonly max_attachments: number;
  /** `nickname.maxLookupCount`; 0 when `nickname` is not a server module. */
  readonly nickname_lookup_count: number;
}

/** One cached `GetRankingTop` result. */
export interface TopCacheEntry {
  readonly entries: readonly CoreContract.RankingEntry[];
  readonly expires_at: bigint;
}

/** The state of one server instance's `ranking`. */
export interface RankingCore {
  readonly settings: RankingSettings;
  readonly modules: RankingModules;
  readonly data: GameData.DataSet;
  readonly server_modules: readonly string[];
  readonly hook_slots: RankingHookSlots;
  /** `GetRankingTop` results by `(board, season, offset, limit)`. Process memory. */
  readonly top_cache: Map<string, TopCacheEntry>;
  stopped: boolean;
}

/** −(2^53−1) ≤ score ≤ 2^53−1. */
export const SCORE_LIMIT = 2n ** 53n - 1n;

export function in_score_range(value: bigint): boolean {
  return value >= -SCORE_LIMIT && value <= SCORE_LIMIT;
}

function integer(settings: Readonly<Record<string, unknown>>, key: string): number {
  const value = settings[key];
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) throw new TypeError(`ranking: setting ${key} is not an integer`);
  return value;
}

/** Reads `## settings`. `nickname.maxLookupCount` is read only when `nickname` is a server module. */
export function read_settings(settings: Readonly<Record<string, unknown>>, has_nickname: boolean): RankingSettings {
  return {
    max_page_size: integer(settings, 'ranking.maxPageSize'),
    around_count: integer(settings, 'ranking.aroundCount'),
    top_cache_ms: BigInt(integer(settings, 'ranking.topCacheMs')),
    max_display_bytes: integer(settings, 'ranking.maxDisplayBytes'),
    season_check_interval_ms: BigInt(integer(settings, 'ranking.seasonCheckIntervalMs')),
    season_job_lease_ms: BigInt(integer(settings, 'ranking.seasonJobLeaseMs')),
    reward_retry_initial_ms: BigInt(integer(settings, 'ranking.rewardRetryInitialMs')),
    reward_retry_factor_permille: BigInt(integer(settings, 'ranking.rewardRetryFactorPermille')),
    reward_retry_max_interval_ms: BigInt(integer(settings, 'ranking.rewardRetryMaxIntervalMs')),
    reward_retry_max_attempts: integer(settings, 'ranking.rewardRetryMaxAttempts'),
    season_retention_ms: BigInt(integer(settings, 'ranking.seasonRetentionMs')),
    max_attachments: integer(settings, 'mailbox.maxAttachments'),
    nickname_lookup_count: has_nickname ? integer(settings, 'nickname.maxLookupCount') : 0,
  };
}

/** A `core` (or `error`) log line of `ranking`. */
export function core_log(
  core: RankingCore,
  level: 'info' | 'warn' | 'error',
  message: string,
  fields: Readonly<Record<string, bigint | number | string | boolean | null>>,
  ctx: RequestCtx | null = null,
): void {
  const common = {
    level,
    message,
    user_id: ctx?.user_id ?? null,
    request_id: ctx === null || ctx.request_id === '' ? null : ctx.request_id,
    request: ctx === null || ctx.request_name === '' ? null : ctx.request_name,
  };
  if (level === 'error') core.modules.logging.write({ kind: 'error', ...common, fields: { ...fields, stack_trace: null } });
  else core.modules.logging.write({ kind: 'core', ...common, fields: { ...fields, module: 'ranking' } });
}
