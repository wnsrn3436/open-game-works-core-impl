/** E of `### match outcome` 4: 1000 ÷ (1 + 10^((R_j − R_i) ÷ scale)) rounded to the nearest integer, 0.5 up. */
export function expected_score(rating_i: bigint, rating_j: bigint, scale: bigint): bigint {
  const e = 1000 / (1 + 10 ** (Number(rating_j - rating_i) / Number(scale)));
  return BigInt(Math.floor(e + 0.5));
}
