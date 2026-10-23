/**
 * iap: verifies store receipts through adapters and grants each store transaction once; recovers unfinished
 * purchases, handles refunds and subscription changes the stores notify, subscription entitlement, passes and daily
 * rewards, sale conditions and purchase limit periods, monthly spend limits by age band, test transactions and the
 * ownership transfer of store transactions bound to another user.
 */
import * as CoreContract from '../../generated/contract/core_contract.ts';
import * as GameData from '../../generated/data/game_data.ts';
import type { RequestCtx } from '../storage/index.ts';
import { account_token_of } from './account_token.ts';
import { create_apple_adapter, APPLE_ROOT_CA_G3 } from './adapters/apple.ts';
import { create_google_adapter, google_key_source } from './adapters/google.ts';
import type { AckKind, KeySource, StoreAdapter } from './adapter.ts';
import { acknowledge, lookup_subscription, verify_receipt } from './calls.ts';
import {
  CoreError,
  is_entitled_state,
  is_failure_code,
  is_pass,
  is_store,
  log,
  log_user,
  product_by_sku,
  ProductType,
  sku_of,
  store_name,
  store_of_name,
  type FakeNotificationParser,
  type IapContext,
  type Store,
  type StoreBinding,
} from './context.ts';
import { read_modules, type HasSocialLink, type IapHookSlots, type IapInput } from './deps.ts';
import { change_other_subscription_after_commit, grant_order, other_subscription_owner, refund_record, revoke_subscription, subscription_apply, type PrepareValue } from './grant.ts';
import { handle_notify, recheck, type RouteRequest, type RouteResponse } from './notify.ts';
import { pass_active, purchase_count, set_daily_claimed } from './purchase_count.ts';
import { monthly_limit_problem, read_settings } from './settings.ts';
import {
  ACCOUNT_TOKEN,
  has_granted_of_user,
  insert_account_token,
  mark_user_rows,
  register_tables,
  select_binding,
  select_other_user_of_user,
  select_payments_of_user,
  select_subscriptions_of_user,
  sum_spend_of_user,
  type OtherUserRow,
  type PaymentRow,
  type SubscriptionRow,
} from './tables.ts';

export type { PrepareValue, VerifyOutcome } from './grant.ts';
export type { RouteRequest, RouteResponse } from './notify.ts';
export type { AdapterCall, AdapterFailure, StoreAdapter, StoreNotification, StoreTransaction, SubscriptionSnapshot, Verification } from './adapter.ts';
export type { HasSocialLink, IapHookSlots } from './deps.ts';

type CoreErrorValue = CoreContract.CoreError;

/** An admin operation object (`admin-api`): `routing` hands it to `admin-api.register_admin_operation`. */
export interface AdminOperation {
  readonly name: string;
  readonly role: 'read' | 'ops' | 'economy' | 'release';
  readonly body: 'json';
  readonly max_body_bytes: null;
  readonly input: Readonly<Record<string, { readonly type: Readonly<Record<string, unknown>>; readonly optional: boolean }>>;
  readonly user_target: string | null;
  readonly handler: (input: Readonly<Record<string, unknown>>, transaction: RequestCtx, prepare_value: unknown, body: Uint8Array | null) => Record<string, unknown> | AdminFailure;
  readonly prepare: null;
  readonly audit_args: null;
}

export type AdminFailure = 'bad_request' | 'not_found' | 'conflict' | 'external_failed' | 'internal';

/** The values of `VerifyPurchaseRequest` and `RecoverPurchaseRequest` that `prepare_verify_purchase` reads. */
export interface VerifyRequest {
  readonly store: CoreContract.IapStore;
  readonly receipt: string;
}

/** `list_payments` output. Rows carry the table columns. */
export interface PaymentList {
  readonly payments: readonly PaymentRow[];
  readonly other_user_attempts: readonly OtherUserRow[];
}

/** What only the DEV code gives iap (`dev/index.ts`), before `begin_start`. */
export interface IapDevCode {
  /** A new fake adapter for adapter name `fake` when the server instance gives none. */
  create_fake_adapter(adapter_key: string): StoreAdapter;
  readonly parse_fake_notification: FakeNotificationParser;
}

