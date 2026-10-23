/** Route `POST /iap/notify/<store>` (`### store notification`). */
import type * as CoreContract from '../../generated/contract/core_contract.ts';
import type { GameTx, RequestCtx } from '../storage/index.ts';
import { is_failure, type StoreNotification, type SubscriptionSnapshot } from './adapter.ts';
import { call_adapter, lookup_subscription } from './calls.ts';
import { CoreError, IapStore, is_entitled_state, log_user, ProductType, state_name, store_name, SubscriptionState, type IapContext, type Store, type StoreBinding } from './context.ts';
import { change_other_subscription_after_commit, lock_grant_rows, other_subscription_owner, product_of_record, refund_record, subscription_apply } from './grant.ts';
import {
  select_binding,
  select_payment,
  select_subscription,
  upsert_binding,
  upsert_payment,
  upsert_subscription,
  type BindingRow,
  type PaymentRow,
  type SubscriptionRow,
} from './tables.ts';

/** A route request (`routing` `## API`). */
export interface RouteRequest {
  readonly method: string;
  readonly path: string;
  readonly query: string;
  readonly headers: Readonly<Record<string, string>>;
  read_body(max_bytes: number, time_limit_ms: number): Promise<Uint8Array | null>;
  readonly upgrade: unknown;
}

/** A route response (`routing` `## API`). */
export interface RouteResponse {
  readonly status: number;
  readonly headers?: Readonly<Record<string, string>>;
  readonly body?: Uint8Array | string;
}

const OK: RouteResponse = { status: 200 };
const BAD_REQUEST: RouteResponse = { status: 400 };
const FORBIDDEN: RouteResponse = { status: 403 };
const NOT_FOUND: RouteResponse = { status: 404 };
const FAILED: RouteResponse = { status: 500 };

function store_of_segment(path: string): Store | null {
  const segment = path.slice(path.lastIndexOf('/') + 1);
  if (segment === 'apple') return IapStore.IAP_STORE_APPLE;
  if (segment === 'google') return IapStore.IAP_STORE_GOOGLE;
  return null;
}

async function parse(c: IapContext, binding: StoreBinding, headers: Readonly<Record<string, string>>, body: Uint8Array): Promise<StoreNotification | 'bad_signature' | 'bad_format' | 'failed'> {
  if (binding.name === 'fake') return c.fake_notification === null ? 'bad_signature' : c.fake_notification(headers, body);
  const adapter = binding.adapter;
  if (adapter.parse_notification === undefined) return 'bad_signature';
  const result = await call_adapter(c, (call) => adapter.parse_notification?.(headers, body, call) ?? Promise.resolve('bad_signature' as const));
  return is_failure(result) ? 'failed' : result;
}

/** What one notification changes, found outside the transaction. */
interface Work {
  readonly store: Store;
  readonly source: string;
  readonly notification: StoreNotification;
  readonly user_id: bigint;
  /** The transaction ID of the record recheck: the refunded one, or the snapshot's latest one. */
  readonly transaction_id: string;
  /** The original transaction ID: of the payment record read outside the transaction (`REFUND`), or of the notification. */
  readonly original_transaction_id: string;
  readonly snapshot: SubscriptionSnapshot | null;
}

/** The records that record recheck reads. */
export interface Recheck {
  readonly payment: PaymentRow | null;
  readonly binding: BindingRow | null;
  readonly subscription: SubscriptionRow | null;
}

/**
 * Record recheck (`### store notification`): locks the rows in the order of grant order 4 (`lock_grant_rows`) and reads
 * the payment record of `transaction_id`, the binding and the subscription record again. The original transaction ID is
 * `original_of` of the reread payment record.
 */
