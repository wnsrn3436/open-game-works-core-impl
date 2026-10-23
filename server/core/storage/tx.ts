/**
 * Transactions (`storage` `### transaction`, `### savepoint`, `### read only`): user transactions with user
 * serialization, game transactions, savepoints, `on_commit`, `after_commit`, `lock_game_row`.
 */
import { createHash, randomBytes } from 'node:crypto';
import type * as CoreContract from '../../generated/contract/core_contract.ts';
import { DbError, is_db_failure, type DbValue } from './db/types.ts';
import {
  adapter_of,
  any_state_of,
  Ctx,
  DbHandle,
  handle_of,
  mark_broken,
  q,
  StorageMisuse,
  TxState,
  user_state_of,
  writable,
  type FailureCode,
  type GameTx,
  type Pass,
  type StorageCore,
} from './core.ts';
import { write_pending } from './delta.ts';
import { Random } from './random.ts';
import type { RequestCtx } from './request_ctx.ts';
import { check_item_id, game_kind } from './state.ts';

export type UserTxResult = 'COMMITTED' | 'WITHDRAWN' | 'REJECTED' | 'FAILED';

/** The request fields of `run_request_transaction`. */
export interface RequestFields {
  readonly request_name: string;
  readonly request_id: string;
  readonly silent: boolean;
  readonly retry: boolean;
  readonly session_id: string;
  readonly client_version: string;
  readonly platform: string;
}

type Mode = 'change' | 'request' | 'rollback';

function is_failure_code(value: unknown): value is FailureCode {
  return typeof value === 'number';
}

function is_thenable(value: unknown): value is PromiseLike<unknown> {
  return typeof value === 'object' && value !== null && typeof (value as { then?: unknown }).then === 'function';
}

/** Throws when called inside an open transaction of this instance. */
function not_nested(core: StorageCore): void {
  const current = core.als.getStore();
  if (current?.active === true) throw new StorageMisuse('storage: a transaction opened inside a transaction');
}

function secure_seed(): bigint {
  return randomBytes(8).readBigInt64BE();
}

/** Runs the synchronous function in the transaction's async context; a thenable result is a misuse. */
function in_context<T>(core: StorageCore, state: TxState, fn: () => T): T {
  const result = core.als.run(state, fn);
  if (is_thenable(result)) {
    // The function is synchronous (`storage` `## API`); its pending part must not report an unhandled rejection.
    Promise.resolve(result).catch(() => undefined);
    throw new StorageMisuse('storage: a transaction function returned a promise');
  }
  return result;
}

/**
 * Calls the `on_commit` functions of a committed transaction, in order, in the turn the commit ended. A server stop
 * does not drop them. A throw and the return value are dropped.
 */
function run_on_commit(fns: readonly (() => unknown)[]): void {
  for (const fn of fns) {
    try {
      const result = fn();
      // The function is synchronous; a pending part it returns must not report an unhandled rejection.
      if (is_thenable(result)) Promise.resolve(result).catch(() => undefined);
    } catch {
      // The module that registered the function logs its failure.
    }
  }
}

/** Calls the `after_commit` functions of a committed transaction outside of it, in order, without waiting. */
function run_after(core: StorageCore, fns: readonly (() => unknown)[]): void {
  if (fns.length === 0) return;
  const job = (async (): Promise<void> => {
    for (const fn of fns) {
      if (core.phase === 'stopped') return;
      try {
        const result = fn();
        if (is_thenable(result)) await result;
      } catch {
        // The module that registered the function logs its failure.
      }
    }
  })();
  void track(core, job);
}

/** Keeps a running job for `wait_after_commit` until it ends. */
export function track(core: StorageCore, job: Promise<void>): Promise<void> {
  core.background.add(job);
  // The cleanup takes the rejection too: the caller of `track` handles the job's own rejection.
  const forget = (): void => {
    core.background.delete(job);
  };
  void job.then(forget, forget);
  return job;
}

/** Waits until every `after_commit` job and user change apply started so far, and any they start, has ended. */
export async function wait_after_commit(core: StorageCore): Promise<void> {
  while (core.background.size > 0) await Promise.allSettled([...core.background]);
}

function end(core: StorageCore, state: TxState): void {
  state.active = false;
  core.open.delete(state);
}

