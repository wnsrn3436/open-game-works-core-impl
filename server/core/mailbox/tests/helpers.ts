/**
 * A test server instance of `mailbox` with its dependencies `server-time`, `storage`, `logging` and `item-ledger` on
 * SQLite or PostgreSQL by the run's DB kind, started in dependency order. `send` plays the part of `routing`'s request
 * processing that mailbox takes part in: request start, the request transaction, the handler, and the response delta.
 */
import * as CoreContract from '../../../generated/contract/core_contract.ts';
import type * as GameContract from '../../../generated/contract/game_contract.ts';
import * as GameDataDev from '../../../dev/generated/data/game_data_dev.ts';
import { create_item_ledger, type ChangeSourceInput, type ItemLedger } from '../../item-ledger/index.ts';
import { create_logging_dev } from '../../logging/dev/index.ts';
import { create_logging, type Logging } from '../../logging/index.ts';
import { create_server_time_dev } from '../../server-time/dev/index.ts';
import { create_server_time, type ServerTime } from '../../server-time/index.ts';
import { create_storage, type GameTx, type RequestCtx, type ResponseDelta, type Storage } from '../../storage/index.ts';
import { TestClock, core_settings, new_db, test_server, type DbTarget } from '../../storage/tests/helpers.ts';
import {
  create_mailbox, type BroadcastMailOutcome, type GrantOrMailOutcome, type ItemAmountInput, type MailArgInput, type MailInput, type Mailbox,
  type SendMailOutcome,
} from '../index.ts';

export { DB_KIND } from '../../storage/tests/helpers.ts';

/** Start time of every mailbox test server. Unix ms. */
export const START_AT = 1_800_000_000_000n;
export const DAY_MS = 86_400_000n;

/** Core settings every mailbox test server uses, so expected values do not hang on the core settings defaults. */
export const MAIL_SETTINGS = {
  'mailbox.defaultExpireMs': Number(DAY_MS),
  'mailbox.maxExpireMs': Number(10n * DAY_MS),
  'mailbox.maxArgs': 2,
  'mailbox.maxArgLength': 8,
  'mailbox.maxAttachments': 3,
  'mailbox.maxClaimAllCount': 100,
};

export const PASS = 'pass';
export const Source = CoreContract.ItemChangeSource;
export const CoreError = CoreContract.CoreError;

/** A `GameError` value a content hook returns in these tests. */
export const GAME_ERROR = 1001 as GameContract.GameError;

type ExtraHook = (ctx: RequestCtx, extra_id: number, mail_id: bigint) => unknown;

/** One server instance: the module objects in dependency order, and what the test's content hooks do. */
export interface MailServer {
  readonly db: DbTarget;
  readonly clock: TestClock;
  readonly time: ServerTime;
  readonly storage: Storage;
  readonly logging: Logging;
  readonly ledger: ItemLedger;
  readonly mailbox: Mailbox;
  /** The lines of the log line writer override, in order. */
  readonly lines: string[];
  /** What the registered `grant_mail_extra` does. null returns `pass`. */
  extra: ExtraHook | null;
  /** What the registered `validate_item_change` returns. null is `pass`. */
  reject_items: GameContract.GameError | null;
}

export interface StartOptions {
  /** Register `grant_mail_extra`. Default true. */
  readonly hook?: boolean;
  /** Settings over `MAIL_SETTINGS`. */
  readonly settings?: Readonly<Record<string, unknown>>;
  /** Another server instance on this database. */
  readonly db?: DbTarget;
  readonly clock?: TestClock;
}

const running: (() => void)[] = [];

