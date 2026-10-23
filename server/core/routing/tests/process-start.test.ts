import { spawn } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { core_test_server_paths } from '../../testing/dev/index.ts';

/** The server root, server module list, core settings defaults and server build data folder of this run. */
const run_paths = core_test_server_paths();

/**
 * A game `server/` in `folder`: the core's `server/` (core `dev/` folders and `server/dev/` included) with the
 * generated files the start point reads, a content `server/main.ts`, and the server build data in `build/data/`.
 */
function game_server(folder: string): string {
  const server = join(folder, 'server');
  cpSync(run_paths.server_root, server, { recursive: true, filter: (source) => !source.includes('node_modules') && !source.includes(join('server', 'build')) });
  writeFileSync(join(server, 'generated', 'server_modules.json'), JSON.stringify(run_paths.server_modules));
  writeFileSync(join(server, 'generated', 'core_settings.json'), JSON.stringify(run_paths.settings));
  writeFileSync(join(server, 'main.ts'), 'export function register() {}\n');
  mkdirSync(join(server, 'build'), { recursive: true });
  symlinkSync(run_paths.data_folder, join(server, 'build', 'data'));
  return server;
}

/** Removes every core module `dev/` folder of a game `server/`. */
function remove_core_dev(server: string): void {
  const core = join(server, 'core');
  for (const entry of readdirSync(core, { withFileTypes: true })) {
    if (entry.isDirectory() && existsSync(join(core, entry.name, 'dev'))) rmSync(join(core, entry.name, 'dev'), { recursive: true, force: true });
  }
}

/** Runs the server process start point and waits for it to exit: the exit code and the stdout lines that are JSON. */
function run_start_point(server: string, args: readonly string[]): Promise<{ code: number | null; lines: Record<string, unknown>[] }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['core/start.ts', ...args], { cwd: server, stdio: ['ignore', 'pipe', 'ignore'] });
    const chunks: string[] = [];
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      chunks.push(chunk);
    });
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error('the server process did not exit'));
    }, 30_000);
    child.once('exit', (code) => {
      clearTimeout(timer);
      const lines = chunks
        .join('')
        .split('\n')
        .filter((line) => line.startsWith('{'))
        .map((line) => JSON.parse(line) as Record<string, unknown>);
      resolve({ code, lines });
    });
  });
}

describe('server process start point', () => {
  it('does not start a server instance on --env STG or PROD when the server code has a core dev/ or server/dev/', async () => {
    const folder = mkdtempSync(join(tmpdir(), 'routing-process-start-'));
    try {
      const server = game_server(folder);
      const dev_code_log = (lines: readonly Record<string, unknown>[]): boolean => lines.some((line) => line.kind === 'error' && String(line.message).includes('DEV code'));
      for (const env of ['STG', 'PROD']) {
        const run = await run_start_point(server, ['--env', env, '--port', '0']);
        expect(run.code).toBe(1);
        expect(dev_code_log(run.lines)).toBe(true);
      }
      // Only server/dev/ is left: still DEV code.
      remove_core_dev(server);
      expect(existsSync(join(server, 'dev'))).toBe(true);
      const run = await run_start_point(server, ['--env', 'STG', '--port', '0']);
      expect(run.code).toBe(1);
      expect(dev_code_log(run.lines)).toBe(true);
    } finally {
      rmSync(folder, { recursive: true, force: true });
    }
  });
});
