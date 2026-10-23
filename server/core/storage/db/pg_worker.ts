/**
 * The PostgreSQL worker thread: owns the connections and runs the statements the main thread sends. Requests on the
 * sync port are answered there and signalled through the shared Int32Array, so the main thread can wait for them
 * synchronously; requests on the async port are answered on that port.
 *
 * Transaction connections are a pool of at most `max_connections`; a transaction waits for a free one up to its lock
 * wait limit. That wait and the transaction's lock waits share the limit: the transaction's `lock_timeout` is what the
 * connection wait left of it (to within one `WAIT_MARKS`th of the limit), so each lock wait of the transaction (the
 * user lock, a row lock, the statement of an `autocommit`) ends with the connection wait within the limit, and the run
 * of a statement past its lock wait does not count against it.
 *
 * Every connect and statement has an answer limit: past it the connection is closed and the call fails as a connection
 * failure, so a PostgreSQL that does not answer (a network partition) does not hold the main thread. A connection that
 * failed or closed is dropped, and the read connection is opened again on its next statement.
 *
 * Fail fast (`storage` `### DB adapter`): once a connect or statement went over its answer limit, every statement,
 * `BEGIN` and connect fails at once as a connection failure, until a connect in the background succeeds. Each
 * background connect starts one answer wait after the one before it.
 *
 * A failure that is not a PostgreSQL answer (a `PgError`) is a worker error: the connection it happened on is closed,
 * since its protocol state is unknown, and the call fails without being a connection failure. When the thread ends
 * (for example on an uncaught exception) it stores `SIGNAL_DEAD`, so a main thread waiting for a sync answer stops.
 */
import { workerData } from 'node:worker_threads';
import { network_time_limit } from '../../server-time/network_time_limit.ts';
import {
  NO_FREE_CONNECTION,
  READ_CONN,
  ROLLED_BACK_AT_COMMIT,
  SIGNAL_ANSWERED,
  SIGNAL_DEAD,
  statement_limit_ms,
  WORKER_ERROR,
  type WorkerInput,
  type WorkerMessage,
  type WorkerRequest,
  type WorkerResult,
} from './pg_messages.ts';
import { PgConnection, PgError, tag_count, type PgResult, type PgValue } from './pg_protocol.ts';
import { TimedQueue } from './timed_queue.ts';

const input = workerData as WorkerInput;
const limits = input.limits;
const signal = new Int32Array(input.signal);

/**
 * An open transaction: its connection, its lock wait limit (its `lock_timeout`: what the wait for its connection left of
 * the lock wait), its answer wait, and whether it asked for a row lock.
 */
interface Open {
  readonly conn: PgConnection;
  readonly wait_ms: number;
  readonly answer_wait_ms: number;
  locked: boolean;
}

const conns = new Map<number, Open>();
const idle: PgConnection[] = [];
/** Transaction connections that are open, idle or being opened. */
let owned = 0;
/** Transactions waiting for a free connection, first come first. */
const waiters = new TimedQueue();
let next_conn = 1;
let read: PgConnection | null = null;
let read_opening: Promise<PgConnection> | null = null;
let closed = false;
/**
 * The async requests in flight that may commit (`commit`, `autocommit`), each until its answer is posted: `close`
 * waits for them, so a `COMMIT` already sent is answered with its outcome, not dropped (`storage` `on_commit`).
 */
const committing = new Set<Promise<void>>();
/** Why PostgreSQL is taken as not answering (fail fast), or null while it answers. */
let unanswered: string | null = null;

/** The `SET` of `lock_timeout` to `ms`, for the transaction (`LOCAL`) or the session (`SESSION`). */
function lock_timeout(scope: 'LOCAL' | 'SESSION', ms: number): string {
  return `SET ${scope} lock_timeout = '${String(ms_limit(ms))}ms'`;
}

function ms_limit(ms: number): bigint {
  return BigInt(Math.max(1, Math.trunc(ms)));
}

/** Waits until `signal` aborts. */
function until(signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    signal.addEventListener(
      'abort',
      () => {
        resolve();
      },
      { once: true },
    );
  });
}

/** Connects in the background until a connect succeeds, which ends fail fast. */
async function reconnect(): Promise<void> {
  while (!closed) {
    const next_try = network_time_limit(ms_limit(limits.answer_wait_ms));
    try {
      const conn = await PgConnection.connect(input.config, network_time_limit(ms_limit(limits.answer_wait_ms)), limits.keepalive_ms);
      conn.close();
      unanswered = null;
      return;
    } catch {
      // PostgreSQL does not answer yet: try again.
    }
    await until(next_try);
  }
}