export function recheck(c: IapContext, ctx_or_tx: RequestCtx | GameTx, store: Store, transaction_id: string, snapshot: SubscriptionSnapshot | null, original_of: (payment: PaymentRow | null) => string): Recheck | 'FAILED' {
  const name = store_name(store);
  const db = c.m.storage.db(ctx_or_tx);
  const now = c.m.time.clock_now();
  let payment: PaymentRow | null = null;
  let original = '';
  const locked = lock_grant_rows(c, ctx_or_tx, store, transaction_id, snapshot?.latest_transaction_id ?? '', () => {
    payment = transaction_id === '' ? null : select_payment(db, name, transaction_id, now);
    original = original_of(payment);
    return original;
  });
  if (!locked) return 'FAILED';
  return { payment, binding: select_binding(db, name, original, now), subscription: select_subscription(db, name, original, now) };
}

/** Record recheck of a notification's work. */
function recheck_work(c: IapContext, ctx_or_tx: RequestCtx | GameTx, w: Work): Recheck | 'FAILED' {
  const original_of = (payment: PaymentRow | null): string => (w.notification.kind === 'REFUND' ? (payment?.original_transaction_id ?? w.original_transaction_id) : w.original_transaction_id);
  return recheck(c, ctx_or_tx, w.store, w.transaction_id, w.snapshot, original_of);
}

type Outcome = 'ok' | 'mismatch' | 'failed';
type SetOutcome = (outcome: Outcome) => void;

/** A failure code that rolls the change back, with the outcome it ends in. */
function fail(set: SetOutcome, outcome: Outcome, code: number = CoreError.CORE_ERROR_INTERNAL): number {
  set(outcome);
  return code;
}

/** `REFUND` in the record user's transaction: claim only for a record that is not `GRANTED`, else the `REFUND` processing order. */
function refund_user(c: IapContext, ctx: RequestCtx, w: Work, rec: PaymentRow | null, set: SetOutcome): 'pass' | number {
  if (rec === null || rec.result !== 'GRANTED') {
    c.m.idempotency.claim_notify(ctx, w.source, w.notification.notification_id);
    return 'pass';
  }
  if (rec.user_id !== ctx.user_id) return fail(set, 'mismatch');
  if (c.m.idempotency.claim_notify(ctx, w.source, w.notification.notification_id) === 'DUPLICATE') return 'pass';
  const refunded = refund_record(c, ctx, w.store, rec, 'iap_refund');
  if (refunded !== 'pass') return fail(set, 'failed', refunded);
  const product = product_of_record(ctx.data, w.store, rec);
  if (product === null || product.type !== ProductType.Subscription || w.snapshot === null) return 'pass';
  const applied = subscription_apply(c, ctx, w.store, rec.original_transaction_id, w.snapshot);
  return applied === 'pass' ? 'pass' : fail(set, 'failed', applied);
}

/** `SUBSCRIPTION` in the record user's transaction: subscription apply. */
function subscription_user(c: IapContext, ctx: RequestCtx, w: Work, sub: SubscriptionRow | null, set: SetOutcome): 'pass' | number {
  if (sub === null || sub.user_id !== ctx.user_id) return fail(set, 'mismatch');
  if (c.m.idempotency.claim_notify(ctx, w.source, w.notification.notification_id) === 'DUPLICATE' || w.snapshot === null) return 'pass';
  const applied = subscription_apply(c, ctx, w.store, w.original_transaction_id, w.snapshot);
  return applied === 'pass' ? 'pass' : fail(set, 'failed', applied);
}

/** The change in the record user's out-of-request change. */
function change_user(c: IapContext, ctx: RequestCtx, w: Work, set: SetOutcome): 'pass' | number {
  const read = recheck_work(c, ctx, w);
  if (read === 'FAILED') return fail(set, 'failed');
  return w.notification.kind === 'REFUND' ? refund_user(c, ctx, w, read.payment, set) : subscription_user(c, ctx, w, read.subscription, set);
}

/** The subscription record with the snapshot's state, `ends_at` and `auto_renew` (written in a game transaction). */
function with_snapshot(c: IapContext, sub: SubscriptionRow, snapshot: SubscriptionSnapshot): SubscriptionRow {
  return { ...sub, state: state_name(snapshot.state), ends_at: snapshot.ends_at, auto_renew: snapshot.auto_renew, updated_at: c.m.time.clock_now() };
}

