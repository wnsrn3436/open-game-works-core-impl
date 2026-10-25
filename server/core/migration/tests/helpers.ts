/**
 * Test instances of `migration` with its dependencies `server-time`, `storage` and `logging`, and the modules a test
 * adds, on the DB of the run's DB kind. The core test data has no game
 * contract with converters (its contract version is 1), so `storage` and `migration` get the test contract of
 * `contract.ts`.
 */
import { AsyncResource } from 'node:async_hooks';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import * as CoreContract from '../../../generated/contract/core_contract.ts';
import { create_logging } from '../../logging/index.ts';
import { module_settings, type ServerInput } from '../../routing/index.ts';
import { create_session } from '../../session/index.ts';
import { create_server_time, type ServerTime } from '../../server-time/index.ts';
import { create_server_time_dev, type ServerTimeDev } from '../../server-time/dev/index.ts';
import { compareVersions, parseVersion } from '../../validation/helper.ts';
import { create_storage_with, type GameTx, type RawRow, type RequestCtx, type Storage } from '../../storage/index.ts';
import { DB_KIND, TestClock, lock_holder, new_db, server_data, type DbTarget, type LockHolder } from '../../storage/tests/helpers.ts';
import { TEST_CONTRACT } from '../../storage/tests/kinds.ts';
import { core_test_server_paths } from '../../testing/dev/index.ts';
import { create_migration_dev, type MigrationDev } from '../dev/index.ts';
import { create_migration_with, type AdminFailure, type Converter, type Migration, type MigrationContract } from '../index.ts';
import { CONVERTER_LIST, MIGRATION_CONTRACT, default_converters } from './contract.ts';

export { DB_KIND, TestClock, lock_holder, new_db, type DbTarget, type LockHolder };

/** The core settings defaults of this run, from `core_test_server_paths`. */
const run_paths = core_test_server_paths();

export const START_AT = 1_800_000_000_000n;
/** Game settings `appId` of the core test data: `user-snapshot-clone` imports only snapshots of this game. */
export const APP_ID = String(run_paths.settings['appId']);

/** Batch settings of the tests: a step every 10 s, a lease of 60 s, two users a step. */
export const SETTINGS: Readonly<Record<string, unknown>> = {
  'migration.batchSize': 2,
  'migration.batchIntervalMs': 10_000,
  'migration.batchLeaseMs': 60_000,
  'migration.maxRecordedFailures': 100,
};

/** The entry file of `user-snapshot-clone`, the DEV dependency `migrate_snapshot` calls `check_snapshot` of. */
const CLONE_ENTRY = new URL('../../user-snapshot-clone/index.ts', import.meta.url);

/**
 * True when this checkout has `user-snapshot-clone`. The tests that need it (`migrate_snapshot` and the snapshot
 * import) are skipped in a checkout without it.
 */
export const CLONE_AVAILABLE = existsSync(fileURLToPath(CLONE_ENTRY));

type CloneFactory = (input: { settings: Readonly<Record<string, unknown>>; modules: Readonly<Record<string, unknown>>; server: ServerInput }) => unknown;

const create_user_snapshot_clone: CloneFactory | null = CLONE_AVAILABLE
  ? ((await import(CLONE_ENTRY.href)) as { create_user_snapshot_clone: CloneFactory }).create_user_snapshot_clone
  : null;

/** A server log line as an object. */
export type LogLine = Readonly<Record<string, unknown>>;

/** A field of a log line, at the top level or in `fields`. */
export function log_field(line: LogLine, name: string): unknown {
  if (Object.hasOwn(line, name)) return line[name];
  const fields = line['fields'];
  return typeof fields === 'object' && fields !== null ? (fields as Record<string, unknown>)[name] : undefined;
}

/** What a module gets besides its dependencies (`server-core` `## module`). */
export interface ModuleInput {
  readonly settings: Readonly<Record<string, unknown>>;
  readonly server: ServerInput;
  readonly modules: Readonly<Record<string, unknown>>;
}

export interface ServerOptions {
  readonly db: DbTarget;
  readonly clock?: TestClock;
  readonly settings?: Readonly<Record<string, unknown>>;
  /** The contract version of this server instance, below `CURRENT` for an older instance; its converters are the ones below it. */
  readonly contract_version?: number;
  /** Converters by `<kind>:<from version>` that replace the defaults of `contract.ts`; null leaves one unregistered. */
  readonly converters?: Readonly<Record<string, Converter | null>>;
  /** Calls between `create_migration` and `begin_start`. */
  readonly before_start?: (migration: Migration) => void;
  /** Calls inside the content `register`, after the converters are registered. */
  readonly register?: (migration: Migration) => void;
  /** Makes more modules after `logging`, in dependency order, from the module input values and the modules so far. */
  readonly extra?: (input: ModuleInput) => readonly (readonly [string, unknown])[];
  /** Also makes `session` and `user-snapshot-clone` (the DEV dependency of migration) after `logging`. */
  readonly clone?: boolean;
  /** Called with each server log line as it is written. */
  readonly on_log?: (line: LogLine) => void;
}