/** What the DEV code reads back: the store's adapter, and the notify route of this server instance. */
export interface IapDevAccess {
  binding(store: Store): StoreBinding | undefined;
  notify(request: RouteRequest): Promise<RouteResponse>;
}

/** The `## API` operations of iap, the admin operation, the hook slots, the lifecycle and the slot its DEV code fills. */
export interface Iap {
  /** A failure is a `CoreError` or the `GameError` of hook `validate_iap_purchase`. */
  CheckPurchase(ctx: RequestCtx, request: CoreContract.CheckPurchaseRequest): CoreContract.CheckPurchaseResponse | number;
  VerifyPurchase(ctx: RequestCtx, request: CoreContract.VerifyPurchaseRequest, prepared: PrepareValue): CoreContract.VerifyPurchaseResponse | CoreErrorValue;
  RecoverPurchase(ctx: RequestCtx, request: CoreContract.RecoverPurchaseRequest, prepared: PrepareValue): CoreContract.RecoverPurchaseResponse | CoreErrorValue;
  SyncSubscriptions(ctx: RequestCtx, request: CoreContract.SyncSubscriptionsRequest, prepared: null): CoreContract.SyncSubscriptionsResponse;
  ClaimIapDaily(ctx: RequestCtx, request: CoreContract.ClaimIapDailyRequest): CoreContract.ClaimIapDailyResponse | CoreErrorValue;
  'POST /iap/notify/<store>'(request: RouteRequest, client_ip: string): Promise<RouteResponse>;
  get_purchase_count(ctx: RequestCtx, product_id: number): number;
  is_subscribed(ctx: RequestCtx, product_id: number): boolean;
  is_pass_active(ctx: RequestCtx, product_id: number): boolean;
  list_payments(user_id: bigint): PaymentList;
  has_granted_payment(ctx: RequestCtx, user_id: bigint): boolean;
  /** `routing` passes the request message as the second input; the store and receipt may also come one by one. */
  prepare_verify_purchase(user_id: bigint, store: CoreContract.IapStore | VerifyRequest, receipt?: string): Promise<PrepareValue | CoreErrorValue>;
  prepare_sync_subscriptions(user_id: bigint): Promise<null | CoreErrorValue>;
  register_account_lookup(has_social_link: HasSocialLink): null;
  readonly revoke_test_grant: AdminOperation;
  remove_user(ctx: RequestCtx): null;
  readonly hook_slots: IapHookSlots;
  begin_start(): void;
  complete_start(): string | null;
  stop(): void;
  /** For the DEV code: called before `begin_start` in a server instance with DEV code. */
  include_dev_code(dev: IapDevCode): IapDevAccess;
}

const SECRET_KEYS = { account: 'iapAccountToken', apple: 'iapApple', google: 'iapGoogle' } as const;

function product_of(ctx: RequestCtx, product_id: number): GameData.IapProductRow | null {
  const table = ctx.data.IapProductTable;
  return table.has_row(product_id) ? table.get_row(product_id) : null;
}

