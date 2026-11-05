/**
 * Statements that PostgreSQL aborts (a lock wait over its limit, a deadlock, the end of the connection), and other
 * failed statements, in the transactions of `storage` (`### transaction`, `### savepoint`, `### DB adapter`).
 */
import { hold_db, hold_lock_key, until_blocked_by } from '../../testing/dev/index.ts';
import { StorageMisuse, type DbHandle, type GameTx, type Storage } from '../index.ts';
import type { RequestCtx } from '../request_ctx.ts';
import { lock_key } from '../tx.ts';
import { DB_KIND, instance, lock_holder, new_user, PG_LOCK_SQL, raw_rows, request, stop_all, type DbTarget, type LockHolder } from './helpers.ts';
import type { HolderResult } from './lock_holder.ts';
import { BossGameState, quest, QuestUserState } from './kinds.ts';

afterEach(() => {
  stop_all();
});

const GAME_ERROR = 1001;
const UPDATE = 'UPDATE test_counter SET n = n + 1 WHERE id = $1';

function tables(s: Storage): void {
  s.register_table('test_counter', 'game', [{ name: 'id', type: 'int64' }, { name: 'n', type: 'int64' }], ['id'], null, null);
  s.register_table('test_text', 'game', [{ name: 'id', type: 'int64' }, { name: 'name', type: 'string' }], ['id'], null, null);
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** What a call throws, or null. */
function thrown(call: () => unknown): unknown {
  try {
    call();
    return null;
  } catch (error) {
    return error;
  }
}

/** What a promise resolves with, or what it rejects with. */
function settled(promise: Promise<unknown>): Promise<unknown> {
  return promise.then(
    (value) => value,
    (error: unknown) => error,
  );
}

/** What a promise rejects with, or null. */
function rejected(promise: Promise<unknown>): Promise<unknown> {
  return promise.then(
    () => null,
    (error: unknown) => error,
  );
}

function connection(db: DbTarget): string {
  return db.secrets.db ?? '';
}

/** Committed rows 1 and 2 of `test_counter` with n 0. */
async function counter_rows(storage: Storage): Promise<void> {
  await storage.run_game_transaction((tx) => {
    storage.db(tx).query('INSERT INTO test_counter (id, n) VALUES (1, 0), (2, 0)');
    return { inserted: true };
  });
}

function counters(storage: Storage): unknown[] {
  return storage.read_db().query('SELECT id, n FROM test_counter ORDER BY id');
}

/**
 * Puts the deadlock check of the other session later still. Only a superuser may set it; without it the session that
 * waited first still checks first.
 */
async function later_deadlock_check(holder: LockHolder): Promise<void> {
  await holder.run("SET deadlock_timeout = '30s'");
}

/**
 * Another session that holds the row lock of `test_counter` row 2. `meet(handle)` locks row 1 through `handle`, lets
 * that session ask for row 1, and asks for row 2: the statement that asks for row 2 meets a deadlock. This session
 * waits first, so its deadlock check runs first and PostgreSQL aborts it, not the other one.
 */
async function deadlock(db: DbTarget): Promise<{ meet(handle: DbHandle): void; end(): Promise<void> }> {
  const holder = await lock_holder(db);
  await later_deadlock_check(holder);
  await holder.ok('BEGIN');
  await holder.ok(UPDATE, [2n]);
  let asked: Promise<HolderResult> = Promise.resolve({ ok: true, rows: [] });
  return {
    meet: (handle) => {
      handle.query(UPDATE, [1n]);
      asked = holder.run(UPDATE, [1n], 300);
      handle.query(UPDATE, [2n]);
    },
    end: async () => {
      await asked;
      await holder.ok('ROLLBACK');
    },
  };
}

/** The backend pid of the read connection of `storage`. */
function read_pid(storage: Storage): number {
  return Number(storage.read_db().query('SELECT pg_backend_pid() AS pid')[0]?.['pid']);
}

/**
 * In a session of another thread, as this thread waits in its query: ends, one after another, `count` sessions that
 * wait for a lock that backend `holder` holds, each after it waits, then ends `holder`, which frees the lock.
 */
async function end_reads(db: DbTarget, holder: number, count: number): Promise<{ done: Promise<HolderResult> }> {
  const ender = await lock_holder(db);
  const done = ender.run(
    `DO $$
     DECLARE
       ended INT[] := '{}';
       waiter INT;
     BEGIN
       FOR n IN 1..${String(count)} LOOP
         waiter := NULL;
         FOR i IN 1..2000 LOOP
           PERFORM pg_stat_clear_snapshot();
           SELECT a.pid INTO waiter FROM pg_stat_activity a WHERE ${String(holder)} = ANY(pg_blocking_pids(a.pid)) AND a.pid <> ALL(ended) LIMIT 1;
           EXIT WHEN waiter IS NOT NULL;
           PERFORM pg_sleep(0.01);
         END LOOP;
         IF waiter IS NULL THEN RAISE EXCEPTION 'no session waited for backend ${String(holder)}'; END IF;
         PERFORM pg_terminate_backend(waiter);
         ended := ended || waiter;
       END LOOP;
       PERFORM pg_terminate_backend(${String(holder)});
     END $$`,
  );
  return { done };
}

describe.runIf(DB_KIND === 'postgresql')('PostgreSQL aborts', () => {
  it('a query that meets a deadlock: a run_game_transaction function that catches it and returns gets a throw from its next query, and is FAILED with no write', async () => {
    const { db, storage } = await instance({ settings: { 'storage.userLockWaitMs': 10_000 }, register: tables });
    await counter_rows(storage);
    const meeting = await deadlock(db);
    let first: unknown = null;
    let next: unknown = null;
    const result = await storage.run_game_transaction((tx) => {
      storage.db(tx).query('INSERT INTO test_text (id, name) VALUES (1, $1)', ['kept?']);
      first = thrown(() => {
        meeting.meet(storage.db(tx));
      });
      next = thrown(() => storage.db(tx).query('SELECT 1 AS one'));
      return { ended: true };
    });
    await meeting.end();
    expect((first as { code?: unknown } | null)?.code).toBe('40P01');
    expect(first).not.toBeInstanceOf(StorageMisuse);
    expect(next).toBeInstanceOf(Error);
    expect(next).not.toBeInstanceOf(StorageMisuse);
    expect(result).toBe('FAILED');
    expect(storage.read_db().query('SELECT id FROM test_text')).toEqual([]);
    expect(counters(storage)).toEqual([
      { id: 1n, n: 0n },
      { id: 2n, n: 0n },
    ]);
  });

  it('a query that meets a deadlock in run_user_transaction, run_rollback_transaction or run_request_transaction makes it FAILED without a throw, whether the function lets the throw out or catches it, and no write remains', async () => {
    const { db, storage } = await instance({ settings: { 'storage.userLockWaitMs': 10_000 }, register: tables });
    const user = await new_user(storage);
    await counter_rows(storage);
    const runs: { name: string; run: (fn: (ctx: RequestCtx) => void) => Promise<unknown> }[] = [
      {
        name: 'user',
        run: (fn) =>
          storage.run_user_transaction(user, (ctx) => {
            fn(ctx);
            return 'pass';
          }),
      },
      {
        name: 'rollback',
        run: (fn) =>
          storage.run_rollback_transaction(user, (ctx) => {
            fn(ctx);
            return 'read';
          }),
      },
      {
        name: 'request',
        run: (fn) =>
          request(storage, user, (ctx) => {
            fn(ctx);
            return 'done';
          }),
      },
    ];
    const results: string[] = [];
    for (const { name, run } of runs) {
      for (const catches of [false, true]) {
        const meeting = await deadlock(db);
        const result = await settled(
          run((ctx) => {
            storage.put_state(ctx, quest(1n, 1n));
            if (!catches) {
              meeting.meet(storage.db(ctx));
              return;
            }
            try {
              meeting.meet(storage.db(ctx));
            } catch {
              // The function goes on after the aborted statement.
            }
          }),
        );
        await meeting.end();
        results.push(`${name} ${catches ? 'catches' : 'lets out'}: ${String(result)}`);
      }
    }
    expect(results).toEqual(runs.flatMap(({ name }) => [`${name} lets out: FAILED`, `${name} catches: FAILED`]));
    expect(raw_rows(storage, 'user_state', user)).toEqual([]);
    expect(raw_rows(storage, 'pending_delta', user)).toEqual([]);
    expect(counters(storage)).toEqual([
      { id: 1n, n: 0n },
      { id: 2n, n: 0n },
    ]);
  });

  it('a statement in a run_savepoint function that meets a deadlock, caught by the function that then returns GameError or pass: run_savepoint throws, the request is FAILED, and no write remains, also of before the savepoint', async () => {
    const { db, storage } = await instance({ settings: { 'storage.userLockWaitMs': 10_000 }, register: tables });
    const user = await new_user(storage);
    await counter_rows(storage);
    for (const returned of [GAME_ERROR, 'pass'] as const) {
      const meeting = await deadlock(db);
      let savepoint: unknown = null;
      const result = await request(storage, user, (ctx) => {
        storage.put_state(ctx, quest(1n, 1n));
        savepoint = thrown(() =>
          storage.run_savepoint(ctx, () => {
            storage.put_state(ctx, quest(2n, 2n));
            try {
              meeting.meet(storage.db(ctx));
            } catch {
              // The function goes on after the aborted statement.
            }
            return returned;
          }),
        );
        return 'done';
      });
      await meeting.end();
      expect(savepoint).toBeInstanceOf(Error);
      expect(savepoint).not.toBeInstanceOf(StorageMisuse);
      expect(result).toBe('FAILED');
    }
    expect(raw_rows(storage, 'user_state', user)).toEqual([]);
    expect(counters(storage)).toEqual([
      { id: 1n, n: 0n },
      { id: 2n, n: 0n },
    ]);
  });

  it('a content lock_game_row that meets a deadlock, caught by the handler: get_state and put_state then throw a value that is not a StorageMisuse, the request is FAILED and no write remains', async () => {
    const { db, storage } = await instance({ settings: { 'storage.userLockWaitMs': 10_000 } });
    const user = await new_user(storage);
    const holder = await lock_holder(db);
    await later_deadlock_check(holder);
    await holder.ok('BEGIN');
    await holder.ok(PG_LOCK_SQL, [lock_key('game_state', ['boss_game_state', 2n])]);
    let asked: Promise<HolderResult> = Promise.resolve({ ok: true, rows: [] });
    const after: unknown[] = [];
    let lock_error: unknown = null;
    const result = await request(storage, user, (ctx) => {
      storage.put_state(ctx, quest(1n, 1n));
      storage.content.lock_game_row(ctx, 'game_state', [BossGameState, 1n]);
      asked = holder.run(PG_LOCK_SQL, [lock_key('game_state', ['boss_game_state', 1n])], 300);
      lock_error = thrown(() => {
        storage.content.lock_game_row(ctx, 'game_state', [BossGameState, 2n]);
      });
      after.push(thrown(() => storage.content.get_state(ctx, QuestUserState, 1n)));
      after.push(
        thrown(() => {
          storage.content.put_state(ctx, quest(3n, 3n));
        }),
      );
      return 'done';
    });
    await asked;
    await holder.ok('ROLLBACK');
    expect(lock_error).toBeInstanceOf(Error);
    expect(after).toHaveLength(2);
    for (const error of after) {
      expect(error).toBeInstanceOf(Error);
      expect(error).not.toBeInstanceOf(StorageMisuse);
    }
    expect(result).toBe('FAILED');
    expect(raw_rows(storage, 'user_state', user)).toEqual([]);
  });

  it('a query that waits past storage.userLockWaitMs for a row testing.hold_db holds throws, the next query throws, and run_game_transaction is FAILED with no write; the same after a core module lock_game_row that is FAILED on a key testing.hold_lock_key holds', async () => {
    const lock_wait = 500;
    const { db, storage } = await instance({ settings: { 'storage.userLockWaitMs': lock_wait }, register: tables });
    await counter_rows(storage);
    const holder = await hold_db(connection(db), [{ sql: 'SELECT n FROM test_counter WHERE id = 1 FOR UPDATE' }]);
    const errors: unknown[] = [];
    let waited = 0;
    const by_query = await storage.run_game_transaction((tx) => {
      storage.db(tx).query(UPDATE, [2n]);
      const started = performance.now();
      errors.push(thrown(() => storage.db(tx).query(UPDATE, [1n])));
      waited = performance.now() - started;
      errors.push(thrown(() => storage.db(tx).query('SELECT 1 AS one')));
      return { ended: true };
    });
    await holder.release();
    expect(errors.map((e) => e instanceof Error && !(e instanceof StorageMisuse))).toEqual([true, true]);
    expect(waited).toBeGreaterThanOrEqual(lock_wait - 50);
    expect(by_query).toBe('FAILED');
    const key_holder = await hold_lock_key(connection(db), lock_key('test_counter', [1n]));
    let locked: unknown = null;
    let query_error: unknown = null;
    const by_lock = await storage.run_game_transaction((tx) => {
      storage.db(tx).query(UPDATE, [2n]);
      locked = storage.lock_game_row(tx, 'test_counter', [1n]);
      query_error = thrown(() => storage.db(tx).query(UPDATE, [2n]));
      return { ended: true };
    });
    await key_holder.release();
    expect(locked).toBe('FAILED');
    expect(query_error).toBeInstanceOf(Error);
    expect(query_error).not.toBeInstanceOf(StorageMisuse);
    expect(by_lock).toBe('FAILED');
    expect(counters(storage)).toEqual([
      { id: 1n, n: 0n },
      { id: 2n, n: 0n },
    ]);
  });

  it('a game transaction whose two lock_game_row calls each wait 0.6 × storage.userLockWaitMs for a row another session holds and then releases commits', async () => {
    const lock_wait = 2000;
    const { db, storage } = await instance({ settings: { 'storage.userLockWaitMs': lock_wait }, register: tables });
    const holders: LockHolder[] = [await lock_holder(db), await lock_holder(db)];
    const released: Promise<HolderResult>[] = [];
    for (const [i, holder] of holders.entries()) {
      await holder.ok('BEGIN');
      await holder.ok(PG_LOCK_SQL, [lock_key('test_counter', [BigInt(i + 1)])]);
    }
    // Row 1 is released 0.6 × the limit after the first wait starts, row 2 0.6 × the limit after the second one starts.
    const started = performance.now();
    for (const [i, holder] of holders.entries()) released.push(holder.run('ROLLBACK', [], 0.6 * lock_wait * (i + 1)));
    const result = await storage.run_game_transaction((tx) => {
      for (const id of [1n, 2n]) {
        if (storage.lock_game_row(tx, 'test_counter', [id]) === 'FAILED') return { locked: false };
      }
      storage.db(tx).query('INSERT INTO test_counter (id, n) VALUES (3, 1)');
      return { locked: true };
    });
    const waited = performance.now() - started;
    await Promise.all(released);
    expect(result).toEqual({ locked: true });
    expect(waited).toBeGreaterThan(lock_wait);
    expect(counters(storage)).toEqual([{ id: 3n, n: 1n }]);
  });

  it('a query waiting for a row testing.hold_db holds, whose session another session ends with pg_terminate_backend, throws a value that is not a StorageMisuse, a later query throws, and run_game_transaction is FAILED whether the function lets the throw out or catches it', async () => {
    const { db, storage } = await instance({ settings: { 'storage.userLockWaitMs': 10_000 }, register: tables });
    await counter_rows(storage);
    const results: unknown[] = [];
    for (const catches of [false, true]) {
      const holder = await hold_db(connection(db), [{ sql: 'SELECT n FROM test_counter WHERE id = 1 FOR UPDATE' }]);
      // `testing.until_blocked_by` and the terminate, in a session of another thread: this thread waits in the query.
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
      const errors: unknown[] = [];
      const result = await settled(
        storage
          .run_game_transaction((tx) => {
            storage.db(tx).query(UPDATE, [2n]);
            if (!catches) return storage.db(tx).query(UPDATE, [1n]);
            errors.push(thrown(() => storage.db(tx).query(UPDATE, [1n])));
            errors.push(thrown(() => storage.db(tx).query('SELECT 1 AS one')));
            return { ended: true };
          }),
      );
      expect(await terminated).toEqual({ ok: true, rows: [] });
      await holder.release();
      if (catches) expect(errors.map((e) => e instanceof Error && !(e instanceof StorageMisuse))).toEqual([true, true]);
      results.push(result);
    }
    expect(results).toEqual(['FAILED', 'FAILED']);
    expect(counters(storage)).toEqual([
      { id: 1n, n: 0n },
      { id: 2n, n: 0n },
    ]);
    expect(await storage.run_game_transaction((tx) => storage.db(tx).query('SELECT n FROM test_counter WHERE id = 1'))).toEqual([{ n: 0n }]);
  });

  it('while testing.hold_db holds LOCK TABLE of a registered table, a read_db query of it throws after storage.userLockWaitMs; so does get_user_record with read_db while it holds LOCK TABLE "user"', async () => {
    const lock_wait = 500;
    const { db, storage } = await instance({ settings: { 'storage.userLockWaitMs': lock_wait }, register: tables });
    const user = await new_user(storage);
    for (const [table, read] of [
      ['test_counter', () => storage.read_db().query('SELECT id FROM test_counter')],
      ['"user"', () => storage.get_user_record(storage.read_db(), user)],
    ] as const) {
      const holder = await hold_db(connection(db), [{ sql: `LOCK TABLE ${table} IN ACCESS EXCLUSIVE MODE` }]);
      const started = performance.now();
      const error = thrown(read);
      const waited = performance.now() - started;
      await holder.release();
      expect(error).toBeInstanceOf(Error);
      expect(error).not.toBeInstanceOf(StorageMisuse);
      expect(waited).toBeGreaterThanOrEqual(lock_wait - 50);
    }
    expect(storage.get_user_record(storage.read_db(), user)).not.toBeNull();
  });

  it('after a testing.hold_db ends every other session of the database while the server runs no statement, a read_db query succeeds and a run_game_transaction whose function runs a query commits', async () => {
    const { db, storage } = await instance({ register: tables });
    await counter_rows(storage);
    expect(storage.read_db().query('SELECT 1 AS one')).toEqual([{ one: 1 }]);
    const holder = await hold_db(connection(db), [
      { sql: 'SELECT count(pg_terminate_backend(pid)) AS n FROM pg_stat_activity WHERE datname = current_database() AND pid <> pg_backend_pid()' },
    ]);
    await holder.release();
    expect(storage.read_db().query('SELECT n FROM test_counter WHERE id = 1')).toEqual([{ n: 0n }]);
    const result = await storage.run_game_transaction((tx) => {
      storage.db(tx).query(UPDATE, [1n]);
      return { updated: true };
    });
    expect(result).toEqual({ updated: true });
    expect(counters(storage)).toEqual([
      { id: 1n, n: 1n },
      { id: 2n, n: 0n },
    ]);
  });

  it('a read_db query waiting for a table that testing.hold_db holds, whose read session another session ends with pg_terminate_backend, runs once more on a new connection and returns its rows', async () => {
    const { db, storage } = await instance({ settings: { 'storage.userLockWaitMs': 10_000 }, register: tables });
    await counter_rows(storage);
    const before = read_pid(storage);
    const holder = await hold_db(connection(db), [{ sql: 'LOCK TABLE test_counter IN ACCESS EXCLUSIVE MODE' }]);
    const ended = await end_reads(db, holder.pid, 1);
    const rows = storage.read_db().query('SELECT pg_backend_pid() AS pid, n FROM test_counter WHERE id = 1');
    expect(await ended.done).toEqual({ ok: true, rows: [] });
    // The holder's session was ended too, so its ROLLBACK fails.
    await settled(holder.release());
    expect(rows).toHaveLength(1);
    expect(rows[0]?.['n']).toBe(0n);
    expect(rows[0]?.['pid']).not.toBe(before);
    expect(read_pid(storage)).toBe(rows[0]?.['pid']);
  });

  it('a read_db query whose run once more on a new connection is also ended throws a value that is not a StorageMisuse, and the next read_db query succeeds', async () => {
    const { db, storage } = await instance({ settings: { 'storage.userLockWaitMs': 10_000 }, register: tables });
    await counter_rows(storage);
    const before = read_pid(storage);
    const holder = await hold_db(connection(db), [{ sql: 'LOCK TABLE test_counter IN ACCESS EXCLUSIVE MODE' }]);
    const ended = await end_reads(db, holder.pid, 2);
    const error = thrown(() => storage.read_db().query('SELECT n FROM test_counter WHERE id = 1'));
    expect(await ended.done).toEqual({ ok: true, rows: [] });
    await settled(holder.release());
    expect(error).toBeInstanceOf(Error);
    expect(error).not.toBeInstanceOf(StorageMisuse);
    expect(read_pid(storage)).not.toBe(before);
    expect(storage.read_db().query('SELECT n FROM test_counter WHERE id = 1')).toEqual([{ n: 0n }]);
  });

  it('a read_db query on a read connection opened for it, because the one before was ended, throws when PostgreSQL ends that new connection while the query waits for a table that testing.hold_db holds', async () => {
    const { db, storage } = await instance({ settings: { 'storage.userLockWaitMs': 10_000 }, register: tables });
    await counter_rows(storage);
    const before = read_pid(storage);
    const killer = await lock_holder(db);
    expect(await killer.ok(`SELECT pg_terminate_backend(${String(before)}) AS ended`)).toEqual([{ ended: true }]);
    // The worker thread sees the closed socket, so the next read opens a new connection.
    await wait(300);
    const holder = await hold_db(connection(db), [{ sql: 'LOCK TABLE test_counter IN ACCESS EXCLUSIVE MODE' }]);
    const ended = await end_reads(db, holder.pid, 1);
    const error = thrown(() => storage.read_db().query('SELECT n FROM test_counter WHERE id = 1'));
    expect(await ended.done).toEqual({ ok: true, rows: [] });
    await settled(holder.release());
    expect(error).toBeInstanceOf(Error);
    expect(error).not.toBeInstanceOf(StorageMisuse);
    expect(storage.read_db().query('SELECT n FROM test_counter WHERE id = 1')).toEqual([{ n: 0n }]);
  });

  it('with storage.dbAnswerWaitMs 0.1 × storage.userLockWaitMs, a sweep_expired delete that waits 0.6 × storage.userLockWaitMs for each of two expired rows that two testing.hold_db hold puts that table in the failed table list with 57014', async () => {
    const lock_wait = 5000;
    const { db, storage } = await instance({ settings: { 'storage.userLockWaitMs': lock_wait, 'storage.dbAnswerWaitMs': lock_wait / 10 } });
    await storage.run_game_transaction((tx) => {
      for (const key of [1n, 2n]) {
        storage.db(tx).query(`INSERT INTO game_state (kind, "key", value, contract_version, updated_at, expires_at) VALUES ('test', $1, $2, 1, 0, 1)`, [key, Uint8Array.from([0])]);
      }
      return { inserted: true };
    });
    const holders = await Promise.all(
      [1n, 2n].map((key) => hold_db(connection(db), [{ sql: `SELECT "key" FROM game_state WHERE kind = 'test' AND "key" = $1 FOR UPDATE`, params: [key] }])),
    );
    // Each holder ends 0.6 × the limit after the delete starts to wait for it.
    const ended = holders.map(async (holder) => {
      await until_blocked_by(connection(db), holder.pid);
      await wait(0.6 * lock_wait);
      await holder.release();
    });
    const result = await storage.sweep_expired();
    await Promise.all(ended);
    expect(result).toEqual({ deleted: 0, failed: [{ table: 'game_state', code: '57014' }] });
    expect((await storage.sweep_expired()).deleted).toBe(2);
  });

  it('with storage.userLockWaitMs 0, a transaction that waits for nothing commits', async () => {
    const { storage } = await instance({ settings: { 'storage.userLockWaitMs': 0 }, register: tables });
    const user = await new_user(storage);
    expect(await request(storage, user, (ctx) => (storage.put_state(ctx, quest(1n, 1n)), 'done'))).toBe('done');
    expect(await storage.run_game_transaction((tx) => storage.db(tx).query('SELECT 1 AS one'))).toEqual([{ one: 1 }]);
  });
});

describe('a string parameter that holds U+0000', () => {
  it('fails the query in both DBs with a value that is not a StorageMisuse: run_game_transaction throws it when the function lets it out, and is FAILED when the function catches it and returns; no write remains; a read_db query with one throws', async () => {
    const { storage } = await instance({ register: tables });
    const insert = 'INSERT INTO test_text (id, name) VALUES ($1, $2)';
    let inner: unknown = null;
    const let_out = await rejected(
      storage.run_game_transaction((tx: GameTx) => {
        storage.db(tx).query(insert, [1n, 'kept?']);
        try {
          storage.db(tx).query(insert, [2n, 'a\u0000b']);
        } catch (error) {
          inner = error;
          throw error;
        }
        return { inserted: true };
      }),
    );
    expect(inner).toBeInstanceOf(Error);
    expect(inner).not.toBeInstanceOf(StorageMisuse);
    expect(let_out).toBe(inner);
    let later: unknown = null;
    const caught = await storage.run_game_transaction((tx: GameTx) => {
      storage.db(tx).query(insert, [3n, 'kept?']);
      thrown(() => storage.db(tx).query(insert, [4n, 'a\u0000b']));
      later = thrown(() => storage.db(tx).query('SELECT 1 AS one'));
      return { inserted: true };
    });
    expect(later).toBeInstanceOf(Error);
    expect(caught).toBe('FAILED');
    expect(storage.read_db().query('SELECT id FROM test_text')).toEqual([]);
    const read_error = thrown(() => storage.read_db().query('SELECT id FROM test_text WHERE name = $1', ['a\u0000b']));
    expect(read_error).toBeInstanceOf(Error);
    expect(read_error).not.toBeInstanceOf(StorageMisuse);
  });
});
