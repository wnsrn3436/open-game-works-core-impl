import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { Server as HttpServer } from 'node:http';
import { connect, createServer, Server as NetServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as real_wait } from 'node:timers/promises';
import * as CoreContract from '../../../generated/contract/core_contract.ts';
import { create_server } from '../index.ts';
import { loopback_left_free } from '../loopback.ts';
import type { AdminOperation, RequestCtx } from '../module_api.ts';
import { parse_server_args } from '../../start.ts';
import { core_test_server_paths, new_core_test_server_input } from '../../testing/dev/index.ts';
import {
  admin,
  advance,
  code,
  echo,
  game_register,
  login,
  logs,
  new_calls,
  plain_headers,
  raw,
  request_logs,
  restart,
  send,
  start,
  send_with_seed,
  stop,
  url_of,
  type ContentCore,
  type TestServer,
} from './support.ts';

vi.mock('../../../generated/contract/game_contract.ts', async (import_original) => (await import('./game_contract_mock.ts')).mock_game_contract(await import_original()));

type Core = ContentCore;

/** The server module list of this run, from `core_test_server_paths`. */
const run_paths = core_test_server_paths();

const servers: TestServer[] = [];
const all = game_register(new_calls());

afterEach(async () => {
  for (const server of servers.splice(0)) await stop(server);
});

async function started(register: (core: Core) => void, more: Parameters<typeof start>[0] = {}): Promise<TestServer> {
  const server = await start({ ...more, register });
  servers.push(server);
  return server;
}

/** A content admin operation of role `read` and no input (`admin-api` admin operation form). */
function admin_operation(name: string, handler: () => Record<string, unknown>): AdminOperation {
  return { name, role: 'read', body: 'json', max_body_bytes: null, input: {}, user_target: null, handler, prepare: null, audit_args: null };
}

