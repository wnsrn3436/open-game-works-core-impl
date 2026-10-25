import { AsyncLocalStorage } from 'node:async_hooks';
import type { ServerTime } from '../../server-time/index.ts';
import { quest, QuestUserState } from '../../storage/tests/kinds.ts';
import type { DbHandle, GameTx, Storage } from '../../storage/index.ts';
import type { Converter } from '../index.ts';
import { CURRENT, default_converters } from './contract.ts';
import {
  admin,
  batch_row,
  DB_KIND,
  lock_holder,
  log_field,
  new_db,
  new_user,
  next_step,
  row,
  seed,
  server,
  SETTINGS,
  sqlite_lock,
  START_AT,
  stop_all,
  TestClock,
  wait_background,
  type LogLine,
  type ModuleInput,
  type Server,
} from './helpers.ts';

afterEach(() => {
  stop_all();
});

const Q = 'quest_user_state';
/** The quest item ID whose from 2 conversion throws. */
const BROKEN = 13n;

/** Quest converters that throw for `BROKEN` and call `hook` with the item ID before converting from 1. */
function converters(hook: (item_id: bigint) => void = () => undefined): Record<string, Converter> {
  const defaults = default_converters();
  const from_1 = defaults['QuestUserState:1'] as Converter;
  const from_2 = defaults['QuestUserState:2'] as Converter;
  return {
    'QuestUserState:1': (item, data) => {
      hook((item as QuestUserState).id);
      return from_1(item, data);
    },
    'QuestUserState:2': (item, data) => {
      if ((item as QuestUserState).id === BROKEN) throw new Error('converter bug');
      return from_2(item, data);
    },
  };
}

/**
 * New users in user ID order, the order a batch steps through them, that each have one version 1 quest item:
 * `100 + n` for the n-th user, or `BROKEN` where asked.
 */
async function old_users(s: Server, count: number, broken: readonly number[] = []): Promise<bigint[]> {
  const users: bigint[] = [];
  for (let n = 1; n <= count; n += 1) users.push(await new_user(s));
  // User IDs are random, so the n-th user made is not the n-th in user ID order.
  users.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  for (const [i, user] of users.entries()) {
    const id = broken.includes(i + 1) ? BROKEN : BigInt(101 + i);
    await seed(s, user, [row('user_state', Q, id, 1n, quest(id, 1n))]);
  }
  return users;
}

/** True when every `user_state` and `server_state` row of the user is at the current contract version. */
function at_target(s: Server, user: bigint): boolean {
  const versions = ['user_state', 'server_state'].flatMap((t) => s.storage.read_db().query(`SELECT contract_version FROM ${t} WHERE user_id = $1`, [user]));
  return versions.every((r) => r['contract_version'] === CURRENT);
}

function failed_users(s: Server): unknown {
  return JSON.parse(String(batch_row(s)?.['failed_users']));
}

async function start_batch(s: Server): Promise<string> {
  const started = await admin(s, 'start_migration_batch');
  if (typeof started === 'string') throw new Error(`start_migration_batch: ${started}`);
  return String(started['batch_id']);
}

/** Steps until the batch is not RUNNING. */
async function run_to_end(s: Server, limit = 10): Promise<void> {
  for (let i = 0; i < limit && batch_row(s)?.['status'] === 'RUNNING'; i += 1) await next_step(s);
}

function user_failure_logs(s: Server): readonly LogLine[] {
  return s.logs.filter((l) => l['kind'] === 'error' && l['message'] === 'migration batch user conversion failed');
}

