import { DatabaseSync, type SQLInputValue, type StatementSync } from 'node:sqlite';
import { network_time_limit } from '../../server-time/network_time_limit.ts';
import type { DbMeter } from './meter.ts';
import { TimedQueue } from './timed_queue.ts';
import { check_text_param, DbError, type BeginOptions, type Begun, type DbAdapter, type DbConn, type DbTxConn, type DbValue, type Row, type Statement } from './types.ts';

const SQLITE_BUSY = 5;
const SQLITE_LOCKED = 6;
const SQLITE_READONLY = 8;
const SQLITE_CANTOPEN = 14;

/**
 * The waits between `BEGIN IMMEDIATE` tries while another connection holds the write lock: the delays of SQLite's own
 * busy handler (`sqliteDefaultBusyCallback`), then its last delay again.
 */
const BUSY_DELAYS_MS = [1, 2, 5, 10, 15, 20, 25, 25, 25, 50, 50, 100];

/** Waits `ms` of real time, or until `stop` aborts. */
function pause(ms: number, stop: AbortSignal): Promise<void> {
  if (stop.aborted) return Promise.resolve();
  const delay = network_time_limit(BigInt(ms));
  return new Promise((resolve) => {
    const done = (): void => {
      delay.removeEventListener('abort', done);
      stop.removeEventListener('abort', done);
      resolve();
    };
    delay.addEventListener('abort', done, { once: true });
    stop.addEventListener('abort', done, { once: true });
  });
}

/** Maps a node:sqlite error to a DbError. */
function db_error(error: unknown): DbError {
  if (error instanceof DbError) return error;
  const errcode = (error as { errcode?: unknown }).errcode;
  const message = error instanceof Error ? error.message : String(error);
  const primary = typeof errcode === 'number' ? errcode & 0xff : -1;
  if (primary === SQLITE_BUSY || primary === SQLITE_LOCKED) return new DbError('lock', String(errcode), message);
  if (primary === SQLITE_READONLY) return new DbError('readonly', String(errcode), message);
  if (primary === SQLITE_CANTOPEN) return new DbError('connection', String(errcode), message);
  return new DbError('sql', String(errcode), message);
}

function param(value: DbValue): SQLInputValue {
  if (typeof value === 'boolean') return value ? 1 : 0;
  check_text_param(value);
  return value;
}

/** A column value by its declared type: `INT` is int32, `BOOLEAN` is bool, every other integer is int64. */
function value_of(value: unknown, declared: string | null): DbValue {
  if (typeof value === 'bigint') {
    if (declared === 'INT') return Number(value);
    if (declared === 'BOOLEAN') return value !== 0n;
    return value;
  }
  return value as DbValue;
}

/**
 * One async lock: the SQLite write connection runs one transaction at a time. Waiters get it first come first; one
 * that waits over its limit gives up with a `lock` DbError and leaves the queue.
 */
class Mutex {
  private held = false;
  private readonly queue = new TimedQueue();

  /** Resolves with the release function; rejects past `wait_ms` of real time. */
  lock(wait_ms: number): Promise<() => void> {
    if (!this.held) {
      this.held = true;
      const release = this.releaser();
      // Two promise steps, as the promise chain this lock replaced took: a job that server-time starts in its
      // `complete_start` then opens its `BEGIN IMMEDIATE` after storage's schema step, which `begin_sync` runs on the
      // same connection outside this lock.
      return Promise.resolve().then(() => release);
    }
    const time_limit = network_time_limit(BigInt(Math.max(1, Math.trunc(wait_ms))));
    const timed_out = (): DbError => new DbError('lock', 'busy', `the SQLite write transaction of this server instance went on over the lock wait of ${String(wait_ms)} ms`);
    return this.queue.wait(time_limit, timed_out).then(() => this.releaser());
  }

  /** Hands the lock to the next waiter; a second call does nothing. */
  private releaser(): () => void {
    let released = false;
    return () => {
      if (released) return;
      released = true;
      if (!this.queue.wake()) this.held = false;
    };
  }
}

/** One node:sqlite connection: every statement is a synchronous DB call of the meter. */
class Connection implements DbConn {
  private readonly db: DatabaseSync;
  private readonly meter: DbMeter | null;
  private readonly cache = new Map<string, StatementSync>();

  constructor(db: DatabaseSync, meter: DbMeter | null) {
    this.db = db;
    this.meter = meter;
  }

  query(sql: string, params: readonly DbValue[] = []): Row[] {
    return this.call(() => {
      const statement = this.prepare(sql);
      const columns = statement.columns();
      return statement.all(...params.map(param)).map((raw) => {
        const row: Row = {};
        for (const column of columns) row[column.name] = value_of(raw[column.name], column.type);
        return row;
      });
    });
  }

