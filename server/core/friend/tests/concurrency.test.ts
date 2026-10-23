import { CoreError, accept, befriend, counts, expect_counts_match_links, id, send_request, start, state_of, stop_all, users } from './helpers.ts';

afterEach(async () => {
  await stop_all();
});

describe('concurrent requests', () => {
  it('two users who send each other a request at the same time end with both link rows Friend', async () => {
    for (let round = 0; round < 3; round += 1) {
      const h = await start();
      const [a, b] = await users(h, 2);
      const results = await Promise.all([send_request(a, id(b)), send_request(b, id(a))]);
      expect(results.map((r) => r.code)).toEqual([0, 0]);
      expect(state_of(h, id(a), id(b))).toBe('FRIEND_STATE_FRIEND');
      expect(state_of(h, id(b), id(a))).toBe('FRIEND_STATE_FRIEND');
      expect_counts_match_links(h, [id(a), id(b)]);
      await stop_all();
    }
  });

  it('when two users accept at the same time the requests of a user with friend.maxFriends − 1 friends, one succeeds and the other is FRIEND_TARGET_LIMIT', async () => {
    const h = await start({ 'friend.maxFriends': 2 });
    const [x, w, a, b] = await users(h, 4);
    await befriend(x, w);
    expect((await send_request(x, id(a))).code).toBe(0);
    expect((await send_request(x, id(b))).code).toBe(0);
    const results = await Promise.all([accept(a, id(x)), accept(b, id(x))]);
    expect(results.map((r) => r.code).sort()).toEqual([0, CoreError.CORE_ERROR_FRIEND_TARGET_LIMIT].sort());
    expect(counts(h, id(x)).friend_count).toBe(2);
    expect_counts_match_links(h, [id(x), id(w), id(a), id(b)]);
  });
});
