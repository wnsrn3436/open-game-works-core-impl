import { send_admin, stop_test_server } from '../../testing/dev/index.ts';
import { in_user_transaction, set_nickname, start, users } from './helpers.ts';

describe('get_nicknames', () => {
  it('called by a content handler returns the nicknames of other users in user ID order and leaves out users without a nickname', async () => {
    const h = await start(false);
    try {
      const [caller, b, c, none] = await users(h.server, ['caller', 'b', 'c', 'none']);
      expect((await set_nickname(c, 'Cherry')).code).toBe(0);
      expect((await set_nickname(b, 'Banana')).code).toBe(0);
      const targets = [c.user_id, none.user_id, b.user_id, 999_999n];
      const { status, json } = await send_admin(h.server, 'game_get_nicknames', { user_id: caller.user_id.toString(), targets: targets.map(String) });
      expect(status).toBe(200);
      const expected = [
        { user_id: b.user_id, nickname: 'Banana' },
        { user_id: c.user_id, nickname: 'Cherry' },
      ].sort((x, y) => (x.user_id < y.user_id ? -1 : 1));
      expect(json).toEqual({ users: expected.map((e) => ({ user_id: e.user_id.toString(), nickname: e.nickname })) });
    } finally {
      await stop_test_server(h.server);
    }
  });

  it('throws for more user IDs than nickname.maxLookupCount', async () => {
    const h = await start(false, { 'nickname.maxLookupCount': 2 });
    try {
      const [a] = await users(h.server, ['a']);
      const nickname = h.nickname();
      expect(await in_user_transaction(h.core(), a.user_id, (ctx) => nickname.get_nicknames(ctx, [1n, 2n]))).toEqual([]);
      await expect(in_user_transaction(h.core(), a.user_id, (ctx) => nickname.get_nicknames(ctx, [1n, 2n, 3n]))).rejects.toThrow();
    } finally {
      await stop_test_server(h.server);
    }
  });
});

describe('find_user_ids_by_nickname', () => {
  it('called by a core module returns the same user IDs for inputs that differ in case, full width or spaces, and not more than the maximum', async () => {
    const h = await start(false, { 'nickname.maxLength': 12 });
    try {
      const [caller, a, b, c] = await users(h.server, ['caller', 'a', 'b', 'c']);
      expect((await set_nickname(a, 'Kiwi Fruit')).code).toBe(0);
      expect((await set_nickname(b, 'kiwifruit')).code).toBe(0);
      expect((await set_nickname(c, 'Melon')).code).toBe(0);
      const ids = [a.user_id, b.user_id].sort((x, y) => (x < y ? -1 : 1));
      const nickname = h.nickname();
      const find = (input: string, max: number): Promise<bigint[]> =>
        in_user_transaction(h.core(), caller.user_id, (ctx) => nickname.find_user_ids_by_nickname(ctx, input, max));
      for (const input of ['Kiwi Fruit', 'KIWIFRUIT', 'ｋｉｗｉ ｆｒｕｉｔ']) expect(await find(input, 10)).toEqual(ids);
      expect(await find('kiwifruit', 1)).toEqual([ids[0]]);
      expect(await find('Nobody', 10)).toEqual([]);
      expect(await find('', 10)).toEqual([]);
      expect(await find('x'.repeat(13), 10)).toEqual([]);
    } finally {
      await stop_test_server(h.server);
    }
  });
});
