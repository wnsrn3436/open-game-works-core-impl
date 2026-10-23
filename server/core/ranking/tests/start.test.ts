/** Server start checks of `ranking` on the core test data. */
import { modules_without, start, testing } from './support.ts';

describe('ranking server start', () => {
  it('a server does not start when a ranking_reward reward has more items than mailbox.maxAttachments', async () => {
    // Without `rating`, whose own start check stops a server below mailbox.maxAttachments 3 on the core test data, and
    // `matchmaker`, which does not start without it.
    const server_modules = modules_without('rating', 'matchmaker');
    const failed = start({ settings: { 'mailbox.maxAttachments': 1 }, server_modules });
    await expect(failed).rejects.toBeInstanceOf(testing.StartFailure);
    await expect(failed).rejects.toThrow(/ranking_reward.*mailbox\.maxAttachments 1/);
    const h = await start({ settings: { 'mailbox.maxAttachments': 2 }, server_modules });
    await testing.stop_test_server(h.server);
  });
});
