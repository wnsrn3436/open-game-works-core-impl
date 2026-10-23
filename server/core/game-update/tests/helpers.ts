/**
 * A test server instance of `game-update` with its dependencies `server-time`, `storage` and `logging` on SQLite or
 * PostgreSQL by the run's DB kind. `admin` plays the part of `admin-api`'s processing step (input fields, the
 * prepare function outside the transaction, the handler function in a game tx, `run_read_only` for role `read`,
 * rollback on a failure reason) and `get` the part of `routing` that hands a path to a route method.
 */
import { createHash, createPrivateKey, createPublicKey, randomBytes, verify } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { create_logging_dev } from '../../logging/dev/index.ts';
import { create_logging, type Logging } from '../../logging/index.ts';
import { create_server_time_dev } from '../../server-time/dev/index.ts';
import { create_server_time, type ServerTime } from '../../server-time/index.ts';
import { create_storage_dev, type StorageDev } from '../../storage/dev/index.ts';
import { create_storage, type GameTx, type Storage } from '../../storage/index.ts';
import { core_test_server_paths } from '../../testing/dev/index.ts';
import { core_settings, new_db, stop_all as stop_holders, test_server, TestClock, type DbTarget } from '../../storage/tests/helpers.ts';
import { create_fake_adapter, create_game_update_dev, type FakeCdnController } from '../dev/index.ts';
import { create_game_update, type AdminOperation, type GameUpdate, type OutgoingHttp, type RouteResponse } from '../index.ts';

export const START_AT = 1_800_000_000_000n;

/** `cdn` adapter `fake` in this environment (the core test data has no `cdn` adapter key). */
export const FAKE_CDN: Readonly<Record<string, unknown>> = { 'environments.<ENV>.adapters.cdn': 'fake' };

export interface StartOptions {
  readonly environment?: 'LOCAL' | 'DEV' | 'STG' | 'PROD';
  readonly settings?: Readonly<Record<string, unknown>>;
  /** `compat_client_data_version` of the server build data. Default: none. */
  readonly compat?: string | null;
  /** The `--secret-file` values. Default: a new `updateSigningKey`. */
  readonly secrets?: Readonly<Record<string, string>>;
  /** The outgoing HTTP adapter `fetch` of the module input `server`. Default: every request fails. */
  readonly fetch?: OutgoingHttp;
}

/** A server start failure: its reason and the log lines written up to then. */
export interface StartFailure {
  readonly reason: string;
  readonly lines: readonly string[];
}

interface Shared {
  readonly db: DbTarget;
  readonly clock: TestClock;
  readonly fake: { readonly adapter: unknown; readonly controller: FakeCdnController };
  readonly options: StartOptions;
  readonly secrets: Readonly<Record<string, string>>;
}

export interface TestServer {
  readonly shared: Shared;
  readonly time: ServerTime;
  readonly storage: Storage;
  readonly storage_dev: StorageDev;
  readonly logging: Logging;
  readonly game_update: GameUpdate;
  readonly lines: string[];
  readonly clock: TestClock;
  stop(): void;
}

export interface AdminAnswer {
  readonly status: number;
  readonly body: Record<string, unknown>;
}

export interface RawAnswer {
  readonly status: number;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: Uint8Array;
}

const running: TestServer[] = [];

afterEach(() => {
  for (const server of running.splice(0).reverse()) server.stop();
  stop_holders();
});

function new_signing_seed(): string {
  return randomBytes(32).toString('base64');
}

const SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex');

/** The Ed25519 public key (standard base64) of a 32 byte seed (standard base64). */
export function public_key_of(seed_base64: string): string {
  const pkcs8 = Buffer.concat([Buffer.from('302e020100300506032b657004220420', 'hex'), Buffer.from(seed_base64, 'base64')]);
  const spki = createPublicKey(createPrivateKey({ key: pkcs8, format: 'der', type: 'pkcs8' })).export({ format: 'der', type: 'spki' });
  return spki.subarray(SPKI_PREFIX.length).toString('base64');
}

