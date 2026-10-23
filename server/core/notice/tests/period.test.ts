import { set_time } from '../../testing/dev/index.ts';
import { HOUR, START, put, server, shown_ids, stop_all } from './helpers.ts';

afterEach(stop_all);

describe('period', () => {
  it('shows a notice from start_at and not from end_at', async () => {
    const s = await server();
    const id = await put(s, { start_at: String(START + 1_000n), end_at: String(START + HOUR) });
    expect(await shown_ids(s)).toEqual([]);
    set_time(s, START + 999n);
    expect(await shown_ids(s)).toEqual([]);
    set_time(s, START + 1_000n);
    expect(await shown_ids(s)).toEqual([id]);
    set_time(s, START + HOUR - 1n);
    expect(await shown_ids(s)).toEqual([id]);
    set_time(s, START + HOUR);
    expect(await shown_ids(s)).toEqual([]);
  });

  it('shows only the notices whose period holds the time', async () => {
    const s = await server();
    const past = await put(s, { start_at: String(START - HOUR), end_at: String(START + 1n) });
    const now = await put(s, { start_at: String(START), end_at: String(START + HOUR) });
    const later = await put(s, { start_at: String(START + 10n), end_at: String(START + HOUR) });
    expect(await shown_ids(s)).toEqual([now, past]);
    set_time(s, START + 10n);
    expect(await shown_ids(s)).toEqual([later, now]);
  });
});
