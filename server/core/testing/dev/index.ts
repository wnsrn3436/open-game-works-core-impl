/**
 * `testing`: the test helper of server regression tests, server core tests and the content populate. The whole
 * module is DEV code. Each `## DEV` operation is exported under its name and takes its inputs as positional
 * arguments; an optional input not given is `undefined`.
 */
import { game_row_lock_id, hold_lock, read_state, type StateItem } from './database.ts';
import { RemoteServer, send as send_request, send_cheat as send_cheat_request, type HeaderOverrides, type Message, type SendResult, type TestSession } from './request.ts';
import { runner, type DbKind, type RegisterFunction, type SettingsValues } from './runner_input.ts';

export { core_test_register, core_test_register_dev, register_false_judges, register_required_hooks, type DbKind, type RegisterFunction } from './runner_input.ts';
import {
  dev_of,
  fake_controller,
  restart_test_server as restart_server,
  set_key_source as set_server_key_source,
  start_test_server as start_server,
  test_clock_of,
  wait_instance_background,
  type KeySourceSetting,
  type TestServer,
} from './test_server.ts';
import type { TestEnvironment } from './server_binding.ts';

export { connect_server, login, send_admin, send_raw, type AdminResponse, type RawResponse, type SendResult } from './request.ts';
export type { RemoteServer, TestSession } from './request.ts';
export { load_data, non_integer_values, read_core_fixture, read_fixture, read_shared_fixture, type LoadedData } from './fixtures.ts';
export { close, connect, read_frame, send_frame, type RealtimeConnection } from './realtime.ts';
export { start_peer_server, stop_test_server, StartFailure, type TestServer, type KeySourceSetting } from './test_server.ts';
export { gates_of, start_peer_process, stop_peer_processes, wait_at_gate, type Gates, type PeerContext, type PeerProcess, type PeerRegister, type PeerRegisterExport } from './peer_process.ts';
export { hold_db, hold_lock_key, until_blocked_by, type HeldStatement, type Holder } from './pg_hold.ts';
export { http1_connect, start_http2_test_server, type Http2Reply, type Http2Request, type Http2TestServer } from './http2_test_server.ts';
export { game_row_lock_id, type StateItem } from './database.ts';
export { core_test_server_paths, new_core_test_server_input, type CoreTestServerInput, type CoreTestServerPaths } from './core_test_server_input.ts';

/** The module input (`server-core` `## module`). `testing` keeps nothing in a server instance. */
export interface TestingInput {
  readonly settings: Readonly<Record<string, unknown>>;
  readonly modules: Readonly<Record<string, unknown>>;
}

/** The `testing` module object of a server instance: lifecycle methods with nothing to do. */
export interface Testing {
  begin_start(): void;
  complete_start(): string | null;
  stop(): void;
}

/** Makes the `testing` module object. The test helper operations do not go through it, so it reads no input. */
export function create_testing({}: TestingInput): Testing {
  return {
    begin_start: () => undefined,
    complete_start: () => null,
    stop: () => undefined,
  };
}

function local(server: TestServer | RemoteServer, operation: string): TestServer {
  if (server instanceof RemoteServer) throw new Error(`testing: a remote test server does not take ${operation}`);
  server.running();
  return server;
}

/**
 * `start_test_server`: a new isolated test server. Inputs: start time (Unix ms), DB kind, environment, matchmaker,
 * real adapter list (adapter key to real or sandbox adapter name), settings overrides, `register`, `registerDev`,
 * server module list, server build data folder.
 */
export function start_test_server(
  start_at?: bigint,
  db?: DbKind,
  environment?: TestEnvironment,
  matchmaker?: boolean,
  real_adapters?: Readonly<Record<string, string>>,
  settings?: SettingsValues,
  register?: RegisterFunction,
  registerDev?: RegisterFunction,
  server_modules?: readonly string[],
  data_folder?: string,
): Promise<TestServer> {
  return start_server({ start_at, db, environment, matchmaker, real_adapters, settings, register, registerDev, server_modules, data_folder });
}

/** `db_kind_of`: the DB kind of a test server or a peer. A remote test server throws. */
export function db_kind_of(server: TestServer | RemoteServer): DbKind {
  if (server instanceof RemoteServer) throw new Error('testing: the DB kind of a remote test server is not known');
  return server.shared.database.kind;
}

/** `default_db_kind`: the run's default DB kind (`OGW_DEFAULT_DB`). It makes no DB. */
export function default_db_kind(): DbKind {
  return runner.default_db();
}

/** `restart_test_server`: the same test server on a new server instance. */
export function restart_test_server(server: TestServer, register?: RegisterFunction, registerDev?: RegisterFunction): Promise<TestServer> {
  return restart_server(local(server, 'restart_test_server'), register, registerDev);
}

/**
 * `send`: a game `rpc` or core `rpc` request over HTTP. Optional: request ID, timestamp, seed, header overrides
 * (a `null` value removes the header), raw body.
 */
