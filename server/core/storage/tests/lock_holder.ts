/**
 * Worker thread of `lock_holder` (helpers.ts): one connection of its own to the test database, like a transaction of
 * another server instance. It runs the statements the test sends, one at a time in order, each after its delay, so it
 * can end a transaction while the test's thread waits for a lock.
 */
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { parentPort, workerData } from 'node:worker_threads';
import { PgConnection, PgError, parse_connection_string, type PgRow, type PgValue } from '../db/pg_protocol.ts';

export interface HolderInput {
  readonly kind: 'sqlite' | 'postgresql';
  /** The SQLite file path or the PostgreSQL connection string. */
  readonly target: string;
}

export interface HolderRequest {
  readonly id: number;
  readonly sql: string;
  readonly params: readonly PgValue[];
  readonly delay_ms: number;
}

export type HolderResult = { readonly ok: true; readonly rows: PgRow[] } | { readonly ok: false; readonly code: string };

const input = workerData as HolderInput;
const port = parentPort;
if (port === null) throw new Error('lock_holder runs as a worker thread');

function sqlite_runner(path: string): (sql: string, params: readonly PgValue[]) => Promise<PgRow[]> {
  const db = new DatabaseSync(path, { readBigInts: true });
  db.exec('PRAGMA busy_timeout = 10000');
  return (sql, params) => {
    if (params.length === 0 && !/^\s*select/i.test(sql)) {
      db.exec(sql);
      return Promise.resolve([]);
    }
    const rows = db.prepare(sql.replace(/\$(\d+)/g, '?$1')).all(...params.map((p) => (typeof p === 'boolean' ? Number(p) : p) as SQLInputValue));
    return Promise.resolve(rows as PgRow[]);
  };
}

async function pg_runner(connection: string): Promise<(sql: string, params: readonly PgValue[]) => Promise<PgRow[]>> {
  const conn = await PgConnection.connect(parse_connection_string(connection));
  return (sql, params) => conn.query(sql, params);
}

const run = input.kind === 'sqlite' ? sqlite_runner(input.target) : await pg_runner(input.target);

function code_of(error: unknown): string {
  if (error instanceof PgError) return error.code;
  const errcode = (error as { errcode?: unknown }).errcode;
  return typeof errcode === 'number' ? String(errcode) : error instanceof Error ? error.message : String(error);
}

let queue = Promise.resolve();

port.on('message', (request: HolderRequest) => {
  queue = queue.then(async () => {
    if (request.delay_ms > 0) await new Promise((resolve) => setTimeout(resolve, request.delay_ms));
    let result: HolderResult;
    try {
      result = { ok: true, rows: await run(request.sql, request.params) };
    } catch (error) {
      result = { ok: false, code: code_of(error) };
    }
    port.postMessage({ id: request.id, result });
  });
});

port.postMessage({ id: 0, result: { ok: true, rows: [] } satisfies HolderResult });
