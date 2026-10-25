/**
 * The shapes routing uses of the other server modules: their `## API` operations as module object methods, and
 * what a module exports for routing to collect (core `rpc` handlers, routes, `on_request_start`, hook slots,
 * admin operations, core cheat handlers).
 *
 * Failure values: a `CoreError` failure value is its `CoreError` number. The other named failure values and
 * outputs are their names as strings (`FAILED`, `WITHDRAWN`, `NAME_MISMATCH`, `COMMITTED`, `REJECTED`). `pass`
 * is the string `pass`, and `none` is `null`.
 */
import type * as CoreContract from '../../generated/contract/core_contract.ts';
import type * as GameData from '../../generated/data/game_data.ts';

/** A `CoreError` value (1..999) or a `GameError` value (1000 and more). */
export type ErrorCode = number;

/** A protobuf message of the generated contract code. */
export interface Message {
  encode(): Uint8Array;
}

/** The request ctx of `storage` `### ctx`. */
export interface RequestCtx {
  readonly user_id: bigint;
  readonly request_name: string;
  readonly request_id: string;
  readonly silent: boolean;
  readonly retry: boolean;
  readonly session_id: string;
  readonly client_version: string;
  readonly platform: string;
  readonly request_time: bigint;
  readonly data: GameData.DataSet;
  readonly data_version: string;
  readonly user_deleted: boolean;
  readonly hook_change_source: unknown;
  readonly seed: bigint;
}

/** A DB handle of `storage`: `db(ctx)`, `db(tx)` or `read_db()`. Routing only passes it on. */
export type DbHandle = unknown;

/** A game tx of `storage.run_game_transaction`. */
export type GameTx = unknown;

/** The request fields `storage.run_request_transaction` puts into the ctx. */
export interface RequestFields {
  request_name: string;
  request_id: string;
  silent: boolean;
  retry: boolean;
  session_id: string;
  client_version: string;
  platform: string;
}

/** A response delta of `storage.take_response_delta`. */
export interface ResponseDelta {
  user_state: CoreContract.UserStateDelta | null;
  pending_user_state: CoreContract.UserStateDelta | null;
  item_changes: CoreContract.ItemChange[];
  item_mails: CoreContract.ItemMail[];
}

export interface TakenResponseDelta {
  delta: ResponseDelta;
  /** `kind` column values of the unknown kind rows `take_response_delta` left out. */
  unknown_kinds: string[];
}

export type ColumnType = 'int64' | 'int32' | 'bool' | 'string' | 'bytes' | 'int64?' | 'int32?' | 'bool?' | 'string?' | 'bytes?';

/** A column of `storage.register_table`. */
export interface ColumnInput {
  readonly name: string;
  readonly type: ColumnType;
}

/** The lifecycle methods of every module object (`server-core` `## module`). */
export interface ModuleLifecycle {
  begin_start?(): void | Promise<void>;
  complete_start?(): string | null | Promise<string | null>;
  stop?(): void | Promise<void>;
}

export interface ServerTimeModule extends ModuleLifecycle {
  /** Server start has ended: every job runs once. routing calls it after every module's `complete_start()` and listening. */
  end_start(): void;
  clock_now(): bigint;
  user_now(user_id: bigint, db: DbHandle): bigint;
  get_window_start(length_ms: bigint, time: bigint): bigint;
  schedule_job(name: string, period_ms: bigint, job: () => unknown): void;
  network_time_limit(ms: bigint): AbortSignal;
}

export interface StorageModule extends ModuleLifecycle {
  read_db(): DbHandle;
  get_user_record(db: DbHandle, user_id: bigint): { readonly public_code: string } | null;
  db(ctx_or_tx: unknown): DbHandle;
  register_table(
    name: string,
    scope: 'user' | 'game',
    columns: readonly ColumnInput[],
    key_columns: readonly string[],
    expiry_column: string | null,
    snapshot: boolean | null,
  ): void;
  run_request_transaction<T>(user_id: bigint, fields: RequestFields, fn: (ctx: RequestCtx) => T): Promise<T | 'FAILED' | 'WITHDRAWN'>;
  run_user_transaction(user_id: bigint, fn: (ctx: RequestCtx) => 'pass' | ErrorCode): Promise<'COMMITTED' | 'WITHDRAWN' | 'REJECTED' | 'FAILED'>;
  run_game_transaction<T>(fn: (tx: GameTx) => T): Promise<T | 'FAILED'>;
  take_response_delta(ctx: RequestCtx): TakenResponseDelta;
  with_hook_change_source<T>(ctx: RequestCtx, source: CoreContract.ItemChangeSource, ref: string, fn: () => T): T;
  sweep_expired(): Promise<number | 'FAILED'>;
  run_user_changes(): Promise<number | 'FAILED'>;
}

