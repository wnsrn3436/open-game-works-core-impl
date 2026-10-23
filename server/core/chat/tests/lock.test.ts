/**
 * Lock wait timeouts of the channel row and the guild row while another connection holds them: `post_system_message`
 * throws, the chat core `rpc`s are `INTERNAL`, and `remove_user` is `FAILED`, so `Withdraw` is `INTERNAL`.
 */
import { hold_game_row_lock, stop_test_server, type TestSession } from '../../testing/dev/index.ts';
import {
  admin_list,
  core_test,
  create_guild,
  delete_guild_chat,
  direct_key,
  E,
  end_other_txs,
  join_guild,
  K,
  make_friends,
  other_tx,
  post_system,
  rows,
  send_chat,
  sent,
  start,
  users,
  withdraw,
  type Harness,
} from './helpers.ts';

let h: Harness;

afterEach(async () => {
  end_other_txs();
  await stop_test_server(h.server);
});

/** `storage.userLockWaitMs` of these tests. */
const WAIT_MS = 200;

/** Runs `fn` while another connection holds the `lock_game_row` lock of the row, and releases it after. */
async function while_held<V>(table: string, key: readonly unknown[], fn: () => Promise<V>): Promise<V> {
  const release = await hold_game_row_lock(h.server, table, key);
  try {
    return await fn();
  } finally {
    await release();
  }
}

/** The `withdrawn_at` of the user row. */
function withdrawn_at(user_id: bigint): unknown {
  return rows(h.core(), 'SELECT withdrawn_at FROM "user" WHERE user_id = $1', [user_id])[0]?.['withdrawn_at'];
}

/** The `(key_a, key_b, seq)` of the stored `Direct` message rows that hold the user. */
function direct_messages(user_id: bigint): unknown[] {
  return rows(h.core(), 'SELECT key_a, key_b, seq FROM chat_message WHERE kind = $1 AND (key_a = $2 OR key_b = $2) ORDER BY key_a, key_b, seq', [
    K.CHAT_CHANNEL_KIND_DIRECT,
    user_id,
  ]);
}

async function guild_of(leader: TestSession, member: TestSession, name: string): Promise<bigint> {
  const guild_id = await create_guild(leader, name);
  await join_guild(member, guild_id);
  return guild_id;
}

