import * as testing from '../../testing/dev/index.ts';
import {
  DAY,
  EXPERIMENT,
  KEY,
  MAX_GROUPS,
  MAX_STRING_BYTES,
  START_AT,
  UNKNOWN_ID,
  admin,
  clear_value,
  new_user,
  put_experiment,
  set_value,
  start,
  stop_experiment,
  two_groups,
  value,
} from './helpers.ts';

describe('admin input', () => {
  it('answers bad_request for a value of the wrong type', async () => {
    const s = await start();
    expect(await set_value(s, KEY.flag, 'true')).toBe('bad_request');
    expect(await set_value(s, KEY.flag, 1)).toBe('bad_request');
    expect(await set_value(s, KEY.count, 1.5)).toBe('bad_request');
    expect(await set_value(s, KEY.count, true)).toBe('bad_request');
    expect(await set_value(s, KEY.count, '9223372036854775808')).toBe('bad_request');
    expect(await set_value(s, KEY.count, '1e3')).toBe('bad_request');
    expect(await admin(s, 'set_config_value', `{"key_id": ${String(KEY.count)}, "value": 9223372036854775808}`)).toBe('bad_request');
    expect(await set_value(s, KEY.title, 5)).toBe('bad_request');
    expect(await set_value(s, KEY.title, null)).toBe('bad_request');
    expect(await set_value(s, KEY.title, 'x'.repeat(MAX_STRING_BYTES + 1))).toBe('bad_request');
    expect(await set_value(s, KEY.title, 'x'.repeat(MAX_STRING_BYTES))).toEqual({});
  });

  it('answers bad_request for groups whose values count differs from key_ids, or a value of the wrong type', async () => {
    const s = await start();
    const keys = [KEY.count, KEY.flag];
    expect(await put_experiment(s, { experiment_id: EXPERIMENT.a, key_ids: keys, groups: two_groups([1]) })).toBe('bad_request');
    expect(await put_experiment(s, { experiment_id: EXPERIMENT.a, key_ids: keys, groups: two_groups([1, true], [1, true, 3]) })).toBe('bad_request');
    expect(await put_experiment(s, { experiment_id: EXPERIMENT.a, key_ids: keys, groups: two_groups([1, true], [true, 1]) })).toBe('bad_request');
    expect(await put_experiment(s, { experiment_id: EXPERIMENT.a, key_ids: keys, groups: two_groups([1, true], [2, false]) })).toEqual({ experiment_id: EXPERIMENT.a });
  });

  it('answers bad_request for the other experiment input rules', async () => {
    const s = await start();
    const ok = { experiment_id: EXPERIMENT.a, key_ids: [KEY.count], groups: two_groups([1]) };
    expect(await put_experiment(s, { ...ok, salt: '' })).toBe('bad_request');
    expect(await put_experiment(s, { ...ok, start_at: START_AT, end_at: START_AT })).toBe('bad_request');
    expect(await put_experiment(s, { ...ok, key_ids: [], groups: two_groups([]) })).toBe('bad_request');
    expect(await put_experiment(s, { ...ok, key_ids: [KEY.count, KEY.count], groups: two_groups([1, 1]) })).toBe('bad_request');
    expect(await put_experiment(s, { ...ok, groups: [{ name: 'only', weight: 1, values: [1] }] })).toBe('bad_request');
    const over = Array.from({ length: MAX_GROUPS + 1 }, (_, i) => ({ name: `g${String(i)}`, weight: 1, values: [i] }));
    expect(await put_experiment(s, { ...ok, groups: over })).toBe('bad_request');
    expect(await put_experiment(s, { ...ok, groups: over.slice(0, MAX_GROUPS) })).toEqual({ experiment_id: EXPERIMENT.a });
    expect(await put_experiment(s, { ...ok, groups: [{ name: 'same', weight: 1, values: [1] }, { name: 'same', weight: 1, values: [2] }] })).toBe('bad_request');
    expect(await put_experiment(s, { ...ok, groups: [{ name: 'a', weight: 0, values: [1] }, { name: 'b', weight: 1, values: [2] }] })).toBe('bad_request');
  });

  it('answers not_found for a key ID value not in remote_config_key', async () => {
    const s = await start();
    expect(await set_value(s, UNKNOWN_ID, 1)).toBe('not_found');
    expect(await clear_value(s, UNKNOWN_ID)).toBe('not_found');
    expect(await put_experiment(s, { experiment_id: EXPERIMENT.a, key_ids: [KEY.count, UNKNOWN_ID], groups: two_groups([1, 1]) })).toBe('not_found');
  });

  it('answers not_found for an experiment_id not in the experiment table', async () => {
    const s = await start();
    expect(await put_experiment(s, { experiment_id: UNKNOWN_ID, key_ids: [KEY.count], groups: two_groups([1]) })).toBe('not_found');
    expect(await put_experiment(s, { experiment_id: KEY.count, key_ids: [KEY.count], groups: two_groups([1]) })).toBe('not_found');
    expect(await stop_experiment(s, UNKNOWN_ID)).toBe('not_found');
  });

  it('writes an audit line for a failure reason', async () => {
    const s = await start();
    expect(await set_value(s, UNKNOWN_ID, 1)).toBe('not_found');
    const audits = testing.read_logs(s, 'audit').filter((line) => line['request'] === 'set_config_value');
    expect(audits.length).toBeGreaterThan(0);
  });
});

