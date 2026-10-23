import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as CoreContract from '../../../generated/contract/core_contract.ts';
import * as GameContract from '../../../generated/contract/game_contract.ts';
import { open_pg_session } from '../../storage/dev/index.ts';
import { new_db } from '../../storage/tests/helpers.ts';
import { advance_time, fake, gates_of, hold_db, hold_lock_key, login, send, start_peer_process, start_test_server, stop_peer_processes, stop_test_server, until_blocked_by } from '../dev/index.ts';
import { AT_TIME, BEFORE_LOCK, FAILING_PEER_FILE, LOCK_KEY } from './peer_register.ts';
import { error_code, real_wait, social_login, type FakeControl } from './helpers.ts';

const PEER = { module: new URL('./peer_register.ts', import.meta.url), name: 'lock_peer' };
const CLOCK_PEER = { module: new URL('./peer_register.ts', import.meta.url), name: 'clock_peer' };
const FAILING_PEER = { module: new URL('./peer_register.ts', import.meta.url), name: 'failing_peer' };
const MISSING_PEER = { module: new URL('./peer_register.ts', import.meta.url), name: 'no_such_peer' };
/** A register export that does not exist: a peer process started with it would fail with its own reason. */
const REAL_ADAPTER_PEER = { module: new URL('./peer_register.ts', import.meta.url), name: 'real_adapter_peer' };

/** The child process handles of this process. */
function child_processes(): number {
  return process.getActiveResourcesInfo().filter((resource) => resource === 'ProcessWrap').length;
}

/**
 * The child process handles once they are at most `max`, or after 2 s of real time. Node closes the handle of a child
 * a moment after its `exit` and `close` events, so the count drops later than the child exits.
 */
async function settled_children(max: number): Promise<number> {
  for (let waited = 0; child_processes() > max && waited < 2_000; waited += 20) await real_wait(20);
  return child_processes();
}

/**
 * The peer folders whose config names the `register` export `name`. Peer processes of other test files may make and
 * remove their folders meanwhile, so a folder gone while it is read is not one.
 */
function peer_folders_of(name: string): string[] {
  return readdirSync(tmpdir())
    .filter((folder) => folder.startsWith('ogw-peer-'))
    .filter((folder) => {
      try {
        return (JSON.parse(readFileSync(join(tmpdir(), folder, 'config.json'), 'utf8')) as { register_name?: unknown }).register_name === name;
      } catch {
        return false;
      }
    });
}

/** True while a process of `pid` exists. */
function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** Lock waits of these tests last until the test lets them go on. */
const WAIT = { 'storage.userLockWaitMs': 20_000 };

/** Time limit of one test: a peer process starts, and a request waits at a gate and for a lock. */
const T = 60_000;

const ADVISORY_LOCK = 'SELECT pg_advisory_xact_lock(CAST($1 AS BIGINT)) AS locked';

afterEach(stop_peer_processes);

/** A note that takes the writer some milliseconds to write. */
const LONG_NOTE = 32 * 1024 * 1024;

/**
 * The content of `file` at the first read that finds it, reading again without a pause until it exists: what a
 * reader of the gate files can see at the moment the file appears.
 */
