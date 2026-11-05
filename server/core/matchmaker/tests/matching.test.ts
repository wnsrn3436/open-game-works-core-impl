/** `### matching` and `### match creation` through `/realtime`: queues, spread, teams, blocks, versions, lockstep. */
import * as CoreContract from '../../../generated/contract/core_contract.ts';
import { storage_module } from '../../storage/tests/helpers.ts';
import { advance_time, call_dev, fake, read_logs, send } from '../../testing/dev/index.ts';
import {
  CoreError,
  GameError,
  K,
  Reason,
  TICK_MS,
  barrier,
  missing,
  calls_of,
  close_and_wait,
  close_code,
  frame,
  harness,
  hold_next_transaction,
  kill_switch,
  kinds,
  match_request,
  matched,
  mode,
  next,
  online,
  participants,
  player,
  queued,
  read_frame,
  report,
  send_and_wait,
  send_frame,
  settled,
  stop_all,
  tick,
  version,
  type Conn,
  type Frame,
  type Harness,
} from './helpers.ts';

const DUEL = mode(7201);
const FOUR = mode(7202, { max_players: 4, min_players: 2, match_wait: 10_000n });
const REPLAY = mode(7203, { result_rule: 'ServerReplay' });
const TEAMS = mode(7204, { max_players: 4, min_players: 4, team_size: 2, max_party_size: 2, rating_spread: 1_000n, allow_room: true });
const SPREAD = mode(7205, { rating_spread: 10n, rating_spread_per_sec: 5n, match_wait: 600_000n });
const ROOM_ONLY = mode(7206, { allow_queue: false, allow_room: true });
const RATED = mode(7207, { rating_rule: 7901, rating_spread: 10n, match_wait: 600_000n });
const TRIO = mode(7208, { max_players: 3, min_players: 3 });

afterEach(async () => {
  await stop_all();
});

async function rated_player(h: Harness, mode_id: number, rating: bigint): Promise<Awaited<ReturnType<typeof queued>>> {
  const s = await player(h);
  ratings.set(s.user_id, rating);
  return queued(h, mode_id, s);
}

const ratings = new Map<bigint, bigint>();
const by_rating = { prepare: (_core: unknown, ctx: { user_id: bigint }) => ratings.get(ctx.user_id) ?? 0n };

