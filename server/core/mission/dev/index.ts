// The DEV code of mission: the core cheat SetMissionProgress.
import type * as CoreContract from '../../../generated/contract/core_contract.ts';
import * as CoreCheatContract from '../../../dev/generated/contract/core_cheat_contract.ts';
import type { RequestCtx } from '../deps.ts';
import type { Mission } from '../index.ts';

/** The `## DEV` operations of `mission`. */
export interface MissionDev {
  SetMissionProgress(ctx: RequestCtx, request: CoreCheatContract.SetMissionProgressRequest): CoreCheatContract.SetMissionProgressResponse | CoreContract.CoreError;
}

/** The DEV object of the server instance's `mission`. */
export function create_mission_dev(mission: Mission): MissionDev {
  return {
    SetMissionProgress: (ctx, request) => {
      const result = mission.set_progress(ctx, request.mission_id, request.progress, request.claimed);
      return result === 'pass' ? new CoreCheatContract.SetMissionProgressResponse() : result;
    },
  };
}
