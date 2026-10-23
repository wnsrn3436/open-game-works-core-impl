/**
 * `rating`: the rating of each rating rule of a user, its Elo update from a decided match, its tier, the soft reset
 * when the season of the rule's `ranking` board changes, and the tier season reward by `mailbox`.
 */
import * as CoreContract from '../../generated/contract/core_contract.ts';
import type * as GameData from '../../generated/data/game_data.ts';
import type { Logging, LogValue } from '../logging/index.ts';
import type { Mailbox } from '../mailbox/index.ts';
import type { MatchRecordInput } from '../matchmaker/index.ts';
import type { Ranking } from '../ranking/index.ts';
import type { RequestCtx, Storage } from '../storage/index.ts';
import type { Validation } from '../validation/index.ts';
import { expected_score } from './elo.ts';

/** `once_key` prefix of the season reward mail. */
const ONCE_KEY_PREFIX = 'rating:';

/** The module objects `rating` reads from `modules`. */
interface RatingModules {
  readonly storage: Pick<Storage, 'get_state' | 'list_state' | 'put_core_state'>;
  readonly validation: Pick<Validation, 'floor_div' | 'apply_permille'>;
  readonly ranking: Pick<Ranking, 'get_season'>;
  readonly mailbox: Pick<Mailbox, 'send_mail'>;
  readonly logging: Pick<Logging, 'write'>;
}

/** The fields of the module input `server` (`server-core` `## module`) that `rating` reads. */
export interface RatingServer {
  readonly data: GameData.DataSet;
}

/** The module input (`server-core` `## module`). */
export interface RatingInput {
  readonly settings: Readonly<Record<string, unknown>>;
  readonly modules: Readonly<Record<string, unknown>>;
  readonly server: RatingServer;
}

/** The fields of a `matchmaker` match record input that `rating` reads. */
export type MatchRecord = Pick<MatchRecordInput, 'mode_id' | 'user_ids' | 'ratings' | 'teams'>;

export interface RatingView {
  readonly rating: bigint;
  /** Tier ID value; 0 when no tier. */
  readonly tier_id: number;
  readonly season: bigint;
  readonly season_games: number;
  /** True while `season_games` < `placement_matches`. */
  readonly placement: boolean;
}

export interface RatingChange {
  readonly before: bigint;
  readonly after: bigint;
  readonly tier_before: number;
  readonly tier_after: number;
}

/** `RatingResult` (`## API`). */
export const RatingResult = {
  OK: 'OK',
  NO_RATING: 'NO_RATING',
  INVALID_INPUT: 'INVALID_INPUT',
} as const;
export type RatingResult = (typeof RatingResult)[keyof typeof RatingResult];

/** The output of `apply_match_outcome`: `OK` with the `RatingChange`, or the failure element in `result`. */
export type MatchOutcome =
  | { readonly result: typeof RatingResult.OK; readonly change: RatingChange }
  | { readonly result: typeof RatingResult.NO_RATING | typeof RatingResult.INVALID_INPUT };

/** The operations of `## API` whose caller has content code: the member `content` (`server-core` `## module`). */
export interface RatingContent {
  get_rating(ctx: RequestCtx, rule_id: number): RatingView;
  apply_match_outcome(ctx: RequestCtx, record: MatchRecord, index: number, placements: readonly (number | bigint)[]): MatchOutcome;
}

/** The `rating` module object: the `## API` operations, the lifecycle, a member the DEV code calls and `content`. */
export interface Rating {
  RefreshRating(ctx: RequestCtx, request: CoreContract.RefreshRatingRequest): CoreContract.RefreshRatingResponse;
  get_rating(ctx: RequestCtx, rule_id: number): RatingView;
  apply_match_outcome(ctx: RequestCtx, record: MatchRecord, index: number, placements: readonly (number | bigint)[]): MatchOutcome;
  begin_start(): void;
  complete_start(): string | null;
  stop(): void;
  /** Called by the DEV code only (`dev/index.ts`): writes the settled row with that rating and its tier. */
  write_rating(ctx: RequestCtx, rule_id: number, rating: bigint): void;
  readonly content: RatingContent;
}

