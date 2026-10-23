/**
 * Test helpers of the chat core tests: a test server whose `register` keeps the module objects, sets the chat hooks
 * and registers a `RunCoreTest` handler that runs a test function in the request ctx.
 */
import * as CoreContract from '../../../generated/contract/core_contract.ts';
import * as GameContract from '../../../generated/contract/game_contract.ts';
import {
  advance_time,
  core_test_register,
  core_test_server_paths,
  load_data,
  login,
  read_logs,
  send,
  send_admin,
  start_test_server,
  type TestServer,
  type TestSession,
} from '../../testing/dev/index.ts';
import type { RequestCtx, Storage } from '../../storage/index.ts';
import { lock_holder, PG_LOCK_SQL, stop_all, storage_module } from '../../storage/tests/helpers.ts';
import type { PgValue } from '../../storage/dev/index.ts';
import { lock_key } from '../../storage/tx.ts';
import type { ChatModule } from '../index.ts';

/** The server module list of this run, from `core_test_server_paths`. */
const run_paths = core_test_server_paths();

/**
 * The module objects of a server instance that these tests call, as `register(core)` gets them, except `storage`: the
 * module object, whose database access content does not get.
 */
export interface Core {
  readonly storage: Storage;
  readonly chat: ChatModule;
  readonly routing: {
    register_hook(module: string, hook: string, fn: (...args: never[]) => unknown): void;
    register_handler(name: string, handler: (ctx: RequestCtx) => unknown): void;
  };
  readonly guild?: { lock_guild(ctx: RequestCtx, guild_id: bigint): unknown };
  readonly friend?: object;
  readonly 'public-profile': { get_public_profiles(ctx: RequestCtx, user_ids: readonly bigint[]): CoreContract.PublicProfileEntry[] };
}

export const E = CoreContract.CoreError;
export const K = CoreContract.ChatChannelKind;
export const MK = CoreContract.ChatMessageKind;

/** 2026-01-01T00:00:00Z. */
export const START_AT = 1_767_225_600_000n;

/** The chat hooks of the content `register`. A test sets them; null is the hook's `default`. */
export interface Hooks {
  validate: ((ctx: RequestCtx, kind: number, channel_id: bigint, message_kind: number, text: string) => unknown) | null;
  sent: ((ctx: RequestCtx, message: CoreContract.ChatMessage) => void) | null;
}

/** A test function `RunCoreTest` runs in the request ctx of a user. */
type CoreTestFn = (ctx: RequestCtx) => unknown;

export interface Harness {
  readonly server: TestServer;
  readonly hooks: Hooks;
  /** The module objects of the server instance the test server runs now. */
  core(): Core;
  chat(): ChatModule;
  /** The test function of the next `RunCoreTest` of each user, and what it returned. */
  readonly runs: Map<bigint, CoreTestFn>;
  readonly results: Map<bigint, unknown>;
}

export interface StartOptions {
  /** Settings overrides on top of `chat.minIntervalMs` 0. */
  readonly settings?: Readonly<Record<string, unknown>>;
  /** The server module list; omitted, the test server prepares every server module. */
  readonly modules?: readonly string[];
  readonly start_at?: bigint;
  /** The DB kind; omitted, `start_test_server`'s default. */
  readonly db?: 'sqlite' | 'postgresql';
}

