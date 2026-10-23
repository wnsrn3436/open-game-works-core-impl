import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { ServerInstance } from '../../routing/server.ts';
import { advance_time, login, read_logs, read_user_state, restart_test_server, start_peer_server, start_test_server, StartFailure, stop_test_server, type TestServer } from '../dev/index.ts';
import { list_databases } from '../dev/database.ts';
import { added, drop_database, fail_next_stop, failing_stop, gold_of, listening_servers, resync, server_folders, set_gold, settled_listening } from './helpers.ts';

describe('isolation', () => {
  it('two test servers in one process do not see each other users, DB, clock and logs', async () => {
    const a = await start_test_server(1_000_000n);
    const b = await start_test_server(2_000_000n);
    try {
      const in_a = await login(a, 'same_name');
      const in_b = await login(b, 'same_name');
      await set_gold(a, in_a.user_id, 500n);
      expect(await gold_of(a, in_a.user_id)).toBe(500n);
      expect(await gold_of(b, in_b.user_id)).toBeNull();
      advance_time(a, 5_000n);
      const a_id = randomUUID();
      const b_id = randomUUID();
      expect((await resync(in_a, a_id)).envelope.server_time_at).toBe(1_005_000n);
      expect((await resync(in_b, b_id)).envelope.server_time_at).toBe(2_000_000n);
      const a_ids = read_logs(a, 'request').map((l) => l.request_id);
      const b_ids = read_logs(b, 'request').map((l) => l.request_id);
      expect(a_ids).toContain(a_id);
      expect(a_ids).not.toContain(b_id);
      expect(b_ids).toContain(b_id);
      expect(b_ids).not.toContain(a_id);
    } finally {
      await stop_test_server(a);
      await stop_test_server(b);
    }
  });

  it.each(['sqlite', 'postgresql'] as const)('a test server that fails during start leaves no temporary folder, %s DB or port', async (db) => {
    const folders = server_folders();
    const databases = await list_databases();
    const listening = listening_servers();
    const failing = (): void => {
      throw new Error('register fails on purpose');
    };
    await expect(start_test_server(undefined, db, undefined, undefined, undefined, undefined, failing)).rejects.toThrow();
    expect(added(folders, server_folders())).toEqual([]);
    expect(added(databases, await list_databases())).toEqual([]);
    expect(listening_servers()).toBe(listening);
  });

  it('stop_test_server removes the folder and the PostgreSQL database of the test server', async () => {
    const server = await start_test_server(undefined, 'postgresql');
    const folder = server.shared.folder;
    const name = server.shared.database.name;
    expect(await list_databases()).toContain(name);
    await stop_test_server(server);
    expect(existsSync(folder)).toBe(false);
    expect(await list_databases()).not.toContain(name);
  });

  it('stop_test_server throws when removing the PostgreSQL database fails, after it stopped the instance and removed the folder', async () => {
    const server = await start_test_server(undefined, 'postgresql');
    const { port } = server;
    const folder = server.shared.folder;
    const saved = process.env.OGW_POSTGRESQL;
    try {
      // The drop connects through OGW_POSTGRESQL: a PostgreSQL that does not listen makes it fail.
      process.env.OGW_POSTGRESQL = 'postgresql://postgres@127.0.0.1:1/postgres';
      await expect(stop_test_server(server)).rejects.toThrow(new RegExp(`removing the database ${server.shared.database.name} of the stopped test server failed`));
    } finally {
      if (saved !== undefined) process.env.OGW_POSTGRESQL = saved;
    }
    expect(existsSync(folder)).toBe(false);
    await expect(fetch(`http://127.0.0.1:${String(port)}/`)).rejects.toThrow();
    expect(await list_databases()).toContain(server.shared.database.name);
    await server.shared.database.drop();
    expect(await list_databases()).not.toContain(server.shared.database.name);
  });

  it('a test server that fails during restart_test_server leaves no temporary folder or open port', async () => {
    const listening = listening_servers();
    const server = await start_test_server();
    const { port } = server;
    const folder = server.shared.folder;
    const failing = (): void => {
      throw new Error('register fails on purpose');
    };
    await expect(restart_test_server(server, failing)).rejects.toThrow(/register fails on purpose/);
    expect(existsSync(folder)).toBe(false);
    expect(listening_servers()).toBe(listening);
    await expect(fetch(`http://127.0.0.1:${String(port)}/`)).rejects.toThrow();
  });

  it('the Error of a start_test_server that fails to start has the failure reason and the server start failure error log line', async () => {
    const failing = (): void => {
      throw new Error('register fails on purpose');
    };
    const thrown: unknown = await start_test_server(undefined, undefined, undefined, undefined, undefined, undefined, failing).then(
      () => null,
      (error: unknown) => error,
    );
    expect(thrown).toBeInstanceOf(StartFailure);
    const error = thrown as Error & { logs?: unknown };
    expect(error.message).toMatch(/register fails on purpose/);
    expect(Array.isArray(error.logs)).toBe(true);
    const lines = error.logs as Record<string, unknown>[];
    const failed = lines.filter((line) => line.level === 'error' && line.kind === 'error' && String(line.message).startsWith('server start failed'));
    expect(failed).toHaveLength(1);
    expect(String(failed[0]?.message)).toMatch(/register fails on purpose/);
  });

  it('an operation called on a stopped test server throws', async () => {
    const server = await start_test_server();
    const session = await login(server, 'stopped');
    await stop_test_server(server);
    await expect(resync(session)).rejects.toThrow();
    await expect(login(server, 'stopped_again')).rejects.toThrow();
    expect(() => {
      advance_time(server, 1n);
    }).toThrow();
    await expect(stop_test_server(server)).rejects.toThrow();
  });

  it('a test server without a DB kind uses OGW_DEFAULT_DB', async () => {
    const before = await list_databases();
    const server: TestServer = await start_test_server();
    try {
      const sqlite_file = existsSync(join(server.shared.folder, 'server.db'));
      const new_databases = (await list_databases()).filter((name) => !before.includes(name));
      if (process.env.OGW_DEFAULT_DB === 'postgresql') {
        expect(new_databases).toHaveLength(1);
        expect(sqlite_file).toBe(false);
      } else {
        expect(process.env.OGW_DEFAULT_DB).toBe('sqlite');
        expect(new_databases).toHaveLength(0);
        expect(sqlite_file).toBe(true);
      }
      const session = await login(server, 'default_db');
      await set_gold(server, session.user_id, 1n);
      expect((await read_user_state(server, session.user_id)).length).toBeGreaterThan(0);
    } finally {
      await stop_test_server(server);
    }
  });

  it('DB kind postgresql throws in a run without OGW_POSTGRESQL', async () => {
    const saved = process.env.OGW_POSTGRESQL;
    Reflect.deleteProperty(process.env, 'OGW_POSTGRESQL');
    try {
      await expect(start_test_server(undefined, 'postgresql')).rejects.toThrow(/OGW_POSTGRESQL/);
    } finally {
      if (saved !== undefined) process.env.OGW_POSTGRESQL = saved;
    }
  });
});

