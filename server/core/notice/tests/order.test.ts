import { HOUR, START, put, server, shown_ids, stop_all } from './helpers.ts';

afterEach(stop_all);

describe('order', () => {
  it('orders by priority descending, start_at descending, then id ascending', async () => {
    const s = await server();
    const low = await put(s, { priority: -1, start_at: String(START) });
    const old_high = await put(s, { priority: 5, start_at: String(START - HOUR) });
    const new_high = await put(s, { priority: 5, start_at: String(START - 1n) });
    const tie_a = await put(s, { priority: 3, start_at: String(START - 10n) });
    const tie_b = await put(s, { priority: 3, start_at: String(START - 10n) });
    const zero = await put(s, { priority: 0, start_at: String(START - 5n) });
    expect(await shown_ids(s)).toEqual([new_high, old_high, tie_a, tie_b, zero, low]);
  });

  it('returns at most notice.maxNotices notices, the first ones of the order', async () => {
    const s = await server({ 'notice.maxNotices': 2 });
    const ids: bigint[] = [];
    for (const priority of [1, 4, 2, 3]) ids.push(await put(s, { priority }));
    expect(await shown_ids(s)).toEqual([ids[1], ids[3]]);
  });
});
