import * as CoreContract from '../../../generated/contract/core_contract.ts';
import * as testing from '../../testing/dev/index.ts';
import {
  account_token,
  APPLE,
  check_purchase,
  code_of,
  CoreError,
  DAY,
  GOOGLE,
  id,
  purchase_count_of,
  purchase_row,
  receipt,
  register_hooks,
  start,
  START,
  Status,
  status_of,
  verify,
  type Session,
  type TestServer,
  fake_store,
} from './helpers.ts';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

async function confirm_age(session: Session, birth_year_month: number): Promise<void> {
  const request = new CoreContract.ConfirmAgeRequest();
  request.birth_year_month = birth_year_month;
  const sent = await testing.send(session, 'core/ConfirmAge', request);
  if (sent.envelope.error !== null) throw new Error(`ConfirmAge failed: ${String(sent.envelope.error.code)}`);
}

async function check_code(session: Session, store: CoreContract.IapStore, name: string): Promise<number | null> {
  return code_of(await check_purchase(session, store, name));
}

/** Grants `[iap_gems]` (spend 1000) as a store transaction that is not a test transaction. */
async function paid_gems(server: TestServer, session: Session, transaction_id: string, test = false): Promise<void> {
  fake_store(server).set_result('verify', { result: 'VALID', test });
  expect(status_of(await verify(session, APPLE, receipt('gems_apple', transaction_id, await account_token(session))))).toBe(Status.PURCHASE_STATUS_GRANTED);
}

