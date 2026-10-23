/**
 * Test servers of `testing` for reset-counter's core tests. The `register` of every test server gives the core test
 * data `rpc` `RunCoreTest` a handler that runs the operation the test sets with `run`, in the request's ctx, and
 * registers the rest as the game-less `register` does.
 */
import * as CoreContract from '../../../generated/contract/core_contract.ts';
import * as GameContract from '../../../generated/contract/game_contract.ts';
import type * as GameData from '../../../generated/data/game_data.ts';
import type { ServerTimeApi } from '../../server-time/index.ts';
import type { RequestCtx } from '../../storage/index.ts';
import * as testing from '../../testing/dev/index.ts';
import { core_test_register } from '../../testing/dev/index.ts';
import type { ResetCounterModule } from '../index.ts';

export type TestServer = Awaited<ReturnType<typeof testing.start_test_server>>;
export type TestSession = Awaited<ReturnType<typeof testing.login>>;

/** 2027-01-15T08:00:00Z, a Friday in the middle of a month. */
export const START_AT = 1_800_000_000_000n;
export const MAX = 2n ** 53n - 1n;
export const DAY_MS = 86_400_000n;
export const GAME_ERROR_CORE_TEST = GameContract.GameError.GAME_ERROR_CORE_TEST;
export const CORE_ERROR_INTERNAL = CoreContract.CoreError.CORE_ERROR_INTERNAL;

const RUN = 'RunCoreTest';

/** What a `RunCoreTest` handler runs: its value is the outcome; a `GameError` value also ends the request with it. */
type Operation = (ctx: RequestCtx, modules: Modules) => unknown;

export interface Modules {
  readonly reset_counter: ResetCounterModule;
  readonly server_time: ServerTimeApi;
}

interface Bound {
  modules: Modules | null;
  operation: Operation | null;
  outcome: unknown;
}

const bound = new WeakMap<TestServer, Bound>();
const running: TestServer[] = [];

/** A test server whose `RunCoreTest` handler runs the operation of `run`. */
export async function start(): Promise<TestServer> {
  const slot: Bound = { modules: null, operation: null, outcome: undefined };
  const register = (core: Readonly<Record<string, unknown>>): void => {
    const routing = core.routing as { register_handler(name: string, handler: (ctx: RequestCtx) => unknown): void };
    slot.modules = { reset_counter: core['reset-counter'] as ResetCounterModule, server_time: core['server-time'] as ServerTimeApi };
    routing.register_handler(RUN, (ctx) => {
      if (slot.operation === null || slot.modules === null) return new GameContract.RunCoreTestResponse();
      const outcome = slot.operation(ctx, slot.modules);
      slot.outcome = outcome;
      return outcome === GAME_ERROR_CORE_TEST ? outcome : new GameContract.RunCoreTestResponse();
    });
    // Every other registration of the game-less `register`, without a second `RunCoreTest` handler.
    const rest = {
      ...core,
      routing: new Proxy(routing, {
        get(target, key, receiver) {
          if (key !== 'register_handler') return Reflect.get(target, key, receiver) as unknown;
          return (name: string, handler: (ctx: RequestCtx) => unknown) => {
            if (name !== RUN) target.register_handler(name, handler);
          };
        },
      }),
    };
    core_test_register(rest);
  };
  const server = await testing.start_test_server(START_AT, undefined, undefined, undefined, undefined, undefined, register);
  bound.set(server, slot);
  running.push(server);
  return server;
}

/** Stops every test server `start` made. */
export async function stop_all(): Promise<void> {
  for (const server of running.splice(0)) await testing.stop_test_server(server);
}

const ACCOUNT = 'reset_counter';

/** A test server and a logged-in user on it. */
export async function start_user(): Promise<{ server: TestServer; session: TestSession }> {
  const server = await start();
  return { server, session: await testing.login(server, ACCOUNT) };
}

/**
 * Sets the test clock and logs the same user in again, as the access token of the earlier login may have expired.
 */
