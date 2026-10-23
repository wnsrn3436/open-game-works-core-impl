import * as GameData from '../../../generated/data/game_data.ts';
import * as Testing from '../../testing/dev/index.ts';
import type { PurchaseLimit } from '../index.ts';
import { DAY, HOUR, MINUTE, START_TIME, at, call, offer_id, set_time, start, stop_all, trigger, user, type Server, type TestSession } from './helpers.ts';

afterEach(stop_all);

// `[offer_basic]`: duration 1h, no live event.
// `[event_offer]`: round 1 from 2027-01-16T00:00:00Z to 2027-01-17T00:00:00Z, repeat 7d.
// `[offer_event]`: bound to `[event_offer]`, duration 1h, cooldown 0.
const ROUND_1_START = at('2027-01-16T00:00:00Z');
const ROUND_2_START = ROUND_1_START + 7n * DAY;
// `dailyResetOffsetMs` 0: a Daily boundary is a UTC midnight.
const SETTINGS = { dailyResetOffsetMs: 0 };

function event_id(name: string): number {
  const value = Testing.load_data().dev.find_id_value(name);
  if (value === 0) throw new Error(`${name} is not in the core test data`);
  return value;
}

interface Input {
  readonly offer?: number;
  readonly reset?: GameData.ResetCycle | null;
  readonly live_event?: number;
  readonly count?: number;
  readonly reset_at?: bigint;
  readonly event_round?: number;
}

/** `read_purchase_limit` in a request of its own; absent inputs are none and the row values 0. */
function read(s: Server, u: TestSession, input: Input): Promise<PurchaseLimit> {
  return call(s, u, (ctx) =>
    s.offer.read_purchase_limit(ctx, input.offer ?? 0, input.reset ?? null, input.live_event ?? 0, input.count ?? 0, input.reset_at ?? 0n, input.event_round ?? 0),
  );
}