/**
 * Writes the subscription record of a withdrawn user. A state the store goes on paying in (`ACTIVE`, `GRACE_PERIOD`,
 * `BILLING_RETRY`) moves `delete_at` of the record and its binding to `clock_now` + `iap.withdrawnRecordRetentionMs`.
 */
function write_withdrawn_subscription(c: IapContext, tx: GameTx, sub: SubscriptionRow, state: CoreContract.SubscriptionState): void {
  const db = c.m.storage.db(tx);
  if (!is_entitled_state(state) && state !== SubscriptionState.SUBSCRIPTION_STATE_BILLING_RETRY) {
    upsert_subscription(db, sub);
    return;
  }
  const now = c.m.time.clock_now();
  const delete_at = now + BigInt(c.settings.withdrawn_record_retention_ms);
  upsert_subscription(db, { ...sub, delete_at });
  const binding = select_binding(db, sub.store, sub.original_transaction_id, now);
  if (binding !== null && binding.user_id === sub.user_id) upsert_binding(db, { ...binding, delete_at });
}

/** `REFUND` of a withdrawn user: the subscription record to write, OK without processing, or a failure code. */
function withdrawn_refund(c: IapContext, tx: GameTx, w: Work, read: Recheck): SubscriptionRow | null | RouteResponse | number {
  const rec = read.payment;
  if (rec === null || rec.result !== 'GRANTED') {
    c.m.idempotency.claim_notify(tx, w.source, w.notification.notification_id);
    return OK;
  }
  if (rec.user_id !== w.user_id) return CoreError.CORE_ERROR_INTERNAL;
  if (c.m.idempotency.claim_notify(tx, w.source, w.notification.notification_id) === 'DUPLICATE') return OK;
  upsert_payment(c.m.storage.db(tx), { ...rec, result: 'REFUNDED' });
  const product = product_of_record(c.data, w.store, rec);
  const subscription = product !== null && product.type === ProductType.Subscription ? read.subscription : null;
  if (subscription === null || w.snapshot === null) return null;
  const other = other_subscription_owner(w.user_id, read.binding, subscription);
  if (other !== null) {
    change_other_subscription_after_commit(c, tx, other, w.store, rec.original_transaction_id, { kind: 'apply', snapshot: w.snapshot });
    return null;
  }
  return with_snapshot(c, subscription, w.snapshot);
}

/** The change of a withdrawn user's records in one game transaction. */
function change_withdrawn(c: IapContext, tx: GameTx, w: Work): RouteResponse | number {
  const read = recheck_work(c, tx, w);
  if (read === 'FAILED') return CoreError.CORE_ERROR_INTERNAL;
  let sub: SubscriptionRow | null;
  if (w.notification.kind === 'REFUND') {
    const refunded = withdrawn_refund(c, tx, w, read);
    if (typeof refunded === 'number' || (refunded !== null && 'status' in refunded)) return refunded;
    sub = refunded;
  } else {
    if (read.subscription === null || read.subscription.user_id !== w.user_id) return CoreError.CORE_ERROR_INTERNAL;
    if (c.m.idempotency.claim_notify(tx, w.source, w.notification.notification_id) === 'DUPLICATE') return OK;
    sub = w.snapshot === null ? null : with_snapshot(c, read.subscription, w.snapshot);
  }
  if (sub !== null && w.snapshot !== null) write_withdrawn_subscription(c, tx, sub, w.snapshot.state);
  return OK;
}

