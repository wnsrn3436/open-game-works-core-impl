import { MessageChannel, receiveMessageOnPort, Worker, type MessagePort } from 'node:worker_threads';
import { parse_connection_string, PgError, type PgValue } from './pg_protocol.ts';
import {
  answer_bound_ms,
  READ_CONN,
  SIGNAL_ANSWERED,
  SIGNAL_DEAD,
  SIGNAL_WAITING,
  type PgLimits,
  type WorkerInput,
  type WorkerMessage,
  type WorkerRequest,
  type WorkerResult,
} from './pg_messages.ts';
import { DbError, type BeginOptions, type Begun, type DbAdapter, type DbConn, type DbTxConn, type DbValue, type Row, type Statement } from './types.ts';

/** SQLSTATE of a lock wait over `lock_timeout`, a deadlock and a serialization failure. */
const LOCK_CODES = new Set(['55P03', '40P01', '40001']);
const READ_ONLY_CODE = '25006';

function db_error(code: string, message: string): DbError {
  if (LOCK_CODES.has(code)) return new DbError('lock', code, message);
  if (code === 'CONN' || code.startsWith('08') || code.startsWith('57P')) return new DbError('connection', code, message);
  if (code === READ_ONLY_CODE) return new DbError('readonly', code, message);
  return new DbError('sql', code, message);
}

function params_of(params: readonly DbValue[]): PgValue[] {
  return params.map((p) => p);
}

interface Answer {
  conn: number;
  rows: Row[];
  count: number;
}

/** The waits of a call that may commit: the worker's `close` waits for it within its statement limit. */
interface CommitWaits {
  readonly wait_ms: number;
  readonly answer_wait_ms: number;
}

interface Pending {
  resolve(result: WorkerResult): void;
  readonly commit: CommitWaits | null;
}

/**
 * The main thread side of the worker: blocking calls through the sync port, promise calls through the async port.
 *
 * The worker ends every wait and statement at its limit, so a live worker answers a sync call within
 * `answer_bound_ms`. A blocking call waits that long and one answer wait (the larger of the transaction's and
 * `answer_wait_ms`) more; past it, or when the worker
 * stored `SIGNAL_DEAD`, the worker is dead: it is terminated, every call of this bridge fails as a connection failure,
 * and the adapter starts a new worker for the calls after it.
 */
class Bridge {
  private readonly worker: Worker;
  private readonly limits: PgLimits;
  private readonly signal: Int32Array;
  private readonly sync_port: MessagePort;
  private readonly async_port: MessagePort;
  private readonly pending = new Map<number, Pending>();
  private next_id = 1;
  private closed = false;
  /** Why the worker is gone, or null while it runs. */
  private dead: string | null = null;

  constructor(connection_string: string, limits: PgLimits, worker_url: URL) {
    const config = parse_connection_string(connection_string);
    this.limits = limits;
    const shared = new SharedArrayBuffer(4);
    this.signal = new Int32Array(shared);
    const sync = new MessageChannel();
    const async = new MessageChannel();
    this.sync_port = sync.port1;
    this.async_port = async.port1;
    const input: WorkerInput = { config, limits, signal: shared, sync_port: sync.port2, async_port: async.port2 };
    this.worker = new Worker(worker_url, { workerData: input, transferList: [sync.port2, async.port2] });
    this.worker.unref();
    this.worker.on('error', (error: Error) => {
      this.die(`the PostgreSQL worker failed: ${error.message}`);
    });
    this.worker.on('exit', (code: number) => {
      this.die(`the PostgreSQL worker ended with exit code ${String(code)}`);
    });
    this.async_port.on('message', (message: { id: number; result: WorkerResult }) => {
      this.deliver(message);
    });
    this.async_port.unref();
  }

  /** True once the worker is gone: every later call fails. */
  get gone(): boolean {
    return this.dead !== null;
  }

  /** A blocking call whose lock wait limit is `wait_ms`, in a transaction whose answer wait is `answer_wait_ms`. */
  call_sync(request: WorkerRequest, wait_ms: number, answer_wait_ms: number = this.limits.answer_wait_ms): Answer {
    const id = this.message_id();
    // A worker that ended already stored SIGNAL_DEAD: only an earlier answer's signal goes back to waiting.
    Atomics.compareExchange(this.signal, 0, SIGNAL_ANSWERED, SIGNAL_WAITING);
    this.sync_port.postMessage({ id, request } satisfies WorkerMessage);
    const limit_ms = answer_bound_ms(this.limits, wait_ms, answer_wait_ms) + Math.max(answer_wait_ms, this.limits.answer_wait_ms);
    for (;;) {
      const waited = Atomics.wait(this.signal, 0, SIGNAL_WAITING, limit_ms);
      const received = receiveMessageOnPort(this.sync_port);
      if (received !== undefined) return this.answer((received.message as { result: WorkerResult }).result);
      if (Atomics.load(this.signal, 0) === SIGNAL_DEAD) this.die('the PostgreSQL worker ended');
      else if (waited === 'timed-out') this.die(`no answer from the PostgreSQL worker within ${String(limit_ms)} ms`);
      else {
        Atomics.compareExchange(this.signal, 0, SIGNAL_ANSWERED, SIGNAL_WAITING);
        continue;
      }
      throw this.gone_error();
    }
  }

