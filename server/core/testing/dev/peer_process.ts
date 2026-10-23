/**
 * `start_peer_process` and `stop_peer_processes`: a server instance in a process of its own on the DB of a test
 * server. It is `routing.create_server` with the test server's DB, secret file, settings, server module list and server
 * build data, the test clock at the test server's time, and a content `register` that a test module makes. It makes a
 * new fake adapter for each fake adapter key of the test server: what the test server's `fake` controller sets does
 * not reach it, and its fake adapter calls are not in that controller's `calls()`. A hook of that `register` can wait at a gate until the test opens it: the request stays in its transaction,
 * holding its locks, while the test process and the other processes go on. A server instance of the test process
 * cannot do that, because its transaction body runs on the thread that would have to open the gate.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { RegisterFunction } from '../../routing/index.ts';
import { network_time_limit } from '../../server-time/network_time_limit.ts';
import { real_delay } from './real_time.ts';
import { connect_server, type RemoteServer } from './request.ts';
import type { SettingsValues } from './runner_input.ts';
import type { ServerInstance } from './server_binding.ts';
import type { TestServer } from './test_server.ts';

/** How long a gate and a reached gate are waited for before the wait fails. Real time. */
const GATE_WAIT_MS = 20_000;

/** What the content `register` maker of a peer process gets. */
export interface PeerContext {
  /**
   * Waits until the test opens the gate `name`. Before it waits it marks the gate reached with `note`, which the
   * test reads from `reached`. A hook is synchronous, so the wait blocks the peer process's thread.
   */
  wait(name: string, note?: string): void;
  /** `modules` of the peer's server instance, once it has started. */
  modules(): ReturnType<ServerInstance['modules']>;
}

/** A module export that makes the content `register` of a peer process. */
export type PeerRegister = (peer: PeerContext) => RegisterFunction;

/** The module export of a `PeerRegister`: the module URL and the export name. */
export interface PeerRegisterExport {
  readonly module: URL;
  readonly name: string;
}

/** The input of the peer process entry, written to a JSON file. */
export interface PeerConfig {
  readonly db_argument: string;
  readonly secret_file: string;
  readonly server_modules: readonly string[];
  readonly data_folder: string;
  readonly settings: SettingsValues;
  readonly overrides: SettingsValues;
  /** The adapter keys of the test server that have a fake adapter: the peer makes a new one for each. */
  readonly fake_keys: readonly string[];
  /** The test clock time of the peer at its start, as a decimal string. */
  readonly start_at: string;
  /** `testing.backgroundWaitTimeoutMs` of the test server, as a decimal string. */
  readonly background_wait_ms: string;
  /** The module file of the `register` maker and its export name. */
  readonly register_module: string;
  readonly register_name: string;
  /** The folder of the gate files. */
  readonly folder: string;
}

/** A peer process: `remote` sends requests to its server instance, `reached` and `open` drive its gates. */
export interface PeerProcess extends Gates {
  readonly remote: RemoteServer;
  /** Stops the peer process and removes its folder. */
  stop(): Promise<void>;
}

const ENTRY = fileURLToPath(new URL('./peer_process_main.ts', import.meta.url));

/** The `stop` of each peer process still running. */
const running = new Set<() => Promise<void>>();

/** The file that marks the gate `name` reached, and the file that opens it. */
function gate_files(folder: string, name: string): { reached: string; open: string } {
  if (!/^[A-Za-z0-9_-]+$/.test(name)) throw new Error(`testing: peer gate name ${JSON.stringify(name)} is not a file name`);
  return { reached: join(folder, `${name}.reached`), open: join(folder, `${name}.open`) };
}

const sleeper = new Int32Array(new SharedArrayBuffer(4));

/**
 * In a peer process: marks the gate `name` of `folder` reached with `note`, then waits until the test opens it. The
 * note is written to a temporary file that is then renamed: the reached file exists only with the whole note.
 */
export function wait_at_gate(folder: string, name: string, note = ''): void {
  const files = gate_files(folder, name);
  const writing = `${files.reached}.writing`;
  writeFileSync(writing, note);
  renameSync(writing, files.reached);
  for (let waited = 0; !existsSync(files.open); waited += 5) {
    if (waited >= GATE_WAIT_MS) throw new Error(`testing: the test did not open gate ${name}`);
    Atomics.wait(sleeper, 0, 0, 5);
  }
}

