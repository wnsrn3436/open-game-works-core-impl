/**
 * Helpers of the `start_local_server` tests: a game `server/` folder made from the core's `server/` with the generated
 * files, the server build data of the core test data and a test `main.ts`, a new test DB, and a `node` process that
 * calls `start_local_server` there with its stdout log lines.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { core_test_server_paths, new_core_test_server_input, type CoreTestServerInput, type DbKind } from '../dev/index.ts';

const paths = core_test_server_paths();

/**
 * The content `main.ts`: `RunCoreTest` throws on its first call when `OGW_TEST_FAIL_FIRST` is `1`, and otherwise returns
 * an empty response; the other `service Game` `rpc`s return an empty response.
 */
const MAIN_TS = `import * as GameContract from './generated/contract/game_contract.ts';
import { core_test_register } from './core/testing/dev/index.ts';

let calls = 0;

export function register(core) {
  core_test_register(core, ['RunCoreTest']);
  core.routing.register_handler('RunCoreTest', () => {
    calls += 1;
    if (calls === 1 && process.env.OGW_TEST_FAIL_FIRST === '1') throw new Error('RunCoreTest fails on its first call on purpose');
    return new GameContract.RunCoreTestResponse();
  });
}
`;

/** The driver: calls `start_local_server` with the JSON arguments and the random base, and prints a failure. */
const DRIVER_TS = `import { start_local_server } from './core/testing/dev/index.ts';

try {
  await start_local_server(JSON.parse(process.argv[2]), BigInt(process.argv[3]));
  process.stdout.write(JSON.stringify({ driver: 'stopped' }) + '\\n');
} catch (error) {
  process.stdout.write(JSON.stringify({ driver: 'failed', name: error?.constructor?.name ?? null, message: String(error?.message ?? error) }) + '\\n');
  process.exitCode = 1;
}
`;

/** A game `server/` folder with its test DB and secret file. */
export interface LocalGame {
  readonly server: string;
  readonly secret_file: string;
  readonly input: CoreTestServerInput;
  remove(): Promise<void>;
}

/** A game `server/` in a new folder, with a new test DB of `kind`; `settings` go over the core test settings. */
export async function local_game(kind: DbKind, settings: Readonly<Record<string, unknown>> = {}): Promise<LocalGame> {
  const folder = mkdtempSync(join(tmpdir(), 'testing-local-'));
  const server = join(folder, 'server');
  cpSync(paths.server_root, server, { recursive: true, filter: (source) => !source.includes('node_modules') && !source.includes(join('server', 'build')) });
  writeFileSync(join(server, 'generated', 'server_modules.json'), JSON.stringify(paths.server_modules));
  writeFileSync(join(server, 'generated', 'core_settings.json'), JSON.stringify({ ...paths.settings, ...settings }));
  writeFileSync(join(server, 'main.ts'), MAIN_TS);
  writeFileSync(join(server, 'driver.ts'), DRIVER_TS);
  mkdirSync(join(server, 'build'), { recursive: true });
  symlinkSync(paths.data_folder, join(server, 'build', 'data'));
  let input: CoreTestServerInput;
  try {
    input = await new_core_test_server_input(kind);
  } catch (error) {
    rmSync(folder, { recursive: true, force: true });
    throw error;
  }
  const secret_file = join(folder, 'secrets.json');
  writeFileSync(secret_file, JSON.stringify(input.secrets.file));
  return {
    server,
    secret_file,
    input,
    remove: async () => {
      try {
        await input.drop();
      } finally {
        rmSync(folder, { recursive: true, force: true });
      }
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

/** The server start arguments of a LOCAL server of a game folder on `port`. */
export function local_args(game: LocalGame, port: number): string[] {
  return ['--env', 'LOCAL', '--port', String(port), '--db', game.input.database.db_argument, '--secret-file', game.secret_file];
}

/** A running `node` process of the driver. */
export interface LocalProcess {
  readonly child: ChildProcess;
  /** The stdout lines that are JSON objects, so far. */
  lines(): Record<string, unknown>[];
  /** Waits until a line matches, for at most `timeout_ms` of real time. */
  wait_line(match: (line: Record<string, unknown>) => boolean, timeout_ms?: number): Promise<Record<string, unknown>>;
  readonly exited: Promise<number | null>;
  /** Ends the process if it still runs. */
  kill(): Promise<void>;
}

/** Starts `node driver.ts <args> <random base>` in the game folder. */
export function run_local(game: LocalGame, args: readonly string[], random_base: bigint, env: Readonly<Record<string, string>> = {}): LocalProcess {
  const child = spawn(process.execPath, ['driver.ts', JSON.stringify(args), String(random_base)], { cwd: game.server, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, ...env } });
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
  let ended = false;
  const exited = new Promise<number | null>((resolve) => {
    child.once('close', (code) => {
      ended = true;
      resolve(code);
    });
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
  // Each new stdout chunk or the exit checks the waiting matches again; no real time poll.
  const wait_line = (match: (line: Record<string, unknown>) => boolean, timeout_ms = 60_000): Promise<Record<string, unknown>> =>
    new Promise((resolve, reject) => {
      const check = (): boolean => {
        const found = lines().find(match);
        if (found !== undefined) {
          finish();
          resolve(found);
          return true;
        }
        if (ended) {
          finish();
          reject(new Error(`the process ended without the line; stderr: ${errors}`));
          return true;
        }
        return false;
      };
      const timer = setTimeout(() => {
        finish();
        reject(new Error(`no matching line within ${String(timeout_ms)} ms; stderr: ${errors}`));
      }, timeout_ms);
      const on_data = (): void => {
        check();
      };
      const finish = (): void => {
        clearTimeout(timer);
        child.stdout.off('data', on_data);
        child.off('close', on_data);
      };
      if (check()) return;
      child.stdout.on('data', on_data);
      child.on('close', on_data);
    });
  return {
    child,
    lines,
    wait_line,
    exited,
    kill: async () => {
      if (ended) return;
      child.kill('SIGKILL');
      await exited;
    },
  };
}

/**
 * Waits until the server of a process answers `GET /update/deploy_list.json` on `port`, for at most `timeout_ms` of
 * real time: `start_local_server` writes no line when it listens, so the test asks the port. Gives the HTTP status.
 */
export async function wait_listening(process_: LocalProcess, port: number, timeout_ms = 60_000): Promise<number> {
  const state = { ended: false };
  void process_.exited.then(() => {
    state.ended = true;
  });
  const started = Date.now();
  for (;;) {
    try {
      const reply = await fetch(`http://127.0.0.1:${String(port)}/update/deploy_list.json`);
      await reply.arrayBuffer();
      return reply.status;
    } catch {
      // Not listening yet.
    }
    if (state.ended) throw new Error(`the process ended before it listened: ${JSON.stringify(process_.lines())}`);
    if (Date.now() - started > timeout_ms) throw new Error(`the process did not listen on ${String(port)} within ${String(timeout_ms)} ms`);
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}
