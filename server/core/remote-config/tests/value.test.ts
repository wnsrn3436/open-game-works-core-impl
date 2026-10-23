import * as testing from '../../testing/dev/index.ts';
import {
  CACHE_MS,
  CoreError,
  DAY,
  EXPERIMENT,
  KEY,
  OVER_HTTP,
  START_AT,
  UNKNOWN_ID,
  advance,
  clear_value,
  field,
  get_remote_config,
  insert_experiment,
  new_user,
  on,
  peer,
  plain,
  put_experiment,
  relogin,
  restart,
  run,
  run_ok,
  set_value,
  start,
  stop_experiment,
  two_groups,
  value,
  write_rows,
} from './helpers.ts';

describe('value selection', () => {
  it('returns default_value with neither override nor experiment', async () => {
    const s = await start();
    const user = await new_user(s);
    expect(await value(user, KEY.flag)).toBe(false);
    expect(await value(user, KEY.count)).toBe(10n);
    expect(await value(user, KEY.title)).toBe('hello');
    expect(await value(user, KEY.threshold)).toBe(7n);
    expect(await value(user, KEY.hidden_flag)).toBe(true);
  });

  it('gives every instance the set value within cacheMs, and default_value after clear_config_value', async () => {
    const a = await start();
    const b = await peer(a);
    const user = await new_user(a);
    expect(await set_value(a, KEY.count, 42)).toEqual({});
    expect(await value(user, KEY.count)).toBe(42n);
    expect(await value(on(b, user), KEY.count)).toBe(10n);
    await advance(CACHE_MS, a, b);
    expect(await value(on(b, user), KEY.count)).toBe(42n);

    expect(await clear_value(a, KEY.count)).toEqual({});
    expect(await value(user, KEY.count)).toBe(10n);
    await advance(CACHE_MS, a, b);
    expect(await value(on(b, user), KEY.count)).toBe(10n);
  });

  it('accepts an Int value as an int64 decimal string or a JSON integer beyond 2^53, and a Bool and a String', async () => {
    const s = await start();
    const user = await new_user(s);
    expect(await set_value(s, KEY.count, '-9223372036854775808')).toEqual({});
    expect(await value(user, KEY.count)).toBe(-9_223_372_036_854_775_808n);
    expect(await admin_raw(s, `{"key_id": ${String(KEY.count)}, "value": 9223372036854775807}`)).toEqual({});
    expect(await value(user, KEY.count)).toBe(9_223_372_036_854_775_807n);
    expect(await set_value(s, KEY.flag, true)).toEqual({});
    expect(await set_value(s, KEY.title, '안녕')).toEqual({});
    expect(await value(user, KEY.flag)).toBe(true);
    expect(await value(user, KEY.title)).toBe('안녕');
  });

  it('puts an active experiment before an override, and the override or default_value outside the period and after stop_experiment', async () => {
    const s = await start();
    let user = await new_user(s);
    await set_value(s, KEY.count, 42);
    const start_at = START_AT + 1_000n;
    const end_at = START_AT + DAY;
    expect(await put_experiment(s, { experiment_id: EXPERIMENT.a, start_at, end_at, key_ids: [KEY.count, KEY.title], groups: two_groups([100, 'one'], [200, 'two']) }))
      .toEqual({ experiment_id: EXPERIMENT.a });
    // Before the period.
    expect(await value(user, KEY.count)).toBe(42n);
    expect(await value(user, KEY.title)).toBe('hello');
    await advance(1_000n, s);
    const in_period = await value(user, KEY.count);
    expect([100n, 200n]).toContain(in_period);
    expect(await value(user, KEY.title)).toBe(in_period === 100n ? 'one' : 'two');
    // end_at is not in the period.
    await advance(end_at - start_at, s);
    user = await relogin(user);
    expect(await value(user, KEY.count)).toBe(42n);

    expect(await put_experiment(s, { experiment_id: EXPERIMENT.a, start_at: START_AT, end_at: START_AT + 10n * DAY, key_ids: [KEY.count], groups: two_groups([100]) }))
      .toEqual({ experiment_id: EXPERIMENT.a });
    expect(await value(user, KEY.count)).toBe(100n);
    expect(await stop_experiment(s, EXPERIMENT.a)).toEqual({});
    expect(await value(user, KEY.count)).toBe(42n);
    await clear_value(s, KEY.count);
    expect(await value(user, KEY.count)).toBe(10n);
  });

  it('uses the experiment with the smallest experiment_id when two active experiments have the key', async () => {
    const s = await start();
    const [low, high] = EXPERIMENT.a < EXPERIMENT.b ? [EXPERIMENT.a, EXPERIMENT.b] : [EXPERIMENT.b, EXPERIMENT.a];
    // put_experiment does not store two overlapping experiments; rows an earlier data version left can be.
    await write_rows(s, (query) => {
      insert_experiment(query, { experiment_id: high, key_ids: [KEY.count], groups: [{ name: 'h1', weight: 1, values: ['2'] }, { name: 'h2', weight: 1, values: ['2'] }] });
      insert_experiment(query, { experiment_id: low, key_ids: [KEY.count], groups: [{ name: 'l1', weight: 1, values: ['1'] }, { name: 'l2', weight: 1, values: ['1'] }] });
    });
    const restarted = await restart(s);
    const user = await new_user(restarted);
    expect(await value(user, KEY.count)).toBe(1n);
    expect((await get_remote_config(user)).assignments.map((a) => a.experiment_id)).toEqual([low, high]);
  });

  it('keeps the value of a key within one request while the cache changes', async () => {
    const a = await start();
    const b = await peer(a);
    const user = await new_user(a);
    expect(await set_value(b, KEY.count, 77)).toEqual({});
    const values = await run_ok(user, (ctx, core) => {
      const remote = core['remote-config'];
      const first = plain(remote.get_config(ctx, KEY.count));
      const client_first = remote.get_client_config(ctx).entries.find((e) => e.key_id === KEY.count)?.value?.int_value;
      // The clock reaches the next run of the cache job: the job of `a` reads the value `b` wrote while this request is open.
      testing.advance_time(a, CACHE_MS);
      const second = plain(remote.get_config(ctx, KEY.count));
      const client_second = remote.get_client_config(ctx).entries.find((e) => e.key_id === KEY.count)?.value?.int_value;
      return { first, second, client_first, client_second };
    });
    expect(values).toEqual({ first: 10n, second: 10n, client_first: 10n, client_second: 10n });
    // The job ran during that request: the next request has the new value without another cache run.
    await testing.wait_background(a);
    expect(await value(user, KEY.count)).toBe(77n);
  });

  it('throws on get_config of a key ID value not in remote_config_key: INTERNAL with the error log of routing', async () => {
    const s = await start();
    const user = await new_user(s);
    const result = await run(user, (ctx, core) => core['remote-config'].get_config(ctx, UNKNOWN_ID));
    expect(result.code).toBe(CoreError.CORE_ERROR_INTERNAL);
    if (!OVER_HTTP) {
      // Without the core test data rpc `RunCoreTest`, the throw comes back here instead of through routing.
      expect(String(result.thrown)).toContain(String(UNKNOWN_ID));
      return;
    }
    const errors = testing.read_logs(s, 'error', 'error').filter((line) => line['request'] === 'RunCoreTest');
    expect(errors).toHaveLength(1);
    expect(String(field(errors[0] ?? {}, 'stack_trace'))).toContain(String(UNKNOWN_ID));
  });
});

/** `set_config_value` with a JSON body text, which can hold integers beyond 2^53. */
async function admin_raw(s: Awaited<ReturnType<typeof start>>, body: string): Promise<unknown> {
  const reply = await testing.send_admin(s, 'set_config_value', body);
  return reply.status === 200 ? reply.json : (reply.json as { error?: string } | null)?.error;
}
