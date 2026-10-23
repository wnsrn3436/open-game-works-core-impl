/** A server module list without `guild` or without `friend`: those channels are refused and `World` still works. */
import { stop_test_server } from '../../testing/dev/index.ts';
import { channels, delete_guild_chat, E, field, get_chat, got, post_system, K, logs, report_chat, send_chat, sent, seqs, start, users, without, type Harness } from './helpers.ts';

let h: Harness;

afterEach(async () => {
  await stop_test_server(h.server);
});

describe('optional dependencies', () => {
  it('without guild: Guild channel send, receive, report and DeleteGuildChatMessage are INVALID_REQUEST, GetChatChannels has no guild entry, a Guild post_system_message is none with an error log, and World works', async () => {
    // Without `ranking` too: the core test data has guild boards, and `ranking` does not start with them and no `guild`.
    // Without `rating` too: it depends on `ranking`. Without `matchmaker` too: the core test data has match_mode rows with a rating_rule, and `matchmaker` does not start with them and no `rating`.
    h = await start({ modules: without('guild', 'ranking', 'rating', 'matchmaker') });
    expect(h.core().guild).toBeUndefined();
    const [a] = await users(h.server, 1);
    expect((await send_chat(a, K.CHAT_CHANNEL_KIND_GUILD, 0n, 'x')).code).toBe(E.CORE_ERROR_INVALID_REQUEST);
    expect((await get_chat(a, K.CHAT_CHANNEL_KIND_GUILD, 0n)).code).toBe(E.CORE_ERROR_INVALID_REQUEST);
    expect((await report_chat(a, K.CHAT_CHANNEL_KIND_GUILD, 0n, 1n)).code).toBe(E.CORE_ERROR_INVALID_REQUEST);
    expect((await delete_guild_chat(a, 1n)).code).toBe(E.CORE_ERROR_INVALID_REQUEST);
    expect((await channels(a)).filter((c) => c.channel_kind === K.CHAT_CHANNEL_KIND_GUILD)).toEqual([]);
    const errors_before = logs(h.server, 'error', 'error').length;
    expect(await post_system(h, a, K.CHAT_CHANNEL_KIND_GUILD, 1n, 'x')).toBeNull();
    const errors = logs(h.server, 'error', 'error').slice(errors_before);
    expect(errors.map((line) => field(line, 'channel_kind'))).toEqual([K.CHAT_CHANNEL_KIND_GUILD]);
    await sent(send_chat(a, K.CHAT_CHANNEL_KIND_WORLD, 1n, 'world'));
    expect(seqs(await got(a, K.CHAT_CHANNEL_KIND_WORLD, 1n))).toEqual([1n]);
  });

  it('without friend: Direct channel send, receive and report are INVALID_REQUEST, GetChatChannels has no Direct entry, and World works', async () => {
    h = await start({ modules: without('friend') });
    expect(h.core().friend).toBeUndefined();
    const [a, b] = await users(h.server, 2);
    expect((await send_chat(a, K.CHAT_CHANNEL_KIND_DIRECT, b.user_id, 'x')).code).toBe(E.CORE_ERROR_INVALID_REQUEST);
    expect((await get_chat(a, K.CHAT_CHANNEL_KIND_DIRECT, b.user_id)).code).toBe(E.CORE_ERROR_INVALID_REQUEST);
    expect((await report_chat(a, K.CHAT_CHANNEL_KIND_DIRECT, b.user_id, 1n)).code).toBe(E.CORE_ERROR_INVALID_REQUEST);
    expect((await channels(a)).filter((c) => c.channel_kind === K.CHAT_CHANNEL_KIND_DIRECT)).toEqual([]);
    await sent(send_chat(a, K.CHAT_CHANNEL_KIND_WORLD, 1n, 'world'));
    expect(seqs(await got(b, K.CHAT_CHANNEL_KIND_WORLD, 1n))).toEqual([1n]);
  });
});
