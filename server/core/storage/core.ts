/**
 * The state of one `storage` instance and of its open transactions, shared by the operation files.
 */
import { AsyncLocalStorage } from 'node:async_hooks';
import type * as CoreContract from '../../generated/contract/core_contract.ts';
import type * as GameData from '../../generated/data/game_data.ts';
import { DbError, type DbAdapter, type DbTxConn, type DbValue, type Row } from './db/types.ts';
import type { KindClass, KindRegistry } from './kinds.ts';
import type { Random } from './random.ts';
import type { HookChangeSource, RequestCtx } from './request_ctx.ts';
import type { TableDef } from './schema.ts';

/** A failure code a function hands back: `GameError` (1000 and up) or `CoreError` (1 to 999). */
export type FailureCode = number;
/** The `pass` result of a change function, a savepoint function, and a user change apply function. */
export type Pass = 'pass';

/** A misuse (`storage` `## API`): thrown; the request ends with `INTERNAL`. */
export class StorageMisuse extends Error {}

/** The core settings `storage` reads (`## settings`). */
export interface StorageSettings {
  readonly user_lock_wait_ms: number;
  readonly db_max_connections: number;
  readonly db_answer_wait_ms: number;
  readonly schema_lock_wait_ms: number;
  readonly schema_answer_wait_ms: number;
  readonly sweep_batch_size: number;
  readonly sweep_table_budget_ms: number;
  readonly max_shuffle_count: number;
  readonly max_public_read_count: number;
  readonly max_game_state_list: number;
  readonly user_change_max_bytes: number;
  readonly user_change_batch_size: number;
  readonly retry_initial_ms: number;
  readonly retry_factor_permille: number;
  readonly retry_max_interval_ms: number;
  readonly retry_max_attempts: number;
}

/** The `server-time` operations `storage` calls. */
export interface TimeSource {
  clock_now(): bigint;
  user_now(user_id: bigint, db: unknown): bigint;
}

/** The converter `migration` registers: stored bytes to bytes, `DELETE`, or `FAILED`. */
export type ItemConverter = (db: DbHandle, kind: KindClass, item_id: bigint, version: bigint, bytes: Uint8Array) => Uint8Array | 'DELETE' | 'FAILED';

/** Why a user change did not apply, as its fail function receives it. */
export type UserChangeFailure = { readonly reason: 'rejected'; readonly code: FailureCode } | { readonly reason: 'withdrawn' } | { readonly reason: 'failed' };
export type UserChangeApply = (ctx: RequestCtx, sender_id: bigint, payload: Uint8Array) => Pass | FailureCode;
export type UserChangeFail = (ctx: RequestCtx, target_id: bigint, payload: Uint8Array, failure: UserChangeFailure) => void;

/** A UserState item first written in a transaction, with its stored bytes before that write. */
export interface Touched {
  readonly column: string;
  readonly item_id: bigint;
  readonly initial: Uint8Array | null;
}

/** What `read_full_state` handed back; `take_response_delta` of that ctx sends it. */
export interface FullState {
  readonly delta: CoreContract.UserStateDelta;
  readonly item_changes: CoreContract.ItemChange[];
  readonly item_mails: CoreContract.ItemMail[];
  readonly unknown_kinds: string[];
}

/**
 * What a savepoint puts back when it rolls back. `delete_user` puts in new `touched`, `item_changes` and `item_mails`
 * objects, so the mark keeps the objects with their lengths. Entries a savepoint adds to `touched` stay: their stored
 * bytes before the first write are those the rollback puts back, so they make no delta entry.
 */
interface SavepointMark {
  readonly name: string;
  readonly touched: Map<string, Touched>;
  readonly item_changes_list: CoreContract.ItemChange[];
  readonly item_changes: number;
  readonly item_mails_list: CoreContract.ItemMail[];
  readonly item_mails: number;
  readonly after: number;
  readonly on_commit: number;
  readonly user_deleted: boolean;
  readonly taken: boolean;
  readonly full: FullState | null;
}

/** The mutable ctx object behind `RequestCtx`. */
export class Ctx implements RequestCtx {
  user_id = 0n;
  request_name = '';
  request_id = '';
  silent = false;
  retry = false;
  session_id = '';
  client_version = '';
  platform = '';
  request_time = 0n;
  data: GameData.DataSet;
  data_version: string;
  user_deleted = false;
  hook_change_source: HookChangeSource | null = null;
  seed = 0n;

  constructor(data: GameData.DataSet, data_version: string) {
    this.data = data;
    this.data_version = data_version;
  }
}

/** A game transaction handle (`run_game_transaction`). */
export interface GameTx {
  readonly game_tx: true;
}