/** A test server with the chat hooks registered through `hooks`, `RunCoreTest`, the core test defaults and `chat.minIntervalMs` 0. */
export async function start(options: StartOptions = {}): Promise<Harness> {
  const hooks: Hooks = { validate: null, sent: null };
  const runs = new Map<bigint, CoreTestFn>();
  const results = new Map<bigint, unknown>();
  const kept: { core?: Core } = {};
  const register = (registered: Readonly<Record<string, unknown>>): void => {
    const core = registered as unknown as Core;
    kept.core = core;
    core.routing.register_handler('RunCoreTest', (ctx: RequestCtx) => {
      const run = runs.get(ctx.user_id);
      if (run === undefined) return GameContract.GameError.GAME_ERROR_CORE_TEST;
      results.set(ctx.user_id, run(ctx));
      return new GameContract.RunCoreTestResponse();
    });
    core_test_register(registered, ['RunCoreTest']);
    core.routing.register_hook('chat', 'validate_chat_send', (ctx: RequestCtx, kind: number, id: bigint, mk: number, text: string) =>
      hooks.validate === null ? 'pass' : hooks.validate(ctx, kind, id, mk, text),
    );
    core.routing.register_hook('chat', 'on_chat_message_sent', (ctx: RequestCtx, message: CoreContract.ChatMessage) => {
      hooks.sent?.(ctx, message);
    });
  };
  const settings = { 'chat.minIntervalMs': 0, ...options.settings };
  const server = await start_test_server(options.start_at ?? START_AT, options.db, undefined, undefined, undefined, settings, register, undefined, options.modules);
  const get = (): Core => {
    if (kept.core === undefined) throw new Error('register was not called');
    return { ...kept.core, storage: storage_module(server) };
  };
  return { server, hooks, core: get, chat: () => get().chat, runs, results };
}

/** The server module list of a server core test without `modules`. */
export function without(...modules: string[]): string[] {
  return run_paths.server_modules.filter((name) => !modules.includes(name));
}

export interface CoreTestResult<V> {
  /** `ServerError.code` of `RunCoreTest`, 0 on success. */
  readonly code: number;
  /** What `fn` returned; undefined when the handler did not run to the end. */
  readonly value: V | undefined;
}

/** Sends `RunCoreTest` as `session`; its handler runs `fn` in the request ctx. */
export async function core_test<V>(h: Harness, session: TestSession, fn: (ctx: RequestCtx) => V): Promise<CoreTestResult<V>> {
  h.runs.set(session.user_id, fn);
  h.results.delete(session.user_id);
  const { envelope } = await send(session, 'RunCoreTest', new GameContract.RunCoreTestRequest());
  h.runs.delete(session.user_id);
  const value = h.results.get(session.user_id) as V | undefined;
  return { code: envelope.error === null ? 0 : envelope.error.code, value };
}

/** `post_system_message` in a `RunCoreTest` of `session`: the written message, or null. A failed request fails the test. */
export async function post_system(h: Harness, session: TestSession, kind: number, channel_id: bigint, text: string): Promise<CoreContract.ChatMessage | null> {
  const result = await core_test(h, session, (ctx) => h.chat().post_system_message(ctx, kind as CoreContract.ChatChannelKind, channel_id, text));
  expect(result.code).toBe(0);
  return result.value ?? null;
}

/** A tuple of `N` test sessions. */
export type Sessions<N extends number, R extends TestSession[] = []> = R['length'] extends N ? R : Sessions<N, [TestSession, ...R]>;

let next_account = 0;

/** Logs in `count` new dev accounts. */
export async function users<N extends number>(server: TestServer, count: N): Promise<Sessions<N>> {
  const out: TestSession[] = [];
  for (let i = 0; i < count; i += 1) {
    next_account += 1;
    out.push(await login(server, `chat_user_${String(next_account)}`));
  }
  return out as Sessions<N>;
}

export interface Result<R> {
  /** `ServerError.code`, 0 on success. */
  readonly code: number;
  readonly response: R | null;
  readonly envelope: CoreContract.ResponseEnvelope;
}

/** A request message: a contract message class instance. */
export interface RequestMessage {
  encode(): Uint8Array;
}

export async function rpc<R>(session: TestSession, name: string, request: RequestMessage): Promise<Result<R>> {
  const { envelope, response } = await send(session, name, request);
  return { code: envelope.error === null ? 0 : envelope.error.code, response: response as R | null, envelope };
}

