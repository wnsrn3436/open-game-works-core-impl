/**
 * `chat`: world, guild and direct channel text chat stored per channel and read by polling, earlier messages, the
 * channel list, system messages, banned words, hidden messages of blocked users, send interval, mute, message
 * reports, deleted message delivery and guild `Leader` and `Officer` message deletion.
 */
import * as CoreContract from '../../generated/contract/core_contract.ts';
import * as GameContract from '../../generated/contract/game_contract.ts';
import type { LogFields } from '../logging/index.ts';
import type { DbHandle, RequestCtx } from '../storage/index.ts';
import { TextCheckResult } from '../validation/index.ts';
import { admin_operations, type ChatAdminOperations } from './admin.ts';
import { read_modules, type ChatModules, type GuildMember } from './deps.ts';
import { read_settings, type ChatSettings } from './settings.ts';
import * as T from './tables.ts';

export type { ChatSettings } from './settings.ts';

const E = CoreContract.CoreError;
const K = CoreContract.ChatChannelKind;
const M = CoreContract.ChatMessageKind;
const Role = CoreContract.GuildRole;

/** A failure code a core `rpc` handler returns: a `CoreError` or a hook's `GameError`. */
export type FailureCode = CoreContract.CoreError | GameContract.GameError;

/** `validate_chat_send`: `'pass'` or a `GameError`. */
export type ValidateChatSend = (
  ctx: RequestCtx,
  channel_kind: CoreContract.ChatChannelKind,
  channel_id: bigint,
  message_kind: CoreContract.ChatMessageKind,
  text: string,
) => 'pass' | GameContract.GameError;

/** `on_chat_message_sent`: the after hook of `SendChatMessage`. */
export type OnChatMessageSent = (ctx: RequestCtx, message: CoreContract.ChatMessage) => void;

/** The hook slots (`routing` `## API`): null until routing puts the registered hook in. */
export interface ChatHookSlots {
  validate_chat_send: ValidateChatSend | null;
  on_chat_message_sent: OnChatMessageSent | null;
}

/** The `chat` module object: the `## API` operations, the hook slots, the admin operations and the lifecycle. */
export interface ChatModule extends ChatAdminOperations {
  SendChatMessage(ctx: RequestCtx, request: CoreContract.SendChatMessageRequest): CoreContract.SendChatMessageResponse | FailureCode;
  GetChatMessages(ctx: RequestCtx, request: CoreContract.GetChatMessagesRequest): CoreContract.GetChatMessagesResponse | CoreContract.CoreError;
  ReportChatMessage(ctx: RequestCtx, request: CoreContract.ReportChatMessageRequest): CoreContract.ReportChatMessageResponse | CoreContract.CoreError;
  GetChatChannels(ctx: RequestCtx, request: CoreContract.GetChatChannelsRequest): CoreContract.GetChatChannelsResponse | CoreContract.CoreError;
  DeleteGuildChatMessage(ctx: RequestCtx, request: CoreContract.DeleteGuildChatMessageRequest): CoreContract.DeleteGuildChatMessageResponse | CoreContract.CoreError;
  /** `auth` calls it at withdrawal. null, or `FAILED` on a lock wait timeout or a channel it did not lock. */
  remove_user(ctx: RequestCtx): null | 'FAILED';
  /** The written `System` message, or null (and an `error` log). A lock wait timeout throws. */
  post_system_message(ctx: RequestCtx, channel_kind: CoreContract.ChatChannelKind, channel_id: bigint, text: string): CoreContract.ChatMessage | null;
  readonly hook_slots: ChatHookSlots;
  begin_start(): void;
  complete_start(): string | null;
  stop(): void;
}

/** The module input (`server-core` `## module`). chat reads nothing of `server`. */
export interface ChatInput {
  readonly settings: Readonly<Record<string, unknown>>;
  readonly modules: Readonly<Record<string, unknown>>;
  readonly server?: unknown;
}

/** A channel decided for the requesting user: the stored key and the channel ID the user sees. */
interface Channel extends T.ChannelKey {
  readonly id: bigint;
}

function is_failure(value: unknown): value is FailureCode {
  return typeof value === 'number';
}

function min_big(a: bigint, b: bigint): bigint {
  return a < b ? a : b;
}

function max_big(a: bigint, b: bigint): bigint {
  return a > b ? a : b;
}