/** One open transaction. */
export class TxState {
  readonly kind: 'user' | 'game';
  readonly conn: DbTxConn;
  readonly user_id: bigint;
  readonly ctx: Ctx | null;
  readonly tx: GameTx | null;
  active = true;
  /** A statement failed: the transaction does not commit. */
  broken = false;
  read_only = 0;
  touched = new Map<string, Touched>();
  item_changes: CoreContract.ItemChange[] = [];
  item_mails: CoreContract.ItemMail[] = [];
  after: (() => unknown)[] = [];
  on_commit: (() => unknown)[] = [];
  taken = false;
  full: FullState | null = null;
  random: Random | null = null;
  readonly hook_sources: HookChangeSource[] = [];
  readonly savepoints: SavepointMark[] = [];
  locked = new Set<bigint>();

  constructor(kind: 'user' | 'game', conn: DbTxConn, user_id: bigint, ctx: Ctx | null) {
    this.kind = kind;
    this.conn = conn;
    this.user_id = user_id;
    this.ctx = ctx;
    this.tx = kind === 'game' ? { game_tx: true } : null;
  }

  mark(name: string): void {
    this.savepoints.push({
      name,
      touched: this.touched,
      item_changes_list: this.item_changes,
      item_changes: this.item_changes.length,
      item_mails_list: this.item_mails,
      item_mails: this.item_mails.length,
      after: this.after.length,
      on_commit: this.on_commit.length,
      user_deleted: this.ctx?.user_deleted ?? false,
      taken: this.taken,
      full: this.full,
    });
  }

  /** Pops the innermost savepoint; with `undo`, puts back the in-memory state of when it opened. */
  unmark(undo: boolean): void {
    const mark = this.savepoints.pop();
    if (mark === undefined || !undo) return;
    this.touched = mark.touched;
    this.item_changes = mark.item_changes_list;
    this.item_changes.length = mark.item_changes;
    this.item_mails = mark.item_mails_list;
    this.item_mails.length = mark.item_mails;
    this.after.length = mark.after;
    this.on_commit.length = mark.on_commit;
    // `locked` stays: a rollback to the savepoint does not release a row lock (`DbTxConn.lock_key`).
    if (this.ctx !== null) this.ctx.user_deleted = mark.user_deleted;
    this.taken = mark.taken;
    this.full = mark.full;
  }
}

/** A DB handle (`storage` `## API` `db`, `read_db`): parameter SQL on the transaction or the read connection. */
export class DbHandle {
  readonly owner: TxState | null;
  private readonly run: (sql: string, params: readonly DbValue[]) => Row[];

  constructor(owner: TxState | null, run: (sql: string, params: readonly DbValue[]) => Row[]) {
    this.owner = owner;
    this.run = run;
  }

  query(sql: string, params: readonly DbValue[] = []): Row[] {
    const owner = this.owner;
    if (owner !== null) {
      if (!owner.active) throw new StorageMisuse('storage: the DB handle of an ended transaction');
      if (owner.read_only > 0 && is_write(sql)) throw new StorageMisuse('storage: a write inside run_read_only');
      if (owner.broken) throw new DbError('lock', 'broken', 'storage: the transaction has failed');
    }
    try {
      return this.run(sql, params);
    } catch (error) {
      if (owner !== null) mark_broken(owner, error);
      if (error instanceof DbError && error.kind === 'readonly') throw new StorageMisuse(`storage: a write through the read-only DB handle: ${error.message}`);
      throw error;
    }
  }
}

/** True when a statement can write: anything but a plain `SELECT` or `WITH ... SELECT`. */
export function is_write(sql: string): boolean {
  const text = sql.trim().toLowerCase();
  if (text.startsWith('select')) return false;
  if (text.startsWith('with')) return /\b(insert|update|delete)\b/.test(text);
  return true;
}

/**
 * A failed statement ends a transaction: it does not commit, on both DBs. PostgreSQL aborts the whole transaction on
 * a failed statement, so SQLite keeps the same meaning even when the caller catches the failure and goes on.
 */
export function mark_broken(state: TxState, error: unknown): void {
  if (error instanceof DbError && error.kind !== 'readonly') state.broken = true;
}

/** Everything one `storage` instance holds. */
export interface StorageCore {
  readonly settings: StorageSettings;
  readonly time: TimeSource;
  readonly kinds: KindRegistry;
  readonly data: GameData.DataSet;
  readonly data_version: string;
  adapter: DbAdapter | null;
  readonly tables: Map<string, TableDef>;
  converter: ItemConverter | null;
  readonly changes: Map<string, { apply: UserChangeApply; fail: UserChangeFail }>;
  /** `change_id`s whose processing threw outside the apply and fail functions: left out of `run_user_changes` until the process ends. */
  readonly skipped_changes: Set<bigint>;
  readonly als: AsyncLocalStorage<TxState>;
  readonly states: WeakMap<object, TxState>;
  readonly open: Set<TxState>;
  readonly background: Set<Promise<void>>;
  seed_provider: ((request_id: string) => bigint | null) | null;
  phase: 'created' | 'starting' | 'started' | 'stopped';
  readonly start_errors: string[];
}

