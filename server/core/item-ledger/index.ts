/** item-ledger: the only path that changes user items. */
import * as CoreContract from '../../generated/contract/core_contract.ts';
import type * as GameContract from '../../generated/contract/game_contract.ts';
import type * as GameData from '../../generated/data/game_data.ts';
import type { FailureCode, RequestCtx } from '../storage/index.ts';
import { register_tables, type HistoryRow } from './history.ts';
import { amount_of, item_info, write_big } from './items.ts';
import {
  Ledger, change_failure_code, content_change_source, has_core_once_key_prefix, type ChangeSource, type ChangeSourceInput, type ItemAddPreviewRow,
  type ItemChangeResult, type ItemLedgerHooks, type ItemShortfall, type LedgerModules, type RecoveryTimes,
} from './ledger.ts';

export type { HistoryRow } from './history.ts';
export {
  CORE_ONCE_KEY_PREFIXES, ItemAddPreview, ItemChangeResult, change_failure_code, content_change_source, has_core_once_key_prefix,
  type AfterItemChangeHook, type ChangeSource, type ChangeSourceInput, type ItemAddPreviewRow, type ItemAddReplacement, type ItemBalanceChange,
  type ItemLedgerHooks, type ItemShortfall, type LedgerModules, type RecoveryTimes, type ValidateItemChangeHook,
} from './ledger.ts';

/** What item-ledger reads of the `server` object of the module input. */
export interface ItemLedgerServer {
  /** True in a server instance with DEV code. */
  readonly dev: boolean;
  /** The server build data (`check_add_items`). */
  readonly data: GameData.DataSet;
}

/** The module input (`server-core` `## module`). */
export interface ItemLedgerInput {
  readonly settings: Readonly<Record<string, unknown>>;
  readonly modules: Readonly<Record<string, unknown>>;
  readonly server: ItemLedgerServer;
}

/** A failure value of a change: an `ItemChangeResult` failure element, or the `GameError` of `validate_item_change`. */
export type ItemChangeOutcome = ItemChangeResult | GameContract.GameError;

/** The operations content code calls (member `content`): a change source's `source` is not used. */
export interface ItemLedgerContent {
  get_balance(ctx: RequestCtx, item_id: number): bigint;
  get_ends_at(ctx: RequestCtx, item_id: number): bigint;
  get_recovery(ctx: RequestCtx, item_id: number): RecoveryTimes;
  check_items(ctx: RequestCtx, items: readonly CoreContract.ItemAmount[]): boolean;
  add_items(ctx: RequestCtx, items: readonly CoreContract.ItemAmount[], source?: ChangeSourceInput): ItemChangeOutcome;
  subtract_items(ctx: RequestCtx, items: readonly CoreContract.ItemAmount[], source?: ChangeSourceInput): ItemChangeOutcome;
  exchange_items(ctx: RequestCtx, subtract: readonly CoreContract.ItemAmount[], add: readonly CoreContract.ItemAmount[], source?: ChangeSourceInput): ItemChangeOutcome;
  preview_add_items(ctx: RequestCtx, items: readonly CoreContract.ItemAmount[]): readonly ItemAddPreviewRow[] | ItemChangeResult;
  revoke_items(ctx: RequestCtx, items: readonly CoreContract.ItemAmount[], source?: ChangeSourceInput): readonly ItemShortfall[] | ItemChangeResult;
}

/**
 * The module object: the `## API` operations as core modules call them, the exports to `routing`, the lifecycle and a
 * member the DEV code calls.
 */
export interface ItemLedger {
  get_balance(ctx: RequestCtx, item_id: number): bigint;
  get_ends_at(ctx: RequestCtx, item_id: number): bigint;
  get_recovery(ctx: RequestCtx, item_id: number): RecoveryTimes;
  check_items(ctx: RequestCtx, items: readonly CoreContract.ItemAmount[]): boolean;
  /** The amount limit of an item; 0 for an unknown item ID value. */
  amount_limit(item_id: number): bigint;
  /** The amount of an `ItemAmount`; null when `big_amount` is neither empty nor a big integer. */
  read_amount(item: CoreContract.ItemAmount): bigint | null;
  /** An `ItemAmount` with the amount in the big encoding pair. */
  make_item_amount(item_id: number, amount: bigint): CoreContract.ItemAmount;
  check_add_items(items: readonly CoreContract.ItemAmount[]): ItemChangeResult;
  /** Content code's change source by the change source rules. */
  content_change_source(ctx: RequestCtx, input?: ChangeSourceInput): ChangeSource;
  /** True when `once_key` starts with a core `once_key` prefix. */
  has_core_once_key_prefix(once_key: string): boolean;
  /** The response code of a core module request that fails on a change (`## error`). */
  change_failure_code(result: ItemChangeOutcome): FailureCode;
  add_items(ctx: RequestCtx, items: readonly CoreContract.ItemAmount[], source: ChangeSourceInput): ItemChangeOutcome;
  subtract_items(ctx: RequestCtx, items: readonly CoreContract.ItemAmount[], source: ChangeSourceInput): ItemChangeOutcome;
  exchange_items(ctx: RequestCtx, subtract: readonly CoreContract.ItemAmount[], add: readonly CoreContract.ItemAmount[], source: ChangeSourceInput): ItemChangeOutcome;
  preview_add_items(ctx: RequestCtx, items: readonly CoreContract.ItemAmount[]): readonly ItemAddPreviewRow[] | ItemChangeResult;
  revoke_items(ctx: RequestCtx, items: readonly CoreContract.ItemAmount[], source: ChangeSourceInput): readonly ItemShortfall[] | ItemChangeResult;
  list_history(user_id: bigint, from: bigint, to: bigint, after_seq: bigint, max_rows: number): readonly HistoryRow[];
  readonly content: ItemLedgerContent;
  /** The hook slots `routing` fills with the hooks `register_hook` got. */
  readonly hook_slots: ItemLedgerHooks;
  /** The ledger of this server instance. Only the module's DEV code calls it. */
  dev_ledger(): Ledger;
  begin_start(): void;
  complete_start(): string | null;
  stop(): void;
}

