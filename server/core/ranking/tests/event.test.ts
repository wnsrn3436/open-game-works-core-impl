import { as_user, at, BOARD, move_to, reward_mails, season_now, start, submit, testing, top, users, type Harness } from './support.ts';

/** Rounds of `[rk_weekend]`: round n from 2026-01-03 + 7(n − 1) days for 2 days. */
const ROUND1_START = at('2026-01-03T00:00:00Z');
const ROUND1_END = at('2026-01-05T00:00:00Z');
const ROUND2_START = at('2026-01-10T00:00:00Z');

let h: Harness;

afterEach(async () => {
  await testing.stop_test_server(h.server);
});

async function my_score(h: Harness, user_id: bigint): Promise<bigint> {
  return as_user(h, user_id, (ctx, ranking) => ranking.get_my_entry(ctx, BOARD.event()).score);
}

describe('ranking event board', () => {
  it('the season is the round that last started; a submission in a round goes to it; before the first round, at the round end and between rounds submit_score is SEASON_CLOSED', async () => {
    h = await start({ start_at: ROUND1_START - 1n });
    const [a] = await users(h, 1);
    const me = a.user_id;
    expect(await season_now(h, me, BOARD.event())).toEqual({ season: 0n, season_ends_at: 0n });
    expect(await submit(h, me, BOARD.event(), 5n)).toBe('SEASON_CLOSED');
    testing.set_time(h.server, ROUND1_START);
    expect(await season_now(h, me, BOARD.event())).toEqual({ season: 1n, season_ends_at: ROUND1_END });
    expect(await submit(h, me, BOARD.event(), 7n)).toBe('OK');
    testing.set_time(h.server, ROUND1_END);
    expect(await season_now(h, me, BOARD.event())).toEqual({ season: 1n, season_ends_at: ROUND1_END });
    expect(await submit(h, me, BOARD.event(), 9n)).toBe('SEASON_CLOSED');
    testing.set_time(h.server, ROUND1_END + 86_400_000n);
    expect(await submit(h, me, BOARD.event(), 9n)).toBe('SEASON_CLOSED');
    expect(await my_score(h, me)).toBe(7n);
  });

  it('the job after the round end sends the season reward by range; between rounds GetRankingTop gives the ended round; the next round starts empty and previous gives the round before', async () => {
    h = await start({ start_at: ROUND1_START + 1n });
    const [a, b] = await users(h, 2);
    await submit(h, a.user_id, BOARD.event(), 20n);
    await submit(h, b.user_id, BOARD.event(), 10n);
    await move_to(h, ROUND1_END);
    for (const s of [a, b]) expect((await reward_mails(h, s.user_id)).length).toBe(1);
    const between = await top(a, BOARD.event(), 0, 10);
    expect([between.season, between.season_ends_at]).toEqual([1n, ROUND1_END]);
    expect(between.entries.map((e) => e.score)).toEqual([20n, 10n]);
    await move_to(h, ROUND2_START);
    expect(await submit(h, b.user_id, BOARD.event(), 1n)).toBe('OK');
    const now = await top(a, BOARD.event(), 0, 10);
    expect(now.season).toBe(2n);
    expect(now.entries.map((e) => [e.user_id, e.score])).toEqual([[b.user_id, 1n]]);
    const prev = await top(a, BOARD.event(), 0, 10, true);
    expect([prev.season, prev.season_ends_at]).toEqual([1n, ROUND1_END]);
    expect(prev.entries.map((e) => e.score)).toEqual([20n, 10n]);
  });
});
