import * as CoreContract from '../../../generated/contract/core_contract.ts';
import * as GameData from '../../../generated/data/game_data.ts';
import { create_server_time } from '../../server-time/index.ts';
import { storage_module } from '../../storage/tests/helpers.ts';
import * as testing from '../../testing/dev/index.ts';
import { DAY_MS, E, JAN_16, JAN_17, START_AT, buy, data, id, purchase_row, run, set_balance, set_offer, start, stop_all, user, type TestServer, type TestSession } from './helpers.ts';

/** `server-time` with the core test data's `dailyResetOffsetMs` (the game settings default 0), for expected reset times. */
const time = create_server_time({ settings: { 'server-time.silentMarginMs': 0, dailyResetOffsetMs: 0 }, modules: {} });

afterEach(async () => {
  await stop_all();
});

describe('purchase limit', () => {
  it('answers SHOP_LIMIT_REACHED at limit_count and sells again after the reset time', async () => {
    const server = await start();
    const session = await user(server);
    await set_balance(server, session, '[shop_gold]', 1000n);
    expect((await buy(session, '[shop_daily]')).code).toBe(0);
    expect((await buy(session, '[shop_daily]')).code).toBe(E.CORE_ERROR_SHOP_LIMIT_REACHED);
    const reset_at = (await purchase_row(server, session, '[shop_daily]'))?.reset_at ?? 0n;
    expect(reset_at).toBe(JAN_16);
    testing.set_time(server, reset_at);
    expect((await buy(session, '[shop_daily]')).code).toBe(0);
  });

  it('keeps the count of a product without offer and reset: the second purchase is SHOP_LIMIT_REACHED and the row has count 1 and reset_at 0', async () => {
    const server = await start();
    const session = await user(server);
    await set_balance(server, session, '[shop_gold]', 1000n);
    expect((await buy(session, '[shop_once]')).code).toBe(0);
    testing.advance_time(server, 400n * DAY_MS);
    expect((await buy(session, '[shop_once]')).code).toBe(E.CORE_ERROR_SHOP_LIMIT_REACHED);
    const row = await purchase_row(server, session, '[shop_once]');
    expect(row?.count).toBe(1);
    expect(row?.reset_at).toBe(0n);
  });

  it.each([
    ['[shop_daily]', GameData.ResetCycle.Daily],
    ['[shop_weekly]', GameData.ResetCycle.Weekly],
    ['[shop_monthly]', GameData.ResetCycle.Monthly],
  ] as const)('writes reset_at of the first %s purchase as get_next_reset of the request time and resets the count at it', async (product, cycle) => {
    const counts: number[] = [];
    const server = await start({
      validate_shop_purchase: (ctx, product_id, _quantity, core) => {
        // The count of the current limit period as the purchase request reads it, before step 9 changes it.
        counts.push(core.shop.get_purchase_count(ctx, product_id));
        return 'pass';
      },
    });
    const session = await user(server);
    await set_balance(server, session, '[shop_gold]', 1000n);
    expect((await buy(session, product)).code).toBe(0);
    const reset_at = (await purchase_row(server, session, product))?.reset_at ?? 0n;
    expect(reset_at).toBe(time.get_next_reset(cycle, START_AT));
    testing.set_time(server, reset_at - 1n);
    expect((await buy(session, product)).code).toBe(E.CORE_ERROR_SHOP_LIMIT_REACHED);
    testing.set_time(server, reset_at);
    expect((await buy(session, product)).code).toBe(0);
    const next = await purchase_row(server, session, product);
    expect(next?.count).toBe(1);
    expect(next?.reset_at).toBe(time.get_next_reset(cycle, reset_at));
    // validate_shop_purchase runs after the limit check, so only the two purchases that passed it read a count.
    expect(counts).toEqual([0, 0]);
  });

  it('counts 1 between the rounds of a repeated live event after a round 1 purchase, and sells again in round 2', async () => {
    const event_pack = id('[shop_event_pack]');
    const server = await start();
    const session = await user(server);
    await set_balance(server, session, '[shop_gold]', 1000n);
    expect((await buy(session, '[shop_event_pack]')).code).toBe(0);
    expect((await purchase_row(server, session, '[shop_event_pack]'))?.event_round).toBe(1);
    testing.set_time(server, JAN_16);
    expect(await run(server, session, (ctx, core) => core.shop.get_purchase_count(ctx, event_pack))).toBe(1);
    testing.set_time(server, JAN_17);
    expect(await run(server, session, (ctx, core) => core.shop.get_purchase_count(ctx, event_pack))).toBe(0);
    expect((await buy(session, '[shop_event_pack]')).code).toBe(0);
    const row = await purchase_row(server, session, '[shop_event_pack]');
    expect(row?.count).toBe(1);
    expect(row?.event_round).toBe(2);
  });
});

