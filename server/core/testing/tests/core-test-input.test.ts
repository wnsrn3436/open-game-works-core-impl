import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import * as GameContract from '../../../generated/contract/game_contract.ts';
import { create_server, type ServerInstance } from '../../routing/index.ts';
import type { RequestCtx } from '../../storage/index.ts';
import {
  connect_server,
  core_test_register,
  core_test_register_dev,
  core_test_server_paths,
  db_kind_of,
  default_db_kind,
  login,
  new_core_test_server_input,
  send,
  start_peer_server,
  start_test_server,
  stop_test_server,
  StartFailure,
} from '../dev/index.ts';
import { list_databases } from '../dev/database.ts';
import { added, error_code } from './helpers.ts';

interface RegisterCore {
  readonly routing: { register_handler(name: string, handler: (ctx: RequestCtx) => unknown): void };
}

/** A `register` that calls `core_test_register` with `not_registered` and registers its own `RunCoreTest` handler when `own` is given. */
function register_with(not_registered: readonly string[] | undefined, own: (() => unknown) | null): (core: Readonly<Record<string, unknown>>) => void {
  return (core) => {
    core_test_register(core, not_registered);
    if (own !== null) (core as unknown as RegisterCore).routing.register_handler('RunCoreTest', own);
  };
}

describe('core_test_register', () => {
  it('registers an empty response handler for each service Game rpc when given no name list', async () => {
    const server = await start_test_server(undefined, undefined, undefined, undefined, undefined, undefined, register_with(undefined, null));
    try {
      const result = await send(await login(server, 'defaults'), 'RunCoreTest', new GameContract.RunCoreTestRequest());
      expect(error_code(result)).toBe(0);
      expect(result.response).toBeInstanceOf(GameContract.RunCoreTestResponse);
    } finally {
      await stop_test_server(server);
    }
  });

  it('does not register the handler of an rpc in the name list: the test register handles it, and without it server start fails', async () => {
    let runs = 0;
    const own = (): unknown => {
      runs += 1;
      return GameContract.GameError.GAME_ERROR_CORE_TEST;
    };
    const server = await start_test_server(undefined, undefined, undefined, undefined, undefined, undefined, register_with(['RunCoreTest'], own));
    try {
      const result = await send(await login(server, 'own'), 'RunCoreTest', new GameContract.RunCoreTestRequest());
      expect(error_code(result)).toBe(GameContract.GameError.GAME_ERROR_CORE_TEST);
      expect(runs).toBe(1);
    } finally {
      await stop_test_server(server);
    }
    const unhandled = start_test_server(undefined, undefined, undefined, undefined, undefined, undefined, register_with(['RunCoreTest'], null));
    await expect(unhandled).rejects.toThrow(StartFailure);
    await expect(unhandled).rejects.toThrow(/rpc RunCoreTest of service Game has no handler/);
  });

  it('registers the rpc of a test register a second time without the name list, so server start fails', async () => {
    const twice = start_test_server(undefined, undefined, undefined, undefined, undefined, undefined, register_with(undefined, () => new GameContract.RunCoreTestResponse()));
    await expect(twice).rejects.toThrow(/register_handler: RunCoreTest is registered twice/);
  });
});

/** Runs `fn` with an environment variable set, or removed when `value` is undefined, awaits it, then puts the variable back. */
async function with_env<T>(name: string, value: string | undefined, fn: () => Promise<T>): Promise<T> {
  const saved = process.env[name];
  if (value === undefined) Reflect.deleteProperty(process.env, name);
  else process.env[name] = value;
  try {
    return await fn();
  } finally {
    if (saved === undefined) Reflect.deleteProperty(process.env, name);
    else process.env[name] = saved;
  }
}

/** The temporary folders of the `new_core_test_server_input` test DBs of this process. */
function input_folders(): string[] {
  const prefix = `ogw-core-test-db-${String(process.pid)}-`;
  return readdirSync(tmpdir()).filter((name) => name.startsWith(prefix)).sort();
}

/** The server core modules of a checkout `server/`: the module folders with an entry file (`server-core` `## folder`). */
function core_modules(server_root: string): string[] {
  const core = join(server_root, 'core');
  return readdirSync(core, { withFileTypes: true })
    .filter((e) => e.isDirectory() && (existsSync(join(core, e.name, 'index.ts')) || existsSync(join(core, e.name, 'dev', 'index.ts'))))
    .map((e) => e.name)
    .sort();
}

