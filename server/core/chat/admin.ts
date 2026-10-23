/**
 * The admin operations of `chat` (`chat` `### admin`), in the admin operation form of `admin-api`. `routing` collects
 * them and passes them to `admin-api`.
 */
import type { GameTx, RequestCtx } from '../storage/index.ts';
import type { ChatModules } from './deps.ts';
import * as T from './tables.ts';

type FieldType =
  | { readonly kind: 'int64' }
  | { readonly kind: 'int32' }
  | { readonly kind: 'string' }
  | { readonly kind: 'enum'; readonly elements: readonly string[] };

type Failure = 'bad_request' | 'not_found' | 'conflict' | 'internal';

/**
 * An admin operation object (`admin-api` `## API`). The handler gets the target user's out-of-request ctx when
 * `user_target` is set, a game tx otherwise.
 */
export interface AdminOperation {
  readonly name: string;
  readonly role: 'read' | 'ops';
  readonly body: 'json';
  readonly max_body_bytes: null;
  readonly input: Readonly<Record<string, { readonly type: FieldType; readonly optional: boolean }>>;
  readonly user_target: string | null;
  readonly handler: (input: Readonly<Record<string, unknown>>, transaction: RequestCtx | GameTx, prepare_value: unknown, body: Uint8Array | null) => Record<string, unknown> | Failure;
  readonly prepare: null;
  readonly audit_args: null;
}

export interface ChatAdminOperations {
  readonly list_chat_messages: AdminOperation;
  readonly delete_chat_message: AdminOperation;
  readonly mute_chat_user: AdminOperation;
  readonly unmute_chat_user: AdminOperation;
}

const CHANNEL_KIND: FieldType = { kind: 'enum', elements: ['World', 'Guild', 'Direct'] };
const INT64: FieldType = { kind: 'int64' };
const required = (type: FieldType): { type: FieldType; optional: boolean } => ({ type, optional: false });

function channel_key(input: Readonly<Record<string, unknown>>): T.ChannelKey {
  const kind = T.channel_kind_of(String(input['channel_kind']));
  if (kind === null) throw new TypeError('chat: channel_kind passed the body check but is not World, Guild or Direct');
  return { kind, key_a: input['key_a'] as bigint, key_b: input['key_b'] as bigint };
}

/** A message row of `list_chat_messages`. admin-api writes the `bigint` values as decimal strings. */
function row_json(row: T.MessageRow): Record<string, unknown> {
  return {
    kind: T.channel_kind_name(row.kind),
    key_a: row.key_a,
    key_b: row.key_b,
    seq: row.seq,
    sender_id: row.sender_id,
    message_kind: T.message_kind_name(row.message_kind),
    text: row.text,
    deleted: row.deleted,
    created_at: row.created_at,
    expires_at: row.expires_at,
  };
}

/** The four admin operations of `chat` for one server instance. */
export function admin_operations(m: ChatModules): ChatAdminOperations {
  const { storage, server_time } = m;
  return {
    list_chat_messages: {
      name: 'list_chat_messages',
      role: 'read',
      body: 'json',
      max_body_bytes: null,
      input: { channel_kind: required(CHANNEL_KIND), key_a: required(INT64), key_b: required(INT64), after_seq: required(INT64), limit: required({ kind: 'int32' }) },
      user_target: null,
      handler: (input, tx) => ({ messages: T.list_messages(storage.db(tx), channel_key(input), input['after_seq'] as bigint, input['limit'] as number).map(row_json) }),
      prepare: null,
      audit_args: null,
    },
    delete_chat_message: {
      name: 'delete_chat_message',
      role: 'ops',
      body: 'json',
      max_body_bytes: null,
      input: { channel_kind: required(CHANNEL_KIND), key_a: required(INT64), key_b: required(INT64), seq: required(INT64) },
      user_target: null,
      handler: (input, tx) => {
        const key = channel_key(input);
        if (storage.lock_game_row(tx, T.CHANNEL, T.channel_lock_key(key)) === 'FAILED') return 'internal';
        const db = storage.db(tx);
        const row = T.read_message(db, key, input['seq'] as bigint);
        if (row === null) return 'not_found';
        if (!row.deleted) T.delete_message(db, row);
        return {};
      },
      prepare: null,
      audit_args: null,
    },
    mute_chat_user: {
      name: 'mute_chat_user',
      role: 'ops',
      body: 'json',
      max_body_bytes: null,
      input: { user_id: required(INT64), until_at: required(INT64), reason: required({ kind: 'string' }) },
      user_target: 'user_id',
      handler: (input, transaction) => {
        const ctx = transaction as RequestCtx;
        const until_at = input['until_at'] as bigint;
        if (until_at < 0n) return 'bad_request';
        T.write_mute(storage.db(ctx), ctx.user_id, until_at, input['reason'] as string, server_time.now(ctx));
        return {};
      },
      prepare: null,
      audit_args: null,
    },
    unmute_chat_user: {
      name: 'unmute_chat_user',
      role: 'ops',
      body: 'json',
      max_body_bytes: null,
      input: { user_id: required(INT64) },
      user_target: 'user_id',
      handler: (_input, transaction) => {
        const ctx = transaction as RequestCtx;
        T.delete_mute(storage.db(ctx), ctx.user_id);
        return {};
      },
      prepare: null,
      audit_args: null,
    },
  };
}