/** A connect or statement went over its answer limit: fail fast until a background connect succeeds. */
function no_answer(reason: string): void {
  if (unanswered !== null || closed) return;
  unanswered = reason;
  void reconnect();
}

/** Throws a `CONN` PgError after `close` or while failing fast. */
function answering(): void {
  if (closed) throw new PgError('CONN', 'the PostgreSQL database is closed');
  if (unanswered !== null) throw new PgError('CONN', `${unanswered}; no statement waits for PostgreSQL until a connect in the background succeeds`);
}

/**
 * Waits for the work; past `limit_ms` it closes the connection and fails fast, so the work rejects with a `CONN`
 * PgError. A failure that is not a PgError leaves the protocol state of the connection unknown, so it closes the
 * connection too.
 */
async function within<T>(conn: PgConnection, limit_ms: number, work: () => Promise<T>): Promise<T> {
  try {
    const time_limit = network_time_limit(ms_limit(limit_ms));
    const abort = (): void => {
      const reason = `no answer from PostgreSQL within ${String(limit_ms)} ms`;
      conn.close(reason);
      no_answer(reason);
    };
    time_limit.addEventListener('abort', abort, { once: true });
    try {
      return await work();
    } finally {
      time_limit.removeEventListener('abort', abort);
    }
  } catch (error) {
    if (!(error instanceof PgError)) conn.close('a worker error left the connection in an unknown state');
    throw error;
  }
}

function answer_limit_ms(wait_ms: number, answer_wait_ms: number = limits.answer_wait_ms): number {
  return statement_limit_ms(limits, wait_ms, answer_wait_ms);
}

/** A new connection within the answer wait; one that goes over it fails fast. */
async function connect(): Promise<PgConnection> {
  answering();
  const time_limit = network_time_limit(ms_limit(limits.answer_wait_ms));
  try {
    return await PgConnection.connect(input.config, time_limit, limits.keepalive_ms);
  } catch (error) {
    if (time_limit.aborted) no_answer(`no connect to PostgreSQL within ${String(limits.answer_wait_ms)} ms`);
    throw error;
  }
}

/** Lets the first waiting transaction look for a connection again. */
function wake(): void {
  waiters.wake();
}

/** Closes a transaction connection for good; its pool slot is free. */
function discard(conn: PgConnection): void {
  conn.close();
  owned -= 1;
  wake();
}

/** Ends the use of a transaction connection: back to the pool, or discarded when it failed. */
function release(conn: PgConnection): void {
  if (conn.failed || closed) {
    discard(conn);
    return;
  }
  idle.push(conn);
  wake();
}

/** Waits until a connection may be free; rejects when the time limit passes first. */
function free_slot(time_limit: AbortSignal): Promise<void> {
  return waiters.wait(time_limit, () => new PgError(NO_FREE_CONNECTION, `no free PostgreSQL connection of ${String(limits.max_connections)} within the lock wait`));
}

/** The marks of a `Wait`: what is left of it is known to within one `1 / WAIT_MARKS` of it. */
const WAIT_MARKS = 20;

/**
 * A wait for a free connection of `wait_ms`, measured with network time limits only (`server-time`: storage's waits are
 * real time): `time_limit` aborts at its end, and marks spread over it tell how much of it is left.
 */
class Wait {
  readonly time_limit: AbortSignal;
  private readonly wait_ms: number;
  /** `at[i]` ms after the start, `marks[i]` aborts; the last one is `time_limit`. */
  private readonly at: number[] = [];
  private readonly marks: AbortSignal[] = [];

  constructor(wait_ms: number) {
    this.wait_ms = Math.max(1, Math.trunc(wait_ms));
    const count = Math.min(WAIT_MARKS, this.wait_ms);
    for (let i = 1; i <= count; i += 1) {
      const at = Math.ceil((i * this.wait_ms) / count);
      this.at.push(at);
      this.marks.push(network_time_limit(BigInt(at)));
    }
    this.time_limit = this.marks[this.marks.length - 1] as AbortSignal;
  }

  /**
   * What is left of the wait: the time to its end from the last mark that aborted, so at most one mark gap more than
   * the time really left; 0 once it ended. Marks abort in order, as their timers end in order.
   */
  left_ms(): number {
    let passed = 0;
    for (const [i, mark] of this.marks.entries()) {
      if (!mark.aborted) break;
      passed = this.at[i] as number;
    }
    return this.wait_ms - passed;
  }
}

/**
 * A transaction connection: an idle one, a new one under the limit, or one freed within `wait_ms`. `waited`: the end
 * of that wait, from the first wait for a free one; it is the given `waited` (or null when no call waited), so a caller
 * that takes a connection again goes on with the same end.
 */
