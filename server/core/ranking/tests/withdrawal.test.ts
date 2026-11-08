import * as CoreContract from '../../../generated/contract/core_contract.ts';
import { around, as_user, at, BOARD, id, move_to, retry_rows, reward_mails, season_now, start, start_peer, submit, T0, testing, top, users, type Harness } from './support.ts';

const NEXT_DAY = at('2026-01-06T00:00:00Z');
const TOP_CACHE_MS = 10_000n;

let h: Harness;
const peers: Harness['server'][] = [];

afterEach(async () => {
  for (const peer of peers.splice(0)) await testing.stop_test_server(peer);
  await testing.stop_test_server(h.server);
});

/** The user IDs of the `GetRankingTop` entries of the `Sum` board, offset 0 and limit 10. */
async function top_users(session: Awaited<ReturnType<typeof testing.login>>): Promise<bigint[]> {
  return (await top(session, BOARD.sum(), 0, 10)).entries.map((e) => e.user_id);
}

describe('ranking withdrawal and retention', () => {
  it('after remove_user the user is in no query result and no season reward, and has no retry row', async () => {
    let fail = true;
    h = await start({
      register: (core) => {
        core.routing.register_hook('ranking', 'ranking_season_reward', () => {
          if (fail) throw new Error('down');
          return { attachments: [Object.assign(new CoreContract.ItemAmount(), { item_id: id('[rk_gold]'), amount: 1n })], extra_id: 0 };
        });
      },
    });
    const [a, b] = await users(h, 2);
    await submit(h, a.user_id, BOARD.daily(), 10n);
    await submit(h, b.user_id, BOARD.daily(), 5n);
    await submit(h, a.user_id, BOARD.sum(), 10n);
    const season = (await season_now(h, a.user_id, BOARD.daily())).season;
    await move_to(h, NEXT_DAY);
    // Retry rows are in user ID order, and random user IDs need not follow a, b.
    expect(retry_rows(h, BOARD.daily(), season).map((r) => r.user_id)).toEqual([a.user_id, b.user_id].sort((x, y) => (x < y ? -1 : 1)));
    await as_user(h, a.user_id, (ctx, ranking) => ranking.remove_user(ctx));
    expect(retry_rows(h, BOARD.daily(), season).map((r) => r.user_id)).toEqual([b.user_id]);
    expect((await top(b, BOARD.sum(), 0, 10)).entries).toEqual([]);
    expect((await top(b, BOARD.daily(), 0, 10, true)).entries.map((e) => e.user_id)).toEqual([b.user_id]);
    expect((await around(a, BOARD.sum())).my_entry?.rank).toBe(0);
    fail = false;
    await move_to(h, NEXT_DAY + 60_000n);
    expect((await reward_mails(h, a.user_id)).length).toBe(0);
    expect((await reward_mails(h, b.user_id)).length).toBe(1);
  });

  it('a GetRankingTop that the server instance running remove_user cached before the removal no longer holds that user', async () => {
    h = await start({ settings: { 'ranking.topCacheMs': Number(TOP_CACHE_MS) } });
    const [a, b] = await users(h, 2);
    await submit(h, a.user_id, BOARD.sum(), 10n);
    await submit(h, b.user_id, BOARD.sum(), 5n);
    testing.set_time(h.server, T0 + 1_000n);
    expect(await top_users(b)).toEqual([a.user_id, b.user_id]);
    await as_user(h, a.user_id, (ctx, ranking) => ranking.remove_user(ctx));
    await testing.wait_background(h.server);
    // Within topCacheMs of the cached query, the same (board, offset, limit) on the same instance.
    expect(await top_users(b)).toEqual([b.user_id]);
    testing.set_time(h.server, T0 + 1_000n + TOP_CACHE_MS - 1n);
    expect(await top_users(b)).toEqual([b.user_id]);
  });

  it('a GetRankingTop that another server instance cached before the removal no longer holds that user topCacheMs after it was cached', async () => {
    h = await start({ settings: { 'ranking.topCacheMs': Number(TOP_CACHE_MS) } });
    const [a, b] = await users(h, 2);
    await submit(h, a.user_id, BOARD.sum(), 10n);
    await submit(h, b.user_id, BOARD.sum(), 5n);
    const peer = await start_peer(h);
    peers.push(peer);
    const cached_at = T0 + 1_000n;
    testing.set_time(h.server, cached_at);
    expect(await top_users(await testing.login(peer, 'u1'))).toEqual([a.user_id, b.user_id]);
    // remove_user runs on the test server's instance, not on the peer that cached the query.
    await as_user(h, a.user_id, (ctx, ranking) => ranking.remove_user(ctx));
    await testing.wait_background(h.server);
    expect(await top_users(b)).toEqual([b.user_id]);
    // A read of the peer inside the cache time may still hold the user; it does not keep the entry past its time.
    testing.set_time(h.server, cached_at + TOP_CACHE_MS / 2n);
    await top_users(await testing.login(peer, 'u1'));
    testing.set_time(h.server, cached_at + TOP_CACHE_MS);
    expect(await top_users(await testing.login(peer, 'u1'))).toEqual([b.user_id]);
  });

  it('admin-api export_personal_data has the ranking_score rows of the user', async () => {
    h = await start();
    const [a] = await users(h, 1);
    await submit(h, a.user_id, BOARD.sum(), 42n, 'tag');
    const res = await testing.send_admin(h.server, 'export_personal_data', { user_id: String(a.user_id) }, 'ogw');
    expect(res.status).toBe(200);
    const rows = JSON.stringify(res.json);
    expect(rows).toContain('ranking_score');
    expect(rows).toContain('"42"');
  });

  it('a season past seasonRetentionMs goes and the previous query is empty', async () => {
    const retention = 3_600_000n;
    h = await start({ settings: { 'ranking.seasonRetentionMs': Number(retention), 'ranking.seasonCheckIntervalMs': 1, 'ranking.topCacheMs': 0 } });
    const [a] = await users(h, 1);
    await submit(h, a.user_id, BOARD.daily(), 10n);
    await move_to(h, NEXT_DAY + retention - 1n);
    expect((await top(a, BOARD.daily(), 0, 10, true)).entries.length).toBe(1);
    await move_to(h, NEXT_DAY + retention);
    expect((await top(a, BOARD.daily(), 0, 10, true)).entries).toEqual([]);
  });
});
