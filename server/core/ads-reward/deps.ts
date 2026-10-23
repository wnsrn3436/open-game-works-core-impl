/**
 * The operations of other modules `ads-reward` calls, in the TypeScript form of their specs (`server-core`
 * `## module`), and the module input.
 */
import type * as GameData from '../../generated/data/game_data.ts';
import type { IdempotencyModule } from '../idempotency/index.ts';
import type { Logging } from '../logging/index.ts';
import type { Mailbox } from '../mailbox/index.ts';
import type { ServerTimeApi } from '../server-time/index.ts';
import type { Storage } from '../storage/index.ts';
import type { KeySource } from './adapter.ts';

export type AdsRewardMailbox = Pick<Mailbox, 'grant_or_mail'>;
export type AdsRewardLogging = Pick<Logging, 'write' | 'track_core_event'>;
export type AdsRewardStorage = Pick<
  Storage,
  'register_table' | 'db' | 'read_db' | 'get_state' | 'put_core_state' | 'run_user_transaction' | 'run_game_transaction' | 'run_savepoint' | 'with_hook_change_source' | 'check_hook_output'
>;
export type AdsRewardServerTime = Pick<ServerTimeApi, 'now' | 'clock_now' | 'get_next_reset' | 'get_window_start' | 'sleep' | 'network_time_limit'>;
export type AdsRewardIdempotency = Pick<IdempotencyModule, 'claim_notify'>;

/** The fields of the `routing.create_server` server object `ads-reward` reads. */
export interface AdsRewardServer {
  readonly data: GameData.DataSet;
  readonly fetch?: typeof globalThis.fetch;
  /** Key source overrides by adapter key. */
  readonly key_sources?: Readonly<Record<string, KeySource | undefined>>;
  /** Fake adapter overrides by adapter key. */
  readonly fake_adapters?: Readonly<Record<string, unknown>>;
}

/** The module input (`server-core` `## module`). */
export interface AdsRewardInput {
  readonly settings: Readonly<Record<string, unknown>>;
  readonly modules: Readonly<Record<string, unknown>>;
  readonly server: AdsRewardServer;
}

/** The modules of `modules` by name, checked for the operations `ads-reward` calls. */
export interface AdsRewardModules {
  readonly storage: AdsRewardStorage;
  readonly time: AdsRewardServerTime;
  readonly idempotency: AdsRewardIdempotency;
  readonly mailbox: AdsRewardMailbox;
  readonly logging: AdsRewardLogging;
}

function module_with(modules: Readonly<Record<string, unknown>>, name: string, operations: readonly string[]): unknown {
  const value = modules[name];
  const object = (typeof value === 'object' && value !== null ? value : null) as Record<string, unknown> | null;
  if (object === null || operations.some((op) => typeof object[op] !== 'function')) throw new TypeError(`ads-reward: modules has no ${name}`);
  return object;
}

/** The dependency modules; a missing one throws. */
export function read_modules(modules: Readonly<Record<string, unknown>>): AdsRewardModules {
  return {
    storage: module_with(modules, 'storage', ['register_table', 'db', 'read_db', 'run_user_transaction', 'run_game_transaction', 'check_hook_output']) as AdsRewardStorage,
    time: module_with(modules, 'server-time', ['clock_now', 'get_next_reset', 'sleep', 'network_time_limit']) as AdsRewardServerTime,
    idempotency: module_with(modules, 'idempotency', ['claim_notify']) as AdsRewardIdempotency,
    mailbox: module_with(modules, 'mailbox', ['grant_or_mail']) as AdsRewardMailbox,
    logging: module_with(modules, 'logging', ['write', 'track_core_event']) as AdsRewardLogging,
  };
}

/** The core settings keys and game settings path of `## settings`. */
export interface AdsRewardSettings {
  readonly ticket_ttl_ms: bigint;
  readonly claim_wait_ms: bigint;
  readonly claim_poll_interval_ms: bigint;
  readonly max_query_bytes: number;
  readonly key_cache_ms: bigint;
  readonly key_refetch_interval_ms: bigint;
  readonly key_fetch_timeout_ms: bigint;
  readonly callback_rate_limit_per_minute: number;
  /** `environments.<ENV>.adapters.ads`: null when this environment has no ads adapter. */
  readonly adapter_name: string | null;
  readonly external_max_response_bytes: number;
  /** `idempotency.maxNotifyIdBytes`. */
  readonly max_notify_id_bytes: number;
}

function integer(settings: Readonly<Record<string, unknown>>, key: string, min: number): number {
  const value = settings[key];
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min) throw new TypeError(`ads-reward: setting ${key} is not an integer of ${String(min)} or more`);
  return value;
}

/** Reads `## settings`; a missing or malformed value, or a value below its range, throws. */
export function read_settings(settings: Readonly<Record<string, unknown>>): AdsRewardSettings {
  const adapter = settings['environments.<ENV>.adapters.ads'];
  if (adapter !== null && adapter !== undefined && typeof adapter !== 'string') throw new TypeError('ads-reward: setting environments.<ENV>.adapters.ads is not a string');
  return {
    ticket_ttl_ms: BigInt(integer(settings, 'ads-reward.ticketTtlMs', 1)),
    claim_wait_ms: BigInt(integer(settings, 'ads-reward.claimWaitMs', 0)),
    claim_poll_interval_ms: BigInt(integer(settings, 'ads-reward.claimPollIntervalMs', 1)),
    max_query_bytes: integer(settings, 'ads-reward.maxQueryBytes', 1),
    key_cache_ms: BigInt(integer(settings, 'ads-reward.keyCacheMs', 1)),
    key_refetch_interval_ms: BigInt(integer(settings, 'ads-reward.keyRefetchIntervalMs', 0)),
    key_fetch_timeout_ms: BigInt(integer(settings, 'ads-reward.keyFetchTimeoutMs', 1)),
    callback_rate_limit_per_minute: integer(settings, 'ads-reward.callbackRateLimitPerMinute', 1),
    adapter_name: adapter ?? null,
    external_max_response_bytes: integer(settings, 'routing.externalMaxResponseBytes', 1),
    max_notify_id_bytes: integer(settings, 'idempotency.maxNotifyIdBytes', 1),
  };
}
