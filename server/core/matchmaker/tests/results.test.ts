/** `### ReportMatchResult`, `### result decision` and the apply hook inputs. */
import * as CoreContract from '../../../generated/contract/core_contract.ts';
import * as GameContract from '../../../generated/contract/game_contract.ts';
import { advance_time, call_dev, hold_game_row_lock, load_data, read_logs, send, wait_background } from '../../testing/dev/index.ts';
import type { MatchRecordInput } from '../index.ts';
import {
  CoreError,
  GameError,
  Judge,
  K,
  bytes_equal,
  calls_of,
  close_and_wait,
  frame,
  harness,
  hold_until_waiter,
  log_bytes,
  match_request,
  matched,
  mode,
  next,
  online,
  participants,
  player,
  report,
  result_bytes,
  send_and_wait,
  settled,
  stop_all,
  tick,
  until,
  until_participants,
  version,
  type Harness,
  type HookCall,
  type Hooks,
} from './helpers.ts';

const CONS2 = mode(7401);
const MAJ3 = mode(7402, { result_rule: 'Majority', min_players: 3, max_players: 3 });
const REP2 = mode(7403, { result_rule: 'ServerReplay' });
const REP3 = mode(7404, { result_rule: 'ServerReplay', min_players: 3, max_players: 3 });
const MODES = [CONS2, MAJ3, REP2, REP3];

/** `replay_match` of the tests: the result is winner = first input, score = sum of inputs. */
function replayed(_record: MatchRecordInput, input_log: Uint8Array): Uint8Array | 'reject' {
  const inputs = GameContract.MatchInputLog.decode(input_log)?.inputs ?? [];
  return result_bytes(inputs[0] ?? 0, inputs.reduce((a, b) => a + b, 0));
}

const HOOKS: Hooks = { apply_result: () => 'pass', apply_mismatch: () => 'pass', replay: replayed };

afterEach(async () => {
  await stop_all();
});

async function test_match(h: Harness, mode_id: number, n: number, seed = 42n): Promise<{ id: string; players: Awaited<ReturnType<typeof player>>[] }> {
  const players = [];
  for (let i = 0; i < n; i += 1) players.push(await player(h));
  const id = (await call_dev(h.server, 'matchmaker', 'create_test_match', [mode_id, players.map((p) => p.user_id), seed])) as string;
  return { id, players };
}

function applied(h: Harness): { hook: string; index: number; out_of_request: boolean }[] {
  return h.calls
    .filter((c) => c.hook === 'apply_match_result' || c.hook === 'apply_match_mismatch')
    .map((c) => ({ hook: c.hook, index: c.index, out_of_request: c.ctx?.request_name === '' }))
    .sort((a, b) => a.index - b.index);
}

