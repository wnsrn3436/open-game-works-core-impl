import * as CoreContract from '../../../generated/contract/core_contract.ts';
import { guest } from '../../auth/tests/helpers.ts';
import * as testing from '../../testing/dev/index.ts';
import { DAY, EXPERIMENT, KEY, START_AT, get_remote_config, new_user, plain, put_experiment, run_ok, set_value, start, two_groups } from './helpers.ts';

const Kind = CoreContract.RemoteConfigValueKind;

/** The `GetRemoteConfig` response in the `Login` response of a new guest. */
async function login_config(s: Awaited<ReturnType<typeof start>>): Promise<{ config: CoreContract.GetRemoteConfigResponse; session: testing.TestSession }> {
  const { session, result } = await guest(s);
  if (result.remote_config === null) throw new Error('Login response has no remote_config');
  return { config: result.remote_config, session };
}

describe('GetRemoteConfig and the Login response', () => {
  it('have no key whose client is false', async () => {
    const s = await start();
    await set_value(s, KEY.threshold, 8);
    await set_value(s, KEY.hidden_flag, false);
    const { config, session } = await login_config(s);
    for (const response of [config, await get_remote_config(session)]) {
      const ids = response.entries.map((e) => e.key_id);
      expect(ids).not.toContain(KEY.threshold);
      expect(ids).not.toContain(KEY.hidden_flag);
      expect([...ids].sort((x, y) => x - y)).toEqual([KEY.flag, KEY.count, KEY.title].sort((x, y) => x - y));
    }
  });

  it('give every entry the value.kind of its key type with only that field set', async () => {
    const s = await start();
    const user = await new_user(s);
    const kinds = new Map((await get_remote_config(user)).entries.map((e) => [e.key_id, e.value?.kind]));
    expect(kinds).toEqual(new Map([[KEY.flag, Kind.REMOTE_CONFIG_VALUE_KIND_BOOL], [KEY.count, Kind.REMOTE_CONFIG_VALUE_KIND_INT], [KEY.title, Kind.REMOTE_CONFIG_VALUE_KIND_STRING]]));
    // A true Bool, a non-zero Int and a non-empty String have their field set, and only it (`plain` checks).
    await set_value(s, KEY.flag, true);
    await set_value(s, KEY.count, -5);
    const { config, session } = await login_config(s);
    for (const response of [config, await get_remote_config(session)]) {
      const values = new Map(response.entries.map((e) => {
        if (e.value === null) throw new Error('entry without value');
        return [e.key_id, plain(e.value)];
      }));
      expect(values).toEqual(new Map<number, unknown>([[KEY.flag, true], [KEY.count, -5n], [KEY.title, 'hello']]));
    }
  });

  it('are what get_client_config gives', async () => {
    const s = await start();
    await put_experiment(s, { experiment_id: EXPERIMENT.a, key_ids: [KEY.count], groups: two_groups([1], [2]) });
    const { config, session } = await login_config(s);
    const client = await run_ok(session, (ctx, core) => core['remote-config'].get_client_config(ctx));
    const response = await get_remote_config(session);
    for (const got of [config, response]) {
      expect(got.entries.map((e) => e.encode())).toEqual(client.entries.map((e) => e.encode()));
      expect(got.assignments.map((a) => a.encode())).toEqual(client.assignments.map((a) => a.encode()));
    }
  });

  it('list in assignments only active experiments with a client key, by experiment table ID value', async () => {
    const s = await start();
    expect(await put_experiment(s, { experiment_id: EXPERIMENT.a, key_ids: [KEY.count], groups: [{ name: 'x', weight: 1, values: [1] }, { name: 'y', weight: 1, values: [2] }] })).toEqual({ experiment_id: EXPERIMENT.a });
    expect(await put_experiment(s, { experiment_id: EXPERIMENT.b, key_ids: [KEY.threshold], groups: [{ name: 'x', weight: 1, values: [1] }, { name: 'y', weight: 1, values: [2] }] })).toEqual({ experiment_id: EXPERIMENT.b });
    expect(await put_experiment(s, { experiment_id: EXPERIMENT.c, start_at: START_AT + DAY, end_at: START_AT + 2n * DAY, key_ids: [KEY.flag], groups: [{ name: 'x', weight: 1, values: [true] }, { name: 'y', weight: 1, values: [false] }] })).toEqual({ experiment_id: EXPERIMENT.c });
    const experiment_ids = new Set(testing.load_data().data.ExperimentTable.all_rows().map((row) => row.id));
    const { config, session } = await login_config(s);
    for (const response of [config, await get_remote_config(session)]) {
      expect(response.assignments.map((a) => a.experiment_id)).toEqual([EXPERIMENT.a]);
      for (const assignment of response.assignments) expect(experiment_ids.has(assignment.experiment_id)).toBe(true);
      const [assignment] = response.assignments;
      expect(['x', 'y']).toContain(assignment?.group);
      expect(response.entries.find((e) => e.key_id === KEY.count)?.value?.int_value).toBe(assignment?.group === 'x' ? 1n : 2n);
    }
  });
});

describe('server build data', () => {
  it('has the remote_config_key rows whose client is false', () => {
    const { data } = testing.load_data();
    expect(data.RemoteConfigKeyTable.has_row(KEY.threshold)).toBe(true);
    expect(data.RemoteConfigKeyTable.get_row(KEY.threshold).client).toBe(false);
    expect(data.RemoteConfigKeyTable.has_row(KEY.hidden_flag)).toBe(true);
  });
});