/** A row of a DB handle query. */
export type Row = Record<string, unknown>;

/** The parameter SQL of a DB handle: the same SQL text runs on SQLite and PostgreSQL. */
export interface SqlHandle {
  query(sql: string, params: readonly unknown[]): Row[];
}

export interface AuthModule extends ModuleLifecycle {
  verify_access_token(token: string): { user_id: bigint; session_id: string } | ErrorCode;
}

export interface SessionModule extends ModuleLifecycle {
  check_current(user_id: bigint, session_id: string): 'pass' | ErrorCode;
  verify_signature(user_id: bigint, session_id: string, name: string, request_id: string, timestamp: string | null, signature: string | null, body: Uint8Array): 'pass' | ErrorCode;
}

export type StoredResponse = Uint8Array | null | 'NAME_MISMATCH';

export interface IdempotencyModule extends ModuleLifecycle {
  find_response(ctx: RequestCtx): StoredResponse;
  find_committed_response(db: DbHandle, user_id: bigint, request_id: string, request_name: string, at: bigint): StoredResponse;
  find_withdrawn_response(db: DbHandle, token_hash: string, request_id: string, request_name: string, at: bigint): StoredResponse;
  save_response(ctx: RequestCtx, bytes: Uint8Array): void;
  save_withdrawn_response(ctx: RequestCtx, token_hash: string, bytes: Uint8Array): void;
  has_response(db: DbHandle, user_id: bigint, request_id: string): boolean;
}

/** `admin-api.is_banned`: `banned` false, or true with the ban's `until_at`. */
export interface BanState {
  banned: boolean;
  until_at: bigint;
}

export interface AdminApiModule extends ModuleLifecycle {
  is_maintenance(): boolean;
  is_banned(user_id: bigint): BanState;
  is_kill_switched(name: string): boolean;
  register_admin_operation(module: string, operation: AdminOperation): void;
}

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';
export type LogKind = 'request' | 'error' | 'security' | 'audit' | 'game' | 'core';

/** A log field value: `bigint` is written as a decimal string. */
export type LogValue = bigint | number | string | boolean | null | readonly LogValue[];

/**
 * One server log entry of `logging.write`, which adds `time`: the common fields, the fields the kind adds, and for a
 * `request` line its minimum level, request body and `(ogw.sensitive)`.
 */
export interface LogEntry {
  level: LogLevel | null;
  kind: LogKind;
  user_id: bigint | null;
  request_id: string | null;
  request: string | null;
  message: string;
  fields: Readonly<Record<string, LogValue>> | null;
  min_level?: LogLevel | null;
  request_body?: Uint8Array | null;
  sensitive?: boolean | null;
}

export interface LoggingModule extends ModuleLifecycle {
  write(entry: LogEntry): unknown;
  with_request_ip<T>(client_ip: string, fn: () => T): T;
  annotate_request_log(ctx: RequestCtx, fields: Record<string, LogValue>, min_level: LogLevel): unknown;
  take_request_log_annotation(ctx: RequestCtx): { fields: Readonly<Record<string, LogValue>>; min_level: LogLevel };
  count_report_request(user_id: bigint): Promise<'pass' | ErrorCode>;
}

export interface ValidationModule extends ModuleLifecycle {
  validate_request(name: string, message: Message): 'pass' | CoreContract.ValidationFailure;
}

export interface GameUpdateModule extends ModuleLifecycle {
  is_data_update_ready(app_version: string): boolean;
}

