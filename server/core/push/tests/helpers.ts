/**
 * Helpers of push's core tests over the `testing` test helpers: test servers with the fake push adapters, devices
 * registered through `core/RegisterPushToken`, `queue_push` and `cancel_push` in the request ctx of the core test data
 * `rpc` `RunCoreTest`, the admin operations through `send_admin`, and the committed push rows read from the test DB.
 */
import { cpSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { setTimeout as sleep_real } from 'node:timers/promises';
import * as CoreContract from '../../../generated/contract/core_contract.ts';
import * as GameContract from '../../../generated/contract/game_contract.ts';
import { open_pg_session } from '../../storage/dev/index.ts';
import { DbError } from '../../storage/db/types.ts';
import type { DbHandle, RequestCtx } from '../../storage/index.ts';
import { storage_module, type DbTarget } from '../../storage/tests/helpers.ts';
import * as testing from '../../testing/dev/index.ts';
import { register_false_judges, register_required_hooks } from '../../testing/dev/index.ts';
import type { PushAdapter } from '../adapter.ts';
import type { FakeController } from '../dev/adapters/fake.ts';
import type { Push, PushArg } from '../index.ts';
import { translation_file } from '../translation.ts';

/** The server build data folder of this run, from `core_test_server_paths`. */
const run_paths = testing.core_test_server_paths();

export type TestServer = Awaited<ReturnType<typeof testing.start_test_server>>;
export type TestSession = Awaited<ReturnType<typeof testing.login>>;

/** The test clock start: 2027-01-15T08:00:00Z, minute 480 of a UTC day. */
export const START_AT = 1_800_000_000_000n;
export const HOUR = 3_600_000n;
export const MINUTE = 60_000n;
export const POLL_MS = 1000n;
export const LEASE_MS = 10_000n;
export const RETRY_MS = 1000n;
export const INVALID_REQUEST = CoreContract.CoreError.CORE_ERROR_INVALID_REQUEST;
export const GAME_ERROR_CORE_TEST = GameContract.GameError.GAME_ERROR_CORE_TEST;

/**
 * Settings of every push test server: a short poll, two attempts, a lease above 2 × (2000 + 1000), five scheduled
 * records per user, and the fake adapters of both push adapter keys.
 */
export const SETTINGS: Readonly<Record<string, unknown>> = {
  'push.pollIntervalMs': Number(POLL_MS),
  'push.sendTimeoutMs': 2000,
  'push.retryIntervalMs': Number(RETRY_MS),
  'push.retryMaxAttempts': 2,
  'push.leaseMs': Number(LEASE_MS),
  'push.maxDelayMs': Number(HOUR),
  'push.maxScheduledPerUser': 5,
  'environments.<ENV>.adapters.push-fcm': 'fake',
  'environments.<ENV>.adapters.push-apns': 'fake',
};

/** What a `RunCoreTest` handler runs: a `GameError` value ends the request with it, anything else is a success. */
export type CoreTestFunction = (ctx: RequestCtx, push: Push) => unknown;

interface Slot {
  run: CoreTestFunction | null;
  value: unknown;
}

const slots = new WeakMap<TestServer, Slot>();
const folders: string[] = [];

/** The content `register` of a push test server: the `RunCoreTest` handler and the judge hooks of a server core test. */
function register_of(slot: Slot): (core: Readonly<Record<string, unknown>>) => void {
  return (core) => {
    const routing = core.routing as { register_handler(name: string, handler: (ctx: RequestCtx) => unknown): void };
    const push = core.push as Push;
    routing.register_handler('RunCoreTest', (ctx) => {
      const run = slot.run;
      if (run === null) return new GameContract.RunCoreTestResponse();
      const value = run(ctx, push);
      slot.value = value;
      return typeof value === 'number' ? value : new GameContract.RunCoreTestResponse();
    });
    register_false_judges(core);
    register_required_hooks(core);
  };
}

export interface StartOptions {
  /** Settings over `SETTINGS`. */
  readonly settings?: Readonly<Record<string, unknown>>;
  /** Real adapter list. */
  readonly real?: Readonly<Record<string, string>>;
  /** Server build data files by name added to a copy of the core test data's server build data folder. */
  readonly files?: ReadonlyMap<string, Uint8Array>;
}

/** A copy of the test runner's server build data folder with `files` added, removed by `remove_data_folders`. */
function data_folder_with(files: ReadonlyMap<string, Uint8Array>): string {
  const folder = mkdtempSync(join(tmpdir(), 'push-data-'));
  folders.push(folder);
  cpSync(run_paths.data_folder, folder, { recursive: true });
  for (const [name, bytes] of files) writeFileSync(join(folder, name), bytes);
  return folder;
}

const servers: TestServer[] = [];

/** Stops the test servers of the test with their peers and removes the server build data copies. */
export async function stop_all(): Promise<void> {
  for (const server of servers.splice(0)) {
    if (!server.stopped) await testing.stop_test_server(server);
  }
  for (const folder of folders.splice(0)) rmSync(folder, { recursive: true, force: true });
}

/** A LOCAL test server at `START_AT`. A server start failure throws. */
export async function start(options: StartOptions = {}): Promise<TestServer> {
  const slot: Slot = { run: null, value: null };
  const data = options.files === undefined ? undefined : data_folder_with(options.files);
  // An adapter key of the real adapter list takes its real adapter, not the fake one of `SETTINGS`.
  const settings: Record<string, unknown> = { ...SETTINGS, ...options.settings };
  for (const key of Object.keys(options.real ?? {})) Reflect.deleteProperty(settings, `environments.<ENV>.adapters.${key}`);
  const server = await testing.start_test_server(START_AT, undefined, undefined, undefined, options.real, settings, register_of(slot), undefined, undefined, data);
  slots.set(server, slot);
  servers.push(server);
  return server;
}

/** A peer of a test server: a second server instance on its DB, clock and fake adapters. */
export async function peer(server: TestServer): Promise<TestServer> {
  const p = await testing.start_peer_server(server);
  const slot = slots.get(server);
  if (slot !== undefined) slots.set(p, slot);
  return p;
}

/** The test server on a new server instance (`restart_test_server`): the old instance stops. */
export async function restart(server: TestServer): Promise<TestServer> {
  const next = await testing.restart_test_server(server);
  const slot = slots.get(server);
  if (slot !== undefined) slots.set(next, slot);
  return next;
}

/** Moves the test clock and waits for the background work of the given servers (a test server and its peers). */
export async function advance(server: TestServer, ms: bigint, ...others: TestServer[]): Promise<void> {
  testing.advance_time(server, ms);
  for (const s of [server, ...others]) await testing.wait_background(s);
}

/** The test clock time of a LOCAL test server. */
export function now(server: TestServer): bigint {
  return server.shared.clock.now();
}

let next_account = 0;
const accounts = new WeakMap<TestSession, string>();

/** A new dev account's test session. */
export async function new_user(server: TestServer): Promise<TestSession> {
  next_account += 1;
  const account = `push_user_${String(next_account)}`;
  const session = await testing.login(server, account);
  accounts.set(session, account);
  return session;
}

/** A new session of the same dev account: a login on another device. */
export function login_again(session: TestSession, account: string): Promise<TestSession> {
  return testing.login(session.server, account);
}

export interface Reply {
  /** `ServerError.code`, 0 on success. */
  readonly code: number;
  readonly response: unknown;
}

export async function call(session: TestSession, name: string, message: { encode(): Uint8Array }, headers?: Readonly<Record<string, string>>): Promise<Reply> {
  const { envelope, response } = await testing.send(session, name, message, undefined, undefined, undefined, headers);
  return { code: envelope.error?.code ?? 0, response };
}

/**
 * `RunCoreTest` of a session's user that runs `fn` with the request ctx and `push`. The value `fn` returned, and the
 * request's error code (0 on success).
 */
export async function run_core_test<T>(session: TestSession, fn: (ctx: RequestCtx, push: Push) => T): Promise<{ code: number; value: T }> {
  const slot = slots.get(session.server as TestServer);
  if (slot === undefined) throw new Error('run_core_test: not a push test server');
  slot.run = fn;
  slot.value = null;
  try {
    const { code } = await call(session, 'RunCoreTest', new GameContract.RunCoreTestRequest());
    return { code, value: slot.value as T };
  } finally {
    slot.run = null;
  }
}

export interface Register {
  readonly device_token: string;
  readonly language?: string;
  readonly timezone_offset_ms?: bigint;
  readonly platform?: string;
}

/** `core/RegisterPushToken` of a session from a platform (default `android`): its error code, 0 on success. */
export async function register(session: TestSession, r: Register): Promise<number> {
  const request = new CoreContract.RegisterPushTokenRequest();
  request.device_token = r.device_token;
  request.language = r.language ?? 'en';
  request.timezone_offset_ms = r.timezone_offset_ms ?? 0n;
  return (await call(session, 'core/RegisterPushToken', request, { 'X-Ogw-Platform': r.platform ?? 'android' })).code;
}

export interface Device {
  readonly session: TestSession;
  /** The dev account name of the user. */
  readonly account: string;
  readonly user_id: bigint;
  readonly token: string;
}

/** A new user with a session and a registered device. */
export async function device(server: TestServer, r: Register): Promise<Device> {
  const session = await new_user(server);
  const code = await register(session, r);
  if (code !== 0) throw new Error(`RegisterPushToken: ${String(code)}`);
  return { session, account: accounts.get(session) ?? '', user_id: session.user_id, token: r.device_token };
}

let loaded: ReturnType<typeof testing.load_data> | null = null;

/** The server build data of the core test data (`load_data`), read once. */
export function data(): ReturnType<typeof testing.load_data> {
  loaded ??= testing.load_data();
  return loaded;
}

/** The ID value of a `push_message` ID name. */
export function message(id_name: string): number {
  const id = data().dev.find_id_value(id_name);
  if (id === 0) throw new Error(`no ID value for ${id_name}`);
  return id;
}

export interface Queue {
  readonly message: string;
  readonly args?: readonly PushArg[];
  /** Ms after the request time; 0 when not given. */
  readonly after_ms?: bigint;
  readonly send_at?: bigint;
  readonly dedupe_key?: string;
}

/** `queue_push` for `target` in a `RunCoreTest` request of `owner`: the push ID, or 0. */
export async function queue(owner: TestSession, target: bigint, q: Queue): Promise<bigint> {
  const { code, value } = await run_core_test(owner, (ctx, push) =>
    push.queue_push(ctx, target, message(q.message), q.args ?? [], q.send_at ?? ctx.request_time + (q.after_ms ?? 0n), q.dedupe_key ?? ''),
  );
  if (code !== 0) throw new Error(`queue: ${String(code)}`);
  return value;
}

export async function cancel(owner: TestSession, target: bigint, dedupe_key: string): Promise<void> {
  const { code } = await run_core_test(owner, (ctx, push) => {
    push.cancel_push(ctx, target, dedupe_key);
  });
  if (code !== 0) throw new Error(`cancel: ${String(code)}`);
}

/** `UpdatePushConsent` of a session. */
export async function set_push_consent(session: TestSession, ad: boolean, night: boolean): Promise<void> {
  const choice = (granted: boolean): CoreContract.ConsentChoice => (granted ? CoreContract.ConsentChoice.CONSENT_CHOICE_GRANTED : CoreContract.ConsentChoice.CONSENT_CHOICE_DENIED);
  const request = Object.assign(new CoreContract.UpdatePushConsentRequest(), { push_ad: choice(ad), push_night: choice(night) });
  const { code } = await call(session, 'core/UpdatePushConsent', request);
  if (code !== 0) throw new Error(`UpdatePushConsent: ${String(code)}`);
}

export interface AdminReply {
  readonly status: number;
  readonly json: unknown;
}

/** An admin operation of the operator `ogw`. */
export async function admin(server: TestServer, operation: string, body: Record<string, unknown>): Promise<AdminReply> {
  const { status, json } = await testing.send_admin(server, operation, body);
  return { status, json };
}

/** `schedule_push` that succeeds: its push ID. */
export async function schedule(server: TestServer, body: Record<string, unknown>): Promise<bigint> {
  const reply = await admin(server, 'schedule_push', { operation_id: `op-${String(Math.random())}`, args: [], ...body });
  const push_id = (reply.json as { push_id?: string } | null)?.push_id;
  if (reply.status !== 200 || push_id === undefined) throw new Error(`schedule_push: ${String(reply.status)} ${JSON.stringify(reply.json)}`);
  return BigInt(push_id);
}

/** The fake adapter controller of a push adapter key. */
export function fake(server: TestServer, key: 'push-fcm' | 'push-apns'): FakeController {
  return testing.fake(server, key) as FakeController;
}

/** The fake adapter object of a push adapter key that the test server gives its instances: a test may replace its `send`. */
export function fake_adapter(server: TestServer, key: 'push-fcm' | 'push-apns'): PushAdapter {
  const pair = server.shared.fakes.get(key);
  if (pair === undefined) throw new Error(`the test server has no fake adapter ${key}`);
  return pair.adapter as PushAdapter;
}

export interface Sent {
  readonly tokens: readonly string[];
  readonly payload: { readonly title: string; readonly body: string; readonly data: Readonly<Record<string, string>> };
}

/** The `send` calls of both fake adapters that went to a token. */
export function sends_to(server: TestServer, token: string): Sent[] {
  return [...fake(server, 'push-fcm').calls(), ...fake(server, 'push-apns').calls()].map((c) => c.input as Sent).filter((c) => c.tokens.includes(token));
}

export function logs(server: TestServer, level?: string): Record<string, unknown>[] {
  return testing.read_logs(server, undefined, level);
}

// Committed rows of the test DB.

/** The DB of a test server, as `storage`'s test helpers name it. */
export function db_target(server: TestServer): DbTarget {
  const database = server.shared.database;
  return { kind: database.kind, db: database.db_argument, secrets: { db: database.connection ?? '' } };
}

const BOOLEAN_COLUMNS = new Set(['ad_allowed', 'night_allowed']);

/** A row with integers as `bigint` and the boolean columns as `boolean`, the same on SQLite and PostgreSQL. */
function normalized(row: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(row)) {
    if (BOOLEAN_COLUMNS.has(key)) out[key] = value === true || value === 1 || value === 1n;
    else out[key] = typeof value === 'number' && Number.isInteger(value) ? BigInt(value) : value;
  }
  return out;
}

