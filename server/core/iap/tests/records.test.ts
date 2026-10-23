import * as CoreContract from '../../../generated/contract/core_contract.ts';
import * as testing from '../../testing/dev/index.ts';
import {
  account_token,
  APPLE,
  balance,
  code_of,
  core_events,
  CoreError,
  DAY,
  data_folder_without_extra_grant,
  exported_rows,
  GOOGLE,
  id,
  link_social,
  list_payments,
  logs_with_reason,
  payment,
  purchase_count_of,
  receipt,
  recover,
  register_hooks,
  revoke_test_grant,
  set_time_offset,
  SOCIAL,
  start,
  START,
  Status,
  status_of,
  stored_purchased_at,
  subscription_row,
  verify,
  withdraw,
  without_purchase_time,
  type Session,
  type TestServer,
  fake_store,
} from './helpers.ts';

function refund(server: TestServer, store: CoreContract.IapStore, transaction_id: string): Promise<unknown> {
  return testing.call_dev(server, 'iap', 'send_fake_refund', [store, transaction_id]);
}

function acknowledgements(server: TestServer): { transaction_id: string; kind: string }[] {
  return fake_store(server, GOOGLE)
    .calls()
    .filter((c) => c.operation === 'acknowledge')
    .map((c) => ({ transaction_id: String(c.input.transaction_id), kind: String(c.input.kind) }));
}

async function alive(session: Session): Promise<boolean> {
  const sent = await testing.send(session, 'core/SyncSubscriptions', new CoreContract.SyncSubscriptionsRequest());
  return sent.envelope.error?.code !== CoreError.CORE_ERROR_UNAUTHORIZED;
}

