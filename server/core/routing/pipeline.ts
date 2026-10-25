/**
 * Request handling of a server instance: the path table, the request processing order, the token-less and the
 * user-less core `rpc` paths, routes, CORS, and the `request`, `security` and `error` logs of requests.
 *
 * A step returns true when the request goes on, and false when it has ended with a response.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Duplex } from 'node:stream';
import * as CoreContract from '../../generated/contract/core_contract.ts';
import * as GameContract from '../../generated/contract/game_contract.ts';
import type { CoreRpcEntry, InstanceState, RouteEntry } from './context.ts';
import { web_deletion_url } from '../auth/index.ts';
import { check_data_version, client_ip, header, is_allowed_origin, parse_common_headers, preflight_headers, read_body, sha256_hex } from './http.ts';
import type {
  CommonHeaders,
  CoreRpcHandler,
  ErrorCode,
  LogLevel,
  LogValue,
  Message,
  NoUserHandler,
  RequestCtx,
  RequestFields,
  ResponseDelta,
  RouteRequest,
  TokenlessHandler,
} from './module_api.ts';
import { increment_counter } from './rate_limit.ts';
import { BAN_EXEMPT_RPC, DATA_HASH_EXEMPT_RPC, NO_ACCESS_TOKEN_RPC, NO_USER_RPC, REPORT_RPC, WITHDRAWN_RESPONSE_RPC } from './spec_tables.ts';

const E = CoreContract.CoreError;

/** The `CoreError` name of a value without `CORE_ERROR_`, e.g. `SESSION_REPLACED`. */
export function core_error_name(code: number): string {
  for (const [name, value] of Object.entries(E)) if (value === code) return name.slice('CORE_ERROR_'.length);
  return String(code);
}

/** The `security` log `reason` of a failure value: its name in snake_case. */
export function failure_reason(code: number): string {
  return core_error_name(code).toLowerCase();
}

function is_core_error(value: unknown): value is number {
  return typeof value === 'number' && value >= 1 && value <= 999;
}

function error_text(error: unknown): string | null {
  if (error instanceof Error) return error.stack ?? error.message;
  if (error === null || error === undefined) return null;
  return typeof error === 'string' ? error : JSON.stringify(error, (_k, v: unknown) => (typeof v === 'bigint' ? v.toString() : v));
}

/** The response envelope bytes with `server_time_at` set to `time`. */
function with_server_time(bytes: Uint8Array, time: bigint): Uint8Array {
  const envelope = CoreContract.ResponseEnvelope.decode(bytes);
  if (envelope === null) throw new Error('the response bytes are not a ResponseEnvelope');
  envelope.server_time_at = time;
  return envelope.encode();
}

function split_url(url: string): { path: string; query: string } {
  const q = url.indexOf('?');
  return q < 0 ? { path: url, query: '' } : { path: url.slice(0, q), query: url.slice(q + 1) };
}

/** One request being handled, from the path table to its response. */
export interface Exchange {
  readonly req: IncomingMessage;
  readonly res: ServerResponse;
  readonly name: string;
  readonly started_at: bigint;
  readonly client_ip: string;
  /** The `Origin` header when it is an allowed origin; null otherwise. */
  readonly origin: string | null;
  headers: CommonHeaders | null;
  body: Uint8Array | null;
  user_id: bigint | null;
  ctx: RequestCtx | null;
  /** The request time and seed of the ctx, kept when the ctx is gone. */
  ctx_time: bigint | null;
  seed: bigint | null;
  sensitive: boolean;
  close_after: boolean;
  done: boolean;
  /** Called with the error code (0 for success) when the response is sent. */
  on_done: ((error_code: number) => void) | null;
}

/** A request that goes through the whole request processing order (steps 5 to 17). */
export interface AuthTarget {
  name: string;
  info: CoreContract.RpcInfo;
  /** A cheat request: steps 4, 6, 7, 9 and 12 do not run. */
  cheat: boolean;
  /** A core `rpc`: a `GameError` outside its `(ogw.core_errors)` is `INTERNAL`. */
  core: boolean;
  validate(message: Message): 'pass' | CoreContract.ValidationFailure;
  invoke(ctx: RequestCtx, message: Message, prepare: unknown): Message | ErrorCode;
  /** Called when step 5 passes. */
  after_auth?(exchange: Exchange): void;
  /** `ResponseEnvelope.server_time_at` of the success response, found after the commit, when it is not the ctx's request time. */
  success_time?(user_id: bigint): bigint;
}

/** What steps 13 to 16 give back: the response bytes, or an error code with what made it. */
type TransactionOutcome = { bytes: Uint8Array } | ErrorCode | 'FAILED' | 'WITHDRAWN';

interface TransactionNotes {
  mismatch: boolean;
  outside: number | null;
}

