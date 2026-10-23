/**
 * The clock adapter: the only way server code reads the time. The system clock adapter is
 * `adapters/system_clock.ts`; the test clock is a DEV clock adapter that `testing` sets with `set_clock`.
 */
export interface ClockAdapter {
  /** The time now. Unix ms. */
  now(): bigint;
  /**
   * True when the time moves with real time (the system clock). The scheduler then wakes by its own timers;
   * otherwise it wakes only when the clock calls a listener.
   */
  readonly real_time: boolean;
  /** Calls `listener` after each change of the time. Returns a function that removes it. */
  subscribe(listener: () => void): () => void;
}
