import { DbHandle } from '../../storage/core.ts';
import type { TestSession } from '../../testing/dev/index.ts';
import { LINK_TABLE } from '../index.ts';
import {
  CoreError,
  accept,
  befriend,
  block,
  count_rows,
  counts,
  expect_counts_match_links,
  id,
  links,
  send_request,
  snapshot,
  start,
  stop_all,
  users,
  withdraw,
  type Harness,
} from './helpers.ts';

/** The committed `withdrawn_at` of the session's user. */
function withdrawn_at(h: Harness, session: TestSession): bigint | null {
  const storage = h.core().storage;
  return storage.get_user_record(storage.read_db(), id(session))?.withdrawn_at ?? null;
}

afterEach(async () => {
  await stop_all();
});

describe('block', () => {
  it('a request between two users one of whom blocked the other is BLOCKED and changes nothing', async () => {
    const h = await start();
    const [a, b] = await users(h, 2);
    expect((await block(b, id(a))).code).toBe(0);
    const before = snapshot(h);
    expect((await send_request(a, id(b))).code).toBe(CoreError.CORE_ERROR_BLOCKED);
    expect((await send_request(b, id(a))).code).toBe(CoreError.CORE_ERROR_BLOCKED);
    expect(snapshot(h)).toEqual(before);
  });

  it('BlockUser between friends deletes both link rows and takes 1 from both friend_count; on_friend_changed is not called', async () => {
    const h = await start();
    const [a, b, c] = await users(h, 3);
    await befriend(a, b);
    await befriend(a, c);
    const calls = h.content.calls.length;
    expect((await block(b, id(a))).code).toBe(0);
    expect(links(h).filter((r) => r.user_id === id(b) || r.other_id === id(b))).toEqual([]);
    expect(counts(h, id(a))).toEqual({ friend_count: 1, sent_count: 0, received_count: 0 });
    expect(counts(h, id(b))).toEqual({ friend_count: 0, sent_count: 0, received_count: 0 });
    expect(h.content.calls).toHaveLength(calls);
  });

  it('BlockUser of a pending request deletes both link rows and takes the request out of both counts', async () => {
    const h = await start();
    const [a, b] = await users(h, 2);
    expect((await send_request(a, id(b))).code).toBe(0);
    expect((await block(a, id(b))).code).toBe(0);
    expect(links(h)).toEqual([]);
    for (const user of [a, b]) expect(counts(h, id(user))).toEqual({ friend_count: 0, sent_count: 0, received_count: 0 });
  });

  it('BlockUser and SendFriendRequest between the same two users at the same time leave no link row between them and counts equal to the link rows', async () => {
    for (let round = 0; round < 3; round += 1) {
      const h = await start();
      const [a, b] = await users(h, 2);
      const results = await Promise.all([block(a, id(b)), send_request(b, id(a))]);
      expect(results[0].code).toBe(0);
      expect([0, CoreError.CORE_ERROR_BLOCKED]).toContain(results[1].code);
      expect(links(h)).toEqual([]);
      expect_counts_match_links(h, [id(a), id(b)]);
      await stop_all();
    }
  });
});

describe('withdrawal', () => {
  it('after Withdraw the user has no link row and no count row, and the others counts no longer hold the relation', async () => {
    const h = await start();
    const [a, b, c, d] = await users(h, 4);
    await befriend(a, b);
    expect((await send_request(c, id(a))).code).toBe(0);
    expect((await send_request(a, id(d))).code).toBe(0);
    const calls = h.content.calls.length;
    expect((await withdraw(a)).code).toBe(0);
    expect(links(h)).toEqual([]);
    expect(count_rows(h).some((r) => r.user_id === id(a))).toBe(false);
    for (const user of [b, c, d]) expect(counts(h, id(user))).toEqual({ friend_count: 0, sent_count: 0, received_count: 0 });
    expect(h.content.calls).toHaveLength(calls);
  });

  it('Withdraw picks every friend_link row it changes by the key prefix, and leaves the link rows between other users', async () => {
    const h = await start();
    const [a, b, c, d] = await users(h, 4);
    await befriend(a, b);
    expect((await send_request(c, id(a))).code).toBe(0);
    expect((await send_request(a, id(d))).code).toBe(0);
    await befriend(c, d);
    const before = links(h).filter((row) => row.user_id !== id(a) && row.other_id !== id(a));
    const spy = vi.spyOn(DbHandle.prototype, 'query');
    let sent: string[];
    try {
      expect((await withdraw(a)).code).toBe(0);
      sent = spy.mock.calls.map(([sql]) => sql).filter((sql) => sql.includes(LINK_TABLE));
    } finally {
      spy.mockRestore();
    }
    const deletes = sent.filter((sql) => sql.startsWith('DELETE'));
    expect(deletes.length).toBeGreaterThan(0);
    for (const sql of deletes) {
      expect(sql).toMatch(/ WHERE user_id = \$1( AND |$)/);
      expect(sql).not.toMatch(/ OR /);
    }
    expect(links(h)).toEqual(before);
    expect(before).toHaveLength(2);
    expect_counts_match_links(h, [id(b), id(c), id(d)]);
  });

  it('Withdraw of the target and SendFriendRequest to it at the same time leave no link row with the withdrawn user, and the sender sent_count equals its Sent rows', async () => {
    for (let round = 0; round < 3; round += 1) {
      const h = await start();
      const [a, b, c] = await users(h, 3);
      expect((await send_request(a, id(c))).code).toBe(0);
      const results = await Promise.all([withdraw(b), send_request(a, id(b))]);
      // On PostgreSQL the Withdraw can read B's link rows before the request commits and find them again with A, whose
      // count row it did not lock: `remove_user` is FAILED and the Withdraw is INTERNAL, and B stays a user.
      expect([0, CoreError.CORE_ERROR_INTERNAL]).toContain(results[0].code);
      expect([0, CoreError.CORE_ERROR_USER_NOT_FOUND]).toContain(results[1].code);
      if (results[0].code === 0) {
        expect(withdrawn_at(h, b)).not.toBeNull();
        expect(links(h).filter((r) => r.user_id === id(b) || r.other_id === id(b))).toEqual([]);
        expect_counts_match_links(h, [id(a), id(c)]);
      } else {
        expect(withdrawn_at(h, b)).toBeNull();
        expect(results[1].code).toBe(0);
        expect_counts_match_links(h, [id(a), id(b), id(c)]);
      }
      await stop_all();
    }
  });

  it('a request to a withdrawn user is USER_NOT_FOUND', async () => {
    const h = await start();
    const [a, b] = await users(h, 2);
    expect((await withdraw(b)).code).toBe(0);
    expect((await send_request(a, id(b))).code).toBe(CoreError.CORE_ERROR_USER_NOT_FOUND);
    expect(links(h)).toEqual([]);
  });

  it('accept of a request from a user who withdrew is FRIEND_REQUEST_NOT_FOUND, since Withdraw deleted the rows', async () => {
    const h = await start();
    const [a, b] = await users(h, 2);
    expect((await send_request(b, id(a))).code).toBe(0);
    expect((await withdraw(b)).code).toBe(0);
    expect((await accept(a, id(b))).code).toBe(CoreError.CORE_ERROR_FRIEND_REQUEST_NOT_FOUND);
  });
});
