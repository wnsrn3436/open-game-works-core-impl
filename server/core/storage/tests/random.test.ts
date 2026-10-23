import * as CoreContract from '../../../generated/contract/core_contract.ts';
import { core_settings, fields, instance, new_user, stop_all } from './helpers.ts';

afterEach(() => {
  stop_all();
});

/** `UtilCore` `## test` vectors. */
const U32_42 = [565663470, 3244226384, 2504567229, 903561869, 4026996297, 2722332799];
const U32_MINUS_42 = [2135434507, 1425494533, 1059454827, 1281541498, 243802185, 3332889050];
const U32_MIN = [1191765185, 1695953820, 3015401034];
const RANGE_1_6 = [1n, 3n, 4n, 6n, 4n, 2n, 3n, 3n, 3n, 3n];
const RANGE_INT32 = [-1581820178n, 1096742736n, 357083581n];
const SHUFFLE_10 = [1, 6, 7, 8, 4, 3, 9, 5, 2, 0];
const WEIGHTED = [0, 3, 3, 3, 3, 3, 3, 0, 3, 2];

describe('random', () => {
  it('random instances give the UtilCore test vectors', async () => {
    const { storage } = await instance();
    const r42 = storage.create_random(42n);
    expect(U32_42.map(() => storage.random_u32(r42))).toEqual(U32_42);
    const rm42 = storage.create_random(-42n);
    expect(U32_MINUS_42.map(() => storage.random_u32(rm42))).toEqual(U32_MINUS_42);
    const rmin = storage.create_random(-(2n ** 63n));
    expect(U32_MIN.map(() => storage.random_u32(rmin))).toEqual(U32_MIN);
    const range = storage.create_random(42n);
    expect(RANGE_1_6.map(() => storage.random_int(range, 1n, 6n))).toEqual(RANGE_1_6);
    const wide = storage.create_random(42n);
    expect(RANGE_INT32.map(() => storage.random_int(wide, -2147483648n, 2147483647n))).toEqual(RANGE_INT32);
    expect(storage.random_shuffle(storage.create_random(42n), 10)).toEqual(SHUFFLE_10);
    const weighted = storage.create_random(42n);
    expect(WEIGHTED.map(() => storage.random_weighted(weighted, [1, 0, 3, 6]))).toEqual(WEIGHTED);
    expect(storage.make_purpose_seed('battle_effect', 1700000000000n)).toBe(1464768381546528617n);
    expect(storage.make_purpose_seed('a', 0n)).toBe(-5808556873153909620n);
  });

  it('a ctx random with the same seed gives the same sequence as a random instance of that seed', async () => {
    const seeds = new Map([
      ['first', 42n],
      ['second', 42n],
    ]);
    const { storage } = await instance({ seed: (request_id) => seeds.get(request_id) ?? null });
    const user = await new_user(storage);
    const draw = (id: string): Promise<unknown> =>
      storage.run_request_transaction(user, fields(id), (ctx) => ({ seed: ctx.seed, values: U32_42.map(() => storage.random_u32(ctx)) }));
    const [a, b] = await Promise.all([draw('first'), draw('second')]);
    expect(a).toEqual({ seed: 42n, values: U32_42 });
    expect(b).toEqual(a);
    const other = (await draw('other')) as { seed: bigint };
    expect(typeof other.seed).toBe('bigint');
  });

  it('throws on random input violations', async () => {
    const { storage } = await instance();
    const r = storage.create_random(1n);
    const max = Number(core_settings()['storage.maxShuffleCount']);
    const bad: (() => unknown)[] = [
      () => storage.random_int(r, 2n, 1n),
      () => storage.random_int(r, 0n, 2n ** 32n),
      () => storage.random_weighted(r, []),
      () => storage.random_weighted(r, [1, -1]),
      () => storage.random_weighted(r, [1.5]),
      () => storage.random_weighted(r, [0, 0]),
      () => storage.random_weighted(r, [2n ** 32n, 1n]),
      () => storage.random_shuffle(r, -1),
      () => storage.random_shuffle(r, max + 1),
    ];
    for (const call of bad) expect(call).toThrow();
    expect(storage.random_int(r, 0n, 2n ** 32n - 1n)).toBeGreaterThanOrEqual(0n);
    expect(storage.random_weighted(r, [2n ** 32n])).toBe(0);
    expect(storage.random_shuffle(r, max)).toHaveLength(max);
  });
});

describe('with_hook_change_source', () => {
  it('sets the ctx hook_change_source to the given value, the outer value after an inner scope, and none after all', async () => {
    const { storage } = await instance();
    const user = await new_user(storage);
    const MAIL = CoreContract.ItemChangeSource.ITEM_CHANGE_SOURCE_MAIL;
    const SHOP = CoreContract.ItemChangeSource.ITEM_CHANGE_SOURCE_SHOP;
    const seen = await storage.run_request_transaction(user, fields('h'), (ctx) => {
      const out: unknown[] = [ctx.hook_change_source];
      storage.with_hook_change_source(ctx, MAIL, 'outer', () => {
        out.push(ctx.hook_change_source);
        storage.with_hook_change_source(ctx, SHOP, 'inner', () => {
          out.push(ctx.hook_change_source);
        });
        out.push(ctx.hook_change_source);
      });
      out.push(ctx.hook_change_source);
      try {
        storage.with_hook_change_source(ctx, SHOP, 'thrown', () => {
          throw new Error('hook failure');
        });
      } catch {
        out.push(ctx.hook_change_source);
      }
      return out;
    });
    expect(seen).toEqual([null, { source: MAIL, ref: 'outer' }, { source: SHOP, ref: 'inner' }, { source: MAIL, ref: 'outer' }, null, null]);
  });
});
