/** Guild channel membership, guild message deletion, deleted message delivery and the guild-then-channel lock order. */
import * as CoreContract from '../../../generated/contract/core_contract.ts';
import { stop_test_server } from '../../testing/dev/index.ts';
import {
  admin,
  admin_list,
  create_guild,
  delete_guild_chat,
  E,
  end_other_txs,
  get_chat,
  got,
  post_system,
  join_guild,
  K,
  other_tx,
  rows,
  send_chat,
  sent,
  seqs,
  set_role,
  start,
  users,
  type Harness,
} from './helpers.ts';

let h: Harness;

afterEach(async () => {
  end_other_txs();
  await stop_test_server(h.server);
});

const Role = CoreContract.GuildRole;

/** How long another transaction keeps its locks while a request of the test server waits for them. */
const HOLD_MS = 500;

describe('Guild channel', () => {
  it('refuses send and receive of a user who is not a guild member with GUILD_NOT_MEMBER, and keeps a member message in that guild channel only', async () => {
    h = await start();
    const [leader1, leader2, outsider] = await users(h.server, 3);
    const guild1 = await create_guild(leader1, 'GuildOne');
    const guild2 = await create_guild(leader2, 'GuildTwo');
    expect((await send_chat(outsider, K.CHAT_CHANNEL_KIND_GUILD, 0n, 'x')).code).toBe(E.CORE_ERROR_GUILD_NOT_MEMBER);
    expect((await get_chat(outsider, K.CHAT_CHANNEL_KIND_GUILD, 0n)).code).toBe(E.CORE_ERROR_GUILD_NOT_MEMBER);
    expect((await sent(send_chat(leader1, K.CHAT_CHANNEL_KIND_GUILD, 0n, 'for guild one'))).channel_key).toBe(guild1);
    expect(seqs(await got(leader1, K.CHAT_CHANNEL_KIND_GUILD, 0n))).toEqual([1n]);
    expect(seqs(await got(leader2, K.CHAT_CHANNEL_KIND_GUILD, 0n))).toEqual([]);
    expect(await admin_list(h.server, 'Guild', guild1, 0n)).toHaveLength(1);
    expect(await admin_list(h.server, 'Guild', guild2, 0n)).toHaveLength(0);
  });

  it('gives the guild ID as channel_key of a Guild channel GetChatMessages response and its messages', async () => {
    h = await start();
    const [leader, member] = await users(h.server, 2);
    const guild_id = await create_guild(leader, 'KeyGuild');
    await join_guild(member, guild_id);
    await sent(send_chat(leader, K.CHAT_CHANNEL_KIND_GUILD, 0n, 'hi'));
    const response = await got(member, K.CHAT_CHANNEL_KIND_GUILD, 0n);
    expect(response.channel_key).toBe(guild_id);
    expect(response.messages.map((m) => [m.channel_kind, m.channel_key])).toEqual([[K.CHAT_CHANNEL_KIND_GUILD, guild_id]]);
  });

  it('refuses DeleteGuildChatMessage of a Member with GUILD_PERMISSION, of a user outside the guild with GUILD_NOT_MEMBER and of a deleted message with CHAT_MESSAGE_NOT_FOUND', async () => {
    h = await start();
    const [leader, officer, member, outsider] = await users(h.server, 4);
    const guild_id = await create_guild(leader, 'DelGuild');
    await join_guild(officer, guild_id);
    await join_guild(member, guild_id);
    await set_role(leader, officer, Role.GUILD_ROLE_OFFICER);
    for (const text of ['one', 'two']) await sent(send_chat(member, K.CHAT_CHANNEL_KIND_GUILD, 0n, text));
    expect((await delete_guild_chat(member, 1n)).code).toBe(E.CORE_ERROR_GUILD_PERMISSION);
    expect((await delete_guild_chat(outsider, 1n)).code).toBe(E.CORE_ERROR_GUILD_NOT_MEMBER);
    expect((await delete_guild_chat(officer, 1n)).code).toBe(0);
    expect((await delete_guild_chat(leader, 1n)).code).toBe(E.CORE_ERROR_CHAT_MESSAGE_NOT_FOUND);
    expect((await delete_guild_chat(leader, 9n)).code).toBe(E.CORE_ERROR_CHAT_MESSAGE_NOT_FOUND);
    expect((await delete_guild_chat(leader, 2n)).code).toBe(0);
    expect(seqs(await got(member, K.CHAT_CHANNEL_KIND_GUILD, 0n))).toEqual([]);
    expect((await admin_list(h.server, 'Guild', guild_id, 0n)).map((m) => [m.seq, m.deleted])).toEqual([
      ['1', true],
      ['2', true],
    ]);
  });

  it('delivers a seq deleted by delete_chat_message or DeleteGuildChatMessage once in deleted_seqs with last_delete_seq 1 higher, and none for after_seq 0', async () => {
    h = await start();
    const [leader, reader] = await users(h.server, 2);
    const guild_id = await create_guild(leader, 'SeqGuild');
    await join_guild(reader, guild_id);
    for (const text of ['one', 'two', 'three']) await sent(send_chat(leader, K.CHAT_CHANNEL_KIND_GUILD, 0n, text));
    const before = await got(reader, K.CHAT_CHANNEL_KIND_GUILD, 0n, { after_seq: 3n });
    expect([before.deleted_seqs, before.last_delete_seq]).toEqual([[], 0n]);

    expect((await delete_guild_chat(leader, 2n)).code).toBe(0);
    const first = await got(reader, K.CHAT_CHANNEL_KIND_GUILD, 0n, { after_seq: 3n, after_delete_seq: 0n });
    expect([first.deleted_seqs, first.last_delete_seq]).toEqual([[2n], 1n]);

    const body = { channel_kind: 'Guild', key_a: String(guild_id), key_b: '0', seq: '1' };
    expect((await admin(h.server, 'delete_chat_message', body)).status).toBe(200);
    expect((await admin(h.server, 'delete_chat_message', body)).status).toBe(200);
    const second = await got(reader, K.CHAT_CHANNEL_KIND_GUILD, 0n, { after_seq: 3n, after_delete_seq: 1n });
    expect([second.deleted_seqs, second.last_delete_seq]).toEqual([[1n], 2n]);
    const none = await got(reader, K.CHAT_CHANNEL_KIND_GUILD, 0n, { after_seq: 3n, after_delete_seq: 2n });
    expect([none.deleted_seqs, none.last_delete_seq]).toEqual([[], 2n]);

    const latest = await got(reader, K.CHAT_CHANNEL_KIND_GUILD, 0n);
    expect([latest.deleted_seqs, latest.last_delete_seq, seqs(latest)]).toEqual([[], 2n, [3n]]);
  });

  it('makes a send that waits on a kick of its sender GUILD_NOT_MEMBER with no message row, as the guild row is locked before the channel row', async () => {
    h = await start();
    const [leader, member] = await users(h.server, 2);
    const guild_id = await create_guild(leader, 'KickGuild');
    await join_guild(member, guild_id);
    // Another server instance's KickGuildMember: it locks the guild row and the member row and deletes the member row.
    // While the send waits, it takes the channel row lock, which a send holding that lock before the guild row would deadlock.
    const kicking = await other_tx(h, [
      ['guild_guild', [guild_id]],
      ['guild_member', [member.user_id]],
    ]);
    await kicking.run('DELETE FROM guild_member WHERE user_id = $1', [member.user_id]);
    await kicking.run('UPDATE guild_guild SET member_count = member_count - 1 WHERE guild_id = $1', [guild_id]);
    const channel_locked = kicking.lock_after(HOLD_MS, 'chat_channel', [K.CHAT_CHANNEL_KIND_GUILD, guild_id, 0n]);
    const committed = kicking.commit_after(0);
    const started = Date.now();
    const raced = await send_chat(member, K.CHAT_CHANNEL_KIND_GUILD, 0n, 'race');
    expect(Date.now() - started).toBeGreaterThanOrEqual(HOLD_MS - 50);
    expect([await channel_locked, await committed]).toEqual([true, true]);
    expect(raced.code).toBe(E.CORE_ERROR_GUILD_NOT_MEMBER);
    expect(await admin_list(h.server, 'Guild', guild_id, 0n)).toEqual([]);
    expect(rows(h.core(), 'SELECT seq FROM chat_message WHERE sender_id = $1', [member.user_id])).toEqual([]);
  });

  it('ends a send, a post_system_message and a DeleteGuildChatMessage of one guild that come together while on_chat_message_sent locks that guild', async () => {
    h = await start();
    const [leader, member] = await users(h.server, 2);
    const guild_id = await create_guild(leader, 'LockGuild');
    await join_guild(member, guild_id);
    await sent(send_chat(member, K.CHAT_CHANNEL_KIND_GUILD, 0n, 'to delete'));
    h.hooks.sent = (ctx) => {
      expect(h.core().guild?.lock_guild(ctx, guild_id)).not.toBe('FAILED');
    };
    const [sent_result, deleted, posted] = await Promise.all([
      send_chat(member, K.CHAT_CHANNEL_KIND_GUILD, 0n, 'with hook'),
      delete_guild_chat(leader, 1n),
      post_system(h, leader, K.CHAT_CHANNEL_KIND_GUILD, guild_id, 'system'),
    ]);
    expect([sent_result.code, deleted.code]).toEqual([0, 0]);
    expect(posted?.message_kind).toBe(CoreContract.ChatMessageKind.CHAT_MESSAGE_KIND_SYSTEM);
    const channel = rows(h.core(), 'SELECT last_seq, last_delete_seq FROM chat_channel WHERE kind = $1 AND key_a = $2 AND key_b = $3', [K.CHAT_CHANNEL_KIND_GUILD, guild_id, 0n]);
    expect(channel).toEqual([{ last_seq: 3n, last_delete_seq: 1n }]);
  });
});
