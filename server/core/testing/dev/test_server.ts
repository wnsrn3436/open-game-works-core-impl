import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { create_system_clock } from '../../server-time/adapters/system_clock.ts';
import type { ClockAdapter } from '../../server-time/clock.ts';
import { network_time_limit } from '../../server-time/network_time_limit.ts';
import { new_database, type TestDatabase } from './database.ts';
import {
  base_settings,
  client_data_version,
  default_register,
  runner,
  server_data_folder,
  server_module_list,
  testing_setting,
  type DbKind,
  type RegisterFunction,
  type SettingsValues,
} from './runner_input.ts';
import { is_real_adapter, new_secrets, type TestSecrets } from './secrets.ts';
import { SETTING_TYPES } from './setting_types.ts';
import {
  ADAPTER_OWNERS,
  new_fake_adapter,
  new_server_instance,
  type FakeAdapterPair,
  type KeySource,
  type KeySourceFailure,
  type ServerInstance,
  type TestEnvironment,
} from './server_binding.ts';
import { TestClock } from './test_clock.ts';

/**
 * What `set_key_source` gives a key source: the value it returns (the public key list or root certificate of the
 * adapter's module spec), or the failure condition `timeout` or `communication_failure`.
 */
export type KeySourceSetting = unknown;

/** What a test server and its peers share (`### isolation`): DB, secrets, settings, adapters, clock. */
interface Shared {
  readonly folder: string;
  readonly database: TestDatabase;
  readonly secrets: TestSecrets;
  readonly secret_file: string;
  readonly environment: TestEnvironment;
  readonly settings: SettingsValues;
  readonly overrides: SettingsValues;
  readonly server_modules: readonly string[];
  readonly data_folder: string;
  readonly data_version: string;
  readonly adapters: Readonly<Record<string, string>>;
  readonly real_adapters: Readonly<Record<string, string>>;
  readonly key_source_settings: Map<string, KeySourceSetting>;
  readonly fakes: ReadonlyMap<string, FakeAdapterPair>;
  readonly test_clock: TestClock | null;
  readonly clock: ClockAdapter;
}

/** What one server instance of a test server has by itself: port, process memory, log line writer. */
interface Own {
  instance: ServerInstance;
  port: number;
  /** The seed of each request ID `send` gave a seed (`storage.set_seed_provider`). Process memory of the instance. */
  seeds: Map<string, bigint>;
}

/** A test server (`start_test_server`) or a peer (`start_peer_server`). */
export class TestServer {
  /** The log lines its log line writer got. Kept by `restart_test_server`; a peer has its own. */
  readonly log_lines: string[] = [];
  readonly peers = new Set<TestServer>();
  stopped = false;
  private own: Own | null = null;
  readonly shared: Shared;
  readonly origin: TestServer | null;
  readonly matchmaker: boolean;
  register: RegisterFunction;
  registerDev: RegisterFunction;

  constructor(shared: Shared, origin: TestServer | null, matchmaker: boolean, register: RegisterFunction, registerDev: RegisterFunction) {
    this.shared = shared;
    this.origin = origin;
    this.matchmaker = matchmaker;
    this.register = register;
    this.registerDev = registerDev;
  }

  /** `http://127.0.0.1:<port>` of the running instance. */
  get url(): string {
    return `http://127.0.0.1:${String(this.running().port)}`;
  }

  get port(): number {
    return this.running().port;
  }

  /** The dev access value of the test server (`cheat` `### dev access`). */
  get dev_access(): string {
    return this.shared.secrets.dev_access;
  }

  get environment(): TestEnvironment {
    return this.shared.environment;
  }

  /** The admin secret of an operator of the test server. */
  admin_secret(operator: string): string | null {
    return this.shared.secrets.file[`adminSecret.${operator}`] ?? null;
  }

  running(): Own {
    if (this.stopped || this.own === null) throw new Error('testing: the test server has stopped');
    return this.own;
  }

  /** The settings values of this test server: the base values with its settings overrides. */
  settings(): SettingsValues {
    return { ...this.shared.settings, ...this.shared.overrides };
  }