function first_content(file: string): string {
  const until = Date.now() + T;
  while (Date.now() < until) {
    try {
      return readFileSync(file, 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }
  throw new Error(`${file} did not appear`);
}

describe('peer gates', () => {
  it('a reached gate file has the whole note from the moment it exists, and reached reads that note', async () => {
    const folder = mkdtempSync(join(tmpdir(), 'ogw-gate-test-'));
    const names = ['g0', 'g1', 'g2', 'g3', 'g4'];
    const child = spawn(process.execPath, [fileURLToPath(new URL('./gate_main.ts', import.meta.url)), folder, String(LONG_NOTE), ...names], { stdio: 'inherit' });
    let exited = false;
    const gone = new Promise<number | null>((resolve) => {
      child.once('exit', (code) => {
        exited = true;
        resolve(code);
      });
    });
    try {
      const gates = gates_of(folder, () => !exited, 'the gate process');
      for (const name of names) {
        expect(first_content(join(folder, `${name}.reached`)).length).toBe(LONG_NOTE);
        expect((await gates.reached(name)).length).toBe(LONG_NOTE);
        gates.open(name);
      }
      expect(await gone).toBe(0);
      expect(readdirSync(folder).sort()).toEqual(names.flatMap((n) => [`${n}.open`, `${n}.reached`]).sort());
    } finally {
      child.kill();
      rmSync(folder, { recursive: true, force: true });
    }
  }, T);
});

describe('peer process and lock holders (PostgreSQL)', () => {
  it('a request of a peer process waits at its gate until open, then for the lock of hold_lock_key, which until_blocked_by sees, and is processed after release', async () => {
    const server = await start_test_server(undefined, 'postgresql', undefined, undefined, undefined, WAIT);
    try {
      const peer = await start_peer_process(server, PEER);
      const session = await login(peer.remote, 'peer_user');
      const holder = await hold_lock_key(server, LOCK_KEY);
      const sent = send(session, 'RunCoreTest', new GameContract.RunCoreTestRequest());
      const pid = Number(await peer.reached(BEFORE_LOCK));
      expect(pid).toBeGreaterThan(0);
      expect(pid).not.toBe(holder.pid);
      peer.open(BEFORE_LOCK);
      await until_blocked_by(server, holder.pid);
      await holder.release();
      expect(error_code(await sent)).toBe(0);
    } finally {
      await stop_test_server(server);
    }
  }, T);

  it('hold_db holds the locks of its statements until release', async () => {
    const server = await start_test_server(undefined, 'postgresql');
    try {
      const first = await hold_db(server, [{ sql: 'SELECT 1 AS one' }, { sql: ADVISORY_LOCK, params: [7n] }]);
      const second = hold_db(server, [{ sql: ADVISORY_LOCK, params: [7n] }]);
      await until_blocked_by(server, first.pid);
      await first.release();
      const next = await second;
      expect(next.pid).not.toBe(first.pid);
      await next.release();
    } finally {
      await stop_test_server(server);
    }
  }, T);

  it('a peer process starts with the test clock at the test server\'s time', async () => {
    const start_at = 1_800_000_000_000n;
    const server = await start_test_server(start_at, 'postgresql');
    try {
      advance_time(server, 5_000n);
      const peer = await start_peer_process(server, CLOCK_PEER);
      const sent = send(await login(peer.remote, 'peer_clock'), 'RunCoreTest', new GameContract.RunCoreTestRequest());
      expect(BigInt(await peer.reached(AT_TIME))).toBe(start_at + 5_000n);
      peer.open(AT_TIME);
      expect(error_code(await sent)).toBe(0);
    } finally {
      await stop_test_server(server);
    }
  }, T);

  it('until_blocked_by counts a session that waits behind another waiter, and throws when fewer sessions wait in time', async () => {
    const server = await start_test_server(undefined, 'postgresql');
    const setup = await open_pg_session(server.shared.database.connection ?? '');
    try {
      await setup.query('CREATE TABLE peer_row (id INT PRIMARY KEY)');
      await setup.query('INSERT INTO peer_row (id) VALUES (1)');
      const row_lock = [{ sql: 'SELECT id FROM peer_row WHERE id = $1 FOR UPDATE', params: [1] }];
      const holder = await hold_db(server, row_lock);
      const first = hold_db(server, row_lock);
      await until_blocked_by(server, holder.pid, 1);
      const second = hold_db(server, row_lock);
      // A second row lock waiter waits for the first waiter's tuple lock, not for the holder.
      await until_blocked_by(server, holder.pid, 2);
      await expect(until_blocked_by(server, holder.pid, 3)).rejects.toThrow(/fewer than 3 sessions/);
      await holder.release();
      await (await first).release();
      await (await second).release();
    } finally {
      setup.close();
      await stop_test_server(server);
    }
  }, T);

  it('hold_db throws when a statement fails', async () => {
    const server = await start_test_server(undefined, 'postgresql');
    try {
      await expect(hold_db(server, [{ sql: 'SELECT * FROM no_such_table' }])).rejects.toThrow();
    } finally {
      await stop_test_server(server);
    }
  });

  it('hold_db, hold_lock_key and until_blocked_by take a PostgreSQL connection string of a test DB without a test server: a hold blocks a second session, which until_blocked_by on that connection string sees', async () => {
    const connection = (await new_db('postgresql')).secrets['db'] ?? '';
    const holder = await hold_lock_key(connection, 11n);
    let second_held = false;
    const second = hold_db(connection, [{ sql: 'SELECT 1 AS one' }, { sql: ADVISORY_LOCK, params: [11n] }]).then((h) => {
      second_held = true;
      return h;
    });
    await until_blocked_by(connection, holder.pid);
    expect(second_held).toBe(false);
    await holder.release();
    const next = await second;
    expect(next.pid).not.toBe(holder.pid);
    await next.release();
  }, T);

  it('a peer process makes its own fake adapters: a failure condition set on the test server\'s fake controller does not reach its requests, and its calls are not in calls()', async () => {
    const server = await start_test_server(undefined, 'postgresql');
    try {
      const google = fake(server, 'login-google') as FakeControl;
      google.set_failure('verify', 'rejected');
      const local = await login(server, 'fake_local');
      expect(error_code(await social_login(local, CoreContract.LoginProvider.LOGIN_PROVIDER_GOOGLE, 'fake:account_local'))).toBe(CoreContract.CoreError.CORE_ERROR_SOCIAL_LOGIN_INVALID);
      expect(google.calls().filter((call) => call.operation === 'verify')).toHaveLength(1);
      const peer = await start_peer_process(server, PEER);
      const remote = await login(peer.remote, 'fake_peer');
      expect(error_code(await social_login(remote, CoreContract.LoginProvider.LOGIN_PROVIDER_GOOGLE, 'fake:account_peer'))).toBe(0);
      expect(google.calls().filter((call) => call.operation === 'verify')).toHaveLength(1);
    } finally {
      await stop_test_server(server);
    }
  }, T);

  it('a settings override of the test server reaches the peer process: with a short storage.userLockWaitMs its request fails at the held lock, and without the override the same request waits for the lock', async () => {
    const short_wait = 300;
    const shorter = await start_test_server(undefined, 'postgresql', undefined, undefined, undefined, { 'storage.userLockWaitMs': short_wait });
    const plain = await start_test_server(undefined, 'postgresql');
    try {
      const default_wait = Number(plain.settings()['storage.userLockWaitMs']);
      expect(default_wait).toBeGreaterThan(4 * short_wait);
      const peer = await start_peer_process(shorter, PEER);
      const session = await login(peer.remote, 'override_short');
      const holder = await hold_lock_key(shorter, LOCK_KEY);
      peer.open(BEFORE_LOCK);
      const sent_at = performance.now();
      const failed = await send(session, 'RunCoreTest', new GameContract.RunCoreTestRequest());
      expect(error_code(failed)).toBe(CoreContract.CoreError.CORE_ERROR_INTERNAL);
      // The lock wait ended at the override, well before the default lock wait.
      expect(performance.now() - sent_at).toBeLessThan(default_wait);
      await holder.release();

      const plain_peer = await start_peer_process(plain, PEER);
      const plain_session = await login(plain_peer.remote, 'override_plain');
      const plain_holder = await hold_lock_key(plain, LOCK_KEY);
      plain_peer.open(BEFORE_LOCK);
      let answered = false;
      const sent = send(plain_session, 'RunCoreTest', new GameContract.RunCoreTestRequest()).then((result) => {
        answered = true;
        return result;
      });
      await until_blocked_by(plain, plain_holder.pid);
      await real_wait(3 * short_wait);
      expect(answered).toBe(false);
      await plain_holder.release();
      expect(error_code(await sent)).toBe(0);
    } finally {
      await stop_test_server(shorter);
      await stop_test_server(plain);
    }
  }, T);

  it('start_peer_process throws for a test server with a real adapter list and starts no process', async () => {
    const server = await start_test_server(undefined, 'postgresql', undefined, undefined, { 'login-apple': 'login-apple' });
    try {
      const children = child_processes();
      await expect(start_peer_process(server, REAL_ADAPTER_PEER)).rejects.toThrow(/real adapter/);
      expect(child_processes()).toBe(children);
      expect(peer_folders_of(REAL_ADAPTER_PEER.name)).toEqual([]);
    } finally {
      await stop_test_server(server);
    }
  }, T);

  it('start_peer_process rejects when the server start of the peer fails, and the peer process and its folder are gone', async () => {
    const server = await start_test_server(undefined, 'postgresql');
    const record = mkdtempSync(join(tmpdir(), 'ogw-failing-peer-'));
    const file = join(record, 'peer.json');
    const previous = process.env[FAILING_PEER_FILE];
    process.env[FAILING_PEER_FILE] = file;
    try {
      const children = child_processes();
      await expect(start_peer_process(server, FAILING_PEER)).rejects.toThrow(/did not start: register fails on purpose/);
      expect(await settled_children(children)).toBe(children);
      const failed = JSON.parse(readFileSync(file, 'utf8')) as { pid: number; folder: string };
      expect(failed.folder.startsWith(join(tmpdir(), 'ogw-peer-'))).toBe(true);
      expect(alive(failed.pid)).toBe(false);
      expect(existsSync(failed.folder)).toBe(false);
      // A peer that failed to start is not one that stop_peer_processes still has to stop.
      await stop_peer_processes();
    } finally {
      if (previous === undefined) Reflect.deleteProperty(process.env, FAILING_PEER_FILE);
      else process.env[FAILING_PEER_FILE] = previous;
      rmSync(record, { recursive: true, force: true });
      await stop_test_server(server);
    }
  }, T);

  it('start_peer_process rejects for a register export that does not exist', async () => {
    const server = await start_test_server(undefined, 'postgresql');
    try {
      const children = child_processes();
      await expect(start_peer_process(server, MISSING_PEER)).rejects.toThrow(/did not start: .*has no export no_such_peer/);
      expect(await settled_children(children)).toBe(children);
      expect(peer_folders_of('no_such_peer')).toEqual([]);
    } finally {
      await stop_test_server(server);
    }
  }, T);

  it('stop_peer_processes stops the peer processes still running', async () => {
    const server = await start_test_server(undefined, 'postgresql');
    try {
      const peer = await start_peer_process(server, PEER);
      // An open gate does not hold the request.
      peer.open(BEFORE_LOCK);
      expect(error_code(await send(await login(peer.remote, 'peer_stop'), 'RunCoreTest', new GameContract.RunCoreTestRequest()))).toBe(0);
      await stop_peer_processes();
      await expect(login(peer.remote, 'peer_stopped')).rejects.toThrow();
    } finally {
      await stop_test_server(server);
    }
  }, T);

  it('start_peer_process, hold_db, hold_lock_key and until_blocked_by throw for a SQLite test server', async () => {
    const server = await start_test_server(undefined, 'sqlite');
    try {
      await expect(start_peer_process(server, PEER)).rejects.toThrow(/PostgreSQL/);
      await expect(hold_db(server, [{ sql: 'SELECT 1 AS one' }])).rejects.toThrow(/PostgreSQL/);
      await expect(hold_lock_key(server, 1n)).rejects.toThrow(/PostgreSQL/);
      await expect(until_blocked_by(server, 1)).rejects.toThrow(/PostgreSQL/);
    } finally {
      await stop_test_server(server);
    }
  });
});
