import type { ClockAdapter, ServerTimeInput } from '../index.ts';

/** A clock adapter whose time moves only when the test sets it, like the test clock. */
export class ManualClock implements ClockAdapter {
  readonly real_time = false;
  #time: bigint;
  readonly #listeners = new Set<() => void>();

  constructor(time: bigint) {
    this.#time = time;
  }

  now(): bigint {
    return this.#time;
  }

  set(time: bigint): void {
    this.#time = time;
    for (const listener of [...this.#listeners]) listener();
  }

  advance(ms: bigint): void {
    this.set(this.#time + ms);
  }

  subscribe(listener: () => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }
}

/** The module input of a test `server-time`. */
export function module_input(silent_margin_ms = 5000, daily_reset_offset_ms = 0): ServerTimeInput {
  return { settings: { 'server-time.silentMarginMs': silent_margin_ms, dailyResetOffsetMs: daily_reset_offset_ms }, modules: {} };
}

/** Waits real time. */
export function wait_real(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Lets pending promise callbacks run. */
export function flush(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}
