import { AsyncLocalStorage } from 'node:async_hooks';
import * as CoreContract from '../../generated/contract/core_contract.ts';
import * as GameContract from '../../generated/contract/game_contract.ts';
import type * as GameData from '../../generated/data/game_data.ts';
import type { PgLimits } from './db/pg_messages.ts';
import { PostgresAdapter } from './db/postgres.ts';
import { SqliteAdapter } from './db/sqlite.ts';
import { DbError, type DbAdapter } from './db/types.ts';
import {
  read_settings,
  type DbHandle,
  type FailureCode,
  type GameTx,
  type ItemConverter,
  type Pass,
  type StorageCore,
  type StorageSettings,
  type TimeSource,
  type TxState,
  type UserChangeApply,
  type UserChangeFail,
} from './core.ts';
import { read_full_state, take_response_delta, type FullStateResult, type TakenDelta } from './delta.ts';
import { KindRegistry, type KindClass, type KindValue, type StorageContract } from './kinds.ts';
import { create_random_instance, random_api, type RandomSource } from './random_ops.ts';
import type { Random } from './random.ts';
import type { RequestCtx } from './request_ctx.ts';
import {
  create_user,
  delete_user,
  export_user_rows,
  find_user_by_public_code,
  get_user_record,
  read_game_rows,
  read_user_rows,
  replace_game_rows,
  replace_user_rows,
  sample_game_rows,
  sample_users,
  scan_users,
  set_user_created_at,
  sweep_expired,
  upgrade_user_rows,
  type NewUser,
  type RawRow,
  type UserRecord,
} from './rows.ts';
import { apply_schema, schema_lock, table_def, type ColumnType, type Scope } from './schema.ts';
import {
  delete_core_state,
  delete_game_state,
  delete_state,
  get_game_state,
  get_state,
  list_game_state,
  list_state,
  put_core_state,
  put_game_state,
  put_state,
  read_public_state,
  type PublicStateEntry,
} from './state.ts';
import {
  add_item_change,
  add_item_mail,
  after_commit,
  db,
  lock_game_row,
  lock_game_row_content,
  on_commit,
  read_db,
  run_game_transaction,
  run_read_only,
  run_request_transaction,
  run_rollback_transaction,
  run_savepoint,
  run_user_transaction,
  wait_after_commit,
  with_hook_change_source,
  type RequestFields,
  type UserTxResult,
} from './tx.ts';
import { register_user_change, run_user_changes, send_user_change, type ChangeCaller } from './user_change.ts';
import { canonical_json } from './canonical_json.ts';
import { check_hook_output } from './hook_output.ts';

export type { RequestCtx, HookChangeSource } from './request_ctx.ts';
/** The error a misuse, and a format violation of `replace_user_rows` and `replace_game_rows`, throws. */
export { StorageMisuse } from './core.ts';
/** The `## API` operation `canonical_json`. */
export { canonical_json } from './canonical_json.ts';
/** `NoAccessTokenRpc` (`server-core` `## request`). */
export { NO_ACCESS_TOKEN_RPC } from './request_sets.ts';
export type { DbHandle, FailureCode, GameTx, ItemConverter, Pass, UserChangeApply, UserChangeFail, UserChangeFailure } from './core.ts';
export type { FullStateResult, ResponseDelta, TakenDelta } from './delta.ts';
export type { KindClass, KindValue } from './kinds.ts';
export type { Random } from './random.ts';
export type { NewUser, RawRow, UserRecord } from './rows.ts';
export { normalize_public_code } from './public_code.ts';
export type { ColumnType, Scope } from './schema.ts';
export type { PublicStateEntry } from './state.ts';
export type { RequestFields, UserTxResult } from './tx.ts';

/** A column of `register_table`. */
export interface ColumnInput {
  readonly name: string;
  readonly type: ColumnType;
}

/** The fields of the module input `server` (`server-core` `## module`) that `storage` reads. */
export interface StorageServer {
  readonly env: 'LOCAL' | 'DEV' | 'STG' | 'PROD';
  /** `--db`: a SQLite file path or `postgresql`; null when the server start has no `--db` (DEV, STG, PROD). */
  readonly db: string | null;
  readonly data: GameData.DataSet;
  readonly data_version: string;
  /** The secret adapter: the `--secret-file` value (LOCAL server, test server) or the host secret store value. */
  read_secret(name: string): string | null;
}