/** The season that `### season settle` closed: the season before, its tier and its match count. */
interface Settled {
  readonly season: bigint;
  readonly tier_id: number;
  readonly season_games: number;
}

/** A row read with the season settle applied. */
interface ReadRow {
  readonly row: CoreContract.RatingUserState;
  readonly settled: Settled | null;
}

function required(modules: Readonly<Record<string, unknown>>, name: string): unknown {
  const module = modules[name];
  if (module === undefined || module === null) throw new TypeError(`rating: module ${name} is missing`);
  return module;
}

/** The dependency module objects of the module input. A missing dependency throws. */
function read_modules(modules: Readonly<Record<string, unknown>>): RatingModules {
  return {
    storage: required(modules, 'storage') as RatingModules['storage'],
    validation: required(modules, 'validation') as RatingModules['validation'],
    ranking: required(modules, 'ranking') as RatingModules['ranking'],
    mailbox: required(modules, 'mailbox') as RatingModules['mailbox'],
    logging: required(modules, 'logging') as RatingModules['logging'],
  };
}

/** A core settings value of `## settings`: an integer, or a throw. */
function integer_setting(settings: Readonly<Record<string, unknown>>, key: string): number {
  const value = settings[key];
  if (typeof value !== 'number' || !Number.isInteger(value)) throw new TypeError(`rating: setting ${key} is not an integer`);
  return value;
}

/** The server start failure of `rating`, or null: a `rating_tier` row whose `season_reward` has more items than `mailbox.maxAttachments`. */
function start_failure(data: GameData.DataSet, max_attachments: number): string | null {
  const over = data.RatingTierTable.all_rows().find((row) => row.season_reward.length > max_attachments);
  if (over === undefined) return null;
  return `rating: the season_reward of rating_tier row ${String(over.id)} has ${String(over.season_reward.length)} items, over mailbox.maxAttachments ${String(max_attachments)}`;
}

/** The `rating_tier` rows of each rule, `min_rating` descending. */
function tiers_by_rule(data: GameData.DataSet): Map<number, GameData.RatingTierRow[]> {
  const out = new Map<number, GameData.RatingTierRow[]>();
  for (const row of data.RatingTierTable.all_rows()) {
    const list = out.get(row.rule);
    if (list === undefined) out.set(row.rule, [row]);
    else list.push(row);
  }
  for (const list of out.values()) list.sort((a, b) => (a.min_rating > b.min_rating ? -1 : a.min_rating < b.min_rating ? 1 : 0));
  return out;
}

