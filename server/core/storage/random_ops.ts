/** The random operations of `storage` on a ctx random or a random instance (`storage` `## API`). */
import { StorageMisuse, user_state_of, type StorageCore } from './core.ts';
import { make_purpose_seed, Random, random_int, random_shuffle, random_weighted } from './random.ts';
import type { RequestCtx } from './request_ctx.ts';

/** A ctx (its transaction's random) or a random instance from `create_random`. */
export type RandomSource = RequestCtx | Random;

function random_of(core: StorageCore, source: unknown): Random {
  if (source instanceof Random) return source;
  const random = user_state_of(core, source).random;
  if (random === null) throw new StorageMisuse('storage: the ctx has no random');
  return random;
}

export function create_random_instance(seed: bigint): Random {
  if (typeof seed !== 'bigint') throw new StorageMisuse('storage: the seed is not a bigint');
  return new Random(seed);
}

export function random_api(core: StorageCore): {
  random_u32(source: RandomSource): number;
  random_int(source: RandomSource, min: bigint, max: bigint): bigint;
  random_weighted(source: RandomSource, weights: readonly (bigint | number)[]): number;
  random_shuffle(source: RandomSource, n: number): number[];
  make_purpose_seed(name: string, base: bigint): bigint;
} {
  return {
    random_u32: (source) => random_of(core, source).step(),
    random_int: (source, min, max) => random_int(random_of(core, source), min, max),
    random_weighted: (source, weights) => random_weighted(random_of(core, source), weights),
    random_shuffle: (source, n) => random_shuffle(random_of(core, source), n, core.settings.max_shuffle_count),
    make_purpose_seed: (name, base) => make_purpose_seed(name, base),
  };
}
