/**
 * shop: buying the products of `shop_product` with game items, their sale conditions (`start_at` and `end_at`, live
 * event, requirement, offer), purchase limits and the reset of purchase counts.
 */
import * as CoreContract from '../../generated/contract/core_contract.ts';
import * as GameData from '../../generated/data/game_data.ts';
import { change_failure_code, type ItemChangeOutcome } from '../item-ledger/index.ts';
import type { Logging } from '../logging/index.ts';
import type { Pass, RequestCtx, Storage } from '../storage/index.ts';

/** The `storage` operations shop calls. */
export type ShopStorage = Pick<Storage, 'get_state' | 'put_core_state' | 'with_hook_change_source' | 'check_hook_output'>;

/** The `logging` operation shop calls. */
export type ShopLogging = Pick<Logging, 'track_core_event'>;

/** A change source of `item-ledger`: `{source, ref, once_key}`. */
export interface ShopChangeSource {
  readonly source: CoreContract.ItemChangeSource;
  readonly ref: string;
  readonly once_key: string;
}

/** The `item-ledger` operations shop calls. A failure is an `ItemChangeResult` element name or a `GameError`. */
export interface ShopItemLedger {
  amount_limit(item_id: number): bigint;
  read_amount(item: CoreContract.ItemAmount): bigint | null;
  make_item_amount(item_id: number, amount: bigint): CoreContract.ItemAmount;
  subtract_items(ctx: RequestCtx, items: readonly CoreContract.ItemAmount[], source: ShopChangeSource): ItemChangeOutcome;
  /** The `ItemAddPreviewRow` of each item, or an `ItemChangeResult` failure element. shop reads `outcome` only. */
  preview_add_items(ctx: RequestCtx, items: readonly CoreContract.ItemAmount[]): readonly { readonly outcome: string }[] | string;
}

/** The `mailbox` operation shop calls. */
export interface ShopMailbox {
  grant_or_mail(
    ctx: RequestCtx,
    items: readonly CoreContract.ItemAmount[],
    source: ShopChangeSource,
    template_id: number,
    args: readonly unknown[],
  ): { readonly result: string | number };
}

/** The `live-event` operations shop calls. An absent value is `null`; an absent `live_event` of the round reset is 0. */
export interface ShopLiveEvent {
  is_in_active_window(ctx: RequestCtx, start_at: bigint | null, end_at: bigint | null, live_event: number | null): boolean;
  round_to_write(ctx: RequestCtx, live_event: number): number;
}

/** A purchase count row as `offer.read_purchase_limit` reads it, with the `reset_at` to write when the count goes up. */
export interface ShopPurchaseLimit {
  readonly count: number;
  readonly reset_at: bigint;
  readonly event_round: number;
  readonly write_reset_at: bigint;
}

/** The `offer` operations shop calls. */
export interface ShopOffer {
  is_offer_active(ctx: RequestCtx, offer_id: number): boolean;
  /** `offer_id` and `live_event` 0 are none; a row that is not stored is `count`, `reset_at` and `event_round` 0. */
  read_purchase_limit(
    ctx: RequestCtx,
    offer_id: number,
    reset: GameData.ResetCycle | null,
    live_event: number,
    count: number,
    reset_at: bigint,
    event_round: number,
  ): ShopPurchaseLimit;
}

/** The `validation` operation shop calls. */
export interface ShopValidation {
  evaluate_requirement(ctx: RequestCtx, requirement_id: number): { readonly passed: boolean };
}

/** What shop reads of the `server` object of the module input. */
export interface ShopServer {
  /** The server build data: server start checks the `shop_product` rows of `extra_grant`. */
  readonly data: GameData.DataSet;
}

/** The module input (`server-core` `## module`). shop has no settings. */
export interface ShopInput {
  readonly settings: Readonly<Record<string, unknown>>;
  readonly modules: Readonly<Record<string, unknown>>;
  readonly server: ShopServer;
}

