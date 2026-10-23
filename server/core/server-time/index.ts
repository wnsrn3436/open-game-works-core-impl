import * as GameData from '../../generated/data/game_data.ts';
import { create_system_clock } from './adapters/system_clock.ts';
import { day_number, next_reset, period_number, period_start, window_start, type Cycle } from './calendar.ts';
import type { ClockAdapter } from './clock.ts';
import { network_time_limit } from './network_time_limit.ts';
import { Scheduler, type JobFunction } from './scheduler.ts';

export type { ClockAdapter } from './clock.ts';
export type { JobFunction } from './scheduler.ts';

/** The ctx fields server-time reads (`storage` `### ctx`). */
export interface TimeCtx {
  readonly request_time: bigint;
  readonly silent: boolean;
}

/** A DB handle: a transaction the caller opened or `storage.read_db`'s handle. server-time only passes it on. */
export type DbHandle = unknown;

/** The cheat time offset provider (DEV `register_offset_provider`): the offset ms of a user. */
export type OffsetProvider = (user_id: bigint, db: DbHandle) => bigint;

/** The `## API` operations of `server-time`. */
export interface ServerTimeApi {
  now(ctx: TimeCtx): bigint;
  is_reached(ctx: TimeCtx, target: bigint): boolean;
  is_reached_strict(ctx: TimeCtx, target: bigint): boolean;
  clock_now(): bigint;
  user_now(user_id: bigint, db: DbHandle): bigint;
  get_day_number(time: bigint): bigint;
  get_period_start(cycle: GameData.ResetCycle | null, time: bigint): bigint;
  get_next_reset(cycle: GameData.ResetCycle | null, time: bigint): bigint;
  get_period_number(cycle: GameData.ResetCycle, time: bigint): bigint;
  get_window_start(length_ms: bigint, time: bigint): bigint;
  schedule_job(name: string, interval_ms: bigint, run: JobFunction): void;
  sleep(ms: bigint): Promise<void>;
  network_time_limit(ms: bigint): AbortSignal;
}

/**
 * `server-time` of one server instance: the `## API` operations, the lifecycle `routing` drives during server
 * start, and the slots the DEV code (`dev/index.ts`) fills.
 */
export interface ServerTime extends ServerTimeApi {
  /** Server start begins: the clock adapter is fixed from here. */
  begin_start(): void;
  /** Registration ends: null, or the reason server start fails. No job runs yet. */
  complete_start(): string | null;
  /**
   * Server start has ended (`routing`, after every module's `complete_start()` and listening): every job runs once.
   * Throws unless `complete_start()` succeeded and this was not called yet.
   */
  end_start(): void;
  /** The server instance stops: the scheduler stops. */
  stop(): void;
  /** For the DEV code: replaces the clock adapter before server start; throws after server start has begun. */
  use_clock(clock: ClockAdapter): void;
  /**
   * For the DEV code: sets the cheat time offset provider; a second call fails server start, and a call after server
   * start has ended throws.
   */
  use_offset_provider(provider: OffsetProvider): void;
  /** For the DEV code: `wait_idle`. */
  wait_idle(): Promise<void>;
}

const TARGET_LIMIT = 2n ** 63n;

/** Settings server-time reads: core settings `server-time.silentMarginMs`, game settings `dailyResetOffsetMs`. */
type SettingKey = 'server-time.silentMarginMs' | 'dailyResetOffsetMs';

/**
 * The module input (`server-core` `## module`): `settings` holds the core settings keys and game settings paths of
 * `## settings` by key. `server-time` has no dependency, so `modules` is empty.
 */
export interface ServerTimeInput {
  readonly settings: Readonly<Record<string, unknown>>;
  readonly modules: Readonly<Record<string, unknown>>;
}

function integer_setting(settings: Readonly<Record<string, unknown>>, key: SettingKey): bigint {
  const value = settings[key];
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) throw new TypeError(`server-time: setting ${key} is not an integer`);
  return BigInt(value);
}

function check_target(target: bigint): void {
  if (target < 0n || target >= TARGET_LIMIT) throw new RangeError(`server-time: target ${String(target)} is not in [0, 2^63)`);
}

function cycle_of(cycle: GameData.ResetCycle): Cycle | null {
  switch (cycle) {
    case GameData.ResetCycle.Daily:
      return 'Daily';
    case GameData.ResetCycle.Weekly:
      return 'Weekly';
    case GameData.ResetCycle.Monthly:
      return 'Monthly';
    default:
      return null;
  }
}

function required_cycle(cycle: GameData.ResetCycle): Cycle {
  const value = cycle_of(cycle);
  if (value === null) throw new RangeError(`server-time: ${String(cycle)} is not a ResetCycle element`);
  return value;
}

/**
 * Makes `server-time` for one server instance. A missing or non-integer setting throws. The clock adapter is the
 * system clock until the DEV code sets another.
 */
export function create_server_time(input: ServerTimeInput): ServerTime {
  const { settings } = input;
  const silent_margin_ms = integer_setting(settings, 'server-time.silentMarginMs');
  const offset_ms = integer_setting(settings, 'dailyResetOffsetMs');
  const scheduler = new Scheduler(create_system_clock());
  let offset_provider: OffsetProvider | null = null;

  const clock_now = (): bigint => scheduler.now();

  return {
    now: (ctx) => ctx.request_time,
    is_reached: (ctx, target) => {
      check_target(target);
      return ctx.request_time + (ctx.silent ? silent_margin_ms : 0n) >= target;
    },
    is_reached_strict: (ctx, target) => {
      check_target(target);
      return ctx.request_time >= target;
    },
    clock_now,
    user_now: (user_id, db) => clock_now() + (offset_provider === null ? 0n : offset_provider(user_id, db)),
    get_day_number: (time) => day_number(offset_ms, time),
    get_period_start: (cycle, time) => {
      const value = cycle === null ? null : cycle_of(cycle);
      return value === null ? 0n : period_start(offset_ms, value, time);
    },
    get_next_reset: (cycle, time) => {
      const value = cycle === null ? null : cycle_of(cycle);
      return value === null ? 0n : next_reset(offset_ms, value, time);
    },
    get_period_number: (cycle, time) => period_number(offset_ms, required_cycle(cycle), time),
    get_window_start: (length_ms, time) => {
      if (length_ms < 1n) throw new RangeError(`get_window_start: length ${String(length_ms)} ms is below 1`);
      return window_start(length_ms, time);
    },
    schedule_job: (name, interval_ms, run) => {
      scheduler.schedule_job(name, interval_ms, run);
    },
    sleep: (ms) => scheduler.sleep(ms),
    network_time_limit,
    begin_start: () => {
      scheduler.begin_start();
    },
    complete_start: () => scheduler.complete_start(),
    end_start: () => {
      scheduler.end_start();
    },
    stop: () => {
      scheduler.stop();
    },
    use_clock: (clock) => {
      scheduler.set_clock(clock);
    },
    use_offset_provider: (provider) => {
      scheduler.check_registration('register_offset_provider');
      if (offset_provider !== null) scheduler.add_start_error('register_offset_provider: called twice');
      else offset_provider = provider;
    },
    wait_idle: () => scheduler.wait_idle(),
  };
}
