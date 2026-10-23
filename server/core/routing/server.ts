/**
 * `create_server` and the server instance: server start (server build data, module preparation in dependency
 * order, content registration, collection and checks, listening), `stop()`, and `dev`.
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { createServer as createNetServer, type Server as NetServer, type Socket } from 'node:net';
import type { Duplex } from 'node:stream';
import * as CoreContract from '../../generated/contract/core_contract.ts';
import * as GameContract from '../../generated/contract/game_contract.ts';
import * as GameData from '../../generated/data/game_data.ts';
import { collect_exports, type CollectResult } from './collect.ts';
import type { HttpFetch, InstanceState, KeySource, ServerArgs, ServerInput } from './context.ts';
import { data_version_failure } from './http.ts';
import { load_module, type LoadedModule } from './loader.ts';
import { close_server, listen_on, LOOPBACK, loopback_left_free } from './loopback.ts';
import { outgoing_fetch } from './outgoing_http.ts';
import type { CoreRpcHandler, DevObject, LogEntry, ModuleObject, ServerTimeModule } from './module_api.ts';
import { Pipeline } from './pipeline.ts';
import type { RoutingModule } from './routing_module.ts';
import { BEFORE_START_DEV_OPERATIONS, CONTENT_REGISTER_OPERATIONS, DEV_ONLY_MODULES, MODULE_DEPENDENCIES } from './spec_tables.ts';
import { check_input, content_object, merge_objects, module_settings, preparation_order, read_build_data, read_data_file, read_secret_file, routing_deps, routing_settings, secret_reader } from './start_parts.ts';

export { module_settings, preparation_order } from './start_parts.ts';

export type RegisterFunction = (core: Readonly<Record<string, unknown>>) => unknown;

/** The input of `create_server`. */
export interface CreateServerInput {
  /** The server start arguments. */
  args: ServerArgs;
  /** The server module list: names of the server modules the game uses. */
  server_modules: readonly string[];
  /** The server build data folder (`server/build/data/`). */
  data_folder: string;
  /** The merged core settings, by core settings key. */
  core_settings: Readonly<Record<string, unknown>>;
  /** The game settings values core reads, by game settings path. */
  game_settings: Readonly<Record<string, unknown>>;
  /** Content `register(core)` of `server/main.ts`. */
  register: RegisterFunction;
  /** True for a server instance with DEV code. */
  dev: boolean;
  /** Content `registerDev(core)` of `server/dev/main.ts`; only with DEV code. */
  register_dev?: RegisterFunction | null;
  /** Core settings and game settings value overrides, by key. */
  settings_overrides?: Readonly<Record<string, unknown>> | null;
  /** Key source overrides by adapter key. */
  key_sources?: Readonly<Record<string, KeySource>> | null;
  /** The outgoing HTTP adapter override. */
  http_adapter?: HttpFetch | null;
  /** The log line writer override. */
  log_writer?: ((line: string) => void) | null;
  /** Fake adapter overrides by adapter key. */
  fake_adapters?: Readonly<Record<string, unknown>> | null;
}

type InstanceStatus = 'created' | 'starting' | 'started' | 'failed' | 'stopped';

interface PendingDev {
  module: string;
  operation: string;
  args: unknown[];
}

/** What routing's DEV code gives the instance (see `dev/index.ts`). */
export interface InstanceDev {
  call_dev(module: string, operation: string, args: unknown[], user_id: bigint | null): Promise<unknown>;
}

/** What server start reads before it prepares modules. */
interface StartData {
  server: ServerInput;
  settings: Record<string, unknown>;
}

/** A start failure: the reason. */
class StartFailure extends Error {}

/** `stop()` was called during server start: the start ends without listening. */
class StartStopped extends Error {}

const STOPPED_DURING_START = 'the server instance was stopped during server start';

/** How many ports `--port` 0 chooses before server start fails, when each is held on all addresses (`listen_with_loopback`). */
const PORT_CHOICES = 16;

/** Listens on `port` (all addresses when `host` is not given), or throws the start failure. */
async function listen_or_fail(server: NetServer, port: number, host?: string): Promise<number> {
  const listening = await listen_on(server, port, host);
  if (typeof listening !== 'number') throw new StartFailure(`listen on port ${String(port)} failed: ${host === undefined ? '' : `${host}: `}${listening.message}`);
  return listening;
}