async function rollback(core: StorageCore, state: TxState): Promise<void> {
  end(core, state);
  await state.conn.rollback();
}

/**
 * Commits; `false` when the transaction is broken or the commit fails (then nothing committed, for example a
 * PostgreSQL transaction that ends with `ROLLBACK` at `COMMIT`).
 */
async function commit(core: StorageCore, state: TxState): Promise<boolean> {
  if (state.broken) {
    await rollback(core, state);
    return false;
  }
  end(core, state);
  try {
    await state.conn.commit();
    return true;
  } catch (error) {
    if (error instanceof DbError) return false;
    throw error;
  }
}

function user_lock_sql(core: StorageCore): string {
  const lock = adapter_of(core).dialect === 'postgresql' ? ' FOR UPDATE' : '';
  return `SELECT created_at, withdrawn_at FROM "user" WHERE user_id = $1${lock}`;
}

/** Opens a user transaction with its ctx: `WITHDRAWN` and `FAILED` leave nothing open. */
async function open_user(core: StorageCore, user_id: bigint, fields: RequestFields | null): Promise<TxState | 'WITHDRAWN' | 'FAILED'> {
  let begun;
  try {
    begun = await adapter_of(core).begin({ lock_wait_ms: core.settings.user_lock_wait_ms, first: { sql: user_lock_sql(core), params: [user_id] } });
  } catch (error) {
    if (is_db_failure(error)) return 'FAILED';
    throw error;
  }
  const row = begun.rows[0];
  if (row === undefined || row.withdrawn_at !== null) {
    await begun.conn.rollback();
    return 'WITHDRAWN';
  }
  const ctx = new Ctx(core.data, core.data_version);
  const state = new TxState('user', begun.conn, user_id, ctx);
  core.open.add(state);
  core.states.set(ctx, state);
  try {
    Object.assign(ctx, fields ?? {});
    ctx.user_id = user_id;
    ctx.request_time = core.time.user_now(user_id, handle_of(state));
    const provided = fields === null || core.seed_provider === null ? null : core.seed_provider(fields.request_id);
    ctx.seed = provided ?? secure_seed();
    state.random = new Random(ctx.seed);
  } catch (error) {
    await rollback(core, state);
    if (is_db_failure(error)) return 'FAILED';
    throw error;
  }
  return state;
}

/** Runs a body; a lock or connection failure ends it as `FAILED`, any other throw rolls back and throws. */
async function body<T>(core: StorageCore, state: TxState, fn: () => T): Promise<{ value: T } | 'FAILED'> {
  try {
    return { value: in_context(core, state, fn) };
  } catch (error) {
    await rollback(core, state);
    if (is_db_failure(error)) return 'FAILED';
    throw error;
  }
}

async function run_user(core: StorageCore, user_id: bigint, fields: RequestFields | null, mode: Mode, fn: (ctx: RequestCtx) => unknown): Promise<unknown> {
  const opened = await open_user(core, user_id, fields);
  if (typeof opened === 'string') return opened;
  const state = opened;
  const ctx = state.ctx as Ctx;
  const ran = await body(core, state, () => fn(ctx));
  if (ran === 'FAILED') return 'FAILED';
  if (mode === 'rollback') {
    await rollback(core, state);
    return ran.value;
  }
  const rejected = mode === 'change' ? ran.value !== 'pass' : is_failure_code(ran.value);
  if (rejected) {
    await rollback(core, state);
    return mode === 'change' ? 'REJECTED' : ran.value;
  }
  if (mode === 'change') {
    const pending = await body(core, state, () => {
      write_pending(core, state);
    });
    if (pending === 'FAILED') return 'FAILED';
  }
  const { after, on_commit } = state;
  if (!(await commit(core, state))) return 'FAILED';
  run_on_commit(on_commit);
  run_after(core, after);
  return mode === 'change' ? 'COMMITTED' : ran.value;
}

/** Checks the nesting rule synchronously, then runs. */
function start<T>(core: StorageCore, user_id: unknown, run: (user_id: bigint) => Promise<T>): Promise<T> {
  not_nested(core);
  if (typeof user_id !== 'bigint') throw new StorageMisuse('storage: the user ID is not a bigint');
  return run(user_id);
}