  /** A promise call; `commit`: the waits of a call that may commit, which `close` lets end. */
  async call(request: WorkerRequest, commit: CommitWaits | null = null): Promise<Answer> {
    const id = this.message_id();
    const result = await new Promise<WorkerResult>((resolve) => {
      this.pending.set(id, { resolve, commit });
      this.async_port.ref();
      this.async_port.postMessage({ id, request } satisfies WorkerMessage);
    });
    return this.answer(result);
  }

  /**
   * Closes the worker. A `COMMIT` it already sent may commit (`storage` `on_commit`): the worker's `close` waits for
   * it within its statement limit and answers it first, so its answer is delivered here, not failed.
   */
  close(): void {
    if (this.closed) return;
    if (this.dead === null) {
      let wait_ms = 0;
      let answer_wait_ms = this.limits.answer_wait_ms;
      for (const pending of this.pending.values()) {
        if (pending.commit === null) continue;
        wait_ms = Math.max(wait_ms, pending.commit.wait_ms);
        answer_wait_ms = Math.max(answer_wait_ms, pending.commit.answer_wait_ms);
      }
      try {
        this.call_sync({ op: 'close' }, wait_ms, answer_wait_ms);
      } catch {
        // The worker is gone already.
      }
      for (let received = receiveMessageOnPort(this.async_port); received !== undefined; received = receiveMessageOnPort(this.async_port)) {
        this.deliver(received.message as { id: number; result: WorkerResult });
      }
    }
    this.closed = true;
    this.fail_pending('the database is closed');
    this.sync_port.close();
    this.async_port.close();
    void this.worker.terminate();
  }

  /** Marks the worker gone and fails the calls waiting for it; its connections close with the thread. */
  private die(reason: string): void {
    if (this.dead !== null || this.closed) return;
    this.dead = reason;
    this.fail_pending(reason);
    void this.worker.terminate();
  }

  private deliver(message: { id: number; result: WorkerResult }): void {
    const pending = this.pending.get(message.id);
    this.pending.delete(message.id);
    if (this.pending.size === 0) this.async_port.unref();
    pending?.resolve(message.result);
  }

  private fail_pending(message: string): void {
    for (const pending of this.pending.values()) pending.resolve({ ok: false, code: 'CONN', message });
    this.pending.clear();
    this.async_port.unref();
  }

  private gone_error(): DbError {
    return new DbError('connection', 'CONN', this.dead ?? 'the PostgreSQL database is closed');
  }

  private message_id(): number {
    if (this.closed) throw new DbError('connection', 'CONN', 'the PostgreSQL database is closed');
    if (this.dead !== null) throw this.gone_error();
    const id = this.next_id;
    this.next_id += 1;
    return id;
  }

  private answer(result: WorkerResult): Answer {
    if (!result.ok) throw db_error(result.code, result.message);
    return { conn: result.conn, rows: result.rows, count: result.count };
  }
}

/** A transaction on one worker: when that worker is gone, every call fails as a connection failure. */
class Transaction implements DbTxConn {
  private readonly bridge: Bridge;
  private readonly conn: number;
  private readonly wait_ms: number;
  private readonly answer_wait_ms: number;
  private open = true;

  constructor(bridge: Bridge, conn: number, wait_ms: number, answer_wait_ms: number) {
    this.bridge = bridge;
    this.conn = conn;
    this.wait_ms = wait_ms;
    this.answer_wait_ms = answer_wait_ms;
  }

  query(sql: string, params: readonly DbValue[] = []): Row[] {
    this.check();
    return this.bridge.call_sync({ op: 'query', conn: this.conn, sql, params: params_of(params) }, this.wait_ms, this.answer_wait_ms).rows;
  }

  lock_key(key: bigint): void {
    this.check();
    this.bridge.call_sync({ op: 'lock', conn: this.conn, key }, this.wait_ms, this.answer_wait_ms);
  }

  async commit(): Promise<void> {
    this.check();
    this.open = false;
    await this.bridge.call({ op: 'commit', conn: this.conn }, { wait_ms: this.wait_ms, answer_wait_ms: this.answer_wait_ms });
  }