describe('CheckPurchase', () => {
  it('gives the account token as a lowercase UUID and keeps one iap_account_token row for a user who sends it twice', async () => {
    const server = await start();
    const a = await testing.login(server, 'a');
    const first = await check_purchase(a, APPLE, '[iap_gems]');
    const second = await check_purchase(a, APPLE, '[iap_gems]');
    expect(first.response?.account_token).toMatch(UUID);
    expect(second.response?.account_token).toBe(first.response?.account_token);
    const b = await testing.login(server, 'b');
    expect((await check_purchase(b, APPLE, '[iap_gems]')).response?.account_token).not.toBe(first.response?.account_token);
    // One mapping row: a store transaction with the token is A's (no ownership change), and it is GRANTED once.
    const token = first.response?.account_token ?? '';
    expect(status_of(await verify(a, APPLE, receipt('gems_apple', 'at-1', token)))).toBe(Status.PURCHASE_STATUS_GRANTED);
  });

  it('refuses a product at its purchase limit and a product the store does not sell', async () => {
    const server = await start();
    const a = await testing.login(server, 'a');
    const token = await account_token(a);
    expect(await check_code(a, GOOGLE, '[iap_apple_only]')).toBe(CoreError.CORE_ERROR_IAP_PRODUCT_UNAVAILABLE);
    expect(await check_code(a, APPLE, '[iap_no_ads]')).toBeNull();
    await verify(a, APPLE, receipt('noads_apple', 'lim-1', token));
    expect(await check_code(a, APPLE, '[iap_no_ads]')).toBe(CoreError.CORE_ERROR_IAP_LIMIT_REACHED);
  });

  it('refuses a store whose adapter game settings do not give', async () => {
    const server = await start({ settings: { 'environments.<ENV>.adapters.iap-google': null } });
    const a = await testing.login(server, 'a');
    expect(await check_code(a, GOOGLE, '[iap_gems]')).toBe(CoreError.CORE_ERROR_IAP_PRODUCT_UNAVAILABLE);
  });

  it('refuses an auto-renewing subscription with entitlement', async () => {
    const server = await start();
    const a = await testing.login(server, 'a');
    const token = await account_token(a);
    expect(await check_code(a, APPLE, '[iap_vip]')).toBeNull();
    await verify(a, APPLE, receipt('vip_apple', 'ar-1', token));
    expect(await check_code(a, APPLE, '[iap_vip]')).toBe(CoreError.CORE_ERROR_IAP_LIMIT_REACHED);
    expect(await testing.call_dev(server, 'iap', 'send_fake_subscription_notify', [APPLE, 'ar-1', { auto_renew: false, ends_at: (START + 30n * DAY).toString() }])).toBe(200);
    expect(await check_code(a, APPLE, '[iap_vip]')).toBeNull();
  });

  it('is AGE_CONFIRMATION_REQUIRED before the age confirmation when consent.ageConfirmation is true', async () => {
    const server = await start({ settings: { 'consent.ageConfirmation': true } });
    const a = await testing.login(server, 'a');
    expect(await check_code(a, APPLE, '[iap_gems]')).toBe(CoreError.CORE_ERROR_AGE_CONFIRMATION_REQUIRED);
    await confirm_age(a, 200001);
    expect(await check_code(a, APPLE, '[iap_gems]')).toBeNull();
  });

  it('takes the smaller monthly spend limit of two age keys; equal passes, over is IAP_SPEND_LIMIT_REACHED; last game month, REFUNDED and test transactions do not count; a user without a limit passes', async () => {
    const settings = { 'purchaseLimits.monthlyBelowAge': { '16': 2000, '19': 5000 } };
    const server = await start({ start_at: START - 2n * DAY, settings });
    const a = await testing.login(server, 'a');
    await confirm_age(a, 201006);
    await paid_gems(server, a, 'feb-1');
    testing.set_time(server, START);
    await paid_gems(server, a, 'mar-test', true);
    await paid_gems(server, a, 'mar-refund');
    expect(await testing.call_dev(server, 'iap', 'send_fake_refund', [APPLE, 'mar-refund'])).toBe(200);
    expect(await check_code(a, APPLE, '[iap_gems]')).toBeNull();
    await paid_gems(server, a, 'mar-1');
    expect(await check_code(a, APPLE, '[iap_gems]')).toBeNull();
    await paid_gems(server, a, 'mar-2');
    expect(await check_code(a, APPLE, '[iap_gems]')).toBe(CoreError.CORE_ERROR_IAP_SPEND_LIMIT_REACHED);
    const adult = await testing.login(server, 'adult');
    await confirm_age(adult, 199001);
    await paid_gems(server, adult, 'ad-1');
    await paid_gems(server, adult, 'ad-2');
    await paid_gems(server, adult, 'ad-3');
    expect(await check_code(adult, APPLE, '[iap_gems]')).toBeNull();
  });

  it('is IAP_PRODUCT_UNAVAILABLE before start_at, from end_at, for an inactive offer and an inactive live event, and IAP_PRODUCT_LOCKED when the requirement fails', async () => {
    const server = await start({ start_at: START + DAY });
    const a = await testing.login(server, 'a');
    expect(await check_code(a, APPLE, '[iap_window]')).toBe(CoreError.CORE_ERROR_IAP_PRODUCT_UNAVAILABLE);
    testing.set_time(server, 1_894_665_600_000n);
    expect(await check_code(a, APPLE, '[iap_window]')).toBeNull();
    testing.set_time(server, 1_896_134_400_000n);
    expect(await check_code(a, APPLE, '[iap_window]')).toBe(CoreError.CORE_ERROR_IAP_PRODUCT_UNAVAILABLE);
    testing.set_time(server, START + DAY);
    expect(await check_code(a, APPLE, '[iap_offer_pack]')).toBe(CoreError.CORE_ERROR_IAP_PRODUCT_UNAVAILABLE);
    expect(await check_code(a, APPLE, '[iap_event_pack]')).toBe(CoreError.CORE_ERROR_IAP_PRODUCT_UNAVAILABLE);
    expect(await check_code(a, APPLE, '[iap_locked]')).toBe(CoreError.CORE_ERROR_IAP_PRODUCT_LOCKED);
  });

  it('a Daily product: the first grant writes reset_at as the next reset, the count is 0 from the reset time and CheckPurchase passes again; an offer product reset_at is the offer end, and triggering the offer again before that end makes the count 0', async () => {
    const server = await start();
    const a = await testing.login(server, 'a');
    const token = await account_token(a);
    await verify(a, APPLE, receipt('daily_apple', 'd-1', token));
    expect((await purchase_row(server, a.user_id, '[iap_daily_pack]'))?.reset_at).toBe(START + DAY);
    expect(await check_code(a, APPLE, '[iap_daily_pack]')).toBe(CoreError.CORE_ERROR_IAP_LIMIT_REACHED);
    testing.set_time(server, START + DAY - 1n);
    expect(await check_code(a, APPLE, '[iap_daily_pack]')).toBe(CoreError.CORE_ERROR_IAP_LIMIT_REACHED);
    testing.set_time(server, START + DAY);
    expect(await check_code(a, APPLE, '[iap_daily_pack]')).toBeNull();

    const offer_id = id('[offer_iap]');
    await testing.call_dev(server, 'offer', 'set_offer', [offer_id, START + DAY, 1], a.user_id);
    expect(await check_code(a, APPLE, '[iap_offer_pack]')).toBeNull();
    await verify(a, APPLE, receipt('offer_apple', 'o-1', token));
    expect((await purchase_row(server, a.user_id, '[iap_offer_pack]'))?.reset_at).toBe(START + 2n * DAY);
    expect(await check_code(a, APPLE, '[iap_offer_pack]')).toBe(CoreError.CORE_ERROR_IAP_LIMIT_REACHED);
    // The offer is triggered again before its earlier end: the offer purchase reset makes the count 0 again.
    await testing.call_dev(server, 'offer', 'set_offer', [offer_id, START + DAY + 1000n, 2], a.user_id);
    expect(await check_code(a, APPLE, '[iap_offer_pack]')).toBeNull();
    await verify(a, APPLE, receipt('offer_apple', 'o-2', token));
    expect((await purchase_row(server, a.user_id, '[iap_offer_pack]'))?.reset_at).toBe(START + 2n * DAY + 1000n);
    expect(await check_code(a, APPLE, '[iap_offer_pack]')).toBe(CoreError.CORE_ERROR_IAP_LIMIT_REACHED);
  });

  it('a limit_count 1 Consumable of a repeating live event passes again in round 2; a NonConsumable of the same event is still IAP_LIMIT_REACHED', async () => {
    // START is the start of a round of [event_iap_weekly] (Mondays 00:00 to Tuesdays 00:00).
    const server = await start();
    const a = await testing.login(server, 'a');
    const token = await account_token(a);
    await verify(a, APPLE, receipt('event_apple', 'ev-1', token));
    await verify(a, APPLE, receipt('event_unlock_apple', 'ev-2', token));
    expect(await check_code(a, APPLE, '[iap_event_pack]')).toBe(CoreError.CORE_ERROR_IAP_LIMIT_REACHED);
    expect(await check_code(a, APPLE, '[iap_event_unlock]')).toBe(CoreError.CORE_ERROR_IAP_LIMIT_REACHED);
    testing.set_time(server, START + 7n * DAY);
    expect(await check_code(a, APPLE, '[iap_event_pack]')).toBeNull();
    expect(await purchase_count_of(server, a.user_id, '[iap_event_pack]')).toBe(1);
    expect(await check_code(a, APPLE, '[iap_event_unlock]')).toBe(CoreError.CORE_ERROR_IAP_LIMIT_REACHED);
  });

  it('hook validate_iap_purchase decides last; its GameError is the response error', async () => {
    const calls: number[] = [];
    let answer: unknown = 'pass';
    const server = await start({
      register: register_hooks({
        validate_iap_purchase: (_ctx: unknown, product_id: number) => {
          calls.push(product_id);
          return answer;
        },
      }),
    });
    const a = await testing.login(server, 'a');
    expect(await check_code(a, APPLE, '[iap_gems]')).toBeNull();
    expect(await check_code(a, GOOGLE, '[iap_apple_only]')).toBe(CoreError.CORE_ERROR_IAP_PRODUCT_UNAVAILABLE);
    expect(calls).toEqual([id('[iap_gems]')]);
    answer = 1000;
    // A GameError not in the (ogw.core_errors) of CheckPurchase is INTERNAL by routing step 15.
    expect(await check_code(a, APPLE, '[iap_gems]')).not.toBeNull();
  });
});
