/**
 * Real adapters `iap-apple` and `iap-apple-sandbox` (`## settings`): the App Store Server API with an ES256 bearer
 * JWT, and signed JWS data checked through its certificate chain up to the key source's root certificate.
 * Receipt data is the StoreKit 2 transaction JWS (`jwsRepresentation`) or a transaction ID.
 */
import * as CoreContract from '../../../generated/contract/core_contract.ts';
import { is_object, parse_json, read_limited, type AdapterCall, type AdapterFailure, type HttpFetch, type KeySource, type StoreAdapter, type StoreNotification, type StoreTransaction, type SubscriptionSnapshot, type Verification } from '../adapter.ts';
import { decode_jws, roots_of, sign_es256, verify_x5c_jws } from './jws.ts';

/** Apple Root CA - G3 (SHA-256 fingerprint 63343ABFB89A6A03EBB57E9B3F5FA7BE7C4F5C756F3017B3A8C488C3653E9179). */
export const APPLE_ROOT_CA_G3 = `-----BEGIN CERTIFICATE-----
MIICQzCCAcmgAwIBAgIILcX8iNLFS5UwCgYIKoZIzj0EAwMwZzEbMBkGA1UEAwwS
QXBwbGUgUm9vdCBDQSAtIEczMSYwJAYDVQQLDB1BcHBsZSBDZXJ0aWZpY2F0aW9u
IEF1dGhvcml0eTETMBEGA1UECgwKQXBwbGUgSW5jLjELMAkGA1UEBhMCVVMwHhcN
MTQwNDMwMTgxOTA2WhcNMzkwNDMwMTgxOTA2WjBnMRswGQYDVQQDDBJBcHBsZSBS
b290IENBIC0gRzMxJjAkBgNVBAsMHUFwcGxlIENlcnRpZmljYXRpb24gQXV0aG9y
aXR5MRMwEQYDVQQKDApBcHBsZSBJbmMuMQswCQYDVQQGEwJVUzB2MBAGByqGSM49
AgEGBSuBBAAiA2IABJjpLz1AcqTtkyJygRMc3RCV8cWjTnHcFBbZDuWmBSp3ZHtf
TjjTuxxEtX/1H7YyYl3J6YRbTzBPEVoA/VhYDKX1DyxNB0cTddqXl5dvMVztK517
IDvYuVTZXpmkOlEKMaNCMEAwHQYDVR0OBBYEFLuw3qFYM4iapIqZ3r6966/ayySr
MA8GA1UdEwEB/wQFMAMBAf8wDgYDVR0PAQH/BAQDAgEGMAoGCCqGSM49BAMDA2gA
MGUCMQCD6cHEFl4aXTQY2e3v9GwOAEZLuN+yRhHFD/3meoyhpmvOwgPUnPWTxnS4
at+qIxUCMG1mihDK1A3UT82NQz60imOlM27jbdoXt2QfyFMm+YhidDkLF1vLUagM
6BgD56KyKA==
-----END CERTIFICATE-----
`;

/** Apple's marker extensions of the signing leaf certificate and of the intermediate certificate. */
export const APPLE_LEAF_OID = '1.2.840.113635.100.6.11.1';
export const APPLE_INTERMEDIATE_OID = '1.2.840.113635.100.6.2.1';

const PRODUCTION = 'https://api.storekit.itunes.apple.com';
const SANDBOX = 'https://api.storekit-sandbox.itunes.apple.com';
const TOKEN_LIFETIME_S = 300n;

/** Apple notification types the iap notification kind `SUBSCRIPTION` covers. */
const SUBSCRIPTION_TYPES: ReadonlySet<string> = new Set(['DID_RENEW', 'EXPIRED', 'DID_FAIL_TO_RENEW', 'GRACE_PERIOD_EXPIRED', 'DID_CHANGE_RENEWAL_STATUS', 'REVOKE']);

/** App Store subscription status codes. */
const STATUS_STATES: ReadonlyMap<number, CoreContract.SubscriptionState> = new Map([
  [1, CoreContract.SubscriptionState.SUBSCRIPTION_STATE_ACTIVE],
  [2, CoreContract.SubscriptionState.SUBSCRIPTION_STATE_EXPIRED],
  [3, CoreContract.SubscriptionState.SUBSCRIPTION_STATE_BILLING_RETRY],
  [4, CoreContract.SubscriptionState.SUBSCRIPTION_STATE_GRACE_PERIOD],
  [5, CoreContract.SubscriptionState.SUBSCRIPTION_STATE_REVOKED],
]);

export interface AppleAdapterOptions {
  readonly name: 'iap-apple' | 'iap-apple-sandbox';
  /** The App Store Server API private key (`.p8` PEM). */
  readonly private_key_pem: string;
  readonly key_id: string;
  readonly issuer_id: string;
  /** Game settings `appId`: the JWT `bid` and the `bundleId` signed data must have. */
  readonly bundle_id: string;
  readonly app_apple_id: number;
  readonly fetch: HttpFetch;
  /** Gives the root certificates (PEM or base64 DER strings). */
  readonly key_source: KeySource;
  readonly max_response_bytes: number;
}

