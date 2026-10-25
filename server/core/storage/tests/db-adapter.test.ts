import { Worker } from 'node:worker_threads';
import { PostgresAdapter } from '../db/postgres.ts';
import { SqliteAdapter } from '../db/sqlite.ts';
import { DbError } from '../db/types.ts';
import type { Storage } from '../index.ts';
import { DB_KIND, instance, lock_holder, new_db, new_user, request, started, stop_all, type DbTarget } from './helpers.ts';
import { CRASH_SQL, STUCK_SQL } from './pg_fault_worker.ts';
import type { ProxyInput, ProxyRequest } from './pg_proxy.ts';

const proxies: Worker[] = [];

afterEach(async () => {
  stop_all();
  for (const proxy of proxies.splice(0)) await proxy.terminate();
});

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** The error a call throws, or null. */
function thrown(call: () => unknown): unknown {
  try {
    call();
    return null;
  } catch (error) {
    return error;
  }
}

/** A TCP proxy to the PostgreSQL of `target` that can stop answering, and the target through it. */
async function pg_proxy(target: DbTarget): Promise<{ db: DbTarget; freeze(): Promise<void>; thaw(): Promise<void> }> {
  const url = new URL(target.secrets.db ?? '');
  const input: ProxyInput = { host: url.hostname.replace(/^\[|\]$/g, ''), port: url.port === '' ? 5432 : Number(url.port) };
  const worker = new Worker(new URL('./pg_proxy.ts', import.meta.url), { workerData: input });
  proxies.push(worker);
  const replies: ((message: { op: string; port?: number }) => void)[] = [];
  worker.on('message', (message: { op: string; port?: number }) => replies.shift()?.(message));
  const next = (): Promise<{ op: string; port?: number }> => new Promise((resolve) => replies.push(resolve));
  const ready = await next();
  url.hostname = '127.0.0.1';
  url.port = String(ready.port);
  const send = async (op: ProxyRequest['op']): Promise<void> => {
    const answered = next();
    worker.postMessage({ op } satisfies ProxyRequest);
    await answered;
  };
  return { db: { ...target, secrets: { ...target.secrets, db: url.toString() } }, freeze: () => send('freeze'), thaw: () => send('thaw') };
}

const FAULT_WORKER = new URL('./pg_fault_worker.ts', import.meta.url);
// A connect under the load of a parallel test run takes over a second: the answer wait leaves room for it.
const FAULT_LIMITS = { max_connections: 2, read_wait_ms: 300, answer_wait_ms: 2000, keepalive_ms: 2000 };
/** `answer_bound_ms` of `FAULT_LIMITS` for `read_wait_ms`, plus one `answer_wait_ms`. */
const FAULT_BOUND_MS = 4 * (300 + 2000) + 2000;

/** A PostgreSQL adapter whose worker runs `pg_fault_worker.ts`. */
async function fault_adapter(): Promise<PostgresAdapter> {
  const target = await new_db('postgresql');
  const adapter = new PostgresAdapter(target.secrets.db ?? '', FAULT_LIMITS, FAULT_WORKER);
  adapter.open();
  return adapter;
}

/** The longest stretch in ms that the event loop did not run a 10 ms timer while `fn` ran, and its outcome. */
async function loop_stall(fn: () => unknown): Promise<{ stall: number; error: unknown }> {
  let last = performance.now();
  let stall = 0;
  const ticker = setInterval(() => {
    const now = performance.now();
    stall = Math.max(stall, now - last);
    last = now;
  }, 10);
  await wait(30);
  let error: unknown = null;
  try {
    await fn();
  } catch (caught) {
    error = caught;
  }
  await wait(30);
  clearInterval(ticker);
  return { stall, error };
}

/** The DbError kind of what a call throws, or null. */
function kind_of(error: unknown): string | null {
  return error instanceof DbError ? error.kind : null;
}

