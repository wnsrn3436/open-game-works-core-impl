import { new_db, new_user, started, stop_all } from './helpers.ts';

// The picks of user IDs and public codes: a queued value comes first, then the real secure random pick.
const picks = vi.hoisted(() => ({ ids: [] as bigint[], codes: [] as string[] }));
vi.mock('../public_code.ts', async (import_original) => {
  const actual = await import_original<typeof import('../public_code.ts')>();
  return {
    ...actual,
    pick_user_id: () => picks.ids.shift() ?? actual.pick_user_id(),
    pick_public_code: () => picks.codes.shift() ?? actual.pick_public_code(),
  };
});

afterEach(() => {
  stop_all();
  picks.ids.length = 0;
  picks.codes.length = 0;
});

describe('create_user on a taken value', () => {
  it('a taken user ID or a taken public code (also of a withdrawn user) inserts nothing, and the next pick makes the row', async () => {
    const db = await new_db();
    const i = started({ db });
    try {
      const s = i.storage;
      picks.ids.push(1000n);
      picks.codes.push('AAAAAAAA');
      const first = await s.run_game_transaction((tx) => s.create_user(tx));
      expect(first).toEqual({ user_id: 1000n, public_code: 'AAAAAAAA' });
      await s.run_user_transaction(1000n, (ctx) => {
        s.delete_user(ctx);
        return 'pass';
      });

      // Same user ID, new code: the first pick is not inserted.
      picks.ids.push(1000n, 2000n);
      picks.codes.push('BBBBBBBB', 'CCCCCCCC');
      const by_id = await s.run_game_transaction((tx) => s.create_user(tx));
      expect(by_id).toEqual({ user_id: 2000n, public_code: 'CCCCCCCC' });

      // New user ID, the withdrawn user's code: not inserted either.
      picks.ids.push(3000n, 4000n);
      picks.codes.push('AAAAAAAA', 'DDDDDDDD');
      const by_code = await s.run_game_transaction((tx) => s.create_user(tx));
      expect(by_code).toEqual({ user_id: 4000n, public_code: 'DDDDDDDD' });

      const rows = s.read_db().query('SELECT user_id, public_code FROM "user" ORDER BY user_id', []);
      expect(rows.map((r) => [r.user_id, r.public_code])).toEqual([
        [1000n, 'AAAAAAAA'],
        [2000n, 'CCCCCCCC'],
        [4000n, 'DDDDDDDD'],
      ]);
      expect(s.get_user_record(s.read_db(), 1000n)?.withdrawn_at).not.toBeNull();
    } finally {
      i.stop();
    }
  });

  it('the start fill picks again when its pick is a code a row has', async () => {
    const db = await new_db();
    const before = started({ db });
    const users = { kept: await new_user(before.storage), empty: await new_user(before.storage) };
    const kept_code = before.storage.get_user_record(before.storage.read_db(), users.kept)?.public_code ?? '';
    await before.storage.run_game_transaction((tx) => before.storage.db(tx).query('UPDATE "user" SET public_code = NULL WHERE user_id = $1', [users.empty]));
    before.stop();
    picks.codes.push(kept_code, 'EEEEEEEE');
    const after = started({ db });
    try {
      expect(after.storage.get_user_record(after.storage.read_db(), users.empty)?.public_code).toBe('EEEEEEEE');
      expect(after.storage.get_user_record(after.storage.read_db(), users.kept)?.public_code).toBe(kept_code);
    } finally {
      after.stop();
    }
  });
});
