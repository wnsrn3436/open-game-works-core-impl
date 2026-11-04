import {
  CoreError,
  FriendState,
  START_AT,
  advance,
  befriend,
  block,
  get_friends,
  confirm_age,
  id,
  run_core_test,
  search,
  send_request,
  set_nickname,
  start,
  stop_all,
  users,
} from './helpers.ts';
import type { TestSession } from '../../testing/dev/index.ts';
import { core_settings } from '../../storage/tests/helpers.ts';
import { LINK_TABLE } from '../index.ts';

/** Birth year-months `ConfirmAge` takes at `START_AT` (2027-01): age 9, below `auth.childAgeYears`, and age 37. */
const CHILD_BIRTH = 201801;
const ADULT_BIRTH = 198912;

/** `user_ids` user ID ascending: user IDs are random, not in the order the users were made. */
function ascending(user_ids: bigint[]): bigint[] {
  return [...user_ids].sort((x, y) => (x < y ? -1 : x > y ? 1 : 0));
}

/** `sessions` user ID ascending, so that a test can make the insertion order differ from the user ID order. The tuple keeps its length. */
function by_id<T extends readonly TestSession[]>(sessions: T): T {
  return [...sessions].sort((x, y) => (x.user_id < y.user_id ? -1 : x.user_id > y.user_id ? 1 : 0)) as readonly TestSession[] as T;
}

afterEach(async () => {
  await stop_all();
});

describe('GetFriends', () => {
  it('returns Friend, Received, Sent in that order; updated_at descending within a state, then user ID ascending', async () => {
    const h = await start();
    const [a, b, c, d, f, ...tied] = await users(h, 7);
    const [low, high] = by_id(tied);
    await befriend(a, b);
    advance(h, 1_000n);
    await befriend(c, a);
    advance(h, 1_000n);
    expect((await send_request(d, id(a))).code).toBe(0);
    advance(h, 1_000n);
    // The larger user ID sends first, at the same request time: user ID ascending, not insertion order.
    expect((await send_request(high, id(a))).code).toBe(0);
    expect((await send_request(low, id(a))).code).toBe(0);
    advance(h, 1_000n);
    expect((await send_request(a, id(f))).code).toBe(0);

    const listed = await get_friends(a);
    expect(listed.code).toBe(0);
    const friends = listed.response?.friends ?? [];
    expect(friends.map((x) => [x.profile?.user_id, x.state, x.updated_at])).toEqual([
      [id(c), FriendState.FRIEND_STATE_FRIEND, START_AT + 1_000n],
      [id(b), FriendState.FRIEND_STATE_FRIEND, START_AT],
      [id(low), FriendState.FRIEND_STATE_RECEIVED, START_AT + 3_000n],
      [id(high), FriendState.FRIEND_STATE_RECEIVED, START_AT + 3_000n],
      [id(d), FriendState.FRIEND_STATE_RECEIVED, START_AT + 2_000n],
      [id(f), FriendState.FRIEND_STATE_SENT, START_AT + 4_000n],
    ]);
  });

  it('fills profile with the nickname, and returns more users than public-profile.maxRequestCount', async () => {
    const h = await start({ 'public-profile.maxRequestCount': 2, 'friend.maxSearchResults': 2, 'block-report.maxBlocks': 2, 'guild.maxJoinRequestsPerGuild': 2 });
    const [a, named, ...rest] = await users(h, 6);
    const others = [named, ...rest];
    await set_nickname(named, 'Named');
    for (const other of others) expect((await send_request(other, id(a))).code).toBe(0);
    const friends = (await get_friends(a)).response?.friends ?? [];
    expect(friends.map((x) => x.profile?.user_id).sort()).toEqual(others.map(id).sort());
    expect(friends.find((x) => x.profile?.user_id === id(named))?.profile?.nickname).toBe('Named');
  });
});

describe('GetFriends without a profile', () => {
  it('leaves out a link row whose other user has no profile and keeps the other rows', async () => {
    const h = await start();
    const [a, b, c] = await users(h, 3);
    await befriend(a, b);
    advance(h, 1_000n);
    expect((await send_request(c, id(a))).code).toBe(0);
    // A link row with a user ID that no user has, the newest Friend row: it would be listed first if kept.
    advance(h, 1_000n);
    const ghost = 2n ** 63n - 1n;
    const storage = h.core().storage;
    await run_core_test(h, a, (ctx) => {
      storage.db(ctx).query(`INSERT INTO ${LINK_TABLE} (user_id, other_id, state, created_at, updated_at) VALUES ($1, $2, $3, $4, $4)`, [id(a), ghost, 'FRIEND_STATE_FRIEND', START_AT + 2_000n]);
      return true;
    });
    const listed = await get_friends(a);
    expect(listed.code).toBe(0);
    expect(listed.response?.friends.map((x) => [x.profile?.user_id, x.state])).toEqual([
      [id(b), FriendState.FRIEND_STATE_FRIEND],
      [id(c), FriendState.FRIEND_STATE_RECEIVED],
    ]);
  });
});