  /**
   * Makes and starts a new server instance for this test server. Throws when server start fails; the `Error` has field
   * `logs`, the log lines of that server instance parsed as JSON.
   */
  async start_instance(): Promise<void> {
    const seeds = new Map<string, bigint>();
    const first_line = this.log_lines.length;
    const instance = await new_test_instance({
      environment: this.shared.environment,
      matchmaker: this.matchmaker,
      db_argument: this.shared.database.db_argument,
      secret_file: this.shared.secret_file,
      server_modules: this.shared.server_modules,
      data_folder: this.shared.data_folder,
      settings: this.shared.settings,
      overrides: this.shared.overrides,
      key_sources: key_sources(this.shared),
      fake_adapters: Object.fromEntries([...this.shared.fakes].map(([key, pair]) => [key, pair.adapter])),
      register: this.register,
      registerDev: this.registerDev,
      clock: this.shared.clock,
      seed_of: (request_id) => seeds.get(request_id) ?? null,
      log_writer: (line) => {
        this.log_lines.push(line);
      },
    });
    const started = await instance.start().catch((error: unknown) => (error instanceof Error ? error.message : String(error)));
    if (typeof started === 'string') {
      const failure = start_failure(started, this.log_lines.slice(first_line));
      const stopped = await instance.stop().then(() => null, (error: unknown) => error);
      throw stopped === null ? failure : with_cleanup_failure(failure, 'stopping the server instance', stopped);
    }
    this.own = { instance, port: started, seeds };
    if (this.shared.environment !== 'LOCAL') return;
    // A LOCAL test server returns after the job runs of server start: a test that moves the clock next does not overlap them.
    const waited = await wait_instance_background(this).then(() => null, (error: unknown) => error);
    if (waited === null) return;
    const stopped = await this.stop_instance().then(() => null, (error: unknown) => error);
    throw stopped === null ? error_of(waited) : with_cleanup_failure(waited, 'stopping the server instance', stopped);
  }

  /** Stops the running instance; the test server object stays for a restart. */
  async stop_instance(): Promise<void> {
    const own = this.own;
    this.own = null;
    if (own !== null) await own.instance.stop();
  }
}

/**
 * The wait of `wait_background` on the running instance of a test server with DEV code: `storage.wait_after_commit`,
 * `server-time.wait_idle`, then `storage.wait_after_commit` again, for at most `testing.backgroundWaitTimeoutMs` of
 * real time; a timeout throws.
 *
 * Three steps leave no chained work behind. `wait_after_commit` waits for every `after_commit` function and user
 * change apply, and for any of those that they start in turn. A scheduler job starts only when the test clock moves
 * (`set_time`, `advance_time`, which the test calls and nothing in the background does), at server start, or again
 * from its own end when it is due, while it still counts as running; a job's `sleep` ends only when the clock moves,
 * too. So background work never starts a job: once step 2 sees the scheduler idle it stays idle, and step 3 waits for
 * the work the jobs started before they ended.
 */
export async function wait_instance_background(server: TestServer): Promise<void> {
  await wait_idle(server.running().instance, testing_setting(server.settings(), 'testing.backgroundWaitTimeoutMs'));
}

/** The wait of `wait_instance_background` on a server instance with DEV code, for at most `timeout` ms of real time. */
export async function wait_idle(instance: ServerInstance, timeout: bigint): Promise<void> {
  const signal = network_time_limit(timeout < 1n ? 1n : timeout);
  const dev = dev_of(instance);
  const idle = (async (): Promise<void> => {
    await dev('storage', 'wait_after_commit', []);
    await dev('server-time', 'wait_idle', []);
    await dev('storage', 'wait_after_commit', []);
  })();
  const timed_out = new Promise<never>((_, reject) => {
    signal.addEventListener('abort', () => {
      reject(new Error(`testing: wait_background did not end within ${String(timeout)} ms`));
    }, { once: true });
  });
  await Promise.race([idle, timed_out]);
}

/**
 * What a server instance of a test server, of a peer (`start_peer_server`) and of a peer process (`start_peer_process`)
 * is made of. They differ only in these values.
 */
