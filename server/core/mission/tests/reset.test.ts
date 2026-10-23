import { set_time } from '../../testing/dev/index.ts';
import {
  C, CODE, GOLD, M, add_ids, at, balance, claim, code_of, new_user, next_reset, progress, set_progress, start, stop_all, stored,
} from './support.ts';

afterEach(stop_all);

const START = at(2026, 12, 2, 12);

describe('reset', () => {
  it('stores reset_at as get_next_reset of the reset cycle and the request time, and 0 for a mission without reset', async () => {
    const s = await start({ start_at: START });
    const u = await new_user(s);
    await add_ids(u, C.sum, 1n);
    expect((await stored(s, u, M.sum_daily))?.reset_at).toBe(next_reset('Daily', START));
    expect((await stored(s, u, M.sum_weekly))?.reset_at).toBe(next_reset('Weekly', START));
    expect((await stored(s, u, M.sum_monthly))?.reset_at).toBe(next_reset('Monthly', START));
    expect((await stored(s, u, M.sum_forever))?.reset_at).toBe(0n);
    expect(next_reset('Daily', START)).toBe(at(2026, 12, 3, 4));
    expect(next_reset('Weekly', START)).toBe(at(2026, 12, 7, 4));
    expect(next_reset('Monthly', START)).toBe(at(2027, 1, 1, 4));
  });

  it('keeps progress just before each reset time and reads (0, false) from the first read after it; a mission without reset keeps it', async () => {
    const s = await start({ start_at: START });
    const u = await new_user(s);
    await add_ids(u, C.sum, 5n);
    const kept = { progress: 5n, claimed: false };
    const zero = { progress: 0n, claimed: false };

    for (const [mission, cycle] of [[M.sum_daily, 'Daily'], [M.sum_weekly, 'Weekly'], [M.sum_monthly, 'Monthly']] as const) {
      const reset_at = next_reset(cycle, START);
      set_time(s.server, reset_at - 1n);
      expect(await progress(u, mission)).toEqual(kept);
      set_time(s.server, reset_at);
      expect(await progress(u, mission)).toEqual(zero);
      expect(await progress(u, M.sum_forever)).toEqual(kept);
    }
    set_time(s.server, at(2028, 6, 1));
    expect(await progress(u, M.sum_forever)).toEqual(kept);
  });

  it('cannot claim twice before the reset and claims again after it', async () => {
    const s = await start({ start_at: START });
    const u = await new_user(s);
    await add_ids(u, C.sum, 10n);
    expect(code_of(await claim(u, M.sum_daily))).toBe(0);
    expect(code_of(await claim(u, M.sum_daily))).toBe(CODE.CORE_ERROR_MISSION_ALREADY_CLAIMED);
    expect(await balance(s, u, GOLD)).toBe(100n);

    set_time(s.server, next_reset('Daily', START));
    expect(await progress(u, M.sum_daily)).toEqual({ progress: 0n, claimed: false });
    expect(code_of(await claim(u, M.sum_daily))).toBe(CODE.CORE_ERROR_MISSION_NOT_COMPLETED);
    await add_ids(u, C.sum, 10n);
    expect(code_of(await claim(u, M.sum_daily))).toBe(0);
    expect(await balance(s, u, GOLD)).toBe(200n);
  });

  it('resets a mission of a repeating live event per round and claims it again in the next round with another once_key', async () => {
    const round1 = at(2027, 2, 1, 1);
    const s = await start({ start_at: round1 });
    const u = await new_user(s);
    expect(await add_ids(u, C.event, 2n)).toEqual([M.event]);
    expect(code_of(await claim(u, M.event))).toBe(0);
    expect(await balance(s, u, GOLD)).toBe(7n);
    expect((await stored(s, u, M.event))?.event_round).toBe(1);

    set_time(s.server, at(2027, 2, 4));
    expect(await progress(u, M.event)).toEqual({ progress: 2n, claimed: true });
    expect(await add_ids(u, C.event, 2n)).toEqual([]);
    expect(code_of(await claim(u, M.event))).toBe(CODE.CORE_ERROR_MISSION_UNAVAILABLE);

    set_time(s.server, at(2027, 2, 8, 1));
    expect(await progress(u, M.event)).toEqual({ progress: 0n, claimed: false });
    expect(await add_ids(u, C.event, 2n)).toEqual([M.event]);
    expect((await stored(s, u, M.event))?.event_round).toBe(2);
    expect(code_of(await claim(u, M.event))).toBe(0);
    expect(await balance(s, u, GOLD)).toBe(14n);
  });
});

describe('SetMissionProgress', () => {
  it('sets the progress, writes reset_at as get_next_reset of the request time, and a Daily mission resets after it', async () => {
    const s = await start({ start_at: START });
    const u = await new_user(s);
    expect(code_of(await set_progress(u, M.sum_daily, 7n, true))).toBe(0);
    const row = await stored(s, u, M.sum_daily);
    expect({ progress: row?.progress, claimed: row?.claimed, reset_at: row?.reset_at })
      .toEqual({ progress: 7n, claimed: true, reset_at: next_reset('Daily', START) });
    expect(await progress(u, M.sum_daily)).toEqual({ progress: 7n, claimed: true });

    set_time(s.server, next_reset('Daily', START));
    expect(await progress(u, M.sum_daily)).toEqual({ progress: 0n, claimed: false });

    expect(code_of(await set_progress(u, M.sum_forever, 4n, false))).toBe(0);
    expect((await stored(s, u, M.sum_forever))?.reset_at).toBe(0n);
    expect(await progress(u, M.sum_forever)).toEqual({ progress: 4n, claimed: false });
  });

  it('is INVALID_REQUEST for a progress over target and changes nothing', async () => {
    const s = await start({ start_at: START });
    const u = await new_user(s);
    expect(code_of(await set_progress(u, M.sum_daily, 11n, false))).toBe(CODE.CORE_ERROR_INVALID_REQUEST);
    expect(await stored(s, u, M.sum_daily)).toBeNull();
  });

  it('ignores the active window and writes the round of the live event', async () => {
    const s = await start({ start_at: at(2027, 2, 8, 1) });
    const u = await new_user(s);
    expect(code_of(await set_progress(u, M.window, 3n, false))).toBe(0);
    expect(await progress(u, M.window)).toEqual({ progress: 3n, claimed: false });
    expect(code_of(await set_progress(u, M.event, 1n, false))).toBe(0);
    expect((await stored(s, u, M.event))?.event_round).toBe(2);
  });
});
