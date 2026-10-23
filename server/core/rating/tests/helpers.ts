/**
 * Test servers for the `rating` core tests: the module objects the test's `register` receives, transactions of a
 * user, and the core test data rows of `rating` by ID name.
 */
import * as CoreContract from '../../../generated/contract/core_contract.ts';
import * as GameContract from '../../../generated/contract/game_contract.ts';
import type * as GameData from '../../../generated/data/game_data.ts';
import type { Ranking } from '../../ranking/index.ts';
import type { RequestCtx, Storage } from '../../storage/index.ts';
import {
  call_dev,
  load_data,
  login,
  read_logs,
  read_user_state,
  register_false_judges,
  register_required_hooks,
  send,
  start_test_server,
  stop_test_server,
  wait_background,
} from '../../testing/dev/index.ts';
import type { Validation } from '../../validation/index.ts';
import type { MatchRecord, Rating } from '../index.ts';

export type TestServer = Awaited<ReturnType<typeof start_test_server>>;
export type TestSession = Awaited<ReturnType<typeof login>>;

/** A `matchmaker` hook `apply_match_result` as `routing.register_hook` takes it. */
export type ApplyMatchResultHook = (ctx: RequestCtx, record: MatchRecord, index: number, result: Uint8Array) => 'pass' | number;

/** The part of the content `register(core)` view that the tests use. */
export interface RegisterView {
  readonly rating: Rating;
  readonly routing: {
    register_handler(name: string, handler: unknown): void;
    register_hook(module: string, name: string, hook: unknown): void;
  };
}

/** The module objects of the running server instance that the tests call. */
export interface Core {
  readonly storage: Storage;
  readonly rating: Rating;
  readonly validation: Validation;
  readonly ranking: Ranking;
}

export interface Kit {
  readonly server: TestServer;
  /** The module objects of the running server instance. */
  readonly core: Core;
  readonly data: GameData.DataSet;
  /** The ID value of an ID name of the core test data. */
  id(name: string): number;
}

const running: TestServer[] = [];

afterEach(async () => {
  for (const server of running.splice(0)) await stop_test_server(server);
});

/** The module object (not the member `content`) of a module of the test server's running instance. */
function module_object(server: TestServer, name: string): unknown {
  const module = server.running().instance.modules().get(name);
  if (module === undefined) throw new Error(`the server instance has no ${name} module`);
  return module;
}

/**
 * Starts a test server whose `register` registers the `RunCoreTest` handler, the judge hooks of `register_false_judges`
 * and the hooks of `register_required_hooks`, then calls `more` with the `register` view.
 */
export async function start(more: (core: RegisterView) => void = () => {}, settings: Readonly<Record<string, unknown>> = {}): Promise<Kit> {
  const register = (core: Readonly<Record<string, unknown>>): void => {
    const view = core as unknown as RegisterView;
    view.routing.register_handler('RunCoreTest', () => new GameContract.RunCoreTestResponse());
    register_false_judges(core);
    register_required_hooks(core);
    more(view);
  };
  const server = await start_test_server(undefined, undefined, undefined, undefined, undefined, { ...settings }, register);
  running.push(server);
  const { data, dev } = load_data();
  const core: Core = {
    storage: module_object(server, 'storage') as Storage,
    rating: module_object(server, 'rating') as Rating,
    validation: module_object(server, 'validation') as Validation,
    ranking: module_object(server, 'ranking') as Ranking,
  };
  return { server, core, data, id: (name) => dev.find_id_value(name) };
}

/** A new user of the test server. A dev account name is `[a-z0-9_]`, so `-` of the name becomes `_`. */
export async function user(kit: Kit, name: string): Promise<TestSession> {
  return login(kit.server, name.replaceAll('-', '_'));
}

/** Runs `fn` in a committed out-of-request transaction of the user and returns its result. */
export async function in_tx<T>(kit: Kit, user_id: bigint, fn: (ctx: RequestCtx) => T): Promise<T> {
  const box: { out: { value: T } | null } = { out: null };
  const result = await kit.core.storage.run_user_transaction(user_id, (ctx) => {
    box.out = { value: fn(ctx) };
    return 'pass';
  });
  if (result !== 'COMMITTED' || box.out === null) throw new Error(`the transaction of user ${String(user_id)} ended ${result}`);
  return box.out.value;
}

/** The committed `RatingUserState` rows of a user. */
export async function rating_rows(kit: Kit, user_id: bigint): Promise<CoreContract.RatingUserState[]> {
  const items = await read_user_state(kit.server, user_id);
  return items.filter((item) => item.kind === 'RatingUserState').map((item) => item.value as CoreContract.RatingUserState);
}

/** The committed row of a rule, or undefined. */
export async function rating_row(kit: Kit, user_id: bigint, rule_id: number): Promise<CoreContract.RatingUserState | undefined> {
  return (await rating_rows(kit, user_id)).find((row) => row.id === BigInt(rule_id));
}

/** The committed `MailUserState` rows of a user. */
export async function mails(kit: Kit, user_id: bigint): Promise<CoreContract.MailUserState[]> {
  const items = await read_user_state(kit.server, user_id);
  return items.filter((item) => item.kind === 'MailUserState').map((item) => item.value as CoreContract.MailUserState);
}

/** A match record of the given match mode with the users, ratings and teams by index. */
export function match(kit: Kit, mode: string, user_ids: readonly bigint[], ratings: readonly bigint[], teams: readonly number[] = user_ids.map(() => 0)): MatchRecord {
  return { mode_id: kit.id(mode), user_ids, ratings, teams };
}

/** `set_rating` of a user through `testing.call_dev`. */
export async function set_rating(kit: Kit, user_id: bigint, rule: string, rating: bigint): Promise<void> {
  await call_dev(kit.server, 'rating', 'set_rating', [kit.id(rule), rating], user_id);
}

/** Closes the season of a ranking board now and waits for its background work. */
export async function close_season(kit: Kit, board: string, user_id: bigint): Promise<void> {
  await call_dev(kit.server, 'ranking', 'close_season_now', [kit.id(board)], user_id);
  await wait_background(kit.server);
}

/** The current season of a ranking board for a user. */
export async function season_of(kit: Kit, user_id: bigint, board: string): Promise<bigint> {
  return in_tx(kit, user_id, (ctx) => {
    const season = kit.core.ranking.get_season(ctx, kit.id(board));
    if (season === 'UNKNOWN_BOARD') throw new Error(`${board} is not a ranking board`);
    return season.season;
  });
}

/** Sends `RefreshRating` and returns its envelope. */
export async function refresh(session: TestSession): Promise<CoreContract.ResponseEnvelope> {
  const { envelope } = await send(session, 'core/RefreshRating', new CoreContract.RefreshRatingRequest());
  expect(envelope.error).toBeNull();
  return envelope;
}

/** The `error` log lines of the test server with that message. */
export function error_logs(kit: Kit, message: string): Record<string, unknown>[] {
  return read_logs(kit.server, 'error', 'error').filter((line) => line.message === message);
}

/** The tier ID value of a rule's `rating_tier` rows for a rating, computed from the data here. */
export function expected_tier(kit: Kit, rule: string, rating: bigint): number {
  const rule_id = kit.id(rule);
  const rows = kit.data.RatingTierTable.all_rows().filter((row) => row.rule === rule_id && row.min_rating <= rating);
  return rows.reduce<GameData.RatingTierRow | null>((best, row) => (best === null || row.min_rating > best.min_rating ? row : best), null)?.id ?? 0;
}
