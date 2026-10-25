import * as CoreContract from '../../../generated/contract/core_contract.ts';
import { send } from '../../testing/dev/index.ts';
import {
  CoreError,
  FriendState,
  START_AT,
  accept,
  advance,
  befriend,
  cancel,
  counts,
  decline,
  id,
  links,
  remove,
  send_request,
  snapshot,
  start,
  state_of,
  stop_all,
  users,
} from './helpers.ts';

afterEach(async () => {
  await stop_all();
});

describe('request and accept', () => {
  it('a request makes A Sent and B Received; the accept makes both Friend with friend_count 1 and sent and received counts 0', async () => {
    const h = await start();
    const [a, b] = await users(h, 2);
    const sent = await send_request(a, id(b));
    expect(sent.code).toBe(0);
    expect(sent.response?.state).toBe(FriendState.FRIEND_STATE_SENT);
    expect(state_of(h, id(a), id(b))).toBe('FRIEND_STATE_SENT');
    expect(state_of(h, id(b), id(a))).toBe('FRIEND_STATE_RECEIVED');
    expect(counts(h, id(a))).toEqual({ friend_count: 0, sent_count: 1, received_count: 0 });
    expect(counts(h, id(b))).toEqual({ friend_count: 0, sent_count: 0, received_count: 1 });

    advance(h, 1_000n);
    expect((await accept(b, id(a))).code).toBe(0);
    // `links` is in user ID order, and user IDs are random.
    const friend = (user_id: bigint, other_id: bigint) => ({ user_id, other_id, state: 'FRIEND_STATE_FRIEND', created_at: START_AT, updated_at: START_AT + 1_000n });
    expect(links(h)).toEqual([friend(id(a), id(b)), friend(id(b), id(a))].sort((x, y) => (x.user_id < y.user_id ? -1 : 1)));
    for (const user of [a, b]) expect(counts(h, id(user))).toEqual({ friend_count: 1, sent_count: 0, received_count: 0 });
  });

  it('SendFriendRequest of A to B who already sent a request to A returns Friend and makes both Friend', async () => {
    const h = await start();
    const [a, b] = await users(h, 2);
    expect((await send_request(b, id(a))).code).toBe(0);
    const sent = await send_request(a, id(b));
    expect(sent.code).toBe(0);
    expect(sent.response?.state).toBe(FriendState.FRIEND_STATE_FRIEND);
    expect(state_of(h, id(a), id(b))).toBe('FRIEND_STATE_FRIEND');
    expect(state_of(h, id(b), id(a))).toBe('FRIEND_STATE_FRIEND');
    for (const user of [a, b]) expect(counts(h, id(user))).toEqual({ friend_count: 1, sent_count: 0, received_count: 0 });
  });

  it('a second request to the same user is Sent and leaves the link rows and counts as they were', async () => {
    const h = await start();
    const [a, b] = await users(h, 2);
    expect((await send_request(a, id(b))).code).toBe(0);
    const before = snapshot(h);
    advance(h, 1_000n);
    const again = await send_request(a, id(b));
    expect(again.code).toBe(0);
    expect(again.response?.state).toBe(FriendState.FRIEND_STATE_SENT);
    expect(snapshot(h)).toEqual(before);
  });

  it('a request to a friend is FRIEND_ALREADY', async () => {
    const h = await start();
    const [a, b] = await users(h, 2);
    await befriend(a, b);
    const before = snapshot(h);
    expect((await send_request(a, id(b))).code).toBe(CoreError.CORE_ERROR_FRIEND_ALREADY);
    expect(snapshot(h)).toEqual(before);
  });

  it('a request to a user ID with no user is USER_NOT_FOUND', async () => {
    const h = await start();
    const [a] = await users(h, 1);
    expect((await send_request(a, id(a) + 1_000n)).code).toBe(CoreError.CORE_ERROR_USER_NOT_FOUND);
    expect(snapshot(h)).toEqual({ links: [], counts: [] });
  });
});