describe('decision', () => {
  it('Consensus: two different results are MISMATCH and apply_match_mismatch runs once per participant with both results in participants', async () => {
    const h = await harness({ modes: MODES, hooks: HOOKS });
    const { id, players } = await test_match(h, CONS2.id, 2);
    const [a, b] = players;
    if (a === undefined || b === undefined) throw new Error('players');
    expect(await report(a, id, result_bytes(0))).toEqual({ code: 0, status: Judge.MATCH_JUDGE_STATUS_PENDING });
    expect(await report(b, id, result_bytes(1))).toEqual({ code: 0, status: Judge.MATCH_JUDGE_STATUS_MISMATCH });
    await settled(h);
    expect(applied(h).map((c) => [c.hook, c.index])).toEqual([['apply_match_mismatch', 0], ['apply_match_mismatch', 1]]);
    const record = calls_of(h, 'apply_match_mismatch')[0]?.record;
    expect(record?.participants.map((p) => bytes_equal(p.result, result_bytes(p === record.participants[0] ? 0 : 1)))).toEqual([true, true]);
  });

  it('Majority with 3: two same results confirm, and the participant who did not report gets the apply out of request', async () => {
    const h = await harness({ modes: MODES, hooks: HOOKS });
    const { id, players } = await test_match(h, MAJ3.id, 3);
    const [a, b] = players;
    if (a === undefined || b === undefined) throw new Error('players');
    await report(a, id, result_bytes(2));
    expect((await report(b, id, result_bytes(2))).status).toBe(Judge.MATCH_JUDGE_STATUS_CONFIRMED);
    await settled(h);
    expect(applied(h)).toEqual([
      { hook: 'apply_match_result', index: 0, out_of_request: true },
      { hook: 'apply_match_result', index: 1, out_of_request: false },
      { hook: 'apply_match_result', index: 2, out_of_request: true },
    ]);
    expect(calls_of(h, 'apply_match_result').every((c) => bytes_equal(c.bytes, result_bytes(2)))).toBe(true);
  });

  it('ServerReplay with 2: different input_log is MISMATCH; the same is CONFIRMED with the replay_match result', async () => {
    const h = await harness({ modes: MODES, hooks: HOOKS });
    const m1 = await test_match(h, REP2.id, 2);
    await report(m1.players[0] ?? (await player(h)), m1.id, result_bytes(0), log_bytes([1]));
    expect((await report(m1.players[1] ?? (await player(h)), m1.id, result_bytes(0), log_bytes([2]))).status).toBe(Judge.MATCH_JUDGE_STATUS_MISMATCH);
    expect(calls_of(h, 'replay_match')).toEqual([]);
    const m2 = await test_match(h, REP2.id, 2);
    await report(m2.players[0] ?? (await player(h)), m2.id, result_bytes(9), log_bytes([3, 4]));
    expect((await report(m2.players[1] ?? (await player(h)), m2.id, result_bytes(8), log_bytes([3, 4]))).status).toBe(Judge.MATCH_JUDGE_STATUS_CONFIRMED);
    await settled(h);
    expect(calls_of(h, 'replay_match')).toHaveLength(1);
    expect(calls_of(h, 'apply_match_result').every((c) => bytes_equal(c.bytes, result_bytes(3, 7)))).toBe(true);
  });

  it('ServerReplay with 3: waits after two different logs, replays the log the third matches once, and records all three logs', async () => {
    const h = await harness({ modes: MODES, hooks: HOOKS });
    const m = await test_match(h, REP3.id, 3);
    const [a, b, c] = m.players;
    if (a === undefined || b === undefined || c === undefined) throw new Error('players');
    await report(a, m.id, result_bytes(0), log_bytes([1]));
    expect((await report(b, m.id, result_bytes(0), log_bytes([2]))).status).toBe(Judge.MATCH_JUDGE_STATUS_PENDING);
    expect((await report(c, m.id, result_bytes(0), log_bytes([2]))).status).toBe(Judge.MATCH_JUDGE_STATUS_CONFIRMED);
    await settled(h);
    const replays = calls_of(h, 'replay_match');
    expect(replays).toHaveLength(1);
    expect(bytes_equal(replays[0]?.bytes ?? new Uint8Array(0), log_bytes([2]))).toBe(true);
    const record = calls_of(h, 'apply_match_result')[0]?.record;
    expect(record?.participants.map((p) => [...p.input_log])).toEqual([[...log_bytes([1])], [...log_bytes([2])], [...log_bytes([2])]]);
    expect([...(record?.replayed_input_log ?? [])]).toEqual([...log_bytes([2])]);
    const all = await test_match(h, REP3.id, 3);
    const [x, y, z] = all.players;
    if (x === undefined || y === undefined || z === undefined) throw new Error('players');
    await report(x, all.id, result_bytes(0), log_bytes([1]));
    await report(y, all.id, result_bytes(0), log_bytes([2]));
    expect((await report(z, all.id, result_bytes(0), log_bytes([3]))).status).toBe(Judge.MATCH_JUDGE_STATUS_MISMATCH);
    await settled(h);
    const mismatch = calls_of(h, 'apply_match_mismatch').find((c) => c.record?.match_id === all.id)?.record;
    expect(mismatch?.replayed_input_log.length).toBe(0);
  });

  it('ServerReplay: the same logs with replay_match answering reject is MISMATCH', async () => {
    const h = await harness({ modes: MODES, hooks: { ...HOOKS, replay: () => 'reject' } });
    const m = await test_match(h, REP2.id, 2);
    await report(m.players[0] ?? (await player(h)), m.id, result_bytes(0), log_bytes([1]));
    expect((await report(m.players[1] ?? (await player(h)), m.id, result_bytes(0), log_bytes([1]))).status).toBe(Judge.MATCH_JUDGE_STATUS_MISMATCH);
  });

  it('Consensus: the same result breaking (ogw.v) is MISMATCH without apply_match_result; ServerReplay with such a log does not replay', async () => {
    const h = await harness({ modes: MODES, hooks: HOOKS });
    const m = await test_match(h, CONS2.id, 2);
    await report(m.players[0] ?? (await player(h)), m.id, result_bytes(99));
    expect((await report(m.players[1] ?? (await player(h)), m.id, result_bytes(99))).status).toBe(Judge.MATCH_JUDGE_STATUS_MISMATCH);
    await settled(h);
    expect(calls_of(h, 'apply_match_result')).toEqual([]);
    expect(calls_of(h, 'apply_match_mismatch')).toHaveLength(2);
    const r = await test_match(h, REP2.id, 2);
    await report(r.players[0] ?? (await player(h)), r.id, result_bytes(0), log_bytes([99]));
    expect((await report(r.players[1] ?? (await player(h)), r.id, result_bytes(0), log_bytes([99]))).status).toBe(Judge.MATCH_JUDGE_STATUS_MISMATCH);
    expect(calls_of(h, 'replay_match')).toEqual([]);
  });
});