async function process(c: IapContext, w: Work): Promise<RouteResponse> {
  let outcome = 'ok' as Outcome;
  let result;
  try {
    result = await c.m.storage.run_user_transaction(w.user_id, (ctx) => change_user(c, ctx, w, (o) => (outcome = o)));
  } catch (error) {
    log_user(c, w.user_id, 'error', 'error', 'iap store notification processing threw', { stack_trace: error instanceof Error ? (error.stack ?? error.message) : String(error) });
    return FAILED;
  }
  if (result === 'COMMITTED') return OK;
  if (result === 'WITHDRAWN') {
    let done;
    try {
      done = await c.m.storage.run_game_transaction((tx) => change_withdrawn(c, tx, w));
    } catch (error) {
      log_user(c, w.user_id, 'error', 'error', 'iap store notification processing threw', { stack_trace: error instanceof Error ? (error.stack ?? error.message) : String(error) });
      return FAILED;
    }
    return typeof done === 'object' ? done : FAILED;
  }
  if (outcome === 'failed' || result === 'FAILED') log_user(c, w.user_id, 'error', 'error', 'iap store notification processing failed', { kind: w.notification.kind });
  return FAILED;
}

/** Handles one store notification; an unexpected throw is HTTP 500 with an `error` log. */
export async function handle_notify(c: IapContext, request: RouteRequest): Promise<RouteResponse> {
  try {
    return await notify(c, request);
  } catch (error) {
    log_user(c, null, 'error', 'error', 'iap store notification threw', { stack_trace: error instanceof Error ? (error.stack ?? error.message) : String(error) });
    return FAILED;
  }
}

/** The work of a `REFUND` notification: the `GRANTED` payment record outside the transaction and, for a subscription, the lookup. */
async function refund_work(c: IapContext, store: Store, binding: StoreBinding, notification: StoreNotification): Promise<Work | RouteResponse> {
  const rec = select_payment(c.m.storage.read_db(), store_name(store), notification.value, c.m.time.clock_now());
  if (rec === null || rec.result !== 'GRANTED') return OK;
  const product = product_of_record(c.data, store, rec);
  let snapshot: SubscriptionSnapshot | null = null;
  if (product !== null && product.type === ProductType.Subscription) {
    snapshot = await lookup_subscription(c, binding, store, rec.original_transaction_id, null, rec.user_id);
    if (snapshot === null) return FAILED;
  }
  return { store, source: binding.name, notification, user_id: rec.user_id, transaction_id: rec.transaction_id, original_transaction_id: rec.original_transaction_id, snapshot };
}

/** The work of a `SUBSCRIPTION` notification: the subscription record outside the transaction and the lookup. */
async function subscription_work(c: IapContext, store: Store, binding: StoreBinding, notification: StoreNotification): Promise<Work | RouteResponse> {
  const sub = select_subscription(c.m.storage.read_db(), store_name(store), notification.value, c.m.time.clock_now());
  if (sub === null) return OK;
  const snapshot = await lookup_subscription(c, binding, store, notification.value, null, sub.user_id);
  if (snapshot === null) return FAILED;
  return { store, source: binding.name, notification, user_id: sub.user_id, transaction_id: snapshot.latest_transaction_id, original_transaction_id: notification.value, snapshot };
}

async function notify(c: IapContext, request: RouteRequest): Promise<RouteResponse> {
  const store = store_of_segment(request.path);
  const binding = store === null ? undefined : c.adapters.get(store);
  if (store === null || binding === undefined) return NOT_FOUND;
  const body = await request.read_body(c.settings.notify_max_body_bytes, c.settings.notify_body_read_timeout_ms);
  if (body === null) return BAD_REQUEST;
  const notification = await parse(c, binding, request.headers, body);
  if (notification === 'failed') return FAILED;
  if (notification === 'bad_signature') return FORBIDDEN;
  if (notification === 'bad_format') return BAD_REQUEST;
  const id_bytes = Buffer.byteLength(notification.notification_id, 'utf8');
  if (id_bytes < 1 || id_bytes > c.settings.max_notify_id_bytes) return BAD_REQUEST;
  if (notification.kind === 'OTHER' || notification.value === '') return OK;
  const work = notification.kind === 'REFUND' ? await refund_work(c, store, binding, notification) : await subscription_work(c, store, binding, notification);
  return 'status' in work ? work : process(c, work);
}
