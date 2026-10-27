import type { RoutingInput } from '../routing_module.ts';
import { create_routing } from '../routing_module.ts';

/** Job `storage_sweep` of a routing module whose `storage` returns `failed` from `sweep_expired` and `user_changes` from `run_user_changes`, with the error logs it leaves. */
function sweep_job(failed: readonly { table: string; code: string }[], user_changes: number | 'FAILED' = 0): { run: () => Promise<void>; errors: string[]; calls: string[] } {
  const errors: string[] = [];
  const calls: string[] = [];
  let job: (() => unknown) | null = null;
  const storage = {
    register_table: () => undefined,
    sweep_expired: () => {
      calls.push('sweep_expired');
      return Promise.resolve({ deleted: 3, failed });
    },
    run_user_changes: () => {
      calls.push('run_user_changes');
      return Promise.resolve(user_changes);
    },
  };
  const server_time = {
    schedule_job: (name: string, _period: bigint, fn: () => unknown) => {
      if (name === 'storage_sweep') job = fn;
    },
  };
  const logging = {
    write: (entry: { level: string; message: string }) => {
      if (entry.level === 'error') errors.push(entry.message);
    },
  };
  const input = { settings: { 'routing.storageSweepIntervalMs': 60000 }, modules: { storage, 'server-time': server_time, logging }, server: {} } as unknown as RoutingInput;
  create_routing(input).begin_start();
  return {
    run: async () => {
      if (job === null) throw new Error('storage_sweep is not scheduled');
      await job();
    },
    errors,
    calls,
  };
}

describe('job storage_sweep', () => {
  it('leaves one error log per table of the failed table list of sweep_expired, with its table name and DB error code, and calls run_user_changes', async () => {
    const sweep = sweep_job([
      { table: 'item_ledger_history', code: '57014' },
      { table: 'logging_server_event', code: '' },
    ]);
    await sweep.run();
    expect(sweep.calls).toEqual(['sweep_expired', 'run_user_changes']);
    expect(sweep.errors).toEqual([
      "storage_sweep: sweep_expired failed on table item_ledger_history, DB error code '57014'",
      "storage_sweep: sweep_expired failed on table logging_server_event, DB error code ''",
    ]);
  });

  it('leaves no error log when the failed table list is empty', async () => {
    const sweep = sweep_job([]);
    await sweep.run();
    expect(sweep.calls).toEqual(['sweep_expired', 'run_user_changes']);
    expect(sweep.errors).toEqual([]);
  });

  it('leaves one error log when run_user_changes is FAILED', async () => {
    const sweep = sweep_job([], 'FAILED');
    await sweep.run();
    expect(sweep.calls).toEqual(['sweep_expired', 'run_user_changes']);
    expect(sweep.errors).toEqual(['storage_sweep: run_user_changes failed']);
  });

  it('leaves no error log when run_user_changes returns a number', async () => {
    const sweep = sweep_job([], 2);
    await sweep.run();
    expect(sweep.errors).toEqual([]);
  });
});