describe('ServerReplay with leaving participants', () => {
  async function three(h: Harness): Promise<Awaited<ReturnType<typeof matched>>> {
    return matched(h, REP3.id, 3);
  }

  it('waits for a staying participant after a MATCH_LEAVE, confirms on its report, and applies to the one who left too', async () => {
    const h = await harness({ modes: MODES, hooks: HOOKS });
    const { players, found } = await three(h);
    const id = found[0]?.match_id ?? '';
    const [a, b, c] = players;
    if (a === undefined || b === undefined || c === undefined) throw new Error('players');
    await send_and_wait(c.conn, frame(K.MATCHMAKER_FRAME_KIND_MATCH_LEAVE, (f) => {
      f.match_id = id;
    }));
    expect((await report(a.session, id, result_bytes(0), log_bytes([5]))).status).toBe(Judge.MATCH_JUDGE_STATUS_PENDING);
    expect((await report(b.session, id, result_bytes(0), log_bytes([5]))).status).toBe(Judge.MATCH_JUDGE_STATUS_CONFIRMED);
    await settled(h);
    expect(applied(h).map((x) => x.index)).toEqual([0, 1, 2]);
  });

  it('confirms a 2-player match on the report after the other matchmaker connection closed, and makes MISMATCH when the one who left reported another log', async () => {
    const h = await harness({ modes: MODES, hooks: HOOKS });
    const one = await matched(h, REP2.id, 2);
    const id = one.found[0]?.match_id ?? '';
    const [a, b] = one.players;
    if (a === undefined || b === undefined) throw new Error('players');
    await close_and_wait(b.conn);
    await until_participants(h, id, (rows) => rows.some((p) => p.disconnected_at !== 0n));
    expect((await report(a.session, id, result_bytes(0), log_bytes([1]))).status).toBe(Judge.MATCH_JUDGE_STATUS_CONFIRMED);
    const two = await matched(h, REP2.id, 2);
    const id2 = two.found[0]?.match_id ?? '';
    const [x, y] = two.players;
    if (x === undefined || y === undefined) throw new Error('players');
    await send_and_wait(y.conn, frame(K.MATCHMAKER_FRAME_KIND_MATCH_LEAVE, (f) => {
      f.match_id = id2;
    }));
    await report(y.session, id2, result_bytes(0), log_bytes([2]));
    expect((await report(x.session, id2, result_bytes(0), log_bytes([1]))).status).toBe(Judge.MATCH_JUDGE_STATUS_MISMATCH);
  });

  it('logs a participant change whose transaction waits past storage.userLockWaitMs for the match record lock, and leaves the record as it was (PostgreSQL)', async () => {
    const h = await harness({ modes: MODES, hooks: HOOKS, db: 'postgresql', settings: { 'storage.userLockWaitMs': 300 } });
    const { found, players } = await matched(h, CONS2.id, 2);
    const id = found[0]?.match_id ?? '';
    const [a] = players;
    if (a === undefined) throw new Error('players');
    // The holder's connection is on the test's thread, which the participant change's lock wait blocks: the wait ends
    // at storage.userLockWaitMs, with lock_game_row FAILED.
    const release = await hold_game_row_lock(h.server, 'matchmaker_match', [id]);
    try {
      await send_and_wait(a.conn, frame(K.MATCHMAKER_FRAME_KIND_MATCH_LEAVE, (f) => {
        f.match_id = id;
      }));
      await until(() => read_logs(h.server, 'error').some((l) => l['message'] === 'match record transaction failed' && l['match_id'] === id));
    } finally {
      await release();
    }
    expect(participants(h, id).map((p) => p.left_at)).toEqual([0n, 0n]);
  });

  it('does not count the report of a participant who left when it picks the log to replay with 3', async () => {
    const h = await harness({ modes: MODES, hooks: HOOKS });
    const { players, found } = await three(h);
    const id = found[0]?.match_id ?? '';
    const [a, b, c] = players;
    if (a === undefined || b === undefined || c === undefined) throw new Error('players');
    await send_and_wait(c.conn, frame(K.MATCHMAKER_FRAME_KIND_MATCH_LEAVE, (f) => {
      f.match_id = id;
    }));
    await report(c.session, id, result_bytes(0), log_bytes([2]));
    await report(a.session, id, result_bytes(0), log_bytes([1]));
    // Counting c, [2] would have 2 of 3 reports; without it, [1] and [2] split the two staying reports.
    expect((await report(b.session, id, result_bytes(0), log_bytes([2]))).status).toBe(Judge.MATCH_JUDGE_STATUS_MISMATCH);
    expect(calls_of(h, 'replay_match')).toEqual([]);
  });
});