describe('queue matching', () => {
  it('gives max_players waiting users the same match_id, seed and start_at with different my_index', async () => {
    const h = await harness({ modes: [FOUR] });
    const { found } = await matched(h, FOUR.id, 4);
    const ids = new Set(found.map((f) => f.match_id));
    expect(ids.size).toBe(1);
    expect(new Set(found.map((f) => f.seed)).size).toBe(1);
    expect(new Set(found.map((f) => f.start_at)).size).toBe(1);
    expect(found.map((f) => f.my_index).sort()).toEqual([0, 1, 2, 3]);
    expect(found[0]?.players.map((p) => p.index)).toEqual([0, 1, 2, 3]);
    expect(found.every((f) => f.mode_id === FOUR.id && f.players.every((p) => p.team === 0 && p.party === 0))).toBe(true);
  });

  it('sends MATCH_FOUND with empty relays when the turn adapter fails', async () => {
    const h = await harness({ modes: [DUEL], settings: { 'environments.<ENV>.adapters.turn': 'fake' } });
    (fake(h.server, 'turn') as { set_failure(op: string, f: string): void }).set_failure('issue_relays', 'communication_failure');
    const { found } = await matched(h, DUEL.id, 2);
    expect(found.every((f) => f.transport !== null && f.transport.relays.length === 0)).toBe(true);
  });

  it('at match_wait makes a match of min_players or more, else only the first user gets TIMEOUT', async () => {
    const h = await harness({ modes: [FOUR] });
    const a = await queued(h, FOUR.id);
    const b = await queued(h, FOUR.id);
    const c = await queued(h, FOUR.id);
    await tick(h, FOUR.match_wait);
    const found = await Promise.all([a, b, c].map((p) => next(p.conn, K.MATCHMAKER_FRAME_KIND_MATCH_FOUND)));
    expect(found[0]?.players).toHaveLength(3);
    const lone = mode(7210, { max_players: 4, min_players: 3, match_wait: 10_000n });
    const h2 = await harness({ modes: [lone] });
    const first = await queued(h2, lone.id);
    await tick(h2, 5_000n);
    const second = await queued(h2, lone.id);
    await tick(h2, 5_000n);
    const failed = await next(first.conn, K.MATCHMAKER_FRAME_KIND_MATCH_FAILED);
    expect(failed.reason).toBe(Reason.MATCH_FAIL_REASON_TIMEOUT);
    expect(kinds(await barrier(second.conn))).not.toContain(K.MATCHMAKER_FRAME_KIND_MATCH_FAILED);
  });

  it('does not group users whose ratings differ by more than the spread until waiting widens it', async () => {
    ratings.clear();
    const h = await harness({ modes: [SPREAD], hooks: by_rating });
    const low = await rated_player(h, SPREAD.id, 100n);
    const high = await rated_player(h, SPREAD.id, 130n);
    await tick(h, 3_000n);
    expect(kinds(await barrier(low.conn))).not.toContain(K.MATCHMAKER_FRAME_KIND_MATCH_FOUND);
    await tick(h, 1_000n);
    const found = await next(high.conn, K.MATCHMAKER_FRAME_KIND_MATCH_FOUND);
    expect(found.players.map((p) => p.user_id)).toEqual([low.session.user_id, high.session.user_id]);
  });

  it('does not put users whose HELLO data_version or client_version differ in one match', async () => {
    const compat = version('b', '2');
    const h = await harness({ modes: [DUEL], compat_client_data_version: compat });
    const a = await queued(h, DUEL.id);
    const b = await queued(h, DUEL.id, undefined, compat);
    const c = await queued(h, DUEL.id, undefined, undefined, '1.0.0');
    await tick(h);
    for (const p of [a, b, c]) expect(kinds(await barrier(p.conn))).not.toContain(K.MATCHMAKER_FRAME_KIND_MATCH_FOUND);
    const d = await queued(h, DUEL.id, undefined, compat);
    await tick(h);
    const found = await next(d.conn, K.MATCHMAKER_FRAME_KIND_MATCH_FOUND);
    expect(found.players.map((p) => p.user_id)).toEqual([b.session.user_id, d.session.user_id]);
  });

  it('answers an unknown mode_id with INVALID_MODE and a hook GameError with REJECTED and that code, without a queue entry', async () => {
    const h = await harness({ modes: [DUEL], hooks: { prepare: () => GameError.GAME_ERROR_CORE_TEST } });
    const conn = await online(h, await player(h));
    const unknown = await send_and_wait(conn, match_request(9999));
    expect(unknown.map((f) => f.reason)).toEqual([Reason.MATCH_FAIL_REASON_INVALID_MODE]);
    const rejected = await send_and_wait(conn, match_request(DUEL.id));
    expect(rejected.map((f) => [f.reason, f.error_code])).toEqual([[Reason.MATCH_FAIL_REASON_REJECTED, GameError.GAME_ERROR_CORE_TEST]]);
  });

  it('answers MATCH_REQUEST with REJECTED and error code 0 when prepare_match_request fails or its transaction is WITHDRAWN, without a queue entry', async () => {
    const h = await harness({ modes: [DUEL], hooks: { prepare: () => {
      throw new Error('prepare fails');
    } } });
    const conn = await online(h, await player(h));
    expect((await send_and_wait(conn, match_request(DUEL.id))).map((f) => [f.reason, f.error_code])).toEqual([[Reason.MATCH_FAIL_REASON_REJECTED, 0]]);
    const h2 = await harness({ modes: [DUEL], hooks: { prepare: () => 0n } });
    const s = await player(h2);
    const withdrawn = await online(h2, s);
    expect((await send(s, 'core/Withdraw', new CoreContract.WithdrawRequest())).envelope.error).toBeNull();
    expect((await send_and_wait(withdrawn, match_request(DUEL.id))).map((f) => [f.reason, f.error_code])).toEqual([[Reason.MATCH_FAIL_REASON_REJECTED, 0]]);
    // Not in the queue: a second user alone gets TIMEOUT.
    const other = await queued(h2, DUEL.id);
    await tick(h2, DUEL.match_wait);
    expect((await next(other.conn, K.MATCHMAKER_FRAME_KIND_MATCH_FAILED)).reason).toBe(Reason.MATCH_FAIL_REASON_TIMEOUT);
  });

  it('answers MATCH_REQUEST with REJECTED and error code 0 and logs an error when prepare_match_request returns a number below 1000 or pass, without a queue entry', async () => {
    let answer: unknown = 0n;
    const h = await harness({ modes: [DUEL], hooks: { prepare: () => answer as bigint } });
    const conn = await online(h, await player(h));
    for (const value of [5, 999, -1, 1000.5, 'pass']) {
      answer = value;
      expect((await send_and_wait(conn, match_request(DUEL.id))).map((f) => [f.reason, f.error_code])).toEqual([[Reason.MATCH_FAIL_REASON_REJECTED, 0]]);
    }
    const errors = read_logs(h.server, 'error').filter((l) => l['message'] === 'prepare_match_request returned a value that is neither a rating nor a GameError');
    expect(errors).toHaveLength(5);
    // Not in the queue: a second user alone gets TIMEOUT.
    answer = 0n;
    const other = await queued(h, DUEL.id);
    await tick(h, DUEL.match_wait);
    expect((await next(other.conn, K.MATCHMAKER_FRAME_KIND_MATCH_FAILED)).reason).toBe(Reason.MATCH_FAIL_REASON_TIMEOUT);
  });

  it('answers MATCH_REQUEST with REJECTED FEATURE_DISABLED while the kill switch MATCH_REQUEST is on', async () => {
    const h = await harness({ modes: [DUEL] });
    await kill_switch(h, true);
    const conn = await online(h, await player(h));
    const out = await send_and_wait(conn, match_request(DUEL.id));
    expect(out.map((f) => [f.reason, f.error_code])).toEqual([[Reason.MATCH_FAIL_REASON_REJECTED, CoreError.CORE_ERROR_FEATURE_DISABLED]]);
    await kill_switch(h, false);
    expect(await send_and_wait(conn, match_request(DUEL.id))).toEqual([]);
  });

  it('answers MATCH_REQUEST of allow_queue false with INVALID_MODE', async () => {
    const h = await harness({ modes: [ROOM_ONLY] });
    const conn = await online(h, await player(h));
    expect((await send_and_wait(conn, match_request(ROOM_ONLY.id))).map((f) => f.reason)).toEqual([Reason.MATCH_FAIL_REASON_INVALID_MODE]);
  });

  it('refuses ServerReplay requests from a data_version that is not client_data_version, and queues Consensus requests from it', async () => {
    const compat = version('b', '2');
    const consensus = mode(7211);
    const replay_room = mode(7212, { result_rule: 'ServerReplay', max_players: 2, allow_room: true, max_party_size: 2 });
    const h = await harness({ modes: [REPLAY, consensus, replay_room], compat_client_data_version: compat, hooks: { replay: () => 'reject' } });
    const data_only = await online(h, await player(h), version('a', '9'), '1.0.0');
    const old_app = await online(h, await player(h), compat);
    expect((await send_and_wait(data_only, match_request(REPLAY.id))).map((f) => [f.reason, f.error_code])).toEqual([
      [Reason.MATCH_FAIL_REASON_REJECTED, CoreError.CORE_ERROR_DATA_UPDATE_REQUIRED],
    ]);
    expect((await send_and_wait(old_app, match_request(REPLAY.id))).map((f) => [f.reason, f.error_code])).toEqual([
      [Reason.MATCH_FAIL_REASON_REJECTED, CoreError.CORE_ERROR_APP_UPDATE_REQUIRED],
    ]);
    expect(await send_and_wait(old_app, match_request(consensus.id))).toEqual([]);
    send_frame(old_app, frame(K.MATCHMAKER_FRAME_KIND_MATCH_CANCEL));
    // A room whose host has that connection.
    const created = await send_and_wait(old_app, frame(K.MATCHMAKER_FRAME_KIND_ROOM_CREATE, (f) => {
      f.mode_id = replay_room.id;
    }));
    const code = created.find((f) => f.kind === K.MATCHMAKER_FRAME_KIND_ROOM_STATE)?.room_code ?? '';
    const guest = await online(h, await player(h), compat);
    await send_and_wait(guest, frame(K.MATCHMAKER_FRAME_KIND_ROOM_JOIN, (f) => {
      f.room_code = code;
    }));
    const party = await send_and_wait(old_app, match_request(replay_room.id));
    expect(party.filter((f) => f.kind === K.MATCHMAKER_FRAME_KIND_ROOM_FAILED).map((f) => [f.error_code, f.request])).toEqual([
      [CoreError.CORE_ERROR_APP_UPDATE_REQUIRED, K.MATCHMAKER_FRAME_KIND_MATCH_REQUEST],
    ]);
    const start = await send_and_wait(old_app, frame(K.MATCHMAKER_FRAME_KIND_ROOM_START));
    expect(start.filter((f) => f.kind === K.MATCHMAKER_FRAME_KIND_ROOM_FAILED).map((f) => [f.error_code, f.request])).toEqual([
      [CoreError.CORE_ERROR_APP_UPDATE_REQUIRED, K.MATCHMAKER_FRAME_KIND_ROOM_START],
    ]);
    expect(start.some((f) => f.kind === K.MATCHMAKER_FRAME_KIND_MATCH_FOUND)).toBe(false);
  });

  it('does not put a user whose connection closed or who sent MATCH_CANCEL in a match', async () => {
    const h = await harness({ modes: [DUEL] });
    const gone = await queued(h, DUEL.id);
    const cancel = await queued(h, DUEL.id);
    await close_and_wait(gone.conn);
    await send_and_wait(cancel.conn, frame(K.MATCHMAKER_FRAME_KIND_MATCH_CANCEL));
    const a = await queued(h, DUEL.id);
    await tick(h);
    expect(kinds(await barrier(a.conn))).not.toContain(K.MATCHMAKER_FRAME_KIND_MATCH_FOUND);
    const b = await queued(h, DUEL.id);
    await tick(h);
    const found = await next(b.conn, K.MATCHMAKER_FRAME_KIND_MATCH_FOUND);
    expect(found.players.map((p) => p.user_id)).toEqual([a.session.user_id, b.session.user_id]);
  });

  it('gives prepare_match_request only the user of a MATCH_REQUEST outside a room, and puts its rating in the record', async () => {
    ratings.clear();
    const h = await harness({ modes: [mode(7213, { rating_spread: 1_000n })], hooks: { ...by_rating, apply_mismatch: () => 'pass' } });
    const a = await rated_player(h, 7213, 300n);
    const b = await rated_player(h, 7213, 200n);
    expect(calls_of(h, 'prepare_match_request').map((c) => c.user_ids)).toEqual([[a.session.user_id], [b.session.user_id]]);
    await tick(h);
    const found = await next(a.conn, K.MATCHMAKER_FRAME_KIND_MATCH_FOUND);
    await report(a.session, found.match_id, new Uint8Array([1]));
    await report(b.session, found.match_id, new Uint8Array([2]));
    await settled(h);
    const applied = calls_of(h, 'apply_match_mismatch');
    expect(applied.map((c) => c.record?.ratings)).toEqual([[300n, 200n], [300n, 200n]]);
  });
});