async function take_conn(wait_ms: number, given: Wait | null): Promise<{ conn: PgConnection; fresh: boolean; waited: Wait | null }> {
  let waited = given;
  for (;;) {
    if (closed) throw new PgError('CONN', 'the PostgreSQL database is closed');
    const ready = idle.pop();
    if (ready !== undefined) {
      if (!ready.failed) return { conn: ready, fresh: false, waited };
      discard(ready);
      continue;
    }
    if (owned < limits.max_connections) {
      owned += 1;
      try {
        return { conn: await connect(), fresh: true, waited };
      } catch (error) {
        owned -= 1;
        wake();
        throw error;
      }
    }
    waited ??= new Wait(wait_ms);
    await free_slot(waited.time_limit);
  }
}

function open_of(id: number): Open {
  const open = conns.get(id);
  if (open === undefined) throw new PgError('CONN', `connection ${String(id)} is not open`);
  return open;
}

/** One statement of an open transaction within its answer limit; while failing fast it rejects at once. */
async function statement(open: Open, sql: string, params: readonly PgValue[] = []): Promise<PgResult> {
  answering();
  return within(open.conn, answer_limit_ms(open.wait_ms, open.answer_wait_ms), () => open.conn.execute(sql, params));
}

/** Opens a transaction and runs its first statement, if any: the transaction's id and that statement's result (none: no rows). */
async function open_tx(lock_wait_ms: number, answer_wait_ms: number, first: { sql: string; params: readonly PgValue[] } | null): Promise<{ id: number; first: PgResult }> {
  let waited: Wait | null = null;
  for (;;) {
    // Before taking a connection, so failing fast does not drop the idle ones.
    answering();
    const taken = await take_conn(lock_wait_ms, waited);
    const { conn, fresh } = taken;
    waited = taken.waited;
    // What the wait for the connection left of the lock wait: the lock wait limit of each of the transaction's locks.
    const wait_ms = waited === null ? lock_wait_ms : waited.left_ms();
    if (wait_ms < 1) {
      release(conn);
      throw new PgError(NO_FREE_CONNECTION, 'the wait for a free PostgreSQL connection left nothing of the lock wait');
    }
    const id = next_conn;
    next_conn += 1;
    const open: Open = { conn, wait_ms, answer_wait_ms, locked: false };
    conns.set(id, open);
    try {
      await statement(open, 'BEGIN');
    } catch (error) {
      conns.delete(id);
      discard(conn);
      // A pooled connection the server closed while it was idle: take another one.
      if (!fresh && error instanceof PgError && error.code === 'CONN') continue;
      throw error;
    }
    try {
      await statement(open, lock_timeout('LOCAL', wait_ms));
      if (first === null) return { id, first: { rows: [], tag: '' } };
      return { id, first: await statement(open, first.sql, first.params) };
    } catch (error) {
      if (conns.has(id)) await end(id, 'ROLLBACK');
      throw error;
    }
  }
}

/**
 * A row lock (`DbTxConn.lock_key`): a session advisory lock, so a `ROLLBACK TO SAVEPOINT` does not release it, as a
 * transaction-level advisory lock taken after the savepoint would be. `end` releases it after the transaction ends.
 */
async function lock(id: number, key: bigint): Promise<WorkerResult> {
  const open = open_of(id);
  open.locked = true;
  await statement(open, 'SELECT pg_advisory_lock(CAST($1 AS BIGINT)) AS locked', [key]);
  return { ok: true, conn: id, rows: [], count: 0 };
}

/** Releases the row locks of an ended transaction; `false` when that failed, so the connection is closed instead. */
async function unlocked(open: Open): Promise<boolean> {
  if (!open.locked) return true;
  try {
    await statement(open, 'SELECT pg_advisory_unlock_all()');
    return true;
  } catch {
    return false;
  }
}

/** Ends a transaction. A `COMMIT` that PostgreSQL answers with another tag rolled back: it fails. */
async function end(id: number, sql: 'COMMIT' | 'ROLLBACK'): Promise<WorkerResult> {
  const open = open_of(id);
  conns.delete(id);
  let result: PgResult;
  try {
    result = await statement(open, sql);
  } catch (error) {
    discard(open.conn);
    if (sql === 'ROLLBACK') return { ok: true, conn: id, rows: [], count: 0 };
    throw error;
  }
  if (await unlocked(open)) release(open.conn);
  else discard(open.conn);
  if (sql === 'COMMIT' && result.tag !== 'COMMIT') throw new PgError(ROLLED_BACK_AT_COMMIT, `PostgreSQL ended the transaction with ${result.tag || 'no tag'} at COMMIT`);
  return { ok: true, conn: id, rows: [], count: 0 };
}