function chunks<V>(values: readonly V[], size: number): V[][] {
  const out: V[][] = [];
  for (let i = 0; i < values.length; i += size) out.push(values.slice(i, i + size));
  return out;
}

/** The parts of chat one server instance shares between its operations. */
class Chat {
  readonly hook_slots: ChatHookSlots = { validate_chat_send: null, on_chat_message_sent: null };

  readonly s: ChatSettings;
  readonly m: ChatModules;

  constructor(s: ChatSettings, m: ChatModules) {
    this.s = s;
    this.m = m;
  }

  db(ctx: RequestCtx): DbHandle {
    return this.m.storage.db(ctx);
  }

  now(ctx: RequestCtx): bigint {
    return this.m.server_time.now(ctx);
  }

  /** A `core` `info` log line (field `module`) or an `error` log line (field `stack_trace` null: not an exception). */
  log(ctx: RequestCtx, kind: 'core' | 'error', message: string, fields: LogFields): void {
    const extra: LogFields = kind === 'core' ? { module: 'chat' } : { stack_trace: null };
    this.m.logging.write({
      kind,
      level: kind === 'core' ? 'info' : 'error',
      message,
      user_id: ctx.user_id,
      request_id: ctx.request_id === '' ? null : ctx.request_id,
      request: ctx.request_name === '' ? null : ctx.request_name,
      fields: { ...extra, ...fields },
    });
  }

  /** The child check (`### channel`). */
  child_check(ctx: RequestCtx): CoreContract.CoreError | null {
    if (this.s.allow_child) return null;
    const consent = this.m.storage.get_state(ctx, CoreContract.ConsentUserState, 0n) as CoreContract.ConsentUserState | null;
    return consent !== null && consent.child ? E.CORE_ERROR_CHILD_RESTRICTED : null;
  }

  /** A `World` channel number: 1 to `chat.worldChannelCount`. */
  is_world_channel(channel_id: bigint): boolean {
    return channel_id >= 1n && channel_id <= BigInt(this.s.world_channel_count);
  }

  /** Channel decision (`### channel`): the channel, or the error. */
  channel(ctx: RequestCtx, kind: CoreContract.ChatChannelKind, channel_key: bigint): Channel | CoreContract.CoreError {
    switch (kind) {
      case K.CHAT_CHANNEL_KIND_WORLD:
        if (!this.is_world_channel(channel_key)) return E.CORE_ERROR_INVALID_REQUEST;
        return { kind, key_a: channel_key, key_b: 0n, id: channel_key };
      case K.CHAT_CHANNEL_KIND_GUILD: {
        if (this.m.guild === null || channel_key !== 0n) return E.CORE_ERROR_INVALID_REQUEST;
        const member = this.m.guild.get_member(ctx, ctx.user_id);
        if (member === null) return E.CORE_ERROR_GUILD_NOT_MEMBER;
        return { kind, key_a: member.guild_id, key_b: 0n, id: member.guild_id };
      }
      case K.CHAT_CHANNEL_KIND_DIRECT:
        if (this.m.friend === null || channel_key < 1n || channel_key === ctx.user_id) return E.CORE_ERROR_INVALID_REQUEST;
        return { kind, key_a: min_big(ctx.user_id, channel_key), key_b: max_big(ctx.user_id, channel_key), id: channel_key };
      default:
        return E.CORE_ERROR_INVALID_REQUEST;
    }
  }

  /** Child check and channel decision, the first step of every chat core `rpc`. */
  open(ctx: RequestCtx, kind: CoreContract.ChatChannelKind, channel_key: bigint): Channel | CoreContract.CoreError {
    return this.child_check(ctx) ?? this.channel(ctx, kind, channel_key);
  }

  /** `sender_nickname` of each sender: `nickname.get_nicknames` in parts of `nickname.maxLookupCount`. */
  nicknames(ctx: RequestCtx, sender_ids: readonly bigint[]): Map<bigint, string> {
    const ids = [...new Set(sender_ids.filter((id) => id !== 0n))].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    const out = new Map<bigint, string>();
    for (const part of chunks(ids, this.s.nickname_lookup_count)) {
      for (const entry of this.m.nickname.get_nicknames(ctx, part)) out.set(entry.user_id, entry.nickname);
    }
    return out;
  }

