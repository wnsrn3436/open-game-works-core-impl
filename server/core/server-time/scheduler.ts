import { AsyncLocalStorage } from 'node:async_hooks';
import type { ClockAdapter } from './clock.ts';

/** The longest delay one timer takes; a later wake time arms the timer again when it fires. */
const MAX_TIMER_MS = 2_147_483_647n;

/** A job function: no input, may wait, logs its own failure. */
export type JobFunction = () => unknown;

interface Job {
  readonly name: string;
  readonly interval_ms: bigint;
  readonly run: JobFunction;
  /** Clock time the last run started at. */
  last_start: bigint;
  running: boolean;
  /** Counts the runs; a `sleep` belongs to the run it was called in. */
  run_count: number;
  /** How many `sleep`s the current run waits in now. */
  sleeping: number;
}

interface Sleeper {
  readonly until: bigint;
  /** Call order: sleepers with the same `until` end in the order they were called. */
  readonly seq: number;
  readonly job: Job | undefined;
  readonly run_count: number;
  readonly resolve: () => void;
}

function earlier(a: Sleeper, b: Sleeper): boolean {
  return a.until < b.until || (a.until === b.until && a.seq < b.seq);
}

/** The waiting `sleep`s as a binary min-heap by end time, so the earliest one is read without a scan. */
class SleeperHeap {
  readonly #items: Sleeper[] = [];

  peek(): Sleeper | undefined {
    return this.#items[0];
  }

  push(sleeper: Sleeper): void {
    const items = this.#items;
    items.push(sleeper);
    let i = items.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (!earlier(sleeper, items[parent] as Sleeper)) break;
      items[i] = items[parent] as Sleeper;
      i = parent;
    }
    items[i] = sleeper;
  }

  pop(): Sleeper | undefined {
    const items = this.#items;
    const top = items[0];
    const last = items.pop();
    if (top === undefined || last === undefined || items.length === 0) return top;
    let i = 0;
    for (;;) {
      const left = 2 * i + 1;
      if (left >= items.length) break;
      const right = left + 1;
      const child = right < items.length && earlier(items[right] as Sleeper, items[left] as Sleeper) ? right : left;
      if (!earlier(items[child] as Sleeper, last)) break;
      items[i] = items[child] as Sleeper;
      i = child;
    }
    items[i] = last;
    return top;
  }

  clear(): void {
    this.#items.length = 0;
  }
}

/**
 * `created` → `starting` (server start) → `completed` (`complete_start`: registration closed) → `started` (server start
 * ended: jobs run) → `stopped`.
 */
type SchedulerState = 'created' | 'starting' | 'completed' | 'started' | 'stopped';

/**
 * The scheduler of one server instance (`server-time` `### scheduler`): `schedule_job` and `sleep` on the clock
 * adapter's time. With a real time clock it wakes by timers; with the test clock only when the clock changes.
 */
export class Scheduler {
  #state: SchedulerState = 'created';
  #clock: ClockAdapter;
  #unsubscribe: (() => void) | null = null;
  #timer: NodeJS.Timeout | null = null;
  readonly #jobs = new Map<string, Job>();
  readonly #sleepers = new SleeperHeap();
  #sleep_seq = 0;
  readonly #idle_waiters = new Set<() => void>();
  readonly #start_errors: string[] = [];
  readonly #current_job = new AsyncLocalStorage<Job>();

  constructor(clock: ClockAdapter) {
    this.#clock = clock;
  }

  /** The clock adapter's time now. */
  now(): bigint {
    return this.#clock.now();
  }

  /** Replaces the clock adapter. Only before server start; throws after. */
  set_clock(clock: ClockAdapter): void {
    if (this.#state !== 'created') throw new Error('set_clock: server start has begun');
    this.#clock = clock;
  }

  /** Server start begins: `set_clock` closes and the scheduler follows the clock. */
  begin_start(): void {
    if (this.#state !== 'created') return;
    this.#state = 'starting';
    this.#unsubscribe = this.#clock.subscribe(() => {
      this.#tick();
    });
  }

  /** Records a registration error; server start then fails. */
  add_start_error(reason: string): void {
    this.#start_errors.push(reason);
  }