describe('teams', () => {
  it('puts solo users of ratings 100, 90, 80, 70 as 100 and 70 on team 0, 90 and 80 on team 1', async () => {
    ratings.clear();
    const h = await harness({ modes: [TEAMS], hooks: by_rating });
    const players = [];
    for (const r of [100n, 90n, 80n, 70n]) players.push(await rated_player(h, TEAMS.id, r));
    await tick(h);
    const first = players[0];
    if (first === undefined) throw new Error('no player');
    const found = await next(first.conn, K.MATCHMAKER_FRAME_KIND_MATCH_FOUND);
    const team = (user_id: bigint | undefined): number | undefined => found.players.find((p) => p.user_id === user_id)?.team;
    expect(players.map((p) => team(p.session.user_id))).toEqual([0, 1, 1, 0]);
  });

  async function party_of(h: Harness, members: readonly bigint[]): Promise<{ host: Awaited<ReturnType<typeof online>>; conns: Awaited<ReturnType<typeof online>>[] }> {
    const conns = [];
    let code = '';
    for (const [i, rating] of members.entries()) {
      const s = await player(h);
      ratings.set(s.user_id, rating);
      const conn = await online(h, s);
      conns.push(conn);
      if (i === 0) {
        const out = await send_and_wait(conn, frame(K.MATCHMAKER_FRAME_KIND_ROOM_CREATE, (f) => {
          f.mode_id = TEAMS.id;
        }));
        code = out.find((f) => f.kind === K.MATCHMAKER_FRAME_KIND_ROOM_STATE)?.room_code ?? '';
      } else {
        await send_and_wait(conn, frame(K.MATCHMAKER_FRAME_KIND_ROOM_JOIN, (f) => {
          f.room_code = code;
        }));
      }
    }
    const host = conns[0];
    if (host === undefined) throw new Error('no host');
    await send_and_wait(host, match_request(TEAMS.id));
    return { host, conns };
  }

  it('puts two parties of 2 on different teams', async () => {
    ratings.clear();
    const h = await harness({ modes: [TEAMS], hooks: by_rating });
    const one = await party_of(h, [10n, 20n]);
    await party_of(h, [30n, 5n]);
    await tick(h);
    const found = await next(one.host, K.MATCHMAKER_FRAME_KIND_MATCH_FOUND);
    const teams = found.players.map((p) => p.team);
    expect(teams[0]).toBe(teams[1]);
    expect(teams[2]).toBe(teams[3]);
    expect(teams[0]).not.toBe(teams[2]);
    expect(found.players.map((p) => p.party)).toEqual([1, 1, 2, 2]);
  });

  it('keeps the queue order teams when a party of 50, 50 first and solo users of 100, 90 leave the party no team', async () => {
    ratings.clear();
    const h = await harness({ modes: [TEAMS], hooks: by_rating });
    const p = await party_of(h, [50n, 50n]);
    await rated_player(h, TEAMS.id, 100n);
    await rated_player(h, TEAMS.id, 90n);
    await tick(h);
    const found = await next(p.host, K.MATCHMAKER_FRAME_KIND_MATCH_FOUND);
    expect(found.players.map((x) => x.team)).toEqual([0, 0, 1, 1]);
  });
});

