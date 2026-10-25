/** Direct channels between friends, hidden messages of blocked users and the channel list. */
import * as CoreContract from '../../../generated/contract/core_contract.ts';
import { stop_test_server } from '../../testing/dev/index.ts';
import { BLOCK_TABLE } from '../../block-report/index.ts';
import {
  block,
  channels,
  core_test,
  create_guild,
  delete_guild_chat,
  E,
  got,
  join_guild,
  K,
  later,
  make_friends,
  send_chat,
  sent,
  seqs,
  start,
  users,
  withdraw,
  type Harness,
} from './helpers.ts';

let h: Harness;

afterEach(async () => {
  await stop_test_server(h.server);
});

/** `(channel_kind, channel_key, last_seq, last_at, last_visible_seq, profile user ID)` of a channel entry. */
function entry_of(entry: CoreContract.ChatChannelEntry): unknown[] {
  return [entry.channel_kind, entry.channel_key, entry.last_seq, entry.last_at, entry.last_visible_seq, entry.profile?.user_id ?? null];
}

describe('Direct channel', () => {
  it('refuses a user who is not a friend with CHAT_NOT_FRIEND, a block either way with BLOCKED and a withdrawn user with USER_NOT_FOUND', async () => {
    h = await start();
    const [a, stranger, blocker, leaving] = await users(h.server, 4);
    expect((await send_chat(a, K.CHAT_CHANNEL_KIND_DIRECT, stranger.user_id, 'hi')).code).toBe(E.CORE_ERROR_CHAT_NOT_FRIEND);
    expect((await send_chat(a, K.CHAT_CHANNEL_KIND_DIRECT, a.user_id, 'me')).code).toBe(E.CORE_ERROR_INVALID_REQUEST);
    expect((await send_chat(a, K.CHAT_CHANNEL_KIND_DIRECT, 0n, 'none')).code).toBe(E.CORE_ERROR_INVALID_REQUEST);
    await make_friends(a, blocker);
    await block(blocker, a);
    expect((await send_chat(a, K.CHAT_CHANNEL_KIND_DIRECT, blocker.user_id, 'hi')).code).toBe(E.CORE_ERROR_BLOCKED);
    expect((await send_chat(blocker, K.CHAT_CHANNEL_KIND_DIRECT, a.user_id, 'hi')).code).toBe(E.CORE_ERROR_BLOCKED);
    await make_friends(a, leaving);
    expect(await withdraw(leaving)).toBe(0);
    expect((await send_chat(a, K.CHAT_CHANNEL_KIND_DIRECT, leaving.user_id, 'hi')).code).toBe(E.CORE_ERROR_USER_NOT_FOUND);
  });

  it('gives the Direct messages of two friends to both of them with the other user as channel_key', async () => {
    h = await start();
    const [a, b, stranger] = await users(h.server, 3);
    await make_friends(a, b);
    await sent(send_chat(a, K.CHAT_CHANNEL_KIND_DIRECT, b.user_id, 'from a'));
    await sent(send_chat(b, K.CHAT_CHANNEL_KIND_DIRECT, a.user_id, 'from b'));
    const at_a = await got(a, K.CHAT_CHANNEL_KIND_DIRECT, b.user_id);
    const at_b = await got(b, K.CHAT_CHANNEL_KIND_DIRECT, a.user_id);
    expect([at_a.channel_key, at_a.messages.map((m) => [m.text, m.channel_key])]).toEqual([
      b.user_id,
      [
        ['from a', b.user_id],
        ['from b', b.user_id],
      ],
    ]);
    expect([at_b.channel_key, at_b.messages.map((m) => [m.text, m.channel_key])]).toEqual([
      a.user_id,
      [
        ['from a', a.user_id],
        ['from b', a.user_id],
      ],
    ]);
    expect(seqs(await got(stranger, K.CHAT_CHANNEL_KIND_DIRECT, a.user_id))).toEqual([]);
  });

  it('hides the messages of a user I blocked while last_seq still reaches their seq', async () => {
    h = await start();
    const [a, b] = await users(h.server, 2);
    await sent(send_chat(a, K.CHAT_CHANNEL_KIND_WORLD, 1n, 'mine'));
    await sent(send_chat(b, K.CHAT_CHANNEL_KIND_WORLD, 1n, 'theirs'));
    await block(a, b);
    const latest = await got(a, K.CHAT_CHANNEL_KIND_WORLD, 1n);
    expect([latest.messages.map((m) => m.text), latest.last_seq]).toEqual([['mine'], 2n]);
    const after = await got(a, K.CHAT_CHANNEL_KIND_WORLD, 1n, { after_seq: 1n });
    expect([seqs(after), after.last_seq]).toEqual([[], 2n]);
    expect(seqs(await got(b, K.CHAT_CHANNEL_KIND_WORLD, 1n))).toEqual([1n, 2n]);
  });
});