describe('migration batch', () => {
  it('converts every user with lower version items and ends DONE; a failed user stays in failed_users and the batch goes on', async () => {
    const s = await server({ converters: converters() });
    const current_user = await new_user(s);
    await seed(s, current_user, [row('user_state', Q, 1n, CURRENT, quest(1n, 1n))]);
    const users = await old_users(s, 5, [3]);
    const batch_id = await start_batch(s);
    await run_to_end(s);
    const failed = users[2] as bigint;
    expect(batch_row(s)).toMatchObject({ batch_id, status: 'DONE', target_version: CURRENT, converted_users: 4n, failed_count: 1n });
    expect(failed_users(s)).toEqual([String(failed)]);
    for (const user of users) expect(at_target(s, user)).toBe(user !== failed);
    expect(user_failure_logs(s).map((l) => [String(l['user_id']), log_field(l, 'batch_id')])).toEqual([[String(failed), batch_id]]);
    const got = await admin(s, 'get_migration_batch');
    expect(got).toMatchObject({ batch_id, status: 'DONE', failed_users: [String(failed)], failed_count: 1n });
  });

  it('ends DONE when users fail, and every other user is at target_version', async () => {
    const s = await server({ converters: converters() });
    const users = await old_users(s, 4, [1, 4]);
    await start_batch(s);
    await run_to_end(s);
    expect(batch_row(s)).toMatchObject({ status: 'DONE', converted_users: 2n, failed_count: 2n });
    expect(failed_users(s)).toEqual([String(users[0]), String(users[3])]);
    expect([users[1], users[2]].every((u) => at_target(s, u as bigint))).toBe(true);
  });

  it('with migration.batchLeaseMs longer than migration.batchIntervalMs, two intervals move cursor_user_id two steps and each step ends with lease_until_at at clock_now', async () => {
    const s = await server();
    const users = await old_users(s, 5);
    await start_batch(s);
    await next_step(s);
    expect(batch_row(s)).toMatchObject({ cursor_user_id: users[1], lease_until_at: s.clock.now(), converted_users: 2n });
    await next_step(s);
    expect(batch_row(s)).toMatchObject({ cursor_user_id: users[3], lease_until_at: s.clock.now(), converted_users: 4n, status: 'RUNNING' });
  });

  it('a new batch has target_version of the current contract version at start_migration_batch', async () => {
    const s = await server();
    await start_batch(s);
    expect(batch_row(s)).toMatchObject({
      status: 'RUNNING',
      target_version: CURRENT,
      cursor_user_id: 0n,
      converted_users: 0n,
      failed_users: '[]',
      failed_count: 0n,
      lease_owner: '',
      lease_until_at: 0n,
      started_at: START_AT,
      updated_at: START_AT,
    });
  });

  it('a step of a server instance whose contract version is below target_version takes no lease and leaves the batch record as it is; a step of a server instance at target_version ends the batch DONE', async () => {
    const db = await new_db();
    const a = await server({ db });
    const b = await server({ db, clock: new TestClock(START_AT), contract_version: Number(CURRENT - 1n) });
    const users = await old_users(a, 3);
    const newer_old = await new_user(a);
    await seed(a, newer_old, [row('user_state', Q, 200n, CURRENT - 1n, quest(200n, 5n))]);
    users.push(newer_old);
    await start_batch(a);
    const before = batch_row(a);
    expect(before).toMatchObject({ target_version: CURRENT, cursor_user_id: 0n, converted_users: 0n, lease_owner: '' });
    await next_step(b);
    await next_step(b);
    expect(batch_row(b)).toEqual(before);
    expect(users.map((u) => at_target(a, u))).toEqual([false, false, false, false]);
    await run_to_end(a);
    expect(batch_row(a)).toMatchObject({ status: 'DONE', target_version: CURRENT, converted_users: 4n, failed_count: 0n });
    expect(users.every((u) => at_target(a, u))).toBe(true);
  });

  // On SQLite the instance's one write connection takes its transactions in the order they ask, so the stop asked
  // after the step's lease runs between the lease and the DONE write. On PostgreSQL nothing orders them; there
  // processes.test.ts holds the step end write with a lock.
  it.runIf(DB_KIND === 'sqlite')('stop_migration_batch committed before the DONE write of a step with no user left leaves status STOPPED (SQLite)', async () => {
    const s = await server();
    await start_batch(s);
    s.clock.advance(BigInt(SETTINGS['migration.batchIntervalMs'] as number));
    // The step has asked for its lease transaction; the stop comes after it and before the DONE write.
    const stopped = admin(s, 'stop_migration_batch');
    await wait_background(s);
    expect(await stopped).toEqual({});
    // The step took its lease before the stop and gave it back in its step end write.
    expect(batch_row(s)).toMatchObject({ status: 'STOPPED', lease_until_at: s.clock.now() });
    await next_step(s);
    expect(batch_row(s)?.['status']).toBe('STOPPED');
  });

  it('when the server instance holding the lease stops during a step, another server instance goes on from cursor_user_id', async () => {
    const db = await new_db();
    let a: Server | null = null;
    let stopped: () => void = () => undefined;
    const a_stopped = new Promise<void>((resolve) => {
      stopped = resolve;
    });
    a = await server({
      db,
      settings: { 'migration.batchSize': 3 },
      converters: converters((id) => {
        if (id !== 102n || a === null) return;
        // The server instance stops while it converts the second user.
        a.stop();
        stopped();
      }),
    });
    const users = await old_users(a, 3);
    await start_batch(a);
    a.clock.advance(BigInt(SETTINGS['migration.batchIntervalMs'] as number));
    await a_stopped;
    // Another server instance starts once the lease has ended.
    const b = await server({ db, settings: { 'migration.batchSize': 3 } });
    const after_stop = batch_row(b);
    expect(after_stop).toMatchObject({ cursor_user_id: 0n, converted_users: 0n });
    expect(after_stop?.['lease_owner']).not.toBe('');
    expect(users.map((u) => at_target(b, u))).toEqual([true, false, false]);
    await next_step(b, (after_stop?.['lease_until_at'] as bigint) - b.clock.now());
    expect(batch_row(b)).toMatchObject({ cursor_user_id: users[2], converted_users: 2n, failed_count: 0n });
    await run_to_end(b);
    expect(batch_row(b)?.['status']).toBe('DONE');
    expect(users.every((u) => at_target(b, u))).toBe(true);
  });

  it('a user whose user lock another transaction holds longer than storage.userLockWaitMs is counted in failed_count and failed_users with an error log, and the batch goes on', async () => {
    const db = await new_db();
    let users: bigint[] = [];
    const sqlite = DB_KIND === 'sqlite' ? sqlite_lock(db) : null;
    const s = await server({
      db,
      settings: { 'migration.batchSize': 3, 'storage.userLockWaitMs': 300 },
      converters: converters(),
      // SQLite: the write lock is the user lock. Another connection holds it from after the first user's failure
      // until the second user's failure.
      on_log: (line) => {
        if (sqlite === null || line['message'] !== 'migration batch user conversion failed') return;
        if (String(line['user_id']) === String(users[0])) sqlite.hold();
        if (String(line['user_id']) === String(users[1])) sqlite.release();
      },
    });
    users = await old_users(s, 3, [1]);
    const holder = DB_KIND === 'postgresql' ? await lock_holder(db) : null;
    if (holder !== null) {
      await holder.ok('BEGIN');
      await holder.ok('SELECT user_id FROM "user" WHERE user_id = $1 FOR UPDATE', [users[1] as bigint]);
    }
    const batch_id = await start_batch(s);
    await next_step(s);
    if (holder !== null) await holder.ok('ROLLBACK');
    sqlite?.close();
    expect(batch_row(s)).toMatchObject({ cursor_user_id: users[2], converted_users: 1n, failed_count: 2n });
    expect(failed_users(s)).toEqual([String(users[0]), String(users[1])]);
    expect(at_target(s, users[1] as bigint)).toBe(false);
    expect(at_target(s, users[2] as bigint)).toBe(true);
    expect(user_failure_logs(s).map((l) => [String(l['user_id']), log_field(l, 'batch_id')])).toContainEqual([String(users[1]), batch_id]);
  });
});

