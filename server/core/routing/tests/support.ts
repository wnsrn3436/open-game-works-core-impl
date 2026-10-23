/**
 * Helpers of routing's core tests over `testing`'s test helper: test servers, requests, raw signed requests,
 * logs, and the content `register` of the game `rpc`s that `game_contract_mock.ts` adds.
 */
import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import * as CoreContract from '../../../generated/contract/core_contract.ts';
import { sign_request } from '../../session/index.ts';
import * as testing from '../../testing/dev/index.ts';
import { register_false_judges, register_required_hooks } from '../../testing/dev/index.ts';
import type { AdminOperation, Message, RequestCtx } from '../module_api.ts';

export const E = CoreContract.CoreError;

/** True when one of the server modules is not in this core (its module folder has no entry file). */
export function missing(...modules: string[]): boolean {
  return modules.some((m) => !existsSync(new URL(`../../${m}/index.ts`, import.meta.url)) && !existsSync(new URL(`../../${m}/dev/index.ts`, import.meta.url)));
}
export const GAME_ERROR_LISTED = 1001;
export const GAME_ERROR_UNLISTED = 1002;

/** The content `core` object of `register` and `registerDev`: the module operations the tests use. */
export interface ContentCore {
  routing: {
    register_handler(name: string, handler: (ctx: RequestCtx, request: Message) => Message | number): void;
    register_hook(module: string, hook: string, fn: unknown): void;
    register_admin_operation(operation: AdminOperation): void;
  };
  storage: {
    register_user_change(name: string, apply: (...args: unknown[]) => unknown, fail: (...args: unknown[]) => unknown): void;
    send_user_change(ctx: RequestCtx, target: bigint, name: string, payload: Uint8Array): void;
    put_state(ctx: RequestCtx, value: Message): void;
  };
  'server-time': { now(ctx: RequestCtx): bigint };
}

export type Register = (core: ContentCore) => void;

/** A test server of `testing`. */
export interface TestServer {
  readonly url?: string;
  readonly base_url?: string;
  readonly port?: number;
}

export interface TestSession {
  user_id: bigint;
  access_token: string;
  login_token: string;
  session_signing_key: string;
}

/** The `## DEV` operations of `testing` the tests use, with their positional inputs. */
interface TestingApi {
  start_test_server(
    start_at?: bigint,
    db?: string,
    env?: string,
    matchmaker?: boolean,
    real_adapters?: Record<string, string>,
    overrides?: Record<string, unknown>,
    register?: Register,
    register_dev?: Register,
    server_modules?: readonly string[],
    data_folder?: string,
  ): Promise<TestServer>;
  stop_test_server(server: TestServer): Promise<void>;
  restart_test_server(server: TestServer, register?: Register, register_dev?: Register): Promise<TestServer>;
  start_peer_server(server: TestServer): Promise<TestServer>;
  login(server: TestServer, name: string): Promise<TestSession>;
  send(session: TestSession, name: string, message: Message, request_id?: string, timestamp?: bigint, seed?: bigint, headers?: Record<string, string>, body?: Uint8Array): Promise<unknown>;
  send_cheat(session: TestSession, name: string, message: Message): Promise<unknown>;
  send_raw(server: TestServer, method: string, path: string, headers: Record<string, string>, body: Uint8Array): Promise<{ status: number; headers: unknown; body: unknown }>;
  read_user_state(server: TestServer, user_id: bigint): unknown;
  advance_time(server: TestServer, ms: bigint): void;
  wait_background(server: TestServer): Promise<void>;
  call_dev(server: TestServer, module: string, operation: string, input: unknown, user_id?: bigint): Promise<unknown>;
  send_admin(server: TestServer, operation: string, body: unknown): Promise<{ status: number; json: unknown }>;
  read_logs(server: TestServer, kind?: string, level?: string): unknown[];
}

const T = testing as unknown as TestingApi;

export interface StartOptions {
  env?: 'LOCAL' | 'STG';
  start_at?: bigint;
  matchmaker?: boolean;
  real_adapters?: Record<string, string>;
  overrides?: Record<string, unknown>;
  register?: Register;
  register_dev?: Register;
  server_modules?: readonly string[];
  /** The server build data folder. Default: the test runner's. */
  data_folder?: string;
}

/** A test's `register` with the judge hooks and hooks every server core test registers (`testing` `### isolation`). */
function with_judges(register: Register | undefined): Register | undefined {
  if (register === undefined) return undefined;
  return (core) => {
    register(core);
    register_false_judges(core as unknown as Readonly<Record<string, unknown>>);
    register_required_hooks(core as unknown as Readonly<Record<string, unknown>>);
  };
}