/** The committed rows of a query on the test server's DB, with `$n` parameters. */
export async function rows(server: TestServer, sql: string, params: readonly (bigint | number | string)[] = []): Promise<Record<string, unknown>[]> {
  const database = server.shared.database;
  if (database.connection === null) {
    const db = new DatabaseSync(database.db_argument, { readOnly: true });
    try {
      const statement = db.prepare(sql.replace(/\$(\d+)/g, '?$1'));
      statement.setReadBigInts(true);
      return (statement.all(...params) as Record<string, unknown>[]).map(normalized);
    } finally {
      db.close();
    }
  }
  const conn = await open_pg_session(database.connection);
  try {
    return (await conn.query(sql, [...params])).map(normalized);
  } finally {
    conn.close();
  }
}

/** A `push_record` row, or undefined. */
export async function record(server: TestServer, push_id: bigint): Promise<Record<string, unknown> | undefined> {
  return (await rows(server, 'SELECT * FROM push_record WHERE push_id = $1', [push_id]))[0];
}

export function records(server: TestServer): Promise<Record<string, unknown>[]> {
  return rows(server, 'SELECT * FROM push_record ORDER BY created_at, push_id');
}

export function devices(server: TestServer): Promise<Record<string, unknown>[]> {
  return rows(server, 'SELECT * FROM push_device ORDER BY user_id, device_token');
}

