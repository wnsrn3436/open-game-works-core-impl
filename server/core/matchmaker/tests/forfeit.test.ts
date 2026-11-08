/**
 * `### result decision` with forfeiters and the final decision, `### integrity` (events, flags, the flag notice),
 * the admin operations `list_match_flags` and `get_match`, the `LEFT` retries and the decision after a `left_at` write.
 */
import * as CoreContract from '../../../generated/contract/core_contract.ts';
import * as GameContract from '../../../generated/contract/game_contract.ts';
import { storage_module } from '../../storage/tests/helpers.ts';
import { advance_time, call_dev, hold_game_row_lock, read_logs, send, send_admin, type TestSession } from '../../testing/dev/index.ts';
import type { MatchRecordInput } from '../index.ts';
import {
  Judge,
  K,
  barrier,
  bytes_equal,
  calls_of,
  close_and_wait,
  close_code,
  connect,
  harness,
  hello,
  hold_next_transaction,
  integrity,
  kinds,
  leave_frame,
  log_bytes,
  match_request,
  match_status,
  matched,
  mode,
  next,
  online,
  participants,
  player,
  queued,
  report,
  result_bytes,
  send_and_wait,
  send_frame,
  settled,
  stop_all,
  tick,
  until,
  until_participants,
  type Harness,
  type Hooks,
  type Queued,
} from './helpers.ts';

const CONS2 = mode(7501);
const MAJ2 = mode(7502, { result_rule: 'Majority' });
const REP2 = mode(7503, { result_rule: 'ServerReplay' });
const CONS3 = mode(7504, { min_players: 3, max_players: 3 });
const MAJ3 = mode(7505, { result_rule: 'Majority', min_players: 3, max_players: 3 });
const REP3 = mode(7506, { result_rule: 'ServerReplay', min_players: 3, max_players: 3 });
const REP4 = mode(7507, { result_rule: 'ServerReplay', min_players: 4, max_players: 4 });
const MODES = [CONS2, MAJ2, REP2, CONS3, MAJ3, REP3, REP4];
/** `deadline_at` − `created_at` of every mode here with `matchmaker.reportMarginMs` 1000. */
const DEADLINE = CONS2.prepare_time + CONS2.max_duration + 1_000n;
const FAST = { 'matchmaker.reportMarginMs': 1_000, 'matchmaker.sweepIntervalMs': 1 };

/** `replay_match` of the tests: the result is winner = first input, score = sum of inputs. */
function replayed(_record: MatchRecordInput, input_log: Uint8Array): Uint8Array | 'reject' {
  const inputs = GameContract.MatchInputLog.decode(input_log)?.inputs ?? [];
  return result_bytes(inputs[0] ?? 0, inputs.reduce((a, b) => a + b, 0));
}

const HOOKS: Hooks = { apply_result: () => 'pass', apply_forfeit: () => 'pass', apply_mismatch: () => 'pass', replay: replayed };

afterEach(async () => {
  await stop_all();
});

/**
 * Makes `storage.lock_game_row` of the match record row of `match_id` `FAILED` at its `nth` call from now (from 1),
 * so that game transaction fails as one whose lock wait exceeded its limit. Returns the count of those calls so far.
 */
function fail_match_lock(h: Harness, match_id: string, nth: number): () => number {
  const storage = storage_module(h.server);
  const original = storage.lock_game_row.bind(storage);
  let calls = 0;
  vi.spyOn(storage, 'lock_game_row').mockImplementation((handle: Parameters<typeof original>[0], table: string, key: readonly unknown[]) => {
    if (table === 'matchmaker_match' && key[0] === match_id) {
      calls += 1;
      if (calls === nth) return 'FAILED';
    }
    return original(handle, table, key);
  });
  return () => calls;
}

/** A match made through `/realtime`; `at(i)` is the participant of index i. */
interface Live {
  readonly id: string;
  at(index: number): Queued;
}

async function live_match(h: Harness, mode_id: number, n: number): Promise<Live> {
  const { players, found } = await matched(h, mode_id, n);
  const by_index = new Map<number, Queued>();
  players.forEach((p, i) => by_index.set(found[i]?.my_index ?? -1, p));
  return {
    id: found[0]?.match_id ?? '',
    at: (index) => {
      const p = by_index.get(index);
      if (p === undefined) throw new Error(`no participant ${String(index)}`);
      return p;
    },
  };
}

/** The counts of `storage.lock_game_row` of each match record row, per storage module. */
const match_lock_counts = new WeakMap<object, Map<string, number>>();

