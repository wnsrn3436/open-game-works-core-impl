/**
 * Test servers of `matchmaker` with the `match_mode` rows a test needs, the content hooks it sets, and `/realtime`
 * players. The rows are written as `match_mode.bin` into a copy of the server build data folder, so each test picks
 * its own modes (a `ServerReplay` row in the core test data would stop every test server without `replay_match`).
 */
import { copyFileSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import * as CoreContract from '../../../generated/contract/core_contract.ts';
import * as GameContract from '../../../generated/contract/game_contract.ts';
import * as GameData from '../../../generated/data/game_data.ts';
import { open_pg_session } from '../../storage/dev/index.ts';
import type { Random, RequestCtx } from '../../storage/index.ts';
import { lock_holder, stop_all as stop_storage_helpers, storage_module } from '../../storage/tests/helpers.ts';
import {
  advance_time,
  close,
  core_test_server_paths,
  connect as connect_realtime,
  game_row_lock_id,
  hold_db,
  hold_lock_key,
  read_frame,
  register_required_hooks,
  restart_test_server,
  send,
  send_admin,
  send_frame,
  start_test_server,
  stop_test_server,
  until_blocked_by,
  wait_background,
  login,
  type Holder,
  type TestServer,
  type TestSession,
} from '../../testing/dev/index.ts';
import type { MatchRecordInput } from '../index.ts';

export const START_AT = 1_800_000_000_000n;
export const TICK_MS = 1000n;
export const K = CoreContract.MatchmakerFrameKind;
export const CoreError = CoreContract.CoreError;
export const GameError = GameContract.GameError;
export const Reason = CoreContract.MatchFailReason;
export const Judge = CoreContract.MatchJudgeStatus;

export type Conn = Awaited<ReturnType<typeof connect_realtime>>;
export type Frame = CoreContract.MatchmakerFrame;
/** The `register(core)` argument: module objects (or their `content` member) by module name. */
export type Core = Readonly<Record<string, Record<string, unknown>>>;

/** True when one of the server modules is not in this core (its module folder has no entry file). */
export function missing(...modules: string[]): boolean {
  return modules.some((m) => !existsSync(new URL(`../../${m}/index.ts`, import.meta.url)) && !existsSync(new URL(`../../${m}/dev/index.ts`, import.meta.url)));
}

/** The server modules of the core spec that are in this core, by name. */
export function present_server_modules(): string[] {
  const dir = new URL('../../../../core-spec/', import.meta.url);
  return readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => JSON.parse(readFileSync(new URL(f, dir), 'utf8')) as { name: string; side: string })
    .filter((m) => m.side === 'server' && !missing(m.name))
    .map((m) => m.name)
    .sort();
}

/** A `match_mode` row; ID values are the test's own. */
export interface Mode {
  readonly id: number;
  readonly min_players: number;
  readonly max_players: number;
  readonly match_wait: bigint;
  readonly prepare_time: bigint;
  readonly max_duration: bigint;
  readonly result_rule: 'Consensus' | 'Majority' | 'ServerReplay';
  readonly rating_spread: bigint;
  readonly rating_spread_per_sec: bigint;
  readonly max_party_size: number;
  readonly team_size: number;
  readonly rating_rule: number;
  readonly allow_queue: boolean;
  readonly allow_room: boolean;
}

export function mode(id: number, fields: Partial<Omit<Mode, 'id'>> = {}): Mode {
  return {
    id,
    min_players: 2,
    max_players: 2,
    match_wait: 30_000n,
    prepare_time: 3_000n,
    max_duration: 600_000n,
    result_rule: 'Consensus',
    rating_spread: 0n,
    rating_spread_per_sec: 0n,
    max_party_size: 1,
    team_size: 0,
    rating_rule: 0,
    allow_queue: true,
    allow_room: false,
    ...fields,
  };
}

