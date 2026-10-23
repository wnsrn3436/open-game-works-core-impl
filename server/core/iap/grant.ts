/**
 * The grant order (`### grant order` 4 to 9), ownership transfer, subscription apply and recompute, and the `REFUND`
 * processing order. Everything here runs inside a user transaction and is synchronous.
 */
import * as CoreContract from '../../generated/contract/core_contract.ts';
import type * as GameData from '../../generated/data/game_data.ts';
import type { GameTx, RequestCtx } from '../storage/index.ts';
import type { StoreTransaction, SubscriptionSnapshot, VerifyStatus } from './adapter.ts';
import {
  CoreError,
  grant_once_key,
  is_entitled_state,
  is_failure_code,
  ItemChangeSource,
  log,
  log_user,
  product_by_sku,
  ProductType,
  PurchaseStatus,
  state_name,
  state_of_name,
  store_name,
  type IapContext,
  type Store,
} from './context.ts';
import { add_purchase, remove_purchase } from './purchase_count.ts';
import {
  BINDING,
  count_granted_of_user,
  has_other_done_of_original,
  PAYMENT,
  select_account_token_user,
  select_binding,
  select_payment,
  select_subscription,
  select_subscriptions_of_product,
  upsert_binding,
  upsert_other_user,
  upsert_payment,
  upsert_subscription,
  type BindingRow,
  type PaymentRow,
  type SubscriptionRow,
} from './tables.ts';

type CoreErrorValue = CoreContract.CoreError;
type Pass = 'pass';

/** What `prepare_verify_purchase` hands the handler (grant order 1 to 3). */
export interface PrepareValue {
  readonly store: Store;
  readonly status: VerifyStatus;
  readonly transaction: StoreTransaction | null;
  readonly snapshot: SubscriptionSnapshot | null;
}

/** The handler result of `VerifyPurchase` and `RecoverPurchase`. */
export interface VerifyOutcome {
  readonly status: CoreContract.PurchaseStatus;
  readonly product_id: number;
  readonly items: readonly CoreContract.ItemAmount[];
}

const MAX_SAFE = 2n ** 53n - 1n;
const PRINTABLE_ASCII = /^[\x20-\x7e]+$/;

function amount_of(item: CoreContract.ItemAmount): bigint {
  return item.big_amount !== '' ? BigInt(item.big_amount) : item.amount;
}

function item_amount(item_id: number, amount: bigint): CoreContract.ItemAmount {
  const out = new CoreContract.ItemAmount();
  out.item_id = item_id;
  if (amount > MAX_SAFE) out.big_amount = amount.toString(10);
  else out.amount = amount;
  return out;
}

/** The revoke list (`## hook`): `reward` minus the items of the mails just cancelled, by item ID value; amounts at or below 0 are left out. */
export function revoke_list(reward: readonly CoreContract.ItemAmount[], cancelled: readonly CoreContract.ItemAmount[]): CoreContract.ItemAmount[] {
  const taken = new Map<number, bigint>();
  for (const item of cancelled) taken.set(item.item_id, (taken.get(item.item_id) ?? 0n) + amount_of(item));
  const out: CoreContract.ItemAmount[] = [];
  for (const item of reward) {
    const left = amount_of(item) - (taken.get(item.item_id) ?? 0n);
    taken.delete(item.item_id);
    if (left > 0n) out.push(item_amount(item.item_id, left));
  }
  return out;
}

function now_of(c: IapContext, ctx: RequestCtx): bigint {
  return c.m.time.now(ctx);
}

function db_of(c: IapContext, ctx: RequestCtx) {
  return c.m.storage.db(ctx);
}

/** The product of a payment record: by product ID value, else by SKU; null when data has neither. */
export function product_of_record(data: GameData.DataSet, store: Store, rec: { product_id: number; sku: string }): GameData.IapProductRow | null {
  const table = data.IapProductTable;
  if (rec.product_id !== 0 && table.has_row(rec.product_id)) return table.get_row(rec.product_id);
  return product_by_sku(data, store, rec.sku);
}

/**
 * Grant order 7: `reward` by `mailbox.grant_or_mail` and hook `grant_iap_extra`. A failure is an `error` log and
 * `INTERNAL`; the caller rolls back.
 */
