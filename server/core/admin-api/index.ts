/**
 * admin-api: the operator HTTP API `POST /admin/<operation>`. Every admin operation (admin-api's own, those other
 * modules export and content admin operations) goes through the processing order here: IP, operator authentication,
 * operation and role, body limit, body rules, processing, and one `audit` log line.
 */
import { createHash, timingSafeEqual } from 'node:crypto';
import * as CoreContract from '../../generated/contract/core_contract.ts';
import { truncate_ip } from '../logging/index.ts';
import type { LogFields, LogValue } from '../logging/index.ts';
import { canonical_json, type RequestCtx } from '../storage/index.ts';
import { check_json_body, check_query, type BodyLimits } from './body.ts';
import { check_definition, CONTENT_MODULE } from './definition.ts';
import { ip_in_cidrs } from './ip.ts';
import { output_json, parse_json, sha256_hex } from './json.ts';
import { own_operations, type OwnOperation } from './operations.ts';
import { fail, ok, ok_text, Reply } from './reply.ts';
import { add_ip_failure, ban_in_force, MAINTENANCE_KIND, OPERATION, read_ban, read_ip_failures, read_operation, read_switches, register_tables, write_operation } from './tables.ts';
import {
  HANDLER_FAILURES,
  PREPARE_FAILURES,
  ROLES,
  type AdminApi,
  type AdminApiInput,
  type AdminInput,
  type AdminOperation,
  type AdminOutput,
  type AdminTransaction,
  type HandlerFailure,
  type Role,
  type RouteRequest,
  type RouteResponse,
} from './types.ts';

export type * from './types.ts';
export { ip_in_cidrs } from './ip.ts';

const MODULE = 'admin-api';
const PATH_PREFIX = '/admin/';
const MINUTE_MS = 60000n;
/** The failure code a transaction function returns to roll back. */
const ROLLBACK = CoreContract.CoreError.CORE_ERROR_INTERNAL;
/** The operator of a LOCAL server and of a test server with every role. */
const ALL_ROLES_OPERATOR = 'ogw';
/** Single-role operators a LOCAL server or test server may hold: the operator name is its role. */
const SINGLE_ROLE_OPERATORS: readonly Role[] = ['read', 'ops', 'economy', 'release', 'privacy'];

interface Operator {
  readonly name: string;
  readonly roles: ReadonlySet<string>;
  readonly digest: Buffer;
}

type HandlerResult = AdminOutput | HandlerFailure | Reply;

/** A registered admin operation and the module that handed it over (`admin-api`, a module, or `game`). */
interface Entry {
  readonly module: string;
  readonly name: string;
  readonly role: Role;
  readonly body: 'json' | 'binary';
  readonly max_body_bytes: number | null;
  readonly input: AdminOperation['input'];
  readonly user_target: string | null;
  readonly allow_withdrawn: boolean;
  readonly handler: ((input: AdminInput, transaction: AdminTransaction, prepared: unknown, body: Uint8Array | null) => HandlerResult) | null;
  readonly prepare: NonNullable<AdminOperation['prepare']> | null;
  readonly execute: ((input: AdminInput) => Promise<Reply>) | null;
  readonly on_committed: ((input: AdminInput) => void) | null;
  readonly audit_args: NonNullable<AdminOperation['audit_args']> | null;
}

interface Audit {
  readonly request: string;
  user_id: bigint | null;
  actor: string | null;
  args: AdminOutput | null;
}

/** An entry that passed steps 1 to 4, with its body and operator. */
interface Admitted {
  readonly entry: Entry;
  readonly body: Uint8Array;
  readonly operator: Operator;
}

interface OperatorSetting {
  readonly name?: unknown;
  readonly roles?: unknown;
  readonly secret?: unknown;
}

function digest(text: string): Buffer {
  return createHash('sha256').update(text, 'utf8').digest();
}

function setting_number(settings: AdminApiInput['settings'], key: string): number {
  const value = settings[key];
  if (typeof value !== 'number') throw new Error(`admin-api: setting ${key} is not a number`);
  return value;
}

function is_reason<T extends string>(value: unknown, reasons: readonly T[]): value is T {
  return typeof value === 'string' && (reasons as readonly string[]).includes(value);
}

function is_thenable(value: unknown): value is PromiseLike<unknown> {
  return typeof value === 'object' && value !== null && typeof (value as { then?: unknown }).then === 'function';
}

function is_output(value: unknown): value is AdminOutput {
  return typeof value === 'object' && value !== null && !Array.isArray(value) && !(value instanceof Reply) && !is_thenable(value);
}

