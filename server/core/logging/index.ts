import { AsyncLocalStorage } from 'node:async_hooks';
import * as CoreContract from '../../generated/contract/core_contract.ts';
import type { ServerTimeApi } from '../server-time/index.ts';
import type { GameTx, RequestCtx, Storage } from '../storage/index.ts';
import { create_analytics_ga4_adapter, type HttpFetch } from './adapters/analytics_ga4.ts';
import {
  client_name_refused,
  filter_params,
  params_bytes,
  server_event_problem,
  to_param,
  within,
  type AdapterFailure,
  type AnalyticsAdapter,
  type AnalyticsSendEvent,
  type EventLimits,
  type ParamList,
} from './analytics.ts';
import { annotation_problem, split_fields, type FieldObject } from './fields.ts';
import { format_line, higher_level, is_level, SecurityWindows, truncate_ip, type Level, type LogEntry, type LogFields, type LogValue, type SecuritySummary } from './log_line.ts';
import {
  CLIENT_ERROR,
  CLIENT_EVENT,
  COUNT_ANALYTICS_DELETION_ATTEMPT,
  DELETE_ANALYTICS_DELETION,
  entry_of,
  INSERT_ANALYTICS_DELETION,
  INSERT_CLIENT_ERROR,
  INSERT_CLIENT_EVENT,
  INSERT_SERVER_EVENT,
  int64_of,
  list_rows,
  register_tables,
  SELECT_ANALYTICS_DELETIONS,
  SERVER_EVENT,
  UPSERT_REPORT_COUNTER,
  type DbValue,
  type ListedTable,
} from './tables.ts';

export type { AdapterFailure, AnalyticsAdapter, AnalyticsSendEvent, ParamList, ParamValue } from './analytics.ts';
export type { HttpFetch } from './adapters/analytics_ga4.ts';
export type { Level, LogEntry, LogFields, LogKind, LogValue } from './log_line.ts';
export { truncate_ip } from './log_line.ts';

const CoreError = CoreContract.CoreError;
type CoreErrorValue = CoreContract.CoreError;

const MINUTE_MS = 60_000n;
const MODULE = 'logging';
const JOB_SECURITY_FLUSH = 'logging_security_flush';
const JOB_ANALYTICS_DELETION = 'logging_analytics_deletion';

/** The `request` log fields and minimum level `annotate_request_log` gave a ctx. */
export interface RequestLogAnnotation {
  readonly fields: LogFields;
  readonly min_level: Level;
}

/** A failure reason of an admin operation handler (`admin-api`). */
export type AdminFailure = 'bad_request' | 'not_found' | 'conflict' | 'external_failed' | 'internal';

/** An admin operation object (`admin-api`): `routing` hands it to `admin-api.register_admin_operation`. */
export interface AdminOperation {
  readonly name: string;
  readonly role: 'read';
  readonly body: 'json';
  readonly max_body_bytes: null;
  readonly input: Readonly<Record<string, { readonly type: { readonly kind: 'int64' | 'int32' | 'string' }; readonly optional: boolean }>>;
  readonly user_target: null;
  readonly handler: (input: Readonly<Record<string, unknown>>, tx: GameTx, prepare_value: unknown, body: Uint8Array | null) => Record<string, unknown> | AdminFailure;
  readonly prepare: null;
  readonly audit_args: null;
}

/** What only the DEV code gives logging (`dev/index.ts`). */
export interface LoggingDevCode {
  /** A new fake analytics adapter, for adapter name `fake` when the server instance gives none. */
  create_fake_analytics(): AnalyticsAdapter;
}

/** The fields of the module input `server` (`server-core` `## module`) that logging reads. */
export interface LoggingServer {
  readonly env: 'LOCAL' | 'DEV' | 'STG' | 'PROD';
  /** `--db`; not null in a LOCAL server and a test server, which read a secret from `--secret-file` by its key. */
  readonly db: string | null;
  /** True in a server instance with DEV code. */
  readonly dev: boolean;
  readonly fetch: HttpFetch;
  read_secret(name: string): string | null;
  write_log_line(line: string): void;
  /** The fake adapter override by adapter key. */
  readonly fake_adapters: Readonly<Record<string, unknown>>;
}

/**
 * The module input (`server-core` `## module`). `settings` holds the keys of `## settings`; the keys with `<ENV>` hold
 * the value of this server instance's environment. `modules` holds `storage` and `server-time`.
 */
