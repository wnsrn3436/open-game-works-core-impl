/** The state of one `push` instance, its settings, and the operations of its dependencies it calls. */
import type * as GameData from '../../generated/data/game_data.ts';
import type { JobFunction } from '../server-time/index.ts';
import type { DbHandle, GameTx, RequestCtx, Storage } from '../storage/index.ts';
import type { AdapterKey, PushAdapter } from './adapter.ts';
import type { Fetch } from './adapters/http.ts';
import type { Translations } from './translation.ts';

/** The `session` operation `push` calls (`session` `## API`): `pass`, or `UNAUTHORIZED` or `SESSION_REPLACED`. */
export interface SessionApi {
  check_current(user_id: bigint, session_id: string): 'pass' | number;
}

/** A log entry of `logging.write` (`logging` `## API`). */
export interface LogEntry {
  readonly kind: 'error' | 'core';
  readonly level: 'info' | 'warn' | 'error';
  readonly message: string;
  readonly user_id: bigint | null;
  readonly request_id: string | null;
  readonly request: string | null;
  readonly fields: Readonly<Record<string, string | number | boolean>>;
}

export interface LoggingApi {
  write(entry: LogEntry): void;
}

/** The `server-time` operations `push` calls. */
export interface TimeApi {
  now(ctx: { readonly request_time: bigint; readonly silent: boolean }): bigint;
  clock_now(): bigint;
  schedule_job(name: string, interval_ms: bigint, run: JobFunction): void;
  sleep(ms: bigint): Promise<void>;
  network_time_limit(ms: bigint): AbortSignal;
}

/** The `storage` operations `push` calls. */
export type StorageApi = Pick<Storage, 'register_table' | 'db' | 'read_db' | 'run_game_transaction' | 'lock_game_row' | 'get_state'>;

/** The `server` fields `push` reads (`server-core` `## module`). */
export interface PushServer {
  readonly env: 'LOCAL' | 'DEV' | 'STG' | 'PROD';
  /** `--db`, or null when the server was not given it. */
  readonly db: string | null;
  readonly data: GameData.DataSet;
  read_data_file(name: string): Uint8Array | null;
  read_secret(name: string): string | null;
  readonly fetch: Fetch;
  /** Fake adapters by adapter key that the server instance was given. */
  readonly fake_adapters?: Readonly<Partial<Record<string, unknown>>>;
}

/** The module input (`server-core` `## module`). */
export interface PushInput {
  readonly settings: Readonly<Record<string, unknown>>;
  readonly modules: Readonly<Record<string, unknown>>;
  readonly server: PushServer;
}

/** The settings of `push` `## settings`. Times and durations are `bigint` ms. */
export interface PushSettings {
  readonly max_device_token_bytes: number;
  readonly max_dedupe_key_bytes: number;
  readonly max_schedule_ahead_ms: bigint;
  readonly max_scheduled_per_user: number;
  readonly max_target_user_ids: number;
  readonly poll_interval_ms: bigint;
  readonly lease_ms: bigint;
  readonly max_delay_ms: bigint;
  readonly send_batch_size: number;
  readonly send_timeout_ms: bigint;
  readonly retry_interval_ms: bigint;
  readonly retry_max_attempts: number;
  readonly record_retention_ms: bigint;
  readonly external_max_response_bytes: number;
  readonly supported_languages: readonly string[];
  readonly ad_push: boolean;
  readonly night_start_minute: number;
  readonly night_end_minute: number;
  readonly adapters: Readonly<Record<AdapterKey, string | null>>;
  readonly secret_fcm: string;
  readonly secret_apns: string;
  readonly fcm_project_id: string;
  readonly fcm_service_account_email: string;
  readonly apple_team_id: string;
  readonly apns_key_id: string;
  readonly app_id: string;
}

const INTEGER_KEYS = {
  max_device_token_bytes: 'push.maxDeviceTokenBytes',
  max_dedupe_key_bytes: 'push.maxDedupeKeyBytes',
  max_schedule_ahead_ms: 'push.maxScheduleAheadMs',
  max_scheduled_per_user: 'push.maxScheduledPerUser',
  max_target_user_ids: 'push.maxTargetUserIds',
  poll_interval_ms: 'push.pollIntervalMs',
  lease_ms: 'push.leaseMs',
  max_delay_ms: 'push.maxDelayMs',
  send_batch_size: 'push.sendBatchSize',
  send_timeout_ms: 'push.sendTimeoutMs',
  retry_interval_ms: 'push.retryIntervalMs',
  retry_max_attempts: 'push.retryMaxAttempts',
  record_retention_ms: 'push.recordRetentionMs',
  external_max_response_bytes: 'routing.externalMaxResponseBytes',
} as const;

function integer(settings: Readonly<Record<string, unknown>>, key: string): number {
  const value = settings[key];
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) throw new TypeError(`push: setting ${key} is not an integer`);
  return value;
}

