/**
 * The DB adapter interface (`storage` `### DB adapter`): SQLite and PostgreSQL behind the same synchronous queries
 * inside a transaction. A transaction opens asynchronously, so waiting for this server instance's transactions, for a
 * free connection and for the SQLite write lock of another connection does not stop other work. A synchronous
 * PostgreSQL call blocks the thread while it waits, up to its lock wait limit plus `storage.dbAnswerWaitMs`; once one
 * went over that, the calls after it fail at once until a connect in the background succeeds. Server start's
 * `begin_sync` blocks.
 */

/** A column value: `int64` is bigint, `int32` is number, `bool` is boolean, `bytes` is Uint8Array. */
export type DbValue = bigint | number | boolean | string | Uint8Array | null;
export type Row = Record<string, DbValue>;

/**
 * Why a DB call failed. `lock`: a lock wait went over its limit, a deadlock or a serialization failure.
 * `connection`: the DB is not reachable. `readonly`: a write through a read-only connection. `sql`: anything else.
 */
export type DbErrorKind = 'lock' | 'connection' | 'readonly' | 'sql';

export class DbError extends Error {
  readonly kind: DbErrorKind;
  readonly code: string;

  constructor(kind: DbErrorKind, code: string, message: string) {
    super(message);
    this.kind = kind;
    this.code = code;
  }
}

export type Dialect = 'sqlite' | 'postgresql';

/** One statement with `$1`, `$2`, ... parameters. */
export interface Statement {
  readonly sql: string;
  readonly params: readonly DbValue[];
}

/** A connection that runs statements synchronously. */
export interface DbConn {
  query(sql: string, params?: readonly DbValue[]): Row[];
}

/** A connection with an open transaction. */
export interface DbTxConn extends DbConn {
  /**
   * Locks an application key until the transaction ends; a rollback to a savepoint does not release it. Throws a
   * `lock` DbError on a wait over the limit.
   */
  lock_key(key: bigint): void;
  commit(): Promise<void>;
  commit_sync(): void;
  /** Never throws. */
  rollback(): Promise<void>;
  rollback_sync(): void;
}

export interface BeginOptions {
  /** The lock wait limit of the whole transaction, including the first statement. */
  readonly lock_wait_ms: number;
  /**
   * The answer wait of each statement of the transaction past its lock wait limit; when not given, the adapter's
   * (`storage.dbAnswerWaitMs`). SQLite has no answer wait.
   */
  readonly answer_wait_ms?: number;
  /** A statement run as part of opening, before the transaction is handed out (for example a row lock). */
  readonly first: Statement | null;
}

export interface Begun {
  readonly conn: DbTxConn;
  readonly rows: Row[];
}

export interface DbAdapter {
  readonly dialect: Dialect;
  /** Connects. Throws a DbError. */
  open(): void;
  /** Opens a write transaction. Throws a DbError; nothing stays open then. */
  begin(options: BeginOptions): Promise<Begun>;
  /** `begin` that blocks; for server start, when nothing else runs. */
  begin_sync(options: BeginOptions): Begun;
  /** One statement in its own transaction. Resolves with the number of rows it changed. */
  autocommit(statement: Statement, lock_wait_ms: number): Promise<number>;
  /** The read-only connection: committed rows only, writes throw a `readonly` DbError. */
  readonly read: DbConn;
  /** Closes every connection; open transactions roll back. */
  close(): void;
}

/** True for a `lock` or `connection` DbError: the operation that opened the transaction ends with `FAILED`. */
export function is_db_failure(error: unknown): error is DbError {
  return error instanceof DbError && (error.kind === 'lock' || error.kind === 'connection');
}
