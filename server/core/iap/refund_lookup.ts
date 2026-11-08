/**
 * Job `iap_refund_lookup` (`### refund lookup`): finds, in the refund list the store keeps, the refunds whose store
 * notification never reached the server, and does refund apply of each. Per store it first retries the transaction IDs
 * of `iap_refund_retry`, then reads the pages of the window that the cursor row of `iap_refund_cursor` gives.
 */
import type { DbHandle } from '../storage/index.ts';
import { is_failure, type RefundPage } from './adapter.ts';
import { call_adapter } from './calls.ts';
import { IapStore, log_user, store_name, type IapContext, type Store, type StoreBinding } from './context.ts';
import { refund_apply } from './notify.ts';
import { REFUND_CURSOR, REFUND_RETRY } from './tables.ts';

export const REFUND_LOOKUP_JOB = 'iap_refund_lookup';

/** The parameters of a statement of a DB handle. */
type Params = NonNullable<Parameters<DbHandle['query']>[1]>;

/** The order in which a run handles the stores. */
const STORES: readonly Store[] = [IapStore.IAP_STORE_APPLE, IapStore.IAP_STORE_GOOGLE];

/** A row of `iap_refund_cursor`. */
export interface CursorRow {
  readonly store: string;
  readonly adapter: string;
  readonly window_start: bigint;
  readonly window_end: bigint;
  readonly page_token: string;
  readonly done: boolean;
  readonly updated_at: bigint;
}

/** A row of `iap_refund_retry`. */
export interface RetryRow {
  readonly store: string;
  readonly transaction_id: string;
  readonly attempts: number;
  readonly failed_at: bigint;
}

const SELECT_CURSOR = `SELECT store, adapter, window_start, window_end, page_token, done, updated_at FROM ${REFUND_CURSOR} WHERE store = $1`;
const UPSERT_CURSOR =
  `INSERT INTO ${REFUND_CURSOR} (store, adapter, window_start, window_end, page_token, done, updated_at) VALUES ($1, $2, $3, $4, $5, $6, $7) ` +
  'ON CONFLICT (store) DO UPDATE SET adapter = excluded.adapter, window_start = excluded.window_start, window_end = excluded.window_end, ' +
  'page_token = excluded.page_token, done = excluded.done, updated_at = excluded.updated_at';
const SELECT_RETRY = `SELECT store, transaction_id, attempts, failed_at FROM ${REFUND_RETRY} WHERE store = $1 ORDER BY failed_at, transaction_id LIMIT $2`;
const INSERT_RETRY = `INSERT INTO ${REFUND_RETRY} (store, transaction_id, attempts, failed_at) VALUES ($1, $2, 0, $3) ON CONFLICT (store, transaction_id) DO NOTHING`;
const RAISE_RETRY = `UPDATE ${REFUND_RETRY} SET attempts = attempts + 1, failed_at = $3 WHERE store = $1 AND transaction_id = $2`;
const DELETE_RETRY = `DELETE FROM ${REFUND_RETRY} WHERE store = $1 AND transaction_id = $2`;

function big(value: unknown): bigint {
  if (typeof value === 'bigint') return value;
  if (typeof value === 'number') return BigInt(value);
  throw new TypeError(`iap: ${String(value)} is not an int64 column value`);
}

function cursor_of(row: Record<string, unknown>): CursorRow {
  return {
    store: String(row.store),
    adapter: String(row.adapter),
    window_start: big(row.window_start),
    window_end: big(row.window_end),
    page_token: String(row.page_token),
    done: row.done === true,
    updated_at: big(row.updated_at),
  };
}

function retry_of(row: Record<string, unknown>): RetryRow {
  return { store: String(row.store), transaction_id: String(row.transaction_id), attempts: Number(row.attempts), failed_at: big(row.failed_at) };
}

export function select_cursor(db: DbHandle, store: string): CursorRow | null {
  const row = db.query(SELECT_CURSOR, [store])[0];
  return row === undefined ? null : cursor_of(row);
}

export function select_retries(db: DbHandle, store: string, max: number): RetryRow[] {
  return db.query(SELECT_RETRY, [store, max]).map(retry_of);
}

function stack_of(error: unknown): string {
  return error instanceof Error ? (error.stack ?? error.message) : String(error);
}

/** One statement in one game transaction; false when the transaction is `FAILED` or throws. */
async function write(c: IapContext, sql: string, params: Params): Promise<boolean> {
  try {
    const result = await c.m.storage.run_game_transaction((tx) => {
      c.m.storage.db(tx).query(sql, params);
      return { written: true };
    });
    return result !== 'FAILED';
  } catch {
    return false;
  }
}

function error(c: IapContext, message: string, fields: Readonly<Record<string, string | number>>): void {
  log_user(c, null, 'error', 'error', message, fields);
}

