import type { ItemConverter, RawRow, Storage } from '../index.ts';
import { instance, new_user, outside, raw_rows, request, stop_all } from './helpers.ts';
import { boss, BossGameState, profile, quest, QuestUserState, TEST_CONTRACT_VERSION, wallet, WalletServerState } from './kinds.ts';

afterEach(() => {
  stop_all();
});

const CURRENT = BigInt(TEST_CONTRACT_VERSION);

/** Converter of the tests: a quest's progress goes up by 100; quest 9 is deleted; quest 13 fails; quest 17 throws. */
const converter: ItemConverter = (_db, kind, item_id, _version, bytes) => {
  if (item_id === 13n) return 'FAILED';
  if (item_id === 17n) throw new Error('converter throw');
  if (kind === QuestUserState) {
    if (item_id === 9n) return 'DELETE';
    const q = QuestUserState.decode(bytes);
    return q === null ? 'FAILED' : quest(q.id, q.progress + 100n).encode();
  }
  if (kind === BossGameState) {
    const b = BossGameState.decode(bytes);
    return b === null ? 'FAILED' : boss(b.key, b.hp + 100n).encode();
  }
  if (kind === WalletServerState) {
    const w = WalletServerState.decode(bytes);
    return w === null ? 'FAILED' : wallet(w.coins + 100n).encode();
  }
  return bytes;
};

function with_converter(s: Storage): void {
  s.register_item_converter(converter);
}

function row(key: string, version: bigint, value: { encode(): Uint8Array }, table = 'user_state'): RawRow {
  return { table, key, contract_version: version, value: value.encode() };
}

async function seed(storage: Storage, user: bigint, rows: RawRow[]): Promise<void> {
  await request(storage, user, (ctx) => {
    storage.replace_user_rows(ctx, rows);
  });
}

function versions(storage: Storage, table: string, user: bigint): bigint[] {
  return storage
    .read_db()
    .query(`SELECT contract_version FROM ${table} WHERE user_id = $1 ORDER BY kind, item_id`, [user])
    .map((r) => r.contract_version as bigint);
}

