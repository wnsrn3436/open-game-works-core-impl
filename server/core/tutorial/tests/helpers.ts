/**
 * A test server with the server modules of the core test run, and the module objects its `register(core)` received.
 * Its `register` runs the body a test sets in the handler of the core test data `rpc` `RunCoreTest`.
 */
import * as CoreContract from '../../../generated/contract/core_contract.ts';
import * as GameContract from '../../../generated/contract/game_contract.ts';
import * as CoreCheatContract from '../../../dev/generated/contract/core_cheat_contract.ts';
import * as Testing from '../../testing/dev/index.ts';
import type { RequestCtx, StorageContent } from '../../storage/index.ts';
import type { TutorialContent } from '../index.ts';

/** The `routing` operations a test `register` calls. */
interface Routing {
  register_handler(name: string, handler: (ctx: RequestCtx) => unknown): void;
}

export const START_AT = 1_800_000_000_000n;
export const SAVE = 'core/SaveTutorialProgress';
export const KIND = 'TutorialProgressUserState';
export const RUN = 'RunCoreTest';

export interface Env {
  server: Testing.TestServer;
  /** The module objects `register(core)` received, by module name. */
  core: Readonly<Record<string, unknown>>;
  /** `storage` and `tutorial` as content `register(core)` gets them. */
  storage: StorageContent;
  tutorial: TutorialContent;
  /** ID values of the core test data tutorials: `[tutorial_first]` has steps 1 to 3, `[tutorial_second]` 1 and 2. */
  first: number;
  second: number;
  /** The body of the `RunCoreTest` handler. */
  run: (ctx: RequestCtx) => void;
}

export async function start(settings?: Record<string, unknown>): Promise<Env> {
  const env = { run: () => {} } as unknown as Env;
  let first_core = null as Readonly<Record<string, unknown>> | null;
  const register = (core: Readonly<Record<string, unknown>>): void => {
    first_core ??= core;
    const routing = core.routing as Routing;
    routing.register_handler(RUN, (ctx) => {
      env.run(ctx);
      return new GameContract.RunCoreTestResponse();
    });
    Testing.core_test_register(core, [RUN]);
  };
  env.server = await Testing.start_test_server(START_AT, undefined, undefined, undefined, undefined, settings, register);
  if (first_core === null) throw new Error('register was not called');
  env.core = first_core;
  env.storage = env.core.storage as StorageContent;
  env.tutorial = env.core.tutorial as TutorialContent;
  const { dev } = Testing.load_data();
  env.first = dev.find_id_value('[tutorial_first]');
  env.second = dev.find_id_value('[tutorial_second]');
  return env;
}

export async function stop(env: Env): Promise<void> {
  await Testing.stop_test_server(env.server);
}

export function save(tutorial_id: number, step: number): CoreContract.SaveTutorialProgressRequest {
  const request = new CoreContract.SaveTutorialProgressRequest();
  request.tutorial_id = tutorial_id;
  request.step = step;
  return request;
}

export function dev_login(account_name: string): CoreCheatContract.DevLoginRequest {
  const request = new CoreCheatContract.DevLoginRequest();
  request.account_name = account_name;
  return request;
}

/** The stored `TutorialProgressUserState` rows of the user as `[tutorial ID value, step]`, item ID ascending. */
export async function stored(env: Env, user_id: bigint): Promise<[number, number][]> {
  const items = (await Testing.read_user_state(env.server, user_id)) as { kind: string; item_id: bigint; value: CoreContract.TutorialProgressUserState }[];
  return items.filter((item) => item.kind === KIND).map((item) => [Number(item.item_id), item.value.step]);
}

/** The `TutorialProgressUserState` entries of a delta: `[tutorial ID value, step]` for an upsert, `[id, null]` for a delete. */
export function delta_rows(delta: CoreContract.UserStateDelta | null): [number, number | null][] {
  if (delta === null) return [];
  return delta.entries
    .filter((entry) => entry.kind === KIND)
    .map((entry) => {
      if (entry.deleted) return [Number(entry.id), null];
      const value = CoreContract.TutorialProgressUserState.decode(entry.value);
      if (value === null) throw new Error('undecodable TutorialProgressUserState entry');
      expect(value.id).toBe(entry.id);
      return [Number(entry.id), value.step];
    });
}

export function error_code(envelope: CoreContract.ResponseEnvelope): number {
  return envelope.error === null ? 0 : envelope.error.code;
}

/** Runs `fn` in the `RunCoreTest` handler of a request of the session; returns its result. The request must succeed. */
export async function in_request<T>(env: Env, session: Testing.TestSession, fn: (ctx: RequestCtx) => T): Promise<T> {
  let out: T | undefined;
  env.run = (ctx) => {
    out = fn(ctx);
  };
  try {
    const { envelope } = await Testing.send(session, RUN, new GameContract.RunCoreTestRequest());
    expect(error_code(envelope)).toBe(0);
  } finally {
    env.run = () => {};
  }
  return out as T;
}

/** Sends `RunCoreTest` with `fn` as the handler body; returns the response envelope. */
export async function run_core_test(env: Env, session: Testing.TestSession, fn: (ctx: RequestCtx) => void): Promise<CoreContract.ResponseEnvelope> {
  env.run = fn;
  try {
    return (await Testing.send(session, RUN, new GameContract.RunCoreTestRequest())).envelope;
  } finally {
    env.run = () => {};
  }
}
