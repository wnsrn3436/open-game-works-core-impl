/**
 * Worker thread of a core test (db-adapter.test.ts): the PostgreSQL worker with a fault. A statement `CRASH_SQL`
 * throws out of the message handler, so the thread ends on an uncaught exception; a statement `STUCK_SQL` keeps the
 * thread busy without end. Every other request goes to the PostgreSQL worker as it is.
 */
import { isMainThread, workerData } from 'node:worker_threads';
import type { WorkerInput, WorkerMessage } from '../db/pg_messages.ts';

export const CRASH_SQL = 'SELECT 1 AS crash';
export const STUCK_SQL = 'SELECT 1 AS stuck';

function fault(message: WorkerMessage): void {
  const request = message.request;
  const sql = request.op === 'query' || request.op === 'autocommit' ? request.sql : '';
  if (sql === CRASH_SQL) throw new Error('fault: the worker crashes');
  if (sql === STUCK_SQL) {
    // Busy without end: the thread answers nothing.
    for (;;) Atomics.load(new Int32Array(1), 0);
  }
}

if (!isMainThread) {
  const input = workerData as WorkerInput;
  // Listeners run in the order they were added: these run before the worker's own.
  input.sync_port.on('message', fault);
  input.async_port.on('message', fault);
  await import('../db/pg_worker.ts');
}
