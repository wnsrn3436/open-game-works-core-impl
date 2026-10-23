/**
 * Guild board tests. They run only when `guild` is in the server module list: the core test data has the guild
 * boards (`[rk_guild_daily]`, `[rk_guild_best]`, `[rk_guild_event]`) only then.
 */
import * as CoreContract from '../../../generated/contract/core_contract.ts';
import type { SeasonRewardHook } from '../index.ts';
import {
  around,
  as_user,
  at,
  BOARD,
  create_guild,
  fresh,
  in_request,
  id,
  join_guild,
  leave_guild,
  missing,
  modules_without,
  move_to,
  retry_rows,
  reward_mails,
  season_now,
  season_row,
  start,
  stop_ranking,
  submit,
  submit_guild,
  testing,
  top,
  users,
  type Harness,
} from './support.ts';

const NEXT_DAY = at('2026-01-06T00:00:00Z');
const LEASE_MS = 300_000n;

let h: Harness;

afterEach(async () => {
  await testing.stop_test_server(h.server);
});

function guild_score(h: Harness, board_id: number, guild_id: bigint): bigint | null {
  const row = h.core().storage.read_db().query('SELECT score FROM ranking_guild_score WHERE board_id = $1 AND guild_id = $2', [board_id, guild_id])[0];
  return row === undefined ? null : (row.score as bigint);
}

