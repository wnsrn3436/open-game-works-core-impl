/**
 * Test servers of `play-session` with content hooks a test sets per server, and the three core `rpc`s sent through
 * the test helper. Every hook call is recorded with the record it received.
 *
 * The core test data has no `play_session_mode` row with continues: such a row would stop every test server of the
 * other modules from starting without `continue_play_session`. A test server here runs on a copy of the server
 * build data whose `play_session_mode` rows the test gives.
 */
import { cpSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as CoreContract from '../../../generated/contract/core_contract.ts';
import * as GameContract from '../../../generated/contract/game_contract.ts';
import * as GameData from '../../../generated/data/game_data.ts';
import { core_test_server_paths, load_data, login, register_required_hooks, restart_test_server, send, start_test_server, stop_test_server, type TestServer, type TestSession } from '../../testing/dev/index.ts';
import type { ApplyHook, ContinueHook, PlaySessionRecord, PrepareHook, VerifyHook } from '../index.ts';
import type { RequestCtx } from '../../storage/index.ts';

export const START_AT = 1_800_000_000_000n;
/** `play_session_mode` rows of the core test data. */
export const TIMED = '[play_session_timed]';
export const INSTANT = '[play_session_instant]';
/** The `max_continue_count` of `[play_session_timed]` in the server build data of `harness`. */
export const CONTINUES = 2;
/** An item row of the core test data (`item-ledger`'s rows), `Reject` overflow. */
export const GOLD = '[gold]';

export const CoreError = CoreContract.CoreError;
/** The `GameError` the test hooks return. */
export const GAME_ERROR = GameContract.GameError.GAME_ERROR_CORE_TEST;

/** The `register(core)` argument: module objects (or their `content` member) by module name. */
export type Core = Readonly<Record<string, Record<string, (...args: never[]) => unknown>>>;

/** One recorded hook call. */
export interface HookCall {
  readonly hook: 'prepare_play_session' | 'continue_play_session' | 'verify_play_session' | 'apply_play_session';
  readonly ctx: RequestCtx;
  readonly record: PlaySessionRecord | null;
  readonly bytes: Uint8Array;
  readonly mode_id: number;
  readonly level_id: number;
}

/**
 * Hook behavior of one test server; `null` leaves the hook unregistered. Each function receives `core` so that it
 * can call core operations the way content code does.
 */
export interface Hooks {
  prepare?: ((core: Core, ctx: RequestCtx, mode_id: number, level_id: number, options: Uint8Array) => Uint8Array | number) | null;
  continue?: ((core: Core, ctx: RequestCtx, record: PlaySessionRecord, options: Uint8Array) => 'pass' | number) | null;
  verify?: ((core: Core, ctx: RequestCtx, record: PlaySessionRecord, result: Uint8Array) => 'pass' | 'reject') | null;
  apply?: ((core: Core, ctx: RequestCtx, record: PlaySessionRecord, result: Uint8Array) => 'pass' | number) | null;
}

export interface Harness {
  readonly server: TestServer;
  readonly calls: HookCall[];
  /** The ID value of an ID name of the core test data. */
  id(name: string): number;
  /** The core test data; `harness` runs on a copy whose `play_session_mode` rows the test gave. */
  readonly data: GameData.DataSet;
  core(): Core;
}

const running: TestServer[] = [];
const folders: string[] = [];

export async function stop_all(): Promise<void> {
  for (const server of running.splice(0)) await stop_test_server(server);
  for (const folder of folders.splice(0)) rmSync(folder, { recursive: true, force: true });
}

/** A `play_session_mode` row of a server build data folder this file writes. */
export interface ModeRow {
  readonly id: number;
  readonly min_duration: bigint;
  readonly max_duration: bigint;
  readonly max_continue_count: number;
}

function varint(out: number[], value: bigint): void {
  let v = BigInt.asUintN(64, value);
  while (v >= 0x80n) {
    out.push(Number(v & 0x7fn) | 0x80);
    v >>= 7n;
  }
  out.push(Number(v));
}

/** `play_session_mode.bin`: the `PlaySessionModeTable` message of the data proto with these rows. */
function encode_modes(rows: readonly ModeRow[]): Uint8Array {
  const out: number[] = [];
  for (const row of rows) {
    const fields: number[] = [];
    for (const [number, value] of [[1, BigInt(row.id)], [2, row.min_duration], [3, row.max_duration], [4, BigInt(row.max_continue_count)]] as const) {
      fields.push(number << 3);
      varint(fields, value);
    }
    out.push((1 << 3) | 2);
    varint(out, BigInt(fields.length));
    out.push(...fields);
  }
  return new Uint8Array(out);
}

/** The `play_session_mode` rows of the core test data, with `[play_session_timed]` at `CONTINUES` continues. */
export function default_modes(): ModeRow[] {
  const { data, dev } = load_data();
  const timed = dev.find_id_value(TIMED);
  return data.PlaySessionModeTable.all_rows().map((row) => ({
    id: row.id,
    min_duration: row.min_duration,
    max_duration: row.max_duration,
    max_continue_count: row.id === timed ? CONTINUES : row.max_continue_count,
  }));
}

/** A copy of the server build data folder of the test run whose `play_session_mode` rows are `rows`; removed by `stop_all`. */
export function data_with_modes(rows: readonly ModeRow[]): string {
  const source = core_test_server_paths().data_folder;
  const folder = mkdtempSync(join(tmpdir(), 'play-session-data-'));
  folders.push(folder);
  cpSync(source, folder, { recursive: true });
  writeFileSync(join(folder, 'play_session_mode.bin'), encode_modes(rows));
  return folder;
}

/** The `register` of a test server: the requirement judges every core test registers, then the play-session hooks. */
export function register_for(hooks: Hooks, calls: HookCall[], hold: { core: Core | null }): (core: unknown) => void {
  return (given) => {
    const core = given as Core;
    hold.core = core;
    const routing = core['routing'] as unknown as { register_hook(module: string, hook: string, fn: unknown): void; register_handler(name: string, fn: unknown): void };
    for (const info of GameContract.RPCS) routing.register_handler(info.name, () => new info.response_class());
    const validation = core['validation'] as unknown as { register_requirement_judge(type: number, judge: () => boolean): void };
    for (const [element, value] of Object.entries(GameData.RequirementType)) {
      if (element !== 'None') validation.register_requirement_judge(value, () => false);
    }
    register_required_hooks(core, ['play-session.continue_play_session']);
    const prepare = hooks.prepare === undefined ? (): Uint8Array => new Uint8Array(0) : hooks.prepare;
    if (prepare !== null) {
      const hook: PrepareHook = (ctx, mode_id, level_id, options) => {
        calls.push({ hook: 'prepare_play_session', ctx, record: null, bytes: options, mode_id, level_id });
        return prepare(core, ctx, mode_id, level_id, options) as Uint8Array | GameContract.GameError;
      };
      routing.register_hook('play-session', 'prepare_play_session', hook);
    }
    const cont = hooks.continue === undefined ? (): 'pass' => 'pass' : hooks.continue;
    if (cont !== null) {
      const hook: ContinueHook = (ctx, record, options) => {
        calls.push({ hook: 'continue_play_session', ctx, record, bytes: options, mode_id: record.mode_id, level_id: record.level_id });
        return cont(core, ctx, record, options) as 'pass' | GameContract.GameError;
      };
      routing.register_hook('play-session', 'continue_play_session', hook);
    }
    const verify = hooks.verify === undefined ? (): 'pass' => 'pass' : hooks.verify;
    if (verify !== null) {
      const hook: VerifyHook = (ctx, record, result) => {
        calls.push({ hook: 'verify_play_session', ctx, record, bytes: result, mode_id: record.mode_id, level_id: record.level_id });
        return verify(core, ctx, record, result);
      };
      routing.register_hook('play-session', 'verify_play_session', hook);
    }
    const apply = hooks.apply === undefined ? (): 'pass' => 'pass' : hooks.apply;
    if (apply !== null) {
      const hook: ApplyHook = (ctx, record, result) => {
        calls.push({ hook: 'apply_play_session', ctx, record, bytes: result, mode_id: record.mode_id, level_id: record.level_id });
        return apply(core, ctx, record, result) as 'pass' | GameContract.GameError;
      };
      routing.register_hook('play-session', 'apply_play_session', hook);
    }
  };
}

/**
 * A started test server whose hooks are `hooks` (hooks not given pass and change nothing) on the server build data
 * with the `play_session_mode` rows `modes`.
 */
export async function harness(hooks: Hooks = {}, settings?: Readonly<Record<string, unknown>>, modes: readonly ModeRow[] = default_modes()): Promise<Harness> {
  const calls: HookCall[] = [];
  const hold: { core: Core | null } = { core: null };
  const register = register_for(hooks, calls, hold);
  const server = await start_test_server(START_AT, undefined, undefined, undefined, undefined, settings, register, undefined, undefined, data_with_modes(modes));
  running.push(server);
  const loaded = load_data();
  return {
    server,
    calls,
    data: loaded.data,
    id: (name) => loaded.dev.find_id_value(name),
    core: () => {
      if (hold.core === null) throw new Error('register was not called');
      return hold.core;
    },
  };
}

/**
 * Restarts the test server on the same DB with the server build data `folder`. `restart_test_server` keeps the server
 * build data folder of `start_test_server`, so this swaps the folder it reads first.
 */
export async function restart_with_data(h: Harness, folder: string): Promise<void> {
  Reflect.set(h.server, 'shared', { ...h.server.shared, data_folder: folder });
  await restart_test_server(h.server);
}

let accounts = 0;

export async function player(h: Harness): Promise<TestSession> {
  accounts += 1;
  return login(h.server, `play_session_${String(accounts)}`);
}

/** The `CoreError` or `GameError` code of an error envelope; 0 for success. */
export function code_of(envelope: CoreContract.ResponseEnvelope): number {
  return envelope.error?.code ?? 0;
}

export interface Sent<T> {
  readonly envelope: CoreContract.ResponseEnvelope;
  readonly response: T | null;
  readonly code: number;
}

async function sent<T>(promise: Promise<{ envelope: CoreContract.ResponseEnvelope; response: unknown }>): Promise<Sent<T>> {
  const { envelope, response } = await promise;
  return { envelope, response: response as T | null, code: code_of(envelope) };
}

export function start_options(booster_count: number): Uint8Array {
  const options = new GameContract.PlaySessionStartOptions();
  options.booster_count = booster_count;
  return options.encode();
}

export function continue_options(moves: number): Uint8Array {
  const options = new GameContract.PlaySessionContinueOptions();
  options.moves = moves;
  return options.encode();
}

export function result_bytes(score: number, inputs: readonly number[] = []): Uint8Array {
  const result = new GameContract.PlaySessionResult();
  result.score = score;
  result.inputs = [...inputs];
  return result.encode();
}

export function loadout_bytes(seed: bigint, note: string): Uint8Array {
  const loadout = new GameContract.PlaySessionLoadout();
  loadout.seed = seed;
  loadout.note = note;
  return loadout.encode();
}

export function start(
  session: TestSession,
  mode_id: number,
  options: Uint8Array = new Uint8Array(0),
  level_id = 0,
  request_id?: string,
): Promise<Sent<CoreContract.StartPlaySessionResponse>> {
  const request = new CoreContract.StartPlaySessionRequest();
  request.mode_id = mode_id;
  request.level_id = level_id;
  request.options = options;
  return sent(send(session, 'core/StartPlaySession', request, request_id));
}

export function continue_session(
  session: TestSession,
  play_session_id: string,
  options: Uint8Array = continue_options(1),
  request_id?: string,
): Promise<Sent<CoreContract.ContinuePlaySessionResponse>> {
  const request = new CoreContract.ContinuePlaySessionRequest();
  request.play_session_id = play_session_id;
  request.options = options;
  return sent(send(session, 'core/ContinuePlaySession', request, request_id));
}

export function finish(
  session: TestSession,
  play_session_id: string,
  result: Uint8Array = result_bytes(10),
  request_id?: string,
): Promise<Sent<CoreContract.FinishPlaySessionResponse>> {
  const request = new CoreContract.FinishPlaySessionRequest();
  request.play_session_id = play_session_id;
  request.result = result;
  return sent(send(session, 'core/FinishPlaySession', request, request_id));
}

/** A started play session; throws when the start fails. */
export async function opened(session: TestSession, mode_id: number, options?: Uint8Array): Promise<CoreContract.StartPlaySessionResponse> {
  const out = await start(session, mode_id, options);
  if (out.response === null) throw new Error(`StartPlaySession failed with ${String(out.code)}`);
  return out.response;
}

export function hook_calls(h: Harness, hook: HookCall['hook']): HookCall[] {
  return h.calls.filter((c) => c.hook === hook);
}

/** The `play-session` module object as content code sees it. */
export function play_session(core: Core): {
  get_active_play_session(ctx: RequestCtx): PlaySessionRecord | null;
  refund_entry(ctx: RequestCtx, record: PlaySessionRecord, items: readonly CoreContract.ItemAmount[]): unknown;
} {
  return core['play-session'] as unknown as ReturnType<typeof play_session>;
}

/** The `item-ledger` operations content code calls. */
export function item_ledger(core: Core): {
  add_items(ctx: RequestCtx, items: readonly CoreContract.ItemAmount[], source: Record<string, string>): string | number;
  subtract_items(ctx: RequestCtx, items: readonly CoreContract.ItemAmount[], source: Record<string, string>): string | number;
  get_balance(ctx: RequestCtx, item_id: number): bigint;
} {
  return core['item-ledger'] as unknown as ReturnType<typeof item_ledger>;
}

export function amount(item_id: number, value: bigint): CoreContract.ItemAmount {
  const item = new CoreContract.ItemAmount();
  item.item_id = item_id;
  item.amount = value;
  return item;
}

export function new_request_id(): string {
  return crypto.randomUUID();
}

export function bytes_equal(a: Uint8Array, b: Uint8Array): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

/** The envelope bytes with `server_time_at` cleared, to compare every other field. */
export function without_server_time(envelope: CoreContract.ResponseEnvelope): Uint8Array {
  const copy = CoreContract.ResponseEnvelope.decode(envelope.encode());
  if (copy === null) throw new Error('not a ResponseEnvelope');
  copy.server_time_at = 0n;
  return copy.encode();
}
