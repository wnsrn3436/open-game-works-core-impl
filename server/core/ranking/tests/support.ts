/**
 * Test support of the `ranking` core tests: test servers through `testing`, a ctx of a user through the module
 * object of `storage` or a `RunCoreTest` request, and readers of the reward mails and of the ranking tables.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import * as CoreContract from '../../../generated/contract/core_contract.ts';
import * as GameContract from '../../../generated/contract/game_contract.ts';
import type { ServerTimeApi } from '../../server-time/index.ts';
import type { RequestCtx, Storage } from '../../storage/index.ts';
import { storage_module } from '../../storage/tests/helpers.ts';
import * as testing from '../../testing/dev/index.ts';
import type { Ranking } from '../index.ts';

export const DAY = 86_400_000n;
export const HOUR = 3_600_000n;

/** Monday 2026-01-05 12:00 UTC. */
export const T0 = BigInt(Date.UTC(2026, 0, 5, 12));

export function at(iso: string): bigint {
  return BigInt(Date.parse(iso));
}

/** Whether a module is not in the server module list of a server core test (every module folder of `server/core/`). */
export function missing(...modules: string[]): boolean {
  return modules.some((m) => !existsSync(new URL(`../../${m}/index.ts`, import.meta.url)) && !existsSync(new URL(`../../${m}/dev/index.ts`, import.meta.url)));
}

/**
 * The content `register` view of the server modules the tests call. In `Harness.core()` its `storage` is the module
 * object of the running server instance: content `register(core)` gets only the member `content`.
 */
export interface CoreView {
  readonly ranking: Ranking;
  readonly storage: Storage;
  readonly 'server-time': ServerTimeApi;
  readonly routing: {
    register_handler(name: string, handler: unknown): void;
    register_hook(module: string, hook: string, fn: unknown): void;
  };
}

/** Server modules of `core-spec/` whose dependency closure reaches none of `modules`. */
export function modules_without(...modules: string[]): string[] {
  const dir = new URL('../../../../core-spec/', import.meta.url);
  const specs = readdirSync(dir).map((f) => JSON.parse(readFileSync(new URL(f, dir), 'utf8')) as { name: string; side: string; dependencies: string[] });
  const server = new Map(specs.filter((s) => s.side === 'server').map((s) => [s.name, s.dependencies]));
  const reaches = (name: string, seen = new Set<string>()): boolean => {
    if (modules.includes(name)) return true;
    if (seen.has(name)) return false;
    seen.add(name);
    return (server.get(name) ?? []).some((d) => reaches(d, seen));
  };
  return [...server.keys()].filter((m) => !reaches(m)).sort();
}

export type TestServer = Awaited<ReturnType<typeof testing.start_test_server>>;
export type TestSession = Awaited<ReturnType<typeof testing.login>>;

export interface Harness {
  readonly server: TestServer;
  /** The `register` view of the running server instance (a restart replaces it; a peer does not). */
  core(): CoreView;
  readonly body: RequestBody;
  /** True while a peer server instance runs `register`. */
  peer_starting: boolean;
}

const loaded = testing.load_data();

/** The ID value of an ID name of the core test data; 0 when the name is not there. */
export function id(name: string): number {
  return loaded.dev.find_id_value(name);
}

/** The guild boards need `guild` rows of the core test data, which are there only when `guild` is a server module. */
export const BOARD = {
  daily: () => id('[rk_daily]'),
  daily_asc: () => id('[rk_daily_asc]'),
  sum: () => id('[rk_sum]'),
  set: () => id('[rk_set]'),
  weekly: () => id('[rk_weekly]'),
  monthly: () => id('[rk_monthly]'),
  event: () => id('[rk_event]'),
  guild_daily: () => id('[rk_guild_daily]'),
  guild_best: () => id('[rk_guild_best]'),
  guild_event: () => id('[rk_guild_event]'),
};

/** What `RunCoreTest` runs inside its request: the function of the test, and what it returned or threw. */
interface RequestBody {
  fn: ((ctx: RequestCtx, ranking: Ranking) => unknown) | null;
  result: unknown;
}

export interface StartOptions {
  readonly start_at?: bigint;
  readonly settings?: Record<string, unknown>;
  /** Called inside `register` after the base registrations. */
  readonly register?: (core: CoreView) => void;
  readonly server_modules?: readonly string[];
}

