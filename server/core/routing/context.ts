/**
 * The per server instance state routing's request processing reads: settings, the prepared modules, and the
 * handlers, routes and operations collected at server start.
 */
import type * as CoreContract from '../../generated/contract/core_contract.ts';
import type * as GameData from '../../generated/data/game_data.ts';
import type {
  AdminApiModule,
  AuthModule,
  CoreRpcHandler,
  GameUpdateModule,
  IdempotencyModule,
  LogEntry,
  LoggingModule,
  ModuleObject,
  NoUserHandler,
  PrepareOperation,
  RouteHandler,
  ServerTimeModule,
  SessionModule,
  StorageModule,
  TokenlessHandler,
  ValidationModule,
} from './module_api.ts';

export type Env = 'LOCAL' | 'DEV' | 'STG' | 'PROD';

/** The server start arguments of `server-core` `## server start`. */
export interface ServerArgs {
  env: Env;
  /** 0 is a free port the OS picks. Default 8080. */
  port?: number;
  matchmaker?: boolean;
  /** SQLite file path or `postgresql`. LOCAL server and test server only. */
  db?: string;
  /** The secret file. LOCAL server and test server only. */
  secret_file?: string;
}

/**
 * A key source (`server-core` `## adapter`): the provider's public key list or root certificate, or the failure
 * value `timeout` or `communication_failure`.
 */
export type KeySource = () => Promise<unknown>;

/** The outgoing HTTP adapter: the global `fetch` as modules call it, with a URL string and the request init. */
export type HttpFetch = (url: string, init: RequestInit) => Promise<Response>;

/**
 * The module input `server` (`server-core` `## module`): the object `create_server` makes once and gives every
 * module of the server instance.
 */
export interface ServerInput {
  /** `--env`. */
  readonly env: Env;
  /** `--db`; null when the server start has none. */
  readonly db: string | null;
  /** True for a server instance with DEV code. */
  readonly dev: boolean;
  /** True when the server start has `--matchmaker`. */
  readonly matchmaker: boolean;
  readonly server_modules: readonly string[];
  /** The server build data as `GameData.load_data_set` loads it. */
  readonly data: GameData.DataSet;
  readonly data_version: string;
  readonly client_data_version: string;
  readonly compat_client_data_version: string | null;
  /** The file adapter: a file of the server build data folder; null when there is none. */
  read_data_file(name: string): Uint8Array | null;
  /** The secret adapter: the `--secret-file` value, or the host secret store value; null when there is none. */
  read_secret(name: string): string | null;
  /** The outgoing HTTP adapter. */
  readonly fetch: HttpFetch;
  /** The log line writer: the `create_server` override, or one line on stdout. */
  write_log_line(line: string): void;
  /** Key source overrides by adapter key. */
  readonly key_sources: Readonly<Record<string, KeySource>>;
  /** Fake adapter overrides by adapter key. */
  readonly fake_adapters: Readonly<Record<string, unknown>>;
  /** The port the instance listens on; 0 before `start()` listens. */
  port(): number;
}

/** The dependency modules routing calls. */
export interface RoutingDeps {
  storage: StorageModule;
  server_time: ServerTimeModule;
  auth: AuthModule;
  session: SessionModule;
  idempotency: IdempotencyModule;
  admin_api: AdminApiModule;
  logging: LoggingModule;
  validation: ValidationModule;
  game_update: GameUpdateModule;
}

/** The routing settings values of one server instance. */
export interface RoutingSettings {
  max_body_bytes: number;
  body_read_timeout_ms: number;
  user_rate_limit_per_minute: number;
  ip_rate_limit_per_minute: number;
  cors_preflight_max_age_ms: number;
  storage_sweep_interval_ms: number;
  trusted_proxy_count: number;
  cors_allowed_origins: readonly string[];
  /** `environments.<ENV>.serverUrl` of this environment; empty for LOCAL. */
  server_url: string;
}

export interface CoreRpcEntry {
  module: string;
  info: CoreContract.RpcInfo;
  handler: CoreRpcHandler | TokenlessHandler | NoUserHandler;
}

export interface RouteEntry {
  module: string;
  /** The route as the spec writes it, e.g. `GET /update/files/<sha256>`. */
  key: string;
  method: string;
  /** Path segments; a segment `<name>` matches any one non-empty segment. */
  segments: readonly string[];
  handler: RouteHandler;
  update: boolean;
}

/** What routing collected at server start. */
export interface Collected {
  game_handlers: ReadonlyMap<string, { info: CoreContract.RpcInfo; handler: CoreRpcHandler }>;
  core_rpcs: ReadonlyMap<string, CoreRpcEntry>;
  routes: readonly RouteEntry[];
  request_start: readonly ((user_id: bigint) => unknown)[];
  prepare: ReadonlyMap<string, PrepareOperation>;
}

/** The handling of the cheat paths that routing's DEV code attaches. */
export interface CheatPaths {
  /** `POST /cheat/<name>` and `POST /core/cheat/<name>` of a DEV code server instance. */
  handle(exchange: import('./pipeline.ts').Exchange, request_name: string): Promise<void>;
  /** True when the cheat request name has a handler. */
  has(request_name: string): boolean;
}

export interface InstanceState {
  readonly server: ServerInput;
  readonly settings: RoutingSettings;
  /** The settings object every module gets (core settings keys and game settings paths). */
  readonly values: Readonly<Record<string, unknown>>;
  readonly deps: RoutingDeps;
  readonly modules: ReadonlyMap<string, ModuleObject>;
  collected: Collected;
  cheat: CheatPaths | null;
  /** Writes a server log line through `logging.write`. */
  log(entry: LogEntry): void;
}