export function held(server: TestServer): Promise<Record<string, unknown>[]> {
  return rows(server, 'SELECT * FROM push_held ORDER BY push_id, user_id');
}

/** The `push` module object of a test server's running instance. */
export function push_module(server: TestServer): Push {
  const push = server.running().instance.modules().get('push');
  if (push === undefined) throw new Error('the server instance has no push module');
  return push as unknown as Push;
}

/**
 * Makes the next `times` statements matching `sql` in a transaction of the test server's running instance throw the
 * lock wait `DbError`, as a lock wait over `storage.userLockWaitMs` does: that game transaction rolls back and is
 * `FAILED`. The first `skip` matching statements run. `before` runs before each such throw. The number of statements
 * made to fail so far.
 */
export function fail_statements(server: TestServer, sql: RegExp, times: number, before: () => void = () => undefined, skip = 0): () => number {
  const storage = storage_module(server);
  const db = storage.db.bind(storage);
  let seen = 0;
  let failed = 0;
  storage.db = (ctx_or_tx) => {
    const handle = db(ctx_or_tx);
    const wrapped = Object.create(handle) as DbHandle;
    wrapped.query = (statement, params) => {
      if (sql.test(statement) && seen++ >= skip && failed < times) {
        failed += 1;
        before();
        throw new DbError('lock', '55P03', 'lock wait over storage.userLockWaitMs');
      }
      return handle.query(statement, params);
    };
    return wrapped;
  };
  return () => failed;
}

