/** A worker thread of `db-adapter.test.ts`: opens a `SqliteAdapter` on the file of `workerData` and posts `ok` or the error. */
import { parentPort, workerData } from 'node:worker_threads';
import { SqliteAdapter } from '../db/sqlite.ts';

const input = workerData as { path: string; wait_ms: number };
const adapter = new SqliteAdapter(input.path, null, input.wait_ms);
try {
  adapter.open();
  adapter.close();
  parentPort?.postMessage('ok');
} catch (error) {
  parentPort?.postMessage(error instanceof Error ? error.message : String(error));
}
