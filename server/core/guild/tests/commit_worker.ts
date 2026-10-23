/**
 * A worker thread of the guild lock tests: on its own PostgreSQL connection it takes the lock `storage.lock_game_row`
 * takes on a game row and posts `locked`. On `go` it waits until another connection waits for an advisory lock of the
 * database, then runs the statements and commits, posting `committed`. A server instance of the test process waits for
 * that lock synchronously, so the commit has to come from another thread.
 */
import { parentPort, workerData } from 'node:worker_threads';
import { open_pg_session, type PgValue } from '../../storage/dev/index.ts';

export interface CommitInput {
  readonly connection: string;
  readonly lock_key: bigint;
  readonly statements: readonly { readonly sql: string; readonly params: readonly PgValue[] }[];
}

/** How long the worker waits for a waiter before it gives up. */
const WAITER_LIMIT_MS = 10_000;

const input = workerData as CommitInput;
const port = parentPort;
if (port === null) throw new Error('commit_worker runs as a worker thread');

const conn = await open_pg_session(input.connection);
await conn.query('BEGIN');
await conn.query('SELECT pg_advisory_xact_lock(CAST($1 AS BIGINT)) AS locked', [input.lock_key]);

async function has_waiter(): Promise<boolean> {
  const rows = await conn.query(
    "SELECT COUNT(*) AS n FROM pg_locks WHERE locktype = 'advisory' AND NOT granted AND database = (SELECT oid FROM pg_database WHERE datname = current_database())",
  );
  return Number(rows[0]?.n ?? 0) > 0;
}

async function commit_after_waiter(): Promise<string> {
  const until = Date.now() + WAITER_LIMIT_MS;
  while (!(await has_waiter())) {
    if (Date.now() >= until) return 'no waiter';
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  for (const statement of input.statements) await conn.query(statement.sql, statement.params);
  await conn.query('COMMIT');
  return 'committed';
}

port.once('message', () => {
  void commit_after_waiter()
    .catch((error: unknown) => (error instanceof Error ? error.message : String(error)))
    .then((result) => {
      conn.close();
      port.postMessage(result);
    });
});
port.postMessage('locked');
