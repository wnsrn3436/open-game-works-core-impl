import { expected_tier, in_tx, mails, rating_rows, season_of, start, user } from './helpers.ts';

describe('get_rating', () => {
  it('gives a user without a row initial_rating, its tier, the current season, season_games 0 and placement while placement_matches ≥ 1', async () => {
    const kit = await start();
    const a = await user(kit, 'rating-get-a');
    const rule = kit.data.RatingRuleTable.get_row(kit.id('[rating_rule_basic]'));
    expect(rule.placement_matches).toBeGreaterThanOrEqual(1);
    const season = await season_of(kit, a.user_id, '[board_rating_weekly]');
    const view = await in_tx(kit, a.user_id, (ctx) => kit.core.rating.get_rating(ctx, rule.id));
    expect(view).toEqual({
      rating: rule.initial_rating,
      tier_id: expected_tier(kit, '[rating_rule_basic]', rule.initial_rating),
      season,
      season_games: 0,
      placement: true,
    });
    expect(view.tier_id).toBe(kit.id('[rating_tier_bronze]'));
    expect(await rating_rows(kit, a.user_id)).toEqual([]);
    expect(await mails(kit, a.user_id)).toEqual([]);
  });

  it('gives placement false when placement_matches is 0, season 0 for a rule without season_board, and tier 0 below every tier', async () => {
    const kit = await start();
    const a = await user(kit, 'rating-get-b');
    const rule = kit.data.RatingRuleTable.get_row(kit.id('[rating_rule_seasonless]'));
    expect(rule.placement_matches).toBe(0);
    const view = await in_tx(kit, a.user_id, (ctx) => kit.core.rating.get_rating(ctx, rule.id));
    expect(view).toEqual({ rating: 1500n, tier_id: kit.id('[rating_tier_plain]'), season: 0n, season_games: 0, placement: false });
    expect(expected_tier(kit, '[rating_rule_seasonless]', 999n)).toBe(0);
  });

  it('throws for a rule ID value not in rating_rule', async () => {
    const kit = await start();
    const a = await user(kit, 'rating-get-c');
    await expect(in_tx(kit, a.user_id, (ctx) => kit.core.rating.get_rating(ctx, 987_654))).rejects.toThrow();
  });
});
