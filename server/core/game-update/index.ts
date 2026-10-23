/**
 * `game-update`: one signed deploy list per environment and the data, translation and bundle files clients get
 * without an app update. Files go to the `cdn` adapter when there is one.
 */
import { create_cdn_r2_adapter, type CdnR2Settings } from './adapters/cdn_r2.ts';
import { create_admin_operations, type AdminOperations } from './admin.ts';
import { data_update_ready, DeployListCache } from './cache.ts';
import { is_cdn_adapter, type CdnAdapter } from './cdn.ts';
import { file_cache_control, is_app_version } from './deploy_list.ts';
import type { GameUpdateLogging, GameUpdateServer, GameUpdateServerTime, GameUpdateStorage } from './deps.ts';
import { create_routes, type Routes } from './routes.ts';
import { is_trusted, load_signing_key, type SigningKey } from './signing.ts';
import { current_deploy_list, TABLES } from './store.ts';

export type { AdminFailure, AdminOperation, AdminOperations, AdminOutput } from './admin.ts';
export type { CdnAdapter, OutgoingHttp } from './cdn.ts';
export type { GameUpdateLogging, GameUpdateServer, GameUpdateServerTime, GameUpdateStorage } from './deps.ts';
export type { RouteHandler, RouteRequest, RouteResponse, Routes } from './routes.ts';

/** The job that reads the current deploy list again. */
export const CACHE_JOB = 'game_update_cache';

/** The module input (`server-core` `## module`). */
export interface GameUpdateInput {
  readonly settings: Readonly<Record<string, unknown>>;
  readonly modules: Readonly<Record<string, unknown>>;
  readonly server: GameUpdateServer;
}

/** What only the DEV code gives game-update (`dev/index.ts`). */
export interface GameUpdateDevCode {
  /** A new fake `cdn` adapter, for adapter name `fake` when the server instance gives none. */
  create_fake_cdn(): CdnAdapter;
}

/** The module object of game-update: `is_data_update_ready`, the routes, the admin operations and the lifecycle. */
export interface GameUpdate extends Routes, AdminOperations {
  /** `is_data_update_ready`: whether a client of that app version is to update its data now. */
  is_data_update_ready(app_version: string): boolean;
  begin_start(): void;
  complete_start(): string | null;
  stop(): void;
  /** For the DEV code: called before `begin_start` in a server instance with DEV code. */
  include_dev_code(dev: GameUpdateDevCode): void;
}

function integer_setting(settings: Readonly<Record<string, unknown>>, key: string): number {
  const value = settings[key];
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) throw new TypeError(`game-update: setting ${key} is not an integer`);
  return value;
}

function module_of(modules: Readonly<Record<string, unknown>>, name: string): unknown {
  const value = modules[name];
  if (value === undefined || value === null) throw new TypeError(`game-update: module ${name} is missing`);
  return value;
}

function cdn_r2_settings(value: unknown): CdnR2Settings | null {
  if (typeof value !== 'object' || value === null) return null;
  const v = value as Record<string, unknown>;
  const { accountId, bucket, accessKeyId, publicBaseUrl } = v;
  if (typeof accountId !== 'string' || typeof bucket !== 'string' || typeof accessKeyId !== 'string' || typeof publicBaseUrl !== 'string') return null;
  if ([accountId, bucket, accessKeyId, publicBaseUrl].includes('')) return null;
  return { accountId, bucket, accessKeyId, publicBaseUrl };
}