function give(c: IapContext, ctx: RequestCtx, product: GameData.IapProductRow, transaction_id: string, once_key: string): Pass | CoreErrorValue {
  if (product.reward.length > 0) {
    const source = { source: ItemChangeSource.ITEM_CHANGE_SOURCE_IAP, ref: transaction_id, once_key };
    const result = c.m.mailbox.grant_or_mail(ctx, product.reward, source, ctx.data.ReservedId.iap_grant_mail(), []);
    if (result.result !== 'Granted' && result.result !== 'AlreadyApplied' && result.result !== 'Mailed') {
      log(c, ctx, 'error', 'error', 'iap grant_or_mail failed', { product_id: product.id, result: result.result });
      return CoreError.CORE_ERROR_INTERNAL;
    }
  }
  if (product.extra_grant) {
    const hook = c.hooks.grant_iap_extra;
    if (hook === null) {
      log(c, ctx, 'error', 'error', 'iap hook grant_iap_extra is not registered', { product_id: product.id });
      return CoreError.CORE_ERROR_INTERNAL;
    }
    let out: unknown;
    try {
      out = c.m.storage.with_hook_change_source(ctx, ItemChangeSource.ITEM_CHANGE_SOURCE_IAP, transaction_id, () => hook(ctx, product.id, transaction_id));
    } catch (error) {
      log(c, ctx, 'error', 'error', 'iap hook grant_iap_extra threw', { product_id: product.id, stack_trace: error instanceof Error ? (error.stack ?? error.message) : String(error) });
      return CoreError.CORE_ERROR_INTERNAL;
    }
    if (out !== 'pass') {
      log(c, ctx, 'error', 'error', is_failure_code(out) ? 'iap hook grant_iap_extra failed' : 'iap hook grant_iap_extra gave an output that is not pass or a GameError', {
        product_id: product.id,
        game_error: is_failure_code(out) ? out : null,
      });
      return CoreError.CORE_ERROR_INTERNAL;
    }
  }
  return 'pass';
}

/** What grant order 7 and 8 need of a store transaction. */
interface GrantInput {
  readonly store: Store;
  readonly transaction_id: string;
  readonly original_transaction_id: string;
  readonly sku: string;
  readonly purchased_at: bigint;
  readonly test: boolean;
  readonly product: GameData.IapProductRow;
  /** The `transfer_count` of the payment record (0 for a new record). */
  readonly transfer_count: number;
  /** The subscription snapshot to apply in grant order 8; null inside a subscription apply. */
  readonly snapshot: SubscriptionSnapshot | null;
}

/** True when another payment record of the same subscription (another transaction ID) is `GRANTED` or `REFUNDED`. */
function is_renewal(c: IapContext, ctx: RequestCtx, g: GrantInput): boolean {
  if (g.product.type !== ProductType.Subscription) return false;
  return has_other_done_of_original(db_of(c, ctx), store_name(g.store), g.original_transaction_id, g.transaction_id, c.m.time.clock_now());
}

/** Grant order 7 and 8. */
function grant_and_record(c: IapContext, ctx: RequestCtx, g: GrantInput): Pass | CoreErrorValue {
  const given = give(c, ctx, g.product, g.transaction_id, grant_once_key(g.store, g.transaction_id, g.transfer_count));
  if (given !== 'pass') return given;
  const renewal = is_renewal(c, ctx, g);
  const counted = add_purchase(c, ctx, g.product);
  if (g.product.limit_count > 0 && counted.count > g.product.limit_count) {
    log(c, ctx, 'core', 'warn', 'iap granted a store transaction over limit_count', { product_id: g.product.id, count: counted.count, limit_count: g.product.limit_count });
  }
  const db = db_of(c, ctx);
  const rec: PaymentRow = {
    store: store_name(g.store),
    transaction_id: g.transaction_id,
    original_transaction_id: g.original_transaction_id,
    user_id: ctx.user_id,
    sku: g.sku,
    product_id: g.product.id,
    spend_amount: g.product.spend_amount,
    purchased_at: g.purchased_at,
    verified_at: now_of(c, ctx),
    result: 'GRANTED',
    test: g.test,
    reset_at: counted.reset_at,
    event_round: counted.event_round,
    transfer_count: g.transfer_count,
    delete_at: null,
  };
  upsert_payment(db, rec);
  if (g.product.type === ProductType.Subscription) {
    upsert_binding(db, { store: rec.store, original_transaction_id: g.original_transaction_id, user_id: ctx.user_id, delete_at: null });
    if (g.snapshot !== null) {
      const applied = subscription_apply(c, ctx, g.store, g.original_transaction_id, g.snapshot);
      if (applied !== 'pass') return applied;
    }
  }
  if (g.test) {
    log(c, ctx, 'audit', 'info', 'iap granted a test transaction', { reason: 'iap_test_grant', store: rec.store, transaction_id: g.transaction_id, product_id: g.product.id });
  }
  c.m.logging.track_core_event(ctx, 'core_iap_granted', [
    ['product_id', g.product.id],
    ['store', rec.store],
    ['spend_amount', rec.spend_amount],
    ['test', g.test],
    ['renewal', renewal],
  ]);
  return 'pass';
}

