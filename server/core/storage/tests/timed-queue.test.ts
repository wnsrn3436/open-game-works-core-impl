import { TimedQueue } from '../db/timed_queue.ts';

/** The order in which `promises` settle, by index, with `ok` or the rejection message. */
async function settle_order(promises: readonly Promise<void>[], act: () => void): Promise<string[]> {
  const order: string[] = [];
  const tracked = promises.map((p, i) =>
    p.then(
      () => order.push(`${String(i)} ok`),
      (error: unknown) => order.push(`${String(i)} ${(error as Error).message}`),
    ),
  );
  act();
  await Promise.all(tracked);
  return order;
}

describe('timed queue (the SQLite write lock and the PostgreSQL connection pool wait on it)', () => {
  it('wakes waiters first come first, one per wake, and wake is false on an empty queue', async () => {
    const queue = new TimedQueue();
    const never = new AbortController().signal;
    const waits = [0, 1, 2].map(() => queue.wait(never, () => new Error('timed out')));
    expect(queue.size).toBe(3);
    const order = await settle_order(waits, () => {
      expect(queue.wake()).toBe(true);
      expect(queue.wake()).toBe(true);
      expect(queue.wake()).toBe(true);
    });
    expect(order).toEqual(['0 ok', '1 ok', '2 ok']);
    expect(queue.wake()).toBe(false);
  });

  it('a waiter whose time limit aborts leaves the queue and rejects with its error; the next wake goes past it', async () => {
    const queue = new TimedQueue();
    const never = new AbortController().signal;
    const limit = new AbortController();
    const first = queue.wait(never, () => new Error('first timed out'));
    const second = queue.wait(limit.signal, () => new Error('second timed out'));
    const third = queue.wait(never, () => new Error('third timed out'));
    const order = await settle_order([first, second, third], () => {
      limit.abort();
      expect(queue.size).toBe(2);
      queue.wake();
      queue.wake();
    });
    expect(order).toEqual(['1 second timed out', '0 ok', '2 ok']);
    expect(queue.wake()).toBe(false);
  });

  it('a woken waiter does not reject when its time limit aborts later', async () => {
    const queue = new TimedQueue();
    const limit = new AbortController();
    const waiting = queue.wait(limit.signal, () => new Error('timed out'));
    queue.wake();
    limit.abort();
    await expect(waiting).resolves.toBeUndefined();
  });

  it('a time limit that already aborted rejects at once without queueing', async () => {
    const queue = new TimedQueue();
    const waiting = queue.wait(AbortSignal.abort(), () => new Error('no wait left'));
    expect(queue.size).toBe(0);
    await expect(waiting).rejects.toThrow('no wait left');
  });

  it('wake_all wakes every waiter first come first', async () => {
    const queue = new TimedQueue();
    const never = new AbortController().signal;
    const waits = [0, 1].map(() => queue.wait(never, () => new Error('timed out')));
    const order = await settle_order(waits, () => {
      queue.wake_all();
    });
    expect(order).toEqual(['0 ok', '1 ok']);
    expect(queue.size).toBe(0);
  });
});