function connects(port: number): Promise<boolean> {
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

/** A port nothing listens on now. */
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

/** Listens on 127.0.0.1 with a listener that counts and drops each connection: the port, or null when it cannot. */
async function loopback_listener(port: number): Promise<{ port: number | null; taken: () => number; close: () => Promise<void> }> {
  let taken = 0;
  const other = createServer((socket) => {
    taken += 1;
    socket.destroy();
  });
  const bound = await new Promise<number | null>((resolve) => {
    other.once('error', () => {
      resolve(null);
    });
    other.listen(port, '127.0.0.1', () => {
      resolve((other.address() as { port: number }).port);
    });
  });
  const close = (): Promise<void> => new Promise((resolve) => {
    if (bound === null) resolve();
    else other.close(() => {
      resolve();
    });
  });
  return { port: bound, taken: () => taken, close };
}

describe('server instances', () => {
  it('runs two server instances of one process on different ports, each with its own handlers, and closes the port on stop', async () => {
    const first_calls = new_calls();
    const second_calls = new_calls();
    const first = await started(game_register(first_calls));
    const second = await started(game_register(second_calls));
    const first_port = Number(url_of(first).port);
    const second_port = Number(url_of(second).port);
    expect(first_port).not.toBe(second_port);
    expect(code(await send(await login(first, 'one'), 'Echo', echo()))).toBe(0);
    expect(first_calls.echo).toBe(1);
    expect(second_calls.echo).toBe(0);
    expect(code(await send(await login(second, 'one'), 'Echo', echo()))).toBe(0);
    expect(second_calls.echo).toBe(1);
    expect(first_calls.echo).toBe(1);
    await stop(second);
    servers.splice(servers.indexOf(second), 1);
    expect(await connects(second_port)).toBe(false);
    expect(await connects(first_port)).toBe(true);
  });

  // On macOS a listener on all addresses leaves 127.0.0.1 on its port free, and a socket bound there (Docker Desktop
  // publishing a container port) took the test helper's requests: `fetch failed` with `other side closed`.
  it('holds 127.0.0.1 on the port it listens on: another socket cannot bind it after start, and requests to 127.0.0.1 reach the server instance', async () => {
    const server = await started(game_register(new_calls()));
    const port = Number(url_of(server).port);
    const other = await loopback_listener(port);
    try {
      expect(code(await send(await login(server, 'loopback'), 'Echo', echo()))).toBe(0);
      expect(other.taken()).toBe(0);
      expect(other.port).toBeNull();
    } finally {
      await other.close();
    }
  });

  it('does not start on a --port that another socket holds on 127.0.0.1', async () => {
    const other = await loopback_listener(0);
    const folder = mkdtempSync(join(tmpdir(), 'routing-loopback-held-'));
    const input = await new_core_test_server_input('sqlite');
    try {
      const port = other.port as number;
      const secret_file = join(folder, 'secrets.json');
      writeFileSync(secret_file, JSON.stringify(input.secrets.file), { mode: 0o600 });
      const instance = create_server({
        args: { env: 'LOCAL', port, db: input.database.db_argument, secret_file },
        server_modules: input.server_modules,
        data_folder: input.data_folder,
        core_settings: input.settings,
        game_settings: {},
        register: input.register,
        dev: true,
        register_dev: input.registerDev,
        log_writer: () => undefined,
      });
      const result = await instance.start();
      await instance.stop();
      expect(result).toEqual(expect.stringMatching(new RegExp(`^listen on port ${String(port)} failed: .*EADDRINUSE`)));
      expect(other.taken()).toBe(0);
    } finally {
      await other.close();
      await input.drop();
      rmSync(folder, { recursive: true, force: true });
    }
  });

  // `--port` 0 takes the port the OS chose on 127.0.0.1; another socket can hold it on all addresses.
  it('chooses another port when the one it holds on 127.0.0.1 is in use on all addresses (--port 0)', async (ctx) => {
    // Only where a listener on all addresses leaves 127.0.0.1 free (macOS); on Linux that listener holds 127.0.0.1 itself.
    if (!(await loopback_left_free())) ctx.skip();
    // The first listen of an HTTP server is the server instance's on all addresses; later ones listen as usual.
    const refused: number[] = [];
    vi.spyOn(HttpServer.prototype, 'listen').mockImplementationOnce(function (this: HttpServer, ...args: unknown[]) {
      const port = args[0] as number;
      refused.push(port);
      process.nextTick(() => this.emit('error', Object.assign(new Error(`listen EADDRINUSE: address already in use :::${String(port)}`), { code: 'EADDRINUSE' })));
      return this;
    });
    try {
      const server = await started(game_register(new_calls()));
      const port = Number(url_of(server).port);
      expect(refused).toHaveLength(1);
      expect(port).not.toBe(refused[0]);
      expect(code(await send(await login(server, 'chosen'), 'Echo', echo()))).toBe(0);
      const other = await loopback_listener(port);
      await other.close();
      expect(other.port).toBeNull();
    } finally {
      vi.restoreAllMocks();
    }
  });

  it('gives each server instance\'s log line writer only its own lines', async () => {
    const first = await started(game_register(new_calls()));
    const second = await started(game_register(new_calls()));
    const session = await login(first, 'writer');
    const request_id = '8a7b6c5d-4e3f-4a1b-9c8d-7e6f5a4b3c2d';
    await send(session, 'Echo', echo(), { request_id });
    expect(logs(first).some((line) => line.request_id === request_id)).toBe(true);
    expect(logs(second).some((line) => line.request_id === request_id)).toBe(false);
  });

  it('stops without waiting for a running job, and the same DB serves a new instance', async () => {
    let job_runs = 0;
    let armed = false;
    const never_ends = (core: Core): void => {
      // Once armed, a job that never ends: stop() must not wait for it. The test server waits for the run of server start.
      (core['server-time'] as unknown as { schedule_job(name: string, interval_ms: bigint, run: () => Promise<void>): void }).schedule_job('routing_never_ends', 3600000n, () => {
        job_runs += 1;
        return armed ? new Promise<void>(() => undefined) : Promise.resolve();
      });
    };
    const server = await started(game_register(new_calls(), never_ends));
    expect(job_runs).toBe(1);
    armed = true;
    advance(server, 3600000n);
    expect(job_runs).toBe(2);
    const session = await login(server, 'stop_job');
    const instance = (server as unknown as { running(): { instance: { stop(): Promise<void> } } }).running().instance;
    const stopped = await Promise.race([
      instance.stop().then(() => 'stopped'),
      new Promise<string>((resolve) => {
        setTimeout(() => {
          resolve('still waiting');
        }, 2000);
      }),
    ]);
    expect(stopped).toBe('stopped');
    // The new instance's run of server start ends.
    armed = false;
    const restarted = await restart(server);
    servers.splice(servers.indexOf(server), 1, restarted);
    expect(code(await send(session, 'Echo', echo()))).toBe(0);
  });
});

describe('stop during server start', () => {
  // stop() while server start waits for the module entry files, and stop() called from content register.
  for (const when of ['loading', 'register'] as const) {
    it(`ends server start when stop() is called during it (${when}): no listening and no job after stop() resolves`, async () => {
      const folder = mkdtempSync(join(tmpdir(), 'routing-stop-during-start-'));
      const input = await new_core_test_server_input('sqlite');
      try {
        const secret_file = join(folder, 'secrets.json');
        writeFileSync(secret_file, JSON.stringify(input.secrets.file), { mode: 0o600 });
        const port = await free_port();
        let job_runs = 0;
        let stopping: Promise<void> | null = null;
        const register = (core: Readonly<Record<string, unknown>>): void => {
          input.register(core);
          (core['server-time'] as { schedule_job(name: string, interval_ms: bigint, run: () => void): void }).schedule_job('routing_stop_probe', 20n, () => {
            job_runs += 1;
          });
          if (when === 'register') stopping = instance.stop();
        };
        const instance = create_server({
          args: { env: 'LOCAL', port, db: input.database.db_argument, secret_file },
          server_modules: input.server_modules,
          data_folder: input.data_folder,
          core_settings: input.settings,
          game_settings: {},
          register,
          dev: true,
          register_dev: input.registerDev,
          log_writer: () => undefined,
        });
        const starting = instance.start();
        if (when === 'loading') stopping = instance.stop();
        expect(await starting).toBe('the server instance was stopped during server start');
        expect(stopping).not.toBeNull();
        await stopping;
        const runs = job_runs;
        await real_wait(200);
        expect(job_runs).toBe(runs);
        expect(await connects(port)).toBe(false);
        await instance.stop();
      } finally {
        await input.drop();
        rmSync(folder, { recursive: true, force: true });
      }
    });
  }

  /** A server instance on `port` that is not started, with a count of each module's stop() calls once `count_stops()` runs. */
  async function counted_instance(port: number): Promise<{ instance: ReturnType<typeof create_server>; count_stops: () => void; stops: Map<string, number>; done: () => Promise<void> }> {
    const folder = mkdtempSync(join(tmpdir(), 'routing-stop-once-'));
    const input = await new_core_test_server_input('sqlite');
    const secret_file = join(folder, 'secrets.json');
    writeFileSync(secret_file, JSON.stringify(input.secrets.file), { mode: 0o600 });
    const instance = create_server({
      args: { env: 'LOCAL', port, db: input.database.db_argument, secret_file },
      server_modules: input.server_modules,
      data_folder: input.data_folder,
      core_settings: input.settings,
      game_settings: {},
      register: input.register,
      dev: true,
      register_dev: input.registerDev,
      log_writer: () => undefined,
    });
    const stops = new Map<string, number>();
    const count_stops = (): void => {
      for (const [module, object] of instance.modules()) {
        const stop_module = object.stop?.bind(object);
        (object as { stop?: () => unknown }).stop = () => {
          stops.set(module, (stops.get(module) ?? 0) + 1);
          return stop_module?.();
        };
      }
    };
    const done = async (): Promise<void> => {
      await input.drop();
      rmSync(folder, { recursive: true, force: true });
    };
    return { instance, count_stops, stops, done };
  }

  const stopped_once = (instance: ReturnType<typeof create_server>, stops: Map<string, number>): void => {
    expect(instance.modules().size).toBeGreaterThan(0);
    expect(stops.size).toBe(instance.modules().size);
    expect([...stops].filter(([, count]) => count !== 1)).toEqual([]);
  };

  // Server start fails with no check of stop() between the call and the failure: listening on a --port another socket holds on 127.0.0.1.
  it('stops every module once when server start fails while stop() waits for it, and once more stop() does nothing', async () => {
    const other = await loopback_listener(0);
    const port = other.port as number;
    const { instance, count_stops, stops, done } = await counted_instance(port);
    const listen = Reflect.get(NetServer.prototype, 'listen') as (...a: unknown[]) => NetServer;
    try {
      // Set in the listen mock, so declared without narrowing to null.
      let stopping = null as Promise<void> | null;
      // The first listen of server start, after every module's complete_start(): count each module's stop(), then stop() the instance.
      vi.spyOn(NetServer.prototype, 'listen').mockImplementationOnce(function (this: NetServer, ...args: unknown[]) {
        count_stops();
        stopping = instance.stop();
        return Reflect.apply(listen, this, args);
      });
      const result = await instance.start();
      expect(result).toEqual(expect.stringMatching(new RegExp(`^listen on port ${String(port)} failed: .*EADDRINUSE`)));
      expect(stopping).not.toBeNull();
      await stopping;
      await instance.stop();
      stopped_once(instance, stops);
    } finally {
      vi.restoreAllMocks();
      await other.close();
      await done();
    }
  });

  it('stops every module once when server start fails, and stop() after it does not stop them again', async () => {
    const other = await loopback_listener(0);
    const port = other.port as number;
    const { instance, count_stops, stops, done } = await counted_instance(port);
    const listen = Reflect.get(NetServer.prototype, 'listen') as (...a: unknown[]) => NetServer;
    try {
      vi.spyOn(NetServer.prototype, 'listen').mockImplementationOnce(function (this: NetServer, ...args: unknown[]) {
        count_stops();
        return Reflect.apply(listen, this, args);
      });
      expect(await instance.start()).toEqual(expect.stringMatching(/^listen on port \d+ failed: .*EADDRINUSE/));
      await instance.stop();
      stopped_once(instance, stops);
    } finally {
      vi.restoreAllMocks();
      await other.close();
      await done();
    }
  });

  it('stops every module once for two stop() calls on a started server instance, and both resolve after the modules stopped', async () => {
    const { instance, count_stops, stops, done } = await counted_instance(await free_port());
    try {
      expect(typeof (await instance.start())).toBe('number');
      count_stops();
      const first = instance.stop().then(() => stops.size);
      const second = instance.stop().then(() => stops.size);
      expect(await Promise.all([first, second])).toEqual([instance.modules().size, instance.modules().size]);
      stopped_once(instance, stops);
    } finally {
      await instance.stop();
      await done();
    }
  });
});

describe('server start failures', () => {
  const failing = async (register: (core: Core) => void, register_dev?: (core: Core) => void): Promise<void> => {
    await expect(start({ register, register_dev })).rejects.toThrow();
  };
  it('does not start with an rpc of service Game without a handler', async () => {
    await failing((core: Core) => {
      core.storage.register_user_change('routing_probe', () => 'pass', () => undefined);
      core.routing.register_handler('Echo', () => new CoreContract.ResyncResponse());
    });
  });

  it('does not start with a handler registered twice, or for an rpc name not in service Game', async () => {
    await failing((core: Core) => {
      all(core);
      core.routing.register_handler('Echo', () => new CoreContract.ResyncResponse());
    });
    await failing((core: Core) => {
      all(core);
      core.routing.register_handler('NotInGame', () => new CoreContract.ResyncResponse());
    });
  });

  it('does not start with register_hook of an unknown module or hook name, or a hook registered twice', async () => {
    await failing((core: Core) => {
      all(core);
      core.routing.register_hook('no-such-module', 'prepare_create_guild', () => 'pass');
    });
    await failing((core: Core) => {
      all(core);
      core.routing.register_hook('guild', 'no_such_hook', () => 'pass');
    });
    await failing((core: Core) => {
      all(core);
      core.routing.register_hook('guild', 'prepare_create_guild', () => 'pass');
      core.routing.register_hook('guild', 'prepare_create_guild', () => 'pass');
    });
  });

  it('does not start when register_handler, register_hook or register_admin_operation is called outside register', async () => {
    await failing(all, (core: Core) => {
      core.routing.register_handler('Echo', () => new CoreContract.ResyncResponse());
    });
    await failing(all, (core: Core) => {
      core.routing.register_hook('mailbox', 'grant_mail_extra', () => 'pass');
    });
    await failing(all, (core: Core) => {
      core.routing.register_admin_operation(admin_operation('game_late', () => ({})));
    });
  });

  it('gives content only the registration operations of routing, so registerDev cannot reopen the register window', async () => {
    const seen: string[][] = [];
    await started((core: Core) => {
      all(core);
      seen.push(Object.keys(core.routing).sort());
    }, {
      register_dev: (core: Core) => {
        seen.push(Object.keys(core.routing).sort());
      },
    });
    const operations = ['register_admin_operation', 'register_handler', 'register_hook'];
    expect(seen).toEqual([operations, operations]);
    // register leaves Crash without a handler; a registerDev that tries the routing module object's window to add it
    // does not start the server.
    const without_crash = (core: Core): void => {
      core.storage.register_user_change('routing_probe', () => 'pass', () => undefined);
      for (const name of ['Echo', 'Fail', 'Probe']) core.routing.register_handler(name, () => new CoreContract.ResyncResponse());
    };
    await failing(without_crash, (core: Core) => {
      (core.routing as unknown as { open_window?: () => void }).open_window?.();
      core.routing.register_handler('Crash', () => new CoreContract.ResyncResponse());
    });
  });

  it('passes content admin operations to admin-api as module game, and does not start with a name outside game_', async () => {
    const server = await started((core: Core) => {
      all(core);
      core.routing.register_admin_operation(admin_operation('game_probe', () => ({ ok: true })));
    });
    const probe = await admin(server, 'game_probe', {});
    expect(probe.status).toBe(200);
    await failing((core: Core) => {
      all(core);
      core.routing.register_admin_operation(admin_operation('probe', () => ({})));
    });
  });

  it('passes every admin operation the modules export to admin-api, and no internal operation', async () => {
    const server = await started(all);
    expect((await admin(server, 'list_client_errors', { from_at: '0', to_at: '1', limit: 10 })).status).toBe(200);
    expect((await admin(server, 'verify_access_token', {})).status).toBe(404);
    expect((await admin(server, 'register_admin_operation', {})).status).toBe(404);
  });

  it('answers HTTP 404 to a core rpc of a module outside the server module list, and does not start with that module\'s register_hook', async () => {
    // Without `ranking` too: the core test data has guild boards, and `ranking` does not start with them and no `guild`.
    // Without `rating` too: it depends on `ranking`. Without `matchmaker` too: the core test data has match_mode rows with a rating_rule, and `matchmaker` does not start with them and no `rating`.
    const server_modules = run_paths.server_modules.filter((m) => !['guild', 'ranking', 'rating', 'matchmaker'].includes(m));
    const server = await started(all, { server_modules });
    const response = await raw(server, 'POST', '/core/CreateGuild', plain_headers(), new Uint8Array(0));
    expect(response.status).toBe(404);
    expect(response.body.length).toBe(0);
    await expect(
      start({
        server_modules,
        register: (core: Core) => {
          all(core);
          core.routing.register_hook('guild', 'prepare_create_guild', () => 'pass');
        },
      }),
    ).rejects.toThrow();
  });

  it('calls registerDev once right after register on a DEV code server, and never on an STG server', async () => {
    const order: string[] = [];
    const register = (core: Core): void => {
      all(core);
      order.push('register');
    };
    const register_dev = (): void => {
      order.push('registerDev');
    };
    servers.push(await start({ register, register_dev }));
    expect(order).toEqual(['register', 'registerDev']);
    order.length = 0;
    servers.push(await start({ env: 'STG', register, register_dev }));
    expect(order).toEqual(['register']);
  });

  it('uses the test clock set before start() from server start, and the seed from the first request', async () => {
    const job_clock: bigint[] = [];
    const clock_job = (core: Core): void => {
      // The job's run when server start ends reads clock_now: the test clock the test server set through dev before start().
      const time = core['server-time'] as unknown as { clock_now(): bigint; schedule_job(name: string, interval_ms: bigint, run: () => void): void };
      time.schedule_job('routing_start_clock', 3600000n, () => {
        job_clock.push(time.clock_now());
      });
    };
    const server = await started(game_register(new_calls(), clock_job), { start_at: 1700000000000n });
    expect(job_clock).toEqual([1700000000000n]);
    // A request that ends at step 3 answers clock_now.
    const response = await raw(server, 'POST', '/core/Resync', plain_headers(), new CoreContract.ResyncRequest().encode());
    expect(CoreContract.ResponseEnvelope.decode(response.body)?.server_time_at).toBe(1700000000000n);
    const session = await login(server, 'seed');
    const request_id = '6b5a4f3e-2d1c-4b0a-9f8e-7d6c5b4a3f2e';
    await send_with_seed(session, 'Echo', echo(), request_id, 12345n);
    const line = request_logs(server, 'Echo').find((l) => l.request_id === request_id);
    expect(line?.seed).toBe('12345');
  });

  it('takes set_clock and set_seed_provider through dev only before start(), and throws after it', async () => {
    const instance = create_server({
      args: { env: 'LOCAL', port: 0 },
      server_modules: [],
      data_folder: join(tmpdir(), 'routing-no-such-data-folder'),
      core_settings: {},
      game_settings: {},
      register: () => undefined,
      dev: true,
    });
    expect(() => instance.dev?.('server-time', 'set_clock', [{}])).not.toThrow();
    expect(() => instance.dev?.('storage', 'set_seed_provider', [() => null])).not.toThrow();
    expect(typeof (await instance.start())).toBe('string');
    expect(() => instance.dev?.('server-time', 'set_clock', [{}])).toThrow();
    expect(() => instance.dev?.('storage', 'set_seed_provider', [() => null])).toThrow();
  });

  it('does not start a server instance with DEV code on --env STG or PROD', async () => {
    for (const env of ['STG', 'PROD'] as const) {
      const lines: string[] = [];
      const instance = create_server({ args: { env, port: 0 }, server_modules: [], data_folder: tmpdir(), core_settings: {}, game_settings: {}, register: () => undefined, dev: true, log_writer: (line) => lines.push(line) });
      expect(await instance.start()).toContain('DEV code');
      expect(lines.some((line) => line.includes('DEV code'))).toBe(true);
    }
    expect(create_server({ args: { env: 'STG', port: 0 }, server_modules: [], data_folder: tmpdir(), core_settings: {}, game_settings: {}, register: () => undefined, dev: false }).dev).toBeUndefined();
  });

  it('reads the server start arguments of the server process start point', () => {
    expect(parse_server_args(['--env', 'LOCAL', '--port', '0', '--db', 'a.db', '--secret-file', 's.json'])).toEqual({ env: 'LOCAL', port: 0, db: 'a.db', secret_file: 's.json' });
    expect(parse_server_args(['--env', 'PROD', '--matchmaker'])).toEqual({ env: 'PROD', matchmaker: true });
    expect(typeof parse_server_args(['--env', 'LOCAL'])).toBe('string');
    expect(typeof parse_server_args(['--env', 'PROD', '--db', 'postgresql'])).toBe('string');
    expect(typeof parse_server_args(['--env', 'TEST'])).toBe('string');
  });

  it('throws on a create_server input of the wrong form', () => {
    expect(() => create_server({ args: { env: 'NOPE' as 'LOCAL' }, server_modules: [], data_folder: '', core_settings: {}, game_settings: {}, register: () => undefined, dev: false })).toThrow();
    expect(() => create_server({ args: { env: 'LOCAL', port: -1 }, server_modules: [], data_folder: '', core_settings: {}, game_settings: {}, register: () => undefined, dev: false })).toThrow();
  });
});

describe('request logs', () => {
  it('writes one request log per answered request and none for an unknown path or a disallowed origin', async () => {
    const server = await started(all_register());
    const session = await login(server, 'logs');
    const before = logs(server, 'request').length;
    await send(session, 'Echo', echo());
    await send(session, 'Fail', echo());
    await send(session, 'Echo', echo(), { headers: { 'X-Ogw-Platform': 'ps5' } });
    expect(logs(server, 'request')).toHaveLength(before + 3);
    expect((await raw(server, 'POST', '/no/such/path', plain_headers())).status).toBe(404);
    expect((await raw(server, 'GET', '/Echo', plain_headers())).status).toBe(404);
    expect((await raw(server, 'POST', '/Echo', plain_headers({ Origin: 'https://evil.example' }))).status).toBe(403);
    expect((await raw(server, 'OPTIONS', '/Echo', { Origin: 'https://evil.example' })).status).toBe(403);
    expect(logs(server, 'request')).toHaveLength(before + 3);
  });

  it('writes one request log for a preflight, a route response and an STG cheat path OPTIONS, which are paths of the path table', async () => {
    const server = await started(all_register());
    const count = (target: TestServer): number => logs(target, 'request').length;
    let before = count(server);
    expect((await raw(server, 'OPTIONS', '/Echo', { Origin: 'http://localhost:5173' })).status).toBe(204);
    expect(count(server)).toBe(before + 1);
    expect(request_logs(server, 'Echo').at(-1)?.error_code).toBe(0);
    before = count(server);
    expect([200, 404]).toContain((await raw(server, 'GET', '/update/deploy_list.json', {})).status);
    expect(count(server)).toBe(before + 1);
    before = count(server);
    expect((await admin(server, 'set_maintenance', { enabled: false })).status).toBe(200);
    expect(count(server)).toBe(before + 1);
    // An unknown method of an update route is an unknown path: no line.
    before = count(server);
    expect((await raw(server, 'OPTIONS', '/update/deploy_list.json', {})).status).toBe(404);
    expect(count(server)).toBe(before);
    const stg = await started(all_register(), { env: 'STG' });
    before = count(stg);
    expect((await raw(stg, 'OPTIONS', '/core/cheat/SetTimeOffset', { Origin: 'http://localhost:5173' })).status).toBe(404);
    expect(count(stg)).toBe(before + 1);
    expect(request_logs(stg, 'core/cheat/SetTimeOffset')).toHaveLength(1);
    expect((await raw(stg, 'GET', '/core/cheat/SetTimeOffset', {})).status).toBe(404);
    expect(count(stg)).toBe(before + 1);
  });

  it('writes the request log of a success with unknown kind rows at warn with their kind column values', async () => {
    const globals = globalThis as { routing_probe_kind?: boolean };
    // An out-of-request change of a content admin operation writes a row of the probe kind: a pending delta row.
    const register = game_register(new_calls(), (core: Core) => {
      core.routing.register_admin_operation({
        ...admin_operation('game_put_probe', () => ({})),
        role: 'ops',
        input: { user_id: { type: { kind: 'int64' }, optional: false } },
        user_target: 'user_id',
        handler: (_input: unknown, ctx: unknown) => {
          const value = new CoreContract.ResyncRequest();
          value.full = true;
          core.storage.put_state(ctx as RequestCtx, value);
          return {};
        },
      });
    });
    globals.routing_probe_kind = true;
    try {
      const server = await started(register);
      const session = await login(server, 'unknown_kind');
      expect((await admin(server, 'game_put_probe', { user_id: session.user_id.toString() })).status).toBe(200);
      // After the restart the contract has no probe kind: the pending row is an unknown kind row.
      globals.routing_probe_kind = false;
      const restarted = await restart(server, register);
      servers.splice(servers.indexOf(server), 1, restarted);
      const request_id = '2f3e4d5c-6b7a-4980-a1b2-c3d4e5f6a7b8';
      expect(code(await send(session, 'Echo', echo(), { request_id }))).toBe(0);
      const line = request_logs(restarted, 'Echo').find((l) => l.request_id === request_id);
      expect(line?.level).toBe('warn');
      expect(line?.unknown_kinds).toBe('routing_probe_user_state');
    } finally {
      globals.routing_probe_kind = false;
    }
  });
});

describe('client IP of a request\'s logs', () => {
  it('gives a security log line without ip, written while a request is handled, the truncated client IP', async () => {
    const calls = new_calls();
    const probe: { write(reason: string): void } = { write: () => undefined };
    const server = await started(
      game_register(calls, (core: Core) => {
        const logging = (core as unknown as { logging: { write(entry: Record<string, unknown>): void } }).logging;
        probe.write = (reason) => {
          logging.write({ kind: 'security', level: 'warn', message: reason, user_id: null, request_id: null, request: null, fields: { reason } });
        };
      }),
    );
    calls.probe_handler = () => {
      probe.write('routing_probe_in_request');
      return new CoreContract.ResyncResponse();
    };
    expect(code(await send(await login(server, 'request_ip'), 'Probe', echo()))).toBe(0);
    probe.write('routing_probe_outside');
    const lines = logs(server, 'security').filter((line) => String(line.reason).startsWith('routing_probe_'));
    // LOCAL: the client IP is the TCP peer address 127.0.0.1.
    expect(lines.map((line) => [line.reason, line.ip])).toEqual([
      ['routing_probe_in_request', '127.0.0.0'],
      ['routing_probe_outside', null],
    ]);
  });
});

function all_register(): (core: Core) => void {
  return game_register(new_calls());
}