/** Byte order of `(store, original transaction ID)`. */
function key_order(a: SubscriptionRow, b: SubscriptionRow): number {
  return Buffer.compare(Buffer.from(a.store, 'utf8'), Buffer.from(b.store, 'utf8')) || Buffer.compare(Buffer.from(a.original_transaction_id, 'utf8'), Buffer.from(b.original_transaction_id, 'utf8'));
}

function latest(rows: readonly SubscriptionRow[]): SubscriptionRow | null {
  let best: SubscriptionRow | null = null;
  for (const row of rows) {
    if (best === null || row.ends_at > best.ends_at || (row.ends_at === best.ends_at && key_order(row, best) < 0)) best = row;
  }
  return best;
}

/** Subscription recompute (ctx user, product): writes or deletes the `SubscriptionUserState` row. */
export function subscription_recompute(c: IapContext, ctx: RequestCtx, product_id: number): void {
  const rows = select_subscriptions_of_product(db_of(c, ctx), ctx.user_id, product_id, c.m.time.clock_now());
  const now = now_of(c, ctx);
  const entitled = rows.filter((row) => is_entitled_state(state_of_name(row.state)) && now < row.ends_at);
  const pick = latest(entitled.length > 0 ? entitled : rows);
  if (pick === null) {
    c.m.storage.delete_core_state(ctx, CoreContract.SubscriptionUserState, BigInt(product_id));
    return;
  }
  const state = new CoreContract.SubscriptionUserState();
  state.id = BigInt(product_id);
  state.state = state_of_name(pick.state);
  state.ends_at = pick.ends_at;
  state.auto_renew = pick.auto_renew;
  c.m.storage.put_core_state(ctx, state);
}

/** The `revoke_test_grant` subscription change: writes `REVOKED` with `ends_at`, then subscription recompute. */
export function revoke_subscription(c: IapContext, ctx: RequestCtx, sub: SubscriptionRow, ends_at: bigint): void {
  upsert_subscription(db_of(c, ctx), { ...sub, state: 'SUBSCRIPTION_STATE_REVOKED', ends_at, updated_at: now_of(c, ctx) });
  subscription_recompute(c, ctx, sub.product_id);
}

/**
 * Only ownership transfer moves a subscription. The user other than `user_id` whose the subscription record or its
 * binding is (`### subscription`, another user's subscription), or null.
 */
export function other_subscription_owner(user_id: bigint, binding: BindingRow | null, sub: SubscriptionRow | null): bigint | null {
  if (sub !== null && sub.user_id !== user_id) return sub.user_id;
  if (binding !== null && binding.user_id !== user_id) return binding.user_id;
  return null;
}

/** What another user C's change after the commit does to C's subscription: subscription apply, or the `revoke_test_grant` change. */
export type OtherSubscriptionChange = { readonly kind: 'apply'; readonly snapshot: SubscriptionSnapshot } | { readonly kind: 'revoke'; readonly ends_at: bigint };

/** C's out-of-request change. It changes nothing when the subscription record or its binding is no longer C's. Failure is an `error` log only. */
function change_other_subscription(c: IapContext, owner: bigint, store: Store, original_transaction_id: string, change: OtherSubscriptionChange): Promise<void> {
  return c.m.storage
    .run_user_transaction(owner, (ctx) => {
      if (change.kind === 'apply') return apply_subscription(c, ctx, store, original_transaction_id, change.snapshot, false);
      if (c.m.storage.lock_game_row(ctx, BINDING, [store_name(store), original_transaction_id]) === 'FAILED') return CoreError.CORE_ERROR_INTERNAL;
      const db = db_of(c, ctx);
      const now = c.m.time.clock_now();
      const sub = select_subscription(db, store_name(store), original_transaction_id, now);
      if (sub === null || other_subscription_owner(ctx.user_id, select_binding(db, store_name(store), original_transaction_id, now), sub) !== null) return 'pass';
      revoke_subscription(c, ctx, sub, change.ends_at);
      return 'pass';
    })
    .then(
      (result) => {
        if (result === 'REJECTED' || result === 'FAILED') log_user(c, owner, 'error', 'error', 'iap change of the subscription of another user failed', { store: store_name(store), change: change.kind, result });
      },
      (error: unknown) => {
        log_user(c, owner, 'error', 'error', 'iap change of the subscription of another user threw', {
          store: store_name(store),
          change: change.kind,
          stack_trace: error instanceof Error ? (error.stack ?? error.message) : String(error),
        });
      },
    );
}

/**
 * Another user's subscription: changes nothing in the transaction of `ctx_or_tx` and, after its commit, opens the owner
 * C's out-of-request change that makes `change`.
 */
export function change_other_subscription_after_commit(c: IapContext, ctx_or_tx: RequestCtx | GameTx, owner: bigint, store: Store, original_transaction_id: string, change: OtherSubscriptionChange): void {
  c.m.storage.after_commit(ctx_or_tx, () => change_other_subscription(c, owner, store, original_transaction_id, change));
}

