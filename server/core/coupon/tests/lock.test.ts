/**
 * `RedeemCoupon` step 4 when `storage.lock_game_row` of the coupon row (`shared`) or the code row (`unique`) is
 * `FAILED`: `INTERNAL`, one `error` log, and no use record or item.
 */
import { randomUUID } from 'node:crypto';
import { storage_module } from '../../storage/tests/helpers.ts';
import * as testing from '../../testing/dev/index.ts';
import { E, balance, codes_of, create, get_coupon, redeem, start, user, type TestServer } from './helpers.ts';

const servers: TestServer[] = [];

async function server(settings?: Readonly<Record<string, unknown>>): Promise<TestServer> {
  const started = await start(undefined, settings);
  servers.push(started);
  return started;
}

afterEach(async () => {
  vi.restoreAllMocks();
  for (const s of servers.splice(0)) await testing.stop_test_server(s);
});

/** The `error` log lines of the step 4 row lock. */
function lock_errors(s: TestServer): Record<string, unknown>[] {
  return testing.read_logs(s, 'error', 'error').filter((line) => String(line['message']).includes('row lock failed'));
}

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
  it('answers INTERNAL with one error log with the user ID and request ID, and changes nothing, when lock_game_row is FAILED', async () => {
    const s = await server();
    const storage = storage_module(s);
    for (const target of await coupons(s)) {
      const session = await user(s);
      const original = storage.lock_game_row.bind(storage);
      const spy = vi.spyOn(storage, 'lock_game_row').mockImplementation((ctx, table, key) => (table === target.table ? 'FAILED' : original(ctx, table, key)));
      const logs = lock_errors(s).length;
      const request_id = randomUUID();
      const result = await redeem(session, target.code, request_id);
      spy.mockRestore();
      expect(result.code).toBe(E.CORE_ERROR_INTERNAL);
      const added = lock_errors(s).slice(logs);
      expect(added).toHaveLength(1);
      expect(added[0]).toMatchObject({ user_id: String(session.user_id), request_id, request: 'core/RedeemCoupon' });
      expect(await balance(s, session, '[coupon_gold]')).toBe(0n);
      expect(String((await get_coupon(s, target.id))['used_count'])).toBe('0');
      // The failure kept no use record: the same user takes it once the lock works.
      expect((await redeem(session, target.code)).code).toBe(0);
    }
  });

  // On SQLite the holder holds the whole database, so the request fails before coupon runs.
  it.skipIf(testing.default_db_kind() !== 'postgresql')(
    'answers INTERNAL with one error log when another transaction holds the row past storage.userLockWaitMs',
    async () => {
      const s = await server({ 'storage.userLockWaitMs': 200 });
      for (const target of await coupons(s)) {
        const session = await user(s);
        const logs = lock_errors(s).length;
        const request_id = randomUUID();
        const release = await testing.hold_game_row_lock(s, target.table, target.key);
        let code: number;
        try {
          code = (await redeem(session, target.code, request_id)).code;
        } finally {
          await release();
        }
        expect(code).toBe(E.CORE_ERROR_INTERNAL);
        const added = lock_errors(s).slice(logs);
        expect(added).toHaveLength(1);
        expect(added[0]).toMatchObject({ user_id: String(session.user_id), request_id, request: 'core/RedeemCoupon' });
        expect(await balance(s, session, '[coupon_gold]')).toBe(0n);
        expect(String((await get_coupon(s, target.id))['used_count'])).toBe('0');
      }
    },
  );
});
