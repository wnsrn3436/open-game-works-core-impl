import { as_user, BOARD, count_rows, reward_mails, season_now, season_row, start, submit, testing, top, users, type Harness, T0 } from './support.ts';
import { create_ranking_dev } from '../dev/index.ts';

let h: Harness;

afterEach(async () => {
  await testing.stop_test_server(h.server);
});

describe('ranking close_season_now', () => {
  it('close_season_now by call_dev with a user ID does not throw; after wait_background the closed season is rewarded, the current season starts empty, previous gives the closed season, and the current end time stays', async () => {
    h = await start();
    const [a, b] = await users(h, 2);
    await submit(h, a.user_id, BOARD.daily(), 10n);
    await submit(h, b.user_id, BOARD.daily(), 5n);
    const before = await season_now(h, a.user_id, BOARD.daily());
    await testing.call_dev(h.server, 'ranking', 'close_season_now', [BOARD.daily()], a.user_id);
    await testing.wait_background(h.server);
    expect((await reward_mails(h, a.user_id)).length).toBe(1);
    expect((await reward_mails(h, b.user_id)).length).toBe(1);
    const now = await top(a, BOARD.daily(), 0, 10);
    expect(now.entries).toEqual([]);
    expect([now.season, now.season_ends_at]).toEqual([before.season + 1n, before.season_ends_at]);
    const prev = await top(a, BOARD.daily(), 0, 10, true);
    expect(prev.season).toBe(before.season);
    expect(prev.entries.map((e) => e.score)).toEqual([10n, 5n]);
  });

  it('a closed season of close_season_now ends at the close time, and its scores go once its end + seasonRetentionMs is reached', async () => {
    const retention = 7_200_000n;
    h = await start({ settings: { 'ranking.seasonRetentionMs': Number(retention), 'ranking.seasonCheckIntervalMs': 1 } });
    const [a] = await users(h, 1);
    await submit(h, a.user_id, BOARD.daily(), 10n);
    const closed = await season_now(h, a.user_id, BOARD.daily());
    await testing.call_dev(h.server, 'ranking', 'close_season_now', [BOARD.daily()], a.user_id);
    await testing.wait_background(h.server);
    const prev = await top(a, BOARD.daily(), 0, 10, true);
    expect(prev.season_ends_at).toBe(T0);
    testing.set_time(h.server, T0 + retention - 1n);
    await testing.wait_background(h.server);
    expect(count_rows(h, 'ranking_score', BOARD.daily(), closed.season)).toBe(1);
    testing.set_time(h.server, T0 + retention);
    await testing.wait_background(h.server);
    expect(count_rows(h, 'ranking_score', BOARD.daily(), closed.season)).toBe(0);
    expect(season_row(h, BOARD.daily(), closed.season)).toBeNull();
  });

  it('when the transaction of close_season_now rolls back, the season shift and the season state stay and no reward goes', async () => {
    h = await start();
    const [a] = await users(h, 1);
    await submit(h, a.user_id, BOARD.daily(), 10n);
    const before = await season_now(h, a.user_id, BOARD.daily());
    const dev = create_ranking_dev(h.core().ranking);
    const result = await h.core().storage.run_user_transaction(a.user_id, (ctx) => {
      dev.close_season_now(ctx, BOARD.daily());
      return 1;
    });
    expect(result).toBe('REJECTED');
    await testing.wait_background(h.server);
    expect(await season_now(h, a.user_id, BOARD.daily())).toEqual(before);
    expect(season_row(h, BOARD.daily(), before.season)?.status).toBe('Open');
    expect((await reward_mails(h, a.user_id)).length).toBe(0);
  });

  it('close_season_now of a board without cycle, and of an event board, changes no score or season and logs warn', async () => {
    h = await start();
    const [a] = await users(h, 1);
    await submit(h, a.user_id, BOARD.sum(), 10n);
    for (const board of [BOARD.sum(), BOARD.event()]) {
      const before = await season_now(h, a.user_id, board);
      await testing.call_dev(h.server, 'ranking', 'close_season_now', [board], a.user_id);
      expect(await season_now(h, a.user_id, board)).toEqual(before);
    }
    expect((await top(a, BOARD.sum(), 0, 10)).entries.map((e) => e.score)).toEqual([10n]);
    expect(testing.read_logs(h.server, 'core', 'warn').filter((l) => String(l.message).startsWith('close_season_now')).length).toBe(2);
    expect(await as_user(h, a.user_id, (ctx, ranking) => ranking.get_my_entry(ctx, BOARD.sum()).score)).toBe(10n);
  });
});
