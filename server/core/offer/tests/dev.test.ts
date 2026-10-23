import type { Offer } from '../index.ts';
import { DAY, HOUR, MINUTE, START_TIME, UNKNOWN_OFFER_ID, at, by_id, call, offer_id, set_offer, set_time, start, stop_all, stored, user, view } from './helpers.ts';

// Counts the DEV objects a server instance makes for offer.
const dev_factory = vi.hoisted(() => ({ calls: 0 }));
vi.mock('../dev/index.ts', async (import_original) => {
  const actual = await import_original<typeof import('../dev/index.ts')>();
  return {
    ...actual,
    create_offer_dev: (offer: Offer) => {
      dev_factory.calls += 1;
      return actual.create_offer_dev(offer);
    },
  };
});

afterEach(stop_all);

// `[offer_basic]`: duration 1h, cooldown 30m.
const BASIC_SPAN = HOUR + 30n * MINUTE;

const INT64_MAX = 2n ** 63n - 1n;
const INT32_MAX = 2 ** 31 - 1;

describe('set_offer (DEV)', () => {
  it('writes the row with the given values, without looking at the window, requirement, cooldown or limit', async () => {
    const s = await start();
    const u = await user(s);
    const locked = offer_id('[offer_locked]');
    const window = offer_id('[offer_window]');
    s.judge = false;
    expect(await set_offer(s, u, locked, START_TIME - DAY, 99)).toBeNull();
    expect(await set_offer(s, u, window, START_TIME, 1)).toBeNull();
    expect(await stored(s, u)).toEqual(by_id([
      { id: BigInt(locked), started_at: START_TIME - DAY, trigger_count: 99, event_round: 0 },
      { id: BigInt(window), started_at: START_TIME, trigger_count: 1, event_round: 0 },
    ]));
    expect(await view(s, u, window)).toEqual({ active: true, ends_at: START_TIME + HOUR });
  });

  it('takes the largest int32 trigger_count and the largest started_at whose started_at + duration + cooldown is 2^63 − 1', async () => {
    const s = await start();
    const u = await user(s);
    const id = offer_id('[offer_basic]');
    const largest = INT64_MAX - BASIC_SPAN;
    expect(await set_offer(s, u, id, largest, INT32_MAX)).toBeNull();
    expect(await stored(s, u)).toEqual([{ id: BigInt(id), started_at: largest, trigger_count: INT32_MAX, event_round: 0 }]);
    await set_offer(s, u, id, largest, 1);
    expect(await view(s, u, id)).toEqual({ active: true, ends_at: largest + HOUR });
    expect(await call(s, u, (ctx) => s.offer.trigger_offer(ctx, id))).toBe('ACTIVE');
    await expect(set_offer(s, u, id, largest + 1n, 1)).rejects.toThrow();
    await expect(set_offer(s, u, id, largest + 1n, 0)).rejects.toThrow();
    expect(await stored(s, u)).toEqual([{ id: BigInt(id), started_at: largest, trigger_count: 1, event_round: 0 }]);
  });

  it('writes event_round by the round reset rule, and deletes the row for trigger_count 0', async () => {
    const s = await start();
    const u = await user(s);
    const id = offer_id('[offer_event]');
    set_time(s, at('2027-01-16T00:00:00Z'));
    await set_offer(s, u, id, 5n, 2);
    expect(await stored(s, u)).toEqual([{ id: BigInt(id), started_at: 5n, trigger_count: 2, event_round: 1 }]);
    await set_offer(s, u, id, 0n, 0);
    expect(await stored(s, u)).toEqual([]);
  });

  it('throws for an unknown offer, and for a non-integer, negative or out-of-range value', async () => {
    const s = await start();
    const u = await user(s);
    const id = offer_id('[offer_basic]');
    const bad: [number, unknown, unknown][] = [
      [UNKNOWN_OFFER_ID, START_TIME, 1],
      [id, -1n, 1],
      [id, START_TIME, -1],
      [id, 1.5, 1],
      [id, START_TIME, 0.5],
      [id, '1', 1],
      [id, INT64_MAX + 1n, 1],
      [id, START_TIME, INT32_MAX + 1],
    ];
    for (const [offer, started_at, count] of bad) {
      await expect(set_offer(s, u, offer, started_at, count), `${String(started_at)}, ${String(count)}`).rejects.toThrow();
    }
    expect(await stored(s, u)).toEqual([]);
  });

  it('is not in a STG server instance', async () => {
    dev_factory.calls = 0;
    const local = await start();
    expect(dev_factory.calls).toBe(1);
    await set_offer(local, await user(local), offer_id('[offer_basic]'), 1n, 1);
    dev_factory.calls = 0;
    const s = await start({ environment: 'STG' });
    expect(dev_factory.calls).toBe(0);
    expect(s.server.running().instance.dev).toBeUndefined();
  });
});
