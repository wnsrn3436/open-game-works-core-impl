import * as CoreContract from '../../../generated/contract/core_contract.ts';
import type { HookChangeSource } from '../../storage/index.ts';
import * as testing from '../../testing/dev/index.ts';
import { HOOK_ERROR, balance, buy, id, purchase_row, set_balance, snapshot, start, stop_all, user } from './helpers.ts';

const SHOP = CoreContract.ItemChangeSource.ITEM_CHANGE_SOURCE_SHOP;

afterEach(async () => {
  await stop_all();
});

// `[shop_extra_pack]`: cost `[shop_gold]` 100, reward `[shop_gem]` 10, `extra_grant` true.
describe('grant_shop_extra', () => {
  it('rolls back the cost and the reward when grant_shop_extra returns a GameError', async () => {
    const calls: { product_id: number; quantity: number; source: HookChangeSource | null }[] = [];
    const server = await start({
      grant_shop_extra: (ctx, product_id, quantity) => {
        calls.push({ product_id, quantity, source: ctx.hook_change_source });
        return HOOK_ERROR;
      },
    });
    const session = await user(server);
    await set_balance(server, session, '[shop_gold]', 1000n);
    const before = await snapshot(server, session);
    expect((await buy(session, '[shop_extra_pack]', 2)).code).toBe(HOOK_ERROR);
    const product_id = id('[shop_extra_pack]');
    expect(calls).toEqual([{ product_id, quantity: 2, source: { source: SHOP, ref: String(product_id) } }]);
    expect(await snapshot(server, session)).toEqual(before);
  });

  it('answers INTERNAL and rolls back the purchase when grant_shop_extra returns a number under 1000 or not pass', async () => {
    let output: unknown = 'pass';
    const server = await start({ grant_shop_extra: () => output as number });
    const session = await user(server);
    await set_balance(server, session, '[shop_gold]', 1000n);
    const before = await snapshot(server, session);
    for (const wrong of [CoreContract.CoreError.CORE_ERROR_SHOP_LIMIT_REACHED, -1, 999, 'ok']) {
      output = wrong;
      expect((await buy(session, '[shop_extra_pack]')).code).toBe(CoreContract.CoreError.CORE_ERROR_INTERNAL);
    }
    expect(await snapshot(server, session)).toEqual(before);
  });

  it('completes the purchase when grant_shop_extra passes', async () => {
    const calls: [number, number][] = [];
    const server = await start({
      grant_shop_extra: (_ctx, product_id, quantity) => {
        calls.push([product_id, quantity]);
        return 'pass';
      },
    });
    const session = await user(server);
    await set_balance(server, session, '[shop_gold]', 1000n);
    expect((await buy(session, '[shop_extra_pack]')).code).toBe(0);
    expect(calls).toEqual([[id('[shop_extra_pack]'), 1]]);
    expect(await balance(server, session, '[shop_gold]')).toBe(900n);
    expect(await balance(server, session, '[shop_gem]')).toBe(10n);
    expect((await purchase_row(server, session, '[shop_extra_pack]'))?.count).toBe(1);
  });

  it('does not call grant_shop_extra for a product with extra_grant false', async () => {
    const calls: number[] = [];
    const server = await start({
      grant_shop_extra: (_ctx, product_id) => {
        calls.push(product_id);
        return 'pass';
      },
    });
    const session = await user(server);
    await set_balance(server, session, '[shop_gold]', 1000n);
    expect((await buy(session, '[shop_basic]')).code).toBe(0);
    expect(calls).toEqual([]);
  });

  it('fails server start with an error log when a shop_product row has extra_grant true and content registered no grant_shop_extra', async () => {
    const failure = await start({ grant_shop_extra: null }).then(
      () => null,
      (error: unknown) => error,
    );
    expect(failure).toBeInstanceOf(testing.StartFailure);
    const { message, logs } = failure as testing.StartFailure;
    expect(message).toContain(String(id('[shop_extra_pack]')));
    expect(message).toContain('grant_shop_extra');
    expect(logs.some((line) => line.level === 'error' && typeof line.message === 'string' && line.message.includes(message))).toBe(true);
  });
});
