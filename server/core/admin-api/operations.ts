/** admin-api's own admin operations (`## API` "admin operations of admin-api"). */
import * as CoreContract from '../../generated/contract/core_contract.ts';
import * as GameContract from '../../generated/contract/game_contract.ts';
import type { ChangeSourceInput, ItemShortfall } from '../item-ledger/index.ts';
import { NO_ACCESS_TOKEN_RPC, type RequestCtx } from '../storage/index.ts';
import { MATCH_REQUEST } from './body.ts';
import { output_json, utf8_length } from './json.ts';
import { fail, file, ok, type Reply } from './reply.ts';
import { read_states } from './states.ts';
import { ban_in_force, delete_ban, KILL_SWITCH_KIND, MAINTENANCE_KIND, read_ban, read_switches, write_ban, write_switch, type BanRow } from './tables.ts';
import type { AdminApiModules, AdminInput, AdminOutput, AdminTransaction, FieldMap, FieldType, HandlerFailure, Role } from './types.ts';

/** An admin-api operation: the handler function form plus what admin-api's own operations need. */
export interface OwnOperation {
  readonly name: string;
  readonly role: Role;
  readonly input: FieldMap;
  readonly user_target: string | null;
  /** A user-targeted operation that also takes a withdrawn user. */
  readonly allow_withdrawn?: boolean;
  /** Runs in the transaction of processing order step 6. */
  readonly handler?: (input: AdminInput, transaction: AdminTransaction) => AdminOutput | HandlerFailure | Reply;
  /** Runs instead of that transaction, for an operation that opens its own or none. */
  readonly execute?: (input: AdminInput) => Promise<Reply>;
  /** Runs after the handler function's transaction committed. */
  readonly on_committed?: (input: AdminInput) => void;
}

export interface OperationContext {
  readonly modules: AdminApiModules;
  readonly max_export_bytes: number;
  /** Updates this server instance's switch cache. */
  readonly set_cached_switch: (kind: string, target: string, enabled: boolean) => void;
  readonly log_error: (request: string, user_id: bigint | null, message: string) => void;
}

const INT64: FieldType = { kind: 'int64' };
const INT32: FieldType = { kind: 'int32' };
const BOOL: FieldType = { kind: 'bool' };
const STRING: FieldType = { kind: 'string' };
const JSON_VALUE: FieldType = { kind: 'json' };
const ITEMS: FieldType = {
  kind: 'array',
  element: {
    kind: 'object',
    fields: { item_id: { type: INT32 }, amount: { type: INT64 }, big_amount: { type: STRING, optional: true } },
  },
};
const USER_ID: FieldMap = { user_id: { type: INT64 } };

const MAX_SAFE = BigInt(Number.MAX_SAFE_INTEGER);

/** `GameError` element names by value. */
const GAME_ERROR_NAMES: ReadonlyMap<number, string> = new Map(Object.entries(GameContract.GameError).map(([name, value]) => [value as number, name]));

/** The request names of `service Game` and base proto `service Core`. */
function rpc_names(): Set<string> {
  return new Set([...CoreContract.RPCS, ...GameContract.RPCS].map((rpc) => rpc.name));
}

interface ItemInput {
  readonly item_id: number;
  readonly amount: bigint;
  readonly big_amount?: string;
}

function item_amounts(items: unknown): CoreContract.ItemAmount[] {
  return (items as readonly ItemInput[]).map((item) => {
    const amount = new CoreContract.ItemAmount();
    amount.item_id = item.item_id;
    amount.amount = item.amount;
    amount.big_amount = item.big_amount ?? '';
    return amount;
  });
}

/** An amount in the big encoding pair of the `items` form. */
function encoded_amount(value: bigint): { amount: bigint; big_amount: string } {
  const absolute = value < 0n ? -value : value;
  return absolute <= MAX_SAFE ? { amount: value, big_amount: '' } : { amount: 0n, big_amount: value.toString() };
}

