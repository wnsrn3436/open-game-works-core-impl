import { CODE, DAY, START_AT, new_user, request_time, run_cheat, server, set_time_offset, stop_all, stored_offset } from './support.ts';

afterEach(stop_all);

const MAX = 1n << 63n;
const SET = 'core/cheat/SetTimeOffset';

describe('SetTimeOffset', () => {
  it('puts clock + offset into the request time of the next requests and replaces the offset', async () => {
    const s = await server();
    const user = await new_user(s);
    const other = await new_user(s);
    expect((await run_cheat(s, user, SET, set_time_offset(DAY))).code).toBe(0);
    expect(await request_time(s, user)).toBe(START_AT + DAY);
    expect((await run_cheat(s, user, SET, set_time_offset(DAY))).code).toBe(0);
    expect(await request_time(s, user)).toBe(START_AT + DAY);
    expect((await run_cheat(s, user, SET, set_time_offset(-5_000n))).code).toBe(0);
    s.clock.advance(1_000n);
    expect(await request_time(s, user)).toBe(START_AT + 1_000n - 5_000n);
    expect(await request_time(s, other)).toBe(START_AT + 1_000n);
    expect((await run_cheat(s, user, SET, set_time_offset(0n))).code).toBe(0);
    expect(await request_time(s, user)).toBe(START_AT + 1_000n);
  });

  it('answers INVALID_REQUEST when clock + offset is below 0 or 2^63 or more, and keeps the offset', async () => {
    const s = await server();
    const user = await new_user(s);
    expect((await run_cheat(s, user, SET, set_time_offset(DAY))).code).toBe(0);
    for (const offset of [-START_AT - 1n, MAX - START_AT, -MAX, MAX - 1n]) {
      expect((await run_cheat(s, user, SET, set_time_offset(offset))).code).toBe(CODE.CORE_ERROR_INVALID_REQUEST);
      expect(stored_offset(s, user)).toBe(DAY);
    }
    expect((await run_cheat(s, user, SET, set_time_offset(-START_AT))).code).toBe(0);
    expect(await request_time(s, user)).toBe(0n);
    expect((await run_cheat(s, user, SET, set_time_offset(MAX - 1n - START_AT))).code).toBe(0);
    expect(await request_time(s, user)).toBe(MAX - 1n);
  });
});