describe('decline, cancel and remove', () => {
  it('decline deletes both link rows and brings the counts back to their values before the request', async () => {
    const h = await start();
    const [a, b] = await users(h, 2);
    const before = { a: counts(h, id(a)), b: counts(h, id(b)) };
    expect((await send_request(a, id(b))).code).toBe(0);
    expect((await decline(b, id(a))).code).toBe(0);
    expect(links(h)).toEqual([]);
    expect({ a: counts(h, id(a)), b: counts(h, id(b)) }).toEqual(before);
  });

  it('cancel deletes both link rows and brings the counts back to their values before the request', async () => {
    const h = await start();
    const [a, b] = await users(h, 2);
    const before = { a: counts(h, id(a)), b: counts(h, id(b)) };
    expect((await send_request(a, id(b))).code).toBe(0);
    expect((await cancel(a, id(b))).code).toBe(0);
    expect(links(h)).toEqual([]);
    expect({ a: counts(h, id(a)), b: counts(h, id(b)) }).toEqual(before);
  });

  it('remove deletes both link rows and brings the counts back to their values before the friendship', async () => {
    const h = await start();
    const [a, b] = await users(h, 2);
    const before = { a: counts(h, id(a)), b: counts(h, id(b)) };
    await befriend(a, b);
    expect((await remove(b, id(a))).code).toBe(0);
    expect(links(h)).toEqual([]);
    expect({ a: counts(h, id(a)), b: counts(h, id(b)) }).toEqual(before);
  });

  it('decline of a sent request, cancel of a received request and remove of a pending request are FRIEND_REQUEST_NOT_FOUND or FRIEND_NOT_FOUND and change nothing', async () => {
    const h = await start();
    const [a, b, c] = await users(h, 3);
    expect((await send_request(a, id(b))).code).toBe(0);
    const before = snapshot(h);
    expect((await decline(a, id(b))).code).toBe(CoreError.CORE_ERROR_FRIEND_REQUEST_NOT_FOUND);
    expect((await cancel(b, id(a))).code).toBe(CoreError.CORE_ERROR_FRIEND_REQUEST_NOT_FOUND);
    expect((await accept(a, id(b))).code).toBe(CoreError.CORE_ERROR_FRIEND_REQUEST_NOT_FOUND);
    expect((await remove(a, id(b))).code).toBe(CoreError.CORE_ERROR_FRIEND_NOT_FOUND);
    expect((await accept(a, id(c))).code).toBe(CoreError.CORE_ERROR_FRIEND_REQUEST_NOT_FOUND);
    expect(snapshot(h)).toEqual(before);
  });
});

describe('invalid request', () => {
  it('SendFriendRequest to oneself and user_id 0 of AcceptFriendRequest, DeclineFriendRequest, CancelFriendRequest and RemoveFriend are INVALID_REQUEST and change nothing', async () => {
    const h = await start();
    const [a, b] = await users(h, 2);
    expect((await send_request(b, id(a))).code).toBe(0);
    const before = snapshot(h);
    expect((await send_request(a, id(a))).code).toBe(CoreError.CORE_ERROR_INVALID_REQUEST);
    expect((await accept(a, 0n)).code).toBe(CoreError.CORE_ERROR_INVALID_REQUEST);
    expect((await decline(a, 0n)).code).toBe(CoreError.CORE_ERROR_INVALID_REQUEST);
    expect((await cancel(a, 0n)).code).toBe(CoreError.CORE_ERROR_INVALID_REQUEST);
    expect((await remove(a, 0n)).code).toBe(CoreError.CORE_ERROR_INVALID_REQUEST);
    expect((await send_request(a, 0n)).code).toBe(CoreError.CORE_ERROR_INVALID_REQUEST);
    expect(snapshot(h)).toEqual(before);
  });

  it('AcceptFriendRequest, DeclineFriendRequest, CancelFriendRequest and RemoveFriend to oneself are FRIEND_REQUEST_NOT_FOUND or FRIEND_NOT_FOUND and change nothing', async () => {
    const h = await start();
    const [a, b] = await users(h, 2);
    expect((await send_request(b, id(a))).code).toBe(0);
    const before = snapshot(h);
    expect((await accept(a, id(a))).code).toBe(CoreError.CORE_ERROR_FRIEND_REQUEST_NOT_FOUND);
    expect((await decline(a, id(a))).code).toBe(CoreError.CORE_ERROR_FRIEND_REQUEST_NOT_FOUND);
    expect((await cancel(a, id(a))).code).toBe(CoreError.CORE_ERROR_FRIEND_REQUEST_NOT_FOUND);
    expect((await remove(a, id(a))).code).toBe(CoreError.CORE_ERROR_FRIEND_NOT_FOUND);
    expect(snapshot(h)).toEqual(before);
  });
});

