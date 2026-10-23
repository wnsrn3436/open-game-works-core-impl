import * as CoreContract from '../../../generated/contract/core_contract.ts';
import { advance, logs, new_user, request, rows, settle, START_TIME, start, stop_all, type Server } from './helpers.ts';

afterEach(() => {
  stop_all();
});

const INTERVAL_MS = 3_600_000n;
const MAX_ATTEMPTS = 3;
const SETTINGS = { 'logging.analyticsDeletionIntervalMs': Number(INTERVAL_MS), 'logging.analyticsDeletionMaxAttempts': MAX_ATTEMPTS };

function deletion_rows(server: Server, user_id: bigint): Record<string, unknown>[] {
  return rows(server, 'SELECT user_id, attempts, created_at FROM logging_analytics_deletion WHERE user_id = $1', [user_id]);
}

function deletion_calls(server: Server): unknown[] {
  return (server.fake?.calls() ?? []).filter((call) => call.operation === 'delete_user_data').map((call) => call.input);
}

/** `Withdraw` as far as logging takes part: `request_analytics_deletion` and `storage.delete_user` in one request transaction. */
function withdraw(server: Server, user_id: bigint, result: () => unknown = () => new CoreContract.WithdrawResponse()): Promise<{ code: number }> {
  return request(server, user_id, 'Withdraw', (ctx) => {
    expect(server.logging.request_analytics_deletion(ctx)).toBeNull();
    server.storage.delete_user(ctx);
    return result();
  });
}