/** Counts the `storage.lock_game_row` calls of the match record row of `match_id` from now. */
function match_locks(h: Harness, match_id: string): () => number {
  const storage = storage_module(h.server);
  let counts = match_lock_counts.get(storage);
  if (counts === undefined) {
    const by_match = new Map<string, number>();
    counts = by_match;
    match_lock_counts.set(storage, by_match);
    const original = storage.lock_game_row.bind(storage);
    vi.spyOn(storage, 'lock_game_row').mockImplementation((handle: Parameters<typeof original>[0], table: string, key: readonly unknown[]) => {
      if (table === 'matchmaker_match') by_match.set(String(key[0]), (by_match.get(String(key[0])) ?? 0) + 1);
      return original(handle, table, key);
    });
  }
  const seen = counts;
  const before = seen.get(match_id) ?? 0;
  return () => (seen.get(match_id) ?? 0) - before;
}

/**
 * `MATCH_LEAVE` with `forfeit` `true` of index i, its `left_at` committed and the decision after it ended. The
 * decision is an `after_commit` function of the `left_at` write: once it locked the record, `settled` waits for it.
 */
async function forfeit(h: Harness, m: Live, index: number): Promise<void> {
  const locks = match_locks(h, m.id);
  await send_and_wait(m.at(index).conn, leave_frame(m.id, true));
  await until(() => locks() >= 2);
  await settled(h);
  expect(participants(h, m.id)[index]?.left_at).not.toBe(0n);
}

async function test_match(h: Harness, mode_id: number, n: number, users?: readonly TestSession[]): Promise<{ id: string; players: TestSession[] }> {
  const players = users === undefined ? [] : [...users];
  while (players.length < n) players.push(await player(h));
  const id = (await call_dev(h.server, 'matchmaker', 'create_test_match', [mode_id, players.map((p) => p.user_id), 1n])) as string;
  return { id, players };
}

function at<T>(list: readonly T[], i: number): T {
  const v = list[i];
  if (v === undefined) throw new Error(`no item ${String(i)}`);
  return v;
}

/** The values the reporter of a rule sends: `result` for Consensus and Majority, `input_log` for ServerReplay. */
function sent(mode_id: number, value: number): [Uint8Array, Uint8Array] {
  return mode_id === REP2.id || mode_id === REP3.id || mode_id === REP4.id ? [result_bytes(0), log_bytes([value])] : [result_bytes(value), new Uint8Array(0)];
}

function flag_logs(h: Harness): Record<string, unknown>[] {
  return read_logs(h.server, 'core', 'warn').filter((l) => l['message'] === 'match integrity flag');
}

interface Flag {
  readonly user_id: string;
  readonly count: number;
  readonly match_ids: string[];
}

async function list_flags(h: Harness, kind: string, limit = 100, after_user_id?: bigint): Promise<{ status: number; flags: Flag[] }> {
  const body: Record<string, unknown> = { kind, limit };
  if (after_user_id !== undefined) body['after_user_id'] = String(after_user_id);
  const out = await send_admin(h.server, 'list_match_flags', body);
  return { status: out.status, flags: ((out.json as { flags?: Flag[] } | null)?.flags ?? []) };
}