  /** Runs one statement; the number of rows it changed. */
  run(sql: string, params: readonly DbValue[] = []): number {
    return this.call(() => Number(this.prepare(sql).run(...params.map(param)).changes));
  }

  exec(sql: string): void {
    this.call(() => {
      this.db.exec(sql);
    });
  }

  private call<T>(fn: () => T): T {
    try {
      return this.meter === null ? fn() : this.meter.sync(fn);
    } catch (error) {
      throw db_error(error);
    }
  }

  private prepare(sql: string): StatementSync {
    let statement = this.cache.get(sql);
    if (statement === undefined) {
      statement = this.db.prepare(sql.replace(/\$(\d+)/g, '?$1'));
      this.cache.set(sql, statement);
    }
    return statement;
  }
}

class Transaction implements DbTxConn {
  private readonly conn: Connection;
  private readonly release: () => void;
  private open = true;

  constructor(conn: Connection, release: () => void) {
    this.conn = conn;
    this.release = release;
  }

  query(sql: string, params?: readonly DbValue[]): Row[] {
    if (!this.open) throw new DbError('sql', 'closed', 'the transaction has ended');
    return this.conn.query(sql, params);
  }

  /** Runs one statement; the number of rows it changed. */
  run(sql: string, params?: readonly DbValue[]): number {
    if (!this.open) throw new DbError('sql', 'closed', 'the transaction has ended');
    return this.conn.run(sql, params);
  }

  /** The SQLite write transaction already holds the whole database. */
  lock_key(): void {
    if (!this.open) throw new DbError('sql', 'closed', 'the transaction has ended');
  }

  commit(): Promise<void> {
    this.commit_sync();
    return Promise.resolve();
  }

  commit_sync(): void {
    if (!this.open) throw new DbError('sql', 'closed', 'the transaction has ended');
    try {
      this.conn.exec('COMMIT');
    } catch (error) {
      this.rollback_sync();
      throw error;
    }
    this.end();
  }

  rollback(): Promise<void> {
    this.rollback_sync();
    return Promise.resolve();
  }

  rollback_sync(): void {
    if (!this.open) return;
    try {
      this.conn.exec('ROLLBACK');
    } catch {
      // No transaction is open after a failed COMMIT or a closed connection.
    }
    this.end();
  }

  private end(): void {
    this.open = false;
    this.release();
  }
}

/** The pause between two tries of setting WAL at open. */
const WAL_RETRY_MS = 5;
const WAL_PAUSE = new Int32Array(new SharedArrayBuffer(4));

/** True for `SQLITE_BUSY` and `SQLITE_LOCKED` (`database is locked`). */
function is_busy(error: unknown): boolean {
  const code = (error as { errcode?: unknown } | null)?.errcode;
  return code === 5 || code === 6 || (error instanceof Error && error.message.includes('database is locked'));
}

/**
 * SQLite: WAL journal, one write connection whose transactions open with `BEGIN IMMEDIATE` one at a time, and a
 * separate read connection. A transaction waits for the one before it on this connection up to the lock wait limit
 * (`storage` user serialization), then its `BEGIN IMMEDIATE` waits for another connection's write transaction up to
 * the lock wait limit by trying again (busy timeout 0). Neither wait blocks the thread.
 */
export class SqliteAdapter implements DbAdapter {
  readonly dialect = 'sqlite' as const;
  private readonly path: string;
  private writer: Connection | null = null;
  private reader: Connection | null = null;
  private handles: DatabaseSync[] = [];
  private readonly mutex = new Mutex();
  private readonly meter: DbMeter | null;
  private readonly open_wait_ms: number;

  /**
   * `meter`: where the synchronous DB calls go (`DbMeter`). `open_wait_ms`: how long setting the journal mode at
   * open waits for another connection to the same file (`storage.schemaLockWaitMs`), so server instances started
   * together on one new file open one at a time, as their schema step runs.
   */
  constructor(path: string, meter: DbMeter | null = null, open_wait_ms = 0) {
    this.path = path;
    this.meter = meter;
    this.open_wait_ms = open_wait_ms;
  }

  open(): void {
    try {
      const write = new DatabaseSync(this.path, { readBigInts: true });
      this.handles.push(write);
      this.sync(() => {
        write.exec('PRAGMA busy_timeout = 0');
      });
      // One synchronous DB call: the thread blocks through every try and every pause between them.
      this.sync(() => {
        this.set_wal(write);
      });
      const read = new DatabaseSync(this.path, { readOnly: true, readBigInts: true });
      this.handles.push(read);
      this.writer = new Connection(write, this.meter);
      this.reader = new Connection(read, this.meter);
    } catch (error) {
      this.close();
      const failure = db_error(error);
      throw new DbError('connection', failure.code, `cannot open SQLite database ${this.path}: ${failure.message}`);
    }
  }