export interface Server {
  readonly db: DbTarget;
  readonly clock: TestClock;
  readonly time: ServerTime;
  readonly time_dev: ServerTimeDev;
  readonly storage: Storage;
  readonly migration: Migration;
  readonly dev: MigrationDev;
  /** The module objects by module name. */
  readonly modules: Readonly<Record<string, Record<string, unknown>>>;
  readonly logs: LogLine[];
  stop(): void;
}

interface Lifecycle {
  begin_start(): void;
  complete_start(): string | null;
  stop(): void;
}

function lifecycle(module: unknown): Lifecycle {
  return module as Lifecycle;
}

/** Registers the converters of `contract.ts`, with `overrides` replacing them by `<kind>:<from version>` (null leaves one unregistered). */
function register_converters(migration: Migration, contract: MigrationContract, overrides: ServerOptions['converters']): void {
  const converters = { ...default_converters(), ...overrides };
  for (const { kind, from_version } of contract.converters) {
    const converter = converters[`${kind}:${String(from_version)}`];
    const info = MIGRATION_CONTRACT.game_kinds.find((k) => k.name === kind);
    if (converter !== null && converter !== undefined && info !== undefined) migration.register_converter(info.kind_class, from_version, converter);
  }
}

/**
 * Starts the modules in dependency order like `routing.create_server`: every `begin_start`, the content `register`
 * (the converters), every `complete_start`. Returns the server start failure reason instead on failure.
 */
export function start_server(options: ServerOptions): Server | string {
  const clock = options.clock ?? new TestClock(START_AT);
  const settings = module_settings('LOCAL', run_paths.settings, {}, { ...SETTINGS, ...options.settings });
  const logs: LogLine[] = [];
  const { data, version } = server_data();
  const names = ['server-time', 'storage', 'logging'];
  const server_modules: string[] = [];
  const server: ServerInput = {
    env: 'LOCAL',
    db: options.db.db,
    dev: true,
    matchmaker: false,
    server_modules,
    data,
    data_version: version,
    client_data_version: version,
    compat_client_data_version: null,
    read_data_file: (): Uint8Array | null => null,
    read_secret: (name: string): string | null => options.db.secrets[name] ?? null,
    fetch: (): Promise<Response> => Promise.reject(new TypeError('fetch failed: the test server has no outgoing HTTP')),
    write_log_line: (line: string): void => {
      const parsed = JSON.parse(line) as LogLine;
      logs.push(parsed);
      options.on_log?.(parsed);
    },
    key_sources: {},
    fake_adapters: {},
    port: (): number => 0,
  };
  const time = create_server_time({ settings, modules: {} });
  const time_dev = create_server_time_dev(time);
  time_dev.set_clock(clock);
  const contract_version = options.contract_version ?? MIGRATION_CONTRACT.contract_version;
  const contract: MigrationContract = { ...MIGRATION_CONTRACT, contract_version, converters: CONVERTER_LIST.filter((c) => c.from_version < contract_version) };
  const storage = create_storage_with({ settings, modules: { 'server-time': time }, server }, { ...TEST_CONTRACT, contract_version });
  const modules: Record<string, Record<string, unknown>> = { 'server-time': time as unknown as Record<string, unknown>, storage: storage as unknown as Record<string, unknown> };
  modules['logging'] = create_logging({ settings, modules: { storage, 'server-time': time }, server }) as unknown as Record<string, unknown>;
  const extra = [...(options.clone === true ? clone_modules({ settings, server, modules }) : []), ...(options.extra?.({ settings, server, modules }) ?? [])];
  for (const [name, module] of extra) {
    modules[name] = module as Record<string, unknown>;
    names.push(name);
  }
  const migration_modules: Record<string, unknown> = { storage, 'server-time': time, logging: modules['logging'] };
  if (modules['user-snapshot-clone'] !== undefined) migration_modules['user-snapshot-clone'] = modules['user-snapshot-clone'];
  const migration = create_migration_with({ settings, modules: migration_modules, server }, contract);
  modules['migration'] = migration as unknown as Record<string, unknown>;
  names.push('migration');
  server_modules.push(...[...names].sort());
  const dev = create_migration_dev(migration);
  options.before_start?.(migration);
  const ordered = names.map((name) => lifecycle(modules[name]));
  const stop = (): void => {
    for (const module of [...ordered].reverse()) module.stop();
  };
  for (const module of ordered) module.begin_start();
  register_converters(migration, contract, options.converters);
  options.register?.(migration);
  for (const module of ordered) {
    const failure = module.complete_start();
    if (failure !== null) {
      stop();
      return failure;
    }
  }
  // Server start ends: every job runs once.
  time.end_start();
  return { db: options.db, clock, time, time_dev, storage, migration, dev, modules, logs, stop };
}

