/**
 * The state of auth in one server instance: settings, module objects, the access token key, the social adapters,
 * and the helpers every handler uses (server logs, the ConsentUserState refresh, request fields).
 */
import * as CoreContract from '../../generated/contract/core_contract.ts';
import { truncate_ip } from '../logging/index.ts';
import type { AppleAdapter, GoogleAdapter } from './adapters/common.ts';
import { recompute, same_state, utc_year_month } from './consent.ts';
import type { AuthModules, AuthServer, CoreErrorCode, Ctx, LogEntry, LogLevel, LogValue, RequestFields, ResponseDelta } from './deps.ts';
import type { AuthSettings } from './settings.ts';
import { birth_year_month } from './tables.ts';
import type { AccessTokenKey } from './token.ts';

export const E = CoreContract.CoreError;

export interface AuthState {
  readonly settings: AuthSettings;
  readonly modules: AuthModules;
  readonly server: AuthServer;
  /** Set at server start. */
  token_key: AccessTokenKey | null;
  apple: AppleAdapter | null;
  google: GoogleAdapter | null;
}

/** The common header values `routing` gives a token-less core `rpc` handler (`routing` common header). */
export interface CommonHeaders {
  readonly request_id: string;
  /** The token of `Authorization: Bearer <token>`; null when there is none. */
  readonly authorization: string | null;
  readonly data_version: string;
  readonly client_version: string;
  readonly platform: string;
  readonly timestamp: string | null;
  readonly signature: string | null;
}

/** The input of a token-less core `rpc` handler as `routing` gives it (`routing` `## API`). */
export interface RoutingTokenlessInput<Req> {
  readonly headers: CommonHeaders;
  readonly body: Uint8Array;
  readonly request: Req;
  readonly client_ip: string;
}

/** What a token-less handler of auth reads of its request. */
export interface TokenlessInput<Req> {
  readonly request_id: string;
  /** The token of `Authorization: Bearer <token>`; empty when there is none. */
  readonly authorization: string;
  readonly timestamp: string | null;
  readonly signature: string | null;
  readonly client_version: string;
  readonly platform: string;
  readonly body: Uint8Array;
  readonly request: Req;
  readonly client_ip: string;
}

/** The handler input of a `routing` token-less input. */
export function tokenless_input<Req>(input: RoutingTokenlessInput<Req>): TokenlessInput<Req> {
  const h = input.headers;
  return {
    request_id: h.request_id,
    authorization: h.authorization ?? '',
    timestamp: h.timestamp,
    signature: h.signature,
    client_version: h.client_version,
    platform: h.platform,
    body: input.body,
    request: input.request,
    client_ip: input.client_ip,
  };
}

/**
 * The output of a token-less handler: the response and its response delta, or a `CoreError` (with the ban of
 * `BANNED`). `user_id` is the user the handler found (null before that) and `ctx` the request ctx it made, if any.
 */
export type TokenlessOutput<Res> =
  | { readonly ok: true; readonly response: Res; readonly delta: ResponseDelta; readonly user_id: bigint | null; readonly ctx: Ctx | null }
  | { readonly ok: false; readonly error: CoreErrorCode; readonly ban: CoreContract.BanDetail | null; readonly user_id: bigint | null; readonly ctx: Ctx | null };

export function failure(error: CoreErrorCode, user_id: bigint | null = null, ctx: Ctx | null = null): TokenlessOutput<never> {
  return { ok: false, error, ban: null, user_id, ctx };
}

export function empty_delta(): ResponseDelta {
  return { user_state: null, pending_user_state: null, item_changes: [], item_mails: [] };
}

export function request_fields(name: string, input: TokenlessInput<unknown>, options: { silent?: boolean; retry?: boolean; session_id?: string } = {}): RequestFields {
  return {
    request_name: name,
    request_id: input.request_id,
    silent: options.silent ?? false,
    retry: options.retry ?? false,
    session_id: options.session_id ?? '',
    client_version: input.client_version,
    platform: input.platform,
  };
}

/** True when a value is a `CoreError` a transaction function returned rather than its result. */
export function is_error(value: unknown): value is CoreErrorCode {
  return typeof value === 'number';
}

/** The truncated IP (`server-core` `## log`), as `logging` truncates it. */
export const truncated_ip = truncate_ip;

interface LogTarget {
  readonly user_id?: bigint | null;
  readonly request_id?: string | null;
  readonly request?: string | null;
}

function write(a: AuthState, level: LogLevel, kind: LogEntry['kind'], message: string, target: LogTarget, fields: Readonly<Record<string, LogValue>>): void {
  a.modules.logging.write({ level, kind, message, user_id: target.user_id ?? null, request_id: target.request_id ?? null, request: target.request ?? null, fields });
}

/** A `security` log line. `ip` is the client IP; the line keeps its truncated IP. */
export function security_log(a: AuthState, message: string, target: LogTarget, reason: string, ip: string, fields: Readonly<Record<string, LogValue>> = {}): void {
  write(a, 'warn', 'security', message, target, { ...fields, ip: truncated_ip(ip), reason });
}

/** An `audit` log line of a change auth makes on its own (`actor` `system`). */
export function audit_log(a: AuthState, message: string, target: LogTarget, fields: Readonly<Record<string, LogValue>>): void {
  write(a, 'info', 'audit', message, target, { actor: 'system', ...fields });
}

export function error_log(a: AuthState, message: string, target: LogTarget, fields: Readonly<Record<string, LogValue>> = {}): void {
  write(a, 'error', 'error', message, target, { stack_trace: null, ...fields });
}

/** The access token key. Set at server start, so a handler always has it. */
export function token_key(a: AuthState): AccessTokenKey {
  if (a.token_key === null) throw new Error('auth: the access token key is not set before server start');
  return a.token_key;
}

/**
 * The address of the web account deletion page: the environment's `serverUrl` without one trailing `/`, then
 * `/account/deletion`; on LOCAL, the port the server listens on at 127.0.0.1.
 */
export function web_deletion_url(env: string, port: number, server_url: string): string {
  if (env === 'LOCAL') return `http://127.0.0.1:${String(port)}/account/deletion`;
  return `${server_url.endsWith('/') ? server_url.slice(0, -1) : server_url}/account/deletion`;
}

/** The address of the web account deletion page of this server instance. */
export function deletion_url(a: AuthState): string {
  return web_deletion_url(a.server.env, a.server.listen_port(), a.settings.server_url);
}

/**
 * Recomputes the user's `ConsentUserState` from its stored value (or the default) and writes it when it changed.
 * `edit` changes the stored answers first. Returns the state.
 */
export function refresh_consent(a: AuthState, ctx: Ctx, edit?: (state: CoreContract.ConsentUserState) => void): CoreContract.ConsentUserState {
  const { storage } = a.modules;
  const stored = storage.get_state(ctx, CoreContract.ConsentUserState, 0n);
  const base = Object.assign(new CoreContract.ConsentUserState(), stored ?? {});
  edit?.(base);
  const birth = birth_year_month(storage.db(ctx), ctx.user_id);
  const next = recompute(base, birth, utc_year_month(a.modules['server-time'].clock_now()), a.settings);
  if (stored === null || !same_state(stored, next)) storage.put_core_state(ctx, next);
  return next;
}

/** Notes the unknown kind rows a delta skipped on the `request` log (`routing` 16th step). */
export function note_unknown_kinds(a: AuthState, ctx: Ctx, kinds: readonly string[]): void {
  if (kinds.length > 0) a.modules.logging.annotate_request_log(ctx, { unknown_kinds: kinds.join(',') }, 'warn');
}