/** A `rating_rule` row (server build target columns). */
export interface RatingRule {
  readonly id: number;
  readonly initial_rating: bigint;
}

/** A data version `<protocol hash>-<data hash>` of repeated hex digits. */
export function version(protocol: string, data: string): string {
  return `${protocol.repeat(64)}-${data.repeat(64)}`;
}

export const CLIENT_DATA_VERSION = version('a', '1');

function varint(value: bigint): number[] {
  let v = BigInt.asUintN(64, value);
  const out: number[] = [];
  do {
    let byte = Number(v & 0x7fn);
    v >>= 7n;
    if (v !== 0n) byte |= 0x80;
    out.push(byte);
  } while (v !== 0n);
  return out;
}

/** One data row message: field i + 1 is `values[i]`, every field a varint. */
function row_message(values: readonly (bigint | number | boolean)[]): number[] {
  const out: number[] = [];
  values.forEach((value, i) => {
    const v = typeof value === 'boolean' ? (value ? 1n : 0n) : BigInt(value);
    if (v === 0n) return;
    out.push(...varint(BigInt((i + 1) << 3)), ...varint(v));
  });
  return out;
}

/** A table binary: one length-delimited field 1 per row. */
function table_binary(rows: readonly (readonly (bigint | number | boolean)[])[]): Uint8Array {
  const out: number[] = [];
  for (const row of rows) {
    const message = row_message(row);
    out.push(0x0a, ...varint(BigInt(message.length)), ...message);
  }
  return new Uint8Array(out);
}

const folders: string[] = [];

export interface DataOptions {
  readonly modes: readonly Mode[];
  readonly rating_rules?: readonly RatingRule[];
  readonly client_data_version?: string;
  readonly compat_client_data_version?: string | null;
}

/** A server build data folder: the core test data with these `match_mode` (and `rating_rule`) rows and versions. */
export function data_folder(options: DataOptions): string {
  const source = core_test_server_paths().data_folder;
  const folder = mkdtempSync(join(tmpdir(), 'matchmaker-data-'));
  folders.push(folder);
  for (const name of readdirSync(source)) copyFileSync(join(source, name), join(folder, name));
  writeFileSync(join(folder, 'match_mode.bin'), table_binary(options.modes.map((m) => [
    m.id, m.min_players, m.max_players, m.match_wait, m.prepare_time, m.max_duration, GameData.MatchResultRule[m.result_rule],
    m.rating_spread, m.rating_spread_per_sec, m.max_party_size, m.team_size, m.rating_rule, m.allow_queue, m.allow_room,
  ])));
  writeFileSync(join(folder, 'rating_rule.bin'), table_binary((options.rating_rules ?? []).map((r) => [r.id, r.initial_rating, 0n, 400n, 32, 32, 0])));
  writeFileSync(join(folder, 'client_data_version'), `${options.client_data_version ?? CLIENT_DATA_VERSION}\n`);
  writeFileSync(join(folder, 'data_version'), `${version('e', 'e')}\n`);
  rmSync(join(folder, 'compat_client_data_version'), { force: true });
  if (options.compat_client_data_version) writeFileSync(join(folder, 'compat_client_data_version'), `${options.compat_client_data_version}\n`);
  return folder;
}

/** One recorded hook call with what the hook received. */
export interface HookCall {
  readonly hook: 'prepare_match_request' | 'validate_party' | 'apply_match_result' | 'apply_match_mismatch' | 'replay_match';
  readonly ctx: RequestCtx | null;
  readonly user_id: bigint;
  readonly mode_id: number;
  readonly user_ids: readonly bigint[];
  readonly members: readonly { readonly user_id: bigint; readonly rating: bigint }[];
  readonly request: number;
  readonly record: MatchRecordInput | null;
  readonly index: number;
  readonly bytes: Uint8Array;
  readonly data: GameData.DataSet | null;
  readonly data_version: string;
  /** The first values of the `replay_match` random. */
  readonly random: readonly number[];
}

