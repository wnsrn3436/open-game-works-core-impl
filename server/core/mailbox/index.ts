/** mailbox: user mailbox, attachment claim, and the mail grant of items that could not be given right away. */
import * as CoreContract from '../../generated/contract/core_contract.ts';
import type * as GameContract from '../../generated/contract/game_contract.ts';
import type * as GameData from '../../generated/data/game_data.ts';
import {
  ItemChangeResult, change_failure_code, content_change_source, has_core_once_key_prefix, type ChangeSource, type ChangeSourceInput,
  type ItemChangeOutcome, type ItemLedger,
} from '../item-ledger/index.ts';
import type { Logging, LogValue } from '../logging/index.ts';
import type { ServerTimeApi } from '../server-time/index.ts';
import type { DbHandle, FailureCode, GameTx, Pass, RequestCtx, Storage } from '../storage/index.ts';
import {
  amount_of,
  check_mail_input,
  mail_input_from_json,
  mail_to_json,
  type CheckedMail,
  type ItemAmountInput,
  type MailArgInput,
  type MailInput,
  type MailItems,
  type MailLimits,
} from './mail_input.ts';
import * as Tables from './tables.ts';

export type { ItemAmountInput, MailArgInput, MailInput } from './mail_input.ts';

/** `MailResult` (`## API`). */
export const MailResult = {
  OK: 'OK',
  ALREADY_SENT: 'ALREADY_SENT',
  INVALID_INPUT: 'INVALID_INPUT',
} as const;
export type MailResult = (typeof MailResult)[keyof typeof MailResult];

/** The output of `send_mail`: `mail_id` is the mail ID of `OK` and `ALREADY_SENT`, else 0. */
export interface SendMailOutcome {
  readonly result: MailResult;
  readonly mail_id: bigint;
}

/** The output of `broadcast_mail`: `broadcast_id` is 0 unless `result` is `OK`. */
export interface BroadcastMailOutcome {
  readonly result: typeof MailResult.OK | typeof MailResult.INVALID_INPUT;
  readonly broadcast_id: bigint;
}

/** The output of `grant_or_mail`, or its failure value in `result`. */
export type GrantOrMailOutcome =
  | { readonly result: 'Granted' }
  | { readonly result: 'AlreadyApplied' }
  | { readonly result: 'Mailed'; readonly mail_ids: readonly bigint[] }
  | { readonly result: 'UNKNOWN_ITEM' | 'INVALID_AMOUNT' | 'UNSUPPORTED_ITEM' | typeof MailResult.INVALID_INPUT };

/** Hook `grant_mail_extra`: `pass` or a `GameError`. */
export type GrantMailExtraHook = (ctx: RequestCtx, extra_id: number, mail_id: bigint) => Pass | GameContract.GameError;

/** The operations content code calls (member `content`). */
export interface MailboxContent {
  send_mail(ctx: RequestCtx, input: MailInput): SendMailOutcome;
  grant_or_mail(
    ctx: RequestCtx,
    items: readonly ItemAmountInput[],
    source: ChangeSourceInput,
    template_id: number,
    args: readonly MailArgInput[],
  ): GrantOrMailOutcome;
}

/** The module object: the `## API` operations as core modules call them, the exports to `routing`, the lifecycle. */
export interface Mailbox {
  send_mail(ctx: RequestCtx, input: MailInput): SendMailOutcome;
  grant_or_mail(
    ctx: RequestCtx,
    items: readonly ItemAmountInput[],
    source: ChangeSourceInput,
    template_id: number,
    args: readonly MailArgInput[],
  ): GrantOrMailOutcome;
  broadcast_mail(tx: GameTx, input: MailInput, start_at: bigint): BroadcastMailOutcome;
  mail_input_from_json(json: unknown): MailInput | typeof MailResult.INVALID_INPUT;
  cancel_mail_by_once_key(ctx: RequestCtx, once_key: string): CoreContract.ItemAmount[];
  cancel_broadcast(tx: GameTx, broadcast_id: bigint): boolean;
  on_request_start(user_id: bigint): Promise<null>;
  ReadMail(ctx: RequestCtx, request: CoreContract.ReadMailRequest): CoreContract.ReadMailResponse | FailureCode;
  ClaimMail(ctx: RequestCtx, request: CoreContract.ClaimMailRequest): CoreContract.ClaimMailResponse | FailureCode;
  ClaimAllMail(ctx: RequestCtx, request: CoreContract.ClaimAllMailRequest): CoreContract.ClaimAllMailResponse | FailureCode;
  readonly content: MailboxContent;
  /** The hook slots `routing` fills with the hooks `register_hook` got. An empty slot does the `default`. */
  readonly hook_slots: { grant_mail_extra: GrantMailExtraHook | null };
  begin_start(): void;
  complete_start(): string | null;
  stop(): void;
}

