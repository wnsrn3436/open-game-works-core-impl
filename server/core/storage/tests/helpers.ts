/**
 * Test instances of `storage` with its dependency `server-time`, on SQLite or PostgreSQL by the run's DB kind.
 */
import { AsyncResource } from 'node:async_hooks';
import { mkdtempSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Worker } from 'node:worker_threads';
import * as GameData from '../../../generated/data/game_data.ts';
import { create_server_time, type ClockAdapter, type ServerTime } from '../../server-time/index.ts';
import { create_server_time_dev } from '../../server-time/dev/index.ts';
import type { PgRow, PgValue } from '../db/pg_protocol.ts';
import { create_storage_dev } from '../dev/index.ts';
import type { ServerInput } from '../../routing/index.ts';
import { create_storage_with, type GameTx, type Storage } from '../index.ts';
import type { RequestCtx } from '../request_ctx.ts';
import type { RequestFields } from '../tx.ts';
import { core_test_server_paths, default_db_kind, new_core_test_server_input } from '../../testing/dev/index.ts';
import { TEST_CONTRACT } from './kinds.ts';
import type { HolderInput, HolderRequest, HolderResult } from './lock_holder.ts';

export type DbKind = 'sqlite' | 'postgresql';

/** Where an instance's database is: `--db` and the secret file's `db`. */
export interface DbTarget {
  readonly kind: DbKind;
  readonly db: string;
  readonly secrets: Readonly<Record<string, string>>;
}

/** The run's DB kind. */
export const DB_KIND: DbKind = default_db_kind();

/** A clock that moves only when the test moves it. */
export class TestClock implements ClockAdapter {
  readonly real_time = false;
  private time: bigint;
  private readonly listeners = new Set<() => void>();

  constructor(time: bigint) {
    this.time = time;
  }

  now(): bigint {
    return this.time;
  }

