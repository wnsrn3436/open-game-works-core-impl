import type { GameUpdate } from '../index.ts';
import { create_fake_adapter } from './adapters/fake.ts';

export { create_fake_adapter } from './adapters/fake.ts';
export type { FakeCdnCall, FakeCdnController, FakeFailure } from './adapters/fake.ts';

/** `game-update` has no `## DEV` operation. */
export type GameUpdateDev = Record<string, never>;

/**
 * The DEV code of the server instance's `game-update`: adapter name `fake` makes a fake `cdn` adapter when the server
 * instance gives none. Called before `begin_start`.
 */
export function create_game_update_dev(game_update: GameUpdate): GameUpdateDev {
  game_update.include_dev_code({ create_fake_cdn: () => create_fake_adapter('cdn').adapter });
  return {};
}
