import * as CoreContract from '../../../generated/contract/core_contract.ts';
import type { DbHandle } from '../../storage/index.ts';
import type { SeasonReward, SeasonRewardHook } from '../index.ts';
import * as store from '../store.ts';
import {
  at,
  attachments,
  BOARD,
  DAY,
  fresh,
  HOUR,
  id,
  mail_args,
  modules_without,
  move_to,
  only,
  retry_rows,
  reward_mails,
  season_now,
  season_row,
  start,
  start_peer,
  stop_ranking,
  submit,
  testing,
  users,
  type Harness,
  type Sessions,
  type StartOptions,
  type TestSession,
} from './support.ts';

/** The day after T0: the daily season of T0 has ended. */
const NEXT_DAY = at('2026-01-06T00:00:00Z');
const LEASE_MS = 300_000n;

let h: Harness;
const peers: Harness['server'][] = [];

afterEach(async () => {
  for (const peer of peers.splice(0)) await testing.stop_test_server(peer);
  await testing.stop_test_server(h.server);
});

function gold(amount: bigint): CoreContract.ItemAmount {
  return Object.assign(new CoreContract.ItemAmount(), { item_id: id('[rk_gold]'), amount });
}

/** Starts a server with the hook (when given) and ranked users: user i has score 100 − i on the daily board. */
async function ranked(count: number, hook: SeasonRewardHook | null, options: StartOptions = {}): Promise<{ sessions: Sessions; season: bigint }> {
  h = await start({
    ...options,
    register: (core) => {
      if (hook !== null) core.routing.register_hook('ranking', 'ranking_season_reward', hook);
    },
  });
  const sessions = await users(h, count);
  for (const [i, s] of sessions.entries()) await submit(h, s.user_id, BOARD.daily(), BigInt(100 - i));
  return { sessions, season: (await season_now(h, sessions[0].user_id, BOARD.daily())).season };
}

async function mail_counts(sessions: readonly TestSession[]): Promise<number[]> {
  const out: number[] = [];
  for (const s of sessions) out.push((await reward_mails(h, s.user_id)).length);
  return out;
}

/** A hook giving gold of the rank, that runs `on_call` at its n-th call (1-based). */
function counting_hook(n: number, on_call: () => void): { hook: SeasonRewardHook; calls: bigint[] } {
  const calls: bigint[] = [];
  const hook: SeasonRewardHook = (ctx, _board, _season, _end, entry): SeasonReward => {
    calls.push(ctx.user_id);
    if (calls.length === n) on_call();
    return { attachments: [gold(BigInt(entry.rank))], extra_id: 0 };
  };
  return { hook, calls };
}

