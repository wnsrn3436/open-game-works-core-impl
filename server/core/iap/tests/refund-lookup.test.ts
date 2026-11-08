/**
 * Job `iap_refund_lookup` on test servers with the fake `iap-apple` and `iap-google` adapters: refund apply of the
 * listed transaction IDs, the cursor window and page token, the refund retry, and the concurrency with store
 * notifications.
 */
import * as CoreContract from '../../../generated/contract/core_contract.ts';
import * as testing from '../../testing/dev/index.ts';
import type { StoreAdapter } from '../adapter.ts';
import type { DbHandle, GameTx, Storage } from '../../storage/index.ts';
import { select_cursor, select_retries, type CursorRow, type RetryRow } from '../refund_lookup.ts';
import {
  account_token,
  APPLE,
  balance,
  core_events,
  fake_store,
  GOOGLE,
  has_pending,
  item_changes,
  logs_with_reason,
  payment,
  purchase_count_of,
  receipt,
  start,
  START,
  verify,
  withdraw,
  type TestServer,
} from './helpers.ts';

const IAP_REFUND = CoreContract.ItemChangeSource.ITEM_CHANGE_SOURCE_IAP_REFUND;
/** `iap.refundLookupIntervalMs` and `iap.refundLookupBackMs` of the core settings. */
const INTERVAL = 3_600_000n;
const BACK = 2_160_000_000n;

function storage_of(server: TestServer): Storage {
  return server.running().instance.modules().get('storage') as unknown as Storage;
}

function cursor(server: TestServer, store: CoreContract.IapStore = APPLE): CursorRow | null {
  return select_cursor(storage_of(server).read_db(), store === APPLE ? 'IAP_STORE_APPLE' : 'IAP_STORE_GOOGLE');
}

function retries(server: TestServer, store: CoreContract.IapStore = APPLE): RetryRow[] {
  return select_retries(storage_of(server).read_db(), store === APPLE ? 'IAP_STORE_APPLE' : 'IAP_STORE_GOOGLE', 1000);
}

/** Runs one statement of the test in a game transaction. */
async function sql(server: TestServer, text: string, params: NonNullable<Parameters<DbHandle['query']>[1]>): Promise<void> {
  const storage = storage_of(server);
  const result = await storage.run_game_transaction((tx) => {
    storage.db(tx).query(text, params);
    return { done: true };
  });
  if (result === 'FAILED') throw new Error(`statement failed: ${text}`);
}

/** The `list_refunds` calls of the fake adapter of a store, as `[window_start, window_end, page_token]`. */
function list_calls(server: TestServer, store: CoreContract.IapStore = APPLE): [unknown, unknown, unknown][] {
  return fake_store(server, store)
    .calls()
    .filter((call) => call.operation === 'list_refunds')
    .map((call) => [call.input.window_start, call.input.window_end, call.input.page_token]);
}

/** Moves the test clock by one job period and waits for the run of job `iap_refund_lookup`. */
async function next_run(server: TestServer, ms: bigint = INTERVAL): Promise<void> {
  testing.advance_time(server, ms);
  await testing.wait_background(server);
}

/** A test server whose first run of the job (at server start) has ended. */
async function started(settings: Readonly<Record<string, unknown>> = {}): Promise<TestServer> {
  const server = await start({ settings });
  await testing.wait_background(server);
  return server;
}

function messages(server: TestServer, level: string, part: string): Record<string, unknown>[] {
  return testing.read_logs(server, undefined, level).filter((line: Record<string, unknown>) => String(line.message).includes(part));
}