/** Hook behavior of one test server; a hook left out is not registered. Each gets `core` like content code. */
export interface Hooks {
  prepare?: (core: Core, ctx: RequestCtx, mode_id: number, user_ids: readonly bigint[]) => bigint | number;
  validate_party?: (mode_id: number, members: readonly { user_id: bigint; rating: bigint }[], request: number) => 'pass' | number;
  apply_result?: (core: Core, ctx: RequestCtx, record: MatchRecordInput, index: number, result: Uint8Array) => 'pass' | number;
  apply_mismatch?: (core: Core, ctx: RequestCtx, record: MatchRecordInput, index: number) => 'pass' | number;
  /** Not given: `reject`, as the default game-less `register` does. `null`: not registered. */
  replay?: ((record: MatchRecordInput, input_log: Uint8Array) => Uint8Array | 'reject') | null;
}

export interface Options {
  readonly modes?: readonly Mode[];
  readonly rating_rules?: readonly RatingRule[];
  readonly hooks?: Hooks;
  readonly settings?: Readonly<Record<string, unknown>>;
  readonly matchmaker?: boolean;
  readonly environment?: 'LOCAL' | 'STG';
  readonly client_data_version?: string;
  readonly compat_client_data_version?: string | null;
  readonly server_modules?: readonly string[];
  readonly db?: 'sqlite' | 'postgresql';
}

export interface Harness {
  readonly server: TestServer;
  readonly calls: HookCall[];
  readonly client_data_version: string;
  readonly folder: string;
  core(): Core;
}

/** Limits high enough that the tests of other rules do not reach them. */
const ROOMY: Readonly<Record<string, unknown>> = {
  'matchmaker.preAuthAcceptsPerSecond': 10_000,
  'matchmaker.preAuthConnections': 10_000,
  'matchmaker.preAuthFramesPerSecond': 10_000,
  'matchmaker.framesPerSecond': 10_000,
  'matchmaker.tickMs': Number(TICK_MS),
};

const running: TestServer[] = [];

export async function stop_all(): Promise<void> {
  // The holders and watcher threads of `hold_until_waiter`.
  for (const holder of held.splice(0)) await holder.release();
  stop_storage_helpers();
  for (const server of running.splice(0)) await stop_test_server(server);
  for (const folder of folders.splice(0)) rmSync(folder, { recursive: true, force: true });
}

function routing_of(core: Core): { register_hook(module: string, hook: string, fn: unknown): void; register_handler(name: string, fn: unknown): void } {
  return core['routing'] as unknown as ReturnType<typeof routing_of>;
}

