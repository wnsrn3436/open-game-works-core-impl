import { boss, BossGameState, deck, DeckUserState, profile, ProfileUserState, quest, QuestUserState, wallet, WalletServerState } from '../../storage/tests/kinds.ts';
import { DELETE, type Converter } from '../index.ts';
import { CONVERTER_LIST, CURRENT, default_converters } from './contract.ts';
import { log_field, new_user, request, row, seed, seed_game, server, stop_all, stored, wait_background, type Server } from './helpers.ts';

afterEach(() => {
  stop_all();
});

const Q = 'quest_user_state';

/** The quest from 2 converter with one item that gets a special result. */
function quest_2_with(item_id: bigint, result: (item: QuestUserState) => ReturnType<Converter>): Record<string, Converter> {
  const fallback = default_converters()['QuestUserState:2'] as Converter;
  return {
    'QuestUserState:2': (item, data) => ((item as QuestUserState).id === item_id ? result(item as QuestUserState) : fallback(item, data)),
  };
}

function conversion_errors(s: Server): readonly Readonly<Record<string, unknown>>[] {
  return s.logs.filter((l) => l['kind'] === 'error' && l['message'] === 'item conversion failed');
}

describe('converters', () => {
  it('applies (1) then (2) to a version 1 item and only (2) to a version 2 item, and stores both at the current contract version', async () => {
    const s = await server();
    const user = await new_user(s);
    await seed(s, user, [row('user_state', Q, 1n, 1n, quest(1n, 5n)), row('user_state', Q, 2n, 2n, quest(2n, 5n))]);
    const read = await request(s, user, (ctx) => [s.storage.get_state(ctx, QuestUserState, 1n), s.storage.get_state(ctx, QuestUserState, 2n)]);
    expect(read).toEqual([quest(1n, 30n), quest(2n, 10n)]);
    for (const [id, progress] of [
      [1n, 30n],
      [2n, 10n],
    ] as const) {
      expect(stored(s, 'user_state', user, Q, id)).toEqual({ value: quest(id, progress).encode(), contract_version: CURRENT });
    }
  });

  it('skips a version with no registered converter and applies the next one', async () => {
    const s = await server();
    const user = await new_user(s);
    await seed(s, user, [row('user_state', 'deck_user_state', 1n, 1n, deck(1n, 1n)), row('user_state', 'profile_user_state', 0n, 1n, profile(4n))]);
    const read = await request(s, user, (ctx) => [s.storage.get_state(ctx, DeckUserState, 1n), s.storage.get_state(ctx, ProfileUserState, 0n)]);
    expect(read).toEqual([deck(1n, 1001n), profile(4n)]);
    expect(stored(s, 'user_state', user, 'deck_user_state', 1n)?.contract_version).toBe(CURRENT);
  });

  it('applies only the registered converters to an item with a very low stored contract version, without stepping through every version', async () => {
    const s = await server();
    const user = await new_user(s);
    const lowest = -BigInt(Number.MAX_SAFE_INTEGER);
    await seed(s, user, [row('user_state', Q, 1n, lowest, quest(1n, 5n)), row('user_state', Q, 2n, 0n, quest(2n, 5n))]);
    const read = await request(s, user, (ctx) => [s.storage.get_state(ctx, QuestUserState, 1n), s.storage.get_state(ctx, QuestUserState, 2n)]);
    expect(read).toEqual([quest(1n, 30n), quest(2n, 30n)]);
    expect(stored(s, 'user_state', user, Q, 1n)).toEqual({ value: quest(1n, 30n).encode(), contract_version: CURRENT });
  });

  it('converts server state and game state items on read', async () => {
    const s = await server();
    const user = await new_user(s);
    await seed(s, user, [row('server_state', 'wallet_server_state', 0n, 1n, wallet(5n))]);
    await seed_game(s, [row('game_state', 'boss_game_state', 4n, 1n, boss(4n, 50n))]);
    const read = await request(s, user, (ctx) => [s.storage.get_state(ctx, WalletServerState, 0n), s.storage.get_game_state(ctx, BossGameState, 4n)]);
    expect(read).toEqual([wallet(105n), boss(4n, 57n)]);
    expect(stored(s, 'server_state', user, 'wallet_server_state', 0n)?.contract_version).toBe(CURRENT);
    expect(stored(s, 'game_state', null, 'boss_game_state', 4n)?.contract_version).toBe(CURRENT);
  });

  it('deletes the item when a converter returns a delete, and the delta has the delete', async () => {
    const s = await server({ converters: quest_2_with(9n, () => DELETE) });
    const user = await new_user(s);
    await seed(s, user, [row('user_state', Q, 9n, 1n, quest(9n, 1n)), row('user_state', Q, 3n, 2n, quest(3n, 1n))]);
    const result = await request(s, user, (ctx) => {
      const read = [s.storage.get_state(ctx, QuestUserState, 9n), s.storage.get_state(ctx, QuestUserState, 3n)];
      return { read, delta: s.storage.take_response_delta(ctx).delta.user_state };
    });
    if (typeof result === 'string') throw new Error(result);
    expect(result.read).toEqual([null, quest(3n, 2n)]);
    expect(stored(s, 'user_state', user, Q, 9n)).toBeNull();
    const deleted = result.delta.entries.filter((e) => e.deleted).map((e) => [e.kind, e.id]);
    expect(deleted).toEqual([['QuestUserState', 9n]]);
  });

  it('a converter that throws makes the request fail (INTERNAL) and leaves the bytes and contract version of the item', async () => {
    const s = await server({
      converters: quest_2_with(13n, () => {
        throw new Error('converter bug');
      }),
    });
    const user = await new_user(s);
    const before = row('user_state', Q, 13n, 1n, quest(13n, 1n));
    await seed(s, user, [before]);
    // The read throws in the handler; routing answers an exception with INTERNAL.
    await expect(request(s, user, (ctx) => s.storage.get_state(ctx, QuestUserState, 13n))).rejects.toThrow();
    expect(stored(s, 'user_state', user, Q, 13n)).toEqual({ value: before.value, contract_version: 1n });
    expect(conversion_errors(s)).toHaveLength(1);
  });

  it('a converter that returns another kind message or another id is FAILED', async () => {
    const s = await server({ converters: { ...quest_2_with(21n, () => profile(1n)), 'QuestUserState:1': (item) => quest((item as QuestUserState).id + 1n, 0n) } });
    const user = await new_user(s);
    const other_kind = row('user_state', Q, 21n, 2n, quest(21n, 1n));
    const other_id = row('user_state', Q, 22n, 1n, quest(22n, 1n));
    await seed(s, user, [other_kind, other_id]);
    await expect(request(s, user, (ctx) => s.storage.get_state(ctx, QuestUserState, 21n))).rejects.toThrow();
    await expect(request(s, user, (ctx) => s.storage.get_state(ctx, QuestUserState, 22n))).rejects.toThrow();
    expect(stored(s, 'user_state', user, Q, 21n)).toEqual({ value: other_kind.value, contract_version: 2n });
    expect(stored(s, 'user_state', user, Q, 22n)).toEqual({ value: other_id.value, contract_version: 1n });
    expect(conversion_errors(s).map((l) => log_field(l, 'from_version'))).toEqual(['2', '1']);
  });

  it('the error log of a FAILED convert_item has the kind, the item ID, the stored contract version and the failed from version', async () => {
    const s = await server({
      converters: quest_2_with(31n, () => {
        throw new Error('converter bug');
      }),
    });
    const user = await new_user(s);
    await seed(s, user, [row('user_state', Q, 31n, 1n, quest(31n, 1n))]);
    await expect(request(s, user, (ctx) => s.storage.get_state(ctx, QuestUserState, 31n))).rejects.toThrow();
    const [line] = conversion_errors(s);
    expect(line?.['level']).toBe('error');
    expect(log_field(line ?? {}, 'item_kind')).toBe(Q);
    expect(log_field(line ?? {}, 'item_id')).toBe('31');
    expect(log_field(line ?? {}, 'stored_version')).toBe('1');
    expect(typeof log_field(line ?? {}, 'error')).toBe('string');
    expect(log_field(line ?? {}, 'from_version')).toBe('2');
  });
});