describe('FORFEIT', () => {
  for (const rule of [CONS2, MAJ2, REP2]) {
    it(`${rule.result_rule}: a 2-player match whose index 1 left with forfeit true without a report is FORFEIT, by ReportMatchResult after the LEFT and by the decision after the left_at write when the report came first`, async () => {
      const h = await harness({ modes: MODES, hooks: HOOKS });
      // The report after the LEFT.
      const one = await live_match(h, rule.id, 2);
      await forfeit(h, one, 1);
      expect(match_status(h, one.id)).toBe('PENDING');
      expect((await report(one.at(0).session, one.id, ...sent(rule.id, 1))).status).toBe(Judge.MATCH_JUDGE_STATUS_FORFEIT);
      await settled(h);
      // The report before the LEFT.
      const two = await live_match(h, rule.id, 2);
      expect((await report(two.at(0).session, two.id, ...sent(rule.id, 1))).status).toBe(Judge.MATCH_JUDGE_STATUS_PENDING);
      await forfeit(h, two, 1);
      expect(match_status(h, two.id)).toBe('FORFEIT');
      expect(calls_of(h, 'replay_match')).toEqual([]);
      for (const m of [one, two]) {
        const calls = calls_of(h, 'apply_match_forfeit').filter((c) => c.record?.match_id === m.id);
        expect(calls.map((c) => c.index).sort()).toEqual([0, 1]);
        for (const c of calls) {
          expect(c.record?.status).toBe(Judge.MATCH_JUDGE_STATUS_FORFEIT);
          // The index that left has left_at and no report; the other has its report.
          expect(c.record?.participants[1]?.left_at).not.toBe(0n);
          expect(c.record?.participants[1]?.reported_at).toBe(0n);
          expect(c.record?.participants[0]?.reported_at).not.toBe(0n);
          expect(bytes_equal(c.record?.participants[0]?.result ?? new Uint8Array(0), sent(rule.id, 1)[0])).toBe(true);
        }
        expect(integrity(h, m.id)).toEqual(new Map([[m.at(1).session.user_id, 'Forfeit']]));
      }
      expect(calls_of(h, 'apply_match_result')).toEqual([]);
      expect(calls_of(h, 'apply_match_mismatch')).toEqual([]);
    });
  }

  it('does not save the report of a participant after its MATCH_LEAVE with forfeit true, and judges the report of one that reported before it', async () => {
    const h = await harness({ modes: MODES, hooks: HOOKS });
    const one = await live_match(h, CONS2.id, 2);
    await forfeit(h, one, 0);
    expect(await report(one.at(0).session, one.id, result_bytes(1))).toEqual({ code: 0, status: Judge.MATCH_JUDGE_STATUS_PENDING });
    expect(participants(h, one.id)[0]?.reported_at).toBe(0n);
    const two = await live_match(h, CONS2.id, 2);
    expect((await report(two.at(0).session, two.id, result_bytes(1))).status).toBe(Judge.MATCH_JUDGE_STATUS_PENDING);
    await forfeit(h, two, 0);
    expect(match_status(h, two.id)).toBe('PENDING');
    expect((await report(two.at(1).session, two.id, result_bytes(1))).status).toBe(Judge.MATCH_JUDGE_STATUS_CONFIRMED);
  });

  it('makes a match with a forfeiter and no other report MISMATCH at deadline_at, with no integrity event', async () => {
    const h = await harness({ modes: MODES, hooks: HOOKS, settings: FAST });
    const m = await live_match(h, CONS2.id, 2);
    await forfeit(h, m, 1);
    await tick(h, DEADLINE);
    expect(match_status(h, m.id)).toBe('MISMATCH');
    expect(integrity(h, m.id)).toEqual(new Map());
  });

  it('3-player Consensus: index 2 forfeits and indexes 0 and 1 report different results; the second report makes FORFEIT with Disagree for both and Forfeit for index 2', async () => {
    const h = await harness({ modes: MODES, hooks: HOOKS });
    const m = await live_match(h, CONS3.id, 3);
    await forfeit(h, m, 2);
    expect((await report(m.at(0).session, m.id, result_bytes(1))).status).toBe(Judge.MATCH_JUDGE_STATUS_PENDING);
    expect((await report(m.at(1).session, m.id, result_bytes(2))).status).toBe(Judge.MATCH_JUDGE_STATUS_FORFEIT);
    expect(integrity(h, m.id)).toEqual(new Map([[m.at(0).session.user_id, 'Disagree'], [m.at(1).session.user_id, 'Disagree'], [m.at(2).session.user_id, 'Forfeit']]));
  });

  it('a decision transaction after a left_at write that fails leaves the left_at, and a 2-player match whose other participant reported before is FORFEIT at deadline_at', async () => {
    const h = await harness({ modes: MODES, hooks: HOOKS, settings: FAST });
    const m = await live_match(h, CONS2.id, 2);
    expect((await report(m.at(0).session, m.id, result_bytes(1))).status).toBe(Judge.MATCH_JUDGE_STATUS_PENDING);
    // The first lock of the record is the left_at write, the second the decision after its commit.
    const calls = fail_match_lock(h, m.id, 2);
    await send_and_wait(m.at(1).conn, leave_frame(m.id, true));
    await until(() => calls() >= 2);
    await settled(h);
    vi.restoreAllMocks();
    expect(calls()).toBe(2);
    expect(match_status(h, m.id)).toBe('PENDING');
    expect(read_logs(h.server, 'error').some((l) => l['message'] === 'match decision after a leave failed' && l['match_id'] === m.id)).toBe(true);
    await tick(h, DEADLINE);
    expect(match_status(h, m.id)).toBe('FORFEIT');
    expect(participants(h, m.id)[1]?.left_at).not.toBe(0n);
  });
});

