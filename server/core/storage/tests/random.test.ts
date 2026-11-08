import * as CoreContract from '../../../generated/contract/core_contract.ts';
import { StorageMisuse } from '../index.ts';
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

  it('a seed provider receives, for a core/Resync request of user U, its request ID, U and core/Resync, and the seed of that ctx is the value it returned', async () => {
    const calls: [string, bigint, string][] = [];
    const { storage } = await instance({
      seed: (request_id, user_id, request_name) => {
        calls.push([request_id, user_id, request_name]);
        return 777n;
      },
    });
    const user = await new_user(storage);
    const seed = await storage.run_request_transaction(user, { ...fields('resync-1'), request_name: 'core/Resync' }, (ctx) => ctx.seed);
    expect(seed).toBe(777n);
    expect(calls).toEqual([['resync-1', user, 'core/Resync']]);
  });

  it('a seed provider is called once per request transaction, not for one that is WITHDRAWN, nor for run_user_transaction and run_rollback_transaction', async () => {
    const calls: string[] = [];
    const { storage } = await instance({
      seed: (request_id) => {
        calls.push(request_id);
        return null;
      },
    });
    const user = await new_user(storage);
    const seed = await storage.run_request_transaction(user, fields('a'), (ctx) => ctx.seed);
    expect(typeof seed).toBe('bigint');
    expect(await storage.run_request_transaction(user + 1n, fields('withdrawn'), () => 'ran')).toBe('WITHDRAWN');
    expect(await storage.run_user_transaction(user, () => 'pass')).toBe('COMMITTED');
    await storage.run_rollback_transaction(user, () => 'ran');
    expect(calls).toEqual(['a']);
  });

  it('make_seed: without a seed provider, 1000 calls give 1000 different values', async () => {
    const { storage } = await instance();
    const values = new Set(Array.from({ length: 1000 }, () => storage.make_seed('match')));
    expect(values.size).toBe(1000);
    for (const value of values) {
      expect(value >= -(2n ** 63n) && value < 2n ** 63n).toBe(true);
    }
  });

  it('make_seed: a provider that returns the number of its earlier calls with the same user ID and request name gives 0, 0 and 1 for match, room and match; it gets user ID 0 and an empty request ID, and a request in between does not change them', async () => {
    const counts = new Map<string, bigint>();
    const calls: [string, bigint, string][] = [];
    const { storage } = await instance({
      seed: (request_id, user_id, request_name) => {
        calls.push([request_id, user_id, request_name]);
        const key = `${String(user_id)} ${request_name}`;
        const count = counts.get(key) ?? 0n;
        counts.set(key, count + 1n);
        return count;
      },
    });
    const user = await new_user(storage);
    const first = storage.make_seed('match');
    expect(await storage.run_request_transaction(user, { ...fields('between'), request_name: 'match' }, (ctx) => ctx.seed)).toBe(0n);
    const room = storage.make_seed('room');
    const second = storage.make_seed('match');
    expect([first, room, second]).toEqual([0n, 0n, 1n]);
    expect(calls.filter((c) => c[1] === 0n)).toEqual([
      ['', 0n, 'match'],
      ['', 0n, 'room'],
      ['', 0n, 'match'],
    ]);
  });

  it('make_seed: with a provider that returns none, a secure random value; Match, 1match and the empty string throw', async () => {
    const { storage } = await instance({ seed: () => null });
    const values = new Set(Array.from({ length: 100 }, () => storage.make_seed('match')));
    expect(values.size).toBe(100);
    for (const bad of ['Match', '1match', '', 'match-1']) {
      expect(() => storage.make_seed(bad), bad).toThrow(StorageMisuse);
    }
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