/** Polls (real time) until `done` is true. */
export async function until(done: () => boolean | Promise<boolean>, what: string, limit_ms = 5000): Promise<void> {
  for (let waited = 0; !(await done()); waited += 10) {
    if (waited > limit_ms) throw new Error(`timed out waiting for ${what}`);
    await sleep_real(10);
  }
}

// Translation binaries for languages other than the core test data's.

function varint(n: number): number[] {
  const out: number[] = [];
  let v = n;
  while (v >= 0x80) {
    out.push((v % 0x80) | 0x80);
    v = Math.floor(v / 0x80);
  }
  out.push(v);
  return out;
}

function field(no: number, bytes: Uint8Array): number[] {
  return [...varint(no * 8 + 2), ...varint(bytes.length), ...bytes];
}

/** A translation binary (`Translation`) of texts by translation key, in key byte order. */
export function translation_binary(texts: ReadonlyMap<string, string>): Uint8Array {
  const utf8 = new TextEncoder();
  const out: number[] = [];
  for (const key of [...texts.keys()].sort((a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b)))) {
    const entry = [...field(1, utf8.encode(key)), ...field(2, utf8.encode(texts.get(key) ?? ''))];
    out.push(...field(1, new Uint8Array(entry)));
  }
  return new Uint8Array(out);
}