export interface TestInstanceParts {
  readonly environment: TestEnvironment;
  readonly matchmaker: boolean;
  /** `--db`: the SQLite file path, or `postgresql`. */
  readonly db_argument: string;
  readonly secret_file: string;
  readonly server_modules: readonly string[];
  readonly data_folder: string;
  readonly settings: SettingsValues;
  readonly overrides: SettingsValues;
  readonly key_sources: Readonly<Record<string, KeySource>>;
  readonly fake_adapters: Readonly<Record<string, unknown>>;
  readonly register: RegisterFunction;
  /** Given only to an instance with DEV code (`LOCAL`). */
  readonly registerDev: RegisterFunction;
  /** Set on a `LOCAL` instance with `server-time.set_clock`. */
  readonly clock: ClockAdapter;
  /** The seed of a request ID, set on a `LOCAL` instance with `storage.set_seed_provider`. */
  readonly seed_of: (request_id: string) => bigint | null;
  readonly log_writer: (line: string) => void;
}

/**
 * A new server instance of `routing.create_server` that has not started (`### isolation`): `--port` 0, no outgoing
 * HTTP, and on `LOCAL` DEV code with the test clock and the seed provider set before `start()`.
 */
export async function new_test_instance(parts: TestInstanceParts): Promise<ServerInstance> {
  const local = parts.environment === 'LOCAL';
  const instance = new_server_instance({
    args: { env: parts.environment, port: 0, matchmaker: parts.matchmaker, db: parts.db_argument, secret_file: parts.secret_file },
    server_modules: parts.server_modules,
    data_folder: parts.data_folder,
    core_settings: parts.settings,
    game_settings: {},
    register: parts.register,
    dev: local,
    register_dev: local ? parts.registerDev : null,
    settings_overrides: parts.overrides,
    key_sources: { ...parts.key_sources },
    http_adapter: () => Promise.reject(new TypeError('fetch failed: a test server has no outgoing HTTP')),
    log_writer: parts.log_writer,
    fake_adapters: { ...parts.fake_adapters },
  });
  if (local) {
    const dev = dev_of(instance);
    await dev('server-time', 'set_clock', [parts.clock]);
    await dev('storage', 'set_seed_provider', [parts.seed_of]);
  }
  return instance;
}

/** A server start failure of `testing`: `message` is the failure reason, field `logs` the log lines read as JSON. */
export class StartFailure extends Error {
  readonly logs: Record<string, unknown>[];

  constructor(reason: string, logs: Record<string, unknown>[]) {
    super(reason);
    this.logs = logs;
  }
}

/** A thrown value as an `Error`. */
function error_of(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value));
}

function message_of(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * The error of a failure whose cleanup failed too: the same `StartFailure` with the cleanup failure added to its
 * message, or a new `Error` with the first one as its cause.
 */
function with_cleanup_failure(error: unknown, cleanup: string, failure: unknown): Error {
  const message = `${message_of(error)}; ${cleanup} failed too: ${message_of(failure)}`;
  if (error instanceof StartFailure) return new StartFailure(message, error.logs);
  return new Error(message, { cause: error });
}

function start_failure(reason: string, lines: readonly string[]): StartFailure {
  const logs: Record<string, unknown>[] = [];
  for (const line of lines) {
    try {
      const parsed: unknown = JSON.parse(line);
      if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) logs.push(parsed as Record<string, unknown>);
    } catch {
      // A line that is not JSON is not a log line object.
    }
  }
  return new StartFailure(reason, logs);
}

/** `routing`'s `dev` of an instance with DEV code. */
export function dev_of(instance: ServerInstance): NonNullable<ServerInstance['dev']> {
  const dev = instance.dev;
  if (dev === undefined) throw new Error('testing: the server instance has no DEV code');
  return dev;
}

/**
 * The key source of each real adapter key: what `set_key_source` set, or `communication_failure` before that. A key
 * source gives the value, or the failure value `timeout` or `communication_failure`.
 */
function key_sources(shared: Shared): Record<string, KeySource> {
  const sources: Record<string, KeySource> = {};
  for (const key of Object.keys(shared.real_adapters)) {
    sources[key] = () => {
      const setting = shared.key_source_settings.get(key);
      if (!shared.key_source_settings.has(key)) return Promise.resolve('communication_failure' satisfies KeySourceFailure);
      return Promise.resolve(setting);
    };
  }
  return sources;
}