export function run_user_transaction(core: StorageCore, user_id: unknown, fn: (ctx: RequestCtx) => Pass | FailureCode): Promise<UserTxResult> {
  return start(core, user_id, (id) => run_user(core, id, null, 'change', fn) as Promise<UserTxResult>);
}

export function run_request_transaction<T>(core: StorageCore, user_id: unknown, fields: RequestFields, fn: (ctx: RequestCtx) => T): Promise<T | 'FAILED' | 'WITHDRAWN'> {
  return start(core, user_id, (id) => run_user(core, id, fields, 'request', fn) as Promise<T | 'FAILED' | 'WITHDRAWN'>);
}

export function run_rollback_transaction<T>(core: StorageCore, user_id: unknown, fn: (ctx: RequestCtx) => T): Promise<T | 'FAILED' | 'WITHDRAWN'> {
  return start(core, user_id, (id) => run_user(core, id, null, 'rollback', fn) as Promise<T | 'FAILED' | 'WITHDRAWN'>);
}

export async function run_game(core: StorageCore, fn: (tx: GameTx) => unknown): Promise<unknown> {
  let begun;
  try {
    begun = await adapter_of(core).begin({ lock_wait_ms: core.settings.user_lock_wait_ms, first: null });
  } catch (error) {
    if (is_db_failure(error)) return 'FAILED';
    throw error;
  }
  const state = new TxState('game', begun.conn, 0n, null);
  const tx = state.tx as GameTx;
  core.open.add(state);
  core.states.set(tx, state);
  const ran = await body(core, state, () => fn(tx));
  if (ran === 'FAILED') return 'FAILED';
  if (is_failure_code(ran.value)) {
    await rollback(core, state);
    return ran.value;
  }
  const { after, on_commit } = state;
  if (!(await commit(core, state))) return 'FAILED';
  run_on_commit(on_commit);
  run_after(core, after);
  return ran.value;
}

export function run_game_transaction<T>(core: StorageCore, fn: (tx: GameTx) => T): Promise<T | 'FAILED'> {
  not_nested(core);
  return run_game(core, fn) as Promise<T | 'FAILED'>;
}

export function run_savepoint(core: StorageCore, ctx: unknown, fn: () => Pass | FailureCode): Pass | FailureCode {
  const state = user_state_of(core, ctx);
  const name = `sp_${String(state.savepoints.length + 1)}`;
  q(state, `SAVEPOINT ${name}`);
  state.mark(name);
  let result: Pass | FailureCode;
  try {
    result = fn();
  } catch (error) {
    state.unmark(false);
    throw error;
  }
  if (result === 'pass') {
    state.unmark(false);
    q(state, `RELEASE SAVEPOINT ${name}`);
    return result;
  }
  if (!is_failure_code(result)) {
    state.unmark(false);
    throw new StorageMisuse('storage: a run_savepoint function returned neither pass nor a failure code');
  }
  state.unmark(true);
  q(state, `ROLLBACK TO SAVEPOINT ${name}`);
  q(state, `RELEASE SAVEPOINT ${name}`);
  return result;
}

export function with_hook_change_source<T>(core: StorageCore, ctx: unknown, source: CoreContract.ItemChangeSource, ref: string, fn: () => T): T {
  const state = user_state_of(core, ctx);
  const c = state.ctx as Ctx;
  const outer = c.hook_change_source;
  state.hook_sources.push({ source, ref });
  c.hook_change_source = { source, ref };
  try {
    return fn();
  } finally {
    state.hook_sources.pop();
    c.hook_change_source = outer;
  }
}

export function run_read_only<T>(core: StorageCore, ctx_or_tx: unknown, fn: () => T): T {
  const state = any_state_of(core, ctx_or_tx);
  state.read_only += 1;
  try {
    return fn();
  } finally {
    state.read_only -= 1;
  }
}

export function after_commit(core: StorageCore, ctx: unknown, fn: () => unknown): void {
  const state = any_state_of(core, ctx);
  if (typeof fn !== 'function') throw new StorageMisuse('storage: after_commit needs a function');
  state.after.push(fn);
}

export function on_commit(core: StorageCore, ctx: unknown, fn: () => unknown): void {
  const state = any_state_of(core, ctx);
  if (typeof fn !== 'function') throw new StorageMisuse('storage: on_commit needs a function');
  state.on_commit.push(fn);
}

