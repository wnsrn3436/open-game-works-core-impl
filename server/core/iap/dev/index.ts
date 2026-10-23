import { randomBytes, randomUUID } from 'node:crypto';
import * as CoreContract from '../../../generated/contract/core_contract.ts';
import type { Iap, RouteRequest } from '../index.ts';
import { create_fake_adapter, parse_fake_notification, sign_fake_notification, type FakeStoreAdapter } from './adapters/fake.ts';

export { create_fake_adapter, parse_fake_notification, sign_fake_notification, snapshot_part, subscription_state } from './adapters/fake.ts';
export type { FakeCall, FakeIapController, FakeStoreAdapter } from './adapters/fake.ts';

/** The `## DEV` operations of iap. */
export interface IapDev {
  send_fake_refund(store: unknown, transaction_id: string, notification_id?: string): Promise<number>;
  send_fake_subscription_notify(store: unknown, original_transaction_id: string, snapshot: unknown, notification_id?: string): Promise<number>;
}

type Store = typeof CoreContract.IapStore.IAP_STORE_APPLE | typeof CoreContract.IapStore.IAP_STORE_GOOGLE;

/** A store from an `IapStore` value, its element name, `APPLE`, `GOOGLE`, `apple` or `google`. */
function store_input(value: unknown): Store {
  const apple = CoreContract.IapStore.IAP_STORE_APPLE;
  const google = CoreContract.IapStore.IAP_STORE_GOOGLE;
  if (value === apple || value === 'IAP_STORE_APPLE' || value === 'APPLE' || value === 'apple') return apple;
  if (value === google || value === 'IAP_STORE_GOOGLE' || value === 'GOOGLE' || value === 'google') return google;
  throw new TypeError(`iap: ${String(value)} is not a store`);
}

/**
 * The DEV code of the server instance's `iap`: a 32 byte secure random fake notification key, fake adapters for
 * adapter name `fake` when the server instance gives none, and the fake store notifications. Called before `begin_start`.
 */
export function create_iap_dev(iap: Iap): IapDev {
  const key = randomBytes(32);
  const access = iap.include_dev_code({
    create_fake_adapter: (adapter_key) => create_fake_adapter(adapter_key).adapter,
    parse_fake_notification: (headers, body) => parse_fake_notification(key, headers, body),
  });

  /** Sends a signed fake notification body to this server instance's `POST /iap/notify/<store>` and gives the HTTP status. */
  const send = async (store: Store, json: Readonly<Record<string, string>>): Promise<number> => {
    const body = new TextEncoder().encode(JSON.stringify(json));
    const request: RouteRequest = {
      method: 'POST',
      path: `/iap/notify/${store === CoreContract.IapStore.IAP_STORE_APPLE ? 'apple' : 'google'}`,
      query: '',
      headers: { 'content-type': 'application/json', 'x-ogw-fake-signature': sign_fake_notification(key, body) },
      read_body: (max_bytes) => Promise.resolve(body.byteLength > max_bytes ? null : body),
      upgrade: null,
    };
    return (await access.notify(request)).status;
  };

  return {
    send_fake_refund: (store, transaction_id, notification_id) =>
      send(store_input(store), { notification_id: notification_id ?? randomUUID(), kind: 'REFUND', transaction_id }),
    send_fake_subscription_notify: (store, original_transaction_id, snapshot, notification_id) => {
      const target = store_input(store);
      const binding = access.binding(target);
      if (binding !== undefined && binding.name === 'fake') (binding.adapter as FakeStoreAdapter).set_snapshot(original_transaction_id, snapshot);
      return send(target, { notification_id: notification_id ?? randomUUID(), kind: 'SUBSCRIPTION', transaction_id: original_transaction_id });
    },
  };
}
