import * as CoreContract from '../../../generated/contract/core_contract.ts';
import { Badge, HeroUserState, ProfileUserState, WalletServerState, hero, profile } from './kinds.ts';
import { CODE, delete_user_state, new_user, run_cheat, server, set_user_state, stop_all, stored, type Answer, type Server } from './support.ts';

afterEach(stop_all);

const SET = 'core/cheat/SetUserState';
const DELETE = 'core/cheat/DeleteUserState';

function entries(answer: Answer): [string, bigint, Uint8Array, boolean][] {
  return (answer.delta?.user_state.entries ?? []).map((e) => [e.kind, e.id, e.value, e.deleted]);
}

async function set(s: Server, user: bigint, kind: string, item_id: bigint, json: string): Promise<Answer> {
  return run_cheat(s, user, SET, set_user_state(kind, item_id, json));
}

describe('SetUserState', () => {
  it('writes the single kind item exactly as the JSON says and sends it in the delta', async () => {
    const s = await server();
    const user = await new_user(s);
    const first = await set(s, user, ProfileUserState.name, 0n, '{"level": 3, "title": "knight", "bestScore": "9007199254740993", "badge": {"rank": 2}}');
    expect(first.code).toBe(0);
    const written = profile(3, 'knight');
    written.best_score = 9_007_199_254_740_993n;
    written.badge = new Badge();
    written.badge.rank = 2;
    expect(await stored(s, user)).toEqual([[ProfileUserState.name, 0n, written.to_json()]]);
    expect(entries(first)).toEqual([[ProfileUserState.name, 0n, written.encode(), false]]);

    const second = await set(s, user, ProfileUserState.name, 0n, '{"level": 5}');
    expect(second.code).toBe(0);
    expect(await stored(s, user)).toEqual([[ProfileUserState.name, 0n, { level: 5 }]]);
    expect(entries(second)).toEqual([[ProfileUserState.name, 0n, profile(5, '').encode(), false]]);
  });

  it('writes a string with a surrogate pair exactly as the JSON says', async () => {
    const s = await server();
    const user = await new_user(s);
    const sent = await set(s, user, ProfileUserState.name, 0n, '{"title": "\\ud83d\\ude00"}');
    expect(sent.code).toBe(0);
    const written = profile(0, '\u{1F600}');
    expect(entries(sent)).toEqual([[ProfileUserState.name, 0n, written.encode(), false]]);
    expect(await stored(s, user)).toEqual([[ProfileUserState.name, 0n, written.to_json()]]);
  });

  it('writes a list kind item whose JSON id is the item ID', async () => {
    const s = await server();
    const user = await new_user(s);
    const sent = await set(s, user, HeroUserState.name, 4n, '{"id": "4", "power": 9, "weapon_id": 1001}');
    expect(sent.code).toBe(0);
    const written = hero(4n, 9);
    written.weapon_id = 1001;
    expect(entries(sent)).toEqual([[HeroUserState.name, 4n, written.encode(), false]]);
    expect(await stored(s, user)).toEqual([[HeroUserState.name, 4n, written.to_json()]]);
  });

  it('answers INVALID_REQUEST for JSON that does not fit the kind, a core kind and other kinds, and writes nothing', async () => {
    const s = await server();
    const user = await new_user(s);
    expect((await set(s, user, HeroUserState.name, 4n, '{"id": "4", "power": 1}')).code).toBe(0);
    const before = await stored(s, user);
    const balance = CoreContract.KINDS.find((k) => k.name === 'ItemBalanceUserState');
    expect(balance?.is_list).toBe(true);
    const cases: [string, bigint, string][] = [
      [HeroUserState.name, 4n, '{"id": "5", "power": 2}'],
      [HeroUserState.name, 4n, '{"power": 2}'],
      [HeroUserState.name, 4n, '{"id": "4", "power": "strong"}'],
      [HeroUserState.name, 4n, '{"id": "4", "power": 2'],
      [HeroUserState.name, 4n, '[{"id": "4"}]'],
      [HeroUserState.name, 4n, '{"id": "4", "pwr": 2}'],
      [ProfileUserState.name, 0n, '{"level": 1, "badge": {"rnk": 1}}'],
      [ProfileUserState.name, 0n, '{"title": "\\udc80"}'],
      [ProfileUserState.name, 0n, '{"title": "a\\ud800b"}'],
      [ProfileUserState.name, 0n, '{"title": "\\udfff"}'],
      [ProfileUserState.name, 1n, '{"level": 1}'],
      ['ItemBalanceUserState', 1n, '{"id": "1", "amount": "100"}'],
      ['NicknameUserState', 0n, '{}'],
      [WalletServerState.name, 0n, '{"coins": "5"}'],
      ['NoSuchUserState', 0n, '{}'],
    ];
    for (const [kind, item_id, json] of cases) {
      const sent = await set(s, user, kind, item_id, json);
      expect([kind, json, sent.code]).toEqual([kind, json, CODE.CORE_ERROR_INVALID_REQUEST]);
      expect(sent.delta).toBeNull();
    }
    expect(await stored(s, user)).toEqual(before);
  });
});

describe('DeleteUserState', () => {
  it('deletes the item and sends the deletion in the delta, and does nothing for an item that is not there', async () => {
    const s = await server();
    const user = await new_user(s);
    expect((await set(s, user, HeroUserState.name, 4n, '{"id": "4", "power": 1}')).code).toBe(0);
    expect((await set(s, user, HeroUserState.name, 5n, '{"id": "5", "power": 2}')).code).toBe(0);
    expect((await set(s, user, ProfileUserState.name, 0n, '{"level": 2}')).code).toBe(0);

    const deleted = await run_cheat(s, user, DELETE, delete_user_state(HeroUserState.name, 4n));
    expect(deleted.code).toBe(0);
    expect(entries(deleted).map(([kind, id, , gone]) => [kind, id, gone])).toEqual([[HeroUserState.name, 4n, true]]);
    const single = await run_cheat(s, user, DELETE, delete_user_state(ProfileUserState.name, 0n));
    expect(single.code).toBe(0);
    expect(entries(single).map(([kind, id, , gone]) => [kind, id, gone])).toEqual([[ProfileUserState.name, 0n, true]]);
    expect(await stored(s, user)).toEqual([[HeroUserState.name, 5n, hero(5n, 2).to_json()]]);

    const missing = await run_cheat(s, user, DELETE, delete_user_state(HeroUserState.name, 9n));
    expect(missing.code).toBe(0);
    expect(entries(missing)).toEqual([]);
    expect(await stored(s, user)).toEqual([[HeroUserState.name, 5n, hero(5n, 2).to_json()]]);
  });

  it('answers INVALID_REQUEST for a core kind, another kind, and a single kind with an item ID', async () => {
    const s = await server();
    const user = await new_user(s);
    expect((await set(s, user, ProfileUserState.name, 0n, '{"level": 2}')).code).toBe(0);
    for (const [kind, item_id] of [
      ['ItemBalanceUserState', 1n],
      [WalletServerState.name, 0n],
      ['NoSuchUserState', 0n],
      [ProfileUserState.name, 1n],
    ] as const) {
      expect((await run_cheat(s, user, DELETE, delete_user_state(kind, item_id))).code).toBe(CODE.CORE_ERROR_INVALID_REQUEST);
    }
    expect(await stored(s, user)).toEqual([[ProfileUserState.name, 0n, { level: 2 }]]);
  });
});
