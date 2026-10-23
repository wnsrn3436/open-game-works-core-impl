/**
 * A `friend_count` row that another transaction holds past `storage.userLockWaitMs`, held with
 * `testing.hold_game_row_lock`. On SQLite the holder holds the whole database.
 */
import { BLOCK_TABLE } from '../../block-report/index.ts';
import { hold_game_row_lock, type TestSession } from '../../testing/dev/index.ts';
import { COUNT_TABLE } from '../index.ts';
import {
  CoreError,
  accept,
  befriend,
  block,
  cancel,
  decline,
  id,
  remove,
  send_request,
  snapshot,
  start,
  stop_all,
  users,
  withdraw,
  type Harness,
} from './helpers.ts';

const LOCK_WAIT_MS = 300;

afterEach(async () => {
  await stop_all();
});

/** The friend tables, the users' `withdrawn_at` and the block rows. */
function state(h: Harness, sessions: readonly TestSession[]): unknown {
  const storage = h.core().storage;
  const db = storage.read_db();
  return {
    ...snapshot(h),
    withdrawn_at: sessions.map((session) => storage.get_user_record(db, id(session))?.withdrawn_at),
    blocks: db.query(`SELECT user_id, blocked_id FROM ${BLOCK_TABLE} ORDER BY user_id, blocked_id`, []),
  };
}

/** Sends `request` while another connection holds the `friend_count` row of `user_id`, and returns its error code. */
async function while_held(h: Harness, user_id: bigint, request: () => Promise<{ code: number }>): Promise<number> {
  const release = await hold_game_row_lock(h.server, COUNT_TABLE, [user_id]);
  try {
    return (await request()).code;
  } finally {
    await release();
  }
}

describe('count row lock wait timeout', () => {
  it('Withdraw of a friend of a user whose friend_count row another transaction holds is INTERNAL and leaves the link rows, counts and withdrawn_at as they were', async () => {
    const h = await start({ 'storage.userLockWaitMs': LOCK_WAIT_MS });
    const [a, b] = await users(h, 2);
    await befriend(a, b);
    const before = state(h, [a, b]);
    expect(await while_held(h, id(b), () => withdraw(a))).toBe(CoreError.CORE_ERROR_INTERNAL);
    expect(state(h, [a, b])).toEqual(before);
  });

  it('BlockUser of a user whose friend_count row another transaction holds is INTERNAL and leaves the block rows and link rows as they were', async () => {
    const h = await start({ 'storage.userLockWaitMs': LOCK_WAIT_MS });
    const [a, b] = await users(h, 2);
    await befriend(a, b);
    const before = state(h, [a, b]);
    expect(await while_held(h, id(b), () => block(a, id(b)))).toBe(CoreError.CORE_ERROR_INTERNAL);
    expect(state(h, [a, b])).toEqual(before);
  });

  it('SendFriendRequest to a user whose friend_count row another transaction holds is INTERNAL and writes nothing', async () => {
    const h = await start({ 'storage.userLockWaitMs': LOCK_WAIT_MS });
    const [a, b] = await users(h, 2);
    const before = state(h, [a, b]);
    expect(await while_held(h, id(b), () => send_request(a, id(b)))).toBe(CoreError.CORE_ERROR_INTERNAL);
    expect(state(h, [a, b])).toEqual(before);
  });

  it('AcceptFriendRequest, DeclineFriendRequest and CancelFriendRequest of a request whose other user count row another transaction holds are INTERNAL and write nothing', async () => {
    const h = await start({ 'storage.userLockWaitMs': LOCK_WAIT_MS });
    const [a, b] = await users(h, 2);
    expect((await send_request(b, id(a))).code).toBe(0);
    const calls = h.content.calls.length;
    const before = state(h, [a, b]);
    expect(await while_held(h, id(b), () => accept(a, id(b)))).toBe(CoreError.CORE_ERROR_INTERNAL);
    expect(state(h, [a, b])).toEqual(before);
    expect(await while_held(h, id(b), () => decline(a, id(b)))).toBe(CoreError.CORE_ERROR_INTERNAL);
    expect(state(h, [a, b])).toEqual(before);
    expect(await while_held(h, id(a), () => cancel(b, id(a)))).toBe(CoreError.CORE_ERROR_INTERNAL);
    expect(state(h, [a, b])).toEqual(before);
    expect(h.content.calls).toHaveLength(calls);
  });

  it('RemoveFriend of a friend whose friend_count row another transaction holds is INTERNAL and writes nothing', async () => {
    const h = await start({ 'storage.userLockWaitMs': LOCK_WAIT_MS });
    const [a, b] = await users(h, 2);
    await befriend(a, b);
    const calls = h.content.calls.length;
    const before = state(h, [a, b]);
    expect(await while_held(h, id(b), () => remove(a, id(b)))).toBe(CoreError.CORE_ERROR_INTERNAL);
    expect(state(h, [a, b])).toEqual(before);
    expect(h.content.calls).toHaveLength(calls);
  });
});
