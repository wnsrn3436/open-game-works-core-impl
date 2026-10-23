/**
 * Test instances of `public-profile` with its dependencies made like a server instance makes them: `server-time`,
 * `storage`, `logging`, `item-ledger`, `validation` and `nickname`, started in dependency order, on SQLite or
 * PostgreSQL by the run's DB kind. `storage` takes the storage test contract, whose kinds include public kinds.
 */
import { randomUUID } from 'node:crypto';
import * as CoreContract from '../../../generated/contract/core_contract.ts';
import { create_item_ledger } from '../../item-ledger/index.ts';
import { create_logging } from '../../logging/index.ts';
import { create_nickname } from '../../nickname/index.ts';
import { create_server_time, type ServerTime } from '../../server-time/index.ts';
import { create_server_time_dev } from '../../server-time/dev/index.ts';
import { create_storage_with, type GameTx, type RequestCtx, type RequestFields, type Storage } from '../../storage/index.ts';
import { TestClock, core_settings, lock_holder, new_db, stop_all as stop_holders, test_server, type DbTarget, type LockHolder } from '../../storage/tests/helpers.ts';
import { TEST_CONTRACT } from '../../storage/tests/kinds.ts';
import { register_false_judges } from '../../testing/dev/index.ts';
import { create_validation } from '../../validation/index.ts';
import { ACTIVITY_TABLE, create_public_profile, type PublicProfile, type PublicProfileNickname } from '../index.ts';

export { DB_KIND } from '../../storage/tests/helpers.ts';

/** The first clock time of every instance here: a multiple of no granularity the tests use, 123456 ms into a minute. */
export const START = 1_800_000_123_456n;

const MODULES = ['item-ledger', 'logging', 'nickname', 'public-profile', 'server-time', 'storage', 'validation'];

/** The `nickname.get_nicknames` and `SetNickname` members the tests call. */
interface NicknameModule {
  get_nicknames: PublicProfileNickname['get_nicknames'];
  SetNickname(ctx: RequestCtx, request: CoreContract.SetNicknameRequest): unknown;
  begin_start(): void;
  complete_start(): string | null;
  stop(): void;
}

interface Lifecycle {
  begin_start(): void;
  complete_start(): string | null;
  stop(): void;
}

export interface Instance {
  readonly db: DbTarget;
  readonly clock: TestClock;
  readonly time: ServerTime;
  readonly storage: Storage;
  readonly nickname: NicknameModule;
  readonly profile: PublicProfile;
  /** The server log lines of the instance, parsed. */
  logs(kind?: string): Record<string, unknown>[];
}

const running: (() => void)[] = [];

/** Starts the modules with core settings and game settings overrides. Throws when server start fails. */
export async function start(settings: Readonly<Record<string, unknown>> = {}): Promise<Instance> {
  const db = await new_db();
  const clock = new TestClock(START);
  const lines: string[] = [];
  const merged: Record<string, unknown> = {
    ...core_settings(),
    dailyResetOffsetMs: 0,
    nicknameUnique: false,
    supportedLanguages: ['en'],
    'consent.privacyChoices': false,
    'environments.<ENV>.adapters.analytics': null,
    ...settings,
  };
  const server = test_server(db, { server_modules: MODULES, write_log_line: (line) => lines.push(line) });
  const time = create_server_time({ settings: merged, modules: {} });
  create_server_time_dev(time).set_clock(clock);
  const storage = create_storage_with({ settings: merged, modules: { 'server-time': time }, server }, TEST_CONTRACT);
  const logging = create_logging({ settings: merged, modules: { storage, 'server-time': time }, server });
  const item_ledger = create_item_ledger({ settings: merged, modules: { storage, 'server-time': time, logging }, server }) as unknown as Lifecycle;
  const validation = create_validation({ settings: merged, modules: { storage, 'item-ledger': item_ledger }, server }) as unknown as Lifecycle;
  const nickname = create_nickname({
    settings: merged,
    modules: { 'item-ledger': item_ledger, validation, storage, 'server-time': time, logging },
    server,
  }) as unknown as NicknameModule;
  const profile = create_public_profile({ settings: merged, modules: { storage, nickname, logging, 'server-time': time }, server });
  const modules: Lifecycle[] = [time, storage, logging, item_ledger, validation, nickname, profile];
  for (const module of modules) module.begin_start();
  register_false_judges({ validation });
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
  const logs = (kind?: string): Record<string, unknown>[] =>
    lines.map((line) => JSON.parse(line) as Record<string, unknown>).filter((line) => kind === undefined || line.kind === kind);
  return { db, clock, time, storage, nickname, profile, logs };
}

