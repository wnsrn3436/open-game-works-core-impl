import * as testing from '../../testing/dev/index.ts';
import { EXPERIMENT, KEY, get_remote_config, new_user, on, peer, put_experiment, restart, start, type Server, type Session } from './helpers.ts';

describe('group assignment across server instances', () => {
  it('assigns the same user the same group on another instance and after a restart', async () => {
    const a = await start();
    const groups = ['g0', 'g1', 'g2', 'g3'].map((name, i) => ({ name, weight: i + 1, values: [i] }));
    expect(await put_experiment(a, { experiment_id: EXPERIMENT.a, salt: 'across', key_ids: [KEY.count], groups })).toEqual({ experiment_id: EXPERIMENT.a });
    const users: Session[] = [];
    for (let i = 0; i < 20; i += 1) users.push(await new_user(a));
    const groups_on = async (s: Server): Promise<string[]> => {
      const out: string[] = [];
      for (const user of users) {
        const response = await get_remote_config(on(s, user));
        const assignment = response.assignments.find((x) => x.experiment_id === EXPERIMENT.a);
        if (assignment === undefined) throw new Error('no assignment');
        const count = response.entries.find((e) => e.key_id === KEY.count)?.value?.int_value;
        expect(count).toBe(BigInt(groups.findIndex((g) => g.name === assignment.group)));
        out.push(assignment.group);
      }
      return out;
    };
    const on_a = await groups_on(a);
    expect(new Set(on_a).size).toBeGreaterThan(1);
    const b = await peer(a);
    expect(await groups_on(b)).toEqual(on_a);
    await testing.stop_test_server(b);
    const restarted = await restart(a);
    expect(await groups_on(restarted)).toEqual(on_a);
  });
});