/** The response of a successful request; any other result fails the test. */
export function ok<R>(result: Result<R>): R {
  expect(result.code).toBe(0);
  if (result.response === null) throw new Error('no response');
  return result.response;
}

export function send_chat(session: TestSession, kind: number, key: bigint, text: string, message_kind: number = MK.CHAT_MESSAGE_KIND_TEXT): Promise<Result<CoreContract.SendChatMessageResponse>> {
  const request = new CoreContract.SendChatMessageRequest();
  request.channel_kind = kind as CoreContract.ChatChannelKind;
  request.channel_key = key;
  request.message_kind = message_kind as CoreContract.ChatMessageKind;
  request.text = text;
  return rpc(session, 'core/SendChatMessage', request);
}

/** The message of a successful `SendChatMessage`. */
export async function sent(result: Promise<Result<CoreContract.SendChatMessageResponse>>): Promise<CoreContract.ChatMessage> {
  const message = ok(await result).message;
  if (message === null) throw new Error('no message');
  return message;
}

export interface GetOptions {
  readonly after_seq?: bigint;
  readonly before_seq?: bigint;
  readonly after_delete_seq?: bigint;
}

export function get_chat(session: TestSession, kind: number, key: bigint, options: GetOptions = {}): Promise<Result<CoreContract.GetChatMessagesResponse>> {
  const request = new CoreContract.GetChatMessagesRequest();
  request.channel_kind = kind as CoreContract.ChatChannelKind;
  request.channel_key = key;
  request.after_seq = options.after_seq ?? 0n;
  request.before_seq = options.before_seq ?? 0n;
  request.after_delete_seq = options.after_delete_seq ?? 0n;
  return rpc(session, 'core/GetChatMessages', request);
}

/** The response of a successful `GetChatMessages`. */
export async function got(session: TestSession, kind: number, key: bigint, options: GetOptions = {}): Promise<CoreContract.GetChatMessagesResponse> {
  return ok(await get_chat(session, kind, key, options));
}

export function report_chat(session: TestSession, kind: number, key: bigint, seq: bigint, reason_id: number = reason()): Promise<Result<CoreContract.ReportChatMessageResponse>> {
  const request = new CoreContract.ReportChatMessageRequest();
  request.channel_kind = kind as CoreContract.ChatChannelKind;
  request.channel_key = key;
  request.seq = seq;
  request.reason_id = reason_id;
  return rpc(session, 'core/ReportChatMessage', request);
}

export function get_channels(session: TestSession): Promise<Result<CoreContract.GetChatChannelsResponse>> {
  return rpc(session, 'core/GetChatChannels', new CoreContract.GetChatChannelsRequest());
}

/** The channels of a successful `GetChatChannels`. */
export async function channels(session: TestSession): Promise<CoreContract.ChatChannelEntry[]> {
  return ok(await get_channels(session)).channels;
}

export function delete_guild_chat(session: TestSession, seq: bigint): Promise<Result<CoreContract.DeleteGuildChatMessageResponse>> {
  const request = new CoreContract.DeleteGuildChatMessageRequest();
  request.seq = seq;
  return rpc(session, 'core/DeleteGuildChatMessage', request);
}

/** The ID value of an ID name of the core test data. */
export function id_value(id_name: string): number {
  return load_data().dev.find_id_value(id_name);
}

/** The `report_reason` row of the core test data. */
export function reason(): number {
  return id_value('[report_spam]');
}

/** Sends a friend request from `a` and accepts it as `b`. */
export async function make_friends(a: TestSession, b: TestSession): Promise<void> {
  const ask = new CoreContract.SendFriendRequestRequest();
  ask.user_id = b.user_id;
  expect((await rpc(a, 'core/SendFriendRequest', ask)).code).toBe(0);
  const accept = new CoreContract.AcceptFriendRequestRequest();
  accept.user_id = a.user_id;
  expect((await rpc(b, 'core/AcceptFriendRequest', accept)).code).toBe(0);
}