export class ServerInstance {
  private readonly input: CreateServerInput;
  private status: InstanceStatus = 'created';
  private listening_port = 0;
  private http: Server | null = null;
  /** The listener on `127.0.0.1:<port>` where the one on all addresses does not hold it (`loopback.ts`). */
  private loopback: NetServer | null = null;
  private readonly sockets = new Set<Socket>();
  private readonly prepared = new Map<string, ModuleObject>();
  private readonly dev_objects = new Map<string, DevObject>();
  private readonly order: string[] = [];
  private readonly pending: PendingDev[] = [];
  private logging: { write(entry: LogEntry): void } | null = null;
  private clock: (() => bigint) | null = null;
  private instance_dev: InstanceDev | null = null;
  /** The running server start, while `status` is `starting`. */
  private starting: Promise<number | string> | null = null;
  private stop_requested = false;
  /** The stop of the first `stop()` call. */
  private stopping: Promise<void> | null = null;
  /** `dev`: only on a server instance with DEV code. */
  readonly dev?: (module: string, operation: string, input?: unknown, user_id?: bigint | null) => unknown;

  constructor(input: CreateServerInput) {
    this.input = input;
    if (input.dev) this.dev = (module, operation, args, user_id) => this.call_dev(module, operation, args, user_id ?? null);
  }

  /** The prepared module objects by name; empty before `start()`. */
  modules(): ReadonlyMap<string, ModuleObject> {
    return this.prepared;
  }

  private call_dev(module: string, operation: string, input: unknown, user_id: bigint | null): unknown {
    const key = `${module}.${operation}`;
    const args = input === undefined ? [] : Array.isArray(input) ? (input as unknown[]) : [input];
    if (BEFORE_START_DEV_OPERATIONS.has(key)) {
      if (this.status !== 'created') throw new Error(`dev: ${key} is called after start()`);
      this.pending.push({ module, operation, args });
      return undefined;
    }
    if (this.status !== 'started' || this.instance_dev === null) throw new Error(`dev: ${key} is called on a server instance that is not started`);
    return this.instance_dev.call_dev(module, operation, args, user_id);
  }

  /** One server log line: to the log line writer override, or to stdout. */
  private write_line(line: string): void {
    if (this.input.log_writer) this.input.log_writer(line);
    else process.stdout.write(`${line}\n`);
  }

  /** Writes a log entry: through `logging.write` once `logging` is prepared, otherwise as a JSON line of its own. */
  log(entry: LogEntry): void {
    if (this.logging !== null) {
      this.logging.write(entry);
      return;
    }
    const { fields, ...common } = entry;
    const line = { time: this.clock === null ? null : this.clock(), ...common, ...(fields ?? {}) };
    this.write_line(JSON.stringify(line, (_k, v: unknown) => (typeof v === 'bigint' ? v.toString() : v)));
  }

  /** Server start; the port it listens on, or the start failure reason. */
  start(): Promise<number | string> {
    if (this.status !== 'created') throw new Error('start: the server instance has already started');
    this.status = 'starting';
    this.starting = this.run_start();
    return this.starting;
  }

  private async run_start(): Promise<number | string> {
    try {
      await this.do_start();
      this.status = 'started';
      return this.listening_port;
    } catch (error) {
      if (error instanceof StartStopped) {
        await this.teardown();
        this.status = 'stopped';
        return STOPPED_DURING_START;
      }
      const reason = error instanceof Error ? error.message : String(error);
      const stack_trace = error instanceof StartFailure ? null : error instanceof Error ? (error.stack ?? null) : null;
      this.log({ level: 'error', kind: 'error', user_id: null, request_id: null, request: null, message: `server start failed: ${reason}`, fields: { stack_trace } });
      await this.teardown();
      this.status = 'failed';
      return reason;
    }
  }

  /** Ends server start when `stop()` was called during it. Checked after each wait of server start. */
  private check_stop(): void {
    if (this.stop_requested) throw new StartStopped(STOPPED_DURING_START);
  }

