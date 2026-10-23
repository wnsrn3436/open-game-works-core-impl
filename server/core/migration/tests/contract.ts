/**
 * The test contract: the test kinds of the `storage` core tests at contract version 3, with `(ogw.converters)`
 * entries for from versions 1 and 2 of `QuestUserState`, 2 of `DeckUserState` (so a version 1 deck skips 1), 1 of
 * `WalletServerState` and 1 of `BossGameState`. `ProfileUserState` has none.
 */
import { BossGameState, DeckUserState, QuestUserState, TEST_CONTRACT, TEST_CONTRACT_VERSION, WalletServerState } from '../../storage/tests/kinds.ts';
import type { Converter, MigrationContract } from '../index.ts';

export const CURRENT = BigInt(TEST_CONTRACT_VERSION);

export const CONVERTER_LIST: readonly { readonly kind: string; readonly from_version: number }[] = [
  { kind: 'QuestUserState', from_version: 1 },
  { kind: 'QuestUserState', from_version: 2 },
  { kind: 'DeckUserState', from_version: 2 },
  { kind: 'WalletServerState', from_version: 1 },
  { kind: 'BossGameState', from_version: 1 },
];

export const MIGRATION_CONTRACT: MigrationContract = {
  core_kinds: TEST_CONTRACT.core_kinds,
  game_kinds: TEST_CONTRACT.game_kinds,
  contract_version: TEST_CONTRACT_VERSION,
  converters: CONVERTER_LIST,
};

/**
 * The converters every test registers unless it replaces one: quest from 1 adds 10 to `progress` and from 2 doubles
 * it, deck from 2 adds 1000 to `power`, wallet from 1 adds 100 to `coins`, boss from 1 adds 7 to `hp`.
 */
export function default_converters(): Record<string, Converter> {
  return {
    'QuestUserState:1': (item) => {
      const q = item as QuestUserState;
      q.progress += 10n;
      return q;
    },
    'QuestUserState:2': (item) => {
      const q = item as QuestUserState;
      q.progress *= 2n;
      return q;
    },
    'DeckUserState:2': (item) => {
      const d = item as DeckUserState;
      d.power += 1000n;
      return d;
    },
    'WalletServerState:1': (item) => {
      const w = item as WalletServerState;
      w.coins += 100n;
      return w;
    },
    'BossGameState:1': (item) => {
      const b = item as BossGameState;
      b.hp += 7n;
      return b;
    },
  };
}