describe('ServerReplay decisions', () => {
  it('2 players: a report saved while the other connection is closed stays PENDING, and the sweep makes MISMATCH at deadline_at without replay_match, with Missing for the one without a report', async () => {
    const h = await harness({ modes: MODES, hooks: HOOKS, settings: FAST });
    const m = await live_match(h, REP2.id, 2);
    await close_and_wait(m.at(1).conn);
    await until_participants(h, m.id, (rows) => rows[1]?.disconnected_at !== 0n);
    expect((await report(m.at(0).session, m.id, result_bytes(0), log_bytes([1]))).status).toBe(Judge.MATCH_JUDGE_STATUS_PENDING);
    await tick(h, DEADLINE);
    expect(match_status(h, m.id)).toBe('MISMATCH');
    expect(calls_of(h, 'replay_match')).toEqual([]);
    expect(integrity(h, m.id)).toEqual(new Map([[m.at(1).session.user_id, 'Missing']]));
  });

  it('3 players with two closed connections stays PENDING on one report and is MISMATCH at deadline_at; two same logs with one closed connection confirm, with no event for the closed one', async () => {
    const h = await harness({ modes: MODES, hooks: HOOKS, settings: FAST });
    const one = await live_match(h, REP3.id, 3);
    await close_and_wait(one.at(1).conn);
    await close_and_wait(one.at(2).conn);
    expect((await report(one.at(0).session, one.id, result_bytes(0), log_bytes([1]))).status).toBe(Judge.MATCH_JUDGE_STATUS_PENDING);
    await tick(h, DEADLINE);
    expect(match_status(h, one.id)).toBe('MISMATCH');
    const two = await live_match(h, REP3.id, 3);
    await close_and_wait(two.at(2).conn);
    expect((await report(two.at(0).session, two.id, result_bytes(0), log_bytes([1]))).status).toBe(Judge.MATCH_JUDGE_STATUS_PENDING);
    expect((await report(two.at(1).session, two.id, result_bytes(0), log_bytes([1]))).status).toBe(Judge.MATCH_JUDGE_STATUS_CONFIRMED);
    expect(integrity(h, two.id)).toEqual(new Map());
  });

  it('3-player Majority with every connection open: two same results confirm at the second report and the third gets no event', async () => {
    const h = await harness({ modes: MODES, hooks: HOOKS });
    const m = await live_match(h, MAJ3.id, 3);
    await report(m.at(0).session, m.id, result_bytes(1));
    expect((await report(m.at(1).session, m.id, result_bytes(1))).status).toBe(Judge.MATCH_JUDGE_STATUS_CONFIRMED);
    expect(integrity(h, m.id)).toEqual(new Map());
  });

  it('3-player Majority: two same results and one different give Disagree only to the different one', async () => {
    const h = await harness({ modes: MODES, hooks: HOOKS });
    const { id, players } = await test_match(h, MAJ3.id, 3);
    await report(at(players, 0), id, result_bytes(1));
    await report(at(players, 2), id, result_bytes(2));
    expect((await report(at(players, 1), id, result_bytes(1))).status).toBe(Judge.MATCH_JUDGE_STATUS_CONFIRMED);
    expect(integrity(h, id)).toEqual(new Map([[at(players, 2).user_id, 'Disagree']]));
  });

  it('4 players: two same logs stay PENDING and the sweep confirms them with replay_match at deadline_at; a throw of replay_match there is MISMATCH with an error log', async () => {
    let fail = false;
    const replay = (record: MatchRecordInput, input_log: Uint8Array): Uint8Array | 'reject' => {
      if (fail) throw new Error('replay fails in the sweep');
      return replayed(record, input_log);
    };
    const h = await harness({ modes: MODES, hooks: { ...HOOKS, replay }, settings: FAST });
    const one = await test_match(h, REP4.id, 4);
    await report(at(one.players, 0), one.id, result_bytes(0), log_bytes([3]));
    expect((await report(at(one.players, 1), one.id, result_bytes(0), log_bytes([3]))).status).toBe(Judge.MATCH_JUDGE_STATUS_PENDING);
    await tick(h, DEADLINE);
    expect(match_status(h, one.id)).toBe('CONFIRMED');
    expect(calls_of(h, 'apply_match_result').filter((c) => c.record?.match_id === one.id).every((c) => bytes_equal(c.bytes, result_bytes(3, 3)))).toBe(true);
    // Missing for the two without a report at deadline_at.
    expect(integrity(h, one.id)).toEqual(new Map([[at(one.players, 2).user_id, 'Missing'], [at(one.players, 3).user_id, 'Missing']]));
    fail = true;
    const two = await test_match(h, REP4.id, 4);
    await report(at(two.players, 0), two.id, result_bytes(0), log_bytes([3]));
    await report(at(two.players, 1), two.id, result_bytes(0), log_bytes([3]));
    await tick(h, DEADLINE);
    expect(match_status(h, two.id)).toBe('MISMATCH');
    expect(read_logs(h.server, 'error').some((l) => typeof l['message'] === 'string' && l['message'].includes('replay fails in the sweep') && l['match_id'] === two.id)).toBe(true);
  });

  it('4 players: a throw of replay_match in the decision after a left_at write makes MISMATCH at once, applies apply_match_mismatch to each participant and leaves an error log', async () => {
    const replay = (): Uint8Array | 'reject' => {
      throw new Error('replay fails after a leave');
    };
    const h = await harness({ modes: MODES, hooks: { ...HOOKS, replay } });
    const m = await live_match(h, REP4.id, 4);
    await report(m.at(0).session, m.id, result_bytes(0), log_bytes([3]));
    expect((await report(m.at(1).session, m.id, result_bytes(0), log_bytes([3]))).status).toBe(Judge.MATCH_JUDGE_STATUS_PENDING);
    await forfeit(h, m, 2);
    expect(match_status(h, m.id)).toBe('MISMATCH');
    expect(calls_of(h, 'apply_match_mismatch').map((c) => c.index).sort()).toEqual([0, 1, 2, 3]);
    expect(read_logs(h.server, 'error').some((l) => typeof l['message'] === 'string' && l['message'].includes('replay fails after a leave'))).toBe(true);
  });

  it('3 players: index 2 forfeits and index 0 reports, PENDING; the same log of index 1 confirms with replay_match, index 2 gets apply_match_result and a Forfeit event', async () => {
    const h = await harness({ modes: MODES, hooks: HOOKS });
    const m = await live_match(h, REP3.id, 3);
    await forfeit(h, m, 2);
    expect((await report(m.at(0).session, m.id, result_bytes(0), log_bytes([4]))).status).toBe(Judge.MATCH_JUDGE_STATUS_PENDING);
    expect((await report(m.at(1).session, m.id, result_bytes(0), log_bytes([4]))).status).toBe(Judge.MATCH_JUDGE_STATUS_CONFIRMED);
    await settled(h);
    expect(calls_of(h, 'apply_match_result').map((c) => c.index).sort()).toEqual([0, 1, 2]);
    expect(integrity(h, m.id)).toEqual(new Map([[m.at(2).session.user_id, 'Forfeit']]));
  });
});

