/**
 * The operations auth uses of other modules and of its server instance, as auth calls them. Each module interface
 * holds only the `## API` operations of that module's spec that auth calls. auth reaches other modules only through
 * these types, so the shapes the spec leaves open (how a failure value or a DB handle looks in TypeScript) are in
 * this one file.
 */
import type { webcrypto } from 'node:crypto';
import type * as CoreContract from '../../generated/contract/core_contract.ts';
import type * as GameData from '../../generated/data/game_data.ts';

/** A `CoreError` value. */
export type CoreErrorCode = CoreContract.CoreError;

/** The request ctx (`storage` `### ctx`). */
export interface Ctx {
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
  readonly seed: bigint;
}

/** A game transaction of `storage.run_game_transaction`. auth only passes it on. */
export type GameTx = object;

export type SqlValue = bigint | number | string | boolean | Uint8Array | null;
export type SqlRow = Readonly<Record<string, SqlValue>>;

/** A DB handle (`storage` `## API`): parameter SQL (`$1`, `$2`, ...) on the tables auth registered. */
export interface DbHandle {
  /** The rows of a statement: of a `SELECT`, or of a statement with `RETURNING`; empty for the others. */
  query(sql: string, params: readonly SqlValue[]): readonly SqlRow[];
}

export type ColumnType = 'int64' | 'int32' | 'bool' | 'string' | 'bytes' | 'int64?' | 'int32?' | 'bool?' | 'string?' | 'bytes?';

export interface ColumnDefinition {
  readonly name: string;
  readonly type: ColumnType;
}

/** The request field of `storage.run_request_transaction`. */
export interface RequestFields {
  readonly request_name: string;
  readonly request_id: string;
  readonly silent: boolean;
  readonly retry: boolean;
  readonly session_id: string;
  readonly client_version: string;
  readonly platform: string;
}

/** The response delta of `storage.take_response_delta`. */
export interface ResponseDelta {
  readonly user_state: CoreContract.UserStateDelta | null;
  readonly pending_user_state: CoreContract.UserStateDelta | null;
  readonly item_changes: readonly CoreContract.ItemChange[];
  readonly item_mails: readonly CoreContract.ItemMail[];
}

/** `storage.take_response_delta`: the response delta and the `kind` column values of the unknown kind rows it skipped. */
export interface TakenDelta {
  readonly delta: ResponseDelta;
  readonly unknown_kinds: readonly string[];
}

/** The output of `storage.read_full_state`. */
export interface FullState {
  readonly delta: CoreContract.UserStateDelta;
  readonly item_changes: readonly CoreContract.ItemChange[];
  readonly item_mails: readonly CoreContract.ItemMail[];
  readonly unknown_kinds: readonly string[];
}

export interface UserRecord {
  readonly created_at: bigint;
  readonly withdrawn_at: bigint | null;
}

/** A kind class: the generated class of a UserState kind. */
export interface KindClass<T> {
  new (): T;
  decode(bytes: Uint8Array): T | null;
}

/** The failure code a change function returns. */
export type FailureCode = number;

/**
 * `storage`. The functions given to `run_user_transaction`, `run_request_transaction` and `run_game_transaction`
 * are synchronous (`storage` `## behavior`).
 */
export interface Storage {
  get_state<T>(ctx: Ctx, kind: KindClass<T>, item_id: bigint): T | null;
  put_core_state(ctx: Ctx, value: object): void;
  run_user_transaction(user_id: bigint, change: (ctx: Ctx) => 'pass' | FailureCode): Promise<'COMMITTED' | 'WITHDRAWN' | 'REJECTED' | 'FAILED'>;
  /** The function's result; a failure code result is rolled back. */
  run_request_transaction<R>(user_id: bigint, fields: RequestFields, run: (ctx: Ctx) => R): Promise<R | 'FAILED' | 'WITHDRAWN'>;
  take_response_delta(ctx: Ctx): TakenDelta;
  run_game_transaction<R>(run: (tx: GameTx) => R): Promise<R | 'FAILED'>;
  after_commit(ctx: Ctx, run: () => unknown): void;
  db(ctx_or_tx: Ctx | GameTx): DbHandle;
  read_db(): DbHandle;
  create_user(tx: GameTx): bigint;
  delete_user(ctx: Ctx): void;
  get_user_record(db: DbHandle, user_id: bigint): UserRecord | null;
  scan_users(db: DbHandle, after_user_id: bigint, max: number): readonly bigint[];
  read_full_state(ctx: Ctx): FullState;
  register_table(
    name: string,
    scope: 'user' | 'game',
    columns: readonly ColumnDefinition[],
    key: readonly string[],
    expiry: string | null,
    snapshot: boolean | null,
    personal_user_column?: string | null,
    indexes?: readonly (readonly string[])[],
  ): void;
}

export interface Session {
  start_session(ctx: Ctx): { readonly session_id: string; readonly signing_key: string };
  end_session(ctx: Ctx): void;
  check_current(user_id: bigint, session_id: string): 'pass' | CoreErrorCode;
  verify_signature(user_id: bigint, session_id: string, name: string, request_id: string, timestamp: string | null, signature: string | null, body: Uint8Array): 'pass' | CoreErrorCode;
}

export interface ServerTime {
  now(ctx: Ctx): bigint;
  clock_now(): bigint;
  user_now(user_id: bigint, db: DbHandle): bigint;
  get_window_start(length_ms: bigint, time: bigint): bigint;
  schedule_job(name: string, interval_ms: bigint, run: () => unknown): void;
  network_time_limit(ms: bigint): AbortSignal;
}

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';
export type LogValue = string | number | bigint | boolean | null | readonly string[];

