/** World channel send and receive, picking by `after_seq` and `before_seq`, sender nicknames, concurrent sends. */
import * as CoreContract from '../../../generated/contract/core_contract.ts';
import { stop_test_server } from '../../testing/dev/index.ts';
import { admin, E, get_chat, got, post_system, K, send_chat, sent, seqs, set_nickname, start, users, type Harness } from './helpers.ts';

let h: Harness;

afterEach(async () => {
  await stop_test_server(h.server);
});

describe('World channel', () => {
  it('returns the messages sent to a World channel in seq ascending order with last_seq at the largest seq', async () => {
    h = await start();
    const [a, b] = await users(h.server, 2);
    const first = await sent(send_chat(a, K.CHAT_CHANNEL_KIND_WORLD, 1n, 'one'));
    const second = await sent(send_chat(b, K.CHAT_CHANNEL_KIND_WORLD, 1n, 'two'));
    const third = await sent(send_chat(a, K.CHAT_CHANNEL_KIND_WORLD, 1n, 'three'));
    expect([first.seq, second.seq, third.seq]).toEqual([1n, 2n, 3n]);
    const response = await got(b, K.CHAT_CHANNEL_KIND_WORLD, 1n);
    expect(seqs(response)).toEqual([1n, 2n, 3n]);
    expect(response.messages.map((m) => [m.text, m.sender_id])).toEqual([
      ['one', a.user_id],
      ['two', b.user_id],
      ['three', a.user_id],
    ]);
    expect([response.last_seq, response.channel_key, response.poll_after_ms]).toEqual([3n, 1n, 3000n]);
    expect(seqs(await got(b, K.CHAT_CHANNEL_KIND_WORLD, 2n))).toEqual([]);
  });

  it('gives the sender nickname of now: a SetNickname or rename_user after the send shows the new nickname, and a System message has an empty one', async () => {
    h = await start();
    const [a, b, c] = await users(h.server, 3);
    expect((await sent(send_chat(a, K.CHAT_CHANNEL_KIND_WORLD, 1n, 'before'))).sender_nickname).toBe('');
    await set_nickname(a, 'First');
    await sent(send_chat(c, K.CHAT_CHANNEL_KIND_WORLD, 1n, 'hello'));
    expect((await got(b, K.CHAT_CHANNEL_KIND_WORLD, 1n)).messages.map((m) => m.sender_nickname)).toEqual(['First', '']);
    const renamed = await admin(h.server, 'rename_user', { operation_id: 'rename-1', user_id: String(a.user_id), nickname: 'Second', reason: 'test' });
    expect(renamed.status).toBe(200);
    await post_system(h, b, K.CHAT_CHANNEL_KIND_WORLD, 1n, 'system');
    expect((await got(b, K.CHAT_CHANNEL_KIND_WORLD, 1n)).messages.map((m) => [m.sender_id, m.sender_nickname])).toEqual([
      [a.user_id, 'Second'],
      [c.user_id, ''],
      [0n, ''],
    ]);
  });

  it('gives the latest chat.maxFetchCount messages for after_seq 0 and only seqs above n for after_seq n', async () => {
    h = await start({ settings: { 'chat.maxFetchCount': 3 } });
    const [a] = await users(h.server, 1);
    for (let i = 1; i <= 5; i += 1) await sent(send_chat(a, K.CHAT_CHANNEL_KIND_WORLD, 1n, `m${String(i)}`));
    const latest = await got(a, K.CHAT_CHANNEL_KIND_WORLD, 1n);
    expect([seqs(latest), latest.last_seq]).toEqual([[3n, 4n, 5n], 5n]);
    const after = await got(a, K.CHAT_CHANNEL_KIND_WORLD, 1n, { after_seq: 1n });
    expect([seqs(after), after.last_seq]).toEqual([[2n, 3n, 4n], 4n]);
    const none = await got(a, K.CHAT_CHANNEL_KIND_WORLD, 1n, { after_seq: 5n });
    expect([seqs(none), none.last_seq]).toEqual([[], 5n]);
  });

  it('gives up to chat.maxFetchCount seqs below n for before_seq n in ascending order with first_seq at the smallest, and refuses after_seq with before_seq', async () => {
    h = await start({ settings: { 'chat.maxFetchCount': 2 } });
    const [a] = await users(h.server, 1);
    for (let i = 1; i <= 5; i += 1) await sent(send_chat(a, K.CHAT_CHANNEL_KIND_WORLD, 1n, `m${String(i)}`));
    const before = await got(a, K.CHAT_CHANNEL_KIND_WORLD, 1n, { before_seq: 4n });
    expect([seqs(before), before.first_seq]).toEqual([[2n, 3n], 2n]);
    const empty = await got(a, K.CHAT_CHANNEL_KIND_WORLD, 1n, { before_seq: 1n });
    expect([seqs(empty), empty.first_seq]).toEqual([[], 0n]);
    expect((await get_chat(a, K.CHAT_CHANNEL_KIND_WORLD, 1n, { after_seq: 1n, before_seq: 4n })).code).toBe(E.CORE_ERROR_INVALID_REQUEST);
  });

  it('refuses a channel number outside chat.worldChannelCount and a nonzero Guild channel_key with INVALID_REQUEST', async () => {
    h = await start({ settings: { 'chat.worldChannelCount': 2 } });
    const [a] = await users(h.server, 1);
    for (const key of [0n, 3n]) {
      expect((await send_chat(a, K.CHAT_CHANNEL_KIND_WORLD, key, 'x')).code).toBe(E.CORE_ERROR_INVALID_REQUEST);
      expect((await get_chat(a, K.CHAT_CHANNEL_KIND_WORLD, key)).code).toBe(E.CORE_ERROR_INVALID_REQUEST);
    }
    await sent(send_chat(a, K.CHAT_CHANNEL_KIND_WORLD, 2n, 'x'));
    expect((await send_chat(a, K.CHAT_CHANNEL_KIND_GUILD, 5n, 'x')).code).toBe(E.CORE_ERROR_INVALID_REQUEST);
    expect((await get_chat(a, K.CHAT_CHANNEL_KIND_GUILD, 5n)).code).toBe(E.CORE_ERROR_INVALID_REQUEST);
    expect((await send_chat(a, CoreContract.ChatChannelKind.CHAT_CHANNEL_KIND_UNSPECIFIED, 1n, 'x')).code).toBe(E.CORE_ERROR_INVALID_REQUEST);
  });

  it('gives distinct seqs to two users who send to the same channel at once', async () => {
    h = await start();
    const sessions = await users(h.server, 6);
    const messages = await Promise.all(sessions.map((s, i) => sent(send_chat(s, K.CHAT_CHANNEL_KIND_WORLD, 1n, `m${String(i)}`))));
    expect(messages.map((m) => m.seq).sort((x, y) => (x < y ? -1 : 1))).toEqual([1n, 2n, 3n, 4n, 5n, 6n]);
    expect(seqs(await got(sessions[0], K.CHAT_CHANNEL_KIND_WORLD, 1n))).toEqual([1n, 2n, 3n, 4n, 5n, 6n]);
  });
});