  private async do_start(): Promise<void> {
    const env = this.input.args.env;
    if (this.input.dev && (env === 'STG' || env === 'PROD')) throw new StartFailure(`a server instance with DEV code does not start with --env ${env}`);
    const order = this.module_order();
    const data = this.read_start_data(order);
    const loaded = await this.load(order);
    this.check_stop();
    this.create_modules(order, loaded, data);
    const routing = this.prepared.get('routing') as unknown as RoutingModule;
    routing.prepared = this.prepared;
    this.create_dev(order, loaded, routing);
    for (const module of order) {
      await this.prepared.get(module)?.begin_start?.();
      this.check_stop();
    }
    await this.register_content(routing);
    this.check_stop();
    const collected = this.collect(routing);
    for (const module of order) {
      const reason = await this.prepared.get(module)?.complete_start?.();
      this.check_stop();
      if (typeof reason === 'string') throw new StartFailure(`${module}: ${reason}`);
    }
    const pipeline = this.request_state(data, collected.result, collected.game_handlers, routing);
    await this.listen(pipeline);
    this.check_stop();
    routing.mark_started();
    // Server start ends here, after every module's `complete_start()` and listening: every job runs its first time.
    (this.prepared.get('server-time') as unknown as ServerTimeModule).end_start();
  }

  /** The secret file and the server build data. */
  private read_start_data(order: readonly string[]): StartData {
    const input = this.input;
    const env = input.args.env;
    const secrets = read_secret_file(input.args.secret_file);
    if (typeof secrets === 'string') throw new StartFailure(secrets);
    const build = read_build_data(input.data_folder);
    const version_failure = data_version_failure(build.client, build.compat);
    if (version_failure !== null) throw new StartFailure(version_failure);
    const data = GameData.load_data_set(build.binaries);
    if (data === null) throw new StartFailure('the server build data cannot be loaded');
    const server: ServerInput = {
      env,
      db: input.args.db ?? null,
      dev: input.dev,
      matchmaker: input.args.matchmaker === true,
      server_modules: [...order].sort(),
      data,
      data_version: build.data_version ?? '',
      client_data_version: build.client ?? '',
      compat_client_data_version: build.compat,
      read_data_file: (name) => read_data_file(input.data_folder, name),
      read_secret: secret_reader(input.args.secret_file === undefined ? null : secrets),
      fetch: input.http_adapter ?? outgoing_fetch,
      write_log_line: (line) => {
        this.write_line(line);
      },
      key_sources: input.key_sources ?? {},
      fake_adapters: input.fake_adapters ?? {},
      port: () => this.listening_port,
    };
    return { server, settings: module_settings(env, input.core_settings, input.game_settings, input.settings_overrides) };
  }

  /** The modules to prepare in dependency order: the server module list, routing, DEV-only modules only with DEV code. */
  private module_order(): string[] {
    const input = this.input;
    const names = new Set(input.server_modules.filter((m) => input.dev || !DEV_ONLY_MODULES.has(m)));
    names.add('routing');
    for (const module of names) {
      const deps = MODULE_DEPENDENCIES[module];
      if (deps === undefined) throw new StartFailure(`${module} is not a server module`);
      const missing = deps.dependencies.find((dep) => !names.has(dep));
      if (missing !== undefined) throw new StartFailure(`${module} depends on ${missing}, which is not in the server module list`);
    }
    const order = preparation_order([...names]);
    this.order.push(...order);
    return order;
  }

  private async load(order: readonly string[]): Promise<Map<string, LoadedModule>> {
    const loaded = new Map<string, LoadedModule>();
    for (const module of order) {
      const result = await load_module(module, this.input.dev);
      if (typeof result === 'string') throw new StartFailure(result);
      loaded.set(module, result);
    }
    return loaded;
  }

  /** Module objects in dependency order. An optional dependency made later is filled in afterwards. */
  private create_modules(order: readonly string[], loaded: ReadonlyMap<string, LoadedModule>, data: StartData): void {
    const server = data.server;
    const wanted = (module: string): string[] => {
      const deps = MODULE_DEPENDENCIES[module];
      return [...(deps?.dependencies ?? []), ...(deps?.optional ?? []), ...(this.input.dev ? (deps?.dev ?? []) : [])];
    };
    const inputs = new Map<string, Record<string, ModuleObject>>();
    for (const module of order) {
      const modules: Record<string, ModuleObject> = {};
      for (const dep of wanted(module)) {
        const object = this.prepared.get(dep);
        if (object !== undefined) modules[dep] = object;
      }
      inputs.set(module, modules);
      const factory = loaded.get(module)?.create;
      if (!factory) throw new StartFailure(`${module} has no create function`);
      const object = factory({ settings: data.settings, modules, server });
      this.prepared.set(module, object);
      this.watch_module(module, object);
    }
    for (const module of order) {
      const modules = inputs.get(module) ?? {};
      for (const dep of wanted(module)) {
        const object = this.prepared.get(dep);
        if (object !== undefined) modules[dep] ??= object;
      }
    }
  }

