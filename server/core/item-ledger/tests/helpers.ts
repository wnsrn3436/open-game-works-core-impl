/**
 * A test server instance of `item-ledger` with its dependencies `server-time`, `storage` and `logging` on SQLite or
 * PostgreSQL by the run's DB kind, started in dependency order. `request` plays the part of `routing`'s request
 * processing that item-ledger takes part in: the request transaction, the handler, and the response delta.
 */
import { readFileSync } from 'node:fs';
import * as CoreContract from '../../../generated/contract/core_contract.ts';
import * as CoreCheatContract from '../../../dev/generated/contract/core_cheat_contract.ts';
import * as GameDataDev from '../../../dev/generated/data/game_data_dev.ts';
import { create_logging_dev } from '../../logging/dev/index.ts';
import { create_logging, type Logging } from '../../logging/index.ts';
import { create_server_time_dev } from '../../server-time/dev/index.ts';
import { create_server_time, type ClockAdapter, type ServerTime } from '../../server-time/index.ts';
import { create_storage_dev, type StorageDev } from '../../storage/dev/index.ts';
import { create_storage, type GameTx, type RequestCtx, type ResponseDelta, type Storage } from '../../storage/index.ts';
import { core_settings, new_db, test_server, type DbTarget } from '../../storage/tests/helpers.ts';
import { create_item_ledger_dev, type ItemLedgerDev } from '../dev/index.ts';
import {
  create_item_ledger, type AfterItemChangeHook, type HistoryRow, type ItemLedger, type ItemLedgerContent, type ValidateItemChangeHook,
} from '../index.ts';

export { DB_KIND } from '../../storage/tests/helpers.ts';

export const START_AT = 1_000_000_000_000n;
export const Source = CoreContract.ItemChangeSource;
export const CoreError = CoreContract.CoreError;

/** A clock that moves only when the test moves it. */
export class TestClock implements ClockAdapter {
  readonly real_time = false;
  #time: bigint;
  readonly #listeners = new Set<() => void>();

  constructor(time: bigint) {
    this.#time = time;
  }

  now(): bigint {
    return this.#time;
  }

