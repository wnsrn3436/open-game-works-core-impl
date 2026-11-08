/**
 * The judgement of matchmaker through the apply hooks into `rating.apply_match_outcome`: a `FORFEIT` changes the
 * ratings from the forfeiter, a `MISMATCH` is `VOID`, a `CONFIRMED` changes them from the reported result.
 */
import * as GameContract from '../../../generated/contract/game_contract.ts';
import type { RequestCtx } from '../../storage/index.ts';
import type { MatchRecordInput } from '../index.ts';
import type { MatchOutcome } from '../../rating/index.ts';
import {
  Judge,
  harness,
  leave_frame,
  matched,
  missing,
  mode,
  report,
  result_bytes,
  send_and_wait,
  settled,
  stop_all,
  until_participants,
  type Core,
  type Hooks,
} from './helpers.ts';

const RULE = 7951;
const RATED = mode(7950, { rating_rule: RULE });

afterEach(async () => {
  await stop_all();
});

type Apply = (core: Core, ctx: RequestCtx, record: MatchRecordInput, index: number, placements: readonly number[]) => 'pass';

describe.skipIf(missing('rating'))('matchmaker to rating', () => {
  it('applies FORFEIT with the empty match rank list as a win of the participant that is not a forfeiter, MISMATCH as VOID, and CONFIRMED from the result', async () => {
    const outcomes: { match_id: string; user_id: bigint; status: number; outcome: MatchOutcome }[] = [];
    const apply: Apply = (core, ctx, record, index, placements) => {
      const rating = core['rating'] as unknown as { apply_match_outcome(ctx: RequestCtx, record: MatchRecordInput, index: number, placements: readonly number[]): MatchOutcome };
      outcomes.push({ match_id: record.match_id, user_id: ctx.user_id, status: record.status, outcome: rating.apply_match_outcome(ctx, record, index, placements) });
      return 'pass';
    };
    const hooks: Hooks = {
      apply_result: (core, ctx, record, index, result) => {
        const winner = GameContract.MatchResult.decode(result)?.winner ?? 0;
        return apply(core, ctx, record, index, record.user_ids.map((_, i) => (i === winner ? 0 : 1)));
      },
      apply_forfeit: (core, ctx, record, index) => apply(core, ctx, record, index, []),
      apply_mismatch: (core, ctx, record, index) => apply(core, ctx, record, index, []),
    };
    const h = await harness({ modes: [RATED], rating_rules: [{ id: RULE, initial_rating: 1_000n }], hooks });
    const change = (match_id: string, user_id: bigint): MatchOutcome | undefined => outcomes.find((o) => o.match_id === match_id && o.user_id === user_id)?.outcome;

    // FORFEIT: index 1 leaves with forfeit true, index 0 reports.
    const forfeited = await matched(h, RATED.id, 2);
    const fid = forfeited.found[0]?.match_id ?? '';
    const by_index = forfeited.players.map((p, i) => ({ p, index: forfeited.found[i]?.my_index ?? -1 })).sort((a, b) => a.index - b.index).map((x) => x.p);
    const [stayer, leaver] = by_index;
    if (stayer === undefined || leaver === undefined) throw new Error('players');
    await send_and_wait(leaver.conn, leave_frame(fid, true));
    await until_participants(h, fid, (rows) => rows[1]?.left_at !== 0n);
    await settled(h);
    expect((await report(stayer.session, fid, result_bytes(1))).status).toBe(Judge.MATCH_JUDGE_STATUS_FORFEIT);
    await settled(h);
    // Same ratings 1000, K 32: the winner gets floor_div(2 × 32 × 500 + 1000, 2000) = 16, the forfeiter −16.
    expect(change(fid, stayer.session.user_id)).toEqual({ result: 'OK', change: { before: 1_000n, after: 1_016n, tier_before: 0, tier_after: 0 } });
    expect(change(fid, leaver.session.user_id)).toEqual({ result: 'OK', change: { before: 1_000n, after: 984n, tier_before: 0, tier_after: 0 } });
    expect(outcomes.filter((o) => o.match_id === fid).every((o) => o.status === Judge.MATCH_JUDGE_STATUS_FORFEIT)).toBe(true);

    // MISMATCH: two different reports are VOID and change no rating.
    const voided = await matched(h, RATED.id, 2);
    const vid = voided.found[0]?.match_id ?? '';
    const [x, y] = voided.players;
    if (x === undefined || y === undefined) throw new Error('players');
    await report(x.session, vid, result_bytes(0));
    expect((await report(y.session, vid, result_bytes(1))).status).toBe(Judge.MATCH_JUDGE_STATUS_MISMATCH);
    await settled(h);
    expect(outcomes.filter((o) => o.match_id === vid).map((o) => o.outcome)).toEqual([{ result: 'VOID' }, { result: 'VOID' }]);

    // CONFIRMED: the same result changes the ratings from the ratings of the match record.
    const confirmed = await matched(h, RATED.id, 2);
    const cid = confirmed.found[0]?.match_id ?? '';
    for (const p of confirmed.players) await report(p.session, cid, result_bytes(0));
    await settled(h);
    const confirmed_outcomes = outcomes.filter((o) => o.match_id === cid);
    expect(confirmed_outcomes).toHaveLength(2);
    expect(confirmed_outcomes.every((o) => o.outcome.result === 'OK' && o.status === Judge.MATCH_JUDGE_STATUS_CONFIRMED)).toBe(true);
  });
});
