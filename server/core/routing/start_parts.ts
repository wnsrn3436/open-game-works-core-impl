/**
 * The parts of server start without instance state: the input check, the settings object of modules, routing's
 * settings, the server build data, the secret file, the module preparation order, and the `core` objects.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { member_names } from './collect.ts';
import type { Env, RoutingDeps, RoutingSettings } from './context.ts';
import type { DevObject, ModuleObject } from './module_api.ts';
import { ENV_GAME_SETTINGS, MODULE_DEPENDENCIES } from './spec_tables.ts';

const ENVS: ReadonlySet<string> = new Set(['LOCAL', 'DEV', 'STG', 'PROD']);

const is_function_or_none = (v: unknown): boolean => v === undefined || v === null || typeof v === 'function';
const is_object = (v: unknown): boolean => typeof v === 'object' && v !== null;

/** Throws a `TypeError` naming the first part of the `create_server` input that has the wrong form. */
export function check_input(value: unknown): void {
  const input = (is_object(value) ? value : {}) as Record<string, unknown>;
  const args = (is_object(input.args) ? input.args : {}) as Record<string, unknown>;
  const port = args.port;
  const modules = input.server_modules;
  const checks: [boolean, string][] = [
    [is_object(value), 'the input is not an object'],
    [typeof args.env === 'string' && ENVS.has(args.env), 'args.env is not LOCAL, DEV, STG or PROD'],
    [port === undefined || (typeof port === 'number' && Number.isInteger(port) && port >= 0 && port <= 65535), 'args.port is not a port number'],
    [args.matchmaker === undefined || typeof args.matchmaker === 'boolean', 'args.matchmaker is not a boolean'],
    [args.db === undefined || typeof args.db === 'string', 'args.db is not a string'],
    [args.secret_file === undefined || typeof args.secret_file === 'string', 'args.secret_file is not a string'],
    [Array.isArray(modules) && modules.every((m) => typeof m === 'string'), 'server_modules is not a list of module names'],
    [typeof input.data_folder === 'string', 'data_folder is not a path'],
    [is_object(input.core_settings) && is_object(input.game_settings), 'core_settings or game_settings is not an object'],
    [typeof input.register === 'function', 'register is not a function'],
    [typeof input.dev === 'boolean', 'dev is not a boolean'],
    [is_function_or_none(input.register_dev) && is_function_or_none(input.log_writer), 'register_dev or log_writer is not a function'],
  ];
  const failed = checks.find(([ok]) => !ok);
  if (failed !== undefined) throw new TypeError(`create_server: ${failed[1]}`);
}

const ENV_PREFIX = 'environments.<ENV>.';
const GAME_ENVS: readonly string[] = ['DEV', 'STG', 'PROD'];

/** The empty value of a spec settings type (`core` `## core settings`). */
export function empty_value(type: string): unknown {
  if (type.endsWith('?')) return null;
  if (type === 'string') return '';
  if (type === 'integer' || type === 'number') return 0;
  if (type === 'boolean') return false;
  if (type === 'object') return {};
  return [];
}

function is_record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** The LOCAL `adapters` (`server-core` `## adapter`): every adapter key of DEV, STG or PROD with the value `fake`. */
function local_adapters(values: Readonly<Record<string, unknown>>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const env of GAME_ENVS) {
    const whole = values[`environments.${env}.adapters`];
    if (is_record(whole)) for (const key of Object.keys(whole)) out[key] = 'fake';
    for (const [path, value] of Object.entries(values)) {
      const prefix = `environments.${env}.adapters.`;
      if (path.startsWith(prefix) && typeof value === 'string') out[path.slice(prefix.length)] = 'fake';
    }
  }
  return out;
}

/** The value at `rest` (a `.` path) inside an object value; undefined when it is not there. */
function inside(value: unknown, rest: string): unknown {
  let current = value;
  for (const segment of rest.split('.')) {
    if (!is_record(current)) return undefined;
    current = current[segment];
  }
  return current;
}

/**
 * The settings object every module gets (`server-core` `## module`): core settings keys and game settings paths. A
 * path with `<ENV>` keeps `<ENV>` and holds this environment's value. LOCAL has no game settings environment: its
 * `adapters` are the LOCAL value of `## adapter`, and its other items the empty value of their type. Overrides of
 * other keys come first, so an override of `environments.<the env>.<path>` is the `<ENV>` value; an override of a
 * `<ENV>` key comes last, and one of an object item also gives the items below it.
 */
