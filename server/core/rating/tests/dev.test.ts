import * as CoreContract from '../../../generated/contract/core_contract.ts';
import { call_dev, read_user_state, send } from '../../testing/dev/index.ts';
import { expected_tier, rating_row, rating_rows, set_rating, start, user } from './helpers.ts';

describe('set_rating', () => {
  it('writes the rating and the tier of that rating to RatingUserState', async () => {
    const kit = await start();
    const a = await user(kit, 'rating-dev-a');
    const rule = kit.id('[rating_rule_basic]');
    for (const rating of [1300n, 1150n, 5n]) {
      await set_rating(kit, a.user_id, '[rating_rule_basic]', rating);
      expect(await rating_row(kit, a.user_id, rule)).toMatchObject({ rating, tier_id: expected_tier(kit, '[rating_rule_basic]', rating), season_games: 0, total_games: 0 });
    }
    expect((await rating_row(kit, a.user_id, rule))?.tier_id).toBe(kit.id('[rating_tier_bronze]'));
  });

  it('throws for a rule ID value not in rating_rule', async () => {
    const kit = await start();
    const a = await user(kit, 'rating-dev-b');
    await expect(call_dev(kit.server, 'rating', 'set_rating', [987_654, 1000n], a.user_id)).rejects.toThrow();
    expect(await rating_rows(kit, a.user_id)).toEqual([]);
  });
});

describe('withdrawal', () => {
  it('leaves no RatingUserState of the user after Withdraw', async () => {
    const kit = await start();
    const a = await user(kit, 'rating-withdraw-a');
    await set_rating(kit, a.user_id, '[rating_rule_basic]', 1200n);
    await set_rating(kit, a.user_id, '[rating_rule_seasonless]', 1600n);
    expect((await rating_rows(kit, a.user_id)).length).toBe(2);
    const { envelope } = await send(a, 'core/Withdraw', new CoreContract.WithdrawRequest());
    expect(envelope.error).toBeNull();
    expect((await read_user_state(kit.server, a.user_id)).filter((item) => item.kind === 'RatingUserState')).toEqual([]);
  });
});
