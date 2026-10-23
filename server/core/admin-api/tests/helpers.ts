/** Shared steps of the admin-api core tests, over the `testing` test helper. */
import { request as http_request } from 'node:http';
import * as CoreContract from '../../../generated/contract/core_contract.ts';
import type { ItemLedgerContent } from '../../item-ledger/index.ts';
import type { MailboxContent } from '../../mailbox/index.ts';
import type { Storage } from '../../storage/index.ts';
import { storage_module } from '../../storage/tests/helpers.ts';
import * as testing from '../../testing/dev/index.ts';
import type { AdminApi, AdminOperation } from '../types.ts';

/** The server module list of this run, from `core_test_server_paths`. */
const run_paths = testing.core_test_server_paths();

export type Server = testing.TestServer;
export type Session = testing.TestSession;

/**
 * The `core` object content `register` gets, as these tests use it, except `storage`: the `storage` module object of
 * the running server instance, whose database access content does not get.
 */
export interface Core {
  readonly routing: { register_admin_operation(operation: AdminOperation): void };
  /** The admin-api module object itself: admin-api has no `content` member. */
  readonly 'admin-api': AdminApi;
  readonly 'item-ledger': ItemLedgerContent;
  readonly mailbox: MailboxContent;
  readonly storage: Storage;
}

export type Register = (core: Core) => void;

export interface StartOptions {
  readonly settings?: Readonly<Record<string, unknown>>;
  readonly register?: Register;
}

/** True when the module is in the server module list of these tests. */
export function has_module(module: string): boolean {
  return run_paths.server_modules.includes(module);
}

/** A test server; a test's own `register` also registers what the default game-less `register` does. */
export async function start(options: StartOptions = {}): Promise<Server> {
  const own = options.register;
  const started: { server?: Server } = {};
  const register = own === undefined ? undefined : (core: Readonly<Record<string, unknown>>): void => {
    testing.core_test_register(core);
    own({
      ...(core as unknown as Core),
      get storage(): Storage {
        if (started.server === undefined) throw new Error('the test server has not started');
        return storage_module(started.server);
      },
    });
  };
  const server = await testing.start_test_server(undefined, undefined, undefined, undefined, undefined, options.settings, register, undefined);
  started.server = server;
  return server;
}

/** Stops a test server that a test started and did not stop yet. */
export async function stop(server: Server | undefined): Promise<void> {
  if (server !== undefined && !server.stopped) await testing.stop_test_server(server);
}

export const restart = testing.restart_test_server;
export const peer = testing.start_peer_server;
export const advance = testing.advance_time;
export const wait_background = testing.wait_background;

export interface AdminReply {
  readonly status: number;
  /** Response headers with lower case names. */
  readonly headers: Readonly<Record<string, string>>;
  readonly text: string;
  readonly json: Record<string, unknown>;
}

function reply_of(reply: testing.AdminResponse): AdminReply {
  const json = typeof reply.json === 'object' && reply.json !== null ? (reply.json as Record<string, unknown>) : {};
  return { status: reply.status, headers: reply.headers, text: new TextDecoder().decode(reply.body), json };
}

/**
 * `POST /admin/<operation>` as operator `operator` (default `ogw`). A string body is sent as it is, so a test can
 * send JSON that an object cannot hold (`1.0`, `1e3`). int64 values in object bodies are decimal strings.
 */
export async function admin(server: Server, operation: string, body: unknown = {}, operator?: string, secret?: string): Promise<AdminReply> {
  return reply_of(await testing.send_admin(server, operation, body, operator, secret));
}

/** `POST /admin/<operation>` with a binary body and its query. */
export async function admin_binary(server: Server, operation: string, body: Uint8Array, query: Readonly<Record<string, string>>, operator?: string): Promise<AdminReply> {
  return reply_of(await testing.send_admin(server, operation, { binary: body, query }, operator, undefined));
}

export interface OpenBodyReply {
  readonly status: number;
  readonly json: Record<string, unknown>;
  /** The response came while the request body was still open. */
  readonly before_body_end: boolean;
}

/**
 * `POST /admin/<operation>` with the given headers that sends `chunk` and keeps the body open. The body ends after
 * `open_ms` unless the response came first, so a response before the end shows the server answered without reading
 * the whole body.
 */
export function admin_open_body(server: Server, operation: string, headers: Readonly<Record<string, string>>, chunk: Uint8Array, open_ms: number): Promise<OpenBodyReply> {
  return new Promise((resolve, reject) => {
    let ended = false;
    const req = http_request(`${server.url}/admin/${operation}`, { method: 'POST', headers: { ...headers }, agent: false }, (res) => {
      const before_body_end = !ended;
      clearTimeout(timer);
      const chunks: Buffer[] = [];
      res.on('data', (data: Buffer) => chunks.push(data));
      res.on('end', () => {
        req.destroy();
        const json = JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>;
        resolve({ status: res.statusCode ?? 0, json, before_body_end });
      });
    });
    req.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    const timer = setTimeout(() => {
      ended = true;
      req.end();
    }, open_ms);
    req.write(chunk);
  });
}

