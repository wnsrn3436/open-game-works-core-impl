/**
 * Helpers of auth's core tests over the `testing` test helpers: test servers with fake social adapters, the auth
 * requests, admin reads of users and personal data rows, direct reads of auth's DB rows, and log reads.
 */
import { createHash, generateKeyPairSync, sign, type KeyObject, type webcrypto } from 'node:crypto';
import { cpSync, existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import * as CoreContract from '../../../generated/contract/core_contract.ts';
import * as GameContract from '../../../generated/contract/game_contract.ts';
import { open_pg_session } from '../../storage/dev/index.ts';
import * as testing from '../../testing/dev/index.ts';
import type { FakeLoginAdapter } from '../dev/index.ts';

/** The server build data folder of this run, from `core_test_server_paths`. */
const run_paths = testing.core_test_server_paths();

export type TestServer = Awaited<ReturnType<typeof testing.start_test_server>>;
export type TestSession = Awaited<ReturnType<typeof testing.login>>;

/** The test clock start of every auth test server: 2027-01-15T08:00:00Z. */
export const T0 = 1_800_000_000_000n;
export const E = CoreContract.CoreError;
export const P = CoreContract.LoginProvider;
export const C = CoreContract.ConsentChoice;

/** Settings that give LOCAL test servers the fake `login-apple` and `login-google` adapters. */
export const FAKE_SOCIAL: Readonly<Record<string, unknown>> = {
  'environments.<ENV>.adapters.login-apple': 'fake',
  'environments.<ENV>.adapters.login-google': 'fake',
};

/** Settings that give LOCAL test servers no social login adapter. */
export const NO_SOCIAL: Readonly<Record<string, unknown>> = {
  'environments.<ENV>.adapters.login-apple': null,
  'environments.<ENV>.adapters.login-google': null,
};

export interface StartOptions {
  readonly settings?: Readonly<Record<string, unknown>>;
  readonly real?: Readonly<Record<string, string>>;
  readonly env?: 'LOCAL' | 'STG';
  readonly social?: boolean;
  /** A content `register`; what the default game-less `register` registers is added. */
  readonly register?: (core: Readonly<Record<string, unknown>>) => void;
  /** What the handler of the core test data `rpc` `RunCoreTest` runs with its ctx. */
  readonly core_test?: (ctx: unknown) => void;
  /** The server build data folder; the core test data's when not given. */
  readonly data_folder?: string;
}

const data_folders: string[] = [];

/** A copy of the core test data's server build data folder with `files` added by name, removed by `remove_data_folders`. */
export function data_folder_with(files: Readonly<Record<string, Uint8Array>>): string {
  const folder = mkdtempSync(join(tmpdir(), 'auth-data-'));
  data_folders.push(folder);
  cpSync(run_paths.data_folder, folder, { recursive: true });
  for (const [name, bytes] of Object.entries(files)) writeFileSync(join(folder, name), bytes);
  return folder;
}

export function remove_data_folders(): void {
  for (const folder of data_folders.splice(0)) rmSync(folder, { recursive: true, force: true });
}

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

function length_field(no: number, bytes: Uint8Array): number[] {
  return [...varint(no * 8 + 2), ...varint(bytes.length), ...bytes];
}

/** A translation binary (`Translation`) of (translation key, text) entries. */
export function translation_binary(entries: readonly [string, string][]): Uint8Array {
  const utf8 = new TextEncoder();
  const out: number[] = [];
  for (const [key, text] of entries) out.push(...length_field(1, Uint8Array.from([...length_field(1, utf8.encode(key)), ...length_field(2, utf8.encode(text))])));
  return Uint8Array.from(out);
}

export function start(options: StartOptions = {}): Promise<TestServer> {
  const settings = { ...(options.social === false ? NO_SOCIAL : FAKE_SOCIAL), ...(options.settings ?? {}) };
  const { register: given, core_test } = options;
  const register =
    given === undefined && core_test === undefined
      ? undefined
      : (core: Readonly<Record<string, unknown>>): void => {
          given?.(core);
          if (core_test === undefined) {
            testing.core_test_register(core);
            return;
          }
          testing.core_test_register(core, ['RunCoreTest']);
          (core.routing as RunCoreTestRouting).register_handler('RunCoreTest', (ctx) => {
            core_test(ctx);
            return new GameContract.RunCoreTestResponse();
          });
        };
  return testing.start_test_server(options.env === 'STG' ? undefined : T0, undefined, options.env, undefined, options.real, settings, register, undefined, undefined, options.data_folder);
}

/** The `routing` member that registers the handler of the core test data `rpc` `RunCoreTest`. */
interface RunCoreTestRouting {
  register_handler(name: string, handler: (ctx: unknown) => GameContract.RunCoreTestResponse): void;
}

/** The terms versions of the core test data game settings. */
export const TERMS_VERSION = 1;

export function agreement(item: CoreContract.TermsItem, version = TERMS_VERSION): CoreContract.TermsAgreement {
  return Object.assign(new CoreContract.TermsAgreement(), { item, version });
}

export function current_agreements(): CoreContract.TermsAgreement[] {
  return [agreement(CoreContract.TermsItem.TERMS_ITEM_TERMS), agreement(CoreContract.TermsItem.TERMS_ITEM_PRIVACY)];
}

const bases = new WeakMap<object, TestSession>();

/** A session with no tokens, for the requests that go without a session. */
export async function anonymous(server: TestServer): Promise<TestSession> {
  let base = bases.get(server);
  if (base === undefined) {
    base = await testing.login(server, 'auth_test_base');
    bases.set(server, base);
  }
  return { ...base, user_id: 0n, access_token: '', login_token: '', session_signing_key: '' };
}

/** The test session of an `AuthResult`. */
export function session_of(base: TestSession, result: CoreContract.AuthResult): TestSession {
  return { ...base, user_id: result.user_id, access_token: result.access_token, login_token: result.login_token, session_signing_key: result.session_signing_key };
}

export interface Reply<R> {
  readonly envelope: CoreContract.ResponseEnvelope;
  readonly response: R;
  /** `ServerError.code`, 0 on success. */
  readonly code: number;
}

interface SendOptions {
  readonly request_id?: string;
  readonly headers?: Readonly<Record<string, string>>;
  readonly raw_body?: Uint8Array;
}

export async function call<R>(session: TestSession, name: string, message: { encode(): Uint8Array }, options: SendOptions = {}): Promise<Reply<R>> {
  const { envelope, response } = (await testing.send(session, name, message, options.request_id, undefined, undefined, options.headers, options.raw_body)) as {
    envelope: CoreContract.ResponseEnvelope;
    response: R;
  };
  return { envelope, response, code: envelope.error?.code ?? 0 };
}

export async function login(server: TestServer, provider: CoreContract.LoginProvider, credential = '', agreements = current_agreements()): Promise<Reply<CoreContract.LoginResponse>> {
  const request = Object.assign(new CoreContract.LoginRequest(), { provider, credential, agreements });
  return call(await anonymous(server), 'core/Login', request);
}

/** A guest `Login` that succeeds: the session of its result. */
export async function guest(server: TestServer): Promise<{ session: TestSession; result: CoreContract.AuthResult }> {
  const reply = await login(server, P.LOGIN_PROVIDER_GUEST);
  const result = reply.response.result;
  if (reply.code !== 0 || result === null) throw new Error(`guest Login failed with ${String(reply.code)}`);
  return { session: session_of(await anonymous(server), result), result };
}

/** A social `Login` with a fake credential `fake:<account>` that succeeds. */
export async function social(server: TestServer, provider: CoreContract.LoginProvider, account: string): Promise<{ session: TestSession; result: CoreContract.AuthResult }> {
  const reply = await login(server, provider, `fake:${account}`);
  const result = reply.response.result;
  if (reply.code !== 0 || result === null) throw new Error(`social Login failed with ${String(reply.code)}`);
  return { session: session_of(await anonymous(server), result), result };
}

function bearer(token: string): Record<string, string> {
  return { Authorization: `Bearer ${token}` };
}

export async function auto_login(server: TestServer, login_token: string, agreements: CoreContract.TermsAgreement[] = []): Promise<Reply<CoreContract.AutoLoginResponse>> {
  const request = Object.assign(new CoreContract.AutoLoginRequest(), { agreements });
  return call(await anonymous(server), 'core/AutoLogin', request, { headers: bearer(login_token) });
}

/** `RefreshToken` of a session: its login token, signed with its session signing key. */
export async function refresh(session: TestSession, headers: Readonly<Record<string, string>> = {}): Promise<Reply<CoreContract.RefreshTokenResponse>> {
  return call(session, 'core/RefreshToken', new CoreContract.RefreshTokenRequest(), { headers: { ...bearer(session.login_token), ...headers } });
}

/** A request that needs a session; `Resync` changes nothing. */
export async function probe(session: TestSession): Promise<number> {
  return (await call(session, 'core/Resync', new CoreContract.ResyncRequest())).code;
}

/** True when one of the server modules is not in this core (its module folder has no entry file). */
export function missing(...modules: string[]): boolean {
  return modules.some((m) => !existsSync(new URL(`../../${m}/index.ts`, import.meta.url)) && !existsSync(new URL(`../../${m}/dev/index.ts`, import.meta.url)));
}

export async function withdraw(session: TestSession): Promise<number> {
  return (await call(session, 'core/Withdraw', new CoreContract.WithdrawRequest())).code;
}

export function fake(server: TestServer, service: 'login-apple' | 'login-google'): FakeLoginAdapter {
  return testing.fake(server, service) as FakeLoginAdapter;
}

export interface AdminReply {
  readonly status: number;
  readonly body: Record<string, unknown>;
}

export async function admin(server: TestServer, operation: string, body: Record<string, unknown>, operator?: string): Promise<AdminReply> {
  const { status, json } = await testing.send_admin(server, operation, body, operator);
  return { status, body: typeof json === 'object' && json !== null ? (json as Record<string, unknown>) : {} };
}

/** `get_user`: `null` when the user does not exist. */
export async function user_record(server: TestServer, user_id: bigint): Promise<Record<string, unknown> | null> {
  const reply = await admin(server, 'get_user', { user_id: user_id.toString() });
  return reply.status === 200 ? reply.body : null;
}

/** Rows of one personal data table of the user (`export_personal_data`). */
export async function personal_rows(server: TestServer, user_id: bigint, table: string): Promise<Record<string, unknown>[]> {
  const reply = await admin(server, 'export_personal_data', { user_id: user_id.toString() });
  const tables = (reply.body.tables ?? {}) as Record<string, Record<string, unknown>[] | undefined>;
  return tables[table] ?? [];
}

/** An integer value as `bigint`, the same on SQLite and PostgreSQL. */
function normalized(row: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(row)) out[key] = typeof value === 'number' && Number.isInteger(value) ? BigInt(value) : value;
  return out;
}

