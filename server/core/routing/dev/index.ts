/**
 * routing's DEV code: content `registerDev`, the cheat paths (dev access, `cheat`'s processing order, `audit`
 * log), and `dev` of a server instance with DEV code.
 */
import { createHash, timingSafeEqual } from 'node:crypto';
import * as CoreContract from '../../../generated/contract/core_contract.ts';
import * as CoreCheatContract from '../../../dev/generated/contract/core_cheat_contract.ts';
import { ip_in_cidrs } from '../../admin-api/index.ts';
import type { CheatPaths, Env, InstanceState } from '../context.ts';
import { header } from '../http.ts';
import type { CheatHandler, CheatModule, DevObject, ErrorCode, LogValue, Message, ModuleObject, RequestCtx, StorageModule, TokenlessHandler } from '../module_api.ts';
import type { AuthTarget, Exchange, Pipeline } from '../pipeline.ts';
import type { RoutingModule } from '../routing_module.ts';
import { CTX_DEV_OPERATIONS, MODULE_CORE_CHEATS } from '../spec_tables.ts';

const E = CoreContract.CoreError;
const DEV_LOGIN = 'core/cheat/DevLogin';
const SET_TIME_OFFSET = 'core/cheat/SetTimeOffset';

interface CheatEntry {
  /** Cheat name without `core/cheat/` or `cheat/`. */
  cheat: string;
  module: string;
  info: CoreContract.RpcInfo;
  handler: CheatHandler | TokenlessHandler;
}

function digest(text: string): Buffer {
  return createHash('sha256').update(text, 'utf8').digest();
}

/** Constant-time comparison of two strings. */
export function same_secret(given: string, expected: string): boolean {
  return timingSafeEqual(digest(given), digest(expected)) && given.length === expected.length;
}

/**
 * The dev access check before the body (`cheat` `### dev access`): the header value against the dev access value (the
 * secret file's `devAccess` of a LOCAL server and a test server, the secret `environments.DEV.secrets.devAccess` on
 * DEV), and on DEV the client IP against `environments.DEV.devAllowedCidrs` unless it is null.
 */
export function passes_dev_access(env: Env, expected: string | null, given: string | null, client_ip: string, allowed_cidrs: readonly string[] | null): boolean {
  if (expected === null || given === null || !same_secret(given, expected)) return false;
  return env !== 'DEV' || allowed_cidrs === null || ip_in_cidrs(client_ip, allowed_cidrs);
}

/** True when a ctx DEV operation's output is one of its failure values. */
function is_failure_value(key: string, output: unknown): boolean {
  if (key === 'item-ledger.set_balance') return output !== 'OK' && output !== 0;
  return false;
}

class RoutingDev {
  private readonly cheats = new Map<string, CheatEntry>();

  async register_dev(register_dev: ((core: Readonly<Record<string, unknown>>) => unknown) | null, core: Readonly<Record<string, unknown>>): Promise<void> {
    if (register_dev !== null) await register_dev(core);
  }

  collect(modules: ReadonlyMap<string, ModuleObject>, dev_objects: ReadonlyMap<string, DevObject>): string[] {
    const errors: string[] = [];
    const core_infos = new Map(CoreCheatContract.RPCS.map((info) => [info.name, info]));
    const add = (module: string, name: string, cheat: string, info: CoreContract.RpcInfo | undefined, core: boolean, handler: unknown): void => {
      if (info === undefined) {
        errors.push(`cheat ${cheat} of ${module} is not in the contract`);
        return;
      }
      if (typeof handler !== 'function') {
        errors.push(`${module} has no handler of its cheat ${cheat}`);
        return;
      }
      const previous = this.cheats.get(name);
      if (previous !== undefined) {
        errors.push(`modules ${previous.module}, ${module} export the same cheat ${name}`);
        return;
      }
      if (core && info.validate === null) errors.push(`the contract tool made no field validator of core cheat ${name}`);
      this.cheats.set(name, { cheat, module, info, handler: handler as CheatHandler });
    };
    const cheat = modules.get('cheat') as unknown as CheatModule | undefined;
    if (cheat !== undefined && typeof cheat.list_cheat_handlers === 'function') {
      for (const entry of cheat.list_cheat_handlers()) add('cheat', entry.request_name, entry.name, entry.rpc, entry.core, entry.handler);
    }
    for (const [module, names] of Object.entries(MODULE_CORE_CHEATS)) {
      if (!modules.has(module)) continue;
      const dev = dev_objects.get(module);
      for (const name of names) {
        const value = dev?.[name];
        const request_name = `core/cheat/${name}`;
        add(module, request_name, name, core_infos.get(request_name), true, typeof value === 'function' ? (value as (...args: never[]) => unknown).bind(dev) : undefined);
      }
    }
    return errors;
  }

