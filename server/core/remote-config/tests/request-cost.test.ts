import { DAY, EXPERIMENT, KEY, START_AT, new_user, plain, put_experiment, run_ok, start, stop_experiment } from './helpers.ts';

/** The number of `createHash('sha256')` calls: each group assignment makes one. */
const hashes = vi.hoisted(() => ({ count: 0 }));

vi.mock('node:crypto', async (import_original) => {
  const crypto = await import_original<typeof import('node:crypto')>();
  return {
    ...crypto,
    createHash: (...args: Parameters<typeof crypto.createHash>) => {
      if (args[0] === 'sha256') hashes.count += 1;
      return crypto.createHash(...args);
    },
  };
});

describe('one request', () => {
  it('assigns the user to each active experiment once over get_client_config and get_config of its keys', async () => {
    const s = await start();
    expect(
      await put_experiment(s, {
        experiment_id: EXPERIMENT.a,
        key_ids: [KEY.flag, KEY.count, KEY.title],
        groups: [
          { name: 'g1', weight: 1, values: [true, 1, 'one'] },
          { name: 'g2', weight: 1, values: [false, 2, 'two'] },
        ],
      }),
    ).toEqual({ experiment_id: EXPERIMENT.a });
    const user = await new_user(s);
    const got = await run_ok(user, (ctx, core) => {
      const remote = core['remote-config'];
      const before = hashes.count;
      const client = remote.get_client_config(ctx);
      const after_client = hashes.count;
      const values = [KEY.flag, KEY.count, KEY.title].map((key_id) => plain(remote.get_config(ctx, key_id)));
      return { client, client_hashes: after_client - before, config_hashes: hashes.count - after_client, values };
    });
    expect(got.client_hashes).toBe(1);
    expect(got.config_hashes).toBe(0);
    expect(got.client.assignments.map((a) => a.experiment_id)).toEqual([EXPERIMENT.a]);
    const group = got.client.assignments[0]?.group;
    const expected = group === 'g1' ? [true, 1n, 'one'] : [false, 2n, 'two'];
    expect(['g1', 'g2']).toContain(group);
    expect(got.values).toEqual(expected);
    const entries = new Map(got.client.entries.map((e) => [e.key_id, e.value === null ? null : plain(e.value)]));
    expect([KEY.flag, KEY.count, KEY.title].map((key_id) => entries.get(key_id))).toEqual(expected);
  });

  it('assigns no group for stopped experiments and experiments outside their period', async () => {
    const s = await start();
    expect(await put_experiment(s, { experiment_id: EXPERIMENT.a, key_ids: [KEY.count], groups: [{ name: 'x', weight: 1, values: [1] }, { name: 'y', weight: 1, values: [2] }] })).toEqual({ experiment_id: EXPERIMENT.a });
    expect(
      await put_experiment(s, { experiment_id: EXPERIMENT.b, start_at: START_AT + DAY, end_at: START_AT + 2n * DAY, key_ids: [KEY.title], groups: [{ name: 'x', weight: 1, values: ['x'] }, { name: 'y', weight: 1, values: ['y'] }] }),
    ).toEqual({ experiment_id: EXPERIMENT.b });
    expect(await put_experiment(s, { experiment_id: EXPERIMENT.c, key_ids: [KEY.flag], groups: [{ name: 'x', weight: 1, values: [true] }, { name: 'y', weight: 1, values: [true] }] })).toEqual({ experiment_id: EXPERIMENT.c });
    expect(await stop_experiment(s, EXPERIMENT.c)).toEqual({});
    const user = await new_user(s);
    const got = await run_ok(user, (ctx, core) => {
      const before = hashes.count;
      const client = core['remote-config'].get_client_config(ctx);
      return { client, hashes: hashes.count - before };
    });
    expect(got.hashes).toBe(1);
    expect(got.client.assignments.map((a) => a.experiment_id)).toEqual([EXPERIMENT.a]);
    const entries = new Map(got.client.entries.map((e) => [e.key_id, e.value === null ? null : plain(e.value)]));
    expect(entries.get(KEY.title)).toBe('hello');
    expect(entries.get(KEY.flag)).toBe(false);
  });
});
