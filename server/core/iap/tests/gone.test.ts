/**
 * The subscription status lookup result `gone` (`### store notification`, `SyncSubscriptions`, grant order 3): the
 * `iap-google` HTTP 410 of `purchases.subscriptionsv2` and the fake adapter result `GONE`.
 */
import { generateKeyPairSync } from 'node:crypto';
import * as CoreContract from '../../../generated/contract/core_contract.ts';
import type { GameTx } from '../../storage/index.ts';
import { storage_module } from '../../storage/tests/helpers.ts';
import * as testing from '../../testing/dev/index.ts';
import type { StoreAdapter } from '../adapter.ts';
import { create_google_adapter } from '../adapters/google.ts';
import { BINDING } from '../tables.ts';
import {
  account_token,
  APPLE,
  balance,
  code_of,
  CoreError,
  DAY,
  exported_rows,
  fake_store,
  GOOGLE,
  GOOGLE_APP_ID,
  has_pending,
  item_changes,
  list_payments,
  receipt,
  recover,
  start,
  START,
  start_default_revoke,
  State,
  Status,
  status_of,
  subscription_row,
  sync_subscriptions,
  verify,
  withdraw,
  type Session,
  type TestServer,
} from './helpers.ts';

/** `iap.fakeSubscriptionPeriodMs`. */
const PERIOD = 300_000n;
const IAP_REFUND = CoreContract.ItemChangeSource.ITEM_CHANGE_SOURCE_IAP_REFUND;

function refund(server: TestServer, store: CoreContract.IapStore, transaction_id: string, notification_id?: string): Promise<unknown> {
  return testing.call_dev(server, 'iap', 'send_fake_refund', notification_id === undefined ? [store, transaction_id] : [store, transaction_id, notification_id]);
}

function notify(server: TestServer, store: CoreContract.IapStore, original: string, snapshot: Record<string, unknown> | null, notification_id?: string): Promise<unknown> {
  return testing.call_dev(server, 'iap', 'send_fake_subscription_notify', notification_id === undefined ? [store, original, snapshot] : [store, original, snapshot, notification_id]);
}

/** A success request of the session that carries its pending delta. */
function next_response(session: Session) {
  return testing.send(session, 'core/SyncSubscriptions', new CoreContract.SyncSubscriptionsRequest());
}

/** The stored `iap_subscription` row of the user and original transaction ID. */
async function subscription_record(server: TestServer, user_id: bigint, original: string): Promise<Record<string, unknown> | undefined> {
  return (await exported_rows(server, user_id, 'iap_subscription')).find((row) => row['original_transaction_id'] === original);
}

/**
 * Makes the fake `iap-google` adapter answer as the real `iap-google` does for `purchases.subscriptionsv2` HTTP 410: the
 * subscription status lookup always, and receipt verification too with `verify` true.
 */
function google_answers_410(server: TestServer, options: { verify: boolean }): string[] {
  const requests: string[] = [];
  const real = create_google_adapter({
    private_key_pem: generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({ type: 'pkcs8', format: 'pem' }),
    service_account_email: 'svc@example.iam.gserviceaccount.com',
    notification_service_account_email: 'push@example.iam.gserviceaccount.com',
    notification_audience: 'https://dev.example.com/iap/notify/google',
    package_name: GOOGLE_APP_ID,
    is_subscription_sku: (sku) => sku.startsWith('vip'),
    fetch: (url) => {
      requests.push(url);
      if (url.endsWith('/token')) return Promise.resolve(new Response(JSON.stringify({ access_token: 'at' }), { status: 200 }));
      return Promise.resolve(new Response('{}', { status: 410 }));
    },
    key_source: () => Promise.resolve({ keys: [] }),
    max_response_bytes: 1_048_576,
    clock_now: () => START,
  });
  const adapter = server.shared.fakes.get('iap-google')?.adapter as StoreAdapter;
  adapter.lookup_subscription = real.lookup_subscription.bind(real);
  if (options.verify) adapter.verify = real.verify.bind(real);
  return requests;
}