  ready(state: InstanceState, pipeline: Pipeline, dev_objects: ReadonlyMap<string, DevObject>): { cheat: CheatPaths; call_dev(module: string, operation: string, args: unknown[], user_id: bigint | null): Promise<unknown> } {
    return {
      cheat: { handle: (exchange, name) => this.handle(state, pipeline, exchange, name), has: (name) => this.cheats.has(name) },
      call_dev: (module, operation, args, user_id) => this.call_dev(state, dev_objects, module, operation, args, user_id),
    };
  }

  private dev_access(state: InstanceState, exchange: Exchange): boolean {
    const given = header(exchange.req.headers, 'x-ogw-dev-access');
    const { expected, allowed_cidrs } = dev_access_inputs(state);
    return passes_dev_access(state.server.env, expected, given, exchange.client_ip, allowed_cidrs);
  }

  private audit(state: InstanceState, exchange: Exchange, args: unknown, result: number, user_id: bigint | null): void {
    state.log({
      level: 'info',
      kind: 'audit',
      user_id,
      request_id: exchange.headers?.request_id ?? null,
      request: exchange.name,
      message: 'cheat request',
      // `args` is a JSON object; the log line writes it as it is.
      fields: { actor: 'system', args: args as LogValue, result },
    });
  }

  /**
   * `args` of the `audit` log: `to_json()` of the cheat request message, which the contract tool makes for every cheat
   * request class; null when it was not read or does not decode.
   */
  private args_of(info: CoreContract.RpcInfo | undefined, body: Uint8Array | null): unknown {
    const message = info === undefined || body === null ? null : info.request_class.decode(body);
    return message === null ? null : (message as unknown as { to_json(): unknown }).to_json();
  }

  private validate(state: InstanceState, info: CoreContract.RpcInfo, message: Message): 'pass' | CoreContract.ValidationFailure {
    return info.validate === null ? 'pass' : (info.validate(message, state.server.data) ?? 'pass');
  }

  /**
   * The dev access check, steps 2 and 3, and the cheat name; the cheat, or null when the request has ended. `DevLogin`
   * writes its `audit` line for every request past the dev access check, so its line is set before the body is read.
   */
  private async admit(state: InstanceState, pipeline: Pipeline, exchange: Exchange, name: string): Promise<{ entry: CheatEntry; body: Uint8Array } | null> {
    if (!this.dev_access(state, exchange)) {
      exchange.close_after = true;
      pipeline.security_log(exchange, 'dev_access');
      pipeline.fail(exchange, E.CORE_ERROR_UNAUTHORIZED, 'dev access: X-Ogw-Dev-Access or client IP');
      return null;
    }
    const entry = this.cheats.get(name);
    if (name === DEV_LOGIN) {
      exchange.on_done = (code) => {
        this.audit(state, exchange, this.args_of(entry?.info, exchange.body), code, exchange.user_id ?? 0n);
      };
    }
    if (entry !== undefined) exchange.sensitive = entry.info.sensitive;
    if (!(await pipeline.read_request(exchange))) return null;
    if (entry === undefined) {
      pipeline.fail(exchange, E.CORE_ERROR_INVALID_REQUEST, `unknown cheat ${name}`);
      return null;
    }
    return { entry, body: exchange.body ?? new Uint8Array(0) };
  }

