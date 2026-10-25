/**
 * Batch steps of server instances in processes of their own (`process.ts`) on one test DB. The test process runs one
 * more instance that seeds users, calls the admin operations and reads the batch record; its own job does not step
 * because its clock does not move.
 */
import { lock_key } from '../../storage/tx.ts';
import { quest } from '../../storage/tests/kinds.ts';
import { hold_db, hold_lock_key, until_blocked_by } from '../../testing/dev/index.ts';
import { CURRENT } from './contract.ts';
import { admin, batch_row, new_db, new_user, row, seed, server, SETTINGS, START_AT, stop_all, type DbTarget, type LogLine, type Server } from './helpers.ts';
import { item_gate, log_gate, start_process, stop_processes } from './process.ts';

afterEach(async () => {
  await stop_processes();
  stop_all();
});

const Q = 'quest_user_state';
const INTERVAL = BigInt(SETTINGS['migration.batchIntervalMs'] as number);
const LEASE_MS = BigInt(SETTINGS['migration.batchLeaseMs'] as number);
/** The quest item ID whose conversion from version 2 throws in a process that names it broken. */
const BROKEN = 13n;
const FAILED_LOG = 'migration batch user conversion failed';
const LOST_LOG = 'migration batch lease lost; the step is dropped';
/** Lock waits of these tests last until the test lets them go on. */
const WAIT = { 'storage.userLockWaitMs': 20_000 };
/** Time limit of one test: child processes start, and steps wait at gates and locks. */
const T = 60_000;

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

/** The instance of the test process, once the `migration_batch` job run of its server start is over (`server`). */
async function test_instance(db: DbTarget): Promise<Server> {
  return server({ db, settings: WAIT });
}

function at_target(s: Server, user: bigint): boolean {
  const versions = ['user_state', 'server_state'].flatMap((t) => s.storage.read_db().query(`SELECT contract_version FROM ${t} WHERE user_id = $1`, [user]));
  return versions.every((r) => r['contract_version'] === CURRENT);
}

async function start_batch(s: Server): Promise<string> {
  const started = await admin(s, 'start_migration_batch');
  if (typeof started === 'string') throw new Error(`start_migration_batch: ${started}`);
  return String(started['batch_id']);
}

function connection(db: DbTarget): string {
  const url = db.secrets['db'];
  if (url === undefined) throw new Error('not a PostgreSQL test DB');
  return url;
}

function messages(logs: readonly LogLine[], message: string): LogLine[] {
  return logs.filter((l) => l['message'] === message);
}