/**
 * Locks the snapshot's latest transaction row and then the binding row (grant order 4) and reads the subscription
 * record. `other` is the user the binding or the record belongs to when it is not the ctx user.
 */
function lock_own_subscription(c: IapContext, ctx: RequestCtx, store: Store, original_transaction_id: string, snapshot: SubscriptionSnapshot): { before: SubscriptionRow | null } | { other: bigint } | 'FAILED' {
  const db = db_of(c, ctx);
  const now = c.m.time.clock_now();
  if (!lock_grant_rows(c, ctx, store, '', snapshot.latest_transaction_id, () => original_transaction_id)) return 'FAILED';
  const binding = select_binding(db, store_name(store), original_transaction_id, now);
  const before = select_subscription(db, store_name(store), original_transaction_id, now);
  const other = other_subscription_owner(ctx.user_id, binding, before);
  return other === null ? { before } : { other };
}

/**
 * Subscription apply (`### subscription`) in the ctx user's transaction. For another user's subscription it changes
 * nothing and makes the subscription apply in that user's change after the commit.
 */
export function subscription_apply(c: IapContext, ctx: RequestCtx, store: Store, original_transaction_id: string, snapshot: SubscriptionSnapshot): Pass | CoreErrorValue {
  return apply_subscription(c, ctx, store, original_transaction_id, snapshot, true);
}

/** Subscription apply; with `follow` false, another user's subscription is left as it is (the change after the commit itself). */
function apply_subscription(c: IapContext, ctx: RequestCtx, store: Store, original_transaction_id: string, store_snapshot: SubscriptionSnapshot, follow: boolean): Pass | CoreErrorValue {
  const snapshot = at_request_time(store_snapshot, now_of(c, ctx));
  const product = product_by_sku(ctx.data, store, snapshot.sku);
  if (product === null || product.type !== ProductType.Subscription) {
    log(c, ctx, 'error', 'error', 'iap subscription snapshot SKU is not a Subscription product', { store: store_name(store), sku: snapshot.sku });
    return 'pass';
  }
  const own = lock_own_subscription(c, ctx, store, original_transaction_id, snapshot);
  if (own === 'FAILED') return CoreError.CORE_ERROR_INTERNAL;
  if ('other' in own) {
    // The snapshot as the store gave it: C's change fills a purchase time the store did not give with C's request time.
    if (follow) change_other_subscription_after_commit(c, ctx, own.other, store, original_transaction_id, { kind: 'apply', snapshot: store_snapshot });
    return 'pass';
  }
  const db = db_of(c, ctx);
  if (snapshot.latest_transaction_id !== '' && select_payment(db, store_name(store), snapshot.latest_transaction_id, c.m.time.clock_now()) === null) {
    const granted = grant_and_record(c, ctx, {
      store,
      transaction_id: snapshot.latest_transaction_id,
      original_transaction_id,
      sku: snapshot.sku,
      purchased_at: snapshot.purchased_at,
      test: snapshot.test,
      product,
      transfer_count: 0,
      snapshot: null,
    });
    if (granted !== 'pass') return granted;
  }
  upsert_subscription(db, {
    store: store_name(store),
    original_transaction_id,
    user_id: ctx.user_id,
    product_id: product.id,
    state: state_name(snapshot.state),
    ends_at: snapshot.ends_at,
    auto_renew: snapshot.auto_renew,
    updated_at: now_of(c, ctx),
    delete_at: null,
  });
  if (own.before !== null && own.before.product_id !== product.id) subscription_recompute(c, ctx, own.before.product_id);
  subscription_recompute(c, ctx, product.id);
  return 'pass';
}

/** Hook `revoke_iap`, or its default `item-ledger.revoke_items`, in the change source of the reason. */
export function revoke(c: IapContext, ctx: RequestCtx, product: GameData.IapProductRow, transaction_id: string, reason: 'refund' | 'transfer', items: readonly CoreContract.ItemAmount[]): Pass | CoreErrorValue {
  const source = reason === 'refund' ? ItemChangeSource.ITEM_CHANGE_SOURCE_IAP_REFUND : ItemChangeSource.ITEM_CHANGE_SOURCE_IAP_TRANSFER;
  const hook = c.hooks.revoke_iap;
  if (hook !== null) {
    try {
      c.m.storage.with_hook_change_source(ctx, source, transaction_id, () => hook(ctx, product.id, transaction_id, reason, items));
    } catch (error) {
      log(c, ctx, 'error', 'error', 'iap hook revoke_iap threw', { product_id: product.id, stack_trace: error instanceof Error ? (error.stack ?? error.message) : String(error) });
      return CoreError.CORE_ERROR_INTERNAL;
    }
    return 'pass';
  }
  if (items.length === 0) return 'pass';
  const result = c.m.item_ledger.revoke_items(ctx, items, { source, ref: transaction_id, once_key: '' });
  if (typeof result === 'string') {
    log(c, ctx, 'error', 'error', 'iap revoke_items failed', { product_id: product.id, result });
    return CoreError.CORE_ERROR_INTERNAL;
  }
  return 'pass';
}