  message(row: T.MessageRow, channel_id: bigint, nicknames: ReadonlyMap<bigint, string>): CoreContract.ChatMessage {
    const message = new CoreContract.ChatMessage();
    message.channel_kind = row.kind;
    message.channel_key = channel_id;
    message.seq = row.seq;
    message.sender_id = row.sender_id;
    message.sender_nickname = row.sender_id === 0n ? '' : (nicknames.get(row.sender_id) ?? '');
    message.message_kind = row.message_kind;
    message.text = row.text;
    message.created_at = row.created_at;
    return message;
  }

  /** Locks the channel row (`storage.lock_game_row`). */
  lock_channel(ctx: RequestCtx, key: T.ChannelKey): 'FAILED' | undefined {
    return this.m.storage.lock_game_row(ctx, T.CHANNEL, T.channel_lock_key(key));
  }

  /** Writes the next message of a locked channel: `last_seq`, `last_at` and the message row. */
  append(ctx: RequestCtx, channel: Channel, sender_id: bigint, message_kind: CoreContract.ChatMessageKind, text: string): T.MessageRow {
    const db = this.db(ctx);
    const created_at = this.now(ctx);
    const seq = T.next_seq(db, channel, created_at);
    const row: T.MessageRow = {
      kind: channel.kind,
      key_a: channel.key_a,
      key_b: channel.key_b,
      seq,
      sender_id,
      message_kind,
      text,
      deleted: false,
      created_at,
      expires_at: created_at + BigInt(this.s.retention_ms),
    };
    T.insert_message(db, channel, row);
    return row;
  }

  /** `guild.lock_guild` of the member's guild and `get_member` again. The member, or the error. */
  relock_member(ctx: RequestCtx, guild_id: bigint): GuildMember | CoreContract.CoreError {
    const guild = this.m.guild;
    if (guild === null) return E.CORE_ERROR_INVALID_REQUEST;
    const locked = guild.lock_guild(ctx, guild_id);
    if (locked === 'FAILED') return E.CORE_ERROR_INTERNAL;
    const member = locked === null ? null : guild.get_member(ctx, ctx.user_id);
    return member === null || member.guild_id !== guild_id ? E.CORE_ERROR_GUILD_NOT_MEMBER : member;
  }

  /** A live row: not deleted and not expired at `now`. */
  static live(row: T.MessageRow, now: bigint): boolean {
    return !row.deleted && row.expires_at > now;
  }

  /** A visible row: live at `now` and not sent by a user in `blocked`. */
  static visible(row: T.MessageRow, now: bigint, blocked: ReadonlySet<bigint>): boolean {
    return Chat.live(row, now) && !blocked.has(row.sender_id);
  }

  blocked(ctx: RequestCtx): Set<bigint> {
    return new Set(this.m.block_report.list_blocked_ids(ctx, ctx.user_id));
  }

  /** `last_visible_seq` of a channel entry (`### channel list`): one statement that leaves out the blocked senders. */
  last_visible_seq(ctx: RequestCtx, key: T.ChannelKey, blocked: ReadonlySet<bigint>): bigint {
    return T.last_live_seq(this.db(ctx), key, this.now(ctx), [...blocked]) ?? 0n;
  }
}

/** `SendChatMessage` step 1, `Direct`: the other user is active, not blocked either way and a friend. */
function check_direct_peer(chat: Chat, ctx: RequestCtx, other: bigint): CoreContract.CoreError | null {
  if (!chat.m.public_profile.is_active_user(ctx, other)) return E.CORE_ERROR_USER_NOT_FOUND;
  if (chat.m.block_report.is_blocked_either(ctx, ctx.user_id, other)) return E.CORE_ERROR_BLOCKED;
  if (chat.m.friend === null || chat.m.friend.are_friends(ctx, ctx.user_id, other)) return null;
  // A Withdraw of the other user that commits between the reads removes the friend rows with the user: that is
  // a withdrawn user, not a user who is not a friend.
  return chat.m.public_profile.is_active_user(ctx, other) ? E.CORE_ERROR_CHAT_NOT_FRIEND : E.CORE_ERROR_USER_NOT_FOUND;
}