export interface LoggingInput {
  readonly settings: Readonly<Record<string, unknown>>;
  readonly modules: Readonly<Record<string, unknown>>;
  readonly server: LoggingServer;
}

/** The `## API` operations of `logging`, the admin operations, the lifecycle and the slot its DEV code fills. */
export interface Logging {
  log(ctx: RequestCtx, level: Level, message: string, fields: FieldObject): null;
  write(entry: LogEntry): null;
  truncate_ip(ip: string): string;
  with_audit_actor<T>(operator: string, fn: () => T): T;
  with_request_ip<T>(client_ip: string, fn: () => T): T;
  annotate_request_log(ctx: RequestCtx, fields: FieldObject, min_level: Level): null;
  take_request_log_annotation(ctx: RequestCtx): RequestLogAnnotation;
  track(ctx: RequestCtx, name: string, params: ParamList): null;
  track_core_event(ctx: RequestCtx, name: string, params: ParamList): null;
  ReportClientErrors(ctx: RequestCtx, request: CoreContract.ReportClientErrorsRequest): CoreContract.ReportClientErrorsResponse | CoreErrorValue;
  ReportAnalyticsEvents(ctx: RequestCtx, request: CoreContract.ReportAnalyticsEventsRequest): CoreContract.ReportAnalyticsEventsResponse | CoreErrorValue;
  count_report_request(user_id: bigint): Promise<'pass' | CoreErrorValue>;
  request_analytics_deletion(ctx: RequestCtx): null;
  readonly list_client_errors: AdminOperation;
  readonly list_client_events: AdminOperation;
  readonly list_server_events: AdminOperation;
  begin_start(): void;
  complete_start(): string | null;
  stop(): void;
  /** For the DEV code: called before `begin_start` in a server instance with DEV code. */
  include_dev_code(dev: LoggingDevCode): void;
}

function integer_setting(settings: Readonly<Record<string, unknown>>, key: string): number {
  const value = settings[key];
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) throw new TypeError(`logging: setting ${key} is not an integer`);
  return value;
}

function string_setting(settings: Readonly<Record<string, unknown>>, key: string): string {
  const value = settings[key];
  return typeof value === 'string' ? value : '';
}

function module_of(modules: Readonly<Record<string, unknown>>, name: string): unknown {
  const value = modules[name];
  if (value === undefined || value === null) throw new TypeError(`logging: module ${name} is missing`);
  return value;
}

function is_analytics_adapter(value: unknown): value is AnalyticsAdapter {
  const adapter = value as Partial<AnalyticsAdapter> | null | undefined;
  return typeof adapter?.send === 'function' && typeof adapter.delete_user_data === 'function';
}

const INT64 = { kind: 'int64' } as const;
const LIST_INPUT: AdminOperation['input'] = {
  user_id: { type: INT64, optional: true },
  from_at: { type: INT64, optional: false },
  to_at: { type: INT64, optional: false },
  after_time_at: { type: INT64, optional: true },
  after_user_id: { type: INT64, optional: true },
  after_seq: { type: INT64, optional: true },
  limit: { type: { kind: 'int32' }, optional: false },
};
const LIST_EVENT_INPUT: AdminOperation['input'] = { ...LIST_INPUT, name: { type: { kind: 'string' }, optional: true } };

