/**
 * Test servers for block-report: a test server whose content `register` keeps the module objects and runs the body a
 * test sets in the core test data `rpc` `RunCoreTest`, so a test calls internal operations with a request ctx like a
 * content handler does.
 */
import * as CoreContract from '../../../generated/contract/core_contract.ts';
import * as GameContract from '../../../generated/contract/game_contract.ts';
import type { RequestCtx, Storage } from '../../storage/index.ts';
import { storage_module } from '../../storage/tests/helpers.ts';
import { core_test_register, load_data, send, send_admin, start_test_server, stop_test_server, type TestServer, type TestSession } from '../../testing/dev/index.ts';
import type { BlockListener, BlockReport, BlockReportPublicProfile } from '../index.ts';

/** The first clock time of every test server here. */
export const START = 1_800_000_000_000n;
/** A search range end that covers every report a test makes. */
export const RANGE_END = START + 3_600_000n;

/** The module objects the content `register` gets that these tests use. */
interface Core {
  readonly routing: { register_handler(name: string, handler: (ctx: RequestCtx) => unknown): void };
  readonly 'block-report': BlockReport;
  readonly 'public-profile': BlockReportPublicProfile;
}

export interface Instance {
  readonly server: TestServer;
  readonly block: BlockReport;
  /** The `storage` module object of the running server instance; content `register(core)` gets only its member `content`. */
  readonly storage: Storage;
  /** The `public-profile` module object block-report calls. */
  readonly profiles: BlockReportPublicProfile;
  readonly content: Content;
}

/** What the content `register` does; a test changes it while the server runs. */
export interface Content {
  /** The body of the `RunCoreTest` handler; null answers an empty response. */
  run_core_test: ((ctx: RequestCtx) => void) | null;
}

export interface StartOptions {
  /** Core settings overrides. */
  readonly settings?: Readonly<Record<string, unknown>>;
  /** Functions given to `register_block_listener` during server start, in order. */
  readonly listeners?: readonly BlockListener[];
}

const running: TestServer[] = [];

/** Starts a test server with all server modules. Throws when server start fails. */
export async function start(options: StartOptions = {}): Promise<Instance> {
  const kept: { core: Core | null } = { core: null };
  const content: Content = { run_core_test: null };
  const register = (raw: Readonly<Record<string, unknown>>): void => {
    const core = raw as unknown as Core;
    kept.core = core;
    core.routing.register_handler('RunCoreTest', (ctx) => {
      content.run_core_test?.(ctx);
      return new GameContract.RunCoreTestResponse();
    });
    core_test_register(raw, ['RunCoreTest']);
    for (const listener of options.listeners ?? []) core['block-report'].register_block_listener(listener);
  };
  const server = await start_test_server(START, undefined, undefined, undefined, undefined, options.settings, register);
  running.push(server);
  const core = kept.core;
  if (core === null) throw new Error('register was not called');
  return {
    server,
    block: core['block-report'],
    get storage() {
      return storage_module(server);
    },
    profiles: core['public-profile'],
    content,
  };
}

export async function stop_all(): Promise<void> {
  for (const server of running.splice(0)) await stop_test_server(server);
}

/** The ID value of an ID name of the core test data. */
export function id_value(id_name: string): number {
  return load_data().dev.find_id_value(id_name);
}

export const SPAM = '[report_reason_spam]';
export const ABUSE = '[report_reason_abuse]';

export interface RpcResult<T> {
  /** The `ServerError.code`, or null for a success. */
  readonly code: number | null;
  readonly response: T | null;
  readonly server_time_at: bigint;
}

/** Sends a core `rpc` or game `rpc` as the session's user. */
export async function rpc<T>(session: TestSession, name: string, message: Parameters<typeof send>[2]): Promise<RpcResult<T>> {
  const { envelope, response } = await send(session, name, message);
  return { code: envelope.error?.code ?? null, response: response as T | null, server_time_at: envelope.server_time_at };
}

/**
 * Runs `fn` in a `RunCoreTest` request of the session's user, as a content handler calls block-report, and returns
 * the request's error code (null for a success) and `fn`'s value (null when it did not return).
 */
export async function run_core_test<T>(instance: Instance, session: TestSession, fn: (ctx: RequestCtx) => T): Promise<{ code: number | null; value: T | null }> {
  const kept: { value: T | null } = { value: null };
  instance.content.run_core_test = (ctx) => {
    kept.value = fn(ctx);
  };
  try {
    const { code } = await rpc(session, 'RunCoreTest', new GameContract.RunCoreTestRequest());
    return { code, value: kept.value };
  } finally {
    instance.content.run_core_test = null;
  }
}

