import { randomUUID } from 'node:crypto';
import * as CoreContract from '../../../generated/contract/core_contract.ts';
import * as GameContract from '../../../generated/contract/game_contract.ts';
import * as CoreCheatContract from '../../../dev/generated/contract/core_cheat_contract.ts';
import * as GameCheatContract from '../../../dev/generated/contract/game_cheat_contract.ts';
import { create_system_clock } from '../../server-time/adapters/system_clock.ts';
import type { ClockAdapter } from '../../server-time/clock.ts';
import { sign_request } from '../../session/index.ts';
import { NO_ACCESS_TOKEN_RPC } from '../../storage/index.ts';
import { client_data_version } from './runner_input.ts';
import type { TestServer } from './test_server.ts';

/** A message of the contract: something with `encode`. */
export interface Message {
  encode(): Uint8Array;
}

/** A server that takes requests: a test server, or a remote test server (`connect_server`). */
export type RequestServer = TestServer | RemoteServer;

/** A remote test server (`connect_server`): a server instance the server process start point runs at a URL. */
export class RemoteServer {
  readonly clock: ClockAdapter = create_system_clock();
  readonly url: string;
  readonly data_version: string;
  readonly dev_access: string;

  constructor(url: string, data_version: string, dev_access: string) {
    this.url = url;
    this.data_version = data_version;
    this.dev_access = dev_access;
  }
}

/**
 * A test session (`## DEV`): a logged-in user of a server with its user ID, access token, login token and session
 * signing key. A copy with other field values is a test session of the same server.
 */
export interface TestSession {
  readonly server: RequestServer;
  readonly user_id: bigint;
  readonly access_token: string;
  readonly login_token: string;
  readonly session_signing_key: string;
}

/**
 * Each user's server time minus the server's clock as of the last `ResponseEnvelope` it got: the user's cheat time
 * offset. A test server and its remote servers keep their own.
 */
const offsets = new WeakMap<object, Map<bigint, bigint>>();

function offsets_of(server: RequestServer): Map<bigint, bigint> {
  const key: object = is_remote(server) ? server : server.shared;
  let map = offsets.get(key);
  if (map === undefined) {
    map = new Map();
    offsets.set(key, map);
  }
  return map;
}

/** The user's server time: the clock with the user's offset as of the last response. */
function user_now(session: TestSession): bigint {
  return clock_of(session.server).now() + (offsets_of(session.server).get(session.user_id) ?? 0n);
}

/**
 * The `NoAccessTokenRpc` requests whose `server_time_at` is the found user's time (`routing`
 * `ResponseEnvelope.server_time_at`). The others (`GetTerms`, `GetNotices`) find no user and carry `clock_now`.
 */
const USER_FOUND_WITHOUT_TOKEN: ReadonlySet<string> = new Set(['core/Login', 'core/AutoLogin', 'core/RefreshToken', 'core/cheat/DevLogin']);

/**
 * Keeps the offset that a response's `server_time_at` shows for the session's user. On a test server only a success
 * response of a request that finds the user carries the user's time: an error may end before the user is found and
 * carry `clock_now`. A request without an access token finds the user of its credential, which may be another user
 * than the session's, so its offset is kept only when the response's `AuthResult` is the session's user. A cheat time
 * offset changes only with a success response, so the other responses are skipped. A remote test server keeps the
 * last `server_time_at` it got (`### remote`).
 */
function saw(session: TestSession, name: string, envelope: CoreContract.ResponseEnvelope, response: unknown): void {
  if (session.user_id === 0n) return;
  if (!is_remote(session.server)) {
    if (envelope.error !== null) return;
    if (NO_ACCESS_TOKEN_RPC.has(name)) {
      if (!USER_FOUND_WITHOUT_TOKEN.has(name)) return;
      const auth = (response as { result?: CoreContract.AuthResult | null } | null)?.result ?? null;
      if (auth?.user_id !== session.user_id) return;
    }
  }
  offsets_of(session.server).set(session.user_id, envelope.server_time_at - clock_of(session.server).now());
}

/** What `send` and `send_cheat` return: the envelope, and the response message when the request succeeded. */
export interface SendResult {
  readonly envelope: CoreContract.ResponseEnvelope;
  readonly response: unknown;
}

