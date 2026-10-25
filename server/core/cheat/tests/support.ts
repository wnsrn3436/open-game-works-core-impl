/**
 * Test instances of `cheat` with its dependencies `server-time` and `storage`, on the DB of the run's DB kind, for
 * the module's own operations: `run_cheat` calls a cheat handler of `list_cheat_handlers` in a request transaction.
 * What the `routing` DEV code does with a cheat request (dev access, authentication, the user counter, the `audit`
 * line, the change source, `server_time_at`) is tested over a test server of `testing` (`served.ts`). Dependencies
 * are not faked.
 */
import { randomBytes } from 'node:crypto';
import * as CoreContract from '../../../generated/contract/core_contract.ts';
import * as CoreCheatContract from '../../../dev/generated/contract/core_cheat_contract.ts';
import { create_server_time, type ServerTime } from '../../server-time/index.ts';
import { create_server_time_dev } from '../../server-time/dev/index.ts';
import { create_storage_with, type GameTx, type Storage } from '../../storage/index.ts';
import type { ResponseDelta } from '../../storage/delta.ts';
import { TestClock, core_settings, new_db, test_server } from '../../storage/tests/helpers.ts';
import { create_cheat_with, type Cheat } from '../dev/index.ts';
import { GAME_KINDS, STORAGE_CONTRACT } from './kinds.ts';

export const CODE = CoreContract.CoreError;
export const START_AT = 1_800_000_000_000n;
export const DAY = 86_400_000n;

type Message = { encode(): Uint8Array };

/** A `service Cheat` rpc of the test game contract. Its messages are core cheat message classes. */
export function content_rpc(name: string): CoreContract.RpcInfo {
  const base = CoreCheatContract.RPCS.find((r) => r.name === 'core/cheat/SetTimeOffset');
  if (base === undefined) throw new Error('base proto has no core/cheat/SetTimeOffset');
  return { ...base, name: `cheat/${name}`, validate: null };
}

/** The `core` object of `registerDev`: each module object by module name. */
export interface Core {
  readonly cheat: Cheat;
  readonly storage: Storage;
  readonly 'server-time': ServerTime;
}

export interface Options {
  /** The `service Cheat` rpcs of the test game contract. */
  readonly rpcs?: readonly CoreContract.RpcInfo[];
  readonly register_dev?: (core: Core) => void;
}

export interface Server {
  readonly clock: TestClock;
  readonly time: ServerTime;
  readonly storage: Storage;
  readonly cheat: Cheat;
  stop(): void;
}

/** Starts `server-time`, `storage` and `cheat` in dependency order, or returns the server start failure reason. */
export async function start_server(options: Options = {}): Promise<Server | string> {
  const db = await new_db();
  const settings = { ...core_settings(), dailyResetOffsetMs: 0 };
  const clock = new TestClock(START_AT);
  const time = create_server_time({ settings, modules: {} });
  create_server_time_dev(time).set_clock(clock);
  const input_server = test_server(db, { env: 'LOCAL', dev: true, server_modules: ['server-time', 'storage', 'cheat'] });
  const storage = create_storage_with({ settings, modules: { 'server-time': time }, server: input_server }, STORAGE_CONTRACT);
  const cheat = create_cheat_with({ settings, modules: { storage, 'server-time': time }, server: input_server }, { game_kinds: GAME_KINDS, core_kinds: CoreContract.KINDS, game_cheat_rpcs: options.rpcs ?? [] });
  const modules = [time, storage, cheat];
  for (const module of modules) module.begin_start();
  options.register_dev?.({ cheat, storage, 'server-time': time });
  let failure: string | null = null;
  for (const module of modules) {
    failure = module.complete_start();
    if (failure !== null) break;
  }
  const stop = (): void => {
    for (const module of [...modules].reverse()) module.stop();
  };
  if (failure !== null) {
    stop();
    return failure;
  }
  // Server start ends: every job runs once.
  time.end_start();
  const server: Server = { clock, time, storage, cheat, stop };
  running.push(server);
  return server;
}

const running: Server[] = [];