describe('versions', () => {
  it('keeps the participants HELLO data_version and client_version in the match record', async () => {
    const compat = version('b', '2');
    const h = await harness({ modes: MODES, hooks: HOOKS, compat_client_data_version: compat });
    const a = await player(h);
    const b = await player(h);
    const ca = await online(h, a, compat, '1.0.0');
    const cb = await online(h, b, compat, '1.0.0');
    await send_and_wait(ca, match_request(CONS2.id));
    await send_and_wait(cb, match_request(CONS2.id));
    await tick(h);
    const found = await next(ca, K.MATCHMAKER_FRAME_KIND_MATCH_FOUND);
    await report(a, found.match_id, result_bytes(0));
    await report(b, found.match_id, result_bytes(1));
    await settled(h);
    const record = calls_of(h, 'apply_match_mismatch')[0]?.record;
    expect(record?.data_version).toBe(compat);
    expect(record?.client_version).toBe('1.0.0');
  });
});

describe('deadline', () => {
  const settings = { 'matchmaker.reportMarginMs': 1_000, 'matchmaker.sweepIntervalMs': 1 };
  /** prepare_time + max_duration + reportMarginMs of CONS2 with these settings. */
  const DEADLINE = CONS2.prepare_time + CONS2.max_duration + 1_000n;

  it('makes a match not decided by deadline_at MISMATCH', async () => {
    const h = await harness({ modes: MODES, hooks: HOOKS, settings });
    await test_match(h, CONS2.id, 2);
    await tick(h, DEADLINE - 1n);
    expect(applied(h)).toEqual([]);
    await tick(h, 1n);
    expect(applied(h).map((c) => [c.hook, c.index])).toEqual([['apply_match_mismatch', 0], ['apply_match_mismatch', 1]]);
  });

  it('answers a report after deadline_at before the sweep with MISMATCH without storing it, applies once each, and the sweep does not decide it again', async () => {
    const h = await harness({ modes: MODES, hooks: HOOKS, settings: { ...settings, 'matchmaker.sweepIntervalMs': 100_000_000 } });
    const { id, players } = await test_match(h, CONS2.id, 2);
    advance_time(h.server, DEADLINE);
    expect((await report(players[0] ?? (await player(h)), id, result_bytes(0))).status).toBe(Judge.MATCH_JUDGE_STATUS_MISMATCH);
    await settled(h);
    expect(applied(h).map((c) => [c.hook, c.index, c.out_of_request])).toEqual([
      ['apply_match_mismatch', 0, true],
      ['apply_match_mismatch', 1, true],
    ]);
    expect(calls_of(h, 'apply_match_mismatch').every((c) => c.record?.participants[0]?.reported_at === 0n)).toBe(true);
    await tick(h, 100_000_000n);
    expect(applied(h)).toHaveLength(2);
  });
});