describe('limits', () => {
  it('a request past friend.maxSentRequests is FRIEND_REQUEST_LIMIT and changes nothing', async () => {
    const h = await start({ 'friend.maxSentRequests': 1 });
    const [a, b, c] = await users(h, 3);
    expect((await send_request(a, id(b))).code).toBe(0);
    const before = snapshot(h);
    expect((await send_request(a, id(c))).code).toBe(CoreError.CORE_ERROR_FRIEND_REQUEST_LIMIT);
    expect(snapshot(h)).toEqual(before);
  });

  it('a request to a user at friend.maxReceivedRequests is FRIEND_TARGET_LIMIT and changes nothing', async () => {
    const h = await start({ 'friend.maxReceivedRequests': 1 });
    const [a, b, c] = await users(h, 3);
    expect((await send_request(b, id(a))).code).toBe(0);
    const before = snapshot(h);
    expect((await send_request(c, id(a))).code).toBe(CoreError.CORE_ERROR_FRIEND_TARGET_LIMIT);
    expect(snapshot(h)).toEqual(before);
  });

  it('with friend.maxFriends friends, a request is FRIEND_LIMIT, a request to that user is FRIEND_TARGET_LIMIT, and nothing changes', async () => {
    const h = await start({ 'friend.maxFriends': 1 });
    const [a, b, c] = await users(h, 3);
    await befriend(a, b);
    const before = snapshot(h);
    expect((await send_request(a, id(c))).code).toBe(CoreError.CORE_ERROR_FRIEND_LIMIT);
    expect((await send_request(c, id(a))).code).toBe(CoreError.CORE_ERROR_FRIEND_TARGET_LIMIT);
    expect(snapshot(h)).toEqual(before);
  });

  it('accepting with friend.maxFriends friends is FRIEND_LIMIT, and accepting a request of a user at friend.maxFriends is FRIEND_TARGET_LIMIT; nothing changes', async () => {
    const h = await start({ 'friend.maxFriends': 1 });
    const [a, b, c, x, y, z] = await users(h, 6);
    // A has C's request, then becomes B's friend.
    expect((await send_request(c, id(a))).code).toBe(0);
    await befriend(b, a);
    // Y sent X a request, then becomes Z's friend.
    expect((await send_request(y, id(x))).code).toBe(0);
    await befriend(z, y);
    const before = snapshot(h);
    expect((await accept(a, id(c))).code).toBe(CoreError.CORE_ERROR_FRIEND_LIMIT);
    expect((await accept(x, id(y))).code).toBe(CoreError.CORE_ERROR_FRIEND_TARGET_LIMIT);
    // SendFriendRequest step 6 checks the same limits as the accept.
    expect((await send_request(a, id(c))).code).toBe(CoreError.CORE_ERROR_FRIEND_LIMIT);
    expect((await send_request(x, id(y))).code).toBe(CoreError.CORE_ERROR_FRIEND_TARGET_LIMIT);
    expect(snapshot(h)).toEqual(before);
  });
});