function text(settings: Readonly<Record<string, unknown>>, key: string): string {
  const value = settings[key];
  return typeof value === 'string' ? value : '';
}

function adapter_name(settings: Readonly<Record<string, unknown>>, key: AdapterKey): string | null {
  const value = settings[`environments.<ENV>.adapters.${key}`];
  return typeof value === 'string' ? value : null;
}

/** Reads the settings. A missing or non-integer core settings key throws; a missing game settings item is empty. */
export function read_settings(settings: Readonly<Record<string, unknown>>): PushSettings {
  const n = (name: keyof typeof INTEGER_KEYS): number => integer(settings, INTEGER_KEYS[name]);
  const languages = settings.supportedLanguages;
  const night = (key: string, fallback: number): number => {
    const value = settings[key];
    return typeof value === 'number' && Number.isSafeInteger(value) ? value : fallback;
  };
  return {
    max_device_token_bytes: n('max_device_token_bytes'),
    max_dedupe_key_bytes: n('max_dedupe_key_bytes'),
    max_schedule_ahead_ms: BigInt(n('max_schedule_ahead_ms')),
    max_scheduled_per_user: n('max_scheduled_per_user'),
    max_target_user_ids: n('max_target_user_ids'),
    poll_interval_ms: BigInt(n('poll_interval_ms')),
    lease_ms: BigInt(n('lease_ms')),
    max_delay_ms: BigInt(n('max_delay_ms')),
    send_batch_size: n('send_batch_size'),
    send_timeout_ms: BigInt(n('send_timeout_ms')),
    retry_interval_ms: BigInt(n('retry_interval_ms')),
    retry_max_attempts: n('retry_max_attempts'),
    record_retention_ms: BigInt(n('record_retention_ms')),
    external_max_response_bytes: n('external_max_response_bytes'),
    supported_languages: Array.isArray(languages) ? languages.filter((l): l is string => typeof l === 'string') : [],
    ad_push: settings['pushConsent.adPush'] === true,
    night_start_minute: night('pushConsent.nightStartMinute', 0),
    night_end_minute: night('pushConsent.nightEndMinute', 0),
    adapters: { 'push-fcm': adapter_name(settings, 'push-fcm'), 'push-apns': adapter_name(settings, 'push-apns') },
    secret_fcm: text(settings, 'environments.<ENV>.secrets.pushFcm'),
    secret_apns: text(settings, 'environments.<ENV>.secrets.pushApns'),
    fcm_project_id: text(settings, 'environments.<ENV>.fcm.projectId'),
    fcm_service_account_email: text(settings, 'environments.<ENV>.fcm.serviceAccountEmail'),
    apple_team_id: text(settings, 'appleTeamId'),
    apns_key_id: text(settings, 'pushApns.keyId'),
    app_id: text(settings, 'appId'),
  };
}

/** The state of one `push` instance. */
export interface PushCore {
  readonly settings: PushSettings;
  readonly storage: StorageApi;
  readonly time: TimeApi;
  readonly session: SessionApi;
  readonly logging: LoggingApi;
  readonly server: PushServer;
  readonly translations: Translations;
  /** Adapters by adapter key, set at server start; a key whose adapter value is null has none. */
  readonly adapters: Map<AdapterKey, PushAdapter>;
  /** Fake adapters the DEV code made for keys that select `fake` and that `server.fake_adapters` does not have. */
  readonly dev_fakes: Map<AdapterKey, PushAdapter>;
  phase: 'created' | 'starting' | 'started' | 'stopped';
  readonly start_errors: string[];
  /**
   * Records whose adapter failure or empty text part this instance logged, by push ID. Held sends of a record run in
   * other batches and runs after its own batches, and log a failure only when the record has not logged it yet.
   */
  readonly logged_failures: Map<bigint, LoggedFailures>;
}

/** The failures of a record that were logged, and the clock time the entry may go. */
export interface LoggedFailures {
  adapter: boolean;
  text: boolean;
  until: bigint;
}

export type Tx = RequestCtx | GameTx;
export type { DbHandle, GameTx, RequestCtx };

/** Writes a log line of `push`. `error` level lines are `kind` `error`; the others are `core`. */
export function log(core: PushCore, level: LogEntry['level'], message: string, fields: LogEntry['fields'], ctx: RequestCtx | null = null): void {
  core.logging.write({
    kind: level === 'error' ? 'error' : 'core',
    level,
    message,
    user_id: ctx?.user_id ?? null,
    request_id: ctx === null || ctx.request_id === '' ? null : ctx.request_id,
    request: ctx === null || ctx.request_name === '' ? null : ctx.request_name,
    fields,
  });
}

/** The UTF-8 byte length of a string. */
export function utf8_length(value: string): number {
  return Buffer.byteLength(value, 'utf8');
}
