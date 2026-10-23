import * as CoreContract from '../../../generated/contract/core_contract.ts';
import * as GameContract from '../../../generated/contract/game_contract.ts';
import type { RequestCtx } from '../../storage/index.ts';
import type { AdsReward } from '../index.ts';
import { begin, claim, DAILY, data, DAY_MS, drive, error_of, GEM, hooks, INTERSTITIAL, notify_of, ONCE, relogin, signed, start, T, T0, user, type Started, type TestSession } from './helpers.ts';

const { CoreError } = CoreContract;

describe('ads-reward limit', () => {
  let s: Started;

  beforeAll(async () => {
    s = await start();
  });

  afterAll(async () => {
    await T.stop_test_server(s.server);
  });

  it('answers INVALID_REQUEST to BeginAdReward of a placement that is not Rewarded', async () => {
    const session = await user(s.server);
    expect(error_of(await begin(session, INTERSTITIAL()))).toBe(CoreError.CORE_ERROR_INVALID_REQUEST);
  });

  it('answers AD_LIMIT_REACHED when the grants reach limit_count, and takes BeginAdReward again after the reset time', async () => {
    T.set_time(s.server, T0 + 3_600_000n);
    const session = await user(s.server);
    for (let i = 0; i < 2; i += 1) {
      const notify_id = await notify_of(session, DAILY());
      expect((await signed(s, notify_id, session.user_id)).status).toBe(200);
    }
    expect(error_of(await begin(session, DAILY()))).toBe(CoreError.CORE_ERROR_AD_LIMIT_REACHED);
    T.set_time(s.server, T0 + DAY_MS - 1n);
    const before_reset = await relogin(s.server, session);
    expect(error_of(await begin(before_reset, DAILY()))).toBe(CoreError.CORE_ERROR_AD_LIMIT_REACHED);
    T.set_time(s.server, T0 + DAY_MS);
    expect(error_of(await begin(before_reset, DAILY()))).toBe(0);
  });

  it('keeps AD_LIMIT_REACHED of a placement whose reset is null after time passes', async () => {
    const session = await user(s.server);
    const notify_id = await notify_of(session, ONCE());
    await signed(s, notify_id, session.user_id);
    expect(error_of(await begin(session, ONCE()))).toBe(CoreError.CORE_ERROR_AD_LIMIT_REACHED);
    T.advance_time(s.server, 40n * DAY_MS);
    expect(error_of(await begin(await relogin(s.server, session), ONCE()))).toBe(CoreError.CORE_ERROR_AD_LIMIT_REACHED);
  });

  it('counts the Claimed tickets of the placement with the grants', async () => {
    const session = await user(s.server);
    const notify_id = await notify_of(session, ONCE());
    expect(error_of(await drive(s.server, claim(session, notify_id)))).toBe(CoreError.CORE_ERROR_AD_REWARD_PENDING);
    expect(error_of(await begin(session, ONCE()))).toBe(CoreError.CORE_ERROR_AD_LIMIT_REACHED);
  });

  it('get_reward_count from a content handler is the grants in the limit period, 0 after the Daily reset time and 0 for a placement with no ad_placement row', async () => {
    const asked: { placement_id: number; count: number | null } = { placement_id: 0, count: null };
    const t = await start(
      {},
      hooks(
        {},
        {
          RunCoreTest: (core: Record<string, unknown>, ctx: RequestCtx) => {
            asked.count = (core['ads-reward'] as AdsReward).get_reward_count(ctx, asked.placement_id);
            return new GameContract.RunCoreTestResponse();
          },
        },
      ),
    );
    const count_of = async (session: TestSession, placement_id: number): Promise<number | null> => {
      asked.placement_id = placement_id;
      asked.count = null;
      const sent = await T.send(session, 'RunCoreTest', new GameContract.RunCoreTestRequest());
      expect(error_of(sent)).toBe(0);
      return asked.count;
    };
    try {
      T.set_time(t.server, T0 + 3_600_000n);
      const session = await user(t.server);
      expect(await count_of(session, DAILY())).toBe(0);
      const notify_id = await notify_of(session, DAILY());
      expect((await signed(t, notify_id, session.user_id)).status).toBe(200);
      expect(await count_of(session, DAILY())).toBe(1);
      expect(await count_of(session, ONCE())).toBe(0);
      expect(data.AdPlacementTable.has_row(GEM())).toBe(false);
      expect(await count_of(session, GEM())).toBe(0);
      T.set_time(t.server, T0 + DAY_MS - 1n);
      const before_reset = await relogin(t.server, session);
      expect(await count_of(before_reset, DAILY())).toBe(1);
      T.set_time(t.server, T0 + DAY_MS);
      expect(await count_of(before_reset, DAILY())).toBe(0);
    } finally {
      await T.stop_test_server(t.server);
    }
  });

  it('lets a hook of validate_ad_reward refuse BeginAdReward with its GameError', async () => {
    expect(GameContract.CORE_ERRORS.get('core/BeginAdReward')).toContain(GameContract.GameError.GAME_ERROR_CORE_TEST);
    const refused = new Set<number>();
    const t = await start(
      {},
      hooks({
        validate_ad_reward: (_ctx: unknown, placement_id: number) => {
          refused.add(placement_id);
          return GameContract.GameError.GAME_ERROR_CORE_TEST;
        },
      }),
    );
    try {
      const session = await user(t.server);
      const sent = await begin(session, ONCE());
      expect(sent.response).toBeNull();
      expect(error_of(sent)).toBe(GameContract.GameError.GAME_ERROR_CORE_TEST);
      expect(refused.has(ONCE())).toBe(true);
    } finally {
      await T.stop_test_server(t.server);
    }
  });
});