export class Pipeline {
  private readonly s: InstanceState;

  constructor(state: InstanceState) {
    this.s = state;
  }

  // ---- logs

  error_log(exchange: Exchange | null, message: string, error: unknown): void {
    this.s.log({
      level: 'error',
      kind: 'error',
      user_id: exchange?.user_id ?? null,
      request_id: exchange?.headers?.request_id ?? null,
      request: exchange?.name ?? null,
      message,
      fields: { stack_trace: error_text(error) },
    });
  }

  /** A `security` log line; `logging.write` keeps the truncated IP of the client IP. */
  security_log(exchange: Exchange, reason: string): void {
    this.s.log({
      level: 'warn',
      kind: 'security',
      user_id: exchange.user_id,
      request_id: exchange.headers?.request_id ?? null,
      request: exchange.name,
      message: `request rejected: ${reason}`,
      fields: { ip: exchange.client_ip, reason },
    });
  }

  private annotation(exchange: Exchange): { fields: Readonly<Record<string, LogValue>>; min_level: LogLevel } {
    if (exchange.ctx === null) return { fields: {}, min_level: 'debug' };
    try {
      return this.s.deps.logging.take_request_log_annotation(exchange.ctx);
    } catch (error) {
      this.error_log(exchange, 'request log annotation failed', error);
      return { fields: {}, min_level: 'debug' };
    }
  }

  /** The `request` log line; `logging.write` sets its level and its `request_body`. */
  private request_log(exchange: Exchange, error_code: number): void {
    const annotation = this.annotation(exchange);
    this.s.log({
      level: null,
      kind: 'request',
      user_id: exchange.user_id,
      request_id: exchange.headers?.request_id ?? null,
      request: exchange.name,
      message: 'request',
      fields: {
        ...annotation.fields,
        error_code,
        duration_ms: Number(this.s.deps.server_time.clock_now() - exchange.started_at),
        client_version: exchange.headers?.client_version ?? null,
        platform: exchange.headers?.platform ?? null,
        seed: exchange.seed === null ? null : exchange.seed.toString(),
      },
      min_level: annotation.min_level,
      request_body: exchange.body,
      sensitive: exchange.sensitive,
    });
  }

  // ---- responses

  /** `ResponseEnvelope.server_time_at` of a response without a stored body. */
  server_time_at(exchange: Exchange): bigint {
    const { server_time, storage } = this.s.deps;
    if (exchange.ctx_time !== null) return exchange.ctx_time;
    if (exchange.user_id !== null) return server_time.user_now(exchange.user_id, storage.read_db());
    return server_time.clock_now();
  }

  /** Sends an envelope's bytes with HTTP 200 and writes the `request` log. */
  respond_bytes(exchange: Exchange, bytes: Uint8Array, error_code = 0): false {
    if (exchange.done) return false;
    exchange.done = true;
    const headers: Record<string, string> = { 'Content-Type': 'application/x-protobuf', Vary: 'Origin' };
    if (exchange.origin !== null) headers['Access-Control-Allow-Origin'] = exchange.origin;
    if (exchange.close_after) headers.Connection = 'close';
    exchange.res.writeHead(200, headers);
    exchange.res.end(bytes);
    this.request_log(exchange, error_code);
    exchange.on_done?.(error_code);
    return false;
  }

  /** Sends an error envelope; `detail` is filled in a DEV code server instance. */
  fail(exchange: Exchange, code: ErrorCode, detail: string, ban: CoreContract.BanDetail | null = null): false {
    const envelope = new CoreContract.ResponseEnvelope();
    envelope.server_time_at = this.server_time_at(exchange);
    const error = new CoreContract.ServerError();
    error.code = code;
    if (this.s.server.dev) error.detail = detail;
    if (code === E.CORE_ERROR_BANNED) error.ban = ban;
    envelope.error = error;
    return this.respond_bytes(exchange, envelope.encode(), code);
  }

  /** An exception that nothing handled: `INTERNAL` and an `error` log with the stack trace. */
  internal(exchange: Exchange, error: unknown): false {
    this.error_log(exchange, 'unhandled exception', error);
    return this.fail(exchange, E.CORE_ERROR_INTERNAL, 'unhandled exception');
  }

  success(exchange: Exchange, time: bigint, delta: ResponseDelta | null, body: Uint8Array): false {
    const envelope = new CoreContract.ResponseEnvelope();
    envelope.server_time_at = time;
    if (delta !== null) {
      envelope.user_state = delta.user_state;
      envelope.pending_user_state = delta.pending_user_state;
      envelope.item_changes = delta.item_changes;
      envelope.item_mails = delta.item_mails;
    }
    envelope.body = body;
    return this.respond_bytes(exchange, envelope.encode());
  }

