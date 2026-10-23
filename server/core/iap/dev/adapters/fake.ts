/**
 * The fake `iap-apple` and `iap-google` adapter (`## DEV`) and its controller (`testing.fake`). It takes receipts
 * `fake:<SKU>:<transaction ID>:<account token>[:<original transaction ID>]` and signs store notifications with the
 * server instance's fake notification key.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';
import * as CoreContract from '../../../../generated/contract/core_contract.ts';
import { is_object, parse_json, type AckKind, type AdapterFailure, type StoreAdapter, type StoreNotification, type StoreTransaction, type SubscriptionSnapshot, type Verification, type VerifyStatus } from '../../adapter.ts';

/** One call the fake adapter received. */
export interface FakeCall {
  readonly operation: 'verify' | 'lookup_subscription' | 'acknowledge';
  readonly input: Readonly<Record<string, unknown>>;
}

/**
 * The fake adapter controller (`testing.fake` service `iap-apple` or `iap-google`). A result or failure condition holds
 * for every call of that operation until it is set again; a failure condition wins over the result.
 * - `verify`: result `VALID`, `INVALID`, `PENDING`, `FAILED` or `{result, test, purchased_at, app_id, device_receipt}`
 *   (all but `result` optional). A field left out, and an unset result, is a test transaction, the purchase time
 *   `server-time.clock_now` of the call, game settings `appId` and a device receipt; an unset result is `VALID`
 * - `lookup_subscription`: a subscription snapshot `{state, ends_at, auto_renew, latest_transaction_id, sku,
 *   purchased_at, test}` or a part of one, or null to unset. A field left out comes from the last store transaction
 *   verified for that original transaction ID: `ACTIVE`, purchase time + `iap.fakeSubscriptionPeriodMs`, `true`
 * - `acknowledge`: no result. Its calls carry `{transaction_id, kind}` (`consume`, `acknowledge`,
 *   `subscription_acknowledge`)
 * - `hold(on)`: with `true`, every later `verify` and `lookup_subscription` call waits until `release(n)` lets it go;
 *   `false` lets every waiting call go
 * - `release(n)`: lets the first n waiting calls go, in the order they came; a call that comes later while fewer than n
 *   were waiting goes at once
 */
export interface FakeIapController {
  set_result(operation: string, result: unknown): void;
  set_failure(operation: string, failure: Exclude<AdapterFailure, 'bad_response'> | null): void;
  calls(): readonly FakeCall[];
  hold(on: boolean): void;
  release(n: number): void;
}

/**
 * The fake adapter: the store adapter interface, and the snapshot `send_fake_subscription_notify` sets for the next
 * subscription status lookup of one original transaction ID (it wins over the controller's result once).
 */
export interface FakeStoreAdapter extends StoreAdapter {
  set_snapshot(original_transaction_id: string, snapshot: unknown): void;
}

const OPERATIONS: ReadonlySet<string> = new Set(['verify', 'lookup_subscription', 'acknowledge']);
const FAILURES: ReadonlySet<unknown> = new Set(['timeout', 'communication_failure', 'rejected', null]);
const STATUSES: ReadonlySet<unknown> = new Set(['VALID', 'INVALID', 'PENDING', 'FAILED']);

/** A `SubscriptionState` from its element name, its short name (`ACTIVE`) or its value; undefined otherwise. */
export function subscription_state(value: unknown): CoreContract.SubscriptionState | undefined {
  const states = CoreContract.SubscriptionState as Readonly<Record<string, CoreContract.SubscriptionState>>;
  if (typeof value === 'number') return Object.values(states).includes(value as CoreContract.SubscriptionState) && value !== 0 ? (value as CoreContract.SubscriptionState) : undefined;
  if (typeof value !== 'string') return undefined;
  return states[value] ?? states[`SUBSCRIPTION_STATE_${value}`];
}

function int64(value: unknown): bigint | undefined {
  if (typeof value === 'bigint') return value;
  if (typeof value === 'number' && Number.isSafeInteger(value)) return BigInt(value);
  if (typeof value === 'string' && /^-?\d+$/.test(value)) return BigInt(value);
  return undefined;
}