/** Starts a server instance on `shared`. Returns the server start failure instead on failure. */
function launch(shared: Shared): TestServer | StartFailure {
  const { options, db, clock, secrets } = shared;
  const env = options.environment ?? 'LOCAL';
  const dev = env === 'LOCAL';
  const time = create_server_time({ settings: { 'server-time.silentMarginMs': 5000, dailyResetOffsetMs: 0 }, modules: {} });
  if (dev) create_server_time_dev(time).set_clock(clock);
  const signing_seed = secrets.updateSigningKey;
  const settings: Record<string, unknown> = {
    ...core_settings(),
    'environments.<ENV>.adapters.analytics': null,
    'environments.<ENV>.adapters.cdn': null,
    'environments.<ENV>.updatePublicKeys': env !== 'LOCAL' && signing_seed !== undefined ? [public_key_of(signing_seed)] : [],
    'environments.<ENV>.secrets.updateSigningKey': '',
    'environments.<ENV>.secrets.cdn': '',
    'environments.<ENV>.cdnR2': {},
    ...options.settings,
  };
  const lines: string[] = [];
  const base_server = test_server(db, {
    env,
    dev,
    server_modules: ['server-time', 'storage', 'logging', 'game-update'],
    secrets,
    write_log_line: (line) => lines.push(line),
    fake_adapters: dev ? { cdn: shared.fake.adapter } : {},
    ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
  });
  const input_server = { ...base_server, compat_client_data_version: options.compat ?? null };
  const storage = create_storage({ settings, modules: { 'server-time': time }, server: input_server });
  const storage_dev = create_storage_dev(storage);
  const logging = create_logging({ settings, modules: { storage, 'server-time': time }, server: input_server });
  if (dev) create_logging_dev(logging);
  const game_update = create_game_update({ settings, modules: { storage, 'server-time': time, logging }, server: input_server });
  if (dev) create_game_update_dev(game_update);
  const modules = [time, storage, logging, game_update];
  for (const module of modules) module.begin_start();
  let failure: string | null = null;
  for (const module of modules) failure ??= module.complete_start();
  const stop = (): void => {
    for (const module of [...modules].reverse()) module.stop();
  };
  if (failure !== null) {
    stop();
    return { reason: failure, lines };
  }
  // Server start ends: every job runs once.
  time.end_start();
  const server: TestServer = { shared, time, storage, storage_dev, logging, game_update, lines, clock, stop };
  running.push(server);
  return server;
}

/** Starts a test server on a new DB, or gives the server start failure. */
export async function start_server(options: StartOptions = {}): Promise<TestServer | StartFailure> {
  const secrets = options.secrets ?? { updateSigningKey: new_signing_seed() };
  return launch({ db: await new_db(), clock: new TestClock(START_AT), fake: create_fake_adapter('cdn'), options, secrets });
}

export async function start(options: StartOptions = {}): Promise<TestServer> {
  const server = await start_server(options);
  if (is_start_failure(server)) throw new Error(`server start failed: ${server.reason}`);
  return server;
}

/**
 * Another server instance on the same DB, clock, secrets, settings and fake adapter; its own cache and scheduler.
 * `compat` gives it other server build data.
 */
export function peer(server: TestServer, compat?: string | null): TestServer {
  const shared = compat === undefined ? server.shared : { ...server.shared, options: { ...server.shared.options, compat } };
  const other = launch(shared);
  if (is_start_failure(other)) throw new Error(`peer start failed: ${other.reason}`);
  return other;
}

export function is_start_failure(value: TestServer | StartFailure): value is StartFailure {
  return 'reason' in value;
}

/** A start failure, or throws when the server started. */
export async function start_failure(options: StartOptions): Promise<StartFailure> {
  const server = await start_server(options);
  if (!is_start_failure(server)) throw new Error('the server started');
  return server;
}

/** The parsed log lines of `kind` among `lines`. */
export function log_lines(lines: readonly string[], kind: string): Record<string, unknown>[] {
  return lines.map((line) => JSON.parse(line) as Record<string, unknown>).filter((line) => line.kind === kind);
}

export function stop(server: TestServer): void {
  const index = running.indexOf(server);
  if (index >= 0) running.splice(index, 1);
  server.stop();
}

const STATUS: Readonly<Record<string, number>> = { bad_request: 400, not_found: 404, conflict: 409, internal: 500, external_failed: 502 };

class Rollback extends Error {
  readonly reason: string;
  constructor(reason: string) {
    super(reason);
    this.reason = reason;
  }
}

