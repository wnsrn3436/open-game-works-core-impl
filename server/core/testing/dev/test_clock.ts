import type { ClockAdapter } from '../../server-time/clock.ts';

/**
 * The test clock (`server-time` `ClockAdapter`): a time that moves only by `set_time` and `advance_time`. One test
 * clock is shared by a test server and its peers; every change calls the listeners of all of them.
 */
export class TestClock implements ClockAdapter {
  readonly real_time = false;
  private time: bigint;
  private readonly listeners = new Set<() => void>();

  constructor(start_at: bigint) {
    this.time = start_at;
  }

  now(): bigint {
    return this.time;
  }

  subscribe(listener: () => void): () => void {
    // Each subscription is its own entry, so one listener subscribed twice is also removed one at a time.
    const entry = (): void => {
      listener();
    };
    this.listeners.add(entry);
    return () => {
      this.listeners.delete(entry);
    };
  }

  set(time: bigint): void {
    this.time = time;
    for (const listener of [...this.listeners]) listener();
  }
}
