/**
 * `RedeemCoupon` step 4 when another transaction holds the coupon row (`shared`) or the code row (`unique`) past
 * `storage.userLockWaitMs`: `INTERNAL`, one `error` log, which `routing` leaves, and no use record or item.
 */
import { randomUUID } from 'node:crypto';
import * as testing from '../../testing/dev/index.ts';
import { E, balance, codes_of, create, get_coupon, redeem, start, user, type TestServer } from './helpers.ts';

const servers: TestServer[] = [];

async function server(settings?: Readonly<Record<string, unknown>>): Promise<TestServer> {
  const started = await start(undefined, settings);
  servers.push(started);
  return started;
}

afterEach(async () => {
  for (const s of servers.splice(0)) await testing.stop_test_server(s);
});

/** A shared coupon and a unique coupon, with the table and key of the row step 4 locks for each. */
async function coupons(s: TestServer) {
  const shared = await create(s, { code: 'LOCKED1' });
  const unique = await create(s, { kind: 'unique', count: 1 });
  const [code] = await codes_of(s, unique);
  if (code === undefined) throw new Error('one code expected');
  return [
    { id: shared, code: 'LOCKED1', table: 'coupon_coupon', key: [shared] },
    { id: unique, code, table: 'coupon_code', key: [code] },
  ];
}

describe('RedeemCoupon row lock failure', () => {
  // On SQLite the holder holds the whole database, and `lock_game_row` takes no lock, so step 4 cannot be FAILED.
  it.skipIf(testing.default_db_kind() !== 'postgresql')(
    'answers INTERNAL with one error log, the routing line of the failed request transaction, when another transaction holds the row past storage.userLockWaitMs',
    async () => {
      const s = await server({ 'storage.userLockWaitMs': 200 });
      for (const target of await coupons(s)) {
        const session = await user(s);
        const logs = testing.read_logs(s, 'error', 'error').length;
        const request_id = randomUUID();
        const release = await testing.hold_game_row_lock(s, target.table, target.key);
        let code: number;
        try {
          code = (await redeem(session, target.code, request_id)).code;
        } finally {
          await release();
        }
        expect(code, target.table).toBe(E.CORE_ERROR_INTERNAL);
        const added = testing.read_logs(s, 'error', 'error').slice(logs);
        expect(added, target.table).toHaveLength(1);
        expect(added[0], target.table).toMatchObject({
          message: 'request transaction failed',
          user_id: String(session.user_id),
          request_id,
          request: 'core/RedeemCoupon',
        });
        expect(await balance(s, session, '[coupon_gold]')).toBe(0n);
        expect(String((await get_coupon(s, target.id))['used_count'])).toBe('0');
        // The failure kept no use record: the same user takes it once the lock is free.
        expect((await redeem(session, target.code)).code, target.table).toBe(0);
      }
    },
  );
});