/** The `register` of a test server: what the default game-less `register` registers, then the matchmaker hooks of `hooks`. */
export function register_for(hooks: Hooks, calls: HookCall[], hold: { core: Core | null }): (core: unknown) => void {
  return (given) => {
    const core = given as Core;
    hold.core = core;
    const routing = routing_of(core);
    const validation = core['validation'] as unknown as { register_requirement_judge(type: number, judge: () => boolean): void };
    for (const [element, value] of Object.entries(GameData.RequirementType)) {
      if (element !== 'None') validation.register_requirement_judge(value, () => false);
    }
    for (const rpc of GameContract.RPCS) {
      routing.register_handler(rpc.name, () => new (rpc.response_class as new () => unknown)());
    }
    register_required_hooks(core, ['matchmaker.replay_match']);
    const blank = { ctx: null, user_id: 0n, mode_id: 0, user_ids: [], members: [], request: 0, record: null, index: -1, bytes: new Uint8Array(0), data: null, data_version: '', random: [] };
    const prepare = hooks.prepare;
    if (prepare !== undefined) {
      routing.register_hook('matchmaker', 'prepare_match_request', (ctx: RequestCtx, mode_id: number, user_ids: readonly bigint[]) => {
        calls.push({ ...blank, hook: 'prepare_match_request', ctx, user_id: ctx.user_id, mode_id, user_ids: [...user_ids] });
        return prepare(core, ctx, mode_id, user_ids);
      });
    }
    const validate = hooks.validate_party;
    if (validate !== undefined) {
      routing.register_hook('matchmaker', 'validate_party', (mode_id: number, members: readonly { user_id: bigint; rating: bigint }[], request: number) => {
        calls.push({ ...blank, hook: 'validate_party', mode_id, members: members.map((m) => ({ ...m })), request });
        return validate(mode_id, members, request);
      });
    }
    const apply_result = hooks.apply_result;
    if (apply_result !== undefined) {
      routing.register_hook('matchmaker', 'apply_match_result', (ctx: RequestCtx, record: MatchRecordInput, index: number, result: Uint8Array) => {
        calls.push({ ...blank, hook: 'apply_match_result', ctx, user_id: ctx.user_id, record, index, bytes: result, mode_id: record.mode_id });
        return apply_result(core, ctx, record, index, result);
      });
    }
    const apply_mismatch = hooks.apply_mismatch;
    if (apply_mismatch !== undefined) {
      routing.register_hook('matchmaker', 'apply_match_mismatch', (ctx: RequestCtx, record: MatchRecordInput, index: number) => {
        calls.push({ ...blank, hook: 'apply_match_mismatch', ctx, user_id: ctx.user_id, record, index, mode_id: record.mode_id });
        return apply_mismatch(core, ctx, record, index);
      });
    }
    const replay = hooks.replay === undefined ? (): 'reject' => 'reject' : hooks.replay;
    if (replay !== null) {
      const storage = core['storage'] as unknown as { random_u32(source: Random): number };
      routing.register_hook('matchmaker', 'replay_match', (record: MatchRecordInput, input_log: Uint8Array, random: Random, data: GameData.DataSet, data_version: string) => {
        const values = [0, 1, 2, 3].map(() => storage.random_u32(random));
        calls.push({ ...blank, hook: 'replay_match', record, bytes: input_log, data, data_version, random: values, mode_id: record.mode_id });
        return replay(record, input_log);
      });
    }
  };
}

/** The default hooks: both apply hooks recorded and passing. */
export const RECORDING: Hooks = { apply_result: () => 'pass', apply_mismatch: () => 'pass' };

/** A started matchmaker test server. */
export async function harness(options: Options = {}): Promise<Harness> {
  const calls: HookCall[] = [];
  const hold: { core: Core | null } = { core: null };
  const client_data_version = options.client_data_version ?? CLIENT_DATA_VERSION;
  const folder = data_folder({
    modes: options.modes ?? [],
    rating_rules: options.rating_rules ?? [],
    client_data_version,
    compat_client_data_version: options.compat_client_data_version ?? null,
  });
  const server = await start_test_server(
    options.environment === 'STG' ? undefined : START_AT,
    options.db,
    options.environment,
    options.matchmaker ?? true,
    undefined,
    { ...ROOMY, ...(options.settings ?? {}) },
    register_for(options.hooks ?? RECORDING, calls, hold),
    undefined,
    options.server_modules,
    folder,
  );
  running.push(server);
  return {
    server,
    calls,
    client_data_version,
    folder,
    core: () => {
      if (hold.core === null) throw new Error('register was not called');
      return hold.core;
    },
  };
}

/** `restart_test_server` of a harness; the harness then refers to the restarted test server. */
export async function restart(h: Harness): Promise<Harness> {
  const server = await restart_test_server(h.server);
  const at = running.indexOf(h.server);
  if (at >= 0) running[at] = server;
  return { ...h, server };
}

let accounts = 0;

export function player(h: Harness): Promise<TestSession> {
  accounts += 1;
  return login(h.server, `matchmaker_${String(accounts)}`);
}