describe('report errors', () => {
  it('answers an unknown match, a non-participant and a second report with their CoreError, and a report after the decision with the decision only', async () => {
    const h = await harness({ modes: MODES, hooks: HOOKS });
    const { id, players } = await test_match(h, CONS2.id, 2);
    const [a, b] = players;
    if (a === undefined || b === undefined) throw new Error('players');
    expect((await report(a, crypto.randomUUID())).code).toBe(CoreError.CORE_ERROR_MATCH_NOT_FOUND);
    expect((await report(a, 'not-a-uuid')).code).toBe(CoreError.CORE_ERROR_INVALID_REQUEST);
    expect((await report(await player(h), id)).code).toBe(CoreError.CORE_ERROR_MATCH_NOT_PARTICIPANT);
    await report(a, id, result_bytes(0));
    expect((await report(a, id, result_bytes(0))).code).toBe(CoreError.CORE_ERROR_MATCH_ALREADY_REPORTED);
    expect((await report(b, id, result_bytes(0))).status).toBe(Judge.MATCH_JUDGE_STATUS_CONFIRMED);
    await settled(h);
    const before = applied(h).length;
    expect(await report(b, id, result_bytes(5))).toEqual({ code: 0, status: Judge.MATCH_JUDGE_STATUS_CONFIRMED });
    await settled(h);
    expect(applied(h)).toHaveLength(before);
  });

  it('decides and applies once per participant when two participants report at the same time', async () => {
    const h = await harness({ modes: MODES, hooks: HOOKS });
    const { id, players } = await test_match(h, CONS2.id, 2);
    const out = await Promise.all(players.map((p) => report(p, id, result_bytes(1))));
    expect(out.map((o) => o.status).sort()).toEqual([Judge.MATCH_JUDGE_STATUS_PENDING, Judge.MATCH_JUDGE_STATUS_CONFIRMED].sort());
    await settled(h);
    expect(applied(h).map((c) => c.index)).toEqual([0, 1]);
  });

  it('calls the decision and the apply hooks for a match made by create_test_match', async () => {
    const h = await harness({ modes: MODES, hooks: HOOKS });
    const { id, players } = await test_match(h, CONS2.id, 2, 777n);
    for (const p of players) await report(p, id, result_bytes(1));
    await settled(h);
    const record = calls_of(h, 'apply_match_result')[0]?.record;
    expect(record?.seed).toBe(777n);
    expect(record?.source).toBe('Queue');
    expect(record?.ratings).toEqual([0n, 0n]);
    expect(applied(h)).toHaveLength(2);
  });

  it('keeps the report and decision and marks the index when the reporter apply hook returns a GameError; the other apply goes on', async () => {
    let refuse: bigint | null = null;
    const hooks: Hooks = { apply_result: (_core, ctx) => (ctx.user_id === refuse ? GameError.GAME_ERROR_CORE_TEST : 'pass') };
    const h = await harness({ modes: MODES, hooks, settings: { 'matchmaker.sweepIntervalMs': 1 } });
    for (const order of [[0, 1], [1, 0]]) {
      const { id, players } = await test_match(h, CONS2.id, 2);
      const first = players[order[0] ?? 0];
      const last = players[order[1] ?? 1];
      if (first === undefined || last === undefined) throw new Error('players');
      refuse = last.user_id;
      await report(first, id, result_bytes(1));
      expect(await report(last, id, result_bytes(1))).toEqual({ code: 0, status: Judge.MATCH_JUDGE_STATUS_CONFIRMED });
      await settled(h);
      expect(calls_of(h, 'apply_match_result').filter((c) => c.record?.match_id === id).map((c) => c.user_id).sort()).toEqual([first.user_id, last.user_id].sort());
      // Marked: a report after this is the decision only, and job matchmaker_sweep does not apply it again.
      expect((await report(last, id, result_bytes(1))).status).toBe(Judge.MATCH_JUDGE_STATUS_CONFIRMED);
      await tick(h, 1_000n);
    }
    expect(calls_of(h, 'apply_match_result')).toHaveLength(4);
    const errors = read_logs(h.server, 'error');
    expect(errors.some((l) => l['message'] === 'match apply rejected')).toBe(true);
  });
});