describe('ranking season reward', () => {
  it('sends the ranking_reward of each rank range once by mail with the integer args rank and season, and a job run again sends nothing more', async () => {
    const { sessions, season } = await ranked(6, null);
    await move_to(h, NEXT_DAY);
    expect(await mail_counts(sessions)).toEqual([1, 1, 1, 0, 0, 0]);
    const first = only(await reward_mails(h, sessions[0].user_id));
    expect(attachments(first)).toEqual([[id('[rk_gold]'), 100n]]);
    expect(mail_args(first)).toEqual([
      ['rank', 1n],
      ['season', season],
    ]);
    expect(first.args.every((a) => a.kind === CoreContract.MailArgKind.MAIL_ARG_KIND_INT)).toBe(true);
    expect(attachments(only(await reward_mails(h, sessions[2].user_id)))).toEqual([[id('[rk_gold]'), 50n]]);
    await move_to(h, NEXT_DAY + DAY);
    expect(await mail_counts(sessions)).toEqual([1, 1, 1, 0, 0, 0]);
    expect(season_row(h, BOARD.daily(), season)?.status).toBe('Closed');
  });

  it('sends the result of a registered ranking_season_reward hook', async () => {
    const seen: [number, bigint, bigint, number][] = [];
    const { sessions, season } = await ranked(2, (_ctx, board, s, end, entry) => {
      seen.push([board, s, end, entry.rank]);
      return { attachments: [gold(7n)], extra_id: 0 };
    });
    await move_to(h, NEXT_DAY);
    expect(seen).toEqual([
      [BOARD.daily(), season, NEXT_DAY, 1],
      [BOARD.daily(), season, NEXT_DAY, 2],
    ]);
    expect(attachments(only(await reward_mails(h, sessions[1].user_id)))).toEqual([[id('[rk_gold]'), 7n]]);
  });

  it('a hook list longer than mailbox.maxAttachments goes in one mail per part, the first with extra_id, the others with once_key <k>', async () => {
    const extra = id('[rk_gold]');
    // One mail takes an item once, so the parts are of different items. Without `rating`, whose start check stops a
    // server below mailbox.maxAttachments 3 on the core test data, and `matchmaker`, which does not start without it.
    const items = ['[rk_gold]', '[gold]', '[big_gold]', '[admin_gold]', '[testing_gold]'].map((name, i) => Object.assign(new CoreContract.ItemAmount(), { item_id: id(name), amount: BigInt(i + 1) }));
    const { sessions, season } = await ranked(1, () => ({ attachments: items, extra_id: extra }), { settings: { 'mailbox.maxAttachments': 2 }, server_modules: modules_without('rating', 'matchmaker') });
    await move_to(h, NEXT_DAY);
    const mails = await reward_mails(h, sessions[0].user_id);
    expect(mails.map((m) => attachments(m).map(([, a]) => a))).toEqual([[1n, 2n], [3n, 4n], [5n]]);
    expect(mails.map((m) => m.extra_id)).toEqual([extra, 0, 0]);
    const keys = h
      .core()
      .storage.read_db()
      .query('SELECT once_key FROM mailbox_once_key WHERE user_id = $1 ORDER BY once_key', [sessions[0].user_id])
      .map((r) => r.once_key);
    const base = `ranking:${String(BOARD.daily())}:${String(season)}`;
    expect(keys).toEqual([base, `${base}:2`, `${base}:3`]);
    await testing.restart_test_server(h.server);
    await move_to(h, NEXT_DAY + DAY);
    expect((await reward_mails(h, sessions[0].user_id)).length).toBe(3);
  });

  it('a job stopped in the middle and started again sends no second mail, counts no ALREADY_SENT as failed, and keeps the ranks', async () => {
    const restart = { promise: null as Promise<unknown> | null };
    const { hook, calls } = counting_hook(2, () => {
      restart.promise = testing.restart_test_server(h.server);
    });
    const { sessions, season } = await ranked(5, hook);
    testing.set_time(h.server, NEXT_DAY);
    while (restart.promise === null) await new Promise((resolve) => setImmediate(resolve));
    await restart.promise;
    await move_to(h, NEXT_DAY + LEASE_MS + 1n);
    expect(await mail_counts(sessions)).toEqual([1, 1, 1, 1, 1]);
    for (const [i, s] of sessions.entries()) expect(mail_args(only(await reward_mails(h, s.user_id)))[0]).toEqual(['rank', BigInt(i + 1)]);
    expect(calls.length).toBeGreaterThanOrEqual(5);
    const row = season_row(h, BOARD.daily(), season);
    expect([row?.status, row?.failed_count]).toEqual(['Closed', 0n]);
  });

  it('a user above the processed ranks who withdraws while the season is Closing does not make the next user skip a rank', async () => {
    const restart = { promise: null as Promise<unknown> | null };
    const { hook } = counting_hook(2, () => {
      restart.promise = testing.restart_test_server(h.server);
    });
    const { sessions } = await ranked(4, hook);
    testing.set_time(h.server, NEXT_DAY);
    while (restart.promise === null) await new Promise((resolve) => setImmediate(resolve));
    await restart.promise;
    const { response } = await testing.send(await fresh(sessions[0]), 'core/Withdraw', new CoreContract.WithdrawRequest());
    expect(response).not.toBeNull();
    await move_to(h, NEXT_DAY + LEASE_MS + 1n);
    for (const [i, s] of sessions.slice(1).entries()) {
      const mails = await reward_mails(h, s.user_id);
      expect(mails.length).toBe(1);
      expect(mail_args(only(mails))[0]).toEqual(['rank', BigInt(i + 2)]);
    }
  });

  it('a FAILED user gets a retry row and the season is Retrying; the job after next_attempt_at sends one mail, removes the row and closes the season', async () => {
    let fail = true;
    const { sessions, season } = await ranked(3, (ctx, _b, _s, _e, entry) => {
      if (fail && entry.rank === 2) throw new Error('reward store is down');
      return { attachments: [gold(1n)], extra_id: 0 };
    });
    await move_to(h, NEXT_DAY);
    const target = sessions[1].user_id;
    expect(await mail_counts(sessions)).toEqual([1, 0, 1]);
    const rows = retry_rows(h, BOARD.daily(), season);
    expect(rows.map((r) => [r.user_id, r.attempts, r.next_attempt_at])).toEqual([[target, 0, NEXT_DAY + 60_000n]]);
    expect(season_row(h, BOARD.daily(), season)?.status).toBe('Retrying');
    expect(testing.read_logs(h.server, 'error').filter((l) => l.message === 'season reward failed').length).toBe(1);
    fail = false;
    await move_to(h, NEXT_DAY + 60_000n);
    expect(await mail_counts(sessions)).toEqual([1, 1, 1]);
    expect(retry_rows(h, BOARD.daily(), season)).toEqual([]);
    expect(season_row(h, BOARD.daily(), season)?.status).toBe('Closed');
    await move_to(h, NEXT_DAY + 2n * 60_000n);
    expect(await mail_counts(sessions)).toEqual([1, 1, 1]);
  });

  it('retries that keep FAILED wait g(attempts) up to the max interval and are given up after rewardRetryMaxAttempts', async () => {
    const { sessions, season } = await ranked(1, () => {
      throw new Error('always down');
    }, {
      settings: {
        'ranking.seasonCheckIntervalMs': 1_000,
        'ranking.rewardRetryInitialMs': 1_000,
        'ranking.rewardRetryFactorPermille': 2_000,
        'ranking.rewardRetryMaxIntervalMs': 5_000,
        'ranking.rewardRetryMaxAttempts': 4,
      },
    });
    await move_to(h, NEXT_DAY);
    let now = NEXT_DAY;
    const intervals: bigint[] = [];
    for (;;) {
      const row = retry_rows(h, BOARD.daily(), season)[0];
      if (row === undefined) break;
      const next = row.next_attempt_at as bigint;
      intervals.push(next - now);
      now = next;
      await move_to(h, now);
    }
    expect(intervals).toEqual([1_000n, 2_000n, 4_000n, 5_000n]);
    const closed = season_row(h, BOARD.daily(), season);
    expect([closed?.status, closed?.failed_count]).toEqual(['Closed', 1n]);
    expect(await mail_counts(sessions)).toEqual([0]);
    const errors = testing.read_logs(h.server, 'error').map((l) => l.message);
    expect(errors.filter((m) => m === 'season reward failed').length).toBe(1);
    expect(errors).toContain('season reward given up');
    expect(errors).toContain('season closed with rewards given up');
  });

  it('a REJECTED user goes into failed_count without a retry row', async () => {
    const { sessions, season } = await ranked(2, (_ctx, _b, _s, _e, entry) => ({
      attachments: [entry.rank === 1 ? Object.assign(new CoreContract.ItemAmount(), { item_id: 999_999, amount: 1n }) : gold(1n)],
      extra_id: 0,
    }));
    await move_to(h, NEXT_DAY);
    expect(await mail_counts(sessions)).toEqual([0, 1]);
    expect(retry_rows(h, BOARD.daily(), season)).toEqual([]);
    const row = season_row(h, BOARD.daily(), season);
    expect([row?.status, row?.failed_count]).toEqual(['Closed', 1n]);
    expect(testing.read_logs(h.server, 'error').some((l) => l.message === 'season reward rejected')).toBe(true);
  });

  it('a server stopped before seasons end and restarted several seasons later sends each ended season with scores once per user', async () => {
    const { sessions, season } = await ranked(2, null, { settings: { 'ranking.seasonCheckIntervalMs': 100 * Number(DAY) } });
    testing.set_time(h.server, NEXT_DAY + HOUR);
    for (const [i, s] of sessions.entries()) await submit(h, s.user_id, BOARD.daily(), BigInt(10 + i));
    testing.set_time(h.server, NEXT_DAY + 5n * DAY);
    await testing.restart_test_server(h.server);
    await testing.wait_background(h.server);
    const seasons = async (user_id: bigint): Promise<bigint[]> => (await reward_mails(h, user_id)).map((m) => m.args.find((a) => a.name === 'season')?.int_value ?? -1n).sort();
    expect(await seasons(sessions[0].user_id)).toEqual([season, season + 1n]);
    expect(await seasons(sessions[1].user_id)).toEqual([season, season + 1n]);
  });

  it('two server instances that take the lease of one season at once: one takes it, and every user gets one mail with its rank', async () => {
    let peer_ready = false;
    const { hook } = counting_hook(2, () => {
      if (peer_ready) testing.advance_time(h.server, 10_001n);
    });
    const { sessions, season } = await ranked(5, hook, { settings: { 'ranking.seasonJobLeaseMs': 10_000, 'ranking.seasonCheckIntervalMs': 1_000 } });
    const peer = await start_peer(h);
    peers.push(peer);
    peer_ready = true;
    testing.set_time(h.server, NEXT_DAY);
    await Promise.all([testing.wait_background(h.server), testing.wait_background(peer)]);
    testing.advance_time(h.server, 20_001n);
    await Promise.all([testing.wait_background(h.server), testing.wait_background(peer)]);
    expect(await mail_counts(sessions)).toEqual([1, 1, 1, 1, 1]);
    for (const [i, s] of sessions.entries()) expect(mail_args(only(await reward_mails(h, s.user_id)))[0]).toEqual(['rank', BigInt(i + 1)]);
    const row = season_row(h, BOARD.daily(), season);
    expect([row?.status, row?.cursor_rank]).toEqual(['Closed', 5]);
  });

  it('an instance whose lease another instance took writes no cursor and makes no more hook calls; the new holder goes on from the cursor', async () => {
    const taken_until = NEXT_DAY + 2n * LEASE_MS;
    const calls: { rank: number; cursor_rank: number }[] = [];
    // In its second call, the lease goes to another owner through `take_lease`, the statement the job of another
    // instance runs. It goes in the user's transaction, since SQLite takes no other write while that one is open.
    const hook: SeasonRewardHook = (ctx, board, s, _end, entry) => {
      calls.push({ rank: entry.rank, cursor_rank: Number(season_row(h, board, s)?.cursor_rank ?? -1) });
      if (calls.length === 2) {
        const db = h.core().storage.db(ctx);
        const seen = store.read_season(db, board, s);
        if (seen === null || store.take_lease(db, seen, 'other', taken_until) === null) throw new Error('the lease was not taken');
      }
      return { attachments: [gold(BigInt(entry.rank))], extra_id: 0 };
    };
    const { sessions, season } = await ranked(5, hook);
    await move_to(h, NEXT_DAY);
    // The earlier holder stopped at rank 2: no third call, and the row is as the other owner left it.
    expect(calls).toEqual([
      { rank: 1, cursor_rank: 0 },
      { rank: 2, cursor_rank: 1 },
    ]);
    const kept = season_row(h, BOARD.daily(), season);
    expect([kept?.status, kept?.cursor_rank, kept?.failed_count, kept?.lease_owner, kept?.lease_until_at]).toEqual(['Closing', 1, 0n, 'other', taken_until]);
    // Past the other owner's lease, the next holder goes on from rank 2 and the cursor does not go back.
    await move_to(h, taken_until);
    expect(calls.slice(2).map((c) => [c.rank, c.cursor_rank])).toEqual([
      [2, 1],
      [3, 2],
      [4, 3],
      [5, 4],
    ]);
    expect(await mail_counts(sessions)).toEqual([1, 1, 1, 1, 1]);
    for (const [i, s] of sessions.entries()) expect(mail_args(only(await reward_mails(h, s.user_id)))[0]).toEqual(['rank', BigInt(i + 1)]);
    const row = season_row(h, BOARD.daily(), season);
    expect([row?.status, row?.cursor_rank, row?.failed_count]).toEqual(['Closed', 5, 0n]);
  });
});