function stack_of(error: unknown): string {
  return error instanceof Error ? (error.stack ?? error.message) : String(error);
}

/** A JSON value as a log field value; `bigint` and bytes are already strings. */
function log_value(value: unknown): LogValue {
  return output_json(value) as LogValue;
}

export function create_admin_api(input: AdminApiInput): AdminApi {
  const { settings, modules, server } = input;
  const storage = modules.storage;
  const server_time = modules['server-time'];
  const logging = modules.logging;

  const max_body_bytes = setting_number(settings, 'admin-api.maxBodyBytes');
  const body_read_timeout_ms = setting_number(settings, 'admin-api.bodyReadTimeoutMs');
  const auth_failures_per_minute = BigInt(setting_number(settings, 'admin-api.authFailuresPerMinute'));
  const operation_id_retention_ms = BigInt(setting_number(settings, 'admin-api.operationIdRetentionMs'));
  const switch_cache_ms = BigInt(setting_number(settings, 'admin-api.switchCacheMs'));
  const max_export_bytes = setting_number(settings, 'admin-api.maxExportBytes');
  const limits: BodyLimits = {
    max_string_bytes: setting_number(settings, 'admin-api.maxStringBytes'),
    max_search_range_ms: BigInt(setting_number(settings, 'admin-api.maxSearchRangeMs')),
    max_search_rows: setting_number(settings, 'admin-api.maxSearchRows'),
  };

  const entries = new Map<string, Entry>();
  const start_errors: string[] = [];
  let operators = new Map<string, Operator>();
  let started = false;
  let maintenance = false;
  let kill_switches = new Set<string>();

  // Logs.

  function log_error(request: string | null, user_id: bigint | null, message: string, stack_trace: string | null = null): void {
    logging.write({ kind: 'error', level: 'error', message, user_id, request_id: null, request, fields: { stack_trace } });
  }

  function log_security(request: string, ip: string, reason: string): void {
    logging.write({ kind: 'security', level: 'warn', message: `admin request refused: ${reason}`, user_id: null, request_id: null, request, fields: { ip, reason } });
  }

  function log_audit(audit: Audit, ip: string, reply: Reply): void {
    const truncated = truncate_ip(ip);
    const fields: LogFields = {
      actor: audit.actor,
      ip: truncated === '' ? null : truncated,
      status: reply.status,
      error: reply.error,
      args: audit.args === null ? null : log_value(audit.args),
    };
    logging.write({ kind: 'audit', level: 'info', message: 'admin request', user_id: audit.user_id, request_id: null, request: audit.request, fields });
  }

  // Switch cache.

  function set_cached_switch(kind: string, target: string, enabled: boolean): void {
    if (kind === MAINTENANCE_KIND) {
      maintenance = enabled;
      return;
    }
    if (enabled) kill_switches.add(target);
    else kill_switches.delete(target);
  }

  /** Job `admin_switch_cache`. */
  function reload_switches(): void {
    try {
      const state = read_switches(storage.read_db());
      maintenance = state.maintenance;
      kill_switches = new Set(state.kill_switches);
    } catch (error) {
      log_error(null, null, 'admin switch cache reload failed', stack_of(error));
    }
  }

  // Registration.

  function add_entry(entry: Entry): void {
    const other = entries.get(entry.name);
    if (other !== undefined) {
      start_errors.push(`admin operation ${entry.name} of ${entry.module} has the name of an admin operation of ${other.module}`);
      return;
    }
    entries.set(entry.name, entry);
  }

  function own_entry(operation: OwnOperation): Entry {
    return {
      module: MODULE,
      name: operation.name,
      role: operation.role,
      body: 'json',
      max_body_bytes: null,
      input: operation.input,
      user_target: operation.user_target,
      allow_withdrawn: operation.allow_withdrawn === true,
      handler: operation.handler ?? null,
      prepare: null,
      execute: operation.execute ?? null,
      on_committed: operation.on_committed ?? null,
      audit_args: null,
    };
  }

  function register_admin_operation(module: string, raw: AdminOperation): void {
    const label = typeof (raw as { name?: unknown } | null)?.name === 'string' ? raw.name : '(no name)';
    if (started) throw new Error(`admin-api: register_admin_operation after server start: ${label} of ${module}`);
    const operation = check_definition(module, raw);
    if (Array.isArray(operation)) {
      start_errors.push(...operation);
      return;
    }
    add_entry({
      module,
      name: operation.name,
      role: operation.role,
      body: operation.body,
      max_body_bytes: operation.body === 'binary' ? (operation.max_body_bytes ?? null) : null,
      input: operation.input,
      user_target: operation.user_target,
      allow_withdrawn: false,
      handler: operation.handler,
      prepare: operation.prepare ?? null,
      execute: null,
      on_committed: null,
      audit_args: operation.audit_args ?? null,
    });
  }

  /** Operators of this server instance; start failures go to `start_errors`. */
  function load_operators(): Map<string, Operator> {
    const out = new Map<string, Operator>();
    const add = (name: string, roles: readonly string[], secret_name: string): void => {
      if (out.has(name)) {
        start_errors.push(`adminOperators has the operator name ${name} twice`);
        return;
      }
      const secret = server.read_secret(secret_name);
      if (secret === null || secret === '') {
        start_errors.push(`the admin secret of operator ${name} cannot be read`);
        return;
      }
      out.set(name, { name, roles: new Set(roles), digest: digest(secret) });
    };
    // A LOCAL server and a test server (they get `--db`) use the fixed operators, whatever the environment.
    if (server.db !== null) {
      add(ALL_ROLES_OPERATOR, ROLES, `adminSecret.${ALL_ROLES_OPERATOR}`);
      for (const role of SINGLE_ROLE_OPERATORS) {
        if (server.read_secret(`adminSecret.${role}`) !== null) add(role, [role], `adminSecret.${role}`);
      }
      return out;
    }
    const list = settings['environments.<ENV>.adminOperators'];
    for (const item of Array.isArray(list) ? (list as readonly OperatorSetting[]) : []) {
      const roles = Array.isArray(item.roles) ? item.roles.filter((r): r is string => typeof r === 'string') : [];
      if (typeof item.name !== 'string' || typeof item.secret !== 'string') {
        start_errors.push('adminOperators has an operator without a name or a secret');
        continue;
      }
      add(item.name, roles, item.secret);
    }
    return out;
  }

  // Processing order.

  function window_now(): { start: bigint; end: bigint; now: bigint } {
    const now = server_time.clock_now();
    const start = server_time.get_window_start(MINUTE_MS, now);
    return { start, end: start + MINUTE_MS, now };
  }

  async function count_auth_failure(request: string, ip: string): Promise<void> {
    const window = window_now();
    const result = await storage.run_game_transaction((tx) => {
      add_ip_failure(storage.db(tx), ip, window.start, window.end);
      return 'pass';
    });
    if (result === 'FAILED') log_error(request, null, 'admin auth failure count was not written');
  }

  /** The operator of `Authorization: Bearer <operator name>.<admin secret>`, compared in constant time. */
  function authenticate(header: string | undefined): Operator | null {
    const match = /^Bearer ([^.\s]+)\.(\S+)$/.exec(header ?? '');
    const operator = operators.get(match?.[1] ?? '');
    const same = timingSafeEqual(digest(match?.[2] ?? ''), operator?.digest ?? digest(''));
    return match !== null && operator !== undefined && same ? operator : null;
  }

  /** Step 1: `adminAllowedCidrs` and the IP's auth failures in this minute window. */
  function check_ip(request: string, ip: string): Reply | null {
    const cidrs = settings['environments.<ENV>.adminAllowedCidrs'];
    if (Array.isArray(cidrs) && !ip_in_cidrs(ip, cidrs.filter((c): c is string => typeof c === 'string'))) {
      log_security(request, ip, 'forbidden');
      return fail('forbidden');
    }
    const window = window_now();
    if (read_ip_failures(storage.read_db(), ip, window.start, window.now) >= auth_failures_per_minute) {
      log_security(request, ip, 'rate_limited');
      return fail('rate_limited');
    }
    return null;
  }

  /** Steps 1 to 4: IP, authentication, operation and role, then body limit. Steps 1 to 3 do not read the body. */
  async function admit(request: RouteRequest, ip: string, audit: Audit): Promise<Admitted | Reply> {
    const refused = check_ip(audit.request, ip);
    if (refused !== null) return refused;
    const operator = authenticate(request.headers.authorization);
    if (operator === null) {
      await count_auth_failure(audit.request, ip);
      log_security(audit.request, ip, 'unauthorized');
      return fail('unauthorized');
    }
    audit.actor = operator.name;
    const entry = entries.get(audit.request);
    if (entry === undefined) return fail('not_found');
    if (!operator.roles.has(entry.role)) {
      log_security(audit.request, ip, 'forbidden');
      return fail('forbidden');
    }
    const limit = entry.body === 'binary' && entry.max_body_bytes !== null ? entry.max_body_bytes : max_body_bytes;
    const body = await request.read_body(limit, body_read_timeout_ms);
    if (body === null) return fail('bad_request');
    return { entry, body, operator };
  }

  /** Step 5: the JSON body, or the query string of a binary body operation. */
  function input_of(entry: Entry, request: RouteRequest, body: Uint8Array): AdminInput | null {
    if (entry.body === 'binary') return check_query(entry.input, new URLSearchParams(request.query), limits);
    return check_json_body(entry.input, parse_json(body), limits);
  }

  /** The target user of a user-targeted operation: the `user_target` field, or `user_id` of admin-api's own. */
  function target_of(entry: Entry, input_: AdminInput): bigint | null {
    const value = entry.user_target === null ? undefined : input_[entry.user_target];
    return typeof value === 'bigint' ? value : null;
  }

  function audit_user_of(entry: Entry, input_: AdminInput): bigint | null {
    const target = target_of(entry, input_);
    if (target !== null || entry.module !== MODULE) return target;
    return typeof input_.user_id === 'bigint' ? input_.user_id : null;
  }

  function args_of(entry: Entry, input_: AdminInput, body: Uint8Array): AdminOutput {
    if (entry.audit_args !== null) return entry.audit_args(input_, entry.body === 'binary' ? body : null);
    return entry.body === 'binary' ? { ...input_, body_sha256: sha256_hex(body) } : input_;
  }

  /** The target user exists and, unless the operation takes one, is not withdrawn. */
  function target_found(entry: Entry, target: bigint | null): boolean {
    if (target === null) return true;
    const record = storage.get_user_record(storage.read_db(), target);
    return record !== null && (record.withdrawn_at === null || entry.allow_withdrawn);
  }

  /** Calls the handler function: read-only for role `read`, in the hook change source for a user-targeted content operation. */
  function call_handler(entry: Entry, input_: AdminInput, transaction: AdminTransaction, prepared: unknown, body: Uint8Array | null): HandlerResult {
    const handler = entry.handler;
    if (handler === null) throw new Error(`admin-api: admin operation ${entry.name} has no handler function`);
    const run = (): HandlerResult => {
      if (entry.module === CONTENT_MODULE && entry.user_target !== null) {
        return storage.with_hook_change_source(transaction as RequestCtx, CoreContract.ItemChangeSource.ITEM_CHANGE_SOURCE_ADMIN, entry.name, () => handler(input_, transaction, prepared, body));
      }
      return handler(input_, transaction, prepared, body);
    };
    return entry.role === 'read' ? storage.run_read_only(transaction, run) : run();
  }

  /** The reply of a handler function's result; a wrong output form is an error. */
  function reply_of(entry: Entry, result: HandlerResult, target: bigint | null): Reply {
    if (result instanceof Reply) return result;
    if (is_reason(result, HANDLER_FAILURES)) {
      if (result === 'internal' || result === 'external_failed') log_error(entry.name, target, `admin operation ${entry.name} failed: ${result}`);
      return fail(result);
    }
    if (is_output(result)) return ok(result);
    if (is_thenable(result)) {
      // A handler function runs inside the transaction and must not wait; its promise is dropped.
      Promise.resolve(result).catch(() => undefined);
      log_error(entry.name, target, `admin operation ${entry.name} handler function returned a promise; it must be synchronous`);
      return fail('internal');
    }
    log_error(entry.name, target, `admin operation ${entry.name} returned an output that is not a JSON object or a failure reason`);
    return fail('internal');
  }

  /** Step 6 inside one transaction: the target user's out-of-request change, or a game transaction. */
  async function run_transaction(admitted: Admitted, input_: AdminInput, prepared: unknown, target: bigint | null): Promise<Reply> {
    const { entry, operator } = admitted;
    const body = entry.body === 'binary' ? admitted.body : null;
    const operation_id = Object.hasOwn(entry.input, 'operation_id') && typeof input_.operation_id === 'string' ? input_.operation_id : null;
    const input_sha256 = operation_id === null ? '' : sha256_hex(canonical_json(input_));
    const box: { reply: Reply } = { reply: fail('internal') };
    const work = (transaction: AdminTransaction): 'pass' | number => {
      if (operation_id !== null) {
        if (storage.lock_game_row(transaction, OPERATION, [entry.name, operation_id]) === 'FAILED') return ROLLBACK;
        const row = read_operation(storage.db(transaction), entry.name, operation_id, server_time.clock_now());
        if (row !== null) {
          box.reply = row.input_sha256 === input_sha256 ? ok_text(row.output) : fail('conflict');
          return 'pass';
        }
      }
      const reply = reply_of(entry, logging.with_audit_actor(operator.name, () => call_handler(entry, input_, transaction, prepared, body)), target);
      box.reply = reply;
      if (reply.status !== 200) return ROLLBACK;
      if (operation_id !== null) {
        const now = server_time.clock_now();
        write_operation(storage.db(transaction), entry.name, operation_id, input_sha256, new TextDecoder().decode(reply.body), now, now + operation_id_retention_ms);
      }
      return 'pass';
    };
    const status = target !== null ? await storage.run_user_transaction(target, work) : await storage.run_game_transaction(work);
    if (status === 'WITHDRAWN') return fail('not_found');
    if (status === 'FAILED') {
      log_error(entry.name, target, `admin operation ${entry.name}: the transaction failed`);
      return fail('internal');
    }
    if (box.reply.status === 200) entry.on_committed?.(input_);
    return box.reply;
  }

  /** The prepare function, outside a transaction: its value, or the reply of its failure reason. */
  async function run_prepare(admitted: Admitted, input_: AdminInput, target: bigint | null): Promise<{ value: unknown } | Reply> {
    const { entry, operator } = admitted;
    if (entry.prepare === null) return { value: undefined };
    const prepare = entry.prepare;
    const body = entry.body === 'binary' ? admitted.body : null;
    const value: unknown = await logging.with_audit_actor(operator.name, () => prepare(input_, body));
    if (!is_reason(value, PREPARE_FAILURES)) return { value };
    if (value === 'external_failed') log_error(entry.name, target, `admin operation ${entry.name} prepare failed: external_failed`);
    return fail(value);
  }

  /** Steps 5 and 6: body rules, the target user, the prepare function and the handler function. */
  async function run_entry(admitted: Admitted, request: RouteRequest, audit: Audit): Promise<Reply> {
    const { entry, body, operator } = admitted;
    const input_ = input_of(entry, request, body);
    if (input_ === null) return fail('bad_request');
    const target = target_of(entry, input_);
    audit.user_id = audit_user_of(entry, input_);
    audit.args = args_of(entry, input_, body);
    if (!target_found(entry, target)) return fail('not_found');
    const execute = entry.execute;
    if (execute !== null) return logging.with_audit_actor(operator.name, () => execute(input_));
    const prepared = await run_prepare(admitted, input_, target);
    if (prepared instanceof Reply) return prepared;
    return run_transaction(admitted, input_, prepared.value, target);
  }

  async function handle(request: RouteRequest, client_ip: string): Promise<RouteResponse> {
    const audit: Audit = { request: request.path.startsWith(PATH_PREFIX) ? request.path.slice(PATH_PREFIX.length) : request.path, user_id: null, actor: null, args: null };
    let reply: Reply;
    try {
      const admitted = await admit(request, client_ip, audit);
      reply = admitted instanceof Reply ? admitted : await run_entry(admitted, request, audit);
    } catch (error) {
      log_error(audit.request, audit.user_id, `admin operation ${audit.request} threw`, stack_of(error));
      reply = fail('internal');
    }
    log_audit(audit, client_ip, reply);
    return { status: reply.status, headers: { ...reply.headers }, body: reply.body };
  }

  return {
    'POST /admin/<operation>': handle,

    begin_start() {
      register_tables(storage);
      server_time.schedule_job('admin_switch_cache', switch_cache_ms, reload_switches);
      const own = own_operations({ modules, max_export_bytes, set_cached_switch, log_error });
      for (const operation of own) add_entry(own_entry(operation));
    },

    complete_start() {
      operators = load_operators();
      if (start_errors.length > 0) return `admin-api: ${start_errors.join('; ')}`;
      started = true;
      return null;
    },

    stop() {},

    register_admin_operation,

    is_maintenance() {
      return maintenance;
    },

    is_banned(user_id: bigint) {
      const ban = read_ban(storage.read_db(), user_id);
      return ban_in_force(ban, server_time.clock_now()) ? { banned: true, until_at: ban.until_at } : { banned: false, until_at: 0n };
    },

    ip_in_cidrs,

    is_kill_switched(request_name: string) {
      return kill_switches.has(request_name);
    },
  };
}