/** The test process side of the gates of `folder`. */
export interface Gates {
  /** Resolves with the note of the gate once the process waits at it. */
  reached(name: string): Promise<string>;
  /** Lets the process go on at the gate; a process that reaches it later does not wait. */
  open(name: string): void;
}

/** The gates of `folder` of a process that waits at them with `wait_at_gate`; `alive` is false once it exited. */
export function gates_of(folder: string, alive: () => boolean, process_name: string): Gates {
  return {
    reached: async (name) => {
      const file = gate_files(folder, name).reached;
      const limit = network_time_limit(BigInt(GATE_WAIT_MS));
      while (!existsSync(file)) {
        if (!alive()) throw new Error(`testing: ${process_name} exited before it reached gate ${name}`);
        if (limit.aborted) throw new Error(`testing: ${process_name} did not reach gate ${name}`);
        await real_delay(5n);
      }
      return readFileSync(file, 'utf8');
    },
    open: (name) => {
      writeFileSync(gate_files(folder, name).open, '');
    },
  };
}

/** The port the peer process sends once its server instance has started, or the failure of its start. */
function ready(child: ChildProcess): Promise<number> {
  return new Promise((resolve, reject) => {
    child.once('message', (message: { port?: unknown; error?: unknown }) => {
      if (typeof message.port === 'number') resolve(message.port);
      else reject(new Error(`testing: the peer process did not start: ${String(message.error)}`));
    });
    child.once('exit', (code) => {
      reject(new Error(`testing: the peer process exited with ${String(code)} before it started`));
    });
  });
}

/**
 * `start_peer_process`: a peer process of a PostgreSQL `LOCAL` test server. `register` names the module export (a
 * `PeerRegister`) that makes the content `register` of the peer. It resolves once the server instance has started and
 * the job runs of its server start have ended.
 */
export async function start_peer_process(server: TestServer, register: PeerRegisterExport): Promise<PeerProcess> {
  server.running();
  const shared = server.shared;
  const clock = shared.test_clock;
  if (clock === null) throw new Error('testing: start_peer_process needs a LOCAL test server');
  if (shared.database.connection === null) throw new Error('testing: start_peer_process needs a PostgreSQL test server');
  if (Object.keys(shared.real_adapters).length > 0) throw new Error('testing: start_peer_process takes a test server without real adapters');
  const folder = mkdtempSync(join(tmpdir(), 'ogw-peer-'));
  const settings = server.settings();
  const config: PeerConfig = {
    db_argument: shared.database.db_argument,
    secret_file: shared.secret_file,
    server_modules: shared.server_modules,
    data_folder: shared.data_folder,
    settings: shared.settings,
    overrides: shared.overrides,
    fake_keys: [...shared.fakes.keys()],
    start_at: String(clock.now()),
    background_wait_ms: String(settings['testing.backgroundWaitTimeoutMs']),
    register_module: fileURLToPath(register.module),
    register_name: register.name,
    folder,
  };
  const config_file = join(folder, 'config.json');
  writeFileSync(config_file, JSON.stringify(config));
  const child = spawn(process.execPath, [ENTRY, config_file], { stdio: ['ignore', 'ignore', 'inherit', 'ipc'] });
  let exited = false;
  child.once('exit', () => {
    exited = true;
  });
  const stop = async (): Promise<void> => {
    running.delete(stop);
    if (!exited) {
      const gone = new Promise<void>((resolve) => {
        child.once('exit', () => {
          resolve();
        });
      });
      child.kill();
      await gone;
    }
    rmSync(folder, { recursive: true, force: true });
  };
  running.add(stop);
  let remote: RemoteServer;
  try {
    const port = await ready(child);
    remote = await connect_server(`http://127.0.0.1:${String(port)}`, shared.data_folder, server.dev_access);
  } catch (error) {
    await stop();
    throw error;
  }
  return {
    remote,
    ...gates_of(folder, () => !exited, 'the peer process'),
    stop,
  };
}

/** `stop_peer_processes`: stops every peer process still running. A test file calls it at the end of each test. */
export async function stop_peer_processes(): Promise<void> {
  await Promise.all([...running].map((stop) => stop()));
}