/** The element name of an `item-ledger` failure: an `ItemChangeResult` element or a `GameError` of a hook. */
function result_name(outcome: string | number): string {
  return typeof outcome === 'string' ? outcome : (GAME_ERROR_NAMES.get(outcome) ?? String(outcome));
}

function admin_source(operation: string, operation_id: string): ChangeSourceInput {
  return { source: CoreContract.ItemChangeSource.ITEM_CHANGE_SOURCE_ADMIN, ref: operation, once_key: `admin:${operation}:${operation_id}` };
}

/** `ban`: `null` unless the user is a ban target by the rule of `is_banned`. */
function ban_json(ban: BanRow | null, now: bigint): AdminOutput | null {
  return ban_in_force(ban, now) ? { until_at: ban.until_at, reason: ban.reason, banned_at: ban.banned_at } : null;
}

function ctx_of(transaction: AdminTransaction): RequestCtx {
  return transaction as RequestCtx;
}

/** `get_user` and `export_personal_data`: reads of one user. */
function user_reads(c: OperationContext): OwnOperation[] {
  const { storage } = c.modules;
  const server_time = c.modules['server-time'];

  /**
   * Reads in one read-only transaction of the user: the value, null when the user is withdrawn (before or while the
   * transaction opened), or `FAILED`.
   */
  const read_user = async <T>(user_id: bigint, read: (ctx: RequestCtx) => T): Promise<{ value: T } | null | 'FAILED'> => {
    const box: { got: { value: T } | null } = { got: null };
    const status = await storage.run_user_transaction(user_id, (ctx) =>
      storage.run_read_only(ctx, () => {
        box.got = { value: read(ctx) };
        return 'pass';
      }),
    );
    if (status === 'FAILED' || status === 'REJECTED') return 'FAILED';
    return status === 'COMMITTED' ? box.got : null;
  };

  const get_user = async (user_id: bigint): Promise<Reply> => {
    const record = storage.get_user_record(storage.read_db(), user_id);
    if (record === null) return fail('not_found');
    const read = record.withdrawn_at === null
      ? await read_user(user_id, (ctx) => ({
          user_state: read_states(storage, ctx, 'user_state'),
          server_state: read_states(storage, ctx, 'server_state'),
          ban: read_ban(storage.db(ctx), user_id),
        }))
      : null;
    if (read === 'FAILED') return fail('internal');
    if (read !== null) return ok({ user_id, created_at: record.created_at, withdrawn_at: null, ...read.value, ban: ban_json(read.value.ban, server_time.clock_now()) });
    // A withdrawn user: no state, the record as it is now.
    const now = storage.get_user_record(storage.read_db(), user_id) ?? record;
    const ban = ban_json(read_ban(storage.read_db(), user_id), server_time.clock_now());
    return ok({ user_id, created_at: now.created_at, withdrawn_at: now.withdrawn_at, ban, user_state: {}, server_state: {} });
  };

  const export_data = async (user_id: bigint): Promise<Reply> => {
    const record = storage.get_user_record(storage.read_db(), user_id);
    if (record === null) return fail('not_found');
    const read = record.withdrawn_at === null
      ? await read_user(user_id, (ctx) => ({
          user_state: read_states(storage, ctx, 'user_state'),
          tables: storage.export_user_rows(storage.db(ctx), user_id),
          exported_at: server_time.now(ctx),
        }))
      : null;
    if (read === 'FAILED') return fail('internal');
    const data = read?.value ?? { user_state: {}, tables: storage.export_user_rows(storage.read_db(), user_id), exported_at: server_time.clock_now() };
    const text = JSON.stringify(output_json({ user_id, created_at: record.created_at, exported_at: data.exported_at, user_state: data.user_state, tables: data.tables }));
    if (utf8_length(text) > c.max_export_bytes) {
      c.log_error('export_personal_data', user_id, 'personal data file is larger than admin-api.maxExportBytes');
      return fail('too_large');
    }
    return file(`personal-data-${user_id.toString()}.json`, text);
  };

  return [
    { name: 'get_user', role: 'read', input: USER_ID, user_target: 'user_id', allow_withdrawn: true, execute: (input) => get_user(input.user_id as bigint) },
    { name: 'export_personal_data', role: 'privacy', input: USER_ID, user_target: 'user_id', allow_withdrawn: true, execute: (input) => export_data(input.user_id as bigint) },
  ];
}