/** A part of a subscription snapshot from a controller value; throws for a value that is not one. */
export function snapshot_part(value: unknown): Partial<SubscriptionSnapshot> {
  if (!is_object(value)) throw new TypeError('fake iap: a subscription snapshot is an object');
  const out: { -readonly [K in keyof SubscriptionSnapshot]?: SubscriptionSnapshot[K] } = {};
  if (value.state !== undefined) {
    const state = subscription_state(value.state);
    if (state === undefined) throw new TypeError(`fake iap: ${JSON.stringify(value.state)} is not a SubscriptionState`);
    out.state = state;
  }
  for (const key of ['ends_at', 'purchased_at'] as const) {
    if (value[key] === undefined) continue;
    const time = int64(value[key]);
    if (time === undefined) throw new TypeError(`fake iap: snapshot ${key} is not an integer`);
    out[key] = time;
  }
  for (const key of ['auto_renew', 'test'] as const) {
    if (value[key] === undefined) continue;
    if (typeof value[key] !== 'boolean') throw new TypeError(`fake iap: snapshot ${key} is not a bool`);
    out[key] = value[key];
  }
  for (const key of ['latest_transaction_id', 'sku'] as const) {
    if (value[key] === undefined) continue;
    if (typeof value[key] !== 'string') throw new TypeError(`fake iap: snapshot ${key} is not a string`);
    out[key] = value[key];
  }
  return out;
}

/** A fake receipt's parts, or null when it is not one. */
function parse_receipt(receipt: string): { sku: string; transaction_id: string; account_token: string; original_transaction_id: string } | null {
  const parts = receipt.split(':');
  if (parts[0] !== 'fake' || (parts.length !== 4 && parts.length !== 5)) return null;
  const [, sku = '', transaction_id = '', account_token = '', original = ''] = parts;
  return { sku, transaction_id, account_token, original_transaction_id: parts.length === 5 && original !== '' ? original : transaction_id };
}

/** A verify result the controller sets. */
interface VerifySetting {
  readonly status: VerifyStatus;
  readonly test: boolean | undefined;
  readonly purchased_at: bigint | null;
  readonly app_id: string | null;
  readonly device_receipt: boolean;
}

/** A verify result from a controller value; throws for a value that is not one. */
function verify_setting(result: unknown): VerifySetting {
  if (STATUSES.has(result)) return { status: result as VerifyStatus, test: undefined, purchased_at: null, app_id: null, device_receipt: true };
  const wrong = new TypeError('fake iap: the verify result is VALID, INVALID, PENDING, FAILED or {result, test, purchased_at, app_id, device_receipt}');
  if (!is_object(result) || !STATUSES.has(result.result)) throw wrong;
  const purchased_at = result.purchased_at === undefined ? null : int64(result.purchased_at);
  const test_ok = result.test === undefined || typeof result.test === 'boolean';
  const app_ok = result.app_id === undefined || typeof result.app_id === 'string';
  const device_ok = result.device_receipt === undefined || typeof result.device_receipt === 'boolean';
  if (purchased_at === undefined || !test_ok || !app_ok || !device_ok) throw wrong;
  return {
    status: result.result as VerifyStatus,
    test: typeof result.test === 'boolean' ? result.test : undefined,
    purchased_at,
    app_id: typeof result.app_id === 'string' ? result.app_id : null,
    device_receipt: typeof result.device_receipt === 'boolean' ? result.device_receipt : true,
  };
}

/** A whole snapshot from a part over the base store transaction; `rejected` without a SKU, transaction ID or purchase time. */
function snapshot_from(part: Partial<SubscriptionSnapshot>, base: StoreTransaction | null | undefined, period_ms: number): SubscriptionSnapshot | AdapterFailure {
  const purchased_at = part.purchased_at ?? base?.purchased_at;
  const latest_transaction_id = part.latest_transaction_id ?? base?.transaction_id;
  const sku = part.sku ?? base?.sku;
  if (purchased_at === undefined || purchased_at === null || latest_transaction_id === undefined || sku === undefined) return 'rejected';
  const defaults: SubscriptionSnapshot = {
    state: CoreContract.SubscriptionState.SUBSCRIPTION_STATE_ACTIVE,
    ends_at: purchased_at + BigInt(period_ms),
    auto_renew: true,
    latest_transaction_id,
    sku,
    purchased_at,
    test: base?.test ?? true,
  };
  return { ...defaults, ...part };
}