  commit_sync(): void {
    this.check();
    this.open = false;
    this.bridge.call_sync({ op: 'commit', conn: this.conn }, this.wait_ms, this.answer_wait_ms);
  }

  async rollback(): Promise<void> {
    if (!this.open) return;
    this.open = false;
    try {
      await this.bridge.call({ op: 'rollback', conn: this.conn });
    } catch {
      // The connection is closed, so nothing stays open.
    }
  }

  rollback_sync(): void {
    if (!this.open) return;
    this.open = false;
    try {
      this.bridge.call_sync({ op: 'rollback', conn: this.conn }, this.wait_ms, this.answer_wait_ms);
    } catch {
      // The connection is closed, so nothing stays open.
    }
  }

  private check(): void {
    if (!this.open) throw new DbError('sql', 'closed', 'the transaction has ended');
  }
}

/** The worker thread file. */
const WORKER_URL = new URL('./pg_worker.ts', import.meta.url);

/**
 * PostgreSQL: `READ COMMITTED` transactions, one connection each, from a pool of at most `limits.max_connections` in a
 * worker thread. A transaction sets `lock_timeout` to its lock wait limit; the read connection is a session in
 * read-only mode. When the worker is gone, the next call after the one that found it gone starts a new worker; the
 * transactions of the old one fail. A connect or statement over its answer wait makes the worker fail fast until a
 * background connect succeeds (`pg_worker.ts`).
 */
export class PostgresAdapter implements DbAdapter {
  readonly dialect = 'postgresql' as const;
  private readonly connection_string: string;
  private readonly limits: PgLimits;
  private readonly worker_url: URL;
  private bridge: Bridge | null = null;

  /** `worker_url`: the worker thread file; a core test gives one that runs the worker with a fault. */
  constructor(connection_string: string, limits: PgLimits, worker_url: URL = WORKER_URL) {
    this.connection_string = connection_string;
    this.limits = limits;
    this.worker_url = worker_url;
  }

  open(): void {
    try {
      this.bridge = new Bridge(this.connection_string, this.limits, this.worker_url);
      this.bridge.call_sync({ op: 'open' }, this.limits.read_wait_ms);
    } catch (error) {
      this.close();
      if (error instanceof DbError) throw new DbError('connection', error.code, `cannot connect to PostgreSQL: ${error.message}`);
      if (error instanceof PgError) throw new DbError('connection', error.code, error.message);
      throw error;
    }
  }

  get read(): DbConn {
    this.required();
    return { query: (sql, params = []) => this.required().call_sync({ op: 'query', conn: READ_CONN, sql, params: params_of(params) }, this.limits.read_wait_ms).rows };
  }

  async begin(options: BeginOptions): Promise<Begun> {
    const bridge = this.required();
    const answer_wait_ms = this.answer_wait_of(options);
    const answer = await bridge.call({ op: 'begin', lock_wait_ms: options.lock_wait_ms, answer_wait_ms, first: this.first(options) });
    return { conn: new Transaction(bridge, answer.conn, options.lock_wait_ms, answer_wait_ms), rows: answer.rows };
  }

  begin_sync(options: BeginOptions): Begun {
    const bridge = this.required();
    const answer_wait_ms = this.answer_wait_of(options);
    const answer = bridge.call_sync({ op: 'begin', lock_wait_ms: options.lock_wait_ms, answer_wait_ms, first: this.first(options) }, options.lock_wait_ms, answer_wait_ms);
    return { conn: new Transaction(bridge, answer.conn, options.lock_wait_ms, answer_wait_ms), rows: answer.rows };
  }

  async autocommit(statement: Statement, lock_wait_ms: number): Promise<number> {
    const commit = { wait_ms: lock_wait_ms, answer_wait_ms: this.limits.answer_wait_ms };
    return (await this.required().call({ op: 'autocommit', lock_wait_ms, sql: statement.sql, params: params_of(statement.params) }, commit)).count;
  }

  close(): void {
    this.bridge?.close();
    this.bridge = null;
  }

  private answer_wait_of(options: BeginOptions): number {
    return options.answer_wait_ms ?? this.limits.answer_wait_ms;
  }

  private first(options: BeginOptions): { sql: string; params: PgValue[] } | null {
    return options.first === null ? null : { sql: options.first.sql, params: params_of(options.first.params) };
  }

  /** The bridge of the running worker: a new one when the worker of the last one is gone. */
  private required(): Bridge {
    if (this.bridge === null) throw new DbError('connection', 'CONN', 'the PostgreSQL database is not open');
    if (this.bridge.gone) {
      this.bridge.close();
      this.bridge = new Bridge(this.connection_string, this.limits, this.worker_url);
    }
    return this.bridge;
  }
}