/** `grant_items`, `revoke_items`, `list_item_history`. */
function item_operations(c: OperationContext): OwnOperation[] {
  const item_ledger = c.modules['item-ledger'];
  const change_input: FieldMap = { operation_id: { type: STRING }, user_id: { type: INT64 }, items: { type: ITEMS } };

  const grant_items: OwnOperation = {
    name: 'grant_items',
    role: 'economy',
    input: change_input,
    user_target: 'user_id',
    handler(input, transaction) {
      const outcome = item_ledger.add_items(ctx_of(transaction), item_amounts(input.items), admin_source('grant_items', input.operation_id as string));
      const result = result_name(outcome);
      if (result === 'OK' || result === 'ALREADY_APPLIED') return { result };
      return fail('conflict', { result });
    },
  };

  const revoke_items: OwnOperation = {
    name: 'revoke_items',
    role: 'economy',
    input: change_input,
    user_target: 'user_id',
    handler(input, transaction) {
      const items = item_amounts(input.items);
      const outcome = item_ledger.revoke_items(ctx_of(transaction), items, admin_source('revoke_items', input.operation_id as string));
      if (typeof outcome !== 'string') {
        const shortfall = items.map((item, i) => {
          const row: ItemShortfall | undefined = outcome[i]?.item_id === item.item_id ? outcome[i] : outcome.find((s) => s.item_id === item.item_id);
          return { item_id: item.item_id, ...encoded_amount(row?.shortfall ?? 0n) };
        });
        return { result: 'OK', shortfall };
      }
      if (outcome === 'ALREADY_APPLIED') return { result: outcome, shortfall: [] };
      return fail('conflict', { result: outcome });
    },
  };

  const list_item_history: OwnOperation = {
    name: 'list_item_history',
    role: 'read',
    input: { user_id: { type: INT64 }, from_at: { type: INT64 }, to_at: { type: INT64 }, after_seq: { type: INT64 }, limit: { type: INT32 } },
    user_target: null,
    execute(input) {
      const entries = item_ledger.list_history(input.user_id as bigint, input.from_at as bigint, input.to_at as bigint, input.after_seq as bigint, input.limit as number);
      return Promise.resolve(ok({ entries }));
    },
  };

  return [grant_items, revoke_items, list_item_history];
}

/** `send_mail`, `broadcast_mail`, `cancel_broadcast`. */
function mail_operations(c: OperationContext): OwnOperation[] {
  const { mailbox } = c.modules;
  // `json` values keep integers past 2^53 as `bigint`; the mail input JSON takes them as decimal strings.
  const mail_of = (value: unknown) => mailbox.mail_input_from_json(output_json(value));

  return [
    {
      name: 'send_mail',
      role: 'economy',
      input: { operation_id: { type: STRING }, user_id: { type: INT64 }, mail: { type: JSON_VALUE } },
      user_target: 'user_id',
      handler(input, transaction) {
        const mail = mail_of(input.mail);
        if (mail === 'INVALID_INPUT') return 'bad_request';
        const outcome = mailbox.send_mail(ctx_of(transaction), mail);
        return outcome.result === 'INVALID_INPUT' ? 'bad_request' : { mail_id: outcome.mail_id };
      },
    },
    {
      name: 'broadcast_mail',
      role: 'economy',
      input: { operation_id: { type: STRING }, mail: { type: JSON_VALUE }, start_at: { type: INT64 } },
      user_target: null,
      handler(input, transaction) {
        const mail = mail_of(input.mail);
        if (mail === 'INVALID_INPUT') return 'bad_request';
        const outcome = mailbox.broadcast_mail(transaction as Parameters<typeof mailbox.broadcast_mail>[0], mail, input.start_at as bigint);
        return outcome.result === 'OK' ? { broadcast_id: outcome.broadcast_id } : 'bad_request';
      },
    },
    {
      name: 'cancel_broadcast',
      role: 'economy',
      input: { broadcast_id: { type: INT64 } },
      user_target: null,
      handler(input, transaction) {
        return mailbox.cancel_broadcast(transaction as Parameters<typeof mailbox.cancel_broadcast>[0], input.broadcast_id as bigint) ? {} : 'not_found';
      },
    },
  ];
}