/** A server log entry: the common fields and the fields of its `kind`. */
export interface LogEntry {
  readonly level: LogLevel;
  readonly kind: 'error' | 'security' | 'audit' | 'core';
  readonly message: string;
  readonly user_id: bigint | null;
  readonly request_id: string | null;
  readonly request: string | null;
  readonly fields: Readonly<Record<string, LogValue>>;
}

export interface Logging {
  write(entry: LogEntry): unknown;
  annotate_request_log(ctx: Ctx, fields: Readonly<Record<string, string | number | boolean>>, min_level: LogLevel): unknown;
  track_core_event(ctx: Ctx, name: string, params: readonly (readonly [string, string | number | boolean])[]): unknown;
  request_analytics_deletion(ctx: Ctx): unknown;
}

export interface AdminApi {
  is_maintenance(): boolean;
  /** `banned` true with the ban's `until_at`, or `banned` false. */
  is_banned(user_id: bigint): { readonly banned: boolean; readonly until_at: bigint };
}

/** A module whose `on_request_start` is in `routing`'s request start table. */
export interface RequestStart {
  on_request_start(user_id: bigint): unknown;
}

export interface RemoteConfig {
  get_client_config(ctx: Ctx): { readonly entries: readonly CoreContract.RemoteConfigEntry[]; readonly assignments: readonly CoreContract.ExperimentAssignment[] };
}

/** `ranking`, `push`, `iap`, `block-report` `remove_user`. */
export interface RemoveUser {
  remove_user(ctx: Ctx): unknown;
}

/** `chat`, `friend`, `guild` `remove_user`. */
export interface FallibleRemoveUser {
  remove_user(ctx: Ctx): 'FAILED' | null | undefined;
}

export interface Iap extends RemoveUser {
  register_account_lookup(has_social_link: (db: DbHandle, user_id: bigint) => boolean): void;
  has_granted_payment(ctx: Ctx, user_id: bigint): boolean;
}

export interface Push extends RemoveUser {
  refresh_push_consent(ctx: Ctx): unknown;
}

/** The module objects auth uses, by module name: `dependencies` always, `optionalDependencies` when on the server module list. */
export interface AuthModules {
  readonly session: Session;
  readonly storage: Storage;
  readonly 'server-time': ServerTime;
  readonly logging: Logging;
  readonly 'admin-api': AdminApi;
  readonly mailbox: RequestStart;
  readonly 'live-event'?: RequestStart;
  readonly 'public-profile'?: RequestStart;
  readonly 'remote-config'?: RemoteConfig;
  readonly ranking?: RemoveUser;
  readonly push?: Push;
  readonly iap?: Iap;
  readonly friend?: FallibleRemoveUser;
  readonly guild?: FallibleRemoveUser;
  readonly chat?: FallibleRemoveUser;
  readonly 'block-report'?: RemoveUser;
}

export type Environment = 'LOCAL' | 'DEV' | 'STG' | 'PROD';
export type SocialAdapterKey = 'login-apple' | 'login-google';

/** One outgoing HTTP request. The adapter stops reading a response body longer than `max_response_bytes`. */
export interface HttpRequest {
  readonly method: 'GET' | 'POST';
  readonly url: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: Uint8Array | null;
  readonly max_response_bytes: number;
  readonly signal: AbortSignal;
}

export type HttpResult =
  | { readonly ok: true; readonly status: number; readonly body: Uint8Array }
  | { readonly ok: false; readonly failure: 'timeout' | 'communication' | 'too_large' };

export type HttpAdapter = (request: HttpRequest) => Promise<HttpResult>;

/** A key source (`server-core` `## adapter`): the provider's JWKS keys, or the failure. */
export type KeySource = (signal: AbortSignal) => Promise<{ readonly ok: true; readonly keys: readonly webcrypto.JsonWebKey[] } | { readonly ok: false; readonly failure: 'timeout' | 'communication' }>;

/** What auth reads of the module input `server` (`server-core` `## module`). */
export interface AuthServerInput {
  readonly env: Environment;
  /** `--db`; given only to a LOCAL server and a test server, which read secrets from `--secret-file`. */
  readonly db: string | null;
  readonly data: GameData.DataSet;
  read_data_file(name: string): Uint8Array | null;
  read_secret(name: string): string | null;
  /** The outgoing HTTP adapter: the global `fetch` signature. */
  readonly fetch: (url: string, init: RequestInit) => Promise<Response>;
  /** Key source overrides by adapter key: the value, or `timeout` or `communication_failure`. */
  readonly key_sources: Readonly<Record<string, () => Promise<unknown>>>;
  readonly fake_adapters: Readonly<Record<string, unknown>>;
  port(): number;
}

/** The module input (`server-core` `## module`). */
export interface AuthInput {
  readonly settings: Readonly<Record<string, unknown>>;
  readonly modules: AuthModules;
  readonly server: AuthServerInput;
}

/** What auth uses of its server instance, made from the module input `server` (`server_view.ts`). */
export interface AuthServer {
  readonly env: Environment;
  /** The port the server instance listens on. Read after server start. */
  listen_port(): number;
  /** A secret value by its `environments.<ENV>.secrets` key; null when it cannot be read. */
  read_secret(key: string): string | null;
  /** The server build data container and accessor. */
  readonly data: GameData.DataSet;
  /** A server build data file (`server/build/data/<name>`); null when there is none. */
  read_data_file(name: string): Uint8Array | null;
  readonly http: HttpAdapter;
  /** The key source override of an adapter key; null for the default key source. */
  key_source(key: SocialAdapterKey): KeySource | null;
  /** The fake adapter override of an adapter key; null when the instance makes its own fake adapter. */
  fake_adapter(key: SocialAdapterKey): unknown;
}
