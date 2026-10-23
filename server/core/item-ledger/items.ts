/** Items of the `item` table and their kind tables, amounts and the big encoding pair. */
import * as CoreContract from '../../generated/contract/core_contract.ts';
import * as GameData from '../../generated/data/game_data.ts';

export const MAX_SAFE = 2n ** 53n - 1n;

export type ItemKind = 'plain' | 'recovery' | 'group' | 'timed' | 'big';

export interface ItemInfo {
  readonly id: number;
  readonly kind: ItemKind;
  readonly max_amount: bigint;
  readonly overflow: GameData.ItemOverflow;
  /** The largest amount of one `ItemAmount`: 10^`max_digits` − 1 for a big item, 2^53−1 for the others. */
  readonly amount_limit: bigint;
  /** The largest balance: 10^`max_digits` − 1 for a big item, `max_amount` for the others. */
  readonly balance_limit: bigint;
  readonly recovery: GameData.ItemRecoveryRow | null;
  readonly group: GameData.ItemGroupRow | null;
  readonly timed: GameData.ItemTimedRow | null;
  /** `convert_to` of the `item_overflow` row for a `Convert` item; empty for the others. */
  readonly convert_to: readonly CoreContract.ItemAmount[];
}

/** The item of an ID value, or null when the `item` table has no such row. */
export function item_info(data: GameData.DataSet, id: number): ItemInfo | null {
  if (!data.ItemTable.has_row(id)) return null;
  const row = data.ItemTable.get_row(id);
  const recovery = data.ItemRecoveryTable.has_row(id) ? data.ItemRecoveryTable.get_row(id) : null;
  const group = data.ItemGroupTable.has_row(id) ? data.ItemGroupTable.get_row(id) : null;
  const timed = data.ItemTimedTable.has_row(id) ? data.ItemTimedTable.get_row(id) : null;
  const big = data.ItemBigTable.has_row(id) ? data.ItemBigTable.get_row(id) : null;
  const kind: ItemKind = recovery ? 'recovery' : group ? 'group' : timed ? 'timed' : big ? 'big' : 'plain';
  const big_limit = big ? 10n ** BigInt(big.max_digits) - 1n : 0n;
  const convert_to = row.overflow === GameData.ItemOverflow.Convert && data.ItemOverflowTable.has_row(id) ? data.ItemOverflowTable.get_row(id).convert_to : [];
  return {
    id, kind, max_amount: row.max_amount, overflow: row.overflow,
    amount_limit: big ? big_limit : MAX_SAFE,
    balance_limit: big ? big_limit : row.max_amount,
    recovery, group, timed, convert_to,
  };
}

const BIG_INTEGER = /^(0|-?[1-9][0-9]*)$/;

/** The value of a contract big encoding pair; null when the big field is neither empty nor a big integer. */
export function read_big(small: bigint, big: string): bigint | null {
  if (big === '') return small;
  return BIG_INTEGER.test(big) ? BigInt(big) : null;
}

/** A value as a contract big encoding pair. */
export function write_big(v: bigint): { small: bigint; big: string } {
  return v <= MAX_SAFE && v >= -MAX_SAFE ? { small: v, big: '' } : { small: 0n, big: v.toString() };
}

/** The value of an `ItemAmount`; null when `big_amount` is not a big integer. */
export function amount_of(a: CoreContract.ItemAmount): bigint | null {
  return read_big(a.amount, a.big_amount);
}

export function min(a: bigint, b: bigint): bigint {
  return a < b ? a : b;
}

export function max(a: bigint, b: bigint): bigint {
  return a > b ? a : b;
}

/** ⌊a ÷ b⌋ for b > 0. */
export function floor_div(a: bigint, b: bigint): bigint {
  const q = a / b;
  return a % b !== 0n && a < 0n ? q - 1n : q;
}

/** ⌈a ÷ b⌉ for a ≥ 0, b > 0. */
export function ceil_div(a: bigint, b: bigint): bigint {
  return (a + b - 1n) / b;
}
