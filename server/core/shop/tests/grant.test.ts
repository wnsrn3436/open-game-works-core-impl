import * as CoreContract from '../../../generated/contract/core_contract.ts';
import type { RequestCtx } from '../../storage/index.ts';
import { E, balance, buy, item_amount, mails, module_of, purchase_row, set_balance, snapshot, start, stop_all, user } from './helpers.ts';

const SHOP = CoreContract.ItemChangeSource.ITEM_CHANGE_SOURCE_SHOP;

/** The `item-ledger` and `mailbox` operations of the server instance that shop calls in steps 6 and 7. */
interface Ledger {
  add_items(ctx: RequestCtx, items: readonly CoreContract.ItemAmount[], source: { source: number; ref: string; once_key: string }): unknown;
  preview_add_items(ctx: RequestCtx, items: readonly CoreContract.ItemAmount[]): unknown;
}
interface Mailbox {
  grant_or_mail(...args: unknown[]): { readonly result: string | number };
}

afterEach(async () => {
  vi.restoreAllMocks();
  await stop_all();
});

// `[shop_basic]`: cost `[shop_gold]` 100, reward `[shop_gem]` 10.
describe('reward grant', () => {
  it('answers INTERNAL and changes nothing when preview_add_items fails', async () => {
    const server = await start();
    const session = await user(server);
    await set_balance(server, session, '[shop_gold]', 1000n);
    const before = await snapshot(server, session);
    const preview = vi.spyOn(module_of(server, 'item-ledger') as Ledger, 'preview_add_items');
    const grant = vi.spyOn(module_of(server, 'mailbox') as Mailbox, 'grant_or_mail');
    for (const failure of ['INVALID_AMOUNT', 'UNKNOWN_ITEM', 'UNSUPPORTED_ITEM']) {
      preview.mockReturnValueOnce(failure);
      expect((await buy(session, '[shop_basic]')).code).toBe(E.CORE_ERROR_INTERNAL);
    }
    expect(grant).not.toHaveBeenCalled();
    expect(await snapshot(server, session)).toEqual(before);
  });

  it('answers INTERNAL and changes nothing when grant_or_mail fails', async () => {
    const server = await start();
    const session = await user(server);
    await set_balance(server, session, '[shop_gold]', 1000n);
    const before = await snapshot(server, session);
    const grant = vi.spyOn(module_of(server, 'mailbox') as Mailbox, 'grant_or_mail');
    for (const failure of ['INVALID_AMOUNT', 'UNKNOWN_ITEM', 'UNSUPPORTED_ITEM', 'INVALID_INPUT']) {
      grant.mockReturnValueOnce({ result: failure });
      expect((await buy(session, '[shop_basic]')).code).toBe(E.CORE_ERROR_INTERNAL);
    }
    expect(grant).toHaveBeenCalledTimes(4);
    expect(await snapshot(server, session)).toEqual(before);
  });

  it('completes the purchase with empty items and no mail when grant_or_mail answers AlreadyApplied for once_key shop:<request ID>', async () => {
    const holder: { ledger: Ledger | null } = { ledger: null };
    const server = await start({
      // Applies once_key shop:<request ID> before step 7 of the same request, so the reward grant finds it applied.
      validate_shop_purchase: (ctx) => {
        holder.ledger?.add_items(ctx, [item_amount('[shop_gem]', 1n)], { source: SHOP, ref: '', once_key: `shop:${ctx.request_id}` });
        return 'pass';
      },
    });
    holder.ledger = module_of(server, 'item-ledger') as Ledger;
    const session = await user(server);
    await set_balance(server, session, '[shop_gold]', 1000n);
    const grant = vi.spyOn(module_of(server, 'mailbox') as Mailbox, 'grant_or_mail');
    const { code, response } = await buy(session, '[shop_basic]');
    expect(grant.mock.results.map((result) => result.value as unknown)).toEqual([{ result: 'AlreadyApplied' }]);
    expect(code).toBe(0);
    expect(response?.items).toEqual([]);
    expect(response?.mailed).toBe(false);
    expect(await balance(server, session, '[shop_gold]')).toBe(900n);
    expect(await balance(server, session, '[shop_gem]')).toBe(1n);
    expect(await mails(server, session)).toEqual([]);
    expect((await purchase_row(server, session, '[shop_basic]'))?.count).toBe(1);
  });
});
