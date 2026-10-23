// cheat: core cheats, the cheat handler registry and the cheat time offset. The whole module is DEV code.
import * as CoreContract from '../../../generated/contract/core_contract.ts';
import * as GameContract from '../../../generated/contract/game_contract.ts';
import * as CoreCheatContract from '../../../dev/generated/contract/core_cheat_contract.ts';
import * as GameCheatContract from '../../../dev/generated/contract/game_cheat_contract.ts';
import { create_server_time_dev } from '../../server-time/dev/index.ts';
import type { CheatContract, DbHandle, RequestCtx, ServerTime, Storage } from './deps.ts';
import { is_offset_in_range, read_offset, register_offset_table, write_offset } from './offset_table.ts';
import { create_cheat_registry, type CheatEntry, type CheatHandler } from './registry.ts';
import { decode_user_state, find_content_kind } from './user_state.ts';

export type { CheatContract } from './deps.ts';
export type { CheatEntry, CheatHandler } from './registry.ts';

/** The module input (`server-core` `## module`). cheat reads only `modules`. */
export interface CheatInput {
  readonly settings: Readonly<Record<string, unknown>>;
  readonly modules: Readonly<Record<string, unknown>>;
  readonly server?: unknown;
}

/** The `cheat` module object: the `## DEV` operations and the lifecycle. */
export interface Cheat {
  register_cheat_handler(name: string, handler: CheatHandler): void;
  list_cheat_handlers(): readonly CheatEntry[];
  get_time_offset(user_id: bigint, db: DbHandle): bigint;
  SetTimeOffset(ctx: RequestCtx, request: CoreCheatContract.SetTimeOffsetRequest): CoreCheatContract.SetTimeOffsetResponse | number;
  SetUserState(ctx: RequestCtx, request: CoreCheatContract.SetUserStateRequest): CoreCheatContract.SetUserStateResponse | number;
  DeleteUserState(ctx: RequestCtx, request: CoreCheatContract.DeleteUserStateRequest): CoreCheatContract.DeleteUserStateResponse | number;
  begin_start(): void;
  complete_start(): string | null;
  stop(): void;
}

const INVALID_REQUEST = CoreContract.CoreError.CORE_ERROR_INVALID_REQUEST;

/** The module object `name` of `modules`; throws when it has no function `member`. */
function module_of(modules: Readonly<Record<string, unknown>>, name: string, member: string): unknown {
  const module = modules[name] as Record<string, unknown> | undefined;
  if (typeof module?.[member] !== 'function') throw new TypeError(`cheat: modules has no ${name}`);
  return module;
}

/** Makes `cheat` with explicit contract lists; `create_cheat` passes the generated contract code. */
export function create_cheat_with(input: CheatInput, contract: CheatContract): Cheat {
  const storage = module_of(input.modules, 'storage', 'register_table') as Storage;
  const server_time = module_of(input.modules, 'server-time', 'clock_now') as ServerTime;

  const get_time_offset = (user_id: bigint, db: DbHandle): bigint => read_offset(db, user_id);

  const SetTimeOffset: Cheat['SetTimeOffset'] = (ctx, request) => {
    if (!is_offset_in_range(server_time.clock_now(), request.offset_ms)) return INVALID_REQUEST;
    write_offset(storage.db(ctx), ctx.user_id, request.offset_ms);
    return new CoreCheatContract.SetTimeOffsetResponse();
  };

  const SetUserState: Cheat['SetUserState'] = (ctx, request) => {
    const kind = find_content_kind(contract.game_kinds, contract.core_kinds, request.kind, request.item_id);
    if (kind === null) return INVALID_REQUEST;
    const value = decode_user_state(kind, request.item_id, request.value_json);
    if (value === null) return INVALID_REQUEST;
    storage.put_state(ctx, value as Parameters<Storage['put_state']>[1]);
    return new CoreCheatContract.SetUserStateResponse();
  };

  const DeleteUserState: Cheat['DeleteUserState'] = (ctx, request) => {
    const kind = find_content_kind(contract.game_kinds, contract.core_kinds, request.kind, request.item_id);
    if (kind === null) return INVALID_REQUEST;
    storage.delete_state(ctx, kind.kind_class, request.item_id);
    return new CoreCheatContract.DeleteUserStateResponse();
  };

  const core_handlers: Readonly<Record<string, CheatHandler>> = {
    SetTimeOffset,
    SetUserState,
    DeleteUserState,
  };
  const core: CheatEntry[] = Object.entries(core_handlers).map(([name, handler]) => {
    const request_name = `core/cheat/${name}`;
    const rpc = CoreCheatContract.RPCS.find((r) => r.name === request_name);
    if (rpc === undefined) throw new Error(`cheat: base proto has no core cheat ${request_name}`);
    return { name, request_name, core: true, rpc, handler };
  });
  const registry = create_cheat_registry(contract.game_cheat_rpcs, core);

  return {
    register_cheat_handler: (name, handler) => {
      registry.register(name, handler);
    },
    list_cheat_handlers: () => registry.list(),
    get_time_offset,
    SetTimeOffset,
    SetUserState,
    DeleteUserState,
    begin_start: () => {
      register_offset_table(storage);
      create_server_time_dev(server_time).register_offset_provider((user_id, db) => get_time_offset(user_id, db as DbHandle));
    },
    complete_start: () => registry.close(),
    stop: () => undefined,
  };
}

/** The `cheat` module of one server instance (`server-core` `## module`). */
export function create_cheat(input: CheatInput): Cheat {
  return create_cheat_with(input, { game_kinds: GameContract.KINDS, core_kinds: CoreContract.KINDS, game_cheat_rpcs: GameCheatContract.RPCS });
}
