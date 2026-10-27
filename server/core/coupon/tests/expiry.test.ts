import * as CoreContract from '../../../generated/contract/core_contract.ts';
import type { GameTx } from '../../storage/index.ts';
import { DB_KIND, lock_holder, stop_all } from '../../storage/tests/helpers.ts';
import { start_modules, type Modules } from './modules.ts';

const START_AT = 1_800_000_030_000n;
const WINDOW_MS = 60_000n;
const REQUEST = new CoreContract.RedeemCouponRequest();
const running: Modules[] = [];

afterEach(() => {
  stop_all();
  for (const m of running.splice(0)) m.stop();
});

async function modules(settings: Readonly<Record<string, unknown>> = {}): Promise<Modules> {
  const started = await start_modules(START_AT, { 'coupon.attemptWindowMs': Number(WINDOW_MS), 'coupon.maxAttemptsPerWindow': 10, ...settings });
  if (typeof started === 'string') throw new Error(`server start failed: ${started}`);
  running.push(started);
  return started;
}

async function new_user(m: Modules): Promise<bigint> {
  const id = await m.storage.run_game_transaction((tx: GameTx) => m.storage.create_user(tx).user_id);
  if (id === 'FAILED') throw new Error('create_user failed');
  return id;
}

function attempt_rows(m: Modules): Record<string, unknown>[] {
  return m.storage.read_db().query('SELECT user_id, window_start, count, expires_at FROM coupon_attempt', []);
}

describe('coupon_attempt', () => {
  it('has expires_at = window_start + coupon.attemptWindowMs, and the expiry sweep deletes the row from that time', async () => {
    const m = await modules();
    const user_id = await new_user(m);
    expect(await m.coupon.count_redeem_attempt(user_id, REQUEST, '203.0.113.7', 'r-attempt')).toBe('pass');
    expect(await m.coupon.count_redeem_attempt(user_id, REQUEST, '203.0.113.7', 'r-attempt')).toBe('pass');
    const window_start = (START_AT / WINDOW_MS) * WINDOW_MS;
    expect(attempt_rows(m)).toEqual([{ user_id, window_start, count: 2n, expires_at: window_start + WINDOW_MS }]);
    m.clock.advance(window_start + WINDOW_MS - 1n - START_AT);
    expect((await m.storage.sweep_expired()).deleted).toBe(0);
    expect(attempt_rows(m)).toHaveLength(1);
    m.clock.advance(1n);
    expect((await m.storage.sweep_expired()).deleted).toBe(1);
    expect(attempt_rows(m)).toEqual([]);
  });

  it('answers UNAUTHORIZED for a user with no user row and counts nothing', async () => {
    const m = await modules();
    expect(await m.coupon.count_redeem_attempt(999_999n, REQUEST, '203.0.113.7', 'r-attempt')).toBe(CoreContract.CoreError.CORE_ERROR_UNAUTHORIZED);
    expect(attempt_rows(m)).toEqual([]);
  });

  it('answers INTERNAL with an error log and counts nothing when the user transaction is FAILED', async () => {
    const m = await modules({ 'storage.userLockWaitMs': 200 });
    const user_id = await new_user(m);
    expect(await m.coupon.count_redeem_attempt(user_id, REQUEST, '203.0.113.7', 'r-first')).toBe('pass');
    const before = attempt_rows(m);
    // Another server instance holds the user lock (PostgreSQL) or the write transaction (SQLite) past the wait limit.
    const holder = await lock_holder(m.db);
    if (DB_KIND === 'postgresql') {
      await holder.ok('BEGIN');
      await holder.ok('SELECT user_id FROM "user" WHERE user_id = $1 FOR UPDATE', [user_id]);
    } else {
      await holder.ok('BEGIN IMMEDIATE');
    }
    expect(await m.coupon.count_redeem_attempt(user_id, REQUEST, '203.0.113.7', 'r-failed')).toBe(CoreContract.CoreError.CORE_ERROR_INTERNAL);
    await holder.ok('ROLLBACK');
    expect(attempt_rows(m)).toEqual(before);
    const errors = m.log_lines.map((line) => JSON.parse(line) as Record<string, unknown>).filter((line) => line['kind'] === 'error');
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatchObject({ user_id: String(user_id), request_id: 'r-failed', request: 'core/RedeemCoupon' });
  });

  it('starts a row of an earlier fixed window again from 1', async () => {
    const m = await modules();
    const user_id = await new_user(m);
    for (let i = 0; i < 3; i += 1) await m.coupon.count_redeem_attempt(user_id, REQUEST, '203.0.113.7', 'r-attempt');
    m.clock.advance(WINDOW_MS);
    expect(await m.coupon.count_redeem_attempt(user_id, REQUEST, '203.0.113.7', 'r-attempt')).toBe('pass');
    expect(attempt_rows(m)[0]?.['count']).toBe(1n);
  });

  it('writes the security log of RATE_LIMITED with the request ID and the truncated client IP', async () => {
    const m = await modules();
    const user_id = await new_user(m);
    for (let i = 0; i < 10; i += 1) expect(await m.coupon.count_redeem_attempt(user_id, REQUEST, '203.0.113.7', `r-${String(i)}`)).toBe('pass');
    expect(await m.coupon.count_redeem_attempt(user_id, REQUEST, '203.0.113.7', 'r-over')).toBe(CoreContract.CoreError.CORE_ERROR_RATE_LIMITED);
    const security = m.log_lines.map((line) => JSON.parse(line) as Record<string, unknown>).filter((line) => line['kind'] === 'security');
    expect(security).toHaveLength(1);
    expect(security[0]).toMatchObject({ user_id: String(user_id), request_id: 'r-over', request: 'core/RedeemCoupon', ip: '203.0.113.0', reason: 'rate_limited' });
  });
});