/** An HTTP response of `send_raw`: status, headers by lower case name, body bytes. */
export interface RawResponse {
  readonly status: number;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: Uint8Array;
}

function header_object(headers: Headers): Record<string, string> {
  const out: Record<string, string> = {};
  headers.forEach((value, name) => {
    out[name.toLowerCase()] = value;
  });
  return out;
}

/** Header overrides of `send`: a value sets the header, `null` removes it. */
export type HeaderOverrides = Readonly<Record<string, string | null>>;

/** `NoSignatureRpc` (`server-core` `## request`). */
const NO_SIGNATURE = new Set(['core/Login', 'core/AutoLogin', 'core/GetTerms', 'core/GetNotices', 'core/cheat/DevLogin']);
/** Requests whose `Authorization` is the login token (`routing` common header). */
const LOGIN_TOKEN_AUTH = new Set(['core/AutoLogin', 'core/RefreshToken']);

/** The platform a test helper request says it is from. */
const PLATFORM = 'linux';

function is_remote(server: RequestServer): server is RemoteServer {
  return server instanceof RemoteServer;
}

function clock_of(server: RequestServer): ClockAdapter {
  return is_remote(server) ? server.clock : server.shared.clock;
}

function url_of(server: RequestServer): string {
  return server.url;
}

function data_version_of(server: RequestServer): string {
  return is_remote(server) ? server.data_version : server.shared.data_version;
}

function rpc_info(name: string, cheat: boolean): CoreContract.RpcInfo {
  const lists = cheat ? [CoreCheatContract.RPCS, GameCheatContract.RPCS] : [CoreContract.RPCS, GameContract.RPCS];
  for (const list of lists) {
    const info = list.find((rpc) => rpc.name === name);
    if (info !== undefined) return info;
  }
  throw new Error(`testing: ${name} is not a ${cheat ? 'cheat' : 'game or core rpc'} of the contract`);
}

interface RequestSpec {
  readonly name: string;
  /** The body the signature covers: the encoded request message. */
  readonly body: Uint8Array;
  /** The body sent in place of `body` after signing (`send`'s raw body). */
  readonly raw_body?: Uint8Array | undefined;
  readonly request_id: string;
  readonly timestamp: bigint | undefined;
  readonly session: TestSession | null;
  readonly dev_access: string | null;
  readonly overrides: HeaderOverrides | undefined;
}

function request_headers(server: RequestServer, spec: RequestSpec): Headers {
  const headers = new Headers({
    'Content-Type': 'application/x-protobuf',
    'X-Ogw-Request-Id': spec.request_id,
    'X-Ogw-Data-Version': data_version_of(server),
    'X-Ogw-Client-Version': '',
    'X-Ogw-Platform': PLATFORM,
  });
  const session = spec.session;
  if (session !== null && !NO_ACCESS_TOKEN_RPC.has(spec.name)) headers.set('Authorization', `Bearer ${session.access_token}`);
  if (session !== null && LOGIN_TOKEN_AUTH.has(spec.name)) headers.set('Authorization', `Bearer ${session.login_token}`);
  if (session !== null && !NO_SIGNATURE.has(spec.name)) {
    const timestamp = (spec.timestamp ?? user_now(session)).toString();
    headers.set('X-Ogw-Timestamp', timestamp);
    headers.set('X-Ogw-Signature', sign_request(session.session_signing_key, spec.name, spec.request_id, timestamp, spec.body));
  }
  if (spec.dev_access !== null) headers.set('X-Ogw-Dev-Access', spec.dev_access);
  for (const [name, value] of Object.entries(spec.overrides ?? {})) {
    if (value === null) headers.delete(name);
    else headers.set(name, value);
  }
  return headers;
}