/** The fake adapter of an adapter key and its controller. Throws for an adapter key other than `iap-apple` and `iap-google`. */
export function create_fake_adapter(adapter_key: string): { adapter: FakeStoreAdapter; controller: FakeIapController } {
  if (adapter_key !== 'iap-apple' && adapter_key !== 'iap-google') throw new TypeError(`iap: no fake adapter for adapter key ${adapter_key}`);
  const calls: FakeCall[] = [];
  const failures = new Map<string, AdapterFailure>();
  let verify: VerifySetting = { status: 'VALID', test: true, purchased_at: null, app_id: null, device_receipt: true };
  let lookup: Partial<SubscriptionSnapshot> | null = null;
  const snapshots = new Map<string, Partial<SubscriptionSnapshot>>();
  const verified = new Map<string, StoreTransaction>();
  let holding = false;
  let credit = 0;
  const waiting: (() => void)[] = [];
  const wait = (): Promise<void> => {
    if (!holding) return Promise.resolve();
    if (credit > 0) {
      credit -= 1;
      return Promise.resolve();
    }
    return new Promise((resolve) => waiting.push(resolve));
  };

  const adapter: FakeStoreAdapter = {
    async verify(receipt, call) {
      calls.push({ operation: 'verify', input: { receipt } });
      await wait();
      const failure = failures.get('verify');
      if (failure !== undefined) return failure;
      const parts = parse_receipt(receipt);
      if (parts === null) return { status: 'INVALID', transaction: null } satisfies Verification;
      const transaction: StoreTransaction = { ...parts, app_id: verify.app_id ?? call.app_id, purchased_at: verify.purchased_at ?? call.now, test: verify.test ?? true, device_receipt: verify.device_receipt, ack: null };
      if (verify.status === 'VALID') verified.set(parts.original_transaction_id, transaction);
      return { status: verify.status, transaction } satisfies Verification;
    },
    async lookup_subscription(original_transaction_id, latest, call) {
      calls.push({ operation: 'lookup_subscription', input: { original_transaction_id } });
      await wait();
      const failure = failures.get('lookup_subscription');
      if (failure !== undefined) return failure;
      const once = snapshots.get(original_transaction_id);
      snapshots.delete(original_transaction_id);
      return snapshot_from({ ...(lookup ?? {}), ...(once ?? {}) }, verified.get(original_transaction_id) ?? latest, call.fake_subscription_period_ms);
    },
    acknowledge(transaction: StoreTransaction, kind: AckKind) {
      calls.push({ operation: 'acknowledge', input: { transaction_id: transaction.transaction_id, kind } });
      return Promise.resolve(failures.get('acknowledge') ?? null);
    },
    set_snapshot(original_transaction_id, snapshot) {
      if (snapshot === null || snapshot === undefined) snapshots.delete(original_transaction_id);
      else snapshots.set(original_transaction_id, snapshot_part(snapshot));
    },
  };

  const hold = (on: boolean): void => {
    if (typeof on !== 'boolean') throw new TypeError('fake iap: hold takes a bool');
    holding = on;
    credit = 0;
    if (!on) for (const go of waiting.splice(0)) go();
  };

  const release = (n: number): void => {
    if (!Number.isSafeInteger(n) || n < 0) throw new TypeError('fake iap: release takes a count of 0 or more');
    const now = waiting.splice(0, n);
    credit += n - now.length;
    for (const go of now) go();
  };

  const controller: FakeIapController = {
    set_result(operation, result) {
      if (operation === 'verify') {
        verify = verify_setting(result);
      } else if (operation === 'lookup_subscription') {
        lookup = result === null ? null : snapshot_part(result);
      } else {
        throw new TypeError(`fake iap: operation ${operation} has no result to set`);
      }
    },
    set_failure(operation, failure) {
      if (!OPERATIONS.has(operation)) throw new TypeError(`fake iap: unknown operation ${operation}`);
      if (!FAILURES.has(failure)) throw new TypeError(`fake iap: unknown failure condition ${String(failure)}`);
      if (failure === null) failures.delete(operation);
      else failures.set(operation, failure);
    },
    calls: () => [...calls],
    hold,
    release,
  };
  return { adapter, controller };
}

/** The `X-Ogw-Fake-Signature` of a body: HMAC-SHA256 with the fake notification key, lowercase hex. */
export function sign_fake_notification(key: Uint8Array, body: Uint8Array): string {
  return createHmac('sha256', key).update(body).digest('hex');
}

const KINDS: ReadonlySet<unknown> = new Set(['REFUND', 'SUBSCRIPTION', 'OTHER']);

/** Reads a fake adapter store notification body (format first, then the signature). */
export function parse_fake_notification(key: Uint8Array, headers: Readonly<Record<string, string>>, body: Uint8Array): StoreNotification | 'bad_signature' | 'bad_format' {
  const json = parse_json(body);
  if (!is_object(json) || typeof json.notification_id !== 'string' || !KINDS.has(json.kind) || typeof json.transaction_id !== 'string') return 'bad_format';
  const signature = headers['x-ogw-fake-signature'];
  if (typeof signature !== 'string') return 'bad_signature';
  const expected = Buffer.from(sign_fake_notification(key, body), 'utf8');
  const given = Buffer.from(signature, 'utf8');
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return 'bad_signature';
  return { notification_id: json.notification_id, kind: json.kind as StoreNotification['kind'], value: json.transaction_id };
}