export function module_settings(env: Env, core_settings: Readonly<Record<string, unknown>>, game_settings: Readonly<Record<string, unknown>>, overrides: Readonly<Record<string, unknown>> | null | undefined): Record<string, unknown> {
  const given = Object.entries(overrides ?? {});
  const flat: Record<string, unknown> = { ...core_settings, ...game_settings };
  for (const [key, value] of given) if (!key.startsWith(ENV_PREFIX)) flat[key] = value;
  if (env === 'LOCAL') set_local_items(flat);
  else set_env_items(flat, env);
  for (const [key, value] of given) if (key.startsWith(ENV_PREFIX)) set_env_override(flat, key, value);
  return flat;
}

/** The LOCAL `<ENV>` items: the LOCAL `adapters` and the empty value of the other items. */
function set_local_items(flat: Record<string, unknown>): void {
  const adapters = local_adapters(flat);
  for (const [rest, type] of Object.entries(ENV_GAME_SETTINGS)) {
    if (rest === 'adapters') flat[`${ENV_PREFIX}${rest}`] = adapters;
    else if (rest.startsWith('adapters.')) flat[`${ENV_PREFIX}${rest}`] = adapters[rest.slice('adapters.'.length)] ?? null;
    else flat[`${ENV_PREFIX}${rest}`] = empty_value(type);
  }
}

/** The `<ENV>` items of a game settings environment: its `environments.<env>.<path>` values. */
function set_env_items(flat: Record<string, unknown>, env: Env): void {
  const prefix = `environments.${env}.`;
  for (const [key, value] of Object.entries(flat)) if (key.startsWith(prefix)) flat[`${ENV_PREFIX}${key.slice(prefix.length)}`] = value;
}

/** An override of an `<ENV>` key; an object item also gives the items below it. */
function set_env_override(flat: Record<string, unknown>, key: string, value: unknown): void {
  flat[key] = value;
  if (!is_record(value)) return;
  const parent = key.slice(ENV_PREFIX.length);
  for (const [rest, type] of Object.entries(ENV_GAME_SETTINGS)) {
    if (!rest.startsWith(`${parent}.`)) continue;
    const below = inside(value, rest.slice(parent.length + 1));
    flat[`${ENV_PREFIX}${rest}`] = below === undefined ? empty_value(type) : below;
  }
}

export function number_setting(settings: Readonly<Record<string, unknown>>, key: string, fallback: number | null): number {
  const value = settings[key];
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (fallback !== null && value === undefined) return fallback;
  throw new Error(`setting ${key} is not a number`);
}

export function routing_settings(env: Env, settings: Readonly<Record<string, unknown>>): RoutingSettings {
  const origins = settings['environments.<ENV>.corsAllowedOrigins'];
  const server_url = settings['environments.<ENV>.serverUrl'];
  return {
    max_body_bytes: number_setting(settings, 'routing.maxBodyBytes', null),
    body_read_timeout_ms: number_setting(settings, 'routing.bodyReadTimeoutMs', null),
    user_rate_limit_per_minute: number_setting(settings, 'routing.userRateLimitPerMinute', null),
    ip_rate_limit_per_minute: number_setting(settings, 'routing.ipRateLimitPerMinute', null),
    cors_preflight_max_age_ms: number_setting(settings, 'routing.corsPreflightMaxAgeMs', null),
    storage_sweep_interval_ms: number_setting(settings, 'routing.storageSweepIntervalMs', null),
    trusted_proxy_count: env === 'LOCAL' ? 0 : number_setting(settings, 'environments.<ENV>.trustedProxyCount', 0),
    cors_allowed_origins: Array.isArray(origins) ? origins.filter((o): o is string => typeof o === 'string') : [],
    server_url: typeof server_url === 'string' ? server_url : '',
  };
}

export function read_text_line(path: string): string | null {
  try {
    return readFileSync(path, 'utf8').trim();
  } catch {
    return null;
  }
}

/** The server build data: table binaries and translation binaries by file name, and the data versions. */
export function read_build_data(folder: string): { binaries: Map<string, Uint8Array>; data_version: string | null; client: string | null; compat: string | null } {
  const binaries = new Map<string, Uint8Array>();
  for (const name of readdirSync(folder)) {
    const path = join(folder, name);
    if (name.endsWith('.bin') && statSync(path).isFile()) binaries.set(name, new Uint8Array(readFileSync(path)));
  }
  return {
    binaries,
    data_version: read_text_line(join(folder, 'data_version')),
    client: read_text_line(join(folder, 'client_data_version')),
    compat: read_text_line(join(folder, 'compat_client_data_version')),
  };
}

