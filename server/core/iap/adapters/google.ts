/**
 * Real adapter `iap-google` (`## settings`): the Google Play Developer API with an access token from a service account
 * RS256 JWT, and store notifications by Pub/Sub push with an OIDC token checked against the key source's Google keys.
 * Receipt data is the Play Billing `Purchase.getOriginalJson()` text.
 */
import * as CoreContract from '../../../generated/contract/core_contract.ts';
import { is_object, parse_json, read_limited, type AckKind, type AdapterCall, type AdapterFailure, type HttpFetch, type KeySource, type StoreAdapter, type StoreNotification, type StoreTransaction, type SubscriptionSnapshot, type Verification } from '../adapter.ts';
import { sign_rs256, verify_rs256_jwks } from './jws.ts';

const API = 'https://androidpublisher.googleapis.com/androidpublisher/v3/applications';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const SCOPE = 'https://www.googleapis.com/auth/androidpublisher';
export const GOOGLE_CERTS_URL = 'https://www.googleapis.com/oauth2/v3/certs';
const ISSUERS: ReadonlySet<unknown> = new Set(['accounts.google.com', 'https://accounts.google.com']);
const TOKEN_LIFETIME_S = 3600n;
/** An access token is used until this many ms before it ends. */
const TOKEN_MARGIN_MS = 60_000n;

/** Google `subscriptionNotification.notificationType` values the iap notification kind `SUBSCRIPTION` covers. */
const SUBSCRIPTION_TYPES: ReadonlySet<unknown> = new Set([1, 2, 3, 5, 6, 12, 13]);

const STATES: ReadonlyMap<string, CoreContract.SubscriptionState> = new Map([
  ['SUBSCRIPTION_STATE_ACTIVE', CoreContract.SubscriptionState.SUBSCRIPTION_STATE_ACTIVE],
  ['SUBSCRIPTION_STATE_CANCELED', CoreContract.SubscriptionState.SUBSCRIPTION_STATE_ACTIVE],
  ['SUBSCRIPTION_STATE_IN_GRACE_PERIOD', CoreContract.SubscriptionState.SUBSCRIPTION_STATE_GRACE_PERIOD],
  ['SUBSCRIPTION_STATE_ON_HOLD', CoreContract.SubscriptionState.SUBSCRIPTION_STATE_BILLING_RETRY],
  ['SUBSCRIPTION_STATE_PENDING', CoreContract.SubscriptionState.SUBSCRIPTION_STATE_BILLING_RETRY],
  ['SUBSCRIPTION_STATE_PAUSED', CoreContract.SubscriptionState.SUBSCRIPTION_STATE_EXPIRED],
  ['SUBSCRIPTION_STATE_EXPIRED', CoreContract.SubscriptionState.SUBSCRIPTION_STATE_EXPIRED],
  ['SUBSCRIPTION_STATE_PENDING_PURCHASE_CANCELED', CoreContract.SubscriptionState.SUBSCRIPTION_STATE_EXPIRED],
]);

export interface GoogleAdapterOptions {
  /** The `iapGoogle.serviceAccountEmail` service account private key (PEM). */
  readonly private_key_pem: string;
  readonly service_account_email: string;
  readonly notification_service_account_email: string;
  /** `environments.<ENV>.serverUrl` + `/iap/notify/google`. */
  readonly notification_audience: string;
  /** Game settings `appId`. */
  readonly package_name: string;
  readonly is_subscription_sku: (sku: string) => boolean;
  readonly fetch: HttpFetch;
  /** Gives the Google JWKS (`{keys: [...]}`). */
  readonly key_source: KeySource;
  readonly max_response_bytes: number;
  readonly clock_now: () => bigint;
}

/** What the purchase acknowledgement reads of a store transaction. */
interface GoogleAck {
  readonly token: string;
  readonly product_id: string;
}

/** `json` is undefined for a body that is not JSON, an empty body among them. */
type Fetched = { status: number; json: unknown } | AdapterFailure;

