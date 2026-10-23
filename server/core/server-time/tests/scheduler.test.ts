import { create_server_time, type ServerTime } from '../index.ts';
import { create_server_time_dev } from '../dev/index.ts';
import { flush, ManualClock, module_input, wait_real } from './manual_clock.ts';

const START = 1_700_000_000_000n;

function with_clock(clock: ManualClock): ServerTime {
  const server_time = create_server_time(module_input());
  create_server_time_dev(server_time).set_clock(clock);
  return server_time;
}

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve = (): void => undefined;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

describe('scheduler on the system clock', () => {
  it('runs a job once when server start ends and then every interval', async () => {
    const server_time = create_server_time(module_input());
    let runs = 0;
    server_time.begin_start();
    server_time.schedule_job('count_job', 40n, () => {
      runs += 1;
    });
    expect(runs).toBe(0);
    expect(server_time.complete_start()).toBeNull();
    // complete_start() only ends the registration: the other modules' complete_start() comes after it.
    await wait_real(60);
    expect(runs).toBe(0);
    server_time.end_start();
    expect(runs).toBe(1);
    await wait_real(220);
    server_time.stop();
    expect(runs).toBeGreaterThanOrEqual(3);
    const stopped = runs;
    await wait_real(100);
    expect(runs).toBe(stopped);
  });
});

