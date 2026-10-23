/**
 * Kinds of a test game contract: the core test data has no game contract, so these classes take the place of the
 * contract tool's kind classes (int64 fields only, proto3 wire format).
 */
import * as CoreContract from '../../../generated/contract/core_contract.ts';
import type { StorageContract } from '../kinds.ts';

type Fields = readonly (readonly [number, string])[];

function varint(value: bigint, out: number[]): void {
  let v = BigInt.asUintN(64, value);
  while (v >= 0x80n) {
    out.push(Number((v & 0x7fn) | 0x80n));
    v >>= 7n;
  }
  out.push(Number(v));
}

function encode(message: Record<string, bigint>, fields: Fields): Uint8Array {
  const out: number[] = [];
  for (const [no, name] of fields) {
    const value = message[name] ?? 0n;
    if (value === 0n) continue;
    varint(BigInt(no << 3), out);
    varint(value, out);
  }
  return Uint8Array.from(out);
}

function decode(bytes: Uint8Array, fields: Fields, target: Record<string, bigint>): boolean {
  let i = 0;
  const next = (): bigint | null => {
    let result = 0n;
    for (let shift = 0n; shift < 70n; shift += 7n) {
      const b = bytes[i];
      if (b === undefined) return null;
      i += 1;
      result |= BigInt(b & 0x7f) << shift;
      if ((b & 0x80) === 0) return result;
    }
    return null;
  };
  while (i < bytes.length) {
    const tag = next();
    if (tag === null || (tag & 7n) !== 0n) return false;
    const value = next();
    const field = fields.find(([no]) => BigInt(no) === tag >> 3n);
    if (value === null || field === undefined) return false;
    target[field[1]] = BigInt.asIntN(64, value);
  }
  return true;
}

const QUEST: Fields = [
  [1, 'id'],
  [2, 'progress'],
];
const PROFILE: Fields = [[1, 'level']];
const DECK: Fields = [
  [1, 'id'],
  [2, 'power'],
];
const WALLET: Fields = [[1, 'coins']];
const BOSS: Fields = [
  [1, 'key'],
  [2, 'hp'],
];

/** A list kind. */
export class QuestUserState {
  id = 0n;
  progress = 0n;

  encode(): Uint8Array {
    return encode(this as unknown as Record<string, bigint>, QUEST);
  }

  static decode(bytes: Uint8Array): QuestUserState | null {
    const m = new QuestUserState();
    return decode(bytes, QUEST, m as unknown as Record<string, bigint>) ? m : null;
  }
}

/** A public single kind. */
export class ProfileUserState {
  level = 0n;

  encode(): Uint8Array {
    return encode(this as unknown as Record<string, bigint>, PROFILE);
  }

  static decode(bytes: Uint8Array): ProfileUserState | null {
    const m = new ProfileUserState();
    return decode(bytes, PROFILE, m as unknown as Record<string, bigint>) ? m : null;
  }
}

/** A public list kind. */
export class DeckUserState {
  id = 0n;
  power = 0n;

  encode(): Uint8Array {
    return encode(this as unknown as Record<string, bigint>, DECK);
  }

  static decode(bytes: Uint8Array): DeckUserState | null {
    const m = new DeckUserState();
    return decode(bytes, DECK, m as unknown as Record<string, bigint>) ? m : null;
  }
}

/** A single server state kind. */
export class WalletServerState {
  coins = 0n;

  encode(): Uint8Array {
    return encode(this as unknown as Record<string, bigint>, WALLET);
  }

  static decode(bytes: Uint8Array): WalletServerState | null {
    const m = new WalletServerState();
    return decode(bytes, WALLET, m as unknown as Record<string, bigint>) ? m : null;
  }
}

/** A game state kind. */
export class BossGameState {
  key = 0n;
  hp = 0n;

  encode(): Uint8Array {
    return encode(this as unknown as Record<string, bigint>, BOSS);
  }

  static decode(bytes: Uint8Array): BossGameState | null {
    const m = new BossGameState();
    return decode(bytes, BOSS, m as unknown as Record<string, bigint>) ? m : null;
  }
}

/** The test contract version: versions 1 and 2 are lower, 4 is higher. */
export const TEST_CONTRACT_VERSION = 3;

export const TEST_CONTRACT: StorageContract = {
  core_kinds: CoreContract.KINDS,
  game_kinds: [
    { name: 'QuestUserState', kind_class: QuestUserState, store: 'user_state', column: 'quest_user_state', is_list: true, is_public: false },
    { name: 'ProfileUserState', kind_class: ProfileUserState, store: 'user_state', column: 'profile_user_state', is_list: false, is_public: true },
    { name: 'DeckUserState', kind_class: DeckUserState, store: 'user_state', column: 'deck_user_state', is_list: true, is_public: true },
    { name: 'WalletServerState', kind_class: WalletServerState, store: 'server_state', column: 'wallet_server_state', is_list: false, is_public: false },
    { name: 'BossGameState', kind_class: BossGameState, store: 'game_state', column: 'boss_game_state', is_list: false, is_public: false },
  ],
  contract_version: TEST_CONTRACT_VERSION,
};

export function quest(id: bigint, progress: bigint): QuestUserState {
  const q = new QuestUserState();
  q.id = id;
  q.progress = progress;
  return q;
}

export function profile(level: bigint): ProfileUserState {
  const p = new ProfileUserState();
  p.level = level;
  return p;
}

export function deck(id: bigint, power: bigint): DeckUserState {
  const d = new DeckUserState();
  d.id = id;
  d.power = power;
  return d;
}

export function wallet(coins: bigint): WalletServerState {
  const w = new WalletServerState();
  w.coins = coins;
  return w;
}

export function boss(key: bigint, hp: bigint): BossGameState {
  const b = new BossGameState();
  b.key = key;
  b.hp = hp;
  return b;
}