// `block-report` is not in this core yet.
describe.skipIf(missing('block-report'))('blocks', () => {
  async function block(s: Awaited<ReturnType<typeof player>>, target: bigint): Promise<void> {
    const request = new CoreContract.BlockUserRequest();
    request.user_id = target;
    const { envelope } = await send(s, 'core/BlockUser', request);
    expect(envelope.error).toBeNull();
  }

  it('does not put two users with a block relation in one match; each matches with someone else', async () => {
    const h = await harness({ modes: [DUEL] });
    const a = await player(h);
    const b = await player(h);
    await block(a, b.user_id);
    const qa = await queued(h, DUEL.id, a);
    const qb = await queued(h, DUEL.id, b);
    const qc = await queued(h, DUEL.id);
    const qd = await queued(h, DUEL.id);
    await tick(h);
    const fa = await next(qa.conn, K.MATCHMAKER_FRAME_KIND_MATCH_FOUND);
    const fb = await next(qb.conn, K.MATCHMAKER_FRAME_KIND_MATCH_FOUND);
    expect(fa.players.map((p) => p.user_id)).toEqual([a.user_id, qc.session.user_id]);
    expect(fb.players.map((p) => p.user_id)).toEqual([b.user_id, qd.session.user_id]);
  });

  it('does not match a party whose member is blocked by another entry', async () => {
    const h = await harness({ modes: [mode(7214, { max_players: 3, min_players: 3, max_party_size: 2, allow_room: true })] });
    const host = await player(h);
    const member = await player(h);
    const blocker = await player(h);
    await block(blocker, member.user_id);
    const hc = await online(h, host);
    const created = await send_and_wait(hc, frame(K.MATCHMAKER_FRAME_KIND_ROOM_CREATE, (f) => {
      f.mode_id = 7214;
    }));
    const code = created.find((f) => f.kind === K.MATCHMAKER_FRAME_KIND_ROOM_STATE)?.room_code ?? '';
    const mc = await online(h, member);
    await send_and_wait(mc, frame(K.MATCHMAKER_FRAME_KIND_ROOM_JOIN, (f) => {
      f.room_code = code;
    }));
    await send_and_wait(hc, match_request(7214));
    const qb = await queued(h, 7214, blocker);
    await tick(h);
    expect(kinds(await barrier(qb.conn))).not.toContain(K.MATCHMAKER_FRAME_KIND_MATCH_FOUND);
    const other = await queued(h, 7214);
    await tick(h);
    const found = await next(other.conn, K.MATCHMAKER_FRAME_KIND_MATCH_FOUND);
    expect(found.players.map((p) => p.user_id)).toEqual([host.user_id, member.user_id, other.session.user_id]);
  });

  it('uses a BlockUser sent after entering the queue only from the next MATCH_REQUEST', async () => {
    const h = await harness({ modes: [DUEL] });
    const a = await player(h);
    const b = await player(h);
    const qa = await queued(h, DUEL.id, a);
    await block(a, b.user_id);
    const qb = await queued(h, DUEL.id, b);
    await tick(h);
    expect((await next(qa.conn, K.MATCHMAKER_FRAME_KIND_MATCH_FOUND)).players.map((p) => p.user_id)).toEqual([a.user_id, b.user_id]);
    await send_and_wait(qa.conn, match_request(DUEL.id));
    await send_and_wait(qb.conn, match_request(DUEL.id));
    await tick(h);
    expect(kinds(await barrier(qa.conn))).not.toContain(K.MATCHMAKER_FRAME_KIND_MATCH_FOUND);
  });
});

