import * as CoreContract from '../../../generated/contract/core_contract.ts';
import { rating_row, refresh, set_rating, start, user } from './helpers.ts';

describe('content view', () => {
  it('gives content register(core) only get_rating and apply_match_outcome of rating', async () => {
    let names: string[] = [];
    await start((core) => {
      names = Object.keys(core.rating).sort();
    });
    expect(names).toEqual(['apply_match_outcome', 'get_rating']);
  });
});

describe('RefreshRating reads', () => {
  it('reads no RatingUserState row again after list_state and the season of a season_board once', async () => {
    const kit = await start();
    const a = await user(kit, 'rating-reads-a');
    await set_rating(kit, a.user_id, '[rating_rule_basic]', 1200n);
    await set_rating(kit, a.user_id, '[rating_rule_seasonless]', 1600n);
    const before = await rating_row(kit, a.user_id, kit.id('[rating_rule_basic]'));
    const get_state = vi.spyOn(kit.core.storage, 'get_state');
    const get_season = vi.spyOn(kit.core.ranking, 'get_season');
    await refresh(a);
    expect(get_state.mock.calls.filter((call) => call[1] === CoreContract.RatingUserState).length).toBe(0);
    expect(get_season.mock.calls.length).toBe(1);
    get_state.mockRestore();
    get_season.mockRestore();
    expect(await rating_row(kit, a.user_id, kit.id('[rating_rule_basic]'))).toEqual(before);
  });
});