/** The result of `call` once it stops throwing, trying every 100 ms; throws its last error past `limit_ms`. */
async function until_ok<T>(call: () => T | Promise<T>, limit_ms: number): Promise<T> {
  const started = performance.now();
  for (;;) {
    try {
      return await call();
    } catch (error) {
      if (performance.now() - started > limit_ms) throw error;
    }
    await wait(100);
  }
}

function expiring_table(s: Storage): void {
  s.register_table('test_expiring', 'game', [{ name: 'id', type: 'int64' }, { name: 'at', type: 'int64' }], ['id'], 'at', null);
}

describe('DB adapter', () => {
  it('sweep_expired returns the number of rows it deleted', async () => {
    const { storage, clock } = await instance({ register: expiring_table });
    const now = clock.now();
    await storage.run_game_transaction((tx) => {
      const rows: [bigint, bigint][] = [
        [1n, now - 1n],
        [2n, now],
        [3n, now - 5n],
        [4n, now + 1n],
      ];
      for (const [id, at] of rows) {
        storage.db(tx).query('INSERT INTO test_expiring (id, at) VALUES ($1, $2)', [id, at]);
      }
      return { inserted: true };
    });
    expect(await storage.sweep_expired()).toBe(3);
    expect(storage.read_db().query('SELECT id FROM test_expiring')).toEqual([{ id: 4n }]);
    expect(await storage.sweep_expired()).toBe(0);
  });

  it.runIf(DB_KIND === 'postgresql')('PostgreSQL: after the server closes every connection (a restart), the read connection and new transactions connect again', async () => {
    const { db, storage } = await instance();
    const user = await new_user(storage);
    expect(storage.read_db().query('SELECT 1 AS one')).toEqual([{ one: 1 }]);
    const holder = await lock_holder(db);
    const [killed] = await holder.ok('SELECT count(pg_terminate_backend(pid)) AS n FROM pg_stat_activity WHERE datname = current_database() AND pid <> pg_backend_pid()');
    expect(Number(killed?.n)).toBeGreaterThanOrEqual(2);
    // The worker thread sees the closed sockets.
    await wait(300);
    expect(storage.read_db().query('SELECT 1 AS one')).toEqual([{ one: 1 }]);
    expect(await request(storage, user, () => 'ran')).toBe('ran');
    const next = await new_user(storage);
    expect(next).not.toBe(user);
    expect(storage.get_user_record(storage.read_db(), next)).not.toBeNull();
  });

  it.runIf(DB_KIND === 'postgresql')(
    'PostgreSQL: of storage.dbMaxConnections + 1 transactions of a user another transaction locks, the connections stay at dbMaxConnections and all are FAILED by the lock wait',
    async () => {
      const max = 2;
      const { db, storage } = await instance({ settings: { 'storage.dbMaxConnections': max, 'storage.userLockWaitMs': 1500 } });
      const user = await new_user(storage);
      const holder = await lock_holder(db);
      await holder.ok('BEGIN');
      await holder.ok('SELECT user_id FROM "user" WHERE user_id = $1 FOR UPDATE', [user]);
      const runs = Array.from({ length: max + 1 }, () => request(storage, user, () => 'ran'));
      await wait(500);
      const [during] = await holder.ok(
        "SELECT count(*) FILTER (WHERE wait_event_type = 'Lock') AS waiting, count(*) AS total FROM pg_stat_activity WHERE datname = current_database() AND pid <> pg_backend_pid()",
      );
      // The transaction connections and the read connection.
      expect([Number(during?.waiting), Number(during?.total)]).toEqual([max, max + 1]);
      expect(await Promise.all(runs)).toEqual(Array.from({ length: max + 1 }, () => 'FAILED'));
      await holder.ok('ROLLBACK');
      expect(await request(storage, user, () => 'ran')).toBe('ran');
      const [after] = await holder.ok('SELECT count(*) AS total FROM pg_stat_activity WHERE datname = current_database() AND pid <> pg_backend_pid()');
      expect(Number(after?.total)).toBeLessThanOrEqual(max + 1);
    },
  );

  it.runIf(DB_KIND === 'postgresql')('PostgreSQL: a transaction waiting for a free connection gets the one a commit frees', async () => {
    const { storage } = await instance({ settings: { 'storage.dbMaxConnections': 1, 'storage.userLockWaitMs': 3000 } });
    const a = await new_user(storage);
    const b = await new_user(storage);
    const runs = [storage.run_user_transaction(a, () => 'pass'), request(storage, b, () => 'ran'), request(storage, a, () => 'ran')];
    expect(await Promise.all(runs)).toEqual(['COMMITTED', 'ran', 'ran']);
  });

  it.runIf(DB_KIND === 'postgresql')(
    'PostgreSQL: a user transaction that waits for a free connection and then for its user lock is FAILED within one storage.userLockWaitMs',
    async () => {
      const lock_wait = 1500;
      const { db, storage } = await instance({ settings: { 'storage.dbMaxConnections': 1, 'storage.userLockWaitMs': lock_wait } });
      const a = await new_user(storage);
      const b = await new_user(storage);
      const holder_a = await lock_holder(db);
      const holder_b = await lock_holder(db);
      for (const [holder, user] of [
        [holder_a, a],
        [holder_b, b],
      ] as const) {
        await holder.ok('BEGIN');
        await holder.ok('SELECT user_id FROM "user" WHERE user_id = $1 FOR UPDATE', [user]);
      }
      // The transaction of a takes the only connection and waits for its user lock; the one of b waits for that connection.
      const first = request(storage, a, () => 'ran');
      await wait(50);
      const started = performance.now();
      const second = request(storage, b, () => 'ran').then((result) => ({ result, waited: performance.now() - started }));
      // The transaction of a commits halfway through the wait of b, which then takes the connection and waits for b's user lock.
      await wait(lock_wait / 2);
      await holder_a.ok('ROLLBACK');
      expect(await first).toBe('ran');
      const { result, waited } = await second;
      await holder_b.ok('ROLLBACK');
      expect(result).toBe('FAILED');
      expect(waited).toBeGreaterThanOrEqual(lock_wait - 50);
      expect(waited).toBeLessThan(lock_wait + lock_wait / 4);
      expect(await request(storage, b, () => 'ran')).toBe('ran');
    },
  );

  it.runIf(DB_KIND === 'postgresql')(
    'PostgreSQL: a sweep_expired statement that waits for a free connection and then for a row lock is FAILED within one storage.userLockWaitMs',
    async () => {
      const lock_wait = 1500;
      const { db, storage } = await instance({ settings: { 'storage.dbMaxConnections': 1, 'storage.userLockWaitMs': lock_wait } });
      const a = await new_user(storage);
      const holder_a = await lock_holder(db);
      const holder_row = await lock_holder(db);
      await holder_a.ok('BEGIN');
      await holder_a.ok('SELECT user_id FROM "user" WHERE user_id = $1 FOR UPDATE', [a]);
      // An expired row of game_state, the first table the sweep deletes from, locked by another session.
      await holder_row.ok("INSERT INTO game_state (kind, \"key\", value, contract_version, updated_at, expires_at) VALUES ('test', 1, decode('00', 'hex'), 1, 0, 1)");
      await holder_row.ok('BEGIN');
      await holder_row.ok("SELECT \"key\" FROM game_state WHERE kind = 'test' FOR UPDATE");
      // The transaction of a takes the only connection and waits for its user lock; the sweep waits for that connection.
      const first = request(storage, a, () => 'ran');
      await wait(50);
      const started = performance.now();
      const sweep = storage.sweep_expired().then((result) => ({ result, waited: performance.now() - started }));
      // The transaction of a commits halfway through the wait of the sweep, which then takes the connection and waits for the row lock.
      await wait(lock_wait / 2);
      await holder_a.ok('ROLLBACK');
      expect(await first).toBe('ran');
      const { result, waited } = await sweep;
      await holder_row.ok('ROLLBACK');
      expect(result).toBe('FAILED');
      expect(waited).toBeGreaterThanOrEqual(lock_wait - 50);
      expect(waited).toBeLessThan(lock_wait + lock_wait / 4);
      expect(await storage.sweep_expired()).toBe(1);
    },
  );

  it.runIf(DB_KIND === 'postgresql')(
    'PostgreSQL: after a wait for a free connection, a first statement with no lock wait that runs past what the wait left of storage.userLockWaitMs succeeds',
    async () => {
      const lock_wait = 1500;
      const target = await new_db('postgresql');
      const adapter = new PostgresAdapter(target.secrets.db ?? '', { max_connections: 1, read_wait_ms: 1000, answer_wait_ms: 10_000, keepalive_ms: 2000 });
      adapter.open();
      try {
        const holding = await adapter.begin({ lock_wait_ms: lock_wait, first: null });
        // It waits for the only connection; its first statement takes no lock and runs longer than the lock wait left.
        const second = adapter.begin({ lock_wait_ms: lock_wait, first: { sql: 'SELECT pg_sleep(1) IS NULL AS slept', params: [] } });
        await wait(lock_wait / 2);
        await holding.conn.commit();
        const begun = await second;
        expect(begun.rows).toEqual([{ slept: false }]);
        // The transaction's own lock wait is what the connection wait left: a held row lock still ends it within the limit.
        const holder = await lock_holder(target);
        await holder.ok('BEGIN');
        await holder.ok('SELECT pg_advisory_xact_lock(CAST($1 AS BIGINT)) AS locked', [91n]);
        const started_lock = performance.now();
        const error = thrown(() => {
          begun.conn.lock_key(91n);
        });
        await holder.ok('ROLLBACK');
        expect(kind_of(error)).toBe('lock');
        expect(performance.now() - started_lock).toBeLessThan(lock_wait - 300);
        await begun.conn.rollback();
      } finally {
        adapter.close();
      }
    },
  );

  it.runIf(DB_KIND === 'postgresql')('PostgreSQL: a COMMIT of a transaction PostgreSQL aborted fails and the next transaction works', async () => {
    const target = await new_db('postgresql');
    const adapter = new PostgresAdapter(target.secrets.db ?? '', { max_connections: 2, read_wait_ms: 1000, answer_wait_ms: 10_000, keepalive_ms: 2000 });
    adapter.open();
    try {
      const { conn } = await adapter.begin({ lock_wait_ms: 1000, first: null });
      expect(thrown(() => conn.query('SELECT 1 / 0 AS x'))).toBeInstanceOf(DbError);
      await expect(conn.commit()).rejects.toThrow(DbError);
      const next = await adapter.begin({ lock_wait_ms: 1000, first: null });
      expect(next.conn.query('SELECT 1 AS one')).toEqual([{ one: 1 }]);
      await next.conn.commit();
    } finally {
      adapter.close();
    }
  });

  it.runIf(DB_KIND === 'postgresql')(
    'PostgreSQL: with no answer (a network partition), a read is a connection DbError and a transaction FAILED within the limits; both work again after a background connect succeeds',
    async () => {
      const answer_wait = 2000;
      const proxy = await pg_proxy(await new_db('postgresql'));
      const { storage } = await instance({ db: proxy.db, settings: { 'storage.userLockWaitMs': 300, 'storage.dbAnswerWaitMs': answer_wait } });
      const user = await new_user(storage);
      await proxy.freeze();
      const started = performance.now();
      const error = thrown(() => storage.read_db().query('SELECT 1 AS one'));
      expect(kind_of(error)).toBe('connection');
      expect(performance.now() - started).toBeLessThan(300 + answer_wait + 1000);
      const failed_at = performance.now();
      expect(await request(storage, user, () => 'ran')).toBe('FAILED');
      // Fail fast: the transaction does not wait for PostgreSQL.
      expect(performance.now() - failed_at).toBeLessThan(500);
      await proxy.thaw();
      // The background connect that was waiting during the partition ends within one answer wait; the next succeeds.
      expect(await until_ok(() => storage.read_db().query('SELECT 1 AS one'), 2 * answer_wait + 2000)).toEqual([{ one: 1 }]);
      expect(await request(storage, user, () => 'ran')).toBe('ran');
    },
  );

  it.runIf(DB_KIND === 'postgresql')(
    'PostgreSQL: a statement of the server start schema lock transaction that answers past storage.dbAnswerWaitMs but within storage.schemaAnswerWaitMs lets server start succeed, and a request statement after it waits storage.dbAnswerWaitMs',
    async () => {
      const lock_wait = 300;
      const answer_wait = 1000;
      const slow_ms = 3000;
      const settings = {
        'storage.userLockWaitMs': lock_wait,
        'storage.schemaLockWaitMs': lock_wait,
        'storage.dbAnswerWaitMs': answer_wait,
        'storage.schemaAnswerWaitMs': 60_000,
      };
      const db = await new_db('postgresql');
      // The base tables first, so the slow statement of the next start is the index build alone.
      started({ db, settings }).stop();
      const holder = await lock_holder(db);
      // An index build that takes build time, not lock wait: every CREATE INDEX answers after slow_ms.
      await holder.ok(`CREATE FUNCTION test_slow_index() RETURNS event_trigger LANGUAGE plpgsql AS $$ BEGIN PERFORM pg_sleep(${String(slow_ms / 1000)}); END $$`);
      await holder.ok("CREATE EVENT TRIGGER test_slow_index ON ddl_command_end WHEN TAG IN ('CREATE INDEX') EXECUTE FUNCTION test_slow_index()");
      const start_at = performance.now();
      const { storage } = await instance({
        db,
        settings,
        register: (s) => {
          s.register_table('test_slow', 'game', [{ name: 'id', type: 'int64' }, { name: 'name', type: 'string' }], ['id'], null, null, null, [['name']]);
        },
      });
      // The index statement answered past its lock wait plus storage.dbAnswerWaitMs.
      expect(performance.now() - start_at).toBeGreaterThanOrEqual(slow_ms - 50);
      const indexes = storage.read_db().query('SELECT COUNT(*) AS n FROM pg_indexes WHERE tablename = $1 AND indexdef LIKE $2', ['test_slow', '%(name%']);
      expect(Number(indexes[0]?.n)).toBe(1);
      const user = await new_user(storage);
      const request_at = performance.now();
      expect(await request(storage, user, (ctx) => storage.db(ctx).query(`SELECT pg_sleep(${String(slow_ms / 1000)})`))).toBe('FAILED');
      const waited = performance.now() - request_at;
      expect(waited).toBeGreaterThanOrEqual(lock_wait + answer_wait - 50);
      expect(waited).toBeLessThan(slow_ms - 500);
    },
  );

  it.runIf(DB_KIND === 'postgresql')(
    'PostgreSQL: a read_db query that waits for a lock another connection holds is a lock DbError at storage.userLockWaitMs, and the next read and transaction work at once without a connection failure',
    async () => {
      const lock_wait = 300;
      const answer_wait = 2000;
      const { db, storage } = await instance({ settings: { 'storage.userLockWaitMs': lock_wait, 'storage.dbAnswerWaitMs': answer_wait } });
      const user = await new_user(storage);
      const holder = await lock_holder(db);
      await holder.ok('CREATE TABLE test_read_lock (id BIGINT)');
      await holder.ok('BEGIN');
      await holder.ok('LOCK TABLE test_read_lock IN ACCESS EXCLUSIVE MODE');
      const started = performance.now();
      const error = thrown(() => storage.read_db().query('SELECT id FROM test_read_lock'));
      const waited = performance.now() - started;
      expect(kind_of(error)).toBe('lock');
      expect(waited).toBeGreaterThanOrEqual(lock_wait - 50);
      // Well under the answer limit (lock wait plus answer wait), past which the connection closes and fails fast.
      expect(waited).toBeLessThan(lock_wait + answer_wait / 2);
      // While the lock is still held: no fail fast, so neither waits for a background connect.
      const next_at = performance.now();
      expect(storage.read_db().query('SELECT 1 AS one')).toEqual([{ one: 1 }]);
      expect(await request(storage, user, () => 'ran')).toBe('ran');
      expect(performance.now() - next_at).toBeLessThan(answer_wait / 2);
      await holder.ok('ROLLBACK');
      expect(storage.read_db().query('SELECT id FROM test_read_lock')).toEqual([]);
    },
  );

  it.runIf(DB_KIND === 'postgresql')(
    'PostgreSQL: after a statement went over its lock wait plus the answer wait, reads, transaction statements, begin and autocommit fail at once as connection failures, so the event loop stalls for one answer wait in all',
    async () => {
      const limits = { max_connections: 2, read_wait_ms: 300, answer_wait_ms: 2000, keepalive_ms: 2000 };
      const proxy = await pg_proxy(await new_db('postgresql'));
      const adapter = new PostgresAdapter(proxy.db.secrets.db ?? '', limits);
      adapter.open();
      try {
        const open = await adapter.begin({ lock_wait_ms: 300, first: null });
        expect(open.conn.query('SELECT 1 AS one')).toEqual([{ one: 1 }]);
        await proxy.freeze();
        const first = await loop_stall(() => adapter.read.query('SELECT 1 AS one'));
        expect(kind_of(first.error)).toBe('connection');
        expect(first.stall).toBeGreaterThanOrEqual(limits.read_wait_ms + limits.answer_wait_ms - 50);
        expect(first.stall).toBeLessThan(limits.read_wait_ms + limits.answer_wait_ms + 1000);
        const kinds: (string | null)[] = [];
        const later = await loop_stall(async () => {
          for (let i = 0; i < 5; i += 1) kinds.push(kind_of(thrown(() => adapter.read.query('SELECT 1 AS one'))));
          kinds.push(kind_of(thrown(() => open.conn.query('SELECT 1 AS one'))));
          kinds.push(kind_of(await adapter.begin({ lock_wait_ms: 300, first: null }).then(() => null, (e: unknown) => e)));
          kinds.push(kind_of(await adapter.autocommit({ sql: 'SELECT 1 AS one', params: [] }, 300).then(() => null, (e: unknown) => e)));
        });
        expect(later.error).toBeNull();
        expect(kinds).toEqual(Array.from({ length: 8 }, () => 'connection'));
        // No call after the first waited for an answer.
        expect(later.stall).toBeLessThan(500);
        await proxy.thaw();
        expect(await until_ok(() => adapter.read.query('SELECT 1 AS one'), 2 * limits.answer_wait_ms + 2000)).toEqual([{ one: 1 }]);
        const next = await adapter.begin({ lock_wait_ms: 300, first: null });
        expect(next.conn.query('SELECT 1 AS one')).toEqual([{ one: 1 }]);
        await next.conn.commit();
      } finally {
        adapter.close();
      }
    },
  );

  it.runIf(DB_KIND === 'postgresql')(
    'PostgreSQL: a worker that ends on an uncaught exception fails the blocking call at once and its open transactions as connection failures, and the next calls work on a new worker',
    async () => {
      const adapter = await fault_adapter();
      try {
        const open = await adapter.begin({ lock_wait_ms: 300, first: null });
        expect(open.conn.query('SELECT 1 AS one')).toEqual([{ one: 1 }]);
        const crash = await loop_stall(() => adapter.read.query(CRASH_SQL));
        expect(crash.error).toBeInstanceOf(DbError);
        expect((crash.error as DbError).kind).toBe('connection');
        // The thread's end stops the wait: no limit of the call passes first.
        expect(crash.stall).toBeLessThan(FAULT_LIMITS.answer_wait_ms);
        expect((thrown(() => open.conn.query('SELECT 1 AS one')) as DbError).kind).toBe('connection');
        expect(adapter.read.query('SELECT 1 AS one')).toEqual([{ one: 1 }]);
        const next = await adapter.begin({ lock_wait_ms: 300, first: null });
        expect(next.conn.query('SELECT 1 AS one')).toEqual([{ one: 1 }]);
        await next.conn.commit();
      } finally {
        adapter.close();
      }
    },
  );

  it.runIf(DB_KIND === 'postgresql')('PostgreSQL: a worker that ends during a promise call rejects it and the calls waiting with it as connection failures, and the next calls work', async () => {
    const adapter = await fault_adapter();
    try {
      const open = await adapter.begin({ lock_wait_ms: 300, first: null });
      const results = await Promise.allSettled([adapter.autocommit({ sql: CRASH_SQL, params: [] }, 300), open.conn.commit()]);
      for (const result of results) {
        expect(result.status).toBe('rejected');
        expect(((result as PromiseRejectedResult).reason as DbError).kind).toBe('connection');
      }
      expect(await adapter.autocommit({ sql: 'SELECT 1 AS one', params: [] }, 300)).toBe(1);
      expect(adapter.read.query('SELECT 1 AS one')).toEqual([{ one: 1 }]);
    } finally {
      adapter.close();
    }
  });

  it.runIf(DB_KIND === 'postgresql')(
    'PostgreSQL: a stop while the COMMIT of a request is in flight lets that COMMIT end: the committed request returns its result and its on_commit function is called',
    async () => {
      const settings = { 'storage.userLockWaitMs': 2000, 'storage.dbAnswerWaitMs': 5000 };
      const register = (s: Storage): void => {
        s.register_table('test_commit', 'game', [{ name: 'id', type: 'int64' }], ['id'], null, null);
      };
      const running = await instance({ settings, register });
      const { db, storage } = running;
      const holder = await lock_holder(db);
      // A COMMIT that takes a second: a deferred constraint trigger runs at COMMIT.
      await holder.ok('CREATE FUNCTION test_slow_commit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN PERFORM pg_sleep(1); RETURN NULL; END $$');
      await holder.ok('CREATE CONSTRAINT TRIGGER test_slow_commit AFTER INSERT ON test_commit DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION test_slow_commit()');
      const user = await new_user(storage);
      const calls: string[] = [];
      const result = request(storage, user, (ctx) => {
        storage.db(ctx).query('INSERT INTO test_commit (id) VALUES ($1)', [1n]);
        storage.on_commit(ctx, () => {
          calls.push('on_commit');
        });
        return 'committed';
      });
      const committing = "SELECT COUNT(*) AS n FROM pg_stat_activity WHERE datname = current_database() AND state = 'active' AND query = 'COMMIT'";
      await until_ok(async () => {
        const [row] = await holder.ok(committing);
        if (Number(row?.n) !== 1) throw new Error('the COMMIT is not in flight yet');
      }, 5000);
      running.stop();
      expect(await result).toBe('committed');
      expect(calls).toEqual(['on_commit']);
      expect((await holder.ok('SELECT id FROM test_commit')).map((row) => String(row.id))).toEqual(['1']);
    },
  );

  it.runIf(DB_KIND === 'postgresql')('PostgreSQL: a blocking call to a worker that stops answering ends as a connection failure after the answer bound, and the next call works on a new worker', async () => {
    const adapter = await fault_adapter();
    try {
      const stuck = await loop_stall(() => adapter.read.query(STUCK_SQL));
      expect((stuck.error as DbError).kind).toBe('connection');
      expect(stuck.stall).toBeGreaterThanOrEqual(FAULT_BOUND_MS - 50);
      expect(stuck.stall).toBeLessThan(FAULT_BOUND_MS + 2000);
      expect(adapter.read.query('SELECT 1 AS one')).toEqual([{ one: 1 }]);
    } finally {
      adapter.close();
    }
  });

  it.runIf(DB_KIND === 'postgresql')('PostgreSQL: a worker error that is not a PostgreSQL answer is a sql DbError, not a connection failure, and frees its connection', async () => {
    const target = await new_db('postgresql');
    const adapter = new PostgresAdapter(target.secrets.db ?? '', { ...FAULT_LIMITS, max_connections: 1 });
    adapter.open();
    try {
      // A lock wait limit that is not a number fails in the worker outside PostgreSQL.
      const error = await adapter.begin({ lock_wait_ms: Number.NaN, first: null }).then(
        () => null,
        (e: unknown) => e,
      );
      expect(error).toBeInstanceOf(DbError);
      expect((error as DbError).kind).toBe('sql');
      const next = await adapter.begin({ lock_wait_ms: 300, first: null });
      expect(next.conn.query('SELECT 1 AS one')).toEqual([{ one: 1 }]);
      await next.conn.commit();
    } finally {
      adapter.close();
    }
  });

  it.runIf(DB_KIND === 'sqlite')(
    'SQLite: a transaction that waits for the write transaction of its server instance over its lock wait is a lock DbError and leaves the queue; the next one gets it after the commit',
    async () => {
      const target = await new_db('sqlite');
      const adapter = new SqliteAdapter(target.db);
      adapter.open();
      try {
        const held = await adapter.begin({ lock_wait_ms: 300, first: null });
        const started = performance.now();
        const late = await adapter.begin({ lock_wait_ms: 200, first: null }).then(
          () => null,
          (e: unknown) => e,
        );
        expect(late).toBeInstanceOf(DbError);
        expect((late as DbError).kind).toBe('lock');
        expect(performance.now() - started).toBeGreaterThanOrEqual(150);
        const order: string[] = [];
        const first = adapter.begin({ lock_wait_ms: 5000, first: null }).then((b) => {
          order.push('first');
          return b;
        });
        const second = adapter.begin({ lock_wait_ms: 5000, first: null }).then((b) => {
          order.push('second');
          return b;
        });
        await wait(50);
        expect(order).toEqual([]);
        await held.conn.commit();
        const got = await first;
        expect(order).toEqual(['first']);
        await got.conn.commit();
        await (await second).conn.commit();
        expect(order).toEqual(['first', 'second']);
      } finally {
        adapter.close();
      }
    },
  );

  it.runIf(DB_KIND === 'sqlite')(
    "SQLite: while another server instance holds the write transaction, BEGIN IMMEDIATE waits without stopping the event loop: it begins after the other's commit, and past the lock wait it is a lock DbError",
    async () => {
      const target = await new_db('sqlite');
      const other = new SqliteAdapter(target.db);
      const adapter = new SqliteAdapter(target.db);
      other.open();
      adapter.open();
      try {
        const held = await other.begin({ lock_wait_ms: 300, first: null });
        let committed_at = 0;
        let begun_at = 0;
        const started = performance.now();
        // The commit runs on a timer: it runs only when the event loop runs during the wait.
        setTimeout(() => {
          void held.conn.commit();
          committed_at = performance.now() - started;
        }, 300);
        const waited = await loop_stall(async () => {
          const begun = await adapter.begin({ lock_wait_ms: 5000, first: null });
          begun_at = performance.now() - started;
          begun.conn.query('SELECT 1 AS one');
          await begun.conn.commit();
        });
        expect(waited.error).toBeNull();
        expect(waited.stall).toBeLessThan(200);
        expect(committed_at).toBeGreaterThanOrEqual(290);
        expect(begun_at).toBeGreaterThanOrEqual(committed_at);
        expect(begun_at).toBeLessThan(committed_at + 1000);

        const again = await other.begin({ lock_wait_ms: 300, first: null });
        const over = await loop_stall(() => adapter.begin({ lock_wait_ms: 300, first: null }));
        expect(kind_of(over.error)).toBe('lock');
        expect(over.stall).toBeLessThan(200);
        await again.conn.commit();
        const next = await adapter.begin({ lock_wait_ms: 300, first: null });
        await next.conn.commit();
      } finally {
        adapter.close();
        other.close();
      }
    },
  );
});
