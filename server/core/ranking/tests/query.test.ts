import * as CoreCheatContract from '../../../dev/generated/contract/core_cheat_contract.ts';
import * as CoreContract from '../../../generated/contract/core_contract.ts';
import { around, as_user, BOARD, DAY, missing, scores, season_now, start, submit, testing, top, top_error, users, type Harness } from './support.ts';

let h: Harness;

afterEach(async () => {
  await testing.stop_test_server(h.server);
});

const INVALID_REQUEST = CoreContract.CoreError.CORE_ERROR_INVALID_REQUEST;

async function set_nickname(session: Awaited<ReturnType<typeof testing.login>>, nickname: string): Promise<void> {
  const { response } = await testing.send(session, 'core/SetNickname', Object.assign(new CoreContract.SetNicknameRequest(), { nickname }));
  expect(response).not.toBeNull();
}

describe('ranking query', () => {
  it('GetRankingTop gives the same result within the cache time and the new score after it', async () => {
    h = await start({ settings: { 'ranking.topCacheMs': 10_000 } });
    const [a, b] = await users(h, 2);
    await submit(h, a.user_id, BOARD.sum(), 10n);
    const first = await top(a, BOARD.sum(), 0, 10);
    await submit(h, b.user_id, BOARD.sum(), 20n);
    testing.advance_time(h.server, 9_999n);
    expect(scores((await top(a, BOARD.sum(), 0, 10)).entries)).toEqual(scores(first.entries));
    testing.advance_time(h.server, 1n);
    expect(scores((await top(a, BOARD.sum(), 0, 10)).entries)).toEqual([
      [b.user_id, 20n],
      [a.user_id, 10n],
    ]);
  });

  it('a GetRankingTop cache miss drops the entries past topCacheMs and puts its key last', async () => {
    h = await start({ settings: { 'ranking.topCacheMs': 10_000 } });
    const [a] = await users(h, 1);
    await submit(h, a.user_id, BOARD.sum(), 10n);
    const keys = (): number[] => [...h.core().ranking.dev_core.top_cache.keys()].map((k) => Number(k.split(':')[2]));
    await top(a, BOARD.sum(), 0, 1);
    testing.advance_time(h.server, 5_000n);
    await top(a, BOARD.sum(), 1, 1);
    expect(keys()).toEqual([0, 1]);
    testing.advance_time(h.server, 5_000n);
    await top(a, BOARD.sum(), 0, 1);
    expect(keys()).toEqual([1, 0]);
    testing.advance_time(h.server, 5_000n);
    await top(a, BOARD.sum(), 2, 1);
    expect(keys()).toEqual([0, 2]);
  });

  it('pages join into one page, stop at size, and limit 0 and over maxPageSize are INVALID_REQUEST', async () => {
    h = await start({ settings: { 'ranking.maxPageSize': 4 } });
    const sessions = await users(h, 7);
    for (const [i, s] of sessions.entries()) await submit(h, s.user_id, BOARD.daily(), BigInt(10 + i));
    const viewer = sessions[0];
    const one = await top(viewer, BOARD.daily(), 0, 2);
    const two = await top(viewer, BOARD.daily(), 2, 2);
    const both = await top(viewer, BOARD.daily(), 0, 4);
    expect(scores([...one.entries, ...two.entries])).toEqual(scores(both.entries));
    expect((await top(viewer, BOARD.daily(), 4, 4)).entries.map((e) => e.rank)).toEqual([5]);
    expect((await top(viewer, BOARD.daily(), 5, 4)).entries).toEqual([]);
    expect((await top(viewer, BOARD.daily(), 9, 4)).entries).toEqual([]);
    expect(await top_error(viewer, BOARD.daily(), 0, 0)).toBe(INVALID_REQUEST);
    expect(await top_error(viewer, BOARD.daily(), 0, 5)).toBe(INVALID_REQUEST);
    expect(await top_error(viewer, 999_999, 0, 1)).toBe(INVALID_REQUEST);
  });

  it('GetRankingAround gives aroundCount entries before and after me', async () => {
    h = await start({ settings: { 'ranking.aroundCount': 2 } });
    const sessions = await users(h, 8);
    for (const [i, s] of sessions.entries()) await submit(h, s.user_id, BOARD.sum(), BigInt(100 - i));
    const res = await around(sessions[4], BOARD.sum());
    expect(res.my_entry?.rank).toBe(5);
    expect(res.entries.map((e) => e.rank)).toEqual([3, 4, 6, 7]);
    const first = await around(sessions[0], BOARD.sum());
    expect(first.entries.map((e) => e.rank)).toEqual([2, 3]);
    const [stranger] = await users(h, 1, 'x');
    const none = await around(stranger, BOARD.sum());
    expect(none.my_entry?.rank).toBe(0);
    expect(none.my_entry?.score).toBe(0n);
    expect(none.entries).toEqual([]);
  });

  it.skipIf(missing('nickname'))('shows the new nickname after SetNickname and rename_user, keeping the display of the score row', async () => {
    h = await start({ settings: { 'ranking.topCacheMs': 10_000 } });
    const [a, b] = await users(h, 2);
    await set_nickname(a, 'alpha');
    await submit(h, a.user_id, BOARD.sum(), 10n, 'hero');
    await submit(h, b.user_id, BOARD.sum(), 5n);
    expect((await top(b, BOARD.sum(), 0, 10)).entries[0]?.nickname).toBe('alpha');
    const renamed = await testing.send_admin(h.server, 'rename_user', { operation_id: crypto.randomUUID(), user_id: String(a.user_id), nickname: 'beta', reason: 'test' });
    expect(renamed.status).toBe(200);
    const mine = await around(b, BOARD.sum());
    expect(mine.entries.find((e) => e.user_id === a.user_id)?.nickname).toBe('beta');
    expect((await top(b, BOARD.sum(), 0, 10)).entries[0]?.nickname).toBe('alpha');
    testing.advance_time(h.server, 10_000n);
    const after = (await top(b, BOARD.sum(), 0, 10)).entries[0];
    expect(after?.nickname).toBe('beta');
    expect(after?.display).toBe('hero');
    expect((await as_user(h, a.user_id, (ctx, ranking) => ranking.get_my_entry(ctx, BOARD.sum()))).nickname).toBe('');
  });

  it('the season end time of a board without cycle and live_event is 0', async () => {
    h = await start();
    const [a] = await users(h, 1);
    await submit(h, a.user_id, BOARD.sum(), 1n);
    const res = await top(a, BOARD.sum(), 0, 10);
    expect([res.season, res.season_ends_at]).toEqual([0n, 0n]);
    const prev = await top(a, BOARD.sum(), 0, 10, true);
    expect([prev.season, prev.season_ends_at, prev.entries.length]).toEqual([0n, 0n, 0]);
    const arr = await around(a, BOARD.sum());
    expect([arr.season, arr.season_ends_at]).toEqual([0n, 0n]);
  });

  it('season and season_ends_at of a user with a cheat time offset are those get_season gives at the same time', async () => {
    h = await start();
    const [a] = await users(h, 1);
    const offset = Object.assign(new CoreCheatContract.SetTimeOffsetRequest(), { offset_ms: 3n * DAY });
    await testing.send_cheat(a, 'core/cheat/SetTimeOffset', offset);
    const s = await season_now(h, a.user_id, BOARD.daily());
    const t = await top(a, BOARD.daily(), 0, 10);
    const r = await around(a, BOARD.daily());
    expect([t.season, t.season_ends_at]).toEqual([s.season, s.season_ends_at]);
    expect([r.season, r.season_ends_at]).toEqual([s.season, s.season_ends_at]);
  });
});