describe('analytics deletion', () => {
  it('after Withdraw commits, the job calls delete_user_data of the fake adapter with the user ID and removes the row', async () => {
    const server = await start({ settings: SETTINGS });
    const user_id = await new_user(server);
    expect((await withdraw(server, user_id)).code).toBe(0);
    expect(deletion_rows(server, user_id)).toEqual([{ user_id, attempts: 0, created_at: START_TIME }]);
    expect(deletion_calls(server)).toEqual([]);
    await advance(server, INTERVAL_MS);
    expect(deletion_calls(server)).toEqual([user_id]);
    expect(deletion_rows(server, user_id)).toEqual([]);
    await advance(server, INTERVAL_MS);
    expect(deletion_calls(server)).toEqual([user_id]);
  });

  it('calls again on the next run after a failure, and at logging.analyticsDeletionMaxAttempts removes the row with an error log', async () => {
    const server = await start({ settings: SETTINGS });
    const retried = await new_user(server);
    await withdraw(server, retried);
    server.fake?.set_result('delete_user_data', false);
    await advance(server, INTERVAL_MS);
    expect(deletion_rows(server, retried)).toMatchObject([{ attempts: 1 }]);
    expect(logs(server, 'core').filter((line) => line.level === 'warn')).toEqual([expect.objectContaining({ user_id: retried.toString(), attempts: 1 })]);
    server.fake?.set_result('delete_user_data', true);
    await advance(server, INTERVAL_MS);
    expect(deletion_calls(server)).toEqual([retried, retried]);
    expect(deletion_rows(server, retried)).toEqual([]);

    const dropped = await new_user(server);
    await withdraw(server, dropped);
    server.fake?.set_failure('delete_user_data', 'communication_failure');
    for (let i = 1; i <= MAX_ATTEMPTS; i += 1) {
      await advance(server, INTERVAL_MS);
      if (i < MAX_ATTEMPTS) expect(deletion_rows(server, dropped)).toMatchObject([{ attempts: i }]);
    }
    expect(deletion_calls(server).filter((id) => id === dropped)).toHaveLength(MAX_ATTEMPTS);
    expect(deletion_rows(server, dropped)).toEqual([]);
    expect(logs(server, 'error')).toEqual([expect.objectContaining({ level: 'error', user_id: dropped.toString(), stack_trace: null, attempts: MAX_ATTEMPTS })]);
    await advance(server, INTERVAL_MS);
    expect(deletion_calls(server).filter((id) => id === dropped)).toHaveLength(MAX_ATTEMPTS);
  });

  it('runs the job when server start ends: no error on a fresh DB, and a row of an earlier server instance is sent at the next start', async () => {
    const first = await start({ settings: SETTINGS });
    await settle(first);
    expect(logs(first, 'error')).toEqual([]);
    const user_id = await new_user(first);
    await withdraw(first, user_id);
    first.stop();
    const second = await start({ settings: SETTINGS, db: first.db });
    await settle(second);
    expect(logs(second, 'error')).toEqual([]);
    expect(deletion_calls(second)).toEqual([user_id]);
    expect(deletion_rows(second, user_id)).toEqual([]);
  });

  it('counts a delete_user_data call that runs past logging.analyticsSendTimeoutMs as a failure and calls again on the next run', async () => {
    const server = await start({ settings: { ...SETTINGS, 'logging.analyticsSendTimeoutMs': 30 } });
    const user_id = await new_user(server);
    await withdraw(server, user_id);
    server.fake?.set_failure('delete_user_data', 'timeout');
    const started = performance.now();
    await advance(server, INTERVAL_MS);
    expect(performance.now() - started).toBeGreaterThanOrEqual(25);
    expect(deletion_rows(server, user_id)).toMatchObject([{ attempts: 1 }]);
    expect(logs(server, 'core').filter((line) => line.level === 'warn')).toEqual([expect.objectContaining({ user_id: user_id.toString(), attempts: 1 })]);
    server.fake?.set_failure('delete_user_data', null);
    await advance(server, INTERVAL_MS);
    expect(deletion_calls(server)).toEqual([user_id, user_id]);
    expect(deletion_rows(server, user_id)).toEqual([]);
  });

  it('logs an error and does not throw when the job cannot read its rows, and sends on the next run', async () => {
    const server = await start({ settings: SETTINGS });
    const user_id = await new_user(server);
    await withdraw(server, user_id);
    const storage = server.storage as { read_db: Server['storage']['read_db'] };
    const read_db = storage.read_db;
    storage.read_db = () => {
      throw new Error('connection lost');
    };
    await advance(server, INTERVAL_MS);
    storage.read_db = read_db;
    expect(deletion_calls(server)).toEqual([]);
    expect(logs(server, 'error')).toEqual([expect.objectContaining({ level: 'error', message: 'analytics deletion job failed', stack_trace: null })]);
    await advance(server, INTERVAL_MS);
    expect(deletion_calls(server)).toEqual([user_id]);
    expect(deletion_rows(server, user_id)).toEqual([]);
  });

  it('leaves no row for Withdraw in an environment without an analytics adapter, or for a rolled back transaction', async () => {
    const without = await start({ settings: SETTINGS, analytics: null });
    const quiet = await new_user(without);
    expect((await withdraw(without, quiet)).code).toBe(0);
    expect(deletion_rows(without, quiet)).toEqual([]);

    const server = await start({ settings: SETTINGS });
    const user_id = await new_user(server);
    expect((await withdraw(server, user_id, () => CoreContract.CoreError.CORE_ERROR_INTERNAL)).code).toBe(CoreContract.CoreError.CORE_ERROR_INTERNAL);
    expect(deletion_rows(server, user_id)).toEqual([]);
    await advance(server, INTERVAL_MS);
    expect(deletion_calls(server)).toEqual([]);
  });

  it('keeps one row for a user when deletion is requested twice', async () => {
    const server = await start({ settings: SETTINGS });
    const user_id = await new_user(server);
    await request(server, user_id, 'Resync', (ctx) => {
      server.logging.request_analytics_deletion(ctx);
      return new CoreContract.ResyncResponse();
    });
    await advance(server, 10n);
    await withdraw(server, user_id);
    expect(deletion_rows(server, user_id)).toEqual([{ user_id, attempts: 0, created_at: START_TIME }]);
  });
});
