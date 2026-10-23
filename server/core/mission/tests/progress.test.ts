import { set_time } from '../../testing/dev/index.ts';
import { C, CODE, M, MAX_SAFE, REJECTED, add, add_ids, at, claim, code_of, new_user, progress, start, stop_all, stored } from './support.ts';

afterEach(stop_all);

const by_id = (a: number, b: number): number => a - b;

describe('add_progress', () => {
  it('changes only the missions of its counter; Sum adds, Max keeps the larger value, and both stop at target', async () => {
    const s = await start();
    const u = await new_user(s);
    const sum_missions = [M.sum_daily, M.sum_weekly, M.sum_monthly, M.sum_forever].sort(by_id);

    expect(await add_ids(u, C.sum, 3n)).toEqual(sum_missions);
    for (const m of sum_missions) expect(await progress(u, m)).toEqual({ progress: 3n, claimed: false });
    expect(await progress(u, M.max)).toEqual({ progress: 0n, claimed: false });
    expect(await progress(u, M.other)).toEqual({ progress: 0n, claimed: false });
    expect(await stored(s, u, M.max)).toBeNull();

    expect(await add_ids(u, C.sum, 4n)).toEqual(sum_missions);
    expect(await progress(u, M.sum_daily)).toEqual({ progress: 7n, claimed: false });
    expect(await add_ids(u, C.sum, 100n)).toEqual(sum_missions);
    expect(await progress(u, M.sum_daily)).toEqual({ progress: 10n, claimed: false });
    expect(await add_ids(u, C.sum, 1n)).toEqual([]);
    expect((await stored(s, u, M.sum_forever))?.progress).toBe(10n);

    expect(await add_ids(u, C.max, 4n)).toEqual([M.max]);
    expect(await add_ids(u, C.max, 2n)).toEqual([]);
    expect(await progress(u, M.max)).toEqual({ progress: 4n, claimed: false });
    expect(await add_ids(u, C.max, 7n)).toEqual([M.max]);
    expect(await progress(u, M.max)).toEqual({ progress: 7n, claimed: false });
    expect(await add_ids(u, C.max, 50n)).toEqual([M.max]);
    expect(await progress(u, M.max)).toEqual({ progress: 10n, claimed: false });

    expect(await add_ids(u, C.unused, 5n)).toEqual([]);
    expect(await progress(u, M.other)).toEqual({ progress: 0n, claimed: false });
  });

  it('takes an amount over 2^53-1 as 2^53-1 without throwing', async () => {
    const s = await start();
    const big = await new_user(s);
    const safe = await new_user(s);
    for (const counter of [C.sum, C.max]) {
      const over = await add_ids(big, counter, 2n ** 62n);
      const edge = await add_ids(safe, counter, MAX_SAFE);
      expect(over).toEqual(edge);
      expect(typeof over).not.toBe('number');
    }
    for (const m of [M.sum_daily, M.sum_forever, M.max]) {
      expect(await progress(big, m)).toEqual(await progress(safe, m));
      const a = await stored(s, big, m);
      const b = await stored(s, safe, m);
      expect({ progress: a?.progress, claimed: a?.claimed, reset_at: a?.reset_at, event_round: a?.event_round })
        .toEqual({ progress: b?.progress, claimed: b?.claimed, reset_at: b?.reset_at, event_round: b?.event_round });
    }
  });

  it('takes an integer number amount over 2^53-1 as 2^53-1 and throws only for a number that is not an integer', async () => {
    const s = await start();
    const big = await new_user(s);
    const safe = await new_user(s);
    for (const counter of [C.sum, C.max]) {
      const over = await add_ids(big, counter, 2 ** 60);
      expect(over).toEqual(await add_ids(safe, counter, MAX_SAFE));
      expect(typeof over).not.toBe('number');
    }
    for (const m of [M.sum_daily, M.sum_forever, M.max]) {
      expect(await progress(big, m)).toEqual(await progress(safe, m));
      expect((await stored(s, big, m))?.progress).toBe((await stored(s, safe, m))?.progress);
    }

    const u = await new_user(s);
    for (const amount of [1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(await add_ids(u, C.sum, amount)).toBe(CODE.CORE_ERROR_INTERNAL);
    }
    expect(await stored(s, u, M.sum_daily)).toBeNull();
    expect(await add_ids(u, C.sum, 3)).toEqual([M.sum_daily, M.sum_weekly, M.sum_monthly, M.sum_forever].sort(by_id));
    expect(await progress(u, M.sum_daily)).toEqual({ progress: 3n, claimed: false });
  });

  it('throws on an unknown counter and an amount below 1, so the request is INTERNAL', async () => {
    const s = await start();
    const u = await new_user(s);
    expect(await add_ids(u, 2_000_000_000, 1n)).toBe(CODE.CORE_ERROR_INTERNAL);
    expect(await add_ids(u, C.sum, 0n)).toBe(CODE.CORE_ERROR_INTERNAL);
    expect(await add_ids(u, C.sum, -5n)).toBe(CODE.CORE_ERROR_INTERNAL);
    expect(await stored(s, u, M.sum_daily)).toBeNull();
  });

  it('does not change a mission outside its active window or a claimed mission', async () => {
    const s = await start();
    const u = await new_user(s);

    expect(await add_ids(u, C.window, 1n)).toEqual([]);
    expect(await stored(s, u, M.window)).toBeNull();
    set_time(s.server, at(2027, 1, 1, 12));
    expect(await add_ids(u, C.window, 1n)).toEqual([M.window]);
    set_time(s.server, at(2027, 1, 2));
    expect(await add_ids(u, C.window, 1n)).toEqual([]);
    expect(await progress(u, M.window)).toEqual({ progress: 1n, claimed: false });

    expect(await add_ids(u, C.other, 5n)).toEqual([M.other]);
    expect(code_of(await claim(u, M.other))).toBe(0);
    expect(await add_ids(u, C.other, 3n)).toEqual([]);
    expect(await progress(u, M.other)).toEqual({ progress: 5n, claimed: true });
  });

  it('rolls back the progress when the handler ends with a GameError after add_progress', async () => {
    const s = await start();
    const u = await new_user(s);
    const failed = await add(u, C.sum, 4n, true);
    expect(code_of(failed)).toBe(REJECTED);
    expect(await stored(s, u, M.sum_daily)).toBeNull();
    expect(await progress(u, M.sum_daily)).toEqual({ progress: 0n, claimed: false });

    expect(await add_ids(u, C.sum, 2n)).toHaveLength(4);
    expect(code_of(await add(u, C.sum, 4n, true))).toBe(REJECTED);
    expect(await progress(u, M.sum_daily)).toEqual({ progress: 2n, claimed: false });
  });

  it('reads an unknown mission as (0, false)', async () => {
    const s = await start();
    const u = await new_user(s);
    expect(await progress(u, 2_000_000_000)).toEqual({ progress: 0n, claimed: false });
  });
});