/** What mailbox reads of the `server` object of the module input. */
export interface MailboxServer {
  /** The server build data (`broadcast_mail`'s input check). */
  readonly data: GameData.DataSet;
}

/** The module input (`server-core` `## module`). */
export interface MailboxInput {
  readonly settings: Readonly<Record<string, unknown>>;
  readonly modules: Readonly<Record<string, unknown>>;
  readonly server: MailboxServer;
}

interface MailboxModules {
  readonly storage: Storage;
  readonly 'item-ledger': ItemLedger;
  readonly 'server-time': ServerTimeApi;
  readonly logging: Logging;
}

const PASS: Pass = 'pass';
const MAIL_KIND = CoreContract.MailUserState;
const Source = CoreContract.ItemChangeSource;
const CoreError = CoreContract.CoreError;

function integer_setting(settings: Readonly<Record<string, unknown>>, key: string): number {
  const value = settings[key];
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) throw new TypeError(`mailbox: setting ${key} is not an integer`);
  return value;
}

function modules_of(modules: Readonly<Record<string, unknown>>): MailboxModules {
  for (const name of ['storage', 'item-ledger', 'server-time', 'logging']) {
    if (modules[name] === undefined || modules[name] === null) throw new TypeError(`mailbox: module ${name} is missing`);
  }
  return modules as unknown as MailboxModules;
}

/** The failure code of an `add_items` result in a core `rpc` (`item-ledger` `## error`); null for `OK`, `ALREADY_APPLIED`. */
function ledger_failure(result: ItemChangeOutcome): FailureCode | null {
  return result === ItemChangeResult.OK || result === ItemChangeResult.ALREADY_APPLIED ? null : change_failure_code(result);
}

