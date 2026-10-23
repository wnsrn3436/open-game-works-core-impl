import * as CoreContract from '../../../generated/contract/core_contract.ts';
import * as testing from '../../testing/dev/index.ts';
import {
  account_token,
  APPLE,
  balance,
  claim_daily,
  code_of,
  CoreError,
  DAY,
  GOOGLE,
  has_pending,
  receipt,
  recover,
  set_time_offset,
  start,
  START,
  State,
  Status,
  status_of,
  stored_purchased_at,
  subscription_row,
  sync_subscriptions,
  verify,
  without_purchase_time,
  type TestServer,
  fake_store,
} from './helpers.ts';
import { storage_module } from '../../storage/tests/helpers.ts';

/** `iap.fakeSubscriptionPeriodMs`. */
const PERIOD = 300_000n;

function notify(server: TestServer, store: CoreContract.IapStore, original: string, snapshot: Record<string, unknown> | null, notification_id?: string): Promise<unknown> {
  return testing.call_dev(server, 'iap', 'send_fake_subscription_notify', notification_id === undefined ? [store, original, snapshot] : [store, original, snapshot, notification_id]);
}

function lookups(server: TestServer, store: CoreContract.IapStore): string[] {
  return fake_store(server, store)
    .calls()
    .filter((c) => c.operation === 'lookup_subscription')
    .map((c) => String(c.input.original_transaction_id));
}

