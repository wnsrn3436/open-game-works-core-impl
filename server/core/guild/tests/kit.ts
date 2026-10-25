/**
 * Test kit of the guild core tests: a test server whose content `register` keeps the module objects, records the guild
 * hooks and runs the handler a test sets for the core test data `rpc` `RunCoreTest`.
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Worker } from 'node:worker_threads';
import * as CoreContract from '../../../generated/contract/core_contract.ts';
import * as GameContract from '../../../generated/contract/game_contract.ts';
import { create_server, type ServerInstance } from '../../routing/index.ts';
import type { RequestCtx, Storage } from '../../storage/index.ts';
import { lock_key } from '../../storage/tx.ts';
import {
  call_dev,
  connect_server,
  core_test_register,
  db_kind_of,
  hold_game_row_lock,
  load_data,
  login,
  new_core_test_server_input,
  read_user_state,
  send,
  send_admin,
  start_test_server,
  stop_test_server,
  type AdminResponse,
  type CoreTestServerInput,
  type DbKind,
  type RemoteServer,
  type TestServer,
  type TestSession,
} from '../../testing/dev/index.ts';
import type { DisbandListener, Guild, GuildContent, GuildMemberChange } from '../index.ts';
import type { CommitInput } from './commit_worker.ts';

export const Role = CoreContract.GuildRole;
export const JoinType = CoreContract.GuildJoinType;
export const E = CoreContract.CoreError;
export const START_AT = 1_800_000_000_000n;
export const REJECTED = GameContract.GameError.GAME_ERROR_CORE_TEST;

/** The module objects of a server instance that the tests use, as `register(core)` gets them. */
export interface Core {
  readonly routing: {
    register_hook(module: string, hook: string, fn: unknown): void;
    register_handler(rpc: string, handler: unknown): void;
  };
  readonly guild: GuildContent;
  readonly 'item-ledger': {
    subtract_items(ctx: RequestCtx, items: readonly CoreContract.ItemAmount[], source: { source: number; ref: string; once_key: string }): string | number;
  };
  readonly [name: string]: unknown;
}

export interface ChangeCall {
  readonly ctx_user: bigint;
  readonly guild_id: bigint;
  readonly user_id: bigint;
  readonly change: GuildMemberChange;
}

/** What the content `register` of a test does; a test changes these while the server runs. */
export interface Content {
  prepare_create_guild: ((ctx: RequestCtx, name: string) => 'pass' | number) | null;
  validate_guild_join: ((ctx: RequestCtx, guild_id: bigint, join_value: bigint) => 'pass' | number) | null;
  /** Runs inside `on_guild_member_changed` after the call is recorded. */
  on_changed: ((ctx: RequestCtx, call: ChangeCall) => void) | null;
  /** The body of the `RunCoreTest` handler; a number it returns is the handler's `GameError`. */
  run_core_test: ((ctx: RequestCtx) => unknown) | null;
  readonly changed: ChangeCall[];
  readonly requested: { readonly ctx_user: bigint; readonly guild_id: bigint }[];
}

/** What the row readers need: the `storage` module object of a running server instance. */
export interface HasStorage {
  storage(): Storage;
}

export interface Kit extends HasStorage {
  readonly server: TestServer;
  readonly content: Content;
  /** The DB kind of the test server. */
  readonly db: DbKind;
  core(): Core;
  /** The guild object `register(core)` gets: the `content` member, which content handlers and hooks call. */
  guild(): GuildContent;
  /** The `guild` module object itself, with the operations only core modules call. */
  module(): Guild;
}

export interface StartOptions {
  readonly settings?: Readonly<Record<string, unknown>>;
  readonly db?: DbKind;
  readonly start_at?: bigint;
  readonly environment?: 'LOCAL' | 'STG';
}

/** Test servers to stop after each test. */
const servers: TestServer[] = [];
/** Lock holders and direct server instances to end after each test. */
const cleanups: (() => Promise<void>)[] = [];

/** Stops the test servers, lock holders and direct server instances a test started. */
export async function stop_servers(): Promise<void> {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
  for (const server of servers.splice(0)) await stop_test_server(server);
}