export async function travel(server: TestServer, session: TestSession, time: bigint): Promise<TestSession> {
  testing.set_time(server, time);
  const again = await testing.login(server, ACCOUNT);
  expect(again.user_id).toBe(session.user_id);
  return again;
}

function slot_of(server: TestServer): Bound {
  const slot = bound.get(server);
  if (slot === undefined || slot.modules === null) throw new Error('the test server was not started by start()');
  return slot;
}

export interface RunResult {
  readonly envelope: CoreContract.ResponseEnvelope;
  /** The value the operation returned; undefined when it threw or did not run. */
  readonly outcome: unknown;
}

/** Sends `RunCoreTest` whose handler runs `operation` in the request's ctx. */
export async function run(server: TestServer, session: TestSession, operation: Operation): Promise<RunResult> {
  const slot = slot_of(server);
  slot.operation = operation;
  slot.outcome = undefined;
  try {
    const { envelope } = await testing.send(session, RUN, new GameContract.RunCoreTestRequest());
    return { envelope, outcome: slot.outcome };
  } finally {
    slot.operation = null;
  }
}

/** `add_count` in its own request; the outcome, after checking the request ended without an error. */
export async function add(server: TestServer, session: TestSession, id: number, amount: bigint | number, limit?: bigint | number): Promise<unknown> {
  const { envelope, outcome } = await run(server, session, (ctx, m) => m.reset_counter.add_count(ctx, id, amount, limit));
  expect(envelope.error).toBeNull();
  return outcome;
}

/** `get_count` in its own request. */
export async function count_of(server: TestServer, session: TestSession, id: number): Promise<bigint> {
  const { envelope, outcome } = await run(server, session, (ctx, m) => m.reset_counter.get_count(ctx, id));
  expect(envelope.error).toBeNull();
  if (typeof outcome !== 'bigint') throw new Error(`get_count gave ${String(outcome)}`);
  return outcome;
}

/** `server-time.get_next_reset` of the test server. */
export function next_reset(server: TestServer, cycle: GameData.ResetCycle | null, time: bigint): bigint {
  const modules = slot_of(server).modules;
  if (modules === null) throw new Error('the test server has no modules');
  return modules.server_time.get_next_reset(cycle, time);
}

/** The committed `ResetCounterUserState` rows of the user as [id, count, reset_at]. */
export async function rows(server: TestServer, user_id: bigint): Promise<[bigint, bigint, bigint][]> {
  const items = await testing.read_user_state(server, user_id);
  return items
    .filter((item) => item.kind === 'ResetCounterUserState')
    .map((item) => {
      const value = item.value as CoreContract.ResetCounterUserState;
      return [value.id, value.count, value.reset_at];
    });
}

/** The committed row of one counter as {count, reset_at}, or null. */
export async function row_of(server: TestServer, user_id: bigint, id: number): Promise<{ count: bigint; reset_at: bigint } | null> {
  const found = (await rows(server, user_id)).find(([row_id]) => row_id === BigInt(id));
  return found === undefined ? null : { count: found[1], reset_at: found[2] };
}

/** The `ResetCounterUserState` entries of a response delta as [id, count, reset_at]. */
export function delta_rows(envelope: CoreContract.ResponseEnvelope): [bigint, bigint, bigint][] {
  return (envelope.user_state?.entries ?? [])
    .filter((entry) => entry.kind === 'ResetCounterUserState')
    .map((entry) => {
      const value = CoreContract.ResetCounterUserState.decode(entry.value);
      if (value === null) throw new Error('a ResetCounterUserState entry does not decode');
      return [value.id, value.count, value.reset_at];
    });
}

/** The reset counter ID values of the core test data (`test-data/data/tables/reset_counter.csv`). */
export function counter(name: 'daily' | 'weekly' | 'monthly' | 'never' | 'unlimited'): number {
  const id = testing.load_data().dev.find_id_value(`[reset_counter_${name}]`);
  if (id === 0) throw new Error(`the core test data has no [reset_counter_${name}]`);
  return id;
}

/** The row of a reset counter ID value from the server build data. */
export function data_row(id: number): GameData.ResetCounterRow {
  return testing.load_data().data.ResetCounterTable.get_row(id);
}