describe('test transactions', () => {
  it('a store transaction the fake adapter calls a test transaction is GRANTED with test true and one audit log', async () => {
    const server = await start();
    const a = await testing.login(server, 'a');
    const token = await account_token(a);
    expect(status_of(await verify(a, APPLE, receipt('gems_apple', 'tt-1', token)))).toBe(Status.PURCHASE_STATUS_GRANTED);
    expect((await payment(server, a.user_id, 'tt-1'))?.test).toBe(true);
    const audits = await logs_with_reason(server, 'audit', 'iap_test_grant');
    expect(audits).toHaveLength(1);
    expect(audits[0]?.transaction_id).toBe('tt-1');
    fake_store(server).set_result('verify', { result: 'VALID', test: false });
    await verify(a, APPLE, receipt('gems_apple', 'tt-2', token));
    expect((await payment(server, a.user_id, 'tt-2'))?.test).toBe(false);
    expect(await logs_with_reason(server, 'audit', 'iap_test_grant')).toHaveLength(1);
  });

  it('an INVALID store transaction for which the store gives no purchase time writes an INVALID payment record whose purchase time is the request time, with the cheat time offset', async () => {
    const server = await start();
    const a = await testing.login(server, 'a');
    await set_time_offset(a, DAY);
    fake_store(server, GOOGLE).set_result('verify', 'INVALID');
    without_purchase_time(server, GOOGLE, 'verify');
    expect(status_of(await verify(a, GOOGLE, receipt('vip_google', 'iv-1', await account_token(a))))).toBe(Status.PURCHASE_STATUS_INVALID);
    expect(await stored_purchased_at(server, a.user_id, 'iv-1')).toEqual({ result: 'INVALID', purchased_at: (START + DAY).toString() });
  });

  it('a user with purchaseLimits.testGrants count grants within periodMs gets INVALID for the next test transaction', async () => {
    const server = await start({ settings: { 'purchaseLimits.testGrants': { count: 2, periodMs: 60_000 } } });
    const a = await testing.login(server, 'a');
    const token = await account_token(a);
    expect(status_of(await verify(a, APPLE, receipt('gems_apple', 'tl-1', token)))).toBe(Status.PURCHASE_STATUS_GRANTED);
    expect(status_of(await verify(a, APPLE, receipt('gems_apple', 'tl-2', token)))).toBe(Status.PURCHASE_STATUS_GRANTED);
    expect(status_of(await verify(a, APPLE, receipt('gems_apple', 'tl-3', token)))).toBe(Status.PURCHASE_STATUS_INVALID);
    expect((await logs_with_reason(server, 'security', 'invalid')).length).toBeGreaterThan(0);
    testing.advance_time(server, 60_001n);
    expect(status_of(await verify(a, APPLE, receipt('gems_apple', 'tl-3', token)))).toBe(Status.PURCHASE_STATUS_GRANTED);
  });

  it('with purchaseLimits.testGrants null the same user gets GRANTED for any number of test transactions', async () => {
    const server = await start();
    const a = await testing.login(server, 'a');
    const token = await account_token(a);
    for (let i = 0; i < 6; i += 1) expect(status_of(await verify(a, APPLE, receipt('gems_apple', `tn-${String(i)}`, token)))).toBe(Status.PURCHASE_STATUS_GRANTED);
    expect(await balance(server, a.user_id)).toBe(600n);
  });

  it('revoke_test_grant revokes the reward of the test transaction and marks it REFUNDED; a store transaction that is not a test transaction is not_found', async () => {
    const server = await start();
    const a = await testing.login(server, 'a');
    const token = await account_token(a);
    await verify(a, APPLE, receipt('gems_apple', 'rv-1', token));
    expect((await revoke_test_grant(server, a.user_id, 'rv-1', 'op-1')).status).toBe(200);
    expect(await balance(server, a.user_id)).toBe(0n);
    expect((await payment(server, a.user_id, 'rv-1'))?.result).toBe('REFUNDED');
    expect((await revoke_test_grant(server, a.user_id, 'rv-1', 'op-2')).status).toBe(409);
    fake_store(server).set_result('verify', { result: 'VALID', test: false });
    await verify(a, APPLE, receipt('gems_apple', 'rv-2', token));
    const missing = await revoke_test_grant(server, a.user_id, 'rv-2', 'op-3');
    expect(missing.status).toBe(404);
    expect((await revoke_test_grant(server, a.user_id, 'nothing', 'op-4')).status).toBe(404);
    const b = await testing.login(server, 'b');
    fake_store(server).set_result('verify', 'VALID');
    await verify(b, APPLE, receipt('gems_apple', 'rv-3', await account_token(b)));
    expect((await revoke_test_grant(server, a.user_id, 'rv-3', 'op-5')).status).toBe(404);
  });

  it('revoke_test_grant of a test Subscription revokes the subscription of the target user; after the Subscription moved to another user by ownership transfer, it revokes that user\'s subscription record and recomputes that user\'s SubscriptionUserState after the commit', async () => {
    const server = await start();
    const own = await testing.login(server, 'own');
    expect(status_of(await verify(own, APPLE, receipt('vip_apple', 'rs-own', await account_token(own))))).toBe(Status.PURCHASE_STATUS_GRANTED);
    expect((await subscription_row(server, own.user_id, '[iap_vip]'))?.state).toBe(CoreContract.SubscriptionState.SUBSCRIPTION_STATE_ACTIVE);
    expect((await revoke_test_grant(server, own.user_id, 'rs-own', 'op-rs-own')).status).toBe(200);
    expect(await subscription_row(server, own.user_id, '[iap_vip]')).toMatchObject({ state: CoreContract.SubscriptionState.SUBSCRIPTION_STATE_REVOKED, ends_at: START });
    expect((await exported_rows(server, own.user_id, 'iap_subscription')).find((row) => row['original_transaction_id'] === 'rs-own')?.['state']).toBe('SUBSCRIPTION_STATE_REVOKED');

    const a = await testing.login(server, 'a');
    const b = await testing.login(server, 'b');
    const data = receipt('vip_apple', 'rs-1', await account_token(b));
    expect(status_of(await verify(b, APPLE, data))).toBe(Status.PURCHASE_STATUS_GRANTED);
    expect(status_of(await recover(a, APPLE, data))).toBe(Status.PURCHASE_STATUS_ALREADY_GRANTED);
    await testing.wait_background(server);
    const a_state = await subscription_row(server, a.user_id, '[iap_vip]');
    expect(a_state?.state).toBe(CoreContract.SubscriptionState.SUBSCRIPTION_STATE_ACTIVE);
    const a_record = (await exported_rows(server, a.user_id, 'iap_subscription')).find((row) => row['original_transaction_id'] === 'rs-1');
    expect(a_record).toBeDefined();
    expect((await revoke_test_grant(server, b.user_id, 'rs-1', 'op-rs-1')).status).toBe(200);
    await testing.wait_background(server);
    expect((await payment(server, b.user_id, 'rs-1'))?.result).toBe('REFUNDED');
    expect((await exported_rows(server, a.user_id, 'iap_subscription')).find((row) => row['original_transaction_id'] === 'rs-1')).toMatchObject({ user_id: a_record?.['user_id'], state: 'SUBSCRIPTION_STATE_REVOKED' });
    expect(await subscription_row(server, a.user_id, '[iap_vip]')).toMatchObject({ state: CoreContract.SubscriptionState.SUBSCRIPTION_STATE_REVOKED, ends_at: START });
    expect(await subscription_row(server, b.user_id, '[iap_vip]')).toBeNull();
    expect(testing.read_logs(server, 'error').filter((l: Record<string, unknown>) => String(l.message).includes('of another user'))).toHaveLength(0);
  });
});