export async function block(blocker: TestSession, target: TestSession): Promise<void> {
  const request = new CoreContract.BlockUserRequest();
  request.user_id = target.user_id;
  expect((await rpc(blocker, 'core/BlockUser', request)).code).toBe(0);
}

export async function set_nickname(session: TestSession, nickname: string): Promise<void> {
  const request = new CoreContract.SetNicknameRequest();
  request.nickname = nickname;
  expect((await rpc(session, 'core/SetNickname', request)).code).toBe(0);
}

export async function withdraw(session: TestSession): Promise<number> {
  return (await rpc(session, 'core/Withdraw', new CoreContract.WithdrawRequest())).code;
}

/** Creates an `Open` guild led by `leader`, and returns its guild ID. */
export async function create_guild(leader: TestSession, name: string): Promise<bigint> {
  const request = new CoreContract.CreateGuildRequest();
  request.name = name;
  request.description = '';
  request.join_type = CoreContract.GuildJoinType.GUILD_JOIN_TYPE_OPEN;
  request.join_value = 0n;
  return ok(await rpc<CoreContract.CreateGuildResponse>(leader, 'core/CreateGuild', request)).guild_id;
}

export async function join_guild(session: TestSession, guild_id: bigint): Promise<void> {
  const request = new CoreContract.JoinGuildRequest();
  request.guild_id = guild_id;
  expect(ok(await rpc<CoreContract.JoinGuildResponse>(session, 'core/JoinGuild', request)).joined).toBe(true);
}

export async function kick(leader: TestSession, target: TestSession): Promise<number> {
  const request = new CoreContract.KickGuildMemberRequest();
  request.user_id = target.user_id;
  return (await rpc(leader, 'core/KickGuildMember', request)).code;
}

export async function set_role(leader: TestSession, target: TestSession, role: CoreContract.GuildRole): Promise<void> {
  const request = new CoreContract.SetGuildMemberRoleRequest();
  request.user_id = target.user_id;
  request.role = role;
  expect((await rpc(leader, 'core/SetGuildMemberRole', request)).code).toBe(0);
}

/** `send_admin` with a JSON body: the status and the JSON body. */
export async function admin(server: TestServer, operation: string, body: Record<string, unknown>): Promise<{ status: number; json: unknown }> {
  const result = await send_admin(server, operation, body);
  return { status: result.status, json: result.json };
}

/** A row of `list_chat_messages`, int64 values as decimal strings. */
export interface AdminMessage {
  readonly kind: string;
  readonly key_a: string;
  readonly key_b: string;
  readonly seq: string;
  readonly sender_id: string;
  readonly message_kind: string;
  readonly text: string;
  readonly deleted: boolean;
  readonly created_at: string;
  readonly expires_at: string;
}

/** `list_chat_messages` of a stored channel `(kind, key_a, key_b)`. */
export async function admin_list(server: TestServer, kind: 'World' | 'Guild' | 'Direct', key_a: bigint, key_b: bigint, after_seq = 0n): Promise<AdminMessage[]> {
  const result = await admin(server, 'list_chat_messages', { channel_kind: kind, key_a: String(key_a), key_b: String(key_b), after_seq: String(after_seq), limit: 1000 });
  expect(result.status).toBe(200);
  return (result.json as { messages: AdminMessage[] }).messages;
}

/** The rows of a chat table, read with `storage.read_db` (committed rows only). */
export function rows(core: Core, sql: string, params: readonly (bigint | number | string | boolean)[] = []): Record<string, unknown>[] {
  return core.storage.read_db().query(sql, params);
}

/** The stored `(key_a, key_b)` of the `Direct` channel of two users. */
export function direct_key(a: bigint, b: bigint): [bigint, bigint] {
  return a < b ? [a, b] : [b, a];
}

export function seqs(response: CoreContract.GetChatMessagesResponse): bigint[] {
  return response.messages.map((m) => m.seq);
}

