/**
 * A `ServerReplay` match decided by a server instance whose server build data changed after the match was made. The
 * test helper restarts a test server with the same server build data only, so this test makes the server instances
 * with `routing.create_server` on one SQLite DB and reaches them with `connect_server`.
 */
import { randomBytes } from 'node:crypto';
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { create_server } from '../../routing/index.ts';
import { core_settings } from '../../storage/tests/helpers.ts';
import { connect_server, login } from '../../testing/dev/index.ts';
import { CLIENT_DATA_VERSION, Judge, data_folder, missing, log_bytes, mode, register_for, report, result_bytes, stop_all, version, type HookCall } from './helpers.ts';

const REPLAY = mode(7701, { result_rule: 'ServerReplay' });

interface SpecSetting {
  readonly key: string;
  readonly type: string;
  readonly source: string;
}

interface SpecModule {
  readonly name: string;
  readonly side: string;
  readonly settings: readonly SpecSetting[];
}

const IMPL = new URL('../../../../', import.meta.url);

function spec_modules(): SpecModule[] {
  const dir = new URL('core-spec/', IMPL);
  return readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => JSON.parse(readFileSync(new URL(f, dir), 'utf8')) as SpecModule)
    .filter((m) => m.side === 'server');
}

function empty_of(type: string): unknown {
  if (type.endsWith('?')) return null;
  if (type === 'string') return '';
  if (type === 'integer' || type === 'number') return 0;
  if (type === 'boolean') return false;
  if (type.startsWith('array<')) return [];
  return {};
}

function at_path(root: unknown, path: string): unknown {
  let value = root;
  for (const part of path.split('.')) {
    if (typeof value !== 'object' || value === null || !(part in value)) return undefined;
    value = (value as Record<string, unknown>)[part];
  }
  return value;
}

/** The game settings values core reads (`core` `## core settings`) from the core test data game settings. */
function game_settings(modules: readonly SpecModule[]): Record<string, unknown> {
  const game = JSON.parse(readFileSync(new URL('test-data/settings.json', IMPL), 'utf8')) as Record<string, unknown>;
  const environments = Object.keys(game['environments'] ?? {});
  const out: Record<string, unknown> = {};
  for (const setting of modules.flatMap((m) => m.settings)) {
    if (setting.source !== 'game') continue;
    const paths = setting.key.includes('<ENV>') ? environments.map((env) => setting.key.replace('<ENV>', env)) : [setting.key];
    for (const path of paths) out[path] = at_path(game, path) ?? empty_of(setting.type);
  }
  return out;
}

interface Direct {
  readonly url: string;
  create_test_match(user_ids: readonly bigint[]): Promise<string>;
  stop(): Promise<void>;
}

/** Writes the `--secret-file` of the server instances in `dir` and returns its dev access value. */
function write_secrets(dir: string): string {
  const dev_access = randomBytes(16).toString('hex');
  const seed = (): string => randomBytes(32).toString('base64');
  writeFileSync(
    join(dir, 'secrets.json'),
    JSON.stringify({ accessTokenKey: seed(), updateSigningKey: seed(), iapAccountToken: seed(), devAccess: dev_access, 'adminSecret.ogw': seed() }),
  );
  return dev_access;
}

/** A started matchmaker server instance on the SQLite DB of `dir` with the server build data `data`. */
async function start_direct(dir: string, data: string, register: (core: unknown) => void): Promise<Direct> {
  const modules = spec_modules().filter((m) => !missing(m.name));
  const instance = create_server({
    args: { env: 'LOCAL', port: 0, matchmaker: true, db: join(dir, 'server.db'), secret_file: join(dir, 'secrets.json') },
    server_modules: modules.map((m) => m.name).sort(),
    data_folder: data,
    core_settings: core_settings(),
    game_settings: game_settings(modules),
    register,
    dev: true,
    register_dev: () => undefined,
    log_writer: () => undefined,
  });
  const port = await instance.start();
  if (typeof port !== 'number') throw new Error(`server start failed: ${port}`);
  return {
    url: `http://127.0.0.1:${String(port)}`,
    create_test_match: async (user_ids) => {
      if (instance.dev === undefined) throw new Error('the server instance has no DEV code');
      return (await instance.dev('matchmaker', 'create_test_match', [REPLAY.id, user_ids, 5n])) as string;
    },
    stop: () => instance.stop(),
  };
}

describe('a ServerReplay match after the server build data changed', () => {
  let dir = '';

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'matchmaker-data-change-'));
  });

  afterEach(async () => {
    rmSync(dir, { recursive: true, force: true });
    await stop_all();
  });

  it('does not call replay_match for a record whose data_version is not the client_data_version of the server, even with the same logs', async () => {
    const calls: HookCall[] = [];
    const register = register_for({ replay: () => result_bytes(0), apply_mismatch: () => 'pass' }, calls, { core: null });
    const before = data_folder({ modes: [REPLAY], client_data_version: CLIENT_DATA_VERSION });
    const after = data_folder({ modes: [REPLAY], client_data_version: version('a', '2') });
    const dev_access = write_secrets(dir);

    const first = await start_direct(dir, before, register);
    const remote = await connect_server(first.url, before, dev_access);
    const a = await login(remote, 'matchmaker_data_a');
    const b = await login(remote, 'matchmaker_data_b');
    const id = await first.create_test_match([a.user_id, b.user_id]);
    await first.stop();

    const second = await start_direct(dir, after, register);
    const remote2 = await connect_server(second.url, after, dev_access);
    const a2 = await login(remote2, 'matchmaker_data_a');
    const b2 = await login(remote2, 'matchmaker_data_b');
    await report(a2, id, result_bytes(0), log_bytes([1]));
    expect((await report(b2, id, result_bytes(0), log_bytes([1]))).status).toBe(Judge.MATCH_JUDGE_STATUS_MISMATCH);
    expect(calls.filter((c) => c.hook === 'replay_match')).toEqual([]);
    await second.stop();
  });

  it('gives replay_match the server build data and data version of the server instance that decides', async () => {
    const calls: HookCall[] = [];
    const register = register_for({ replay: () => result_bytes(0), apply_result: () => 'pass' }, calls, { core: null });
    const made = data_folder({ modes: [REPLAY] });
    const deciding = data_folder({ modes: [REPLAY, mode(7702)] });
    writeFileSync(join(deciding, 'data_version'), `${version('f', 'f')}\n`);
    const dev_access = write_secrets(dir);

    const first = await start_direct(dir, made, register);
    const remote = await connect_server(first.url, made, dev_access);
    const a = await login(remote, 'matchmaker_data_c');
    const b = await login(remote, 'matchmaker_data_d');
    const id = await first.create_test_match([a.user_id, b.user_id]);
    await first.stop();

    const second = await start_direct(dir, deciding, register);
    const remote2 = await connect_server(second.url, deciding, dev_access);
    for (const name of ['matchmaker_data_c', 'matchmaker_data_d']) await report(await login(remote2, name), id, result_bytes(0), log_bytes([3]));
    const call = calls.find((c) => c.hook === 'replay_match');
    expect(call?.data_version).toBe(version('f', 'f'));
    expect(call?.data?.MatchModeTable.has_row(7702)).toBe(true);
    await second.stop();
  });
});
