/** Server start checks of `rating` on the core test data. */
import { StartFailure } from '../../testing/dev/index.ts';
import { start } from './helpers.ts';

describe('rating server start', () => {
  it('a server does not start when a rating_tier season_reward has more items than mailbox.maxAttachments', async () => {
    const kit = await start();
    const longest = Math.max(...kit.data.RatingTierTable.all_rows().map((row) => row.season_reward.length));
    expect(longest).toBe(3);
    const failed = start(undefined, { 'mailbox.maxAttachments': longest - 1 });
    await expect(failed).rejects.toBeInstanceOf(StartFailure);
    await expect(failed).rejects.toThrow(/rating_tier.*mailbox\.maxAttachments 2/);
    await start(undefined, { 'mailbox.maxAttachments': longest });
  });
});