/** The `error` and `core` log lines of job `migration_batch`, as [message, user ID]. */
function job_logs(s: Server): [unknown, string][] {
  return s.logs
    .filter((l) => /^migration(_converter| batch)/.test(String(l['message'])))
    .map((l) => [l['message'], String(l['user_id'])]);
}

/** The `run_user_transaction` calls from now on: the step's user transactions. */
function user_transactions(s: Server): Promise<unknown>[] {
  const calls: Promise<unknown>[] = [];
  const run = s.storage.run_user_transaction.bind(s.storage);
  s.storage.run_user_transaction = (user_id, fn) => {
    const call = run(user_id, fn);
    calls.push(call);
    return call;
  };
  return calls;
}

/** Waits until the calls have settled and what they resolve has run to its next wait. */
async function settled(calls: readonly Promise<unknown>[]): Promise<void> {
  await Promise.allSettled(calls);
  await new Promise((resolve) => setImmediate(resolve));
}

describe('migration batch after stop', () => {
  it('a user conversion that fails after the server instance stops under its open transaction is not logged, and the step ends there; the same failure before stop is logged', async () => {
    const db = await new_db();
    let a: Server | null = null;
    // The server instance stops while it converts the second user: storage rolls back that user's open
    // transaction and closes the DB, as a server stop does under a running step.
    a = await server({
      db,
      settings: { 'migration.batchSize': 3 },
      converters: converters((id) => {
        if (id === 102n && a !== null) a.stop();
      }),
    });
    const users = await old_users(a, 3, [1]);
    const transactions = user_transactions(a);
    await start_batch(a);
    await next_step(a);
    // The stop ends wait_idle at once while the step goes on; it goes on from the stopped user's transaction.
    await settled(transactions);
    // Only the first user's failure, which came before the stop, is logged.
    expect(job_logs(a)).toEqual([['migration batch user conversion failed', String(users[0])]]);
    // The step wrote no step end: another server instance goes on from cursor_user_id once the lease has ended.
    const b = await server({ db, settings: { 'migration.batchSize': 3 } });
    expect(batch_row(b)).toMatchObject({ cursor_user_id: 0n, converted_users: 0n, failed_count: 0n });
    expect(users.map((u) => at_target(b, u))).toEqual([false, false, false]);
  });

  it('a step failure that comes after migration stop() began is not logged; the same failure before stop is', async () => {
    const s = await server({ settings: { 'migration.batchSize': 3 } });
    const users = await old_users(s, 2);
    await start_batch(s);
    // Every batch status read throws, as a statement on a closed DB connection does.
    const read_db = s.storage.read_db.bind(s.storage);
    const stop = { now: false };
    let thrown = 0;
    s.storage.read_db = () => {
      const handle = read_db();
      const wrapped = Object.create(handle) as DbHandle;
      wrapped.query = (statement, params) => {
        if (statement.startsWith('SELECT status FROM migration_batch')) {
          thrown += 1;
          if (stop.now) s.migration.stop();
          throw new Error('the DB connection is closed');
        }
        return handle.query(statement, params);
      };
      return wrapped;
    };
    await next_step(s);
    expect([thrown, job_logs(s)]).toEqual([1, [['migration batch step failed', 'null']]]);
    // migration stop() begins under the status read of the next step (its lease has ended), which then throws.
    stop.now = true;
    await next_step(s, BigInt(SETTINGS['migration.batchLeaseMs'] as number));
    expect(thrown).toBe(2);
    expect(job_logs(s)).toEqual([['migration batch step failed', 'null']]);
    // A job run after stop() began starts no step.
    await next_step(s, BigInt(SETTINGS['migration.batchLeaseMs'] as number));
    expect(thrown).toBe(2);
    expect(users.map((u) => at_target(s, u))).toEqual([false, false]);
  });
});

