import * as CoreContract from '../../../generated/contract/core_contract.ts';
import { advance_time, login } from '../../testing/dev/index.ts';
import { BLOCK_TABLE } from '../index.ts';
import { block_user, get_blocked_users, in_request, start, stop_all, unblock_user, withdraw, type Instance } from './kit.ts';

const INVALID_REQUEST = CoreContract.CoreError.CORE_ERROR_INVALID_REQUEST;
const USER_NOT_FOUND = CoreContract.CoreError.CORE_ERROR_USER_NOT_FOUND;
const BLOCK_LIMIT = CoreContract.CoreError.CORE_ERROR_BLOCK_LIMIT;

afterEach(async () => {
  await stop_all();
});

function block_row_count(instance: Instance, user_id: bigint): number {
  return instance.storage.read_db().query(`SELECT blocked_id FROM ${BLOCK_TABLE} WHERE user_id = $1`, [user_id]).length;
}

describe('BlockUser and UnblockUser', () => {
  it('makes is_blocked true after BlockUser and false after UnblockUser', async () => {
    const instance = await start();
    const alice = await login(instance.server, 'alice');
    const bob = await login(instance.server, 'bob');
    expect((await block_user(alice, bob.user_id)).code).toBeNull();
    expect(await in_request(instance, bob, (ctx) => instance.block.is_blocked(ctx, alice.user_id, bob.user_id))).toBe(true);
    expect(await in_request(instance, bob, (ctx) => instance.block.is_blocked(ctx, bob.user_id, alice.user_id))).toBe(false);
    expect((await unblock_user(alice, bob.user_id)).code).toBeNull();
    expect(await in_request(instance, bob, (ctx) => instance.block.is_blocked(ctx, alice.user_id, bob.user_id))).toBe(false);
  });

  it('succeeds on a second BlockUser of the same user and keeps one block row', async () => {
    const instance = await start();
    const alice = await login(instance.server, 'alice');
    const bob = await login(instance.server, 'bob');
    expect((await block_user(alice, bob.user_id)).code).toBeNull();
    expect((await block_user(alice, bob.user_id)).code).toBeNull();
    expect(block_row_count(instance, alice.user_id)).toBe(1);
  });

  it('succeeds on UnblockUser of a user that is not blocked', async () => {
    const instance = await start();
    const alice = await login(instance.server, 'alice');
    const bob = await login(instance.server, 'bob');
    expect((await unblock_user(alice, bob.user_id)).code).toBeNull();
  });

  it('is INVALID_REQUEST for the own user ID and for user ID 0', async () => {
    const instance = await start();
    const alice = await login(instance.server, 'alice');
    expect((await block_user(alice, alice.user_id)).code).toBe(INVALID_REQUEST);
    expect((await block_user(alice, 0n)).code).toBe(INVALID_REQUEST);
    expect((await unblock_user(alice, alice.user_id)).code).toBe(INVALID_REQUEST);
    expect((await unblock_user(alice, 0n)).code).toBe(INVALID_REQUEST);
    expect(block_row_count(instance, alice.user_id)).toBe(0);
  });

  it('is USER_NOT_FOUND for a user that does not exist', async () => {
    const instance = await start();
    const alice = await login(instance.server, 'alice');
    expect((await block_user(alice, alice.user_id + 1_000_000n)).code).toBe(USER_NOT_FOUND);
    expect(block_row_count(instance, alice.user_id)).toBe(0);
  });

  it('is BLOCK_LIMIT when the block rows reach block-report.maxBlocks, and writes nothing', async () => {
    const instance = await start({ settings: { 'block-report.maxBlocks': 2 } });
    const alice = await login(instance.server, 'alice');
    const bob = await login(instance.server, 'bob');
    const carol = await login(instance.server, 'carol');
    const dave = await login(instance.server, 'dave');
    expect((await block_user(alice, bob.user_id)).code).toBeNull();
    expect((await block_user(alice, carol.user_id)).code).toBeNull();
    expect((await block_user(alice, dave.user_id)).code).toBe(BLOCK_LIMIT);
    expect(block_row_count(instance, alice.user_id)).toBe(2);
    // An already blocked user is a success at the limit.
    expect((await block_user(alice, bob.user_id)).code).toBeNull();
  });

  it('deletes the block row of a withdrawn user on the next BlockUser so that it does not count toward the limit', async () => {
    const instance = await start({ settings: { 'block-report.maxBlocks': 1 } });
    const alice = await login(instance.server, 'alice');
    const bob = await login(instance.server, 'bob');
    const carol = await login(instance.server, 'carol');
    expect((await block_user(alice, bob.user_id)).code).toBeNull();
    expect((await withdraw(bob)).code).toBeNull();
    expect(block_row_count(instance, alice.user_id)).toBe(1);
    expect((await block_user(alice, carol.user_id)).code).toBeNull();
    const rows = instance.storage.read_db().query(`SELECT blocked_id FROM ${BLOCK_TABLE} WHERE user_id = $1`, [alice.user_id]);
    expect(rows).toEqual([{ blocked_id: carol.user_id }]);
  });

  it('is USER_NOT_FOUND for a withdrawn user, and UnblockUser of a withdrawn user succeeds', async () => {
    const instance = await start();
    const alice = await login(instance.server, 'alice');
    const bob = await login(instance.server, 'bob');
    expect((await block_user(alice, bob.user_id)).code).toBeNull();
    expect((await withdraw(bob)).code).toBeNull();
    expect((await block_user(alice, bob.user_id)).code).toBe(USER_NOT_FOUND);
    expect((await unblock_user(alice, bob.user_id)).code).toBeNull();
    expect(block_row_count(instance, alice.user_id)).toBe(0);
  });
});