  private plain(res: ServerResponse, status: number, headers: Record<string, string> = {}): void {
    res.writeHead(status, headers);
    res.end();
  }

  // ---- the path table

  private client_ip_of(req: IncomingMessage): string {
    const trusted = this.s.server.env === 'LOCAL' ? 0 : this.s.settings.trusted_proxy_count;
    return client_ip(trusted, header(req.headers, 'x-forwarded-for'), req.socket.remoteAddress);
  }

  new_exchange(req: IncomingMessage, res: ServerResponse, name: string, origin: string | null): Exchange {
    return {
      req,
      res,
      name,
      started_at: this.s.deps.server_time.clock_now(),
      client_ip: this.client_ip_of(req),
      origin,
      headers: null,
      body: null,
      user_id: null,
      ctx: null,
      ctx_time: null,
      seed: null,
      sensitive: false,
      close_after: false,
      done: false,
      on_done: null,
    };
  }

  /** The allowed origin of the request; null when it has no `Origin`; false when its `Origin` is not allowed. */
  private origin_of(req: IncomingMessage): string | null | false {
    const origin = header(req.headers, 'origin');
    if (origin === null) return null;
    return is_allowed_origin(origin, this.s.server.env, this.s.settings.cors_allowed_origins) ? origin : false;
  }

  /** A response without an envelope of a path in the path table, with its `request` log line. */
  private plain_logged(exchange: Exchange, status: number, headers: Record<string, string> = {}): void {
    this.plain(exchange.res, status, headers);
    this.request_log(exchange, 0);
  }

  /** The CORS preflight of an rpc path or a cheat path; `name` is its request name. */
  private preflight(req: IncomingMessage, res: ServerResponse, name: string, cheat: boolean): void {
    const origin = this.origin_of(req);
    if (typeof origin !== 'string') {
      this.plain(res, 403, { Vary: 'Origin' });
      return;
    }
    this.plain_logged(this.new_exchange(req, res, name, origin), 204, preflight_headers(origin, this.s.settings.cors_preflight_max_age_ms, cheat));
  }

  /** The request name of an rpc path, or null. */
  private rpc_name(path: string): string | null {
    const rpc = /^\/(core\/)?([A-Za-z][A-Za-z0-9]*)$/.exec(path);
    if (rpc === null) return null;
    const core = rpc[1] !== undefined;
    const name = `${core ? 'core/' : ''}${rpc[2] ?? ''}`;
    const known = core ? this.s.collected.core_rpcs.has(name) : this.s.collected.game_handlers.has(name);
    return known ? name : null;
  }