  /** Throws when server start has ended: a registration after `complete_start()` throws. */
  check_registration(operation: string): void {
    if (this.#state !== 'created' && this.#state !== 'starting') throw new Error(`${operation}: server start has ended`);
  }

  /**
   * Registration ends: null, or the registration errors (server start fails). No job runs yet: the other modules'
   * `complete_start()` comes after this one. Throws when it was called already.
   */
  complete_start(): string | null {
    if (this.#state === 'created') this.begin_start();
    if (this.#state !== 'starting') throw new Error('complete_start: server start has already ended');
    if (this.#start_errors.length > 0) return this.#start_errors.join('; ');
    this.#state = 'completed';
    return null;
  }

  /**
   * Server start ends, after every module's `complete_start()` succeeded: every job runs once. Throws unless
   * `complete_start()` succeeded and server start has not ended yet.
   */
  end_start(): void {
    if (this.#state !== 'completed') throw new Error(`end_start: the scheduler is ${this.#state}, not completed`);
    this.#state = 'started';
    for (const job of this.#jobs.values()) this.#run(job);
    this.#arm();
  }

  /** `schedule_job`. A registration error is recorded for server start; throws after server start. */
  schedule_job(name: string, interval_ms: bigint, run: JobFunction): void {
    this.check_registration(`schedule_job ${name}`);
    if (this.#jobs.has(name)) this.add_start_error(`schedule_job: job ${name} is scheduled twice`);
    else if (interval_ms < 1n) this.add_start_error(`schedule_job: job ${name} interval ${String(interval_ms)} ms is below 1`);
    else this.#jobs.set(name, { name, interval_ms, run, last_start: 0n, running: false, run_count: 0, sleeping: 0 });
  }

  /** `sleep`: ends when the clock time is at least the call's clock time + `ms`. */
  sleep(ms: bigint): Promise<void> {
    if (this.#state === 'stopped') return new Promise(() => undefined);
    if (ms <= 0n) return Promise.resolve();
    const until = this.#clock.now() + ms;
    const job = this.#current_job.getStore();
    return new Promise((resolve) => {
      if (job) job.sleeping += 1;
      this.#sleep_seq += 1;
      this.#sleepers.push({ until, seq: this.#sleep_seq, job, run_count: job?.run_count ?? 0, resolve });
      this.#arm();
      this.#check_idle();
    });
  }

  /** `wait_idle`: ends when no job runs, or every running job sleeps until a time the clock has not reached. */
  wait_idle(): Promise<void> {
    if (this.#is_idle()) return Promise.resolve();
    return new Promise((resolve) => this.#idle_waiters.add(resolve));
  }

  /** The server instance stops: running jobs and waiting `sleep`s are dropped unfinished. */
  stop(): void {
    this.#state = 'stopped';
    this.#unsubscribe?.();
    this.#unsubscribe = null;
    if (this.#timer !== null) clearTimeout(this.#timer);
    this.#timer = null;
    this.#sleepers.clear();
    for (const resolve of this.#idle_waiters) resolve();
    this.#idle_waiters.clear();
  }

  #tick(): void {
    if (this.#state === 'stopped') return;
    const now = this.#clock.now();
    for (let sleeper = this.#sleepers.peek(); sleeper !== undefined && now >= sleeper.until; sleeper = this.#sleepers.peek()) {
      this.#sleepers.pop();
      if (sleeper.job?.run_count === sleeper.run_count) sleeper.job.sleeping -= 1;
      sleeper.resolve();
    }
    if (this.#state === 'started') {
      for (const job of this.#jobs.values()) if (!job.running && this.#due(job, now)) this.#run(job);
    }
    this.#arm();
    this.#check_idle();
  }

  #due(job: Job, now: bigint): boolean {
    return job.last_start + job.interval_ms <= now;
  }

  #run(job: Job): void {
    job.running = true;
    job.run_count += 1;
    job.sleeping = 0;
    job.last_start = this.#clock.now();
    const done = this.#current_job.run(job, () => new Promise<unknown>((resolve) => {
      resolve(job.run());
    }));
    // A job logs its own failure; a throw ends the run without a log.
    void done.catch(() => undefined).then(() => {
      job.running = false;
      if (this.#state !== 'started') return;
      if (this.#due(job, this.#clock.now())) this.#run(job);
      this.#arm();
      this.#check_idle();
    });
  }

  /** With a real time clock, sets one timer for the earliest wake time (a due job or a `sleep` end). */
  #arm(): void {
    if (this.#timer !== null) clearTimeout(this.#timer);
    this.#timer = null;
    if (!this.#clock.real_time || this.#state === 'stopped') return;
    let wake: bigint | null = this.#sleepers.peek()?.until ?? null;
    if (this.#state === 'started') {
      for (const job of this.#jobs.values()) {
        const at = job.last_start + job.interval_ms;
        if (!job.running && (wake === null || at < wake)) wake = at;
      }
    }
    if (wake === null) return;
    const delay = wake - this.#clock.now();
    const ms = delay < 0n ? 0n : delay > MAX_TIMER_MS ? MAX_TIMER_MS : delay;
    this.#timer = setTimeout(() => {
      this.#timer = null;
      this.#tick();
    }, Number(ms));
    this.#timer.unref();
  }

  #is_idle(): boolean {
    for (const job of this.#jobs.values()) if (job.running && job.sleeping === 0) return false;
    return true;
  }

  #check_idle(): void {
    if (this.#idle_waiters.size === 0 || !this.#is_idle()) return;
    const waiters = [...this.#idle_waiters];
    this.#idle_waiters.clear();
    for (const resolve of waiters) resolve();
  }
}
