/**
 * matchmaker: takes realtime matching connections on `GET /realtime`, groups waiting users and parties or room
 * members into matches, decides the match results participants report, and applies them to each participant's
 * saved state through the apply hooks.
 */
import type * as CoreContract from '../../generated/contract/core_contract.ts';
import * as GameData from '../../generated/data/game_data.ts';
import type { RequestCtx } from '../storage/index.ts';
import type {
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
} from './deps.ts';
import { create_realtime, type RouteRequest, type RouteResponse } from './realtime.ts';
import { register_tables, type MatchRecord } from './records.ts';
import { create_results } from './results.ts';
import { duration_of, read_settings, room_code_failure, type Env, type HookSlots } from './shared.ts';

export type { Connection, ParticipantChange } from './deps.ts';
export type { MatchRecordInput, MatchSource } from './records.ts';
export type { RouteRequest, RouteResponse } from './realtime.ts';
export type {
  ApplyMatchMismatchHook,
  ApplyMatchResultHook,
  HookSlots,
  PrepareMatchRequestHook,
  ReplayMatchHook,
  ValidatePartyHook,
} from './shared.ts';

/** The module input (`server-core` `## module`). */
export interface MatchmakerInput {
  readonly settings: Readonly<Record<string, unknown>>;
  readonly modules: Readonly<Record<string, unknown>>;
  readonly server: MatchmakerServer;
}

/** The `matchmaker` module object: the route, the core `rpc` handler, the hook slots and the lifecycle. */
export interface Matchmaker {
  'GET /realtime'(request: RouteRequest, ip: string): RouteResponse | null;
  ReportMatchResult(ctx: RequestCtx, request: CoreContract.ReportMatchResultRequest): CoreContract.ReportMatchResultResponse | number;
  readonly hook_slots: HookSlots;
  begin_start(): void;
  complete_start(): string | null;
  stop(): void;
  /** Called by the DEV code only (`dev/index.ts`): what `create_test_match` reads and saves through. */
  readonly test_match_context: TestMatchContext;
}

/** What the DEV operation `create_test_match` needs of one server instance. */
export interface TestMatchContext {
  readonly data: GameData.DataSet;
  readonly client_data_version: string;
  readonly report_margin_ms: bigint;
  clock_now(): bigint;
  /** The duration of a match of the mode: `max_duration`, or `matchmaker.lockstepMaxDurationMs` for a lockstep match. */
  duration_of(mode: GameData.MatchModeRow, lockstep: boolean): bigint;
  /** Saves a new match record in one game transaction; false when it failed. */
  save(record: MatchRecord): Promise<boolean>;
}

/** The module object of a dependency, checked by one member it must have; a missing one throws. */
function module_of(modules: Readonly<Record<string, unknown>>, name: string, member: string): Record<string, unknown> {
  const module = modules[name] as Record<string, unknown> | undefined;
  if (module === undefined || typeof module[member] !== 'function') throw new TypeError(`matchmaker: modules has no ${name}`);
  return module;
}

/**
 * The module object of an optional dependency, or null when it is not a server module. Read at each use: an optional
 * dependency made after `matchmaker` (`rating` depends on `matchmaker`) is in `modules` only once the server made it.
 */
function optional_module(modules: Readonly<Record<string, unknown>>, name: string, member: string): Record<string, unknown> | null {
  return modules[name] === undefined ? null : module_of(modules, name, member);
}

/** The server start failures of the `match_mode` rows and the settings matchmaker checks itself. */
function start_failure(env: Env): string | null {
  const room_code = room_code_failure(env.settings.room_code_alphabet, env.settings.room_code_length);
  if (room_code !== null) return room_code;
  const rows = env.server.data.MatchModeTable.all_rows();
  if (rows.some((r) => r.result_rule === GameData.MatchResultRule.ServerReplay) && env.hooks.replay_match === null) {
    return 'matchmaker: a match_mode row has result_rule ServerReplay and replay_match is not registered';
  }
  const over = rows.find((r) => r.max_players > env.settings.max_players);
  if (over !== undefined) return `matchmaker: match_mode ${String(over.id)} max_players ${String(over.max_players)} is over matchmaker.maxPlayers`;
  if (rows.some((r) => r.rating_rule !== 0) && !env.server.server_modules.includes('rating')) {
    return 'matchmaker: a match_mode row has a rating_rule and rating is not a server module';
  }
  return null;
}

/** Makes `matchmaker` for one server instance. A missing setting or dependency throws. */
export function create_matchmaker(input: MatchmakerInput): Matchmaker {
  const modules = input.modules;
  const hooks: HookSlots = { prepare_match_request: null, validate_party: null, apply_match_result: null, apply_match_mismatch: null, replay_match: null };
  let stopped = false;
  const env: Env = {
    settings: read_settings(input.settings),
    server: input.server,
    storage: module_of(modules, 'storage', 'run_game_transaction') as unknown as MatchmakerStorage,
    server_time: module_of(modules, 'server-time', 'clock_now') as unknown as MatchmakerServerTime,
    logging: module_of(modules, 'logging', 'write') as unknown as MatchmakerLogging,
    auth: module_of(modules, 'auth', 'verify_access_token') as unknown as MatchmakerAuth,
    session: module_of(modules, 'session', 'check_current') as unknown as MatchmakerSession,
    admin: module_of(modules, 'admin-api', 'is_maintenance') as unknown as MatchmakerAdminApi,
    p2p: module_of(modules, 'p2p-signaling', 'open_match_session') as unknown as MatchmakerP2pSignaling,
    validation: module_of(modules, 'validation', 'validate_message') as unknown as MatchmakerValidation,
    game_update: module_of(modules, 'game-update', 'is_data_update_ready') as unknown as MatchmakerGameUpdate,
    get block_report() {
      return optional_module(modules, 'block-report', 'list_blocked_ids') as unknown as MatchmakerBlockReport | null;
    },
    get rating() {
      return optional_module(modules, 'rating', 'get_rating') as unknown as MatchmakerRating | null;
    },
    hooks,
    stopped: () => stopped,
  };
  const results = create_results(env);
  const realtime = create_realtime(env, results);

  return {
    'GET /realtime': (request, ip) => realtime.route(request, ip),
    ReportMatchResult: (ctx, request) => results.report(ctx, request),
    hook_slots: hooks,
    begin_start() {
      register_tables(env.storage);
      if (!env.server.matchmaker) return;
      env.server_time.schedule_job('matchmaker_tick', env.settings.tick_ms, () => realtime.tick());
      env.server_time.schedule_job('matchmaker_sweep', env.settings.sweep_interval_ms, () => results.sweep());
    },
    complete_start: () => start_failure(env),
    stop() {
      stopped = true;
      realtime.stop();
    },
    test_match_context: {
      data: env.server.data,
      client_data_version: env.server.client_data_version,
      report_margin_ms: env.settings.report_margin_ms,
      clock_now: () => env.server_time.clock_now(),
      duration_of: (mode, lockstep) => duration_of(env, mode, lockstep),
      save: (record) => results.create(record),
    },
  };
}