export function stop_all(): void {
  for (const stop of running.splice(0)) stop();
  stop_holders();
}

/** Request fields of a request named `name` with a new request ID. */
export function fields(name: string): RequestFields {
  return { request_name: name, request_id: randomUUID(), silent: false, retry: false, session_id: '', client_version: '', platform: '' };
}

/** Runs one request transaction of `user_id`; throws when it is `FAILED` or `WITHDRAWN`. A throw of `fn` rolls back and throws. */
export async function request<T>(instance: Instance, user_id: bigint, name: string, fn: (ctx: RequestCtx) => T): Promise<T> {
  const result = await instance.storage.run_request_transaction(user_id, fields(name), fn);
  if (result === 'FAILED' || result === 'WITHDRAWN') throw new Error(`request ${name}: ${String(result)}`);
  return result;
}

export async function new_user(instance: Instance): Promise<bigint> {
  const user = await instance.storage.run_game_transaction((tx: GameTx) => instance.storage.create_user(tx));
  if (user === 'FAILED') throw new Error('create_user: FAILED');
  return user;
}

/** What a withdrawal does to the stored state of the user: `storage.delete_user` in one of its transactions. */
export async function withdraw(instance: Instance, user_id: bigint): Promise<void> {
  await request(instance, user_id, 'core/Withdraw', (ctx) => {
    instance.storage.delete_user(ctx);
  });
}

/** `SetNickname` of `user_id`; throws when it does not succeed. */
export async function set_nickname(instance: Instance, user_id: bigint, nickname: string): Promise<void> {
  const message = new CoreContract.SetNicknameRequest();
  message.nickname = nickname;
  const response = await request(instance, user_id, 'core/SetNickname', (ctx) => instance.nickname.SetNickname(ctx, message));
  if (!(response instanceof CoreContract.SetNicknameResponse)) throw new Error(`SetNickname ${nickname}: ${String(response)}`);
}

/** `GetPublicProfiles` of `user_id` in its own request transaction. */
export function get_profiles(instance: Instance, user_id: bigint, user_ids: readonly bigint[]): Promise<CoreContract.GetPublicProfilesResponse | number> {
  const message = new CoreContract.GetPublicProfilesRequest();
  message.user_ids = [...user_ids];
  return request(instance, user_id, 'core/GetPublicProfiles', (ctx) => instance.profile.GetPublicProfiles(ctx, message));
}

/** The committed `last_active_at` of a user, or null when there is no row. */
export function stored_last_active(instance: Instance, user_id: bigint): bigint | null {
  const row = instance.storage.read_db().query(`SELECT last_active_at FROM ${ACTIVITY_TABLE} WHERE user_id = $1`, [user_id])[0];
  return row === undefined ? null : (row.last_active_at as bigint);
}

/** Another connection that holds the user lock of `user_id` until it ends its transaction. */
export interface UserLock {
  /** Runs one statement in the holder's transaction; throws when it fails. */
  query(sql: string, params: readonly bigint[]): Promise<void>;
  /** Commits the holder's transaction after `delay_ms`, while the caller may wait for the lock. Throws when it fails. */
  commit_after(delay_ms: number): Promise<void>;
  /** Rolls back the holder's transaction. */
  release(): Promise<void>;
}

export async function hold_user_lock(instance: Instance, user_id: bigint, postgresql: boolean): Promise<UserLock> {
  const holder: LockHolder = await lock_holder(instance.db);
  if (postgresql) {
    await holder.ok('BEGIN');
    await holder.ok('SELECT user_id FROM "user" WHERE user_id = $1 FOR UPDATE', [user_id]);
  } else {
    await holder.ok('BEGIN IMMEDIATE');
  }
  return {
    query: async (sql, params) => {
      await holder.ok(sql, params);
    },
    commit_after: async (delay_ms) => {
      const result = await holder.run('COMMIT', [], delay_ms);
      if (!result.ok) throw new Error(`holder COMMIT failed: ${result.code}`);
    },
    release: async () => {
      await holder.ok('ROLLBACK');
    },
  };
}
