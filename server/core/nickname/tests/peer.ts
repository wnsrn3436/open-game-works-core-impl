/**
 * The content `register` of a nickname peer process (`testing` `start_peer_process`): the core test defaults and a
 * `validate_item_change` hook that waits at gate `nickname-<user ID>` for the cost of a `SetNickname`. `SetNickname`
 * calls it in step 4, after the rules (step 2) and before the name registration (step 5).
 */
import * as CoreContract from '../../../generated/contract/core_contract.ts';
import type { RequestCtx } from '../../storage/index.ts';
import { core_test_register, type PeerRegister } from '../../testing/dev/index.ts';

interface Routing {
  register_hook(module: string, hook: string, fn: unknown): void;
}

export function cost_gate(user_id: bigint): string {
  return `nickname-${String(user_id)}`;
}

export const nickname_peer: PeerRegister = (peer) => (core) => {
  core_test_register(core);
  (core as unknown as { routing: Routing }).routing.register_hook('item-ledger', 'validate_item_change', (ctx: RequestCtx, source: { source: number }) => {
    if (source.source === CoreContract.ItemChangeSource.ITEM_CHANGE_SOURCE_NICKNAME) peer.wait(cost_gate(ctx.user_id));
    return 'pass';
  });
};