/** Makes `iap` for one server instance. A missing or non-integer core setting, or a missing module, throws. */
export function create_iap(input: IapInput): Iap {
  const { server } = input;
  const settings = read_settings(input.settings);
  const m = read_modules(input.modules);
  const hook_slots: IapHookSlots = { validate_iap_purchase: null, grant_iap_extra: null, revoke_iap: null };
  const c: IapContext = {
    m,
    settings,
    data: server.data,
    hooks: hook_slots,
    adapters: new Map(),
    account_key: '',
    has_social_link: null,
    fake_notification: null,
  };
  const start_errors: string[] = [];
  let dev: IapDevCode | null = null;
  let lookups = 0;
  let completed = false;
  register_tables(m.storage);

  /** A secret value: by secret key from `--secret-file` on a LOCAL or test server, else by the game settings secret name. */
  const secret = (key: (typeof SECRET_KEYS)[keyof typeof SECRET_KEYS]): string | null => {
    const name = server.db !== null ? key : settings.secret_names[key];
    if (name === '') return null;
    const value = server.read_secret(name);
    return typeof value === 'string' && value !== '' ? value : null;
  };

  const key_source = (adapter_key: string, fallback: KeySource): KeySource => server.key_sources[adapter_key] ?? fallback;

  const make_adapter = (store: Store, name: string): StoreAdapter | string => {
    const adapter_key = store === CoreContract.IapStore.IAP_STORE_APPLE ? 'iap-apple' : 'iap-google';
    if (name === 'fake') {
      const given = server.fake_adapters[adapter_key];
      if (given !== undefined && given !== null) return given as StoreAdapter;
      if (dev !== null) return dev.create_fake_adapter(adapter_key);
      return `adapter ${adapter_key} fake needs a server instance with DEV code`;
    }
    const max_response_bytes = settings.external_max_response_bytes;
    if (store === CoreContract.IapStore.IAP_STORE_APPLE && (name === 'iap-apple' || name === 'iap-apple-sandbox')) {
      const private_key = secret(SECRET_KEYS.apple);
      if (private_key === null) return `adapter ${name} has no secret ${SECRET_KEYS.apple}`;
      return create_apple_adapter({
        name,
        private_key_pem: private_key,
        key_id: settings.apple_key_id,
        issuer_id: settings.apple_issuer_id,
        bundle_id: settings.app_id,
        app_apple_id: settings.app_apple_id,
        fetch: server.fetch,
        key_source: key_source(adapter_key, () => Promise.resolve([APPLE_ROOT_CA_G3])),
        max_response_bytes,
      });
    }
    if (store === CoreContract.IapStore.IAP_STORE_GOOGLE && name === 'iap-google') {
      const private_key = secret(SECRET_KEYS.google);
      if (private_key === null) return `adapter ${name} has no secret ${SECRET_KEYS.google}`;
      return create_google_adapter({
        private_key_pem: private_key,
        service_account_email: settings.google_service_account_email,
        notification_service_account_email: settings.google_notification_service_account_email,
        notification_audience: `${settings.server_url}/iap/notify/google`,
        package_name: settings.app_id,
        is_subscription_sku: (sku) => {
          const product = product_by_sku(c.data, CoreContract.IapStore.IAP_STORE_GOOGLE, sku);
          return product !== null && product.type === ProductType.Subscription;
        },
        fetch: server.fetch,
        key_source: key_source(adapter_key, google_key_source(server.fetch, max_response_bytes)),
        max_response_bytes,
        clock_now: () => m.time.clock_now(),
      });
    }
    return `adapter name ${name} is not an adapter of ${adapter_key}`;
  };

  const begin_start = (): void => {
    const chosen: [Store, string | null][] = [
      [CoreContract.IapStore.IAP_STORE_APPLE, settings.apple_adapter],
      [CoreContract.IapStore.IAP_STORE_GOOGLE, settings.google_adapter],
    ];
    for (const [store, name] of chosen) {
      if (name === null || name === '') continue;
      const adapter = make_adapter(store, name);
      if (typeof adapter === 'string') start_errors.push(adapter);
      else c.adapters.set(store, { name, adapter });
    }
    const key = secret(SECRET_KEYS.account);
    if (key === null) start_errors.push(`iap: secret ${SECRET_KEYS.account} has no value`);
    else c.account_key = key;
    const monthly = monthly_limit_problem(settings);
    if (monthly !== null) start_errors.push(monthly);
  };

  const complete_start = (): string | null => {
    completed = true;
    const errors = [...start_errors];
    if (lookups === 0) errors.push('register_account_lookup was not called');
    if (c.data.IapProductTable.all_rows().some((row) => row.extra_grant) && (hook_slots.grant_iap_extra === null || hook_slots.revoke_iap === null)) {
      errors.push('an iap_product row has extra_grant true, and hook grant_iap_extra or revoke_iap is not registered');
    }
    return errors.length === 0 ? null : `iap: ${errors.join('; ')}`;
  };

  const binding_of = (store: unknown): { store: Store; binding: StoreBinding } | null => {
    if (!is_store(store)) return null;
    const binding = c.adapters.get(store);
    return binding === undefined ? null : { store, binding };
  };

  /** Monthly spend (`### monthly spend limit`). */
  const monthly_spend = (ctx: RequestCtx): bigint => {
    const now = m.time.now(ctx);
    const from = m.time.get_period_start(GameData.ResetCycle.Monthly, now);
    const to = m.time.get_next_reset(GameData.ResetCycle.Monthly, now);
    return sum_spend_of_user(m.storage.db(ctx), ctx.user_id, false, from, to, m.time.clock_now());
  };

  /** `pass`, or the `CheckPurchase` failure of the monthly spend limit check. */
  const spend_check = (ctx: RequestCtx, product: GameData.IapProductRow): 'pass' | CoreErrorValue => {
    const consent = m.storage.get_state(ctx, CoreContract.ConsentUserState, 0n) as CoreContract.ConsentUserState | null;
    const confirmed_at = consent?.age_confirmed_at ?? 0n;
    if (settings.age_confirmation && confirmed_at === 0n) return CoreError.CORE_ERROR_AGE_CONFIRMATION_REQUIRED;
    let limit: bigint | null = null;
    for (const [age, value] of Object.entries(settings.monthly_below_age)) {
      const n = Number(age);
      const below = consent !== null && confirmed_at !== 0n && consent.age_to !== 0 && consent.age_to <= n;
      if (!below || typeof value !== 'number') continue;
      const amount = BigInt(value);
      if (limit === null || amount < limit) limit = amount;
    }
    if (limit !== null && monthly_spend(ctx) + product.spend_amount > limit) return CoreError.CORE_ERROR_IAP_SPEND_LIMIT_REACHED;
    return 'pass';
  };

  const subscription_row = (ctx: RequestCtx, product_id: number): CoreContract.SubscriptionUserState | null =>
    m.storage.get_state(ctx, CoreContract.SubscriptionUserState, BigInt(product_id)) as CoreContract.SubscriptionUserState | null;

  const subscribed = (ctx: RequestCtx, product_id: number): boolean => {
    const row = subscription_row(ctx, product_id);
    return row !== null && is_entitled_state(row.state) && m.time.now(ctx) < row.ends_at;
  };

  /** `CheckPurchase` 1 and 2: the store sells the product and its sale condition holds. */
  const sale_refusal = (ctx: RequestCtx, product: GameData.IapProductRow, store: CoreContract.IapStore): CoreErrorValue | null => {
    if (!is_store(store) || sku_of(product, store) === '' || !c.adapters.has(store)) return CoreError.CORE_ERROR_IAP_PRODUCT_UNAVAILABLE;
    const start_at = product.start_at === 0n ? null : product.start_at;
    const end_at = product.end_at === 0n ? null : product.end_at;
    if (!m.live_event.is_in_active_window(ctx, start_at, end_at, product.live_event === 0 ? null : product.live_event)) return CoreError.CORE_ERROR_IAP_PRODUCT_UNAVAILABLE;
    if (product.offer !== 0 && !m.offer.is_offer_active(ctx, product.offer)) return CoreError.CORE_ERROR_IAP_PRODUCT_UNAVAILABLE;
    if (product.requirement !== 0 && !m.validation.evaluate_requirement(ctx, product.requirement).passed) return CoreError.CORE_ERROR_IAP_PRODUCT_LOCKED;
    return null;
  };

  /** `CheckPurchase` 3: the purchase limit, or an auto-renewing subscription with entitlement. */
  const limit_reached = (ctx: RequestCtx, product: GameData.IapProductRow): boolean => {
    if (product.limit_count > 0 && purchase_count(c, ctx, product) >= product.limit_count) return true;
    return product.type === ProductType.Subscription && subscribed(ctx, product.id) && subscription_row(ctx, product.id)?.auto_renew === true;
  };

  /** `CheckPurchase` 5: hook `validate_iap_purchase`. A throw or an output that is not `pass` or a `GameError` is `INTERNAL`. */
  const validate_hook = (ctx: RequestCtx, product: GameData.IapProductRow): 'pass' | number => {
    const hook = hook_slots.validate_iap_purchase;
    if (hook === null) return 'pass';
    let out: unknown;
    try {
      out = hook(ctx, product.id);
    } catch (error) {
      log(c, ctx, 'error', 'error', 'iap hook validate_iap_purchase threw', { stack_trace: error instanceof Error ? (error.stack ?? error.message) : String(error) });
      return CoreError.CORE_ERROR_INTERNAL;
    }
    if (out === 'pass' || is_failure_code(out)) return out;
    log(c, ctx, 'error', 'error', 'iap hook validate_iap_purchase gave an output that is not pass or a GameError');
    return CoreError.CORE_ERROR_INTERNAL;
  };

  const CheckPurchase = (ctx: RequestCtx, request: CoreContract.CheckPurchaseRequest): CoreContract.CheckPurchaseResponse | number => {
    const product = product_of(ctx, request.product_id);
    if (product === null) return CoreError.CORE_ERROR_IAP_PRODUCT_UNAVAILABLE;
    const refused = sale_refusal(ctx, product, request.store) ?? (limit_reached(ctx, product) ? CoreError.CORE_ERROR_IAP_LIMIT_REACHED : null);
    if (refused !== null) return refused;
    const spend = spend_check(ctx, product);
    if (spend !== 'pass') return spend;
    const hooked = validate_hook(ctx, product);
    if (hooked !== 'pass') return hooked;
    const token = account_token_of(c.account_key, ctx.user_id);
    if (m.storage.lock_game_row(ctx, ACCOUNT_TOKEN, [token]) === 'FAILED') return CoreError.CORE_ERROR_INTERNAL;
    insert_account_token(m.storage.db(ctx), token, ctx.user_id, m.time.clock_now());
    const response = new CoreContract.CheckPurchaseResponse();
    response.account_token = token;
    return response;
  };

  /** Grant order 4 to 9 and the purchase acknowledgement of a `GOOGLE` store transaction after commit. */
  const verify = (ctx: RequestCtx, prepared: PrepareValue): { status: CoreContract.PurchaseStatus; product_id: number; items: readonly CoreContract.ItemAmount[] } | CoreErrorValue => {
    const result = grant_order(c, ctx, prepared, account_token_of(c.account_key, ctx.user_id));
    if (typeof result === 'number') return result;
    const done = result.status === CoreContract.PurchaseStatus.PURCHASE_STATUS_GRANTED || result.status === CoreContract.PurchaseStatus.PURCHASE_STATUS_ALREADY_GRANTED;
    const binding = c.adapters.get(prepared.store);
    const tx = prepared.transaction;
    if (done && prepared.store === CoreContract.IapStore.IAP_STORE_GOOGLE && binding !== undefined && tx !== null) {
      const product = ctx.data.IapProductTable.get_row(result.product_id);
      const kind: AckKind = product.type === ProductType.Consumable ? 'consume' : product.type === ProductType.NonConsumable ? 'acknowledge' : 'subscription_acknowledge';
      const user_id = ctx.user_id;
      m.storage.after_commit(ctx, () => acknowledge(c, binding, prepared.store, tx, kind, user_id));
    }
    return result;
  };

  const VerifyPurchase = (ctx: RequestCtx, _request: CoreContract.VerifyPurchaseRequest, prepared: PrepareValue): CoreContract.VerifyPurchaseResponse | CoreErrorValue => {
    const result = verify(ctx, prepared);
    if (typeof result === 'number') return result;
    const response = new CoreContract.VerifyPurchaseResponse();
    response.status = result.status;
    response.product_id = result.product_id;
    response.items = [...result.items];
    return response;
  };

  const RecoverPurchase = (ctx: RequestCtx, _request: CoreContract.RecoverPurchaseRequest, prepared: PrepareValue): CoreContract.RecoverPurchaseResponse | CoreErrorValue => {
    const result = verify(ctx, prepared);
    if (typeof result === 'number') return result;
    const response = new CoreContract.RecoverPurchaseResponse();
    response.status = result.status;
    response.product_id = result.product_id;
    response.items = [...result.items];
    return response;
  };

  /** Grant order 1 to 3, outside the transaction. */
  const prepare_verify_purchase = async (user_id: bigint, store: CoreContract.IapStore | VerifyRequest, receipt?: string): Promise<PrepareValue | CoreErrorValue> => {
    const input = typeof store === 'object' ? store : { store, receipt: receipt ?? '' };
    const found = binding_of(input.store);
    if (found === null) return CoreError.CORE_ERROR_INVALID_REQUEST;
    const verification = await verify_receipt(c, found.binding, found.store, input.receipt, user_id);
    if (verification === null) return CoreError.CORE_ERROR_IAP_VERIFY_UNAVAILABLE;
    const tx = verification.transaction;
    let snapshot = null;
    if (verification.status === 'VALID' && tx !== null) {
      const product = product_by_sku(c.data, found.store, tx.sku);
      if (product !== null && product.type === ProductType.Subscription) {
        snapshot = await lookup_subscription(c, found.binding, found.store, tx.original_transaction_id, tx, user_id);
        if (snapshot === null) return CoreError.CORE_ERROR_IAP_VERIFY_UNAVAILABLE;
      }
    }
    return { store: found.store, status: verification.status, transaction: tx, snapshot };
  };

  /** `SyncSubscriptions` request prepare (`### subscription`). */
  const prepare_sync_subscriptions = async (user_id: bigint): Promise<null | CoreErrorValue> => {
    const now = m.time.clock_now();
    const interval = BigInt(settings.subscription_sync_interval_ms);
    const due = select_subscriptions_of_user(m.storage.read_db(), user_id, now).filter((row) => {
      const live = row.state === 'SUBSCRIPTION_STATE_ACTIVE' || row.state === 'SUBSCRIPTION_STATE_GRACE_PERIOD' || row.state === 'SUBSCRIPTION_STATE_BILLING_RETRY';
      return live && (now >= row.ends_at || row.updated_at + interval <= now);
    });
    let failed = false;
    for (const row of due) {
      const store = store_of_name(row.store);
      const binding = store === null ? undefined : c.adapters.get(store);
      if (store === null || binding === undefined) continue;
      const snapshot = await lookup_subscription(c, binding, store, row.original_transaction_id, null, user_id);
      if (snapshot === null) {
        failed = true;
        continue;
      }
      const result = await m.storage.run_user_transaction(user_id, (ctx) => subscription_apply(c, ctx, store, row.original_transaction_id, snapshot));
      if (result !== 'COMMITTED') {
        log_user(c, user_id, 'error', 'error', 'iap subscription apply of SyncSubscriptions failed', { store: row.store, result });
        failed = true;
      }
    }
    return failed ? CoreError.CORE_ERROR_IAP_VERIFY_UNAVAILABLE : null;
  };

  const SyncSubscriptions = (): CoreContract.SyncSubscriptionsResponse => new CoreContract.SyncSubscriptionsResponse();

  const ClaimIapDaily = (ctx: RequestCtx, request: CoreContract.ClaimIapDailyRequest): CoreContract.ClaimIapDailyResponse | CoreErrorValue => {
    const product = product_of(ctx, request.product_id);
    if (product === null || product.daily_reward.length === 0) return CoreError.CORE_ERROR_INVALID_REQUEST;
    const entitled = product.type === ProductType.Subscription ? subscribed(ctx, product.id) : is_pass(product) ? pass_active(c, ctx, product) : false;
    if (!entitled) return CoreError.CORE_ERROR_IAP_DAILY_INACTIVE;
    const today = m.time.get_day_number(m.time.now(ctx));
    const row = m.storage.get_state(ctx, CoreContract.IapPurchaseUserState, BigInt(product.id)) as CoreContract.IapPurchaseUserState | null;
    if (row !== null && row.daily_claimed_day === today) return CoreError.CORE_ERROR_IAP_ALREADY_CLAIMED;
    const source = { source: CoreContract.ItemChangeSource.ITEM_CHANGE_SOURCE_IAP, ref: `daily:${today.toString()}`, once_key: `iap:daily:${String(product.id)}:${today.toString()}` };
    const granted = m.mailbox.grant_or_mail(ctx, product.daily_reward, source, ctx.data.ReservedId.iap_grant_mail(), []);
    if (granted.result !== 'Granted' && granted.result !== 'AlreadyApplied' && granted.result !== 'Mailed') {
      log(c, ctx, 'error', 'error', 'iap grant_or_mail of the daily reward failed', { product_id: product.id, result: granted.result });
      return CoreError.CORE_ERROR_INTERNAL;
    }
    set_daily_claimed(c, ctx, product, today);
    const response = new CoreContract.ClaimIapDailyResponse();
    response.items = [...product.daily_reward];
    return response;
  };

  /**
   * Revokes the test `Subscription` record of `revoke_test_grant` in the ctx user's change. A record moved to another user
   * is revoked in that user's change after the commit.
   */
  const revoke_test_subscription = (ctx: RequestCtx, store: Store, sub: SubscriptionRow, now: bigint): void => {
    const db = m.storage.db(ctx);
    const time = m.time.now(ctx);
    const other = other_subscription_owner(ctx.user_id, select_binding(db, store_name(store), sub.original_transaction_id, now), sub);
    if (other !== null) {
      change_other_subscription_after_commit(c, ctx, other, store, sub.original_transaction_id, { kind: 'revoke', ends_at: time });
      return;
    }
    revoke_subscription(c, ctx, sub, time);
  };

  /** `revoke_test_grant` handler in the target user's out-of-request change. */
  const revoke_test_grant_handler = (input: Readonly<Record<string, unknown>>, ctx: RequestCtx): Record<string, unknown> | AdminFailure => {
    const store = input.store === 'APPLE' ? CoreContract.IapStore.IAP_STORE_APPLE : input.store === 'GOOGLE' ? CoreContract.IapStore.IAP_STORE_GOOGLE : null;
    const transaction_id = input.transaction_id;
    if (store === null || typeof transaction_id !== 'string') return 'bad_request';
    const now = m.time.clock_now();
    const read = recheck(c, ctx, store, transaction_id, null, (payment) => payment?.original_transaction_id ?? '');
    if (read === 'FAILED') return 'internal';
    const rec = read.payment;
    if (rec === null || rec.user_id !== ctx.user_id || !rec.test) return 'not_found';
    const sub = read.subscription;
    if (rec.result !== 'GRANTED') return 'conflict';
    if (refund_record(c, ctx, store, rec, 'iap_test_grant_revoked') !== 'pass') return 'internal';
    const product = product_of(ctx, rec.product_id);
    if (product !== null && product.type === ProductType.Subscription && sub !== null) revoke_test_subscription(ctx, store, sub, now);
    return {};
  };

  const revoke_test_grant: AdminOperation = {
    name: 'revoke_test_grant',
    role: 'economy',
    body: 'json',
    max_body_bytes: null,
    input: {
      operation_id: { type: { kind: 'string' }, optional: false },
      user_id: { type: { kind: 'int64' }, optional: false },
      store: { type: { kind: 'enum', elements: ['APPLE', 'GOOGLE'] }, optional: false },
      transaction_id: { type: { kind: 'string' }, optional: false },
    },
    user_target: 'user_id',
    handler: (input, ctx) => revoke_test_grant_handler(input, ctx),
    prepare: null,
    audit_args: null,
  };

  return {
    CheckPurchase,
    VerifyPurchase,
    RecoverPurchase,
    SyncSubscriptions,
    ClaimIapDaily,
    'POST /iap/notify/<store>': (request) => handle_notify(c, request),
    get_purchase_count: (ctx, product_id) => {
      const product = product_of(ctx, product_id);
      return product === null ? 0 : purchase_count(c, ctx, product);
    },
    is_subscribed: (ctx, product_id) => subscribed(ctx, product_id),
    is_pass_active: (ctx, product_id) => {
      const product = product_of(ctx, product_id);
      return product !== null && pass_active(c, ctx, product);
    },
    list_payments: (user_id) => {
      const db = m.storage.read_db();
      const now = m.time.clock_now();
      return { payments: select_payments_of_user(db, user_id, now), other_user_attempts: select_other_user_of_user(db, user_id, now) };
    },
    has_granted_payment: (ctx, user_id) => has_granted_of_user(m.storage.db(ctx), user_id, false, m.time.clock_now()),
    prepare_verify_purchase,
    prepare_sync_subscriptions,
    register_account_lookup: (has_social_link) => {
      if (completed) throw new Error('iap: register_account_lookup was called after server start');
      lookups += 1;
      if (lookups > 1) start_errors.push('register_account_lookup was called twice');
      else c.has_social_link = has_social_link;
      return null;
    },
    revoke_test_grant,
    remove_user: (ctx) => {
      mark_user_rows(m.storage.db(ctx), ctx.user_id, m.time.now(ctx) + BigInt(settings.withdrawn_record_retention_ms));
      return null;
    },
    hook_slots,
    begin_start,
    complete_start,
    stop: () => undefined,
    include_dev_code: (code) => {
      dev = code;
      c.fake_notification = code.parse_fake_notification;
      return { binding: (store) => c.adapters.get(store), notify: (request) => handle_notify(c, request) };
    },
  };
}
