/**
 * `### apply`: the out-of-request apply of each index, its retries by job `matchmaker_sweep`, withdrawn users, and
 * the record expiry. A hook that throws makes the out-of-request apply fail like `FAILED`, which these tests use to
 * hold an index unmarked.
 */
import * as CoreContract from '../../../generated/contract/core_contract.ts';
import { advance_time, call_dev, login, read_logs, send, start_peer_server, stop_test_server, wait_background } from '../../testing/dev/index.ts';
import { CoreError, Judge, RECORDING, calls_of, harness, mode, player, refuse_applied_write, report, restart, result_bytes, settled, stop_all, tick, type Harness, type Hooks } from './helpers.ts';

const CONS2 = mode(7501);
const CONS3 = mode(7502, { min_players: 3, max_players: 3 });

afterEach(async () => {
  await stop_all();
});

async function test_match(h: Harness, mode_id: number, n: number): Promise<{ id: string; players: Awaited<ReturnType<typeof player>>[] }> {
  const players = [];
  for (let i = 0; i < n; i += 1) players.push(await player(h));
  const id = (await call_dev(h.server, 'matchmaker', 'create_test_match', [mode_id, players.map((p) => p.user_id), 1n])) as string;
  return { id, players };
}

/** `apply_match_result` that throws out of request for the users in `failing`. */
function failing_hooks(failing: Set<bigint>): Hooks {
  return {
    apply_result: (_core, ctx) => {
      if (ctx.request_name === '' && failing.has(ctx.user_id)) throw new Error('apply fails');
      return 'pass';
    },
    apply_mismatch: () => 'pass',
  };
}

function calls_for(h: Harness, user_id: bigint): number {
  return calls_of(h, 'apply_match_result').filter((c) => c.user_id === user_id).length;
}

const RETRY = {
  'matchmaker.applyRetryInitialMs': 1_000,
  'matchmaker.applyRetryFactorPermille': 2_000,
  'matchmaker.applyRetryMaxIntervalMs': 3_000,
  'matchmaker.applyRetryMaxAttempts': 4,
  'matchmaker.sweepIntervalMs': 1,
};

describe('apply retry', () => {
  it('tries a FAILED apply again at clock_now + g(attempts), keeps going after a restart, and gives up at the attempt limit with error logs only at the first failure and the end', async () => {
    const failing = new Set<bigint>();
    const hooks = failing_hooks(failing);
    const h = await harness({ modes: [CONS2], hooks, settings: RETRY });
    const { id, players } = await test_match(h, CONS2.id, 2);
    const [a, b] = players;
    if (a === undefined || b === undefined) throw new Error('players');
    failing.add(b.user_id);
    await report(b, id, result_bytes(1));
    await report(a, id, result_bytes(1));
    await settled(h);
    expect(calls_for(h, b.user_id)).toBe(1);
    // g(1) = 1000.
    await tick(h, 999n);
    expect(calls_for(h, b.user_id)).toBe(1);
    await tick(h, 1n);
    expect(calls_for(h, b.user_id)).toBe(2);
    // g(2) = 2000, across a restart.
    const h2 = await restart(h);
    await tick(h2, 1_999n);
    expect(calls_for(h2, b.user_id)).toBe(2);
    await tick(h2, 1n);
    expect(calls_for(h2, b.user_id)).toBe(3);
    // g(3) = min(4000, 3000) = 3000; the 4th failure reaches the limit and gives up.
    await tick(h2, 3_000n);
    expect(calls_for(h2, b.user_id)).toBe(4);
    await tick(h2, 10_000n);
    expect(calls_for(h2, b.user_id)).toBe(4);
    // Every error line of the match: the hook failure goes on the one first-failure line, not a line per attempt.
    const errors = read_logs(h2.server, 'error').filter((l) => l['match_id'] === id);
    expect(errors.map((l) => l['message'])).toEqual(['match apply failed', 'match apply given up']);
    expect(errors[0]?.['failure']).toBe('apply_match_result threw: apply fails');
  });

  it('counts an apply whose transaction throws after the hook as a FAILED apply: tried again at clock_now + g(attempts) and given up at the attempt limit with error logs only at the first failure and the end', async () => {
    const h = await harness({ modes: [CONS2], hooks: RECORDING, settings: RETRY });
    const { id, players } = await test_match(h, CONS2.id, 2);
    const [a, b] = players;
    if (a === undefined || b === undefined) throw new Error('players');
    // a's report decides and applies a in its request; b's apply runs out of request and its applied write fails.
    await refuse_applied_write(h, id, 1);
    await report(b, id, result_bytes(1));
    await report(a, id, result_bytes(1));
    await settled(h);
    expect(calls_for(h, b.user_id)).toBe(1);
    await tick(h, 999n);
    expect(calls_for(h, b.user_id)).toBe(1);
    await tick(h, 1n);
    expect(calls_for(h, b.user_id)).toBe(2);
    await tick(h, 2_000n);
    expect(calls_for(h, b.user_id)).toBe(3);
    await tick(h, 3_000n);
    expect(calls_for(h, b.user_id)).toBe(4);
    await tick(h, 10_000n);
    expect(calls_for(h, b.user_id)).toBe(4);
    const errors = read_logs(h.server, 'error').filter((l) => l['match_id'] === id);
    expect(errors.map((l) => l['message'])).toEqual(['match apply failed', 'match apply given up']);
    expect(String(errors[0]?.['failure'])).toContain('apply write refused');
  });

  it('marks a withdrawn participant without applying', async () => {
    const h = await harness({ modes: [CONS3] });
    const { id, players } = await test_match(h, CONS3.id, 3);
    const [a, b, c] = players;
    if (a === undefined || b === undefined || c === undefined) throw new Error('players');
    const withdrawn = await send(c, 'core/Withdraw', new CoreContract.WithdrawRequest());
    expect(withdrawn.envelope.error).toBeNull();
    await report(a, id, result_bytes(1));
    await report(b, id, result_bytes(2));
    await settled(h);
    expect(calls_of(h, 'apply_match_mismatch').map((x) => x.user_id).sort()).toEqual([a.user_id, b.user_id].sort());
  });
});

