import * as testing from '../../testing/dev/index.ts';
import { assign_group } from '../assign.ts';

interface GroupCase {
  name: string;
  input: { salt: string; groups: { name: string; weight: number }[]; user_ids: string[] };
  expected: { group_by_user: Record<string, string>; count_by_group: Record<string, number> };
}

/** The core test fixture `remote-config-group`. */
function group_cases(): GroupCase[] {
  return (JSON.parse(new TextDecoder().decode(testing.read_core_fixture('remote-config-group'))) as { cases: GroupCase[] }).cases;
}

function weighted(groups: GroupCase['input']['groups']): { name: string; weight: bigint }[] {
  return groups.map((group) => ({ name: group.name, weight: BigInt(group.weight) }));
}

describe('group assignment', () => {
  const cases = group_cases();

  it('has cases', () => {
    expect(cases.length).toBeGreaterThan(0);
  });

  for (const c of cases) {
    it(`assigns the fixture groups: ${c.name}`, () => {
      const groups = weighted(c.input.groups);
      const by_user: Record<string, string> = {};
      for (const user of c.input.user_ids) by_user[user] = assign_group(c.input.salt, groups, BigInt(user)).name;
      expect(by_user).toEqual(c.expected.group_by_user);
      const counts: Record<string, number> = Object.fromEntries(groups.map((group) => [group.name, 0]));
      for (let user = 1n; user <= 10_000n; user += 1n) {
        const name = assign_group(c.input.salt, groups, user).name;
        counts[name] = (counts[name] ?? 0) + 1;
      }
      expect(counts).toEqual(c.expected.count_by_group);
    });
  }

  it('gives the same user the same group for the same salt and groups, every call', () => {
    const groups = [{ name: 'a', weight: 3n }, { name: 'b', weight: 5n }, { name: 'c', weight: 1n }];
    for (let user = 1n; user <= 500n; user += 1n) {
      expect(assign_group('stable', groups, user).name).toBe(assign_group('stable', groups.map((g) => ({ ...g })), user).name);
    }
  });
});