  private async handle(state: InstanceState, pipeline: Pipeline, exchange: Exchange, name: string): Promise<void> {
    const admitted = await this.admit(state, pipeline, exchange, name);
    if (admitted === null) return;
    const { entry, body } = admitted;
    if (name === DEV_LOGIN) {
      if (state.deps.admin_api.is_maintenance()) pipeline.fail(exchange, E.CORE_ERROR_MAINTENANCE, 'step 4 maintenance');
      else await pipeline.process_tokenless(exchange, entry.info, entry.handler as TokenlessHandler, (m) => this.validate(state, entry.info, m));
      return;
    }
    const storage: StorageModule = state.deps.storage;
    const server_time = state.deps.server_time;
    const handler = entry.handler as CheatHandler;
    const target: AuthTarget = {
      name,
      info: entry.info,
      cheat: true,
      core: false,
      validate: (m) => this.validate(state, entry.info, m),
      invoke: (ctx: RequestCtx, m: Message): Message | ErrorCode =>
        storage.with_hook_change_source(ctx, CoreContract.ItemChangeSource.ITEM_CHANGE_SOURCE_CHEAT, entry.cheat, () => handler(ctx, m)),
      after_auth: (ex) => {
        ex.on_done = (code) => {
          if (code !== E.CORE_ERROR_RATE_LIMITED) this.audit(state, ex, this.args_of(entry.info, body), code, ex.user_id);
        };
      },
    };
    if (name === SET_TIME_OFFSET) target.success_time = (user_id) => server_time.user_now(user_id, storage.read_db());
    await pipeline.process_authenticated(exchange, target);
  }

  private async call_dev(state: InstanceState, dev_objects: ReadonlyMap<string, DevObject>, module: string, operation: string, args: unknown[], user_id: bigint | null): Promise<unknown> {
    const key = `${module}.${operation}`;
    const object: DevObject | undefined = dev_objects.get(module) ?? state.modules.get(module);
    const fn = object?.[operation];
    if (object === undefined || typeof fn !== 'function') throw new Error(`dev: ${key} is not a DEV operation of this server instance`);
    const call = (...all: unknown[]): unknown => (fn as (...a: unknown[]) => unknown).apply(object, all);
    if (!CTX_DEV_OPERATIONS.has(key)) return await Promise.resolve(call(...args));
    if (user_id === null) throw new Error(`dev: ${key} takes ctx and needs a user ID`);
    let output: unknown = undefined;
    let failure: unknown = undefined;
    const result = await state.deps.storage.run_user_transaction(user_id, (ctx) => {
      const out = call(ctx, ...args);
      if (is_failure_value(key, out)) {
        failure = out;
        return E.CORE_ERROR_INTERNAL;
      }
      output = out;
      return 'pass';
    });
    if (result === 'COMMITTED') return output;
    if (result === 'REJECTED' && failure !== undefined) return failure;
    throw new Error(`dev: ${key} ended with ${result}`);
  }
}

/**
 * The dev access inputs of the server instance: `expected`, the dev access value (null when it has none), and
 * `allowed_cidrs`, `environments.<ENV>.devAllowedCidrs` (null when it is not set).
 */
export function dev_access_inputs(state: Pick<InstanceState, 'server' | 'values'>): { expected: string | null; allowed_cidrs: string[] | null } {
  const server = state.server;
  const cidrs = state.values['environments.<ENV>.devAllowedCidrs'];
  const allowed_cidrs = Array.isArray(cidrs) ? cidrs.filter((v): v is string => typeof v === 'string') : null;
  if (server.env !== 'DEV') return { expected: server.read_secret('devAccess'), allowed_cidrs };
  const name = state.values['environments.<ENV>.secrets.devAccess'];
  return { expected: typeof name === 'string' && name !== '' ? server.read_secret(name) : null, allowed_cidrs };
}

/** The DEV object of routing. routing has no DEV operation; creating it attaches the DEV code to routing. */
export function create_routing_dev(routing: ModuleObject): DevObject {
  (routing as unknown as RoutingModule).dev = new RoutingDev();
  return {};
}