  /**
   * `PRAGMA journal_mode = WAL`. While another connection opens the same new file, SQLite answers it with
   * `SQLITE_BUSY` without its busy handler, so it tries again every `WAL_RETRY_MS`, blocking the thread like the
   * schema step of server start, for up to `open_wait_ms`.
   */
  private set_wal(write: DatabaseSync): void {
    const tries = Math.max(1, Math.ceil(this.open_wait_ms / WAL_RETRY_MS));
    for (let attempt = 1; ; attempt += 1) {
      try {
        write.exec('PRAGMA journal_mode = WAL');
        return;
      } catch (error) {
        if (attempt >= tries || !is_busy(error)) throw error;
        Atomics.wait(WAL_PAUSE, 0, 0, WAL_RETRY_MS);
      }
    }
  }

  /** Runs a statement of `open` outside a `Connection` as a synchronous DB call of the meter. */
  private sync<T>(call: () => T): T {
    return this.meter === null ? call() : this.meter.sync(call);
  }

  get read(): DbConn {
    return this.required(this.reader);
  }

  begin(options: BeginOptions): Promise<Begun> {
    return this.begin_tx(options);
  }

  private async begin_tx(options: BeginOptions): Promise<{ conn: Transaction; rows: Row[] }> {
    const release = await this.mutex.lock(options.lock_wait_ms);
    try {
      const busy = this.begin_immediate(options.lock_wait_ms);
      if (busy !== null) await busy;
      return this.started(options, release);
    } catch (error) {
      release();
      throw error;
    }
  }

  /**
   * Server start's blocking `begin`: its `BEGIN IMMEDIATE` waits for another connection's write transaction with a
   * busy timeout of the lock wait limit, blocking the thread. Nothing else of this server instance runs yet.
   */
  begin_sync(options: BeginOptions): Begun {
    const writer = this.required(this.writer);
    writer.exec(`PRAGMA busy_timeout = ${String(Math.max(0, Math.trunc(options.lock_wait_ms)))}`);
    try {
      writer.exec('BEGIN IMMEDIATE');
    } finally {
      writer.exec('PRAGMA busy_timeout = 0');
    }
    return this.started(options, () => undefined);
  }

  async autocommit(statement: Statement, lock_wait_ms: number): Promise<number> {
    const { conn } = await this.begin_tx({ lock_wait_ms, first: null });
    try {
      const count = conn.run(statement.sql, statement.params);
      conn.commit_sync();
      return count;
    } catch (error) {
      conn.rollback_sync();
      throw error;
    }
  }

  close(): void {
    for (const handle of this.handles) {
      try {
        if (handle.isOpen) handle.close();
      } catch {
        // Closing a handle that is gone already.
      }
    }
    this.handles = [];
    this.writer = null;
    this.reader = null;
  }

  /**
   * `BEGIN IMMEDIATE` with busy timeout 0: null when it began. While another connection to the file holds the write
   * lock, the promise of the tries after it: each after SQLite's busy handler delay, without blocking the thread,
   * until `lock_wait_ms` of real time passed. The first try runs at once, so a transaction that does not wait opens in
   * the same promise step as before the tries.
   */
  private begin_immediate(lock_wait_ms: number): Promise<void> | null {
    if (this.try_begin()) return null;
    return this.retry_begin(lock_wait_ms);
  }

  private async retry_begin(lock_wait_ms: number): Promise<void> {
    const time_limit = network_time_limit(BigInt(Math.max(1, Math.trunc(lock_wait_ms))));
    for (let tries = 0; ; tries += 1) {
      await pause(BUSY_DELAYS_MS[Math.min(tries, BUSY_DELAYS_MS.length - 1)] ?? 100, time_limit);
      if (this.try_begin()) return;
      if (time_limit.aborted) {
        throw new DbError('lock', 'busy', `another connection to the SQLite database held its write transaction over the lock wait of ${String(lock_wait_ms)} ms`);
      }
    }
  }

  /** One `BEGIN IMMEDIATE`: false while another connection holds the write lock. */
  private try_begin(): boolean {
    try {
      this.required(this.writer).exec('BEGIN IMMEDIATE');
      return true;
    } catch (error) {
      if (error instanceof DbError && error.kind === 'lock') return false;
      throw error;
    }
  }

  /** The transaction after its `BEGIN IMMEDIATE`, with the first statement run. */
  private started(options: BeginOptions, release: () => void): { conn: Transaction; rows: Row[] } {
    const writer = this.required(this.writer);
    const conn = new Transaction(writer, release);
    if (options.first === null) return { conn, rows: [] };
    try {
      return { conn, rows: conn.query(options.first.sql, options.first.params) };
    } catch (error) {
      conn.rollback_sync();
      throw error;
    }
  }

  private required(conn: Connection | null): Connection {
    if (conn === null) throw new DbError('connection', 'closed', 'the SQLite database is not open');
    return conn;
  }
}
