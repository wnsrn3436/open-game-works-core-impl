import {
  CACHE_MS,
  EXPERIMENT,
  KEY,
  UNKNOWN_ID,
  advance,
  field,
  get_remote_config,
  insert_experiment,
  insert_override,
  new_user,
  restart,
  set_value,
  start,
  value,
  warnings,
  write_rows,
} from './helpers.ts';

describe('stored values that data no longer matches', () => {
  it('does not use the override of a key deleted from data, and logs one warn line at server start', async () => {
    const s = await start();
    await set_value(s, KEY.count, 5);
    await write_rows(s, (query) => {
      insert_override(query, UNKNOWN_ID, '"stored"');
    });
    expect(warnings(s)).toEqual([]);
    const after = await restart(s);
    const user = await new_user(after);
    const lines = warnings(after);
    expect(lines).toHaveLength(1);
    expect(field(lines[0] ?? {}, 'key_id')).toBe(UNKNOWN_ID);
    expect((await get_remote_config(user)).entries.map((e) => e.key_id)).not.toContain(UNKNOWN_ID);
    expect(await value(user, KEY.count)).toBe(5n);
  });

  it('does not use a stored value whose type does not match the key type, and logs warn lines at server start', async () => {
    const s = await start();
    // `[rc_flag]` is a Bool key and `[rc_title]` a String key: an Int text and a Bool text are stored values of another type.
    await write_rows(s, (query) => {
      insert_override(query, KEY.flag, '5');
      insert_experiment(query, { experiment_id: EXPERIMENT.a, key_ids: [KEY.title], groups: [{ name: 'g1', weight: 1, values: ['true'] }, { name: 'g2', weight: 1, values: ['true'] }] });
    });
    const after = await restart(s);
    const user = await new_user(after);
    expect(await value(user, KEY.flag)).toBe(false);
    expect(await value(user, KEY.title)).toBe('hello');
    const lines = warnings(after);
    expect(lines.map((line) => field(line, 'key_id'))).toEqual([KEY.flag, KEY.title, KEY.title]);
    expect(lines.filter((line) => field(line, 'experiment_id') === EXPERIMENT.a)).toHaveLength(2);
  });

  it('does not use an experiment not in the experiment table, and logs one warn line at server start', async () => {
    const s = await start();
    await write_rows(s, (query) => {
      insert_experiment(query, { experiment_id: UNKNOWN_ID, key_ids: [KEY.count], groups: [{ name: 'g1', weight: 1, values: ['6'] }, { name: 'g2', weight: 1, values: ['6'] }] });
    });
    const after = await restart(s);
    const user = await new_user(after);
    expect(await value(user, KEY.count)).toBe(10n);
    expect((await get_remote_config(user)).assignments).toEqual([]);
    const lines = warnings(after);
    expect(lines).toHaveLength(1);
    expect(field(lines[0] ?? {}, 'experiment_id')).toBe(UNKNOWN_ID);
  });

  it('does not use the experiment value of a key deleted from data and keeps the experiment for its other keys', async () => {
    const s = await start();
    await write_rows(s, (query) => {
      insert_experiment(query, { experiment_id: EXPERIMENT.a, key_ids: [UNKNOWN_ID, KEY.count], groups: [{ name: 'g1', weight: 1, values: ['"t"', '6'] }, { name: 'g2', weight: 1, values: ['"t"', '6'] }] });
    });
    const after = await restart(s);
    const user = await new_user(after);
    expect(await value(user, KEY.count)).toBe(6n);
    const lines = warnings(after);
    expect(lines).toHaveLength(1);
    expect([field(lines[0] ?? {}, 'experiment_id'), field(lines[0] ?? {}, 'key_id')]).toEqual([EXPERIMENT.a, UNKNOWN_ID]);
  });

  it('logs no warn line on cache reloads after server start', async () => {
    const s = await start();
    await write_rows(s, (query) => {
      insert_override(query, UNKNOWN_ID, '"stored"');
    });
    const after = await restart(s);
    await set_value(after, KEY.count, 1);
    await advance(2n * CACHE_MS, after);
    expect(warnings(after)).toHaveLength(1);
  });
});

describe('server start', () => {
  it('fails when a String key default_value is over remote-config.maxStringBytes', async () => {
    // `[rc_title]` has default_value `hello`, 5 bytes.
    await expect(start({ 'remote-config.maxStringBytes': 4 })).rejects.toThrow(/default_value of String key .*maxStringBytes 4/);
    const s = await start({ 'remote-config.maxStringBytes': 5 });
    expect(await value(await new_user(s), KEY.title)).toBe('hello');
  });
});