/** The file adapter: a file of the server build data folder by name; null when there is no such file. */
export function read_data_file(folder: string, name: string): Uint8Array | null {
  if (name === '' || name.includes('/') || name.includes('\\') || name === '.' || name === '..') return null;
  try {
    const path = join(folder, name);
    return statSync(path).isFile() ? new Uint8Array(readFileSync(path)) : null;
  } catch {
    return null;
  }
}

/** Where the host secret store keeps a secret in the server image (`server-image.md`). */
const HOST_SECRET_DIR = '/run/secrets';

/**
 * The secret adapter: the `--secret-file` values of a LOCAL server and a test server, or else the host secret store,
 * whose secret is the file content without one trailing line break.
 */
export function secret_reader(file_values: Readonly<Record<string, string>> | null): (name: string) => string | null {
  if (file_values !== null) return (name) => (Object.prototype.hasOwnProperty.call(file_values, name) ? (file_values[name] ?? null) : null);
  return (name) => {
    if (name === '' || name.includes('/') || name === '.' || name === '..') return null;
    try {
      return readFileSync(join(HOST_SECRET_DIR, name), 'utf8').replace(/\r?\n$/, '');
    } catch {
      return null;
    }
  };
}

/** The secret file: a JSON object of secret values. */
export function read_secret_file(path: string | undefined): Record<string, string> | string {
  if (path === undefined) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return 'the secret file cannot be read as JSON';
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return 'the secret file is not a JSON object';
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) if (typeof value === 'string') out[key] = value;
  return out;
}

/**
 * Module preparation order: each module after its dependencies, and after an optional dependency when that edge
 * makes no cycle with the edges taken so far. Ties go by module name.
 */
export function preparation_order(modules: readonly string[]): string[] {
  const present = [...new Set(modules)].sort();
  const set = new Set(present);
  const edges = new Map<string, Set<string>>(present.map((m) => [m, new Set((MODULE_DEPENDENCIES[m]?.dependencies ?? []).filter((d) => set.has(d)))]));
  const reaches = (from: string, to: string): boolean => {
    const seen = new Set<string>();
    const stack = [from];
    while (stack.length > 0) {
      const at = stack.pop() as string;
      if (at === to) return true;
      if (seen.has(at)) continue;
      seen.add(at);
      for (const next of edges.get(at) ?? []) stack.push(next);
    }
    return false;
  };
  for (const module of present) {
    for (const dep of MODULE_DEPENDENCIES[module]?.optional ?? []) {
      if (set.has(dep) && !reaches(dep, module)) edges.get(module)?.add(dep);
    }
  }
  const order: string[] = [];
  const done = new Set<string>();
  const visit = (module: string): void => {
    if (done.has(module)) return;
    done.add(module);
    for (const dep of [...(edges.get(module) ?? [])].sort()) visit(dep);
    order.push(module);
  };
  for (const module of present) visit(module);
  return order;
}

/** The object of a module in content `register(core)`: its member `content` when it has one, else the module object. */
export function content_object(object: ModuleObject): ModuleObject {
  const content = object.content;
  return content !== null && typeof content === 'object' ? (content as ModuleObject) : object;
}

/** A module object with its DEV object's operations: the `core` that `registerDev` gets. */
export function merge_objects(object: ModuleObject, dev: DevObject | undefined): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const source of dev === undefined ? [object] : [object, dev]) {
    for (const name of member_names(source)) {
      const value = (source as Record<string, unknown>)[name];
      out[name] = typeof value === 'function' ? (value as (...args: unknown[]) => unknown).bind(source) : value;
    }
  }
  return out;
}

export function routing_deps(modules: ReadonlyMap<string, ModuleObject>): RoutingDeps {
  const get = (name: string): unknown => modules.get(name);
  return {
    storage: get('storage'),
    server_time: get('server-time'),
    auth: get('auth'),
    session: get('session'),
    idempotency: get('idempotency'),
    admin_api: get('admin-api'),
    logging: get('logging'),
    validation: get('validation'),
    game_update: get('game-update'),
  } as RoutingDeps;
}