export type LogLine = Record<string, unknown>;

export function logs(server: Server, kind?: string): LogLine[] {
  return testing.read_logs(server, kind, undefined);
}

/** `audit` log lines of admin requests (those with `status`), optionally of one operation. */
export function audits(server: Server, operation?: string): LogLine[] {
  return logs(server, 'audit').filter((line) => line.status !== undefined && (operation === undefined || line.request === operation));
}

export async function login(server: Server, name: string): Promise<{ session: Session; user_id: string }> {
  const session = await testing.login(server, name);
  return { session, user_id: String(session.user_id) };
}

export interface Sent {
  readonly code: number;
  readonly envelope: CoreContract.ResponseEnvelope;
  /** The decoded response message; null on an error response. */
  readonly response: unknown;
}

/** Sends a core `rpc` and returns the error code (0 on success) and the envelope. */
export async function send(session: Session, request: string, message: { encode(): Uint8Array }): Promise<Sent> {
  const result = await testing.send(session, request, message);
  const envelope = result.envelope;
  return { code: envelope.error?.code ?? 0, envelope, response: result.response ?? null };
}

export function claim_all(session: Session): Promise<Sent> {
  return send(session, 'core/ClaimAllMail', new CoreContract.ClaimAllMailRequest());
}

export function read_mail(session: Session, mail_id: bigint): Promise<Sent> {
  const request = new CoreContract.ReadMailRequest();
  request.mail_id = mail_id;
  return send(session, 'core/ReadMail', request);
}

export function claim_mail(session: Session, mail_id: bigint): Promise<Sent> {
  const request = new CoreContract.ClaimMailRequest();
  request.mail_id = mail_id;
  return send(session, 'core/ClaimMail', request);
}

export const CoreError = CoreContract.CoreError;

export function id_value(id_name: string): number {
  return testing.load_data().dev.find_id_value(id_name);
}

export const GOLD = '[admin_gold]';
export const BIG_GOLD = '[admin_big_gold]';
export const NOTICE_MAIL = '[mail_admin_notice]';

/** The user's `get_user` JSON. */
export async function get_user(server: Server, user_id: string): Promise<AdminReply> {
  return admin(server, 'get_user', { user_id });
}

/** A user's balance of an item, read with `get_user`. */
export async function balance(server: Server, user_id: string, item: string): Promise<bigint> {
  const reply = await get_user(server, user_id);
  const state = reply.json.user_state as Record<string, unknown> | undefined;
  const rows = (state?.item_balance_user_state ?? []) as Record<string, unknown>[];
  const row = rows.find((r) => String(r.id) === String(id_value(item)));
  if (row === undefined) return 0n;
  const big = typeof row.big_amount === 'string' ? row.big_amount : '';
  const amount = typeof row.amount === 'string' ? row.amount : '0';
  return BigInt(big !== '' ? big : amount);
}

export function items(item: string, amount: bigint | string, big_amount = ''): Record<string, unknown>[] {
  const value: Record<string, unknown> = { item_id: id_value(item), amount: String(amount) };
  if (big_amount !== '') value.big_amount = big_amount;
  return [value];
}

export function grant(server: Server, user_id: string, operation_id: string, list: Record<string, unknown>[]): Promise<AdminReply> {
  return admin(server, 'grant_items', { operation_id, user_id, items: list });
}

export function revoke(server: Server, user_id: string, operation_id: string, list: Record<string, unknown>[]): Promise<AdminReply> {
  return admin(server, 'revoke_items', { operation_id, user_id, items: list });
}

export function notice_mail(text: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return { template_id: id_value(NOTICE_MAIL), args: [{ name: 'text', value: { text_value: text } }], ...extra };
}

/** The core test data `[admin_gold]` amount as an `ItemAmount` list. */
export function gold(amount: bigint): CoreContract.ItemAmount[] {
  const value = new CoreContract.ItemAmount();
  value.item_id = id_value(GOLD);
  value.amount = amount;
  return [value];
}

/** Withdraws a user with `auth`'s admin operation `withdraw_user`. */
export async function withdraw(server: Server, user_id: string): Promise<void> {
  const reply = await admin(server, 'withdraw_user', { user_id });
  if (reply.status !== 200) throw new Error(`withdraw_user answered ${String(reply.status)}: ${reply.text}`);
}

/** A user ID no user has. */
export const MISSING_USER = '999999999';