function integer_setting(settings: Readonly<Record<string, unknown>>, key: string): bigint {
  const value = settings[key];
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) throw new TypeError(`item-ledger: setting ${key} is not an integer`);
  return BigInt(value);
}

function modules_of(modules: Readonly<Record<string, unknown>>): LedgerModules {
  for (const name of ['storage', 'server-time', 'logging']) {
    if (modules[name] === undefined || modules[name] === null) throw new TypeError(`item-ledger: module ${name} is missing`);
  }
  return modules as unknown as LedgerModules;
}

function make_item_amount(item_id: number, amount: bigint): CoreContract.ItemAmount {
  const item = new CoreContract.ItemAmount();
  const { small, big } = write_big(amount);
  item.item_id = item_id;
  item.amount = small;
  item.big_amount = big;
  return item;
}

export function create_item_ledger(input: ItemLedgerInput): ItemLedger {
  const deps = modules_of(input.modules);
  const ledger = new Ledger(integer_setting(input.settings, 'item-ledger.historyRetentionMs'), deps, input.server.dev);
  const data = input.server.data;
  register_tables(deps.storage);
  const content: ItemLedgerContent = {
    get_balance: (ctx, id) => ledger.get_balance(ctx, id),
    get_ends_at: (ctx, id) => ledger.get_ends_at(ctx, id),
    get_recovery: (ctx, id) => ledger.get_recovery(ctx, id),
    check_items: (ctx, items) => ledger.check_items(ctx, items),
    add_items: (ctx, items, source) => ledger.change(ctx, 'add_items', [], items, source, 'content'),
    subtract_items: (ctx, items, source) => ledger.change(ctx, 'subtract_items', items, [], source, 'content'),
    exchange_items: (ctx, subtract, add, source) => ledger.change(ctx, 'exchange_items', subtract, add, source, 'content'),
    preview_add_items: (ctx, items) => ledger.preview(ctx, items),
    revoke_items: (ctx, items, source) => ledger.revoke(ctx, items, source, 'content'),
  };
  return {
    get_balance: (ctx, id) => ledger.get_balance(ctx, id),
    get_ends_at: (ctx, id) => ledger.get_ends_at(ctx, id),
    get_recovery: (ctx, id) => ledger.get_recovery(ctx, id),
    check_items: (ctx, items) => ledger.check_items(ctx, items),
    amount_limit: (item_id) => item_info(data, item_id)?.amount_limit ?? 0n,
    read_amount: (item) => amount_of(item),
    make_item_amount: (item_id, amount) => make_item_amount(item_id, amount),
    check_add_items: (items) => ledger.check_add(data, items),
    content_change_source: (ctx, source) => content_change_source(ctx, source),
    has_core_once_key_prefix: (once_key) => has_core_once_key_prefix(once_key),
    change_failure_code: (result) => change_failure_code(result),
    add_items: (ctx, items, source) => ledger.change(ctx, 'add_items', [], items, source, 'core'),
    subtract_items: (ctx, items, source) => ledger.change(ctx, 'subtract_items', items, [], source, 'core'),
    exchange_items: (ctx, subtract, add, source) => ledger.change(ctx, 'exchange_items', subtract, add, source, 'core'),
    preview_add_items: (ctx, items) => ledger.preview(ctx, items),
    revoke_items: (ctx, items, source) => ledger.revoke(ctx, items, source, 'core'),
    list_history: (user_id, from, to, after_seq, max_rows) => ledger.list_history(user_id, from, to, after_seq, max_rows),
    content,
    hook_slots: ledger.hooks,
    dev_ledger: () => ledger,
    begin_start: () => {},
    complete_start: () => null,
    stop: () => {},
  };
}