  advance(ms: bigint): void {
    this.time += ms;
    for (const listener of [...this.listeners]) listener();
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}

export const START_TIME = 1_800_000_000_000n;

/** A new empty database of the run's DB kind. */
export async function new_db(kind: DbKind = DB_KIND): Promise<DbTarget> {
  if (kind === 'sqlite') return { kind, db: join(mkdtempSync(join(tmpdir(), 'storage-test-')), 'test.db'), secrets: {} };
  const { database } = await new_core_test_server_input(kind);
  if (database.connection === null) throw new Error('new_core_test_server_input gave no PostgreSQL connection');
  return { kind, db: database.db_argument, secrets: { db: database.connection } };
}

/** The outgoing HTTP adapter of a test server: the global `fetch` signature that the tests' fakes give. */
export type TestFetch = ServerInput['fetch'];

/** The module input `server` of a test server instance: `routing`'s type of every field of `server-core` `## module`. */
export type TestServer = ServerInput;

export interface TestServerOptions {
  readonly env?: TestServer['env'];
  /** DEV code in the server instance. Default: not STG and not PROD. */
  readonly dev?: boolean;
  readonly matchmaker?: boolean;
  /** The server module list. Default: `server-time` and `storage`. */
  readonly server_modules?: readonly string[];
  /** `--secret-file` values besides the database's `db`. */
  readonly secrets?: Readonly<Record<string, string>>;
  /** The outgoing HTTP adapter override. Default: a fetch that rejects. */
  readonly fetch?: TestFetch;
  /** The log line writer override. Default: drops the line. */
  readonly write_log_line?: (line: string) => void;
  readonly key_sources?: ServerInput['key_sources'];
  readonly fake_adapters?: Readonly<Record<string, unknown>>;
}

/**
 * The module input `server` of a test server on `db` and the core test data's server build data. `create_server`
 * gives one `server` to every module, so a test passes the same object to each module it starts.
 */
export function test_server(db: DbTarget, options: TestServerOptions = {}): TestServer {
  const env = options.env ?? 'LOCAL';
  const build = server_data();
  const secrets: Readonly<Record<string, string>> = { ...db.secrets, ...options.secrets };
  return {
    env,
    db: db.db,
    dev: options.dev ?? (env !== 'STG' && env !== 'PROD'),
    matchmaker: options.matchmaker ?? false,
    server_modules: options.server_modules ?? ['server-time', 'storage'],
    data: build.data,
    data_version: build.version,
    client_data_version: build.client_version,
    compat_client_data_version: build.compat_client_version,
    read_data_file: (name) => build.files.get(name) ?? null,
    read_secret: (name) => secrets[name] ?? null,
    fetch: options.fetch ?? (() => Promise.reject(new Error('no outgoing HTTP in this test'))),
    write_log_line: options.write_log_line ?? (() => undefined),
    key_sources: options.key_sources ?? {},
    fake_adapters: options.fake_adapters ?? {},
    port: () => 0,
  };
}

export interface ServerData {
  readonly data: GameData.DataSet;
  readonly version: string;
  readonly client_version: string;
  readonly compat_client_version: string | null;
  /** The files of the server build data folder by name. */
  readonly files: ReadonlyMap<string, Uint8Array>;
}

let data_cache: ServerData | null = null;

/** The server build data of the core test data, from the folder `core_test_server_paths` gives. */
export function server_data(): ServerData {
  if (data_cache !== null) return data_cache;
  const folder = core_test_server_paths().data_folder;
  const files = new Map<string, Uint8Array>();
  for (const name of readdirSync(folder)) files.set(name, readFileSync(join(folder, name)));
  const data = GameData.load_data_set(files);
  if (data === null) throw new Error('the server build data does not load');
  const text = (name: string): string | null => {
    const bytes = files.get(name);
    return bytes === undefined ? null : Buffer.from(bytes).toString('utf8').trim();
  };
  const version = text('data_version');
  const client_version = text('client_data_version');
  if (version === null || client_version === null) throw new Error('the server build data has no data_version or client_data_version');
  data_cache = { data, version, client_version, compat_client_version: text('compat_client_data_version'), files };
  return data_cache;
}

/** The core settings defaults of this core. */
export function core_settings(): Record<string, unknown> {
  return JSON.parse(readFileSync(new URL('../../../../settings/core-settings.json', import.meta.url), 'utf8')) as Record<string, unknown>;
}

export interface InstanceOptions {
  readonly db: DbTarget;
  readonly clock?: TestClock;
  readonly settings?: Readonly<Record<string, unknown>>;
  /** Fields of the module input `server` that replace the test server's. */
  readonly server?: Partial<TestServer>;
  /** Registrations between `begin_start` and `complete_start`, like core modules and content `register`. */
  readonly register?: (storage: Storage) => void;
  readonly offset?: (user_id: bigint) => bigint;
  readonly seed?: (request_id: string) => bigint | null;
}

export interface Instance {
  readonly db: DbTarget;
  readonly storage: Storage;
  readonly time: ServerTime;
  readonly clock: TestClock;
  stop(): void;
}

/** Starts `server-time` and `storage` in dependency order. Returns the start failure reason instead on failure. */
export function start_instance(options: InstanceOptions): Instance | string {
  const clock = options.clock ?? new TestClock(START_TIME);
  const time = create_server_time({ settings: { 'server-time.silentMarginMs': 5000, dailyResetOffsetMs: 0 }, modules: {} });
  const time_dev = create_server_time_dev(time);
  time_dev.set_clock(clock);
  const offset = options.offset;
  if (offset !== undefined) time_dev.register_offset_provider((user_id) => offset(user_id));
  const server = { ...test_server(options.db), ...options.server };
  const storage = create_storage_with({ settings: { ...core_settings(), ...options.settings }, modules: { 'server-time': time }, server }, TEST_CONTRACT);
  if (options.seed !== undefined) create_storage_dev(storage).set_seed_provider(options.seed);
  time.begin_start();
  storage.begin_start();
  options.register?.(storage);
  const time_failure = time.complete_start();
  const failure = time_failure ?? storage.complete_start();
  const stop = (): void => {
    storage.stop();
    time.stop();
  };
  if (failure !== null) {
    stop();
    return failure;
  }
  // Server start ends: every job runs once.
  time.end_start();
  return { db: options.db, storage, time, clock, stop };
}

export function started(options: InstanceOptions): Instance {
  const instance = start_instance(options);
  if (typeof instance === 'string') throw new Error(`server start failed: ${instance}`);
  return instance;
}

/** Instances to stop after each test. */
const running: Instance[] = [];

export async function instance(options: Partial<InstanceOptions> = {}): Promise<Instance> {
  const created = started({ ...options, db: options.db ?? (await new_db()) });
  running.push(created);
  return created;
}

export function stop_all(): void {
  for (const i of running.splice(0)) i.stop();
  for (const h of holders.splice(0)) void h.terminate();
}

export function new_user(storage: Storage): Promise<bigint> {
  return storage.run_game_transaction((tx: GameTx) => storage.create_user(tx)) as Promise<bigint>;
}

export const FIELDS: RequestFields = { request_name: 'Test', request_id: 'r-1', silent: false, retry: false, session_id: '', client_version: '', platform: '' };

export function fields(request_id: string): RequestFields {
  return { ...FIELDS, request_id };
}

/** A request transaction with a sync handler. */
export function request<T>(storage: Storage, user_id: bigint, fn: (ctx: RequestCtx) => T): Promise<T | 'FAILED' | 'WITHDRAWN'> {
  return storage.run_request_transaction(user_id, FIELDS, fn);
}

/** A promise the test resolves later. */
export function gate(): { promise: Promise<void>; open: () => void } {
  let open: () => void = () => undefined;
  const promise = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { promise, open };
}

/** Lets queued promise callbacks and I/O callbacks run. */
export function settle(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

/** Rows of a base table of a user through the read connection, for before/after comparisons. */
export function raw_rows(storage: Storage, table: string, user_id: bigint): string[] {
  return storage
    .read_db()
    .query(`SELECT * FROM ${table} WHERE user_id = $1`, [user_id])
    .map((row) => JSON.stringify(row, (_, v: unknown) => (typeof v === 'bigint' ? `${String(v)}n` : v instanceof Uint8Array ? Buffer.from(v).toString('hex') : v)))
    .sort();
}

const bound_outside = AsyncResource.bind((fn: () => unknown): unknown => fn());

/**
 * Calls the function in the async context of this module's load, outside any transaction: a transaction function uses
 * it to start another transaction while its own one is open.
 */
export function outside<T>(fn: () => T): T {
  return bound_outside(fn) as T;
}

/** Holder workers to stop after each test. */
const holders: Worker[] = [];

/** One connection of another thread to the test database, like a transaction of another server instance. */
export interface LockHolder {
  /** Runs one statement after `delay_ms`, after the statements sent before it. Resolves with its outcome. */
  run(sql: string, params?: readonly PgValue[], delay_ms?: number): Promise<HolderResult>;
  /** `run` that throws when the statement fails. */
  ok(sql: string, params?: readonly PgValue[]): Promise<PgRow[]>;
}

export async function lock_holder(target: DbTarget): Promise<LockHolder> {
  const input: HolderInput = { kind: target.kind, target: target.kind === 'sqlite' ? target.db : (target.secrets.db ?? '') };
  const worker = new Worker(new URL('./lock_holder.ts', import.meta.url), { workerData: input });
  holders.push(worker);
  const waiting = new Map<number, (result: HolderResult) => void>();
  const ready = gate();
  worker.on('message', (message: { id: number; result: HolderResult }) => {
    if (message.id === 0) ready.open();
    waiting.get(message.id)?.(message.result);
    waiting.delete(message.id);
  });
  await ready.promise;
  let next = 1;
  const run = (sql: string, params: readonly PgValue[] = [], delay_ms = 0): Promise<HolderResult> =>
    new Promise((resolve) => {
      const id = next;
      next += 1;
      waiting.set(id, resolve);
      worker.postMessage({ id, sql, params, delay_ms } satisfies HolderRequest);
    });
  return {
    run,
    ok: async (sql, params) => {
      const result = await run(sql, params);
      if (!result.ok) throw new Error(`lock holder: ${sql}: ${result.code}`);
      return result.rows;
    },
  };
}

/** The statement that takes the lock of `lock_game_row(table, key)` on PostgreSQL. */
export const PG_LOCK_SQL = 'SELECT pg_advisory_xact_lock(CAST($1 AS BIGINT)) AS locked';

/** A test server of `testing` with its running server instance. */
export interface RunningServer {
  running(): { readonly instance: { modules(): ReadonlyMap<string, unknown> } };
}

/**
 * The `storage` module object of a test server's running instance. Content `register(core)` gets only its member
 * `content`, so a test that reads or writes the database directly takes the module object.
 */
export function storage_module(server: RunningServer): Storage {
  const storage = server.running().instance.modules().get('storage');
  if (storage === undefined) throw new Error('the server instance has no storage module');
  return storage as Storage;
}