/** The module input (`server-core` `## module`). */
export interface StorageInput {
  readonly settings: Readonly<Record<string, unknown>>;
  readonly modules: Readonly<Record<string, unknown>>;
  readonly server: StorageServer;
}

/** The `storage` module object: the `## API` operations, the lifecycle, the members the DEV code calls and `content`. */
export interface Storage {
  get_state(ctx: RequestCtx, kind: KindClass, item_id: bigint): KindValue | null;
  list_state(ctx: RequestCtx, kind: KindClass): KindValue[];
  put_state(ctx: RequestCtx, value: KindValue): void;
  delete_state(ctx: RequestCtx, kind: KindClass, item_id: bigint): void;
  put_core_state(ctx: RequestCtx, value: KindValue): void;
  delete_core_state(ctx: RequestCtx, kind: KindClass, item_id: bigint): void;
  read_public_state(ctx: RequestCtx, user_ids: readonly bigint[], kind: KindClass): PublicStateEntry[];
  get_game_state(ctx: RequestCtx, kind: KindClass, key: bigint): KindValue | null;
  list_game_state(ctx: RequestCtx, kind: KindClass, after_key: bigint, max: number): KindValue[];
  put_game_state(ctx: RequestCtx, value: KindValue, expires_at: bigint): void;
  delete_game_state(ctx: RequestCtx, kind: KindClass, key: bigint): void;
  run_user_transaction(user_id: bigint, fn: (ctx: RequestCtx) => Pass | FailureCode): Promise<UserTxResult>;
  run_request_transaction<T>(user_id: bigint, fields: RequestFields, fn: (ctx: RequestCtx) => T): Promise<T | 'FAILED' | 'WITHDRAWN'>;
  take_response_delta(ctx: RequestCtx): TakenDelta;
  add_item_change(ctx: RequestCtx, change: CoreContract.ItemChange): void;
  add_item_mail(ctx: RequestCtx, mail: CoreContract.ItemMail): void;
  run_rollback_transaction<T>(user_id: bigint, fn: (ctx: RequestCtx) => T): Promise<T | 'FAILED' | 'WITHDRAWN'>;
  run_game_transaction<T>(fn: (tx: GameTx) => T): Promise<T | 'FAILED'>;
  run_savepoint(ctx: RequestCtx, fn: () => Pass | FailureCode): Pass | FailureCode;
  with_hook_change_source<T>(ctx: RequestCtx, source: CoreContract.ItemChangeSource, ref: string, fn: () => T): T;
  check_hook_output(hook: string, output: unknown): Pass | FailureCode;
  run_read_only<T>(ctx_or_tx: RequestCtx | GameTx, fn: () => T): T;
  lock_game_row(ctx_or_tx: RequestCtx | GameTx, table: string, key: readonly unknown[]): 'FAILED' | undefined;
  after_commit(ctx_or_tx: RequestCtx | GameTx, fn: () => unknown): void;
  on_commit(ctx_or_tx: RequestCtx | GameTx, fn: () => void): void;
  send_user_change(ctx: RequestCtx, target_id: bigint, name: string, payload: Uint8Array): void;
  register_user_change(name: string, apply: UserChangeApply, fail: UserChangeFail): void;
  run_user_changes(): Promise<number | 'FAILED'>;
  db(ctx_or_tx: RequestCtx | GameTx): DbHandle;
  read_db(): DbHandle;
  create_user(tx: GameTx): NewUser;
  delete_user(ctx: RequestCtx): void;
  get_user_record(db: DbHandle, user_id: bigint): UserRecord | null;
  find_user_by_public_code(db: DbHandle, public_code: string): bigint | null;
  set_user_created_at(ctx: RequestCtx, time: bigint): void;
  scan_users(db: DbHandle, after: bigint, max: number, version?: bigint | number | null): bigint[];
  sample_users(db: DbHandle, max: number): bigint[];
  read_full_state(ctx: RequestCtx): FullStateResult;
  read_user_rows(ctx: RequestCtx): RawRow[];
  replace_user_rows(ctx: RequestCtx, rows: readonly RawRow[]): number;
  read_game_rows(db: DbHandle, kind: KindClass, keys: readonly bigint[]): RawRow[];
  sample_game_rows(db: DbHandle, kind: KindClass, max: number): RawRow[];
  replace_game_rows(tx: GameTx, rows: readonly RawRow[]): number | 'FAILED';
  upgrade_user_rows(ctx: RequestCtx): number | 'FAILED';
  register_table(
    name: string,
    scope: Scope,
    columns: readonly ColumnInput[],
    key_columns: readonly string[],
    expiry_column: string | null,
    snapshot: boolean | null,
    personal_data_user_column?: string | null,
    indexes?: readonly (readonly string[])[],
  ): void;
  export_user_rows(db: DbHandle, user_id: bigint): Record<string, Record<string, unknown>[]>;
  register_item_converter(fn: ItemConverter): void;
  sweep_expired(): Promise<number | 'FAILED'>;
  random_u32(source: RandomSource): number;
  random_int(source: RandomSource, min: bigint, max: bigint): bigint;
  random_weighted(source: RandomSource, weights: readonly (bigint | number)[]): number;
  random_shuffle(source: RandomSource, n: number): number[];
  create_random(seed: bigint): Random;
  make_purpose_seed(name: string, base: bigint): bigint;
  canonical_json(value: unknown): string;
  begin_start(): void;
  complete_start(): string | null;
  stop(): void;
  /** Called by the DEV code only (`dev/index.ts`). */
  set_seed_provider(fn: (request_id: string) => bigint | null): void;
  /** Called by the DEV code only (`dev/index.ts`). */
  wait_after_commit(): Promise<void>;
  readonly content: StorageContent;
}

