/**
 * Helpers of the server process tests (`### server process`, `### ops path`): a game `server/` folder made from the
 * core's `server/`, the server process started with the server process entry point `core/start.ts` or with a driver
 * that calls `run_server_process` and prints its output, its stdout log lines, and the ops paths.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { core_test_server_paths, new_core_test_server_input, type CoreTestServerInput } from '../../testing/dev/index.ts';
import { real_delay } from '../../testing/dev/real_time.ts';

const run_paths = core_test_server_paths();

/**
 * The content `server/main.ts` of the process tests. `RunCoreTest` writes a probe line with the thread and whether
 * that server instance was made with `--matchmaker`, then by `OGW_TEST_MODE`: `exit` ends its worker thread with exit
 * code 7, `lock` puts the game state row `CoreTestGameState` key 1. With `OGW_TEST_MODE` `flood`, the route
 * `GET /account/deletion` takes over an upgrade request: it writes `OGW_TEST_FLOOD_BYTES` bytes, ends the connection,
 * destroys it once the end is written, then writes the probe line `flood`.
 */
const MAIN_TS = `import { threadId, workerData } from 'node:worker_threads';
import * as GameContract from './generated/contract/game_contract.ts';
import { core_test_register } from './core/testing/dev/index.ts';

export function register(core) {
  core_test_register(core, ['RunCoreTest']);
  if (process.env.OGW_TEST_MODE === 'flood') {
    const auth = core.auth;
    const route = auth['GET /account/deletion'];
    auth['GET /account/deletion'] = (request, ip) => {
      if (request.upgrade === null) return route.call(auth, request, ip);
      const socket = request.upgrade.socket;
      socket.end(Buffer.alloc(Number(process.env.OGW_TEST_FLOOD_BYTES), 0x61), () => {
        socket.destroy();
        process.stdout.write(JSON.stringify({ probe: 'flood' }) + '\\n');
      });
      return null;
    };
  }
  core.routing.register_handler('RunCoreTest', (ctx) => {
    process.stdout.write(JSON.stringify({ probe: 'RunCoreTest', thread: threadId, matchmaker: workerData?.args?.matchmaker === true }) + '\\n');
    const mode = process.env.OGW_TEST_MODE ?? '';
    if (mode === 'exit') process.exit(7);
    if (mode === 'lock') {
      const row = new GameContract.CoreTestGameState();
      row.key = 1n;
      core.storage.put_game_state(ctx, row, 0n);
    }
    return new GameContract.RunCoreTestResponse();
  });
}
`;

/** The driver: calls `run_server_process` with the JSON argument and prints `{"driver": <output>}`. */
const DRIVER_TS = `import { run_server_process } from './core/routing/index.ts';

const result = await run_server_process(JSON.parse(process.argv[2]));
process.stdout.write(JSON.stringify({ driver: result }) + '\\n');
if (typeof result === 'string') process.exitCode = 1;
`;

/** A game `server/` folder of a process test, with its test DB and secret file. */
export interface GameServer {
  readonly server: string;
  readonly secret_file: string;
  readonly input: CoreTestServerInput;
  remove(): Promise<void>;
}

/**
 * A game `server/` in a new folder: the core's `server/` (DEV code included) with the generated files, the content
 * `server/main.ts` of the process tests, the server build data in `build/data/`, a new test DB of `kind`, and its
 * secret file. `settings` are set over the core test settings in `generated/core_settings.json`.
 */
export async function game_server(kind: 'sqlite' | 'postgresql', settings: Readonly<Record<string, unknown>> = {}): Promise<GameServer> {
  const folder = mkdtempSync(join(tmpdir(), 'routing-process-'));
  const server = join(folder, 'server');
  cpSync(run_paths.server_root, server, { recursive: true, filter: (source) => !source.includes('node_modules') && !source.includes(join('server', 'build')) });
  writeFileSync(join(server, 'generated', 'server_modules.json'), JSON.stringify(run_paths.server_modules));
  writeFileSync(join(server, 'generated', 'core_settings.json'), JSON.stringify({ ...run_paths.settings, ...settings }));
  writeFileSync(join(server, 'main.ts'), MAIN_TS);
  writeFileSync(join(server, 'driver.ts'), DRIVER_TS);
  mkdirSync(join(server, 'build'), { recursive: true });
  symlinkSync(run_paths.data_folder, join(server, 'build', 'data'));
  const input = await new_core_test_server_input(kind);
  const secret_file = join(folder, 'secrets.json');
  writeFileSync(secret_file, JSON.stringify(input.secrets.file));
  return {
    server,
    secret_file,
    input,
    remove: async () => {
      await input.drop();
      rmSync(folder, { recursive: true, force: true });
    },
  };
}

/** A port that was free on all addresses and on `127.0.0.1` when this returned. */
export async function free_port(): Promise<number> {
  const server = createServer();
  const port = await new Promise<number>((resolve) => {
    server.listen(0, () => {
      resolve((server.address() as { port: number }).port);
    });
  });
  await new Promise((resolve) => server.close(resolve));
  return port;
}

