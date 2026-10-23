import * as testing from '../../testing/dev/index.ts';
import { E, create, redeem, start, user, type TestServer } from './helpers.ts';

const WINDOW_MS = 60_000n;
const servers: TestServer[] = [];

async function server(max_attempts: number): Promise<TestServer> {
  const started = await start(undefined, { 'coupon.attemptWindowMs': Number(WINDOW_MS), 'coupon.maxAttemptsPerWindow': max_attempts });
  servers.push(started);
  return started;
}

afterEach(async () => {
  for (const s of servers.splice(0)) await testing.stop_test_server(s);
});

describe('redeem attempt limit', () => {
  it('answers RATE_LIMITED for the right code past coupon.maxAttemptsPerWindow, counting failed attempts, and takes it in the next fixed window', async () => {
    const s = await server(3);
    await create(s, { code: 'RIGHT1' });
    const session = await user(s);
    for (let i = 0; i < 3; i += 1) expect((await redeem(session, `WRONG${String(i)}`)).code).toBe(E.CORE_ERROR_COUPON_INVALID);
    expect((await redeem(session, 'RIGHT1')).code).toBe(E.CORE_ERROR_RATE_LIMITED);
    const security = testing.read_logs(s, 'security').filter((line) => line['reason'] === 'rate_limited' && String(line['user_id']) === String(session.user_id));
    expect(security).toHaveLength(1);
    testing.advance_time(s, WINDOW_MS);
    expect((await redeem(session, 'RIGHT1')).code).toBe(0);
  });

  it('counts per user', async () => {
    const s = await server(1);
    await create(s, { code: 'RIGHT2' });
    const a = await user(s);
    const b = await user(s);
    expect((await redeem(a, 'WRONG')).code).toBe(E.CORE_ERROR_COUPON_INVALID);
    expect((await redeem(a, 'RIGHT2')).code).toBe(E.CORE_ERROR_RATE_LIMITED);
    expect((await redeem(b, 'RIGHT2')).code).toBe(0);
  });

  it('writes the security log of RATE_LIMITED through routing with that request ID and the truncated client IP', async () => {
    const s = await server(1);
    await create(s, { code: 'RIGHT4' });
    const session = await user(s);
    expect((await redeem(session, 'WRONG')).code).toBe(E.CORE_ERROR_COUPON_INVALID);
    const request_id = crypto.randomUUID();
    expect((await redeem(session, 'RIGHT4', request_id)).code).toBe(E.CORE_ERROR_RATE_LIMITED);
    const security = testing.read_logs(s, 'security').filter((line) => line['reason'] === 'rate_limited' && String(line['user_id']) === String(session.user_id));
    expect(security).toHaveLength(1);
    // The test client connects to 127.0.0.1, and a LOCAL server takes the TCP peer address as the client IP.
    expect(security[0]).toMatchObject({ request_id, request: 'core/RedeemCoupon', ip: '127.0.0.0' });
  });

  it('does not count a RedeemCoupon sent again with the same request ID', async () => {
    const s = await server(2);
    await create(s, { code: 'RIGHT3' });
    const session = await user(s);
    const request_id = crypto.randomUUID();
    const first = await redeem(session, 'RIGHT3', request_id);
    expect(first.code).toBe(0);
    const again = await redeem(session, 'RIGHT3', request_id);
    expect(again.code).toBe(0);
    expect(again.envelope.body).toEqual(first.envelope.body);
    expect((await redeem(session, 'WRONG')).code).toBe(E.CORE_ERROR_COUPON_INVALID);
    expect((await redeem(session, 'WRONG')).code).toBe(E.CORE_ERROR_RATE_LIMITED);
  });
});