describe('cleanup failures', () => {
  /** The Error `fn` rejects with; throws when it resolves. */
  async function rejection(fn: () => Promise<unknown>): Promise<Error> {
    const thrown: unknown = await fn().then(
      () => null,
      (error: unknown) => error,
    );
    if (!(thrown instanceof Error)) throw new Error('the operation did not throw an Error');
    return thrown;
  }

  it('stop_test_server whose peer stop fails stops the other peers and the instance, removes the folder and the PostgreSQL database, then throws', async () => {
    const listening = listening_servers();
    const server = await start_test_server(undefined, 'postgresql');
    const failing = await start_peer_server(server);
    const other = await start_peer_server(server);
    const ports = [server.port, failing.port, other.port];
    const folder = server.shared.folder;
    const name = server.shared.database.name;
    fail_next_stop(failing);
    const error = await rejection(() => stop_test_server(server));
    expect(error.message).toMatch(/stopping a peer of the stopped test server failed: stop fails on purpose/);
    expect(existsSync(folder)).toBe(false);
    expect(await list_databases()).not.toContain(name);
    expect(await settled_listening(listening)).toBeLessThanOrEqual(listening);
    for (const port of ports) await expect(fetch(`http://127.0.0.1:${String(port)}/`)).rejects.toThrow();
    expect(() => server.running()).toThrow(/has stopped/);
    expect(() => other.running()).toThrow(/has stopped/);
  });

  it('stop_test_server whose instance stop fails removes the folder and the PostgreSQL database, then throws', async () => {
    const listening = listening_servers();
    const server = await start_test_server(undefined, 'postgresql');
    const { port } = server;
    const folder = server.shared.folder;
    const name = server.shared.database.name;
    fail_next_stop(server);
    const error = await rejection(() => stop_test_server(server));
    expect(error.message).toMatch(/stopping the server instance of the stopped test server failed: stop fails on purpose/);
    expect(existsSync(folder)).toBe(false);
    expect(await list_databases()).not.toContain(name);
    expect(await settled_listening(listening)).toBeLessThanOrEqual(listening);
    await expect(fetch(`http://127.0.0.1:${String(port)}/`)).rejects.toThrow();
  });

  it('restart_test_server whose instance stop fails ends the test server: it removes the folder and the PostgreSQL database and throws, and a later stop_test_server throws', async () => {
    const listening = listening_servers();
    const server = await start_test_server(undefined, 'postgresql');
    const { port } = server;
    const folder = server.shared.folder;
    const name = server.shared.database.name;
    fail_next_stop(server);
    const error = await rejection(() => restart_test_server(server));
    expect(error.message).toMatch(/stopping the server instance of the restarted test server failed: stop fails on purpose/);
    expect(existsSync(folder)).toBe(false);
    expect(await list_databases()).not.toContain(name);
    expect(await settled_listening(listening)).toBeLessThanOrEqual(listening);
    await expect(fetch(`http://127.0.0.1:${String(port)}/`)).rejects.toThrow();
    await expect(stop_test_server(server)).rejects.toThrow(/has stopped/);
  });

  it('a start_test_server whose start fails and whose database removal fails too throws a StartFailure with both failures and the log lines', async () => {
    const folders = server_folders();
    const databases = await list_databases();
    const listening = listening_servers();
    const saved = process.env.OGW_POSTGRESQL;
    // `register` runs after the database is made: the drop then connects to a PostgreSQL that does not listen.
    const failing = (): void => {
      process.env.OGW_POSTGRESQL = 'postgresql://postgres@127.0.0.1:1/postgres';
      throw new Error('register fails on purpose');
    };
    let error: Error;
    try {
      error = await rejection(() => start_test_server(undefined, 'postgresql', undefined, undefined, undefined, undefined, failing));
    } finally {
      if (saved !== undefined) process.env.OGW_POSTGRESQL = saved;
    }
    expect(error).toBeInstanceOf(StartFailure);
    expect(error.message).toMatch(/register fails on purpose.*; removing the database ogw_test_\S+ failed too: /);
    const lines = (error as StartFailure).logs;
    expect(lines.some((line) => line.level === 'error' && String(line.message).startsWith('server start failed'))).toBe(true);
    expect(added(folders, server_folders())).toEqual([]);
    expect(await settled_listening(listening)).toBeLessThanOrEqual(listening);
    const left = added(databases, await list_databases());
    expect(left).toHaveLength(1);
    for (const name of left) await drop_database(name);
  });

  it.each(['sqlite', 'postgresql'] as const)('a start_test_server whose start fails and whose instance stop fails too throws a StartFailure with both failures and leaves no folder or %s DB', async (db) => {
    const folders = server_folders();
    const databases = await list_databases();
    const failing = (): void => {
      throw new Error('register fails on purpose');
    };
    const proto = ServerInstance.prototype;
    const stop = Object.getOwnPropertyDescriptor(proto, 'stop')?.value as ServerInstance['stop'];
    let error: Error;
    try {
      proto.stop = function (this: ServerInstance) {
        return failing_stop(() => stop.call(this))();
      };
      error = await rejection(() => start_test_server(undefined, db, undefined, undefined, undefined, undefined, failing));
    } finally {
      proto.stop = stop;
    }
    expect(error).toBeInstanceOf(StartFailure);
    expect(error.message).toMatch(/register fails on purpose.*; stopping the server instance failed too: stop fails on purpose/);
    expect((error as StartFailure).logs.length).toBeGreaterThan(0);
    expect(added(folders, server_folders())).toEqual([]);
    expect(added(databases, await list_databases())).toEqual([]);
  });
});