/** Starts `server-time`, `storage`, `logging`, `item-ledger` and `mailbox` with their DEV code in dependency order. */
export async function start_mail_server(options: StartOptions = {}): Promise<MailServer> {
  const db = options.db ?? (await new_db());
  const clock = options.clock ?? new TestClock(START_AT);
  const time = create_server_time({ settings: { 'server-time.silentMarginMs': 5000, dailyResetOffsetMs: 0 }, modules: {} });
  create_server_time_dev(time).set_clock(clock);
  const settings = { ...core_settings(), 'environments.<ENV>.adapters.analytics': 'fake', ...MAIL_SETTINGS, ...options.settings };
  const lines: string[] = [];
  const server = test_server(db, {
    server_modules: ['item-ledger', 'logging', 'mailbox', 'server-time', 'storage'],
    write_log_line: (line) => lines.push(line),
  });
  const storage = create_storage({ settings, modules: { 'server-time': time }, server });
  const logging = create_logging({ settings, modules: { storage, 'server-time': time }, server });
  create_logging_dev(logging);
  const ledger = create_item_ledger({ settings, modules: { storage, 'server-time': time, logging }, server });
  const mailbox = create_mailbox({ settings, modules: { storage, 'item-ledger': ledger, 'server-time': time, logging }, server });
  const modules = [time, storage, logging, ledger, mailbox];
  for (const m of modules) m.begin_start();
  const ms: MailServer = { db, clock, time, storage, logging, ledger, mailbox, lines, extra: null, reject_items: null };
  // What `routing` does with the hooks content `register` gave to `register_hook`.
  ledger.hook_slots.validate_item_change = () => ms.reject_items ?? 'pass';
  if (options.hook !== false) {
    mailbox.hook_slots.grant_mail_extra = (ctx, extra_id, mail_id) => (ms.extra === null ? 'pass' : (ms.extra(ctx, extra_id, mail_id) as 'pass'));
  }
  let failure: string | null = null;
  for (const m of modules) failure ??= m.complete_start();
  const stop = (): void => {
    for (const m of [...modules].reverse()) m.stop();
  };
  if (failure !== null) {
    stop();
    throw new Error(`server start failed: ${failure}`);
  }
  // Server start ends: every job runs once.
  time.end_start();
  running.push(stop);
  return ms;
}

/** A second server instance on the same database and clock. */
export function start_peer(ms: MailServer): Promise<MailServer> {
  return start_mail_server({ db: ms.db, clock: ms.clock });
}

/** Stops every server instance the test file started. */
export function stop_all(): void {
  for (const stop of running.splice(0)) stop();
}

export interface Session {
  readonly user_id: bigint;
}

/** A new user, created at the clock's time. */
export async function login(ms: MailServer): Promise<Session> {
  const user_id = await ms.storage.run_game_transaction((tx: GameTx) => ms.storage.create_user(tx).user_id);
  if (typeof user_id !== 'bigint') throw new Error(`create_user: ${user_id}`);
  return { user_id };
}

/** A request outcome: the error code (0 on success), the handler's response, and the response delta on success. */
export interface Sent {
  readonly code: number;
  readonly response: unknown;
  readonly delta: ResponseDelta | null;
}

let next_request = 0;

function fields(request_name: string): { request_name: string; request_id: string; silent: boolean; retry: boolean; session_id: string; client_version: string; platform: string } {
  next_request += 1;
  return { request_name, request_id: `request-${String(next_request)}`, silent: false, retry: false, session_id: 'session-1', client_version: '1.0.0', platform: 'android' };
}

/**
 * The request transaction of a request without request start: a failure code rolls back, a throw rolls back and ends
 * `INTERNAL`.
 */
export async function request_transaction(ms: MailServer, user_id: bigint, name: string, handler: (ctx: RequestCtx) => unknown): Promise<Sent> {
  let response: unknown = null;
  let delta: ResponseDelta | null = null;
  let result: unknown;
  try {
    result = await ms.storage.run_request_transaction(user_id, fields(name), (ctx) => {
      response = handler(ctx);
      if (typeof response === 'number') return response;
      delta = ms.storage.take_response_delta(ctx).delta;
      return 'response';
    });
  } catch {
    return { code: CoreError.CORE_ERROR_INTERNAL, response: null, delta: null };
  }
  if (typeof result === 'number') return { code: result, response, delta: null };
  if (result !== 'response') throw new Error(`run_request_transaction: ${String(result)}`);
  return { code: 0, response, delta };
}

