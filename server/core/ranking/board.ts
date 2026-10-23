import * as GameData from '../../generated/data/game_data.ts';
import type { DbHandle } from '../storage/index.ts';
import type { RankingCore } from './core.ts';
import { read_season_end, read_shift } from './store.ts';

/** One `ranking_board` row as `ranking` uses it. */
export interface Board {
  readonly id: number;
  readonly guild: boolean;
  /** `sort_direction` `Desc`: a larger score is better. */
  readonly desc: boolean;
  readonly update_mode: GameData.RankingUpdateMode;
  /** `cycle`, null when the cell is null. */
  readonly cycle: GameData.ResetCycle | null;
  /** `live_event` ID value, 0 when the cell is null. */
  readonly live_event: number;
  readonly size: number;
  /** `reward_mail` ID value, 0 when the cell is null. */
  readonly reward_mail: number;
}

/** A season number and its end time (`season` of `## behavior`). */
export interface Season {
  readonly season: bigint;
  readonly ends_at: bigint;
}

const ENDLESS: Season = { season: 0n, ends_at: 0n };

export function find_board(data: GameData.DataSet, board_id: number): Board | null {
  const table = data.RankingBoardTable;
  if (!Number.isInteger(board_id) || !table.has_row(board_id)) return null;
  const row = table.get_row(board_id);
  return {
    id: row.id,
    guild: row.entity === GameData.RankingEntity.Guild,
    desc: row.sort_direction !== GameData.RankingOrder.Asc,
    update_mode: row.update_mode,
    cycle: row.cycle === GameData.ResetCycle.None ? null : row.cycle,
    live_event: row.live_event,
    size: row.size,
    reward_mail: row.reward_mail,
  };
}

export function all_boards(data: GameData.DataSet): Board[] {
  return data.RankingBoardTable.all_rows().flatMap((row) => find_board(data, row.id) ?? []);
}

/** A board whose season ends: it has `cycle` or `live_event`. */
export function has_seasons(board: Board): boolean {
  return board.cycle !== null || board.live_event !== 0;
}

export function is_event_board(board: Board): boolean {
  return board.live_event !== 0;
}

/** The season of time `t` (`season` of `## behavior`). The season shift is read with `db`. */
export function season_at(core: RankingCore, board: Board, db: DbHandle, t: bigint): Season {
  const time = core.modules.time;
  if (board.cycle !== null) {
    return { season: time.get_period_number(board.cycle, t) + read_shift(db, board.id), ends_at: time.get_next_reset(board.cycle, t) };
  }
  if (board.live_event !== 0) {
    const round = core.modules.live_event.get_latest_round(board.live_event, t);
    return { season: BigInt(round.round), ends_at: round.end_at };
  }
  return ENDLESS;
}

/** An event board takes a score only while the round of its season is active (`SEASON_CLOSED`). */
export function is_closed_for_submit(board: Board, season: Season, t: bigint): boolean {
  return is_event_board(board) && (season.season === 0n || t >= season.ends_at);
}

/**
 * The season before the season of `t`, or null when there is none (a board without seasons, an event board before
 * its second round). Its end time is its `ranking_season` row's `end_at`, or else the cycle period start (cycle
 * board) or 0 (event board).
 */
export function previous_season(core: RankingCore, board: Board, db: DbHandle, t: bigint): Season | null {
  if (!has_seasons(board)) return null;
  const current = season_at(core, board, db, t);
  const season = current.season - 1n;
  if (is_event_board(board) && season < 1n) return null;
  const end = read_season_end(db, board.id, season);
  if (end !== null) return { season, ends_at: end };
  return { season, ends_at: board.cycle !== null ? core.modules.time.get_period_start(board.cycle, t) : 0n };
}