function json_type(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value;
}

const ENV_PREFIX = 'environments.<ENV>.';
const ADAPTERS_KEY = `${ENV_PREFIX}adapters`;

/**
 * The spec type of a settings key (`core` `## core settings`): its row of the settings type table, where a path of one
 * environment is the `environments.<ENV>.` row. The table holds every spec row, so a game checkout without `core-spec/`
 * checks the same types as the core checkout.
 */
function spec_type(key: string): string | undefined {
  return SETTING_TYPES[key] ?? SETTING_TYPES[key.replace(/^environments\.[^.]+\./, ENV_PREFIX)];
}

/** True when `value` has the spec settings type `type`: `integer` is a safe integer, `T?` also takes `null`, `array<T>` checks each element. */
function has_type(type: string, value: unknown): boolean {
  if (type.endsWith('?')) return value === null || has_type(type.slice(0, -1), value);
  if (type.startsWith('array<') && type.endsWith('>')) return Array.isArray(value) && value.every((element) => has_type(type.slice('array<'.length, -1), element));
  if (type === 'integer') return typeof value === 'number' && Number.isSafeInteger(value);
  if (type === 'number') return typeof value === 'number' && Number.isFinite(value);
  if (type === 'string' || type === 'boolean') return typeof value === type;
  if (type === 'object') return typeof value === 'object' && value !== null && !Array.isArray(value);
  return false;
}

/**
 * Checks settings overrides: each key is a core settings key or a game settings path core reads, and its value has the
 * spec type of the key. A path with `<ENV>` is the test server's environment item of that path. A key of the settings
 * without a spec row keeps the JSON type of its value in the settings.
 */
export function check_overrides(settings: SettingsValues, overrides: SettingsValues): void {
  for (const [key, value] of Object.entries(overrides)) {
    const type = spec_type(key);
    if (!key.startsWith(ENV_PREFIX) && !(key in settings)) throw new Error(`testing: settings override ${key} is not a core settings key or a game settings value core reads`);
    if (type === undefined && key.startsWith(ENV_PREFIX)) throw new Error(`testing: settings override ${key} is not a game settings value core reads`);
    if (type !== undefined) {
      if (!has_type(type, value)) throw new Error(`testing: settings override ${key} is ${JSON.stringify(value)}, not ${type}`);
      continue;
    }
    const base = json_type(settings[key]);
    if (base !== 'null' && json_type(value) !== base) throw new Error(`testing: settings override ${key} is ${json_type(value)}, not ${base}`);
  }
}

/**
 * The adapter name of each adapter key a test server uses (`### isolation`): `fake` for each adapter key whose module
 * is in the server module list (none on STG), or the test's whole `environments.<ENV>.adapters` override in place of
 * those; then the test's overrides of single adapter keys (`null` removes one); then the real adapter list. A name
 * other than `fake` comes only from the real adapter list.
 */
function adapter_choice(environment: TestEnvironment, modules: readonly string[], real: Readonly<Record<string, string>>, overrides: SettingsValues): Record<string, string> {
  const adapters: Record<string, unknown> = {};
  const whole = overrides[ADAPTERS_KEY];
  if (whole !== undefined) Object.assign(adapters, whole);
  else if (environment === 'LOCAL') {
    for (const [key, owner] of Object.entries(ADAPTER_OWNERS)) if (modules.includes(owner) && !(key in real)) adapters[key] = 'fake';
  }
  for (const [key, value] of Object.entries(overrides)) {
    if (key.startsWith(`${ADAPTERS_KEY}.`)) adapters[key.slice(ADAPTERS_KEY.length + 1)] = value;
  }
  const chosen: Record<string, string> = {};
  for (const [key, name] of Object.entries(adapters)) {
    if (name === null) continue;
    const owner = ADAPTER_OWNERS[key];
    if (owner === undefined) throw new Error(`testing: settings override ${ADAPTERS_KEY} has ${key}, which is not an adapter key`);
    if (key in real) throw new Error(`testing: settings override ${ADAPTERS_KEY} has ${key}, which the real adapter list gives`);
    if (name !== 'fake') throw new Error(`testing: settings override of adapter key ${key} is ${JSON.stringify(name)}; a real or sandbox adapter goes in the real adapter list`);
    if (environment === 'STG') throw new Error('testing: a STG test server has no fake adapter');
    if (!modules.includes(owner)) throw new Error(`testing: module ${owner} of adapter key ${key} is not in the server module list`);
    chosen[key] = name;
  }
  return { ...chosen, ...real };
}