describe('sweep', () => {
  it('applies an index left when the server instance that decided stopped before applying it', async () => {
    const h = await harness({ modes: [CONS2], settings: { 'matchmaker.sweepIntervalMs': 1 } });
    const peer = await start_peer_server(h.server);
    const a = await player(h);
    const b = await login(peer, 'matchmaker_apply_peer');
    const id = (await call_dev(h.server, 'matchmaker', 'create_test_match', [CONS2.id, [a.user_id, b.user_id], 1n])) as string;
    await report(a, id, result_bytes(1));
    // The decision commits on the peer, which stops right after; a's apply is left to the sweep of the matchmaker.
    expect((await report(b, id, result_bytes(1))).status).toBe(Judge.MATCH_JUDGE_STATUS_CONFIRMED);
    await stop_test_server(peer);
    await tick(h, 1n);
    expect(calls_of(h, 'apply_match_result').map((c) => c.index).sort()).toEqual([0, 1]);
  });

  it('applies once per index when the other participant apply and a sweep retry overlap', async () => {
    const h = await harness({ modes: [CONS3], settings: { 'matchmaker.sweepIntervalMs': 1 } });
    const { id, players } = await test_match(h, CONS3.id, 3);
    const [a, b] = players;
    if (a === undefined || b === undefined) throw new Error('players');
    await report(a, id, result_bytes(1));
    await report(b, id, result_bytes(2));
    // The after-commit applies and the sweep run at the same time.
    advance_time(h.server, 1n);
    advance_time(h.server, 1n);
    await wait_background(h.server);
    expect(calls_of(h, 'apply_match_mismatch').map((c) => c.index).sort()).toEqual([0, 1, 2]);
  });

  it('keeps a record with an index not marked past matchmaker.recordRetentionMs, and removes it after every index is marked', async () => {
    const failing = new Set<bigint>();
    const h = await harness({
      modes: [CONS2],
      hooks: failing_hooks(failing),
      settings: { ...RETRY, 'matchmaker.applyRetryMaxAttempts': 1_000, 'matchmaker.recordRetentionMs': 10_000, 'routing.storageSweepIntervalMs': 1_000 },
    });
    const { id, players } = await test_match(h, CONS2.id, 2);
    const [a, b] = players;
    if (a === undefined || b === undefined) throw new Error('players');
    failing.add(b.user_id);
    await report(b, id, result_bytes(1));
    await report(a, id, result_bytes(1));
    await tick(h, 30_000n);
    expect((await report(a, id, result_bytes(1))).status).toBe(Judge.MATCH_JUDGE_STATUS_CONFIRMED);
    failing.clear();
    await tick(h, 3_000n);
    await tick(h, 10_001n);
    await tick(h, 1_000n);
    expect((await report(a, id, result_bytes(1))).code).toBe(CoreError.CORE_ERROR_MATCH_NOT_FOUND);
  });

  it('does no deadline decision or apply retry on a server instance without --matchmaker', async () => {
    const failing = new Set<bigint>();
    const h = await harness({ modes: [CONS2], matchmaker: false, hooks: failing_hooks(failing), settings: RETRY });
    const lone = await test_match(h, CONS2.id, 2);
    await tick(h, CONS2.prepare_time + CONS2.max_duration + 120_000n);
    expect(calls_of(h, 'apply_match_mismatch')).toEqual([]);
    expect((await report(lone.players[0] ?? (await player(h)), lone.id)).status).toBe(Judge.MATCH_JUDGE_STATUS_MISMATCH);
    const { id, players } = await test_match(h, CONS2.id, 2);
    const [a, b] = players;
    if (a === undefined || b === undefined) throw new Error('players');
    failing.add(b.user_id);
    await report(b, id, result_bytes(1));
    await report(a, id, result_bytes(1));
    await settled(h);
    await tick(h, 60_000n);
    expect(calls_for(h, b.user_id)).toBe(1);
  });
});

