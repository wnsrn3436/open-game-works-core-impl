/**
 * The DB wait state (`watch_db_wait`) and the DB metrics (`read_db_metrics`) of a server instance (`### DB adapter`).
 */
import { Worker } from 'node:worker_threads';
import { create_server_time } from '../../server-time/index.ts';
import { hold_db, hold_lock_key } from '../../testing/dev/index.ts';
import { create_storage_with, type DbMetrics, type Storage } from '../index.ts';
import { lock_key } from '../tx.ts';
import { core_settings, DB_KIND, instance, lock_holder, new_db, new_user, request, stop_all, test_server, type DbTarget } from './helpers.ts';
import { BossGameState, TEST_CONTRACT } from './kinds.ts';

const observers: Worker[] = [];

afterEach(async () => {
  stop_all();
  for (const observer of observers.splice(0)) await observer.terminate();
});

const UPDATE = 'UPDATE test_counter SET n = n + 1 WHERE id = $1';

function tables(s: Storage): void {
  s.register_table('test_counter', 'game', [{ name: 'id', type: 'int64' }, { name: 'n', type: 'int64' }], ['id'], null, null);
}

function connection(db: DbTarget): string {
  return db.secrets.db ?? '';
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function counter_rows(storage: Storage): Promise<void> {
  await storage.run_game_transaction((tx) => {
    storage.db(tx).query('INSERT INTO test_counter (id, n) VALUES (1, 0), (2, 0)');
    return { inserted: true };
  });
}

/**
 * The DB wait state array of a server instance, with a thread that watches its element 0 while this thread waits in a
 * synchronous DB call: element 1 becomes 1 once it saw element 0 at 1. Element 2 ends the watch.
 */
function watched(): { array: Int32Array; saw_wait(): boolean; reset(): void } {
  const array = new Int32Array(new SharedArrayBuffer(12));
  const observer = new Worker(
    `const { workerData } = require('node:worker_threads');
     const a = new Int32Array(workerData);
     const sleep = new Int32Array(new SharedArrayBuffer(4));
     while (Atomics.load(a, 2) === 0) {
       if (Atomics.load(a, 0) === 1) Atomics.store(a, 1, 1);
       Atomics.wait(sleep, 0, 0, 1);
     }`,
    { eval: true, workerData: array.buffer },
  );
  observers.push(observer);
  const stop = (): void => {
    Atomics.store(array, 2, 1);
  };
  observer.once('exit', stop);
  return {
    array,
    saw_wait: () => Atomics.load(array, 1) === 1,
    reset: () => {
      Atomics.store(array, 1, 0);
    },
  };
}

/** A started instance whose storage got `array` with `watch_db_wait` before its start. */
async function watched_instance(array: Int32Array, settings: Readonly<Record<string, unknown>>): Promise<{ db: DbTarget; storage: Storage }> {
  return await instance({ settings, register: tables, watch: array });
}

function grew(before: DbMetrics, after: DbMetrics): { calls: number; wait_ms: number; locks: number; connections: number } {
  return {
    calls: after.sync_calls - before.sync_calls,
    wait_ms: after.sync_wait_ms - before.sync_wait_ms,
    locks: after.lock_failures - before.lock_failures,
    connections: after.connection_failures - before.connection_failures,
  };
}

describe('watch_db_wait', () => {
  it('throws after server start has begun, and takes an array before it', async () => {
    const db = await new_db();
    const time = create_server_time({ settings: { 'server-time.silentMarginMs': 5000, dailyResetOffsetMs: 0 }, modules: {} });
    const storage = create_storage_with({ settings: core_settings(), modules: { 'server-time': time }, server: test_server(db) }, TEST_CONTRACT);
    const array = new Int32Array(new SharedArrayBuffer(4));
    expect(() => {
      storage.watch_db_wait(array);
    }).not.toThrow();
    time.begin_start();
    storage.begin_start();
    try {
      expect(() => {
        storage.watch_db_wait(array);
      }).toThrow();
    } finally {
      storage.stop();
      time.stop();
    }
  });

  it('a synchronous DB call stores 1 in element 0 while it waits and 0 after it ends; read_db_metrics counts it and its wait', async () => {
    const watch = watched();
    const { storage } = await watched_instance(watch.array, {});
    await counter_rows(storage);
    const before = storage.read_db_metrics();
    watch.reset();
    let during = -1;
    let after = -1;
    let waited = 0;
    await storage.run_game_transaction((tx) => {
      const started = performance.now();
      storage.db(tx).query(UPDATE, [1n]);
      waited = performance.now() - started;
      after = Atomics.load(watch.array, 0);
      during = Number(watch.saw_wait());
      return { ran: true };
    });
    expect(after).toBe(0);
    expect(Atomics.load(watch.array, 0)).toBe(0);
    const growth = grew(before, storage.read_db_metrics());
    // The UPDATE (SQLite: also BEGIN IMMEDIATE and COMMIT).
    expect(growth.calls).toBeGreaterThanOrEqual(1);
    expect(growth.wait_ms).toBeGreaterThanOrEqual(waited - 2);
    expect(during === 1 || waited < 2).toBe(true);
  });

  it('read_db_metrics counts its own statement in the next call', async () => {
    const { storage } = await instance();
    const first = storage.read_db_metrics();
    const second = storage.read_db_metrics();
    const own = DB_KIND === 'postgresql' ? 1 : 0;
    expect(second.sync_calls - first.sync_calls).toBe(own);
  });
});

describe('read_db_metrics', () => {
  it('wal_archive_failing is false on SQLite and on a PostgreSQL whose pg_stat_archiver has no failure', async () => {
    const { storage } = await instance();
    if (DB_KIND === 'postgresql') {
      const row = storage.read_db().query('SELECT last_failed_time IS NULL AS no_failure FROM pg_stat_archiver')[0];
      expect(row?.['no_failure']).toBe(true);
    }
    expect(storage.read_db_metrics().wal_archive_failing).toBe(false);
  });

  it('starts from 0 failures and counts the synchronous DB calls of the schema step', async () => {
    const { storage } = await instance({ register: tables });
    const metrics = storage.read_db_metrics();
    expect(metrics.lock_failures).toBe(0);
    expect(metrics.connection_failures).toBe(0);
    expect(metrics.sync_calls).toBeGreaterThan(0);
    expect(metrics.sync_wait_ms).toBeGreaterThanOrEqual(0);
  });

  it.runIf(DB_KIND === 'sqlite')('on SQLite, a wait over storage.userLockWaitMs for the write transaction of another server instance on the same file raises lock_failures by 1', async () => {
    const lock_wait = 300;
    const { db, storage } = await instance({ settings: { 'storage.userLockWaitMs': lock_wait }, register: tables });
    const user = await new_user(storage);
    const holder = await lock_holder(db);
    await holder.ok('BEGIN IMMEDIATE');
    const before = storage.read_db_metrics();
    const result = await request(storage, user, () => 'ran');
    await holder.ok('ROLLBACK');
    expect(result).toBe('FAILED');
    expect(grew(before, storage.read_db_metrics()).locks).toBe(1);
    expect(grew(before, storage.read_db_metrics()).connections).toBe(0);
  });
});

describe.runIf(DB_KIND === 'postgresql')('PostgreSQL DB wait state and DB metrics', () => {
  it('element 0 is 1 while a query inside run_game_transaction waits for a row testing.hold_db holds and 0 after it; sync_wait_ms grows by at least that wait and sync_calls by at least 1', async () => {
    const lock_wait = 500;
    const watch = watched();
    const { db, storage } = await watched_instance(watch.array, { 'storage.userLockWaitMs': lock_wait });
    await counter_rows(storage);
    const holder = await hold_db(connection(db), [{ sql: 'SELECT n FROM test_counter WHERE id = 1 FOR UPDATE' }]);
    const before = storage.read_db_metrics();
    watch.reset();
    let saw = false;
    let after = -1;
    let waited = 0;
    const result = await storage.run_game_transaction((tx) => {
      const started = performance.now();
      try {
        storage.db(tx).query(UPDATE, [1n]);
      } catch {
        // The lock wait went over storage.userLockWaitMs.
      }
      waited = performance.now() - started;
      after = Atomics.load(watch.array, 0);
      saw = watch.saw_wait();
      return { ran: true };
    });
    await holder.release();
    expect(result).toBe('FAILED');
    expect(saw).toBe(true);
    expect(after).toBe(0);
    expect(waited).toBeGreaterThanOrEqual(lock_wait - 50);
    const growth = grew(before, storage.read_db_metrics());
    expect(growth.calls).toBeGreaterThanOrEqual(1);
    expect(growth.wait_ms).toBeGreaterThanOrEqual(waited - 2);
  });

  it('element 0 is 1 while put_game_state in a handler waits for a game_state row testing.hold_db holds, and stays 0 while the transaction start of a request waits for the user row testing.hold_db holds', async () => {
    const lock_wait = 500;
    const watch = watched();
    const { db, storage } = await watched_instance(watch.array, { 'storage.userLockWaitMs': lock_wait });
    const user = await new_user(storage);
    const boss = (hp: bigint): BossGameState => Object.assign(new BossGameState(), { key: 1n, hp });
    expect(await request(storage, user, (ctx) => (storage.put_game_state(ctx, boss(10n), 0n), 'put'))).toBe('put');
    const row_holder = await hold_db(connection(db), [{ sql: `SELECT "key" FROM game_state WHERE kind = 'boss_game_state' AND "key" = 1 FOR UPDATE` }]);
    watch.reset();
    let saw = false;
    const put = await request(storage, user, (ctx) => {
      try {
        storage.put_game_state(ctx, boss(20n), 0n);
      } catch {
        // The row lock wait went over storage.userLockWaitMs.
      }
      saw = watch.saw_wait();
      return 'ran';
    });
    await row_holder.release();
    expect(put).toBe('FAILED');
    expect(saw).toBe(true);
    expect(Atomics.load(watch.array, 0)).toBe(0);

    const user_holder = await hold_db(connection(db), [{ sql: 'SELECT user_id FROM "user" WHERE user_id = $1 FOR UPDATE', params: [user] }]);
    const before = storage.read_db_metrics();
    watch.reset();
    let ran = false;
    const states: number[] = [];
    const start = request(storage, user, () => {
      ran = true;
      return 'ran';
    });
    let ended = false;
    void start.finally(() => {
      ended = true;
    });
    while (!ended) {
      states.push(Atomics.load(watch.array, 0));
      await wait(10);
    }
    expect(await start).toBe('FAILED');
    await user_holder.release();
    expect(ran).toBe(false);
    expect(states.length).toBeGreaterThan(10);
    expect(states.every((s) => s === 0)).toBe(true);
    expect(watch.saw_wait()).toBe(false);
    const growth = grew(before, storage.read_db_metrics());
    // Only the pg_stat_archiver statement of the read_db_metrics call before.
    expect(growth.calls).toBe(1);
    expect(growth.locks).toBe(1);
  });

  it('a core module lock_game_row that is FAILED after storage.userLockWaitMs raises lock_failures by 1', async () => {
    const { db, storage } = await instance({ settings: { 'storage.userLockWaitMs': 300 }, register: tables });
    await counter_rows(storage);
    const key_holder = await hold_lock_key(connection(db), lock_key('test_counter', [1n]));
    const before = storage.read_db_metrics();
    let locked: unknown = null;
    const result = await storage.run_game_transaction((tx) => {
      locked = storage.lock_game_row(tx, 'test_counter', [1n]);
      return { ran: true };
    });
    await key_holder.release();
    expect(locked).toBe('FAILED');
    expect(result).toBe('FAILED');
    const growth = grew(before, storage.read_db_metrics());
    expect(growth.locks).toBe(1);
    expect(growth.connections).toBe(0);
  });

  it('a query inside run_game_transaction whose connection pg_terminate_backend ends raises connection_failures by 1', async () => {
    const { db, storage } = await instance({ settings: { 'storage.userLockWaitMs': 10_000 }, register: tables });
    await counter_rows(storage);
    const holder = await hold_db(connection(db), [{ sql: 'SELECT n FROM test_counter WHERE id = 1 FOR UPDATE' }]);
    // The terminate, in a session of another thread: this thread waits in the query.
    const ender = await lock_holder(db);
    const terminated = ender.run(
      `DO $$ BEGIN
         FOR i IN 1..2000 LOOP
           PERFORM pg_stat_clear_snapshot();
           EXIT WHEN EXISTS (SELECT 1 FROM pg_stat_activity WHERE ${String(holder.pid)} = ANY(pg_blocking_pids(pid)));
           PERFORM pg_sleep(0.01);
         END LOOP;
         PERFORM pg_terminate_backend(pid) FROM pg_stat_activity WHERE ${String(holder.pid)} = ANY(pg_blocking_pids(pid));
       END $$`,
    );
    const before = storage.read_db_metrics();
    const result = await storage.run_game_transaction((tx) => {
      try {
        storage.db(tx).query(UPDATE, [1n]);
      } catch {
        // PostgreSQL ended the connection.
      }
      return { ran: true };
    });
    expect(await terminated).toEqual({ ok: true, rows: [] });
    await holder.release();
    expect(result).toBe('FAILED');
    const growth = grew(before, storage.read_db_metrics());
    expect(growth.connections).toBe(1);
    expect(growth.locks).toBe(0);
  });

  it('a read_db query whose connection pg_terminate_backend ended while idle and that succeeds on its new connection does not raise connection_failures', async () => {
    const { db, storage } = await instance({ register: tables });
    await counter_rows(storage);
    const pid = Number(storage.read_db().query('SELECT pg_backend_pid() AS pid')[0]?.['pid']);
    const killer = await lock_holder(db);
    expect(await killer.ok(`SELECT pg_terminate_backend(${String(pid)}) AS ended`)).toEqual([{ ended: true }]);
    const before = storage.read_db_metrics();
    const rows = storage.read_db().query('SELECT pg_backend_pid() AS pid, n FROM test_counter WHERE id = 1');
    expect(rows[0]?.['n']).toBe(0n);
    expect(rows[0]?.['pid']).not.toBe(pid);
    expect(grew(before, storage.read_db_metrics()).connections).toBe(0);
  });
});
