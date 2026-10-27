/**
 * routing's module object: the content registration operations (`register_handler`, `register_hook`,
 * `register_admin_operation`) and routing's own server start work (table `routing_rate_counter`, job
 * `storage_sweep`).
 */
import * as GameContract from '../../generated/contract/game_contract.ts';
import type { CheatPaths, InstanceState, ServerInput } from './context.ts';
import type { AdminOperation, CoreRpcHandler, DevObject, LoggingModule, ModuleObject, ServerTimeModule, StorageModule } from './module_api.ts';
import type { Pipeline } from './pipeline.ts';
import { register_rate_counter } from './rate_limit.ts';

export interface RoutingInput {
  settings: Readonly<Record<string, unknown>>;
  modules: Readonly<Record<string, ModuleObject>>;
  server: ServerInput;
}

/** What routing's DEV code attaches to the routing module object (see `dev/index.ts`). */
export interface RoutingDevAttachment {
  /** Calls content `registerDev(core)` once; right after `register`. */
  register_dev(register_dev: ((core: Readonly<Record<string, unknown>>) => unknown) | null, core: Readonly<Record<string, unknown>>): Promise<void>;
  /** Collects the cheat handlers after registration; the start failures. */
  collect(modules: ReadonlyMap<string, ModuleObject>, dev_objects: ReadonlyMap<string, DevObject>): string[];
  /** The cheat paths and `dev` of the instance, once its request state is ready. */
  ready(state: InstanceState, pipeline: Pipeline, dev_objects: ReadonlyMap<string, DevObject>): {
    cheat: CheatPaths;
    call_dev(module: string, operation: string, args: unknown[], user_id: bigint | null): Promise<unknown>;
  };
}

type Window = 'before' | 'open' | 'closed';

function as_number(value: unknown, key: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`core setting ${key} is not a number`);
  return value;
}

export class RoutingModule {
  private readonly input: RoutingInput;
  private window: Window = 'before';
  private started = false;
  /** Game `rpc` name to handler. */
  readonly game_handlers = new Map<string, CoreRpcHandler>();
  /** Registered hooks: module name to hook name to hook. */
  readonly hooks = new Map<string, Map<string, unknown>>();
  readonly content_admin_operations: AdminOperation[] = [];
  /** Registration errors; each is a server start failure. */
  readonly errors: string[] = [];
  /** Every prepared module of the server instance; set before `register`. */
  prepared: ReadonlyMap<string, ModuleObject> = new Map();
  dev: RoutingDevAttachment | null = null;

  constructor(input: RoutingInput) {
    this.input = input;
  }

  private outside(operation: string): boolean {
    if (this.window === 'open') return false;
    if (this.started) throw new Error(`${operation} is called outside register`);
    this.errors.push(`${operation} is called outside register`);
    return true;
  }

  /** `register_handler`: a handler of a `service Game` `rpc`. */
  readonly register_handler = (name: string, handler: CoreRpcHandler): void => {
    if (this.outside('register_handler')) return;
    if (!GameContract.RPCS.some((info) => info.name === name)) {
      this.errors.push(`register_handler: ${name} is not an rpc of service Game`);
      return;
    }
    if (typeof handler !== 'function') {
      this.errors.push(`register_handler: the handler of ${name} is not a function`);
      return;
    }
    if (this.game_handlers.has(name)) {
      this.errors.push(`register_handler: ${name} is registered twice`);
      return;
    }
    this.game_handlers.set(name, handler);
  };

  /** `register_hook`: a hook into a hook slot of a prepared module. */
  readonly register_hook = (module: string, hook: string, fn: unknown): void => {
    if (this.outside('register_hook')) return;
    const object = this.prepared.get(module);
    if (object === undefined) {
      this.errors.push(`register_hook: ${module} is not a prepared module`);
      return;
    }
    const slots = object.hook_slots;
    if (slots === null || typeof slots !== 'object' || !Object.prototype.hasOwnProperty.call(slots, hook)) {
      this.errors.push(`register_hook: ${module} has no hook slot ${hook}`);
      return;
    }
    if (typeof fn !== 'function') {
      this.errors.push(`register_hook: the hook ${module}.${hook} is not a function`);
      return;
    }
    const registered = this.hooks.get(module) ?? new Map<string, unknown>();
    if (registered.has(hook)) {
      this.errors.push(`register_hook: ${module}.${hook} is registered twice`);
      return;
    }
    registered.set(hook, fn);
    this.hooks.set(module, registered);
  };

  /** `register_admin_operation`: a content admin operation, passed to `admin-api` with module name `game`. */
  readonly register_admin_operation = (operation: AdminOperation): void => {
    if (this.outside('register_admin_operation')) return;
    const name = (operation as { name?: unknown } | null)?.name;
    if (typeof name !== 'string' || !name.startsWith('game_')) {
      this.errors.push(`register_admin_operation: content admin operation ${typeof name === 'string' ? name : '(no name)'} does not start with game_`);
      return;
    }
    this.content_admin_operations.push(operation);
  };

  /**
   * What content `register(core)` and `registerDev(core)` get as `core.routing`: the three registration operations
   * only, so content cannot reach the register window or the collected state.
   */
  readonly content: Readonly<Pick<RoutingModule, 'register_handler' | 'register_hook' | 'register_admin_operation'>> = {
    register_handler: this.register_handler,
    register_hook: this.register_hook,
    register_admin_operation: this.register_admin_operation,
  };

  open_window(): void {
    this.window = 'open';
  }

  /** Ends `register` and `registerDev`, and puts the registered hooks into their hook slots. */
  close_window(): void {
    this.window = 'closed';
    for (const [module, hooks] of this.hooks) {
      const slots = this.prepared.get(module)?.hook_slots as Record<string, unknown> | undefined;
      if (slots === undefined) continue;
      for (const [hook, fn] of hooks) slots[hook] = fn;
    }
  }

  mark_started(): void {
    this.started = true;
  }

  begin_start(): void {
    const storage = this.input.modules.storage as unknown as StorageModule;
    const server_time = this.input.modules['server-time'] as unknown as ServerTimeModule;
    const logging = this.input.modules.logging as unknown as LoggingModule;
    register_rate_counter(storage);
    const interval = as_number(this.input.settings['routing.storageSweepIntervalMs'], 'routing.storageSweepIntervalMs');
    const error = (message: string, stack_trace: string | null): void => {
      logging.write({ level: 'error', kind: 'error', user_id: null, request_id: null, request: null, message, fields: { stack_trace } });
    };
    const step = async (name: string, run: () => Promise<boolean>): Promise<void> => {
      try {
        if (!(await run())) error(`storage_sweep: ${name} failed`, null);
      } catch (e) {
        error(`storage_sweep: ${name} threw`, e instanceof Error ? (e.stack ?? String(e)) : String(e));
      }
    };
    server_time.schedule_job('storage_sweep', BigInt(interval), async () => {
      // One error log per table whose delete failed, with its table name and DB error code.
      await step('sweep_expired', async () => {
        for (const { table, code } of (await storage.sweep_expired()).failed) error(`storage_sweep: sweep_expired failed on table ${table}, DB error code '${code}'`, null);
        return true;
      });
      await step('run_user_changes', async () => (await storage.run_user_changes()) !== 'FAILED');
    });
  }

  complete_start(): string | null {
    return null;
  }

  stop(): void {}
}

/** The module form entry of routing. `create_server` makes routing's module object with it. */
export function create_routing(input: RoutingInput): RoutingModule {
  return new RoutingModule(input);
}