export function add_item_change(core: StorageCore, ctx: unknown, change: CoreContract.ItemChange): void {
  const state = user_state_of(core, ctx);
  writable(state);
  if (state.taken) throw new StorageMisuse('storage: add_item_change after take_response_delta');
  state.item_changes.push(change);
}

export function add_item_mail(core: StorageCore, ctx: unknown, mail: CoreContract.ItemMail): void {
  const state = user_state_of(core, ctx);
  writable(state);
  if (state.taken) throw new StorageMisuse('storage: add_item_mail after take_response_delta');
  state.item_mails.push(mail);
}

/** The 64-bit key of one row to lock: the first 8 bytes of SHA-256 of the table and its key values. */
export function lock_key(table: string, values: readonly unknown[]): bigint {
  const text = JSON.stringify([table, ...values.map((v) => (typeof v === 'bigint' ? `n${String(v)}` : v))]);
  return createHash('sha256').update(text, 'utf8').digest().readBigInt64BE(0);
}

/** The key values of a `game_state` row from `(game state kind, key)`. */
function game_state_key(core: Pick<StorageCore, 'kinds'>, key: unknown): unknown[] {
  if (!Array.isArray(key) || key.length !== 2) throw new StorageMisuse('storage: the game_state key is not (game state kind, key)');
  const kind = game_kind(core, key[0]);
  return [kind.info.column, check_item_id(kind, key[1])];
}

/**
 * The lock key `lock_game_row` takes for `table` and `key`. The `game_state` key is `(game state kind, key)` as
 * content passes it; the key of another table is its key column values. `testing`'s `game_row_lock_id` uses it too.
 */
export function row_lock_key(core: Pick<StorageCore, 'kinds'>, table: string, key: unknown): bigint {
  if (table === 'game_state') return lock_key(table, game_state_key(core, key));
  if (!Array.isArray(key)) throw new StorageMisuse(`storage: lock_game_row key of ${table} is not a list`);
  return lock_key(table, key);
}

/** Locks the row `(table, values)` until the transaction ends; `FAILED` on a lock wait over the limit or a deadlock. */
export function lock_row(state: TxState, table: string, values: readonly unknown[]): 'FAILED' | undefined {
  const id = lock_key(table, values);
  if (state.locked.has(id)) return undefined;
  try {
    if (state.broken) throw new DbError('lock', 'broken', 'storage: the transaction has failed');
    state.conn.lock_key(id);
  } catch (error) {
    mark_broken(state, error);
    if (is_db_failure(error)) return 'FAILED';
    throw error;
  }
  state.locked.add(id);
  return undefined;
}

/**
 * `lock_game_row` of a core module: a table outside the tables registered with scope `game` is misuse, and a lock
 * failure is `FAILED`.
 */
export function lock_game_row(core: StorageCore, ctx_or_tx: unknown, table: unknown, key: unknown): 'FAILED' | undefined {
  const state = any_state_of(core, ctx_or_tx);
  const def = typeof table === 'string' ? core.tables.get(table) : undefined;
  if (def?.scope !== 'game') throw new StorageMisuse(`storage: lock_game_row of ${String(table)}, not a table registered with scope game`);
  if (!Array.isArray(key) || key.length !== def.key.length) throw new StorageMisuse(`storage: lock_game_row key of ${def.name} does not match its key columns`);
  return lock_row(state, def.name, key as unknown[]);
}

/** `lock_game_row` of content code: `game_state` with `(game state kind, key)` only; a lock failure throws. */
export function lock_game_row_content(core: StorageCore, ctx: unknown, table: unknown, key: unknown): void {
  const state = any_state_of(core, ctx);
  if (table !== 'game_state') throw new StorageMisuse(`storage: content lock_game_row of ${String(table)}, not game_state`);
  if (lock_row(state, 'game_state', game_state_key(core, key)) === 'FAILED') throw new DbError('lock', 'lock_game_row', 'storage: the game_state row lock went over storage.userLockWaitMs or deadlocked');
}

export function db(core: StorageCore, ctx_or_tx: unknown): DbHandle {
  return handle_of(any_state_of(core, ctx_or_tx));
}

export function read_db(core: StorageCore): DbHandle {
  return new DbHandle(null, (sql: string, params: readonly DbValue[]) => adapter_of(core).read.query(sql, params));
}