describe('migration batch on server instances in two processes', () => {
  it('a step whose step end write waits behind the lease that another server instance takes after the step\'s lease ended changes no row, so the step is dropped and logs the lost lease (PostgreSQL)', async () => {
    const db = await new_db('postgresql');
    const m = await test_instance(db);
    const users = await old_users(m, 4);
    const a = await start_process({ db, start_at: START_AT, settings: WAIT, gate_items: [101n] });
    // b's clock is past the end of the lease a takes in its step.
    const b = await start_process({ db, start_at: START_AT + LEASE_MS + INTERVAL, settings: WAIT });
    await start_batch(m);
    const stepped_a = a.step(INTERVAL);
    await a.reached(item_gate(101n));
    const leased_by_a = batch_row(m)?.['lease_owner'];
    // The test holds the batch record row: b's lease write waits for it, then a's step end write queues behind b.
    const record_row = await hold_db(connection(db), [{ sql: 'SELECT batch_id FROM migration_batch FOR UPDATE' }]);
    const stepped_b = b.step(INTERVAL);
    await until_blocked_by(connection(db), record_row.pid, 1);
    a.open(item_gate(101n));
    await until_blocked_by(connection(db), record_row.pid, 2);
    // a read its lease_owner in the step end transaction before b's lease write committed.
    await record_row.release();
    await stepped_a;
    const b_now = await stepped_b;
    expect(messages(await a.logs(), LOST_LOG)).toHaveLength(1);
    const record = batch_row(m);
    expect(record?.['lease_owner']).not.toBe(leased_by_a);
    // Only b's step end: a converted the first two users, but the step that lost its lease does not count them.
    expect(record).toMatchObject({ status: 'RUNNING', cursor_user_id: users[3], converted_users: 2n, failed_count: 0n, failed_users: '[]', lease_until_at: b_now, updated_at: b_now });
    expect(users.every((u) => at_target(m, u))).toBe(true);
  }, T);

  it('stop_migration_batch committed after a step took its lease and before its DONE write leaves status STOPPED, and the step end write still gives the lease back (PostgreSQL)', async () => {
    const db = await new_db('postgresql');
    const m = await test_instance(db);
    const a = await start_process({ db, start_at: START_AT, settings: WAIT });
    const batch_id = await start_batch(m);
    // The step end transaction waits for the batch record lock the test holds; the lease write before it committed.
    const record_lock = await hold_lock_key(connection(db), lock_key('migration_batch', [batch_id]));
    const stepped = a.step(INTERVAL);
    await until_blocked_by(connection(db), record_lock.pid);
    expect(batch_row(m)?.['lease_owner']).not.toBe('');
    expect(await admin(m, 'stop_migration_batch')).toEqual({});
    await record_lock.release();
    const now = await stepped;
    expect(batch_row(m)).toMatchObject({ status: 'STOPPED', lease_until_at: now, cursor_user_id: 0n, converted_users: 0n });
    await a.step(INTERVAL);
    expect(batch_row(m)?.['status']).toBe('STOPPED');
  }, T);

  it('of two server instances whose lease writes wait for the batch record at the same time, one takes the lease and runs the one step (PostgreSQL)', async () => {
    const db = await new_db('postgresql');
    const m = await test_instance(db);
    const users = await old_users(m, 4);
    const a = await start_process({ db, start_at: START_AT, settings: WAIT });
    const b = await start_process({ db, start_at: START_AT, settings: WAIT });
    await start_batch(m);
    const record_row = await hold_db(connection(db), [{ sql: 'SELECT batch_id FROM migration_batch FOR UPDATE' }]);
    const steps = [a.step(INTERVAL), b.step(INTERVAL)];
    await until_blocked_by(connection(db), record_row.pid, 2);
    await record_row.release();
    const [now] = await Promise.all(steps);
    expect(batch_row(m)).toMatchObject({ cursor_user_id: users[1], converted_users: 2n, failed_count: 0n, lease_until_at: now });
    expect(users.map((u) => at_target(m, u))).toEqual([true, true, false, false]);
    expect([...messages(await a.logs(), LOST_LOG), ...messages(await b.logs(), LOST_LOG)]).toEqual([]);
  }, T);

  it('a step of another server instance while a step holds the lease takes no lease and writes nothing; the step that holds it ends as one step', async () => {
    const db = await new_db();
    const m = await test_instance(db);
    const users = await old_users(m, 4, [1]);
    const a = await start_process({ db, start_at: START_AT, settings: WAIT, broken_items: [BROKEN], gate_logs: [FAILED_LOG] });
    const b = await start_process({ db, start_at: START_AT, settings: WAIT, broken_items: [BROKEN] });
    await start_batch(m);
    const stepped = a.step(INTERVAL);
    // a holds the lease and waits between users, outside a transaction, after the first user failed.
    await a.reached(log_gate(0));
    const leased = batch_row(m);
    await b.step(INTERVAL);
    expect(batch_row(m)).toEqual(leased);
    a.open(log_gate(0));
    const now = await stepped;
    expect(batch_row(m)).toMatchObject({ cursor_user_id: users[1], converted_users: 1n, failed_count: 1n, failed_users: JSON.stringify([String(users[0])]), lease_until_at: now });
    expect(messages(await b.logs(), FAILED_LOG)).toEqual([]);
  }, T);

  it('stop_migration_batch committed while a step is between two users stops the step before the next user: status STOPPED and cursor_user_id the last user it tried', async () => {
    const db = await new_db();
    const m = await test_instance(db);
    const users = await old_users(m, 3, [1]);
    const a = await start_process({ db, start_at: START_AT, settings: { ...WAIT, 'migration.batchSize': 3 }, broken_items: [BROKEN], gate_logs: [FAILED_LOG] });
    await start_batch(m);
    const stepped = a.step(INTERVAL);
    await a.reached(log_gate(0));
    expect(await admin(m, 'stop_migration_batch')).toEqual({});
    a.open(log_gate(0));
    await stepped;
    expect(batch_row(m)).toMatchObject({ status: 'STOPPED', cursor_user_id: users[0], converted_users: 0n, failed_count: 1n });
    expect(users.map((u) => at_target(m, u))).toEqual([false, false, false]);
  }, T);

  it('stop_migration_batch committed while a step converts a user stops the step before the next user: status STOPPED and cursor_user_id that user (PostgreSQL)', async () => {
    const db = await new_db('postgresql');
    const m = await test_instance(db);
    const users = await old_users(m, 4);
    const a = await start_process({ db, start_at: START_AT, settings: { ...WAIT, 'migration.batchSize': 4 }, gate_items: [101n] });
    await start_batch(m);
    const stepped = a.step(INTERVAL);
    // a is in the first user's transaction; the stop does not wait for it.
    await a.reached(item_gate(101n));
    expect(await admin(m, 'stop_migration_batch')).toEqual({});
    a.open(item_gate(101n));
    await stepped;
    expect(batch_row(m)).toMatchObject({ status: 'STOPPED', cursor_user_id: users[0], converted_users: 1n, failed_count: 0n });
    expect(users.map((u) => at_target(m, u))).toEqual([true, false, false, false]);
  }, T);

  describe('after the lease of a step ends and another server instance takes it', () => {
    /**
     * a takes the lease and waits between users after its first user failed. b, whose clock is past a's lease, takes
     * the lease, fails the same user and converts the others. Then a goes on with the users after the failed one.
     */
    async function takeover(): Promise<{ m: Server; users: bigint[]; b_now: bigint; a_logs: LogLine[]; b: Awaited<ReturnType<typeof start_process>> }> {
      const db = await new_db();
      const m = await test_instance(db);
      const users = await old_users(m, 3, [1]);
      const settings = { ...WAIT, 'migration.batchSize': 3 };
      const a = await start_process({ db, start_at: START_AT, settings, broken_items: [BROKEN], gate_logs: [FAILED_LOG] });
      const b = await start_process({ db, start_at: START_AT + LEASE_MS + INTERVAL, settings, broken_items: [BROKEN] });
      await start_batch(m);
      const stepped = a.step(INTERVAL);
      await a.reached(log_gate(0));
      const b_now = await b.step(INTERVAL);
      a.open(log_gate(0));
      await stepped;
      return { m, users, b_now, a_logs: await a.logs(), b };
    }

    it('the first server instance does not write the batch record and logs the lost lease', async () => {
      const { m, users, b_now, a_logs } = await takeover();
      expect(batch_row(m)).toMatchObject({
        status: 'RUNNING',
        cursor_user_id: users[2],
        converted_users: 2n,
        failed_users: JSON.stringify([String(users[0])]),
        failed_count: 1n,
        lease_until_at: b_now,
        updated_at: b_now,
      });
      expect(messages(a_logs, LOST_LOG)).toHaveLength(1);
    }, T);

    it('once the other server instance ends the batch DONE, the failed user is in failed_users once and failed_count is the number of failed users', async () => {
      const { m, users, b } = await takeover();
      await b.step(INTERVAL);
      expect(batch_row(m)).toMatchObject({ status: 'DONE', failed_count: 1n, converted_users: 2n, failed_users: JSON.stringify([String(users[0])]) });
      expect([users[1], users[2]].every((u) => at_target(m, u as bigint))).toBe(true);
    }, T);
  });
});