describe('on_friend_changed', () => {
  it('is called once with each FriendChange, and with Accepted for a request to a user whose request is pending', async () => {
    const h = await start();
    const [a, b, c, d] = await users(h, 4);
    const calls = h.content.calls;
    expect((await send_request(a, id(b))).code).toBe(0);
    expect(calls).toEqual([{ user_id: id(a), other_id: id(b), change: 'Requested' }]);
    expect((await accept(b, id(a))).code).toBe(0);
    expect(calls.slice(1)).toEqual([{ user_id: id(b), other_id: id(a), change: 'Accepted' }]);
    expect((await remove(a, id(b))).code).toBe(0);
    expect(calls.slice(2)).toEqual([{ user_id: id(a), other_id: id(b), change: 'Removed' }]);
    expect((await send_request(c, id(a))).code).toBe(0);
    expect((await decline(a, id(c))).code).toBe(0);
    expect(calls.slice(4)).toEqual([{ user_id: id(a), other_id: id(c), change: 'Declined' }]);
    expect((await send_request(a, id(d))).code).toBe(0);
    expect((await cancel(a, id(d))).code).toBe(0);
    expect(calls.slice(6)).toEqual([{ user_id: id(a), other_id: id(d), change: 'Canceled' }]);
    expect((await send_request(d, id(c))).code).toBe(0);
    expect((await send_request(c, id(d))).code).toBe(0);
    expect(calls.slice(8)).toEqual([{ user_id: id(c), other_id: id(d), change: 'Accepted' }]);
    expect(calls).toHaveLength(9);
  });

  it('is not called for a request to a user already Sent to', async () => {
    const h = await start();
    const [a, b] = await users(h, 2);
    expect((await send_request(a, id(b))).code).toBe(0);
    expect((await send_request(a, id(b))).code).toBe(0);
    expect(h.content.calls).toHaveLength(1);
  });

  it('that throws makes the request INTERNAL and leaves the link rows and counts as they were', async () => {
    const h = await start();
    const [a, b, c] = await users(h, 3);
    expect((await send_request(b, id(a))).code).toBe(0);
    await befriend(a, c);
    h.content.throw_in_hook = true;
    const before = snapshot(h);
    expect((await send_request(a, id(b))).code).toBe(CoreError.CORE_ERROR_INTERNAL);
    expect((await accept(a, id(b))).code).toBe(CoreError.CORE_ERROR_INTERNAL);
    expect((await decline(a, id(b))).code).toBe(CoreError.CORE_ERROR_INTERNAL);
    expect((await cancel(b, id(a))).code).toBe(CoreError.CORE_ERROR_INTERNAL);
    expect((await remove(a, id(c))).code).toBe(CoreError.CORE_ERROR_INTERNAL);
    expect((await send_request(b, id(c))).code).toBe(CoreError.CORE_ERROR_INTERNAL);
    expect(snapshot(h)).toEqual(before);
  });

  it('that returns a value or a Promise makes the request INTERNAL and leaves the link rows and counts as they were', async () => {
    const outputs: (() => unknown)[] = [() => 1, () => 'pass', () => Promise.resolve()];
    for (const output of outputs) {
      const h = await start();
      const [a, b, c] = await users(h, 3);
      expect((await send_request(b, id(a))).code).toBe(0);
      await befriend(a, c);
      h.content.hook_output = output;
      const before = snapshot(h);
      expect((await send_request(a, id(b))).code).toBe(CoreError.CORE_ERROR_INTERNAL);
      expect((await accept(a, id(b))).code).toBe(CoreError.CORE_ERROR_INTERNAL);
      expect((await decline(a, id(b))).code).toBe(CoreError.CORE_ERROR_INTERNAL);
      expect((await cancel(b, id(a))).code).toBe(CoreError.CORE_ERROR_INTERNAL);
      expect((await remove(a, id(c))).code).toBe(CoreError.CORE_ERROR_INTERNAL);
      expect((await send_request(b, id(c))).code).toBe(CoreError.CORE_ERROR_INTERNAL);
      expect(snapshot(h)).toEqual(before);
      await stop_all();
    }
  });
});

describe('response', () => {
  it('a friend rpc changes no UserState: the response user_state is empty', async () => {
    const h = await start();
    const [a, b] = await users(h, 2);
    const { envelope } = (await send(a, 'core/SendFriendRequest', Object.assign(new CoreContract.SendFriendRequestRequest(), { user_id: id(b) }))) as {
      envelope: CoreContract.ResponseEnvelope;
    };
    expect(envelope.error).toBeNull();
    expect(envelope.user_state?.entries ?? []).toEqual([]);
  });
});