/** The operations whose `caller` includes content code, in the same form for content and core modules. */
const SHARED_CONTENT = [
  'get_state',
  'list_state',
  'put_state',
  'delete_state',
  'read_public_state',
  'get_game_state',
  'list_game_state',
  'put_game_state',
  'delete_game_state',
  'send_user_change',
  'random_u32',
  'random_int',
  'random_weighted',
  'random_shuffle',
  'create_random',
  'make_purpose_seed',
] as const satisfies readonly (keyof Storage)[];

type SharedContent = (typeof SHARED_CONTENT)[number];

/**
 * What content `register(core)` gets as `storage` (`server-core` `## module`): only the operations whose `caller`
 * includes content code. Its `lock_game_row` takes `game_state` only and throws on a lock failure, and its
 * `register_user_change` takes content's change names, which have no `.`.
 */
export interface StorageContent extends Pick<Storage, SharedContent> {
  lock_game_row(ctx: RequestCtx, table: string, key: readonly unknown[]): void;
  register_user_change(name: string, apply: UserChangeApply, fail: UserChangeFail): void;
}

/** The member `content`: a frozen object, so content code cannot set or add a member. */
function content_of(storage: Omit<Storage, 'content'>, core: StorageCore, register: (caller: ChangeCaller) => Storage['register_user_change']): StorageContent {
  const shared = Object.fromEntries(SHARED_CONTENT.map((name) => [name, storage[name]])) as Pick<Storage, SharedContent>;
  return Object.freeze({
    ...shared,
    lock_game_row: (ctx: RequestCtx, table: string, key: readonly unknown[]) => {
      lock_game_row_content(core, ctx, table, key);
    },
    register_user_change: register('content'),
  });
}

/** A secret through the secret adapter; a missing or empty value fails server start. */
function secret(input: StorageInput, name: string, what: string): string {
  const value = input.server.read_secret(name);
  if (typeof value !== 'string' || value === '') throw new DbError('connection', 'secret', `${what} has no value`);
  return value;
}

/**
 * The waits of the PostgreSQL adapter: a connect answers within `storage.dbAnswerWaitMs`, and a statement within its
 * lock wait limit (where `lock_timeout` ends its lock wait) plus that, or plus `storage.schemaAnswerWaitMs` in the
 * schema lock transaction (`complete_start`). TCP keepalive starts after twice `storage.userLockWaitMs`.
 */
function pg_limits(settings: StorageSettings): PgLimits {
  return {
    max_connections: settings.db_max_connections,
    read_wait_ms: settings.user_lock_wait_ms,
    answer_wait_ms: settings.db_answer_wait_ms,
    keepalive_ms: 2 * Math.max(1, settings.user_lock_wait_ms),
  };
}

/** The DB adapter of the server start arguments (`### DB adapter`). */
function adapter_for(input: StorageInput, settings: StorageSettings): DbAdapter {
  const target = input.server.db;
  if (target === 'postgresql') return new PostgresAdapter(secret(input, 'db', '--db postgresql: the secret db'), pg_limits(settings));
  if (target !== null) return new SqliteAdapter(target);
  const name = input.settings['environments.<ENV>.secrets.db'];
  if (typeof name !== 'string' || name === '') throw new DbError('connection', 'secret', `game settings environments.${input.server.env}.secrets.db names no secret`);
  return new PostgresAdapter(secret(input, name, `the secret ${name}`), pg_limits(settings));
}