  set(time: bigint): void {
    this.#time = time;
    for (const listener of [...this.#listeners]) listener();
  }

  subscribe(listener: () => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }
}

/** One server instance: the module objects in dependency order. */
export interface Server {
  readonly db: DbTarget;
  readonly clock: TestClock;
  readonly time: ServerTime;
  readonly storage: Storage;
  readonly storage_dev: StorageDev | null;
  readonly logging: Logging;
  readonly module: ItemLedger;
  readonly dev: ItemLedgerDev | null;
  /** The lines of the log line writer override, in order. */
  readonly lines: string[];
  stop(): void;
}

export interface Env {
  readonly server: Server;
  /** The module object: the operations as core modules call them. */
  readonly module: ItemLedger;
  /** Member `content`: the operations as content code calls them. */
  readonly ledger: ItemLedgerContent;
  readonly storage: Storage;
  readonly logging: Logging;
  /** What the hooks in the hook slots call; null does the `default`. */
  readonly hooks: { validate: ValidateItemChangeHook | null; after: AfterItemChangeHook | null };
}

export interface StartOptions {
  readonly env?: 'LOCAL' | 'STG';
  readonly start_at?: bigint;
  readonly settings?: Readonly<Record<string, unknown>>;
  /** Another server instance on this database. */
  readonly db?: DbTarget;
  readonly clock?: TestClock;
}

const running: Server[] = [];

/** Starts `server-time`, `storage`, `logging` and `item-ledger` (and their DEV code outside STG) in dependency order. */
export async function start_server(options: StartOptions = {}): Promise<Server> {
  const env = options.env ?? 'LOCAL';
  const dev = env !== 'STG';
  const db = options.db ?? (await new_db());
  const clock = options.clock ?? new TestClock(options.start_at ?? START_AT);
  const time = create_server_time({ settings: { 'server-time.silentMarginMs': 5000, dailyResetOffsetMs: 0 }, modules: {} });
  if (dev) create_server_time_dev(time).set_clock(clock);
  const settings = { ...core_settings(), 'environments.<ENV>.adapters.analytics': dev ? 'fake' : null, ...options.settings };
  const lines: string[] = [];
  const server = test_server(db, {
    env,
    dev,
    server_modules: ['item-ledger', 'logging', 'server-time', 'storage'],
    write_log_line: (line) => lines.push(line),
  });
  const storage = create_storage({ settings, modules: { 'server-time': time }, server });
  const storage_dev = dev ? create_storage_dev(storage) : null;
  const logging = create_logging({ settings, modules: { storage, 'server-time': time }, server });
  if (dev) create_logging_dev(logging);
  const module = create_item_ledger({ settings, modules: { storage, 'server-time': time, logging }, server });
  const ledger_dev = dev ? create_item_ledger_dev(module) : null;
  const modules = [time, storage, logging, module];
  for (const m of modules) m.begin_start();
  let failure: string | null = null;
  for (const m of modules) failure ??= m.complete_start();
  const stop = (): void => {
    for (const m of [...modules].reverse()) m.stop();
  };
  if (failure !== null) {
    stop();
    throw new Error(`server start failed: ${failure}`);
  }
  // Server start ends: every job runs once.
  time.end_start();
  const started: Server = { db, clock, time, storage, storage_dev, logging, module, dev: ledger_dev, lines, stop };
  running.push(started);
  return started;
}

export async function start(options: StartOptions = {}): Promise<Env> {
  const server = await start_server(options);
  const hooks: Env['hooks'] = { validate: null, after: null };
  // What `routing` does with the hooks content `register` gave to `register_hook`.
  server.module.hook_slots.validate_item_change = (ctx, source, list) => (hooks.validate ? hooks.validate(ctx, source, list) : 'pass');
  server.module.hook_slots.after_item_change = (ctx, source, list) => {
    hooks.after?.(ctx, source, list);
    return null;
  };
  return { server, module: server.module, ledger: server.module.content, storage: server.storage, logging: server.logging, hooks };
}

/** A second server instance on the same database and clock, with the same hooks. */
export async function start_peer(env: Env): Promise<Env> {
  const peer = await start({ db: env.server.db, clock: env.server.clock });
  peer.hooks.validate = (ctx, source, list) => (env.hooks.validate ? env.hooks.validate(ctx, source, list) : 'pass');
  return peer;
}

/** Stops every server instance the test file started. */
export function stop(): void {
  for (const server of running.splice(0)) server.stop();
}

/** The ID value of a core test data ID name. */
export function id(name: string): number {
  const v = GameDataDev.find_id_value(name);
  if (v === 0) throw new Error(`no ID value for ${name}`);
  return v;
}

/** An `ItemAmount` with the amount in the big encoding pair. */
export function amount(name: string, n: bigint | number | string): CoreContract.ItemAmount {
  const a = new CoreContract.ItemAmount();
  a.item_id = id(name);
  const v = BigInt(n);
  if (v > 2n ** 53n - 1n || v < -(2n ** 53n - 1n)) a.big_amount = v.toString();
  else a.amount = v;
  return a;
}

export function items(...list: [string, bigint | number | string][]): CoreContract.ItemAmount[] {
  return list.map(([name, n]) => amount(name, n));
}

/** A new user, created at the clock's time. */
export async function user(env: Env): Promise<{ user_id: bigint }> {
  const user_id = await env.storage.run_game_transaction((tx: GameTx) => env.storage.create_user(tx).user_id);
  if (typeof user_id !== 'bigint') throw new Error(`create_user: ${user_id}`);
  return { user_id };
}

/** Runs `fn` in an out-of-request change of the user and commits; the result is what `fn` returned. */
export async function tx<T>(env: Env, user_id: bigint, fn: (ctx: RequestCtx) => T): Promise<T> {
  let out: T | undefined;
  const result = await env.storage.run_user_transaction(user_id, (ctx) => {
    out = fn(ctx);
    return 'pass';
  });
  if (result !== 'COMMITTED') throw new Error(`run_user_transaction: ${result}`);
  return out as T;
}

let next_request = 0;

function fields(request_name: string): { request_name: string; request_id: string; silent: boolean; retry: boolean; session_id: string; client_version: string; platform: string } {
  next_request += 1;
  return { request_name, request_id: `request-${String(next_request)}`, silent: false, retry: false, session_id: 'session-1', client_version: '1.0.0', platform: 'android' };
}

/**
 * A success request named `request_name`: `fn`'s result and the response delta. A throw of `fn` rolls the request
 * back and rejects, as `routing` ends it `INTERNAL`.
 */
export async function request<T>(env: Env, user_id: bigint, fn: (ctx: RequestCtx) => T, request_name = 'core/Test'): Promise<{ out: T; delta: ResponseDelta }> {
  let out: T | undefined;
  let delta: ResponseDelta | undefined;
  const result = await env.storage.run_request_transaction(user_id, fields(request_name), (ctx) => {
    out = fn(ctx);
    delta = env.storage.take_response_delta(ctx).delta;
    return 'response';
  });
  if (result !== 'response' || delta === undefined) throw new Error(`run_request_transaction: ${result}`);
  return { out: out as T, delta };
}

/** A success request that carries the user's pending delta. */
export async function flush(env: Env, user_id: bigint): Promise<ResponseDelta> {
  return (await request(env, user_id, () => null)).delta;
}

/** The core cheat `SetItemBalance` as a request: the error code (0 on success) and, on success, the response delta. */
export async function send_set_item_balance(env: Env, user_id: bigint, message: CoreCheatContract.SetItemBalanceRequest): Promise<{ code: number; delta: ResponseDelta | null }> {
  const dev = env.server.dev;
  if (dev === null) throw new Error('no DEV code');
  let delta: ResponseDelta | null = null;
  const result = await env.storage.run_request_transaction(user_id, fields('core/cheat/SetItemBalance'), (ctx) => {
    const out = dev.SetItemBalance(ctx, message);
    if (typeof out === 'number') return out;
    delta = env.storage.take_response_delta(ctx).delta;
    return 'response';
  });
  if (result === 'FAILED' || result === 'WITHDRAWN') throw new Error(`run_request_transaction: ${result}`);
  return { code: result === 'response' ? 0 : result, delta };
}

/**
 * `set_balance` as `routing`'s `dev` calls it: an out-of-request change, committed on `OK`, rolled back on a failure
 * value. A success request then takes its pending delta, so a test's next request has only its own changes.
 */
export async function set_balance(env: Env, user_id: bigint, name: string | number, n: bigint | number): Promise<string> {
  const dev = env.server.dev;
  if (dev === null) throw new Error('no DEV code');
  let out = '';
  await env.storage.run_user_transaction(user_id, (ctx) => {
    out = dev.set_balance(ctx, typeof name === 'number' ? name : id(name), BigInt(n));
    return out === 'OK' ? 'pass' : CoreError.CORE_ERROR_INTERNAL;
  });
  if (out === 'OK') await flush(env, user_id);
  return out;
}

export async function balance(env: Env, user_id: bigint, name: string): Promise<bigint> {
  return tx(env, user_id, (ctx) => env.ledger.get_balance(ctx, id(name)));
}

/** The stored `ItemBalanceUserState` row of an item, or null. */
export async function row(env: Env, user_id: bigint, name: string): Promise<CoreContract.ItemBalanceUserState | null> {
  return tx(env, user_id, (ctx) => env.storage.get_state(ctx, CoreContract.ItemBalanceUserState, BigInt(id(name))) as CoreContract.ItemBalanceUserState | null);
}

/** Writes an `ItemBalanceUserState` row as the owner module does. */
export async function put_row(env: Env, user_id: bigint, name: string, values: Partial<Pick<CoreContract.ItemBalanceUserState, 'amount' | 'recovery_started_at' | 'ends_at' | 'big_amount'>>): Promise<void> {
  await tx(env, user_id, (ctx) => {
    const s = new CoreContract.ItemBalanceUserState();
    s.id = BigInt(id(name));
    Object.assign(s, values);
    env.storage.put_core_state(ctx, s);
  });
}

export function history(env: Env, user_id: bigint): readonly HistoryRow[] {
  return env.module.list_history(user_id, 0n, 2n ** 62n, 0n, 1000);
}

/** The `ItemBalanceUserState` entries of a delta, as `[item ID, row or 'deleted']`. */
export function balance_entries(delta: CoreContract.UserStateDelta | null | undefined): [number, CoreContract.ItemBalanceUserState | 'deleted'][] {
  return (delta?.entries ?? [])
    .filter((e) => e.kind === 'ItemBalanceUserState')
    .map((e) => [Number(e.id), e.deleted ? 'deleted' : (CoreContract.ItemBalanceUserState.decode(e.value) as CoreContract.ItemBalanceUserState)]);
}

/** `[item_id, delta, overflow, source, ref]` of `ItemChange`s, with the big encoding pairs read. */
export function change_rows(list: readonly CoreContract.ItemChange[]): [number, bigint, bigint, number, string][] {
  return list.map((c) => [
    c.item_id, c.big_delta !== '' ? BigInt(c.big_delta) : c.delta, c.big_overflow !== '' ? BigInt(c.big_overflow) : c.overflow, c.source, c.ref,
  ]);
}

/** Log lines as objects, of one kind and level when given. */
export function logs(env: Env, kind?: string, level?: string): Record<string, unknown>[] {
  return env.server.lines
    .map((line) => JSON.parse(line) as Record<string, unknown>)
    .filter((line) => (kind === undefined || line.kind === kind) && (level === undefined || line.level === level));
}

/** Sets the test clock. */
export function set_time(env: Env, time: bigint): void {
  env.server.clock.set(time);
}

export function advance_time(env: Env, ms: bigint): void {
  env.server.clock.set(env.server.clock.now() + ms);
}

/** Waits for the scheduler and the `after_commit` functions, like `testing.wait_background`. */
export async function wait_background(env: Env): Promise<void> {
  await create_server_time_dev(env.server.time).wait_idle();
  await env.server.storage_dev?.wait_after_commit();
}

/** A core test fixture case; the test file that reads the fixture gives the `input` and `expected` forms. */
export interface FixtureCase<I, E> {
  readonly name: string;
  readonly input: I;
  readonly expected: E;
}

/** The cases of a core test fixture. */
export function fixture(name: string): FixtureCase<unknown, unknown>[] {
  const text = readFileSync(new URL(`../../../../fixtures/${name}.json`, import.meta.url), 'utf8');
  return (JSON.parse(text) as { cases: FixtureCase<unknown, unknown>[] }).cases;
}
