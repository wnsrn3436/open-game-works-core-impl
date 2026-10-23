/** Adapter calls under the `iap.verifyTimeoutMs` time limit, with the `error` log of a failure. */
import { is_failure, within_limit, type AckKind, type AdapterCall, type StoreTransaction, type SubscriptionSnapshot, type Verification } from './adapter.ts';
import { log_user, store_name, type IapContext, type Store, type StoreBinding } from './context.ts';

/** Runs one adapter call under `iap.verifyTimeoutMs`. */
export function call_adapter<T>(c: IapContext, run: (call: AdapterCall) => Promise<T>): Promise<T | 'timeout' | 'communication_failure'> {
  return within_limit(c.m.time, c.settings.verify_timeout_ms, (signal) =>
    run({ signal, now: c.m.time.clock_now(), app_id: c.settings.app_id, fake_subscription_period_ms: c.settings.fake_subscription_period_ms }),
  );
}

/** Receipt verification; a failure, time limit or `FAILED` is null after an `error` log. */
export async function verify_receipt(c: IapContext, binding: StoreBinding, store: Store, receipt: string, user_id: bigint): Promise<Verification | null> {
  const result = await call_adapter(c, (call) => binding.adapter.verify(receipt, call));
  if (is_failure(result) || result.status === 'FAILED') {
    log_user(c, user_id, 'error', 'error', 'iap receipt verification failed', { store: store_name(store), adapter: binding.name, failure: is_failure(result) ? result : 'FAILED' });
    return null;
  }
  return result;
}

/** Subscription status lookup; a failure or time limit is null after an `error` log. */
export async function lookup_subscription(
  c: IapContext,
  binding: StoreBinding,
  store: Store,
  original_transaction_id: string,
  latest: StoreTransaction | null,
  user_id: bigint | null,
): Promise<SubscriptionSnapshot | null> {
  const result = await call_adapter(c, (call) => binding.adapter.lookup_subscription(original_transaction_id, latest, call));
  if (is_failure(result)) {
    log_user(c, user_id, 'error', 'error', 'iap subscription status lookup failed', { store: store_name(store), adapter: binding.name, failure: result });
    return null;
  }
  return result;
}

/** Purchase acknowledgement (`### store acknowledgement`); a failure is an `error` log only. */
export async function acknowledge(c: IapContext, binding: StoreBinding, store: Store, transaction: StoreTransaction, kind: AckKind, user_id: bigint): Promise<void> {
  const result = await call_adapter(c, (call) => binding.adapter.acknowledge(transaction, kind, call));
  if (result !== null) {
    log_user(c, user_id, 'error', 'error', 'iap purchase acknowledgement failed', { store: store_name(store), adapter: binding.name, transaction_id: transaction.transaction_id, kind, failure: result });
  }
}
