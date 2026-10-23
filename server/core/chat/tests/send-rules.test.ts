/** Send rules: banned words and plain text, send interval, mute, room invites, the two hooks and system messages. */
import * as CoreContract from '../../../generated/contract/core_contract.ts';
import * as GameContract from '../../../generated/contract/game_contract.ts';
import { stop_test_server } from '../../testing/dev/index.ts';
import {
  admin,
  admin_list,
  create_guild,
  E,
  field,
  got,
  id_value,
  post_system,
  K,
  later,
  logs,
  make_friends,
  MK,
  report_chat,
  rows,
  send_chat,
  sent,
  start,
  START_AT,
  users,
  type Harness,
} from './helpers.ts';

let h: Harness;

afterEach(async () => {
  await stop_test_server(h.server);
});

function last_sent_at(user_id: bigint): unknown {
  return rows(h.core(), 'SELECT last_sent_at FROM chat_sender WHERE user_id = $1', [user_id])[0]?.['last_sent_at'] ?? null;
}

async function texts(kind: 'World' | 'Guild' | 'Direct', key_a: bigint, key_b: bigint): Promise<string[]> {
  return (await admin_list(h.server, kind, key_a, key_b)).map((m) => m.text);
}

describe('text', () => {
  it('refuses a text with a banned word with TEXT_BANNED and an info log of the banned_word ID value, and a text with a line break with TEXT_INVALID, writing no message row', async () => {
    h = await start();
    const [a] = await users(h.server, 1);
    expect((await send_chat(a, K.CHAT_CHANNEL_KIND_WORLD, 1n, 'this has a badword in it')).code).toBe(E.CORE_ERROR_TEXT_BANNED);
    const line = logs(h.server, 'core', 'info').find((l) => field(l, 'banned_word_id') !== undefined) ?? {};
    expect(field(line, 'banned_word_id')).toBe(id_value('[banned_en_1]'));
    expect((await send_chat(a, K.CHAT_CHANNEL_KIND_WORLD, 1n, 'two\nlines')).code).toBe(E.CORE_ERROR_TEXT_INVALID);
    expect(await texts('World', 1n, 0n)).toEqual([]);
    expect(last_sent_at(a.user_id)).toBeNull();
  });

  it('refuses a room code of the wrong length or alphabet and any RoomInvite on a World channel with INVALID_REQUEST, and a System or unspecified message kind', async () => {
    h = await start({ settings: { 'matchmaker.roomCodeLength': 4, 'matchmaker.roomCodeAlphabet': 'ABCD' } });
    const [a, b] = await users(h.server, 2);
    await make_friends(a, b);
    const invite = async (key: bigint, text: string, kind: number = K.CHAT_CHANNEL_KIND_DIRECT): Promise<number> =>
      (await send_chat(a, kind, key, text, MK.CHAT_MESSAGE_KIND_ROOM_INVITE)).code;
    expect(await invite(b.user_id, 'ABC')).toBe(E.CORE_ERROR_INVALID_REQUEST);
    expect(await invite(b.user_id, 'ABCDA')).toBe(E.CORE_ERROR_INVALID_REQUEST);
    expect(await invite(b.user_id, 'ABCE')).toBe(E.CORE_ERROR_INVALID_REQUEST);
    expect(await invite(1n, 'ABCD', K.CHAT_CHANNEL_KIND_WORLD)).toBe(E.CORE_ERROR_INVALID_REQUEST);
    expect(await invite(b.user_id, 'DCBA')).toBe(0);
    await create_guild(a, 'InviteGuild');
    expect(await invite(0n, 'AAAA', K.CHAT_CHANNEL_KIND_GUILD)).toBe(0);
    expect((await send_chat(a, K.CHAT_CHANNEL_KIND_WORLD, 1n, 'x', MK.CHAT_MESSAGE_KIND_SYSTEM)).code).toBe(E.CORE_ERROR_INVALID_REQUEST);
    expect((await send_chat(a, K.CHAT_CHANNEL_KIND_WORLD, 1n, 'x', MK.CHAT_MESSAGE_KIND_UNSPECIFIED)).code).toBe(E.CORE_ERROR_INVALID_REQUEST);
    const direct = await got(b, K.CHAT_CHANNEL_KIND_DIRECT, a.user_id);
    expect(direct.messages.map((m) => [m.message_kind, m.text])).toEqual([[MK.CHAT_MESSAGE_KIND_ROOM_INVITE, 'DCBA']]);
  });
});

