import * as CoreContract from '../../../generated/contract/core_contract.ts';
import type { IapContext } from '../context.ts';
import type { IapModules } from '../deps.ts';
import { add_purchase } from '../purchase_count.ts';
import type { RequestCtx } from '../../storage/index.ts';
import { data, product, START } from './helpers.ts';

/**
 * An iap context whose `offer.read_purchase_limit` reads `read` and gives `write_reset_at`. `server-time` has no
 * `get_next_reset` and `offer` has no `get_offer_ends_at`, so iap can get the next reset time only from `write_reset_at`.
 */
function context(read: { count: number; reset_at: bigint; event_round: number }, write_reset_at: bigint) {
  const puts: CoreContract.IapPurchaseUserState[] = [];
  const calls: unknown[] = [];
  const m = {
    storage: {
      get_state: () => null,
      put_core_state: (_ctx: RequestCtx, row: CoreContract.IapPurchaseUserState) => {
        puts.push(row);
      },
    },
    time: { now: () => START },
    live_event: { round_to_write: () => read.event_round },
    offer: {
      read_purchase_limit: (_ctx: RequestCtx, offer: number, reset: unknown, live_event: number, count: number, reset_at: bigint, event_round: number) => {
        calls.push([offer, reset, live_event, count, reset_at, event_round]);
        return { ...read, write_reset_at };
      },
    },
  } as unknown as IapModules;
  const c = { m, data } as unknown as IapContext;
  return { c, puts, calls };
}

const ctx = { user_id: 1n, data } as unknown as RequestCtx;

describe('add_purchase', () => {
  it.each(['[iap_daily_pack]', '[iap_offer_pack]'])('writes reset_at of %s as read_purchase_limit write_reset_at when the read reset_at is 0', (name) => {
    const row = product(name);
    const { c, puts, calls } = context({ count: 0, reset_at: 0n, event_round: 0 }, 1_234_567n);
    expect(add_purchase(c, ctx, row)).toEqual({ reset_at: 1_234_567n, event_round: 0, count: 1 });
    expect(calls).toEqual([[row.offer, row.reset, row.live_event, 0, 0n, 0]]);
    expect(puts.map((put) => [put.id, put.count, put.reset_at])).toEqual([[BigInt(row.id), 1, 1_234_567n]]);
  });

  it('writes write_reset_at, not the read reset_at, when the read reset_at is not 0', () => {
    const { c, puts } = context({ count: 2, reset_at: START + 10n, event_round: 0 }, START + 20n);
    expect(add_purchase(c, ctx, product('[iap_daily_pack]'))).toEqual({ reset_at: START + 20n, event_round: 0, count: 3 });
    expect(puts.map((put) => [put.count, put.reset_at])).toEqual([[3, START + 20n]]);
  });
});
