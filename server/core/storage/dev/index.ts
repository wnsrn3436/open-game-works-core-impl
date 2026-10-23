import { PgConnection, parse_connection_string, type PgRow, type PgValue } from '../db/pg_protocol.ts';
import type { Storage } from '../index.ts';

export type { PgRow, PgValue } from '../db/pg_protocol.ts';

/** A PostgreSQL connection of `open_pg_session`, apart from the connection pool of every server instance. */
export interface PgSession {
  /** The backend pid of the connection. */
  readonly pid: number;
  /** Runs one statement with `$n` parameters on the connection. A failed statement rejects. */
  query(sql: string, params?: readonly PgValue[]): Promise<PgRow[]>;
  /** Closes the connection; an open transaction of it ends with it. */
  close(): void;
}

/** The `## DEV` operations of `storage`. */
export interface StorageDev {
  /** Before server start: the seed of each request's ctx random by request ID, or null for a secure random seed. */
  set_seed_provider(fn: (request_id: string) => bigint | null): void;
  /** Waits until every `after_commit` function and user change apply started so far has ended. */
  wait_after_commit(): Promise<void>;
  /** A new connection to a PostgreSQL connection string, with the wire protocol of the PostgreSQL adapter. */
  open_pg_session(connection: string): Promise<PgSession>;
}

/**
 * `open_pg_session`: a new connection of the PostgreSQL adapter's wire protocol, outside every connection pool and
 * without a lock wait limit. A failed connect rejects.
 */
export async function open_pg_session(connection: string): Promise<PgSession> {
  const conn = await PgConnection.connect(parse_connection_string(connection));
  try {
    const pid = Number((await conn.query('SELECT pg_backend_pid() AS pid'))[0]?.pid);
    return {
      pid,
      query: (sql, params = []) => conn.query(sql, params),
      close: () => {
        conn.close();
      },
    };
  } catch (error) {
    conn.close();
    throw error;
  }
}

export function create_storage_dev(storage: Storage): StorageDev {
  return {
    set_seed_provider: (fn) => {
      storage.set_seed_provider(fn);
    },
    wait_after_commit: () => storage.wait_after_commit(),
    open_pg_session,
  };
}
