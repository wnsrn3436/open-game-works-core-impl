/**
 * A first-come-first-served queue of waiters, each of which gives up when its time limit aborts. The SQLite write
 * lock and the PostgreSQL worker's connection pool both queue on it. A plain module, so the worker thread imports it.
 */
export class TimedQueue {
  private readonly waiters: (() => void)[] = [];

  /** The number of waiters in the queue. */
  get size(): number {
    return this.waiters.length;
  }

  /**
   * Resolves when `wake` reaches this waiter. When `time_limit` aborts first, the waiter leaves the queue and the
   * promise rejects with `timed_out()`; when it already aborted, it rejects at once without queueing.
   */
  wait(time_limit: AbortSignal, timed_out: () => Error): Promise<void> {
    if (time_limit.aborted) return Promise.reject(timed_out());
    return new Promise((resolve, reject) => {
      const waiter = (): void => {
        time_limit.removeEventListener('abort', on_abort);
        resolve();
      };
      const on_abort = (): void => {
        const at = this.waiters.indexOf(waiter);
        if (at >= 0) this.waiters.splice(at, 1);
        reject(timed_out());
      };
      this.waiters.push(waiter);
      time_limit.addEventListener('abort', on_abort, { once: true });
    });
  }

  /** Wakes the first waiter; false when none waits. */
  wake(): boolean {
    const next = this.waiters.shift();
    if (next === undefined) return false;
    next();
    return true;
  }

  /** Wakes every waiter, first come first. */
  wake_all(): void {
    for (const waiter of this.waiters.splice(0)) waiter();
  }
}