function json_body(value: unknown): Record<string, unknown> {
  return JSON.parse(JSON.stringify(value, (_key, v: unknown) => (typeof v === 'bigint' ? v.toString() : v))) as Record<string, unknown>;
}

function operation_of(server: TestServer, name: string): AdminOperation {
  const operation = (server.game_update as unknown as Record<string, unknown>)[name] as AdminOperation | undefined;
  if (operation?.name !== name) throw new Error(`no admin operation ${name}`);
  return operation;
}

/** One admin operation through `admin-api`'s step 6, with the input field check of step 5. */
async function run_admin(server: TestServer, operation: AdminOperation, input: Record<string, unknown>, body: Uint8Array | null): Promise<AdminAnswer> {
  const fields = Object.keys(input);
  const known = fields.every((field) => field in operation.input);
  const complete = Object.entries(operation.input).every(([field, spec]) => spec.optional || field in input);
  if (!known || !complete) return { status: 400, body: { error: 'bad_request' } };
  let prepared: unknown = null;
  if (operation.prepare !== null) {
    prepared = await operation.prepare(input, body);
    if (typeof prepared === 'string') return { status: STATUS[prepared] ?? 500, body: { error: prepared } };
  }
  const { storage } = server;
  try {
    const output = await storage.run_game_transaction((tx: GameTx) => {
      const run = (): ReturnType<AdminOperation['handler']> => operation.handler(input, tx, prepared, body);
      const result = operation.role === 'read' ? storage.run_read_only(tx, run) : run();
      if (typeof result === 'string') throw new Rollback(result);
      return result;
    });
    if (output === 'FAILED') return { status: 500, body: { error: 'internal' } };
    return { status: 200, body: json_body(output) };
  } catch (error) {
    if (error instanceof Rollback) return { status: STATUS[error.reason] ?? 500, body: { error: error.reason } };
    throw error;
  }
}

export function admin(server: TestServer, name: string, input: Record<string, unknown> = {}): Promise<AdminAnswer> {
  return run_admin(server, operation_of(server, name), input, null);
}

/** `put_update_file` with its binary body: over `max_body_bytes` is step 1's `bad_request`. */
export function put_file(server: TestServer, bytes: Uint8Array, sha256 = sha256_of(bytes)): Promise<AdminAnswer> {
  const operation = operation_of(server, 'put_update_file');
  if (bytes.byteLength > (operation.max_body_bytes ?? 0)) return Promise.resolve({ status: 400, body: { error: 'bad_request' } });
  return run_admin(server, operation, { sha256 }, bytes);
}

/** `put_update_file`'s handler function with a body that skips step 1's `max_body_bytes` check. */
export function put_file_past_body_limit(server: TestServer, bytes: Uint8Array): Promise<AdminAnswer> {
  return run_admin(server, operation_of(server, 'put_update_file'), { sha256: sha256_of(bytes) }, bytes);
}

/** `max_body_bytes` of an admin operation. */
export function max_body_bytes(server: TestServer, name: string): number | null {
  return operation_of(server, name).max_body_bytes;
}

const ROUTES: readonly { readonly route: string; readonly match: (path: string) => boolean }[] = [
  { route: 'GET /update/deploy_list.json', match: (path) => path === '/update/deploy_list.json' },
  { route: 'GET /update/deploy_list.json.sig', match: (path) => path === '/update/deploy_list.json.sig' },
  { route: 'GET /update/files/<sha256>', match: (path) => /^\/update\/files\/[^/]+$/.test(path) },
];

/** A `GET` through the route method `routing` would pick; a path no route has is HTTP 404. */
export function get(server: TestServer, path: string): RawAnswer {
  const found = ROUTES.find((route) => route.match(path));
  if (found === undefined) return { status: 404, headers: {}, body: new Uint8Array() };
  const handler = (server.game_update as unknown as Record<string, (request: unknown, ip: string) => RouteResponse>)[found.route];
  if (handler === undefined) throw new Error(`no route method ${found.route}`);
  const response = handler({ method: 'GET', path, query: '', headers: {} }, '203.0.113.1');
  const headers: Record<string, string> = {};
  for (const [name, value] of Object.entries(response.headers ?? {})) headers[name.toLowerCase()] = value;
  const body = response.body ?? new Uint8Array();
  return { status: response.status, headers, body: typeof body === 'string' ? Buffer.from(body, 'utf8') : body };
}