/** Makes `logging` for one server instance. A missing or non-integer setting, or a missing module, throws. */
export function create_logging(input: LoggingInput): Logging {
  const { settings, modules, server } = input;
  const storage = module_of(modules, 'storage') as Storage;
  const time = module_of(modules, 'server-time') as ServerTimeApi;
  const security_window_ms = BigInt(integer_setting(settings, 'logging.securityRepeatWindowMs'));
  const max_repeated_ips = integer_setting(settings, 'logging.maxRepeatedIps');
  const report_limit = BigInt(integer_setting(settings, 'logging.reportRateLimitPerMinute'));
  const client_retention_ms = BigInt(integer_setting(settings, 'logging.clientLogRetentionMs'));
  const server_retention_ms = BigInt(integer_setting(settings, 'logging.serverEventRetentionMs'));
  const send_timeout_ms = BigInt(integer_setting(settings, 'logging.analyticsSendTimeoutMs'));
  const deletion_interval_ms = BigInt(integer_setting(settings, 'logging.analyticsDeletionIntervalMs'));
  const deletion_batch = integer_setting(settings, 'logging.analyticsDeletionBatchSize');
  const deletion_max_attempts = integer_setting(settings, 'logging.analyticsDeletionMaxAttempts');
  const max_response_bytes = integer_setting(settings, 'routing.externalMaxResponseBytes');
  const limits: EventLimits = {
    max_string_length: integer_setting(settings, 'logging.maxStringLength'),
    max_event_params: integer_setting(settings, 'logging.maxEventParams'),
  };
  const adapter_name = settings['environments.<ENV>.adapters.analytics'];
  const debug_allowed = server.env !== 'STG' && server.env !== 'PROD';

  const windows = new SecurityWindows(max_repeated_ips);
  const annotations = new WeakMap<object, RequestLogAnnotation>();
  const audit_actor = new AsyncLocalStorage<string>();
  const request_ip = new AsyncLocalStorage<string>();
  const start_errors: string[] = [];
  let dev: LoggingDevCode | null = null;
  let adapter: AnalyticsAdapter | null = null;
  let last_send_failure: AdapterFailure | null = null;

  const summary_line = (summary: SecuritySummary): void => {
    const entry: LogEntry = { kind: 'security', level: 'warn', message: summary.reason, user_id: summary.user_id, request_id: null, request: null, fields: null };
    const fields: LogFields = { ip: null, reason: 'repeated', count: summary.count, ips: summary.ips };
    server.write_log_line(format_line(time.clock_now(), 'warn', entry, fields));
  };

  /**
   * Truncates the `ip` of a `security` line, the client IP of `with_request_ip` when the entry has none, and admits the
   * line to its window: false when the line is counted, not written.
   */
  const security_fields = (entry: LogEntry, fields: Record<string, LogValue>, now: bigint): boolean => {
    const given = Object.hasOwn(fields, 'ip') ? fields.ip : (request_ip.getStore() ?? null);
    const ip = typeof given === 'string' ? truncate_ip(given) : '';
    fields.ip = ip === '' ? null : ip;
    const reason = typeof fields.reason === 'string' ? fields.reason : '';
    const ended: SecuritySummary[] = [];
    const first = windows.admit(now, security_window_ms, entry.user_id, ip, reason, ended);
    for (const summary of ended) summary_line(summary);
    return first;
  };

  /** The fields a kind adds, and false when the line is not written (a counted `security` line). */
  const kind_fields = (entry: LogEntry, fields: Record<string, LogValue>, now: bigint): boolean => {
    switch (entry.kind) {
      case 'request':
        delete fields.request_body;
        if (server.dev && entry.request_body && entry.sensitive !== true) fields.request_body = Buffer.from(entry.request_body).toString('base64');
        return true;
      case 'error':
        fields.stack_trace ??= null;
        return true;
      case 'audit':
        if (!Object.hasOwn(fields, 'actor')) fields.actor = audit_actor.getStore() ?? 'system';
        return true;
      case 'core':
        fields.module ??= MODULE;
        return true;
      case 'security':
        return security_fields(entry, fields, now);
      default:
        return true;
    }
  };

  const write = (entry: LogEntry): null => {
    const now = time.clock_now();
    const fields: Record<string, LogValue> = { ...(entry.fields ?? {}) };
    const level: Level =
      entry.kind === 'request' ? higher_level(fields.error_code === CoreError.CORE_ERROR_INTERNAL ? 'error' : 'info', entry.min_level ?? 'debug') : (entry.level ?? 'info');
    if (level === 'debug' && !debug_allowed) return null;
    if (kind_fields(entry, fields, now)) server.write_log_line(format_line(now, level, entry, fields));
    return null;
  };

  const core_log = (level: Level, message: string, fields: LogFields = {}, user_id: bigint | null = null): void => {
    const common = { level, message, user_id, request_id: null, request: null };
    if (level === 'error') write({ kind: 'error', ...common, fields: { ...fields, stack_trace: null } });
    else write({ kind: 'core', ...common, fields: { ...fields, module: MODULE } });
  };

  const annotate = (ctx: RequestCtx, fields: FieldObject, min_level: Level): null => {
    const problem = annotation_problem(fields);
    if (problem !== null) throw new TypeError(`annotate_request_log: ${problem}`);
    if (!is_level(min_level)) throw new TypeError(`annotate_request_log: ${String(min_level)} is not a level`);
    const before = annotations.get(ctx);
    annotations.set(ctx, {
      fields: { ...(before?.fields ?? {}), ...(fields as LogFields) },
      min_level: higher_level(before?.min_level ?? 'debug', min_level),
    });
    return null;
  };

  const annotate_counts = (ctx: RequestCtx, dropped: number, client_dropped: number, consent_dropped: number): void => {
    const level: Level = dropped > 0 || client_dropped > 0 ? 'warn' : 'debug';
    annotate(ctx, { dropped_count: dropped, client_dropped_count: client_dropped, consent_dropped_count: consent_dropped }, level);
  };

  const analytics_allowed = (ctx: RequestCtx): boolean => {
    const consent = storage.get_state(ctx, CoreContract.ConsentUserState, 0n) as CoreContract.ConsentUserState | null;
    return consent !== null && consent.analytics_allowed;
  };

  /** Sends events with the time limit; one `warn` log per run of the same failure kind. */
  const send = async (events: readonly AnalyticsSendEvent[]): Promise<void> => {
    const target = adapter;
    if (target === null || events.length === 0) return;
    const signal = time.network_time_limit(send_timeout_ms);
    const failure = await within<AdapterFailure | null>(signal, () => target.send(events, signal), 'timeout', 'communication_failure');
    if (failure !== null && failure !== last_send_failure) core_log('warn', 'analytics send failed', { failure });
    last_send_failure = failure;
  };

  const send_after_commit = (ctx: RequestCtx, events: readonly AnalyticsSendEvent[]): void => {
    if (adapter === null || events.length === 0) return;
    storage.after_commit(ctx, () => send(events));
  };

  const track_event = (ctx: RequestCtx, name: string, params: ParamList, core: boolean): null => {
    const problem = server_event_problem(name, params, limits, core);
    if (problem !== null) throw new TypeError(`${core ? 'track_core_event' : 'track'}: ${problem}`);
    if (!analytics_allowed(ctx)) return null;
    const converted = params.map(([key, value]) => to_param(key, value));
    const time_at = ctx.request_time;
    const row: DbValue[] = [ctx.user_id, time_at, ctx.request_id, ctx.client_version, ctx.platform, name, params_bytes(converted), time_at + server_retention_ms];
    storage.db(ctx).query(INSERT_SERVER_EVENT, row);
    send_after_commit(ctx, [{ user_id: ctx.user_id, name, time_at, params: converted }]);
    return null;
  };

  const list = (table: ListedTable, input: Readonly<Record<string, unknown>>, tx: GameTx): Record<string, unknown> | AdminFailure => {
    const cursor = [input.after_time_at, input.after_user_id, input.after_seq];
    const given = cursor.filter((value) => value !== undefined).length;
    if (given !== 0 && given !== cursor.length) return 'bad_request';
    const [after_time_at, after_user_id, after_seq] = cursor as (bigint | undefined)[];
    if (after_seq !== undefined && after_seq < 1n) return 'bad_request';
    const after = after_time_at !== undefined && after_user_id !== undefined && after_seq !== undefined ? { time_at: after_time_at, user_id: after_user_id, seq: after_seq } : null;
    const rows = list_rows(storage.db(tx), table, {
      user_id: (input.user_id as bigint | undefined) ?? null,
      name: table === CLIENT_ERROR ? null : ((input.name as string | undefined) ?? null),
      from_at: input.from_at as bigint,
      to_at: input.to_at as bigint,
      after,
      limit: input.limit as number,
      now: time.clock_now(),
    });
    return { entries: rows.map((row) => entry_of(table, row)) };
  };

  const admin_operation = (name: string, table: ListedTable, fields: AdminOperation['input']): AdminOperation => ({
    name,
    role: 'read',
    body: 'json',
    max_body_bytes: null,
    input: fields,
    user_target: null,
    handler: (input, tx) => list(table, input, tx),
    prepare: null,
    audit_args: null,
  });

  const create_ga4 = (): AnalyticsAdapter | null => {
    /** A secret by its `environments.<ENV>.secrets` key: that key in `--secret-file`, or the host secret its game settings value names. */
    const secret = (key: string): string | null => {
      if (server.db !== null) return server.read_secret(key);
      const name = string_setting(settings, `environments.<ENV>.secrets.${key}`);
      return name === '' ? null : server.read_secret(name);
    };
    const api_secret = secret('analytics');
    const private_key = secret('analyticsServiceAccount');
    if (api_secret === null || private_key === null) {
      start_errors.push('logging: a secret of analytics adapter analytics-ga4 cannot be read');
      return null;
    }
    return create_analytics_ga4_adapter({
      fetch: server.fetch,
      measurement_id: string_setting(settings, 'environments.<ENV>.analyticsGa4.measurementId'),
      api_secret,
      property_id: string_setting(settings, 'environments.<ENV>.analyticsGa4.propertyId'),
      service_account_email: string_setting(settings, 'environments.<ENV>.analyticsGa4.serviceAccountEmail'),
      private_key,
      max_response_bytes,
      clock_now: () => time.clock_now(),
    });
  };

  const pick_adapter = (): AnalyticsAdapter | null => {
    if (adapter_name === undefined || adapter_name === null) return null;
    if (adapter_name === 'analytics-ga4') return create_ga4();
    if (adapter_name !== 'fake') {
      start_errors.push(`logging: unknown analytics adapter ${JSON.stringify(adapter_name)}`);
      return null;
    }
    const given = server.fake_adapters.analytics;
    if (is_analytics_adapter(given)) return given;
    if (dev !== null) return dev.create_fake_analytics();
    start_errors.push('logging: analytics adapter fake needs DEV code');
    return null;
  };

  const flush_security = (): void => {
    for (const summary of windows.flush(time.clock_now())) summary_line(summary);
  };

  /** One failed deletion request: `attempts` goes up, and at the limit the row is removed. */
  const count_deletion_failure = async (user_id: bigint): Promise<void> => {
    // A game transaction rolls back when its function returns a number (a failure code), so the count is in an object.
    const counted = await storage.run_game_transaction((tx) => {
      const db = storage.db(tx);
      const rows = db.query(COUNT_ANALYTICS_DELETION_ATTEMPT, [user_id]);
      const after = rows.length === 0 ? 0 : Number(rows[0]?.attempts ?? 0);
      if (after >= deletion_max_attempts) db.query(DELETE_ANALYTICS_DELETION, [user_id]);
      return { attempts: after };
    });
    if (counted === 'FAILED') {
      core_log('warn', 'analytics deletion attempt could not be counted', {}, user_id);
      return;
    }
    const attempts = counted.attempts;
    if (attempts >= deletion_max_attempts) core_log('error', 'analytics deletion request failed at the attempt limit; the request is dropped', { attempts }, user_id);
    else core_log('warn', 'analytics deletion request failed', { attempts }, user_id);
  };

  /** The job body: a failure, a DB error too, is an `error` log and does not throw (`server-time` scheduler). */
  const run_deletions = async (): Promise<void> => {
    try {
      await send_deletions();
    } catch {
      core_log('error', 'analytics deletion job failed');
    }
  };

  const send_deletions = async (): Promise<void> => {
    const target = adapter;
    if (target === null) return;
    const rows = storage.read_db().query(SELECT_ANALYTICS_DELETIONS, [deletion_batch]);
    for (const row of rows) {
      const user_id = int64_of(row.user_id);
      const signal = time.network_time_limit(send_timeout_ms);
      const ok = await within(signal, () => target.delete_user_data(user_id, signal), false, false);
      if (!ok) {
        await count_deletion_failure(user_id);
        continue;
      }
      const removed = await storage.run_game_transaction((tx) => storage.db(tx).query(DELETE_ANALYTICS_DELETION, [user_id]));
      if (removed === 'FAILED') core_log('warn', 'analytics deletion row could not be removed', {}, user_id);
    }
  };

  return {
    log(ctx, level, message, fields) {
      const { kept, dropped } = split_fields(fields);
      if (dropped.length > 0) core_log('warn', 'log fields dropped: keys must be snake_case and not common fields, values integers, strings or bools', { dropped_count: dropped.length });
      const entry_level = is_level(level) ? level : 'info';
      if (entry_level !== level) core_log('warn', 'log level is not debug, info, warn or error; info is used');
      return write({ kind: 'game', level: entry_level, message, user_id: ctx.user_id, request_id: ctx.request_id || null, request: ctx.request_name || null, fields: kept });
    },
    write,
    truncate_ip,
    with_audit_actor: (operator, fn) => audit_actor.run(operator, fn),
    with_request_ip: (client_ip, fn) => request_ip.run(client_ip, fn),
    annotate_request_log: annotate,
    take_request_log_annotation(ctx) {
      const annotation = annotations.get(ctx) ?? { fields: {}, min_level: 'debug' };
      annotations.delete(ctx);
      return annotation;
    },
    track: (ctx, name, params) => track_event(ctx, name, params, false),
    track_core_event: (ctx, name, params) => track_event(ctx, name, params, true),
    ReportClientErrors(ctx, request) {
      const db = storage.db(ctx);
      const received_at = ctx.request_time;
      let dropped = 0;
      for (const entry of request.errors) {
        if (entry.level !== 'warn' && entry.level !== 'error') {
          dropped += 1;
          continue;
        }
        const row: DbValue[] = [ctx.user_id, entry.time_at, received_at, ctx.client_version, ctx.platform, entry.level, entry.tag, entry.message, entry.stack_trace];
        db.query(INSERT_CLIENT_ERROR, [...row, received_at + client_retention_ms]);
      }
      annotate_counts(ctx, dropped, request.dropped_error_count, 0);
      return new CoreContract.ReportClientErrorsResponse();
    },
    ReportAnalyticsEvents(ctx, request) {
      const client_dropped = request.dropped_event_count;
      if (request.events.some(client_name_refused)) {
        annotate_counts(ctx, 0, client_dropped, 0);
        return CoreError.CORE_ERROR_INVALID_REQUEST;
      }
      if (!analytics_allowed(ctx)) {
        annotate_counts(ctx, 0, client_dropped, request.events.length);
        return new CoreContract.ReportAnalyticsEventsResponse();
      }
      const db = storage.db(ctx);
      const received_at = ctx.request_time;
      let dropped = 0;
      const sent: AnalyticsSendEvent[] = [];
      for (const event of request.events) {
        const { kept, dropped: event_dropped } = filter_params(event.params);
        dropped += event_dropped;
        const row: DbValue[] = [ctx.user_id, event.time_at, received_at, ctx.client_version, ctx.platform, event.name, params_bytes(kept)];
        db.query(INSERT_CLIENT_EVENT, [...row, received_at + client_retention_ms]);
        sent.push({ user_id: ctx.user_id, name: event.name, time_at: event.time_at, params: kept });
      }
      send_after_commit(ctx, sent);
      annotate_counts(ctx, dropped, client_dropped, 0);
      return new CoreContract.ReportAnalyticsEventsResponse();
    },
    async count_report_request(user_id) {
      let count = 0n;
      const result = await storage.run_user_transaction(user_id, (ctx) => {
        const window_start = time.get_window_start(MINUTE_MS, time.clock_now());
        const rows = storage.db(ctx).query(UPSERT_REPORT_COUNTER, [user_id, window_start, window_start + MINUTE_MS]);
        count = int64_of(rows[0]?.count);
        return 'pass';
      });
      if (result === 'WITHDRAWN') return CoreError.CORE_ERROR_UNAUTHORIZED;
      if (result !== 'COMMITTED') {
        core_log('error', 'client log report counter transaction failed', {}, user_id);
        return CoreError.CORE_ERROR_INTERNAL;
      }
      return count > report_limit ? CoreError.CORE_ERROR_RATE_LIMITED : 'pass';
    },
    request_analytics_deletion(ctx) {
      if (adapter !== null) storage.db(ctx).query(INSERT_ANALYTICS_DELETION, [ctx.user_id, ctx.request_time]);
      return null;
    },
    list_client_errors: admin_operation('list_client_errors', CLIENT_ERROR, LIST_INPUT),
    list_client_events: admin_operation('list_client_events', CLIENT_EVENT, LIST_EVENT_INPUT),
    list_server_events: admin_operation('list_server_events', SERVER_EVENT, LIST_EVENT_INPUT),
    begin_start() {
      register_tables(storage);
      adapter = pick_adapter();
      time.schedule_job(JOB_SECURITY_FLUSH, security_window_ms, flush_security);
      time.schedule_job(JOB_ANALYTICS_DELETION, deletion_interval_ms, run_deletions);
    },
    complete_start() {
      if (start_errors.length > 0) return start_errors.join('; ');
      return null;
    },
    stop() {
      windows.clear();
      last_send_failure = null;
    },
    include_dev_code(code) {
      dev = code;
    },
  };
}