/** The `error` log lines of `ranking`'s job `ranking_season`, as [message, reason]. */
function ranking_errors(): [unknown, unknown][] {
  return testing
    .read_logs(h.server, 'error')
    .filter((l) => /^(season |job ranking_season)/.test(String(l.message)))
    .map((l) => [l.message, l.reason]);
}

describe('job ranking_season after stop', () => {
  it('a user\'s reward FAILED after ranking stop() began, under its open transaction, is not logged; the same failure before stop is', async () => {
    // Rank 1 fails before stop. At rank 2, stop() begins inside the user's open transaction, which then fails as one
    // under a DB connection closed by the server stop does.
    const { season } = await ranked(3, (_ctx, _b, _s, _e, entry) => {
      if (entry.rank === 1) throw new Error('reward store is down');
      if (entry.rank === 2) {
        stop_ranking(h);
        throw new Error('the DB connection is closed');
      }
      return { attachments: [gold(1n)], extra_id: 0 };
    });
    await move_to(h, NEXT_DAY);
    expect(ranking_errors()).toEqual([['season reward failed', 'reward store is down']]);
    // The job ends at the stop: rank 2's FAILED writes nothing and rank 3 is not processed.
    expect(season_row(h, BOARD.daily(), season)?.cursor_rank).toBe(1);
  });

  it('a job failure that comes after ranking stop() began is not logged; the same failure before stop is', async () => {
    const { season } = await ranked(2, null);
    // Every cursor write throws an error that is not a DB failure, as a statement on a closed DB connection does.
    const storage = h.core().storage;
    const db = storage.db.bind(storage);
    const stop = { now: false };
    let thrown = 0;
    storage.db = (ctx_or_tx) => {
      const handle = db(ctx_or_tx);
      const wrapped = Object.create(handle) as DbHandle;
      wrapped.query = (statement, params) => {
        if (statement.startsWith(`UPDATE ${store.SEASON_TABLE} SET cursor_score`)) {
          thrown += 1;
          if (stop.now) stop_ranking(h);
          throw new Error('the DB connection is closed');
        }
        return handle.query(statement, params);
      };
      return wrapped;
    };
    await move_to(h, NEXT_DAY);
    expect([thrown, ranking_errors()]).toEqual([1, [['job ranking_season: the DB connection is closed', undefined]]]);
    // Ranking stop() begins under the cursor write of the next lease holder, which then throws.
    stop.now = true;
    await move_to(h, NEXT_DAY + LEASE_MS + 1n);
    expect(thrown).toBe(2);
    expect(ranking_errors()).toEqual([['job ranking_season: the DB connection is closed', undefined]]);
    expect(season_row(h, BOARD.daily(), season)?.status).toBe('Closing');
  });

  it('a ranking stop() that begins under the lease transaction ends the pass without closing the season; the next holder rewards every rank', async () => {
    const { sessions, season } = await ranked(3, null);
    // Ranking stop() begins inside the transaction of `take_lease`, which then commits as storage is still open.
    const storage = h.core().storage;
    const db = storage.db.bind(storage);
    storage.db = (ctx_or_tx) => {
      const handle = db(ctx_or_tx);
      const wrapped = Object.create(handle) as DbHandle;
      wrapped.query = (statement, params) => {
        if (statement.startsWith(`UPDATE ${store.SEASON_TABLE} SET lease_owner`)) stop_ranking(h);
        return handle.query(statement, params);
      };
      return wrapped;
    };
    await move_to(h, NEXT_DAY);
    const kept = season_row(h, BOARD.daily(), season);
    expect([kept?.status, kept?.cursor_rank, kept?.failed_count]).toEqual(['Closing', 0, 0n]);
    expect(await mail_counts(sessions)).toEqual([0, 0, 0]);
    await testing.restart_test_server(h.server);
    await move_to(h, NEXT_DAY + LEASE_MS + 1n);
    expect(await mail_counts(sessions)).toEqual([1, 1, 1]);
    const row = season_row(h, BOARD.daily(), season);
    expect([row?.status, row?.cursor_rank, row?.failed_count]).toEqual(['Closed', 3, 0n]);
  });

  it.each([1, 3])('a reward retry FAILED after ranking stop() began writes nothing to its retry row (rewardRetryMaxAttempts %i); the next holder retries it', async (max_attempts) => {
    const mode = { now: 'fail' as 'fail' | 'stop' | 'send' };
    const { sessions, season } = await ranked(1, () => {
      if (mode.now === 'stop') stop_ranking(h);
      if (mode.now !== 'send') throw new Error('the DB connection is closed');
      return { attachments: [gold(1n)], extra_id: 0 };
    }, { settings: { 'ranking.rewardRetryMaxAttempts': max_attempts } });
    const user_id = sessions[0].user_id;
    await move_to(h, NEXT_DAY);
    const first = [[user_id, 0, NEXT_DAY + 60_000n]];
    const retries = (): unknown[][] => retry_rows(h, BOARD.daily(), season).map((r) => [r.user_id, r.attempts, r.next_attempt_at]);
    expect(retries()).toEqual(first);
    // Ranking stop() begins inside the retry's open user transaction, which then fails as one under a DB connection
    // closed by the server stop does.
    mode.now = 'stop';
    await move_to(h, NEXT_DAY + 60_000n);
    expect(retries()).toEqual(first);
    const kept = season_row(h, BOARD.daily(), season);
    expect([kept?.status, kept?.failed_count]).toEqual(['Retrying', 0n]);
    mode.now = 'send';
    await testing.restart_test_server(h.server);
    await move_to(h, NEXT_DAY + 60_000n + LEASE_MS + 1n);
    expect(await mail_counts(sessions)).toEqual([1]);
    expect(retries()).toEqual([]);
    const row = season_row(h, BOARD.daily(), season);
    expect([row?.status, row?.failed_count]).toEqual(['Closed', 0n]);
    expect(testing.read_logs(h.server, 'error').map((l) => l.message)).not.toContain('season closed with rewards given up');
  });

  it.each([0, 1])('a first-pass reward FAILED after ranking stop() began moves no cursor, counts no failure and puts no retry row (rewardRetryMaxAttempts %i); the next holder rewards every rank', async (max_attempts) => {
    const mode = { now: 'stop' as 'stop' | 'send' };
    // Ranking stop() begins inside rank 1's open user transaction, which then fails as one under a DB connection
    // closed by the server stop does; storage still commits the game transactions after it.
    const { sessions, season } = await ranked(2, (_ctx, _b, _s, _e, entry) => {
      if (mode.now === 'stop' && entry.rank === 1) {
        stop_ranking(h);
        throw new Error('the DB connection is closed');
      }
      return { attachments: [gold(1n)], extra_id: 0 };
    }, { settings: { 'ranking.rewardRetryMaxAttempts': max_attempts } });
    await move_to(h, NEXT_DAY);
    const kept = season_row(h, BOARD.daily(), season);
    expect([kept?.status, kept?.cursor_rank, kept?.failed_count]).toEqual(['Closing', 0, 0n]);
    expect(retry_rows(h, BOARD.daily(), season)).toEqual([]);
    expect(await mail_counts(sessions)).toEqual([0, 0]);
    mode.now = 'send';
    await testing.restart_test_server(h.server);
    await move_to(h, NEXT_DAY + LEASE_MS + 1n);
    expect(await mail_counts(sessions)).toEqual([1, 1]);
    const row = season_row(h, BOARD.daily(), season);
    expect([row?.status, row?.cursor_rank, row?.failed_count]).toEqual(['Closed', 2, 0n]);
    expect(ranking_errors()).toEqual([]);
  });
});