export function set_time(server: TestServer, ms: bigint): void {
  server.clock.advance(ms - server.clock.now());
}

export function advance_time(server: TestServer, ms: bigint): void {
  server.clock.advance(ms);
}

/** Waits for the scheduler and the `after_commit` functions, like `testing.wait_background`. */
export async function wait_background(server: TestServer): Promise<void> {
  await create_server_time_dev(server.time).wait_idle();
  await server.storage_dev.wait_after_commit();
}

export function fake_cdn(server: TestServer): FakeCdnController {
  return server.shared.fake.controller;
}

/** The sha256 of each fake `put` call, in order. */
export function put_calls(server: TestServer): string[] {
  return fake_cdn(server)
    .calls()
    .flatMap((call) => (call.operation === 'put' && call.input !== null ? [call.input.sha256] : []));
}

export function read_logs(server: TestServer, kind?: string): Record<string, unknown>[] {
  return kind === undefined ? server.lines.map((line) => JSON.parse(line) as Record<string, unknown>) : log_lines(server.lines, kind);
}

/** `client_data_version` of the server build data the test runner gives. */
export function client_data_version(): string {
  return readFileSync(join(core_test_server_paths().data_folder, 'client_data_version'), 'utf8').trim();
}

/** A data version with another protocol hash than `version`. */
export function other_protocol(version: string): string {
  const [, data] = version.split('-');
  return `${'f'.repeat(16)}-${data ?? ''}`;
}

export function sha256_of(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

export interface UpdateFile {
  readonly name: string;
  readonly bytes: Uint8Array;
  readonly sha256: string;
}

export function new_file(name: string, size = 64): UpdateFile {
  const bytes = new Uint8Array(randomBytes(size));
  return { name, bytes, sha256: sha256_of(bytes) };
}

/** Uploads files with `put_update_file`; every upload must succeed. */
export async function upload(server: TestServer, files: readonly UpdateFile[]): Promise<void> {
  for (const file of files) {
    const answer = await put_file(server, file.bytes);
    if (answer.status !== 200) throw new Error(`put_update_file ${file.name}: ${String(answer.status)}`);
  }
}

/** A `publish_deploy_list` input with one patch entry for app version `version` holding `files` as data files. */
export function publish_body(data_version: string, files: readonly UpdateFile[], version = '1.0.0'): Record<string, unknown> {
  return {
    app: { android: { min_version: '1.0.0', recommended_version: version, store_url: 'https://play.example.com/app' } },
    patches: {
      [version]: {
        data_version,
        data_files: files.map((file) => ({ name: file.name, size: file.bytes.byteLength, sha256: file.sha256 })),
        translation_files: [],
        bundle_files: [],
      },
    },
  };
}

export interface ServedDeployList {
  readonly bytes: Uint8Array;
  readonly list: Record<string, unknown> & { sequence: number; published_at: number; file_base_url: string };
  readonly signature: { key_id: string; sequence: number; signature: string };
}

/** The served deploy list and signature, or null on HTTP 404. */
export function served(server: TestServer): ServedDeployList | null {
  const list = get(server, '/update/deploy_list.json');
  const signature = get(server, '/update/deploy_list.json.sig');
  if (list.status === 404 && signature.status === 404) return null;
  if (list.status !== 200 || signature.status !== 200) throw new Error(`deploy list ${String(list.status)}, signature ${String(signature.status)}`);
  return {
    bytes: list.body,
    list: JSON.parse(Buffer.from(list.body).toString('utf8')) as ServedDeployList['list'],
    signature: JSON.parse(Buffer.from(signature.body).toString('utf8')) as ServedDeployList['signature'],
  };
}

/** True when the Ed25519 public key (standard base64) verifies the signature of `bytes`. */
export function signature_verifies(public_key_base64: string, bytes: Uint8Array, signature_base64: string): boolean {
  const key = createPublicKey({ key: Buffer.concat([SPKI_PREFIX, Buffer.from(public_key_base64, 'base64')]), format: 'der', type: 'spki' });
  return verify(null, bytes, key, Buffer.from(signature_base64, 'base64'));
}

/** A new Ed25519 public key in standard base64, which no server's signing key has. */
export function stranger_public_key(): string {
  return public_key_of(new_signing_seed());
}
