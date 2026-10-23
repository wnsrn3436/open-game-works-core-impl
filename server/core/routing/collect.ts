/**
 * Server start collection of what the prepared modules export: core `rpc` handlers, routes, `on_request_start`,
 * request prepare operations and admin operations, with the start failures of missing and doubled exports.
 */
import type * as CoreContract from '../../generated/contract/core_contract.ts';
import type { CoreRpcEntry, RouteEntry } from './context.ts';
import type { AdminOperation, CoreRpcHandler, ModuleObject, PrepareOperation, RouteHandler } from './module_api.ts';
import { MATCHMAKER_ROUTES, MODULE_ADMIN_OPERATIONS, MODULE_CORE_RPCS, MODULE_ROUTES, REQUEST_PREPARE, REQUEST_START_ORDER, UPDATE_ROUTES } from './spec_tables.ts';

export interface CollectInput {
  /** The prepared modules by name. */
  modules: ReadonlyMap<string, ModuleObject>;
  /** The server instance opens `GET /realtime` (`--matchmaker`). */
  matchmaker: boolean;
  /** `CoreContract.RPCS`. */
  core_rpcs: readonly CoreContract.RpcInfo[];
}

export interface CollectResult {
  core_rpcs: Map<string, CoreRpcEntry>;
  routes: RouteEntry[];
  request_start: ((user_id: bigint) => unknown)[];
  prepare: Map<string, PrepareOperation>;
  admin_operations: { module: string; operation: AdminOperation }[];
  errors: string[];
}

const ROUTE_KEY = /^(GET|POST|PUT|PATCH|DELETE|HEAD) (\/\S*)$/;

/** Every property name of an object, its prototype chain included (class methods). */
export function member_names(object: object): string[] {
  const names = new Set<string>();
  for (let o: object | null = object; o !== null && o !== Object.prototype; o = Object.getPrototypeOf(o) as object | null) {
    for (const name of Object.getOwnPropertyNames(o)) if (name !== 'constructor') names.add(name);
  }
  return [...names];
}

function bound(object: ModuleObject, name: string): ((...args: never[]) => unknown) | null {
  const value = object[name];
  return typeof value === 'function' ? (value as (...args: never[]) => unknown).bind(object) : null;
}

/** Modules by the names of their function members that `test` picks. */
function exporters(modules: ReadonlyMap<string, ModuleObject>, test: (name: string) => boolean): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const [module, object] of modules) {
    for (const name of member_names(object)) {
      if (typeof object[name] === 'function' && test(name)) out.set(name, [...(out.get(name) ?? []), module]);
    }
  }
  return out;
}

function doubled(found: ReadonlyMap<string, readonly string[]>, what: (name: string) => string, errors: string[]): void {
  for (const [name, modules] of found) if (modules.length > 1) errors.push(`modules ${modules.join(', ')} export the same ${what(name)}`);
}

/** Core rpc handlers: a module's method named after the core rpc. */
function collect_core_rpcs(input: CollectInput, errors: string[]): Map<string, CoreRpcEntry> {
  const infos = new Map(input.core_rpcs.map((info) => [info.name, info]));
  doubled(exporters(input.modules, (name) => infos.has(`core/${name}`)), (name) => `core rpc core/${name}`, errors);
  const out = new Map<string, CoreRpcEntry>();
  for (const [module, object] of input.modules) {
    for (const short of MODULE_CORE_RPCS[module] ?? []) {
      const name = `core/${short}`;
      const info = infos.get(name);
      const handler = bound(object, short);
      if (info === undefined) errors.push(`core rpc ${name} of ${module} is not in the base proto`);
      else if (handler === null) errors.push(`${module} has no handler of its core rpc ${name}`);
      else {
        if (info.validate === null) errors.push(`the contract tool made no server field validator of core rpc ${name}`);
        out.set(name, { module, info, handler: handler as CoreRpcHandler });
      }
    }
  }
  return out;
}

function route_entry(module: string, key: string, handler: (...args: never[]) => unknown): RouteEntry | null {
  const match = ROUTE_KEY.exec(key);
  if (match === null) return null;
  return { module, key, method: match[1] ?? '', segments: (match[2] ?? '').split('/').slice(1), handler: handler as RouteHandler, update: UPDATE_ROUTES.has(key) };
}

/** Routes: a module's method named after the route as the spec writes it. */
function collect_routes(input: CollectInput, errors: string[]): RouteEntry[] {
  const found = exporters(input.modules, (name) => ROUTE_KEY.test(name));
  doubled(found, (name) => `route ${name}`, errors);
  const out: RouteEntry[] = [];
  for (const [module, object] of input.modules) {
    for (const key of MODULE_ROUTES[module] ?? []) if (bound(object, key) === null) errors.push(`${module} has no handler of its route ${key}`);
  }
  for (const [key, modules] of found) {
    const module = modules[0];
    const object = module === undefined ? undefined : input.modules.get(module);
    const handler = object === undefined ? null : bound(object, key);
    const skip = modules.length > 1 || (MATCHMAKER_ROUTES.has(key) && !input.matchmaker);
    const entry = handler === null || module === undefined || skip ? null : route_entry(module, key, handler);
    if (entry !== null) out.push(entry);
  }
  return out;
}

/** The request start table. */
function collect_request_start(input: CollectInput, errors: string[]): ((user_id: bigint) => unknown)[] {
  const out: ((user_id: bigint) => unknown)[] = [];
  for (const module of REQUEST_START_ORDER) {
    const object = input.modules.get(module);
    const operation = object === undefined ? null : bound(object, 'on_request_start');
    if (object !== undefined && operation === null) errors.push(`${module} has no on_request_start`);
    if (operation !== null) out.push(operation as (user_id: bigint) => unknown);
  }
  return out;
}

/** The request prepare table. */
function collect_prepare(input: CollectInput, errors: string[]): Map<string, PrepareOperation> {
  const out = new Map<string, PrepareOperation>();
  for (const [name, { module, operation }] of REQUEST_PREPARE) {
    const object = input.modules.get(module);
    const fn = object === undefined ? null : bound(object, operation);
    if (object !== undefined && fn === null) errors.push(`${module} has no request prepare operation ${operation}`);
    if (fn !== null) out.set(name, fn as PrepareOperation);
  }
  return out;
}

/** Admin operations: only the operations with caller `operator`. */
function collect_admin(input: CollectInput, errors: string[]): { module: string; operation: AdminOperation }[] {
  const out: { module: string; operation: AdminOperation }[] = [];
  for (const [module, object] of input.modules) {
    for (const name of MODULE_ADMIN_OPERATIONS[module] ?? []) {
      const operation = object[name];
      if (operation !== null && typeof operation === 'object') out.push({ module, operation: operation as AdminOperation });
      else errors.push(`${module} does not export its admin operation ${name}`);
    }
  }
  return out;
}

export function collect_exports(input: CollectInput): CollectResult {
  const errors: string[] = [];
  const core_rpcs = collect_core_rpcs(input, errors);
  const routes = collect_routes(input, errors);
  const request_start = collect_request_start(input, errors);
  const prepare = collect_prepare(input, errors);
  const admin_operations = collect_admin(input, errors);
  return { core_rpcs, routes, request_start, prepare, admin_operations, errors };
}