/** `run_core_test` that must succeed: `fn`'s value. */
export async function in_request<T>(instance: Instance, session: TestSession, fn: (ctx: RequestCtx) => T): Promise<T> {
  const { code, value } = await run_core_test(instance, session, fn);
  if (code !== null) throw new Error(`RunCoreTest: error code ${String(code)}`);
  return value as T;
}

export function block_user(session: TestSession, user_id: bigint): Promise<RpcResult<CoreContract.BlockUserResponse>> {
  const request = new CoreContract.BlockUserRequest();
  request.user_id = user_id;
  return rpc(session, 'core/BlockUser', request);
}

export function unblock_user(session: TestSession, user_id: bigint): Promise<RpcResult<CoreContract.UnblockUserResponse>> {
  const request = new CoreContract.UnblockUserRequest();
  request.user_id = user_id;
  return rpc(session, 'core/UnblockUser', request);
}

export function get_blocked_users(session: TestSession): Promise<RpcResult<CoreContract.GetBlockedUsersResponse>> {
  return rpc(session, 'core/GetBlockedUsers', new CoreContract.GetBlockedUsersRequest());
}

export interface ReportInput {
  readonly reason?: string;
  readonly reason_id?: number;
  readonly context?: CoreContract.ReportContext;
  readonly ref?: string;
  readonly comment?: string;
}

export function report_user(session: TestSession, user_id: bigint, input: ReportInput = {}): Promise<RpcResult<CoreContract.ReportUserResponse>> {
  const request = new CoreContract.ReportUserRequest();
  request.user_id = user_id;
  request.reason_id = input.reason_id ?? id_value(input.reason ?? SPAM);
  request.context = input.context ?? CoreContract.ReportContext.REPORT_CONTEXT_PROFILE;
  request.ref = input.ref ?? '';
  request.comment = input.comment ?? '';
  return rpc(session, 'core/ReportUser', request);
}

export function withdraw(session: TestSession): Promise<RpcResult<CoreContract.WithdrawResponse>> {
  return rpc(session, 'core/Withdraw', new CoreContract.WithdrawRequest());
}

export interface AdminResult {
  readonly status: number;
  readonly json: unknown;
}

export async function admin(instance: Instance, operation: string, body: unknown): Promise<AdminResult> {
  const { status, json } = await send_admin(instance.server, operation, body);
  return { status, json };
}

/** A report of the `list_reports` output. */
export interface ReportJson {
  readonly report_id: string;
  readonly reporter_id: string;
  readonly target_id: string;
  readonly reason_id: number;
  readonly context: string;
  readonly ref: string;
  readonly comment: string;
  readonly evidence: string;
  readonly status: string;
  readonly created_at: string;
  readonly resolved_at: string;
  readonly resolution: string;
  readonly expires_at: string | null;
}

export interface ListInput {
  readonly status?: 'Open' | 'Resolved';
  readonly from_at?: bigint;
  readonly to_at?: bigint;
  readonly after_created_at?: string;
  readonly after_report_id?: string;
  readonly limit?: number;
}

/** `list_reports` that must succeed. */
export async function list_reports(instance: Instance, input: ListInput = {}): Promise<ReportJson[]> {
  const result = await admin(instance, 'list_reports', list_body(input));
  if (result.status !== 200) throw new Error(`list_reports: ${String(result.status)} ${JSON.stringify(result.json)}`);
  return (result.json as { reports: ReportJson[] }).reports;
}

export function list_body(input: ListInput): Record<string, unknown> {
  const body: Record<string, unknown> = {
    status: input.status ?? 'Open',
    from_at: String(input.from_at ?? START),
    to_at: String(input.to_at ?? RANGE_END),
    limit: input.limit ?? 50,
  };
  if (input.after_created_at !== undefined) body.after_created_at = input.after_created_at;
  if (input.after_report_id !== undefined) body.after_report_id = input.after_report_id;
  return body;
}

/** The report rows in the DB, committed, by `report_id`. */
export function report_rows(instance: Instance): Record<string, unknown>[] {
  return instance.storage.read_db().query('SELECT report_id, target_id, status, evidence FROM block_report_report ORDER BY report_id');
}
