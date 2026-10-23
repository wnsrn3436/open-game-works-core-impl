/**
 * The first run of every job comes when server start ends (`### scheduler`): after every module's `complete_start()`,
 * so after `storage` has made the tables on a new DB, and never when server start fails. The server instances are made
 * with `routing.create_server` on a new DB of the run's DB kind, so a job can be registered between `begin_start()`
 * and `complete_start()` with the table it reads.
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as real_wait } from 'node:timers/promises';
import { create_server } from '../../routing/index.ts';
import type { Storage } from '../../storage/index.ts';
import { new_core_test_server_input, type CoreTestServerInput } from '../../testing/dev/index.ts';
import type { ServerTimeApi } from '../index.ts';

interface Instance {
  start(): Promise<number | string>;
  stop(): Promise<void>;
  modules(): ReadonlyMap<string, unknown>;
  readonly dev?: (module: string, operation: string, input?: unknown) => unknown;
}

const PROBE_TABLE = 'server_time_probe';
const PROBE_JOB = 'server_time_probe';

interface Probe {
  readonly instance: Instance;
  /** One entry per run of the probe job: `ok`, or the message of the error its table read threw. */
  readonly runs: string[];
  /** The server log lines of the instance. */
  readonly lines: Record<string, unknown>[];
}

let folder = '';
let input: CoreTestServerInput | null = null;
const instances: Instance[] = [];

beforeEach(async () => {
  folder = mkdtempSync(join(tmpdir(), 'server-time-first-run-'));
  input = await new_core_test_server_input();
});

afterEach(async () => {
  for (const instance of instances.splice(0)) await instance.stop();
  await input?.drop();
  input = null;
  rmSync(folder, { recursive: true, force: true });
});

/**
 * A server instance on the new DB. Its `register` registers the table `server_time_probe` with `storage` and a job
 * that reads it, the way a module does in `begin_start()`; `more` registers more with `storage` after that.
 */
function probe_instance(port: number, more: (storage: Storage) => void = () => undefined): Probe {
  const given = input;
  if (given === null) throw new Error('no test DB');
  const secret_file = join(folder, 'secrets.json');
  writeFileSync(secret_file, JSON.stringify(given.secrets.file), { mode: 0o600 });
  const runs: string[] = [];
  const lines: Record<string, unknown>[] = [];
  const instance: Instance = create_server({
    args: { env: 'LOCAL', port, matchmaker: true, db: given.database.db_argument, secret_file },
    server_modules: given.server_modules,
    data_folder: given.data_folder,
    core_settings: given.settings,
    game_settings: {},
    register: (core) => {
      given.register(core);
      // Content `register(core)` gets only the member `content` of `storage`; the probe uses the module object.
      const storage = instance.modules().get('storage') as Storage;
      storage.register_table(PROBE_TABLE, 'game', [{ name: 'id', type: 'int32' }], ['id'], null, null);
      (core['server-time'] as ServerTimeApi).schedule_job(PROBE_JOB, 3_600_000n, () => {
        try {
          storage.read_db().query(`SELECT id FROM ${PROBE_TABLE}`);
          runs.push('ok');
        } catch (error) {
          runs.push(error instanceof Error ? error.message : String(error));
        }
      });
      more(storage);
    },
    dev: true,
    register_dev: given.registerDev,
    // Jobs the defaults leave out: `auth_guest_sweep`, and `logging_analytics_deletion` reading its table.
    settings_overrides: { 'auth.inactiveGuestDeleteAfterMs': 86_400_000, 'environments.<ENV>.adapters.analytics': 'fake' },
    log_writer: (line) => {
      lines.push(JSON.parse(line) as Record<string, unknown>);
    },
  });
  instances.push(instance);
  return { instance, runs, lines };
}

/** A port another server listens on, so listening on it fails. */
async function taken_port(): Promise<{ port: number; close(): Promise<void> }> {
  const holder: Server = createServer();
  await new Promise<void>((resolve) => {
    holder.listen(0, resolve);
  });
  const address = holder.address();
  if (address === null || typeof address === 'string') throw new Error('no port');
  return {
    port: address.port,
    close: () =>
      new Promise<void>((resolve) => {
        holder.close(() => {
          resolve();
        });
      }),
  };
}

describe('first job run', () => {
  it('reads the table of its module on a new DB: the first run comes after storage made the tables, and no job leaves an error log', async () => {
    const probe = probe_instance(0);
    expect(typeof (await probe.instance.start())).toBe('number');
    // The first runs of the core modules' jobs (some of them wait) end without an error log.
    const dev = probe.instance.dev;
    if (dev === undefined) throw new Error('the server instance has no DEV code');
    await dev('storage', 'wait_after_commit', []);
    await dev('server-time', 'wait_idle', []);
    await dev('storage', 'wait_after_commit', []);
    const errors = probe.lines.filter((line) => line.level === 'error').map((line) => line.message);
    expect({ runs: probe.runs, errors }).toEqual({ runs: ['ok'], errors: [] });
  });

  it('does not run when a module after server-time fails its complete_start', async () => {
    const probe = probe_instance(0, (storage) => {
      // `storage.complete_start()` comes after `server-time`'s and fails server start on a second registration.
      storage.register_table(PROBE_TABLE, 'game', [{ name: 'id', type: 'int32' }], ['id'], null, null);
    });
    const result = await probe.instance.start();
    expect(result).toMatch(/server_time_probe is registered twice/);
    await real_wait(200);
    expect(probe.runs).toEqual([]);
  });

  it('does not run when listening fails after every complete_start', async () => {
    const holder = await taken_port();
    try {
      const probe = probe_instance(holder.port);
      expect(typeof (await probe.instance.start())).toBe('string');
      await real_wait(200);
      expect(probe.runs).toEqual([]);
    } finally {
      await holder.close();
    }
  });
});
