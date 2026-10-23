import * as CoreContract from '../../../generated/contract/core_contract.ts';
import * as GameContract from '../../../generated/contract/game_contract.ts';
import { call_dev, send, wait_background } from '../../testing/dev/index.ts';
import type { MatchOutcome } from '../index.ts';
import { rating_row, refresh, start, user, type ApplyMatchResultHook } from './helpers.ts';

describe('apply_match_outcome in matchmaker.apply_match_result', () => {
  it('gives the change of a participant that is not the reporter to that participant as a pending delta', async () => {
    const outcomes = new Map<bigint, MatchOutcome>();
    const kit = await start((core) => {
      // The first index wins.
      const hook: ApplyMatchResultHook = (ctx, record, index) => {
        const placements = record.user_ids.map((_, i) => (i === 0 ? 0 : 1));
        outcomes.set(ctx.user_id, core.rating.apply_match_outcome(ctx, record, index, placements));
        return 'pass';
      };
      core.routing.register_hook('matchmaker', 'apply_match_result', hook);
    });
    const a = await user(kit, 'rating-mm-a');
    const b = await user(kit, 'rating-mm-b');
    const rule = kit.id('[rating_rule_basic]');
    const match_id = await call_dev(kit.server, 'matchmaker', 'create_test_match', [kit.id('[mode_rating_duel]'), [a.user_id, b.user_id], 7n]);
    const result = new GameContract.MatchResult().encode();
    const report = (session: typeof a): ReturnType<typeof send> => {
      const request = new CoreContract.ReportMatchResultRequest();
      request.match_id = String(match_id);
      request.result = result;
      return send(session, 'core/ReportMatchResult', request);
    };

    const first = await report(a);
    expect(first.envelope.error).toBeNull();
    expect((first.response as CoreContract.ReportMatchResultResponse).status).toBe(CoreContract.MatchJudgeStatus.MATCH_JUDGE_STATUS_PENDING);
    const second = await report(b);
    expect((second.response as CoreContract.ReportMatchResultResponse).status).toBe(CoreContract.MatchJudgeStatus.MATCH_JUDGE_STATUS_CONFIRMED);
    // The reporter's apply is in its request; its row is in that response.
    expect(second.envelope.user_state?.entries.some((entry) => entry.kind === 'RatingUserState' && entry.id === BigInt(rule))).toBe(true);
    await wait_background(kit.server);

    expect(outcomes.get(a.user_id)?.result).toBe('OK');
    expect(outcomes.get(b.user_id)?.result).toBe('OK');
    const row = await rating_row(kit, a.user_id, rule);
    expect(row?.rating).toBe(1032n);
    expect((await rating_row(kit, b.user_id, rule))?.rating).toBe(968n);
    // a's change reaches a as a pending delta on its next response; that `RefreshRating` itself writes nothing.
    const envelope = await refresh(a);
    expect(envelope.user_state?.entries.some((e) => e.kind === 'RatingUserState') ?? false).toBe(false);
    const entry = envelope.pending_user_state?.entries.find((e) => e.kind === 'RatingUserState' && e.id === BigInt(rule));
    expect(entry).toBeDefined();
    expect(CoreContract.RatingUserState.decode(entry?.value ?? new Uint8Array())?.rating).toBe(1032n);
  });
});