async function post(server: RequestServer, spec: RequestSpec, info: CoreContract.RpcInfo): Promise<SendResult> {
  const reply = await fetch(`${url_of(server)}/${spec.name}`, { method: 'POST', headers: request_headers(server, spec), body: spec.raw_body ?? spec.body });
  const bytes = new Uint8Array(await reply.arrayBuffer());
  const envelope = reply.status === 200 ? CoreContract.ResponseEnvelope.decode(bytes) : null;
  if (envelope === null) throw new Error(`testing: ${spec.name} got HTTP ${String(reply.status)} without a ResponseEnvelope`);
  const response = envelope.error === null ? info.response_class.decode(envelope.body) : null;
  if (spec.session !== null) saw(spec.session, spec.name, envelope, response);
  return { envelope, response };
}

function check_running(server: RequestServer): void {
  if (!is_remote(server)) server.running();
}

/** `send`'s optional inputs, in their positional order. */
export interface SendOptions {
  readonly request_id: string | undefined;
  readonly timestamp: bigint | undefined;
  readonly seed: bigint | undefined;
  readonly headers: HeaderOverrides | undefined;
  readonly raw_body: Uint8Array | undefined;
}

/** `send`: a game `rpc` or core `rpc` request of a test session, over HTTP. */
export async function send(session: TestSession, name: string, message: Message, options: SendOptions): Promise<SendResult> {
  const server = session.server;
  check_running(server);
  if (is_remote(server) && (options.timestamp !== undefined || options.seed !== undefined || options.headers !== undefined || options.raw_body !== undefined)) {
    throw new Error('testing: a remote test server takes no timestamp, seed, header override or raw body');
  }
  const request_id = options.request_id ?? randomUUID();
  if (options.seed !== undefined) {
    if (is_remote(server) || server.environment === 'STG') throw new Error('testing: only a LOCAL test server takes a seed');
    server.running().seeds.set(request_id, options.seed);
  }
  const info = rpc_info(name, false);
  // Header overrides and the raw body apply after the signature of the encoded message (`### request`).
  const spec = { name, body: message.encode(), raw_body: options.raw_body, request_id, timestamp: options.timestamp, session, dev_access: null, overrides: options.headers };
  return post(server, spec, info);
}

function dev_access_of(server: RequestServer): string {
  if (is_remote(server)) return server.dev_access;
  if (server.environment === 'STG') throw new Error('testing: a STG test server takes no cheat request');
  return server.dev_access;
}

/** `send_cheat`: a cheat request of a test session, with the server's dev access value. */
export async function send_cheat(session: TestSession, name: string, message: Message): Promise<SendResult> {
  const server = session.server;
  check_running(server);
  const dev_access = dev_access_of(server);
  const info = rpc_info(name, true);
  return post(server, { name, body: message.encode(), request_id: randomUUID(), timestamp: undefined, session, dev_access, overrides: undefined }, info);
}

function auth_result(result: SendResult, name: string): CoreContract.AuthResult {
  const error = result.envelope.error;
  if (error !== null) throw new Error(`testing: ${name} failed with error code ${String(error.code)}: ${error.detail}`);
  const response = result.response as { result?: CoreContract.AuthResult | null } | null;
  const auth = response?.result ?? null;
  if (auth === null) throw new Error(`testing: ${name} gave no AuthResult`);
  return auth;
}

/** The agreements of a STG guest `Login`: the current version of each terms item (game settings `termsDocuments`). */
function current_agreements(server: TestServer): CoreContract.TermsAgreement[] {
  const documents = server.settings().termsDocuments as Record<string, { version?: unknown } | undefined> | undefined;
  const items: [string, CoreContract.TermsItem][] = [['TERMS', CoreContract.TermsItem.TERMS_ITEM_TERMS], ['PRIVACY', CoreContract.TermsItem.TERMS_ITEM_PRIVACY]];
  return items.map(([key, item]) => {
    const agreement = new CoreContract.TermsAgreement();
    agreement.item = item;
    agreement.version = Number(documents?.[key]?.version ?? 0);
    return agreement;
  });
}

/**
 * `login`: `DevLogin` with the dev account name on a LOCAL or remote test server, a guest `Login` that agrees to
 * the current terms versions on a STG test server.
 */