export function frame(kind: CoreContract.MatchmakerFrameKind, fill: (f: Frame) => void = () => {}): Frame {
  const f = new CoreContract.MatchmakerFrame();
  f.kind = kind;
  fill(f);
  return f;
}

export function hello(session: TestSession, data_version: string, client_version = ''): Frame {
  return frame(K.MATCHMAKER_FRAME_KIND_HELLO, (f) => {
    f.access_token = session.access_token;
    f.data_version = data_version;
    f.client_version = client_version;
  });
}

const WAIT_MS = 5_000n;

/** The next frame of the kind, skipping other kinds; throws when the connection ends first. */
export async function next(conn: Conn, kind: CoreContract.MatchmakerFrameKind, ms = WAIT_MS): Promise<Frame> {
  for (;;) {
    const f = await read_frame(conn, ms);
    if (f === null) throw new Error(`connection ended before frame kind ${String(kind)}`);
    if (f.kind === kind) return f;
  }
}

/** The WebSocket close code and reason the server closed each connection with. */
const ws_closes = new WeakMap<Conn, { code: number; reason: string }>();

/** `connect` that keeps the WebSocket close code and reason of the connection for `close_code`. */
export async function connect(server: TestServer): Promise<Conn> {
  const conn = await connect_realtime(server);
  conn.socket.addEventListener('close', (event) => {
    ws_closes.set(conn, { code: event.code, reason: event.reason });
  }, { once: true });
  return conn;
}

/** The WebSocket close code and reason of a connection that ended, or null when it has not ended. */
export function ws_close(conn: Conn): { code: number; reason: string } | null {
  return ws_closes.get(conn) ?? null;
}

/**
 * Reads until the connection ends; returns the `CLOSE` code it sent, or null when it ended without one. A connection
 * that sent `CLOSE` must have closed with WebSocket close code 4000 and that code as the decimal reason, and one that
 * did not must not have closed with 4000; otherwise this throws.
 */
export async function close_code(conn: Conn, ms = WAIT_MS): Promise<number | null> {
  let code: number | null = null;
  for (;;) {
    const f = await read_frame(conn, ms);
    if (f === null) break;
    if (f.kind === K.MATCHMAKER_FRAME_KIND_CLOSE) code = f.code;
  }
  const closed = ws_close(conn);
  if (closed === null) throw new Error('the connection ended without a WebSocket close event');
  if (code === null ? closed.code === 4000 : closed.code !== 4000 || closed.reason !== String(code)) {
    throw new Error(`CLOSE ${String(code)} came with WebSocket close ${String(closed.code)} "${closed.reason}"`);
  }
  return code;
}

/** A connection that sent `HELLO` and got `HELLO_ACK`. */
export async function online(h: Harness, session: TestSession, data_version = h.client_data_version, client_version = ''): Promise<Conn> {
  const conn = await connect(h.server);
  send_frame(conn, hello(session, data_version, client_version));
  const f = await read_frame(conn, WAIT_MS);
  if (f?.kind !== K.MATCHMAKER_FRAME_KIND_HELLO_ACK) throw new Error(`HELLO got ${f === null ? 'a closed connection' : `kind ${String(f.kind)} code ${String(f.code)}`}`);
  return conn;
}

let barriers = 0;

/**
 * Waits until every frame sent before on this connection was handled: the frames of one connection are handled in
 * order, and a `MATCH_REJOIN` of a match that does not exist answers `MATCH_REJOINED` with its own `match_id` and
 * changes nothing.
 */
export async function barrier(conn: Conn): Promise<Frame[]> {
  barriers += 1;
  const match_id = `barrier-${String(barriers)}`;
  send_frame(conn, frame(K.MATCHMAKER_FRAME_KIND_MATCH_REJOIN, (f) => {
    f.match_id = match_id;
  }));
  const seen: Frame[] = [];
  for (;;) {
    const f = await read_frame(conn, WAIT_MS);
    if (f === null) throw new Error('connection ended before the barrier');
    if (f.kind === K.MATCHMAKER_FRAME_KIND_MATCH_REJOINED && f.match_id === match_id) return seen;
    seen.push(f);
  }
}