export function start(options: StartOptions = {}): Promise<TestServer> {
  return T.start_test_server(options.start_at, undefined, options.env, options.matchmaker, options.real_adapters, options.overrides, with_judges(options.register), options.register_dev, options.server_modules, options.data_folder);
}

export const stop = (server: TestServer): Promise<void> => T.stop_test_server(server);
export const restart = (server: TestServer, register?: Register): Promise<TestServer> => T.restart_test_server(server, with_judges(register));
export const peer = (server: TestServer): Promise<TestServer> => T.start_peer_server(server);
export const login = (server: TestServer, name: string): Promise<TestSession> => T.login(server, name);
export const advance = (server: TestServer, ms: bigint): void => {
  T.advance_time(server, ms);
};
export const wait_background = (server: TestServer): Promise<void> => T.wait_background(server);
export const read_user_state = (server: TestServer, user_id: bigint): unknown => T.read_user_state(server, user_id);
export const call_dev = (server: TestServer, module: string, operation: string, input: unknown, user_id?: bigint): Promise<unknown> => T.call_dev(server, module, operation, input, user_id);
export const admin = async (server: TestServer, operation: string, body: unknown): Promise<{ status: number; body: unknown }> => {
  const reply = await T.send_admin(server, operation, body);
  return { status: reply.status, body: reply.json };
};
export const send_with_seed = (session: TestSession, name: string, message: Message, request_id: string, seed: bigint): Promise<unknown> => T.send(session, name, message, request_id, undefined, seed);

export interface Sent {
  envelope: CoreContract.ResponseEnvelope;
  response: unknown;
}

/** `send` gives the envelope and the response message; this takes a pair, an object, or the envelope alone. */
function normalize(result: unknown): Sent {
  if (Array.isArray(result)) return { envelope: result[0] as CoreContract.ResponseEnvelope, response: result[1] };
  if (result instanceof CoreContract.ResponseEnvelope) return { envelope: result, response: null };
  const object = result as { envelope: CoreContract.ResponseEnvelope; response?: unknown; message?: unknown };
  return { envelope: object.envelope, response: object.response ?? object.message ?? null };
}

export interface SendOptions {
  request_id?: string;
  timestamp?: bigint;
  headers?: Record<string, string>;
  body?: Uint8Array;
}

export async function send(session: TestSession, name: string, message: Message, options: SendOptions = {}): Promise<Sent> {
  return normalize(await T.send(session, name, message, options.request_id, options.timestamp, undefined, options.headers, options.body));
}

export async function send_cheat(session: TestSession, name: string, message: Message): Promise<Sent> {
  return normalize(await T.send_cheat(session, name, message));
}

export function code(sent: Sent): number {
  return sent.envelope.error?.code ?? 0;
}

export interface RawResponse {
  status: number;
  headers: Record<string, string>;
  body: Uint8Array;
}

function header_record(given: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (given instanceof Headers) {
    given.forEach((value, key) => {
      out[key.toLowerCase()] = value;
    });
    return out;
  }
  for (const [key, value] of Object.entries((given ?? {}) as Record<string, unknown>)) out[key.toLowerCase()] = Array.isArray(value) ? value.join(', ') : String(value);
  return out;
}

export async function raw(server: TestServer, method: string, path: string, headers: Record<string, string>, body: Uint8Array = new Uint8Array(0)): Promise<RawResponse> {
  const result = await T.send_raw(server, method, path, headers, body);
  const bytes = result.body instanceof Uint8Array ? result.body : new Uint8Array((result.body ?? []) as ArrayLike<number>);
  return { status: result.status, headers: header_record(result.headers), body: bytes };
}

export function envelope_of(response: RawResponse): CoreContract.ResponseEnvelope {
  const envelope = CoreContract.ResponseEnvelope.decode(response.body);
  if (envelope === null) throw new Error(`HTTP ${String(response.status)} has no envelope`);
  return envelope;
}

/** The client data version of the server build data. */
export function client_data_version(): string {
  return readFileSync(`${testing.core_test_server_paths().data_folder}/client_data_version`, 'utf8').trim();
}

/** The common header of a request without access token. */
export function plain_headers(extra: Record<string, string> = {}): Record<string, string> {
  return {
    'Content-Type': 'application/x-protobuf',
    'X-Ogw-Request-Id': randomUUID(),
    'X-Ogw-Data-Version': client_data_version(),
    'X-Ogw-Client-Version': '1.0.0',
    'X-Ogw-Platform': 'linux',
    ...extra,
  };
}