describe('higher contract version', () => {
  it('reads the stored bytes when migration_converter has no row of that kind between the versions, and is INTERNAL when it has one', async () => {
    const s = await server();
    const user = await new_user(s);
    const newer = row('user_state', Q, 1n, CURRENT + 2n, quest(1n, 7n));
    await seed(s, user, [newer]);
    // Another kind's converter between the versions does not matter.
    await s.storage.run_game_transaction((tx) => s.storage.db(tx).query('INSERT INTO migration_converter (kind, from_version, registered_at) VALUES ($1, $2, 0)', ['wallet_server_state', CURRENT]));
    expect(await request(s, user, (ctx) => s.storage.get_state(ctx, QuestUserState, 1n))).toEqual(quest(1n, 7n));
    expect(stored(s, 'user_state', user, Q, 1n)).toEqual({ value: newer.value, contract_version: CURRENT + 2n });
    // A newer server registered a quest converter from the current version + 1.
    await s.storage.run_game_transaction((tx) => s.storage.db(tx).query('INSERT INTO migration_converter (kind, from_version, registered_at) VALUES ($1, $2, 0)', [Q, CURRENT + 1n]));
    await expect(request(s, user, (ctx) => s.storage.get_state(ctx, QuestUserState, 1n))).rejects.toThrow();
    expect(stored(s, 'user_state', user, Q, 1n)).toEqual({ value: newer.value, contract_version: CURRENT + 2n });
  });

  it('has a migration_converter row for every registered converter after server start and wait_background', async () => {
    const s = await server();
    await wait_background(s);
    const rows = s.storage.read_db().query('SELECT kind, from_version, registered_at FROM migration_converter ORDER BY kind, from_version');
    expect(rows).toHaveLength(CONVERTER_LIST.length);
    expect(rows).toEqual([
      { kind: 'boss_game_state', from_version: 1n, registered_at: s.clock.now() },
      { kind: 'deck_user_state', from_version: 2n, registered_at: s.clock.now() },
      { kind: 'quest_user_state', from_version: 1n, registered_at: s.clock.now() },
      { kind: 'quest_user_state', from_version: 2n, registered_at: s.clock.now() },
      { kind: 'wallet_server_state', from_version: 1n, registered_at: s.clock.now() },
    ]);
  });
});
