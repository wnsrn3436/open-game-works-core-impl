import { spawn } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { connect_server, login, type RemoteServer } from '../dev/index.ts';
import { base_settings, SERVER_ROOT, server_module_list } from '../dev/runner_input.ts';
import { new_secrets } from '../dev/secrets.ts';
import { real_wait, resync, seeds_by_request } from './helpers.ts';

async function free_port(): Promise<number> {
  const probe = createServer();
  await new Promise<void>((resolve) => {
    probe.listen(0, '127.0.0.1', resolve);
  });
  const address = probe.address();
  await new Promise<void>((resolve) => {
    probe.close(() => {
      resolve();
    });
  });
  if (address === null || typeof address === 'string') throw new Error('no port');
  return address.port;
}

async function connect_when_up(url: string, dev_access: string): Promise<RemoteServer> {
  for (let i = 0; ; i += 1) {
    try {
      return await connect_server(url, process.env.OGW_SERVER_DATA ?? '', dev_access);
    } catch (error) {
      if (i >= 100) throw error;
      await real_wait(100);
    }
  }
}

/**
 * The content `register` of the game the server process runs: `core_test_register` of the copied `server/`, so that
 * the process registers what a test server of a server core test registers.
 */
const MAIN_TS = `export { core_test_register as register } from './core/testing/dev/index.ts';
`;

/**
 * A game `server/` in `folder`: the core's `server/` with the generated files of a game (`server_modules.json`,
 * `core_settings.json`), the content `server/main.ts`, and the server build data in `build/data/`.
 */
function game_server(folder: string): string {
  const server = join(folder, 'server');
  cpSync(SERVER_ROOT, server, { recursive: true, filter: (source) => !source.includes('node_modules') && !source.includes(join('server', 'build')) });
  writeFileSync(join(server, 'generated', 'server_modules.json'), JSON.stringify(server_module_list()));
  writeFileSync(join(server, 'generated', 'core_settings.json'), JSON.stringify(base_settings()));
  writeFileSync(join(server, 'main.ts'), MAIN_TS);
  mkdirSync(join(server, 'build'), { recursive: true });
  symlinkSync(process.env.OGW_SERVER_DATA ?? '', join(server, 'build', 'data'));
  return server;
}

/** The server log lines a server process wrote to stdout so far, parsed. */
function log_lines(stdout: readonly string[]): Record<string, unknown>[] {
  return stdout
    .join('')
    .split('\n')
    // The last part is a line the process has not ended yet.
    .slice(0, -1)
    .filter((line) => line.startsWith('{'))
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

/** The `seed` of the `request` log line of each request ID, once the server process wrote all of them. */
async function request_seeds(stdout: readonly string[], request_ids: readonly string[]): Promise<Map<string, unknown>> {
  for (let i = 0; ; i += 1) {
    const seeds = seeds_by_request(log_lines(stdout));
    if (request_ids.every((id) => seeds.has(id)) || i >= 100) return seeds;
    await real_wait(50);
  }
}

describe('server process start point', () => {
  it('a server instance the server process start point runs takes no test clock and no seed', async () => {
    const folder = mkdtempSync(join(tmpdir(), 'testing-process-'));
    const secrets = new_secrets(null, []);
    writeFileSync(join(folder, 'secrets.json'), JSON.stringify(secrets.file), { mode: 0o600 });
    const port = await free_port();
    const child = spawn(process.execPath, ['core/start.ts', '--env', 'LOCAL', '--port', String(port), '--db', join(folder, 'server.db'), '--secret-file', join(folder, 'secrets.json')], {
      cwd: game_server(folder),
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    const stdout: string[] = [];
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      stdout.push(chunk);
    });
    try {
      const remote = await connect_when_up(`http://127.0.0.1:${String(port)}`, secrets.dev_access);
      const session = await login(remote, 'process_user');
      const time = (await resync(session)).envelope.server_time_at;
      // The system clock: the request time is now, not a test clock time.
      expect(Math.abs(Number(time) - Date.now())).toBeLessThan(60_000);
      // No seed designation: each request of the process's instance gets its own secure random seed.
      const request_ids = [randomUUID(), randomUUID(), randomUUID()];
      for (const id of request_ids) await resync(session, id);
      const seeds = await request_seeds(stdout, request_ids);
      const values = request_ids.map((id) => seeds.get(id));
      for (const value of values) expect(value).toMatch(/^-?[0-9]+$/);
      expect(new Set(values).size).toBe(request_ids.length);
    } finally {
      child.kill();
      rmSync(folder, { recursive: true, force: true });
    }
  });
});
