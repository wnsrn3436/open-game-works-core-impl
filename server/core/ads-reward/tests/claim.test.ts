import * as CoreContract from '../../../generated/contract/core_contract.ts';
import {
  amounts,
  BASIC,
  balance_entry,
  begin,
  claim,
  CLAIM_WAIT_MS,
  DAILY,
  drive,
  error_of,
  GEM,
  notify_of,
  POLL_MS,
  signed,
  start,
  still_pending,
  T,
  user,
  type Started,
} from './helpers.ts';

const { CoreError } = CoreContract;

describe('ads-reward claim', () => {
  let s: Started;

  beforeAll(async () => {
    s = await start();
  });

  afterAll(async () => {
    await T.stop_test_server(s.server);
  });

  it('answers AD_REWARD_PENDING to ClaimAdReward before the callback after claimWaitMs, keeps the Claimed ticket and sends the late grant in the next pending delta', async () => {
    const session = await user(s.server);
    const notify_id = await notify_of(session, BASIC());
    const pending = claim(session, notify_id);
    expect(await still_pending(pending, 200)).toBe(true);
    const first = await drive(s.server, pending);
    expect(error_of(first)).toBe(CoreError.CORE_ERROR_AD_REWARD_PENDING);

    const next = await notify_of(session, BASIC());
    expect(next).not.toBe(notify_id);
    expect((await signed(s, notify_id, session.user_id)).status).toBe(200);

    const after = await begin(session, DAILY());
    expect(error_of(after)).toBe(0);
    expect(balance_entry(after.envelope.pending_user_state, GEM())).toBe(10n);
    const claimed = await claim(session, notify_id);
    expect(error_of(claimed)).toBe(0);
    expect(amounts(claimed.response?.items ?? [])).toEqual([[GEM(), 10n]]);
  });

  it('sends the late grant in the pending delta of the next successful response', async () => {
    const session = await user(s.server);
    const notify_id = await notify_of(session, BASIC());
    expect(error_of(await drive(s.server, claim(session, notify_id)))).toBe(CoreError.CORE_ERROR_AD_REWARD_PENDING);
    expect((await signed(s, notify_id, session.user_id)).status).toBe(200);
    const next = await claim(session, notify_id);
    expect(error_of(next)).toBe(0);
    expect(balance_entry(next.envelope.pending_user_state, GEM())).toBe(10n);
  });

  it('does not block other requests of the user and the callback grant of the user while wait_ad_reward waits', async () => {
    const session = await user(s.server);
    const notify_id = await notify_of(session, BASIC());
    const pending = claim(session, notify_id);
    expect(await still_pending(pending, 200)).toBe(true);

    const other = notify_of(session, DAILY());
    expect(await still_pending(other, 3000)).toBe(false);
    expect(await other).not.toBe('');
    const granted = signed(s, notify_id, session.user_id);
    expect(await still_pending(granted, 3000)).toBe(false);
    expect((await granted).status).toBe(200);
    expect(await still_pending(pending, 100)).toBe(true);

    T.advance_time(s.server, POLL_MS);
    const claimed = await drive(s.server, pending);
    expect(error_of(claimed)).toBe(0);
    expect(amounts(claimed.response?.items ?? [])).toEqual([[GEM(), 10n]]);
  });

  it('waits no longer than claimWaitMs of the clock', async () => {
    const session = await user(s.server);
    const notify_id = await notify_of(session, BASIC());
    const pending = claim(session, notify_id);
    expect(await still_pending(pending, 200)).toBe(true);
    T.advance_time(s.server, CLAIM_WAIT_MS);
    const first = await drive(s.server, pending);
    expect(error_of(first)).toBe(CoreError.CORE_ERROR_AD_REWARD_PENDING);
  });

  it('answers AD_REWARD_NOT_FOUND to a reward notify ID the user does not have', async () => {
    const owner = await user(s.server);
    const other = await user(s.server);
    const notify_id = await notify_of(owner, BASIC());
    expect(error_of(await claim(other, notify_id))).toBe(CoreError.CORE_ERROR_AD_REWARD_NOT_FOUND);
  });
});
