import * as testing from '../../testing/dev/index.ts';
import {
  account_token,
  APPLE,
  balance,
  claim_daily,
  code_of,
  CoreError,
  DAY,
  purchase_row,
  receipt,
  start,
  set_time_offset,
  START,
  verify,
  fake_store,
} from './helpers.ts';

const TODAY = START / DAY;

describe('daily reward and pass', () => {
  it('ClaimIapDaily gives daily_reward once a game day; the second claim of the day is IAP_ALREADY_CLAIMED and the next game day gives it again; a subscription without entitlement and an inactive pass are IAP_DAILY_INACTIVE', async () => {
    const server = await start();
    const a = await testing.login(server, 'a');
    const token = await account_token(a);
    expect(code_of(await claim_daily(a, '[iap_vip]'))).toBe(CoreError.CORE_ERROR_IAP_DAILY_INACTIVE);
    expect(code_of(await claim_daily(a, '[iap_pass]'))).toBe(CoreError.CORE_ERROR_IAP_DAILY_INACTIVE);
    expect(code_of(await claim_daily(a, '[iap_gems]'))).toBe(CoreError.CORE_ERROR_INVALID_REQUEST);
    fake_store(server).set_result('lookup_subscription', { ends_at: (START + 30n * DAY).toString() });
    await verify(a, APPLE, receipt('vip_apple', 'd-vip', token));
    const before = await balance(server, a.user_id);
    const first = await claim_daily(a, '[iap_vip]');
    expect(first.response?.items.map((i) => i.amount)).toEqual([5n]);
    expect(await balance(server, a.user_id)).toBe(before + 5n);
    expect(code_of(await claim_daily(a, '[iap_vip]'))).toBe(CoreError.CORE_ERROR_IAP_ALREADY_CLAIMED);
    testing.set_time(server, START + DAY - 1n);
    expect(code_of(await claim_daily(a, '[iap_vip]'))).toBe(CoreError.CORE_ERROR_IAP_ALREADY_CLAIMED);
    testing.set_time(server, START + DAY);
    expect(code_of(await claim_daily(a, '[iap_vip]'))).toBeNull();
    expect((await purchase_row(server, a.user_id, '[iap_vip]'))?.daily_claimed_day).toBe(TODAY + 1n);
  });

  it('a pass grant writes pass_end_day as today + pass_days, a grant while active adds pass_days, it is active until the game day before pass_end_day and not on it, and its REFUND takes pass_days back', async () => {
    const server = await start();
    const a = await testing.login(server, 'a');
    const token = await account_token(a);
    await verify(a, APPLE, receipt('pass_apple', 'ps-1', token));
    expect((await purchase_row(server, a.user_id, '[iap_pass]'))?.pass_end_day).toBe(TODAY + 30n);
    await verify(a, APPLE, receipt('pass_apple', 'ps-2', token));
    expect((await purchase_row(server, a.user_id, '[iap_pass]'))?.pass_end_day).toBe(TODAY + 60n);
    testing.set_time(server, (TODAY + 59n) * DAY);
    expect(code_of(await claim_daily(a, '[iap_pass]'))).toBeNull();
    testing.set_time(server, (TODAY + 60n) * DAY);
    expect(code_of(await claim_daily(a, '[iap_pass]'))).toBe(CoreError.CORE_ERROR_IAP_DAILY_INACTIVE);
    expect(await testing.call_dev(server, 'iap', 'send_fake_refund', [APPLE, 'ps-2'])).toBe(200);
    expect((await purchase_row(server, a.user_id, '[iap_pass]'))?.pass_end_day).toBe(TODAY + 30n);
  });

  it('in DEV a user with a cheat time offset is judged by the request time with the offset, for entitlement and for the ClaimIapDaily game day', async () => {
    const server = await start();
    const a = await testing.login(server, 'a');
    const token = await account_token(a);
    fake_store(server).set_result('lookup_subscription', { ends_at: (START + 2n * DAY).toString() });
    await verify(a, APPLE, receipt('vip_apple', 'off-1', token));
    expect(code_of(await claim_daily(a, '[iap_vip]'))).toBeNull();
    await set_time_offset(a, DAY);
    expect(code_of(await claim_daily(a, '[iap_vip]'))).toBeNull();
    expect((await purchase_row(server, a.user_id, '[iap_vip]'))?.daily_claimed_day).toBe(TODAY + 1n);
    await set_time_offset(a, 2n * DAY);
    expect(code_of(await claim_daily(a, '[iap_vip]'))).toBe(CoreError.CORE_ERROR_IAP_DAILY_INACTIVE);
  });
});