describe('reporter hook failures', () => {
  it('answers INTERNAL without storing the report when the reporter apply_match_result throws or returns a malformed value or a number below 1000; the record stays PENDING', async () => {
    let fault: 'throw' | 'malformed' | number | null = null;
    let reporter: bigint | null = null;
    const hooks: Hooks = {
      apply_result: (_core, ctx) => {
        if (ctx.user_id !== reporter || fault === null) return 'pass';
        if (fault === 'throw') throw new Error('reporter apply fails');
        if (fault === 'malformed') return 'done' as unknown as 'pass';
        return fault;
      },
    };
    const h = await harness({ modes: MODES, hooks });
    // 999 and -1 are numbers out of the GameError range: a wrong output form, not a GameError.
    for (const kind of ['throw', 'malformed', 999, -1] as const) {
      const { id, players } = await test_match(h, CONS2.id, 2);
      const [a, b] = players;
      if (a === undefined || b === undefined) throw new Error('players');
      await report(a, id, result_bytes(1));
      fault = kind;
      reporter = b.user_id;
      expect((await report(b, id, result_bytes(1))).code).toBe(CoreError.CORE_ERROR_INTERNAL);
      // Still PENDING with a's report only: a's report is a duplicate, and b's report was not stored.
      expect((await report(a, id, result_bytes(1))).code).toBe(CoreError.CORE_ERROR_MATCH_ALREADY_REPORTED);
      fault = null;
      expect(await report(b, id, result_bytes(1))).toEqual({ code: 0, status: Judge.MATCH_JUDGE_STATUS_CONFIRMED });
      await settled(h);
      expect(calls_of(h, 'apply_match_result').filter((c) => c.record?.match_id === id).map((c) => c.index)).toEqual([1, 1, 0]);
    }
  });

  it('answers INTERNAL without storing the report when replay_match throws or returns a value that is not bytes; the record stays PENDING', async () => {
    let fault: 'throw' | 'malformed' | null = null;
    const replay = (record: MatchRecordInput, input_log: Uint8Array): Uint8Array | 'reject' => {
      if (fault === 'throw') throw new Error('replay fails');
      if (fault === 'malformed') return 7 as unknown as Uint8Array;
      return replayed(record, input_log);
    };
    const h = await harness({ modes: MODES, hooks: { ...HOOKS, replay } });
    for (const kind of ['throw', 'malformed'] as const) {
      const { id, players } = await test_match(h, REP2.id, 2);
      const [a, b] = players;
      if (a === undefined || b === undefined) throw new Error('players');
      await report(a, id, result_bytes(0), log_bytes([4]));
      fault = kind;
      expect((await report(b, id, result_bytes(0), log_bytes([4]))).code).toBe(CoreError.CORE_ERROR_INTERNAL);
      expect((await report(a, id, result_bytes(0), log_bytes([4]))).code).toBe(CoreError.CORE_ERROR_MATCH_ALREADY_REPORTED);
      fault = null;
      expect(await report(b, id, result_bytes(0), log_bytes([4]))).toEqual({ code: 0, status: Judge.MATCH_JUDGE_STATUS_CONFIRMED });
      await settled(h);
      expect(calls_of(h, 'apply_match_result').filter((c) => c.record?.match_id === id).map((c) => c.index).sort()).toEqual([0, 1]);
    }
  });
});

