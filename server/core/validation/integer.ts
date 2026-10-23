/**
 * Integer helpers that give the same numbers as client `UtilCore`: floor division, floor modulo and permille, on
 * int64 values and on big integers.
 */

const INT64_MIN = -(1n << 63n);
const INT64_MAX = (1n << 63n) - 1n;

/** The result of `apply_permille`: `success` is false when the product is outside int64, and `value` is then 0. */
export interface PermilleResult {
  readonly success: boolean;
  readonly value: bigint;
}

/** `a ÷ b` rounded toward negative infinity. `b` is not 0. */
function floorQuotient(a: bigint, b: bigint): bigint {
  const q = a / b;
  return a % b !== 0n && a < 0n !== b < 0n ? q - 1n : q;
}

/** `a ÷ b` rounded toward negative infinity; 0 when `b` ≤ 0. */
export function floor_div(a: bigint, b: bigint): bigint {
  return b <= 0n ? 0n : floorQuotient(a, b);
}

/** `a − b × floor_div(a, b)`, 0 or more and less than `b`; 0 when `b` ≤ 0. */
export function floor_mod(a: bigint, b: bigint): bigint {
  return b <= 0n ? 0n : a - b * floorQuotient(a, b);
}

/** `floor_div(value × permille, 1000)`; (`false`, 0) when `value × permille` is outside int64. */
export function apply_permille(value: bigint, permille: bigint): PermilleResult {
  const product = value * permille;
  if (product < INT64_MIN || product > INT64_MAX) return { success: false, value: 0n };
  return { success: true, value: floorQuotient(product, 1000n) };
}

/** `a ÷ b` rounded toward negative infinity with no range limit; null when `b` ≤ 0. */
export function big_floor_div(a: bigint, b: bigint): bigint | null {
  return b <= 0n ? null : floorQuotient(a, b);
}

/** `big_floor_div(value × permille, 1000)` with no range limit. */
export function big_apply_permille(value: bigint, permille: bigint): bigint {
  return floorQuotient(value * permille, 1000n);
}
