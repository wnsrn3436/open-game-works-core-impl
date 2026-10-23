import { randomUUID } from 'node:crypto';
import * as CoreContract from '../../../generated/contract/core_contract.ts';
import * as testing from '../../testing/dev/index.ts';
import { E, MAX_SAFE, amount_in, balance, buy, delta_of, id, purchase_row, set_balance, shop_change, snapshot, start, stop_all, user } from './helpers.ts';

const SHOP = CoreContract.ItemChangeSource.ITEM_CHANGE_SOURCE_SHOP;

afterEach(async () => {
  await stop_all();
});

describe('purchase', () => {
  it('takes the cost, gives the reward and counts the purchase, all in the delta of one response with the Shop source', async () => {
    const server = await start();
    const session = await user(server);
    await set_balance(server, session, '[shop_gold]', 1000n);
    const { envelope, response, code } = await buy(session, '[shop_basic]');
    expect(code).toBe(0);
    expect(response?.mailed).toBe(false);
    expect(amount_in(response?.items ?? [], '[shop_gem]')).toBe(10n);
    expect(await balance(server, session, '[shop_gold]')).toBe(900n);
    expect(await balance(server, session, '[shop_gem]')).toBe(10n);
    expect((await purchase_row(server, session, '[shop_basic]'))?.count).toBe(1);
    const balances = delta_of(envelope, CoreContract.ItemBalanceUserState);
    expect(balances.find((e) => e.id === BigInt(id('[shop_gold]')))?.value?.amount).toBe(900n);
    expect(balances.find((e) => e.id === BigInt(id('[shop_gem]')))?.value?.amount).toBe(10n);
    expect(delta_of(envelope, CoreContract.ShopPurchaseUserState).map((e) => [e.id, e.value?.count])).toEqual([[BigInt(id('[shop_basic]')), 1]]);
    const gem = shop_change(envelope, '[shop_gem]');
    expect(gem?.delta).toBe(10n);
    expect(gem?.source).toBe(SHOP);
    expect(gem?.ref).toBe(String(id('[shop_basic]')));
    const gold = shop_change(envelope, '[shop_gold]');
    expect(gold?.delta).toBe(-100n);
    expect(gold?.source).toBe(SHOP);
  });

  it('answers ITEM_NOT_ENOUGH when the cost is short and keeps the purchase count', async () => {
    const server = await start();
    const session = await user(server);
    await set_balance(server, session, '[shop_gold]', 99n);
    const before = await snapshot(server, session);
    const { code } = await buy(session, '[shop_basic]');
    expect(code).toBe(E.CORE_ERROR_ITEM_NOT_ENOUGH);
    expect(await purchase_row(server, session, '[shop_basic]')).toBeNull();
    expect(await snapshot(server, session)).toEqual(before);
  });

  it('doubles the cost and the reward for quantity 2', async () => {
    const server = await start();
    const session = await user(server);
    await set_balance(server, session, '[shop_gold]', 1000n);
    const { code, response } = await buy(session, '[shop_basic]', 2);
    expect(code).toBe(0);
    expect(amount_in(response?.items ?? [], '[shop_gem]')).toBe(20n);
    expect(await balance(server, session, '[shop_gold]')).toBe(800n);
    expect(await balance(server, session, '[shop_gem]')).toBe(20n);
    expect((await purchase_row(server, session, '[shop_basic]'))?.count).toBe(2);
  });

  it('answers INVALID_REQUEST for a quantity over max_quantity and changes nothing', async () => {
    const server = await start();
    const session = await user(server);
    await set_balance(server, session, '[shop_gold]', 1000n);
    const before = await snapshot(server, session);
    const { code } = await buy(session, '[shop_basic]', 6);
    expect(code).toBe(E.CORE_ERROR_INVALID_REQUEST);
    expect(await snapshot(server, session)).toEqual(before);
  });

  it('answers INVALID_REQUEST for a product ID value that is not in shop_product', async () => {
    const server = await start();
    const session = await user(server);
    const request = new CoreContract.BuyShopProductRequest();
    request.product_id = 999_999;
    request.quantity = 1;
    const { envelope } = await testing.send(session, 'core/BuyShopProduct', request);
    expect(envelope.error?.code).toBe(E.CORE_ERROR_INVALID_REQUEST);
  });

  it('gives a big item reward over 2^53-1 within the amount limit, with the product in big_delta', async () => {
    const server = await start();
    const session = await user(server);
    const { envelope, code, response } = await buy(session, '[shop_big_pack]', 2);
    const expected = 4_503_599_627_370_496n * 2n;
    expect(expected > MAX_SAFE).toBe(true);
    expect(code).toBe(0);
    const change = shop_change(envelope, '[shop_big]');
    expect(change?.big_delta).toBe(expected.toString());
    expect(change?.delta).toBe(0n);
    expect(amount_in(response?.items ?? [], '[shop_big]')).toBe(expected);
    expect(await balance(server, session, '[shop_big]')).toBe(expected);
  });

  it('answers INVALID_REQUEST and changes nothing when a big item reward × quantity is over its amount limit', async () => {
    const server = await start();
    const session = await user(server);
    // 4503599627370496 × 3 is over 10^16 − 1, the amount limit of [shop_big] (max_digits 16).
    expect(4_503_599_627_370_496n * 3n > 10n ** 16n - 1n).toBe(true);
    const before = await snapshot(server, session);
    const { code } = await buy(session, '[shop_big_pack]', 3);
    expect(code).toBe(E.CORE_ERROR_INVALID_REQUEST);
    expect(await snapshot(server, session)).toEqual(before);
  });

  it('answers INVALID_REQUEST when the amount × quantity of an item that is not a big item is over 2^53-1', async () => {
    const server = await start();
    const session = await user(server);
    const before = await snapshot(server, session);
    const { code } = await buy(session, '[shop_huge_pack]', 2);
    expect(code).toBe(E.CORE_ERROR_INVALID_REQUEST);
    expect(await snapshot(server, session)).toEqual(before);
  });

  it('answers INVALID_REQUEST and changes nothing when a cost amount × quantity is over the amount limit', async () => {
    const server = await start();
    const session = await user(server);
    // [shop_costly_pack] costs 4503599627370496 [shop_gold]; × 2 is over 2^53-1, the amount limit of an item that is not a big item.
    expect(4_503_599_627_370_496n * 2n > MAX_SAFE).toBe(true);
    const before = await snapshot(server, session);
    const { code } = await buy(session, '[shop_costly_pack]', 2);
    expect(code).toBe(E.CORE_ERROR_INVALID_REQUEST);
    expect(await snapshot(server, session)).toEqual(before);
  });

  it('judges the overflow on the balance after the cost when the cost and the reward have the same item', async () => {
    const server = await start();
    const session = await user(server);
    // [shop_discard] has max_amount 5: 4 − 2 + 3 = 5 fits; 4 + 3 would discard 2.
    await set_balance(server, session, '[shop_discard]', 4n);
    const { code, envelope } = await buy(session, '[shop_swap]');
    expect(code).toBe(0);
    expect(await balance(server, session, '[shop_discard]')).toBe(5n);
    expect(envelope.item_changes.every((c) => c.overflow === 0n)).toBe(true);
  });

  it('applies a purchase sent again with the same request ID once', async () => {
    const server = await start();
    const session = await user(server);
    await set_balance(server, session, '[shop_gold]', 1000n);
    const request_id = randomUUID();
    const first = await buy(session, '[shop_basic]', 1, false, request_id);
    const again = await buy(session, '[shop_basic]', 1, false, request_id);
    expect(first.code).toBe(0);
    expect(again.code).toBe(0);
    expect(again.response?.encode()).toEqual(first.response?.encode());
    expect(await balance(server, session, '[shop_gold]')).toBe(900n);
    expect(await balance(server, session, '[shop_gem]')).toBe(10n);
    expect((await purchase_row(server, session, '[shop_basic]'))?.count).toBe(1);
  });
});