describe('integrity flags', () => {
  /** One integrity event of the kind for the user, now; returns its match ID. */
  async function event_of(h: Harness, kind: 'Disagree' | 'Forfeit' | 'Missing', user: TestSession): Promise<string> {
    if (kind === 'Disagree') {
      const { id, players } = await test_match(h, CONS2.id, 2, [user]);
      await report(user, id, result_bytes(0));
      await report(at(players, 1), id, result_bytes(1));
      return id;
    }
    if (kind === 'Missing') {
      const { id, players } = await test_match(h, CONS2.id, 2, [user]);
      await report(at(players, 1), id, result_bytes(1));
      await tick(h, DEADLINE);
      return id;
    }
    const conn = await online(h, user);
    await send_and_wait(conn, match_request(CONS2.id));
    const other = await queued(h, CONS2.id);
    await tick(h);
    const found = await next(conn, K.MATCHMAKER_FRAME_KIND_MATCH_FOUND);
    await next(other.conn, K.MATCHMAKER_FRAME_KIND_MATCH_FOUND);
    await send_and_wait(conn, leave_frame(found.match_id, true));
    await until_participants(h, found.match_id, (rows) => rows[found.my_index]?.left_at !== 0n);
    await settled(h);
    await report(other.session, found.match_id, result_bytes(1));
    await settled(h);
    await close_and_wait(conn);
    await close_and_wait(other.conn);
    return found.match_id;
  }

  const KEYS = { Disagree: 'matchmaker.flagDisagreeCount', Forfeit: 'matchmaker.flagForfeitCount', Missing: 'matchmaker.flagMissingCount' } as const;

  for (const kind of ['Disagree', 'Forfeit', 'Missing'] as const) {
    it(`${kind}: flags a user at its second event in the window with one warn log, not again at the third, and not past the window of the first`, async () => {
      const window = 100_000_000;
      const h = await harness({ modes: MODES, hooks: HOOKS, settings: { ...FAST, [KEYS[kind]]: 2, 'matchmaker.flagWindowMs': window } });
      const user = await player(h);
      const first = await event_of(h, kind, user);
      expect((await list_flags(h, kind)).flags).toEqual([]);
      advance_time(h.server, 1_000n);
      const second = await event_of(h, kind, user);
      const listed = await list_flags(h, kind);
      expect(listed.status).toBe(200);
      expect(listed.flags).toEqual([{ user_id: String(user.user_id), count: 2, match_ids: [first, second] }]);
      const logs = flag_logs(h).filter((l) => String(l['user_id']) === String(user.user_id));
      expect(logs.map((l) => [l['integrity_kind'], l['flag_count']])).toEqual([[kind, 2]]);
      await event_of(h, kind, user);
      expect(flag_logs(h).filter((l) => l['integrity_kind'] === kind)).toHaveLength(1);

      // Another run with events at t1 < t2: at t1 + window only the second counts.
      const run = await harness({ modes: MODES, hooks: HOOKS, settings: { ...FAST, [KEYS[kind]]: 2, 'matchmaker.flagWindowMs': window } });
      const u = await player(run);
      await event_of(run, kind, u);
      const t1 = events_at(run, u)[0] ?? 0n;
      advance_time(run.server, 5_000n);
      await event_of(run, kind, u);
      expect((await list_flags(run, kind)).flags.map((f) => f.user_id)).toEqual([String(u.user_id)]);
      const now = storage_now(run);
      advance_time(run.server, t1 + BigInt(window) - now);
      expect((await list_flags(run, kind)).flags).toEqual([]);
    });
  }

  it('with matchmaker.flagDisagreeCount 1 leaves the log once for each user of a 2-player match with two different reports, and once for each of the four users of two matches made MISMATCH by one sweep run', async () => {
    const h = await harness({ modes: MODES, hooks: HOOKS, settings: { ...FAST, 'matchmaker.flagDisagreeCount': 1, 'matchmaker.sweepIntervalMs': 100_000_000 } });
    const { id, players } = await test_match(h, CONS2.id, 2);
    await report(at(players, 0), id, result_bytes(0));
    await report(at(players, 1), id, result_bytes(1));
    expect(flag_logs(h).map((l) => String(l['user_id'])).sort()).toEqual(players.map((p) => String(p.user_id)).sort());
    // Two 3-player matches with two different reports each wait for their third report until the sweep.
    const reporters: TestSession[] = [];
    for (let i = 0; i < 2; i += 1) {
      const m = await test_match(h, CONS3.id, 3);
      await report(at(m.players, 0), m.id, result_bytes(0));
      await report(at(m.players, 1), m.id, result_bytes(1));
      reporters.push(at(m.players, 0), at(m.players, 1));
    }
    await tick(h, 100_000_000n);
    const logged = flag_logs(h).slice(2).map((l) => String(l['user_id'])).sort();
    expect(logged).toEqual(reporters.map((p) => String(p.user_id)).sort());
  });

  it('leaves no flag log and no flag when the reporter apply hook throws in the ReportMatchResult that would raise it, and leaves it once on the resend with the same request ID', async () => {
    let throws = true;
    const hooks: Hooks = {
      ...HOOKS,
      apply_mismatch: (_core, ctx) => {
        if (ctx.request_name !== '' && throws) throw new Error('reporter apply fails');
        return 'pass';
      },
    };
    const h = await harness({ modes: MODES, hooks, settings: { 'matchmaker.flagDisagreeCount': 2 } });
    const user = await player(h);
    // The first Disagree: the user reports first, so the other participant is the reporter that decides.
    const first = await test_match(h, CONS2.id, 2, [user]);
    await report(user, first.id, result_bytes(0));
    throws = false;
    await report(at(first.players, 1), first.id, result_bytes(1));
    throws = true;
    const second = await test_match(h, CONS2.id, 2, [user]);
    await report(at(second.players, 1), second.id, result_bytes(1));
    const request = new CoreContract.ReportMatchResultRequest();
    request.match_id = second.id;
    request.result = result_bytes(0);
    const request_id = crypto.randomUUID();
    const failed = await send(user, 'core/ReportMatchResult', request, request_id);
    expect(failed.envelope.error?.code).toBe(CoreContract.CoreError.CORE_ERROR_INTERNAL);
    await settled(h);
    expect(flag_logs(h)).toEqual([]);
    expect((await list_flags(h, 'Disagree')).flags).toEqual([]);
    throws = false;
    const resent = await send(user, 'core/ReportMatchResult', request, request_id);
    expect((resent.response as CoreContract.ReportMatchResultResponse | null)?.status).toBe(Judge.MATCH_JUDGE_STATUS_MISMATCH);
    expect(flag_logs(h).map((l) => [String(l['user_id']), l['flag_count']])).toEqual([[String(user.user_id), 2]]);
  });

  it('list_match_flags with limit 1 returns the flagged user with the smallest user ID, then the next after it, and a limit out of the admin-api body rules is bad_request', async () => {
    const h = await harness({ modes: MODES, hooks: HOOKS, settings: { 'matchmaker.flagDisagreeCount': 1 } });
    const { id, players } = await test_match(h, CONS2.id, 2);
    await report(at(players, 0), id, result_bytes(0));
    await report(at(players, 1), id, result_bytes(1));
    const ids = players.map((p) => p.user_id).sort((a, b) => (a < b ? -1 : 1));
    const first = await list_flags(h, 'Disagree', 1);
    expect(first.flags.map((f) => f.user_id)).toEqual([String(at(ids, 0))]);
    const after = await list_flags(h, 'Disagree', 1, at(ids, 0));
    expect(after.flags.map((f) => f.user_id)).toEqual([String(at(ids, 1))]);
    expect((await list_flags(h, 'Disagree', 1, at(ids, 1))).flags).toEqual([]);
    expect((await list_flags(h, 'Disagree', 0)).status).toBe(400);
  });

  it('fails the settings check of routing with matchmaker.flagDisagreeCount, flagForfeitCount or flagMissingCount 0', async () => {
    for (const key of Object.values(KEYS)) {
      await expect(harness({ modes: MODES, hooks: HOOKS, settings: { [key]: 0 } })).rejects.toThrow();
    }
  });
});

