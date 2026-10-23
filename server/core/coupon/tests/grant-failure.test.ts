import * as CoreContract from '../../../generated/contract/core_contract.ts';
import * as GameData from '../../../generated/data/game_data.ts';
import * as GameDataDev from '../../../dev/generated/data/game_data_dev.ts';
import type { GameTx } from '../../storage/index.ts';
import { fields, server_data } from '../../storage/tests/helpers.ts';
import type { CreateCouponInput } from '../index.ts';
import { start_modules, type Modules, type StartOptions } from './modules.ts';

const START_AT = 1_800_000_000_000n;
const running: Modules[] = [];

afterEach(() => {
  for (const m of running.splice(0)) m.stop();
});

async function modules(options: StartOptions = {}): Promise<Modules> {
  const started = await start_modules(START_AT, {}, options);
  if (typeof started === 'string') throw new Error(`server start failed: ${started}`);
  running.push(started);
  return started;
}

/** The core test data's server build data without the item row `name`. */
function data_without(name: string): GameData.DataSet {
  const data = GameData.load_data_set(server_data().files);
  if (data === null) throw new Error('the server build data does not load');
  const id = GameDataDev.find_id_value(name);
  (data as { ItemTable: GameData.ItemTable }).ItemTable = new GameData.ItemTable(data.ItemTable.all_rows().filter((row) => row.id !== id));
  return data;
}

function coupon_input(code: string, item_name: string, extra_id = 0): CreateCouponInput {
  return {
    operation_id: `op-${code}`,
    kind: 'shared',
    code,
    count: 0,
    max_uses: 0,
    start_at: START_AT,
    end_at: START_AT + 86_400_000n,
    items: [{ item_id: GameDataDev.find_id_value(item_name), amount: 1n }],
    extra_id,
    memo: '',
  };
}

describe('grant failure', () => {
  // The server build data changes between create_coupon and RedeemCoupon: a second server instance on the same
  // database runs with data that no longer has the coupon's item.
  it('answers INTERNAL when the grant ends in a grant_or_mail failure, and the use record and used_count stay', async () => {
    const before = await modules();
    const created = await before.storage.run_game_transaction((tx: GameTx) => before.coupon.create_coupon.handler(coupon_input('GONE1', '[coupon_gem]'), tx, null, null));
    expect(created).toEqual({ coupon_id: 1n });
    const after = await modules({ db: before.db, data: data_without('[coupon_gem]') });
    const user_id = await after.storage.run_game_transaction((tx: GameTx) => after.storage.create_user(tx));
    if (user_id === 'FAILED') throw new Error('create_user failed');
    const request = new CoreContract.RedeemCouponRequest();
    request.code = 'GONE1';
    const result = await after.storage.run_request_transaction(user_id, fields('r-gone'), (ctx) => after.coupon.RedeemCoupon(ctx, request, 'pass'));
    expect(result).toBe(CoreContract.CoreError.CORE_ERROR_INTERNAL);
    const db = after.storage.read_db();
    expect(db.query('SELECT used_count FROM coupon_coupon WHERE coupon_id = $1', [1n])).toEqual([{ used_count: 0n }]);
    expect(db.query('SELECT user_id FROM coupon_redemption', [])).toEqual([]);
    expect(after.log_lines.map((line) => JSON.parse(line) as Record<string, unknown>).filter((line) => line['kind'] === 'audit')).toEqual([]);
  });

  it('answers INTERNAL when the mail of an extra_id coupon ends in INVALID_INPUT, and no mail, use record or used_count stays', async () => {
    const before = await modules();
    const created = await before.storage.run_game_transaction((tx: GameTx) => before.coupon.create_coupon.handler(coupon_input('GONE2', '[coupon_gem]', 7), tx, null, null));
    expect(created).toEqual({ coupon_id: 1n });
    const after = await modules({ db: before.db, data: data_without('[coupon_gem]') });
    const user_id = await after.storage.run_game_transaction((tx: GameTx) => after.storage.create_user(tx));
    if (user_id === 'FAILED') throw new Error('create_user failed');
    const request = new CoreContract.RedeemCouponRequest();
    request.code = 'GONE2';
    const result = await after.storage.run_request_transaction(user_id, fields('r-gone-mail'), (ctx) => after.coupon.RedeemCoupon(ctx, request, 'pass'));
    expect(result).toBe(CoreContract.CoreError.CORE_ERROR_INTERNAL);
    const db = after.storage.read_db();
    expect(db.query('SELECT kind FROM user_state WHERE user_id = $1', [user_id])).toEqual([]);
    expect(db.query('SELECT once_key FROM mailbox_once_key', [])).toEqual([]);
    expect(db.query('SELECT used_count FROM coupon_coupon WHERE coupon_id = $1', [1n])).toEqual([{ used_count: 0n }]);
    expect(db.query('SELECT user_id FROM coupon_redemption', [])).toEqual([]);
    expect(after.log_lines.map((line) => JSON.parse(line) as Record<string, unknown>).filter((line) => line['kind'] === 'audit')).toEqual([]);
  });
});
