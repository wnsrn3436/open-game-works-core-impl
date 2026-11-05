import type { ItemConverter, Storage } from '../index.ts';
import { instance, new_user, new_users, request, stop_all } from './helpers.ts';
import { quest, QuestUserState, TEST_CONTRACT_VERSION } from './kinds.ts';

const CURRENT = BigInt(TEST_CONTRACT_VERSION);

afterEach(() => {
  stop_all();
});

/** Converter of the tests: quest 13 fails; any other row is kept as it is. */
const converter: ItemConverter = (_db, _kind, item_id, _version, bytes) => (item_id === 13n ? 'FAILED' : bytes);

function with_converter(s: Storage): void {
  s.register_item_converter(converter);
}

function progress_of(values: readonly unknown[]): [bigint, bigint][] {
  return values.map((v) => [(v as QuestUserState).id, (v as QuestUserState).progress]);
}

describe('get_states', () => {
  it('of a list kind with item IDs a, b, c, b, where c has no row, gives a and b once each in item ID order, and does not read another item whose converter fails', async () => {
    const { storage } = await instance({ register: with_converter });
    const user = await new_user(storage);
    await request(storage, user, (ctx) => {
      // Quest 13 at a lower contract version: reading it would throw.
      storage.replace_user_rows(ctx, [
        { table: 'user_state', key: 'quest_user_state/7', contract_version: CURRENT, value: quest(7n, 70n).encode() },
        { table: 'user_state', key: 'quest_user_state/2', contract_version: CURRENT, value: quest(2n, 20n).encode() },
        { table: 'user_state', key: 'quest_user_state/13', contract_version: 1n, value: quest(13n, 1n).encode() },
      ]);
    });
    const read = await request(storage, user, (ctx) => storage.get_states(ctx, QuestUserState, [7n, 2n, 5n, 2n]));
    expect(progress_of(read as unknown[])).toEqual([
      [2n, 20n],
      [7n, 70n],
    ]);
    await expect(request(storage, user, (ctx) => storage.get_states(ctx, QuestUserState, [2n, 13n]))).rejects.toThrow();
    expect(await request(storage, user, (ctx) => storage.get_states(ctx, QuestUserState, []))).toEqual([]);
  });

  it('of 70000 item IDs, two of which have rows, gives those two values without throwing', async () => {
    const { storage } = await instance();
    const user = await new_user(storage);
    await request(storage, user, (ctx) => {
      storage.put_state(ctx, quest(3n, 30n));
      storage.put_state(ctx, quest(69_999n, 9n));
    });
    const ids = Array.from({ length: 70_000 }, (_, i) => BigInt(70_000 - i));
    const read = await request(storage, user, (ctx) => storage.get_states(ctx, QuestUserState, ids));
    expect(progress_of(read as unknown[])).toEqual([
      [3n, 30n],
      [69_999n, 9n],
    ]);
  });

  it('throws for a negative item ID of a list kind and for item IDs that are not a list', async () => {
    const { storage } = await instance();
    const user = await new_user(storage);
    await expect(request(storage, user, (ctx) => storage.get_states(ctx, QuestUserState, [1n, -1n]))).rejects.toThrow();
    await expect(request(storage, user, (ctx) => storage.get_states(ctx, QuestUserState, 1n as unknown as bigint[]))).rejects.toThrow();
  });
});

describe('get_user_records', () => {
  it('of an existing user, a withdrawn user, a user ID without a user row and the existing user again gives the existing user once and the withdrawn user, in user ID order, each with the get_user_record output', async () => {
    const { storage } = await instance();
    const [a, w] = (await new_users(storage, 2)) as [bigint, bigint];
    await request(storage, w, (ctx) => {
      storage.delete_user(ctx);
    });
    const missing = 9_007_199_254_740_993n;
    const records = storage.get_user_records(storage.read_db(), [w, a, missing, a]);
    expect(records).toEqual([
      { user_id: a, record: storage.get_user_record(storage.read_db(), a) },
      { user_id: w, record: storage.get_user_record(storage.read_db(), w) },
    ]);
    expect(records[1]?.record.withdrawn_at).not.toBeNull();
    expect(records[0]?.record.withdrawn_at).toBeNull();
    // Inside a transaction, through its DB handle.
    expect(await storage.run_game_transaction((tx) => storage.get_user_records(storage.db(tx), [a]).map((r) => r.user_id))).toEqual([a]);
    expect(storage.get_user_records(storage.read_db(), [])).toEqual([]);
  });

  it('of 70000 user IDs, two of which have user rows, gives those two users without throwing', async () => {
    const { storage } = await instance();
    const users = await new_users(storage, 2);
    const ids = [...users, ...Array.from({ length: 69_998 }, (_, i) => BigInt(i + 1))];
    expect(storage.get_user_records(storage.read_db(), ids).map((r) => r.user_id)).toEqual(users);
  });
});