/** `SendChatMessage` steps 2 and 3: mute and send interval. */
function check_sender(chat: Chat, ctx: RequestCtx): CoreContract.CoreError | null {
  const db = chat.db(ctx);
  const until_at = T.read_mute_until(db, ctx.user_id);
  if (until_at !== null && (until_at === 0n || !chat.m.server_time.is_reached_strict(ctx, until_at))) return E.CORE_ERROR_CHAT_MUTED;
  const last_sent_at = T.read_last_sent_at(db, ctx.user_id);
  if (last_sent_at !== null && last_sent_at + BigInt(chat.s.min_interval_ms) > chat.now(ctx)) return E.CORE_ERROR_CHAT_TOO_FAST;
  return null;
}

/** `RoomInvite` text: `matchmaker.roomCodeLength` code points, each in `matchmaker.roomCodeAlphabet`. */
function is_room_code(chat: Chat, text: string): boolean {
  let length = 0;
  for (const char of text) {
    if (!chat.s.room_code_alphabet.includes(char)) return false;
    length += 1;
  }
  return length === chat.s.room_code_length;
}

/** `SendChatMessage` step 4: the text check. */
function check_text(chat: Chat, ctx: RequestCtx, channel: Channel, message_kind: CoreContract.ChatMessageKind, text: string): CoreContract.CoreError | null {
  if (message_kind === M.CHAT_MESSAGE_KIND_ROOM_INVITE) {
    return channel.kind === K.CHAT_CHANNEL_KIND_WORLD || !is_room_code(chat, text) ? E.CORE_ERROR_INVALID_REQUEST : null;
  }
  if (message_kind !== M.CHAT_MESSAGE_KIND_TEXT) return E.CORE_ERROR_INVALID_REQUEST;
  const checked = chat.m.validation.check_text(text, chat.s.max_text_length, false);
  if (checked.result === TextCheckResult.INVALID) return E.CORE_ERROR_TEXT_INVALID;
  if (checked.result === TextCheckResult.BANNED) {
    chat.log(ctx, 'core', 'chat text has a banned word', { banned_word_id: checked.banned_word_id });
    return E.CORE_ERROR_TEXT_BANNED;
  }
  return null;
}

/** `SendChatMessage` step 5: hook `validate_chat_send`. A wrong output throws, so the request ends with `INTERNAL`. */
function run_validate_hook(chat: Chat, ctx: RequestCtx, channel: Channel, message_kind: CoreContract.ChatMessageKind, text: string): FailureCode | null {
  const hook = chat.hook_slots.validate_chat_send;
  if (hook === null) return null;
  const output: unknown = hook(ctx, channel.kind, channel.id, message_kind, text);
  const checked = chat.m.storage.check_hook_output('validate_chat_send', output);
  return checked === 'pass' ? null : (checked as GameContract.GameError);
}

/** `SendChatMessage` step 6 before the write: the guild lock, the channel lock and the checks again. */
function lock_for_send(chat: Chat, ctx: RequestCtx, channel: Channel): CoreContract.CoreError | null {
  if (channel.kind === K.CHAT_CHANNEL_KIND_GUILD) {
    const member = chat.relock_member(ctx, channel.key_a);
    if (is_failure(member)) return member;
  }
  if (chat.lock_channel(ctx, channel) === 'FAILED') return E.CORE_ERROR_INTERNAL;
  if (channel.kind === K.CHAT_CHANNEL_KIND_DIRECT) {
    if (!chat.m.public_profile.is_active_user(ctx, channel.id)) return E.CORE_ERROR_USER_NOT_FOUND;
    if (chat.m.friend !== null && !chat.m.friend.are_friends(ctx, ctx.user_id, channel.id)) return E.CORE_ERROR_CHAT_NOT_FRIEND;
  }
  return null;
}

function send_chat_message(chat: Chat, ctx: RequestCtx, request: CoreContract.SendChatMessageRequest): CoreContract.SendChatMessageResponse | FailureCode {
  const channel = chat.open(ctx, request.channel_kind, request.channel_key);
  if (is_failure(channel)) return channel;
  const failure =
    (channel.kind === K.CHAT_CHANNEL_KIND_DIRECT ? check_direct_peer(chat, ctx, channel.id) : null) ??
    check_sender(chat, ctx) ??
    check_text(chat, ctx, channel, request.message_kind, request.text) ??
    run_validate_hook(chat, ctx, channel, request.message_kind, request.text) ??
    lock_for_send(chat, ctx, channel);
  if (failure !== null) return failure;
  const row = chat.append(ctx, channel, ctx.user_id, request.message_kind, request.text);
  T.write_last_sent_at(chat.db(ctx), ctx.user_id, row.created_at);
  const response = new CoreContract.SendChatMessageResponse();
  response.message = chat.message(row, channel.id, chat.nicknames(ctx, [ctx.user_id]));
  chat.hook_slots.on_chat_message_sent?.(ctx, response.message);
  return response;
}