describe('change source', () => {
  it('records ItemChange source Match and ref match_id for items the apply hook gives, in the reporter apply and out of request', async () => {
    const gold = load_data().dev.find_id_value('[gold]');
    const give: Hooks['apply_result'] = (core, ctx) => {
      const ledger = core['item-ledger'] as unknown as { add_items(ctx: unknown, items: unknown[], source: unknown): unknown };
      const item = new CoreContract.ItemAmount();
      item.item_id = gold;
      item.amount = 5n;
      ledger.add_items(ctx, [item], { source: CoreContract.ItemChangeSource.ITEM_CHANGE_SOURCE_REQUEST, ref: '', once_key: '' });
      return 'pass';
    };
    const h = await harness({ modes: MODES, hooks: { apply_result: give } });
    const { id, players } = await test_match(h, CONS2.id, 2);
    const [a, b] = players;
    if (a === undefined || b === undefined) throw new Error('players');
    await report(a, id, result_bytes(1));
    const request = new CoreContract.ReportMatchResultRequest();
    request.match_id = id;
    request.result = result_bytes(1);
    const reporter = await send(b, 'core/ReportMatchResult', request);
    expect(reporter.envelope.item_changes.map((c) => [c.source, c.ref])).toEqual([[CoreContract.ItemChangeSource.ITEM_CHANGE_SOURCE_MATCH, id]]);
    await wait_background(h.server);
    const resync = await send(a, 'core/Resync', new CoreContract.ResyncRequest());
    expect(resync.envelope.item_changes.map((c) => [c.source, c.ref])).toEqual([[CoreContract.ItemChangeSource.ITEM_CHANGE_SOURCE_MATCH, id]]);
  });
});

describe('participants', () => {
  it('writes the close time to disconnected_at, 0 after MATCH_REJOIN, and nothing after the decision', async () => {
    const hooks: Hooks = {
      apply_result: (_core, ctx) => {
        if (ctx.request_name === '' && throw_once.has(ctx.user_id)) {
          throw_once.delete(ctx.user_id);
          throw new Error('apply later');
        }
        return 'pass';
      },
    };
    const throw_once = new Set<bigint>();
    const h = await harness({ modes: MODES, hooks, settings: { 'matchmaker.applyRetryInitialMs': 1_000, 'matchmaker.sweepIntervalMs': 1 } });
    const { players, found } = await matched(h, CONS2.id, 2);
    const id = found[0]?.match_id ?? '';
    const created_at = (found[0]?.start_at ?? 0n) - CONS2.prepare_time;
    const [a, b] = players;
    if (a === undefined || b === undefined) throw new Error('players');
    await close_and_wait(a.conn);
    await close_and_wait(b.conn);
    await until_participants(h, id, (rows) => rows.every((p) => p.disconnected_at !== 0n));
    const back = await online(h, a.session);
    await send_and_wait(back, frame(K.MATCHMAKER_FRAME_KIND_MATCH_REJOIN, (f) => {
      f.match_id = id;
    }));
    throw_once.add(b.session.user_id);
    await report(b.session, id, result_bytes(1));
    await report(a.session, id, result_bytes(1));
    const reporter = calls_of(h, 'apply_match_result')[0]?.record;
    expect(reporter?.participants.map((p) => p.disconnected_at)).toEqual([0n, created_at]);
    // b's out-of-request apply threw once and waits for its retry.
    await settled(h);
    const b_calls = (): HookCall[] => calls_of(h, 'apply_match_result').filter((c) => c.user_id === b.session.user_id);
    expect(b_calls()).toHaveLength(1);
    // After the decision: a's connection closes again; b's retried apply sees the record as decided. On PostgreSQL the
    // participant change of the close is a transaction that can still run after the close: the holder lets it take the
    // record lock first, so the retried apply reads the record after it. On SQLite it ends before the close is seen.
    const holder = h.server.shared.database.connection === null ? null : await hold_until_waiter(h.server, 'matchmaker_match', [id]);
    await close_and_wait(back);
    await holder?.released;
    await tick(h, 1_000n);
    expect(b_calls()).toHaveLength(2);
    expect(b_calls()[1]?.record?.participants.map((p) => p.disconnected_at)).toEqual([0n, created_at]);
  });

  it('writes the time a participant of a PENDING match was bound to a new match to left_at of the earlier record', async () => {
    const h = await harness({ modes: MODES, hooks: HOOKS });
    const first = await matched(h, CONS2.id, 2);
    const id = first.found[0]?.match_id ?? '';
    const [a, b] = first.players;
    if (a === undefined || b === undefined) throw new Error('players');
    await send_and_wait(a.conn, match_request(CONS2.id));
    const other = await player(h);
    const oc = await online(h, other);
    await send_and_wait(oc, match_request(CONS2.id));
    await tick(h, 5_000n);
    const second = await next(a.conn, K.MATCHMAKER_FRAME_KIND_MATCH_FOUND);
    const bound_at = second.start_at - CONS2.prepare_time;
    await report(a.session, id, result_bytes(0));
    await report(b.session, id, result_bytes(1));
    await settled(h);
    const record = calls_of(h, 'apply_match_mismatch').find((c) => c.record?.match_id === id)?.record;
    expect(record?.participants.map((p) => p.left_at)).toEqual([bound_at, 0n]);
  });

  it('gives apply_match_mismatch of a 2-player Consensus match the left_at and missing report of the one who left, after deadline_at', async () => {
    const h = await harness({ modes: MODES, hooks: HOOKS, settings: { 'matchmaker.reportMarginMs': 1_000, 'matchmaker.sweepIntervalMs': 1 } });
    const { players, found } = await matched(h, CONS2.id, 2);
    const id = found[0]?.match_id ?? '';
    const [a, b] = players;
    if (a === undefined || b === undefined) throw new Error('players');
    await send_and_wait(a.conn, frame(K.MATCHMAKER_FRAME_KIND_MATCH_LEAVE, (f) => {
      f.match_id = id;
    }));
    await report(b.session, id, result_bytes(1));
    await tick(h, CONS2.prepare_time + CONS2.max_duration + 1_000n);
    const records = calls_of(h, 'apply_match_mismatch').map((c) => c.record);
    expect(records).toHaveLength(2);
    for (const record of records) {
      expect(record?.participants[0]?.left_at).not.toBe(0n);
      expect(record?.participants[0]?.reported_at).toBe(0n);
      expect(record?.participants[1]?.reported_at).not.toBe(0n);
      expect(bytes_equal(record?.participants[1]?.result ?? new Uint8Array(0), result_bytes(1))).toBe(true);
    }
  });
});

