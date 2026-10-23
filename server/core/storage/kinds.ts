import type * as CoreContract from '../../generated/contract/core_contract.ts';

/** A stored kind message: a generated kind class instance. */
export interface KindValue {
  encode(): Uint8Array;
}

/** A generated kind class: the kind identifier of the storage operations. */
export type KindClass = CoreContract.KindInfo['kind_class'];

/** One kind of the contract. `order` is the UserState delta kind order. */
export interface Kind {
  readonly info: CoreContract.KindInfo;
  readonly order: number;
  /** A base proto UserState kind (`base-proto.md` `## core UserState kind`). */
  readonly core: boolean;
}

/** The kinds and the contract version `storage` works with: the generated contract code of the server. */
export interface StorageContract {
  readonly core_kinds: readonly CoreContract.KindInfo[];
  readonly game_kinds: readonly CoreContract.KindInfo[];
  readonly contract_version: number;
}

/** Lookup of the contract kinds by class and by `kind` column value. */
export class KindRegistry {
  readonly version: bigint;
  private readonly by_class = new Map<unknown, Kind>();
  private readonly by_column = new Map<string, Kind>();

  constructor(contract: StorageContract) {
    this.version = BigInt(contract.contract_version);
    const all = [...contract.core_kinds.map((info) => ({ info, core: info.store === 'user_state' })), ...contract.game_kinds.map((info) => ({ info, core: false }))];
    for (const [order, { info, core }] of all.entries()) {
      const kind: Kind = { info, order, core };
      this.by_class.set(info.kind_class, kind);
      this.by_column.set(info.column, kind);
    }
  }

  of_class(kind_class: unknown): Kind | null {
    return this.by_class.get(kind_class) ?? null;
  }

  of_value(value: unknown): Kind | null {
    if (typeof value !== 'object' || value === null) return null;
    return this.of_class(value.constructor);
  }

  of_column(column: string): Kind | null {
    return this.by_column.get(column) ?? null;
  }

  user_state_kinds(): Kind[] {
    return [...this.by_class.values()].filter((k) => k.info.store === 'user_state');
  }
}

/** The item ID of a kind value: `id` of a list kind, `key` of a game state kind, 0 for a single kind. */
export function item_id_of(kind: Kind, value: KindValue): bigint {
  const field = kind.info.store === 'game_state' ? 'key' : kind.info.is_list ? 'id' : null;
  if (field === null) return 0n;
  const id = (value as unknown as Record<string, unknown>)[field];
  if (typeof id !== 'bigint') throw new TypeError(`storage: ${kind.info.name}.${field} is not an int64`);
  return id;
}

/** Decodes stored bytes of a kind; throws when the bytes are not that kind message. */
export function decode_kind(kind: Kind, bytes: Uint8Array): KindValue {
  const value = kind.info.kind_class.decode(bytes);
  if (value === null) throw new Error(`storage: stored ${kind.info.name} bytes are not a ${kind.info.name} message`);
  return value;
}

export function same_bytes(a: Uint8Array | null, b: Uint8Array | null): boolean {
  if (a === null || b === null) return a === b;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) if (a[i] !== b[i]) return false;
  return true;
}