describe('scheduler on the test clock', () => {
  it('runs a job after server start only when the clock passes the interval, once for many intervals', async () => {
    const clock = new ManualClock(START);
    const server_time = with_clock(clock);
    let runs = 0;
    server_time.schedule_job('count_job', 1000n, () => {
      runs += 1;
    });
    expect(server_time.complete_start()).toBeNull();
    server_time.end_start();
    expect(runs).toBe(1);
    clock.advance(999n);
    await flush();
    expect(runs).toBe(1);
    clock.advance(1n);
    await flush();
    expect(runs).toBe(2);
    clock.advance(5500n);
    await flush();
    expect(runs).toBe(3);
    await wait_real(150);
    expect(runs).toBe(3);
    clock.advance(999n);
    await flush();
    expect(runs).toBe(3);
    clock.advance(1n);
    await flush();
    expect(runs).toBe(4);
    server_time.stop();
  });

  it('does not overlap runs of one job and runs once more right after a run that became due again', async () => {
    const clock = new ManualClock(START);
    const server_time = with_clock(clock);
    const gates = [deferred(), deferred()];
    let running = 0;
    let most = 0;
    let runs = 0;
    server_time.schedule_job('slow_job', 1000n, async () => {
      const gate = gates[runs];
      runs += 1;
      running += 1;
      most = Math.max(most, running);
      await gate?.promise;
      running -= 1;
    });
    server_time.complete_start();
    server_time.end_start();
    expect(runs).toBe(1);
    clock.advance(1000n);
    clock.advance(3000n);
    await flush();
    expect(runs).toBe(1);
    gates[0]?.resolve();
    await flush();
    expect(runs).toBe(2);
    gates[1]?.resolve();
    await flush();
    expect(runs).toBe(2);
    expect(most).toBe(1);
    server_time.stop();
  });

  it('runs a job that threw again at its next time', async () => {
    const clock = new ManualClock(START);
    const server_time = with_clock(clock);
    let runs = 0;
    server_time.schedule_job('sync_throw_job', 1000n, () => {
      runs += 1;
      throw new Error('job failure');
    });
    let async_runs = 0;
    server_time.schedule_job('async_throw_job', 1000n, async () => {
      async_runs += 1;
      await Promise.resolve();
      throw new Error('job failure');
    });
    expect(server_time.complete_start()).toBeNull();
    server_time.end_start();
    await flush();
    expect([runs, async_runs]).toEqual([1, 1]);
    clock.advance(1000n);
    await flush();
    expect([runs, async_runs]).toEqual([2, 2]);
    server_time.stop();
  });

  it('ends sleep when the test clock reaches its time', async () => {
    const clock = new ManualClock(START);
    const server_time = with_clock(clock);
    server_time.complete_start();
    server_time.end_start();
    let done = false;
    void server_time.sleep(500n).then(() => {
      done = true;
    });
    await wait_real(50);
    expect(done).toBe(false);
    clock.advance(499n);
    await flush();
    expect(done).toBe(false);
    clock.advance(1n);
    await flush();
    expect(done).toBe(true);
    await server_time.sleep(0n);
    server_time.stop();
  });

  it('ends many sleeps each when the test clock reaches its time, same times in call order', async () => {
    const clock = new ManualClock(START);
    const server_time = with_clock(clock);
    server_time.complete_start();
    server_time.end_start();
    // Durations out of order, with repeats: 0..199 ms, each three times.
    const durations = Array.from({ length: 600 }, (_, i) => BigInt((i * 37) % 200) + 1n);
    const ended: number[] = [];
    durations.forEach((ms, i) => {
      void server_time.sleep(ms).then(() => {
        ended.push(i);
      });
    });
    for (let step = 0n; step <= 200n; step += 7n) {
      clock.set(START + step);
      await flush();
      const expected = durations.flatMap((ms, i) => (ms <= step ? [i] : []));
      expect([...ended].sort((a, b) => a - b)).toEqual(expected);
    }
    // Sleeps with the same end time ended in the order they were called.
    const by_end = new Map<bigint, number[]>();
    for (const i of ended) by_end.set(durations[i] ?? 0n, [...(by_end.get(durations[i] ?? 0n) ?? []), i]);
    for (const order of by_end.values()) expect(order).toEqual([...order].sort((a, b) => a - b));
    server_time.stop();
  });

  it('wakes many sleeps on the system clock at their end times', async () => {
    const server_time = create_server_time(module_input());
    server_time.complete_start();
    server_time.end_start();
    const ended: number[] = [];
    const sleeps = [90n, 10n, 50n, 10n, 30n, 70n].map((ms, i) =>
      server_time.sleep(ms).then(() => {
        ended.push(i);
      }),
    );
    await Promise.all(sleeps);
    expect(ended).toEqual([1, 3, 4, 2, 5, 0]);
    server_time.stop();
  });

  it('fails server start on a second job of the same name or an interval below 1, and throws after server start', () => {
    const twice = with_clock(new ManualClock(START));
    twice.begin_start();
    twice.schedule_job('same_job', 1000n, () => undefined);
    twice.schedule_job('same_job', 2000n, () => undefined);
    expect(twice.complete_start()).toMatch(/same_job/);

    for (const interval of [0n, -1n]) {
      const short = with_clock(new ManualClock(START));
      short.begin_start();
      short.schedule_job('short_job', interval, () => undefined);
      expect(short.complete_start()).toMatch(/short_job/);
    }

    const started = with_clock(new ManualClock(START));
    expect(started.complete_start()).toBeNull();
    expect(() => {
      started.schedule_job('late_job', 1000n, () => undefined);
    }).toThrow();
    started.end_start();
    expect(() => {
      started.schedule_job('later_job', 1000n, () => undefined);
    }).toThrow();
    started.stop();
  });

  it('runs no job at complete_start, every job once at end_start, and end_start only once after a complete_start that succeeded', () => {
    const server_time = with_clock(new ManualClock(START));
    const runs: string[] = [];
    server_time.begin_start();
    server_time.schedule_job('first_job', 1000n, () => runs.push('first_job'));
    server_time.schedule_job('second_job', 1000n, () => runs.push('second_job'));
    expect(() => {
      server_time.end_start();
    }).toThrow();
    expect(server_time.complete_start()).toBeNull();
    expect(runs).toEqual([]);
    server_time.end_start();
    expect(runs).toEqual(['first_job', 'second_job']);
    expect(() => {
      server_time.end_start();
    }).toThrow();
    server_time.stop();

    const failed = with_clock(new ManualClock(START));
    let failed_runs = 0;
    failed.begin_start();
    failed.schedule_job('failed_job', 1000n, () => (failed_runs += 1));
    failed.schedule_job('failed_job', 1000n, () => (failed_runs += 1));
    expect(failed.complete_start()).toMatch(/failed_job/);
    expect(() => {
      failed.end_start();
    }).toThrow();
    expect(failed_runs).toBe(0);
  });

  it('throws on set_clock once server start has begun', () => {
    const server_time = create_server_time(module_input());
    const dev = create_server_time_dev(server_time);
    dev.set_clock(new ManualClock(START));
    server_time.begin_start();
    expect(() => {
      dev.set_clock(new ManualClock(START));
    }).toThrow();
    expect(server_time.clock_now()).toBe(START);
  });

  it('ends wait_idle without waiting for a job that sleeps until a time the clock has not reached', async () => {
    const clock = new ManualClock(START);
    const server_time = with_clock(clock);
    const dev = create_server_time_dev(server_time);
    let woke = false;
    server_time.schedule_job('sleepy_job', 60_000n, async () => {
      await server_time.sleep(10_000n);
      woke = true;
    });
    const gate = deferred();
    let gated_done = false;
    server_time.schedule_job('gated_job', 60_000n, async () => {
      await gate.promise;
      gated_done = true;
    });
    server_time.complete_start();
    server_time.end_start();
    let idle = false;
    void dev.wait_idle().then(() => {
      idle = true;
    });
    await wait_real(30);
    expect(idle).toBe(false);
    gate.resolve();
    await wait_real(30);
    expect(gated_done).toBe(true);
    expect(idle).toBe(true);
    expect(woke).toBe(false);
    clock.advance(10_000n);
    await dev.wait_idle();
    expect(woke).toBe(true);
    server_time.stop();
  });
});