async function fetch_json(fetch: HttpFetch, max: number, url: string, init: RequestInit): Promise<Fetched> {
  let response: Response;
  try {
    response = await fetch(url, init);
  } catch {
    return 'communication_failure';
  }
  const body = await read_limited(response, max);
  if (body === null) return 'communication_failure';
  return { status: response.status, json: parse_json(body) };
}

/** The server key source of `iap-google`: the Google public keys from `GOOGLE_CERTS_URL`. */
export function google_key_source(fetch: HttpFetch, max_response_bytes: number): KeySource {
  return async () => {
    const got = await fetch_json(fetch, max_response_bytes, GOOGLE_CERTS_URL, { method: 'GET' });
    if (typeof got === 'string') return got;
    return got.status === 200 && is_object(got.json) ? got.json : 'communication_failure';
  };
}

function ms_of(value: unknown): bigint | null {
  if (typeof value === 'string' && /^\d+$/.test(value)) return BigInt(value);
  if (typeof value === 'number' && Number.isSafeInteger(value)) return BigInt(value);
  if (typeof value === 'string') {
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? null : BigInt(parsed);
  }
  return null;
}

/** The receipt's purchase JSON fields, or null. */
function receipt_of(receipt: string): { product_id: string; token: string; package_name: string } | null {
  let json: unknown;
  try {
    json = JSON.parse(receipt) as unknown;
  } catch {
    return null;
  }
  if (!is_object(json) || typeof json.productId !== 'string' || typeof json.purchaseToken !== 'string' || json.productId === '' || json.purchaseToken === '') return null;
  return {
    product_id: json.productId,
    token: json.purchaseToken,
    package_name: typeof json.packageName === 'string' ? json.packageName : '',
  };
}

type Receipt = NonNullable<ReturnType<typeof receipt_of>>;

