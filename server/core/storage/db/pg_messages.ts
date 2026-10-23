/** The messages between the main thread and the PostgreSQL worker thread. */
import type { MessagePort } from 'node:worker_threads';
import type { PgConfig, PgRow, PgValue } from './pg_protocol.ts';

/** The waits of the PostgreSQL adapter, in ms. */
export interface PgLimits {
  /** Transaction connections at most, besides the read connection (`storage.dbMaxConnections`). */
  readonly max_connections: number;
  /** The lock wait limit of a statement on the read connection. */
  readonly read_wait_ms: number;
  /**
   * The longest wait for a connect with its authentication, and for a statement's answer past its lock wait limit
   * unless its transaction has its own answer wait.
   */
  readonly answer_wait_ms: number;
  /** The idle time after which TCP keepalive probes a connection. */
  readonly keepalive_ms: number;
}

export interface WorkerInput {
  readonly config: PgConfig;
  readonly limits: PgLimits;
  readonly signal: SharedArrayBuffer;
  readonly sync_port: MessagePort;
  readonly async_port: MessagePort;
}

export type WorkerRequest =
  | { op: 'open' }
  | { op: 'begin'; lock_wait_ms: number; answer_wait_ms: number; first: { sql: string; params: readonly PgValue[] } | null }
  | { op: 'query'; conn: number; sql: string; params: readonly PgValue[] }
  | { op: 'lock'; conn: number; key: bigint }
  | { op: 'commit'; conn: number }
  | { op: 'rollback'; conn: number }
  | { op: 'autocommit'; lock_wait_ms: number; sql: string; params: readonly PgValue[] }
  | { op: 'close' };

/** `count`: the rows the statement changed, for `autocommit`; 0 otherwise. */
export type WorkerResult = { ok: true; conn: number; rows: PgRow[]; count: number } | { ok: false; code: string; message: string };

export interface WorkerMessage {
  readonly id: number;
  readonly request: WorkerRequest;
}

/** The read connection's id. */
export const READ_CONN = 0;

/** The code of a transaction that PostgreSQL rolled back at `COMMIT` (SQLSTATE `in_failed_sql_transaction`). */
export const ROLLED_BACK_AT_COMMIT = '25P02';

/** The code of a transaction that got no connection within its wait (SQLSTATE `lock_not_available`). */
export const NO_FREE_CONNECTION = '55P03';

/** The code of a worker failure that is not a PostgreSQL answer (for example a decode error): not a connection failure. */
export const WORKER_ERROR = 'WORKER';

/** The values of the shared signal: the main thread waits on `WAITING`; the worker stores `ANSWERED` or `DEAD`. */
export const SIGNAL_WAITING = 0;
export const SIGNAL_ANSWERED = 1;
export const SIGNAL_DEAD = 2;

/**
 * The answer limit of a statement whose lock wait limit is `wait_ms`: its lock wait ends at `wait_ms` by `lock_timeout`,
 * and its answer past that waits `answer_wait_ms` (its transaction's answer wait), by default the limits' one.
 */
export function statement_limit_ms(limits: PgLimits, wait_ms: number, answer_wait_ms: number = limits.answer_wait_ms): number {
  return Math.max(0, Math.trunc(wait_ms)) + answer_wait_ms;
}

/**
 * The longest a live worker takes to answer one request whose lock wait limit is `wait_ms` and whose transaction's
 * answer wait is `answer_wait_ms`: at most four limited steps (`begin`: the wait for a free connection, a connect, then
 * `BEGIN`, `SET` and the first statement, each within `statement_limit_ms` or, for the connect, the limits' answer
 * wait; a read: a connect, `SET` and the statement).
 */
export function answer_bound_ms(limits: PgLimits, wait_ms: number, answer_wait_ms: number = limits.answer_wait_ms): number {
  return 4 * statement_limit_ms(limits, wait_ms, Math.max(answer_wait_ms, limits.answer_wait_ms));
}