/** The content admin operation and the admin operation a module exports (`admin-api`). Routing passes it on. */
export interface AdminOperation {
  name: string;
  role: string;
  [field: string]: unknown;
}

/** The common header values of a request. */
export interface CommonHeaders {
  request_id: string;
  authorization: string | null;
  data_version: string;
  client_version: string;
  platform: string;
  timestamp: string | null;
  signature: string | null;
}

/** The input of a token-less core `rpc` handler. */
export interface TokenlessInput {
  headers: CommonHeaders;
  body: Uint8Array;
  request: Message;
  client_ip: string;
}

/**
 * The output of a token-less core `rpc` handler. `user_id` is the user the handler determined (null when none);
 * `ctx` is the ctx of the request transaction it opened (null when none), whose request time is `server_time_at`.
 */
export type TokenlessOutput =
  | { response: Message; delta: ResponseDelta; user_id: bigint | null; ctx: RequestCtx | null }
  | { error: ErrorCode; ban: CoreContract.BanDetail | null; user_id: bigint | null; ctx: RequestCtx | null };

/** A core `rpc` handler with ctx. `prepare` is the prepare value of a request prepare `rpc`. */
export type CoreRpcHandler = (ctx: RequestCtx, request: Message, prepare?: unknown) => Message | ErrorCode;
export type TokenlessHandler = (input: TokenlessInput) => TokenlessOutput | Promise<TokenlessOutput>;
/** The `NoUserRpc` handler: request message, `X-Ogw-Platform`, `X-Ogw-Client-Version`. */
export type NoUserHandler = (request: Message, platform: string, client_version: string) => Message | Promise<Message>;
/**
 * A request prepare operation: user ID, request message, client IP and request ID, in this order, to a prepare value or
 * a `CoreError`. An operation takes the leading inputs it needs.
 */
export type PrepareOperation = (user_id: bigint, request: Message, client_ip: string, request_id: string) => unknown;

/** An HTTP request a route handler receives. */
export interface RouteRequest {
  method: string;
  /** Path without the query string. */
  path: string;
  /** The query string without `?`; empty when there is none. */
  query: string;
  /** Lower case header names. */
  headers: Readonly<Record<string, string | undefined>>;
  /** Reads the body: null when it passes `max_bytes` or the reading takes longer than `timeout_ms`. */
  read_body(max_bytes: number, timeout_ms: number): Promise<Uint8Array | null>;
  /** The connection of a WebSocket upgrade request; null for other requests. */
  upgrade: { socket: import('node:stream').Duplex; head: Uint8Array; raw: import('node:http').IncomingMessage } | null;
}

/** A route handler's response; null when the handler took over the connection (WebSocket). */
export interface RouteResponse {
  status: number;
  headers?: Record<string, string>;
  body?: Uint8Array | string;
}

export type RouteHandler = (request: RouteRequest, client_ip: string) => RouteResponse | null | Promise<RouteResponse | null>;

/** A cheat handler: ctx and cheat request message to a cheat response message or an error code. */
export type CheatHandler = (ctx: RequestCtx, request: Message) => Message | ErrorCode;

/**
 * `cheat.list_cheat_handlers`: cheat name (request name without `core/cheat/` or `cheat/`), request name, whether it
 * is a core cheat, its `rpc` entry and handler.
 */
export interface CheatModule extends ModuleLifecycle {
  list_cheat_handlers(): readonly { name: string; request_name: string; core: boolean; rpc: CoreContract.RpcInfo; handler: CheatHandler }[];
}

/**
 * A module object. Besides its `## API` operations it may hold, for routing to collect:
 * - a method named after each of its core `rpc` names (e.g. `Resync`) and token-less core `rpc` names (e.g. `Login`)
 * - a method named after each of its routes as the spec writes it (e.g. `GET /update/files/<sha256>`)
 * - `on_request_start(user_id)`
 * - `hook_slots`: an object with a key per hook slot, each null until routing puts the registered hook in
 * - a property named after each of its admin operations, holding the admin operation
 */
export interface ModuleObject extends ModuleLifecycle {
  [name: string]: unknown;
}

/** The DEV object of `create_<module>_dev`. It may hold a method named after each of its core cheats. */
export type DevObject = Record<string, unknown>;