describe('new_core_test_server_input', () => {
  it.each(['sqlite', 'postgresql'] as const)('gives a new %s test DB and a server start input that routing.create_server starts on; drop removes the DB', async (kind) => {
    const before = await list_databases();
    const input = await new_core_test_server_input(kind);
    const other = await new_core_test_server_input(kind);
    const folder = mkdtempSync(join(tmpdir(), 'testing-core-test-input-'));
    let instance: ServerInstance | null = null;
    try {
      expect(input.database.kind).toBe(kind);
      expect(input.database.name).not.toBe(other.database.name);
      expect(input.secrets.file.accessTokenKey).not.toBe(other.secrets.file.accessTokenKey);
      expect(input.secrets.dev_access).toBe(input.secrets.file.devAccess);
      if (kind === 'postgresql') {
        expect(input.database.db_argument).toBe('postgresql');
        expect(input.database.connection).not.toBeNull();
        expect(input.secrets.file.db).toBe(input.database.connection);
        expect(await list_databases()).toContain(input.database.name);
      } else {
        expect(input.database.connection).toBeNull();
        expect(input.database.db_argument).toBe(input.database.name);
        expect(input.secrets.file.db).toBeUndefined();
      }
      const core_settings = JSON.parse(readFileSync(join(input.server_root, '..', 'settings', 'core-settings.json'), 'utf8')) as Record<string, unknown>;
      for (const [key, value] of Object.entries(core_settings)) expect(input.settings[key], key).toEqual(value);
      expect(input.server_modules).toEqual(core_modules(input.server_root));
      expect(existsSync(join(input.data_folder, 'client_data_version'))).toBe(true);
      expect(input.register).toBe(core_test_register);
      expect(input.registerDev).toBe(core_test_register_dev);
      expect(existsSync(join(input.server_root, 'core', 'testing', 'dev', 'index.ts'))).toBe(true);

      const secret_file = join(folder, 'secrets.json');
      writeFileSync(secret_file, JSON.stringify(input.secrets.file), { mode: 0o600 });
      instance = create_server({
        args: { env: 'LOCAL', port: 0, matchmaker: false, db: input.database.db_argument, secret_file },
        server_modules: input.server_modules,
        data_folder: input.data_folder,
        core_settings: input.settings,
        game_settings: {},
        register: input.register,
        dev: true,
        register_dev: input.registerDev,
        log_writer: () => undefined,
      });
      const port = await instance.start();
      expect(typeof port).toBe('number');
      if (kind === 'sqlite') expect(existsSync(input.database.db_argument)).toBe(true);
      const remote = await connect_server(`http://127.0.0.1:${String(port)}`, input.data_folder, input.secrets.dev_access);
      const result = await send(await login(remote, 'direct'), 'RunCoreTest', new GameContract.RunCoreTestRequest());
      expect(error_code(result)).toBe(0);
      await instance.stop();
      instance = null;
    } finally {
      await instance?.stop();
      await input.drop();
      await other.drop();
      rmSync(folder, { recursive: true, force: true });
    }
    if (kind === 'sqlite') expect(existsSync(dirname(input.database.db_argument))).toBe(false);
    const after = await list_databases();
    expect(after).not.toContain(input.database.name);
    expect(after.filter((name) => !before.includes(name))).toEqual([]);
  });

  it.each(['sqlite', 'postgresql'] as const)('makes no %s test DB and no folder when an input it reads is missing or broken', async (kind) => {
    const scratch = mkdtempSync(join(tmpdir(), 'testing-core-test-input-broken-'));
    try {
      const modules_file = join(scratch, 'modules.json');
      writeFileSync(modules_file, '{"not": "a list"}');
      const broken: readonly (readonly [string, string, RegExp])[] = [
        ['OGW_SERVER_DATA', join(scratch, 'missing'), /the server build data folder .* does not exist/],
        ['OGW_SERVER_MODULES', modules_file, /is not a JSON array of module names/],
      ];
      for (const [name, value, message] of broken) {
        const databases = await list_databases();
        const folders = input_folders();
        await expect(with_env(name, value, () => new_core_test_server_input(kind)), name).rejects.toThrow(message);
        expect(added(databases, await list_databases()), name).toEqual([]);
        expect(added(folders, input_folders()), name).toEqual([]);
      }
    } finally {
      rmSync(scratch, { recursive: true, force: true });
    }
  });

  it('throws and leaves no folder or postgresql test DB when making the DB fails', async () => {
    const failing: readonly (readonly [string | undefined, RegExp])[] = [
      [undefined, /OGW_POSTGRESQL/],
      // A PostgreSQL that does not listen: the folder is made, then CREATE DATABASE cannot connect.
      ['postgresql://postgres@127.0.0.1:1/postgres', /ECONNREFUSED/],
    ];
    for (const [value, message] of failing) {
      const label = value ?? 'no OGW_POSTGRESQL';
      const databases = await list_databases();
      const folders = input_folders();
      await expect(with_env('OGW_POSTGRESQL', value, () => new_core_test_server_input('postgresql')), label).rejects.toThrow(message);
      expect(added(databases, await list_databases()), label).toEqual([]);
      expect(added(folders, input_folders()), label).toEqual([]);
    }
  });
});