/** Starts a test server whose `register` keeps the `register` view for the test and runs `RunCoreTest` bodies. */
export async function start(options: StartOptions = {}): Promise<Harness> {
  const kept = { view: null as CoreView | null };
  const body: RequestBody = { fn: null, result: undefined };
  const harness = { body, peer_starting: false };
  const register = (core: Readonly<Record<string, unknown>>): void => {
    const view = core as unknown as CoreView;
    if (!harness.peer_starting) kept.view = view;
    view.routing.register_handler('RunCoreTest', (ctx: RequestCtx) => {
      if (body.fn !== null) body.result = body.fn(ctx, view.ranking);
      return new GameContract.RunCoreTestResponse();
    });
    testing.register_false_judges(core);
    testing.register_required_hooks(core);
    options.register?.(view);
  };
  const server = await testing.start_test_server(
    options.start_at ?? T0,
    undefined,
    undefined,
    undefined,
    undefined,
    { 'ranking.topCacheMs': 10_000, ...(options.settings ?? {}) },
    register,
    undefined,
    options.server_modules,
    undefined,
  );
  return Object.assign(harness, {
    server,
    core: () => {
      if (kept.view === null) throw new Error('register has not run');
      return { ...kept.view, storage: storage_module(server) };
    },
  });
}

/**
 * Calls `stop()` of the `ranking` module object of the test server's running instance (a restart replaces it), as the
 * server stop does before `storage`'s. The module object is routing's `ModuleObject`, whose lifecycle types `stop`.
 */
export function stop_ranking(h: Harness): void {
  const ranking = h.server.running().instance.modules().get('ranking');
  if (ranking?.stop === undefined) throw new Error('the server instance has no ranking module');
  void ranking.stop();
}

/** A peer server instance of the test server; the `register` view stays the test server's. */
export async function start_peer(h: Harness): Promise<TestServer> {
  h.peer_starting = true;
  try {
    return await testing.start_peer_server(h.server);
  } finally {
    h.peer_starting = false;
  }
}

/**
 * Sends `RunCoreTest` as the session's user; `fn` runs inside that request. The value `fn` returned, or the error
 * code of the response.
 */
export async function in_request<T>(h: Harness, session: TestSession, fn: (ctx: RequestCtx, ranking: Ranking) => T, refresh = true): Promise<{ value: T } | { code: number }> {
  h.body.fn = fn;
  h.body.result = undefined;
  try {
    const { envelope } = await testing.send(refresh ? await fresh(session) : session, 'RunCoreTest', new GameContract.RunCoreTestRequest());
    if (envelope.error !== null) return { code: envelope.error.code };
    return { value: h.body.result as T };
  } finally {
    h.body.fn = null;
  }
}

/** Runs `fn` with a ctx of the user in one out-of-request change that commits, and returns its value. */
export async function as_user<T>(h: Harness, user_id: bigint, fn: (ctx: RequestCtx, ranking: Ranking) => T): Promise<T> {
  const box: { out: { value: T } | null } = { out: null };
  const result = await h.core().storage.run_user_transaction(user_id, (ctx) => {
    box.out = { value: fn(ctx, h.core().ranking) };
    return 'pass';
  });
  if (result !== 'COMMITTED' || box.out === null) throw new Error(`the user transaction ended with ${result}`);
  return box.out.value;
}

export async function submit(h: Harness, user_id: bigint, board_id: number, score: bigint, display = ''): Promise<string> {
  return as_user(h, user_id, (ctx, ranking) => ranking.submit_score(ctx, board_id, score, display));
}

/** Test sessions of `users`. The tests read only indexes below the count they asked for. */
export type Sessions = readonly TestSession[] & Readonly<Record<0 | 1 | 2 | 3 | 4 | 5 | 6 | 7, TestSession>>;

/** The dev account name of each test session `users` made. */
const account_names = new WeakMap<TestSession, string>();

export async function users(h: Harness, count: number, prefix = 'u'): Promise<Sessions> {
  const out: TestSession[] = [];
  for (let i = 0; i < count; i += 1) {
    const name = `${prefix}${String(i)}`;
    const session = await testing.login(h.server, name);
    account_names.set(session, name);
    out.push(session);
  }
  return out as unknown as Sessions;
}

/** A new test session of the same user: the access token of a session can expire while a test moves the clock. */
export async function fresh(session: TestSession): Promise<TestSession> {
  const name = account_names.get(session);
  if (name === undefined) return session;
  const again = await testing.login(session.server, name);
  account_names.set(again, name);
  return again;
}

/** Sends a core `rpc` on a new session of the user; the response, or a throw with the error code. */
async function query(session: TestSession, name: string, request: Parameters<typeof testing.send>[2]): Promise<{ response: unknown; code: number }> {
  const { envelope, response } = await testing.send(await fresh(session), name, request);
  return { response, code: envelope.error?.code ?? 0 };
}

/** The first element of a list that the test expects to have one. */
export function only<T>(list: readonly T[]): T {
  const first = list[0];
  if (first === undefined) throw new Error('the list is empty');
  return first;
}

export async function top(session: TestSession, board_id: number, offset: number, limit: number, previous = false): Promise<CoreContract.GetRankingTopResponse> {
  const request = Object.assign(new CoreContract.GetRankingTopRequest(), { board_id, offset, limit, previous });
  const { response, code } = await query(session, 'core/GetRankingTop', request);
  if (!(response instanceof CoreContract.GetRankingTopResponse)) throw new Error(`GetRankingTop failed with code ${String(code)}`);
  return response;
}

