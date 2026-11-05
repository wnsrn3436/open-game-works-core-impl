/**
 * A `friend_count` row that another transaction holds past `storage.userLockWaitMs`, held with
 * `testing.hold_game_row_lock`. On SQLite the holder holds the whole database.
 */
import { BLOCK_TABLE } from '../../block-report/index.ts';
import { default_db_kind, hold_game_row_lock, read_logs, type TestSession } from '../../testing/dev/index.ts';
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

/** The `error` log lines of the `friend_count` lock wait timeout. */
function lock_errors(h: Harness): Record<string, unknown>[] {
  return read_logs(h.server, 'error', 'error').filter((line) => JSON.stringify(line).includes(`${COUNT_TABLE} lock wait timed out`));
}

/**
 * Sends `request` while another connection holds the `friend_count` row of `user_id`, and returns its error code.
 * On PostgreSQL the request reaches the friend lock, whose `FAILED` makes the request transaction `FAILED`, and the
 * request adds exactly one `error` log line: the `routing` line of that transaction, with the request name `logged`.
 * On SQLite the holder holds the whole database, so the request fails before friend runs.
 */
async function while_held(h: Harness, user_id: bigint, request: () => Promise<{ code: number }>, logged: string): Promise<number> {
  const logs = read_logs(h.server, 'error', 'error').length;
  const release = await hold_game_row_lock(h.server, COUNT_TABLE, [user_id]);
  let code: number;
  try {
    code = (await request()).code;
  } finally {
    await release();
  }
  if (default_db_kind() === 'postgresql') {
    const added = read_logs(h.server, 'error', 'error').slice(logs);
    expect(added.map((line) => [line['message'], line['request']])).toEqual([['request transaction failed', logged]]);
  }
  return code;
}

/** Sends `request` while every `friend_count` lock of friend is a lock wait timeout, and returns its error code and its lock `error` log lines. */
async function while_failing(h: Harness, request: () => Promise<{ code: number }>): Promise<{ code: number; requests: unknown[] }> {
  const storage = h.core().storage;
  const original = storage.lock_game_row.bind(storage);
  const logs = lock_errors(h).length;
  const spy = vi.spyOn(storage, 'lock_game_row').mockImplementation((ctx, table, key) => (table === COUNT_TABLE ? 'FAILED' : original(ctx, table, key)));
  let code: number;
  try {
    code = (await request()).code;
  } finally {
    spy.mockRestore();
  }
  return { code, requests: lock_errors(h).slice(logs).map((line) => line['request']) };
}

describe('count row lock wait timeout', () => {
  it('a lock wait timeout of friend in each core rpc and in the block listener is INTERNAL, with one routing error log, and writes nothing', async () => {
    const h = await start();
    const [a, b, c] = await users(h, 3);
    await befriend(a, b);
    expect((await send_request(c, id(a))).code).toBe(0);
    const calls = h.content.calls.length;
    const before = state(h, [a, b, c]);
    const cases: [string, () => Promise<{ code: number }>][] = [
      ['core/SendFriendRequest', () => send_request(c, id(b))],
      ['core/AcceptFriendRequest', () => accept(a, id(c))],
      ['core/DeclineFriendRequest', () => decline(a, id(c))],
      ['core/CancelFriendRequest', () => cancel(c, id(a))],
      ['core/RemoveFriend', () => remove(a, id(b))],
      ['core/BlockUser', () => block(a, id(b))],
    ];
    for (const [name, request] of cases) {
      expect(await while_failing(h, request)).toEqual({ code: CoreError.CORE_ERROR_INTERNAL, requests: [name] });
      expect(state(h, [a, b, c])).toEqual(before);
    }
    expect(h.content.calls).toHaveLength(calls);
  });

  it('Withdraw of a friend of a user whose friend_count row another transaction holds is INTERNAL and leaves the link rows, counts and withdrawn_at as they were', async () => {
    const h = await start({ 'storage.userLockWaitMs': LOCK_WAIT_MS });
    const [a, b] = await users(h, 2);
    await befriend(a, b);
    const before = state(h, [a, b]);
    expect(await while_held(h, id(b), () => withdraw(a), 'core/Withdraw')).toBe(CoreError.CORE_ERROR_INTERNAL);
    expect(state(h, [a, b])).toEqual(before);
  });

  it('BlockUser of a user whose friend_count row another transaction holds is INTERNAL with an error log and leaves the block rows and link rows as they were', async () => {
    const h = await start({ 'storage.userLockWaitMs': LOCK_WAIT_MS });
    const [a, b] = await users(h, 2);
    await befriend(a, b);
    const before = state(h, [a, b]);
    expect(await while_held(h, id(b), () => block(a, id(b)), 'core/BlockUser')).toBe(CoreError.CORE_ERROR_INTERNAL);
    expect(state(h, [a, b])).toEqual(before);
  });

  it('SendFriendRequest to a user whose friend_count row another transaction holds is INTERNAL with an error log and writes nothing', async () => {
    const h = await start({ 'storage.userLockWaitMs': LOCK_WAIT_MS });
    const [a, b] = await users(h, 2);
    const before = state(h, [a, b]);
    expect(await while_held(h, id(b), () => send_request(a, id(b)), 'core/SendFriendRequest')).toBe(CoreError.CORE_ERROR_INTERNAL);
    expect(state(h, [a, b])).toEqual(before);
  });

  it('AcceptFriendRequest, DeclineFriendRequest and CancelFriendRequest of a request whose other user count row another transaction holds are INTERNAL with an error log each and write nothing', async () => {
    const h = await start({ 'storage.userLockWaitMs': LOCK_WAIT_MS });
    const [a, b] = await users(h, 2);
    expect((await send_request(b, id(a))).code).toBe(0);
    const calls = h.content.calls.length;
    const before = state(h, [a, b]);
    expect(await while_held(h, id(b), () => accept(a, id(b)), 'core/AcceptFriendRequest')).toBe(CoreError.CORE_ERROR_INTERNAL);
    expect(state(h, [a, b])).toEqual(before);
    expect(await while_held(h, id(b), () => decline(a, id(b)), 'core/DeclineFriendRequest')).toBe(CoreError.CORE_ERROR_INTERNAL);
    expect(state(h, [a, b])).toEqual(before);
    expect(await while_held(h, id(a), () => cancel(b, id(a)), 'core/CancelFriendRequest')).toBe(CoreError.CORE_ERROR_INTERNAL);
    expect(state(h, [a, b])).toEqual(before);
    expect(h.content.calls).toHaveLength(calls);
  });

  it('RemoveFriend of a friend whose friend_count row another transaction holds is INTERNAL with an error log and writes nothing', async () => {
    const h = await start({ 'storage.userLockWaitMs': LOCK_WAIT_MS });
    const [a, b] = await users(h, 2);
    await befriend(a, b);
    const calls = h.content.calls.length;
    const before = state(h, [a, b]);
    expect(await while_held(h, id(b), () => remove(a, id(b)), 'core/RemoveFriend')).toBe(CoreError.CORE_ERROR_INTERNAL);
    expect(state(h, [a, b])).toEqual(before);
    expect(h.content.calls).toHaveLength(calls);
  });
});