function error_text(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Makes `game-update` for one server instance. A missing or non-integer setting, or a missing module, throws. */
export function create_game_update(input: GameUpdateInput): GameUpdate {
  const { settings, server } = input;
  const storage = module_of(input.modules, 'storage') as GameUpdateStorage;
  const server_time = module_of(input.modules, 'server-time') as GameUpdateServerTime;
  const logging = module_of(input.modules, 'logging') as GameUpdateLogging;
  const max_file_bytes = integer_setting(settings, 'game-update.maxFileBytes');
  const max_deploy_list_bytes = integer_setting(settings, 'game-update.maxDeployListBytes');
  const keep_deploy_lists = integer_setting(settings, 'game-update.keepDeployLists');
  const deploy_list_max_age_ms = integer_setting(settings, 'game-update.deployListMaxAgeMs');
  const file_max_age_ms = integer_setting(settings, 'game-update.fileMaxAgeMs');
  const cache_refresh_ms = integer_setting(settings, 'game-update.cacheRefreshMs');
  const cdn_timeout_ms = integer_setting(settings, 'game-update.cdnTimeoutMs');
  const max_response_bytes = integer_setting(settings, 'routing.externalMaxResponseBytes');

  for (const table of TABLES) storage.register_table(table.name, 'game', table.columns, table.key, null, null);

  const cache = new DeployListCache(() => current_deploy_list(storage.read_db()));
  let dev: GameUpdateDevCode | null = null;
  let signing_key: SigningKey | null = null;
  let cdn: CdnAdapter | null = null;
  let start_error: string | null = null;

  const log_error = (message: string): void => {
    logging.write({ kind: 'error', level: 'error', message, user_id: null, request_id: null, request: null, fields: null });
  };

  /** A secret by its `environments.<ENV>.secrets` key: that key in `--secret-file`, or the host secret its game settings value names. */
  const read_secret = (key: 'updateSigningKey' | 'cdn'): string | null => {
    if (server.db !== null) return server.read_secret(key);
    const name = settings[`environments.<ENV>.secrets.${key}`];
    return typeof name === 'string' && name !== '' ? server.read_secret(name) : null;
  };

  /** The `cdn` adapter of `adapters.cdn`, or the reason server start fails. */
  const resolve_cdn = (): CdnAdapter | string | null => {
    const name = settings['environments.<ENV>.adapters.cdn'] ?? null;
    if (name === null) return null;
    if (name === 'fake') {
      const given = server.fake_adapters.cdn;
      if (is_cdn_adapter(given)) return given;
      if (dev !== null) return dev.create_fake_cdn();
      return 'game-update: cdn adapter fake needs the DEV code';
    }
    if (name !== 'cdn-r2') return `game-update: unknown cdn adapter ${JSON.stringify(name)}`;
    const r2 = cdn_r2_settings(settings['environments.<ENV>.cdnR2']);
    if (r2 === null) return 'game-update: environments.<ENV>.cdnR2 lacks accountId, bucket, accessKeyId or publicBaseUrl';
    const secret = read_secret('cdn');
    if (secret === null) return 'game-update: cannot read the secret cdn';
    return create_cdn_r2_adapter({
      settings: r2,
      secret_access_key: secret,
      http: server.fetch,
      clock_now: () => server_time.clock_now(),
      cache_control: file_cache_control(file_max_age_ms),
      max_response_bytes,
    });
  };

  /** The signing key, or the reason server start fails. */
  const resolve_signing_key = (): SigningKey | string => {
    const secret = read_secret('updateSigningKey');
    if (secret === null) return 'game-update: cannot read the secret updateSigningKey';
    const key = load_signing_key(secret);
    if (key === null) return 'game-update: the secret updateSigningKey is not 32 bytes of standard base64';
    const trusted = settings['environments.<ENV>.updatePublicKeys'];
    if (server.env !== 'LOCAL' && !is_trusted(key.public_key, Array.isArray(trusted) ? trusted : [])) {
      return `game-update: the public key ${key.public_key_base64} of updateSigningKey is not in environments.${server.env}.updatePublicKeys`;
    }
    return key;
  };

  /** Job `game_update_cache`. */
  const refresh_job = (): void => {
    try {
      cache.refresh();
    } catch (error) {
      log_error(`${CACHE_JOB} failed: ${error_text(error)}`);
    }
  };

  const client_data_versions = [server.client_data_version, server.compat_client_data_version];

  const admin_operations = create_admin_operations({
    storage,
    server_time,
    logging,
    cache,
    environment: server.env,
    client_data_version: server.client_data_version,
    compat_client_data_version: server.compat_client_data_version,
    signing_key: () => {
      if (signing_key === null) throw new Error('game-update: no signing key before server start');
      return signing_key;
    },
    cdn: () => {
      const base_url = cdn?.base_url() ?? null;
      return cdn === null || base_url === null ? null : { adapter: cdn, base_url };
    },
    max_file_bytes,
    max_deploy_list_bytes,
    keep_deploy_lists,
    cdn_timeout_ms,
  });

  const routes = create_routes({ current: () => cache.current(), read_db: () => storage.read_db(), deploy_list_max_age_ms, file_max_age_ms });

  return {
    ...routes,
    ...admin_operations,
    is_data_update_ready: (app_version) => {
      if (!is_app_version(app_version)) return false;
      let entry;
      try {
        entry = cache.current();
      } catch (error) {
        log_error(`is_data_update_ready cannot read the deploy list: ${error_text(error)}`);
        return false;
      }
      return data_update_ready(entry, app_version, client_data_versions, server_time.clock_now(), BigInt(deploy_list_max_age_ms) + BigInt(cache_refresh_ms));
    },
    begin_start: () => {
      server_time.schedule_job(CACHE_JOB, BigInt(cache_refresh_ms), refresh_job);
      const key = resolve_signing_key();
      const adapter = resolve_cdn();
      if (typeof key === 'string') start_error = key;
      else signing_key = key;
      if (typeof adapter === 'string') start_error ??= adapter;
      else cdn = adapter;
    },
    complete_start: () => {
      if (start_error !== null) {
        log_error(start_error);
        return start_error;
      }
      return null;
    },
    stop: () => undefined,
    include_dev_code: (code) => {
      dev = code;
    },
  };
}
