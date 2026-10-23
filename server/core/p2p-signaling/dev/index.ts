import type { P2pSignaling } from '../index.ts';
import { create_fake_adapter } from './adapters/fake.ts';

export { create_fake_adapter } from './adapters/fake.ts';
export type { FakeTurnCall, FakeTurnController } from './adapters/fake.ts';

/** `p2p-signaling` has no `## DEV` operation. */
export type P2pSignalingDev = Record<string, never>;

/**
 * The DEV code of the server instance's `p2p-signaling`: adapter name `fake` makes a fake `turn` adapter when the
 * server instance gives none. Called before `begin_start`.
 */
export function create_p2p_signaling_dev(p2p_signaling: P2pSignaling): P2pSignalingDev {
  p2p_signaling.include_dev_code({ create_fake_turn: () => create_fake_adapter('turn').adapter });
  return {};
}