function check_real_adapters(real: Readonly<Record<string, string>>): void {
  for (const [key, name] of Object.entries(real)) {
    if (!(key in ADAPTER_OWNERS)) throw new Error(`testing: ${key} is not an adapter key`);
    if (!is_real_adapter(name)) throw new Error(`testing: ${name} is not a real or sandbox adapter name`);
  }
}

/**
 * The settings overrides a test server gives `create_server`: the test's overrides with `environments.<ENV>.adapters`
 * replaced by the adapter choice and its single adapter key overrides left out, and on STG the new update public key.
 */
function server_overrides(environment: TestEnvironment, overrides: SettingsValues, adapters: Readonly<Record<string, string>>, secrets: TestSecrets): SettingsValues {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(overrides)) if (!key.startsWith(`${ADAPTERS_KEY}.`)) out[key] = value;
  out[ADAPTERS_KEY] = { ...adapters };
  if (environment === 'STG') out[`${ENV_PREFIX}updatePublicKeys`] = [secrets.update_public_key];
  return out;
}

/** The input of `start_test_server`. */
export interface StartInput {
  readonly start_at: bigint | undefined;
  readonly db: DbKind | undefined;
  readonly environment: TestEnvironment | undefined;
  readonly matchmaker: boolean | undefined;
  readonly real_adapters: Readonly<Record<string, string>> | undefined;
  readonly settings: SettingsValues | undefined;
  readonly register: RegisterFunction | undefined;
  readonly registerDev: RegisterFunction | undefined;
  readonly server_modules: readonly string[] | undefined;
  readonly data_folder: string | undefined;
}

/** What `start_test_server` checks and reads before it makes anything. */
interface Plan {
  readonly environment: TestEnvironment;
  readonly kind: DbKind;
  readonly real: Readonly<Record<string, string>>;
  readonly base: SettingsValues;
  readonly overrides: SettingsValues;
  readonly server_modules: readonly string[];
  readonly data_folder: string;
  readonly start_at: bigint;
  readonly adapters: Readonly<Record<string, string>>;
}

/** Checks the input of `start_test_server`; the inputs are also checked at run time, for callers without types. */
function check_start_input(environment: unknown, db: unknown, start_at: unknown): void {
  if (environment !== 'LOCAL' && environment !== 'STG') throw new Error(`testing: environment ${JSON.stringify(environment)} is not LOCAL or STG`);
  if (environment === 'STG' && start_at !== undefined) throw new Error('testing: a STG test server runs on the system clock and takes no start time');
  if (db !== undefined && db !== 'sqlite' && db !== 'postgresql') throw new Error(`testing: DB kind ${JSON.stringify(db)} is not sqlite or postgresql`);
}

function plan_of(input: StartInput): Plan {
  const environment = input.environment ?? 'LOCAL';
  check_start_input(environment, input.db, input.start_at);
  const kind = input.db ?? runner.default_db();
  if (kind === 'postgresql' && runner.postgresql() === null) throw new Error('testing: DB kind postgresql needs OGW_POSTGRESQL, which this run does not give');
  const real = input.real_adapters ?? {};
  check_real_adapters(real);
  const base = base_settings();
  const overrides = input.settings ?? {};
  check_overrides(base, overrides);
  const start_at = input.start_at ?? testing_setting({ ...base, ...overrides }, 'testing.defaultStartAt');
  const server_modules = input.server_modules ?? server_module_list();
  const data_folder = input.data_folder ?? server_data_folder();
  const adapters = adapter_choice(environment, server_modules, real, overrides);
  return { environment, kind, real, base, overrides, server_modules, data_folder, start_at, adapters };
}