  /** `logging` takes the instance's log lines, and `server-time` gives their time, from when they are made. */
  private watch_module(module: string, object: ModuleObject): void {
    if (module === 'logging') this.logging = object as unknown as { write(entry: LogEntry): void };
    if (module === 'server-time') {
      const server_time = object as unknown as { clock_now(): bigint };
      this.clock = () => server_time.clock_now();
    }
  }

  /** DEV objects, and the DEV operations `dev` took before `start()`. */
  private create_dev(order: readonly string[], loaded: ReadonlyMap<string, LoadedModule>, routing: RoutingModule): void {
    if (!this.input.dev) {
      if (this.pending.length > 0) throw new StartFailure('dev operations on a server instance without DEV code');
      return;
    }
    for (const module of order) {
      const create_dev = loaded.get(module)?.create_dev;
      const object = this.prepared.get(module);
      if (create_dev && object !== undefined) this.dev_objects.set(module, create_dev(object));
    }
    if (routing.dev === null) throw new StartFailure('routing has no DEV code in a server instance with DEV code');
    for (const call of this.pending) {
      const target = this.dev_objects.get(call.module);
      const fn = target?.[call.operation];
      if (typeof fn !== 'function') throw new StartFailure(`dev: ${call.module} has no DEV operation ${call.operation}`);
      (fn as (...args: unknown[]) => unknown).apply(target, call.args);
    }
  }

  /** Content `register`, then content `registerDev` through routing's DEV code. */
  private async register_content(routing: RoutingModule): Promise<void> {
    const core: Record<string, unknown> = {};
    for (const [module, object] of this.prepared) core[module] = content_object(object);
    routing.open_window();
    await this.input.register(core);
    routing.close_window();
    if (!this.input.dev || routing.dev === null) return;
    const core_dev: Record<string, unknown> = {};
    for (const [module, object] of this.prepared) core_dev[module] = merge_objects(content_object(object), this.dev_objects.get(module));
    for (const key of CONTENT_REGISTER_OPERATIONS) {
      const [module = '', operation = ''] = key.split('.');
      const object = core_dev[module] as Record<string, unknown> | undefined;
      if (object === undefined) continue;
      object[operation] = (): void => {
        routing.errors.push(`${key} is called outside register`);
      };
    }
    await routing.dev.register_dev(this.input.register_dev ?? null, core_dev);
  }

  /** Collects what the modules export and checks it; admin operations go to `admin-api`. */
  private collect(routing: RoutingModule): { result: CollectResult; game_handlers: Map<string, { info: CoreContract.RpcInfo; handler: CoreRpcHandler }> } {
    const errors = [...routing.errors];
    const result = collect_exports({ modules: this.prepared, matchmaker: this.input.args.matchmaker === true, core_rpcs: CoreContract.RPCS });
    errors.push(...result.errors);
    const game_handlers = new Map<string, { info: CoreContract.RpcInfo; handler: CoreRpcHandler }>();
    for (const info of GameContract.RPCS) {
      const handler = routing.game_handlers.get(info.name);
      if (handler === undefined) errors.push(`rpc ${info.name} of service Game has no handler`);
      else game_handlers.set(info.name, { info, handler });
    }
    if (routing.dev !== null) errors.push(...routing.dev.collect(this.prepared, this.dev_objects));
    if (errors.length > 0) throw new StartFailure(errors.join('; '));
    const admin_api = routing_deps(this.prepared).admin_api;
    for (const { module, operation } of result.admin_operations) admin_api.register_admin_operation(module, operation);
    for (const operation of routing.content_admin_operations) admin_api.register_admin_operation('game', operation);
    return { result, game_handlers };
  }