async function begin(lock_wait_ms: number, answer_wait_ms: number, first: { sql: string; params: readonly PgValue[] } | null): Promise<WorkerResult> {
  const begun = await open_tx(lock_wait_ms, answer_wait_ms, first);
  return { ok: true, conn: begun.id, rows: begun.first.rows, count: 0 };
}

/** One statement in its own transaction; its lock wait shares the limit with the connection wait, as in any transaction. */
async function autocommit(lock_wait_ms: number, sql: string, params: readonly PgValue[]): Promise<WorkerResult> {
  const begun = await open_tx(lock_wait_ms, limits.answer_wait_ms, { sql, params });
  await end(begun.id, 'COMMIT');
  return { ok: true, conn: begun.id, rows: begun.first.rows, count: tag_count(begun.first.tag) };
}

/**
 * The read connection: a read-only session whose `lock_timeout` is `read_wait_ms`, so a read's lock wait ends there as
 * a lock failure and only the answer past it counts against the answer wait.
 */
async function open_read(): Promise<PgConnection> {
  const conn = await connect();
  try {
    await within(conn, answer_limit_ms(limits.read_wait_ms), () => conn.query('SET SESSION CHARACTERISTICS AS TRANSACTION READ ONLY'));
    await within(conn, answer_limit_ms(limits.read_wait_ms), () => conn.query(lock_timeout('SESSION', limits.read_wait_ms)));
  } catch (error) {
    conn.close();
    throw error;
  }
  return conn;
}

/** The read connection; one that failed or closed is opened again. */
async function read_conn(): Promise<PgConnection> {
  if (closed) throw new PgError('CONN', 'the PostgreSQL database is closed');
  if (read !== null && !read.failed) return read;
  read?.close();
  read = null;
  read_opening ??= open_read().finally(() => {
    read_opening = null;
  });
  const conn = await read_opening;
  read = conn;
  return conn;
}

async function query(id: number, sql: string, params: readonly PgValue[]): Promise<WorkerResult> {
  if (id !== READ_CONN) return { ok: true, conn: id, rows: (await statement(open_of(id), sql, params)).rows, count: 0 };
  answering();
  const conn = await read_conn();
  const rows = await within(conn, answer_limit_ms(limits.read_wait_ms), () => conn.query(sql, params));
  return { ok: true, conn: id, rows, count: 0 };
}

async function open(): Promise<WorkerResult> {
  await read_conn();
  return { ok: true, conn: READ_CONN, rows: [], count: 0 };
}

/**
 * Closes every connection but the ones of a `COMMIT` in flight, then waits for those: each ends within its answer
 * limit, and its answer is posted before this one, so the main thread delivers it before it fails the other calls.
 */
async function close(): Promise<WorkerResult> {
  closed = true;
  for (const open of conns.values()) open.conn.close();
  for (const conn of idle) conn.close();
  conns.clear();
  idle.length = 0;
  owned = 0;
  waiters.wake_all();
  read?.close();
  read = null;
  await Promise.allSettled([...committing]);
  return { ok: true, conn: READ_CONN, rows: [], count: 0 };
}

function run(request: WorkerRequest): Promise<WorkerResult> | WorkerResult {
  switch (request.op) {
    case 'open':
      return open();
    case 'begin':
      return begin(request.lock_wait_ms, request.answer_wait_ms, request.first);
    case 'query':
      return query(request.conn, request.sql, request.params);
    case 'lock':
      return lock(request.conn, request.key);
    case 'commit':
      return end(request.conn, 'COMMIT');
    case 'rollback':
      return end(request.conn, 'ROLLBACK');
    case 'autocommit':
      return autocommit(request.lock_wait_ms, request.sql, request.params);
    case 'close':
      return close();
  }
}

async function handle(request: WorkerRequest): Promise<WorkerResult> {
  try {
    return await run(request);
  } catch (error) {
    if (error instanceof PgError) return { ok: false, code: error.code, message: error.message };
    return { ok: false, code: WORKER_ERROR, message: `PostgreSQL worker error: ${error instanceof Error ? error.message : String(error)}` };
  }
}

process.on('exit', () => {
  Atomics.store(signal, 0, SIGNAL_DEAD);
  Atomics.notify(signal, 0);
});

input.sync_port.on('message', (message: WorkerMessage) => {
  void handle(message.request).then((result) => {
    input.sync_port.postMessage({ id: message.id, result });
    Atomics.store(signal, 0, SIGNAL_ANSWERED);
    Atomics.notify(signal, 0);
  });
});

input.async_port.on('message', (message: WorkerMessage) => {
  const job = handle(message.request).then((result) => {
    input.async_port.postMessage({ id: message.id, result });
  });
  if (message.request.op !== 'commit' && message.request.op !== 'autocommit') return;
  committing.add(job);
  void job.finally(() => committing.delete(job));
});
