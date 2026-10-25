/**
 * Test instances of `session` with its dependencies `server-time` and `storage`, started in dependency order like a
 * server instance, on SQLite or PostgreSQL by the run's DB kind.
 */
import { randomUUID } from 'node:crypto';
import { create_server_time, type ServerTime } from '../../server-time/index.ts';
import { create_server_time_dev } from '../../server-time/dev/index.ts';
import { create_storage, type RequestCtx, type RequestFields, type Storage } from '../../storage/index.ts';
import { core_settings, new_db, test_server, TestClock } from '../../storage/tests/helpers.ts';
import { create_session, sign_request, type Session, type SessionStart } from '../index.ts';

/** The session record table, as `session` registers it. */
export const SESSION_TABLE = 'session_current';

/** The first clock time of every instance here. */
export const START = 1_800_000_000_000n;

export interface Instance {
  readonly storage: Storage;
  readonly time: ServerTime;
  readonly session: Session;
  readonly clock: TestClock;
  /** The cheat time offset of each user, read by the DEV offset provider. */
  readonly offsets: Map<bigint, bigint>;
}

const running: (() => void)[] = [];

/** Starts `server-time`, `storage` and `session` with core settings overrides. Throws when server start fails. */
export async function start(settings: Readonly<Record<string, unknown>> = {}): Promise<Instance> {
  const target = await new_db();
  const clock = new TestClock(START);
  const offsets = new Map<bigint, bigint>();
  const merged = { ...core_settings(), dailyResetOffsetMs: 0, ...settings };
  const time = create_server_time({ settings: merged, modules: {} });
  const time_dev = create_server_time_dev(time);
  time_dev.set_clock(clock);
  time_dev.register_offset_provider((user_id) => offsets.get(user_id) ?? 0n);
  const server = test_server(target, { server_modules: ['server-time', 'storage', 'session'] });
  const storage = create_storage({ settings: merged, modules: { 'server-time': time }, server });
  const session = create_session({ settings: merged, modules: { storage, 'server-time': time }, server });
  const modules = [time, storage, session];
  for (const module of modules) module.begin_start();
  const failure = modules.map((module) => module.complete_start()).find((reason) => reason !== null) ?? null;
  const stop = (): void => {
    for (const module of [...modules].reverse()) module.stop();
  };
  if (failure !== null) {
    stop();
    throw new Error(`server start failed: ${failure}`);
  }
  // Server start ends: every job runs once.
  time.end_start();
  running.push(stop);
  return { storage, time, session, clock, offsets };
}

export function stop_all(): void {
  for (const stop of running.splice(0)) stop();
}

/** Request fields of a request named `name` with a new request ID. */
export function fields(name: string, session_id = ''): RequestFields {
  return { request_name: name, request_id: randomUUID(), silent: false, retry: false, session_id, client_version: '', platform: '' };
}

/** Runs one request transaction; throws when it is `FAILED` or `WITHDRAWN`. */
export async function request<T>(storage: Storage, user_id: bigint, name: string, fn: (ctx: RequestCtx) => T): Promise<T> {
  const result = await storage.run_request_transaction(user_id, fields(name), fn);
  if (result === 'FAILED' || result === 'WITHDRAWN') throw new Error(`request ${name}: ${String(result)}`);
  return result;
}

export async function new_user(storage: Storage): Promise<bigint> {
  const user = await storage.run_game_transaction((tx) => storage.create_user(tx).user_id);
  if (user === 'FAILED') throw new Error('create_user: FAILED');
  return user;
}

/** What a login does to session: `start_session` in the login's request transaction. */
export function login(instance: Instance, user_id: bigint): Promise<SessionStart> {
  return request(instance.storage, user_id, 'core/Login', (ctx) => instance.session.start_session(ctx));
}

export interface Signed {
  readonly name: string;
  readonly request_id: string;
  readonly timestamp: string;
  readonly signature: string;
  readonly body: Uint8Array;
}

/** A request signed like the client signs it: name, request ID, timestamp and body. */
export function signed(signing_key: string, name: string, timestamp: bigint, body: Uint8Array = new Uint8Array([0x08, 0x01])): Signed {
  const request = { name, request_id: randomUUID(), timestamp: String(timestamp), body };
  return { ...request, signature: sign_request(signing_key, request.name, request.request_id, request.timestamp, request.body) };
}

/** `verify_signature` of a signed request whose access token holds `session_id`. */
export function verify(instance: Instance, user_id: bigint, session_id: string, request: Signed): ReturnType<Session['verify_signature']> {
  return instance.session.verify_signature(user_id, session_id, request.name, request.request_id, request.timestamp, request.signature, request.body);
}