/** `ban_user`, `unban_user`, `set_maintenance`, `set_kill_switch`, `get_switches`. */
function switch_operations(c: OperationContext): OwnOperation[] {
  const { storage } = c.modules;
  const server_time = c.modules['server-time'];
  const known_requests = rpc_names();

  return [
    {
      name: 'ban_user',
      role: 'ops',
      input: { user_id: { type: INT64 }, until_at: { type: INT64 }, reason: { type: STRING } },
      user_target: 'user_id',
      handler(input, transaction) {
        const ctx = ctx_of(transaction);
        write_ban(storage.db(ctx), input.user_id as bigint, { until_at: input.until_at as bigint, reason: input.reason as string, banned_at: server_time.now(ctx) });
        return {};
      },
    },
    {
      name: 'unban_user',
      role: 'ops',
      input: USER_ID,
      user_target: 'user_id',
      handler(input, transaction) {
        delete_ban(storage.db(transaction), input.user_id as bigint);
        return {};
      },
    },
    {
      name: 'set_maintenance',
      role: 'ops',
      input: { enabled: { type: BOOL } },
      user_target: null,
      handler(input, transaction) {
        write_switch(storage.db(transaction), MAINTENANCE_KIND, '', input.enabled as boolean, server_time.clock_now());
        return {};
      },
      on_committed(input) {
        c.set_cached_switch(MAINTENANCE_KIND, '', input.enabled as boolean);
      },
    },
    {
      name: 'set_kill_switch',
      role: 'ops',
      input: { request_name: { type: STRING }, enabled: { type: BOOL } },
      user_target: null,
      handler(input, transaction) {
        const name = input.request_name as string;
        if (name !== MATCH_REQUEST && !known_requests.has(name)) return 'not_found';
        if (NO_ACCESS_TOKEN_RPC.has(name)) return 'conflict';
        write_switch(storage.db(transaction), KILL_SWITCH_KIND, name, input.enabled as boolean, server_time.clock_now());
        return {};
      },
      on_committed(input) {
        c.set_cached_switch(KILL_SWITCH_KIND, input.request_name as string, input.enabled as boolean);
      },
    },
    {
      name: 'get_switches',
      role: 'read',
      input: {},
      user_target: null,
      handler(_input, transaction) {
        const state = read_switches(storage.db(transaction));
        return { maintenance: state.maintenance, kill_switches: state.kill_switches };
      },
    },
  ];
}

/** The operations of the optional dependencies that are in the server module list. */
function optional_operations(c: OperationContext): OwnOperation[] {
  const out: OwnOperation[] = [];
  const { iap, ranking } = c.modules;
  if (iap !== undefined) {
    out.push({
      name: 'list_payments',
      role: 'read',
      input: USER_ID,
      user_target: 'user_id',
      allow_withdrawn: true,
      execute(input) {
        const { payments, other_user_attempts } = iap.list_payments(input.user_id as bigint);
        return Promise.resolve(ok({ payments, other_user_attempts }));
      },
    });
  }
  if (ranking !== undefined) {
    out.push({
      name: 'remove_ranking_user',
      role: 'ops',
      input: USER_ID,
      user_target: 'user_id',
      handler(_input, transaction) {
        ranking.remove_user(ctx_of(transaction));
        return {};
      },
    });
  }
  return out;
}

export function own_operations(c: OperationContext): OwnOperation[] {
  return [...user_reads(c), ...item_operations(c), ...mail_operations(c), ...switch_operations(c), ...optional_operations(c)];
}