function time_of(modules: Readonly<Record<string, unknown>>): TimeSource {
  const time = modules['server-time'] as Partial<TimeSource> | undefined;
  if (typeof time?.clock_now !== 'function' || typeof time.user_now !== 'function') throw new TypeError('storage: modules has no server-time');
  return time as TimeSource;
}

function registration(core: StorageCore, what: string, error: string | null): void {
  if (core.phase === 'started' || core.phase === 'stopped') throw new Error(`storage: ${what} after server start`);
  if (error !== null) core.start_errors.push(error);
}

function begin_start(core: StorageCore, input: StorageInput): void {
  core.phase = 'starting';
  try {
    const adapter = adapter_for(input, core.settings);
    adapter.open();
    core.adapter = adapter;
  } catch (error) {
    core.start_errors.push(error instanceof Error ? error.message : String(error));
  }
}

function complete_start(core: StorageCore): string | null {
  if (core.start_errors.length > 0 || core.adapter === null) return `storage: ${core.start_errors.join('; ') || 'the database is not open'}`;
  const adapter = core.adapter;
  let begun;
  try {
    // An index build on a large table takes build time, not lock wait: the schema statements have their own answer wait.
    begun = adapter.begin_sync({
      lock_wait_ms: core.settings.schema_lock_wait_ms,
      answer_wait_ms: core.settings.schema_answer_wait_ms,
      first: schema_lock(adapter.dialect),
    });
  } catch (error) {
    return `storage: the schema lock: ${error instanceof Error ? error.message : String(error)}`;
  }
  let reason: string | null;
  try {
    reason = apply_schema(begun.conn, adapter.dialect, [...core.tables.values()]);
    if (reason === null) begun.conn.commit_sync();
  } catch (error) {
    reason = `the schema step: ${error instanceof Error ? error.message : String(error)}`;
  }
  if (reason !== null) {
    begun.conn.rollback_sync();
    return `storage: ${reason}`;
  }
  core.phase = 'started';
  return null;
}

function stop(core: StorageCore): void {
  core.phase = 'stopped';
  for (const state of core.open) {
    state.active = false;
    state.conn.rollback_sync();
  }
  core.open.clear();
  core.adapter?.close();
  core.adapter = null;
}