function sleep_real(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

type Statement = (text: string, params: readonly unknown[]) => boolean;

/**
 * A DB fault of the storage module of the test server: inside a game transaction, a statement that `fail_write`
 * matches is not run and that transaction is `FAILED`; a `read_db` statement that `throw_read` matches throws.
 * `restore` puts the storage operations back.
 */
function storage_fault(server: TestServer, fault: { fail_write?: Statement; throw_read?: Statement }): { restore: () => void } {
  const storage = storage_of(server);
  const original = { run_game_transaction: storage.run_game_transaction.bind(storage), db: storage.db.bind(storage), read_db: storage.read_db.bind(storage) };
  let in_game = false;
  let hit = false;
  const intercept = (handle: DbHandle, match: Statement, on_match: () => ReturnType<DbHandle['query']>): DbHandle => {
    const wrapped = Object.create(handle) as DbHandle;
    Object.defineProperty(wrapped, 'query', {
      value: (text: string, params: NonNullable<Parameters<DbHandle['query']>[1]> = []) => (match(text, params) ? on_match() : handle.query(text, params)),
    });
    return wrapped;
  };
  storage.db = (ctx_or_tx) => {
    const handle = original.db(ctx_or_tx);
    if (!in_game || fault.fail_write === undefined) return handle;
    return intercept(handle, fault.fail_write, () => {
      hit = true;
      return [];
    });
  };
  storage.run_game_transaction = async <T>(fn: (tx: GameTx) => T): Promise<T | 'FAILED'> => {
    const run = { failed: false };
    const result = await original.run_game_transaction((tx) => {
      in_game = true;
      hit = false;
      try {
        return fn(tx);
      } finally {
        run.failed = hit;
        in_game = false;
      }
    });
    return run.failed ? 'FAILED' : result;
  };
  storage.read_db = () => {
    const handle = original.read_db();
    if (fault.throw_read === undefined) return handle;
    return intercept(handle, fault.throw_read, () => {
      throw new Error('test read fault');
    });
  };
  return {
    restore: () => {
      storage.run_game_transaction = original.run_game_transaction;
      storage.db = original.db;
      storage.read_db = original.read_db;
    },
  };
}

/** A statement whose text starts with `prefix` (after whitespace) and, when given, whose parameters include `param`. */
function statement(prefix: string, param?: string): Statement {
  return (text, params) => text.trimStart().startsWith(prefix) && (param === undefined || params.includes(param));
}

describe('refund lookup', () => {
  it('revokes the reward of a listed GRANTED store transaction with source IapRefund, marks it REFUNDED with a pending delta and an audit log iap_refund_lookup; the same ID again and a later notification change nothing', async () => {
    const server = await started();
    const a = await testing.login(server, 'a');
    const token = await account_token(a);
    await verify(a, APPLE, receipt('gems_apple', 'lk-1', token));
    await verify(a, APPLE, receipt('gems_apple', 'lk-0', token));
    expect(await balance(server, a.user_id)).toBe(200n);
    fake_store(server).set_result('list_refunds', { transaction_ids: ['lk-1'] });
    await next_run(server);
    expect(await balance(server, a.user_id)).toBe(100n);
    expect((await payment(server, a.user_id, 'lk-1'))?.result).toBe('REFUNDED');
    expect(await purchase_count_of(server, a.user_id, '[iap_gems]')).toBe(1);
    const next = await testing.send(a, 'core/SyncSubscriptions', new CoreContract.SyncSubscriptionsRequest());
    expect(has_pending(next, 'ItemBalanceUserState')).toBe(true);
    expect(item_changes(next).map((c) => [c.source, c.ref, c.delta])).toEqual([[IAP_REFUND, 'lk-1', -100n]]);
    expect(await logs_with_reason(server, 'audit', 'iap_refund_lookup')).toHaveLength(1);
    await next_run(server);
    expect(await testing.call_dev(server, 'iap', 'send_fake_refund', [APPLE, 'lk-1'])).toBe(200);
    expect(await balance(server, a.user_id)).toBe(100n);
    expect(await purchase_count_of(server, a.user_id, '[iap_gems]')).toBe(1);
    expect(await core_events(server, a.user_id, 'core_iap_refunded')).toHaveLength(1);
    expect(await logs_with_reason(server, 'audit', 'iap_refund_lookup')).toHaveLength(1);
    expect(await logs_with_reason(server, 'audit', 'iap_refund')).toHaveLength(0);
  });

  it('a listed ID without a payment record, or of an INVALID or REFUNDED record, changes no record and writes the cursor row done', async () => {
    const server = await started();
    const a = await testing.login(server, 'a');
    const token = await account_token(a);
    await verify(a, APPLE, receipt('gems_apple', 'nr-1', token));
    expect(await testing.call_dev(server, 'iap', 'send_fake_refund', [APPLE, 'nr-1'])).toBe(200);
    fake_store(server).set_result('verify', 'INVALID');
    await verify(a, APPLE, receipt('gems_apple', 'nr-2', token));
    expect((await payment(server, a.user_id, 'nr-2'))?.result).toBe('INVALID');
    const events = (await core_events(server, a.user_id, 'core_iap_refunded')).length;
    fake_store(server).set_result('list_refunds', { transaction_ids: ['nr-none', 'nr-1', 'nr-2'] });
    await next_run(server);
    expect((await payment(server, a.user_id, 'nr-1'))?.result).toBe('REFUNDED');
    expect((await payment(server, a.user_id, 'nr-2'))?.result).toBe('INVALID');
    expect(await core_events(server, a.user_id, 'core_iap_refunded')).toHaveLength(events);
    expect(cursor(server)).toMatchObject({ adapter: 'fake', window_start: START, window_end: START + INTERVAL, page_token: '', done: true });
    expect(retries(server)).toEqual([]);
  });

  it('the first run looks from clock_now - iap.refundLookupBackMs to clock_now with the empty page token, the next run from the previous window end, and a cursor row of another adapter starts again from the oldest start', async () => {
    const server = await started();
    expect(list_calls(server)).toEqual([[START - BACK, START, '']]);
    expect(list_calls(server, GOOGLE)).toEqual([[START - BACK, START, '']]);
    expect(cursor(server, GOOGLE)).toMatchObject({ store: 'IAP_STORE_GOOGLE', adapter: 'fake', window_start: START - BACK, window_end: START, page_token: '', done: true, updated_at: START });
    await next_run(server);
    expect(list_calls(server).at(-1)).toEqual([START, START + INTERVAL, '']);
    await sql(server, 'UPDATE iap_refund_cursor SET adapter = $1 WHERE store = $2', ['iap-apple', 'IAP_STORE_APPLE']);
    await next_run(server);
    const now = START + 2n * INTERVAL;
    expect(list_calls(server).at(-1)).toEqual([now - BACK, now, '']);
    expect(list_calls(server, GOOGLE).at(-1)).toEqual([START + INTERVAL, now, '']);
    expect(messages(server, 'warn', 'refund lookup window')).toHaveLength(0);
  });

  it('a next page token goes to the next call with the same window; after iap.refundLookupPageCount pages the store ends and the next run goes on from the stored page token', async () => {
    const server = await started({ 'iap.refundLookupPageCount': 2 });
    fake_store(server).set_result('list_refunds', { transaction_ids: [], next_page_token: 'P1' });
    await next_run(server);
    const window: [bigint, bigint] = [START, START + INTERVAL];
    expect(list_calls(server).slice(1)).toEqual([
      [...window, ''],
      [...window, 'P1'],
    ]);
    expect(cursor(server)).toMatchObject({ window_start: START, window_end: START + INTERVAL, page_token: 'P1', done: false });
    fake_store(server).set_result('list_refunds', { transaction_ids: [] });
    await next_run(server);
    expect(list_calls(server).slice(3)).toEqual([[...window, 'P1']]);
    expect(cursor(server)).toMatchObject({ window_start: START, window_end: START + INTERVAL, page_token: '', done: true });
    await next_run(server);
    expect(list_calls(server).at(-1)).toEqual([START + INTERVAL, START + 3n * INTERVAL, '']);
  });

  it('a failed list_refunds keeps the cursor row, and the next run asks for the same window and page token', async () => {
    const server = await started({ 'iap.refundLookupPageCount': 1 });
    const fake = fake_store(server);
    fake.set_result('list_refunds', { next_page_token: 'P1' });
    await next_run(server);
    const kept = cursor(server);
    expect(kept).toMatchObject({ page_token: 'P1', done: false });
    fake.set_failure('list_refunds', 'timeout');
    await next_run(server);
    expect(cursor(server)).toEqual(kept);
    expect(messages(server, 'error', 'list_refunds failed')).toHaveLength(1);
    fake.set_failure('list_refunds', null);
    await next_run(server);
    expect(list_calls(server).slice(1)).toEqual([
      [START, START + INTERVAL, ''],
      [START, START + INTERVAL, 'P1'],
      [START, START + INTERVAL, 'P1'],
    ]);
  });

  it('a rejected list_refunds with a page token makes the next run read that window from the first page', async () => {
    const server = await started({ 'iap.refundLookupPageCount': 1 });
    const fake = fake_store(server);
    fake.set_result('list_refunds', { next_page_token: 'P1' });
    await next_run(server);
    fake.set_failure('list_refunds', 'rejected');
    await next_run(server);
    expect(cursor(server)).toMatchObject({ window_start: START, window_end: START + INTERVAL, page_token: '', done: false });
    fake.set_failure('list_refunds', null);
    await next_run(server);
    expect(list_calls(server).slice(1)).toEqual([
      [START, START + INTERVAL, ''],
      [START, START + INTERVAL, 'P1'],
      [START, START + INTERVAL, ''],
    ]);
  });

  it('a FAILED insert into iap_refund_retry of a page leaves an error log and ends that store without writing the cursor row; the next run reads that page again', async () => {
    const server = await started({ 'iap.refundLookupPageCount': 1 });
    const a = await testing.login(server, 'a');
    const token = await account_token(a);
    await verify(a, APPLE, receipt('vip_apple', 'fi-1', token));
    await verify(a, APPLE, receipt('gems_apple', 'fi-2', token));
    const fake = fake_store(server);
    fake.set_result('list_refunds', { next_page_token: 'P1' });
    await next_run(server);
    const kept = cursor(server);
    expect(kept).toMatchObject({ page_token: 'P1', done: false });
    fake.set_failure('lookup_subscription', 'timeout');
    fake.set_result('list_refunds', { transaction_ids: ['fi-1', 'fi-2'], next_page_token: 'P2' });
    const fault = storage_fault(server, { fail_write: statement('INSERT INTO iap_refund_retry') });
    await next_run(server);
    fault.restore();
    expect(cursor(server)).toEqual(kept);
    expect(retries(server)).toEqual([]);
    const failed = messages(server, 'error', 'could not write iap_refund_retry');
    expect(failed).toHaveLength(1);
    expect(failed[0]).toMatchObject({ store: 'IAP_STORE_APPLE', transaction_id: 'fi-1' });
    expect((await payment(server, a.user_id, 'fi-1'))?.result).toBe('GRANTED');
    expect((await payment(server, a.user_id, 'fi-2'))?.result).toBe('GRANTED');
    fake.set_failure('lookup_subscription', null);
    fake.set_result('lookup_subscription', { state: 'REVOKED', ends_at: (START + 2n * INTERVAL).toString(), auto_renew: false });
    await next_run(server);
    expect(list_calls(server).slice(1)).toEqual([
      [START, START + INTERVAL, ''],
      [START, START + INTERVAL, 'P1'],
      [START, START + INTERVAL, 'P1'],
    ]);
    expect((await payment(server, a.user_id, 'fi-1'))?.result).toBe('REFUNDED');
    expect((await payment(server, a.user_id, 'fi-2'))?.result).toBe('REFUNDED');
    expect(cursor(server)).toMatchObject({ window_start: START, window_end: START + INTERVAL, page_token: 'P2', done: false });
  });

  it('a FAILED cursor write of a page leaves an error log and ends that store before its next page; the cursor row stays and the next run reads that page again', async () => {
    const server = await started({ 'iap.refundLookupPageCount': 2 });
    const fake = fake_store(server);
    fake.set_result('list_refunds', { next_page_token: 'P1' });
    await next_run(server);
    const kept = cursor(server);
    expect(kept).toMatchObject({ page_token: 'P1', done: false });
    fake.set_result('list_refunds', { next_page_token: 'P2' });
    const fault = storage_fault(server, { fail_write: statement('INSERT INTO iap_refund_cursor', 'IAP_STORE_APPLE') });
    await next_run(server);
    fault.restore();
    expect(cursor(server)).toEqual(kept);
    const failed = messages(server, 'error', 'could not write iap_refund_cursor');
    expect(failed).toHaveLength(1);
    expect(failed[0]).toMatchObject({ store: 'IAP_STORE_APPLE' });
    expect(list_calls(server).slice(3)).toEqual([[START, START + INTERVAL, 'P1']]);
    expect(cursor(server, GOOGLE)).toMatchObject({ window_end: START + 2n * INTERVAL, done: true });
    await next_run(server);
    expect(list_calls(server).slice(4, 5)).toEqual([[START, START + INTERVAL, 'P1']]);
  });

  it('a FAILED give-up delete of iap_refund_retry leaves an error log without the give-up log and ends the retry of that store; the row stays, the pages are read and a later run gives it up', async () => {
    const server = await started({ 'iap.refundRetryCount': 1 });
    const a = await testing.login(server, 'a');
    const token = await account_token(a);
    await verify(a, APPLE, receipt('vip_apple', 'rf-1', token));
    await verify(a, APPLE, receipt('gems_apple', 'rf-3', token));
    await sql(server, 'INSERT INTO iap_refund_retry (store, transaction_id, attempts, failed_at) VALUES ($1, $2, 0, $3)', ['IAP_STORE_APPLE', 'rf-1', 10n]);
    await sql(server, 'INSERT INTO iap_refund_retry (store, transaction_id, attempts, failed_at) VALUES ($1, $2, 0, $3)', ['IAP_STORE_APPLE', 'rf-2', 20n]);
    const fake = fake_store(server);
    fake.set_failure('lookup_subscription', 'timeout');
    fake.set_result('list_refunds', { transaction_ids: ['rf-3'] });
    const fault = storage_fault(server, { fail_write: statement('DELETE FROM iap_refund_retry') });
    const calls = list_calls(server).length;
    await next_run(server);
    fault.restore();
    expect(retries(server)).toEqual([
      { store: 'IAP_STORE_APPLE', transaction_id: 'rf-1', attempts: 0, failed_at: 10n },
      { store: 'IAP_STORE_APPLE', transaction_id: 'rf-2', attempts: 0, failed_at: 20n },
    ]);
    const failed = messages(server, 'error', 'could not write iap_refund_retry');
    expect(failed).toHaveLength(1);
    expect(failed[0]).toMatchObject({ store: 'IAP_STORE_APPLE', transaction_id: 'rf-1' });
    expect(messages(server, 'error', 'gave up the refund apply')).toHaveLength(0);
    expect(list_calls(server)).toHaveLength(calls + 1);
    expect((await payment(server, a.user_id, 'rf-3'))?.result).toBe('REFUNDED');
    fake.set_result('list_refunds', null);
    await next_run(server);
    expect(retries(server)).toEqual([]);
    const gave_up = messages(server, 'error', 'gave up the refund apply');
    expect(gave_up).toHaveLength(1);
    expect(gave_up[0]).toMatchObject({ store: 'IAP_STORE_APPLE', transaction_id: 'rf-1' });
    expect((await payment(server, a.user_id, 'rf-1'))?.result).toBe('GRANTED');
  });

  it('a FAILED attempts update of iap_refund_retry leaves an error log and ends the retry of that store; the row keeps its attempts and failed_at', async () => {
    const server = await started({ 'iap.refundRetryCount': 3 });
    const a = await testing.login(server, 'a');
    const token = await account_token(a);
    await verify(a, APPLE, receipt('vip_apple', 'ru-1', token));
    await sql(server, 'INSERT INTO iap_refund_retry (store, transaction_id, attempts, failed_at) VALUES ($1, $2, 0, $3)', ['IAP_STORE_APPLE', 'ru-1', 10n]);
    fake_store(server).set_failure('lookup_subscription', 'timeout');
    const fault = storage_fault(server, { fail_write: statement('UPDATE iap_refund_retry') });
    await next_run(server);
    fault.restore();
    expect(retries(server)).toEqual([{ store: 'IAP_STORE_APPLE', transaction_id: 'ru-1', attempts: 0, failed_at: 10n }]);
    expect(messages(server, 'error', 'could not write iap_refund_retry')).toHaveLength(1);
    await next_run(server);
    expect(retries(server)).toEqual([{ store: 'IAP_STORE_APPLE', transaction_id: 'ru-1', attempts: 1, failed_at: START + 2n * INTERVAL }]);
  });

  it('a throwing read_db of the iap_refund_retry rows leaves an error log and ends the retry of that store, and the pages of that store are read', async () => {
    const server = await started();
    const a = await testing.login(server, 'a');
    const token = await account_token(a);
    await verify(a, APPLE, receipt('gems_apple', 'rr-2', token));
    await sql(server, 'INSERT INTO iap_refund_retry (store, transaction_id, attempts, failed_at) VALUES ($1, $2, 0, $3)', ['IAP_STORE_APPLE', 'rr-1', 10n]);
    fake_store(server).set_result('list_refunds', { transaction_ids: ['rr-2'] });
    const fault = storage_fault(server, { throw_read: (text, params) => text.includes('FROM iap_refund_retry') && params.includes('IAP_STORE_APPLE') });
    await next_run(server);
    fault.restore();
    const failed = messages(server, 'error', 'could not read iap_refund_retry');
    expect(failed).toHaveLength(1);
    expect(failed[0]).toMatchObject({ store: 'IAP_STORE_APPLE' });
    expect(retries(server).map((r) => r.transaction_id)).toEqual(['rr-1']);
    expect((await payment(server, a.user_id, 'rr-2'))?.result).toBe('REFUNDED');
    expect(cursor(server)).toMatchObject({ window_end: START + INTERVAL, done: true });
  });

  it('a throwing read_db of the cursor row leaves an error log and ends that store in that run; the next store is handled', async () => {
    const server = await started();
    const kept = cursor(server);
    const apple_calls = list_calls(server).length;
    const google_calls = list_calls(server, GOOGLE).length;
    const fault = storage_fault(server, { throw_read: (text, params) => text.includes('FROM iap_refund_cursor') && params.includes('IAP_STORE_APPLE') });
    await next_run(server);
    fault.restore();
    const failed = messages(server, 'error', 'could not read iap_refund_cursor');
    expect(failed).toHaveLength(1);
    expect(failed[0]).toMatchObject({ store: 'IAP_STORE_APPLE' });
    expect(list_calls(server)).toHaveLength(apple_calls);
    expect(cursor(server)).toEqual(kept);
    expect(list_calls(server, GOOGLE)).toHaveLength(google_calls + 1);
    await next_run(server);
    expect(list_calls(server).at(-1)).toEqual([START, START + 2n * INTERVAL, '']);
  });

  it('a done cursor row whose window end is older than clock_now - iap.refundLookupBackMs starts the window at the oldest start with one warn log', async () => {
    const server = await started();
    await sql(server, 'UPDATE iap_refund_cursor SET window_end = $1 WHERE store = $2', [START - BACK - 5000n, 'IAP_STORE_APPLE']);
    await next_run(server);
    const now = START + INTERVAL;
    expect(list_calls(server).at(-1)).toEqual([now - BACK, now, '']);
    const warns = messages(server, 'warn', 'refund lookup window');
    expect(warns).toHaveLength(1);
    expect(warns[0]).toMatchObject({ store: 'IAP_STORE_APPLE', handled_at: (START - BACK - 5000n).toString(), window_start: (now - BACK).toString() });
  });

  it('a failed refund apply goes to the refund retry with attempts 0 and the page goes on; the next run applies it when the subscription lookup succeeds and deletes its row', async () => {
    const server = await started();
    const a = await testing.login(server, 'a');
    const token = await account_token(a);
    await verify(a, APPLE, receipt('vip_apple', 'rt-1', token));
    await verify(a, APPLE, receipt('gems_apple', 'rt-2', token));
    const fake = fake_store(server);
    fake.set_failure('lookup_subscription', 'timeout');
    fake.set_result('list_refunds', { transaction_ids: ['rt-1', 'rt-2'] });
    await next_run(server);
    expect((await payment(server, a.user_id, 'rt-1'))?.result).toBe('GRANTED');
    expect((await payment(server, a.user_id, 'rt-2'))?.result).toBe('REFUNDED');
    expect(retries(server)).toEqual([{ store: 'IAP_STORE_APPLE', transaction_id: 'rt-1', attempts: 0, failed_at: START + INTERVAL }]);
    expect(messages(server, 'error', 'goes to the refund retry')).toHaveLength(1);
    expect(cursor(server)).toMatchObject({ window_end: START + INTERVAL, done: true });
    fake.set_failure('lookup_subscription', null);
    fake.set_result('lookup_subscription', { state: 'REVOKED', ends_at: (START + INTERVAL).toString(), auto_renew: false });
    fake.set_result('list_refunds', null);
    await next_run(server);
    expect((await payment(server, a.user_id, 'rt-1'))?.result).toBe('REFUNDED');
    expect(retries(server)).toEqual([]);
  });

  it('while the refund apply keeps failing, attempts rise by 1 per run, the run whose attempts + 1 reaches iap.refundRetryCount deletes the row with one error log, and later pages are applied meanwhile', async () => {
    const server = await started({ 'iap.refundRetryCount': 3 });
    const a = await testing.login(server, 'a');
    const token = await account_token(a);
    await verify(a, APPLE, receipt('vip_apple', 'rg-1', token));
    for (const id of ['rg-2', 'rg-3', 'rg-4']) await verify(a, APPLE, receipt('gems_apple', id, token));
    const fake = fake_store(server);
    fake.set_failure('lookup_subscription', 'timeout');
    fake.set_result('list_refunds', { transaction_ids: ['rg-1'] });
    await next_run(server);
    expect(retries(server).map((r) => r.attempts)).toEqual([0]);
    fake.set_result('list_refunds', { transaction_ids: ['rg-2'] });
    await next_run(server);
    expect(retries(server).map((r) => [r.attempts, r.failed_at])).toEqual([[1, START + 2n * INTERVAL]]);
    expect((await payment(server, a.user_id, 'rg-2'))?.result).toBe('REFUNDED');
    fake.set_result('list_refunds', { transaction_ids: ['rg-3'] });
    await next_run(server);
    expect(retries(server).map((r) => r.attempts)).toEqual([2]);
    expect((await payment(server, a.user_id, 'rg-3'))?.result).toBe('REFUNDED');
    fake.set_result('list_refunds', { transaction_ids: ['rg-4'] });
    await next_run(server);
    expect(retries(server)).toEqual([]);
    const gave_up = messages(server, 'error', 'gave up the refund apply');
    expect(gave_up).toHaveLength(1);
    expect(gave_up[0]).toMatchObject({ store: 'IAP_STORE_APPLE', transaction_id: 'rg-1' });
    expect((await payment(server, a.user_id, 'rg-4'))?.result).toBe('REFUNDED');
    fake.set_failure('lookup_subscription', null);
    fake.set_result('list_refunds', null);
    await next_run(server);
    expect((await payment(server, a.user_id, 'rg-1'))?.result).toBe('GRANTED');
  });

  it('a run retries at most iap.refundRetryBatchSize rows of a store, the oldest failed_at first, before it calls list_refunds', async () => {
    const server = await started({ 'iap.refundRetryBatchSize': 2 });
    for (const [id, at] of [
      ['rb-1', 30n],
      ['rb-2', 10n],
      ['rb-3', 20n],
    ] as const) {
      await sql(server, 'INSERT INTO iap_refund_retry (store, transaction_id, attempts, failed_at) VALUES ($1, $2, 0, $3)', ['IAP_STORE_APPLE', id, at]);
    }
    const adapter = server.shared.fakes.get('iap-apple')?.adapter as StoreAdapter;
    const list = adapter.list_refunds.bind(adapter);
    const seen: string[][] = [];
    adapter.list_refunds = (start_at, end_at, page_token, call) => {
      seen.push(retries(server).map((r) => r.transaction_id));
      return list(start_at, end_at, page_token, call);
    };
    await next_run(server);
    expect(seen).toEqual([['rb-1']]);
    expect(retries(server).map((r) => r.transaction_id)).toEqual(['rb-1']);
  });

  it('a time advance while the list_refunds of APPLE waits under hold gives the first list_refunds of GOOGLE without a cursor row the window start of clock_now after that advance - iap.refundLookupBackMs', async () => {
    const server = await started();
    await sql(server, 'DELETE FROM iap_refund_cursor WHERE store = $1', ['IAP_STORE_GOOGLE']);
    const apple = fake_store(server, APPLE);
    apple.hold(true);
    testing.advance_time(server, INTERVAL);
    for (let i = 0; i < 200 && list_calls(server).length < 2; i += 1) await sleep_real(10);
    expect(list_calls(server)).toHaveLength(2);
    testing.advance_time(server, 1000n);
    apple.hold(false);
    await testing.wait_background(server);
    const now = START + INTERVAL + 1000n;
    expect(list_calls(server, GOOGLE).at(-1)).toEqual([now - BACK, now, '']);
  });

  it('each list element the adapter left out for its signature check leaves one error log', async () => {
    const server = await started();
    const adapter = server.shared.fakes.get('iap-apple')?.adapter as StoreAdapter;
    adapter.list_refunds = () => Promise.resolve({ transaction_ids: [], next_page_token: '', unverified: 2 });
    await next_run(server);
    expect(messages(server, 'error', 'did not pass the signature check')).toHaveLength(2);
    expect(cursor(server)).toMatchObject({ window_end: START + INTERVAL, done: true });
  });

  it('a listed GRANTED store transaction of a withdrawn user is marked REFUNDED without a revoke or core_iap_refunded', async () => {
    const server = await started();
    const a = await testing.login(server, 'a');
    const token = await account_token(a);
    await verify(a, APPLE, receipt('gems_apple', 'lw-1', token));
    await withdraw(a);
    fake_store(server).set_result('list_refunds', { transaction_ids: ['lw-1'] });
    await next_run(server);
    expect((await payment(server, a.user_id, 'lw-1'))?.result).toBe('REFUNDED');
    expect(await core_events(server, a.user_id, 'core_iap_refunded')).toHaveLength(0);
    expect(await logs_with_reason(server, 'audit', 'iap_refund_lookup')).toHaveLength(0);
    expect(retries(server)).toEqual([]);
  });

  it('refund apply of the lookup and a REFUND notification of the same GRANTED store transaction at once revoke, lower the purchase count and emit core_iap_refunded once, and the notification is HTTP 200', async () => {
    const server = await started();
    const a = await testing.login(server, 'a');
    const token = await account_token(a);
    await verify(a, APPLE, receipt('gems_apple', 'lc-1', token));
    await verify(a, APPLE, receipt('gems_apple', 'lc-0', token));
    fake_store(server).set_result('list_refunds', { transaction_ids: ['lc-1'] });
    testing.advance_time(server, INTERVAL);
    const [status] = await Promise.all([testing.call_dev(server, 'iap', 'send_fake_refund', [APPLE, 'lc-1']), testing.wait_background(server)]);
    await testing.wait_background(server);
    expect(status).toBe(200);
    expect(await balance(server, a.user_id)).toBe(100n);
    expect(await purchase_count_of(server, a.user_id, '[iap_gems]')).toBe(1);
    expect(await core_events(server, a.user_id, 'core_iap_refunded')).toHaveLength(1);
    expect((await payment(server, a.user_id, 'lc-1'))?.result).toBe('REFUNDED');
  });
});