function text_of(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function account_of(json: Record<string, unknown>): string {
  if (typeof json.obfuscatedExternalAccountId === 'string') return json.obfuscatedExternalAccountId.toLowerCase();
  const ids = json.externalAccountIdentifiers;
  return is_object(ids) ? text_of(ids.obfuscatedExternalAccountId).toLowerCase() : '';
}

function is_test_purchase(json: Record<string, unknown>): boolean {
  return json.testPurchase !== undefined && json.testPurchase !== null;
}

/** The line item that ends last, with its end. */
function last_line(json: Record<string, unknown>): { line: Record<string, unknown>; ends_at: bigint } | null {
  const items = Array.isArray(json.lineItems) ? (json.lineItems as unknown[]).filter(is_object) : [];
  let last: { line: Record<string, unknown>; ends_at: bigint } | null = null;
  for (const line of items) {
    const ends_at = ms_of(line.expiryTime) ?? 0n;
    if (last === null || ends_at >= last.ends_at) last = { line, ends_at };
  }
  return last;
}

/** The order ID of a `subscriptionsv2` line item: its latest successful order, else the response's latest order. */
function latest_order_of(json: Record<string, unknown>, line: Record<string, unknown>): string {
  return text_of(line.latestSuccessfulOrderId) || text_of(json.latestOrderId);
}

/** Subscription states of a purchase that waits for payment: Google sets no `startTime` for them. */
const PENDING_STATES: ReadonlySet<unknown> = new Set(['SUBSCRIPTION_STATE_PENDING', 'SUBSCRIPTION_STATE_PENDING_PURCHASE_CANCELED']);

/**
 * The purchase time of a `subscriptionsv2` response: `startTime`. A pending purchase has none: null, the request time.
 * `bad_response` when another response has none.
 */
function start_of(json: Record<string, unknown>): bigint | null | 'bad_response' {
  const start = ms_of(json.startTime);
  if (start !== null) return start;
  return PENDING_STATES.has(json.subscriptionState) ? null : 'bad_response';
}

/** The subscription snapshot of a `subscriptionsv2` response; a canceled subscription past its end is `EXPIRED`. */
function snapshot_of(json: Record<string, unknown>, now: bigint): SubscriptionSnapshot | 'rejected' | 'bad_response' {
  const state = STATES.get(text_of(json.subscriptionState));
  const last = last_line(json);
  if (state === undefined || last === null) return 'rejected';
  const purchased_at = start_of(json);
  if (purchased_at === 'bad_response') return purchased_at;
  const plan = is_object(last.line.autoRenewingPlan) ? last.line.autoRenewingPlan : null;
  const canceled = json.subscriptionState === 'SUBSCRIPTION_STATE_CANCELED';
  return {
    state: canceled && now >= last.ends_at ? CoreContract.SubscriptionState.SUBSCRIPTION_STATE_EXPIRED : state,
    ends_at: last.ends_at,
    auto_renew: !canceled && plan !== null && plan.autoRenewEnabled === true,
    latest_transaction_id: latest_order_of(json, last.line),
    sku: text_of(last.line.productId),
    purchased_at,
    test: is_test_purchase(json),
  };
}

/**
 * The store transaction of a subscription purchase: transaction ID the order ID of the receipt product's line item in
 * the `subscriptionsv2` response, original transaction ID the purchase token. The receipt's order ID and purchase time
 * are not read: the client wrote them.
 */
function subscription_transaction(r: Receipt, json: Record<string, unknown>, line: Record<string, unknown>): StoreTransaction | 'bad_response' {
  const purchased_at = start_of(json);
  if (purchased_at === 'bad_response') return purchased_at;
  return {
    transaction_id: latest_order_of(json, line),
    original_transaction_id: r.token,
    sku: r.product_id,
    app_id: r.package_name,
    account_token: account_of(json),
    purchased_at,
    test: is_test_purchase(json),
    device_receipt: true,
    ack: { token: r.token, product_id: r.product_id } satisfies GoogleAck,
  };
}

/**
 * The store transaction of a one-time product purchase: the order ID of the `purchases.products` response, or the
 * purchase token when there is none (promo code). The receipt's order ID and purchase time are not read. `bad_response`
 * when the response has no `purchaseTimeMillis`.
 */
function product_transaction(r: Receipt, json: Record<string, unknown>): StoreTransaction | 'bad_response' {
  const order_id = text_of(json.orderId) || r.token;
  const purchased_at = ms_of(json.purchaseTimeMillis);
  if (purchased_at === null) return 'bad_response';
  return {
    transaction_id: order_id,
    original_transaction_id: order_id,
    sku: r.product_id,
    app_id: r.package_name,
    account_token: account_of(json),
    purchased_at,
    test: json.purchaseType === 0,
    device_receipt: true,
    ack: { token: r.token, product_id: r.product_id } satisfies GoogleAck,
  };
}

/** The verification result of an API response: INVALID for a token Google does not know, a failure for other errors. */
function failed_lookup(status: number): Verification | AdapterFailure | null {
  if (status === 400 || status === 404 || status === 410) return { status: 'INVALID', transaction: null };
  return status === 200 ? null : 'communication_failure';
}

/** The message ID and the developer notification of a Pub/Sub push body, or `bad_format`. */
function read_push(body: Uint8Array): { id: string; inner: Record<string, unknown> } | 'bad_format' {
  const json = parse_json(body);
  if (!is_object(json) || !is_object(json.message) || typeof json.message.data !== 'string') return 'bad_format';
  const id = text_of(json.message.messageId) || text_of(json.message.message_id);
  const inner = parse_json(Buffer.from(json.message.data, 'base64'));
  return !is_object(inner) || id === '' ? 'bad_format' : { id, inner };
}

/** True for OIDC token claims of the notification service account, verified, for this audience, not expired. */
function claims_ok(claims: Record<string, unknown> | null, options: GoogleAdapterOptions, now: bigint): boolean {
  if (claims === null) return false;
  const exp = ms_of(claims.exp);
  const from_account = claims.email === options.notification_service_account_email && claims.email_verified === true;
  return ISSUERS.has(claims.iss) && from_account && claims.aud === options.notification_audience && exp !== null && exp * 1000n > now;
}

/** The notification of a developer notification: a voided purchase is `REFUND`, the listed subscription types `SUBSCRIPTION`. */
function notification_of(id: string, inner: Record<string, unknown>): StoreNotification | 'bad_format' {
  if (is_object(inner.voidedPurchaseNotification)) {
    const voided = inner.voidedPurchaseNotification;
    const value = text_of(voided.orderId) || text_of(voided.purchaseToken);
    return value === '' ? 'bad_format' : { notification_id: id, kind: 'REFUND', value };
  }
  const sub = inner.subscriptionNotification;
  if (is_object(sub) && SUBSCRIPTION_TYPES.has(sub.notificationType)) {
    const token = text_of(sub.purchaseToken);
    return token === '' ? 'bad_format' : { notification_id: id, kind: 'SUBSCRIPTION', value: token };
  }
  return { notification_id: id, kind: 'OTHER', value: '' };
}

export function create_google_adapter(options: GoogleAdapterOptions): StoreAdapter {
  const max = options.max_response_bytes;
  const app = `${API}/${encodeURIComponent(options.package_name)}`;
  let cached: { token: string; until: bigint } | null = null;

  /** A Google Play Developer API access token, kept until shortly before it ends. */
  const access_token = async (call: AdapterCall): Promise<{ token: string } | AdapterFailure> => {
    const now = options.clock_now();
    if (cached !== null && now < cached.until) return { token: cached.token };
    const iat = now / 1000n;
    const assertion = sign_rs256(
      { iss: options.service_account_email, scope: SCOPE, aud: TOKEN_URL, iat: Number(iat), exp: Number(iat + TOKEN_LIFETIME_S) },
      options.private_key_pem,
    );
    const body = new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }).toString();
    const got = await fetch_json(options.fetch, max, TOKEN_URL, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body, signal: call.signal });
    if (typeof got === 'string') return got;
    if (got.status !== 200 || !is_object(got.json) || typeof got.json.access_token !== 'string') return 'rejected';
    const lifetime = typeof got.json.expires_in === 'number' ? BigInt(Math.floor(got.json.expires_in)) * 1000n : TOKEN_LIFETIME_S * 1000n;
    cached = { token: got.json.access_token, until: now + lifetime - TOKEN_MARGIN_MS };
    return { token: cached.token };
  };

  const api = async (method: 'GET' | 'POST', path: string, call: AdapterCall): Promise<Fetched> => {
    const access = await access_token(call);
    if (typeof access === 'string') return access;
    return fetch_json(options.fetch, max, `${app}${path}`, { method, headers: { authorization: `Bearer ${access.token}` }, signal: call.signal });
  };

  /** A 200 answer whose body is not a JSON object is a communication failure; another status keeps its body or `{}`. */
  const subscription = async (token: string, call: AdapterCall): Promise<{ status: number; json: Record<string, unknown> } | AdapterFailure> => {
    const got = await api('GET', `/purchases/subscriptionsv2/tokens/${encodeURIComponent(token)}`, call);
    if (typeof got === 'string') return got;
    if (got.status === 200 && !is_object(got.json)) return 'communication_failure';
    return { status: got.status, json: is_object(got.json) ? got.json : {} };
  };

  const verify_subscription = async (r: Receipt, call: AdapterCall): Promise<Verification | AdapterFailure> => {
    const got = await subscription(r.token, call);
    if (typeof got === 'string') return got;
    const failed = failed_lookup(got.status);
    if (failed !== null) return failed;
    // The lookup takes the purchase token alone: a receipt product that is no line item of it is another product's receipt.
    const lines = Array.isArray(got.json.lineItems) ? (got.json.lineItems as unknown[]).filter(is_object) : [];
    const line = lines.find((item) => item.productId === r.product_id);
    if (line === undefined) return { status: 'INVALID', transaction: null };
    const state = got.json.subscriptionState;
    const status = state === 'SUBSCRIPTION_STATE_PENDING' ? 'PENDING' : state === 'SUBSCRIPTION_STATE_PENDING_PURCHASE_CANCELED' ? 'INVALID' : 'VALID';
    const transaction = subscription_transaction(r, got.json, line);
    return transaction === 'bad_response' ? transaction : { status, transaction };
  };

  const verify_product = async (r: Receipt, call: AdapterCall): Promise<Verification | AdapterFailure> => {
    const got = await api('GET', `/purchases/products/${encodeURIComponent(r.product_id)}/tokens/${encodeURIComponent(r.token)}`, call);
    if (typeof got === 'string') return got;
    const failed = failed_lookup(got.status);
    if (failed !== null) return failed;
    if (!is_object(got.json)) return 'communication_failure';
    const state = got.json.purchaseState;
    const status = state === 0 ? 'VALID' : state === 2 ? 'PENDING' : 'INVALID';
    const transaction = product_transaction(r, got.json);
    return transaction === 'bad_response' ? transaction : { status, transaction };
  };

  /** The OIDC token check of a push request: `ok`, `bad_signature`, or the key source failure. */
  const check_push_token = async (headers: Readonly<Record<string, string>>, now: bigint): Promise<'ok' | 'bad_signature' | AdapterFailure> => {
    const auth = headers.authorization ?? '';
    if (!auth.startsWith('Bearer ')) return 'bad_signature';
    let jwks: unknown;
    try {
      jwks = await options.key_source();
    } catch {
      return 'communication_failure';
    }
    if (jwks === 'timeout' || jwks === 'communication_failure') return jwks;
    return claims_ok(verify_rs256_jwks(auth.slice('Bearer '.length), jwks), options, now) ? 'ok' : 'bad_signature';
  };

  return {
    verify(receipt, call): Promise<Verification | AdapterFailure> {
      const r = receipt_of(receipt);
      if (r === null) return Promise.resolve({ status: 'INVALID', transaction: null });
      return options.is_subscription_sku(r.product_id) ? verify_subscription(r, call) : verify_product(r, call);
    },

    async lookup_subscription(original_transaction_id, _latest, call): Promise<SubscriptionSnapshot | AdapterFailure> {
      const got = await subscription(original_transaction_id, call);
      if (typeof got === 'string') return got;
      if (got.status !== 200) return got.status === 404 || got.status === 410 ? 'rejected' : 'communication_failure';
      return snapshot_of(got.json, call.now);
    },

    async acknowledge(transaction, kind: AckKind, call): Promise<null | AdapterFailure> {
      const ack = transaction.ack as GoogleAck | null;
      if (ack === null || typeof ack.token !== 'string') return 'rejected';
      const product = encodeURIComponent(ack.product_id);
      const token = encodeURIComponent(ack.token);
      const path =
        kind === 'consume'
          ? `/purchases/products/${product}/tokens/${token}:consume`
          : kind === 'acknowledge'
            ? `/purchases/products/${product}/tokens/${token}:acknowledge`
            : `/purchases/subscriptions/${product}/tokens/${token}:acknowledge`;
      const done = await api('POST', path, call);
      if (typeof done === 'string') return done;
      if (done.status >= 200 && done.status < 300) return null;
      // Already consumed or acknowledged is a success: read the purchase state.
      const state = kind === 'subscription_acknowledge' ? await subscription(ack.token, call) : await api('GET', `/purchases/products/${product}/tokens/${token}`, call);
      if (typeof state === 'string') return state;
      const json = is_object(state.json) ? state.json : {};
      const settled = kind === 'consume' ? json.consumptionState === 1 : kind === 'acknowledge' ? json.acknowledgementState === 1 : json.acknowledgementState === 'ACKNOWLEDGEMENT_STATE_ACKNOWLEDGED';
      return state.status === 200 && settled ? null : 'rejected';
    },

    async parse_notification(headers, body, call): Promise<StoreNotification | 'bad_signature' | 'bad_format' | AdapterFailure> {
      const push = read_push(body);
      if (push === 'bad_format') return push;
      const checked = await check_push_token(headers, call.now);
      if (checked !== 'ok') return checked;
      if (push.inner.packageName !== options.package_name) return 'bad_signature';
      return notification_of(push.id, push.inner);
    },
  };
}