/**
 * `REFUND` processing order 1 to 4 for a `GRANTED` payment record of the ctx user: cancels the unclaimed grant mails,
 * revokes, marks the record `REFUNDED`, takes the purchase count and pass days back, `core_iap_refunded`, `audit` log.
 */
export function refund_record(c: IapContext, ctx: RequestCtx, store: Store, rec: PaymentRow, audit_reason: string): Pass | CoreErrorValue {
  const product = product_of_record(ctx.data, store, rec);
  const cancelled = c.m.mailbox.cancel_mail_by_once_key(ctx, grant_once_key(store, rec.transaction_id, rec.transfer_count));
  if (product !== null) {
    const revoked = revoke(c, ctx, product, rec.transaction_id, 'refund', revoke_list(product.reward, cancelled));
    if (revoked !== 'pass') return revoked;
  }
  upsert_payment(db_of(c, ctx), { ...rec, result: 'REFUNDED' });
  if (product !== null) remove_purchase(c, ctx, product, rec.reset_at, rec.event_round, true);
  c.m.logging.track_core_event(ctx, 'core_iap_refunded', [
    ['product_id', rec.product_id],
    ['store', rec.store],
    ['spend_amount', rec.spend_amount],
    ['test', rec.test],
  ]);
  log(c, ctx, 'audit', 'info', 'iap refunded a store transaction', { reason: audit_reason, store: rec.store, transaction_id: rec.transaction_id, product_id: rec.product_id });
  return 'pass';
}

/** What ownership transfer 5 does in the earlier owner B's out-of-request change. */
type EarlierOwnerChange =
  | { readonly kind: 'non_consumable'; readonly product: GameData.IapProductRow; readonly once_key: string; readonly reset_at: bigint; readonly event_round: number }
  | { readonly kind: 'subscription'; readonly product_ids: readonly number[] };

/** Ownership transfer 5: B's change after A's commit. Failure is an `error` log only. */
function change_earlier_owner(c: IapContext, owner: bigint, transaction_id: string, change: EarlierOwnerChange): Promise<void> {
  return c.m.storage
    .run_user_transaction(owner, (ctx) => {
      if (change.kind === 'subscription') {
        for (const id of change.product_ids) subscription_recompute(c, ctx, id);
        return 'pass';
      }
      const cancelled = c.m.mailbox.cancel_mail_by_once_key(ctx, change.once_key);
      const revoked = revoke(c, ctx, change.product, transaction_id, 'transfer', revoke_list(change.product.reward, cancelled));
      if (revoked !== 'pass') return revoked;
      remove_purchase(c, ctx, change.product, change.reset_at, change.event_round, false);
      return 'pass';
    })
    .then(
      (result) => {
        if (result === 'REJECTED' || result === 'FAILED') log_user(c, owner, 'error', 'error', 'iap change of the earlier owner after an ownership transfer failed', { transaction_id, result });
      },
      (error: unknown) => {
        log_user(c, owner, 'error', 'error', 'iap change of the earlier owner after an ownership transfer threw', {
          transaction_id,
          stack_trace: error instanceof Error ? (error.stack ?? error.message) : String(error),
        });
      },
    );
}

/** A store transaction or subscription snapshot whose purchase time is known. */
type Timed<T extends { readonly purchased_at: bigint | null }> = T & { readonly purchased_at: bigint };

/** The purchase time a store did not give is the request time (`iap-google` pending subscription). */
function at_request_time<T extends { readonly purchased_at: bigint | null }>(value: T, request_time: bigint): Timed<T> {
  return (value.purchased_at === null ? { ...value, purchased_at: request_time } : value) as Timed<T>;
}

/** The verified store transaction a grant order works on. */
interface Verified {
  readonly store: Store;
  readonly status: VerifyStatus;
  readonly tx: Timed<StoreTransaction>;
  /** As the store gave it; subscription apply fills a purchase time the store did not give with its own request time. */
  readonly snapshot: SubscriptionSnapshot | null;
}

/**
 * Ownership transfer 1 to 5 in A's (the ctx user's) transaction. Returns `moved` when the `NonConsumable` payment
 * record moved to A (the grant order ends `GRANTED`).
 */
