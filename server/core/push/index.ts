/**
 * `push`: device token registration, push scheduling, target selection, push text and send records
 * (`server-core` `## module`).
 */
import type * as CoreContract from '../../generated/contract/core_contract.ts';
import { ADAPTER_NAMES, type AdapterKey, type PushAdapter } from './adapter.ts';
import { create_apns_adapter } from './adapters/apns.ts';
import { create_fcm_adapter } from './adapters/fcm.ts';
import { read_settings, type LoggingApi, type PushCore, type PushInput, type RequestCtx, type SessionApi, type StorageApi, type TimeApi } from './core.ts';
import { admin_operations, cancel_push, queue_push, refresh_push_consent, register_push_token, remove_user, type AdminOperation } from './schedule.ts';
import { push_send_job } from './send.ts';
import { register_tables, type PushArg } from './store.ts';
import { Translations } from './translation.ts';

export type { PushAdapter, PushPayload, SendFailure, SendOutcome, SendResult, AdapterKey } from './adapter.ts';
export type { LogEntry, PushInput, PushServer } from './core.ts';
export type { AdminOperation } from './schedule.ts';
export type { PushArg } from './store.ts';

/** The `push` module object: the `## API` operations, its admin operations, the lifecycle, and a DEV-only member. */
export interface Push {
  RegisterPushToken(ctx: RequestCtx, request: CoreContract.RegisterPushTokenRequest): CoreContract.RegisterPushTokenResponse | number;
  queue_push(ctx: RequestCtx, user_id: bigint, message_id: number, args: readonly PushArg[], send_at: bigint, dedupe_key: string): bigint;
  cancel_push(ctx: RequestCtx, user_id: bigint, dedupe_key: string): void;
  refresh_push_consent(ctx: RequestCtx): void;
  remove_user(ctx: RequestCtx): void;
  readonly schedule_push: AdminOperation;
  readonly cancel_scheduled_push: AdminOperation;
  readonly get_push: AdminOperation;
  readonly list_pushes: AdminOperation;
  begin_start(): void;
  complete_start(): string | null;
  stop(): void;
  /** Called by the DEV code only (`dev/index.ts`): makes the fake adapter of each key that selects `fake`. */
  use_fake_adapters(make: (key: AdapterKey) => PushAdapter): void;
}

/** The module object of a dependency; throws when `modules` does not have it. */
function module_of(modules: Readonly<Record<string, unknown>>, name: string, member: string): unknown {
  const value = modules[name] as Record<string, unknown> | undefined;
  if (typeof value?.[member] !== 'function') throw new TypeError(`push: modules has no ${name}`);
  return value;
}

/** Makes the adapter of a key, or the reason it cannot be made. */
function make_adapter(core: PushCore, key: AdapterKey, name: string): PushAdapter | string {
  const s = core.settings;
  if (!(ADAPTER_NAMES[key] as readonly string[]).includes(name)) return `adapters.${key} ${name} is not an adapter name`;
  if (name === 'fake') {
    const given = core.server.fake_adapters?.[key] as PushAdapter | undefined;
    return given ?? core.dev_fakes.get(key) ?? `adapters.${key} is fake and the server instance has no DEV code`;
  }
  // A server with `--db` (LOCAL server, test server) reads the secret by its game settings key, others by its name.
  const secret_key = key === 'push-fcm' ? 'pushFcm' : 'pushApns';
  const secret_name = core.server.db !== null ? secret_key : key === 'push-fcm' ? s.secret_fcm : s.secret_apns;
  const pem = secret_name === '' ? null : core.server.read_secret(secret_name);
  if (pem === null) return `the secret of adapters.${key} cannot be read`;
  const common = { private_key_pem: pem, fetch: core.server.fetch, max_response_bytes: s.external_max_response_bytes, now: () => core.time.clock_now() };
  if (key === 'push-fcm') return create_fcm_adapter({ ...common, project_id: s.fcm_project_id, service_account_email: s.fcm_service_account_email });
  return create_apns_adapter({ ...common, name: name as 'push-apns' | 'push-apns-sandbox', key_id: s.apns_key_id, team_id: s.apple_team_id, topic: s.app_id });
}

/** The server start checks of `## error` and `## settings`, and the adapters. Null, or why server start fails. */
function complete_start(core: PushCore): string | null {
  const s = core.settings;
  const errors = [...core.start_errors];
  const limit = BigInt(s.retry_max_attempts) * (s.send_timeout_ms + s.retry_interval_ms);
  if (s.lease_ms <= limit) errors.push(`push.leaseMs ${String(s.lease_ms)} is not above push.retryMaxAttempts × (push.sendTimeoutMs + push.retryIntervalMs) = ${String(limit)}`);
  if (s.night_start_minute === s.night_end_minute) errors.push('pushConsent.nightStartMinute and pushConsent.nightEndMinute are the same');
  for (const key of Object.keys(ADAPTER_NAMES) as AdapterKey[]) {
    const name = s.adapters[key];
    if (name === null) continue;
    const adapter = make_adapter(core, key, name);
    if (typeof adapter === 'string') errors.push(adapter);
    else core.adapters.set(key, adapter);
  }
  if (errors.length > 0) return `push: ${errors.join('; ')}`;
  core.phase = 'started';
  return null;
}

/** Makes `push` of one server instance. A missing dependency or a missing core settings key throws. */
export function create_push(input: PushInput): Push {
  const core: PushCore = {
    settings: read_settings(input.settings),
    storage: module_of(input.modules, 'storage', 'register_table') as StorageApi,
    time: module_of(input.modules, 'server-time', 'clock_now') as TimeApi,
    session: module_of(input.modules, 'session', 'check_current') as SessionApi,
    logging: module_of(input.modules, 'logging', 'write') as LoggingApi,
    server: input.server,
    translations: new Translations((name) => input.server.read_data_file(name)),
    adapters: new Map(),
    dev_fakes: new Map(),
    phase: 'created',
    start_errors: [],
    logged_failures: new Map(),
  };
  const [schedule_push, cancel_scheduled_push, get_push, list_pushes] = admin_operations(core) as [AdminOperation, AdminOperation, AdminOperation, AdminOperation];
  return {
    RegisterPushToken: (ctx, request) => register_push_token(core, ctx, request),
    queue_push: (ctx, user_id, message_id, args, send_at, dedupe_key) => queue_push(core, ctx, user_id, message_id, args, send_at, dedupe_key),
    cancel_push: (ctx, user_id, dedupe_key) => {
      cancel_push(core, ctx, user_id, dedupe_key);
    },
    refresh_push_consent: (ctx) => {
      refresh_push_consent(core, ctx);
    },
    remove_user: (ctx) => {
      remove_user(core, ctx);
    },
    schedule_push,
    cancel_scheduled_push,
    get_push,
    list_pushes,
    begin_start: () => {
      core.phase = 'starting';
      register_tables(core);
      core.time.schedule_job('push_send', core.settings.poll_interval_ms, push_send_job(core));
    },
    complete_start: () => complete_start(core),
    stop: () => {
      core.phase = 'stopped';
    },
    use_fake_adapters: (make) => {
      if (core.phase !== 'created') throw new Error('push: use_fake_adapters after server start began');
      for (const key of Object.keys(ADAPTER_NAMES) as AdapterKey[]) {
        if (core.settings.adapters[key] === 'fake' && core.server.fake_adapters?.[key] === undefined) core.dev_fakes.set(key, make(key));
      }
    },
  };
}
