import * as CoreContract from '../../../generated/contract/core_contract.ts';
import * as CoreCheatContract from '../../../dev/generated/contract/core_cheat_contract.ts';
import type { RequestCtx } from '../../storage/index.ts';
import { MAX_COUNT, type ResetCounterModule } from '../index.ts';

/** The core cheat handler type of `SetResetCounter`. */
export type SetResetCounterHandler = (
  ctx: RequestCtx,
  request: CoreCheatContract.SetResetCounterRequest,
) => CoreCheatContract.SetResetCounterResponse | CoreContract.CoreError;

/** The `## DEV` operations of `reset-counter` for one server instance. */
export interface ResetCounterDev {
  /** Core cheat `core/cheat/SetResetCounter`; `routing`'s DEV code collects it. */
  SetResetCounter: SetResetCounterHandler;
}

/** The DEV operations of the server instance's `reset-counter`. */
export function create_reset_counter_dev(reset_counter: ResetCounterModule): ResetCounterDev {
  return {
    SetResetCounter(ctx, request) {
      // The field validator rejects these first; the handler checks again (`server-core` `## request`).
      if (request.count < 0n || request.count > MAX_COUNT) return CoreContract.CoreError.CORE_ERROR_INVALID_REQUEST;
      if (!reset_counter.write_count(ctx, request.counter_id, request.count)) return CoreContract.CoreError.CORE_ERROR_INVALID_REQUEST;
      return new CoreCheatContract.SetResetCounterResponse();
    },
  };
}