/** The shared part of a new test server in `folder`: DB, secret file, fake adapters, clock. */
async function new_shared(plan: Plan, folder: string, database: TestDatabase): Promise<Shared> {
  const secrets = new_secrets(database.connection, Object.values(plan.real));
  const secret_file = join(folder, 'secrets.json');
  writeFileSync(secret_file, JSON.stringify(secrets.file), { mode: 0o600 });
  const adapters = plan.adapters;
  const fakes = new Map<string, FakeAdapterPair>();
  for (const [key, name] of Object.entries(adapters)) if (name === 'fake') fakes.set(key, await new_fake_adapter(key));
  const test_clock = plan.environment === 'LOCAL' ? new TestClock(plan.start_at) : null;
  return {
    folder,
    database,
    secrets,
    secret_file,
    environment: plan.environment,
    settings: plan.base,
    overrides: server_overrides(plan.environment, plan.overrides, adapters, secrets),
    server_modules: plan.server_modules,
    data_folder: plan.data_folder,
    data_version: client_data_version(plan.data_folder),
    adapters,
    real_adapters: plan.real,
    key_source_settings: new Map(),
    fakes,
    test_clock,
    clock: test_clock ?? create_system_clock(),
  };
}

/**
 * Makes a new temporary folder `<prefix><pid>-` and a new test DB of `kind` in it, and runs `step` on them. When the DB
 * or `step` fails, it removes the folder and the DB and throws, with a failed DB removal added to the failure.
 */
export async function with_new_database<T>(kind: DbKind, prefix: string, step: (folder: string, database: TestDatabase) => Promise<T>): Promise<T> {
  const folder = mkdtempSync(join(tmpdir(), `${prefix}${String(process.pid)}-`));
  let database: TestDatabase | null = null;
  try {
    database = await new_database(kind, folder);
    return await step(folder, database);
  } catch (error) {
    rmSync(folder, { recursive: true, force: true });
    const dropped = database === null ? null : await database.drop().then(() => null, (failure: unknown) => failure);
    throw dropped === null ? error : with_cleanup_failure(error, `removing the database ${database?.name ?? ''}`, dropped);
  }
}

/** Starts a new test server (`start_test_server`). On a failure it removes what it made and throws. */
export async function start_test_server(input: StartInput): Promise<TestServer> {
  const plan = plan_of(input);
  const defaults = await default_register();
  return with_new_database(plan.kind, 'ogw-test-server-', async (folder, database) => {
    const shared = await new_shared(plan, folder, database);
    const server = new TestServer(shared, null, input.matchmaker ?? false, input.register ?? defaults.register, input.registerDev ?? defaults.registerDev);
    await server.start_instance();
    return server;
  });
}

/** The test server a peer belongs to; itself for an original test server. */
export function origin_of(server: TestServer): TestServer {
  return server.origin ?? server;
}

/** A failed step of a cleanup and its failure. */
type CleanupFailure = readonly [step: string, failure: unknown];

/** Runs `fn`; its failure as a `CleanupFailure` of `step`, or null. */
function settle(step: string, fn: () => Promise<unknown>): Promise<CleanupFailure | null> {
  return fn().then(
    () => null,
    (failure: unknown) => [step, failure] as const,
  );
}

/** Removes the folder and the DB of a stopped test server; the failure of the DB removal, or null. */
function remove_shared(server: TestServer): Promise<CleanupFailure | null> {
  rmSync(server.shared.folder, { recursive: true, force: true });
  return settle(`removing the database ${server.shared.database.name}`, () => server.shared.database.drop());
}

/**
 * Stops the peers, then the instance, of an original test server and marks it stopped. A failed stop does not keep
 * the others from stopping; the failures come back in order.
 */
async function stop_all(server: TestServer): Promise<CleanupFailure[]> {
  server.stopped = true;
  const failures: CleanupFailure[] = [];
  for (const peer of [...server.peers]) {
    const failed = await settle('stopping a peer', () => stop_peer(peer));
    if (failed !== null) failures.push(failed);
  }
  const failed = await settle('stopping the server instance', () => server.stop_instance());
  if (failed !== null) failures.push(failed);
  return failures;
}