export function adapter_of(core: StorageCore): DbAdapter {
  if (core.adapter === null) throw new DbError('connection', 'closed', 'storage: the database is not open');
  return core.adapter;
}

/** The open user transaction of a ctx; misuse when it is not one. */
export function user_state_of(core: StorageCore, ctx: unknown): TxState {
  const state = typeof ctx === 'object' && ctx !== null ? core.states.get(ctx) : undefined;
  if (state?.kind !== 'user' || !state.active) throw new StorageMisuse('storage: the ctx is not of an open transaction');
  return state;
}

/** The open transaction of a ctx or a game tx; misuse when it is neither. */
export function any_state_of(core: StorageCore, ctx_or_tx: unknown): TxState {
  const state = typeof ctx_or_tx === 'object' && ctx_or_tx !== null ? core.states.get(ctx_or_tx) : undefined;
  if (state === undefined || !state.active) throw new StorageMisuse('storage: the ctx or game tx is not of an open transaction');
  return state;
}

/** A write in a transaction: misuse inside `run_read_only`. */
export function writable(state: TxState): void {
  if (state.read_only > 0) throw new StorageMisuse('storage: a write inside run_read_only');
}

/** A UserState write: misuse after `take_response_delta` and after `read_full_state`. */
export function user_state_writable(state: TxState): void {
  writable(state);
  if (state.taken) throw new StorageMisuse('storage: a UserState write after take_response_delta');
  if (state.full !== null) throw new StorageMisuse('storage: a UserState write after read_full_state');
}

/** The DB handle of a transaction. */
export function handle_of(state: TxState): DbHandle {
  return new DbHandle(state, (sql, params) => state.conn.query(sql, params));
}

/** Runs a statement of the transaction; a lock or connection failure marks it broken. */
export function q(state: TxState, sql: string, params: readonly DbValue[] = []): Row[] {
  if (state.broken) throw new DbError('lock', 'broken', 'storage: the transaction has failed');
  try {
    return state.conn.query(sql, params);
  } catch (error) {
    mark_broken(state, error);
    throw error;
  }
}

export function big(value: DbValue | undefined): bigint {
  if (typeof value === 'bigint') return value;
  if (typeof value === 'number') return BigInt(value);
  throw new TypeError(`storage: ${String(value)} is not an integer`);
}

export function bytes(value: DbValue | undefined): Uint8Array {
  if (value instanceof Uint8Array) return value;
  throw new TypeError('storage: the column is not bytes');
}

export function int_setting(settings: Readonly<Record<string, unknown>>, key: string): number {
  const value = settings[key];
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) throw new TypeError(`storage: setting ${key} is not an integer`);
  return value;
}

export function read_settings(settings: Readonly<Record<string, unknown>>): StorageSettings {
  return {
    user_lock_wait_ms: int_setting(settings, 'storage.userLockWaitMs'),
    db_max_connections: int_setting(settings, 'storage.dbMaxConnections'),
    db_answer_wait_ms: int_setting(settings, 'storage.dbAnswerWaitMs'),
    schema_lock_wait_ms: int_setting(settings, 'storage.schemaLockWaitMs'),
    schema_answer_wait_ms: int_setting(settings, 'storage.schemaAnswerWaitMs'),
    sweep_batch_size: int_setting(settings, 'storage.sweepBatchSize'),
    sweep_table_budget_ms: int_setting(settings, 'storage.sweepTableBudgetMs'),
    max_shuffle_count: int_setting(settings, 'storage.maxShuffleCount'),
    max_public_read_count: int_setting(settings, 'storage.maxPublicReadCount'),
    max_game_state_list: int_setting(settings, 'storage.maxGameStateList'),
    user_change_max_bytes: int_setting(settings, 'storage.userChangeMaxBytes'),
    user_change_batch_size: int_setting(settings, 'storage.userChangeBatchSize'),
    retry_initial_ms: int_setting(settings, 'storage.userChangeRetryInitialMs'),
    retry_factor_permille: int_setting(settings, 'storage.userChangeRetryFactorPermille'),
    retry_max_interval_ms: int_setting(settings, 'storage.userChangeRetryMaxIntervalMs'),
    retry_max_attempts: int_setting(settings, 'storage.userChangeRetryMaxAttempts'),
  };
}