type Fetched = { status: number; json: unknown } | AdapterFailure;

function int(value: unknown): bigint | null {
  if (typeof value === 'number' && Number.isSafeInteger(value)) return BigInt(value);
  if (typeof value === 'string' && /^\d+$/.test(value)) return BigInt(value);
  return null;
}

/** The transaction ID a receipt names: the `transactionId` of a transaction JWS, or the receipt itself when it is digits. */
export function apple_transaction_id(receipt: string): string | null {
  if (/^\d{1,64}$/.test(receipt)) return receipt;
  const jws = decode_jws(receipt);
  const id = jws?.payload.transactionId;
  return typeof id === 'string' && /^\d{1,64}$/.test(id) ? id : null;
}

/** The `lastTransactions` item of an original transaction ID in a subscription status response, or null. */
function last_transaction_of(json: unknown, original_transaction_id: string): Record<string, unknown> | null {
  if (!is_object(json) || !Array.isArray(json.data)) return null;
  for (const group of json.data as unknown[]) {
    if (!is_object(group) || !Array.isArray(group.lastTransactions)) continue;
    const found = (group.lastTransactions as unknown[]).find((item) => is_object(item) && item.originalTransactionId === original_transaction_id);
    if (found !== undefined && is_object(found)) return found;
  }
  return null;
}

/** `ends_at` of a subscription state: the grace period end, the revocation time, else the expiry. */
function ends_at_of(state: CoreContract.SubscriptionState, tx: Record<string, unknown>, renewal: Record<string, unknown> | null): bigint {
  const grace = renewal === null ? null : int(renewal.gracePeriodExpiresDate);
  const revoked = int(tx.revocationDate);
  if (state === CoreContract.SubscriptionState.SUBSCRIPTION_STATE_GRACE_PERIOD && grace !== null) return grace;
  if (state === CoreContract.SubscriptionState.SUBSCRIPTION_STATE_REVOKED && revoked !== null) return revoked;
  return int(tx.expiresDate) ?? 0n;
}

/** A `REFUND` notification with its transaction ID, or a `SUBSCRIPTION` one with its original transaction ID. */
function notification_of(id: string, type: string, tx: Record<string, unknown>): StoreNotification | 'bad_format' {
  const value = type === 'REFUND' ? tx.transactionId : tx.originalTransactionId;
  if (typeof value !== 'string') return 'bad_format';
  return { notification_id: id, kind: type === 'REFUND' ? 'REFUND' : 'SUBSCRIPTION', value };
}