describe('rating rule', () => {
  // `rating` is not in this core yet.
  it.skipIf(missing('rating'))('queues by rating.get_rating and records it, not the rating prepare_match_request returned', async () => {
    const h = await harness({ modes: [RATED], rating_rules: [{ id: 7901, initial_rating: 1_000n }], hooks: { prepare: () => 5n, apply_mismatch: () => 'pass' } });
    const a = await player(h);
    const b = await player(h);
    const c = await player(h);
    await call_dev(h.server, 'rating', 'set_rating', [7901, 1_500n], a.user_id);
    await call_dev(h.server, 'rating', 'set_rating', [7901, 1_000n], b.user_id);
    await call_dev(h.server, 'rating', 'set_rating', [7901, 1_505n], c.user_id);
    const qa = await queued(h, RATED.id, a);
    await queued(h, RATED.id, b);
    const qc = await queued(h, RATED.id, c);
    await tick(h);
    const found = await next(qa.conn, K.MATCHMAKER_FRAME_KIND_MATCH_FOUND);
    expect(found.players.map((p) => p.user_id)).toEqual([a.user_id, c.user_id]);
    await report(a, found.match_id, new Uint8Array([1]));
    await report(qc.session, found.match_id, new Uint8Array([2]));
    await settled(h);
    expect(calls_of(h, 'apply_match_mismatch')[0]?.record?.ratings).toEqual([1_500n, 1_505n]);
  });
});