describe('subscription', () => {
  it('a Subscription purchase makes SubscriptionUserState ACTIVE with the snapshot ends_at and entitlement; from ends_at there is none', async () => {
    const server = await start();
    const a = await testing.login(server, 'a');
    const token = await account_token(a);
    expect(status_of(await verify(a, APPLE, receipt('vip_apple', 'sub-1', token)))).toBe(Status.PURCHASE_STATUS_GRANTED);
    const row = await subscription_row(server, a.user_id, '[iap_vip]');
    expect(row?.state).toBe(State.SUBSCRIPTION_STATE_ACTIVE);
    expect(row?.ends_at).toBe(START + PERIOD);
    expect(row?.auto_renew).toBe(true);
    expect(code_of(await claim_daily(a, '[iap_vip]'))).toBeNull();
    testing.set_time(server, START + PERIOD - 1n);
    expect(code_of(await claim_daily(a, '[iap_vip]'))).toBe(CoreError.CORE_ERROR_IAP_ALREADY_CLAIMED);
    testing.set_time(server, START + PERIOD);
    expect(code_of(await claim_daily(a, '[iap_vip]'))).toBe(CoreError.CORE_ERROR_IAP_DAILY_INACTIVE);
  });

  it('a renewal notification grants the new transaction reward once and changes ends_at; the next notification and RecoverPurchase of that transaction do not grant again', async () => {
    const server = await start();
    const a = await testing.login(server, 'a');
    const token = await account_token(a);
    await verify(a, APPLE, receipt('vip_apple', 'rn-1', token));
    expect(await balance(server, a.user_id)).toBe(30n);
    const renewed = { latest_transaction_id: 'rn-2', ends_at: (START + 2n * PERIOD).toString(), purchased_at: (START + PERIOD).toString() };
    expect(await notify(server, APPLE, 'rn-1', renewed)).toBe(200);
    expect(await balance(server, a.user_id)).toBe(60n);
    expect((await subscription_row(server, a.user_id, '[iap_vip]'))?.ends_at).toBe(START + 2n * PERIOD);
    expect(await notify(server, APPLE, 'rn-1', renewed)).toBe(200);
    expect(status_of(await recover(a, APPLE, receipt('vip_apple', 'rn-2', token, 'rn-1')))).toBe(Status.PURCHASE_STATUS_ALREADY_GRANTED);
    expect(await balance(server, a.user_id)).toBe(60n);
  });

  it('GRACE_PERIOD has entitlement; BILLING_RETRY, EXPIRED and REVOKED do not', async () => {
    const server = await start();
    const a = await testing.login(server, 'a');
    const token = await account_token(a);
    await verify(a, APPLE, receipt('vip_apple', 'st-1', token));
    const ends = (START + 10n * DAY).toString();
    const cases: [string, number | null][] = [
      ['GRACE_PERIOD', null],
      ['BILLING_RETRY', CoreError.CORE_ERROR_IAP_DAILY_INACTIVE],
      ['EXPIRED', CoreError.CORE_ERROR_IAP_DAILY_INACTIVE],
      ['REVOKED', CoreError.CORE_ERROR_IAP_DAILY_INACTIVE],
    ];
    let day = 0n;
    for (const [state, expected] of cases) {
      day += 1n;
      testing.set_time(server, START + day * DAY);
      expect(await notify(server, APPLE, 'st-1', { state, ends_at: ends })).toBe(200);
      expect(code_of(await claim_daily(a, '[iap_vip]'))).toBe(expected);
    }
  });

  it('a notification whose subscription status lookup fails is HTTP 500 and the state stays', async () => {
    const server = await start();
    const a = await testing.login(server, 'a');
    const token = await account_token(a);
    await verify(a, APPLE, receipt('vip_apple', 'lf-1', token));
    const before = await subscription_row(server, a.user_id, '[iap_vip]');
    fake_store(server).set_failure('lookup_subscription', 'communication_failure');
    expect(await notify(server, APPLE, 'lf-1', null)).toBe(500);
    expect(await subscription_row(server, a.user_id, '[iap_vip]')).toEqual(before);
  });

  it('cancelling Apple, subscribing to the same product on Google and an Apple EXPIRED notification leave the Google state; a plan change recomputes both product rows', async () => {
    const server = await start();
    const a = await testing.login(server, 'a');
    const token = await account_token(a);
    await verify(a, APPLE, receipt('vip_apple', 'x-apple', token));
    expect(await notify(server, APPLE, 'x-apple', { auto_renew: false, ends_at: (START + DAY).toString() })).toBe(200);
    fake_store(server, GOOGLE).set_result('lookup_subscription', { ends_at: (START + 30n * DAY).toString() });
    expect(status_of(await verify(a, GOOGLE, receipt('vip_google', 'x-google', token)))).toBe(Status.PURCHASE_STATUS_GRANTED);
    fake_store(server, GOOGLE).set_result('lookup_subscription', null);
    expect(await notify(server, APPLE, 'x-apple', { state: 'EXPIRED', ends_at: (START + DAY).toString(), auto_renew: false })).toBe(200);
    const row = await subscription_row(server, a.user_id, '[iap_vip]');
    expect(row?.state).toBe(State.SUBSCRIPTION_STATE_ACTIVE);
    expect(row?.ends_at).toBe(START + 30n * DAY);
    expect(code_of(await claim_daily(a, '[iap_vip]'))).toBeNull();

    expect(await notify(server, GOOGLE, 'x-google', { sku: 'vip_plus_google', latest_transaction_id: 'x-google-2', ends_at: (START + 60n * DAY).toString() })).toBe(200);
    const vip = await subscription_row(server, a.user_id, '[iap_vip]');
    const plus = await subscription_row(server, a.user_id, '[iap_vip_plus]');
    expect(vip?.state).toBe(State.SUBSCRIPTION_STATE_EXPIRED);
    expect(plus?.state).toBe(State.SUBSCRIPTION_STATE_ACTIVE);
    expect(plus?.ends_at).toBe(START + 60n * DAY);
  });

  it('SyncSubscriptions looks up ACTIVE, GRACE_PERIOD and BILLING_RETRY records whose ends_at or sync interval passed, not the others nor EXPIRED and REVOKED, and grants the renewal it finds', async () => {
    const server = await start();
    const a = await testing.login(server, 'a');
    const token = await account_token(a);
    const far = (START + 100n * DAY).toString();
    await verify(a, APPLE, receipt('vip_apple', 'due-ends', token));
    await verify(a, GOOGLE, receipt('vip_google', 'not-due', token));
    expect(await notify(server, GOOGLE, 'not-due', { ends_at: far })).toBe(200);
    await verify(a, APPLE, receipt('vip_plus_apple', 'expired', token));
    expect(await notify(server, APPLE, 'expired', { state: 'EXPIRED', ends_at: (START + 1n).toString() })).toBe(200);
    await verify(a, GOOGLE, receipt('vip_plus_google', 'revoked', token));
    expect(await notify(server, GOOGLE, 'revoked', { state: 'REVOKED', ends_at: (START + 1n).toString() })).toBe(200);
    testing.set_time(server, START + PERIOD);
    const before_apple = lookups(server, APPLE).length;
    const before_google = lookups(server, GOOGLE).length;
    fake_store(server).set_result('lookup_subscription', { latest_transaction_id: 'due-ends-2', ends_at: far, purchased_at: (START + PERIOD).toString() });
    expect(code_of(await sync_subscriptions(a))).toBeNull();
    expect(lookups(server, APPLE).slice(before_apple)).toEqual(['due-ends']);
    expect(lookups(server, GOOGLE).slice(before_google)).toEqual([]);
    expect(await balance(server, a.user_id)).toBe(30n + 30n + 60n + 60n + 30n);
    testing.set_time(server, START + PERIOD + 86_400_000n);
    fake_store(server, GOOGLE).set_result('lookup_subscription', { ends_at: far });
    expect(code_of(await sync_subscriptions(a))).toBeNull();
    expect(lookups(server, GOOGLE).slice(before_google)).toEqual(['not-due']);
  });

  it('a renewal whose snapshot has no store purchase time gets the request time of the transaction that applies it as its purchase time, through SyncSubscriptions and a SUBSCRIPTION notification, with the cheat time offset', async () => {
    const server = await start();
    const a = await testing.login(server, 'a');
    await verify(a, APPLE, receipt('vip_apple', 'np-1', await account_token(a)));
    testing.set_time(server, START + PERIOD);
    await set_time_offset(a, DAY);
    without_purchase_time(server, APPLE, 'lookup_subscription');
    fake_store(server).set_result('lookup_subscription', { latest_transaction_id: 'np-2', ends_at: (START + 60n * DAY).toString() });
    expect(code_of(await sync_subscriptions(a))).toBeNull();
    expect(await stored_purchased_at(server, a.user_id, 'np-2')).toEqual({ result: 'GRANTED', purchased_at: (START + PERIOD + DAY).toString() });
    testing.set_time(server, START + 2n * PERIOD);
    expect(await notify(server, APPLE, 'np-1', { latest_transaction_id: 'np-3' })).toBe(200);
    expect(await stored_purchased_at(server, a.user_id, 'np-3')).toEqual({ result: 'GRANTED', purchased_at: (START + 2n * PERIOD + DAY).toString() });
  });

  it('the subscription apply of SyncSubscriptions locks the snapshot latest transaction row and then the binding row, the order of grant order 4', async () => {
    const locks: string[] = [];
    let recording = false;
    const server = await start();
    const storage = storage_module(server);
    const original = storage.lock_game_row.bind(storage);
    storage.lock_game_row = (ctx_or_tx, table, key) => {
      if (recording && (table === 'iap_payment' || table === 'iap_binding')) locks.push(`${table}:${key.join(':')}`);
      return original(ctx_or_tx, table, key);
    };
    const a = await testing.login(server, 'a');
    await verify(a, APPLE, receipt('vip_apple', 'sl-1', await account_token(a)));
    testing.set_time(server, START + PERIOD);
    fake_store(server).set_result('lookup_subscription', { latest_transaction_id: 'sl-2', ends_at: (START + 60n * DAY).toString(), purchased_at: (START + PERIOD).toString() });
    recording = true;
    expect(code_of(await sync_subscriptions(a))).toBeNull();
    recording = false;
    expect(locks.slice(0, 2)).toEqual(['iap_payment:IAP_STORE_APPLE:sl-2', 'iap_binding:IAP_STORE_APPLE:sl-1']);
    expect((await subscription_row(server, a.user_id, '[iap_vip]'))?.ends_at).toBe(START + 60n * DAY);
  });

  it('a failed lookup of SyncSubscriptions is IAP_VERIFY_UNAVAILABLE; the successful lookup stays applied and reaches the next success response as pending_user_state', async () => {
    const server = await start();
    const a = await testing.login(server, 'a');
    const token = await account_token(a);
    await verify(a, APPLE, receipt('vip_apple', 'pa-1', token));
    await verify(a, GOOGLE, receipt('vip_plus_google', 'pg-1', token));
    testing.set_time(server, START + PERIOD);
    fake_store(server).set_failure('lookup_subscription', 'timeout');
    fake_store(server, GOOGLE).set_result('lookup_subscription', { ends_at: (START + 50n * DAY).toString() });
    expect(code_of(await sync_subscriptions(a))).toBe(CoreError.CORE_ERROR_IAP_VERIFY_UNAVAILABLE);
    const next = await claim_daily(a, '[iap_vip_plus]');
    expect(code_of(next)).toBeNull();
    expect(has_pending(next, 'SubscriptionUserState')).toBe(true);
  });

  it('other requests of the same user go on while VerifyPurchase waits for the adapter and SyncSubscriptions waits for the lookup', async () => {
    const server = await start();
    const a = await testing.login(server, 'a');
    const token = await account_token(a);
    await verify(a, APPLE, receipt('vip_apple', 'w-1', token));
    testing.set_time(server, START + PERIOD);
    const fake = fake_store(server);
    fake.hold(true);
    const waiting_verify = verify(a, APPLE, receipt('gems_apple', 'w-2', token));
    const waiting_sync = sync_subscriptions(a);
    expect(code_of(await claim_daily(a, '[iap_pass]'))).toBe(CoreError.CORE_ERROR_IAP_DAILY_INACTIVE);
    expect((await account_token(a)).length).toBeGreaterThan(0);
    fake.hold(false);
    expect(status_of(await waiting_verify)).toBe(Status.PURCHASE_STATUS_GRANTED);
    expect(code_of(await waiting_sync)).toBeNull();
  });
});