/** Sends a frame and returns the frames it caused on this connection. */
export function send_and_wait(conn: Conn, f: Frame): Promise<Frame[]> {
  send_frame(conn, f);
  return barrier(conn);
}

export function kinds(frames: readonly Frame[]): number[] {
  return frames.map((f) => f.kind);
}

export function match_request(mode_id: number, lockstep = false): Frame {
  return frame(K.MATCHMAKER_FRAME_KIND_MATCH_REQUEST, (f) => {
    f.mode_id = mode_id;
    f.lockstep = lockstep;
  });
}

export function room_frame(kind: CoreContract.MatchmakerFrameKind, fill: (f: Frame) => void = () => {}): Frame {
  return frame(kind, fill);
}

/** Waits for out-of-request applies and other background work of the test server. */
export function settled(h: Harness): Promise<void> {
  return wait_background(h.server);
}

/** Moves the test clock and waits for the jobs it started (`matchmaker_tick`, `matchmaker_sweep`, ...). */
export async function tick(h: Harness, ms = TICK_MS): Promise<void> {
  advance_time(h.server, ms);
  await wait_background(h.server);
}

/** A player online and in the queue of the mode. */
export interface Queued {
  readonly session: TestSession;
  readonly conn: Conn;
}

export async function queued(h: Harness, mode_id: number, session?: TestSession, data_version?: string, client_version = ''): Promise<Queued> {
  const s = session ?? (await player(h));
  const conn = await online(h, s, data_version ?? h.client_data_version, client_version);
  const caused = await send_and_wait(conn, match_request(mode_id));
  if (caused.length > 0) throw new Error(`MATCH_REQUEST got kind ${String(caused[0]?.kind)} reason ${String(caused[0]?.reason)}`);
  return { session: s, conn };
}

/** `n` players queued for the mode, a tick, and each one's `MATCH_FOUND`. */
export async function matched(h: Harness, mode_id: number, n: number): Promise<{ players: Queued[]; found: Frame[] }> {
  const players: Queued[] = [];
  for (let i = 0; i < n; i += 1) players.push(await queued(h, mode_id));
  await tick(h);
  const found = await Promise.all(players.map((p) => next(p.conn, K.MATCHMAKER_FRAME_KIND_MATCH_FOUND)));
  return { players, found };
}

export function result_bytes(winner: number, score = 10): Uint8Array {
  const r = new GameContract.MatchResult();
  r.winner = winner;
  r.score = score;
  return r.encode();
}

export function log_bytes(inputs: readonly number[]): Uint8Array {
  const l = new GameContract.MatchInputLog();
  l.inputs = [...inputs];
  return l.encode();
}

export interface Reported {
  readonly code: number;
  readonly status: CoreContract.MatchJudgeStatus | null;
}

export async function report(session: TestSession, match_id: string, result: Uint8Array = result_bytes(0), input_log: Uint8Array = new Uint8Array(0)): Promise<Reported> {
  const request = new CoreContract.ReportMatchResultRequest();
  request.match_id = match_id;
  request.result = result;
  request.input_log = input_log;
  const { envelope, response } = await send(session, 'core/ReportMatchResult', request);
  return { code: envelope.error?.code ?? 0, status: (response as CoreContract.ReportMatchResultResponse | null)?.status ?? null };
}

export async function admin(h: Harness, operation: string, body: Record<string, unknown>): Promise<void> {
  const out = await send_admin(h.server, operation, body);
  if (out.status !== 200) throw new Error(`${operation} answered ${String(out.status)}`);
}