/** The list cut into pieces of `size` in order. */
function chunks<T>(list: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

/** The items added up by item ID value, in item ID value order. */
function sum_items(ledger: ItemLedger, items: readonly CoreContract.ItemAmount[]): CoreContract.ItemAmount[] {
  const totals = new Map<number, bigint>();
  for (const item of items) totals.set(item.item_id, (totals.get(item.item_id) ?? 0n) + (ledger.read_amount(item) ?? 0n));
  return [...totals.entries()].sort(([a], [b]) => a - b).map(([item_id, amount]) => ledger.make_item_amount(item_id, amount));
}

function copy_mail(mail: CoreContract.MailUserState): CoreContract.MailUserState {
  const copy = CoreContract.MailUserState.decode(mail.encode());
  if (copy === null) throw new TypeError('mailbox: MailUserState does not encode');
  return copy;
}

function stack_of(error: unknown): string {
  return error instanceof Error ? (error.stack ?? error.message) : String(error);
}

/** Makes `mailbox` for one server instance and registers its tables. A missing setting or module throws. */
export function create_mailbox(input: MailboxInput): Mailbox {
  const { settings } = input;
  const deps = modules_of(input.modules);
  const storage = deps.storage;
  const ledger = deps['item-ledger'];
  const time = deps['server-time'];
  const logging = deps.logging;
  const data = input.server.data;
  const default_expire_ms = BigInt(integer_setting(settings, 'mailbox.defaultExpireMs'));
  const max_claim_all = integer_setting(settings, 'mailbox.maxClaimAllCount');
  const limits: MailLimits = {
    max_args: integer_setting(settings, 'mailbox.maxArgs'),
    max_arg_length: integer_setting(settings, 'mailbox.maxArgLength'),
    max_attachments: integer_setting(settings, 'mailbox.maxAttachments'),
    max_expire_ms: BigInt(integer_setting(settings, 'mailbox.maxExpireMs')),
  };
  const start_failure =
    default_expire_ms < 1n || default_expire_ms > limits.max_expire_ms
      ? `mailbox: mailbox.defaultExpireMs ${default_expire_ms.toString()} is below 1 or over mailbox.maxExpireMs ${limits.max_expire_ms.toString()}`
      : null;
  const hook_slots: Mailbox['hook_slots'] = { grant_mail_extra: null };
  const ledger_items: MailItems = {
    check_items: (items) => ledger.check_add_items(items) === ItemChangeResult.OK,
    read_amount: (item) => ledger.read_amount(item),
    make_item_amount: (item_id, amount) => ledger.make_item_amount(item_id, amount),
  };
  Tables.register_tables(storage);

  function log(ctx: RequestCtx | null, user_id: bigint | null, level: 'info' | 'error', message: string, fields: Record<string, LogValue> = {}): void {
    logging.write({
      kind: level === 'error' ? 'error' : 'core',
      level,
      message,
      user_id: ctx?.user_id ?? user_id,
      request_id: ctx && ctx.request_id !== '' ? ctx.request_id : null,
      request: ctx && ctx.request_name !== '' ? ctx.request_name : null,
      fields: level === 'error' ? { stack_trace: null, ...fields } : { module: 'mailbox', ...fields },
    });
  }

  function is_expired(ctx: RequestCtx, mail: CoreContract.MailUserState): boolean {
    return mail.expires_at !== 0n && time.is_reached_strict(ctx, mail.expires_at);
  }

  /** Stores a checked mail for the ctx user: `ALREADY_SENT` when its `once_key` has a row. */
  function deliver(ctx: RequestCtx, mail: CheckedMail): SendMailOutcome {
    const db = storage.db(ctx);
    if (mail.once_key !== '') {
      const sent = Tables.find_once_key(db, ctx.user_id, mail.once_key);
      if (sent !== null) return { result: MailResult.ALREADY_SENT, mail_id: sent };
    }
    const mail_id = Tables.next_mail_id(db, ctx.user_id);
    const sent_at = time.now(ctx);
    const state = new CoreContract.MailUserState();
    state.id = mail_id;
    state.template_id = mail.template_id;
    state.args = mail.args;
    state.attachments = mail.attachments;
    state.extra_id = mail.extra_id;
    state.sent_at = sent_at;
    state.expires_at = mail.no_expiry ? 0n : sent_at + (mail.expire_ms === 0n ? default_expire_ms : mail.expire_ms);
    storage.put_core_state(ctx, state);
    if (state.expires_at !== 0n) Tables.lower_next_expires_at(db, ctx.user_id, state.expires_at);
    if (mail.once_key !== '') Tables.insert_once_key(db, ctx.user_id, mail.once_key, mail_id);
    return { result: MailResult.OK, mail_id };
  }

  function send_mail(ctx: RequestCtx, mail_input: MailInput, allow_no_expiry: boolean): SendMailOutcome {
    const checked = check_mail_input(mail_input, ctx.data, limits, allow_no_expiry, ledger_items);
    if (!checked.ok) {
      log(ctx, null, 'error', 'send_mail input is invalid', { reason: checked.reason });
      return { result: MailResult.INVALID_INPUT, mail_id: 0n };
    }
    return deliver(ctx, checked.mail);
  }

  /** `grant_or_mail` step 3: the items as mails of `mailbox.maxAttachments` items each. */
  function mail_items(
    ctx: RequestCtx,
    items: readonly ItemAmountInput[],
    source: ChangeSource,
    template_id: number,
    args: readonly MailArgInput[],
  ): GrantOrMailOutcome {
    const no_expiry = source.source === Source.ITEM_CHANGE_SOURCE_IAP;
    const pieces = chunks(items, Math.max(1, limits.max_attachments));
    const once_key_of = (index: number): string => (source.once_key === '' || index === 0 ? source.once_key : `${source.once_key}:${String(index + 1)}`);
    if (source.once_key !== '' && pieces.length > 1) {
      const later_keys = pieces.slice(1).map((_, index) => once_key_of(index + 1));
      const taken = Tables.find_once_keys(storage.db(ctx), ctx.user_id, later_keys);
      if (taken.size > 0) {
        log(ctx, null, 'error', 'grant_or_mail once_key of a later piece already has a mail', { once_key: source.once_key });
        return { result: MailResult.INVALID_INPUT };
      }
    }
    const checked: CheckedMail[] = [];
    for (const [index, attachments] of pieces.entries()) {
      const once_key = once_key_of(index);
      const result = check_mail_input({ template_id, args, attachments, expire_ms: 0n, no_expiry, once_key }, ctx.data, limits, true, ledger_items);
      if (!result.ok) {
        log(ctx, null, 'error', 'send_mail input is invalid', { reason: result.reason });
        return { result: MailResult.INVALID_INPUT };
      }
      checked.push(result.mail);
    }
    const mail_ids: bigint[] = [];
    for (const mail of checked) {
      const sent = deliver(ctx, mail);
      mail_ids.push(sent.mail_id);
      if (sent.result !== MailResult.OK) continue;
      const item_mail = new CoreContract.ItemMail();
      item_mail.mail_id = sent.mail_id;
      item_mail.source = source.source;
      item_mail.ref = source.ref;
      item_mail.items = mail.attachments;
      storage.add_item_mail(ctx, item_mail);
    }
    return { result: 'Mailed', mail_ids };
  }

  function grant_or_mail(
    ctx: RequestCtx,
    items: readonly ItemAmountInput[],
    source: ChangeSource,
    template_id: number,
    args: readonly MailArgInput[],
  ): GrantOrMailOutcome {
    if (source.once_key !== '') {
      const db = storage.db(ctx);
      if (Tables.find_once_key(db, ctx.user_id, source.once_key) !== null) {
        return { result: 'Mailed', mail_ids: Tables.once_key_mail_ids(db, ctx.user_id, source.once_key) };
      }
    }
    const amounts = items.map((item) => ledger.make_item_amount(item.item_id, amount_of(item, ledger_items) ?? 0n));
    const added = ledger.add_items(ctx, amounts, source);
    if (added === ItemChangeResult.OK) return { result: 'Granted' };
    if (added === ItemChangeResult.ALREADY_APPLIED) return { result: 'AlreadyApplied' };
    if (added === ItemChangeResult.UNKNOWN_ITEM || added === ItemChangeResult.INVALID_AMOUNT || added === ItemChangeResult.UNSUPPORTED_ITEM) {
      return { result: added };
    }
    if (added === ItemChangeResult.LIMIT_EXCEEDED || added === ItemChangeResult.REJECTED || typeof added === 'number') {
      return mail_items(ctx, items, source, template_id, args);
    }
    throw new Error(`mailbox: add_items returned ${added} for a list to add`);
  }

  /** `ClaimMail` steps 2 to 4 on one mail. A failure code leaves the caller to roll back. */
  function claim(ctx: RequestCtx, mail: CoreContract.MailUserState): Pass | FailureCode {
    const ref = mail.id.toString();
    if (mail.attachments.length > 0) {
      const failure = ledger_failure(ledger.add_items(ctx, mail.attachments, { source: Source.ITEM_CHANGE_SOURCE_MAIL, ref, once_key: `mail:${ref}` }));
      if (failure !== null) return failure;
    }
    if (mail.extra_id !== 0) {
      const hook = hook_slots.grant_mail_extra;
      if (hook === null) {
        log(ctx, null, 'error', 'grant_mail_extra is not registered for a mail with extra_id', { mail_id: mail.id, extra_id: mail.extra_id });
        return CoreError.CORE_ERROR_INTERNAL;
      }
      // The hook is content code: its output is checked, not trusted to match the type.
      const out: unknown = storage.with_hook_change_source(ctx, Source.ITEM_CHANGE_SOURCE_MAIL, ref, () => hook(ctx, mail.extra_id, mail.id));
      const result = storage.check_hook_output('grant_mail_extra', out);
      if (result !== PASS) return result;
    }
    storage.delete_core_state(ctx, MAIL_KIND, mail.id);
    log(ctx, null, 'info', 'mail claimed', { mail_id: mail.id });
    return PASS;
  }

  function read_mail(ctx: RequestCtx, request: CoreContract.ReadMailRequest): CoreContract.ReadMailResponse | FailureCode {
    const mail = storage.get_state(ctx, MAIL_KIND, request.mail_id) as CoreContract.MailUserState | null;
    if (mail === null) return CoreError.CORE_ERROR_MAIL_NOT_FOUND;
    if (!mail.read) {
      const copy = copy_mail(mail);
      copy.read = true;
      storage.put_core_state(ctx, copy);
    }
    return new CoreContract.ReadMailResponse();
  }

  function claim_mail(ctx: RequestCtx, request: CoreContract.ClaimMailRequest): CoreContract.ClaimMailResponse | FailureCode {
    const mail = storage.get_state(ctx, MAIL_KIND, request.mail_id) as CoreContract.MailUserState | null;
    if (mail === null) return CoreError.CORE_ERROR_MAIL_NOT_FOUND;
    if (is_expired(ctx, mail)) return CoreError.CORE_ERROR_MAIL_EXPIRED;
    const failure = claim(ctx, mail);
    if (failure !== PASS) return failure;
    const response = new CoreContract.ClaimMailResponse();
    response.items = mail.attachments.map((item) => ledger.make_item_amount(item.item_id, ledger.read_amount(item) ?? 0n));
    return response;
  }

  function claim_all_mail(ctx: RequestCtx): CoreContract.ClaimAllMailResponse {
    const mails = storage.list_state(ctx, MAIL_KIND) as CoreContract.MailUserState[];
    const open = mails.filter((mail) => !is_expired(ctx, mail)).sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    const batch = open.slice(0, max_claim_all);
    const response = new CoreContract.ClaimAllMailResponse();
    const claimed: CoreContract.ItemAmount[] = [];
    let unclaimed = open.length - batch.length;
    for (const mail of batch) {
      if (storage.run_savepoint(ctx, () => claim(ctx, mail)) === PASS) {
        response.mail_ids.push(mail.id);
        claimed.push(...mail.attachments);
      } else {
        unclaimed += 1;
      }
    }
    response.items = sum_items(ledger, claimed);
    response.unclaimed_count = unclaimed;
    return response;
  }

  function broadcast_mail(tx: GameTx, mail_input: MailInput, start_at: bigint): BroadcastMailOutcome {
    const checked = check_mail_input(mail_input, data, limits, false, ledger_items);
    if (!checked.ok || checked.mail.once_key !== '') {
      log(null, null, 'error', 'broadcast_mail input is invalid', { reason: checked.ok ? 'once_key is not empty' : checked.reason });
      return { result: MailResult.INVALID_INPUT, broadcast_id: 0n };
    }
    if (storage.lock_game_row(tx, Tables.BROADCAST_COUNTER, [0n]) === 'FAILED') throw new Error('mailbox: the broadcast counter lock failed');
    const db = storage.db(tx);
    const broadcast_id = Tables.next_broadcast_id(db);
    const expire_ms = checked.mail.expire_ms === 0n ? default_expire_ms : checked.mail.expire_ms;
    const mail = JSON.stringify(mail_to_json({ ...checked.mail, expire_ms }));
    Tables.insert_broadcast(db, { broadcast_id, mail, start_at, cancelled: false, expires_at: start_at + expire_ms }, time.clock_now());
    return { result: MailResult.OK, broadcast_id };
  }

  function input_from_json(json: unknown): MailInput | typeof MailResult.INVALID_INPUT {
    const mail_input = mail_input_from_json(json);
    if (mail_input !== null) return mail_input;
    log(null, null, 'error', 'mail input JSON is malformed');
    return MailResult.INVALID_INPUT;
  }

  function cancel_broadcast(tx: GameTx, broadcast_id: bigint): boolean {
    if (storage.lock_game_row(tx, Tables.BROADCAST, [broadcast_id]) === 'FAILED') throw new Error('mailbox: the broadcast lock failed');
    const db = storage.db(tx);
    if (Tables.find_broadcast(db, broadcast_id, time.clock_now()) === null) return false;
    Tables.cancel_broadcast_row(db, broadcast_id);
    return true;
  }

  function cancel_mail_by_once_key(ctx: RequestCtx, once_key: string): CoreContract.ItemAmount[] {
    const db = storage.db(ctx);
    const first = Tables.find_once_key(db, ctx.user_id, once_key);
    const mail_ids = [...(first === null ? [] : [first]), ...Tables.once_key_mail_ids(db, ctx.user_id, once_key, 2)].sort((a, b) =>
      a < b ? -1 : a > b ? 1 : 0,
    );
    const out: CoreContract.ItemAmount[] = [];
    for (const mail_id of mail_ids) {
      const mail = storage.get_state(ctx, MAIL_KIND, mail_id) as CoreContract.MailUserState | null;
      if (mail === null) continue;
      storage.delete_core_state(ctx, MAIL_KIND, mail_id);
      log(ctx, null, 'info', 'mail cancelled', { mail_id, once_key });
      out.push(...mail.attachments);
    }
    return out;
  }

  /** Request start step 1: reads the mails only when `next_expires_at` is reached, then lowers it to the mails left. */
  function delete_expired(ctx: RequestCtx, db: DbHandle): void {
    const next_expires_at = Tables.read_next_expires_at(db, ctx.user_id);
    if (next_expires_at === 0n || !time.is_reached_strict(ctx, next_expires_at)) return;
    let lowest = 0n;
    for (const mail of storage.list_state(ctx, MAIL_KIND) as CoreContract.MailUserState[]) {
      if (is_expired(ctx, mail)) storage.delete_core_state(ctx, MAIL_KIND, mail.id);
      else if (mail.expires_at !== 0n && (lowest === 0n || mail.expires_at < lowest)) lowest = mail.expires_at;
    }
    Tables.set_next_expires_at(db, ctx.user_id, lowest);
  }

  /** Request start steps 1 and 2 in the user's out-of-request change. */
  function start_request(ctx: RequestCtx): void {
    const db = storage.db(ctx);
    delete_expired(ctx, db);
    const broadcasts = Tables.active_broadcasts(db, time.now(ctx), time.clock_now());
    const once_keys = broadcasts.map((row) => `broadcast:${row.broadcast_id.toString()}`);
    const sent_keys = Tables.find_once_keys(db, ctx.user_id, once_keys);
    for (const [index, row] of broadcasts.entries()) {
      const once_key = once_keys[index] ?? '';
      if (sent_keys.has(once_key)) continue;
      const mail_input = mail_input_from_json(JSON.parse(row.mail));
      const sent = mail_input === null ? null : send_mail(ctx, { ...mail_input, once_key }, false);
      if (sent === null || sent.result === MailResult.INVALID_INPUT) {
        log(ctx, null, 'error', 'broadcast mail input is invalid: the broadcast is skipped', { broadcast_id: row.broadcast_id });
      }
    }
  }

  async function on_request_start(user_id: bigint): Promise<null> {
    try {
      const result = await storage.run_user_transaction(user_id, (ctx) => {
        start_request(ctx);
        return PASS;
      });
      if (result === 'FAILED' || result === 'REJECTED') log(null, user_id, 'error', 'mailbox request start failed', { result });
    } catch (error) {
      log(null, user_id, 'error', 'mailbox request start failed', { stack_trace: stack_of(error) });
    }
    return null;
  }

  /** Throws with an `error` log when content code passes a core `once_key` prefix. */
  function refuse_core_once_key(ctx: RequestCtx, operation: string, once_key: unknown): void {
    if (!has_core_once_key_prefix(once_key)) return;
    log(ctx, null, 'error', `content code passed a once_key with a core once_key prefix to ${operation}`, { once_key: String(once_key) });
    throw new Error(`mailbox: content once_key of ${operation} starts with a core once_key prefix`);
  }

  /** A core module's change source: `source` as given, `ref` and `once_key` left out are the empty string. */
  function core_source(source: ChangeSourceInput): ChangeSource {
    return { source: source.source ?? Source.ITEM_CHANGE_SOURCE_UNSPECIFIED, ref: source.ref ?? '', once_key: source.once_key ?? '' };
  }

  const content: MailboxContent = {
    send_mail: (ctx, mail_input) => {
      refuse_core_once_key(ctx, 'send_mail', (mail_input as Partial<MailInput> | null)?.once_key);
      return send_mail(ctx, mail_input, false);
    },
    grant_or_mail: (ctx, items, source, template_id, args) => {
      refuse_core_once_key(ctx, 'grant_or_mail', source.once_key);
      return grant_or_mail(ctx, items, content_change_source(ctx, source), template_id, args);
    },
  };

  return {
    send_mail: (ctx, mail_input) => send_mail(ctx, mail_input, false),
    grant_or_mail: (ctx, items, source, template_id, args) => grant_or_mail(ctx, items, core_source(source), template_id, args),
    broadcast_mail,
    mail_input_from_json: input_from_json,
    cancel_mail_by_once_key,
    cancel_broadcast,
    on_request_start,
    ReadMail: read_mail,
    ClaimMail: claim_mail,
    ClaimAllMail: (ctx) => claim_all_mail(ctx),
    content,
    hook_slots,
    begin_start: () => {},
    complete_start: () => start_failure,
    stop: () => {},
  };
}