function pick_of(request: CoreContract.GetChatMessagesRequest): T.Pick {
  if (request.after_seq !== 0n) return { after: request.after_seq };
  if (request.before_seq !== 0n) return { before: request.before_seq };
  return { latest: true };
}

function get_chat_messages(chat: Chat, ctx: RequestCtx, request: CoreContract.GetChatMessagesRequest): CoreContract.GetChatMessagesResponse | CoreContract.CoreError {
  const channel = chat.open(ctx, request.channel_kind, request.channel_key);
  if (is_failure(channel)) return channel;
  if (request.after_seq !== 0n && request.before_seq !== 0n) return E.CORE_ERROR_INVALID_REQUEST;
  const db = chat.db(ctx);
  const rows = T.select_messages(db, channel, pick_of(request), chat.s.max_fetch_count);
  const now = chat.now(ctx);
  const blocked = chat.blocked(ctx);
  const visible = rows.filter((row) => Chat.visible(row, now, blocked)).sort((a, b) => (a.seq < b.seq ? -1 : 1));
  const nicknames = chat.nicknames(
    ctx,
    visible.map((row) => row.sender_id),
  );
  const response = new CoreContract.GetChatMessagesResponse();
  response.messages = visible.map((row) => chat.message(row, channel.id, nicknames));
  const seqs = rows.map((row) => row.seq);
  response.last_seq = seqs.length === 0 ? request.after_seq : seqs.reduce(max_big);
  response.first_seq = seqs.length === 0 ? 0n : seqs.reduce(min_big);
  response.poll_after_ms = BigInt(chat.s.poll_interval_ms);
  response.channel_key = channel.id;
  if (request.after_seq !== 0n) {
    const deletions = T.select_deletions(db, channel, request.after_delete_seq, chat.s.max_fetch_count);
    response.deleted_seqs = deletions.map((row) => row.seq);
    response.last_delete_seq = deletions.reduce((last, row) => max_big(last, row.delete_seq), request.after_delete_seq);
  } else {
    response.last_delete_seq = T.read_channel(db, channel)?.last_delete_seq ?? 0n;
  }
  return response;
}

function report_chat_message(chat: Chat, ctx: RequestCtx, request: CoreContract.ReportChatMessageRequest): CoreContract.ReportChatMessageResponse | CoreContract.CoreError {
  const channel = chat.open(ctx, request.channel_kind, request.channel_key);
  if (is_failure(channel)) return channel;
  const row = T.read_message(chat.db(ctx), channel, request.seq);
  if (row === null || !Chat.live(row, chat.now(ctx))) return E.CORE_ERROR_CHAT_MESSAGE_NOT_FOUND;
  if (row.sender_id === ctx.user_id || row.message_kind === M.CHAT_MESSAGE_KIND_SYSTEM) return E.CORE_ERROR_INVALID_REQUEST;
  const ref = `${T.channel_kind_element(row.kind)}:${String(row.key_a)}:${String(row.key_b)}:${String(row.seq)}`;
  const result = chat.m.block_report.add_report(ctx, row.sender_id, request.reason_id, CoreContract.ReportContext.REPORT_CONTEXT_CHAT, ref, '', row.text);
  if (result === 'LIMIT') return E.CORE_ERROR_REPORT_LIMIT;
  if (result === 'INVALID_INPUT') return E.CORE_ERROR_INVALID_REQUEST;
  return new CoreContract.ReportChatMessageResponse();
}

/** A channel list entry of a stored channel row, or of a channel with no row. */
function channel_entry(chat: Chat, ctx: RequestCtx, key: T.ChannelKey, row: T.ChannelRow | null, id: bigint, blocked: ReadonlySet<bigint>): CoreContract.ChatChannelEntry {
  const entry = new CoreContract.ChatChannelEntry();
  entry.channel_kind = key.kind;
  entry.channel_key = id;
  entry.last_seq = row?.last_seq ?? 0n;
  entry.last_at = row?.last_at ?? 0n;
  entry.last_visible_seq = row === null ? 0n : chat.last_visible_seq(ctx, key, blocked);
  return entry;
}