function transfer(c: IapContext, ctx: RequestCtx, v: Verified, product: GameData.IapProductRow, rec: PaymentRow | null, owner: bigint): 'moved' | 'continue' | CoreErrorValue {
  const db = db_of(c, ctx);
  const store = store_name(v.store);
  const now = c.m.time.clock_now();
  let change: EarlierOwnerChange | null = null;
  let moved: 'moved' | 'continue' = 'continue';
  if (product.type === ProductType.NonConsumable && rec !== null && rec.result === 'GRANTED') {
    const transfer_count = rec.transfer_count + 1;
    const counted = add_purchase(c, ctx, product);
    upsert_payment(db, { ...rec, user_id: ctx.user_id, transfer_count, reset_at: counted.reset_at, event_round: counted.event_round, delete_at: null });
    const given = give(c, ctx, product, v.tx.transaction_id, grant_once_key(v.store, v.tx.transaction_id, transfer_count));
    if (given !== 'pass') return given;
    change = { kind: 'non_consumable', product, once_key: grant_once_key(v.store, v.tx.transaction_id, rec.transfer_count), reset_at: rec.reset_at, event_round: rec.event_round };
    moved = 'moved';
  }
  if (product.type === ProductType.Subscription) {
    const binding = select_binding(db, store, v.tx.original_transaction_id, now);
    if (binding !== null) {
      upsert_binding(db, { ...binding, user_id: ctx.user_id, delete_at: null });
      const sub = select_subscription(db, store, v.tx.original_transaction_id, now);
      const ids = new Set<number>([product.id]);
      if (sub !== null) {
        upsert_subscription(db, { ...sub, user_id: ctx.user_id, delete_at: null });
        ids.add(sub.product_id);
      }
      for (const id of ids) subscription_recompute(c, ctx, id);
      change = { kind: 'subscription', product_ids: [...ids] };
    }
  }
  const fields = { reason: 'iap_transfer', store, transaction_id: v.tx.transaction_id, from_user_id: owner };
  log(c, ctx, 'security', 'warn', 'iap ownership transfer', fields);
  log(c, ctx, 'audit', 'info', 'iap ownership transfer', fields);
  if (change !== null) {
    const earlier = change;
    c.m.storage.after_commit(ctx, () => change_earlier_owner(c, owner, v.tx.transaction_id, earlier));
  }
  return moved;
}

/** Test grant limit (`### test transaction`). */
function test_grant_limit_reached(c: IapContext, ctx: RequestCtx): boolean {
  const limit = c.settings.test_grants;
  if (limit === null) return false;
  const from = now_of(c, ctx) - BigInt(limit.period_ms);
  return count_granted_of_user(db_of(c, ctx), ctx.user_id, true, from, limit.count, c.m.time.clock_now()) >= limit.count;
}

function transaction_id_problem(c: IapContext, id: string): boolean {
  return id === '' || id.length > c.settings.max_transaction_id_length || !PRINTABLE_ASCII.test(id);
}

/** Writes or rewrites the `INVALID` payment record when there is none or it is `INVALID`. */
function record_invalid(c: IapContext, ctx: RequestCtx, v: Verified, product: GameData.IapProductRow | null, rec: PaymentRow | null): void {
  if (rec !== null && rec.result !== 'INVALID') return;
  upsert_payment(db_of(c, ctx), {
    store: store_name(v.store),
    transaction_id: v.tx.transaction_id,
    original_transaction_id: v.tx.original_transaction_id,
    user_id: ctx.user_id,
    sku: v.tx.sku,
    product_id: product?.id ?? 0,
    spend_amount: product?.spend_amount ?? 0n,
    purchased_at: v.tx.purchased_at,
    verified_at: now_of(c, ctx),
    result: 'INVALID',
    test: v.tx.test,
    reset_at: 0n,
    event_round: 0,
    transfer_count: rec?.transfer_count ?? 0,
    delete_at: null,
  });
}

function outcome(status: CoreContract.PurchaseStatus, product_id: number, items: readonly CoreContract.ItemAmount[] = []): VerifyOutcome {
  return { status, product_id, items };
}

/**
 * The lock order of grant order 4 and of record recheck: the payment row of `transaction_id` (none when it is empty),
 * the payment row of `latest` when it is not empty and differs, and then the binding row of `original()`. `original`
 * runs after the payment rows are locked, so it can read the payment record again.
 */
export function lock_grant_rows(c: IapContext, ctx_or_tx: RequestCtx | GameTx, store: Store, transaction_id: string, latest: string, original: () => string): boolean {
  const name = store_name(store);
  const ids = transaction_id === '' ? [] : [transaction_id];
  if (latest !== '' && latest !== transaction_id) ids.push(latest);
  for (const id of ids) if (c.m.storage.lock_game_row(ctx_or_tx, PAYMENT, [name, id]) === 'FAILED') return false;
  return c.m.storage.lock_game_row(ctx_or_tx, BINDING, [name, original()]) !== 'FAILED';
}

/** Grant order 4: locks the payment row (and the snapshot's latest transaction row) and then the binding row. */
function lock_rows(c: IapContext, ctx: RequestCtx, v: Verified): boolean {
  return lock_grant_rows(c, ctx, v.store, v.tx.transaction_id, v.snapshot?.latest_transaction_id ?? '', () => v.tx.original_transaction_id);
}