describe('new_core_test_server_input without a DB kind', () => {
  it.each(['sqlite', 'postgresql'] as const)('makes a test DB of OGW_DEFAULT_DB %s and gives that kind back', async (kind) => {
    const before = await list_databases();
    const input = await with_env('OGW_DEFAULT_DB', kind, () => new_core_test_server_input());
    try {
      expect(input.kind).toBe(kind);
      expect(input.database.kind).toBe(kind);
      if (kind === 'postgresql') expect(added(before, await list_databases())).toEqual([input.database.name]);
      else expect(input.database.connection).toBeNull();
    } finally {
      await input.drop();
    }
    expect(added(before, await list_databases())).toEqual([]);
  });

  it('gives the DB kind it was given, whatever OGW_DEFAULT_DB is', async () => {
    const input = await with_env('OGW_DEFAULT_DB', 'postgresql', () => new_core_test_server_input('sqlite'));
    try {
      expect(input.kind).toBe('sqlite');
      expect(input.database.connection).toBeNull();
    } finally {
      await input.drop();
    }
  });

  it('throws and makes no folder or DB when OGW_DEFAULT_DB is not sqlite or postgresql', async () => {
    const databases = await list_databases();
    const folders = input_folders();
    await expect(with_env('OGW_DEFAULT_DB', 'mysql', () => new_core_test_server_input())).rejects.toThrow(/OGW_DEFAULT_DB/);
    expect(added(databases, await list_databases())).toEqual([]);
    expect(added(folders, input_folders())).toEqual([]);
  });
});

describe('core_test_server_paths', () => {
  it('gives the core settings defaults, the server module list, the server build data folder and the server root of new_core_test_server_input, and makes no folder or DB', async () => {
    const databases = await list_databases();
    const folders = input_folders();
    const paths = core_test_server_paths();
    expect(added(databases, await list_databases())).toEqual([]);
    expect(added(folders, input_folders())).toEqual([]);
    const input = await new_core_test_server_input('sqlite');
    try {
      expect(paths.settings).toEqual(input.settings);
      expect(paths.server_modules).toEqual(input.server_modules);
      expect(paths.data_folder).toBe(input.data_folder);
      expect(paths.server_root).toBe(input.server_root);
    } finally {
      await input.drop();
    }
    expect(Object.keys(paths).sort()).toEqual(['data_folder', 'server_modules', 'server_root', 'settings']);
  });

  it('throws when an input it reads is missing', () => {
    const saved = process.env.OGW_SERVER_DATA;
    process.env.OGW_SERVER_DATA = join(tmpdir(), 'testing-core-test-paths-missing');
    try {
      expect(() => core_test_server_paths()).toThrow(/the server build data folder .* does not exist/);
    } finally {
      if (saved === undefined) Reflect.deleteProperty(process.env, 'OGW_SERVER_DATA');
      else process.env.OGW_SERVER_DATA = saved;
    }
  });
});

describe('default_db_kind', () => {
  it('gives the OGW_DEFAULT_DB kind, and makes no folder or DB', async () => {
    for (const kind of ['sqlite', 'postgresql'] as const) {
      const databases = await list_databases();
      const folders = input_folders();
      expect(await with_env('OGW_DEFAULT_DB', kind, () => Promise.resolve(default_db_kind())), kind).toBe(kind);
      expect(added(databases, await list_databases()), kind).toEqual([]);
      expect(added(folders, input_folders()), kind).toEqual([]);
    }
  });

  it('gives the DB kind of a test server started without one', async () => {
    const server = await start_test_server();
    try {
      expect(default_db_kind()).toBe(db_kind_of(server));
    } finally {
      await stop_test_server(server);
    }
  });

  it('throws when OGW_DEFAULT_DB is not sqlite or postgresql', async () => {
    await expect(with_env('OGW_DEFAULT_DB', 'mysql', () => Promise.resolve().then(() => default_db_kind()))).rejects.toThrow(/OGW_DEFAULT_DB/);
  });
});

describe('db_kind_of', () => {
  it.each(['sqlite', 'postgresql'] as const)('gives %s for a test server started on it, and for its peer', async (kind) => {
    const server = await start_test_server(undefined, kind);
    try {
      expect(db_kind_of(server)).toBe(kind);
      const peer = await start_peer_server(server);
      expect(db_kind_of(peer)).toBe(kind);
    } finally {
      await stop_test_server(server);
    }
  });

  it('gives the OGW_DEFAULT_DB kind for a test server started without a DB kind', async () => {
    for (const kind of ['sqlite', 'postgresql'] as const) {
      const server = await with_env('OGW_DEFAULT_DB', kind, () => start_test_server());
      try {
        expect(db_kind_of(server), kind).toBe(kind);
      } finally {
        await stop_test_server(server);
      }
    }
  });

  it('throws for a remote test server, whose DB the test does not know', async () => {
    const server = await start_test_server();
    try {
      const remote = await connect_server(server.url, server.shared.data_folder, server.dev_access);
      expect(() => db_kind_of(remote)).toThrow(/remote test server/);
    } finally {
      await stop_test_server(server);
    }
  });
});