describe('lock wait timeout', () => {
  it('throws from a Guild channel post_system_message while another transaction holds the guild row past the lock wait, so the request is INTERNAL and has no message row', async () => {
    h = await start({ settings: { 'storage.userLockWaitMs': WAIT_MS } });
    const [leader] = await users(h.server, 1);
    const guild_id = await create_guild(leader, 'LockedGuild');
    const held = await while_held('guild_guild', [guild_id], () =>
      core_test(h, leader, (ctx) => h.chat().post_system_message(ctx, K.CHAT_CHANNEL_KIND_GUILD, guild_id, 'locked')),
    );
    expect(held.code).toBe(E.CORE_ERROR_INTERNAL);
    expect(await admin_list(h.server, 'Guild', guild_id, 0n)).toEqual([]);
    expect((await post_system(h, leader, K.CHAT_CHANNEL_KIND_GUILD, guild_id, 'free'))?.seq).toBe(1n);
  });

  it('makes a Guild channel SendChatMessage INTERNAL with no message row while another transaction holds the guild row or the channel row past the lock wait', async () => {
    h = await start({ settings: { 'storage.userLockWaitMs': WAIT_MS } });
    const [leader, member] = await users(h.server, 2);
    const guild_id = await guild_of(leader, member, 'SendLock');
    for (const [table, key] of [
      ['guild_guild', [guild_id]],
      ['chat_channel', [K.CHAT_CHANNEL_KIND_GUILD, guild_id, 0n]],
    ] as const) {
      expect((await while_held(table, key, () => send_chat(member, K.CHAT_CHANNEL_KIND_GUILD, 0n, 'locked'))).code).toBe(E.CORE_ERROR_INTERNAL);
    }
    expect(await admin_list(h.server, 'Guild', guild_id, 0n)).toEqual([]);
    expect((await sent(send_chat(member, K.CHAT_CHANNEL_KIND_GUILD, 0n, 'free'))).seq).toBe(1n);
  });

  it('makes a Direct channel SendChatMessage INTERNAL with no channel or message row while another transaction holds the channel row past the lock wait', async () => {
    h = await start({ settings: { 'storage.userLockWaitMs': WAIT_MS } });
    const [a, b] = await users(h.server, 2);
    await make_friends(a, b);
    const key = [K.CHAT_CHANNEL_KIND_DIRECT, ...direct_key(a.user_id, b.user_id)];
    expect((await while_held('chat_channel', key, () => send_chat(a, K.CHAT_CHANNEL_KIND_DIRECT, b.user_id, 'locked'))).code).toBe(E.CORE_ERROR_INTERNAL);
    expect(rows(h.core(), 'SELECT last_seq FROM chat_channel WHERE kind = $1 AND key_a = $2 AND key_b = $3', key)).toEqual([]);
    expect(direct_messages(a.user_id)).toEqual([]);
    expect((await sent(send_chat(a, K.CHAT_CHANNEL_KIND_DIRECT, b.user_id, 'free'))).seq).toBe(1n);
  });

  it('makes DeleteGuildChatMessage INTERNAL and keeps the message while another transaction holds the guild row or the channel row past the lock wait', async () => {
    h = await start({ settings: { 'storage.userLockWaitMs': WAIT_MS } });
    const [leader, member] = await users(h.server, 2);
    const guild_id = await guild_of(leader, member, 'DeleteLock');
    await sent(send_chat(member, K.CHAT_CHANNEL_KIND_GUILD, 0n, 'keep'));
    for (const [table, key] of [
      ['guild_guild', [guild_id]],
      ['chat_channel', [K.CHAT_CHANNEL_KIND_GUILD, guild_id, 0n]],
    ] as const) {
      expect((await while_held(table, key, () => delete_guild_chat(leader, 1n))).code).toBe(E.CORE_ERROR_INTERNAL);
    }
    expect((await admin_list(h.server, 'Guild', guild_id, 0n)).map((m) => [m.seq, m.deleted])).toEqual([['1', false]]);
    expect(rows(h.core(), 'SELECT seq FROM chat_deletion WHERE kind = $1 AND key_a = $2', [K.CHAT_CHANNEL_KIND_GUILD, guild_id])).toEqual([]);
    expect((await delete_guild_chat(leader, 1n)).code).toBe(0);
  });

  it('makes Withdraw INTERNAL, as remove_user is FAILED, and keeps the chat rows while another transaction holds a Direct channel row of the user past the lock wait', async () => {
    h = await start({ settings: { 'storage.userLockWaitMs': WAIT_MS } });
    const [leaving, friend] = await users(h.server, 2);
    await make_friends(leaving, friend);
    await sent(send_chat(leaving, K.CHAT_CHANNEL_KIND_DIRECT, friend.user_id, 'kept'));
    await sent(send_chat(leaving, K.CHAT_CHANNEL_KIND_WORLD, 1n, 'kept'));
    const key = [K.CHAT_CHANNEL_KIND_DIRECT, ...direct_key(leaving.user_id, friend.user_id)];
    expect(await while_held('chat_channel', key, () => withdraw(leaving))).toBe(E.CORE_ERROR_INTERNAL);
    expect(withdrawn_at(leaving.user_id)).toBeNull();
    expect(direct_messages(leaving.user_id)).toHaveLength(1);
    expect(await admin_list(h.server, 'World', 1n, 0n)).toHaveLength(1);
    expect(await withdraw(leaving)).toBe(0);
    expect(direct_messages(leaving.user_id)).toEqual([]);
  });

  it('makes Withdraw INTERNAL, as remove_user is FAILED, and keeps the chat rows when a Direct channel row of the user it read again after its locks is one it did not lock (PostgreSQL)', async () => {
    h = await start({ db: 'postgresql' });
    const [leaving, friend, stranger] = await users(h.server, 3);
    await make_friends(leaving, friend);
    await sent(send_chat(leaving, K.CHAT_CHANNEL_KIND_DIRECT, friend.user_id, 'kept'));
    // Another server instance holds the friend's Direct channel row, which remove_user waits for, and writes a Direct
    // channel row of the user with a stranger, which remove_user's first read did not see. It commits while remove_user waits.
    const other = await other_tx(h, [['chat_channel', [K.CHAT_CHANNEL_KIND_DIRECT, ...direct_key(leaving.user_id, friend.user_id)]]]);
    const [key_a, key_b] = direct_key(leaving.user_id, stranger.user_id);
    await other.run('INSERT INTO chat_channel (kind, key_a, key_b, last_seq, last_at, last_delete_seq) VALUES ($1, $2, $3, 0, 0, 0)', [K.CHAT_CHANNEL_KIND_DIRECT, key_a, key_b]);
    // It commits only once remove_user waits: a commit before remove_user's first read would let that read see the
    // stranger's channel row, and remove_user would lock it too.
    const committed = other.commit_when_waited();
    expect(await withdraw(leaving)).toBe(E.CORE_ERROR_INTERNAL);
    expect(await committed).toBe(true);
    expect(withdrawn_at(leaving.user_id)).toBeNull();
    expect(direct_messages(leaving.user_id)).toHaveLength(1);
    expect(rows(h.core(), 'SELECT key_a, key_b FROM chat_channel WHERE kind = $1 AND (key_a = $2 OR key_b = $2) ORDER BY key_a, key_b', [K.CHAT_CHANNEL_KIND_DIRECT, leaving.user_id])).toHaveLength(2);
  });
});