/**
 * What a game transaction of job `migration_batch` does: `run` it; give back `FAILED` (`fail`) or throw (`throw`)
 * without running it; or stop the server instance first, so it runs on the closed DB and gives back `FAILED`
 * (`stop then fail`), or throws as a statement on a closed DB connection does (`stop then throw`).
 */
type GameTxAction = 'run' | 'fail' | 'throw' | 'stop then fail' | 'stop then throw';

/**
 * A server `extra` that makes the game transactions of job `migration_batch` do what `plan(run, n)` says, for the
 * n-th game transaction (from 0) of the run-th job run (from 0, the run at server start). Each such game
 * transaction is pushed to `calls`. In a job run the first one is the `migration_converter` insert until it has been
 * written, then the lease and the step end write.
 */
function job_game_transactions(server_of: () => Server | null, calls: Promise<unknown>[], plan: (run: number, n: number) => GameTxAction): (input: ModuleInput) => [] {
  return (input) => {
    const time = input.modules['server-time'] as ServerTime;
    const storage = input.modules['storage'] as Storage;
    const job = new AsyncLocalStorage<{ n: number }>();
    let runs = 0;
    const schedule = time.schedule_job.bind(time);
    time.schedule_job = (name, interval_ms, run) => {
      if (name !== 'migration_batch') {
        schedule(name, interval_ms, run);
        return;
      }
      schedule(name, interval_ms, () => {
        runs += 1;
        return job.run({ n: 0 }, run);
      });
    };
    const run_game = storage.run_game_transaction.bind(storage);
    storage.run_game_transaction = <T>(fn: (tx: GameTx) => T): Promise<T | 'FAILED'> => {
      const in_job = job.getStore();
      if (in_job === undefined) return run_game(fn);
      const action = plan(runs - 1, in_job.n);
      in_job.n += 1;
      if (action.startsWith('stop')) server_of()?.stop();
      const call: Promise<unknown> =
        action === 'run' || action === 'stop then fail'
          ? run_game(fn)
          : action === 'fail'
            ? Promise.resolve('FAILED')
            : Promise.reject(new Error('the DB connection is closed'));
      calls.push(call);
      return call as Promise<T | 'FAILED'>;
    };
    return [];
  };
}