/** The headers of a request signed with the session, as `session` `### request signature` says. */
export function signed_headers(session: TestSession, name: string, body: Uint8Array, time: bigint, extra: Record<string, string> = {}): Record<string, string> {
  const request_id = extra['X-Ogw-Request-Id'] ?? randomUUID();
  const timestamp = time.toString();
  const signature = sign_request(session.session_signing_key, name, request_id, timestamp, body);
  return plain_headers({
    'Authorization': `Bearer ${session.access_token}`,
    'X-Ogw-Request-Id': request_id,
    'X-Ogw-Timestamp': timestamp,
    'X-Ogw-Signature': signature,
    ...extra,
  });
}

/** The server time of the session's user: `server_time_at` of a `Resync`. */
export async function user_time(session: TestSession): Promise<bigint> {
  return (await send(session, 'core/Resync', new CoreContract.ResyncRequest())).envelope.server_time_at;
}

/** Sends a signed request with raw headers through `send_raw`. */
export async function signed_raw(server: TestServer, session: TestSession, name: string, body: Uint8Array, extra: Record<string, string> = {}): Promise<RawResponse> {
  const time = await user_time(session);
  return raw(server, 'POST', `/${name}`, signed_headers(session, name, body, time, extra), body);
}

/** The test server's log lines as objects. */
export function logs(server: TestServer, kind?: string): Record<string, unknown>[] {
  const lines = T.read_logs(server, kind);
  return lines.map((line) => (typeof line === 'string' ? (JSON.parse(line) as Record<string, unknown>) : (line as Record<string, unknown>)));
}

export function request_logs(server: TestServer, request: string): Record<string, unknown>[] {
  return logs(server, 'request').filter((line) => line.request === request);
}

export function security_reasons(server: TestServer): string[] {
  return logs(server, 'security').map((line) => String(line.reason));
}

/** The calls of the game `rpc` handlers of `game_register`. */
export interface GameCalls {
  echo: number;
  fail: number;
  crash: number;
  probe: number;
  /** What `Echo` read as `server-time.now`. */
  echo_time: bigint | null;
  /** How `Probe` ends after it sends user change `routing_probe` to `probe_target`. */
  probe_mode: 'response' | 'game_error' | 'throw';
  probe_target: bigint;
  /** Applied user changes `routing_probe`. */
  applied: number;
  /** When set, `Probe` runs this instead. */
  probe_handler: ((ctx: RequestCtx) => Message | number) | null;
}

export function new_calls(): GameCalls {
  return { echo: 0, fail: 0, crash: 0, probe: 0, echo_time: null, probe_mode: 'response', probe_target: 0n, applied: 0, probe_handler: null };
}

/**
 * The content `register` of the mocked game `rpc`s `Echo`, `Fail` (a listed `GameError`), `Crash` (throws) and
 * `Probe` (a write: a user change to another user, then as `probe_mode` says).
 */
export function game_register(calls: GameCalls, more?: Register): Register {
  return (core) => {
    core.storage.register_user_change('routing_probe', () => {
      calls.applied += 1;
      return 'pass';
    }, () => undefined);
    core.routing.register_handler('Probe', (ctx: RequestCtx) => {
      calls.probe += 1;
      if (calls.probe_handler !== null) return calls.probe_handler(ctx);
      core.storage.send_user_change(ctx, calls.probe_target, 'routing_probe', new Uint8Array([1]));
      if (calls.probe_mode === 'game_error') return GAME_ERROR_LISTED;
      if (calls.probe_mode === 'throw') throw new Error('crash after a write');
      return new CoreContract.ResyncResponse();
    });
    core.routing.register_handler('Echo', (ctx: RequestCtx) => {
      calls.echo += 1;
      calls.echo_time = core['server-time'].now(ctx);
      return new CoreContract.ResyncResponse();
    });
    core.routing.register_handler('Fail', () => {
      calls.fail += 1;
      return GAME_ERROR_LISTED;
    });
    core.routing.register_handler('Crash', () => {
      calls.crash += 1;
      throw new Error('crash in a handler');
    });
    more?.(core);
  };
}

export const echo = (): CoreContract.ResyncRequest => new CoreContract.ResyncRequest();


/** The base URL of a test server. */
export function url_of(server: TestServer): URL {
  const value = server.url ?? server.base_url ?? `http://127.0.0.1:${String(server.port ?? 0)}`;
  return new URL(value);
}