describe('experiment overlap', () => {
  it('answers conflict when the period and a key overlap an experiment not stopped', async () => {
    const s = await start();
    expect(await put_experiment(s, { experiment_id: EXPERIMENT.a, start_at: START_AT, end_at: START_AT + DAY, key_ids: [KEY.count, KEY.flag], groups: two_groups([1, true]) })).toEqual({ experiment_id: EXPERIMENT.a });
    expect(await put_experiment(s, { experiment_id: EXPERIMENT.b, start_at: START_AT + DAY - 1n, end_at: START_AT + 2n * DAY, key_ids: [KEY.flag], groups: two_groups([false]) })).toBe('conflict');
    // A period that starts at end_at does not overlap, nor does another key.
    expect(await put_experiment(s, { experiment_id: EXPERIMENT.b, start_at: START_AT + DAY, end_at: START_AT + 2n * DAY, key_ids: [KEY.flag], groups: two_groups([false]) })).toEqual({ experiment_id: EXPERIMENT.b });
    expect(await put_experiment(s, { experiment_id: EXPERIMENT.c, start_at: START_AT, end_at: START_AT + DAY, key_ids: [KEY.title], groups: two_groups(['t']) })).toEqual({ experiment_id: EXPERIMENT.c });
    // Replacing the experiment itself does not conflict with its stored row.
    expect(await put_experiment(s, { experiment_id: EXPERIMENT.a, start_at: START_AT, end_at: START_AT + DAY, key_ids: [KEY.count, KEY.flag], groups: two_groups([2, false]) })).toEqual({ experiment_id: EXPERIMENT.a });
  });

  it('lets one of two concurrent overlapping put_experiment calls succeed and answers conflict to the other', async () => {
    const s = await start();
    const input = { start_at: START_AT, end_at: START_AT + DAY, key_ids: [KEY.count], groups: two_groups([1]) };
    const results = await Promise.all([
      put_experiment(s, { ...input, operation_id: 'op-a', experiment_id: EXPERIMENT.a }),
      put_experiment(s, { ...input, operation_id: 'op-b', experiment_id: EXPERIMENT.b }),
    ]);
    expect(results.filter((r) => typeof r === 'object')).toHaveLength(1);
    expect(results.filter((r) => r === 'conflict')).toHaveLength(1);
    const listed = await admin(s, 'list_remote_config');
    if (typeof listed === 'string') throw new Error(listed);
    expect(listed['experiments'] as unknown[]).toHaveLength(1);
  });

  it('lets put_experiment overlap a stopped experiment, and makes a stopped experiment active again when put again', async () => {
    const s = await start();
    const user = await new_user(s);
    const input = { start_at: START_AT, end_at: START_AT + DAY, key_ids: [KEY.count] };
    expect(await put_experiment(s, { ...input, experiment_id: EXPERIMENT.a, groups: two_groups([1]) })).toEqual({ experiment_id: EXPERIMENT.a });
    expect(await stop_experiment(s, EXPERIMENT.a)).toEqual({});
    expect(await put_experiment(s, { ...input, experiment_id: EXPERIMENT.b, groups: two_groups([2]) })).toEqual({ experiment_id: EXPERIMENT.b });
    expect(await value(user, KEY.count)).toBe(2n);
    expect(await stop_experiment(s, EXPERIMENT.b)).toEqual({});
    expect(await value(user, KEY.count)).toBe(10n);
    expect(await put_experiment(s, { ...input, experiment_id: EXPERIMENT.a, groups: two_groups([3]) })).toEqual({ experiment_id: EXPERIMENT.a });
    expect(await value(user, KEY.count)).toBe(3n);
  });
});

describe('list_remote_config', () => {
  it('lists the override and experiment rows by ID value, with values as JSON values', async () => {
    const s = await start();
    await set_value(s, KEY.count, '123');
    await set_value(s, KEY.title, 'abc');
    await put_experiment(s, { experiment_id: EXPERIMENT.a, salt: 's1', key_ids: [KEY.flag], groups: two_groups([true], [false]) });
    await stop_experiment(s, EXPERIMENT.a);
    const at = String(START_AT);
    expect(await admin(s, 'list_remote_config')).toEqual({
      overrides: [
        { key_id: KEY.count, value: '123', updated_at: at },
        { key_id: KEY.title, value: 'abc', updated_at: at },
      ].sort((x, y) => x.key_id - y.key_id),
      experiments: [{
        experiment_id: EXPERIMENT.a,
        salt: 's1',
        start_at: at,
        end_at: String(START_AT + DAY),
        key_ids: [KEY.flag],
        groups: [{ name: 'g1', weight: 1, values: [true] }, { name: 'g2', weight: 1, values: [false] }],
        stopped: true,
        updated_at: at,
      }],
    });
  });

  it('answers not_found for stop_experiment of an experiment never put', async () => {
    const s = await start();
    expect(await stop_experiment(s, EXPERIMENT.c)).toBe('not_found');
  });
});