export async function top_error(session: TestSession, board_id: number, offset: number, limit: number): Promise<number> {
  const request = Object.assign(new CoreContract.GetRankingTopRequest(), { board_id, offset, limit });
  return (await query(session, 'core/GetRankingTop', request)).code;
}

export async function around(session: TestSession, board_id: number, previous = false): Promise<CoreContract.GetRankingAroundResponse> {
  const request = Object.assign(new CoreContract.GetRankingAroundRequest(), { board_id, previous });
  const { response, code } = await query(session, 'core/GetRankingAround', request);
  if (!(response instanceof CoreContract.GetRankingAroundResponse)) throw new Error(`GetRankingAround failed with code ${String(code)}`);
  return response;
}

/** `(user ID, score)` of each entry in order. */
export function scores(entries: readonly CoreContract.RankingEntry[]): [bigint, bigint][] {
  return entries.map((e) => [e.user_id, e.score]);
}

/** The reward mails (`MailUserState` of the reward template) of a user. */
export async function reward_mails(h: Harness, user_id: bigint): Promise<CoreContract.MailUserState[]> {
  const template = id('[mail_ranking_reward_mail]');
  const rows = await testing.read_user_state(h.server, user_id);
  return rows
    .filter((r) => r.kind === 'MailUserState')
    .map((r) => r.value as CoreContract.MailUserState)
    .filter((m) => m.template_id === template);
}

/** `(name, int_value)` of a mail's args. */
export function mail_args(mail: CoreContract.MailUserState): [string, bigint][] {
  return mail.args.map((a) => [a.name, a.int_value]);
}

/** The item amounts of a mail as `(item ID value, amount)`. */
export function attachments(mail: CoreContract.MailUserState): [number, bigint][] {
  return mail.attachments.map((a) => [a.item_id, a.amount]);
}

/** One `ranking_season` row, read through `storage.read_db`. */
export function season_row(h: Harness, board_id: number, season: bigint): Record<string, unknown> | null {
  return h.core().storage.read_db().query('SELECT * FROM ranking_season WHERE board_id = $1 AND season = $2', [board_id, season])[0] ?? null;
}

export function retry_rows(h: Harness, board_id: number, season: bigint): Record<string, unknown>[] {
  return h.core().storage.read_db().query('SELECT * FROM ranking_reward_retry WHERE board_id = $1 AND season = $2 ORDER BY user_id', [board_id, season]);
}

export function count_rows(h: Harness, table: string, board_id: number, season: bigint): number {
  const row = h.core().storage.read_db().query(`SELECT COUNT(*) AS n FROM ${table} WHERE board_id = $1 AND season = $2`, [board_id, season])[0];
  return Number(row?.n ?? 0);
}

/** The season of a board now, through `get_season`. */
export async function season_now(h: Harness, user_id: bigint, board_id: number): Promise<{ season: bigint; season_ends_at: bigint }> {
  const s = await as_user(h, user_id, (ctx, ranking) => ranking.get_season(ctx, board_id));
  if (s === 'UNKNOWN_BOARD') throw new Error('unknown board');
  return s;
}

/** Moves the clock to `time`, then waits for the jobs and out-of-request changes it started. */
export async function move_to(h: Harness, time: bigint): Promise<void> {
  testing.set_time(h.server, time);
  await testing.wait_background(h.server);
}

export { testing };

export async function submit_guild(h: Harness, user_id: bigint, board_id: number, guild_id: bigint, score: bigint): Promise<string> {
  return as_user(h, user_id, (ctx, ranking) => ranking.submit_guild_score(ctx, board_id, guild_id, score));
}

/** `CreateGuild` of an `Open` guild; the new guild ID. */
export async function create_guild(session: TestSession, name: string): Promise<bigint> {
  const request = Object.assign(new CoreContract.CreateGuildRequest(), { name, description: '', join_type: CoreContract.GuildJoinType.GUILD_JOIN_TYPE_OPEN, join_value: 0n });
  const { response } = await testing.send(session, 'core/CreateGuild', request);
  if (response === null) throw new Error('CreateGuild failed');
  return (response as CoreContract.CreateGuildResponse).guild_id;
}

export async function join_guild(session: TestSession, guild_id: bigint): Promise<void> {
  const { response } = await testing.send(session, 'core/JoinGuild', Object.assign(new CoreContract.JoinGuildRequest(), { guild_id }));
  if (response === null) throw new Error('JoinGuild failed');
}

export async function leave_guild(session: TestSession): Promise<void> {
  const { response } = await testing.send(await fresh(session), 'core/LeaveGuild', new CoreContract.LeaveGuildRequest());
  if (response === null) throw new Error('LeaveGuild failed');
}
