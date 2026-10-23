import { advance_time, start_peer_server, wait_background } from '../../testing/dev/index.ts';
import { admin, put, server, shown_ids, stop_all } from './helpers.ts';

afterEach(stop_all);

/** The core settings default of `notice.cacheMs`. */
const CACHE_MS = 60_000n;

describe('notice cache', () => {
  it('shows a new notice on every server instance within notice.cacheMs and on the changing one at once', async () => {
    const s = await server({ 'notice.cacheMs': Number(CACHE_MS) });
    const peer = await start_peer_server(s);
    const id = await put(s);
    expect(await shown_ids(s)).toEqual([id]);
    expect(await shown_ids(peer)).toEqual([]);
    advance_time(s, CACHE_MS - 1n);
    await wait_background(peer);
    expect(await shown_ids(peer)).toEqual([]);
    advance_time(s, 1n);
    await wait_background(peer);
    expect(await shown_ids(peer)).toEqual([id]);
  });

  it('drops a deleted notice on every server instance within notice.cacheMs', async () => {
    const s = await server({ 'notice.cacheMs': Number(CACHE_MS) });
    const peer = await start_peer_server(s);
    const id = await put(s);
    advance_time(s, CACHE_MS);
    await wait_background(peer);
    expect(await shown_ids(peer)).toEqual([id]);
    expect((await admin(peer, 'delete_notice', { notice_id: String(id) })).status).toBe(200);
    expect(await shown_ids(peer)).toEqual([]);
    expect(await shown_ids(s)).toEqual([id]);
    advance_time(s, CACHE_MS);
    await wait_background(s);
    expect(await shown_ids(s)).toEqual([]);
  });
});