describe('purchase limit read', () => {
  /**
   * Checks that `get_purchase_count` is the `count` of `offer.read_purchase_limit` on the stored row and, when `bought`
   * is set, that a purchase writes `count` + 1 and its `write_reset_at`. Returns the read `count`.
   */
  async function check_read(server: TestServer, session: TestSession, product: string, bought: boolean): Promise<number> {
    const product_id = id(product);
    const row = data().ShopProductTable.get_row(product_id);
    const stored = await purchase_row(server, session, product);
    const [count, limit] = await run(server, session, (ctx, core) => [
      core.shop.get_purchase_count(ctx, product_id),
      core.offer.read_purchase_limit(
        ctx,
        row.offer,
        row.reset === GameData.ResetCycle.None ? null : row.reset,
        row.live_event,
        stored?.count ?? 0,
        stored?.reset_at ?? 0n,
        stored?.event_round ?? 0,
      ),
    ] as const);
    expect(count).toBe(limit.count);
    if (!bought) return count;
    expect((await buy(session, product)).code).toBe(0);
    const written = await purchase_row(server, session, product);
    expect(written?.count).toBe(limit.count + 1);
    expect(written?.reset_at).toBe(limit.write_reset_at);
    return count;
  }

  it('reads each purchase count row with offer.read_purchase_limit and writes its write_reset_at as reset_at', async () => {
    const server = await start();
    const session = await user(server);
    await set_balance(server, session, '[shop_gold]', 1000n);
    // [shop_offer] lasts 1h; [shop_event] round 1 is active at START_AT and round 2 starts at JAN_17.
    await set_offer(server, session, '[shop_offer]', START_AT, 1);
    for (const product of ['[shop_daily]', '[shop_once]', '[shop_event_pack]', '[shop_offer_pack]']) {
      expect(await check_read(server, session, product, true)).toBe(0);
    }
    testing.set_time(server, JAN_17);
    // The lazy reset of [shop_daily] and [shop_offer_pack] (at the offer end) and the round reset of [shop_event_pack]
    // read count 0; [shop_once] does not reset. The offer is off, so [shop_offer_pack] is not bought.
    expect(await check_read(server, session, '[shop_daily]', true)).toBe(0);
    expect(await check_read(server, session, '[shop_once]', false)).toBe(1);
    expect(await check_read(server, session, '[shop_event_pack]', true)).toBe(0);
    expect(await check_read(server, session, '[shop_offer_pack]', false)).toBe(0);
    // Turning the offer on again moves its end time: the offer purchase reset reads count 0.
    await set_offer(server, session, '[shop_offer]', JAN_17, 2);
    expect(await check_read(server, session, '[shop_offer_pack]', true)).toBe(0);
  });
});

describe('purchase count bounds', () => {
  it('keeps count at 2^31−1 when a purchase would raise it past 2^31−1', async () => {
    const int32_max = 2 ** 31 - 1;
    const server = await start();
    const session = await user(server);
    expect((await buy(session, '[shop_max_count]', int32_max)).code).toBe(0);
    expect((await purchase_row(server, session, '[shop_max_count]'))?.count).toBe(int32_max);
    expect((await buy(session, '[shop_max_count]', 1)).code).toBe(0);
    expect((await purchase_row(server, session, '[shop_max_count]'))?.count).toBe(int32_max);
  });

  it('answers 0 from get_purchase_count for a product ID value that is not in shop_product, also with a stored row for it', async () => {
    const unknown = 999_999;
    const server = await start();
    const session = await user(server);
    const storage = storage_module(server);
    expect(data().ShopProductTable.has_row(unknown)).toBe(false);
    expect(await run(server, session, (ctx, core) => core.shop.get_purchase_count(ctx, unknown))).toBe(0);
    // A row the module wrote while the product was in the data.
    await run(server, session, (ctx) => {
      const state = new CoreContract.ShopPurchaseUserState();
      state.id = BigInt(unknown);
      state.count = 3;
      storage.put_core_state(ctx, state);
    });
    const read = await run(server, session, (ctx, core) => {
      const row = storage.get_state(ctx, CoreContract.ShopPurchaseUserState, BigInt(unknown)) as CoreContract.ShopPurchaseUserState | null;
      return [row?.count ?? null, core.shop.get_purchase_count(ctx, unknown)];
    });
    expect(read).toEqual([3, 0]);
  });
});
