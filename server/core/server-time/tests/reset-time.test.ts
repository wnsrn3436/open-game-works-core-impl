import * as GameData from '../../../generated/data/game_data.ts';
import { create_server_time } from '../index.ts';
import { create_server_time_dev } from '../dev/index.ts';
import { read_core_fixture } from '../../testing/dev/index.ts';
import { ManualClock, module_input } from './manual_clock.ts';

interface ResetTimeCase {
  name: string;
  input: { offset_ms: number; cycle: 'Daily' | 'Weekly' | 'Monthly'; time: number };
  expected: { day_number: number; period_start: number; next_reset: number; period_number: number };
}

/** The core test fixture `reset-time`. */
function reset_time_cases(): ResetTimeCase[] {
  return (JSON.parse(new TextDecoder().decode(read_core_fixture('reset-time'))) as { cases: ResetTimeCase[] }).cases;
}

describe('game day and ResetCycle', () => {
  const cases = reset_time_cases();

  it('has cases for every offset kind, cycle and boundary', () => {
    const offsets = new Set(cases.map((c) => Math.sign(c.input.offset_ms)));
    expect([...offsets].sort()).toEqual([-1, 0, 1]);
    expect(cases.some((c) => c.input.offset_ms === -32_400_000)).toBe(true);
    expect(new Set(cases.map((c) => c.input.cycle))).toEqual(new Set(['Daily', 'Weekly', 'Monthly']));
  });

  it.each(cases.map((c) => [c.name, c] as const))('matches fixture case %s', (_name, c) => {
    const server_time = create_server_time(module_input(5000, c.input.offset_ms));
    const cycle = GameData.ResetCycle[c.input.cycle];
    const time = BigInt(c.input.time);
    expect(server_time.get_day_number(time)).toBe(BigInt(c.expected.day_number));
    expect(server_time.get_period_start(cycle, time)).toBe(BigInt(c.expected.period_start));
    expect(server_time.get_next_reset(cycle, time)).toBe(BigInt(c.expected.next_reset));
    expect(server_time.get_period_number(cycle, time)).toBe(BigInt(c.expected.period_number));
  });

  it('gives 0 for a null or None cycle and throws for get_period_number of None', () => {
    const server_time = create_server_time(module_input());
    expect(server_time.get_period_start(null, 1_000n)).toBe(0n);
    expect(server_time.get_next_reset(null, 1_000n)).toBe(0n);
    expect(server_time.get_period_start(GameData.ResetCycle.None, 1_000n)).toBe(0n);
    expect(server_time.get_next_reset(GameData.ResetCycle.None, 1_000n)).toBe(0n);
    expect(() => server_time.get_period_number(GameData.ResetCycle.None, 1_000n)).toThrow();
  });

  it('numbers adjacent periods 1 apart', () => {
    const server_time = create_server_time(module_input(5000, -32_400_000));
    for (const cycle of [GameData.ResetCycle.Daily, GameData.ResetCycle.Weekly, GameData.ResetCycle.Monthly]) {
      let time = 1_700_000_000_000n;
      for (let i = 0; i < 30; i += 1) {
        const next = server_time.get_next_reset(cycle, time);
        expect(server_time.get_period_start(cycle, next)).toBe(next);
        expect(server_time.get_period_number(cycle, next)).toBe(server_time.get_period_number(cycle, time) + 1n);
        expect(server_time.get_period_number(cycle, next - 1n)).toBe(server_time.get_period_number(cycle, time));
        time = next;
      }
    }
  });
});

describe('fixed window', () => {
  it('puts clock_now 119999 in the minute window [60000, 120000) and 120000 in the next one', () => {
    const clock = new ManualClock(119_999n);
    const server_time = create_server_time(module_input());
    create_server_time_dev(server_time).set_clock(clock);
    const start = server_time.get_window_start(60_000n, server_time.clock_now());
    expect(start).toBe(60_000n);
    expect(start + 60_000n).toBe(120_000n);
    clock.set(120_000n);
    expect(server_time.get_window_start(60_000n, server_time.clock_now())).toBe(120_000n);
  });

  it('uses clock_now, not the cheat time offset, for a user with an offset', () => {
    const clock = new ManualClock(119_999n);
    const server_time = create_server_time(module_input());
    const dev = create_server_time_dev(server_time);
    dev.set_clock(clock);
    dev.register_offset_provider(() => 3_600_000n);
    expect(server_time.get_window_start(60_000n, server_time.clock_now())).toBe(60_000n);
    expect(server_time.get_window_start(60_000n, server_time.user_now(1n, null))).toBe(3_660_000n);
  });

  it('floors the window start for any length of 1 or more and throws for a length below 1', () => {
    const server_time = create_server_time(module_input());
    expect(server_time.get_window_start(1n, 12_345n)).toBe(12_345n);
    expect(server_time.get_window_start(1_000n, 0n)).toBe(0n);
    expect(server_time.get_window_start(1_000n, 1_999n)).toBe(1_000n);
    expect(server_time.get_window_start(1_000n, -1n)).toBe(-1_000n);
    expect(() => server_time.get_window_start(0n, 1_000n)).toThrow();
    expect(() => server_time.get_window_start(-60_000n, 1_000n)).toThrow();
  });
});