export async function login(server: RequestServer, account_name: string): Promise<TestSession> {
  check_running(server);
  const request_id = randomUUID();
  let result: SendResult;
  let name: string;
  if (!is_remote(server) && server.environment === 'STG') {
    name = 'core/Login';
    const message = new CoreContract.LoginRequest();
    message.provider = CoreContract.LoginProvider.LOGIN_PROVIDER_GUEST;
    message.agreements = current_agreements(server);
    result = await post(server, { name, body: message.encode(), request_id, timestamp: undefined, session: null, dev_access: null, overrides: undefined }, rpc_info(name, false));
  } else {
    name = 'core/cheat/DevLogin';
    const message = new CoreCheatContract.DevLoginRequest();
    message.account_name = account_name;
    const spec = { name, body: message.encode(), request_id, timestamp: undefined, session: null, dev_access: dev_access_of(server), overrides: undefined };
    result = await post(server, spec, rpc_info(name, true));
  }
  const auth = auth_result(result, name);
  const session: TestSession = { server, user_id: auth.user_id, access_token: auth.access_token, login_token: auth.login_token, session_signing_key: auth.session_signing_key };
  saw(session, name, result.envelope, result.response);
  return session;
}

/** `send_raw`: one HTTP request to a test server as given. */
export async function send_raw(server: TestServer, method: string, path: string, headers: Readonly<Record<string, string>>, body: Uint8Array | null): Promise<RawResponse> {
  server.running();
  // A GET or HEAD request carries no body.
  const sent = method === 'GET' || method === 'HEAD' ? null : body;
  const reply = await fetch(`${server.url}${path}`, { method, headers, body: sent });
  return { status: reply.status, headers: header_object(reply.headers), body: new Uint8Array(await reply.arrayBuffer()) };
}

/** The response of `send_admin`: HTTP status, headers, body bytes, and the body as JSON (null when it is not JSON). */
export interface AdminResponse {
  readonly status: number;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: Uint8Array;
  readonly json: unknown;
}

/** A binary body of `send_admin`: the bytes, and the input fields as the query string. */
export interface AdminBinaryBody {
  readonly binary: Uint8Array;
  readonly query: Readonly<Record<string, string>>;
}

function is_binary_body(body: unknown): body is AdminBinaryBody {
  return typeof body === 'object' && body !== null && (body as { binary?: unknown }).binary instanceof Uint8Array;
}

function parse_json(bytes: Uint8Array): unknown {
  try {
    return JSON.parse(new TextDecoder().decode(bytes)) as unknown;
  } catch {
    return null;
  }
}

/**
 * `send_admin`: `POST /admin/<operation>` as an operator of the test server (`ogw` when not given) with its admin
 * secret, or the admin secret override. A JSON body is a JSON value or its JSON text; a binary body is
 * `{binary, query}`.
 */
export async function send_admin(server: TestServer, operation: string, body: unknown, operator?: string, admin_secret?: string): Promise<AdminResponse> {
  server.running();
  const name = operator ?? 'ogw';
  const secret = admin_secret ?? server.admin_secret(name) ?? '';
  const binary = is_binary_body(body) ? body : null;
  const search = binary === null ? '' : `?${new URLSearchParams(binary.query).toString()}`;
  const text = typeof body === 'string' ? body : JSON.stringify(body, (_k, v: unknown) => (typeof v === 'bigint' ? v.toString() : v));
  const reply = await fetch(`${server.url}/admin/${operation}${search}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${name}.${secret}`, 'Content-Type': binary === null ? 'application/json' : 'application/octet-stream' },
    body: binary === null ? text : binary.binary,
  });
  const bytes = new Uint8Array(await reply.arrayBuffer());
  return { status: reply.status, headers: header_object(reply.headers), body: bytes, json: parse_json(bytes) };
}

/**
 * `connect_server`: a remote test server for the server instance at `url`, which must answer HTTP. It neither
 * starts nor stops a server process.
 */
export async function connect_server(url: string, data_folder: string, dev_access: string): Promise<RemoteServer> {
  const base = url.replace(/\/+$/, '');
  try {
    await (await fetch(`${base}/`, { method: 'GET' })).arrayBuffer();
  } catch (error) {
    throw new Error(`testing: cannot connect to ${base}: ${error instanceof Error ? error.message : String(error)}`);
  }
  return new RemoteServer(base, client_data_version(data_folder), dev_access);
}