  /** One request of the path table, all of it inside `logging.with_request_ip`. */
  handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    return this.s.deps.logging.with_request_ip(this.client_ip_of(req), () => this.dispatch(req, res));
  }

  private async dispatch(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const { path, query } = split_url(req.url ?? '/');
    const method = req.method ?? '';
    const cheat = /^\/(core\/)?cheat\/([A-Za-z][A-Za-z0-9]*)$/.exec(path);
    if (cheat !== null) {
      await this.handle_cheat_path(req, res, method, `${cheat[1] === undefined ? '' : 'core/'}cheat/${cheat[2] ?? ''}`);
      return;
    }
    const name = this.rpc_name(path);
    if (name !== null && method === 'OPTIONS') {
      this.preflight(req, res, name, false);
      return;
    }
    if (name !== null && method === 'POST') {
      await this.handle_rpc(req, res, name);
      return;
    }
    const route = this.find_route(method, path);
    if (route === null) {
      this.plain(res, 404);
      return;
    }
    await this.handle_route(route, req, res, path, query, null);
  }

  /** STG and PROD: `UNAUTHORIZED` without reading the body and without CORS header. */
  private closed_cheat_path(req: IncomingMessage, res: ServerResponse, name: string): void {
    const exchange = this.new_exchange(req, res, name, null);
    exchange.close_after = true;
    this.security_log(exchange, 'cheat_path_closed');
    const envelope = new CoreContract.ResponseEnvelope();
    envelope.server_time_at = this.server_time_at(exchange);
    const error = new CoreContract.ServerError();
    error.code = E.CORE_ERROR_UNAUTHORIZED;
    envelope.error = error;
    exchange.done = true;
    res.writeHead(200, { 'Content-Type': 'application/x-protobuf', Connection: 'close' });
    res.end(envelope.encode());
    this.request_log(exchange, E.CORE_ERROR_UNAUTHORIZED);
  }

  private async handle_cheat_path(req: IncomingMessage, res: ServerResponse, method: string, name: string): Promise<void> {
    const cheat = this.s.server.dev ? this.s.cheat : null;
    if (method === 'OPTIONS' && cheat !== null) {
      this.preflight(req, res, name, true);
      return;
    }
    // STG and PROD: the `OPTIONS` of a cheat path is a path of the path table, so it has a `request` log line.
    if (method === 'OPTIONS') {
      this.plain_logged(this.new_exchange(req, res, name, null), 404);
      return;
    }
    if (method !== 'POST') {
      this.plain(res, 404);
      return;
    }
    if (cheat === null) {
      this.closed_cheat_path(req, res, name);
      return;
    }
    const origin = this.origin_of(req);
    if (origin === false) {
      this.plain(res, 403, { Vary: 'Origin' });
      return;
    }
    const exchange = this.new_exchange(req, res, name, origin);
    await this.guard(exchange, () => cheat.handle(exchange, name));
  }

  /** Runs a request's processing; an exception that escapes it is `INTERNAL`. */
  private async guard(exchange: Exchange, run: () => Promise<unknown>): Promise<void> {
    try {
      await run();
    } catch (error) {
      if (exchange.done) this.error_log(exchange, 'unhandled exception after the response', error);
      else this.internal(exchange, error);
    }
  }

  // ---- rpc paths

  /** Step 2: null (`INVALID_REQUEST`) on `Content-Encoding`, another `Content-Type`, or the body limit. */
  async read_rpc_body(exchange: Exchange): Promise<Uint8Array | null> {
    const req = exchange.req;
    const media = (header(req.headers, 'content-type') ?? '').split(';')[0]?.trim().toLowerCase() ?? '';
    if (req.headers['content-encoding'] !== undefined || media !== 'application/x-protobuf') {
      exchange.close_after = true;
      return null;
    }
    const settings = this.s.settings;
    const signal = this.s.deps.server_time.network_time_limit(BigInt(Math.max(1, settings.body_read_timeout_ms)));
    const body = await read_body(req, settings.max_body_bytes, signal);
    if (body === null) exchange.close_after = true;
    return body;
  }

  /** Steps 2 and 3. */
  async read_request(exchange: Exchange): Promise<boolean> {
    const body = await this.read_rpc_body(exchange);
    if (body === null) return this.fail(exchange, E.CORE_ERROR_INVALID_REQUEST, 'step 2 body limit: Content-Encoding, Content-Type, size or read time');
    exchange.body = body;
    exchange.headers = parse_common_headers(exchange.name, exchange.req.headers);
    if (exchange.headers === null) return this.fail(exchange, E.CORE_ERROR_INVALID_REQUEST, 'step 3 common header: a header is missing or has a wrong format');
    return true;
  }

  private async handle_rpc(req: IncomingMessage, res: ServerResponse, name: string): Promise<void> {
    const origin = this.origin_of(req);
    if (origin === false) {
      this.plain(res, 403, { Vary: 'Origin' });
      return;
    }
    const exchange = this.new_exchange(req, res, name, origin);
    await this.guard(exchange, () => this.process_rpc(exchange));
  }

  private game_target(name: string, info: CoreContract.RpcInfo, handler: CoreRpcHandler): AuthTarget {
    const validation = this.s.deps.validation;
    return { name, info, cheat: false, core: false, validate: (m) => validation.validate_request(name, m), invoke: (ctx, m) => handler(ctx, m) };
  }

  private core_target(name: string, core: CoreRpcEntry): AuthTarget {
    const validation = this.s.deps.validation;
    const handler = core.handler as CoreRpcHandler;
    return {
      name,
      info: core.info,
      cheat: false,
      core: true,
      validate: (m) => validation.validate_request(name, m),
      invoke: (ctx, m, prepare) => (prepare === undefined ? handler(ctx, m) : handler(ctx, m, prepare)),
    };
  }

  private async process_rpc(exchange: Exchange): Promise<void> {
    const { deps, collected } = this.s;
    const name = exchange.name;
    const core = collected.core_rpcs.get(name);
    const game = collected.game_handlers.get(name);
    const info = core?.info ?? game?.info;
    if (info === undefined) throw new Error(`no handler for ${name}`);
    exchange.sensitive = info.sensitive;
    if (!(await this.read_request(exchange))) return;
    if (core !== undefined && NO_USER_RPC.has(name)) {
      await this.process_no_user(exchange, core);
      return;
    }
    // 4. maintenance
    if (deps.admin_api.is_maintenance()) {
      this.fail(exchange, E.CORE_ERROR_MAINTENANCE, 'step 4 maintenance');
      return;
    }
    if (core !== undefined && NO_ACCESS_TOKEN_RPC.has(name)) {
      await this.process_tokenless(exchange, info, core.handler as TokenlessHandler, (m) => deps.validation.validate_request(name, m));
      return;
    }
    const target = core !== undefined ? this.core_target(name, core) : this.game_target(name, info, (game as { handler: CoreRpcHandler }).handler);
    await this.process_authenticated(exchange, target);
  }

  /** Counts the request on the IP counter (`### rate limit`). */
  async count_ip(exchange: Exchange): Promise<boolean> {
    const { storage, server_time } = this.s.deps;
    const count = await increment_counter(storage, server_time, 'ip', exchange.client_ip);
    if (count === 'FAILED') {
      this.error_log(exchange, 'rate counter transaction failed', null);
      return this.fail(exchange, E.CORE_ERROR_INTERNAL, 'rate limit: rate counter transaction failed');
    }
    if (count > BigInt(this.s.settings.ip_rate_limit_per_minute)) {
      this.security_log(exchange, 'rate_limited_ip');
      return this.fail(exchange, E.CORE_ERROR_RATE_LIMITED, 'rate limit: IP counter over the limit');
    }
    return true;
  }

  /** Steps 10 and 11. null when the request has ended with `INVALID_REQUEST`. */
  decode(exchange: Exchange, info: CoreContract.RpcInfo, validate: (m: Message) => 'pass' | CoreContract.ValidationFailure): Message | null {
    const message = info.request_class.decode(exchange.body ?? new Uint8Array(0));
    if (message === null) {
      this.fail(exchange, E.CORE_ERROR_INVALID_REQUEST, 'step 10 decode: the body is not the request message');
      return null;
    }
    const result = validate(message);
    if (result !== 'pass') {
      this.fail(exchange, E.CORE_ERROR_INVALID_REQUEST, `step 11 field validation: ${result.path} ${result.rule}`);
      return null;
    }
    return message;
  }

  /** A `NoUserRpc`: steps 1 to 3, the IP counter, 10, 11 and 17. */
  private async process_no_user(exchange: Exchange, core: CoreRpcEntry): Promise<void> {
    const { deps } = this.s;
    if (!(await this.count_ip(exchange))) return;
    const message = this.decode(exchange, core.info, (m) => deps.validation.validate_request(exchange.name, m));
    if (message === null) return;
    const headers = exchange.headers as CommonHeaders;
    const response = await (core.handler as NoUserHandler)(message, headers.platform, headers.client_version);
    this.success(exchange, deps.server_time.clock_now(), null, response.encode());
  }

  /** A token-less core `rpc` or `DevLogin`: the IP counter, 10, 11, then the handler of `auth`. */
  async process_tokenless(exchange: Exchange, info: CoreContract.RpcInfo, handler: TokenlessHandler, validate: (m: Message) => 'pass' | CoreContract.ValidationFailure): Promise<void> {
    if (!(await this.count_ip(exchange))) return;
    const message = this.decode(exchange, info, validate);
    if (message === null) return;
    const output = await handler({ headers: exchange.headers as CommonHeaders, body: exchange.body ?? new Uint8Array(0), request: message, client_ip: exchange.client_ip });
    exchange.user_id = output.user_id;
    if (output.ctx !== null) {
      exchange.ctx = output.ctx;
      exchange.ctx_time = output.ctx.request_time;
      exchange.seed = output.ctx.seed;
    }
    if ('error' in output) this.fail(exchange, output.error, `handler: ${core_error_name(output.error)}`, output.ban);
    else this.success(exchange, this.server_time_at(exchange), output.delta, output.response.encode());
  }

  /** Step 5 failures: `security` log and the IP counter, except `TOKEN_EXPIRED`. */
  private async auth_failure(exchange: Exchange, code: ErrorCode, step: string): Promise<false> {
    if (code === E.CORE_ERROR_TOKEN_EXPIRED) return this.fail(exchange, code, `step 5 ${step}: TOKEN_EXPIRED`);
    this.security_log(exchange, failure_reason(code));
    if (!(await this.count_ip(exchange))) return false;
    return this.fail(exchange, code, `step 5 ${step}: ${core_error_name(code)}`);
  }

  /** A stored response of step 5: answered, or `INVALID_REQUEST` for another request name. */
  private stored(exchange: Exchange, stored: Uint8Array | null | 'NAME_MISMATCH'): boolean {
    if (stored === 'NAME_MISMATCH') {
      this.security_log(exchange, 'request_name_mismatch');
      return this.fail(exchange, E.CORE_ERROR_INVALID_REQUEST, 'step 5: the request ID has a stored response of another request');
    }
    if (stored !== null) return this.respond_bytes(exchange, stored);
    return true;
  }

  /** The session check and the signature check of step 5; null when both pass. */
  private session_failure(user_id: bigint, session_id: string, name: string, headers: CommonHeaders, body: Uint8Array): { code: ErrorCode; step: string } | null {
    const session = this.s.deps.session;
    const current = session.check_current(user_id, session_id);
    if (typeof current === 'number') return { code: current, step: 'session' };
    const signed = session.verify_signature(user_id, session_id, name, headers.request_id, headers.timestamp, headers.signature, body);
    if (typeof signed === 'number') return { code: signed, step: 'signature' };
    return null;
  }

  /** Step 5: the session ID of the authenticated user, or null when the request has ended. */
  private async authenticate(exchange: Exchange, target: AuthTarget, token_hash: string): Promise<string | null> {
    const { storage, server_time, auth, idempotency } = this.s.deps;
    const headers = exchange.headers as CommonHeaders;
    const name = target.name;
    if (WITHDRAWN_RESPONSE_RPC.has(name)) {
      const stored = idempotency.find_withdrawn_response(storage.read_db(), token_hash, headers.request_id, name, server_time.clock_now());
      if (!this.stored(exchange, stored)) return null;
    }
    const verified = auth.verify_access_token(headers.authorization ?? '');
    const failure =
      typeof verified === 'number'
        ? { code: verified, step: 'access token' }
        : this.session_failure(verified.user_id, verified.session_id, name, headers, exchange.body ?? new Uint8Array(0));
    if (failure !== null || typeof verified === 'number') {
      await this.auth_failure(exchange, failure?.code ?? E.CORE_ERROR_UNAUTHORIZED, failure?.step ?? 'access token');
      return null;
    }
    exchange.user_id = verified.user_id;
    target.after_auth?.(exchange);
    const read_db = storage.read_db();
    const committed = idempotency.find_committed_response(read_db, verified.user_id, headers.request_id, name, server_time.user_now(verified.user_id, read_db));
    return this.stored(exchange, committed) ? verified.session_id : null;
  }

  /** Steps 6 and 7. */
  private check_ban_and_version(exchange: Exchange, target: AuthTarget, user_id: bigint): boolean {
    if (target.cheat) return true;
    const { admin_api, game_update, storage } = this.s.deps;
    const ban = admin_api.is_banned(user_id);
    if (ban.banned && target.name !== BAN_EXEMPT_RPC) {
      const detail = new CoreContract.BanDetail();
      detail.user_id = user_id;
      detail.until_at = ban.until_at;
      detail.deletion_url = this.deletion_url();
      detail.public_code = storage.get_user_record(storage.read_db(), user_id)?.public_code ?? '';
      return this.fail(exchange, E.CORE_ERROR_BANNED, 'step 6 ban', detail);
    }
    const headers = exchange.headers as CommonHeaders;
    const server = this.s.server;
    const result = check_data_version(headers.data_version, server.client_data_version, server.compat_client_data_version, DATA_HASH_EXEMPT_RPC.has(target.name), headers.client_version, (v) => game_update.is_data_update_ready(v));
    if (result === 'APP_UPDATE_REQUIRED') return this.fail(exchange, E.CORE_ERROR_APP_UPDATE_REQUIRED, 'step 7 data version: no data version with this protocol hash');
    if (result === 'DATA_UPDATE_REQUIRED') return this.fail(exchange, E.CORE_ERROR_DATA_UPDATE_REQUIRED, 'step 7 data version: the data hash differs');
    return true;
  }

  /** Step 8. */
  private async count_user(exchange: Exchange, user_id: bigint): Promise<boolean> {
    const { storage, server_time, logging } = this.s.deps;
    if (REPORT_RPC.has(exchange.name)) {
      const counted = await logging.count_report_request(user_id);
      if (counted === 'pass') return true;
      if (counted === E.CORE_ERROR_RATE_LIMITED) this.security_log(exchange, 'rate_limited_user');
      return this.fail(exchange, counted, `step 8 rate limit: ${core_error_name(counted)}`);
    }
    const count = await increment_counter(storage, server_time, 'user', user_id.toString());
    if (count === 'FAILED') {
      this.error_log(exchange, 'rate counter transaction failed', null);
      return this.fail(exchange, E.CORE_ERROR_INTERNAL, 'step 8 rate limit: rate counter transaction failed');
    }
    if (count > BigInt(this.s.settings.user_rate_limit_per_minute)) {
      this.security_log(exchange, 'rate_limited_user');
      return this.fail(exchange, E.CORE_ERROR_RATE_LIMITED, 'step 8 rate limit: user counter over the limit');
    }
    return true;
  }

  /** Step 12. */
  private async request_start(exchange: Exchange, user_id: bigint): Promise<void> {
    for (const on_request_start of this.s.collected.request_start) {
      try {
        await on_request_start(user_id);
      } catch (error) {
        this.error_log(exchange, 'on_request_start failed', error);
      }
    }
  }

  /** The request prepare: `{ value }`, or null when the request has ended with the prepare operation's `CoreError`. */
  private async prepare(exchange: Exchange, user_id: bigint, message: Message): Promise<{ value: unknown } | null> {
    const { storage, idempotency } = this.s.deps;
    const operation = this.s.collected.prepare.get(exchange.name);
    if (operation === undefined) return { value: undefined };
    const request_id = (exchange.headers as CommonHeaders).request_id;
    if (exchange.name === 'core/RedeemCoupon' && idempotency.has_response(storage.read_db(), user_id, request_id)) return { value: undefined };
    const value = await operation(user_id, message, exchange.client_ip, request_id);
    if (!is_core_error(value)) return { value };
    this.fail(exchange, value, `request prepare: ${core_error_name(value)}`);
    return null;
  }

  /** Steps 13 to 16 in one user transaction. */
  private transaction(exchange: Exchange, target: AuthTarget, user_id: bigint, session_id: string, message: Message, prepare: unknown, token_hash: string, notes: TransactionNotes): Promise<TransactionOutcome> {
    const { storage, idempotency, logging } = this.s.deps;
    const headers = exchange.headers as CommonHeaders;
    const name = target.name;
    const fields: RequestFields = {
      request_name: name,
      request_id: headers.request_id,
      silent: target.info.silent,
      retry: target.info.retry,
      session_id,
      client_version: headers.client_version,
      platform: headers.platform,
    };
    return storage.run_request_transaction(user_id, fields, (ctx): { bytes: Uint8Array } | ErrorCode => {
      exchange.ctx = ctx;
      exchange.ctx_time = ctx.request_time;
      exchange.seed = ctx.seed;
      // 14. idempotency
      const stored = idempotency.find_response(ctx);
      if (stored === 'NAME_MISMATCH') {
        notes.mismatch = true;
        return E.CORE_ERROR_INVALID_REQUEST;
      }
      if (stored !== null) return { bytes: stored };
      // 15. handler
      const result = target.invoke(ctx, message, prepare);
      if (typeof result === 'number') {
        const listed = GameContract.CORE_ERRORS.get(name) ?? [];
        if (!target.core || result < 1000 || listed.includes(result as GameContract.GameError)) return result;
        notes.outside = result;
        return E.CORE_ERROR_INTERNAL;
      }
      // 16. commit
      const response_body = result.encode();
      const taken = storage.take_response_delta(ctx);
      if (taken.unknown_kinds.length > 0) logging.annotate_request_log(ctx, { unknown_kinds: taken.unknown_kinds.join(',') }, 'warn');
      const envelope = new CoreContract.ResponseEnvelope();
      envelope.server_time_at = ctx.request_time;
      envelope.user_state = taken.delta.user_state;
      envelope.pending_user_state = taken.delta.pending_user_state;
      envelope.item_changes = taken.delta.item_changes;
      envelope.item_mails = taken.delta.item_mails;
      envelope.body = response_body;
      const bytes = envelope.encode();
      idempotency.save_response(ctx, bytes);
      idempotency.save_withdrawn_response(ctx, token_hash, bytes);
      return { bytes };
    });
  }

  /** Step 17 of the transaction's outcome. */
  private finish(exchange: Exchange, outcome: TransactionOutcome, notes: TransactionNotes): void {
    if (outcome === 'WITHDRAWN') {
      this.fail(exchange, E.CORE_ERROR_UNAUTHORIZED, 'step 13: the user is withdrawn');
      return;
    }
    if (outcome === 'FAILED') {
      this.error_log(exchange, 'request transaction failed', null);
      this.fail(exchange, E.CORE_ERROR_INTERNAL, 'step 13: the request transaction failed');
      return;
    }
    if (typeof outcome !== 'number') {
      this.respond_bytes(exchange, outcome.bytes);
      return;
    }
    if (notes.mismatch) {
      this.security_log(exchange, 'request_name_mismatch');
      this.fail(exchange, outcome, 'step 14: the request ID has a stored response of another request');
      return;
    }
    if (notes.outside !== null) {
      this.error_log(exchange, `core rpc ${exchange.name} returned GameError ${String(notes.outside)}, which is not in its core_errors`, null);
      this.fail(exchange, outcome, `step 15: GameError ${String(notes.outside)} is not in the core_errors of ${exchange.name}`);
      return;
    }
    this.fail(exchange, outcome, `step 15 handler: ${outcome >= 1000 ? `GameError ${String(outcome)}` : core_error_name(outcome)}`);
  }

  /** Steps 5 to 17. */
  async process_authenticated(exchange: Exchange, target: AuthTarget): Promise<void> {
    const token_hash = sha256_hex((exchange.headers as CommonHeaders).authorization ?? '');
    const session_id = await this.authenticate(exchange, target, token_hash);
    const user_id = exchange.user_id;
    if (session_id === null || exchange.done || user_id === null) return;
    if (!this.check_ban_and_version(exchange, target, user_id)) return;
    if (!(await this.count_user(exchange, user_id))) return;
    // 9. kill switch
    if (!target.cheat && this.s.deps.admin_api.is_kill_switched(target.name)) {
      this.fail(exchange, E.CORE_ERROR_FEATURE_DISABLED, 'step 9 kill switch');
      return;
    }
    const message = this.decode(exchange, target.info, (m) => target.validate(m));
    if (message === null) return;
    if (!target.cheat) await this.request_start(exchange, user_id);
    const prepared = await this.prepare(exchange, user_id, message);
    if (prepared === null) return;
    const notes: TransactionNotes = { mismatch: false, outside: null };
    let outcome: TransactionOutcome;
    try {
      outcome = await this.transaction(exchange, target, user_id, session_id, message, prepared.value, token_hash, notes);
      if (target.success_time !== undefined && typeof outcome === 'object') outcome = { bytes: with_server_time(outcome.bytes, target.success_time(user_id)) };
    } catch (error) {
      this.internal(exchange, error);
      return;
    }
    this.finish(exchange, outcome, notes);
  }

  /** The web account deletion page address of `auth`. */
  deletion_url(): string {
    return web_deletion_url(this.s.server.env, this.s.server.port(), this.s.settings.server_url);
  }

  // ---- routes

  find_route(method: string, path: string): RouteEntry | null {
    const segments = path.split('/').slice(1);
    const matches = (route: RouteEntry): boolean =>
      route.method === method && route.segments.length === segments.length && route.segments.every((s, i) => (/^<[^>]+>$/.test(s) ? (segments[i] ?? '') !== '' : s === segments[i]));
    return this.s.collected.routes.find(matches) ?? null;
  }

  private route_request(req: IncomingMessage, path: string, query: string, upgrade: RouteRequest['upgrade']): RouteRequest {
    const headers: Record<string, string | undefined> = {};
    for (const [key, value] of Object.entries(req.headers)) headers[key] = Array.isArray(value) ? value.join(', ') : value;
    const server_time = this.s.deps.server_time;
    return {
      method: req.method ?? '',
      path,
      query,
      headers,
      read_body: (max_bytes, timeout_ms) => read_body(req, max_bytes, server_time.network_time_limit(BigInt(Math.max(1, timeout_ms)))),
      upgrade,
    };
  }

  async handle_route(route: RouteEntry, req: IncomingMessage, res: ServerResponse, path: string, query: string, upgrade: RouteRequest['upgrade']): Promise<void> {
    const started_at = this.s.deps.server_time.clock_now();
    try {
      const output = await route.handler(this.route_request(req, path, query, upgrade), this.client_ip_of(req));
      if (output === null) {
        this.route_log(started_at, 0);
        return;
      }
      const headers: Record<string, string> = { ...(output.headers ?? {}) };
      if (route.update) {
        headers.Vary = 'Origin';
        const origin = this.origin_of(req);
        if (typeof origin === 'string') headers['Access-Control-Allow-Origin'] = origin;
      }
      res.writeHead(output.status, headers);
      res.end(output.body);
      this.route_log(started_at, 0);
    } catch (error) {
      this.error_log(null, `route ${route.key} failed`, error);
      if (!res.headersSent) this.plain(res, 500);
      this.route_log(started_at, E.CORE_ERROR_INTERNAL);
    }
  }

  /** The `request` log line of a route's request: no request name, `INTERNAL` when the route handler threw. */
  private route_log(started_at: bigint, error_code: number): void {
    this.s.log({
      level: null,
      kind: 'request',
      user_id: null,
      request_id: null,
      request: null,
      message: 'request',
      fields: { error_code, duration_ms: Number(this.s.deps.server_time.clock_now() - started_at), client_version: null, platform: null, seed: null },
    });
  }

  /** A WebSocket upgrade request, inside `logging.with_request_ip`: the route of its path, or the connection is closed. */
  handle_upgrade(req: IncomingMessage, socket: Duplex, head: Buffer): Promise<void> {
    return this.s.deps.logging.with_request_ip(this.client_ip_of(req), () => this.upgrade(req, socket, head));
  }

  private async upgrade(req: IncomingMessage, socket: Duplex, head: Buffer): Promise<void> {
    const { path, query } = split_url(req.url ?? '/');
    const route = this.find_route(req.method ?? '', path);
    if (route === null) {
      socket.destroy();
      return;
    }
    const started_at = this.s.deps.server_time.clock_now();
    try {
      const output = await route.handler(this.route_request(req, path, query, { socket, head: new Uint8Array(head), raw: req }), this.client_ip_of(req));
      if (output !== null) socket.end(`HTTP/1.1 ${String(output.status)} \r\nConnection: close\r\n\r\n`);
      this.route_log(started_at, 0);
    } catch (error) {
      this.error_log(null, `route ${route.key} failed`, error);
      socket.destroy();
      this.route_log(started_at, E.CORE_ERROR_INTERNAL);
    }
  }
}
