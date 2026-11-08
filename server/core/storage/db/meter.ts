/**
 * The DB wait state and the DB metrics of one server instance (`storage` `### DB adapter`): each synchronous DB call
 * stores 1 in element 0 of the array `watch_db_wait` gave while the thread waits for the answer of the DB, and adds
 * to the count and the real elapsed time of synchronous DB calls; each statement, `lock_game_row` call and
 * transaction start that fails with a lock or connection failure adds to its failure count.
 */
import { create_system_clock } from '../../server-time/adapters/system_clock.ts';
import { DbError, type BeginOptions, type Begun, type DbAdapter, type DbConn, type DbTxConn, type DbValue, type Row, type Statement } from './types.ts';

/** The counts of `read_db_metrics` from the server start of the server instance. */
export interface DbCounts {
  readonly sync_calls: number;
  readonly sync_wait_ms: number;
  readonly lock_failures: number;
  readonly connection_failures: number;
}

/** Real elapsed time: the system clock adapter of `server-time`, never the test clock a DEV run sets. */
const real_clock = create_system_clock();

export class DbMeter {
  private watch: Int32Array | null = null;
  private calls = 0;
  private wait_ms = 0;
  private locks = 0;
  private connections = 0;

  /** The array whose element 0 is the DB wait state. */
  watch_with(array: Int32Array): void {
    this.watch = array;
  }

  /** Runs one synchronous DB call: the DB wait state is 1 while it runs, and the call is counted with its wait. */
  sync<T>(call: () => T): T {
    const watch = this.watch;
    if (watch !== null) Atomics.store(watch, 0, 1);
    const started = real_clock.now();
    try {
      return call();
    } finally {
      const ended = real_clock.now();
      if (ended > started) this.wait_ms += Number(ended - started);
      this.calls += 1;
      if (watch !== null) Atomics.store(watch, 0, 0);
    }
  }

  /** Counts a failure of a statement, a `lock_game_row` call or a transaction start by its kind. */
  failed(error: unknown): void {
    if (!(error instanceof DbError)) return;
    if (error.kind === 'lock') this.locks += 1;
    else if (error.kind === 'connection') this.connections += 1;
  }

  counts(): DbCounts {
    return { sync_calls: this.calls, sync_wait_ms: this.wait_ms, lock_failures: this.locks, connection_failures: this.connections };
  }
}

function counted<T>(meter: DbMeter, call: () => T): T {
  try {
    return call();
  } catch (error) {
    meter.failed(error);
    throw error;
  }
}

async function counted_async<T>(meter: DbMeter, call: () => Promise<T>): Promise<T> {
  try {
    return await call();
  } catch (error) {
    meter.failed(error);
    throw error;
  }
}

/** A transaction connection whose failed statements, row locks and commits are counted. */
class CountedTx implements DbTxConn {
  private readonly inner: DbTxConn;
  private readonly meter: DbMeter;

  constructor(inner: DbTxConn, meter: DbMeter) {
    this.inner = inner;
    this.meter = meter;
  }

  query(sql: string, params?: readonly DbValue[]): Row[] {
    return counted(this.meter, () => this.inner.query(sql, params));
  }

  lock_key(key: bigint): void {
    counted(this.meter, () => {
      this.inner.lock_key(key);
    });
  }

  commit(): Promise<void> {
    return counted_async(this.meter, () => this.inner.commit());
  }

  commit_sync(): void {
    counted(this.meter, () => {
      this.inner.commit_sync();
    });
  }

  rollback(): Promise<void> {
    return this.inner.rollback();
  }

  rollback_sync(): void {
    this.inner.rollback_sync();
  }
}

/**
 * The adapter whose statements and transaction starts count their lock and connection failures in `meter`. A read
 * statement that runs once more on a new connection and a transaction start that takes another connection give one
 * result, so each counts once.
 */
export function counting_adapter(inner: DbAdapter, meter: DbMeter): DbAdapter {
  const begun = (result: Begun): Begun => ({ conn: new CountedTx(result.conn, meter), rows: result.rows });
  const read: DbConn = { query: (sql, params) => counted(meter, () => inner.read.query(sql, params)) };
  return {
    dialect: inner.dialect,
    open: () => {
      inner.open();
    },
    begin: async (options: BeginOptions) => begun(await counted_async(meter, () => inner.begin(options))),
    begin_sync: (options: BeginOptions) => begun(counted(meter, () => inner.begin_sync(options))),
    autocommit: (statement: Statement, lock_wait_ms: number) => counted_async(meter, () => inner.autocommit(statement, lock_wait_ms)),
    read,
    close: () => {
      inner.close();
    },
  };
}
