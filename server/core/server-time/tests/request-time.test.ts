import { create_server_time, type TimeCtx } from '../index.ts';
import { create_server_time_dev } from '../dev/index.ts';
import { ManualClock, module_input } from './manual_clock.ts';

const START = 1_700_000_000_000n;
const MARGIN = 5000n;

function test_server_time(clock: ManualClock) {
  const server_time = create_server_time(module_input(Number(MARGIN)));
  create_server_time_dev(server_time).set_clock(clock);
  return server_time;
}

function ctx(request_time: bigint, silent: boolean): TimeCtx {
  return { request_time, silent };
}

describe('request time', () => {
  it('keeps now the same within one request while the clock moves', () => {
    const clock = new ManualClock(START);
    const server_time = test_server_time(clock);
    const request = ctx(server_time.user_now(1n, null), false);
    clock.advance(7000n);
    const first = server_time.now(request);
    clock.advance(1n);
    expect(first).toBe(START);
    expect(server_time.now(request)).toBe(START);
    expect(server_time.clock_now()).toBe(START + 7001n);
  });

  it('is_reached of a silent request allows the margin and of a request without silent does not', () => {
    const server_time = test_server_time(new ManualClock(START));
    const target = START + MARGIN - 1n;
    expect(server_time.is_reached(ctx(START, false), target)).toBe(false);
    expect(server_time.is_reached(ctx(START, true), target)).toBe(true);
    expect(server_time.is_reached(ctx(START, true), START + MARGIN)).toBe(true);
    expect(server_time.is_reached(ctx(START, true), START + MARGIN + 1n)).toBe(false);
    expect(server_time.is_reached(ctx(START, false), START)).toBe(true);
  });

  it('is_reached_strict ignores the margin and is true at request time = target', () => {
    const server_time = test_server_time(new ManualClock(START));
    const target = START + MARGIN - 1n;
    expect(server_time.is_reached_strict(ctx(START, false), target)).toBe(false);
    expect(server_time.is_reached_strict(ctx(START, true), target)).toBe(false);
    expect(server_time.is_reached_strict(ctx(START, true), START)).toBe(true);
    expect(server_time.is_reached_strict(ctx(START, false), START)).toBe(true);
    expect(server_time.is_reached_strict(ctx(START, false), START - 1n)).toBe(true);
  });

  it('throws on a target below 0 or at 2^63 and above, and takes 0 and 2^63 - 1', () => {
    const server_time = test_server_time(new ManualClock(START));
    for (const target of [-1n, 2n ** 63n, 2n ** 64n]) {
      expect(() => server_time.is_reached(ctx(START, false), target)).toThrow();
      expect(() => server_time.is_reached(ctx(START, true), target)).toThrow();
      expect(() => server_time.is_reached_strict(ctx(START, false), target)).toThrow();
    }
    expect(server_time.is_reached(ctx(START, false), 0n)).toBe(true);
    expect(server_time.is_reached_strict(ctx(START, false), 2n ** 63n - 1n)).toBe(false);
  });

  it('adds the cheat time offset of the user in DEV, and nothing for a user without one', () => {
    const clock = new ManualClock(START);
    const server_time = test_server_time(clock);
    const offset = 3n * 86_400_000n;
    const seen: unknown[] = [];
    create_server_time_dev(server_time).register_offset_provider((user_id, db) => {
      seen.push(db);
      return user_id === 7n ? offset : 0n;
    });
    const db = { handle: 1 };
    expect(server_time.user_now(7n, db)).toBe(START + offset);
    expect(server_time.user_now(8n, db)).toBe(START);
    expect(server_time.clock_now()).toBe(START);
    expect(seen).toEqual([db, db]);
    expect(server_time.complete_start()).toBeNull();
    server_time.stop();
  });

  it('fails server start on a second register_offset_provider', () => {
    const server_time = test_server_time(new ManualClock(START));
    const dev = create_server_time_dev(server_time);
    dev.register_offset_provider(() => 1n);
    dev.register_offset_provider(() => 2n);
    expect(server_time.complete_start()).toMatch(/register_offset_provider/);
    expect(server_time.user_now(1n, null)).toBe(START + 1n);
    server_time.stop();
  });

  it('throws on register_offset_provider after server start has ended, and keeps the provider it had', () => {
    const server_time = test_server_time(new ManualClock(START));
    const dev = create_server_time_dev(server_time);
    dev.register_offset_provider(() => 1n);
    server_time.begin_start();
    expect(server_time.complete_start()).toBeNull();
    expect(() => {
      dev.register_offset_provider(() => 5n);
    }).toThrow(/register_offset_provider/);
    expect(() => {
      dev.register_offset_provider(() => 6n);
    }).toThrow(/register_offset_provider/);
    expect(server_time.user_now(1n, null)).toBe(START + 1n);
    server_time.stop();
    expect(() => {
      dev.register_offset_provider(() => 7n);
    }).toThrow(/register_offset_provider/);

    const without = test_server_time(new ManualClock(START));
    expect(without.complete_start()).toBeNull();
    expect(() => {
      create_server_time_dev(without).register_offset_provider(() => 5n);
    }).toThrow(/register_offset_provider/);
    expect(without.user_now(1n, null)).toBe(START);
    without.stop();
  });

  it('has user_now equal to clock_now without the DEV code (STG and PROD)', () => {
    const server_time = create_server_time(module_input());
    const user_now = server_time.user_now(7n, null);
    const clock_now = server_time.clock_now();
    expect(clock_now - user_now).toBeGreaterThanOrEqual(0n);
    expect(clock_now - user_now).toBeLessThan(1000n);
    const clock = new ManualClock(START);
    const stg = create_server_time(module_input());
    create_server_time_dev(stg).set_clock(clock);
    expect(stg.user_now(7n, null)).toBe(stg.clock_now());
  });

  it('has every API operation and lifecycle method as a method of the module object', () => {
    const server_time = create_server_time(module_input());
    const methods = ['now', 'is_reached', 'is_reached_strict', 'clock_now', 'user_now', 'get_day_number', 'get_period_start',
      'get_next_reset', 'get_period_number', 'get_window_start', 'schedule_job', 'sleep', 'network_time_limit', 'begin_start',
      'complete_start', 'stop'] as const;
    for (const name of methods) expect(typeof server_time[name]).toBe('function');
    server_time.begin_start();
    expect(server_time.complete_start()).toBeNull();
    server_time.stop();
  });

  it('throws on a missing or non-integer setting', () => {
    expect(() => create_server_time({ settings: { 'server-time.silentMarginMs': 1 }, modules: {} })).toThrow();
    expect(() => create_server_time({ settings: { 'server-time.silentMarginMs': 1.5, dailyResetOffsetMs: 0 }, modules: {} })).toThrow();
    expect(() => create_server_time({ settings: { 'server-time.silentMarginMs': 1, dailyResetOffsetMs: '0' }, modules: {} })).toThrow();
  });
});
