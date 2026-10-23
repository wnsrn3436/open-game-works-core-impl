import * as CoreContract from '../../../generated/contract/core_contract.ts';
import * as testing from '../../testing/dev/index.ts';
import {
  account_token,
  APPLE,
  balance,
  CAPPED,
  code_of,
  core_events,
  CoreError,
  DAY,
  GOOGLE,
  id,
  item_changes,
  list_payments,
  mails,
  payment,
  product,
  purchase_count_of,
  purchase_row,
  receipt,
  recover,
  set_balance,
  start,
  START,
  Status,
  status_of,
  verify,
  fake_store,
} from './helpers.ts';

describe('grant order', () => {
  it('a valid receipt is GRANTED, grants reward with source Iap and adds one to the purchase count', async () => {
    const server = await start();
    const a = await testing.login(server, 'a');
    const token = await account_token(a);
    const sent = await verify(a, APPLE, receipt('gems_apple', 'g-1', token));
    expect(status_of(sent)).toBe(Status.PURCHASE_STATUS_GRANTED);
    expect(sent.response?.product_id).toBe(id('[iap_gems]'));
    expect(sent.response?.items.map((i) => [i.item_id, i.amount])).toEqual([[id('[item_iap_gem]'), 100n]]);
    expect(item_changes(sent).map((c) => [c.source, c.ref, c.delta])).toEqual([[CoreContract.ItemChangeSource.ITEM_CHANGE_SOURCE_IAP, 'g-1', 100n]]);
    expect(await balance(server, a.user_id)).toBe(100n);
    expect(await purchase_count_of(server, a.user_id, '[iap_gems]')).toBe(1);
    expect((await payment(server, a.user_id, 'g-1'))?.result).toBe('GRANTED');
  });

  it('the same receipt again is ALREADY_GRANTED and items stay; RecoverPurchase too', async () => {
    const server = await start();
    const a = await testing.login(server, 'a');
    const token = await account_token(a);
    const data = receipt('gems_apple', 'g-1', token);
    expect(status_of(await verify(a, APPLE, data))).toBe(Status.PURCHASE_STATUS_GRANTED);
    expect(status_of(await verify(a, APPLE, data))).toBe(Status.PURCHASE_STATUS_ALREADY_GRANTED);
    expect(status_of(await recover(a, APPLE, data))).toBe(Status.PURCHASE_STATUS_ALREADY_GRANTED);
    expect(await balance(server, a.user_id)).toBe(100n);
    expect(await purchase_count_of(server, a.user_id, '[iap_gems]')).toBe(1);
    expect((await list_payments(server, a.user_id)).payments).toHaveLength(1);
  });

  it('a recovered unfinished purchase is GRANTED like VerifyPurchase', async () => {
    const server = await start();
    const a = await testing.login(server, 'a');
    const token = await account_token(a);
    expect(status_of(await recover(a, APPLE, receipt('gems_apple', 'r-1', token)))).toBe(Status.PURCHASE_STATUS_GRANTED);
    expect(await balance(server, a.user_id)).toBe(100n);
  });

  it('an unknown SKU is INVALID with an error log', async () => {
    const server = await start();
    const a = await testing.login(server, 'a');
    const token = await account_token(a);
    expect(status_of(await verify(a, APPLE, receipt('nope_apple', 'u-1', token)))).toBe(Status.PURCHASE_STATUS_INVALID);
    expect(status_of(await verify(a, GOOGLE, receipt('apple_only_apple', 'u-2', token)))).toBe(Status.PURCHASE_STATUS_INVALID);
    expect(await balance(server, a.user_id)).toBe(0n);
    expect(testing.read_logs(server, 'error').some((l: Record<string, unknown>) => l.sku === 'nope_apple')).toBe(true);
  });

  it('a store transaction of another app ID is INVALID, and so is a transaction ID outside printable ASCII', async () => {
    const server = await start();
    const a = await testing.login(server, 'a');
    const token = await account_token(a);
    fake_store(server).set_result('verify', { result: 'VALID', app_id: 'com.example.other' });
    expect(status_of(await verify(a, APPLE, receipt('gems_apple', 'app-1', token)))).toBe(Status.PURCHASE_STATUS_INVALID);
    expect((await payment(server, a.user_id, 'app-1'))?.result).toBe('INVALID');
    fake_store(server).set_result('verify', 'VALID');
    expect(status_of(await verify(a, APPLE, receipt('gems_apple', 'bad\u0001id', token)))).toBe(Status.PURCHASE_STATUS_INVALID);
    expect(await balance(server, a.user_id)).toBe(0n);
  });

  it('an INVALID store transaction sent again by the right user is GRANTED with one payment record', async () => {
    const server = await start();
    const a = await testing.login(server, 'a');
    const token = await account_token(a);
    const fake = fake_store(server);
    fake.set_result('verify', 'INVALID');
    expect(status_of(await verify(a, APPLE, receipt('gems_apple', 'i-1', token)))).toBe(Status.PURCHASE_STATUS_INVALID);
    expect((await payment(server, a.user_id, 'i-1'))?.result).toBe('INVALID');
    fake.set_result('verify', 'VALID');
    expect(status_of(await verify(a, APPLE, receipt('gems_apple', 'i-1', token)))).toBe(Status.PURCHASE_STATUS_GRANTED);
    const records = (await list_payments(server, a.user_id)).payments.filter((p) => p.transaction_id === 'i-1');
    expect(records.map((p) => p.result)).toEqual(['GRANTED']);
  });

  it('own GRANTED store transaction that the adapter now calls INVALID is ALREADY_GRANTED; a refund after it still revokes', async () => {
    const server = await start();
    const a = await testing.login(server, 'a');
    const token = await account_token(a);
    const data = receipt('gems_apple', 'k-1', token);
    expect(status_of(await verify(a, APPLE, data))).toBe(Status.PURCHASE_STATUS_GRANTED);
    fake_store(server).set_result('verify', 'INVALID');
    expect(status_of(await verify(a, APPLE, data))).toBe(Status.PURCHASE_STATUS_ALREADY_GRANTED);
    expect((await payment(server, a.user_id, 'k-1'))?.result).toBe('GRANTED');
    expect(await testing.call_dev(server, 'iap', 'send_fake_refund', [APPLE, 'k-1'])).toBe(200);
    await testing.wait_background(server);
    expect(await balance(server, a.user_id)).toBe(0n);
    expect((await payment(server, a.user_id, 'k-1'))?.result).toBe('REFUNDED');
  });

  it('another user GRANTED store transaction that the adapter calls INVALID is INVALID and its record stays', async () => {
    const server = await start();
    const a = await testing.login(server, 'a');
    const b = await testing.login(server, 'b');
    const token_b = await account_token(b);
    const data = receipt('gems_apple', 'k-2', token_b);
    expect(status_of(await verify(b, APPLE, data))).toBe(Status.PURCHASE_STATUS_GRANTED);
    fake_store(server).set_result('verify', 'INVALID');
    expect(status_of(await verify(a, APPLE, data))).toBe(Status.PURCHASE_STATUS_INVALID);
    expect((await payment(server, b.user_id, 'k-2'))?.user_id).toBe(b.user_id.toString());
    expect((await payment(server, b.user_id, 'k-2'))?.result).toBe('GRANTED');
  });

  it('PENDING grants nothing and leaves no payment record', async () => {
    const server = await start();
    const a = await testing.login(server, 'a');
    const token = await account_token(a);
    fake_store(server).set_result('verify', 'PENDING');
    expect(status_of(await verify(a, APPLE, receipt('gems_apple', 'p-1', token)))).toBe(Status.PURCHASE_STATUS_PENDING);
    expect(await balance(server, a.user_id)).toBe(0n);
    expect((await list_payments(server, a.user_id)).payments).toHaveLength(0);
  });

  it('adapter FAILED and time limit are IAP_VERIFY_UNAVAILABLE, and the same receipt is granted later', async () => {
    const server = await start();
    const a = await testing.login(server, 'a');
    const token = await account_token(a);
    const fake = fake_store(server);
    const data = receipt('gems_apple', 'f-1', token);
    fake.set_result('verify', 'FAILED');
    expect(code_of(await verify(a, APPLE, data))).toBe(CoreError.CORE_ERROR_IAP_VERIFY_UNAVAILABLE);
    fake.set_result('verify', 'VALID');
    fake.set_failure('verify', 'timeout');
    expect(code_of(await verify(a, APPLE, data))).toBe(CoreError.CORE_ERROR_IAP_VERIFY_UNAVAILABLE);
    fake.set_failure('verify', 'communication_failure');
    expect(code_of(await verify(a, APPLE, data))).toBe(CoreError.CORE_ERROR_IAP_VERIFY_UNAVAILABLE);
    expect((await list_payments(server, a.user_id)).payments).toHaveLength(0);
    expect(testing.read_logs(server, 'error').length).toBeGreaterThanOrEqual(3);
    fake.set_failure('verify', null);
    expect(status_of(await verify(a, APPLE, data))).toBe(Status.PURCHASE_STATUS_GRANTED);
    expect(await balance(server, a.user_id)).toBe(100n);
  });

  it('a store without an adapter is INVALID_REQUEST', async () => {
    const server = await start({ settings: { 'environments.<ENV>.adapters.iap-google': null } });
    const a = await testing.login(server, 'a');
    const token = await account_token(a);
    expect(code_of(await verify(a, GOOGLE, receipt('gems_google', 'n-1', token)))).toBe(CoreError.CORE_ERROR_INVALID_REQUEST);
  });

  it('a reward over max_amount goes by an [iap_grant_mail] mail that does not expire, and the result is GRANTED', async () => {
    const server = await start();
    const a = await testing.login(server, 'a');
    const token = await account_token(a);
    await set_balance(server, a.user_id, CAPPED(), 100n);
    const sent = await verify(a, APPLE, receipt('capped_apple', 'm-1', token));
    expect(status_of(sent)).toBe(Status.PURCHASE_STATUS_GRANTED);
    expect(sent.envelope.item_mails).toHaveLength(1);
    expect(sent.envelope.item_mails[0]?.source).toBe(CoreContract.ItemChangeSource.ITEM_CHANGE_SOURCE_IAP);
    expect(await balance(server, a.user_id, CAPPED())).toBe(100n);
    const mail = (await mails(server, a.user_id))[0];
    expect(mail?.template_id).toBe(id('[mail_iap_grant_mail]'));
    expect(mail?.expires_at).toBe(0n);
  });

  it('the receipt text and the account token are not in the log', async () => {
    const server = await start();
    const a = await testing.login(server, 'a');
    const token = await account_token(a);
    const data = receipt('gems_apple', 'secret-tx', token);
    await verify(a, APPLE, data);
    fake_store(server).set_result('verify', 'INVALID');
    await verify(a, APPLE, receipt('gems_apple', 'secret-tx-2', token));
    fake_store(server).set_failure('verify', 'timeout');
    await verify(a, APPLE, receipt('gems_apple', 'secret-tx-3', token));
    const text = JSON.stringify(testing.read_logs(server));
    expect(text).not.toContain(token);
    expect(text).not.toContain(data);
    expect(text).not.toContain('fake:gems_apple');
  });

  it('VerifyPurchase does not check the limit again: a paid store transaction over limit_count is granted with a warn log', async () => {
    const server = await start();
    const a = await testing.login(server, 'a');
    const token = await account_token(a);
    expect(status_of(await verify(a, APPLE, receipt('daily_apple', 'l-1', token)))).toBe(Status.PURCHASE_STATUS_GRANTED);
    expect(status_of(await verify(a, APPLE, receipt('daily_apple', 'l-2', token)))).toBe(Status.PURCHASE_STATUS_GRANTED);
    expect(await purchase_count_of(server, a.user_id, '[iap_daily_pack]')).toBe(2);
    expect(testing.read_logs(server, 'core', 'warn').some((l: Record<string, unknown>) => l.module === 'iap' && l.limit_count === 1)).toBe(true);
  });

  it('the payment record reset_at and event_round are the IapPurchaseUserState row values right after the grant', async () => {
    const server = await start();
    const a = await testing.login(server, 'a');
    const token = await account_token(a);
    await verify(a, APPLE, receipt('daily_apple', 'rr-1', token));
    const row = await purchase_row(server, a.user_id, '[iap_daily_pack]');
    const rec = await payment(server, a.user_id, 'rr-1');
    expect(rec?.reset_at).toBe(row?.reset_at.toString());
    expect(rec?.event_round).toBe(row?.event_round);
    expect(row?.reset_at).toBe(START + DAY);
  });

  it('core_iap_granted carries product, store, spend_amount, test and renewal', async () => {
    const server = await start();
    const a = await testing.login(server, 'a');
    const token = await account_token(a);
    await verify(a, APPLE, receipt('gems_apple', 'e-1', token));
    await verify(a, GOOGLE, receipt('noads_google', 'e-2', token));
    await verify(a, APPLE, receipt('vip_apple', 'e-3', token));
    expect(await testing.call_dev(server, 'iap', 'send_fake_subscription_notify', [APPLE, 'e-3', { latest_transaction_id: 'e-4', ends_at: (START + 40n * DAY).toString() }])).toBe(200);
    const params = await core_events(server, a.user_id, 'core_iap_granted');
    expect(params).toEqual([
      expect.objectContaining({ product_id: BigInt(id('[iap_gems]')), store: 'IAP_STORE_APPLE', spend_amount: product('[iap_gems]').spend_amount, test: true, renewal: false }),
      expect.objectContaining({ product_id: BigInt(id('[iap_no_ads]')), store: 'IAP_STORE_GOOGLE', renewal: false }),
      expect.objectContaining({ product_id: BigInt(id('[iap_vip]')), renewal: false }),
      expect.objectContaining({ product_id: BigInt(id('[iap_vip]')), renewal: true }),
    ]);
  });
});