/** The refund retry of a store (`iap.refundRetryBatchSize` rows, oldest `failed_at` first). */
async function retry_store(c: IapContext, store: Store, binding: StoreBinding): Promise<void> {
  const name = store_name(store);
  let rows: RetryRow[];
  try {
    rows = select_retries(c.m.storage.read_db(), name, c.settings.refund_retry_batch_size);
  } catch (e) {
    error(c, 'iap refund lookup could not read iap_refund_retry', { store: name, stack_trace: stack_of(e) });
    return;
  }
  for (const row of rows) {
    const applied = await refund_apply(c, store, binding, row.transaction_id);
    const now = c.m.time.clock_now();
    let written: boolean;
    if (applied) {
      written = await write(c, DELETE_RETRY, [name, row.transaction_id]);
    } else if (row.attempts + 1 < c.settings.refund_retry_count) {
      written = await write(c, RAISE_RETRY, [name, row.transaction_id, now]);
    } else {
      written = await write(c, DELETE_RETRY, [name, row.transaction_id]);
      if (written) error(c, 'iap refund lookup gave up the refund apply of a transaction ID', { store: name, transaction_id: row.transaction_id, attempts: row.attempts + 1 });
    }
    if (!written) {
      error(c, 'iap refund lookup could not write iap_refund_retry', { store: name, transaction_id: row.transaction_id });
      return;
    }
  }
}

/** The window and first page token of a store's pages; null when there is nothing to look up. */
function window_of(c: IapContext, store: Store, binding: StoreBinding, cursor: CursorRow | null, now: bigint): { start: bigint; end: bigint; token: string } | null {
  const oldest = now - BigInt(c.settings.refund_lookup_back_ms);
  const same = cursor !== null && cursor.adapter === binding.name;
  let window: { start: bigint; end: bigint; token: string };
  if (cursor === null || !same) window = { start: oldest, end: now, token: '' };
  else if (cursor.done) window = { start: cursor.window_end > oldest ? cursor.window_end : oldest, end: now, token: '' };
  else if (cursor.window_start >= oldest) window = { start: cursor.window_start, end: cursor.window_end, token: cursor.page_token };
  else window = { start: oldest, end: now, token: '' };
  if (cursor !== null && same) {
    const handled = cursor.done ? cursor.window_end : cursor.window_start;
    if (window.start > handled) {
      log_user(c, null, 'core', 'warn', 'iap refund lookup window starts after the handled time; the refunds in between are not looked up', {
        store: store_name(store),
        handled_at: handled.toString(),
        window_start: window.start.toString(),
      });
    }
  }
  return window.start < window.end ? window : null;
}

/** The pages of a store, up to `iap.refundLookupPageCount`. */
async function pages_of_store(c: IapContext, store: Store, binding: StoreBinding): Promise<void> {
  const name = store_name(store);
  const now = c.m.time.clock_now();
  let cursor: CursorRow | null;
  try {
    cursor = select_cursor(c.m.storage.read_db(), name);
  } catch (e) {
    error(c, 'iap refund lookup could not read iap_refund_cursor', { store: name, stack_trace: stack_of(e) });
    return;
  }
  const window = window_of(c, store, binding, cursor, now);
  if (window === null) return;
  const cursor_row = (token: string, done: boolean): Params => [name, binding.name, window.start, window.end, token, done, c.m.time.clock_now()];
  let token = window.token;
  for (let page = 0; page < c.settings.refund_lookup_page_count; page += 1) {
    const listed = await call_adapter(c, (call) => binding.adapter.list_refunds(window.start, window.end, token, call));
    if (is_failure(listed)) {
      error(c, 'iap refund lookup list_refunds failed', { store: name, adapter: binding.name, failure: listed, page_token: token });
      // A page token the store no longer accepts: the next run reads the window from the first page.
      if (listed === 'rejected' && token !== '' && !(await write(c, UPSERT_CURSOR, cursor_row('', false)))) {
        error(c, 'iap refund lookup could not write iap_refund_cursor', { store: name });
      }
      return;
    }
    const result: RefundPage = listed;
    for (let i = 0; i < result.unverified; i += 1) error(c, 'iap refund lookup left out a notification history element that did not pass the signature check', { store: name, adapter: binding.name });
    for (const transaction_id of result.transaction_ids) {
      if (await refund_apply(c, store, binding, transaction_id)) continue;
      error(c, 'iap refund apply of the refund lookup failed; the transaction ID goes to the refund retry', { store: name, transaction_id });
      if (!(await write(c, INSERT_RETRY, [name, transaction_id, c.m.time.clock_now()]))) {
        error(c, 'iap refund lookup could not write iap_refund_retry', { store: name, transaction_id });
        return;
      }
    }
    const next = result.next_page_token;
    if (!(await write(c, UPSERT_CURSOR, cursor_row(next, next === '')))) {
      error(c, 'iap refund lookup could not write iap_refund_cursor', { store: name });
      return;
    }
    if (next === '') return;
    token = next;
  }
}

/** One run of job `iap_refund_lookup`. It logs its own failures and does not throw. */
export async function run_refund_lookup(c: IapContext): Promise<void> {
  for (const store of STORES) {
    const binding = c.adapters.get(store);
    if (binding === undefined) continue;
    try {
      await retry_store(c, store, binding);
      await pages_of_store(c, store, binding);
    } catch (e) {
      error(c, 'iap refund lookup threw', { store: store_name(store), stack_trace: stack_of(e) });
    }
  }
}
