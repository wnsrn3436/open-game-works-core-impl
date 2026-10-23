import type { ClockAdapter } from '../clock.ts';

/** The clock adapter `system`: the host system clock. The one core code file that reads the system clock. */
export function create_system_clock(): ClockAdapter {
  return {
    now: () => BigInt(Date.now()),
    real_time: true,
    subscribe: () => () => undefined,
  };
}
