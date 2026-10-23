import { randomUUID } from 'node:crypto';
import * as CoreCheatContract from '../../../dev/generated/contract/core_cheat_contract.ts';
import * as CoreContract from '../../../generated/contract/core_contract.ts';
import { amounts, BASIC, balance, balance_entry, claim, error_of, fake_callback, GEM, hooks, notify_of, reward_count, start, T, user, type Started } from './helpers.ts';

const { CoreError, ItemChangeSource } = CoreContract;

describe('ads-reward FakeAdCallback', () => {
  let s: Started;

  beforeAll(async () => {
    s = await start();
  });

  afterAll(async () => {
    await T.stop_test_server(s.server);
  });

  it('grants without INTERNAL with the grant in the response delta and item_changes, and a later ClaimAdReward succeeds', async () => {
    const session = await user(s.server);
    const notify_id = await notify_of(session, BASIC());
    const sent = await fake_callback(session, notify_id);
    expect(error_of(sent)).toBe(0);
    expect(balance_entry(sent.envelope.user_state, GEM())).toBe(10n);
    expect(sent.envelope.item_changes.map((c) => [c.item_id, c.delta, c.source])).toEqual([[GEM(), 10n, ItemChangeSource.ITEM_CHANGE_SOURCE_AD_REWARD]]);
    const claimed = await claim(session, notify_id);
    expect(error_of(claimed)).toBe(0);
    expect(amounts(claimed.response?.items ?? [])).toEqual([[GEM(), 10n]]);
  });

  it('answers AD_REWARD_NOT_FOUND to a reward notify ID without a usable ticket of the user', async () => {
    const owner = await user(s.server);
    const other = await user(s.server);
    const notify_id = await notify_of(owner, BASIC());
    expect(error_of(await fake_callback(other, notify_id))).toBe(CoreError.CORE_ERROR_AD_REWARD_NOT_FOUND);
    expect(error_of(await fake_callback(owner, randomUUID()))).toBe(CoreError.CORE_ERROR_AD_REWARD_NOT_FOUND);
    expect(error_of(await fake_callback(owner, notify_id))).toBe(0);
    expect(error_of(await fake_callback(owner, notify_id))).toBe(CoreError.CORE_ERROR_AD_REWARD_NOT_FOUND);
  });

  it('answers INTERNAL without a grant when on_ad_rewarded throws, and a later FakeAdCallback of the same reward notify ID grants', async () => {
    let fail_next = false;
    const failing = await start(
      {},
      hooks({
        on_ad_rewarded: () => {
          if (fail_next) {
            fail_next = false;
            throw new Error('on_ad_rewarded fails');
          }
        },
      }),
    );
    try {
      const session = await user(failing.server);
      const notify_id = await notify_of(session, BASIC());
      fail_next = true;
      const errors = T.read_logs(failing.server, 'error', 'error').length;
      expect(error_of(await fake_callback(session, notify_id))).toBe(CoreError.CORE_ERROR_INTERNAL);
      expect(T.read_logs(failing.server, 'error', 'error').length).toBeGreaterThan(errors);
      expect(await balance(failing.server, session.user_id, GEM())).toBe(0n);
      expect(await reward_count(failing.server, session.user_id, BASIC())).toBeNull();

      const sent = await fake_callback(session, notify_id);
      expect(error_of(sent)).toBe(0);
      expect(balance_entry(sent.envelope.user_state, GEM())).toBe(10n);
      expect((await reward_count(failing.server, session.user_id, BASIC()))?.count).toBe(1);
      const claimed = await claim(session, notify_id);
      expect(error_of(claimed)).toBe(0);
      expect(amounts(claimed.response?.items ?? [])).toEqual([[GEM(), 10n]]);
    } finally {
      await T.stop_test_server(failing.server);
    }
  });

  it('has no FakeAdCallback on a STG server', async () => {
    const server = await T.start_test_server(undefined, undefined, 'STG');
    try {
      const request = new CoreCheatContract.FakeAdCallbackRequest();
      request.notify_id = randomUUID();
      const raw = await T.send_raw(server, 'POST', '/core/cheat/FakeAdCallback', { 'content-type': 'application/x-protobuf' }, request.encode());
      const envelope = CoreContract.ResponseEnvelope.decode(raw.body);
      expect(envelope?.error?.code).toBe(CoreError.CORE_ERROR_UNAUTHORIZED);
      expect(T.read_logs(server, 'security').some((l) => l.reason === 'cheat_path_closed')).toBe(true);
    } finally {
      await T.stop_test_server(server);
    }
  });
});