describe('read conversion', () => {
  it('stores the converted value at the current contract version, deletes on a delete result, and leaves the row on FAILED', async () => {
    const { storage } = await instance({ register: with_converter });
    const user = await new_user(storage);
    await seed(storage, user, [row('quest_user_state/1', 1n, quest(1n, 5n)), row('quest_user_state/9', 2n, quest(9n, 1n)), row('quest_user_state/13', 1n, quest(13n, 1n))]);
    const read = await request(storage, user, (ctx) => [(storage.get_state(ctx, QuestUserState, 1n) as QuestUserState).progress, storage.get_state(ctx, QuestUserState, 9n)]);
    expect(read).toEqual([105n, null]);
    const stored = storage.read_db().query('SELECT item_id, value, contract_version FROM user_state WHERE user_id = $1 ORDER BY item_id', [user]);
    expect(stored.map((r) => [r.item_id, r.contract_version])).toEqual([
      [1n, CURRENT],
      [13n, 1n],
    ]);
    expect(stored[0]?.value).toEqual(quest(1n, 105n).encode());
    const before = raw_rows(storage, 'user_state', user);
    await expect(request(storage, user, (ctx) => storage.get_state(ctx, QuestUserState, 13n))).rejects.toThrow();
    expect(raw_rows(storage, 'user_state', user)).toEqual(before);
  });

  it('inside run_read_only returns the converted value and changes no row, contract version, delta or pending delta', async () => {
    const { storage } = await instance({ register: with_converter });
    const user = await new_user(storage);
    await seed(storage, user, [row('quest_user_state/1', 1n, quest(1n, 5n)), row('quest_user_state/9', 1n, quest(9n, 1n))]);
    const before = raw_rows(storage, 'user_state', user);
    const read = await request(storage, user, (ctx) => {
      const values = storage.run_read_only(ctx, () => [(storage.get_state(ctx, QuestUserState, 1n) as QuestUserState).progress, storage.get_state(ctx, QuestUserState, 9n), storage.list_state(ctx, QuestUserState).length]);
      return { values, taken: storage.take_response_delta(ctx) };
    });
    if (typeof read === 'string') throw new Error(read);
    expect(read.values).toEqual([105n, null, 1]);
    expect(read.taken.delta.user_state.entries).toEqual([]);
    expect(raw_rows(storage, 'user_state', user)).toEqual(before);
    expect(raw_rows(storage, 'pending_delta', user)).toEqual([]);
    expect(await storage.run_user_transaction(user, (ctx) => (storage.run_read_only(ctx, () => storage.get_state(ctx, QuestUserState, 1n)), 'pass'))).toBe('COMMITTED');
    expect(raw_rows(storage, 'pending_delta', user)).toEqual([]);
  });

  it('reads a higher contract version row through the converter and keeps the row and its version', async () => {
    const { storage } = await instance({ register: with_converter });
    const user = await new_user(storage);
    await seed(storage, user, [row('quest_user_state/1', CURRENT + 1n, quest(1n, 5n))]);
    const before = raw_rows(storage, 'user_state', user);
    expect(await request(storage, user, (ctx) => (storage.get_state(ctx, QuestUserState, 1n) as QuestUserState).progress)).toBe(105n);
    expect(raw_rows(storage, 'user_state', user)).toEqual(before);
  });

  it('reads a lower version row as the current message when no converter is registered', async () => {
    const { storage } = await instance();
    const user = await new_user(storage);
    await seed(storage, user, [row('quest_user_state/1', 1n, quest(1n, 5n))]);
    expect(await request(storage, user, (ctx) => (storage.get_state(ctx, QuestUserState, 1n) as QuestUserState).progress)).toBe(5n);
  });

  it('upgrade_user_rows leaves every row of the user at the current contract version', async () => {
    const { storage } = await instance({ register: with_converter });
    const user = await new_user(storage);
    await seed(storage, user, [
      row('quest_user_state/1', 1n, quest(1n, 5n)),
      row('quest_user_state/2', 2n, quest(2n, 5n)),
      row('quest_user_state/9', 1n, quest(9n, 5n)),
      row('profile_user_state/0', 1n, profile(1n)),
      row('wallet_server_state/0', 1n, wallet(1n), 'server_state'),
      row('quest_user_state/3', CURRENT, quest(3n, 5n)),
    ]);
    const changed = await request(storage, user, (ctx) => ({ changed: storage.upgrade_user_rows(ctx) }));
    expect(changed).toEqual({ changed: 5 });
    expect(versions(storage, 'user_state', user)).toEqual([CURRENT, CURRENT, CURRENT, CURRENT]);
    expect(versions(storage, 'server_state', user)).toEqual([CURRENT]);
    expect(await request(storage, user, (ctx) => (storage.get_state(ctx, WalletServerState, 0n) as WalletServerState).coins)).toBe(101n);
    await seed(storage, user, [row('quest_user_state/13', 1n, quest(13n, 1n))]);
    expect(await request(storage, user, (ctx) => ({ changed: storage.upgrade_user_rows(ctx) }))).toEqual({ changed: 'FAILED' });
  });

  it('upgrade_user_rows throws, not FAILED, when the converter throws, and the row stays', async () => {
    const { storage } = await instance({ register: with_converter });
    const user = await new_user(storage);
    await seed(storage, user, [row('quest_user_state/17', 1n, quest(17n, 1n))]);
    await expect(request(storage, user, (ctx) => ({ changed: storage.upgrade_user_rows(ctx) }))).rejects.toThrow('converter throw');
    expect(versions(storage, 'user_state', user)).toEqual([1n]);
  });

  it('a lower version game_state row read without a lock while a locking transaction writes it ends as the locking write at the current version', async () => {
    const { storage } = await instance({ register: with_converter });
    const writer = await new_user(storage);
    const reader = await new_user(storage);
    await storage.run_game_transaction((tx) => {
      storage.replace_game_rows(tx, [{ table: 'game_state', key: 'boss_game_state/1', contract_version: 1n, value: boss(1n, 5n).encode() }]);
    });
    let reading: Promise<unknown> = Promise.resolve(null);
    await request(storage, writer, (ctx) => {
      storage.content.lock_game_row(ctx, 'game_state', [BossGameState, 1n]);
      storage.put_game_state(ctx, boss(1n, 50n), 0n);
      reading = outside(() => request(storage, reader, (c) => (storage.get_game_state(c, BossGameState, 1n) as BossGameState).hp));
    });
    expect([105n, 50n]).toContain(await reading);
    const stored = storage.read_db().query('SELECT value, contract_version FROM game_state WHERE kind = $1 AND "key" = 1', ['boss_game_state']);
    expect(stored).toEqual([{ value: boss(1n, 50n).encode(), contract_version: CURRENT }]);
  });
});
