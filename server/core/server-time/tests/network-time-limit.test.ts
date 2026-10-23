import { create_server_time } from '../index.ts';
import { create_server_time_dev } from '../dev/index.ts';
import { ManualClock, module_input, wait_real } from './manual_clock.ts';

describe('network_time_limit', () => {
  it('aborts after the ms of real time and not when the test clock moves past it', async () => {
    const clock = new ManualClock(1_700_000_000_000n);
    const server_time = create_server_time(module_input());
    create_server_time_dev(server_time).set_clock(clock);
    server_time.complete_start();
    const signal = server_time.network_time_limit(120n);
    clock.advance(60_000n);
    await wait_real(30);
    expect(signal.aborted).toBe(false);
    await wait_real(250);
    expect(signal.aborted).toBe(true);
    expect((signal.reason as DOMException).name).toBe('TimeoutError');
    server_time.stop();
  });

  it('throws on ms below 1', () => {
    const server_time = create_server_time(module_input());
    expect(() => server_time.network_time_limit(0n)).toThrow();
    expect(() => server_time.network_time_limit(-5n)).toThrow();
    expect(server_time.network_time_limit(1n).aborted).toBe(false);
  });
});