/** The translation keys of a `push_message` row's `title` and `body`. */
export function message_keys(id_name: string): { title: string; body: string } {
  const row = data().data.PushMessageTable.get_row(message(id_name));
  return { title: row.title, body: row.body };
}

/**
 * The source texts of the core test data `push_message` rows the tests send in other languages, by ID name, as
 * `data/tables/push_message.csv` writes them.
 */
export const SOURCE_TEXTS: Readonly<Record<string, { title: string; body: string }>> = {
  '[push_ad_label_message]': { title: '(Ad)', body: 'Ad label' },
  '[push_plain]': { title: 'Plain', body: 'Nothing to fill' },
  '[push_fmt_plain]': { title: 'Format', body: '{v}' },
  '[push_fmt_n]': { title: 'Format', body: '{v:n}' },
  '[push_fmt_ordinal]': { title: 'Format', body: '{v:ordinal}' },
  '[push_fmt_duration]': { title: 'Format', body: '{v:duration}' },
  '[push_fmt_date]': { title: 'Format', body: '{v:date}' },
  '[push_fmt_datetime]': { title: 'Format', body: '{v:datetime}' },
  '[push_fmt_plural]': { title: 'Format', body: '{v:plural:item/items}' },
  '[push_fmt_euro]': { title: 'Format', body: '{v:으로/로}' },
  '[push_fmt_iga]': { title: 'Format', body: '{v:이/가}' },
  '[push_fmt_compact]': { title: 'Format', body: '{v:compact}' },
  '[push_fmt_brace]': { title: 'Format', body: '{v}}' },
};

/** Translation binaries of `languages` with the source texts of `SOURCE_TEXTS`, and `extra` texts by ID name, without the texts of `omit`. */
export function translations(
  languages: readonly string[], extra: Readonly<Record<string, { title: string; body: string }>> = {}, omit: readonly string[] = [],
): Map<string, Uint8Array> {
  const texts = new Map<string, string>();
  for (const [id_name, t] of Object.entries({ ...SOURCE_TEXTS, ...extra })) {
    if (omit.includes(id_name)) continue;
    const keys = message_keys(id_name);
    texts.set(keys.title, t.title);
    texts.set(keys.body, t.body);
  }
  const binary = translation_binary(texts);
  return new Map(languages.map((l) => [translation_file(l), binary]));
}

export { testing };
