/** The DEV code of item-ledger: `set_balance` and the core cheat `SetItemBalance`. */
import * as CoreContract from '../../../generated/contract/core_contract.ts';
import * as CoreCheatContract from '../../../dev/generated/contract/core_cheat_contract.ts';
import type { RequestCtx } from '../../storage/index.ts';
import type { ItemLedger } from '../index.ts';
import { read_big } from '../items.ts';
import { Change, ItemChangeResult } from '../ledger.ts';

export type SetItemBalanceHandler = (ctx: RequestCtx, request: CoreCheatContract.SetItemBalanceRequest) => CoreCheatContract.SetItemBalanceResponse | CoreContract.CoreError;

/** The DEV object: the `## DEV` operations. */
export interface ItemLedgerDev {
  set_balance(ctx: RequestCtx, item_id: number, balance: bigint): ItemChangeResult;
  SetItemBalance: SetItemBalanceHandler;
}

export function create_item_ledger_dev(module: ItemLedger): ItemLedgerDev {
  const ledger = module.dev_ledger();

  const set_balance = (ctx: RequestCtx, item_id: number, balance: bigint): ItemChangeResult => {
    ledger.guard_write(ctx, 'set_balance');
    const info = ledger.info(ctx, item_id);
    if (!info) return ItemChangeResult.UNKNOWN_ITEM;
    if (info.kind === 'group') return ItemChangeResult.UNSUPPORTED_ITEM;
    const limit = info.kind === 'timed' ? info.max_amount : info.balance_limit;
    if (balance < 0n || balance > limit) return ItemChangeResult.INVALID_AMOUNT;
    const hook = ctx.hook_change_source;
    const source = { source: CoreContract.ItemChangeSource.ITEM_CHANGE_SOURCE_CHEAT, ref: hook ? hook.ref : ctx.request_name, once_key: '' };
    ledger.check_cheat(ctx, source);
    new Change(ledger, ctx).set(item_id, balance, source);
    return ItemChangeResult.OK;
  };

  const SetItemBalance: SetItemBalanceHandler = (ctx, request) => {
    const balance = read_big(request.balance, request.big_balance);
    if (balance === null) return CoreContract.CoreError.CORE_ERROR_INVALID_REQUEST;
    if (set_balance(ctx, request.item_id, balance) !== ItemChangeResult.OK) return CoreContract.CoreError.CORE_ERROR_INVALID_REQUEST;
    return new CoreCheatContract.SetItemBalanceResponse();
  };

  return { set_balance, SetItemBalance };
}