/** The `at` of the integrity events of a user, ascending. */
function events_at(h: Harness, user: TestSession): bigint[] {
  const rows = storage_module(h.server).read_db().query('SELECT at FROM matchmaker_integrity WHERE user_id = $1 ORDER BY at', [user.user_id]);
  return rows.map((r) => r['at'] as bigint);
}

/** `server-time.clock_now` of the test server. */
function storage_now(h: Harness): bigint {
  const time = h.core()['server-time'] as unknown as { clock_now(): bigint };
  return time.clock_now();
}

describe('get_match', () => {
  it('returns the reports, leave, end and disconnect times and the integrity of each participant of a MISMATCH match, keeps a record with an event for the larger of the two retentions, and is not_found after the expiry', async () => {
    const h = await harness({ modes: MODES, hooks: HOOKS, settings: { 'matchmaker.recordRetentionMs': 1_000, 'matchmaker.flagWindowMs': 5_000 } });
    const flagged = await live_match(h, CONS2.id, 2);
    await close_and_wait(flagged.at(1).conn);
    await until_participants(h, flagged.id, (rows) => rows[1]?.disconnected_at !== 0n);
    await report(flagged.at(0).session, flagged.id, result_bytes(0), log_bytes([1]));
    expect((await report(flagged.at(1).session, flagged.id, result_bytes(1), log_bytes([2]))).status).toBe(Judge.MATCH_JUDGE_STATUS_MISMATCH);
    const plain = await test_match(h, CONS2.id, 2);
    await report(at(plain.players, 0), plain.id, result_bytes(1));
    await report(at(plain.players, 1), plain.id, result_bytes(1));
    await settled(h);

    const got = await send_admin(h.server, 'get_match', { match_id: flagged.id });
    expect(got.status).toBe(200);
    const match = (got.json as { match: Record<string, unknown> }).match;
    expect(match['status']).toBe('MATCH_JUDGE_STATUS_MISMATCH');
    const rows = match['participants'] as Record<string, unknown>[];
    const b64 = (bytes: Uint8Array): string => Buffer.from(bytes).toString('base64');
    expect(rows.map((r) => [r['result'], r['input_log'], r['integrity']])).toEqual([
      [b64(result_bytes(0)), b64(log_bytes([1])), 'Disagree'],
      [b64(result_bytes(1)), b64(log_bytes([2])), 'Disagree'],
    ]);
    expect(rows.map((r) => [r['left_at'], r['ended_at'], r['disconnected_at'] !== '0'])).toEqual([['0', '0', false], ['0', '0', true]]);

    advance_time(h.server, 1_000n);
    expect((await send_admin(h.server, 'get_match', { match_id: plain.id })).status).toBe(404);
    expect((await send_admin(h.server, 'get_match', { match_id: flagged.id })).status).toBe(200);
    advance_time(h.server, 4_000n);
    await storage_module(h.server).sweep_expired();
    expect((await send_admin(h.server, 'get_match', { match_id: flagged.id })).status).toBe(404);
  });
});