describe('the lookup result gone', () => {
  it('iap-google: a 410 of subscriptionsv2 in the lookup of a REFUND notification is gone, so the refund goes on without the subscription apply; in receipt verification and in the lookup of grant order 2 it is INVALID with no payment record', async () => {
    const server = await start_default_revoke();
    const a = await testing.login(server, 'a');
    const token = await account_token(a);
    expect(status_of(await verify(a, GOOGLE, receipt('vip_google', 'g410-1', token)))).toBe(Status.PURCHASE_STATUS_GRANTED);
    const record = await subscription_record(server, a.user_id, 'g410-1');
    const state = await subscription_row(server, a.user_id, '[iap_vip]');
    const requests = google_answers_410(server, { verify: false });
    expect(await refund(server, GOOGLE, 'g410-1')).toBe(200);
    expect(requests.some((url) => url.endsWith('/purchases/subscriptionsv2/tokens/g410-1'))).toBe(true);
    expect((await list_payments(server, a.user_id)).payments.find((p) => p.transaction_id === 'g410-1')?.result).toBe('REFUNDED');
    expect(await balance(server, a.user_id)).toBe(0n);
    expect(await subscription_record(server, a.user_id, 'g410-1')).toEqual(record);
    expect(await subscription_row(server, a.user_id, '[iap_vip]')).toEqual(state);

    // Grant order 2: the receipt verifies (fake), its lookup answers 410.
    const looked = await verify(a, GOOGLE, receipt('vip_google', 'g410-2', token));
    expect([looked.response?.status, looked.response?.product_id]).toEqual([Status.PURCHASE_STATUS_INVALID, 0]);
    // Receipt verification of a subscription receipt answered 410.
    google_answers_410(server, { verify: true });
    const verified = await verify(a, GOOGLE, JSON.stringify({ packageName: GOOGLE_APP_ID, productId: 'vip_google', purchaseToken: 'g410-3' }));
    expect([verified.response?.status, verified.response?.product_id]).toEqual([Status.PURCHASE_STATUS_INVALID, 0]);
    const ids = (await list_payments(server, a.user_id)).payments.map((p) => p.transaction_id);
    expect(ids).toEqual(['g410-1']);
  });

  it('fake iap-google GONE: a GOOGLE REFUND of a GRANTED Subscription revokes reward with source IapRefund, marks the payment record REFUNDED, is HTTP 200 and leaves the subscription record as it was', async () => {
    const server = await start_default_revoke();
    const a = await testing.login(server, 'a');
    expect(status_of(await verify(a, GOOGLE, receipt('vip_google', 'gf-1', await account_token(a))))).toBe(Status.PURCHASE_STATUS_GRANTED);
    expect(code_of(await next_response(a))).toBeNull();
    const record = await subscription_record(server, a.user_id, 'gf-1');
    const state = await subscription_row(server, a.user_id, '[iap_vip]');
    expect(state?.state).toBe(State.SUBSCRIPTION_STATE_ACTIVE);
    fake_store(server, GOOGLE).set_result('lookup_subscription', 'GONE');
    expect(await refund(server, GOOGLE, 'gf-1')).toBe(200);
    expect((await list_payments(server, a.user_id)).payments.find((p) => p.transaction_id === 'gf-1')?.result).toBe('REFUNDED');
    const next = await next_response(a);
    expect(item_changes(next).map((c) => [c.source, c.ref, c.delta])).toEqual([[IAP_REFUND, 'gf-1', -30n]]);
    expect(has_pending(next, 'SubscriptionUserState')).toBe(false);
    expect(await subscription_record(server, a.user_id, 'gf-1')).toEqual(record);
    expect(await subscription_row(server, a.user_id, '[iap_vip]')).toEqual(state);
  });

  it('GONE in grant order 2 is INVALID with product ID value 0, no payment record and no grant', async () => {
    const server = await start();
    const a = await testing.login(server, 'a');
    fake_store(server, GOOGLE).set_result('lookup_subscription', 'GONE');
    const sent = await verify(a, GOOGLE, receipt('vip_google', 'gg-1', await account_token(a)));
    expect([sent.response?.status, sent.response?.product_id]).toEqual([Status.PURCHASE_STATUS_INVALID, 0]);
    expect((await list_payments(server, a.user_id)).payments).toEqual([]);
    expect(await balance(server, a.user_id)).toBe(0n);
    expect(await subscription_row(server, a.user_id, '[iap_vip]')).toBeNull();
  });

  it('a SUBSCRIPTION notification whose lookup is GONE only claims the notification ID: HTTP 200, the records stay, and the same notification ID later is a duplicate', async () => {
    const server = await start();
    const a = await testing.login(server, 'a');
    expect(status_of(await verify(a, GOOGLE, receipt('vip_google', 'gs-1', await account_token(a))))).toBe(Status.PURCHASE_STATUS_GRANTED);
    const record = await subscription_record(server, a.user_id, 'gs-1');
    const state = await subscription_row(server, a.user_id, '[iap_vip]');
    const fake = fake_store(server, GOOGLE);
    fake.set_result('lookup_subscription', 'GONE');
    expect(await notify(server, GOOGLE, 'gs-1', null, 'gs-n1')).toBe(200);
    expect(await subscription_record(server, a.user_id, 'gs-1')).toEqual(record);
    expect(await subscription_row(server, a.user_id, '[iap_vip]')).toEqual(state);
    fake.set_result('lookup_subscription', null);
    expect(await notify(server, GOOGLE, 'gs-1', { state: 'REVOKED', ends_at: START.toString(), auto_renew: false }, 'gs-n1')).toBe(200);
    expect(await subscription_record(server, a.user_id, 'gs-1')).toEqual(record);
    expect(await notify(server, GOOGLE, 'gs-1', { state: 'REVOKED', ends_at: START.toString(), auto_renew: false }, 'gs-n2')).toBe(200);
    expect((await subscription_record(server, a.user_id, 'gs-1'))?.['state']).toBe('SUBSCRIPTION_STATE_REVOKED');
  });

  it('a SUBSCRIPTION notification whose lookup is GONE and whose claim transaction fails is HTTP 500 with one error log, and the same notification ID sent again is handled', async () => {
    const server = await start();
    const a = await testing.login(server, 'a');
    expect(status_of(await verify(a, GOOGLE, receipt('vip_google', 'gc-1', await account_token(a))))).toBe(Status.PURCHASE_STATUS_GRANTED);
    await testing.wait_background(server);
    const record = await subscription_record(server, a.user_id, 'gc-1');
    const fake = fake_store(server, GOOGLE);
    fake.set_result('lookup_subscription', 'GONE');
    // The next game transaction (the claim of the notification) fails.
    const storage = storage_module(server);
    const run = storage.run_game_transaction.bind(storage);
    const armed = { fail: true };
    storage.run_game_transaction = <T>(fn: (tx: GameTx) => T): Promise<T | 'FAILED'> => {
      if (!armed.fail) return run(fn);
      armed.fail = false;
      return Promise.resolve('FAILED');
    };
    const errors = testing.read_logs(server, 'error').length;
    const sent = await notify(server, GOOGLE, 'gc-1', null, 'gc-n1');
    storage.run_game_transaction = run;
    expect(armed.fail).toBe(false);
    expect(sent).toBe(500);
    const logged = testing.read_logs(server, 'error').slice(errors);
    expect(logged).toHaveLength(1);
    expect(logged[0]?.message).toBe('iap store notification processing failed');
    expect(await subscription_record(server, a.user_id, 'gc-1')).toEqual(record);
    // The store sends the same notification ID again: it was not claimed, so it is handled.
    fake.set_result('lookup_subscription', null);
    expect(await notify(server, GOOGLE, 'gc-1', { state: 'REVOKED', ends_at: START.toString(), auto_renew: false }, 'gc-n1')).toBe(200);
    expect((await subscription_record(server, a.user_id, 'gc-1'))?.['state']).toBe('SUBSCRIPTION_STATE_REVOKED');
  });

  it('for a withdrawn user, a SUBSCRIPTION notification whose lookup is GONE only claims, and a REFUND marks the payment record REFUNDED and leaves the subscription record as it was', async () => {
    const server = await start();
    const a = await testing.login(server, 'a');
    const token = await account_token(a);
    expect(status_of(await verify(a, GOOGLE, receipt('vip_google', 'gw-1', token)))).toBe(Status.PURCHASE_STATUS_GRANTED);
    await withdraw(a);
    const record = await subscription_record(server, a.user_id, 'gw-1');
    const fake = fake_store(server, GOOGLE);
    fake.set_result('lookup_subscription', 'GONE');
    expect(await notify(server, GOOGLE, 'gw-1', null, 'gw-n1')).toBe(200);
    expect(await subscription_record(server, a.user_id, 'gw-1')).toEqual(record);
    fake.set_result('lookup_subscription', null);
    expect(await notify(server, GOOGLE, 'gw-1', { state: 'ACTIVE', ends_at: (START + 40n * DAY).toString() }, 'gw-n1')).toBe(200);
    expect(await subscription_record(server, a.user_id, 'gw-1')).toEqual(record);
    fake.set_result('lookup_subscription', 'GONE');
    expect(await refund(server, GOOGLE, 'gw-1')).toBe(200);
    expect((await exported_rows(server, a.user_id, 'iap_payment')).find((row) => row['transaction_id'] === 'gw-1')?.['result']).toBe('REFUNDED');
    expect(await subscription_record(server, a.user_id, 'gw-1')).toEqual(record);
  });

  it('a SyncSubscriptions whose lookup is GONE changes that subscription record to EXPIRED with auto_renew false, the same ends_at and product, and recomputes SubscriptionUserState', async () => {
    const server = await start();
    const a = await testing.login(server, 'a');
    expect(status_of(await verify(a, GOOGLE, receipt('vip_google', 'gy-1', await account_token(a))))).toBe(Status.PURCHASE_STATUS_GRANTED);
    const before = await subscription_record(server, a.user_id, 'gy-1');
    expect([before?.['state'], before?.['auto_renew'], before?.['ends_at']]).toEqual(['SUBSCRIPTION_STATE_ACTIVE', true, (START + PERIOD).toString()]);
    testing.set_time(server, START + PERIOD);
    fake_store(server, GOOGLE).set_result('lookup_subscription', 'GONE');
    const sent = await sync_subscriptions(a);
    expect(code_of(sent)).toBeNull();
    expect(has_pending(sent, 'SubscriptionUserState')).toBe(true);
    const after = await subscription_record(server, a.user_id, 'gy-1');
    expect(after).toEqual({ ...before, state: 'SUBSCRIPTION_STATE_EXPIRED', auto_renew: false, updated_at: (START + PERIOD).toString() });
    expect(await subscription_row(server, a.user_id, '[iap_vip]')).toMatchObject({ state: State.SUBSCRIPTION_STATE_EXPIRED, ends_at: START + PERIOD, auto_renew: false });
    // EXPIRED is no longer looked up.
    const lookups = fake_store(server, GOOGLE).calls().filter((c) => c.operation === 'lookup_subscription').length;
    testing.set_time(server, START + 2n * DAY);
    expect(code_of(await sync_subscriptions(a))).toBeNull();
    expect(fake_store(server, GOOGLE).calls().filter((c) => c.operation === 'lookup_subscription').length).toBe(lookups);
  });

  it('a SyncSubscriptions GONE of a subscription that moved to A by ownership transfer while its lookup waited changes nothing for B and, after the commit, changes A\'s record to EXPIRED with A\'s SubscriptionUserState', async () => {
    const server = await start();
    const a = await testing.login(server, 'a');
    const b = await testing.login(server, 'b');
    const data = receipt('vip_apple', 'gt-1', await account_token(b));
    expect(status_of(await verify(b, APPLE, data))).toBe(Status.PURCHASE_STATUS_GRANTED);
    testing.set_time(server, START + PERIOD);
    // B's next lookup waits for the gate; the lookups after it go on.
    const adapter = server.shared.fakes.get('iap-apple')?.adapter as StoreAdapter;
    const lookup = adapter.lookup_subscription.bind(adapter);
    let open = (): void => undefined;
    const gate = new Promise<void>((resolve) => {
      open = resolve;
    });
    let armed = true;
    const held = { waiting: false };
    adapter.lookup_subscription = async (original, latest, call) => {
      if (armed) {
        armed = false;
        held.waiting = true;
        await gate;
      }
      return lookup(original, latest, call);
    };
    const synced = sync_subscriptions(b);
    for (let i = 0; i < 200 && !held.waiting; i += 1) await new Promise((resolve) => setTimeout(resolve, 10));
    expect(held.waiting).toBe(true);
    const ends_at = START + 10n * DAY;
    fake_store(server).set_result('lookup_subscription', { ends_at: ends_at.toString() });
    expect(status_of(await recover(a, APPLE, data))).toBe(Status.PURCHASE_STATUS_ALREADY_GRANTED);
    await testing.wait_background(server);
    const moved = await subscription_record(server, a.user_id, 'gt-1');
    expect([moved?.['state'], moved?.['ends_at']]).toEqual(['SUBSCRIPTION_STATE_ACTIVE', ends_at.toString()]);
    fake_store(server).set_result('lookup_subscription', 'GONE');
    open();
    expect(code_of(await synced)).toBeNull();
    await testing.wait_background(server);
    expect(await subscription_row(server, b.user_id, '[iap_vip]')).toBeNull();
    expect(await subscription_record(server, b.user_id, 'gt-1')).toBeUndefined();
    const record = await subscription_record(server, a.user_id, 'gt-1');
    expect([record?.['state'], record?.['auto_renew'], record?.['ends_at'], record?.['product_id']]).toEqual(['SUBSCRIPTION_STATE_EXPIRED', false, ends_at.toString(), moved?.['product_id']]);
    expect(await subscription_row(server, a.user_id, '[iap_vip]')).toMatchObject({ state: State.SUBSCRIPTION_STATE_EXPIRED, ends_at, auto_renew: false });
    expect(testing.read_logs(server, 'error').filter((l: Record<string, unknown>) => String(l.message).includes('of another user'))).toHaveLength(0);
  });

  it('a failed change of the lookup result GONE of SyncSubscriptions is IAP_VERIFY_UNAVAILABLE with one error log, and the record stays', async () => {
    const server = await start();
    const a = await testing.login(server, 'a');
    expect(status_of(await verify(a, GOOGLE, receipt('vip_google', 'gx-1', await account_token(a))))).toBe(Status.PURCHASE_STATUS_GRANTED);
    const before = await subscription_record(server, a.user_id, 'gx-1');
    testing.set_time(server, START + PERIOD);
    fake_store(server, GOOGLE).set_result('lookup_subscription', 'GONE');
    // The change cannot lock the binding row.
    const storage = storage_module(server);
    const lock = storage.lock_game_row.bind(storage);
    storage.lock_game_row = (ctx_or_tx, table, key) => (table === BINDING && key[1] === 'gx-1' ? 'FAILED' : lock(ctx_or_tx, table, key));
    const errors = testing.read_logs(server, 'error').length;
    const sent = await sync_subscriptions(a);
    storage.lock_game_row = lock;
    expect(code_of(sent)).toBe(CoreError.CORE_ERROR_IAP_VERIFY_UNAVAILABLE);
    const logged = testing.read_logs(server, 'error').slice(errors);
    expect(logged.filter((l: Record<string, unknown>) => l.message === 'iap change of a gone subscription of SyncSubscriptions failed')).toHaveLength(1);
    expect(await subscription_record(server, a.user_id, 'gx-1')).toEqual(before);
  });
});
