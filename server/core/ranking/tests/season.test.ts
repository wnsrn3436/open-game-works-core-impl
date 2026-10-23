import * as CoreContract from '../../../generated/contract/core_contract.ts';
import { as_user, at, BOARD, DAY, HOUR, in_request, move_to, season_now, start, submit, testing, top, users, type Harness } from './support.ts';

let h: Harness;

afterEach(async () => {
  await testing.stop_test_server(h.server);
});

describe('ranking season', () => {
  it('a submission just before the season boundary goes to the old season, just after to the new one', async () => {
    const boundary = at('2026-01-06T00:00:00Z');
    h = await start({ start_at: boundary - 1n });
    const [a] = await users(h, 1);
    const before = await season_now(h, a.user_id, BOARD.daily());
    expect(before.season_ends_at).toBe(boundary);
    await submit(h, a.user_id, BOARD.daily(), 10n);
    testing.set_time(h.server, boundary);
    const after = await season_now(h, a.user_id, BOARD.daily());
    expect(after.season).toBe(before.season + 1n);
    await submit(h, a.user_id, BOARD.daily(), 3n);
    const now = await top(a, BOARD.daily(), 0, 10);
    expect(now.entries.map((e) => e.score)).toEqual([3n]);
    const prev = await top(a, BOARD.daily(), 0, 10, true);
    expect(prev.season).toBe(before.season);
    expect(prev.entries.map((e) => e.score)).toEqual([10n]);
  });

  it('Weekly changes at the start of a Monday game day and Monthly at the start of a 1st, by dailyResetOffsetMs', async () => {
    const offset = 3n * HOUR;
    const monday = at('2026-01-12T00:00:00Z') + offset;
    h = await start({ start_at: monday - 1n, settings: { dailyResetOffsetMs: Number(offset) } });
    const [a] = await users(h, 1);
    const week = await season_now(h, a.user_id, BOARD.weekly());
    expect(week.season_ends_at).toBe(monday);
    testing.set_time(h.server, monday);
    expect((await season_now(h, a.user_id, BOARD.weekly())).season).toBe(week.season + 1n);
    const first = at('2026-02-01T00:00:00Z') + offset;
    testing.set_time(h.server, first - 1n);
    const month = await season_now(h, a.user_id, BOARD.monthly());
    expect(month.season_ends_at).toBe(first);
    testing.set_time(h.server, first);
    expect((await season_now(h, a.user_id, BOARD.monthly())).season).toBe(month.season + 1n);
    testing.set_time(h.server, first + 2n * DAY);
    expect((await season_now(h, a.user_id, BOARD.monthly())).season).toBe(month.season + 1n);
  });

  it('get_season gives the season and end time that a submission at the same time takes; 0 and 0 without seasons; UNKNOWN_BOARD for an unknown board', async () => {
    h = await start();
    const [a] = await users(h, 1);
    const s = await season_now(h, a.user_id, BOARD.daily());
    await submit(h, a.user_id, BOARD.daily(), 5n);
    const res = await top(a, BOARD.daily(), 0, 10);
    expect([res.season, res.season_ends_at]).toEqual([s.season, s.season_ends_at]);
    expect(await season_now(h, a.user_id, BOARD.sum())).toEqual({ season: 0n, season_ends_at: 0n });
    expect(await as_user(h, a.user_id, (ctx, ranking) => ranking.get_season(ctx, 999_999))).toBe('UNKNOWN_BOARD');
    await testing.call_dev(h.server, 'ranking', 'close_season_now', [BOARD.daily()], a.user_id);
    expect((await season_now(h, a.user_id, BOARD.daily())).season).toBe(s.season + 1n);
  });

  it('get_my_entry of a board ID value not in ranking_board throws, and a request calling it is INTERNAL', async () => {
    h = await start();
    const [a] = await users(h, 1);
    await expect(as_user(h, a.user_id, (ctx, ranking) => ranking.get_my_entry(ctx, 999_999))).rejects.toThrow();
    const done = await in_request(h, a, (ctx, ranking) => ranking.get_my_entry(ctx, 999_999));
    expect(done).toEqual({ code: CoreContract.CoreError.CORE_ERROR_INTERNAL });
    expect(testing.read_logs(h.server, 'error').some((l) => String(l.request).endsWith('RunCoreTest'))).toBe(true);
  });

  it('a new season starts with no score', async () => {
    h = await start();
    const [a] = await users(h, 1);
    await submit(h, a.user_id, BOARD.daily(), 5n);
    await move_to(h, at('2026-01-06T00:00:00Z'));
    expect((await top(a, BOARD.daily(), 0, 10)).entries).toEqual([]);
  });
});
