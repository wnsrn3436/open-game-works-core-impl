/** The DEV code of `ranking` (`## DEV`): `close_season_now`. Not in STG·PROD builds. */
import type { RequestCtx } from '../../storage/index.ts';
import { find_board, season_at } from '../board.ts';
import { core_log } from '../core.ts';
import type { Ranking } from '../index.ts';
import { close_pass, new_lease_owner } from '../reward.ts';
import { bump_shift, close_season_row, read_season, SHIFT_TABLE } from '../store.ts';

/** The `## DEV` operations of `ranking` for one server instance. */
export interface RankingDev {
  close_season_now(ctx: RequestCtx, board_id: number): null;
}

/** The DEV operations of the server instance's `ranking`. */
export function create_ranking_dev(ranking: Ranking): RankingDev {
  const core = ranking.dev_core;
  const { storage, time } = core.modules;
  return {
    close_season_now: (ctx, board_id) => {
      const board = find_board(ctx.data, board_id);
      if (board?.cycle == null) {
        core_log(core, 'warn', 'close_season_now: the board has no cycle', { board_id }, ctx);
        return null;
      }
      if (storage.lock_game_row(ctx, SHIFT_TABLE, [board.id]) === 'FAILED') throw new Error('ranking: close_season_now could not lock the season shift row');
      const db = storage.db(ctx);
      const now = time.clock_now();
      const season = season_at(core, board, db, now).season;
      const owner = new_lease_owner();
      close_season_row(db, board.id, season, now, owner, now + core.settings.season_job_lease_ms);
      bump_shift(db, board.id);
      storage.after_commit(ctx, async () => {
        const row = read_season(storage.read_db(), board.id, season);
        if (row?.lease_owner === owner && row.status === 'Closing') await close_pass(core, row, owner);
      });
      return null;
    },
  };
}
