/** `chat.allowChild`: a child user's chat core `rpc`s are `CHILD_RESTRICTED` unless it is `true`. */
import * as CoreContract from '../../../generated/contract/core_contract.ts';
import { stop_test_server, type TestSession } from '../../testing/dev/index.ts';
import {
  admin,
  admin_list,
  core_test,
  create_guild,
  delete_guild_chat,
  E,
  get_channels,
  get_chat,
  join_guild,
  K,
  ok,
  post_system,
  report_chat,
  rpc,
  send_chat,
  sent,
  start,
  START_AT,
  users,
  type Harness,
} from './helpers.ts';

let h: Harness;

/** The `kind` column value of `ConsentUserState` rows. */
const CONSENT_COLUMN = CoreContract.KINDS.find((kind) => kind.name === 'ConsentUserState')?.column ?? '';

afterEach(async () => {
  await stop_test_server(h.server);
});

/** `ConfirmAge` of a user born in January 2016: age 10 on `START_AT`, a child in the core test data age bands. */
async function confirm_child(session: TestSession): Promise<void> {
  const request = new CoreContract.ConfirmAgeRequest();
  request.birth_year_month = 201601;
  expect(ok(await rpc<CoreContract.ConfirmAgeResponse>(session, 'core/ConfirmAge', request)).consent?.child).toBe(true);
}

async function open_reports(): Promise<unknown[]> {
  const listed = await admin(h.server, 'list_reports', { status: 'Open', from_at: String(START_AT - 3_600_000n), to_at: String(START_AT + 3_600_000n), limit: 100 });
  expect(listed.status).toBe(200);
  return (listed.json as { reports: unknown[] }).reports;
}

/** A child who leads a guild with one message by an adult member, and the codes of the five chat core `rpc`s of the child. */
async function child_codes(): Promise<{ child: TestSession; guild_id: bigint; codes: number[] }> {
  const [child, adult] = await users(h.server, 2);
  const guild_id = await create_guild(child, 'ChildGuild');
  await join_guild(adult, guild_id);
  await sent(send_chat(adult, K.CHAT_CHANNEL_KIND_GUILD, 0n, 'adult message'));
  await confirm_child(child);
  const codes = [
    (await get_channels(child)).code,
    (await get_chat(child, K.CHAT_CHANNEL_KIND_GUILD, 0n)).code,
    (await send_chat(child, K.CHAT_CHANNEL_KIND_WORLD, 1n, 'child message')).code,
    (await report_chat(child, K.CHAT_CHANNEL_KIND_GUILD, 0n, 1n)).code,
    (await delete_guild_chat(child, 1n)).code,
  ];
  return { child, guild_id, codes };
}

describe('chat.allowChild', () => {
  it('refuses GetChatChannels, GetChatMessages, SendChatMessage, ReportChatMessage and DeleteGuildChatMessage of a child with CHILD_RESTRICTED and makes no message, report or deletion, while post_system_message in the child ctx writes', async () => {
    h = await start({ settings: { 'chat.allowChild': false } });
    const { child, guild_id, codes } = await child_codes();
    expect(codes).toEqual(Array.from({ length: 5 }, () => E.CORE_ERROR_CHILD_RESTRICTED));
    expect(await admin_list(h.server, 'World', 1n, 0n)).toEqual([]);
    expect((await admin_list(h.server, 'Guild', guild_id, 0n)).map((m) => m.deleted)).toEqual([false]);
    expect(await open_reports()).toEqual([]);
    const written = await post_system(h, child, K.CHAT_CHANNEL_KIND_WORLD, 1n, 'system');
    expect(written?.seq).toBe(1n);
    expect(await admin_list(h.server, 'World', 1n, 0n)).toHaveLength(1);
  });

  it('processes the chat core rpcs of a child when chat.allowChild is true', async () => {
    h = await start({ settings: { 'chat.allowChild': true } });
    const { guild_id, codes } = await child_codes();
    expect(codes).toEqual([0, 0, 0, 0, 0]);
    expect(await admin_list(h.server, 'World', 1n, 0n)).toHaveLength(1);
    expect((await admin_list(h.server, 'Guild', guild_id, 0n)).map((m) => m.deleted)).toEqual([true]);
    expect(await open_reports()).toHaveLength(1);
  });

  it('processes a user who has no ConsentUserState row', async () => {
    h = await start({ settings: { 'chat.allowChild': false } });
    const [child] = await users(h.server, 1);
    await confirm_child(child);
    const result = await core_test(h, child, (ctx) => {
      const { storage, chat } = h.core();
      // The test removes the row with a raw delete through the storage module object.
      storage.db(ctx).query('DELETE FROM user_state WHERE user_id = $1 AND kind = $2', [ctx.user_id, CONSENT_COLUMN]);
      const get = new CoreContract.GetChatMessagesRequest();
      get.channel_kind = K.CHAT_CHANNEL_KIND_WORLD;
      get.channel_key = 1n;
      const message = new CoreContract.SendChatMessageRequest();
      message.channel_kind = K.CHAT_CHANNEL_KIND_WORLD;
      message.channel_key = 1n;
      message.message_kind = CoreContract.ChatMessageKind.CHAT_MESSAGE_KIND_TEXT;
      message.text = 'no consent row';
      return [
        storage.get_state(ctx, CoreContract.ConsentUserState, 0n),
        chat.GetChatChannels(ctx, new CoreContract.GetChatChannelsRequest()) instanceof CoreContract.GetChatChannelsResponse,
        chat.GetChatMessages(ctx, get) instanceof CoreContract.GetChatMessagesResponse,
        chat.SendChatMessage(ctx, message) instanceof CoreContract.SendChatMessageResponse,
      ];
    });
    expect(result).toEqual({ code: 0, value: [null, true, true, true] });
    expect((await admin_list(h.server, 'World', 1n, 0n)).map((m) => m.text)).toEqual(['no consent row']);
  });
});