export const ban = (h: Harness, user_id: bigint): Promise<void> => admin(h, 'ban_user', { user_id: String(user_id), until_at: '0', reason: 'test' });
export const maintenance = (h: Harness, enabled: boolean): Promise<void> => admin(h, 'set_maintenance', { enabled });
export const kill_switch = (h: Harness, enabled: boolean): Promise<void> => admin(h, 'set_kill_switch', { request_name: 'MATCH_REQUEST', enabled });

/**
 * Blocks writes to a table from another connection to the test server's DB until the returned release: a SQLite
 * `BEGIN IMMEDIATE` (every write waits), or a PostgreSQL `EXCLUSIVE` table lock (reads go on).
 */
export async function hold_writes(h: Harness, table: string): Promise<() => Promise<void>> {
  const database = h.server.shared.database;
  if (database.connection !== null) {
    const holder = await hold_db(h.server, [{ sql: `LOCK TABLE ${table} IN EXCLUSIVE MODE` }]);
    return () => holder.release();
  }
  const db = new DatabaseSync(database.db_argument);
  db.exec('BEGIN IMMEDIATE');
  return () => {
    db.exec('ROLLBACK');
    db.close();
    return Promise.resolve();
  };
}

/**
 * Holds the row lock a user transaction of the user waits for, from another connection to the PostgreSQL DB. Its
 * `pid` tells `until_blocked_by` which waiters are the ones behind this row.
 */
export function hold_user_row(h: Harness, user_id: bigint): Promise<Holder> {
  return hold_db(h.server, [{ sql: 'SELECT user_id FROM "user" WHERE user_id = $1 FOR UPDATE', params: [user_id] }]);
}

/**
 * The statement of a watcher thread that ends backend `$1` once a session waits for a lock of it. `pg_locks` and
 * `pg_blocking_pids` read the lock table live, unlike the per-transaction snapshot of `pg_stat_activity`.
 */
const END_AFTER_WAITER = `SELECT ogw_test_end_after_waiter(CAST($1 AS INT)) AS ended`;

/**
 * The function of `END_AFTER_WAITER`: once a session waits for a lock of backend `holder`, it ends that backend and
 * returns true when the backend has exited, which lets its locks go. False when no session waited in 20 s.
 */
const END_AFTER_WAITER_FUNCTION = `CREATE OR REPLACE FUNCTION ogw_test_end_after_waiter(holder int) RETURNS boolean LANGUAGE plpgsql AS $$
BEGIN
  FOR i IN 1..2000 LOOP
    IF EXISTS (SELECT 1 FROM pg_locks l WHERE NOT l.granted AND holder = ANY(pg_blocking_pids(l.pid))) THEN
      RETURN pg_terminate_backend(holder, 20000);
    END IF;
    PERFORM pg_sleep(0.01);
  END LOOP;
  RETURN false;
END $$`;

/** The `hold_lock_key` holders of `hold_until_waiter` that have not let go yet. */
const held: Holder[] = [];

/**
 * Holds the lock `storage.lock_game_row` takes for `table` and `key` (`testing`'s `game_row_lock_id`: a `game_state`
 * key is `[game state kind class, key]`) with `testing`'s `hold_lock_key`, and lets it go once a transaction waits for
 * it. A transaction of the test server waits for a row lock on the test's thread, which cannot release the holder then,
 * so a watcher on a thread of its own ends the holder's backend. `released` resolves once the backend has exited: then
 * the waiting transaction has the lock, and a transaction that locks the row after that runs after it. It rejects when
 * no transaction waited in time.
 */