/** Removes the folder and the DB of a stopped test server after the failures so far; throws them all, if any. */
async function remove_and_throw(server: TestServer, failures: CleanupFailure[], context: string): Promise<void> {
  const removed = await remove_shared(server);
  if (removed !== null) failures.push(removed);
  const [first, ...rest] = failures;
  if (first === undefined) return;
  let error = new Error(`testing: ${first[0]} of the ${context} test server failed: ${message_of(first[1])}`, { cause: first[1] });
  for (const [step, failure] of rest) error = with_cleanup_failure(error, step, failure);
  throw error;
}

/**
 * `stop_test_server`: a peer stops alone; an original test server stops with its peers and removes its folder and DB.
 * A failure of a stop or of the DB removal throws, after the rest of the cleanup.
 */
export async function stop_test_server(server: TestServer): Promise<void> {
  server.running();
  if (server.origin !== null) {
    await stop_peer(server);
    return;
  }
  await remove_and_throw(server, await stop_all(server), 'stopped');
}

/** Stops a peer alone. */
async function stop_peer(peer: TestServer): Promise<void> {
  peer.stopped = true;
  peer.origin?.peers.delete(peer);
  await peer.stop_instance();
}

/**
 * `restart_test_server`: stops the peers and the instance, then starts a new instance of the same test server. When a
 * stop or the new start fails, the test server ends: it removes its folder and DB, as `stop_test_server` does, and throws.
 */
export async function restart_test_server(server: TestServer, register: RegisterFunction | undefined, registerDev: RegisterFunction | undefined): Promise<TestServer> {
  server.running();
  if (server.origin !== null) throw new Error('testing: restart_test_server takes the original test server, not a peer');
  const failures = await stop_all(server);
  if (failures.length > 0) await remove_and_throw(server, failures, 'restarted');
  if (register !== undefined) server.register = register;
  if (registerDev !== undefined) server.registerDev = registerDev;
  server.stopped = false;
  try {
    await server.start_instance();
  } catch (error) {
    server.stopped = true;
    const removed = await remove_shared(server);
    throw removed === null ? error : with_cleanup_failure(error, removed[0], removed[1]);
  }
  return server;
}

/** `start_peer_server`: a new server instance on the same DB, secrets, settings, adapters and clock. */
export async function start_peer_server(server: TestServer): Promise<TestServer> {
  const origin = origin_of(server);
  origin.running();
  const peer = new TestServer(origin.shared, origin, false, origin.register, origin.registerDev);
  await peer.start_instance();
  origin.peers.add(peer);
  return peer;
}

/** The test clock of a `LOCAL` test server; throws for `STG`. */
export function test_clock_of(server: TestServer, operation: string): TestClock {
  server.running();
  const clock = server.shared.test_clock;
  if (clock === null) throw new Error(`testing: ${operation} needs a LOCAL test server; a STG test server runs on the system clock`);
  return clock;
}

/** The fake adapter controller of a service (`fake`). */
export function fake_controller(server: TestServer, service: string): unknown {
  server.running();
  if (server.environment === 'STG') throw new Error('testing: a STG test server has no fake adapter');
  const owner = ADAPTER_OWNERS[service];
  if (owner === undefined) throw new Error(`testing: ${service} is not a fake adapter service`);
  if (service in server.shared.real_adapters) throw new Error(`testing: ${service} uses the real adapter ${String(server.shared.real_adapters[service])}`);
  if (!server.shared.server_modules.includes(owner)) throw new Error(`testing: module ${owner} of service ${service} is not in the server module list`);
  const pair = server.shared.fakes.get(service);
  if (pair === undefined) throw new Error(`testing: the test server uses no adapter for ${service}`);
  return pair.controller;
}

/** `set_key_source`: what the key source of a real adapter's key gives from now on. */
export function set_key_source(server: TestServer, adapter_key: string, setting: KeySourceSetting): void {
  server.running();
  if (!(adapter_key in server.shared.real_adapters)) throw new Error(`testing: adapter key ${adapter_key} is not in the real adapter list`);
  server.shared.key_source_settings.set(adapter_key, setting);
}