describe('interval and mute', () => {
  it('refuses a second send within chat.minIntervalMs with CHAT_TOO_FAST and takes it at the interval', async () => {
    h = await start({ settings: { 'chat.minIntervalMs': 1000 } });
    const [a] = await users(h.server, 1);
    await sent(send_chat(a, K.CHAT_CHANNEL_KIND_WORLD, 1n, 'one'));
    expect((await send_chat(a, K.CHAT_CHANNEL_KIND_WORLD, 1n, 'two')).code).toBe(E.CORE_ERROR_CHAT_TOO_FAST);
    later(h.server, 999n);
    expect((await send_chat(a, K.CHAT_CHANNEL_KIND_WORLD, 1n, 'three')).code).toBe(E.CORE_ERROR_CHAT_TOO_FAST);
    later(h.server, 1n);
    await sent(send_chat(a, K.CHAT_CHANNEL_KIND_WORLD, 1n, 'four'));
    expect(await texts('World', 1n, 0n)).toEqual(['one', 'four']);
  });

  it('refuses a send after mute_chat_user with CHAT_MUTED, and takes it once until_at is reached or after unmute_chat_user', async () => {
    h = await start();
    const [a] = await users(h.server, 1);
    const mute = async (until_at: bigint): Promise<number> => (await admin(h.server, 'mute_chat_user', { user_id: String(a.user_id), until_at: String(until_at), reason: 'spam' })).status;
    const unmute = async (): Promise<number> => (await admin(h.server, 'unmute_chat_user', { user_id: String(a.user_id) })).status;
    expect(await mute(START_AT + 600_000n)).toBe(200);
    expect((await send_chat(a, K.CHAT_CHANNEL_KIND_WORLD, 1n, 'muted')).code).toBe(E.CORE_ERROR_CHAT_MUTED);
    later(h.server, 599_999n);
    expect((await send_chat(a, K.CHAT_CHANNEL_KIND_WORLD, 1n, 'muted')).code).toBe(E.CORE_ERROR_CHAT_MUTED);
    later(h.server, 1n);
    await sent(send_chat(a, K.CHAT_CHANNEL_KIND_WORLD, 1n, 'after until_at'));
    expect(await mute(0n)).toBe(200);
    later(h.server, 900_000n);
    expect((await send_chat(a, K.CHAT_CHANNEL_KIND_WORLD, 1n, 'muted')).code).toBe(E.CORE_ERROR_CHAT_MUTED);
    expect(await unmute()).toBe(200);
    await sent(send_chat(a, K.CHAT_CHANNEL_KIND_WORLD, 1n, 'after unmute'));
    expect(await unmute()).toBe(200);
    expect(await texts('World', 1n, 0n)).toEqual(['after until_at', 'after unmute']);
  });

  it('refuses mute_chat_user with until_at below 0 with bad_request, writing no mute row, and the user still sends', async () => {
    h = await start();
    const [a] = await users(h.server, 1);
    const result = await admin(h.server, 'mute_chat_user', { user_id: String(a.user_id), until_at: '-1', reason: 'bad' });
    expect([result.status, result.json]).toEqual([400, { error: 'bad_request' }]);
    expect(rows(h.core(), 'SELECT user_id FROM chat_mute WHERE user_id = $1', [a.user_id])).toEqual([]);
    await sent(send_chat(a, K.CHAT_CHANNEL_KIND_WORLD, 1n, 'still sends'));
  });
});

describe('hooks', () => {
  it('ends with the GameError of validate_chat_send with no message row and last_sent_at kept, and calls on_chat_message_sent once with the sent message', async () => {
    h = await start();
    const [a] = await users(h.server, 1);
    const seen: unknown[][] = [];
    h.hooks.validate = (_ctx, kind, id, message_kind, text) => {
      seen.push([kind, id, message_kind, text]);
      return text === 'reject' ? GameContract.GameError.GAME_ERROR_CORE_TEST : 'pass';
    };
    const delivered: CoreContract.ChatMessage[] = [];
    h.hooks.sent = (_ctx, message) => {
      delivered.push(message);
    };
    await sent(send_chat(a, K.CHAT_CHANNEL_KIND_WORLD, 2n, 'first'));
    const before = last_sent_at(a.user_id);
    later(h.server, 5_000n);
    expect((await send_chat(a, K.CHAT_CHANNEL_KIND_WORLD, 2n, 'reject')).code).toBe(GameContract.GameError.GAME_ERROR_CORE_TEST);
    expect(last_sent_at(a.user_id)).toBe(before);
    expect(await texts('World', 2n, 0n)).toEqual(['first']);
    expect(seen).toEqual([
      [K.CHAT_CHANNEL_KIND_WORLD, 2n, MK.CHAT_MESSAGE_KIND_TEXT, 'first'],
      [K.CHAT_CHANNEL_KIND_WORLD, 2n, MK.CHAT_MESSAGE_KIND_TEXT, 'reject'],
    ]);
    expect(delivered.map((m) => [m.seq, m.text, m.sender_id, m.channel_key])).toEqual([[1n, 'first', a.user_id, 2n]]);
  });

  it('judges the validate_chat_send output with storage.check_hook_output: a safe integer of 1000 and up outside GameError reaches routing as that GameError, and a wrong output form throws, both INTERNAL with no message row', async () => {
    h = await start();
    const [a] = await users(h.server, 1);
    let output: unknown = 1500;
    h.hooks.validate = () => output;
    /** The new `error` log lines of one SendChatMessage that must end with INTERNAL. */
    const internal_errors = async (): Promise<string[]> => {
      const errors_before = logs(h.server, 'error', 'error').length;
      expect((await send_chat(a, K.CHAT_CHANNEL_KIND_WORLD, 1n, 'x')).code).toBe(E.CORE_ERROR_INTERNAL);
      return logs(h.server, 'error', 'error')
        .slice(errors_before)
        .map((line) => JSON.stringify(line, (_, v: unknown) => (typeof v === 'bigint' ? String(v) : v)));
    };
    // routing's step 15: chat returned 1500 as the hook's GameError, outside the core_errors of SendChatMessage.
    expect((await internal_errors()).some((line) => line.includes('GameError 1500') && line.includes('core_errors'))).toBe(true);
    for (const value of [999, 0, 1000.5, 'refused', null, {}]) {
      output = value;
      expect((await internal_errors()).some((line) => line.includes('hook validate_chat_send returned') && line.includes('not pass or a GameError'))).toBe(true);
    }
    expect(await texts('World', 1n, 0n)).toEqual([]);
    expect(last_sent_at(a.user_id)).toBeNull();
    output = 'pass';
    await sent(send_chat(a, K.CHAT_CHANNEL_KIND_WORLD, 1n, 'x'));
  });
});

