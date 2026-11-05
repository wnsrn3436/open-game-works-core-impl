import * as CoreContract from '../../../generated/contract/core_contract.ts';
import * as GameDataDev from '../../../dev/generated/data/game_data_dev.ts';
import { create_storage_dev } from '../../storage/dev/index.ts';
import type { GameTx } from '../../storage/index.ts';
import { fields } from '../../storage/tests/helpers.ts';
import { start_modules } from './modules.ts';

const START_AT = 1_800_000_000_000n;

describe('RedeemCoupon audit at commit', () => {
  it('keeps the audit line of a committed RedeemCoupon when the server stops while an earlier after_commit function of its transaction still runs', async () => {
    const m = await start_modules(START_AT);
    if (typeof m === 'string') throw new Error(`server start failed: ${m}`);
    const created = await m.storage.run_game_transaction((tx: GameTx) =>
      m.coupon.create_coupon.handler(
        {
          operation_id: 'op-stop1',
          kind: 'shared',
          code: 'STOP1',
          count: 0,
          max_uses: 0,
          start_at: START_AT,
          end_at: START_AT + 86_400_000n,
          items: [{ item_id: GameDataDev.find_id_value('[coupon_gold]'), amount: 1n }],
          extra_id: 0,
          memo: '',
        },
        tx,
        null,
        null,
      ),
    );
    expect(created).toEqual({ coupon_id: 1n });
    const user_id = await m.storage.run_game_transaction((tx: GameTx) => m.storage.create_user(tx).user_id);
    if (user_id === 'FAILED') throw new Error('create_user failed');
    let open!: () => void;
    const gate = new Promise<void>((resolve) => {
      open = resolve;
    });
    const request = new CoreContract.RedeemCouponRequest();
    request.code = 'stop-1';
    const result = await m.storage.run_request_transaction(user_id, fields('r-stop'), (ctx) => {
      // An after_commit function of the request that is still running when the server stops.
      m.storage.after_commit(ctx, () => gate);
      return m.coupon.RedeemCoupon(ctx, request, 'pass');
    });
    expect(result).toBeInstanceOf(CoreContract.RedeemCouponResponse);
    m.stop();
    open();
    await create_storage_dev(m.storage).wait_after_commit();
    const audits = m.log_lines
      .map((line) => JSON.parse(line) as Record<string, unknown>)
      .filter((line) => line['kind'] === 'audit' && line['request'] === 'core/RedeemCoupon');
    expect(audits).toHaveLength(1);
    expect(String(audits[0]?.['user_id'])).toBe(String(user_id));
    expect(audits[0]?.['args']).toEqual({ coupon_id: '1', code: 'STOP1' });
  });
});
