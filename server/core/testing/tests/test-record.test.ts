import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as CoreContract from '../../../generated/contract/core_contract.ts';
import * as GameContract from '../../../generated/contract/game_contract.ts';
import { core_test_register, login, restart_test_server, send, send_admin, start_test_server, stop_test_server, type TestServer } from '../dev/index.ts';

let folder = '';
let file = '';
const servers: TestServer[] = [];

beforeEach(() => {
  folder = mkdtempSync(join(tmpdir(), 'testing-record-'));
  file = join(folder, 'record.jsonl');
  process.env.OGW_TEST_RECORD = file;
});

afterEach(async () => {
  delete process.env.OGW_TEST_RECORD;
  for (const server of servers.splice(0)) await stop_test_server(server);
  rmSync(folder, { recursive: true, force: true });
});

/** The test record lines so far, read as JSON. */
function lines(): unknown[] {
  if (!existsSync(file)) return [];
  return readFileSync(file, 'utf8').split('\n').filter((line) => line !== '').map((line) => JSON.parse(line) as unknown);
}

/** What `RunCoreTest` of the test's `register` does next. */
let outcome: 'ok' | 'game_error' = 'ok';

/** `register` with `RunCoreTest` by `outcome` and one content admin operation `game_probe`. */
function register(core: Readonly<Record<string, unknown>>): void {
  const routing = core.routing as { register_handler(name: string, fn: unknown): void; register_admin_operation(operation: unknown): void };
  core_test_register(core, ['RunCoreTest']);
  routing.register_handler('RunCoreTest', () => (outcome === 'game_error' ? GameContract.GameError.GAME_ERROR_CORE_TEST : new GameContract.RunCoreTestResponse()));
  routing.register_admin_operation({ name: 'game_probe', role: 'read', body: 'json', input: {}, user_target: null, handler: () => ({}) });
}

async function start(): Promise<TestServer> {
  const server = await start_test_server(undefined, undefined, undefined, undefined, undefined, undefined, register);
  servers.push(server);
  return server;
}

function run_append(tag: string, count: number, length: number): Promise<number | null> {
  const main = fileURLToPath(new URL('./record_main.ts', import.meta.url));
  const child = spawn(process.execPath, [main, tag, String(count), String(length)], { stdio: 'ignore', env: { ...process.env, OGW_TEST_RECORD: file } });
  return new Promise((resolve) => child.once('exit', resolve));
}

describe('test record', () => {
  it('records admin_operation at start and restart, game_error of a GameError response only, and admin of send_admin', async () => {
    const server = await start();
    expect(lines()).toEqual([{ kind: 'admin_operation', operation: 'game_probe' }]);
    const session = await login(server, 'record_user');
    outcome = 'game_error';
    const failed = await send(session, 'RunCoreTest', new GameContract.RunCoreTestRequest());
    expect(failed.envelope.error?.code).toBe(GameContract.GameError.GAME_ERROR_CORE_TEST);
    outcome = 'ok';
    expect((await send(session, 'RunCoreTest', new GameContract.RunCoreTestRequest())).envelope.error).toBeNull();
    // A CoreError response: the request without its signature.
    const unsigned = await send(session, 'RunCoreTest', new GameContract.RunCoreTestRequest(), undefined, undefined, undefined, { 'X-Ogw-Signature': null });
    expect(unsigned.envelope.error?.code).toBeLessThan(1000);
    expect(unsigned.envelope.error?.code).toBe(CoreContract.CoreError.CORE_ERROR_UNAUTHORIZED);
    const admin = await send_admin(server, 'game_probe', {});
    await restart_test_server(server);
    expect(lines()).toEqual([
      { kind: 'admin_operation', operation: 'game_probe' },
      { kind: 'game_error', request: 'RunCoreTest', error: 'GAME_ERROR_CORE_TEST' },
      { kind: 'admin', operation: 'game_probe', status: admin.status },
      { kind: 'admin_operation', operation: 'game_probe' },
    ]);
  });

  it('the lines that two processes append together are each whole', async () => {
    const count = 2000;
    // Lines longer than a pipe buffer: a split write would mix them.
    await Promise.all([run_append('a', count, 9000), run_append('b', count, 9000)]);
    const read = lines() as { kind: string; operation: string }[];
    expect(read).toHaveLength(2 * count);
    expect(read.filter((line) => line.operation.startsWith('a')).length).toBe(count);
    expect(read.every((line) => line.kind === 'admin' && /^[ab]n{9000}$/.test(line.operation))).toBe(true);
  });

  it('writes no test record without OGW_TEST_RECORD', async () => {
    delete process.env.OGW_TEST_RECORD;
    const server = await start();
    const session = await login(server, 'no_record_user');
    outcome = 'game_error';
    await send(session, 'RunCoreTest', new GameContract.RunCoreTestRequest());
    outcome = 'ok';
    await send_admin(server, 'game_probe', {});
    expect(existsSync(file)).toBe(false);
  });
});