describe('replay_match input', () => {
  it('gets the server build data, its data version and a random whose sequence is UtilCore.create_random(make_purpose_seed(match_simulation, seed))', async () => {
    const h = await harness({ modes: MODES, hooks: HOOKS });
    const m = await test_match(h, REP2.id, 2, 123_456_789n);
    for (const p of m.players) await report(p, m.id, result_bytes(0), log_bytes([4]));
    const call = calls_of(h, 'replay_match')[0];
    expect(call?.data_version).toBe(version('e', 'e'));
    expect(call?.data?.MatchModeTable.has_row(REP2.id)).toBe(true);
    expect(call?.random).toEqual(pcg32(purpose_seed('match_simulation', 123_456_789n), 4));
  });
});

const M64 = (1n << 64n) - 1n;

/** `make_purpose_seed` of `UtilCore` `### PCG32 algorithm`. */
function purpose_seed(name: string, base: bigint): bigint {
  let h = 14695981039346656037n;
  for (const c of new TextEncoder().encode(name)) h = ((h ^ BigInt(c)) * 1099511628211n) & M64;
  return BigInt.asIntN(64, h ^ BigInt.asUintN(64, base));
}

/** The first `n` `next_uint32` values of `UtilCore.create_random(seed)`. */
function pcg32(seed: bigint, n: number): number[] {
  let state = 0n;
  const step = (): number => {
    const old = state;
    state = (old * 6364136223846793005n + 1n) & M64;
    const x = Number((((old >> 18n) ^ old) >> 27n) & 0xffff_ffffn);
    const r = Number(old >> 59n);
    return ((x >>> r) | (x << ((32 - r) % 32))) >>> 0;
  };
  step();
  state = (state + BigInt.asUintN(64, seed)) & M64;
  step();
  return Array.from({ length: n }, step);
}