export function send(
  session: TestSession,
  name: string,
  message: Message,
  request_id?: string,
  timestamp?: bigint,
  seed?: bigint,
  headers?: HeaderOverrides,
  raw_body?: Uint8Array,
): Promise<SendResult> {
  return send_request(session, name, message, { request_id, timestamp, seed, headers, raw_body });
}

/** `send_cheat`: a cheat request with the dev access value. */
export function send_cheat(session: TestSession, name: string, message: Message): Promise<SendResult> {
  return send_cheat_request(session, name, message);
}

/** `read_user_state`: the committed UserState items of a user, as copies. */
export function read_user_state(server: TestServer, user_id: bigint): Promise<StateItem[]> {
  return read_state(local(server, 'read_user_state').shared.database, 'user_state', user_id);
}

/** `read_server_state`: the committed server state items of a user, as copies. */
export function read_server_state(server: TestServer, user_id: bigint): Promise<StateItem[]> {
  return read_state(local(server, 'read_server_state').shared.database, 'server_state', user_id);
}

/** `set_time`: moves the test clock of a LOCAL test server and its peers to `time`. */
export function set_time(server: TestServer, time: bigint): void {
  test_clock_of(local(server, 'set_time'), 'set_time').set(time);
}

/** `advance_time`: moves the test clock of a LOCAL test server and its peers forward by `ms`. Negative throws. */
export function advance_time(server: TestServer, ms: bigint): void {
  const clock = test_clock_of(local(server, 'advance_time'), 'advance_time');
  if (ms < 0n) throw new Error(`testing: advance_time by ${String(ms)} ms is negative`);
  clock.set(clock.now() + ms);
}

/** `fake`: the fake adapter controller of a service. */
export function fake(server: TestServer, service: string): unknown {
  return fake_controller(local(server, 'fake'), service);
}

/** `set_key_source`: what the key source of a real adapter's key gives: a value, or `timeout` or `communication_failure`. */
export function set_key_source(server: TestServer, adapter_key: string, setting: KeySourceSetting): void {
  set_server_key_source(local(server, 'set_key_source'), adapter_key, setting);
}

/**
 * `wait_background`: waits until `storage.wait_after_commit` and `server-time.wait_idle` of the test server's instance
 * end, for at most `testing.backgroundWaitTimeoutMs` of real time.
 */
export async function wait_background(server: TestServer): Promise<void> {
  const test_server = local(server, 'wait_background');
  if (test_server.environment === 'STG') throw new Error('testing: a STG test server has no DEV code');
  await wait_instance_background(test_server);
}

/** `read_logs`: the log lines the test server's log line writer got, parsed, optionally of one kind and level. */
export function read_logs(server: TestServer, kind?: string, level?: string): Record<string, unknown>[] {
  const lines = local(server, 'read_logs').log_lines.map((line) => JSON.parse(line) as Record<string, unknown>);
  return lines.filter((line) => (kind === undefined || line.kind === kind) && (level === undefined || line.level === level));
}

/** The testing DEV operations `call_dev` calls (`## DEV` testing DEV operation table, `called by` `call_dev`). */
const CALL_DEV_OPERATIONS: ReadonlySet<string> = new Set([
  'item-ledger.set_balance',
  'iap.send_fake_refund',
  'iap.send_fake_subscription_notify',
  'ranking.close_season_now',
  'tutorial.set_tutorial_step',
  'matchmaker.create_test_match',
  'migration.migrate_snapshot',
  'attendance.set_attendance',
  'offer.set_offer',
  'rating.set_rating',
]);

/** `call_dev`: a module DEV operation of the test server's instance through `routing`'s `dev`. */
export async function call_dev(server: TestServer, module: string, operation: string, input: readonly unknown[], user_id?: bigint): Promise<unknown> {
  const test_server = local(server, 'call_dev');
  if (test_server.environment === 'STG') throw new Error('testing: a STG test server has no DEV code');
  if (!CALL_DEV_OPERATIONS.has(`${module}.${operation}`)) throw new Error(`testing: call_dev does not call ${module}.${operation}`);
  if (!test_server.shared.server_modules.includes(module)) throw new Error(`testing: module ${module} is not in the server module list`);
  return await dev_of(test_server.running().instance)(module, operation, [...input], user_id);
}

/**
 * `hold_game_row_lock`: holds the lock that `storage.lock_game_row` takes for `table` and `key` on a connection of
 * the test server's DB that is not the server instance's, until the returned function releases it. The key of
 * table `game_state` is `[game state kind class, key]`, as content passes it.
 */
export async function hold_game_row_lock(server: TestServer, table: string, key: readonly unknown[]): Promise<() => Promise<void>> {
  const test_server = local(server, 'hold_game_row_lock');
  return hold_lock(test_server.shared.database, game_row_lock_id(table, key));
}