describe('DEV lockstep', () => {
  it('keeps lockstep requests apart from others, marks the match lockstep and sets deadline_at from lockstepMaxDurationMs', async () => {
    const h = await harness({ modes: [DUEL], settings: { 'matchmaker.lockstepMaxDurationMs': 120_000, 'matchmaker.reportMarginMs': 1_000 }, hooks: { apply_mismatch: () => 'pass' } });
    const a = await online(h, await player(h));
    const b = await online(h, await player(h));
    const c = await online(h, await player(h));
    await send_and_wait(a, match_request(DUEL.id, true));
    await send_and_wait(b, match_request(DUEL.id, false));
    await tick(h);
    expect(kinds(await barrier(a))).not.toContain(K.MATCHMAKER_FRAME_KIND_MATCH_FOUND);
    await send_and_wait(c, match_request(DUEL.id, true));
    await tick(h);
    const found = await next(a, K.MATCHMAKER_FRAME_KIND_MATCH_FOUND);
    expect(found.lockstep).toBe(true);
    // deadline_at = start_at + 120000 + 1000, and start_at is prepare_time after the clock of the match creation.
    await tick(h, DUEL.prepare_time + 121_000n - 1n);
    expect(calls_of(h, 'apply_match_mismatch')).toEqual([]);
    await tick(h, 10_001n);
    expect(calls_of(h, 'apply_match_mismatch')).toHaveLength(2);
  });

  it('reads lockstep as false on a STG test server', async () => {
    const h = await harness({ modes: [DUEL], environment: 'STG' });
    const a = await online(h, await player(h));
    const b = await online(h, await player(h));
    await send_and_wait(a, match_request(DUEL.id, true));
    await send_and_wait(b, match_request(DUEL.id, false));
    const found = await next(a, K.MATCHMAKER_FRAME_KIND_MATCH_FOUND, 15_000n);
    expect(found.lockstep).toBe(false);
  });
});