describe('read_purchase_limit', () => {
  it('keeps count for offer 0, reset_at 0 and a reset_at equal to get_offer_ends_at, and resets it for another nonzero reset_at', async () => {
    const s = await start({ settings: SETTINGS });
    const u = await user(s);
    const id = offer_id('[offer_basic]');
    expect(await trigger(s, u, id)).toBe('OK');
    const ends_at = START_TIME + HOUR;
    set_time(s, START_TIME + 10n * MINUTE);

    // offer 0: no offer purchase reset; a reset_at not reached is kept.
    expect(await read(s, u, { reset: GameData.ResetCycle.Daily, count: 3, reset_at: START_TIME + DAY })).toEqual({
      count: 3,
      reset_at: START_TIME + DAY,
      event_round: 0,
      write_reset_at: START_TIME + DAY,
    });
    // reset_at 0: kept; the write takes the offer end time.
    expect(await read(s, u, { offer: id, count: 3 })).toEqual({ count: 3, reset_at: 0n, event_round: 0, write_reset_at: ends_at });
    // reset_at equal to get_offer_ends_at: kept.
    expect(await read(s, u, { offer: id, count: 3, reset_at: ends_at })).toEqual({ count: 3, reset_at: ends_at, event_round: 0, write_reset_at: ends_at });
    // A nonzero reset_at that differs (an earlier turn of the offer): count 0 and reset_at the offer end time.
    expect(await read(s, u, { offer: id, count: 3, reset_at: ends_at - 1n })).toEqual({ count: 0, reset_at: ends_at, event_round: 0, write_reset_at: ends_at });
    expect(await read(s, u, { offer: id, count: 3, reset_at: ends_at + DAY })).toEqual({ count: 0, reset_at: ends_at, event_round: 0, write_reset_at: ends_at });
  });

  it('gives the next reset time as write_reset_at of a row whose reset_at is 0, and 0 when there is none', async () => {
    const s = await start({ settings: SETTINGS });
    const u = await user(s);
    const next_midnight = START_TIME + DAY;
    expect(await read(s, u, { reset: GameData.ResetCycle.Daily, count: 2 })).toEqual({ count: 2, reset_at: 0n, event_round: 0, write_reset_at: next_midnight });
    // `reset` None reads as null: no reset.
    expect(await read(s, u, { reset: GameData.ResetCycle.None, count: 2 })).toEqual({ count: 2, reset_at: 0n, event_round: 0, write_reset_at: 0n });
    expect(await read(s, u, { count: 2 })).toEqual({ count: 2, reset_at: 0n, event_round: 0, write_reset_at: 0n });
    // An offer never turned on: get_offer_ends_at is 0.
    expect(await read(s, u, { offer: offer_id('[offer_basic]'), count: 2 })).toEqual({ count: 2, reset_at: 0n, event_round: 0, write_reset_at: 0n });
  });

  it('applies the lazy reset at reset_at and not before', async () => {
    const s = await start({ settings: SETTINGS });
    const u = await user(s);
    const reset_at = START_TIME + DAY;
    set_time(s, reset_at - 1n);
    expect(await read(s, u, { reset: GameData.ResetCycle.Daily, count: 4, reset_at })).toEqual({ count: 4, reset_at, event_round: 0, write_reset_at: reset_at });
    set_time(s, reset_at);
    expect(await read(s, u, { reset: GameData.ResetCycle.Daily, count: 4, reset_at })).toEqual({
      count: 0,
      reset_at: reset_at + DAY,
      event_round: 0,
      write_reset_at: reset_at + DAY,
    });
  });

  it('applies the round reset with event_round of the round and reset_at the next reset time, before the lazy reset', async () => {
    const s = await start({ settings: SETTINGS });
    const u = await user(s);
    const live_event = event_id('[event_offer]');
    set_time(s, ROUND_2_START + HOUR);
    const next_midnight = ROUND_2_START + DAY;
    // Same round: no round reset.
    expect(await read(s, u, { reset: GameData.ResetCycle.Daily, live_event, count: 4, reset_at: ROUND_2_START + 5n * DAY, event_round: 2 })).toEqual({
      count: 4,
      reset_at: ROUND_2_START + 5n * DAY,
      event_round: 2,
      write_reset_at: ROUND_2_START + 5n * DAY,
    });
    // An earlier round: a reset_at not reached becomes the next reset time.
    expect(await read(s, u, { reset: GameData.ResetCycle.Daily, live_event, count: 4, reset_at: ROUND_2_START + 5n * DAY, event_round: 1 })).toEqual({
      count: 0,
      reset_at: next_midnight,
      event_round: 2,
      write_reset_at: next_midnight,
    });
    // A reached reset_at of an earlier round: the round reset sets the next reset time first, so the lazy reset does not move it.
    expect(await read(s, u, { reset: GameData.ResetCycle.Daily, live_event, count: 4, reset_at: ROUND_1_START, event_round: 1 })).toEqual({
      count: 0,
      reset_at: next_midnight,
      event_round: 2,
      write_reset_at: next_midnight,
    });
    // Between rounds (round 0): no round reset.
    set_time(s, ROUND_2_START - 1n);
    expect(await read(s, u, { live_event, count: 4, event_round: 1 })).toEqual({ count: 4, reset_at: 0n, event_round: 1, write_reset_at: 0n });
  });

  it('reads a row that the round reset, the offer purchase reset and the lazy reset all hit, in that order', async () => {
    const s = await start({ settings: SETTINGS });
    const u = await user(s);
    const id = offer_id('[offer_event]');
    const live_event = event_id('[event_offer]');
    set_time(s, ROUND_1_START);
    expect(await trigger(s, u, id)).toBe('OK');
    const round_1_ends_at = ROUND_1_START + HOUR;
    set_time(s, ROUND_2_START);
    expect(await trigger(s, u, id)).toBe('OK');
    const round_2_ends_at = ROUND_2_START + HOUR;
    // The row of a round 1 purchase: an earlier round, a reset_at not the offer end time, and a reset_at reached.
    const row = { offer: id, live_event, count: 1, reset_at: round_1_ends_at, event_round: 1 };
    // While the offer is on: the round reset reads event_round 2 and reset_at the offer end time; the lazy reset does not hit it.
    expect(await read(s, u, row)).toEqual({ count: 0, reset_at: round_2_ends_at, event_round: 2, write_reset_at: round_2_ends_at });
    // After the offer ends: the lazy reset hits the offer end time and reads the next reset time, the same end time.
    set_time(s, round_2_ends_at);
    expect(await read(s, u, row)).toEqual({ count: 0, reset_at: round_2_ends_at, event_round: 2, write_reset_at: round_2_ends_at });
    // Without the round reset (event_round 2), the offer purchase reset alone reads the same.
    expect(await read(s, u, { ...row, event_round: 2 })).toEqual({ count: 0, reset_at: round_2_ends_at, event_round: 2, write_reset_at: round_2_ends_at });
  });
});