/** `validate_shop_purchase` and `grant_shop_extra`: `pass` or a `GameError`. */
export type ShopProductHook = (ctx: RequestCtx, product_id: number, quantity: number) => Pass | number;
/** `on_shop_bought` (after hook). Its output is none; any other output is a wrong output form. */
export type OnShopBoughtHook = (ctx: RequestCtx, product_id: number, quantity: number) => unknown;

/** The hook slots `routing` fills with the hooks `register_hook` got; an empty slot is `null`. */
export interface ShopHookSlots {
  validate_shop_purchase: ShopProductHook | null;
  grant_shop_extra: ShopProductHook | null;
  on_shop_bought: OnShopBoughtHook | null;
}

/** A failure of a shop operation: a `CoreError`, or the `GameError` of a hook or of `item-ledger`. */
export type ShopFailure = number;

/** The handler of the core `rpc` `BuyShopProduct`. */
export type BuyShopProductHandler = (ctx: RequestCtx, request: CoreContract.BuyShopProductRequest) => CoreContract.BuyShopProductResponse | ShopFailure;

export interface ShopModule {
  /** core `rpc` `BuyShopProduct`, exported to `routing`. */
  readonly BuyShopProduct: BuyShopProductHandler;
  get_purchase_count(ctx: RequestCtx, product_id: number): number;
  readonly hook_slots: ShopHookSlots;
  begin_start(): void;
  complete_start(): string | null;
  stop(): void;
}

const E = CoreContract.CoreError;
const SHOP_SOURCE = CoreContract.ItemChangeSource.ITEM_CHANGE_SOURCE_SHOP;
const INT32_MAX = 2 ** 31 - 1;

interface ShopModules {
  readonly 'item-ledger': ShopItemLedger;
  readonly mailbox: ShopMailbox;
  readonly 'live-event': ShopLiveEvent;
  readonly offer: ShopOffer;
  readonly validation: ShopValidation;
  readonly storage: ShopStorage;
  readonly logging: ShopLogging;
}

const DEPENDENCIES = ['item-ledger', 'mailbox', 'live-event', 'offer', 'validation', 'storage', 'logging'] as const;

function modules_of(modules: Readonly<Record<string, unknown>>): ShopModules {
  for (const name of DEPENDENCIES) {
    if (modules[name] === undefined || modules[name] === null) throw new TypeError(`shop: module ${name} is missing`);
  }
  return modules as unknown as ShopModules;
}

/** A purchase that passed steps 1 to 3 of the purchase order. */
interface Purchase {
  readonly ctx: RequestCtx;
  readonly product_id: number;
  readonly product: GameData.ShopProductRow;
  readonly quantity: number;
  /** The change source `ref`: the product ID value in decimal. */
  readonly ref: string;
  /** `cost` × quantity. */
  readonly cost: readonly CoreContract.ItemAmount[];
  /** `reward` × quantity. */
  readonly reward: CoreContract.ItemAmount[];
  readonly read: ShopPurchaseLimit;
  readonly accept_loss: boolean;
}