/** The user IDs of each saved match record in index order, the earliest record first. */
function read_match_users(h: Harness): bigint[][] {
  const rows = storage_module(h.server)
    .read_db()
    .query('SELECT p.match_id, p.user_id FROM matchmaker_participant p JOIN matchmaker_match m ON m.match_id = p.match_id ORDER BY m.created_at, p.match_id, p.idx', []);
  const by_match = new Map<string, bigint[]>();
  for (const r of rows) {
    const id = String(r['match_id']);
    by_match.set(id, [...(by_match.get(id) ?? []), r['user_id'] as bigint]);
  }
  return [...by_match.values()];
}

function room_create(mode_id: number): Frame {
  return frame(K.MATCHMAKER_FRAME_KIND_ROOM_CREATE, (f) => {
    f.mode_id = mode_id;
  });
}

/** The frames of a connection up to the first one of the kind, that one included. */
async function frames_until(conn: Conn, kind: CoreContract.MatchmakerFrameKind): Promise<Frame[]> {
  const seen: Frame[] = [];
  for (;;) {
    const f = await read_frame(conn, 5_000n);
    if (f === null) throw new Error(`connection ended before frame kind ${String(kind)}`);
    seen.push(f);
    if (f.kind === kind) return seen;
  }
}

describe('frames sent while prepare_match_request waits', () => {
  /** A user whose `MATCH_REQUEST` waits in the transaction of `prepare_match_request` while `after` is sent. */
  const waiting_request = async (h: Harness, mode_id: number, after: Frame): Promise<{ user_id: bigint; frames: Frame[] }> => {
    const s = await player(h);
    const conn = await online(h, s);
    const held = hold_next_transaction(h, 'run_rollback_transaction');
    send_frame(conn, match_request(mode_id));
    send_frame(conn, after);
    await vi.waitFor(() => {
      expect(held.calls()).toBe(1);
    });
    held.open();
    return { user_id: s.user_id, frames: await barrier(conn) };
  };

  it('handles a MATCH_CANCEL, a second MATCH_REQUEST and a ROOM_CREATE after that MATCH_REQUEST ends: no entry, one entry, and ROOM_BUSY', async () => {
    const h = await harness({ modes: [FOUR, ROOM_ONLY], hooks: by_rating });
    const cancelled = await waiting_request(h, FOUR.id, frame(K.MATCHMAKER_FRAME_KIND_MATCH_CANCEL));
    expect(cancelled.frames).toEqual([]);
    const twice = await waiting_request(h, FOUR.id, match_request(FOUR.id));
    expect(twice.frames).toEqual([]);
    const created = await waiting_request(h, FOUR.id, room_create(ROOM_ONLY.id));
    expect(created.frames.map((f) => [f.kind, f.error_code, f.request])).toEqual([
      [K.MATCHMAKER_FRAME_KIND_ROOM_FAILED, CoreError.CORE_ERROR_ROOM_BUSY, K.MATCHMAKER_FRAME_KIND_ROOM_CREATE],
    ]);
    // The second MATCH_REQUEST was handled: its own prepare_match_request ran.
    expect(calls_of(h, 'prepare_match_request').map((c) => c.user_id)).toEqual([cancelled.user_id, twice.user_id, twice.user_id, created.user_id]);
    // At match_wait every entry of the queue is in one match of up to four.
    await tick(h, FOUR.match_wait);
    expect(read_match_users(h)).toEqual([[twice.user_id, created.user_id]]);
  });

  it('does not put the user in the queue when the connection closes while prepare_match_request of its MATCH_REQUEST waits', async () => {
    const h = await harness({ modes: [DUEL] });
    const conn = await online(h, await player(h));
    const held = hold_next_transaction(h, 'run_rollback_transaction');
    send_frame(conn, match_request(DUEL.id));
    await vi.waitFor(() => {
      expect(held.calls()).toBe(1);
    });
    await close_and_wait(conn);
    held.open();
    await held.done();
    const other = await queued(h, DUEL.id);
    await tick(h);
    expect(kinds(await barrier(other.conn))).not.toContain(K.MATCHMAKER_FRAME_KIND_MATCH_FOUND);
    expect(read_match_users(h)).toEqual([]);
  });

  it.each([
    ['a second MATCH_REQUEST', match_request(FOUR.id)],
    ['a ROOM_CREATE', room_create(ROOM_ONLY.id)],
  ])('drops %s of the previous connection sent while its prepare_match_request waited for a new connection that authenticated, and the new connection makes the only entry of that user', async (_name, after) => {
    const h = await harness({ modes: [FOUR, ROOM_ONLY] });
    const s = await player(h);
    const previous = await online(h, s);
    const held = hold_next_transaction(h, 'run_rollback_transaction');
    send_frame(previous, match_request(FOUR.id));
    send_frame(previous, after);
    await vi.waitFor(() => {
      expect(held.calls()).toBe(1);
    });
    const fresh = await online(h, s);
    expect(await close_code(previous)).toBe(CoreError.CORE_ERROR_SESSION_REPLACED);
    held.open();
    await held.done();
    await barrier(fresh);
    // In no queue and no room: the MATCH_REQUEST of the new connection is a request outside a room.
    expect(await send_and_wait(fresh, match_request(FOUR.id))).toEqual([]);
    const other = await queued(h, FOUR.id);
    await tick(h, FOUR.match_wait);
    const found = await next(fresh, K.MATCHMAKER_FRAME_KIND_MATCH_FOUND);
    expect(found.players.map((p) => [p.user_id, p.party])).toEqual([[s.user_id, 0], [other.session.user_id, 0]]);
    expect(kinds(await barrier(fresh))).not.toContain(K.MATCHMAKER_FRAME_KIND_MATCH_FOUND);
    expect(read_match_users(h)).toEqual([[s.user_id, other.session.user_id]]);
  });
});