describe('ranking guild board', () => {
  it.skipIf(missing('guild'))('submit_guild_score adds for Sum and keeps a better score for Best; Sum scores two members submit at the same time are both kept', async () => {
    h = await start();
    const [a, b] = await users(h, 2);
    const g = await create_guild(a, 'guildone');
    await join_guild(b, g);
    await Promise.all([submit_guild(h, a.user_id, BOARD.guild_daily(), g, 4n), submit_guild(h, b.user_id, BOARD.guild_daily(), g, 6n)]);
    expect(guild_score(h, BOARD.guild_daily(), g)).toBe(10n);
    await submit_guild(h, a.user_id, BOARD.guild_best(), g, 8n);
    await submit_guild(h, a.user_id, BOARD.guild_best(), g, 3n);
    expect(guild_score(h, BOARD.guild_best(), g)).toBe(8n);
    await submit_guild(h, a.user_id, BOARD.guild_best(), g, 9n);
    expect(guild_score(h, BOARD.guild_best(), g)).toBe(9n);
  });

  it.skipIf(missing('guild'))('submit_guild_score of a user board and submit_score of a guild board are ENTITY_MISMATCH, an unknown guild is UNKNOWN_GUILD, and the score stays', async () => {
    h = await start();
    const [a] = await users(h, 1);
    const g = await create_guild(a, 'guildtwo');
    expect(await submit_guild(h, a.user_id, BOARD.daily(), g, 1n)).toBe('ENTITY_MISMATCH');
    expect(await submit(h, a.user_id, BOARD.guild_daily(), 1n)).toBe('ENTITY_MISMATCH');
    expect(await submit_guild(h, a.user_id, BOARD.guild_daily(), g + 1000n, 1n)).toBe('UNKNOWN_GUILD');
    expect(guild_score(h, BOARD.guild_daily(), g)).toBeNull();
    expect(guild_score(h, BOARD.guild_daily(), g + 1000n)).toBeNull();
    expect(await as_user(h, a.user_id, (ctx, ranking) => ranking.get_my_entry(ctx, BOARD.daily()).score)).toBe(0n);
  });

  it.skipIf(missing('guild'))('a lock wait over the limit on the guild row makes submit_guild_score throw and the request INTERNAL, and the score stays', async () => {
    h = await start();
    const [a] = await users(h, 1);
    const g = await create_guild(a, 'guildlock');
    await submit_guild(h, a.user_id, BOARD.guild_daily(), g, 2n);
    // The login before the hold: on SQLite the hold holds back every write transaction, a login's too.
    const session = await fresh(a);
    const release = await testing.hold_game_row_lock(h.server, 'guild_guild', [g]);
    try {
      const done = await in_request(h, session, (ctx, ranking) => ranking.submit_guild_score(ctx, BOARD.guild_daily(), g, 5n), false);
      expect(done).toEqual({ code: CoreContract.CoreError.CORE_ERROR_INTERNAL });
    } finally {
      await release();
    }
    expect(guild_score(h, BOARD.guild_daily(), g)).toBe(2n);
  });

  it.skipIf(missing('guild'))('the event guild board takes a guild score only while a round is active (SEASON_CLOSED before the first round, at the round end and between rounds)', async () => {
    const round1_start = at('2026-01-03T00:00:00Z');
    const round1_end = at('2026-01-05T00:00:00Z');
    h = await start({ start_at: round1_start - 1n });
    const [a] = await users(h, 1);
    const g = await create_guild(a, 'eventguild');
    expect(await submit_guild(h, a.user_id, BOARD.guild_event(), g, 5n)).toBe('SEASON_CLOSED');
    testing.set_time(h.server, round1_start);
    expect(await submit_guild(h, a.user_id, BOARD.guild_event(), g, 7n)).toBe('OK');
    testing.set_time(h.server, round1_end);
    expect(await submit_guild(h, a.user_id, BOARD.guild_event(), g, 9n)).toBe('SEASON_CLOSED');
    testing.set_time(h.server, round1_end + 86_400_000n);
    expect(await submit_guild(h, a.user_id, BOARD.guild_event(), g, 9n)).toBe('SEASON_CLOSED');
    expect(guild_score(h, BOARD.guild_event(), g)).toBe(7n);
  });

  it.skipIf(missing('guild'))('GetRankingTop of a guild board has guild_id, the current guild_name and user_id 0, earlier first on a tie; GetRankingAround is my guild, rank 0 and empty for a non-member', async () => {
    h = await start();
    const [a, b, c] = await users(h, 3);
    const g1 = await create_guild(a, 'guildalpha');
    await submit_guild(h, a.user_id, BOARD.guild_best(), g1, 5n);
    testing.advance_time(h.server, 1000n);
    const g2 = await create_guild(b, 'guildbeta');
    await submit_guild(h, b.user_id, BOARD.guild_best(), g2, 5n);
    const res = await top(c, BOARD.guild_best(), 0, 10);
    expect(res.entries.map((e) => [e.rank, e.guild_id, e.guild_name, e.user_id])).toEqual([
      [1, g1, 'guildalpha', 0n],
      [2, g2, 'guildbeta', 0n],
    ]);
    const mine = await around(b, BOARD.guild_best());
    expect([mine.my_entry?.rank, mine.my_entry?.guild_id]).toEqual([2, g2]);
    expect(mine.entries.map((e) => e.guild_id)).toEqual([g1]);
    const none = await around(c, BOARD.guild_best());
    expect([none.my_entry?.rank, none.my_entry?.guild_id, none.entries.length]).toEqual([0, 0n, 0]);
  });

  it.skipIf(missing('guild'))('disbanding a guild removes its ranking_guild_score rows of every season', async () => {
    h = await start();
    const [a] = await users(h, 1);
    const g = await create_guild(a, 'guildgone');
    await submit_guild(h, a.user_id, BOARD.guild_daily(), g, 3n);
    await move_to(h, NEXT_DAY);
    await submit_guild(h, a.user_id, BOARD.guild_daily(), g, 4n);
    await submit_guild(h, a.user_id, BOARD.guild_best(), g, 4n);
    await leave_guild(a);
    expect(h.core().storage.read_db().query('SELECT * FROM ranking_guild_score WHERE guild_id = $1', [g])).toEqual([]);
  });

  it.skipIf(missing('guild'))('the reward of an ended guild board season goes once by mail to each member at processing time; the hook gets the guild entry and the season end; a job stopped in a member list sends no second mail', async () => {
    const seen: [bigint, bigint, bigint][] = [];
    const restart = { promise: null as Promise<unknown> | null };
    const hook: SeasonRewardHook = (ctx, _board, _season, end, entry) => {
      seen.push([ctx.user_id, entry.guild_id, end]);
      if (seen.length === 2 && restart.promise === null) restart.promise = testing.restart_test_server(h.server);
      return { attachments: [Object.assign(new CoreContract.ItemAmount(), { item_id: id('[rk_gold]'), amount: 1n })], extra_id: 0 };
    };
    h = await start({
      register: (core) => {
        core.routing.register_hook('ranking', 'ranking_season_reward', hook);
      },
    });
    const [a, b, c, d] = await users(h, 4);
    const g = await create_guild(a, 'guildprize');
    await join_guild(b, g);
    await join_guild(c, g);
    await submit_guild(h, a.user_id, BOARD.guild_daily(), g, 10n);
    await join_guild(d, g);
    testing.set_time(h.server, NEXT_DAY);
    while (restart.promise === null) await new Promise((resolve) => setImmediate(resolve));
    await restart.promise;
    await move_to(h, NEXT_DAY + LEASE_MS + 1n);
    for (const s of [a, b, c, d]) expect((await reward_mails(h, s.user_id)).length).toBe(1);
    expect(seen.every(([, guild, end]) => guild === g && end === NEXT_DAY)).toBe(true);
  });

  it.skipIf(missing('guild'))('a member\'s reward FAILED after ranking stop() began ends the guild processing without a failure, a retry row or a cursor move; the next holder rewards every member once', async () => {
    const mode = { now: 'stop' as 'stop' | 'send' };
    const calls: bigint[] = [];
    // Ranking stop() begins inside the first member's open user transaction, which then fails as one under a DB
    // connection closed by the server stop does; storage still commits the game transactions after it.
    const hook: SeasonRewardHook = (ctx) => {
      calls.push(ctx.user_id);
      if (mode.now === 'stop' && calls.length === 1) {
        stop_ranking(h);
        throw new Error('the DB connection is closed');
      }
      return { attachments: [Object.assign(new CoreContract.ItemAmount(), { item_id: id('[rk_gold]'), amount: 1n })], extra_id: 0 };
    };
    h = await start({
      settings: { 'ranking.rewardRetryMaxAttempts': 0 },
      register: (core) => {
        core.routing.register_hook('ranking', 'ranking_season_reward', hook);
      },
    });
    const [a, b] = await users(h, 2);
    const g = await create_guild(a, 'guildstop');
    await join_guild(b, g);
    await submit_guild(h, a.user_id, BOARD.guild_daily(), g, 10n);
    const { season } = await season_now(h, a.user_id, BOARD.guild_daily());
    await move_to(h, NEXT_DAY);
    expect(calls).toHaveLength(1);
    const kept = season_row(h, BOARD.guild_daily(), season);
    expect([kept?.status, kept?.cursor_rank, kept?.failed_count]).toEqual(['Closing', 0, 0n]);
    expect(retry_rows(h, BOARD.guild_daily(), season)).toEqual([]);
    mode.now = 'send';
    await testing.restart_test_server(h.server);
    await move_to(h, NEXT_DAY + LEASE_MS + 1n);
    for (const s of [a, b]) expect((await reward_mails(h, s.user_id)).length).toBe(1);
    const row = season_row(h, BOARD.guild_daily(), season);
    expect([row?.status, row?.cursor_rank, row?.failed_count]).toEqual(['Closed', 1, 0n]);
  });

  it.skipIf(missing('guild'))('a server does not start with a guild board in the data and guild not a server module', async () => {
    await expect(start({ server_modules: modules_without('guild') })).rejects.toThrow();
    h = await start();
  });
});