  private request_state(data: StartData, result: CollectResult, game_handlers: InstanceState['collected']['game_handlers'], routing: RoutingModule): Pipeline {
    const state: InstanceState = {
      server: data.server,
      settings: routing_settings(data.server.env, data.settings),
      values: data.settings,
      deps: routing_deps(this.prepared),
      modules: this.prepared,
      collected: { game_handlers, core_rpcs: result.core_rpcs, routes: result.routes, request_start: result.request_start, prepare: result.prepare },
      cheat: null,
      log: (entry) => {
        this.log(entry);
      },
    };
    const pipeline = new Pipeline(state);
    if (routing.dev !== null) {
      const ready = routing.dev.ready(state, pipeline, this.dev_objects);
      state.cheat = ready.cheat;
      this.instance_dev = ready;
    }
    return pipeline;
  }

  private on_request(pipeline: Pipeline, req: IncomingMessage, res: ServerResponse): void {
    pipeline.handle(req, res).catch((error: unknown) => {
      pipeline.error_log(null, 'request handling failed', error);
      if (!res.headersSent) {
        res.writeHead(500);
        res.end();
      }
    });
  }

  /**
   * Listens on `--port` on all addresses. Where that leaves `127.0.0.1` on the port free for another socket
   * (`loopback.ts`), it also listens on `127.0.0.1:<port>` with the HTTP server's listener options and hands those
   * connections to the same HTTP server, so the port the instance listens on is its own on `127.0.0.1` too.
   */
  private async listen(pipeline: Pipeline): Promise<void> {
    const http = createServer((req, res) => {
      this.on_request(pipeline, req, res);
    });
    http.on('upgrade', (req: IncomingMessage, socket: Duplex, head: Buffer) => {
      void pipeline.handle_upgrade(req, socket, head);
    });
    http.on('connection', (socket: Socket) => {
      this.sockets.add(socket);
      socket.on('close', () => this.sockets.delete(socket));
    });
    this.http = http;
    const port = this.input.args.port ?? 8080;
    this.listening_port = (await loopback_left_free()) ? await this.listen_with_loopback(http, port) : await listen_or_fail(http, port);
  }

  /**
   * Listens on `127.0.0.1:<port>`, then on all addresses on the port that listener got. With `--port` 0 the OS
   * chooses the port on `127.0.0.1` only, and another socket can hold it on all addresses (`EADDRINUSE`); then it
   * chooses again, up to `PORT_CHOICES` times.
   */
  private async listen_with_loopback(http: Server, port: number): Promise<number> {
    for (let choice = 1; ; choice += 1) {
      const loopback = createNetServer({ allowHalfOpen: true, noDelay: true }, (socket) => {
        http.emit('connection', socket);
      });
      this.loopback = loopback;
      const held = await listen_or_fail(loopback, port, LOOPBACK);
      const listening = await listen_on(http, held);
      if (typeof listening === 'number') return listening;
      if (port !== 0 || (listening as NodeJS.ErrnoException).code !== 'EADDRINUSE' || choice === PORT_CHOICES) {
        throw new StartFailure(`listen on port ${String(port)} failed: ${listening.message}`);
      }
      this.loopback = null;
      await close_server(loopback);
    }
  }

  private async teardown(): Promise<void> {
    const http = this.http;
    this.http = null;
    const loopback = this.loopback;
    this.loopback = null;
    loopback?.close();
    if (http !== null) {
      http.close();
      for (const socket of this.sockets) socket.destroy();
      this.sockets.clear();
    }
    for (const module of [...this.order].reverse()) {
      try {
        await this.prepared.get(module)?.stop?.();
      } catch (error) {
        this.log({ level: 'error', kind: 'error', user_id: null, request_id: null, request: null, message: `${module} stop failed`, fields: { stack_trace: error instanceof Error ? (error.stack ?? null) : null } });
      }
    }
  }

  /** Stops taking connections, drops what is in progress, and stops the modules in reverse dependency order. */
  stop(): Promise<void> {
    // Every call shares one stop, so the modules stop once.
    this.stopping ??= this.run_stop();
    return this.stopping;
  }

  private async run_stop(): Promise<void> {
    if (this.status === 'starting') {
      // Server start ends at its next check, or fails before it; either way it tears down what it prepared.
      this.stop_requested = true;
      await this.starting;
    }
    // A server start that failed or was stopped has torn down already.
    if (this.status !== 'failed' && this.status !== 'stopped') await this.teardown();
    this.status = 'stopped';
  }
}

/** `create_server`: a server instance that has not started. A wrong input throws. */
export function create_server(input: CreateServerInput): ServerInstance {
  check_input(input);
  return new ServerInstance(input);
}
