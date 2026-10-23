import type { RequestCtx } from '../../storage/index.ts';
import { expected_score } from '../elo.ts';
import type { MatchOutcome, MatchRecord } from '../index.ts';
import { error_logs, expected_tier, in_tx, match, rating_row, rating_rows, set_rating, start, user, type Kit } from './helpers.ts';

const BASIC = '[rating_rule_basic]';
const FREE = '[rating_rule_seasonless]';

function apply(kit: Kit, user_id: bigint, record: MatchRecord, index: number, placements: readonly number[]): Promise<MatchOutcome> {
  return in_tx(kit, user_id, (ctx: RequestCtx) => kit.core.rating.apply_match_outcome(ctx, record, index, placements));
}

/** Δ of the outcome, or a failure of the test. */
function delta(outcome: MatchOutcome): bigint {
  if (outcome.result !== 'OK') throw new Error(`apply_match_outcome is ${outcome.result}`);
  return outcome.change.after - outcome.change.before;
}

async function floor_div(kit: Kit, user_id: bigint, a: bigint, b: bigint): Promise<bigint> {
  return in_tx(kit, user_id, () => kit.core.validation.floor_div(a, b));
}

describe('apply_match_outcome', () => {
  it('gives the winner of a 1 vs 1 match of equal ratings floor_div(2K×500 + 1000, 2000), the loser floor_div(−2K×500 + 1000, 2000), and 0 to both on a draw', async () => {
    const kit = await start();
    const [a, b, c, d] = await Promise.all(['rating-elo-a', 'rating-elo-b', 'rating-elo-c', 'rating-elo-d'].map((name) => user(kit, name)));
    if (!a || !b || !c || !d) throw new Error('login');
    const rule = kit.data.RatingRuleTable.get_row(kit.id(FREE));
    const k = BigInt(rule.k_factor);
    const won = match(kit, '[mode_rating_free]', [a.user_id, b.user_id], [1500n, 1500n]);
    const win = await apply(kit, a.user_id, won, 0, [0, 1]);
    const lose = await apply(kit, b.user_id, won, 1, [0, 1]);
    expect(delta(win)).toBe(await floor_div(kit, a.user_id, 2n * k * 500n + 1000n, 2000n));
    expect(delta(lose)).toBe(await floor_div(kit, a.user_id, -2n * k * 500n + 1000n, 2000n));
    expect(delta(win)).toBe(10n);
    expect(delta(lose)).toBe(-10n);
    const drawn = match(kit, '[mode_rating_free]', [c.user_id, d.user_id], [1500n, 1500n]);
    expect(delta(await apply(kit, c.user_id, drawn, 0, [0, 0]))).toBe(0n);
    expect(delta(await apply(kit, d.user_id, drawn, 1, [3, 3]))).toBe(0n);
    expect((await rating_row(kit, a.user_id, rule.id))?.rating).toBe(1510n);
    expect((await rating_row(kit, b.user_id, rule.id))?.rating).toBe(1490n);
  });

  it('uses E = 91 when R_j − R_i is scale', async () => {
    const kit = await start();
    const a = await user(kit, 'rating-e-a');
    const b = await user(kit, 'rating-e-b');
    const rule = kit.data.RatingRuleTable.get_row(kit.id(FREE));
    const r_i = 1500n;
    const r_j = r_i + rule.scale;
    expect(expected_score(r_i, r_j, rule.scale)).toBe(91n);
    const outcome = await apply(kit, a.user_id, match(kit, '[mode_rating_free]', [a.user_id, b.user_id], [r_i, r_j]), 0, [0, 1]);
    // K = k_factor 20: floor_div(2 × 20 × (1000 − 91) + 1000, 2000) = 18.
    expect(delta(outcome)).toBe(await floor_div(kit, a.user_id, 2n * BigInt(rule.k_factor) * (1000n - 91n) + 1000n, 2000n));
    expect(delta(outcome)).toBe(18n);
  });

  it('gives each participant the same Δ whatever the apply order, since Δ uses the ratings of the match record', async () => {
    const kit = await start();
    const users = await Promise.all(['rating-order-a', 'rating-order-b', 'rating-order-c', 'rating-order-d'].map((name) => user(kit, name)));
    const [a, b, c, d] = users.map((u) => u.user_id) as [bigint, bigint, bigint, bigint];
    const first = match(kit, '[mode_rating_free]', [a, b], [1500n, 1700n]);
    const second = match(kit, '[mode_rating_free]', [c, d], [1500n, 1700n]);
    const a_delta = delta(await apply(kit, a, first, 0, [1, 0]));
    const b_delta = delta(await apply(kit, b, first, 1, [1, 0]));
    const d_delta = delta(await apply(kit, d, second, 1, [1, 0]));
    const c_delta = delta(await apply(kit, c, second, 0, [1, 0]));
    expect(c_delta).toBe(a_delta);
    expect(d_delta).toBe(b_delta);
  });

  it('counts only participants of the other team as opponents in a 4 player match of team_size 2', async () => {
    const kit = await start();
    const users = await Promise.all(['rating-team-a', 'rating-team-b', 'rating-team-c', 'rating-team-d'].map((name) => user(kit, name)));
    const ids = users.map((u) => u.user_id);
    const record = match(kit, '[mode_rating_team]', ids, [1000n, 1000n, 1000n, 1000n], [0, 0, 1, 1]);
    const rule = kit.data.RatingRuleTable.get_row(kit.id(BASIC));
    const k = BigInt(rule.placement_k_factor);
    const [a, , c] = ids as [bigint, bigint, bigint, bigint];
    // Opponents are the 2 of team 1: Σ = 2 × (1000 − 500), m = 2. With the teammate (a draw, S − E = 0) m would be 3.
    const win = await apply(kit, a, record, 0, [0, 0, 1, 1]);
    expect(delta(win)).toBe(await floor_div(kit, a, 2n * k * 1000n + 1000n * 2n, 2000n * 2n));
    expect(delta(win)).toBe(32n);
    const lose = await apply(kit, c, record, 2, [0, 0, 1, 1]);
    expect(delta(lose)).toBe(await floor_div(kit, c, 2n * k * -1000n + 1000n * 2n, 2000n * 2n));
    expect(delta(lose)).toBe(-32n);
  });

  it('changes no rating and adds 1 to season_games and total_games when there is no opponent', async () => {
    const kit = await start();
    const a = await user(kit, 'rating-alone-a');
    const b = await user(kit, 'rating-alone-b');
    const rule = kit.id(BASIC);
    // team_size 2 and both participants on team 0: m = 0.
    const record = match(kit, '[mode_rating_team]', [a.user_id, b.user_id], [1000n, 1400n], [0, 0]);
    for (const placements of [[0, 1], [1, 0]]) {
      const outcome = await apply(kit, a.user_id, record, 0, placements);
      expect(outcome).toEqual({ result: 'OK', change: { before: 1000n, after: 1000n, tier_before: expected_tier(kit, BASIC, 1000n), tier_after: expected_tier(kit, BASIC, 1000n) } });
    }
    expect(await rating_row(kit, a.user_id, rule)).toMatchObject({ rating: 1000n, season_games: 2, total_games: 2, tier_id: expected_tier(kit, BASIC, 1000n) });
  });

  it('uses placement_k_factor while season_games < placement_matches and k_factor after', async () => {
    const kit = await start();
    const a = await user(kit, 'rating-k-a');
    const b = await user(kit, 'rating-k-b');
    const rule = kit.data.RatingRuleTable.get_row(kit.id(BASIC));
    expect(rule.placement_matches).toBe(2);
    const record = match(kit, '[mode_rating_duel]', [a.user_id, b.user_id], [1000n, 1000n]);
    const deltas: bigint[] = [];
    for (let i = 0; i < 3; i++) deltas.push(delta(await apply(kit, a.user_id, record, 0, [0, 1])));
    const with_k = (k: number): Promise<bigint> => floor_div(kit, a.user_id, 2n * BigInt(k) * 500n + 1000n, 2000n);
    expect(deltas).toEqual([await with_k(rule.placement_k_factor), await with_k(rule.placement_k_factor), await with_k(rule.k_factor)]);
    expect(deltas).toEqual([32n, 32n, 16n]);
    const row = await rating_row(kit, a.user_id, rule.id);
    expect(row).toMatchObject({ rating: 1080n, season_games: 3, total_games: 3, tier_id: expected_tier(kit, BASIC, 1080n) });
  });

  it('writes min_rating when the new rating is less than min_rating', async () => {
    const kit = await start();
    const a = await user(kit, 'rating-min-a');
    const b = await user(kit, 'rating-min-b');
    const rule = kit.data.RatingRuleTable.get_row(kit.id(FREE));
    await set_rating(kit, a.user_id, FREE, rule.min_rating + 5n);
    const outcome = await apply(kit, a.user_id, match(kit, '[mode_rating_free]', [a.user_id, b.user_id], [1500n, 1500n]), 0, [1, 0]);
    expect(outcome).toEqual({ result: 'OK', change: { before: rule.min_rating + 5n, after: rule.min_rating, tier_before: 0, tier_after: 0 } });
    expect((await rating_row(kit, a.user_id, rule.id))?.rating).toBe(rule.min_rating);
  });

  it('changes no row on INVALID_INPUT and NO_RATING, and leaves an error log', async () => {
    const kit = await start();
    const a = await user(kit, 'rating-bad-a');
    const b = await user(kit, 'rating-bad-b');
    await set_rating(kit, a.user_id, BASIC, 1234n);
    const before = await rating_rows(kit, a.user_id);
    const ids = [a.user_id, b.user_id];
    const duel = match(kit, '[mode_rating_duel]', ids, [1000n, 1000n]);
    const invalid: [MatchRecord, number, number[]][] = [
      [duel, 2, [0, 1]],
      [duel, -1, [0, 1]],
      [duel, 1, [0, 1]],
      [duel, 0, [0]],
      [duel, 0, [0, 1, 2]],
      [duel, 0, [0, -1]],
    ];
    for (const [record, index, placements] of invalid) expect(await apply(kit, a.user_id, record, index, placements)).toEqual({ result: 'INVALID_INPUT' });
    expect(await apply(kit, a.user_id, match(kit, '[mode_rating_none]', ids, [1000n, 1000n]), 0, [0, 1])).toEqual({ result: 'NO_RATING' });
    expect(await rating_rows(kit, a.user_id)).toEqual(before);
    expect(await rating_rows(kit, b.user_id)).toEqual([]);
    expect(error_logs(kit, 'rating match outcome input is invalid').length).toBe(invalid.length);
    expect(error_logs(kit, 'rating match outcome for a match mode without a rating rule').length).toBe(1);
  });
});
