/** `submit_score`, `submit_guild_score`, `update_display` (`## behavior` score and guild board). */
import * as GameData from '../../generated/data/game_data.ts';
import type { DbHandle, RequestCtx } from '../storage/index.ts';
import { all_boards, find_board, has_seasons, is_closed_for_submit, season_at, type Board, type Season } from './board.ts';
import { core_log, in_score_range, type RankingCore, type RankingResult } from './core.ts';
import { insert_open_season, read_score, write_display, write_score, type ScoreRow } from './store.ts';

const CONTROL = /\p{Cc}/u;
const encoder = new TextEncoder();

/** A display is at most `ranking.maxDisplayBytes` UTF-8 bytes and has no control character. */
export function is_valid_display(display: unknown, max_bytes: number): display is string {
  return typeof display === 'string' && encoder.encode(display).length <= max_bytes && !CONTROL.test(display);
}

/** The score row after one submission, or `OUT_OF_RANGE` when a `Sum` total leaves the score range. */
export function apply_submission(board: Board, before: ScoreRow | null, entity_id: bigint, score: bigint, at: bigint, display: string): ScoreRow | 'OUT_OF_RANGE' {
  if (before === null) return { entity_id, score, reached_at: at, display };
  switch (board.update_mode) {
    case GameData.RankingUpdateMode.Sum: {
      const total = before.score + score;
      return in_score_range(total) ? { entity_id, score: total, reached_at: at, display } : 'OUT_OF_RANGE';
    }
    case GameData.RankingUpdateMode.Set:
      return { entity_id, score, reached_at: at, display };
    default: {
      const better = board.desc ? score > before.score : score < before.score;
      return better ? { entity_id, score, reached_at: at, display } : { ...before, display };
    }
  }
}

interface Target {
  readonly board: Board;
  readonly season: Season;
  readonly at: bigint;
}

/** Steps shared by both submissions: the board, its entity and the season of `clock_now`. */
function target_of(core: RankingCore, ctx: RequestCtx, board_id: number, guild: boolean, operation: string): Target | RankingResult {
  const board = find_board(ctx.data, board_id);
  if (board === null) {
    core_log(core, 'error', `${operation}: unknown board`, { board_id }, ctx);
    return 'UNKNOWN_BOARD';
  }
  if (board.guild !== guild) {
    core_log(core, 'error', `${operation}: the board entity does not match`, { board_id }, ctx);
    return 'ENTITY_MISMATCH';
  }
  const db = core.modules.storage.db(ctx);
  const at = core.modules.time.clock_now();
  const season = season_at(core, board, db, at);
  if (is_closed_for_submit(board, season, at)) return 'SEASON_CLOSED';
  return { board, season, at };
}

function out_of_range(core: RankingCore, ctx: RequestCtx, operation: string, board_id: number, score: bigint): 'OUT_OF_RANGE' {
  core_log(core, 'error', `${operation}: the score is out of range`, { board_id, score }, ctx);
  return 'OUT_OF_RANGE';
}

/** Writes one submission: the score row and, for a board with seasons, the season's `Open` row. */
function store_submission(core: RankingCore, ctx: RequestCtx, db: DbHandle, target: Target, entity_id: bigint, score: bigint, display: string, operation: string): RankingResult {
  const { board, season, at } = target;
  if (!in_score_range(score)) return out_of_range(core, ctx, operation, board.id, score);
  const before = read_score(db, board, board.id, season.season, entity_id);
  const after = apply_submission(board, before, entity_id, score, at, display);
  if (after === 'OUT_OF_RANGE') return out_of_range(core, ctx, operation, board.id, score);
  write_score(db, board, board.id, season.season, after);
  if (has_seasons(board)) insert_open_season(db, board.id, season.season, season.ends_at);
  return 'OK';
}

export function submit_score(core: RankingCore, ctx: RequestCtx, board_id: number, score: bigint, display: string): RankingResult {
  const target = target_of(core, ctx, board_id, false, 'submit_score');
  if (typeof target === 'string') return target;
  if (!is_valid_display(display, core.settings.max_display_bytes)) {
    core_log(core, 'warn', 'submit_score: invalid display', { board_id }, ctx);
    return 'INVALID_DISPLAY';
  }
  return store_submission(core, ctx, core.modules.storage.db(ctx), target, ctx.user_id, score, display, 'submit_score');
}

export function submit_guild_score(core: RankingCore, ctx: RequestCtx, board_id: number, guild_id: bigint, score: bigint): RankingResult {
  const target = target_of(core, ctx, board_id, true, 'submit_guild_score');
  if (typeof target === 'string') return target;
  const guild = core.modules.guild;
  const locked = guild === null ? null : guild.lock_guild(ctx, guild_id);
  if (locked === 'FAILED') throw new Error('ranking: submit_guild_score could not lock the guild row');
  if (locked === null) {
    core_log(core, 'warn', 'submit_guild_score: unknown guild', { board_id, guild_id }, ctx);
    return 'UNKNOWN_GUILD';
  }
  return store_submission(core, ctx, core.modules.storage.db(ctx), target, guild_id, score, '', 'submit_guild_score');
}

export function update_display(core: RankingCore, ctx: RequestCtx, display: string): 'OK' | 'INVALID_DISPLAY' {
  if (!is_valid_display(display, core.settings.max_display_bytes)) {
    core_log(core, 'warn', 'update_display: invalid display', {}, ctx);
    return 'INVALID_DISPLAY';
  }
  const db = core.modules.storage.db(ctx);
  const at = core.modules.time.clock_now();
  for (const board of all_boards(ctx.data)) {
    if (!board.guild) write_display(db, board.id, season_at(core, board, db, at).season, ctx.user_id, display);
  }
  return 'OK';
}