/** Makes `storage` with an explicit contract; `create_storage` passes the generated contract code. */
export function create_storage_with(input: StorageInput, contract: StorageContract): Storage {
  const core: StorageCore = {
    settings: read_settings(input.settings),
    time: time_of(input.modules),
    kinds: new KindRegistry(contract),
    data: input.server.data,
    data_version: input.server.data_version,
    adapter: null,
    tables: new Map(),
    converter: null,
    changes: new Map(),
    skipped_changes: new Set(),
    als: new AsyncLocalStorage<TxState>(),
    states: new WeakMap(),
    open: new Set(),
    background: new Set(),
    seed_provider: null,
    phase: 'created',
    start_errors: [],
  };
  const register_change =
    (caller: ChangeCaller): Storage['register_user_change'] =>
    (name, apply, fail) => {
      registration(core, 'register_user_change', register_user_change(core, caller, name, apply, fail));
    };
  const storage: Omit<Storage, 'content'> = {
    get_state: (ctx, kind, item_id) => get_state(core, ctx, kind, item_id),
    list_state: (ctx, kind) => list_state(core, ctx, kind),
    put_state: (ctx, value) => {
      put_state(core, ctx, value);
    },
    delete_state: (ctx, kind, item_id) => {
      delete_state(core, ctx, kind, item_id);
    },
    put_core_state: (ctx, value) => {
      put_core_state(core, ctx, value);
    },
    delete_core_state: (ctx, kind, item_id) => {
      delete_core_state(core, ctx, kind, item_id);
    },
    read_public_state: (ctx, user_ids, kind) => read_public_state(core, ctx, user_ids, kind),
    get_game_state: (ctx, kind, key) => get_game_state(core, ctx, kind, key),
    list_game_state: (ctx, kind, after_key, max) => list_game_state(core, ctx, kind, after_key, max),
    put_game_state: (ctx, value, expires_at) => {
      put_game_state(core, ctx, value, expires_at);
    },
    delete_game_state: (ctx, kind, key) => {
      delete_game_state(core, ctx, kind, key);
    },
    run_user_transaction: (user_id, fn) => run_user_transaction(core, user_id, fn),
    run_request_transaction: (user_id, fields, fn) => run_request_transaction(core, user_id, fields, fn),
    take_response_delta: (ctx) => take_response_delta(core, ctx),
    add_item_change: (ctx, change) => {
      add_item_change(core, ctx, change);
    },
    add_item_mail: (ctx, mail) => {
      add_item_mail(core, ctx, mail);
    },
    run_rollback_transaction: (user_id, fn) => run_rollback_transaction(core, user_id, fn),
    run_game_transaction: (fn) => run_game_transaction(core, fn),
    run_savepoint: (ctx, fn) => run_savepoint(core, ctx, fn),
    with_hook_change_source: (ctx, source, ref, fn) => with_hook_change_source(core, ctx, source, ref, fn),
    check_hook_output,
    run_read_only: (ctx_or_tx, fn) => run_read_only(core, ctx_or_tx, fn),
    lock_game_row: (ctx_or_tx, table, key) => lock_game_row(core, ctx_or_tx, table, key),
    after_commit: (ctx_or_tx, fn) => {
      after_commit(core, ctx_or_tx, fn);
    },
    on_commit: (ctx_or_tx, fn) => {
      on_commit(core, ctx_or_tx, fn);
    },
    send_user_change: (ctx, target_id, name, payload) => {
      send_user_change(core, ctx, target_id, name, payload);
    },
    register_user_change: register_change('module'),
    run_user_changes: () => run_user_changes(core),
    db: (ctx_or_tx) => db(core, ctx_or_tx),
    read_db: () => read_db(core),
    create_user: (tx) => create_user(core, tx),
    delete_user: (ctx) => {
      delete_user(core, ctx);
    },
    get_user_record: (handle, user_id) => get_user_record(handle, user_id),
    find_user_by_public_code: (handle, public_code) => find_user_by_public_code(handle, public_code),
    set_user_created_at: (ctx, time) => {
      set_user_created_at(core, ctx, time);
    },
    scan_users: (handle, after, max, version) => scan_users(handle, after, max, version),
    sample_users: (handle, max) => sample_users(core, handle, max),
    read_full_state: (ctx) => read_full_state(core, ctx),
    read_user_rows: (ctx) => read_user_rows(core, ctx),
    replace_user_rows: (ctx, rows) => replace_user_rows(core, ctx, rows),
    read_game_rows: (handle, kind, keys) => read_game_rows(core, handle, kind, keys),
    sample_game_rows: (handle, kind, max) => sample_game_rows(core, handle, kind, max),
    replace_game_rows: (tx, rows) => replace_game_rows(core, tx, rows),
    upgrade_user_rows: (ctx) => upgrade_user_rows(core, ctx),
    register_table: (name, scope, columns, key, expiry, snapshot, personal, indexes) => {
      const def = table_def({ name, scope, columns, key, expiry, snapshot, personal, indexes });
      const error = typeof def === 'string' ? def : core.tables.has(def.name) ? `table ${def.name} is registered twice` : null;
      registration(core, 'register_table', error);
      if (typeof def !== 'string' && error === null) core.tables.set(def.name, def);
    },
    export_user_rows: (handle, user_id) => export_user_rows(core, handle, user_id),
    register_item_converter: (fn) => {
      registration(core, 'register_item_converter', core.converter !== null ? 'register_item_converter is called twice' : null);
      if (core.converter === null) core.converter = fn;
    },
    sweep_expired: () => sweep_expired(core),
    ...random_api(core),
    create_random: (seed) => create_random_instance(seed),
    canonical_json,
    begin_start: () => {
      begin_start(core, input);
    },
    complete_start: () => complete_start(core),
    stop: () => {
      stop(core);
    },
    set_seed_provider: (fn) => {
      if (core.phase !== 'created') throw new Error('storage: set_seed_provider after server start began');
      core.seed_provider = fn;
    },
    wait_after_commit: () => wait_after_commit(core),
  };
  return Object.assign(storage, { content: content_of(storage, core, register_change) });
}

/** The `storage` module of one server instance (`server-core` `## module`). */
export function create_storage(input: StorageInput): Storage {
  return create_storage_with(input, { core_kinds: CoreContract.KINDS, game_kinds: GameContract.KINDS, contract_version: GameContract.CONTRACT_VERSION });
}
