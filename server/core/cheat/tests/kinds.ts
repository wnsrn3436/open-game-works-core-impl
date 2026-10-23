/**
 * Content kinds of a test game contract: the core test data has no game contract, so these classes take the place of
 * the contract tool's kind classes. They have the generated class methods `encode`, `decode`, `to_json` and
 * `from_json`; `from_json` reads proto3 JSON (proto or lowerCamel names, `int64` as a decimal string or number) and,
 * like the generated code, ignores unknown keys. The stored bytes are canonical JSON, which only these tests read.
 */
import * as CoreContract from '../../../generated/contract/core_contract.ts';
import type { StorageContract } from '../../storage/kinds.ts';

type FieldType = 'int32' | 'int64' | 'string' | (() => JsonClass);
type Fields = readonly (readonly [string, FieldType])[];

interface JsonClass {
  new (): object;
  from_json(json: unknown): object | null;
}

const INT64_MIN = -(1n << 63n);
const INT64_MAX = (1n << 63n) - 1n;

function camel(name: string): string {
  return name.replace(/_([a-z0-9])/g, (_m: string, ch: string) => ch.toUpperCase());
}

function read_int64(raw: unknown): bigint | undefined {
  const value = typeof raw === 'number' && Number.isSafeInteger(raw) ? BigInt(raw) : typeof raw === 'string' && /^-?[0-9]+$/.test(raw) ? BigInt(raw) : null;
  return value !== null && value >= INT64_MIN && value <= INT64_MAX ? value : undefined;
}

function read_field(type: FieldType, raw: unknown): unknown {
  if (type === 'string') return typeof raw === 'string' ? raw : undefined;
  if (type === 'int32') return typeof raw === 'number' && Number.isInteger(raw) && raw >= -(2 ** 31) && raw < 2 ** 31 ? raw : undefined;
  if (type === 'int64') return read_int64(raw);
  return type().from_json(raw) ?? undefined;
}

function from_json<T extends object>(json: unknown, fields: Fields, create: () => T): T | null {
  if (typeof json !== 'object' || json === null || Array.isArray(json)) return null;
  const record = json as Record<string, unknown>;
  const message = create() as Record<string, unknown>;
  for (const [name, type] of fields) {
    const key = Object.hasOwn(record, name) ? name : camel(name);
    const raw = record[key];
    if (raw === undefined || raw === null) continue;
    const value = read_field(type, raw);
    if (value === undefined) return null;
    message[name] = value;
  }
  return message as T;
}

function to_json(message: object, fields: Fields): unknown {
  const record = message as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const [name, type] of fields) {
    const value = record[name];
    if (value === null || value === 0 || value === 0n || value === '') continue;
    out[name] = typeof value === 'bigint' ? String(value) : typeof type === 'function' ? (value as { to_json(): unknown }).to_json() : value;
  }
  return out;
}

function encode(message: object, fields: Fields): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(to_json(message, fields)));
}

function decode<T extends object>(bytes: Uint8Array, fields: Fields, create: () => T): T | null {
  try {
    return from_json(JSON.parse(new TextDecoder().decode(bytes)), fields, create);
  } catch {
    return null;
  }
}

const BADGE: Fields = [
  ['rank', 'int32'],
  ['label', 'string'],
];

/** A message field type of `ProfileUserState`. */
export class Badge {
  rank = 0;
  label = '';

  encode(): Uint8Array {
    return encode(this, BADGE);
  }

  static decode(bytes: Uint8Array): Badge | null {
    return decode(bytes, BADGE, () => new Badge());
  }

  to_json(): unknown {
    return to_json(this, BADGE);
  }

  static from_json(json: unknown): Badge | null {
    return from_json(json, BADGE, () => new Badge());
  }
}

const PROFILE: Fields = [
  ['level', 'int32'],
  ['title', 'string'],
  ['best_score', 'int64'],
  ['badge', () => Badge],
];

/** A single UserState kind. */
export class ProfileUserState {
  level = 0;
  title = '';
  best_score = 0n;
  badge: Badge | null = null;

  encode(): Uint8Array {
    return encode(this, PROFILE);
  }

  static decode(bytes: Uint8Array): ProfileUserState | null {
    return decode(bytes, PROFILE, () => new ProfileUserState());
  }

  to_json(): unknown {
    return to_json(this, PROFILE);
  }

  static from_json(json: unknown): ProfileUserState | null {
    return from_json(json, PROFILE, () => new ProfileUserState());
  }
}

const HERO: Fields = [
  ['id', 'int64'],
  ['power', 'int32'],
  ['weapon_id', 'int32'],
];

/** A list UserState kind. */
export class HeroUserState {
  id = 0n;
  power = 0;
  weapon_id = 0;

  encode(): Uint8Array {
    return encode(this, HERO);
  }

  static decode(bytes: Uint8Array): HeroUserState | null {
    return decode(bytes, HERO, () => new HeroUserState());
  }

  to_json(): unknown {
    return to_json(this, HERO);
  }

  static from_json(json: unknown): HeroUserState | null {
    return from_json(json, HERO, () => new HeroUserState());
  }
}

const WALLET: Fields = [['coins', 'int64']];

/** A single server state kind. */
export class WalletServerState {
  coins = 0n;

  encode(): Uint8Array {
    return encode(this, WALLET);
  }

  static decode(bytes: Uint8Array): WalletServerState | null {
    return decode(bytes, WALLET, () => new WalletServerState());
  }

  to_json(): unknown {
    return to_json(this, WALLET);
  }

  static from_json(json: unknown): WalletServerState | null {
    return from_json(json, WALLET, () => new WalletServerState());
  }
}

export const GAME_KINDS: readonly CoreContract.KindInfo[] = [
  { name: 'ProfileUserState', kind_class: ProfileUserState, store: 'user_state', column: 'profile_user_state', is_list: false, is_public: false },
  { name: 'HeroUserState', kind_class: HeroUserState, store: 'user_state', column: 'hero_user_state', is_list: true, is_public: false },
  { name: 'WalletServerState', kind_class: WalletServerState, store: 'server_state', column: 'wallet_server_state', is_list: false, is_public: false },
];

export const STORAGE_CONTRACT: StorageContract = { core_kinds: CoreContract.KINDS, game_kinds: GAME_KINDS, contract_version: 1 };

export function profile(level: number, title: string): ProfileUserState {
  const p = new ProfileUserState();
  p.level = level;
  p.title = title;
  return p;
}

export function hero(id: bigint, power: number): HeroUserState {
  const h = new HeroUserState();
  h.id = id;
  h.power = power;
  return h;
}