/** A running server process. */
export interface RunningProcess {
  readonly child: ChildProcess;
  /** The stdout lines that are JSON objects, so far. */
  lines(): Record<string, unknown>[];
  /** Waits until a line matches, for at most `timeout_ms` of real time. */
  wait_line(match: (line: Record<string, unknown>) => boolean, timeout_ms?: number): Promise<Record<string, unknown>>;
  /** The exit code, once the process ended. */
  readonly exited: Promise<number | null>;
  /** Ends the process if it still runs. */
  kill(): Promise<void>;
}

function run(server: string, argv: readonly string[], env: Readonly<Record<string, string>>): RunningProcess {
  const child = spawn(process.execPath, argv, { cwd: server, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, ...env } });
  let text = '';
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (chunk: string) => {
    text += chunk;
  });
  let errors = '';
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (chunk: string) => {
    errors = (errors + chunk).slice(-4000);
  });
  const exited = new Promise<number | null>((resolve) => {
    child.once('exit', (code) => {
      resolve(code);
    });
  });
  let ended = false;
  let exit_code: number | null = null;
  void exited.then((code) => {
    ended = true;
    exit_code = code;
  });
  const lines = (): Record<string, unknown>[] =>
    text
      .split('\n')
      .filter((line) => line.startsWith('{'))
      .flatMap((line) => {
        try {
          return [JSON.parse(line) as Record<string, unknown>];
        } catch {
          return [];
        }
      });
  return {
    child,
    lines,
    exited,
    wait_line: async (match, timeout_ms = 30_000) => {
      const started = Date.now();
      for (let waited = 0; waited < timeout_ms; waited += 20) {
        const found = lines().find(match);
        if (found !== undefined) return found;
        if (ended) break;
        await real_delay(20n);
      }
      const found = lines().find(match);
      if (found !== undefined) return found;
      const state = ended ? `ended with exit code ${String(exit_code)}` : 'still running';
      throw new Error(`no matching line after ${String(Date.now() - started)} ms, process ${state}; the lines: ${JSON.stringify(lines()).slice(0, 2000)}; stderr: ${errors}`);
    },
    kill: async () => {
      if (ended) return;
      child.kill('SIGKILL');
      await exited;
    },
  };
}

/** The server start arguments of a LOCAL server process of `game`. */
export function local_args(game: GameServer, extra: readonly string[] = []): string[] {
  return ['--env', 'LOCAL', '--db', game.input.database.db_argument, '--secret-file', game.secret_file, ...extra];
}

/** The server process started with the server process entry point `core/start.ts`. */
export function start_point(game: GameServer, args: readonly string[], env: Readonly<Record<string, string>> = {}): RunningProcess {
  return run(game.server, ['core/start.ts', ...args], env);
}

/** The output of `run_server_process` in a driver process. */
export type DriverOutput = { port: number; ops_port: number | null } | string;

/** A driver process that calls `run_server_process` with `args`; its output once it returned. */
export async function driver(game: GameServer, args: Readonly<Record<string, unknown>>, env: Readonly<Record<string, string>> = {}): Promise<{ process: RunningProcess; output: DriverOutput }> {
  const running = run(game.server, ['driver.ts', JSON.stringify({ env: 'LOCAL', db: game.input.database.db_argument, secret_file: game.secret_file, ...args })], env);
  const line = await running.wait_line((l) => 'driver' in l, 60_000);
  return { process: running, output: line.driver as DriverOutput };
}

/** A GET on `127.0.0.1:<port>`: the status, the `Content-Type` and the body text. */
export async function get(port: number, path: string): Promise<{ status: number; type: string | null; text: string }> {
  const response = await fetch(`http://127.0.0.1:${String(port)}${path}`);
  return { status: response.status, type: response.headers.get('content-type'), text: await response.text() };
}

/** Polls `check` every 20 ms of real time until it is true, for at most `timeout_ms`. */
export async function until(check: () => Promise<boolean> | boolean, timeout_ms = 20_000): Promise<void> {
  for (let waited = 0; waited < timeout_ms; waited += 20) {
    if (await check()) return;
    await real_delay(20n);
  }
  if (!(await check())) throw new Error('the condition did not hold in time');
}

/** True when a TCP connection to `127.0.0.1:<port>` is accepted. */
export async function accepts(port: number): Promise<boolean> {
  const { connect } = await import('node:net');
  return new Promise((resolve) => {
    const socket = connect(port, '127.0.0.1');
    socket.once('connect', () => {
      socket.destroy();
      resolve(true);
    });
    socket.once('error', () => {
      resolve(false);
    });
  });
}

/** The value of a sample in Prometheus text: `name` with the label text `labels` (e.g. `{a="b"}`), or null. */
export function sample(text: string, name: string, labels = ''): number | null {
  const line = text.split('\n').find((l) => l.startsWith(`${name}${labels} `));
  return line === undefined ? null : Number(line.slice(name.length + labels.length + 1));
}