/** True when grant order 4 judges the store transaction `INVALID`; writes the log of the rules that log. */
function is_invalid(c: IapContext, ctx: RequestCtx, v: Verified, product: GameData.IapProductRow | null, rec: PaymentRow | null): boolean {
  const store = store_name(v.store);
  const tx = v.tx;
  if (v.status === 'INVALID' || tx.app_id !== c.settings.app_id || transaction_id_problem(c, tx.transaction_id)) return true;
  if (product === null) {
    log(c, ctx, 'error', 'error', 'iap store transaction SKU is not an iap_product row of the store', { store, sku: tx.sku, transaction_id: tx.transaction_id });
    return true;
  }
  if (rec !== null && rec.result === 'REFUNDED' && rec.user_id !== ctx.user_id) {
    log(c, ctx, 'security', 'warn', 'iap refunded store transaction of another user', { reason: 'invalid', cause: 'refunded_other_user', store, transaction_id: tx.transaction_id });
    return true;
  }
  if (tx.test && test_grant_limit_reached(c, ctx)) {
    log(c, ctx, 'security', 'warn', 'iap test grant limit reached', { reason: 'invalid', cause: 'test_grant_limit', store, transaction_id: tx.transaction_id });
    return true;
  }
  return false;
}

/** The `INVALID` end of grant order 4, with the payment record it writes. */
function invalid(c: IapContext, ctx: RequestCtx, v: Verified, product: GameData.IapProductRow | null, rec: PaymentRow | null): VerifyOutcome {
  if (!transaction_id_problem(c, v.tx.transaction_id)) record_invalid(c, ctx, v, product, rec);
  return outcome(PurchaseStatus.PURCHASE_STATUS_INVALID, product?.id ?? 0);
}

/** The payment record grant order goes on with after step 4. */
interface GoOn {
  readonly go: true;
  readonly rec: PaymentRow | null;
}

/** The earlier owner B (`### ownership transfer`): the `GRANTED` record user, else the binding user, else the account token user. */
function owner_of(c: IapContext, ctx: RequestCtx, v: Verified, granted_other: PaymentRow | null, binding: BindingRow | null): bigint | null {
  if (granted_other !== null) return granted_other.user_id;
  if (binding !== null) return binding.user_id;
  return v.tx.account_token === '' ? null : select_account_token_user(db_of(c, ctx), v.tx.account_token, c.m.time.clock_now());
}

/** Ownership transfer condition (`### ownership transfer`) for an existing earlier owner B. */
function transfer_allowed(c: IapContext, ctx: RequestCtx, v: Verified, product: GameData.IapProductRow, owner: bigint, granted_other: boolean): boolean {
  if (!v.tx.device_receipt) return false;
  if (c.has_social_link === null || c.has_social_link(db_of(c, ctx), owner)) return false;
  if (product.type === ProductType.NonConsumable || product.type === ProductType.Subscription) return true;
  return product.type === ProductType.Consumable && !granted_other;
}

/** Grant order 4 for a store transaction of another user: ownership transfer, or the `OTHER_USER` record and its end. */
function other_user(c: IapContext, ctx: RequestCtx, v: Verified, product: GameData.IapProductRow, rec: PaymentRow | null, binding: BindingRow | null): GoOn | VerifyOutcome | CoreErrorValue {
  const db = db_of(c, ctx);
  const store = store_name(v.store);
  const granted_other = rec !== null && rec.result === 'GRANTED' && rec.user_id !== ctx.user_id ? rec : null;
  const owner = owner_of(c, ctx, v, granted_other, binding);
  if (owner !== null && transfer_allowed(c, ctx, v, product, owner, granted_other !== null)) {
    const moved = transfer(c, ctx, v, product, rec, owner);
    if (moved === 'moved') return outcome(PurchaseStatus.PURCHASE_STATUS_GRANTED, product.id, product.reward);
    if (moved !== 'continue') return moved;
    return { go: true, rec: select_payment(db, store, v.tx.transaction_id, c.m.time.clock_now()) };
  }
  upsert_other_user(db, { store, transaction_id: v.tx.transaction_id, user_id: ctx.user_id, owner_user_id: owner ?? 0n, product_id: product.id, verified_at: now_of(c, ctx) });
  log(c, ctx, 'security', 'warn', 'iap store transaction of another user', {
    reason: granted_other === null ? 'other_user' : 'already_granted',
    store,
    transaction_id: v.tx.transaction_id,
    owner_user_id: owner ?? 0n,
  });
  return outcome(granted_other === null ? PurchaseStatus.PURCHASE_STATUS_OTHER_USER : PurchaseStatus.PURCHASE_STATUS_ALREADY_GRANTED, product.id);
}