export function create_rating(input: RatingInput): Rating {
  const { storage, validation, ranking, mailbox, logging } = read_modules(input.modules);
  const max_attachments = integer_setting(input.settings, 'mailbox.maxAttachments');
  const tier_cache = new WeakMap<GameData.DataSet, Map<number, GameData.RatingTierRow[]>>();

  const tiers_of = (data: GameData.DataSet, rule_id: number): readonly GameData.RatingTierRow[] => {
    let cached = tier_cache.get(data);
    if (cached === undefined) {
      cached = tiers_by_rule(data);
      tier_cache.set(data, cached);
    }
    return cached.get(rule_id) ?? [];
  };

  /** The tier ID value of a rating: the row with the largest `min_rating` ≤ rating, or 0. */
  const tier_of = (data: GameData.DataSet, rule_id: number, rating: bigint): number =>
    tiers_of(data, rule_id).find((tier) => tier.min_rating <= rating)?.id ?? 0;

  const rule_of = (ctx: RequestCtx, rule_id: number): GameData.RatingRuleRow => {
    if (!ctx.data.RatingRuleTable.has_row(rule_id)) throw new Error(`rating rule ${String(rule_id)} is not in rating_rule`);
    return ctx.data.RatingRuleTable.get_row(rule_id);
  };

  const current_season = (ctx: RequestCtx, rule: GameData.RatingRuleRow): bigint => {
    if (rule.season_board === 0) return 0n;
    const season = ranking.get_season(ctx, rule.season_board);
    if (season === 'UNKNOWN_BOARD') throw new Error(`season_board ${String(rule.season_board)} of rating rule ${String(rule.id)} is not a ranking board`);
    return season.season;
  };

  /** A stored row (null when none) of the ctx user with `### season settle` to the season applied, without writing it. */
  const settle_row = (ctx: RequestCtx, rule: GameData.RatingRuleRow, stored: CoreContract.RatingUserState | null, season: bigint): ReadRow => {
    const row = new CoreContract.RatingUserState();
    row.id = BigInt(rule.id);
    if (stored === null) {
      row.rating = rule.initial_rating;
      row.tier_id = tier_of(ctx.data, rule.id, row.rating);
      row.season = season;
      return { row, settled: null };
    }
    row.rating = stored.rating;
    row.tier_id = stored.tier_id;
    row.season = stored.season;
    row.season_games = stored.season_games;
    row.total_games = stored.total_games;
    if (stored.season === season) return { row, settled: null };
    const settled: Settled = { season: stored.season, tier_id: tier_of(ctx.data, rule.id, stored.rating), season_games: stored.season_games };
    const scaled = validation.apply_permille(stored.rating - rule.soft_reset_target, BigInt(rule.soft_reset_permille));
    if (!scaled.success) throw new Error(`soft reset of rating rule ${String(rule.id)} overflows int64`);
    const reset = rule.soft_reset_target + scaled.value;
    row.rating = reset < rule.min_rating ? rule.min_rating : reset;
    row.season = season;
    row.season_games = 0;
    row.tier_id = tier_of(ctx.data, rule.id, row.rating);
    return { row, settled };
  };

  /** The row of the ctx user with `### season settle` applied, without writing it. */
  const read_row = (ctx: RequestCtx, rule: GameData.RatingRuleRow): ReadRow => {
    const stored = storage.get_state(ctx, CoreContract.RatingUserState, BigInt(rule.id)) as CoreContract.RatingUserState | null;
    return settle_row(ctx, rule, stored, current_season(ctx, rule));
  };

  /** Sends the season reward of a settled season (`### season settle`). */
  const send_season_reward = (ctx: RequestCtx, rule: GameData.RatingRuleRow, settled: Settled): void => {
    if (settled.tier_id === 0 || settled.season_games < rule.reward_min_games) return;
    const reward = ctx.data.RatingTierTable.get_row(settled.tier_id).season_reward;
    if (reward.length === 0) return;
    const sent = mailbox.send_mail(ctx, {
      template_id: rule.reward_mail,
      args: [{ name: 'season', int_value: settled.season }],
      attachments: reward,
      extra_id: 0,
      expire_ms: 0n,
      no_expiry: false,
      once_key: `${ONCE_KEY_PREFIX}${String(rule.id)}:${String(settled.season)}`,
    });
    if (sent.result === 'OK' || sent.result === 'ALREADY_SENT') return;
    throw new Error(`season reward mail of rating rule ${String(rule.id)} season ${String(settled.season)} failed: ${sent.result}`);
  };

  /** Writes a row read by `read_row`; a settled season sends its reward first. */
  const write_row = (ctx: RequestCtx, rule: GameData.RatingRuleRow, read: ReadRow): void => {
    if (read.settled !== null) send_season_reward(ctx, rule, read.settled);
    storage.put_core_state(ctx, read.row);
  };

  const log_error = (ctx: RequestCtx, message: string, fields: Record<string, LogValue>): void => {
    logging.write({
      kind: 'error',
      level: 'error',
      message,
      user_id: ctx.user_id,
      request_id: ctx.request_id === '' ? null : ctx.request_id,
      request: ctx.request_name === '' ? null : ctx.request_name,
      fields: { ...fields, stack_trace: null },
    });
  };

  const is_valid_input = (ctx: RequestCtx, record: MatchRecord, index: number, placements: readonly (bigint | number)[]): boolean => {
    const count = record.user_ids.length;
    if (!Number.isInteger(index) || index < 0 || index >= count) return false;
    if (record.user_ids[index] !== ctx.user_id) return false;
    if (placements.length !== count) return false;
    return placements.every((p) => (typeof p === 'bigint' ? p >= 0n : Number.isInteger(p) && p >= 0));
  };

  const apply_match_outcome = (ctx: RequestCtx, record: MatchRecord, index: number, placements: readonly (bigint | number)[]): MatchOutcome => {
    if (!is_valid_input(ctx, record, index, placements)) {
      log_error(ctx, 'rating match outcome input is invalid', { mode_id: record.mode_id, index, players: record.user_ids.length, placements: placements.length });
      return { result: RatingResult.INVALID_INPUT };
    }
    const mode = ctx.data.MatchModeTable.get_row(record.mode_id);
    if (mode.rating_rule === 0) {
      log_error(ctx, 'rating match outcome for a match mode without a rating rule', { mode_id: record.mode_id });
      return { result: RatingResult.NO_RATING };
    }
    const rule = rule_of(ctx, mode.rating_rule);
    const read = read_row(ctx, rule);
    const before = read.row.rating;
    const tier_before = read.row.tier_id;
    const team = BigInt(record.teams[index] ?? 0);
    const opponents = record.user_ids
      .map((_, j) => j)
      .filter((j) => j !== index && (mode.team_size === 0 || BigInt(record.teams[j] ?? 0) !== team));
    const m = BigInt(opponents.length);
    if (m > 0n) {
      const mine = BigInt(placements[index] ?? 0);
      const rating_i = BigInt(record.ratings[index] ?? 0);
      let sum = 0n;
      for (const j of opponents) {
        const theirs = BigInt(placements[j] ?? 0);
        const score = mine < theirs ? 1000n : mine === theirs ? 500n : 0n;
        sum += score - expected_score(rating_i, BigInt(record.ratings[j] ?? 0), rule.scale);
      }
      const k = BigInt(read.row.season_games < rule.placement_matches ? rule.placement_k_factor : rule.k_factor);
      const delta = validation.floor_div(2n * k * sum + 1000n * m, 2000n * m);
      const after = read.row.rating + delta;
      read.row.rating = after < rule.min_rating ? rule.min_rating : after;
    }
    read.row.season_games += 1;
    read.row.total_games += 1;
    read.row.tier_id = tier_of(ctx.data, rule.id, read.row.rating);
    write_row(ctx, rule, read);
    return { result: RatingResult.OK, change: { before, after: read.row.rating, tier_before, tier_after: read.row.tier_id } };
  };

  const get_rating = (ctx: RequestCtx, rule_id: number): RatingView => {
    const rule = rule_of(ctx, rule_id);
    const { row } = read_row(ctx, rule);
    return {
      rating: row.rating,
      tier_id: row.tier_id,
      season: row.season,
      season_games: row.season_games,
      placement: row.season_games < rule.placement_matches,
    };
  };

  return {
    RefreshRating(ctx) {
      const rows = storage.list_state(ctx, CoreContract.RatingUserState) as CoreContract.RatingUserState[];
      // Rules of one `season_board` share its season: read it once.
      const seasons = new Map<number, bigint>();
      for (const stored of rows) {
        const rule_id = Number(stored.id);
        if (!ctx.data.RatingRuleTable.has_row(rule_id)) continue;
        const rule = ctx.data.RatingRuleTable.get_row(rule_id);
        let season = seasons.get(rule.season_board);
        if (season === undefined) {
          season = current_season(ctx, rule);
          seasons.set(rule.season_board, season);
        }
        const read = settle_row(ctx, rule, stored, season);
        if (read.settled !== null) write_row(ctx, rule, read);
      }
      return new CoreContract.RefreshRatingResponse();
    },
    get_rating,
    apply_match_outcome,
    begin_start() {},
    complete_start() {
      return start_failure(input.server.data, max_attachments);
    },
    stop() {},
    write_rating(ctx, rule_id, rating) {
      const rule = rule_of(ctx, rule_id);
      const read = read_row(ctx, rule);
      read.row.rating = rating;
      read.row.tier_id = tier_of(ctx.data, rule.id, rating);
      write_row(ctx, rule, read);
    },
    content: { get_rating, apply_match_outcome },
  };
}