export function logs(server: TestServer, kind?: string, level?: string): Record<string, unknown>[] {
  return read_logs(server, kind, level);
}

/** A log line field: at the top level or under `fields`. */
export function field(line: Record<string, unknown>, name: string): unknown {
  if (name in line) return line[name];
  const fields = line['fields'];
  return typeof fields === 'object' && fields !== null ? (fields as Record<string, unknown>)[name] : undefined;
}

export function later(server: TestServer, ms: bigint): void {
  advance_time(server, ms);
}

/**
 * A transaction on a connection of another thread to the test server's DB, as another server instance's request would
 * hold. It holds the row locks it was opened with (on SQLite, `BEGIN IMMEDIATE` holds every write transaction) until it
 * commits, so a request of the test server waits for it.
 */
export interface OtherTx {
  readonly db: 'sqlite' | 'postgresql';
  /** Runs one statement in the transaction; a failure fails the test. */
  run(sql: string, params?: readonly PgValue[]): Promise<void>;
  /** After `delay_ms`, takes the lock `storage.lock_game_row` takes on a row (on SQLite, the transaction has it already). True when it got it. */
  lock_after(delay_ms: number, table: string, key: readonly unknown[]): Promise<boolean>;
  /** Commits after `delay_ms`, after the statements sent before it. True when it committed. */
  commit_after(delay_ms: number): Promise<boolean>;
  /**
   * PostgreSQL: commits once a session waits for a lock of the transaction, after the statements sent before it. Its
   * thread watches the waits, as the test's thread waits with the request. True when a session waited and it committed.
   */
  commit_when_waited(): Promise<boolean>;
}

/**
 * Ends once a session of the DB waits for a lock of this connection's transaction; fails after `WAITED_POLLS` polls of
 * 10 ms. `pg_locks` is read again on each poll.
 */
const WAITED_POLLS = 2000;
const UNTIL_WAITED_SQL = `DO $$ BEGIN
  FOR i IN 1..${String(WAITED_POLLS)} LOOP
    IF EXISTS (SELECT 1 FROM pg_locks WHERE NOT granted AND pg_backend_pid() = ANY(pg_blocking_pids(pid))) THEN RETURN; END IF;
    PERFORM pg_sleep(0.01);
  END LOOP;
  RAISE EXCEPTION 'no session waited for a lock of this transaction';
END $$`;

/** Opens an `OtherTx` holding the `lock_game_row` locks of `rows` (`[table, key values]`). */
export async function other_tx(h: Harness, rows: readonly (readonly [string, readonly unknown[]])[]): Promise<OtherTx> {
  const database = h.server.shared.database;
  const holder = await lock_holder({ kind: database.kind, db: database.db_argument, secrets: { db: database.connection ?? '' } });
  const pg = database.kind === 'postgresql';
  await holder.ok(pg ? 'BEGIN' : 'BEGIN IMMEDIATE');
  if (pg) for (const [table, key] of rows) await holder.ok(PG_LOCK_SQL, [lock_key(table, key)]);
  return {
    db: database.kind,
    run: async (sql, params = []) => {
      await holder.ok(sql, params);
    },
    lock_after: async (delay_ms, table, key) => (await (pg ? holder.run(PG_LOCK_SQL, [lock_key(table, key)], delay_ms) : holder.run('SELECT 1 AS held', [], delay_ms))).ok,
    commit_after: async (delay_ms) => (await holder.run('COMMIT', [], delay_ms)).ok,
    commit_when_waited: async () => {
      if (!pg) throw new Error('commit_when_waited needs PostgreSQL');
      const [waited, committed] = await Promise.all([holder.run(UNTIL_WAITED_SQL), holder.run('COMMIT')]);
      return waited.ok && committed.ok;
    },
  };
}

/** Ends the threads of the `OtherTx`s a test opened. */
export function end_other_txs(): void {
  stop_all();
}
