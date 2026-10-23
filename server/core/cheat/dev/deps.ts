// The dependency modules of cheat and the contract lists it reads.
import type * as CoreContract from '../../../generated/contract/core_contract.ts';

export type { DbHandle, RequestCtx, Storage } from '../../storage/index.ts';
export type { ServerTime } from '../../server-time/index.ts';

/**
 * The contract lists cheat reads: the UserState kinds of the game contract and of the base proto, and the `service
 * Cheat` rpcs. `create_cheat` passes the generated contract code.
 */
export interface CheatContract {
  readonly game_kinds: readonly CoreContract.KindInfo[];
  readonly core_kinds: readonly CoreContract.KindInfo[];
  readonly game_cheat_rpcs: readonly CoreContract.RpcInfo[];
}
