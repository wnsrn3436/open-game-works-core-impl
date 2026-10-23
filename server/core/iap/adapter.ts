/**
 * The store adapter interface of `iap` (adapter keys `iap-apple`, `iap-google`): receipt verification, subscription
 * status lookup, purchase acknowledgement and store notification parsing. The fake adapter (`dev/adapters/fake.ts`),
 * `iap-apple`, `iap-apple-sandbox` and `iap-google` (`adapters/`) implement it.
 */
import type * as CoreContract from '../../generated/contract/core_contract.ts';
import type { ServerTimeApi } from '../server-time/index.ts';

/**
 * A failed adapter call: time limit, network or HTTP failure, a refusal the adapter got, or a store response without a
 * value the adapter needs (`bad_response`; only a real adapter gives it).
 */
export type AdapterFailure = 'timeout' | 'communication_failure' | 'rejected' | 'bad_response';

/** Receipt verification result (`### grant order` 2). */
export type VerifyStatus = 'VALID' | 'INVALID' | 'PENDING' | 'FAILED';

/** Store transaction information the adapter took from the store. `account_token` is empty when there is none. */
export interface StoreTransaction {
  readonly transaction_id: string;
  readonly original_transaction_id: string;
  readonly sku: string;
  readonly app_id: string;
  readonly account_token: string;
  /** Unix ms. null: the store gives none (a pending `iap-google` subscription), and the purchase time is the request time. */
  readonly purchased_at: bigint | null;
  readonly test: boolean;
  /** True when the adapter confirmed the receipt is one the buying device got from the store (`## API` device receipt). */
  readonly device_receipt: boolean;
  /** What only this adapter reads for the purchase acknowledgement (for example a purchase token). Never stored. */
  readonly ack: unknown;
}

export interface Verification {
  readonly status: VerifyStatus;
  /** null when the receipt names no store transaction. */
  readonly transaction: StoreTransaction | null;
}

/** The current state of one subscription at the store (`### subscription`). */
export interface SubscriptionSnapshot {
  readonly state: CoreContract.SubscriptionState;
  readonly ends_at: bigint;
  readonly auto_renew: boolean;
  readonly latest_transaction_id: string;
  /** SKU of the latest store transaction. */
  readonly sku: string;
  /** Purchase time of the latest store transaction. Unix ms. null: the store gives none, and it is the request time. */
  readonly purchased_at: bigint | null;
  readonly test: boolean;
}

export type AckKind = 'consume' | 'acknowledge' | 'subscription_acknowledge';

export type NotificationKind = 'REFUND' | 'SUBSCRIPTION' | 'OTHER';

/** A verified store notification. `value` is the transaction ID (`REFUND`), the original transaction ID (`SUBSCRIPTION`) or empty. */
export interface StoreNotification {
  readonly notification_id: string;
  readonly kind: NotificationKind;
  readonly value: string;
}

/**
 * What every adapter call gets: the abort signal of its time limit, `server-time.clock_now`, game settings `appId`
 * and core settings `iap.fakeSubscriptionPeriodMs` (the fake adapter reads the last two; it is made without settings).
 */
export interface AdapterCall {
  readonly signal: AbortSignal;
  readonly now: bigint;
  readonly app_id: string;
  readonly fake_subscription_period_ms: number;
}

export interface StoreAdapter {
  verify(receipt: string, call: AdapterCall): Promise<Verification | AdapterFailure>;
  /** `latest` is the store transaction just verified, or null when the lookup comes from a notification or a sync. */
  lookup_subscription(original_transaction_id: string, latest: StoreTransaction | null, call: AdapterCall): Promise<SubscriptionSnapshot | AdapterFailure>;
  acknowledge(transaction: StoreTransaction, kind: AckKind, call: AdapterCall): Promise<null | AdapterFailure>;
  /**
   * Checks the signature and reads a store notification. The fake adapter has none: its signature uses the server
   * instance's fake notification key, which the DEV code holds.
   */
  parse_notification?(headers: Readonly<Record<string, string>>, body: Uint8Array, call: AdapterCall): Promise<StoreNotification | 'bad_signature' | 'bad_format' | AdapterFailure>;
}

/** Key source (`server-core` `## adapter`): the root certificates or public keys an adapter checks signatures with. */
export type KeySource = () => Promise<unknown>;

/** The outgoing HTTP adapter: the global `fetch` signature. */
export type HttpFetch = (url: string, init: RequestInit) => Promise<Response>;

const FAILURES: ReadonlySet<unknown> = new Set(['timeout', 'communication_failure', 'rejected', 'bad_response']);

export function is_failure(value: unknown): value is AdapterFailure {
  return FAILURES.has(value);
}

/**
 * Runs `run` under a time limit of `ms` of real elapsed time (`server-time.network_time_limit`). The limit wins even
 * when `run` does not watch the signal; a throw is `communication_failure`.
 */
export function within_limit<T>(time: Pick<ServerTimeApi, 'network_time_limit'>, ms: number, run: (signal: AbortSignal) => Promise<T>): Promise<T | 'timeout' | 'communication_failure'> {
  const signal = time.network_time_limit(BigInt(ms));
  return new Promise((resolve) => {
    if (signal.aborted) {
      resolve('timeout');
      return;
    }
    const on_abort = (): void => {
      resolve('timeout');
    };
    signal.addEventListener('abort', on_abort, { once: true });
    run(signal).then(
      (value) => {
        signal.removeEventListener('abort', on_abort);
        resolve(signal.aborted ? 'timeout' : value);
      },
      () => {
        signal.removeEventListener('abort', on_abort);
        resolve(signal.aborted ? 'timeout' : 'communication_failure');
      },
    );
  });
}

/** Reads a response body up to `max` bytes; null when it is longer or the read fails. */
export async function read_limited(response: Response, max: number): Promise<Uint8Array | null> {
  if (response.body === null) return new Uint8Array(0);
  const reader = (response.body as ReadableStream<Uint8Array>).getReader();
  const parts: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const chunk = (await reader.read()) as { done: boolean; value: Uint8Array | undefined };
      if (chunk.done || chunk.value === undefined) break;
      total += chunk.value.byteLength;
      if (total > max) {
        await reader.cancel().catch(() => undefined);
        return null;
      }
      parts.push(chunk.value);
    }
  } catch {
    return null;
  }
  const out = new Uint8Array(total);
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.byteLength;
  }
  return out;
}

/** JSON of a UTF-8 body; undefined when it is not JSON. */
export function parse_json(bytes: Uint8Array): unknown {
  try {
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as unknown;
  } catch {
    return undefined;
  }
}

export function is_object(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
