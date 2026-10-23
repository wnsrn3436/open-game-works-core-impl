import type { ClockAdapter, OffsetProvider, ServerTime } from '../index.ts';

/** The `## DEV` operations of `server-time` for one server instance. */
export interface ServerTimeDev {
  /** `cheat` calls it at server start. A second call fails server start; a call after server start throws. */
  register_offset_provider(provider: OffsetProvider): void;
  /** `testing` calls it before server start. Throws once server start has begun. */
  set_clock(clock: ClockAdapter): void;
  /** Ends when no job runs, or every running job sleeps until a time the clock has not reached. */
  wait_idle(): Promise<void>;
}

/** The DEV operations of the server instance's `server-time`. */
export function create_server_time_dev(server_time: ServerTime): ServerTimeDev {
  return {
    register_offset_provider: (provider) => {
      server_time.use_offset_provider(provider);
    },
    set_clock: (clock) => {
      server_time.use_clock(clock);
    },
    wait_idle: () => server_time.wait_idle(),
  };
}