export async function hold_until_waiter(server: TestServer, table: string, key: readonly unknown[]): Promise<{ released: Promise<void> }> {
  const connection = server.shared.database.connection;
  if (connection === null) throw new Error('this needs a PostgreSQL test server');
  const lock_id = game_row_lock_id(table, key);
  const watcher = await lock_holder({ kind: 'postgresql', db: 'postgresql', secrets: { db: connection } });
  await watcher.ok(END_AFTER_WAITER_FUNCTION);
  const holder = await hold_lock_key(server, lock_id);
  held.push(holder);
  // The statement is queued on the watcher thread now: the waiting transaction blocks the test's thread.
  const released = watcher.ok(END_AFTER_WAITER, [holder.pid]).then(async (rows) => {
    held.splice(held.indexOf(holder), 1);
    if (rows[0]?.['ended'] !== true) {
      await holder.release();
      const shown = key.map((v) => (typeof v === 'function' ? v.name : String(v)));
      throw new Error(`no transaction waited for the lock of ${table} ${JSON.stringify(shown)}`);
    }
    // The backend has ended, so the rollback of `release` fails; `release` still closes the connection.
    await holder.release().catch(() => undefined);
  });
  return { released };
}

/**
 * Closes the connection and reads it until it ends. The server sends its close frame after it handled the close, so
 * the queue, room and match session changes of the close are done by then; the participant change it started is a
 * transaction of its own that may still run.
 */
export async function close_and_wait(conn: Conn): Promise<void> {
  close(conn);
  while ((await read_frame(conn, WAIT_MS)) !== null) {
    // Frames the server sent before it handled the close.
  }
}

/** `left_at` and `disconnected_at` of each index of a match record, as committed. */
export function participants(h: Harness, match_id: string): { left_at: bigint; disconnected_at: bigint }[] {
  return storage_module(h.server)
    .read_db()
    .query('SELECT left_at, disconnected_at FROM matchmaker_participant WHERE match_id = $1 ORDER BY idx', [match_id])
    .map((r) => ({ left_at: r['left_at'] as bigint, disconnected_at: r['disconnected_at'] as bigint }));
}

/** Waits in real time until the condition holds. */
export async function until(condition: () => boolean): Promise<void> {
  for (let i = 0; i < 250; i += 1) {
    if (condition()) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error('the condition did not hold in time');
}

/** Waits in real time until the committed record of the match passes `check`. */
export function until_participants(h: Harness, match_id: string, check: (rows: { left_at: bigint; disconnected_at: bigint }[]) => boolean): Promise<void> {
  return until(() => check(participants(h, match_id)));
}

/**
 * Makes the DB refuse the write that marks index `idx` of the match applied by an apply that committed (the write that
 * does not count an attempt), so that apply transaction throws after its hook, as a DB or storage error would. The
 * write of `FAILED` attempts and of giving up goes through.
 */
export async function refuse_applied_write(h: Harness, match_id: string, idx: number): Promise<void> {
  if (!/^[0-9a-f-]+$/.test(match_id)) throw new Error(`match ID ${match_id} is not a UUID`);
  const when = `NEW.match_id = '${match_id}' AND NEW.idx = ${String(idx)} AND NEW.applied AND NOT OLD.applied AND NEW.attempts = OLD.attempts`;
  const database = h.server.shared.database;
  if (database.connection === null) {
    const db = new DatabaseSync(database.db_argument);
    try {
      db.exec(`CREATE TRIGGER refuse_applied BEFORE UPDATE ON matchmaker_participant WHEN ${when} BEGIN SELECT RAISE(ABORT, 'apply write refused'); END`);
    } finally {
      db.close();
    }
    return;
  }
  const conn = await open_pg_session(database.connection);
  try {
    await conn.query("CREATE FUNCTION refuse_applied() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'apply write refused'; END $$");
    await conn.query(`CREATE TRIGGER refuse_applied BEFORE UPDATE ON matchmaker_participant FOR EACH ROW WHEN (${when}) EXECUTE FUNCTION refuse_applied()`);
  } finally {
    conn.close();
  }
}

export function calls_of(h: Harness, hook: HookCall['hook']): HookCall[] {
  return h.calls.filter((c) => c.hook === hook);
}

export function bytes_equal(a: Uint8Array, b: Uint8Array): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

export { close, send_frame, read_frame, until_blocked_by };
