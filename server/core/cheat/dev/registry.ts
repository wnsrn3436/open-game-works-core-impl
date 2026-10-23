// Cheat handlers: the core cheats of this module and the content cheats `registerDev` registers.
import type * as CoreContract from '../../../generated/contract/core_contract.ts';
import type { RequestCtx } from './deps.ts';

type Message = { encode(): Uint8Array };

/** A cheat handler: a cheat response message, or a `GameError` or `CoreError` value. */
export type CheatHandler = (ctx: RequestCtx, request: never) => Message | number;

/** One cheat of `list_cheat_handlers`. `name` is the cheat name, `request_name` the contract request name. */
export interface CheatEntry {
  readonly name: string;
  readonly request_name: string;
  readonly core: boolean;
  readonly rpc: CoreContract.RpcInfo;
  readonly handler: CheatHandler;
}

export interface CheatRegistry {
  register(name: string, handler: CheatHandler): void;
  /** Ends registration. A server start failure reason, or null. */
  close(): string | null;
  list(): readonly CheatEntry[];
}

const GAME_PREFIX = 'cheat/';

/** `game_rpcs` is the `service Cheat` rpc list; `core` the core cheats of this module. */
export function create_cheat_registry(game_rpcs: readonly CoreContract.RpcInfo[], core: readonly CheatEntry[]): CheatRegistry {
  const content = new Map<string, CheatHandler>();
  const errors: string[] = [];
  let closed = false;

  const rpc_of = (name: string): CoreContract.RpcInfo | undefined => game_rpcs.find((rpc) => rpc.name === GAME_PREFIX + name);

  return {
    register(name, handler) {
      if (closed) throw new Error(`register_cheat_handler: cheat ${name} registered after registerDev`);
      if (rpc_of(name) === undefined) errors.push(`register_cheat_handler: ${name} is not an rpc of service Cheat`);
      else if (content.has(name)) errors.push(`register_cheat_handler: cheat ${name} registered twice`);
      else if (typeof handler !== 'function') errors.push(`register_cheat_handler: cheat ${name} handler is not a function`);
      else content.set(name, handler);
    },
    close() {
      closed = true;
      const missing = game_rpcs
        .map((rpc) => rpc.name.slice(GAME_PREFIX.length))
        .filter((name) => !content.has(name))
        .map((name) => `service Cheat rpc ${name} has no cheat handler`);
      const all = [...errors, ...missing];
      return all.length === 0 ? null : all.join('; ');
    },
    list() {
      const entries: CheatEntry[] = [...core];
      for (const rpc of game_rpcs) {
        const name = rpc.name.slice(GAME_PREFIX.length);
        const handler = content.get(name);
        if (handler !== undefined) entries.push({ name, request_name: rpc.name, core: false, rpc, handler });
      }
      return entries;
    },
  };
}