/**
 * Grant order 4 for a store transaction without an account token: goes on when its original transaction ID is bound to
 * the ctx user, or binds it when it has no binding and was bought within `iap.withdrawnRecordRetentionMs`.
 */
function bind_tokenless(c: IapContext, ctx: RequestCtx, v: Verified, binding: BindingRow | null): boolean {
  if (binding !== null) return binding.user_id === ctx.user_id;
  if (v.tx.purchased_at + BigInt(c.settings.withdrawn_record_retention_ms) <= now_of(c, ctx)) return false;
  upsert_binding(db_of(c, ctx), { store: store_name(v.store), original_transaction_id: v.tx.original_transaction_id, user_id: ctx.user_id, delete_at: null });
  return true;
}

/** Grant order 4 for a store transaction that is not the ctx user's `GRANTED` or `REFUNDED` one. */
function judge(c: IapContext, ctx: RequestCtx, v: Verified, product: GameData.IapProductRow | null, rec: PaymentRow | null, my_account_token: string): GoOn | VerifyOutcome | CoreErrorValue {
  if (is_invalid(c, ctx, v, product, rec) || product === null) return invalid(c, ctx, v, product, rec);
  const binding = select_binding(db_of(c, ctx), store_name(v.store), v.tx.original_transaction_id, c.m.time.clock_now());
  const granted_other = rec !== null && rec.result === 'GRANTED' && rec.user_id !== ctx.user_id;
  const bound_other = binding !== null && binding.user_id !== ctx.user_id;
  const token_other = binding?.user_id !== ctx.user_id && v.tx.account_token !== '' && v.tx.account_token !== my_account_token;
  if (granted_other || bound_other || token_other) return other_user(c, ctx, v, product, rec, binding);
  if (v.tx.account_token === '' && !bind_tokenless(c, ctx, v, binding)) return invalid(c, ctx, v, product, rec);
  return { go: true, rec };
}

/** Grant order 6 to 9. */
function finish(c: IapContext, ctx: RequestCtx, v: Verified, product: GameData.IapProductRow | null, rec: PaymentRow | null): VerifyOutcome | CoreErrorValue {
  if (rec !== null && (rec.result === 'GRANTED' || rec.result === 'REFUNDED')) {
    const known = product ?? product_of_record(ctx.data, v.store, rec);
    if (known !== null && known.type === ProductType.Subscription && v.snapshot !== null) {
      const applied = subscription_apply(c, ctx, v.store, v.tx.original_transaction_id, v.snapshot);
      if (applied !== 'pass') return applied;
    }
    return outcome(PurchaseStatus.PURCHASE_STATUS_ALREADY_GRANTED, known?.id ?? 0);
  }
  if (product === null) return outcome(PurchaseStatus.PURCHASE_STATUS_INVALID, 0);
  const granted = grant_and_record(c, ctx, {
    store: v.store,
    transaction_id: v.tx.transaction_id,
    original_transaction_id: v.tx.original_transaction_id,
    sku: v.tx.sku,
    purchased_at: v.tx.purchased_at,
    test: v.tx.test,
    product,
    transfer_count: rec?.transfer_count ?? 0,
    snapshot: v.snapshot,
  });
  if (granted !== 'pass') return granted;
  return outcome(PurchaseStatus.PURCHASE_STATUS_GRANTED, product.id, product.reward);
}

/** Grant order 4 to 9 (`VerifyPurchase`, `RecoverPurchase`) in the request transaction. */
export function grant_order(c: IapContext, ctx: RequestCtx, prepared: PrepareValue, my_account_token: string): VerifyOutcome | CoreErrorValue {
  const tx = prepared.transaction;
  if (tx === null) return outcome(PurchaseStatus.PURCHASE_STATUS_INVALID, 0);
  const v: Verified = { store: prepared.store, status: prepared.status, tx: at_request_time(tx, now_of(c, ctx)), snapshot: prepared.snapshot };
  if (!lock_rows(c, ctx, v)) return CoreError.CORE_ERROR_INTERNAL;
  let rec = select_payment(db_of(c, ctx), store_name(v.store), tx.transaction_id, c.m.time.clock_now());
  const product = product_by_sku(ctx.data, v.store, tx.sku);
  const own_done = rec !== null && rec.user_id === ctx.user_id && (rec.result === 'GRANTED' || rec.result === 'REFUNDED');
  if (!own_done) {
    const judged = judge(c, ctx, v, product, rec, my_account_token);
    if (typeof judged === 'number' || !('go' in judged)) return judged;
    rec = judged.rec;
    if (v.status === 'PENDING') return outcome(PurchaseStatus.PURCHASE_STATUS_PENDING, product?.id ?? 0);
  }
  return finish(c, ctx, v, product, rec);
}
