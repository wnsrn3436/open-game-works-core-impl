import * as CoreContract from '../../../generated/contract/core_contract.ts';
import { around, as_user, at, BOARD, id, move_to, retry_rows, reward_mails, season_now, start, submit, testing, top, users, type Harness } from './support.ts';

const NEXT_DAY = at('2026-01-06T00:00:00Z');

let h: Harness;

afterEach(async () => {
  await testing.stop_test_server(h.server);
});

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
    expect(retry_rows(h, BOARD.daily(), season).map((r) => r.user_id)).toEqual([a.user_id, b.user_id]);
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