export async function server(options: Options = {}): Promise<Server> {
  const started = await start_server(options);
  if (typeof started === 'string') throw new Error(`server start failed: ${started}`);
  return started;
}

export function stop_all(): void {
  for (const s of running.splice(0)) s.stop();
}

/** A new user. */
export async function new_user(s: Server): Promise<bigint> {
  const created = await s.storage.run_game_transaction((tx: GameTx) => s.storage.create_user(tx).user_id);
  if (created === 'FAILED') throw new Error('create_user failed');
  return created;
}

export interface Answer {
  readonly code: number;
  readonly response: Message | null;
  readonly delta: ResponseDelta | null;
}

const FIELDS = { request_id: '', silent: false, retry: false, session_id: 's-1', client_version: '1.0.0', platform: 'linux' };

function request_fields(request_name: string): typeof FIELDS & { request_name: string } {
  return { ...FIELDS, request_name, request_id: randomBytes(8).toString('hex') };
}

/** The cheat handler of `request_name` from `list_cheat_handlers`, called in a request transaction of the user. */
export async function run_cheat(s: Server, user_id: bigint, request_name: string, request: Message): Promise<Answer> {
  const entry = s.cheat.list_cheat_handlers().find((e) => e.request_name === request_name);
  if (entry === undefined) throw new Error(`no cheat handler of ${request_name}`);
  const result = await s.storage.run_request_transaction(user_id, request_fields(request_name), (ctx): { response: Message; delta: ResponseDelta } | number => {
    const out = entry.handler(ctx, request as never);
    if (typeof out === 'number') return out;
    return { response: out, delta: s.storage.take_response_delta(ctx).delta };
  });
  if (typeof result === 'string') return { code: CODE.CORE_ERROR_INTERNAL, response: null, delta: null };
  if (typeof result === 'number') return { code: result, response: null, delta: null };
  return { code: 0, ...result };
}

/** The request time of the user's next request. */
export async function request_time(s: Server, user_id: bigint): Promise<bigint> {
  const result = await s.storage.run_request_transaction(user_id, request_fields('test/Ping'), (ctx) => ctx.request_time);
  if (typeof result === 'string') throw new Error(`test/Ping failed: ${result}`);
  return result;
}

/** The stored UserState of the user as `[kind, id, json]`, read in a rollback transaction. */
export async function stored(s: Server, user_id: bigint): Promise<[string, bigint, unknown][]> {
  const result = await s.storage.run_rollback_transaction(user_id, (ctx) => {
    const out: [string, bigint, unknown][] = [];
    for (const kind of GAME_KINDS.filter((k) => k.store === 'user_state')) {
      const single = kind.is_list ? null : s.storage.get_state(ctx, kind.kind_class, 0n);
      const values = kind.is_list ? s.storage.list_state(ctx, kind.kind_class) : single === null ? [] : [single];
      for (const value of values) {
        out.push([kind.name, kind.is_list ? (value as unknown as { id: bigint }).id : 0n, (value as unknown as { to_json(): unknown }).to_json()]);
      }
    }
    return out;
  });
  if (typeof result === 'string') throw new Error(`read failed: ${result}`);
  return result;
}

/** The stored cheat time offset of a user. */
export function stored_offset(s: Server, user_id: bigint): bigint {
  return s.cheat.get_time_offset(user_id, s.storage.read_db());
}

export function set_time_offset(offset_ms: bigint): CoreCheatContract.SetTimeOffsetRequest {
  const request = new CoreCheatContract.SetTimeOffsetRequest();
  request.offset_ms = offset_ms;
  return request;
}

export function set_user_state(kind: string, item_id: bigint, value_json: string): CoreCheatContract.SetUserStateRequest {
  const request = new CoreCheatContract.SetUserStateRequest();
  request.kind = kind;
  request.item_id = item_id;
  request.value_json = value_json;
  return request;
}

export function delete_user_state(kind: string, item_id: bigint): CoreCheatContract.DeleteUserStateRequest {
  const request = new CoreCheatContract.DeleteUserStateRequest();
  request.kind = kind;
  request.item_id = item_id;
  return request;
}