describe('hooks of extra_grant', () => {
  it('a server whose data has an extra_grant row does not start unless content registers grant_iap_extra and revoke_iap; without such a row it starts with neither', async () => {
    for (const left_out of ['grant_iap_extra', 'revoke_iap']) {
      const failure = await start({ register: register_hooks({ [left_out]: null }) }).then(
        () => null,
        (error: unknown) => error,
      );
      expect(failure).toBeInstanceOf(testing.StartFailure);
      const start_failure = failure as InstanceType<typeof testing.StartFailure>;
      expect(start_failure.message).toContain(left_out);
      expect(start_failure.logs.some((line) => line.level === 'error' && String(line.message).includes(left_out))).toBe(true);
    }
    const server = await start();
    const a = await testing.login(server, 'a');
    expect(status_of(await verify(a, APPLE, receipt('extra_apple', 'x-1', await account_token(a))))).toBe(Status.PURCHASE_STATUS_GRANTED);
    expect(await start({ data_folder: data_folder_without_extra_grant(), register: register_hooks({ grant_iap_extra: null, revoke_iap: null }) })).toBeDefined();
  });

  it('grant_iap_extra failing is INTERNAL and leaves items and the payment record as they were', async () => {
    let answer: unknown = 1000;
    const calls: [number, string][] = [];
    const server = await start({
      register: register_hooks({
        grant_iap_extra: (_ctx: unknown, product_id: number, transaction_id: string) => {
          calls.push([product_id, transaction_id]);
          return answer;
        },
      }),
    });
    const a = await testing.login(server, 'a');
    const token = await account_token(a);
    const data = receipt('extra_apple', 'xf-1', token);
    expect(code_of(await verify(a, APPLE, data))).toBe(CoreError.CORE_ERROR_INTERNAL);
    expect(await balance(server, a.user_id)).toBe(0n);
    expect(await payment(server, a.user_id, 'xf-1')).toBeUndefined();
    expect(testing.read_logs(server, 'error').some((l: Record<string, unknown>) => String(l.message).includes('grant_iap_extra'))).toBe(true);
    answer = 'pass';
    expect(status_of(await verify(a, APPLE, data))).toBe(Status.PURCHASE_STATUS_GRANTED);
    expect(await balance(server, a.user_id)).toBe(7n);
    expect(calls.at(-1)).toEqual([id('[iap_extra]'), 'xf-1']);
  });
});

describe('records of a withdrawn user', () => {
  it('after remove_user the payment record stays and the expiry sweep removes it from its delete_at', async () => {
    const retention = 10n * DAY;
    const server = await start({ settings: { 'iap.withdrawnRecordRetentionMs': Number(retention), 'routing.storageSweepIntervalMs': 60_000 } });
    const a = await testing.login(server, 'a');
    await verify(a, APPLE, receipt('gems_apple', 'wr-1', await account_token(a)));
    await withdraw(a);
    expect((await payment(server, a.user_id, 'wr-1'))?.delete_at).toBe((START + retention).toString());
    testing.set_time(server, START + retention - 60_000n);
    await testing.wait_background(server);
    expect(await payment(server, a.user_id, 'wr-1')).toBeDefined();
    testing.set_time(server, START + retention + 60_000n);
    await testing.wait_background(server);
    expect((await list_payments(server, a.user_id)).payments).toEqual([]);
  });

  it('has_granted_payment keeps a guest with a GRANTED payment record that is not a test transaction from the guest sweep; guests with only test, REFUNDED or INVALID records or none are removed', async () => {
    const settings = { 'auth.inactiveGuestDeleteAfterMs': 1000, 'auth.guestSweepIntervalMs': 1000, 'auth.guestSweepBatchSize': 100 };
    const server = await start({ settings: { ...settings, ...SOCIAL } });
    const fake = fake_store(server);
    const paid = await testing.login(server, 'g_paid');
    const test_only = await testing.login(server, 'g_test');
    const refunded = await testing.login(server, 'g_refunded');
    const invalid = await testing.login(server, 'g_invalid');
    const none = await testing.login(server, 'g_none');
    const linked = await testing.login(server, 'g_linked');
    await link_social(linked, 'linked');
    fake.set_result('verify', { result: 'VALID', test: false });
    await verify(paid, APPLE, receipt('gems_apple', 'gp-1', await account_token(paid)));
    await verify(refunded, APPLE, receipt('gems_apple', 'gr-1', await account_token(refunded)));
    expect(await refund(server, APPLE, 'gr-1')).toBe(200);
    fake.set_result('verify', { result: 'VALID', test: true });
    await verify(test_only, APPLE, receipt('gems_apple', 'gt-1', await account_token(test_only)));
    fake.set_result('verify', 'INVALID');
    await verify(invalid, APPLE, receipt('gems_apple', 'gi-1', await account_token(invalid)));
    await account_token(none);
    for (let i = 0; i < 3; i += 1) {
      testing.advance_time(server, 1000n);
      await testing.wait_background(server);
    }
    expect(await alive(paid)).toBe(true);
    expect(await alive(linked)).toBe(true);
    for (const gone of [test_only, refunded, invalid, none]) expect(await alive(gone)).toBe(false);
  });
});