/** A request of the user named `name`: request start (`mailbox.on_request_start`), then the handler. */
export async function send(ms: MailServer, session: Session, name: string, handler: (ctx: RequestCtx) => unknown): Promise<Sent> {
  await ms.mailbox.on_request_start(session.user_id);
  return request_transaction(ms, session.user_id, name, handler);
}

/** `Login` of a new user as `auth` makes it: the user, the request start operations, then its response delta. */
export async function login_request(ms: MailServer): Promise<{ session: Session; sent: Sent }> {
  const session = await login(ms);
  return { session, sent: await send(ms, session, 'core/Login', () => null) };
}

export function read_mail(ms: MailServer, session: Session, mail_id: bigint): Promise<Sent> {
  const request = new CoreContract.ReadMailRequest();
  request.mail_id = mail_id;
  return send(ms, session, 'core/ReadMail', (ctx) => ms.mailbox.ReadMail(ctx, request));
}

export function claim_mail(ms: MailServer, session: Session, mail_id: bigint): Promise<Sent> {
  const request = new CoreContract.ClaimMailRequest();
  request.mail_id = mail_id;
  return send(ms, session, 'core/ClaimMail', (ctx) => ms.mailbox.ClaimMail(ctx, request));
}

export function claim_all(ms: MailServer, session: Session): Promise<Sent> {
  return send(ms, session, 'core/ClaimAllMail', (ctx) => ms.mailbox.ClaimAllMail(ctx, new CoreContract.ClaimAllMailRequest()));
}

/** A success request that only carries the pending delta. */
export function touch(ms: MailServer, session: Session): Promise<Sent> {
  return send(ms, session, 'core/Test', () => null);
}

/** Runs `fn` in an out-of-request change of the user and commits; the result is what `fn` returned. */
export async function in_user<R>(ms: MailServer, user_id: bigint, fn: (ctx: RequestCtx) => R): Promise<R> {
  let out: R | undefined;
  const result = await ms.storage.run_user_transaction(user_id, (ctx) => {
    out = fn(ctx);
    return 'pass';
  });
  if (result !== 'COMMITTED') throw new Error(`run_user_transaction: ${result}`);
  return out as R;
}

/** Runs `fn` in a transaction of the user that rolls back. */
export async function peek<R>(ms: MailServer, user_id: bigint, fn: (ctx: RequestCtx) => R): Promise<R> {
  let out: R | undefined;
  await ms.storage.run_rollback_transaction(user_id, (ctx) => {
    out = fn(ctx);
  });
  return out as R;
}

/** Runs `fn` in a game transaction. */
export async function game<R>(ms: MailServer, fn: (tx: GameTx) => R): Promise<R> {
  const out = await ms.storage.run_game_transaction(fn);
  if (out === 'FAILED') throw new Error('run_game_transaction: FAILED');
  return out;
}