function direct_entries(chat: Chat, ctx: RequestCtx, blocked: ReadonlySet<bigint>): CoreContract.ChatChannelEntry[] {
  const after_at = chat.now(ctx) - BigInt(chat.s.retention_ms);
  // Of each key column, the blocked users can leave out at most `blocked.size` of the first rows.
  const limit = chat.s.max_channel_list_count + blocked.size;
  const rows = T.recent_direct_channels(chat.db(ctx), K.CHAT_CHANNEL_KIND_DIRECT, ctx.user_id, after_at, limit)
    .map((row) => ({ row, other: row.key_a === ctx.user_id ? row.key_b : row.key_a }))
    .filter(({ other }) => !blocked.has(other))
    .sort((a, b) => (a.row.last_at !== b.row.last_at ? (a.row.last_at > b.row.last_at ? -1 : 1) : a.other < b.other ? -1 : 1))
    .slice(0, chat.s.max_channel_list_count);
  const profiles = new Map<bigint, CoreContract.PublicProfileEntry>();
  // One call for every entry: `get_public_profiles` chunks by `public-profile.maxRequestCount` itself.
  for (const profile of chat.m.public_profile.get_public_profiles(ctx, rows.map(({ other }) => other))) profiles.set(profile.user_id, profile);
  const out: CoreContract.ChatChannelEntry[] = [];
  for (const { row, other } of rows) {
    const profile = profiles.get(other);
    if (profile === undefined) continue;
    const entry = channel_entry(chat, ctx, row, row, other, blocked);
    entry.profile = profile;
    out.push(entry);
  }
  return out;
}

function get_chat_channels(chat: Chat, ctx: RequestCtx): CoreContract.GetChatChannelsResponse | CoreContract.CoreError {
  const child = chat.child_check(ctx);
  if (child !== null) return child;
  const blocked = chat.blocked(ctx);
  const response = new CoreContract.GetChatChannelsResponse();
  const member = chat.m.guild?.get_member(ctx, ctx.user_id) ?? null;
  if (member !== null) {
    const key: T.ChannelKey = { kind: K.CHAT_CHANNEL_KIND_GUILD, key_a: member.guild_id, key_b: 0n };
    const entry = channel_entry(chat, ctx, key, T.read_channel(chat.db(ctx), key), member.guild_id, blocked);
    entry.profile = new CoreContract.PublicProfileEntry();
    response.channels.push(entry);
  }
  if (chat.m.friend !== null) response.channels.push(...direct_entries(chat, ctx, blocked));
  response.poll_after_ms = BigInt(chat.s.channel_poll_interval_ms);
  return response;
}

function delete_guild_chat_message(chat: Chat, ctx: RequestCtx, request: CoreContract.DeleteGuildChatMessageRequest): CoreContract.DeleteGuildChatMessageResponse | CoreContract.CoreError {
  const child = chat.child_check(ctx);
  if (child !== null) return child;
  if (chat.m.guild === null) return E.CORE_ERROR_INVALID_REQUEST;
  const first = chat.m.guild.get_member(ctx, ctx.user_id);
  if (first === null) return E.CORE_ERROR_GUILD_NOT_MEMBER;
  const member = chat.relock_member(ctx, first.guild_id);
  if (is_failure(member)) return member;
  if (member.role !== Role.GUILD_ROLE_LEADER && member.role !== Role.GUILD_ROLE_OFFICER) return E.CORE_ERROR_GUILD_PERMISSION;
  const key: T.ChannelKey = { kind: K.CHAT_CHANNEL_KIND_GUILD, key_a: member.guild_id, key_b: 0n };
  if (chat.lock_channel(ctx, key) === 'FAILED') return E.CORE_ERROR_INTERNAL;
  const db = chat.db(ctx);
  const row = T.read_message(db, key, request.seq);
  if (row === null || !Chat.live(row, chat.now(ctx))) return E.CORE_ERROR_CHAT_MESSAGE_NOT_FOUND;
  T.delete_message(db, row);
  chat.log(ctx, 'core', 'guild chat message deleted', { guild_id: member.guild_id, seq: request.seq });
  return new CoreContract.DeleteGuildChatMessageResponse();
}