describe('block listener', () => {
  it('is called once inside the BlockUser transaction, with the block row already written', async () => {
    const calls: { blocker: bigint; blocked: bigint; row_seen: boolean }[] = [];
    const holder: { instance: Instance | null } = { instance: null };
    const instance = await start({
      listeners: [
        (ctx, blocker, blocked) => {
          calls.push({ blocker, blocked, row_seen: holder.instance?.block.is_blocked(ctx, blocker, blocked) ?? false });
        },
      ],
    });
    holder.instance = instance;
    const alice = await login(instance.server, 'alice');
    const bob = await login(instance.server, 'bob');
    expect((await block_user(alice, bob.user_id)).code).toBeNull();
    expect(calls).toEqual([{ blocker: alice.user_id, blocked: bob.user_id, row_seen: true }]);
    // A second BlockUser of the same user changes nothing and does not call the listener.
    expect((await block_user(alice, bob.user_id)).code).toBeNull();
    expect(calls).toHaveLength(1);
  });

  it('calls the listeners in registration order', async () => {
    const order: string[] = [];
    const instance = await start({ listeners: [() => order.push('first'), () => order.push('second')] });
    const alice = await login(instance.server, 'alice');
    const bob = await login(instance.server, 'bob');
    expect((await block_user(alice, bob.user_id)).code).toBeNull();
    expect(order).toEqual(['first', 'second']);
  });

  it('makes BlockUser INTERNAL with no block row when it throws', async () => {
    const instance = await start({
      listeners: [
        () => {
          throw new Error('listener failure');
        },
      ],
    });
    const alice = await login(instance.server, 'alice');
    const bob = await login(instance.server, 'bob');
    expect((await block_user(alice, bob.user_id)).code).toBe(CoreContract.CoreError.CORE_ERROR_INTERNAL);
    expect(block_row_count(instance, alice.user_id)).toBe(0);
    expect(await in_request(instance, bob, (ctx) => instance.block.is_blocked(ctx, alice.user_id, bob.user_id))).toBe(false);
  });
});

