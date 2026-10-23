/** The calculation rules of `ranking` that need no other module: update modes, display, retry interval, mail parts. */
import * as GameData from '../../../generated/data/game_data.ts';
import type { Board } from '../board.ts';
import type { RankingCore } from '../core.ts';
import { retry_interval, reward_once_key, split_attachments } from '../reward.ts';
import { apply_submission, is_valid_display } from '../score.ts';

function board(update_mode: GameData.RankingUpdateMode, desc = true): Board {
  return { id: 1, guild: false, desc, update_mode, cycle: null, live_event: 0, size: 10, reward_mail: 0 };
}

const BEFORE = { entity_id: 1n, score: 50n, reached_at: 100n, display: 'old' };
const MAX = 2n ** 53n - 1n;

describe('ranking rules', () => {
  it('Best keeps the better score and its time, Sum adds, Set replaces, and the display always changes', () => {
    const best = board(GameData.RankingUpdateMode.Best);
    expect(apply_submission(best, BEFORE, 1n, 40n, 200n, 'new')).toEqual({ ...BEFORE, display: 'new' });
    expect(apply_submission(best, BEFORE, 1n, 60n, 200n, 'new')).toEqual({ entity_id: 1n, score: 60n, reached_at: 200n, display: 'new' });
    expect(apply_submission(best, BEFORE, 1n, 50n, 200n, '')).toEqual({ ...BEFORE, display: '' });
    const asc = board(GameData.RankingUpdateMode.Best, false);
    expect(apply_submission(asc, BEFORE, 1n, 40n, 200n, 'x')).toEqual({ entity_id: 1n, score: 40n, reached_at: 200n, display: 'x' });
    expect(apply_submission(asc, BEFORE, 1n, 60n, 200n, 'x')).toEqual({ ...BEFORE, display: 'x' });
    expect(apply_submission(board(GameData.RankingUpdateMode.Sum), BEFORE, 1n, 5n, 200n, 'x')).toEqual({ entity_id: 1n, score: 55n, reached_at: 200n, display: 'x' });
    expect(apply_submission(board(GameData.RankingUpdateMode.Sum), { ...BEFORE, score: MAX }, 1n, 1n, 200n, 'x')).toBe('OUT_OF_RANGE');
    expect(apply_submission(board(GameData.RankingUpdateMode.Set), BEFORE, 1n, -3n, 200n, 'x')).toEqual({ entity_id: 1n, score: -3n, reached_at: 200n, display: 'x' });
    expect(apply_submission(best, null, 2n, 7n, 300n, 'y')).toEqual({ entity_id: 2n, score: 7n, reached_at: 300n, display: 'y' });
  });

  it('a display is valid up to maxDisplayBytes UTF-8 bytes without control characters', () => {
    expect(is_valid_display('', 4)).toBe(true);
    expect(is_valid_display('abcd', 4)).toBe(true);
    expect(is_valid_display('abcde', 4)).toBe(false);
    expect(is_valid_display('가나', 4)).toBe(false);
    expect(is_valid_display('a\u0007', 4)).toBe(false);
    expect(is_valid_display('a\u0085', 4)).toBe(false);
    expect(is_valid_display(3, 4)).toBe(false);
  });

  it('the retry interval is rewardRetryInitialMs, then grows by the factor up to the max interval', () => {
    const core = {
      settings: { reward_retry_initial_ms: 1000n, reward_retry_factor_permille: 1500n, reward_retry_max_interval_ms: 3000n },
    } as unknown as Pick<RankingCore, 'settings'>;
    expect([0, 1, 2, 3, 4].map((a) => retry_interval(core, a))).toEqual([1000n, 1500n, 2250n, 3000n, 3000n]);
  });

  it('splits attachments into parts of maxAttachments in order, an empty list into one empty part, with once_key <k> from the second part', () => {
    expect(split_attachments([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
    expect(split_attachments([], 2)).toEqual([[]]);
    expect([1, 2, 3].map((k) => reward_once_key(12, 345n, k))).toEqual(['ranking:12:345', 'ranking:12:345:2', 'ranking:12:345:3']);
  });
});
