/**
 * ranking: data-defined ranking boards of user and guild scores, rank queries, and season rewards by mail.
 */
import type * as CoreContract from '../../generated/contract/core_contract.ts';
import type * as GameData from '../../generated/data/game_data.ts';
import type { RequestCtx } from '../storage/index.ts';
import { all_boards } from './board.ts';
import { read_settings, type RankingCore, type RankingHookSlots, type RankingResult } from './core.ts';
import { read_modules } from './deps.ts';
import { get_my_entry, get_ranking_around, get_ranking_top, get_season } from './query.ts';
import { JOB_NAME, run_season_job } from './reward.ts';
import { submit_guild_score, submit_score, update_display } from './score.ts';
import { delete_guild_rows, delete_user_rows, register_tables } from './store.ts';

export type { RankingResult, RankingHookSlots, SeasonReward, SeasonRewardHook } from './core.ts';
export type * from './deps.ts';

type CoreErrorValue = (typeof CoreContract.CoreError)[keyof typeof CoreContract.CoreError];

/** The fields of the module input `server` (`server-core` `## module`) that `ranking` reads. */
export interface RankingServer {
  readonly data: GameData.DataSet;
  readonly server_modules: readonly string[];
}

/** The module input (`server-core` `## module`). */
export interface RankingInput {
  readonly settings: Readonly<Record<string, unknown>>;
  readonly modules: Readonly<Record<string, unknown>>;
  readonly server: RankingServer;
}

/** The `ranking` module object: the `## API` operations, the core rpc handlers, the hook slots and the lifecycle. */
export interface Ranking {
  submit_score(ctx: RequestCtx, board_id: number, score: bigint, display: string): RankingResult;
  submit_guild_score(ctx: RequestCtx, board_id: number, guild_id: bigint, score: bigint): RankingResult;
  update_display(ctx: RequestCtx, display: string): 'OK' | 'INVALID_DISPLAY';
  get_my_entry(ctx: RequestCtx, board_id: number): CoreContract.RankingEntry;
  get_season(ctx: RequestCtx, board_id: number): { season: bigint; season_ends_at: bigint } | 'UNKNOWN_BOARD';
  GetRankingTop(ctx: RequestCtx, request: CoreContract.GetRankingTopRequest): CoreContract.GetRankingTopResponse | CoreErrorValue;
  GetRankingAround(ctx: RequestCtx, request: CoreContract.GetRankingAroundRequest): CoreContract.GetRankingAroundResponse | CoreErrorValue;
  remove_user(ctx: RequestCtx): null;
  readonly hook_slots: RankingHookSlots;
  begin_start(): void;
  complete_start(): string | null;
  stop(): void;
  /** For the DEV code (`dev/index.ts`) only. */
  readonly dev_core: RankingCore;
}

/**
 * The server start failure of `ranking`, or null: a guild board without `guild` in the server module list, or a
 * `ranking_reward` row whose `reward` has more items than `mailbox.maxAttachments`.
 */
function start_failure(core: RankingCore): string | null {
  const failure = all_boards(core.data).some((board) => board.guild) && !core.server_modules.includes('guild') ? 'ranking: ranking_board has a guild board but guild is not a server module' : null;
  if (failure !== null) return failure;
  const limit = core.settings.max_attachments;
  const over = core.data.RankingRewardTable.all_rows().find((row) => row.reward.length > limit);
  if (over === undefined) return null;
  const name = `ranking_reward row of board ${String(over.id)} ranks ${String(over.rank_from)}-${String(over.rank_to)}`;
  return `ranking: the reward of the ${name} has ${String(over.reward.length)} items, over mailbox.maxAttachments ${String(limit)}`;
}

/** Makes `ranking` for one server instance. A missing setting or required dependency throws. */
export function create_ranking(input: RankingInput): Ranking {
  const modules = read_modules(input.modules);
  const hook_slots: RankingHookSlots = { ranking_season_reward: null };
  const core: RankingCore = {
    settings: read_settings(input.settings, modules.nickname !== null),
    modules,
    data: input.server.data,
    server_modules: input.server.server_modules,
    hook_slots,
    top_cache: new Map(),
    stopped: false,
  };
  register_tables(modules.storage);
  return {
    submit_score: (ctx, board_id, score, display) => submit_score(core, ctx, board_id, score, display),
    submit_guild_score: (ctx, board_id, guild_id, score) => submit_guild_score(core, ctx, board_id, guild_id, score),
    update_display: (ctx, display) => update_display(core, ctx, display),
    get_my_entry: (ctx, board_id) => get_my_entry(core, ctx, board_id),
    get_season: (ctx, board_id) => get_season(core, ctx, board_id),
    GetRankingTop: (ctx, request) => get_ranking_top(core, ctx, request),
    GetRankingAround: (ctx, request) => get_ranking_around(core, ctx, request),
    remove_user: (ctx) => {
      delete_user_rows(modules.storage.db(ctx), ctx.user_id);
      modules.storage.after_commit(ctx, () => {
        core.top_cache.clear();
      });
      return null;
    },
    hook_slots,
    begin_start: () => {
      modules.time.schedule_job(JOB_NAME, core.settings.season_check_interval_ms, () => run_season_job(core));
      modules.guild?.register_disband_listener((ctx_or_tx, guild_id) => {
        delete_guild_rows(modules.storage.db(ctx_or_tx), guild_id);
      });
    },
    complete_start: () => start_failure(core),
    stop: () => {
      core.stopped = true;
      core.top_cache.clear();
    },
    dev_core: core,
  };
}