describe('GetBlockedUsers', () => {
  it('lists blocked users by blocked_at descending, user ID ascending for the same blocked_at, without withdrawn users', async () => {
    const instance = await start();
    const alice = await login(instance.server, 'alice');
    const bob = await login(instance.server, 'bob');
    const carol = await login(instance.server, 'carol');
    const dave = await login(instance.server, 'dave');
    const erin = await login(instance.server, 'erin');
    const first = await block_user(alice, bob.user_id);
    advance_time(instance.server, 1000n);
    const second = await block_user(alice, dave.user_id);
    const third = await block_user(alice, carol.user_id);
    advance_time(instance.server, 1000n);
    await block_user(alice, erin.user_id);
    expect((await withdraw(erin)).code).toBeNull();

    const result = await get_blocked_users(alice);
    expect(result.code).toBeNull();
    const entries = (result.response?.blocked ?? []).map((entry) => ({ user_id: entry.profile?.user_id, blocked_at: entry.blocked_at }));
    const [low, high] = carol.user_id < dave.user_id ? [carol.user_id, dave.user_id] : [dave.user_id, carol.user_id];
    expect(second.server_time_at).toBe(third.server_time_at);
    expect(entries).toEqual([
      { user_id: low, blocked_at: second.server_time_at },
      { user_id: high, blocked_at: second.server_time_at },
      { user_id: bob.user_id, blocked_at: first.server_time_at },
    ]);
  });

  it('lists block rows over public-profile.maxRequestCount, left from a higher block-report.maxBlocks', async () => {
    const instance = await start({ settings: { 'block-report.maxBlocks': 2, 'public-profile.maxRequestCount': 2 } });
    const alice = await login(instance.server, 'alice');
    const bob = await login(instance.server, 'bob');
    const carol = await login(instance.server, 'carol');
    const dave = await login(instance.server, 'dave');
    const first = await block_user(alice, bob.user_id);
    expect(first.code).toBeNull();
    expect((await block_user(alice, carol.user_id)).code).toBeNull();
    // The third row stands for one written while block-report.maxBlocks was higher.
    await in_request(instance, alice, (ctx) =>
      instance.storage.db(ctx).query(`INSERT INTO ${BLOCK_TABLE} (user_id, blocked_id, created_at) VALUES ($1, $2, $3)`, [alice.user_id, dave.user_id, first.server_time_at]),
    );
    expect(block_row_count(instance, alice.user_id)).toBe(3);

    const lookups = vi.spyOn(instance.profiles, 'get_public_profiles');
    const result = await get_blocked_users(alice);
    expect(result.code).toBeNull();
    const ids = (result.response?.blocked ?? []).map((entry) => entry.profile?.user_id);
    expect(ids).toEqual([bob.user_id, carol.user_id, dave.user_id].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)));
    // block-report hands every blocked user to one get_public_profiles call, which chunks by public-profile.maxRequestCount itself.
    expect(lookups.mock.calls.map(([, user_ids]) => user_ids.length)).toEqual([3]);
  });

  it('is an empty list for a user who blocked nobody', async () => {
    const instance = await start();
    const alice = await login(instance.server, 'alice');
    const result = await get_blocked_users(alice);
    expect(result.code).toBeNull();
    expect(result.response?.blocked).toEqual([]);
  });
});

describe('is_blocked_either and list_blocked_ids', () => {
  it('is_blocked_either is true for a block in either direction and false without one', async () => {
    const instance = await start();
    const alice = await login(instance.server, 'alice');
    const bob = await login(instance.server, 'bob');
    const carol = await login(instance.server, 'carol');
    await block_user(alice, bob.user_id);
    await block_user(carol, alice.user_id);
    const result = await in_request(instance, bob, (ctx) => ({
      alice_bob: instance.block.is_blocked_either(ctx, alice.user_id, bob.user_id),
      bob_alice: instance.block.is_blocked_either(ctx, bob.user_id, alice.user_id),
      alice_carol: instance.block.is_blocked_either(ctx, alice.user_id, carol.user_id),
      bob_carol: instance.block.is_blocked_either(ctx, bob.user_id, carol.user_id),
    }));
    expect(result).toEqual({ alice_bob: true, bob_alice: true, alice_carol: true, bob_carol: false });
  });

  it('list_blocked_ids lists the blocked user IDs ascending, also of another user', async () => {
    const instance = await start();
    const alice = await login(instance.server, 'alice');
    const bob = await login(instance.server, 'bob');
    const carol = await login(instance.server, 'carol');
    await block_user(alice, carol.user_id);
    await block_user(alice, bob.user_id);
    const ids = await in_request(instance, bob, (ctx) => instance.block.list_blocked_ids(ctx, alice.user_id));
    expect(ids).toEqual([bob.user_id, carol.user_id].sort((a, b) => (a < b ? -1 : 1)));
    expect(await in_request(instance, bob, (ctx) => instance.block.list_blocked_ids(ctx, bob.user_id))).toEqual([]);
  });
});