/** The committed rows of a query on the test server's DB, with `$n` parameters. */
export async function db_rows(server: TestServer, sql: string, params: readonly (bigint | string)[] = []): Promise<Record<string, unknown>[]> {
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

/** The SHA-256 lowercase hex of a token or code, computed here apart from auth's own hashing. */
export function token_hash(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

/** A user's `auth_login_token` rows, ordered by `token_hash`. */
export function login_token_rows(server: TestServer, user_id: bigint): Promise<Record<string, unknown>[]> {
  return db_rows(server, 'SELECT token_hash, previous_hash, session_id, created_at, last_used_at FROM auth_login_token WHERE user_id = $1 ORDER BY token_hash', [user_id]);
}

interface TransactionRunner {
  run_request_transaction(user_id: bigint, fields: { request_name: string }, fn: (ctx: unknown) => unknown): Promise<unknown>;
}

/**
 * Holds the next `run_request_transaction` of `request_name` on the test server's instance before it opens:
 * `reached` resolves there, and the transaction opens once `release` is called. Calls of other requests go on.
 */
export function hold_next_transaction(server: TestServer, request_name: string): { reached: Promise<void>; release: () => void } {
  const storage = server.running().instance.modules().get('storage') as unknown as TransactionRunner | undefined;
  if (storage === undefined) throw new Error('auth test: no storage module');
  const original = storage.run_request_transaction.bind(storage);
  let reach = (): void => undefined;
  let release = (): void => undefined;
  const reached = new Promise<void>((resolve) => {
    reach = resolve;
  });
  const released = new Promise<void>((resolve) => {
    release = resolve;
  });
  storage.run_request_transaction = async (user_id, fields, fn) => {
    if (fields.request_name !== request_name) return original(user_id, fields, fn);
    storage.run_request_transaction = original;
    reach();
    await released;
    return original(user_id, fields, fn);
  };
  return { reached, release };
}

/**
 * The user IDs of every `user` row, withdrawn users included. User IDs are random, so a test compares these sets
 * instead of counting on the next ID.
 */
export async function user_ids(server: TestServer): Promise<Set<bigint>> {
  // The base session of `anonymous` makes a user the first time: made before the set is read.
  await anonymous(server);
  return new Set((await db_rows(server, 'SELECT user_id FROM "user"')).map((r) => r.user_id as bigint));
}

export function logs(server: TestServer, kind?: string): Record<string, unknown>[] {
  return testing.read_logs(server, kind);
}

/** All log lines as one text, to look for values that must not be there. */
export function log_text(server: TestServer): string {
  return JSON.stringify(logs(server), (_key, value: unknown) => (typeof value === 'bigint' ? value.toString() : value));
}

export function user_state(server: TestServer, user_id: bigint): Promise<testing.StateItem[]> {
  return testing.read_user_state(server, user_id);
}

export async function consent_of(server: TestServer, user_id: bigint): Promise<CoreContract.ConsentUserState> {
  const item = (await user_state(server, user_id)).find((x) => x.kind === 'ConsentUserState');
  return (item?.value as CoreContract.ConsentUserState | undefined) ?? new CoreContract.ConsentUserState();
}

// Test keys for the real adapters.

export interface TestKey {
  readonly kid: string;
  readonly private_key: KeyObject;
  readonly jwk: webcrypto.JsonWebKey & { kid: string };
}

export function rsa_key(kid: string): TestKey {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  return { kid, private_key: privateKey, jwk: { ...publicKey.export({ format: 'jwk' }), kid, alg: 'RS256', use: 'sig' } };
}

/** An RS256 ID token of the key with the claims. */
export function id_token(key: TestKey, claims: Record<string, unknown>): string {
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', kid: key.kid, typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify(claims)).toString('base64url');
  const signature = sign('RSA-SHA256', Buffer.from(`${header}.${payload}`), key.private_key).toString('base64url');
  return `${header}.${payload}.${signature}`;
}

/** `exp` seconds an hour after T0. */
export const EXP_LATER = Number(T0 / 1000n) + 3600;

export { testing };