describe('SearchUsers', () => {
  it('leaves out oneself and users in a block relation and returns at most friend.maxSearchResults users, user ID ascending', async () => {
    const h = await start({ nicknameUnique: false, 'friend.maxSearchResults': 2 });
    const [a, ...others] = await users(h, 6);
    // The two users in a block relation have the smallest IDs, so either one would be in the first 2 results if kept.
    const [blocked, blocker, ...kept] = by_id(others);
    for (const user of [a, ...others]) await set_nickname(user, 'Twin');
    expect((await block(a, id(blocked))).code).toBe(0);
    expect((await block(blocker, id(a))).code).toBe(0);
    const found = await search(a, 'Twin');
    expect(found.code).toBe(0);
    expect(found.response?.users.map((u) => [u.user_id, u.nickname])).toEqual(kept.slice(0, 2).map((user) => [id(user), 'Twin']));
  });

  it('without the limit returns every user left, and nothing for a nickname nobody has', async () => {
    const h = await start({ nicknameUnique: false });
    const [a, b, c, d] = await users(h, 4);
    for (const user of [a, b, c, d]) await set_nickname(user, 'Twin');
    expect((await block(a, id(b))).code).toBe(0);
    expect((await search(a, 'twin')).response?.users.map((u) => u.user_id)).toEqual(ascending([id(c), id(d)]));
    expect((await search(a, 'Nobody')).response?.users).toEqual([]);
  });

  it('a nickname of nickname.maxLength + 1 code points is INVALID_REQUEST, and one of nickname.maxLength code points is searched', async () => {
    // `(ogw.v)` `max_chars_key` takes the settings value when the contract is generated, so the test uses that value.
    const max = core_settings()['nickname.maxLength'];
    if (typeof max !== 'number') throw new Error('core settings have no nickname.maxLength');
    const h = await start({ nicknameUnique: false });
    const [a, b] = await users(h, 2);
    const longest = 'A'.repeat(max);
    await set_nickname(b, longest);
    expect((await search(a, `${longest}A`)).code).toBe(CoreError.CORE_ERROR_INVALID_REQUEST);
    expect((await search(a, '😀'.repeat(max + 1))).code).toBe(CoreError.CORE_ERROR_INVALID_REQUEST);
    const found = await search(a, longest);
    expect(found.code).toBe(0);
    expect(found.response?.users.map((u) => u.user_id)).toEqual([id(b)]);
    // `max` code points that are 2 × `max` UTF-16 code units.
    expect((await search(a, '😀'.repeat(max))).code).toBe(0);
  });

  it('with chat.allowChild false is CHILD_RESTRICTED for a child user and returns the results to a user who is not a child', async () => {
    const h = await start({ nicknameUnique: false, 'chat.allowChild': false });
    const [a, b, c] = await users(h, 3);
    await set_nickname(b, 'Twin');
    expect((await confirm_age(a, CHILD_BIRTH)).child).toBe(true);
    expect((await confirm_age(c, ADULT_BIRTH)).child).toBe(false);
    expect((await search(a, 'Twin')).code).toBe(CoreError.CORE_ERROR_CHILD_RESTRICTED);
    const found = await search(c, 'Twin');
    expect(found.code).toBe(0);
    expect(found.response?.users.map((u) => u.user_id)).toEqual([id(b)]);
  });

  it('with chat.allowChild true returns the results to a child user', async () => {
    const h = await start({ nicknameUnique: false, 'chat.allowChild': true });
    const [a, b] = await users(h, 2);
    await set_nickname(b, 'Twin');
    expect((await confirm_age(a, CHILD_BIRTH)).child).toBe(true);
    const found = await search(a, 'Twin');
    expect(found.code).toBe(0);
    expect(found.response?.users.map((u) => u.user_id)).toEqual([id(b)]);
  });
});

describe('internal operations', () => {
  it('are_friends is true only for Friend rows, and list_friend_ids returns the friends user ID ascending', async () => {
    const h = await start();
    const [a, d, ...pair] = await users(h, 4);
    const [b, c] = by_id(pair);
    // The larger user ID becomes A's friend first: user ID ascending, not insertion order.
    await befriend(c, a);
    await befriend(a, b);
    expect((await send_request(a, id(d))).code).toBe(0);
    const friend = h.friend();
    const result = await run_core_test(h, d, (ctx) => ({
      ab: friend.are_friends(ctx, id(a), id(b)),
      ba: friend.are_friends(ctx, id(b), id(a)),
      ad: friend.are_friends(ctx, id(a), id(d)),
      bc: friend.are_friends(ctx, id(b), id(c)),
      list_a: friend.list_friend_ids(ctx, id(a)),
      list_d: friend.list_friend_ids(ctx, id(d)),
    }));
    expect(result).toEqual({ ab: true, ba: true, ad: false, bc: false, list_a: [id(b), id(c)], list_d: [] });
  });
});