// A stop in the first synchronous part of a job run comes before `wait_idle` waits, so that `wait_idle` would not
// end; those tests advance the clock and wait for the game transactions instead.
describe('migration batch after stop under a game transaction', () => {
  it('a lease transaction that fails after the server instance stops under it is not logged and leaves the batch record as it is; the same failure before stop is logged', async () => {
    const db = await new_db();
    const calls: Promise<unknown>[] = [];
    let a: Server | null = null;
    // Job run 1 (the first step): its lease fails. Job run 2: the server instance stops under its lease.
    a = await server({ db, extra: job_game_transactions(() => a, calls, (run, n) => (n !== 0 ? 'run' : run === 1 ? 'fail' : run === 2 ? 'stop then fail' : 'run')) });
    const users = await old_users(a, 2);
    await start_batch(a);
    const before = batch_row(a);
    await next_step(a);
    expect(job_logs(a)).toEqual([['migration batch lease failed', 'null']]);
    expect(batch_row(a)).toEqual(before);
    a.clock.advance(BigInt(SETTINGS['migration.batchIntervalMs'] as number));
    await settled(calls);
    expect(calls.length).toBe(3);
    expect(job_logs(a)).toEqual([['migration batch lease failed', 'null']]);
    // A server instance below target_version takes no lease, so it reads the batch record as the stopped one left it.
    const b = await server({ db, contract_version: Number(CURRENT - 1n) });
    expect(batch_row(b)).toEqual(before);
    expect(users.map((u) => at_target(b, u))).toEqual([false, false]);
  });

  it('a step end write that fails after the server instance stops under it is not logged and leaves the batch record as the lease left it; the same failure before stop is logged', async () => {
    const db = await new_db();
    const calls: Promise<unknown>[] = [];
    let a: Server | null = null;
    let at_stop: Readonly<Record<string, unknown>> | null = null;
    // Job run 1 (the first step): its step end write fails. Job run 2: the server instance stops under its step end write.
    a = await server({
      db,
      extra: job_game_transactions(
        () => a,
        calls,
        (run, n) => {
          if (n !== 1 || a === null) return 'run';
          if (run === 1) return 'fail';
          if (run !== 2) return 'run';
          at_stop = batch_row(a);
          return 'stop then fail';
        },
      ),
    });
    const users = await old_users(a, 4);
    const batch_id = await start_batch(a);
    await next_step(a);
    expect(job_logs(a)).toEqual([['migration batch step end write failed', 'null']]);
    expect(batch_row(a)).toMatchObject({ batch_id, status: 'RUNNING', cursor_user_id: 0n, converted_users: 0n });
    // The failed step end write did not give the lease back: the next step comes once it has ended.
    await next_step(a, BigInt(SETTINGS['migration.batchLeaseMs'] as number));
    await settled(calls);
    expect(calls.length).toBe(5);
    expect(job_logs(a)).toEqual([['migration batch step end write failed', 'null']]);
    expect(at_stop).toMatchObject({ batch_id, status: 'RUNNING', cursor_user_id: 0n, converted_users: 0n });
    const b = await server({ db, contract_version: Number(CURRENT - 1n) });
    expect(batch_row(b)).toEqual(at_stop);
    // Both steps converted their users before the step end write.
    expect(users.map((u) => at_target(b, u))).toEqual([true, true, true, true]);
  });

  it.each([
    ['fail', 'stop then fail'],
    ['throw', 'stop then throw'],
  ] as const)(
    'a migration_converter insert that fails (%s) is logged before stop and not after the server instance stops under it (%s), and no step runs then',
    async (before_stop, after_stop) => {
      const db = await new_db();
      const calls: Promise<unknown>[] = [];
      let a: Server | null = null;
      // Job run 0 (at server start): the insert fails. Job run 1: the server instance stops under the insert.
      a = await server({ db, extra: job_game_transactions(() => a, calls, (run) => (run === 0 ? before_stop : run === 1 ? after_stop : 'run')) });
      const not_written = ['migration_converter rows were not written', 'null'];
      expect(job_logs(a)).toEqual([not_written]);
      const logged = a.logs.find((l) => l['message'] === not_written[0]);
      expect(logged === undefined ? null : log_field(logged, 'error')).toBe(before_stop === 'fail' ? 'the game transaction failed' : 'the DB connection is closed');
      a.clock.advance(BigInt(SETTINGS['migration.batchIntervalMs'] as number));
      await settled(calls);
      expect(calls.length).toBe(2);
      expect(job_logs(a)).toEqual([not_written]);
    },
  );
});