/**
 * `session` and `user-snapshot-clone` with their dependencies, as `routing` makes them. Of `validation`,
 * `user-snapshot-clone` calls only `parse_version` and `compare_versions`.
 */
function clone_modules(input: ModuleInput): (readonly [string, unknown])[] {
  if (create_user_snapshot_clone === null) throw new Error('this checkout has no user-snapshot-clone');
  const { storage, logging } = input.modules;
  const time = input.modules['server-time'];
  const validation = { parse_version: parseVersion, compare_versions: compareVersions };
  const session = create_session({ settings: input.settings, modules: { storage, 'server-time': time }, server: input.server });
  const clone = create_user_snapshot_clone({ settings: input.settings, modules: { validation, storage, session, 'server-time': time, logging }, server: input.server });
  return [
    ['session', session],
    ['user-snapshot-clone', clone],
  ];
}

/** Servers to stop after each test. */
const running: Server[] = [];

/**
 * A started server instance, once the job run of its server start is over (`testing.start_test_server` waits for it
 * the same way). Otherwise that run's `migration_batch` step could read a batch the test starts after and take its
 * lease.
 */
export async function server(options: Partial<ServerOptions> = {}): Promise<Server> {
  const started = start_server({ ...options, db: options.db ?? (await new_db()) });
  if (typeof started === 'string') throw new Error(`server start failed: ${started}`);
  running.push(started);
  await wait_background(started);
  return started;
}

export function stop_all(): void {
  for (const s of running.splice(0)) s.stop();
}

/** Waits until the jobs and `after_commit` functions started so far have ended (`testing.wait_background`). */
export async function wait_background(s: Server): Promise<void> {
  await s.storage.wait_after_commit();
  await s.time_dev.wait_idle();
}

/** Moves the clock by one batch interval and waits for the job (`testing.advance_time` and `wait_background`). */
export async function next_step(s: Server, ms = BigInt(SETTINGS['migration.batchIntervalMs'] as number)): Promise<void> {
  s.clock.advance(ms);
  await wait_background(s);
}

export function new_user(s: Server): Promise<bigint> {
  return s.storage.run_game_transaction((tx: GameTx) => s.storage.create_user(tx).user_id) as Promise<bigint>;
}

const FIELDS = { request_name: 'Test', request_id: 'r-1', silent: false, retry: false, session_id: '', client_version: '', platform: '' };

/** A request transaction with a sync handler. */
export function request<T>(s: Server, user_id: bigint, fn: (ctx: RequestCtx) => T): Promise<T | 'FAILED' | 'WITHDRAWN'> {
  return s.storage.run_request_transaction(user_id, FIELDS, fn);
}

/** A raw row of a UserState, server state or game state item. */
export function row(table: string, column: string, item_id: bigint, version: bigint, value: { encode(): Uint8Array }): RawRow {
  return { table, key: `${column}/${String(item_id)}`, contract_version: version, value: value.encode() };
}

/** Replaces the user's snapshot rows (`user_state`, `server_state`) with raw rows that keep their contract version. */
export async function seed(s: Server, user_id: bigint, rows: readonly RawRow[]): Promise<void> {
  const result = await s.storage.run_user_transaction(user_id, (ctx) => {
    s.storage.replace_user_rows(ctx, rows);
    return 'pass';
  });
  if (result !== 'COMMITTED') throw new Error(`seed: ${result}`);
}

/** Writes `game_state` raw rows as they are. */
export async function seed_game(s: Server, rows: readonly RawRow[]): Promise<void> {
  // A number result of a game transaction is a failure code that rolls it back, so the count is not returned.
  const result = await s.storage.run_game_transaction((tx) => {
    s.storage.replace_game_rows(tx, rows);
    return 'pass';
  });
  if (result !== 'pass') throw new Error(`seed_game: ${result}`);
}

