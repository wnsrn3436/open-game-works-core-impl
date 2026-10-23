import { network_time_limit } from '../../server-time/network_time_limit.ts';

/** Resolves after `ms` of real time, on `server-time.network_time_limit`, the real time timer of core code. */
export function real_delay(ms: bigint): Promise<void> {
  const signal = network_time_limit(ms);
  return new Promise((resolve) => {
    signal.addEventListener('abort', () => {
      resolve();
    }, { once: true });
  });
}