/** Time limit of one test: test servers start, and lock tests wait. */
export const T = 60_000;

function new_content(): Content {
  return { prepare_create_guild: null, validate_guild_join: null, on_changed: null, run_core_test: null, changed: [], requested: [] };
}

function content_register(content: Content, keep: (core: Core) => void): (core: Readonly<Record<string, unknown>>) => void {
  return (raw) => {
    const core = raw as Core;
    keep(core);
    core_test_register(raw, ['RunCoreTest']);
    const hook = (name: string, fn: unknown): void => {
      core.routing.register_hook('guild', name, fn);
    };
    hook('prepare_create_guild', (ctx: RequestCtx, name: string) => content.prepare_create_guild?.(ctx, name) ?? 'pass');
    hook('validate_guild_join', (ctx: RequestCtx, guild_id: bigint, join_value: bigint) => content.validate_guild_join?.(ctx, guild_id, join_value) ?? 'pass');
    hook('on_guild_member_changed', (ctx: RequestCtx, guild_id: bigint, user_id: bigint, change: GuildMemberChange) => {
      const call = { ctx_user: ctx.user_id, guild_id, user_id, change };
      content.changed.push(call);
      content.on_changed?.(ctx, call);
    });
    hook('on_guild_join_requested', (ctx: RequestCtx, guild_id: bigint) => {
      content.requested.push({ ctx_user: ctx.user_id, guild_id });
    });
    core.routing.register_handler('RunCoreTest', (ctx: RequestCtx) => {
      const result = content.run_core_test?.(ctx);
      return typeof result === 'number' ? result : new GameContract.RunCoreTestResponse();
    });
  };
}

/** The `storage` module object of a server instance; content `register(core)` gets only its member `content`. */
function storage_of(instance: ServerInstance): Storage {
  const storage = instance.modules().get('storage');
  if (storage === undefined) throw new Error('the server instance has no storage module');
  return storage as unknown as Storage;
}

/** The `guild` module object of a server instance. */
function guild_module(instance: ServerInstance): Guild {
  const guild = instance.modules().get('guild');
  if (guild === undefined) throw new Error('the server instance has no guild module');
  return guild as unknown as Guild;
}

/** A test server with guild settings overrides. */
export async function start(options: StartOptions = {}): Promise<Kit> {
  const content = new_content();
  let kept: Core | null = null;
  const register = content_register(content, (core) => {
    kept = core;
  });
  const start_at = options.environment === 'STG' ? undefined : (options.start_at ?? START_AT);
  const server = await start_test_server(start_at, options.db, options.environment, undefined, undefined, options.settings ?? {}, register);
  servers.push(server);
  const core = (): Core => {
    if (kept === null) throw new Error('register was not called');
    return kept;
  };
  return {
    server,
    content,
    db: db_kind_of(server),
    core,
    guild: () => core().guild,
    module: () => guild_module(server.running().instance),
    storage: () => storage_of(server.running().instance),
  };
}

/**
 * A server instance made with `routing.create_server` on a new test DB, for what a test server does not take: a PROD
 * environment, a `null` settings override, and `register_disband_listener` during server start. It runs on the system
 * clock.
 */
export interface Direct extends HasStorage {
  readonly instance: ServerInstance;
  readonly content: Content;
  /** A remote test server of the instance to log in and send requests to; null for PROD, which has no DEV code. */
  readonly server: RemoteServer | null;
  module(): Guild;
  admin(operation: string, body: Record<string, unknown>): Promise<{ status: number; json: unknown }>;
}

export interface DirectOptions {
  readonly env: 'LOCAL' | 'PROD';
  readonly settings?: Readonly<Record<string, unknown>>;
  /** Functions given to `register_disband_listener` in `register(core)`, in order. */
  readonly listeners?: readonly DisbandListener[];
  /** Gets the log lines the instance writes, parsed. */
  readonly logs?: Record<string, unknown>[];
}

