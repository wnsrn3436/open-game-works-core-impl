/**
 * `hold_db`, `hold_lock_key` and `until_blocked_by`: transactions of the test process on a PostgreSQL DB that hold
 * locks while a request waits for them. Each one is a `storage.open_pg_session` connection. The DB is a test server's,
 * or the DB of a PostgreSQL connection string, for a core test that makes its server instances on a test DB itself.
 */
import { network_time_limit } from '../../server-time/network_time_limit.ts';
import { open_pg_session, type PgValue } from '../../storage/dev/index.ts';
import { real_delay } from './real_time.ts';
import type { TestServer } from './test_server.ts';

/** A PostgreSQL test server, or a PostgreSQL connection string. */
export type PgTarget = TestServer | string;

/** How long `until_blocked_by` waits for the lock waiters before it throws. Real time. */
const LOCK_WAIT_MS = 20_000n;

/** One statement of `hold_db`: SQL with `$n` parameters. */
export interface HeldStatement {
  readonly sql: string;
  readonly params?: readonly PgValue[];
}

/** A transaction of `hold_db` that holds its locks until `release`. */
export interface Holder {
  /** The backend pid of the holder's connection, for `until_blocked_by`. */
  readonly pid: number;
  /** Rolls the transaction back and closes its connection. A second call does nothing. */
  release(): Promise<void>;
}

/** The PostgreSQL connection string of `target`: the string itself, or a running test server's DB. Throws for SQLite. */
function connection_of(target: PgTarget, operation: string): string {
  if (typeof target === 'string') return target;
  target.running();
  const connection = target.shared.database.connection;
  if (connection === null) throw new Error(`testing: ${operation} needs a PostgreSQL test server`);
  return connection;
}

/** `hold_db`: a transaction on a new connection to the DB of `target` that ran `statements` and stays open until `release`. */
export async function hold_db(target: PgTarget, statements: readonly HeldStatement[]): Promise<Holder> {
  const conn = await open_pg_session(connection_of(target, 'hold_db'));
  try {
    await conn.query('BEGIN');
    for (const statement of statements) await conn.query(statement.sql, [...(statement.params ?? [])]);
  } catch (error) {
    conn.close();
    throw error;
  }
  let released = false;
  return {
    pid: conn.pid,
    release: async () => {
      if (released) return;
      released = true;
      try {
        await conn.query('ROLLBACK');
      } finally {
        conn.close();
      }
    },
  };
}

/** The PostgreSQL statement that takes the advisory lock `$1` until its transaction ends, as `storage.lock_game_row` does. */
export const PG_ROW_LOCK_SQL = 'SELECT pg_advisory_xact_lock(CAST($1 AS BIGINT)) AS locked';

/** `hold_lock_key`: `hold_db` of the transaction advisory lock of `key`, the lock `storage.lock_game_row` takes. */
export async function hold_lock_key(target: PgTarget, key: bigint): Promise<Holder> {
  return await hold_db(connection_of(target, 'hold_lock_key'), [{ sql: PG_ROW_LOCK_SQL, params: [key] }]);
}

/**
 * The sessions of the DB that wait for a lock of backend `$1`, or wait behind such a session (a row lock waiter
 * queues behind the first waiter, which `pg_blocking_pids` names instead of the holder).
 */
const BLOCKED_BY = `WITH RECURSIVE waiting(pid) AS (
  SELECT pid FROM pg_stat_activity WHERE datname = current_database() AND CAST($1 AS INT) = ANY(pg_blocking_pids(pid))
  UNION
  SELECT a.pid FROM pg_stat_activity a JOIN waiting w ON w.pid = ANY(pg_blocking_pids(a.pid)) WHERE a.datname = current_database()
) SELECT COUNT(*) AS n FROM waiting`;

/**
 * `until_blocked_by`: waits until `count` sessions of the DB of `target` wait, directly or behind another waiter, for a
 * lock that backend `pid` holds. Throws after `LOCK_WAIT_MS` of real time.
 */
export async function until_blocked_by(target: PgTarget, pid: number, count = 1): Promise<void> {
  const conn = await open_pg_session(connection_of(target, 'until_blocked_by'));
  const limit = network_time_limit(LOCK_WAIT_MS);
  try {
    for (;;) {
      const rows = await conn.query(BLOCKED_BY, [pid]);
      if (Number(rows[0]?.n ?? 0) >= count) return;
      if (limit.aborted) throw new Error(`testing: fewer than ${String(count)} sessions waited for a lock of backend ${String(pid)}`);
      await real_delay(10n);
    }
  } finally {
    conn.close();
  }
}