describe('post_system_message', () => {
  it('writes a System message with sender_id 0 at the next seq, also in the ctx of a muted user, and fails with an error log and no row for Direct, an out-of-range World channel, a missing guild, an empty text and a text over chat.maxSystemTextBytes', async () => {
    h = await start({ settings: { 'chat.maxSystemTextBytes': 8, 'chat.worldChannelCount': 2 } });
    const [a, b] = await users(h.server, 2);
    await sent(send_chat(b, K.CHAT_CHANNEL_KIND_WORLD, 1n, 'before'));
    expect((await admin(h.server, 'mute_chat_user', { user_id: String(a.user_id), until_at: '0', reason: 'muted' })).status).toBe(200);
    const post = (kind: number, id: bigint, text: string): Promise<CoreContract.ChatMessage | null> => post_system(h, a, kind, id, text);
    const written = await post(K.CHAT_CHANNEL_KIND_WORLD, 1n, '{"k":1}');
    expect(written === null ? null : [written.seq, written.sender_id, written.message_kind, written.channel_key, written.sender_nickname]).toEqual([
      2n,
      0n,
      MK.CHAT_MESSAGE_KIND_SYSTEM,
      1n,
      '',
    ]);
    const errors_before = logs(h.server, 'error', 'error').length;
    expect(await post(K.CHAT_CHANNEL_KIND_DIRECT, b.user_id, 'x')).toBeNull();
    expect(await post(K.CHAT_CHANNEL_KIND_WORLD, 3n, 'x')).toBeNull();
    expect(await post(K.CHAT_CHANNEL_KIND_GUILD, 999n, 'x')).toBeNull();
    expect(await post(K.CHAT_CHANNEL_KIND_WORLD, 1n, '')).toBeNull();
    expect(await post(K.CHAT_CHANNEL_KIND_WORLD, 1n, '123456789')).toBeNull();
    expect(logs(h.server, 'error', 'error').length - errors_before).toBe(5);
    expect((await admin_list(h.server, 'World', 1n, 0n)).map((m) => [m.seq, m.sender_id, m.message_kind])).toEqual([
      ['1', String(b.user_id), 'CHAT_MESSAGE_KIND_TEXT'],
      ['2', '0', 'CHAT_MESSAGE_KIND_SYSTEM'],
    ]);
    expect(rows(h.core(), 'SELECT seq FROM chat_message WHERE kind <> $1', [K.CHAT_CHANNEL_KIND_WORLD])).toEqual([]);
  });

  it('refuses SendChatMessage of a System message and ReportChatMessage of a System message with INVALID_REQUEST', async () => {
    h = await start();
    const [a] = await users(h.server, 1);
    expect((await send_chat(a, K.CHAT_CHANNEL_KIND_WORLD, 1n, 'fake', MK.CHAT_MESSAGE_KIND_SYSTEM)).code).toBe(E.CORE_ERROR_INVALID_REQUEST);
    await post_system(h, a, K.CHAT_CHANNEL_KIND_WORLD, 1n, 'system');
    expect((await report_chat(a, K.CHAT_CHANNEL_KIND_WORLD, 1n, 1n)).code).toBe(E.CORE_ERROR_INVALID_REQUEST);
  });
});
