import { DAY, HOUR, at, offer_id, set_time, start, stop_all, stored, trigger, user, view } from './helpers.ts';

afterEach(stop_all);

// `[event_offer]`: round 1 from 2027-01-16T00:00:00Z to 2027-01-17T00:00:00Z, repeat 7d.
// `[offer_event]`: bound to `[event_offer]`, duration 1h, cooldown 0, max_triggers 2.
const ROUND_1_START = at('2027-01-16T00:00:00Z');
const ROUND_1_END = at('2027-01-17T00:00:00Z');
const ROUND_2_START = ROUND_1_START + 7n * DAY;

describe('round reset of an offer bound to a live event with repeat', () => {
  it('keeps the last end time between rounds and starts round 2 from no row', async () => {
    const s = await start();
    const u = await user(s);
    const id = offer_id('[offer_event]');

    set_time(s, ROUND_1_START - 1n);
    expect(await trigger(s, u, id)).toBe('UNAVAILABLE');
    set_time(s, ROUND_1_START);
    expect(await trigger(s, u, id)).toBe('OK');
    set_time(s, ROUND_1_START + HOUR);
    expect(await trigger(s, u, id)).toBe('OK');
    set_time(s, ROUND_1_START + 2n * HOUR);
    expect(await trigger(s, u, id)).toBe('LIMIT_REACHED');
    const last_end = ROUND_1_START + 2n * HOUR;
    expect(await stored(s, u)).toEqual([{ id: BigInt(id), started_at: ROUND_1_START + HOUR, trigger_count: 2, event_round: 1 }]);

    for (const time of [ROUND_1_END, ROUND_2_START - 1n]) {
      set_time(s, time);
      expect(await view(s, u, id)).toEqual({ active: false, ends_at: last_end });
      expect(await trigger(s, u, id)).toBe('UNAVAILABLE');
    }

    set_time(s, ROUND_2_START);
    expect(await view(s, u, id)).toEqual({ active: false, ends_at: 0n });
    expect(await trigger(s, u, id)).toBe('OK');
    expect(await stored(s, u)).toEqual([{ id: BigInt(id), started_at: ROUND_2_START, trigger_count: 1, event_round: 2 }]);
    expect(await view(s, u, id)).toEqual({ active: true, ends_at: ROUND_2_START + HOUR });
  });
});