/** Starts a direct server instance (`Direct`); the start failure reason when it does not start. */
export async function start_direct(options: DirectOptions): Promise<Direct | string> {
  const folder = mkdtempSync(join(tmpdir(), 'guild-direct-'));
  let input: CoreTestServerInput | null = null;
  cleanups.push(async () => {
    if (input !== null) await input.drop();
    rmSync(folder, { recursive: true, force: true });
  });
  input = await new_core_test_server_input();
  const secrets = input.secrets;
  const secret_file = join(folder, 'secrets.json');
  writeFileSync(secret_file, JSON.stringify(secrets.file), { mode: 0o600 });
  const content = new_content();
  const local = options.env === 'LOCAL';
  const env_settings = local ? {} : { 'environments.<ENV>.adapters': {}, 'environments.<ENV>.updatePublicKeys': [secrets.update_public_key] };
  const instance: ServerInstance = create_server({
    args: { env: options.env, port: 0, matchmaker: false, db: input.database.db_argument, secret_file },
    server_modules: input.server_modules,
    data_folder: input.data_folder,
    core_settings: input.settings,
    game_settings: {},
    register: (raw) => {
      content_register(content, () => undefined)(raw);
      for (const listener of options.listeners ?? []) guild_module(instance).register_disband_listener(listener);
    },
    dev: local,
    register_dev: local ? input.registerDev : null,
    settings_overrides: { ...env_settings, ...(options.settings ?? {}) },
    log_writer: (line) => {
      options.logs?.push(JSON.parse(line) as Record<string, unknown>);
    },
  });
  const started = await instance.start().catch((error: unknown) => (error instanceof Error ? error.message : String(error)));
  if (typeof started === 'string') return started;
  cleanups.push(() => instance.stop());
  const url = `http://127.0.0.1:${String(started)}`;
  const admin_secret = secrets.file['adminSecret.ogw'] ?? '';
  return {
    instance,
    content,
    server: local ? await connect_server(url, input.data_folder, secrets.dev_access) : null,
    module: () => guild_module(instance),
    storage: () => storage_of(instance),
    admin: async (operation, body) => {
      const reply = await fetch(`${url}/admin/${operation}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ogw.${admin_secret}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body, (_k, v: unknown) => (typeof v === 'bigint' ? v.toString() : v)),
      });
      const text = await reply.text();
      return { status: reply.status, json: text === '' ? null : (JSON.parse(text) as unknown) };
    },
  };
}

/**
 * Holds the lock `lock_guild` takes on a guild row from another connection to the test server's DB until the test
 * ends or the returned function runs. On SQLite it holds every write transaction.
 */
export function hold_guild(kit: Kit, guild_id: bigint): Promise<() => Promise<void>> {
  return hold_row(kit, 'guild_guild', [guild_id]);
}

/** `hold_guild` on the lock `storage.lock_game_row` takes on the row of `key` in a guild table. */
export async function hold_row(kit: Kit, table: string, key: readonly bigint[]): Promise<() => Promise<void>> {
  const release = await hold_game_row_lock(kit.server, table, key);
  let released = false;
  const once = async (): Promise<void> => {
    if (released) return;
    released = true;
    await release();
  };
  cleanups.push(once);
  return once;
}

/**
 * Holds the lock `lock_guild` takes on a guild row from a worker thread's connection to the test server's PostgreSQL
 * DB. The returned function lets the worker go on: once a connection waits for an advisory lock of the DB, it runs the
 * statements and commits, and the promise resolves to `committed`, or to the reason it did not.
 */
export function commit_while_locked(kit: Kit, guild_id: bigint, statements: CommitInput['statements']): Promise<() => Promise<string>> {
  return commit_while_row_locked(kit, 'guild_guild', [guild_id], statements);
}

/** `commit_while_locked` on the lock `storage.lock_game_row` takes on the row of `key` in a guild table. */
export async function commit_while_row_locked(kit: Kit, table: string, key: readonly bigint[], statements: CommitInput['statements']): Promise<() => Promise<string>> {
  const connection = kit.server.shared.database.connection;
  if (connection === null) throw new Error('commit_while_locked needs a PostgreSQL test server');
  const input: CommitInput = { connection, lock_key: lock_key(table, key), statements };
  const worker = new Worker(new URL('./commit_worker.ts', import.meta.url), { workerData: input });
  cleanups.push(() => worker.terminate().then(() => undefined));
  const next = (): Promise<string> =>
    new Promise((resolve, reject) => {
      worker.once('message', (message: string) => {
        resolve(message);
      });
      worker.once('error', reject);
    });
  const locked = await next();
  if (locked !== 'locked') throw new Error(`commit_worker: ${locked}`);
  return () => {
    const done = next();
    worker.postMessage('go');
    return done;
  };
}

type Tuple<T, N extends number, R extends T[] = []> = R['length'] extends N ? R : Tuple<T, N, [T, ...R]>;

/** `count` dev logins, in the order they were made (their user IDs are random, not in that order). */
export async function users<N extends number>(kit: { readonly server: TestServer | RemoteServer | null }, count: N, prefix = 'guild'): Promise<Tuple<TestSession, N>> {
  const server = kit.server;
  if (server === null) throw new Error('the server takes no login');
  const sessions: TestSession[] = [];
  for (let i = 0; i < count; i += 1) sessions.push(await login(server, `${prefix}_${String(i)}`));
  return sessions as Tuple<TestSession, N>;
}

export interface Sent<T> {
  /** `ServerError.code`; 0 on success. */
  readonly code: number;
  readonly response: T | null;
  readonly envelope: CoreContract.ResponseEnvelope;
}

/** Sends a core `rpc` (`core/<name>`). */
export async function rpc<T>(session: TestSession, name: string, request: { encode(): Uint8Array }): Promise<Sent<T>> {
  const { envelope, response } = (await send(session, `core/${name}`, request)) as { envelope: CoreContract.ResponseEnvelope; response: T | null };
  return { code: envelope.error === null ? 0 : envelope.error.code, response, envelope };
}

export async function create_guild(
  session: TestSession,
  name: string,
  join_type: CoreContract.GuildJoinType = JoinType.GUILD_JOIN_TYPE_OPEN,
  description = '',
  join_value = 0n,
): Promise<{ code: number; guild_id: bigint }> {
  const request = new CoreContract.CreateGuildRequest();
  request.name = name;
  request.description = description;
  request.join_type = join_type;
  request.join_value = join_value;
  const sent = await rpc<CoreContract.CreateGuildResponse>(session, 'CreateGuild', request);
  return { code: sent.code, guild_id: sent.response?.guild_id ?? 0n };
}

export async function join_guild(session: TestSession, guild_id: bigint): Promise<{ code: number; joined: boolean | null }> {
  const request = new CoreContract.JoinGuildRequest();
  request.guild_id = guild_id;
  const sent = await rpc<CoreContract.JoinGuildResponse>(session, 'JoinGuild', request);
  return { code: sent.code, joined: sent.response?.joined ?? null };
}

/** Sends a core `rpc` whose request has one `user_id` field and returns the error code. */
export async function on_user(session: TestSession, name: 'AcceptGuildJoinRequest' | 'RejectGuildJoinRequest' | 'KickGuildMember', user_id: bigint): Promise<number> {
  const request = new CoreContract[`${name}Request`]();
  request.user_id = user_id;
  return (await rpc(session, name, request)).code;
}

export async function set_role(session: TestSession, user_id: bigint, role: CoreContract.GuildRole): Promise<number> {
  const request = new CoreContract.SetGuildMemberRoleRequest();
  request.user_id = user_id;
  request.role = role;
  return (await rpc(session, 'SetGuildMemberRole', request)).code;
}

export async function cancel_request(session: TestSession, guild_id: bigint): Promise<number> {
  const request = new CoreContract.CancelGuildJoinRequestRequest();
  request.guild_id = guild_id;
  return (await rpc(session, 'CancelGuildJoinRequest', request)).code;
}

export async function leave(session: TestSession): Promise<number> {
  return (await rpc(session, 'LeaveGuild', new CoreContract.LeaveGuildRequest())).code;
}

export async function withdraw(session: TestSession): Promise<number> {
  return (await rpc(session, 'Withdraw', new CoreContract.WithdrawRequest())).code;
}

export async function get_guild(session: TestSession, guild_id: bigint): Promise<Sent<CoreContract.GetGuildResponse>> {
  const request = new CoreContract.GetGuildRequest();
  request.guild_id = guild_id;
  return rpc(session, 'GetGuild', request);
}

export async function get_my_guild(session: TestSession): Promise<Sent<CoreContract.GetMyGuildResponse>> {
  return rpc(session, 'GetMyGuild', new CoreContract.GetMyGuildRequest());
}

export async function search(session: TestSession, name: string): Promise<bigint[]> {
  const request = new CoreContract.SearchGuildsRequest();
  request.name = name;
  const sent = await rpc<CoreContract.SearchGuildsResponse>(session, 'SearchGuilds', request);
  return (sent.response?.guilds ?? []).map((g) => g.guild_id);
}

export async function joinable(session: TestSession, max_join_value: bigint): Promise<bigint[]> {
  const request = new CoreContract.ListJoinableGuildsRequest();
  request.max_join_value = max_join_value;
  const sent = await rpc<CoreContract.ListJoinableGuildsResponse>(session, 'ListJoinableGuilds', request);
  return (sent.response?.guilds ?? []).map((g) => g.guild_id);
}

export async function run_core_test(session: TestSession, body: (ctx: RequestCtx) => unknown, kit: Kit): Promise<number> {
  kit.content.run_core_test = body;
  try {
    const { envelope } = (await send(session, 'RunCoreTest', new GameContract.RunCoreTestRequest())) as { envelope: CoreContract.ResponseEnvelope };
    return envelope.error === null ? 0 : envelope.error.code;
  } finally {
    kit.content.run_core_test = null;
  }
}

export function admin(kit: Kit, operation: string, body: Record<string, unknown>): Promise<AdminResponse> {
  return send_admin(kit.server, operation, body);
}

/** An `int64` column value of a row `storage` read. */
function int64(value: unknown): bigint {
  if (typeof value !== 'bigint') throw new TypeError(`not an int64 value: ${typeof value}`);
  return value;
}

/** Committed rows of a guild table, read through `storage.read_db`. */
export function rows(kit: HasStorage, sql: string, params: readonly (bigint | number | string)[] = []): Record<string, unknown>[] {
  return kit.storage().read_db().query(sql, params);
}

export interface MemberState {
  readonly guild_id: bigint;
  readonly role: number;
  readonly joined_at: bigint;
  readonly active_at: bigint;
}

export function member(kit: HasStorage, user_id: bigint): MemberState | null {
  const row = rows(kit, 'SELECT guild_id, role, joined_at, active_at FROM guild_member WHERE user_id = $1', [user_id])[0];
  return row === undefined ? null : { guild_id: int64(row.guild_id), role: Number(row.role), joined_at: int64(row.joined_at), active_at: int64(row.active_at) };
}

export interface GuildState {
  readonly name: string;
  readonly normalized_name: string;
  readonly description: string;
  readonly join_type: number;
  readonly leader_id: bigint;
  readonly member_count: number;
  readonly max_members: number;
  readonly joinable: boolean;
  readonly created_at: bigint;
  readonly updated_at: bigint;
}

export function guild_row(kit: HasStorage, guild_id: bigint): GuildState | null {
  const row = rows(kit, 'SELECT * FROM guild_guild WHERE guild_id = $1', [guild_id])[0];
  if (row === undefined) return null;
  return {
    name: String(row.name),
    normalized_name: String(row.normalized_name),
    description: String(row.description),
    join_type: Number(row.join_type),
    leader_id: int64(row.leader_id),
    member_count: Number(row.member_count),
    max_members: Number(row.max_members),
    joinable: row.joinable === true || row.joinable === 1 || row.joinable === 1n,
    created_at: int64(row.created_at),
    updated_at: int64(row.updated_at),
  };
}

export function member_ids(kit: HasStorage, guild_id: bigint): bigint[] {
  return rows(kit, 'SELECT user_id FROM guild_member WHERE guild_id = $1 ORDER BY user_id', [guild_id]).map((r) => int64(r.user_id));
}

export function requests(kit: HasStorage): { guild_id: bigint; user_id: bigint }[] {
  return rows(kit, 'SELECT guild_id, user_id FROM guild_join_request ORDER BY guild_id, user_id').map((r) => ({ guild_id: int64(r.guild_id), user_id: int64(r.user_id) }));
}

export function name_rows(kit: HasStorage): { normalized_name: string; guild_id: bigint }[] {
  return rows(kit, 'SELECT normalized_name, guild_id FROM guild_name ORDER BY guild_id').map((r) => ({ normalized_name: String(r.normalized_name), guild_id: int64(r.guild_id) }));
}

export function cooldown(kit: HasStorage, user_id: bigint): bigint | null {
  const row = rows(kit, 'SELECT ends_at FROM guild_cooldown WHERE user_id = $1', [user_id])[0];
  return row === undefined ? null : int64(row.ends_at);
}

/** The withdrawal time of a user's `user` row, or null. */
export function withdrawn_at(kit: HasStorage, user_id: bigint): bigint | null {
  return kit.storage().get_user_record(kit.storage().read_db(), user_id)?.withdrawn_at ?? null;
}

/** The ID value of an ID name of the core test data. */
export function id_value(id_name: string): number {
  return (load_data() as { dev: { find_id_value(name: string): number } }).dev.find_id_value(id_name);
}

export const GOLD = '[guild_gold]';

export async function set_gold(kit: Kit, user_id: bigint, balance: bigint): Promise<void> {
  await call_dev(kit.server, 'item-ledger', 'set_balance', [id_value(GOLD), balance], user_id);
}

export async function gold(kit: Kit, user_id: bigint): Promise<bigint> {
  const items = (await read_user_state(kit.server, user_id)) as { kind: string; item_id: bigint; value: unknown }[];
  const item = items.find((i) => i.kind === 'ItemBalanceUserState' && i.item_id === BigInt(id_value(GOLD)));
  return item === undefined ? 0n : (item.value as { amount: bigint }).amount;
}

export async function test_state(kit: Kit, user_id: bigint): Promise<GameContract.GuildTestUserState | null> {
  const items = (await read_user_state(kit.server, user_id)) as { kind: string; value: unknown }[];
  const item = items.find((i) => i.kind === 'GuildTestUserState');
  return item === undefined ? null : (item.value as GameContract.GuildTestUserState);
}

export { advance_time, read_logs, set_time, type TestSession } from '../../testing/dev/index.ts';

/** Every row of the guild tables, for before and after comparisons. */
export function snapshot(kit: HasStorage): string {
  const tables = ['guild_guild', 'guild_name', 'guild_member', 'guild_join_request', 'guild_cooldown', 'guild_sequence'];
  return JSON.stringify(
    tables.map((table) => rows(kit, `SELECT * FROM ${table}`).map((row) => JSON.stringify(row, (_, v: unknown) => (typeof v === 'bigint' ? String(v) : v))).sort()),
  );
}

/** A guild with a `Leader` and members who joined it (`Open`), with `Officer` roles for `officers`. */
export async function guild_with(
  leader: TestSession,
  name: string,
  members: readonly TestSession[],
  officers: readonly TestSession[] = [],
): Promise<bigint> {
  const { code, guild_id } = await create_guild(leader, name);
  if (code !== 0) throw new Error(`CreateGuild ${name}: ${String(code)}`);
  for (const m of members) {
    const joined = await join_guild(m, guild_id);
    if (joined.code !== 0) throw new Error(`JoinGuild ${name}: ${String(joined.code)}`);
  }
  for (const o of officers) {
    const set = await set_role(leader, o.user_id, Role.GUILD_ROLE_OFFICER);
    if (set !== 0) throw new Error(`SetGuildMemberRole ${name}: ${String(set)}`);
  }
  return guild_id;
}

export async function update_guild(session: TestSession, join_type: CoreContract.GuildJoinType, description = '', join_value = 0n): Promise<number> {
  const request = new CoreContract.UpdateGuildRequest();
  request.description = description;
  request.join_type = join_type;
  request.join_value = join_value;
  return (await rpc(session, 'UpdateGuild', request)).code;
}
