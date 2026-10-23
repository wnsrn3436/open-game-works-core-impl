/**
 * PCG32 random (`UtilCore` `### PCG32 algorithm`): the same sequence for the same seed and calls on every engine and
 * on the server.
 */

const MASK64 = (1n << 64n) - 1n;
const MASK32 = (1n << 32n) - 1n;
const MULTIPLIER = 6364136223846793005n;
const INCREMENT = 1n;
const FNV_OFFSET = 14695981039346656037n;
const FNV_PRIME = 1099511628211n;
const TWO_32 = 1n << 32n;

/** A random instance: one PCG32 sequence. */
export class Random {
  private state = 0n;

  constructor(seed: bigint) {
    this.step();
    this.state = (this.state + BigInt.asUintN(64, seed)) & MASK64;
    this.step();
  }

  step(): number {
    const old = this.state;
    this.state = (old * MULTIPLIER + INCREMENT) & MASK64;
    const x = (((old >> 18n) ^ old) >> 27n) & MASK32;
    const r = old >> 59n;
    return Number(((x >> r) | (x << ((32n - r) % 32n))) & MASK32);
  }

  /** 0 <= result < b, for 1 <= b <= 2^32. */
  bounded(b: bigint): bigint {
    const t = (TWO_32 - b) % b;
    for (;;) {
      const v = BigInt(this.step());
      if (v >= t) return v % b;
    }
  }
}

/** The random input error of `random_int`, `random_weighted` and `random_shuffle`: a misuse, thrown. */
export class RandomInputError extends RangeError {}

export function random_int(random: Random, min: bigint, max: bigint): bigint {
  if (min > max) throw new RandomInputError(`random_int: min ${String(min)} > max ${String(max)}`);
  if (max - min >= TWO_32) throw new RandomInputError(`random_int: max - min ${String(max - min)} is 2^32 or more`);
  return min + random.bounded(max - min + 1n);
}

export function random_weighted(random: Random, weights: readonly (bigint | number)[]): number {
  if (weights.length === 0) throw new RandomInputError('random_weighted: no weights');
  const values = weights.map((w) => {
    if (typeof w === 'number' && !Number.isSafeInteger(w)) throw new RandomInputError(`random_weighted: weight ${String(w)} is not an integer`);
    const v = BigInt(w);
    if (v < 0n) throw new RandomInputError(`random_weighted: weight ${String(v)} is negative`);
    return v;
  });
  const sum = values.reduce((a, b) => a + b, 0n);
  if (sum === 0n) throw new RandomInputError('random_weighted: the weights sum to 0');
  if (sum > TWO_32) throw new RandomInputError(`random_weighted: the weights sum to ${String(sum)}, over 2^32`);
  const v = random.bounded(sum);
  let acc = 0n;
  for (const [i, w] of values.entries()) {
    acc += w;
    if (v < acc) return i;
  }
  return values.length - 1;
}

export function random_shuffle(random: Random, n: number, max_count: number): number[] {
  if (!Number.isSafeInteger(n) || n < 0 || n > max_count) throw new RandomInputError(`random_shuffle: n ${String(n)} is not in [0, ${String(max_count)}]`);
  const buf = Array.from({ length: n }, (_, i) => i);
  for (let i = n - 1; i >= 1; i -= 1) {
    const j = Number(random.bounded(BigInt(i + 1)));
    const a = buf[i] as number;
    buf[i] = buf[j] as number;
    buf[j] = a;
  }
  return buf;
}

export function make_purpose_seed(name: string, base: bigint): bigint {
  let h = FNV_OFFSET;
  for (const c of new TextEncoder().encode(name)) h = ((h ^ BigInt(c)) * FNV_PRIME) & MASK64;
  return BigInt.asIntN(64, h ^ BigInt.asUintN(64, base));
}