describe('GetChatChannels', () => {
  it('gives my guild first, then Direct channels by last_at descending up to chat.maxChannelListCount, without blocked users and channels past chat.retentionMs', async () => {
    h = await start({ settings: { 'chat.retentionMs': 100_000, 'chat.maxChannelListCount': 2 } });
    const [me, f1, f2, f3, f4, f5] = await users(h.server, 6);
    const guild_id = await create_guild(me, 'ListGuild');
    for (const friend of [f1, f2, f3, f4, f5]) await make_friends(me, friend);
    await sent(send_chat(f1, K.CHAT_CHANNEL_KIND_DIRECT, me.user_id, 'f1'));
    later(h.server, 50_000n);
    await sent(send_chat(f2, K.CHAT_CHANNEL_KIND_DIRECT, me.user_id, 'f2'));
    later(h.server, 55_000n);
    const f5_last = await sent(send_chat(f5, K.CHAT_CHANNEL_KIND_DIRECT, me.user_id, 'f5'));
    later(h.server, 5_000n);
    await sent(send_chat(f3, K.CHAT_CHANNEL_KIND_DIRECT, me.user_id, 'f3 one'));
    const f3_last = await sent(send_chat(f3, K.CHAT_CHANNEL_KIND_DIRECT, me.user_id, 'f3 two'));
    await sent(send_chat(f4, K.CHAT_CHANNEL_KIND_DIRECT, me.user_id, 'f4'));
    await block(me, f4);
    const guild_last = await sent(send_chat(me, K.CHAT_CHANNEL_KIND_GUILD, 0n, 'guild'));

    const result = await channels(me);
    expect(result.map(entry_of)).toEqual([
      [K.CHAT_CHANNEL_KIND_GUILD, guild_id, 1n, guild_last.created_at, 1n, 0n],
      [K.CHAT_CHANNEL_KIND_DIRECT, f3.user_id, 2n, f3_last.created_at, 2n, f3.user_id],
      [K.CHAT_CHANNEL_KIND_DIRECT, f5.user_id, 1n, f5_last.created_at, 1n, f5.user_id],
    ]);
    expect(result[0]?.profile).toEqual(new CoreContract.PublicProfileEntry());
  });

  it('gives the first chat.maxChannelListCount Direct channels by last_at descending and other user ID ascending over channels where I am key_a and key_b, when blocked users hold the latest rows of one key column', async () => {
    h = await start({ settings: { 'chat.maxChannelListCount': 3 } });
    // Sorted by user ID: `low` shares channels where I am key_b, the `high` users channels where I am key_a.
    const [low, me, high1, high2, high3, high4] = (await users(h.server, 6)).sort((a, b) => (a.user_id < b.user_id ? -1 : 1));
    expect([low.user_id < me.user_id, me.user_id < high1.user_id]).toEqual([true, true]);
    for (const friend of [low, high1, high2, high3, high4]) await make_friends(me, friend);
    await sent(send_chat(high1, K.CHAT_CHANNEL_KIND_DIRECT, me.user_id, 'high1'));
    await sent(send_chat(low, K.CHAT_CHANNEL_KIND_DIRECT, me.user_id, 'low'));
    later(h.server, 1_000n);
    await sent(send_chat(high2, K.CHAT_CHANNEL_KIND_DIRECT, me.user_id, 'high2'));
    later(h.server, 1_000n);
    await sent(send_chat(high3, K.CHAT_CHANNEL_KIND_DIRECT, me.user_id, 'high3'));
    await sent(send_chat(high4, K.CHAT_CHANNEL_KIND_DIRECT, me.user_id, 'high4'));
    await block(me, high3);
    await block(me, high4);

    const result = await channels(me);
    expect(result.map((entry) => [entry.channel_kind, entry.channel_key, entry.last_seq, entry.last_visible_seq])).toEqual([
      [K.CHAT_CHANNEL_KIND_DIRECT, high2.user_id, 1n, 1n],
      [K.CHAT_CHANNEL_KIND_DIRECT, low.user_id, 1n, 1n],
      [K.CHAT_CHANNEL_KIND_DIRECT, high1.user_id, 1n, 1n],
    ]);
  });

  it('fills the Direct profiles with one get_public_profiles call, which chunks by public-profile.maxRequestCount itself', async () => {
    h = await start({ settings: { 'public-profile.maxRequestCount': 1 } });
    const [me, f1, f2, f3] = await users(h.server, 4);
    for (const friend of [f1, f2, f3]) {
      await make_friends(me, friend);
      await sent(send_chat(friend, K.CHAT_CHANNEL_KIND_DIRECT, me.user_id, 'hi'));
    }
    const lookups = vi.spyOn(h.core()['public-profile'], 'get_public_profiles');
    const result = await channels(me);
    // The same last_at: user ID ascending.
    expect(result.map((entry) => entry.profile?.user_id)).toEqual([f1.user_id, f2.user_id, f3.user_id].sort((a, b) => (a < b ? -1 : 1)));
    expect(lookups.mock.calls.map(([, user_ids]) => user_ids.length)).toEqual([3]);
  });

  it('gives last_visible_seq without messages of blocked users, deleted messages and messages past chat.retentionMs, 0 when only those are left, while last_seq counts them', async () => {
    h = await start({ settings: { 'chat.retentionMs': 100_000 } });
    const [me, b, c] = await users(h.server, 3);
    const guild_id = await create_guild(me, 'SeenGuild');
    await join_guild(b, guild_id);
    await join_guild(c, guild_id);
    await block(me, c);
    await sent(send_chat(b, K.CHAT_CHANNEL_KIND_GUILD, 0n, 'one'));
    later(h.server, 60_000n);
    await sent(send_chat(c, K.CHAT_CHANNEL_KIND_GUILD, 0n, 'blocked'));
    await sent(send_chat(b, K.CHAT_CHANNEL_KIND_GUILD, 0n, 'three'));
    expect((await delete_guild_chat(me, 3n)).code).toBe(0);
    expect((await channels(me)).map(entry_of)[0]).toEqual([K.CHAT_CHANNEL_KIND_GUILD, guild_id, 3n, expect.any(BigInt), 1n, 0n]);
    later(h.server, 50_000n);
    expect((await channels(me)).map(entry_of)[0]).toEqual([K.CHAT_CHANNEL_KIND_GUILD, guild_id, 3n, expect.any(BigInt), 0n, 0n]);
    expect((await channels(b)).map(entry_of)[0]).toEqual([K.CHAT_CHANNEL_KIND_GUILD, guild_id, 3n, expect.any(BigInt), 2n, 0n]);
  });

  it('gives last_visible_seq below more than chat.maxFetchCount newer messages of users I blocked, in a Guild and a Direct channel', async () => {
    h = await start({ settings: { 'chat.maxFetchCount': 2 } });
    const [me, b, c, d] = await users(h.server, 4);
    const guild_id = await create_guild(me, 'FarGuild');
    await join_guild(b, guild_id);
    await join_guild(c, guild_id);
    await join_guild(d, guild_id);
    await make_friends(me, b);
    await block(me, c);
    await block(me, d);
    await sent(send_chat(b, K.CHAT_CHANNEL_KIND_GUILD, 0n, 'seen'));
    for (const sender of [c, d, c, d, c]) await sent(send_chat(sender, K.CHAT_CHANNEL_KIND_GUILD, 0n, 'hidden'));
    await sent(send_chat(b, K.CHAT_CHANNEL_KIND_DIRECT, me.user_id, 'seen'));
    await sent(send_chat(me, K.CHAT_CHANNEL_KIND_DIRECT, b.user_id, 'mine'));
    expect((await channels(me)).map((entry) => [entry.channel_kind, entry.last_seq, entry.last_visible_seq])).toEqual([
      [K.CHAT_CHANNEL_KIND_GUILD, 6n, 1n],
      [K.CHAT_CHANNEL_KIND_DIRECT, 2n, 2n],
    ]);
    expect((await channels(b)).map((entry) => [entry.channel_kind, entry.last_visible_seq])).toEqual([
      [K.CHAT_CHANNEL_KIND_GUILD, 6n],
      [K.CHAT_CHANNEL_KIND_DIRECT, 2n],
    ]);
    await block(b, c);
    await block(b, d);
    expect((await channels(b)).map((entry) => [entry.channel_kind, entry.last_visible_seq])).toEqual([
      [K.CHAT_CHANNEL_KIND_GUILD, 1n],
      [K.CHAT_CHANNEL_KIND_DIRECT, 2n],
    ]);
  });

  // 40000 blocked users take more bind parameters than a PostgreSQL or SQLite statement takes.
  it.each(['sqlite', 'postgresql'] as const)('gives last_visible_seq when I blocked more users than a statement takes bind parameters (%s)', async (db) => {
    h = await start({ db });
    const [me, b, c] = await users(h.server, 3);
    const guild_id = await create_guild(me, 'WideGuild');
    await join_guild(b, guild_id);
    await join_guild(c, guild_id);
    await make_friends(me, b);
    await block(me, c);
    const inserted = await core_test(h, me, (ctx) =>
      h.core().storage.db(ctx).query(
        `WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < 40000) ` +
          `INSERT INTO ${BLOCK_TABLE} (user_id, blocked_id, created_at) SELECT $1, CAST($2 AS BIGINT) + i, 0 FROM n`,
        [me.user_id, 1_000_000_000n],
      ),
    );
    expect(inserted.code).toBe(0);
    await sent(send_chat(b, K.CHAT_CHANNEL_KIND_GUILD, 0n, 'seen'));
    for (let i = 0; i < 3; i += 1) await sent(send_chat(c, K.CHAT_CHANNEL_KIND_GUILD, 0n, 'hidden'));
    await sent(send_chat(b, K.CHAT_CHANNEL_KIND_DIRECT, me.user_id, 'seen'));
    expect((await channels(me)).map((entry) => [entry.channel_kind, entry.last_seq, entry.last_visible_seq])).toEqual([
      [K.CHAT_CHANNEL_KIND_GUILD, 4n, 1n],
      [K.CHAT_CHANNEL_KIND_DIRECT, 1n, 1n],
    ]);
    await sent(send_chat(me, K.CHAT_CHANNEL_KIND_GUILD, 0n, 'mine'));
    expect((await channels(me)).map((entry) => [entry.channel_kind, entry.last_visible_seq])[0]).toEqual([K.CHAT_CHANNEL_KIND_GUILD, 5n]);
  });
});
