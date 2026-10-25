/**
 * A test server instance of `logging` with its dependencies `storage` and `server-time` on SQLite or PostgreSQL by
 * the run's DB kind. `request` plays the part of `routing`'s request processing that logging takes part in: the
 * report counter of the client log `rpc`s, the request transaction, the handler, and the `request` log line written
 * with `take_request_log_annotation`.
 */
import { inspect } from 'node:util';
import * as CoreContract from '../../../generated/contract/core_contract.ts';
import type { ClockAdapter } from '../../server-time/index.ts';
import { create_server_time, type ServerTime } from '../../server-time/index.ts';
import { create_server_time_dev } from '../../server-time/dev/index.ts';
import { create_storage_dev, type StorageDev } from '../../storage/dev/index.ts';
import { create_storage, type GameTx, type RequestCtx, type Storage } from '../../storage/index.ts';
import { core_settings, new_db, server_data, stop_all as stop_holders, test_server, type DbTarget } from '../../storage/tests/helpers.ts';
import { create_fake_adapter, create_logging_dev, type FakeAnalyticsController } from '../dev/index.ts';
import { create_logging, type AnalyticsSendEvent, type HttpFetch, type Level, type Logging, type LogValue } from '../index.ts';

export { lock_holder, DB_KIND } from '../../storage/tests/helpers.ts';