export function create_shop(input: ShopInput): ShopModule {
  const deps = modules_of(input.modules);
  const ledger = deps['item-ledger'];
  const mailbox = deps.mailbox;
  const live_event = deps['live-event'];
  const offer = deps.offer;
  const validation = deps.validation;
  const storage = deps.storage;
  const logging = deps.logging;
  const data = input.server.data;
  const hook_slots: ShopHookSlots = { validate_shop_purchase: null, grant_shop_extra: null, on_shop_bought: null };

  /** Each amount of a bundle times the quantity, or null when a product is over the amount limit of its item. */
  function bundle_times(bundle: readonly CoreContract.ItemAmount[], quantity: number): CoreContract.ItemAmount[] | null {
    const items: CoreContract.ItemAmount[] = [];
    for (const entry of bundle) {
      const amount = ledger.read_amount(entry);
      if (amount === null) return null;
      const value = amount * BigInt(quantity);
      if (value > ledger.amount_limit(entry.item_id)) return null;
      items.push(ledger.make_item_amount(entry.item_id, value));
    }
    return items;
  }

  /** The stored row read with `offer.read_purchase_limit`: the round reset, the offer purchase reset, the lazy reset. */
  function read_count(ctx: RequestCtx, product_id: number, product: GameData.ShopProductRow): ShopPurchaseLimit {
    const row = storage.get_state(ctx, CoreContract.ShopPurchaseUserState, BigInt(product_id)) as CoreContract.ShopPurchaseUserState | null;
    const reset = product.reset === GameData.ResetCycle.None ? null : product.reset;
    return offer.read_purchase_limit(ctx, product.offer, reset, product.live_event, row?.count ?? 0, row?.reset_at ?? 0n, row?.event_round ?? 0);
  }

  function save_count(ctx: RequestCtx, product_id: number, product: GameData.ShopProductRow, read: ShopPurchaseLimit, quantity: number): void {
    const state = new CoreContract.ShopPurchaseUserState();
    state.id = BigInt(product_id);
    state.count = Math.min(read.count + quantity, INT32_MAX);
    state.reset_at = read.write_reset_at;
    state.event_round = live_event.round_to_write(ctx, product.live_event);
    storage.put_core_state(ctx, state);
  }

  /** Runs a content hook in the change source of the purchase (`server-core` `## request`). */
  function in_source<T>(ctx: RequestCtx, product_id: number, fn: () => T): T {
    return storage.with_hook_change_source(ctx, SHOP_SOURCE, String(product_id), fn);
  }

  function on_sale(ctx: RequestCtx, product: GameData.ShopProductRow): boolean {
    const window = live_event.is_in_active_window(
      ctx,
      product.start_at === 0n ? null : product.start_at,
      product.end_at === 0n ? null : product.end_at,
      product.live_event === 0 ? null : product.live_event,
    );
    return window && (product.offer === 0 || offer.is_offer_active(ctx, product.offer));
  }

  /** Steps 1 to 3 of the purchase order: the request, the sale condition and the purchase limit. */
  function prepare(ctx: RequestCtx, request: CoreContract.BuyShopProductRequest): Purchase | ShopFailure {
    const product_id = request.product_id;
    const quantity = request.quantity;
    if (!ctx.data.ShopProductTable.has_row(product_id)) return E.CORE_ERROR_INVALID_REQUEST;
    const product = ctx.data.ShopProductTable.get_row(product_id);
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > product.max_quantity) return E.CORE_ERROR_INVALID_REQUEST;
    const cost = bundle_times(product.cost, quantity);
    const reward = bundle_times(product.reward, quantity);
    if (cost === null || reward === null) return E.CORE_ERROR_INVALID_REQUEST;
    if (!on_sale(ctx, product)) return E.CORE_ERROR_SHOP_PRODUCT_UNAVAILABLE;
    if (!validation.evaluate_requirement(ctx, product.requirement).passed) return E.CORE_ERROR_SHOP_PRODUCT_LOCKED;
    const read = read_count(ctx, product_id, product);
    if (product.limit_count !== 0 && read.count + quantity > product.limit_count) return E.CORE_ERROR_SHOP_LIMIT_REACHED;
    return { ctx, product_id, product, quantity, ref: String(product_id), cost, reward, read, accept_loss: request.accept_loss };
  }

  /** Steps 4 and 8: a `pass`-or-`GameError` hook in the change source of the purchase. */
  function call_product_hook(p: Purchase, name: 'validate_shop_purchase' | 'grant_shop_extra', hook: ShopProductHook): Pass | ShopFailure {
    return in_source(p.ctx, p.product_id, () => storage.check_hook_output(`shop.${name}`, hook(p.ctx, p.product_id, p.quantity)));
  }

  /** Step 5: the cost. */
  function pay(p: Purchase): Pass | ShopFailure {
    if (p.cost.length === 0) return 'pass';
    const result = ledger.subtract_items(p.ctx, p.cost, { source: SHOP_SOURCE, ref: p.ref, once_key: '' });
    return result === 'OK' ? 'pass' : change_failure_code(result);
  }

  /** Steps 6 and 7: the reward that `max_amount` would discard, on the balances after the cost, then the reward. */
  function grant(p: Purchase, response: CoreContract.BuyShopProductResponse): Pass | ShopFailure {
    if (p.reward.length === 0) return 'pass';
    const preview = ledger.preview_add_items(p.ctx, p.reward);
    if (typeof preview === 'string') return E.CORE_ERROR_INTERNAL;
    if (!p.accept_loss && preview.some((row) => row.outcome === 'Discarded')) return E.CORE_ERROR_SHOP_OVERFLOW_LOSS;
    const source = { source: SHOP_SOURCE, ref: p.ref, once_key: `shop:${p.ctx.request_id}` };
    const granted = mailbox.grant_or_mail(p.ctx, p.reward, source, p.ctx.data.ReservedId.shop_grant_mail(), []);
    if (granted.result === 'Granted') response.items = p.reward;
    else if (granted.result === 'Mailed') response.mailed = true;
    else if (granted.result !== 'AlreadyApplied') return E.CORE_ERROR_INTERNAL;
    return 'pass';
  }

  /** Step 8: the content reward of a product with `extra_grant`. */
  function grant_extra(p: Purchase): Pass | ShopFailure {
    if (!p.product.extra_grant) return 'pass';
    const extra = hook_slots.grant_shop_extra;
    return extra === null ? E.CORE_ERROR_INTERNAL : call_product_hook(p, 'grant_shop_extra', extra);
  }

  /** Steps 9 to 11: the purchase count, `on_shop_bought` and the core analytics event. */
  function finish(p: Purchase): void {
    save_count(p.ctx, p.product_id, p.product, p.read, p.quantity);
    const bought = hook_slots.on_shop_bought;
    if (bought !== null) {
      in_source(p.ctx, p.product_id, () => {
        const result = bought(p.ctx, p.product_id, p.quantity);
        if (result !== undefined && result !== null) throw new TypeError('shop: after hook on_shop_bought returned a value');
      });
    }
    logging.track_core_event(p.ctx, 'core_shop_bought', [['product_id', p.product_id], ['quantity', p.quantity]]);
  }

  const BuyShopProduct: BuyShopProductHandler = (ctx, request) => {
    const p = prepare(ctx, request);
    if (typeof p === 'number') return p;
    const validate = hook_slots.validate_shop_purchase;
    const response = new CoreContract.BuyShopProductResponse();
    for (const step of [
      () => (validate === null ? 'pass' : call_product_hook(p, 'validate_shop_purchase', validate)),
      () => pay(p),
      () => grant(p, response),
      () => grant_extra(p),
    ]) {
      const result = step();
      if (result !== 'pass') return result;
    }
    finish(p);
    return response;
  };

  return {
    BuyShopProduct,
    get_purchase_count(ctx, product_id) {
      if (!ctx.data.ShopProductTable.has_row(product_id)) return 0;
      return read_count(ctx, product_id, ctx.data.ShopProductTable.get_row(product_id)).count;
    },
    hook_slots,
    begin_start() {},
    complete_start() {
      if (hook_slots.grant_shop_extra !== null) return null;
      const ids = data.ShopProductTable.all_rows().filter((row) => row.extra_grant).map((row) => row.id);
      if (ids.length === 0) return null;
      return `shop: shop_product rows ${ids.join(', ')} have extra_grant true and content registered no grant_shop_extra hook`;
    },
    stop() {},
  };
}