/** The stored row of an item: its bytes and contract version, or null. */
export function stored(s: Server, table: string, user_id: bigint | null, column: string, item_id: bigint): { value: Uint8Array; contract_version: bigint } | null {
  const rows =
    table === 'game_state'
      ? s.storage.read_db().query('SELECT value, contract_version FROM game_state WHERE kind = $1 AND key = $2', [column, item_id])
      : s.storage.read_db().query(`SELECT value, contract_version FROM ${table} WHERE user_id = $1 AND kind = $2 AND item_id = $3`, [user_id, column, item_id]);
  const found = rows[0];
  return found === undefined ? null : { value: found['value'] as Uint8Array, contract_version: found['contract_version'] as bigint };
}

/** Every row of the tables a migration test can touch, for before/after comparisons. */
export function dump(s: Server): string {
  const tables = ['"user"', 'user_state', 'server_state', 'pending_delta', 'game_state', 'migration_converter', 'migration_batch'];
  return JSON.stringify(
    tables.map((t) => s.storage.read_db().query(`SELECT * FROM ${t}`).map((r) => JSON.stringify(r, (_k, v: unknown) => (typeof v === 'bigint' ? `${String(v)}n` : v instanceof Uint8Array ? Buffer.from(v).toString('hex') : v))).sort()),
  );
}

/** The batch record by its `migration_batch` columns, read through the read connection. */
export function batch_row(s: Server): Readonly<Record<string, unknown>> | null {
  return s.storage.read_db().query('SELECT * FROM migration_batch ORDER BY started_at DESC, batch_id DESC LIMIT 1')[0] ?? null;
}

/**
 * Calls an admin operation the way `admin-api` does for an operation without `user_target`: the handler in a game
 * transaction (read only for role `read`) that rolls back on a failure reason.
 */
export async function admin(s: Server, name: 'start_migration_batch' | 'get_migration_batch' | 'stop_migration_batch'): Promise<Record<string, unknown> | AdminFailure> {
  const operation = s.migration[name];
  let failure = null as AdminFailure | null;
  const result = await s.storage.run_game_transaction((tx) => {
    const call = (): Record<string, unknown> | AdminFailure => operation.handler({}, tx, undefined, null);
    const output = operation.role === 'read' ? s.storage.run_read_only(tx, call) : call();
    if (typeof output === 'string') {
      failure = output;
      return CoreContract.CoreError.CORE_ERROR_INTERNAL;
    }
    return output;
  });
  if (failure !== null) return failure;
  if (result === 'FAILED' || typeof result === 'number') throw new Error(`admin ${name}: the game transaction failed`);
  return result;
}

const bound_outside = AsyncResource.bind((fn: () => unknown): unknown => fn());

/** Calls the function outside any transaction's async context: a hook uses it to start a transaction while one is open. */
export function outside<T>(fn: () => T): T {
  return bound_outside(fn) as T;
}

/** A connection of the test's own thread to the SQLite test database, to hold the write lock between transactions. */
export function sqlite_lock(target: DbTarget): { hold(): void; release(): void; close(): void } {
  const db = new DatabaseSync(target.db);
  return {
    hold: () => {
      db.exec('BEGIN IMMEDIATE');
    },
    release: () => {
      db.exec('ROLLBACK');
    },
    close: () => {
      db.close();
    },
  };
}

/** The `sha256` of snapshot records: the records with keys in byte order, without spaces. */
export function records_sha256(records: readonly Record<string, unknown>[]): string {
  const sorted = records.map((r) => Object.fromEntries(Object.keys(r).sort().map((k) => [k, r[k]])));
  return createHash('sha256').update(JSON.stringify(sorted), 'utf8').digest('hex');
}

/** A snapshot record of a raw row. */
export function snapshot_record(raw: RawRow): Record<string, unknown> {
  return { table: raw.table, key: raw.key, contract_version: Number(raw.contract_version), value: Buffer.from(raw.value).toString('base64') };
}

/** A snapshot (`user-snapshot-clone` `### snapshot`) of raw rows, or a game state snapshot when `user` is null. */
export function snapshot(raws: readonly RawRow[], user: { source_user_id: string; user_created_at: string } | null, contract_version = 1): Record<string, unknown> {
  const order = (a: string, b: string): number => Buffer.compare(Buffer.from(a, 'utf8'), Buffer.from(b, 'utf8'));
  const records = raws.map(snapshot_record).sort((a, b) => order(String(a['table']), String(b['table'])) || order(String(a['key']), String(b['key'])));
  return {
    format: 1,
    app_id: APP_ID,
    source_environment: 'PROD',
    ...(user === null ? {} : user),
    exported_at: String(START_AT),
    contract_version,
    data_version: server_data().version,
    core_version: '0.0.0',
    records,
    sha256: records_sha256(records),
  };
}