/** The user's mails in mail ID order. */
export async function read_mails(ms: MailServer, user_id: bigint): Promise<CoreContract.MailUserState[]> {
  const mails = await peek(ms, user_id, (ctx) => ms.storage.list_state(ctx, CoreContract.MailUserState) as CoreContract.MailUserState[]);
  return [...mails].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

export async function mail_ids(ms: MailServer, user_id: bigint): Promise<bigint[]> {
  return (await read_mails(ms, user_id)).map((mail) => mail.id);
}

export function balance(ms: MailServer, user_id: bigint, name: string): Promise<bigint> {
  return peek(ms, user_id, (ctx) => ms.ledger.get_balance(ctx, id(name)));
}

/**
 * Adds items to the user in an out-of-request change. A success request then takes its pending delta, so a test's
 * next request has only its own changes.
 */
export async function give(ms: MailServer, user_id: bigint, items: readonly CoreContract.ItemAmount[]): Promise<void> {
  const result = await in_user(ms, user_id, (ctx) => ms.ledger.add_items(ctx, items, { source: Source.ITEM_CHANGE_SOURCE_ADMIN, ref: 'test' }));
  if (result !== 'OK') throw new Error(`add_items: ${String(result)}`);
  await request_transaction(ms, user_id, 'core/Test', () => null);
}

/** Subtracts items from the user in an out-of-request change, and takes its pending delta as `give` does. */
export async function take(ms: MailServer, user_id: bigint, items: readonly CoreContract.ItemAmount[]): Promise<void> {
  const result = await in_user(ms, user_id, (ctx) => ms.ledger.subtract_items(ctx, items, { source: Source.ITEM_CHANGE_SOURCE_ADMIN, ref: 'test' }));
  if (result !== 'OK') throw new Error(`subtract_items: ${String(result)}`);
  await request_transaction(ms, user_id, 'core/Test', () => null);
}

/** Content code's `send_mail` in an out-of-request change of the user. */
export function send_mail(ms: MailServer, user_id: bigint, input: MailInput): Promise<SendMailOutcome> {
  return in_user(ms, user_id, (ctx) => ms.mailbox.content.send_mail(ctx, input));
}

/** Content code's `grant_or_mail` in an out-of-request change of the user. */
export function grant_or_mail(
  ms: MailServer,
  user_id: bigint,
  items: readonly ItemAmountInput[],
  source: ChangeSourceInput,
  template: string,
  args: readonly MailArgInput[] = [],
): Promise<GrantOrMailOutcome> {
  return in_user(ms, user_id, (ctx) => ms.mailbox.content.grant_or_mail(ctx, items, source, id(template), args));
}

/** What the admin operation `send_mail` does with its `mail` JSON: `mail_input_from_json`, then `send_mail` to the user. */
export async function admin_send_mail(ms: MailServer, user_id: bigint, json: unknown): Promise<SendMailOutcome | 'INVALID_INPUT'> {
  const input = ms.mailbox.mail_input_from_json(json);
  if (input === 'INVALID_INPUT') return input;
  return in_user(ms, user_id, (ctx) => ms.mailbox.send_mail(ctx, input));
}

/** What the admin operation `broadcast_mail` does with its `mail` JSON: `mail_input_from_json`, then `broadcast_mail`. */
export async function admin_broadcast(ms: MailServer, json: unknown, start_at: bigint): Promise<BroadcastMailOutcome | 'INVALID_INPUT'> {
  const input = ms.mailbox.mail_input_from_json(json);
  if (input === 'INVALID_INPUT') return input;
  return game(ms, (tx) => ms.mailbox.broadcast_mail(tx, input, start_at));
}

/** Log lines as objects, of one kind when given. */
export function logs(ms: MailServer, kind?: string): Record<string, unknown>[] {
  return ms.lines.map((line) => JSON.parse(line) as Record<string, unknown>).filter((line) => kind === undefined || line.kind === kind);
}

/** The log lines of one kind for one user. */
export function user_logs(ms: MailServer, kind: string, user_id: bigint): Record<string, unknown>[] {
  return logs(ms, kind).filter((line) => line.user_id === user_id.toString());
}

export function advance_time(ms: MailServer, by: bigint): void {
  ms.clock.advance(by);
}

/** The ID value of a core test data ID name. */
export function id(name: string): number {
  const value = GameDataDev.find_id_value(name);
  if (value === 0) throw new Error(`no ID value for ${name}`);
  return value;
}

export function amount(name: string, value: bigint): CoreContract.ItemAmount {
  const out = new CoreContract.ItemAmount();
  out.item_id = id(name);
  out.amount = value;
  return out;
}

export function plain(fields: Partial<MailInput> = {}): MailInput {
  return { template_id: id('[mail_mailbox_plain]'), ...fields };
}

/** The `MailUserState` entries of a delta as `[mail ID, deleted]`. */
export function mail_entries(delta: CoreContract.UserStateDelta | null | undefined): [bigint, boolean][] {
  return (delta?.entries ?? []).filter((entry) => entry.kind === 'MailUserState').map((entry) => [entry.id, entry.deleted]);
}

/** `[item ID value, amount]` of an `ItemAmount` list. */
export function pairs(items: readonly CoreContract.ItemAmount[]): [number, bigint][] {
  return items.map((item) => [item.item_id, item.big_amount === '' ? item.amount : BigInt(item.big_amount)]);
}