describe('purchase count of refunds', () => {
  it('a Daily Consumable granted on day d and d + 1: the REFUND of d keeps the count of d + 1 at 1, and the REFUND of d + 1 makes it 0', async () => {
    const server = await start();
    const a = await testing.login(server, 'a');
    const token = await account_token(a);
    await verify(a, APPLE, receipt('daily_apple', 'pd-d', token));
    testing.set_time(server, START + DAY);
    await verify(a, APPLE, receipt('daily_apple', 'pd-d1', token));
    expect(await refund(server, APPLE, 'pd-d')).toBe(200);
    expect(await purchase_count_of(server, a.user_id, '[iap_daily_pack]')).toBe(1);
    expect(await refund(server, APPLE, 'pd-d1')).toBe(200);
    expect(await purchase_count_of(server, a.user_id, '[iap_daily_pack]')).toBe(0);
  });

  it('the REFUND in round 2 of a store transaction granted in round 1 of a repeating live event keeps the purchase count of round 2', async () => {
    const server = await start();
    const a = await testing.login(server, 'a');
    const token = await account_token(a);
    await verify(a, APPLE, receipt('event_apple', 'pe-1', token));
    testing.set_time(server, START + 7n * DAY);
    await verify(a, APPLE, receipt('event_apple', 'pe-2', token));
    expect(await refund(server, APPLE, 'pe-1')).toBe(200);
    expect(await purchase_count_of(server, a.user_id, '[iap_event_pack]')).toBe(1);
  });
});

describe('analytics and acknowledgement', () => {
  it('a grant and a refund leave core_iap_granted and core_iap_refunded for a user that allows analytics', async () => {
    const server = await start();
    const a = await testing.login(server, 'a');
    await verify(a, APPLE, receipt('gems_apple', 'an-1', await account_token(a)));
    expect(await refund(server, APPLE, 'an-1')).toBe(200);
    expect(await core_events(server, a.user_id, 'core_iap_granted')).toHaveLength(1);
    const refunded = await core_events(server, a.user_id, 'core_iap_refunded');
    expect(refunded).toEqual([expect.objectContaining({ store: 'IAP_STORE_APPLE', test: true })]);
  });

  it('a GOOGLE store transaction of the fake iap-google adapter ending GRANTED or ALREADY_GRANTED gets one purchase acknowledgement after commit by product type; INVALID, OTHER_USER, PENDING and IAP_VERIFY_UNAVAILABLE get none; a failed acknowledgement keeps the response and logs one error', async () => {
    const server = await start({ settings: SOCIAL });
    const a = await testing.login(server, 'a');
    const token = await account_token(a);
    const fake = fake_store(server, GOOGLE);
    await verify(a, GOOGLE, receipt('gems_google', 'ak-c', token));
    await verify(a, GOOGLE, receipt('noads_google', 'ak-n', token));
    await verify(a, GOOGLE, receipt('vip_google', 'ak-s', token));
    await verify(a, GOOGLE, receipt('gems_google', 'ak-c', token));
    await testing.wait_background(server);
    expect(acknowledgements(server)).toEqual([
      { transaction_id: 'ak-c', kind: 'consume' },
      { transaction_id: 'ak-n', kind: 'acknowledge' },
      { transaction_id: 'ak-s', kind: 'subscription_acknowledge' },
      { transaction_id: 'ak-c', kind: 'consume' },
    ]);
    const count = acknowledgements(server).length;
    fake.set_result('verify', 'INVALID');
    await verify(a, GOOGLE, receipt('gems_google', 'ak-i', token));
    fake.set_result('verify', 'PENDING');
    await verify(a, GOOGLE, receipt('gems_google', 'ak-p', token));
    fake.set_result('verify', 'FAILED');
    await verify(a, GOOGLE, receipt('gems_google', 'ak-f', token));
    fake.set_result('verify', 'VALID');
    const b = await testing.login(server, 'b');
    await link_social(b, 'b-ack');
    await verify(a, GOOGLE, receipt('gems_google', 'ak-o', await account_token(b)));
    await testing.wait_background(server);
    expect(acknowledgements(server)).toHaveLength(count);
    fake.set_failure('acknowledge', 'communication_failure');
    const errors = testing.read_logs(server, 'error').length;
    expect(status_of(await verify(a, GOOGLE, receipt('gems_google', 'ak-x', token)))).toBe(Status.PURCHASE_STATUS_GRANTED);
    await testing.wait_background(server);
    expect(testing.read_logs(server, 'error').length).toBe(errors + 1);
  });
});