describe('a participant connection closed while its match is created', () => {
  it.each([
    ['closes', async (_h: Harness, q: Awaited<ReturnType<typeof queued>>): Promise<Conn | null> => {
      await close_and_wait(q.conn);
      return null;
    }],
    ['is replaced by a new connection of that user', async (h: Harness, q: Awaited<ReturnType<typeof queued>>): Promise<Conn | null> => online(h, q.session)],
  ])('when it %s after matching collected the entry: PEER_LEFT of that index, disconnected_at before MATCH_FOUND, no PEER_SIGNAL to it, and no MATCH_FOUND for a new connection', async (_name, close_it) => {
    const h = await harness({ modes: [TRIO], settings: { 'environments.<ENV>.adapters.turn': 'fake', 'p2p-signaling.turnTimeoutMs': 1000 } });
    const a = await queued(h, TRIO.id);
    const b = await queued(h, TRIO.id);
    const c = await queued(h, TRIO.id);
    // The relays of the match do not come until p2p-signaling.turnTimeoutMs: the match is being created until then.
    const turn = fake(h.server, 'turn') as { set_failure(op: string, f: string): void; calls(): readonly unknown[] };
    turn.set_failure('issue_relays', 'timeout');
    advance_time(h.server, TICK_MS);
    await vi.waitFor(() => {
      expect(turn.calls()).toHaveLength(1);
    });
    const fresh = await close_it(h, a);
    const b_frames = await frames_until(b.conn, K.MATCHMAKER_FRAME_KIND_MATCH_FOUND);
    const found = b_frames.at(-1);
    const match_id = found?.match_id ?? '';
    // The DISCONNECTED of index 0 was written before MATCH_FOUND.
    expect(participants(h, match_id).map((p) => p.disconnected_at !== 0n)).toEqual([true, false, false]);
    expect(found?.players.map((p) => p.user_id)).toEqual([a.session.user_id, b.session.user_id, c.session.user_id]);
    expect(b_frames.filter((f) => f.kind === K.MATCHMAKER_FRAME_KIND_PEER_LEFT).map((f) => f.index)).toEqual([0]);
    const c_frames = await frames_until(c.conn, K.MATCHMAKER_FRAME_KIND_MATCH_FOUND);
    expect(c_frames.filter((f) => f.kind === K.MATCHMAKER_FRAME_KIND_PEER_LEFT).map((f) => f.index)).toEqual([0]);
    send_frame(b.conn, frame(K.MATCHMAKER_FRAME_KIND_PEER_SIGNAL, (f) => {
      f.index = 0;
      f.payload = new Uint8Array([1]);
    }));
    await barrier(b.conn);
    if (fresh !== null) {
      const seen = kinds(await barrier(fresh));
      expect(seen).not.toContain(K.MATCHMAKER_FRAME_KIND_MATCH_FOUND);
      expect(seen).not.toContain(K.MATCHMAKER_FRAME_KIND_PEER_SIGNAL);
    }
    expect(kinds(await barrier(c.conn))).not.toContain(K.MATCHMAKER_FRAME_KIND_PEER_SIGNAL);
  });
});
