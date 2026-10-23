import * as CoreContract from '../../../generated/contract/core_contract.ts';
import * as GameContract from '../../../generated/contract/game_contract.ts';
import * as testing from '../../testing/dev/index.ts';
import { E, HOOK_ERROR, balance, buy, delta_of, id, item_amount, server_events, set_balance, snapshot, start, stop_all, user } from './helpers.ts';

afterEach(async () => {
  await stop_all();
});

describe('hooks', () => {
  it('uses a GameError the core test data lists in (ogw.core_errors) of core/BuyShopProduct', () => {
    expect(GameContract.CORE_ERRORS.get('core/BuyShopProduct')).toContain(HOOK_ERROR);
  });

  it('changes nothing when validate_shop_purchase returns a GameError', async () => {
    const calls: [number, number][] = [];
    const server = await start({
      validate_shop_purchase: (_ctx, product_id, quantity) => {
        calls.push([product_id, quantity]);
        return HOOK_ERROR;
      },
    });
    const session = await user(server);
    await set_balance(server, session, '[shop_gold]', 1000n);
    const before = await snapshot(server, session);
    const { code } = await buy(session, '[shop_basic]', 2);
    expect(code).toBe(HOOK_ERROR);
    expect(calls).toEqual([[id('[shop_basic]'), 2]]);
    expect(await snapshot(server, session)).toEqual(before);
  });

  it('answers INTERNAL and changes nothing when validate_shop_purchase returns a number under 1000 or not pass', async () => {
    let output: unknown = 'pass';
    const server = await start({ validate_shop_purchase: () => output as number });
    const session = await user(server);
    await set_balance(server, session, '[shop_gold]', 1000n);
    const before = await snapshot(server, session);
    for (const wrong of [E.CORE_ERROR_SHOP_LIMIT_REACHED, -1, 0, 999, 1000.5, 'ok', null]) {
      output = wrong;
      expect((await buy(session, '[shop_basic]')).code).toBe(E.CORE_ERROR_INTERNAL);
    }
    expect(await snapshot(server, session)).toEqual(before);
  });

  it('calls on_shop_bought once per purchase that succeeds, with its changes in the delta of the same response', async () => {
    const calls: [number, number][] = [];
    const server = await start({
      on_shop_bought: (ctx, product_id, quantity, core) => {
        calls.push([product_id, quantity]);
        core.ledger.add_items(ctx, [item_amount('[shop_shard]', 1n)]);
      },
    });
    const session = await user(server);
    await set_balance(server, session, '[shop_gold]', 150n);
    const first = await buy(session, '[shop_basic]');
    expect(first.code).toBe(0);
    expect(calls).toEqual([[id('[shop_basic]'), 1]]);
    const shard = delta_of(first.envelope, CoreContract.ItemBalanceUserState).find((e) => e.id === BigInt(id('[shop_shard]')));
    expect(shard?.value?.amount).toBe(1n);
    // 50 gold left: the next purchase fails and the hook is not called.
    const failed = await buy(session, '[shop_basic]');
    expect(failed.code).toBe(E.CORE_ERROR_ITEM_NOT_ENOUGH);
    expect(calls.length).toBe(1);
    expect(await balance(server, session, '[shop_shard]')).toBe(1n);
  });

  it('answers INTERNAL and changes nothing when on_shop_bought throws', async () => {
    const server = await start({
      on_shop_bought: () => {
        throw new Error('content failure');
      },
    });
    const session = await user(server);
    await set_balance(server, session, '[shop_gold]', 1000n);
    const before = await snapshot(server, session);
    const { code } = await buy(session, '[shop_basic]');
    expect(code).toBe(E.CORE_ERROR_INTERNAL);
    expect(await snapshot(server, session)).toEqual(before);
  });
});

describe('core analytics event', () => {
  it('stores core_shop_bought for a user who allows analytics on a purchase that succeeds, and not on one that fails', async () => {
    const server = await start();
    const session = await user(server);
    const consent = (await testing.read_user_state(server, session.user_id)).find((s) => s.kind === 'ConsentUserState');
    expect((consent?.value as CoreContract.ConsentUserState | undefined)?.analytics_allowed).toBe(true);
    await set_balance(server, session, '[shop_gold]', 100n);
    expect((await buy(session, '[shop_basic]')).code).toBe(0);
    expect((await buy(session, '[shop_basic]')).code).toBe(E.CORE_ERROR_ITEM_NOT_ENOUGH);
    expect(await server_events(server, session)).toEqual([
      { name: 'core_shop_bought', params: [['product_id', BigInt(id('[shop_basic]'))], ['quantity', 1n]] },
    ]);
  });
});