describe('personal data', () => {
  it('export_personal_data holds the integrity events and the matchmaker_participant rows of the user with result, input_log and the leave, end and disconnect times', async () => {
    const h = await harness({ modes: MODES, hooks: HOOKS });
    const m = await live_match(h, CONS2.id, 2);
    const user = m.at(0).session;
    await report(user, m.id, result_bytes(0), log_bytes([7]));
    await report(m.at(1).session, m.id, result_bytes(1));
    const out = await send_admin(h.server, 'export_personal_data', { user_id: user.user_id });
    expect(out.status).toBe(200);
    const tables = (out.json as { tables: Record<string, Record<string, unknown>[]> }).tables;
    expect(tables['matchmaker_integrity']?.map((r) => [r['match_id'], r['kind']])).toEqual([[m.id, 'Disagree']]);
    const rows = tables['matchmaker_participant'] ?? [];
    expect(rows).toHaveLength(1);
    const row = at(rows, 0);
    expect(row['match_id']).toBe(m.id);
    for (const column of ['result', 'input_log', 'left_at', 'ended_at', 'disconnected_at']) expect(Object.keys(row)).toContain(column);
  });
});

describe('LEFT write', () => {
  it('sends MATCH_FOUND of the new match before the retry of a failed LEFT of the previous match, writes a later DISCONNECTED of another index without waiting for it, and the retry writes left_at later', async () => {
    const h = await harness({ modes: MODES, hooks: HOOKS, settings: { 'matchmaker.applyRetryInitialMs': 2_000 } });
    const first = await live_match(h, CONS2.id, 2);
    const a = first.at(0);
    await send_and_wait(a.conn, match_request(CONS2.id));
    const c = await queued(h, CONS2.id);
    // The first lock of the previous record in the tick is the first attempt of the LEFT of a.
    fail_match_lock(h, first.id, 1);
    await tick(h);
    await next(a.conn, K.MATCHMAKER_FRAME_KIND_MATCH_FOUND);
    await next(c.conn, K.MATCHMAKER_FRAME_KIND_MATCH_FOUND);
    vi.restoreAllMocks();
    expect(participants(h, first.id)[0]?.left_at).toBe(0n);
    expect(read_logs(h.server, 'error').some((l) => l['message'] === 'participant change failed' && l['match_id'] === first.id)).toBe(true);
    await close_and_wait(first.at(1).conn);
    await until_participants(h, first.id, (rows) => rows[1]?.disconnected_at !== 0n);
    expect(participants(h, first.id)[0]?.left_at).toBe(0n);
    advance_time(h.server, 2_000n);
    await until_participants(h, first.id, (rows) => rows[0]?.left_at !== 0n);
  });

  it('On PostgreSQL, writes the left_at of a LEFT whose first attempt exceeded its lock wait with a later attempt, so the participant is a forfeiter, and drops a DISCONNECTED under the same lock', async () => {
    const h = await harness({ modes: MODES, hooks: HOOKS, db: 'postgresql', settings: { 'storage.userLockWaitMs': 300, 'matchmaker.applyRetryInitialMs': 2_000 } });
    const m = await live_match(h, CONS2.id, 2);
    const release = await hold_game_row_lock(h.server, 'matchmaker_match', [m.id]);
    try {
      await send_and_wait(m.at(1).conn, leave_frame(m.id, true));
      await until(() => read_logs(h.server, 'error').some((l) => l['message'] === 'participant change failed' && l['change'] === 'LEFT'));
      await close_and_wait(m.at(0).conn);
      await until(() => read_logs(h.server, 'error').some((l) => l['message'] === 'participant change failed' && l['change'] === 'DISCONNECTED'));
    } finally {
      await release();
    }
    expect(participants(h, m.id).map((p) => [p.left_at, p.disconnected_at])).toEqual([[0n, 0n], [0n, 0n]]);
    advance_time(h.server, 2_000n);
    await until_participants(h, m.id, (rows) => rows[1]?.left_at !== 0n);
    await settled(h);
    expect(participants(h, m.id)[0]?.disconnected_at).toBe(0n);
    expect((await report(m.at(0).session, m.id, result_bytes(1))).status).toBe(Judge.MATCH_JUDGE_STATUS_FORFEIT);
  });

  it('handles a MATCH_LEAVE with forfeit true that arrived before the close of its connection, while that connection waited in its frame handling, as LEFT after the wait and writes no disconnected_at', async () => {
    const h = await harness({ modes: MODES, hooks: HOOKS });
    const m = await live_match(h, CONS2.id, 2);
    const conn = m.at(1).conn;
    const held = hold_next_transaction(h, 'run_rollback_transaction');
    // The MATCH_REQUEST waits in its prepare_match_request transaction; MATCH_LEAVE and the close come behind it.
    send_frame(conn, match_request(CONS2.id));
    await vi.waitFor(() => {
      expect(held.calls()).toBe(1);
    });
    send_frame(conn, leave_frame(m.id, true));
    // The server closes its side when it handles the close, after the MATCH_LEAVE arrived.
    await close_and_wait(conn);
    // While the hold is in place, the MATCH_LEAVE waits behind the MATCH_REQUEST: no PEER_LEFT, no left_at.
    expect(kinds(await barrier(m.at(0).conn))).not.toContain(K.MATCHMAKER_FRAME_KIND_PEER_LEFT);
    expect(participants(h, m.id)[1]?.left_at).toBe(0n);
    held.open();
    await held.done();
    await until_participants(h, m.id, (rows) => rows[1]?.left_at !== 0n);
    await settled(h);
    expect(participants(h, m.id)[1]?.disconnected_at).toBe(0n);
    expect(kinds(await barrier(m.at(0).conn))).toContain(K.MATCHMAKER_FRAME_KIND_PEER_LEFT);
  });

  it('sends HELLO_ACK of a new connection of that user after the MATCH_LEAVE waiting behind the frame handling of the replaced connection was handled', async () => {
    const h = await harness({ modes: MODES, hooks: HOOKS });
    const m = await live_match(h, CONS2.id, 2);
    const p = m.at(1);
    const held = hold_next_transaction(h, 'run_rollback_transaction');
    send_frame(p.conn, match_request(CONS2.id));
    await vi.waitFor(() => {
      expect(held.calls()).toBe(1);
    });
    send_frame(p.conn, leave_frame(m.id, true));
    // The MATCH_LEAVE must arrive before the replaced connection closes. A barrier on that connection is answered only
    // after the hold, so a round trip on the other participant's connection lets the server read it first.
    await barrier(m.at(0).conn);
    const fresh = await connect(h.server);
    let acked = false;
    const ack = next(fresh, K.MATCHMAKER_FRAME_KIND_HELLO_ACK).then((f) => {
      acked = true;
      return f;
    });
    send_frame(fresh, hello(p.session, h.client_data_version));
    expect(await close_code(p.conn)).toBe(CoreContract.CoreError.CORE_ERROR_SESSION_REPLACED);
    expect(kinds(await barrier(m.at(0).conn))).not.toContain(K.MATCHMAKER_FRAME_KIND_PEER_LEFT);
    expect(acked).toBe(false);
    expect(participants(h, m.id)[1]?.left_at).toBe(0n);
    held.open();
    await held.done();
    await ack;
    await until_participants(h, m.id, (rows) => rows[1]?.left_at !== 0n);
    await settled(h);
    expect(participants(h, m.id)[1]?.disconnected_at).toBe(0n);
  });
});