export function create_apple_adapter(options: AppleAdapterOptions): StoreAdapter {
  const bases = options.name === 'iap-apple' ? [PRODUCTION, SANDBOX] : [SANDBOX];

  const bearer = (now: bigint): string => {
    const iat = now / 1000n;
    return sign_es256(
      { kid: options.key_id },
      { iss: options.issuer_id, iat: Number(iat), exp: Number(iat + TOKEN_LIFETIME_S), aud: 'appstoreconnect-v1', bid: options.bundle_id },
      options.private_key_pem,
    );
  };

  const get = async (url: string, call: AdapterCall): Promise<Fetched> => {
    let response: Response;
    try {
      response = await options.fetch(url, { method: 'GET', headers: { authorization: `Bearer ${bearer(call.now)}` }, signal: call.signal });
    } catch {
      return 'communication_failure';
    }
    const body = await read_limited(response, options.max_response_bytes);
    if (body === null) return 'communication_failure';
    return { status: response.status, json: parse_json(body) };
  };

  const roots = async (): Promise<ReturnType<typeof roots_of> | AdapterFailure> => {
    let value: unknown;
    try {
      value = await options.key_source();
    } catch {
      return 'communication_failure';
    }
    if (value === 'timeout' || value === 'communication_failure') return value;
    return roots_of(value) ?? 'rejected';
  };

  /** A signed JWS payload checked against the root certificates at `now`. */
  const signed = async (token: unknown, now: bigint): Promise<Record<string, unknown> | null | AdapterFailure> => {
    if (typeof token !== 'string') return null;
    const certs = await roots();
    if (typeof certs === 'string' || certs === null) return typeof certs === 'string' ? certs : 'rejected';
    return verify_x5c_jws(token, certs, APPLE_LEAF_OID, APPLE_INTERMEDIATE_OID, now);
  };

  const transaction_of = (payload: Record<string, unknown>): StoreTransaction | null => {
    const purchased_at = int(payload.purchaseDate);
    if (typeof payload.transactionId !== 'string' || typeof payload.originalTransactionId !== 'string' || typeof payload.productId !== 'string' || purchased_at === null) return null;
    return {
      transaction_id: payload.transactionId,
      original_transaction_id: payload.originalTransactionId,
      sku: payload.productId,
      app_id: typeof payload.bundleId === 'string' ? payload.bundleId : '',
      account_token: typeof payload.appAccountToken === 'string' ? payload.appAccountToken.toLowerCase() : '',
      purchased_at,
      test: payload.environment !== 'Production',
      device_receipt: false,
      ack: null,
    };
  };

  /**
   * A device receipt: a transaction JWS that passes the same certificate chain check as the store's transaction
   * information and whose `transactionId` is the verified transaction ID. A transaction ID receipt is not one.
   */
  const is_device_receipt = async (receipt: string, transaction_id: string, now: bigint): Promise<boolean | AdapterFailure> => {
    if (decode_jws(receipt) === null) return false;
    const payload = await signed(receipt, now);
    if (typeof payload === 'string') return payload;
    return payload !== null && payload.transactionId === transaction_id;
  };

  /** The verification of a receipt from the store's signed transaction information. */
  const verification_of = async (receipt: string, info: unknown, now: bigint): Promise<Verification | AdapterFailure> => {
    const payload = await signed(info, now);
    if (typeof payload === 'string') return payload;
    const transaction = payload === null ? null : transaction_of(payload);
    if (payload === null || transaction === null) return { status: 'INVALID', transaction: null };
    const device_receipt = await is_device_receipt(receipt, transaction.transaction_id, now);
    if (typeof device_receipt === 'string') return device_receipt;
    const revoked = payload.revocationDate !== undefined && payload.revocationDate !== null;
    const other_app = transaction.app_id !== options.bundle_id;
    return { status: revoked || other_app ? 'INVALID' : 'VALID', transaction: { ...transaction, device_receipt } };
  };

  /** True for a notification payload with an ID and a type whose data is of this app. */
  const is_app_notification = (payload: Record<string, unknown>): payload is Record<string, unknown> & { notificationUUID: string; notificationType: string } => {
    if (typeof payload.notificationUUID !== 'string' || typeof payload.notificationType !== 'string') return false;
    const data = is_object(payload.data) ? payload.data : {};
    return data.bundleId === options.bundle_id && (data.environment !== 'Production' || data.appAppleId === options.app_apple_id);
  };

  /** The subscription snapshot of a `lastTransactions` item of the status lookup. */
  const snapshot_of = async (item: Record<string, unknown>, now: bigint): Promise<SubscriptionSnapshot | AdapterFailure> => {
    const state = typeof item.status === 'number' ? STATUS_STATES.get(item.status) : undefined;
    const tx = await signed(item.signedTransactionInfo, now);
    const renewal = await signed(item.signedRenewalInfo, now);
    if (typeof tx === 'string') return tx;
    if (typeof renewal === 'string') return renewal;
    const transaction = tx === null ? null : transaction_of(tx);
    if (state === undefined || tx === null || transaction === null) return 'rejected';
    return {
      state,
      ends_at: ends_at_of(state, tx, renewal),
      auto_renew: renewal !== null && renewal.autoRenewStatus === 1,
      latest_transaction_id: transaction.transaction_id,
      sku: transaction.sku,
      purchased_at: transaction.purchased_at,
      test: transaction.test,
    };
  };

  return {
    async verify(receipt, call): Promise<Verification | AdapterFailure> {
      const id = apple_transaction_id(receipt);
      if (id === null) return { status: 'INVALID', transaction: null };
      for (const base of bases) {
        const got = await get(`${base}/inApps/v1/transactions/${id}`, call);
        if (typeof got === 'string') return got;
        if (got.status === 404) continue;
        if (got.status === 400) return { status: 'INVALID', transaction: null };
        if (got.status !== 200 || !is_object(got.json)) return 'communication_failure';
        return verification_of(receipt, got.json.signedTransactionInfo, call.now);
      }
      return { status: 'INVALID', transaction: null };
    },

    async lookup_subscription(original_transaction_id, latest, call): Promise<SubscriptionSnapshot | AdapterFailure> {
      const order = latest === null ? bases : latest.test ? [SANDBOX] : [PRODUCTION];
      for (const base of order) {
        const got = await get(`${base}/inApps/v1/subscriptions/${encodeURIComponent(original_transaction_id)}`, call);
        if (typeof got === 'string') return got;
        if (got.status === 404) continue;
        if (got.status !== 200) return 'communication_failure';
        const item = last_transaction_of(got.json, original_transaction_id);
        return item === null ? 'rejected' : snapshot_of(item, call.now);
      }
      return 'rejected';
    },

    acknowledge: () => Promise.resolve(null),

    async parse_notification(_headers, body, call): Promise<StoreNotification | 'bad_signature' | 'bad_format' | AdapterFailure> {
      const json = parse_json(body);
      if (!is_object(json) || typeof json.signedPayload !== 'string' || decode_jws(json.signedPayload) === null) return 'bad_format';
      const payload = await signed(json.signedPayload, call.now);
      if (typeof payload === 'string') return payload;
      if (payload === null || !is_app_notification(payload)) return 'bad_signature';
      const type = payload.notificationType;
      if (type !== 'REFUND' && !SUBSCRIPTION_TYPES.has(type)) return { notification_id: payload.notificationUUID, kind: 'OTHER', value: '' };
      const tx = await signed(is_object(payload.data) ? payload.data.signedTransactionInfo : undefined, call.now);
      if (tx === null || typeof tx === 'string') return tx ?? 'bad_signature';
      return notification_of(payload.notificationUUID, type, tx);
    },
  };
}
