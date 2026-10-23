import * as CoreCheatContract from '../../../dev/generated/contract/core_cheat_contract.ts';
import type { RequestCtx } from '../../storage/index.ts';
import type { AdsReward } from '../index.ts';
import { create_fake_adapter } from './adapters/fake.ts';

export { create_fake_adapter } from './adapters/fake.ts';
export type { FakeAdsController, FakeAdsKey } from './adapters/fake.ts';

/** The `## DEV` operations of `ads-reward`: the core cheat `FakeAdCallback`. */
export interface AdsRewardDev {
  FakeAdCallback(ctx: RequestCtx, request: CoreCheatContract.FakeAdCallbackRequest): CoreCheatContract.FakeAdCallbackResponse | number;
}

/**
 * The DEV code of the server instance's `ads-reward`. When `environments.<ENV>.adapters.ads` is `fake` and the
 * server has no fake adapter override, the module gets a fake adapter made here.
 */
export function create_ads_reward_dev(ads_reward: AdsReward): AdsRewardDev {
  ads_reward.use_fake_adapter(create_fake_adapter);
  return {
    FakeAdCallback: (ctx, request) => {
      const result = ads_reward.fake_callback(ctx, request.notify_id);
      return result === 'OK' ? new CoreCheatContract.FakeAdCallbackResponse() : result;
    },
  };
}
