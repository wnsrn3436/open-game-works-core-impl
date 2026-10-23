/** The longest delay one timer takes; a longer limit chains timers. */
const MAX_TIMER_MS = 2_147_483_647n;

/**
 * `network_time_limit`: an `AbortSignal` that aborts when `ms` of real time has passed since the call. It measures
 * real time with timers, so a clock adapter change (the test clock) does not abort it. Throws when `ms` is below 1.
 */
export function network_time_limit(ms: bigint): AbortSignal {
  if (ms < 1n) throw new RangeError(`network_time_limit: ms ${String(ms)} is below 1`);
  const controller = new AbortController();
  const wait = (left: bigint): void => {
    const step = left < MAX_TIMER_MS ? left : MAX_TIMER_MS;
    const timer = setTimeout(() => {
      if (left > step) wait(left - step);
      else controller.abort(new DOMException(`network time limit of ${String(ms)} ms passed`, 'TimeoutError'));
    }, Number(step));
    timer.unref();
  };
  wait(ms);
  return controller.signal;
}