export const CoreError = CoreContract.CoreError;
export const START_TIME = 1_800_000_000_000n;
export const MINUTE_MS = 60_000n;

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

  advance(ms: bigint): void {
    this.#time += ms;
    for (const listener of [...this.#listeners]) listener();
  }

  subscribe(listener: () => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }
}

export interface StartOptions {
  readonly env?: 'LOCAL' | 'DEV' | 'STG' | 'PROD';
  /** DEV code in the server instance. Default: not STG and not PROD. */
  readonly dev?: boolean;
  /** `environments.<ENV>.adapters.analytics`. Default: `fake` (LOCAL). */
  readonly analytics?: string | null;
  /** Gives the fake adapter as the server instance's fake adapter override. Default: true. */
  readonly fake_override?: boolean;
  readonly settings?: Readonly<Record<string, unknown>>;
  readonly secrets?: Readonly<Record<string, string>>;
  /** Gives logging a server with `db` null, as a server that reads the host secret store. Default: false. */
  readonly host_secrets?: boolean;
  readonly fetch?: HttpFetch;
  readonly db?: DbTarget;
  /** The seed of each request's ctx random by request ID (`storage.set_seed_provider`). */
  readonly seed?: (request_id: string) => bigint | null;
}

export interface Server {
  readonly db: DbTarget;
  readonly storage: Storage;
  readonly storage_dev: StorageDev;
  readonly time: ServerTime;
  readonly clock: TestClock;
  readonly logging: Logging;
  /** The fake analytics adapter's controller; null when the instance made its own fake adapter or has none. */
  readonly fake: FakeAnalyticsController | null;
  /** The lines of the log line writer override, in order. */
  readonly lines: string[];
  stop(): void;
}

const running: Server[] = [];

/** Stops the instances and lock holders the test started. */
export function stop_all(): void {
  for (const server of running.splice(0)) server.stop();
  stop_holders();
}

/** Runs the lifecycle of `modules` in dependency order: the first server start failure reason, or null. */
function start_modules(modules: readonly { begin_start(): void; complete_start(): string | null }[]): string | null {
  for (const module of modules) module.begin_start();
  let failure: string | null = null;
  for (const module of modules) failure ??= module.complete_start();
  return failure;
}

/** The environment of the instance and whether it has DEV code, from `options` and their defaults. */
function instance_env(options: StartOptions): { env: NonNullable<StartOptions['env']>; dev: boolean } {
  const env = options.env ?? 'LOCAL';
  return { env, dev: options.dev ?? (env !== 'STG' && env !== 'PROD') };
}

/** Starts `server-time`, `storage` and `logging` in dependency order. Returns the server start failure reason instead on failure. */
export async function start_server(options: StartOptions = {}): Promise<Server | string> {
  const { env, dev } = instance_env(options);
  const db = options.db ?? (await new_db());
  const clock = new TestClock(START_TIME);
  const time = create_server_time({ settings: { 'server-time.silentMarginMs': 5000, dailyResetOffsetMs: 0 }, modules: {} });
  if (dev) create_server_time_dev(time).set_clock(clock);
  const settings = { ...core_settings(), 'environments.<ENV>.adapters.analytics': options.analytics === undefined ? 'fake' : options.analytics, ...options.settings };
  const fake = options.fake_override === false ? null : create_fake_adapter('analytics');
  const lines: string[] = [];
  const input_server = test_server(db, {
    env,
    dev,
    server_modules: ['server-time', 'storage', 'logging'],
    secrets: options.secrets,
    fetch: options.fetch,
    write_log_line: (line) => lines.push(line),
    fake_adapters: fake === null ? {} : { analytics: fake.adapter },
  });
  const storage = create_storage({ settings, modules: { 'server-time': time }, server: input_server });
  const storage_dev = create_storage_dev(storage);
  if (options.seed !== undefined) storage_dev.set_seed_provider(options.seed);
  const logging = create_logging({ settings, modules: { storage, 'server-time': time }, server: options.host_secrets === true ? { ...input_server, db: null } : input_server });
  if (dev) create_logging_dev(logging);
  const modules = [time, storage, logging];
  const stop = (): void => {
    for (const module of [...modules].reverse()) module.stop();
  };
  const failure = start_modules(modules);
  if (failure !== null) {
    stop();
    return failure;
  }
  // Server start ends: every job runs once.
  time.end_start();
  const server: Server = { db, storage, storage_dev, time, clock, logging, fake: fake?.controller ?? null, lines, stop };
  running.push(server);
  return server;
}

export async function start(options: StartOptions = {}): Promise<Server> {
  const server = await start_server(options);
  if (typeof server === 'string') throw new Error(`server start failed: ${server}`);
  return server;
}

export function new_user(server: Server): Promise<bigint> {
  return server.storage.run_game_transaction((tx: GameTx) => server.storage.create_user(tx).user_id) as Promise<bigint>;
}

/** Writes the user's `ConsentUserState` with `analytics_allowed`. */
export async function set_consent(server: Server, user_id: bigint, allowed: boolean): Promise<void> {
  const consent = new CoreContract.ConsentUserState();
  consent.analytics_allowed = allowed;
  const result = await server.storage.run_user_transaction(user_id, (ctx) => {
    server.storage.put_core_state(ctx, consent);
    return 'pass';
  });
  if (result !== 'COMMITTED') throw new Error(`consent: ${result}`);
}

/** A new user, with analytics consent unless `consent` is false. */
export async function user(server: Server, consent = true): Promise<bigint> {
  const id = await new_user(server);
  if (consent) await set_consent(server, id, true);
  return id;
}

/** Log lines as objects, of one kind when given. */
export function logs(server: Server, kind?: string): Record<string, unknown>[] {
  return server.lines.map((line) => JSON.parse(line) as Record<string, unknown>).filter((line) => kind === undefined || line.kind === kind);
}

/** Moves the test clock and waits for the jobs that came due and the `after_commit` functions. */
export async function advance(server: Server, ms: bigint): Promise<void> {
  server.clock.advance(ms);
  await settle(server);
}

/** Waits for the scheduler and the `after_commit` functions, like `testing.wait_background`. */
export async function settle(server: Server): Promise<void> {
  await create_server_time_dev(server.time).wait_idle();
  await server.storage_dev.wait_after_commit();
}

const CLIENT_LOG_RPCS: ReadonlySet<string> = new Set(['ReportClientErrors', 'ReportAnalyticsEvents']);

export interface RequestOptions {
  readonly request_id?: string;
  readonly body?: Uint8Array;
  readonly sensitive?: boolean;
  readonly client_version?: string;
  readonly platform?: string;
  /** The decoded request message, checked by the contract's field validator before the transaction. */
  readonly message?: unknown;
}

export interface RequestResult<T> {
  /** The error code: 0 on success, a `CoreError` or `GameError` value, or `CoreError` `INTERNAL` for a throw. */
  readonly code: number;
  readonly response: T | null;
  /** True when the handler ran. */
  readonly handled: boolean;
  readonly request_id: string;
}

let next_request = 0;

/**
 * One request of `user_id` with the handler, through the steps of `routing`'s request processing order that involve
 * logging: for a client log `rpc`, `count_report_request` in place of the user counter; the field validation of the
 * contract's validator when `message` is given; the request transaction (a
 * number result rolls back); the `request` log line with the request's annotation; an `error` log line with the stack
 * trace of a throw.
 */
/** What the request transaction of `request` ended with. */
interface HandlerRun<T> {
  readonly code: number;
  readonly response: T | null;
  readonly ctx: RequestCtx | null;
  readonly thrown: unknown;
}

/** The request transaction with the handler: a number result rolls back, a throw is `INTERNAL`. */
async function run_handler<T>(server: Server, user_id: bigint, fields: Parameters<Storage['run_request_transaction']>[1], handler: (ctx: RequestCtx) => T | number): Promise<HandlerRun<T>> {
  const seen: { ctx: RequestCtx | null } = { ctx: null };
  let result: T | number | 'FAILED' | 'WITHDRAWN';
  try {
    result = await server.storage.run_request_transaction(user_id, fields, (given) => {
      seen.ctx = given;
      return handler(given);
    });
  } catch (thrown) {
    return { code: CoreError.CORE_ERROR_INTERNAL, response: null, ctx: seen.ctx, thrown };
  }
  if (result === 'FAILED') return { code: CoreError.CORE_ERROR_INTERNAL, response: null, ctx: seen.ctx, thrown: null };
  if (result === 'WITHDRAWN') return { code: CoreError.CORE_ERROR_UNAUTHORIZED, response: null, ctx: seen.ctx, thrown: null };
  if (typeof result === 'number') return { code: result, response: null, ctx: seen.ctx, thrown: null };
  return { code: 0, response: result, ctx: seen.ctx, thrown: null };
}

/** The checks before the transaction: the report counter of a client log `rpc`, then the field validation. 0 when they pass. */
async function pre_check(server: Server, user_id: bigint, name: string, message: unknown): Promise<number> {
  const counted = CLIENT_LOG_RPCS.has(name) ? await server.logging.count_report_request(user_id) : 'pass';
  if (counted !== 'pass') return counted;
  const validate = CoreContract.RPCS.find((rpc) => rpc.name === `core/${name}`)?.validate ?? null;
  if (message !== undefined && validate !== null && validate(message as never, server_data().data) !== null) return CoreError.CORE_ERROR_INVALID_REQUEST;
  return 0;
}

export async function request<T>(server: Server, user_id: bigint, name: string, handler: (ctx: RequestCtx) => T | number, options: RequestOptions = {}): Promise<RequestResult<T>> {
  next_request += 1;
  const request_id = options.request_id ?? `request-${String(next_request)}`;
  const request_name = `core/${name}`;
  const fields = { request_name, request_id, silent: false, retry: false, session_id: 'session-1', client_version: options.client_version ?? '1.2.3', platform: options.platform ?? 'android' };
  const refused = await pre_check(server, user_id, name, options.message);
  const run: HandlerRun<T> = refused !== 0 ? { code: refused, response: null, ctx: null, thrown: null } : await run_handler(server, user_id, fields, handler);
  const logging = server.logging;
  if (run.thrown !== null) {
    const stack = run.thrown instanceof Error ? (run.thrown.stack ?? run.thrown.message) : inspect(run.thrown);
    logging.write({ kind: 'error', level: 'error', message: 'unhandled exception', user_id, request_id, request: request_name, fields: { stack_trace: stack } });
  }
  const annotation = run.ctx === null ? { fields: {}, min_level: 'debug' as Level } : logging.take_request_log_annotation(run.ctx);
  const seed: LogValue = run.ctx === null ? null : run.ctx.seed.toString();
  logging.write({
    kind: 'request',
    level: null,
    message: 'request',
    user_id,
    request_id,
    request: request_name,
    fields: { error_code: run.code, duration_ms: 1, client_version: fields.client_version, platform: fields.platform, seed, ...annotation.fields },
    min_level: annotation.min_level,
    request_body: options.body ?? null,
    sensitive: options.sensitive ?? false,
  });
  return { code: run.code, response: run.response, handled: run.ctx !== null, request_id };
}

/** The `request` log line of a request ID. */
export function request_line(server: Server, request_id: string): Record<string, unknown> {
  const lines = logs(server, 'request').filter((line) => line.request_id === request_id);
  if (lines.length !== 1) throw new Error(`${String(lines.length)} request log lines for ${request_id}`);
  return lines[0] as Record<string, unknown>;
}

/** Runs the handler of an admin list operation as `admin-api` does: in a game transaction, with checked input. */
export async function admin_list(
  server: Server,
  operation: 'list_client_errors' | 'list_client_events' | 'list_server_events',
  input: Readonly<Record<string, unknown>>,
): Promise<Record<string, unknown>[] | string> {
  const op = server.logging[operation];
  const result = await server.storage.run_game_transaction((tx) => op.handler(input, tx, null, null));
  if (typeof result === 'string') return result;
  return result.entries as Record<string, unknown>[];
}

/** Committed rows, by `storage.read_db`. */
export function rows(server: Server, sql: string, params: readonly (bigint | number | string)[] = []): Record<string, unknown>[] {
  return server.storage.read_db().query(sql, params);
}

/** The analytics events the fake adapter got through `send`, in order. */
export function sent_events(server: Server): { user_id: bigint; name: string; time_at: bigint; params: CoreContract.AnalyticsParam[] }[] {
  const out: { user_id: bigint; name: string; time_at: bigint; params: CoreContract.AnalyticsParam[] }[] = [];
  for (const call of server.fake?.calls() ?? []) {
    if (call.operation === 'send' && Array.isArray(call.input)) for (const event of call.input as readonly AnalyticsSendEvent[]) out.push({ ...event, params: [...event.params] });
  }
  return out;
}

export function error_entry(level: string, time_at: bigint, message = 'boom'): CoreContract.ClientErrorEntry {
  const entry = new CoreContract.ClientErrorEntry();
  entry.level = level;
  entry.time_at = time_at;
  entry.tag = 'battle';
  entry.message = message;
  entry.stack_trace = 'at frame 1';
  return entry;
}

export function report_errors(entries: readonly CoreContract.ClientErrorEntry[], dropped = 0): CoreContract.ReportClientErrorsRequest {
  const request = new CoreContract.ReportClientErrorsRequest();
  request.errors = [...entries];
  request.dropped_error_count = dropped;
  return request;
}

const Kind = CoreContract.AnalyticsParamKind;

export function int_param(key: string, value: bigint): CoreContract.AnalyticsParam {
  const param = new CoreContract.AnalyticsParam();
  param.key = key;
  param.kind = Kind.ANALYTICS_PARAM_KIND_INT;
  param.int_value = value;
  return param;
}

export function string_param(key: string, value: string): CoreContract.AnalyticsParam {
  const param = new CoreContract.AnalyticsParam();
  param.key = key;
  param.kind = Kind.ANALYTICS_PARAM_KIND_STRING;
  param.string_value = value;
  return param;
}

export function double_param(key: string, value: number): CoreContract.AnalyticsParam {
  const param = new CoreContract.AnalyticsParam();
  param.key = key;
  param.kind = Kind.ANALYTICS_PARAM_KIND_DOUBLE;
  param.double_value = value;
  return param;
}

export function analytics_event(name: string, time_at: bigint, params: readonly CoreContract.AnalyticsParam[] = []): CoreContract.AnalyticsEvent {
  const event = new CoreContract.AnalyticsEvent();
  event.name = name;
  event.time_at = time_at;
  event.params = [...params];
  return event;
}

export function report_events(events: readonly CoreContract.AnalyticsEvent[], dropped = 0): CoreContract.ReportAnalyticsEventsRequest {
  const request = new CoreContract.ReportAnalyticsEventsRequest();
  request.events = [...events];
  request.dropped_event_count = dropped;
  return request;
}

/** The two client log `rpc`s through `request`. */
export function report_client_errors(server: Server, user_id: bigint, message: CoreContract.ReportClientErrorsRequest, options: RequestOptions = {}): Promise<RequestResult<unknown>> {
  return request(server, user_id, 'ReportClientErrors', (ctx) => server.logging.ReportClientErrors(ctx, message), { message, ...options });
}

export function report_analytics_events(server: Server, user_id: bigint, message: CoreContract.ReportAnalyticsEventsRequest, options: RequestOptions = {}): Promise<RequestResult<unknown>> {
  return request(server, user_id, 'ReportAnalyticsEvents', (ctx) => server.logging.ReportAnalyticsEvents(ctx, message), { message, ...options });
}