/** `post_system_message` step 1: the channel, or a reason it fails. A guild lock wait timeout throws. */
function system_channel(chat: Chat, ctx: RequestCtx, kind: CoreContract.ChatChannelKind, channel_id: bigint): Channel | string {
  if (kind === K.CHAT_CHANNEL_KIND_WORLD) {
    if (!chat.is_world_channel(channel_id)) return 'the world channel number is out of range';
    return { kind, key_a: channel_id, key_b: 0n, id: channel_id };
  }
  if (kind !== K.CHAT_CHANNEL_KIND_GUILD) return 'the channel kind is not World or Guild';
  if (chat.m.guild === null) return 'guild is not a server module';
  const locked = chat.m.guild.lock_guild(ctx, channel_id);
  if (locked === 'FAILED') throw new Error('chat: post_system_message: the guild row lock wait timed out');
  if (locked === null) return 'the guild does not exist';
  return { kind, key_a: channel_id, key_b: 0n, id: channel_id };
}

function post_system_message(chat: Chat, ctx: RequestCtx, kind: CoreContract.ChatChannelKind, channel_id: bigint, text: string): CoreContract.ChatMessage | null {
  const channel = system_channel(chat, ctx, kind, channel_id);
  let reason = typeof channel === 'string' ? channel : null;
  if (reason === null && (text === '' || Buffer.byteLength(text, 'utf8') > chat.s.max_system_text_bytes)) reason = 'the text is empty or over chat.maxSystemTextBytes';
  if (typeof channel === 'string' || reason !== null) {
    chat.log(ctx, 'error', `post_system_message: ${reason ?? ''}`, { channel_kind: kind, channel_id });
    return null;
  }
  if (chat.lock_channel(ctx, channel) === 'FAILED') throw new Error('chat: post_system_message: the channel row lock wait timed out');
  const row = chat.append(ctx, channel, 0n, M.CHAT_MESSAGE_KIND_SYSTEM, text);
  return chat.message(row, channel.id, new Map());
}

function remove_user(chat: Chat, ctx: RequestCtx): null | 'FAILED' {
  const db = chat.db(ctx);
  const me = ctx.user_id;
  const others = new Set(T.direct_channels(db, K.CHAT_CHANNEL_KIND_DIRECT, me).map((row) => (row.key_a === me ? row.key_b : row.key_a)));
  for (const id of chat.m.friend?.list_friend_ids(ctx, me) ?? []) others.add(id);
  const keys = [...others]
    .map((other): T.ChannelKey => ({ kind: K.CHAT_CHANNEL_KIND_DIRECT, key_a: min_big(me, other), key_b: max_big(me, other) }))
    .sort((a, b) => (a.key_a !== b.key_a ? (a.key_a < b.key_a ? -1 : 1) : a.key_b < b.key_b ? -1 : a.key_b > b.key_b ? 1 : 0));
  const locked = new Set<string>();
  for (const key of keys) {
    if (chat.lock_channel(ctx, key) === 'FAILED') return 'FAILED';
    locked.add(`${String(key.key_a)}:${String(key.key_b)}`);
  }
  const channels = T.direct_channels(db, K.CHAT_CHANNEL_KIND_DIRECT, me);
  if (channels.some((row) => !locked.has(`${String(row.key_a)}:${String(row.key_b)}`))) return 'FAILED';
  T.delete_sent_messages(db, me);
  for (const row of channels) T.delete_channel(db, row);
  return null;
}

/** Makes `chat` for one server instance and registers its tables. A missing setting or module throws. */
export function create_chat(input: ChatInput): ChatModule {
  const chat = new Chat(read_settings(input.settings), read_modules(input.modules));
  T.register_tables(chat.m.storage);
  return {
    SendChatMessage: (ctx, request) => send_chat_message(chat, ctx, request),
    GetChatMessages: (ctx, request) => get_chat_messages(chat, ctx, request),
    ReportChatMessage: (ctx, request) => report_chat_message(chat, ctx, request),
    GetChatChannels: (ctx) => get_chat_channels(chat, ctx),
    DeleteGuildChatMessage: (ctx, request) => delete_guild_chat_message(chat, ctx, request),
    remove_user: (ctx) => remove_user(chat, ctx),
    post_system_message: (ctx, kind, channel_id, text) => post_system_message(chat, ctx, kind, channel_id, text),
    ...admin_operations(chat.m),
    hook_slots: chat.hook_slots,
    begin_start: () => {},
    complete_start: () => null,
    stop: () => {},
  };
}
