/**
 * reset-counter: counts data-defined reset counters of a user (counts that go back to 0 every reset cycle) and
 * judges their limit. What to count and when is up to content code.
 */
import * as CoreContract from '../../generated/contract/core_contract.ts';
import * as GameData from '../../generated/data/game_data.ts';
import type { ServerTimeApi } from '../server-time/index.ts';
import type { RequestCtx, Storage } from '../storage/index.ts';

/** The `storage` operations reset-counter calls. */
export type ResetCounterStorage = Pick<Storage, 'get_state' | 'put_core_state'>;

/** The `server-time` operations reset-counter calls. */
export type ResetCounterServerTime = Pick<ServerTimeApi, 'now' | 'get_next_reset'>;

/** The module input (`server-core` `## module`). reset-counter reads no settings and nothing of `server`. */
export interface ResetCounterInput {
  readonly settings: Readonly<Record<string, unknown>>;
  readonly modules: Readonly<Record<string, unknown>>;
  readonly server?: unknown;
}

/** `ResetCounterResult`: `OK` or the failure value `LIMIT_REACHED`. */
export type ResetCounterResult = 'OK' | 'LIMIT_REACHED';

/** An amount, a limit or a count: an integer from 0 (count) or 1 (amount, limit) to 2^53−1. */
export type CounterInteger = bigint | number;

export interface ResetCounterModule {
  begin_start(): void;
  complete_start(): string | null;
  stop(): void;
  get_count(ctx: RequestCtx, counter_id: number): bigint;
  add_count(ctx: RequestCtx, counter_id: number, amount: CounterInteger, limit?: CounterInteger): ResetCounterResult;
  /**
   * Called by the DEV code only (`dev/index.ts`, `SetResetCounter`): writes the count of a known counter as given,
   * without the limit, and `reset_at` as the next reset time. False for an unknown counter.
   */
  write_count(ctx: RequestCtx, counter_id: number, count: bigint): boolean;
}

export const MAX_COUNT = 2n ** 53n - 1n;

function module_of(modules: Readonly<Record<string, unknown>>, name: string, member: string): unknown {
  const module = modules[name] as Record<string, unknown> | undefined;
  if (typeof module?.[member] !== 'function') throw new TypeError(`reset-counter: modules has no ${name}`);
  return module;
}

/** The row of a reset counter ID value, or null for an unknown one. */
function row_of(ctx: RequestCtx, counter_id: unknown): GameData.ResetCounterRow | null {
  if (typeof counter_id !== 'number' || !Number.isSafeInteger(counter_id)) return null;
  const table = ctx.data.ResetCounterTable;
  return table.has_row(counter_id) ? table.get_row(counter_id) : null;
}

/** An amount or a limit argument as a bigint; throws when it is not an integer from 1 to 2^53−1. */
function positive(value: unknown, what: string, counter_id: number): bigint {
  let v: bigint | null = null;
  if (typeof value === 'bigint') v = value;
  else if (typeof value === 'number' && Number.isSafeInteger(value)) v = BigInt(value);
  if (v === null || v < 1n || v > MAX_COUNT) {
    throw new RangeError(`reset-counter: ${what} ${String(value)} of reset counter ${String(counter_id)} is not an integer from 1 to 2^53-1`);
  }
  return v;
}

/** `ResetCycle?` of a row: `None` is null (`server-time` `## API`). */
function cycle_of(row: GameData.ResetCounterRow): GameData.ResetCycle | null {
  return row.reset === GameData.ResetCycle.None ? null : row.reset;
}

/** Makes `reset-counter` for one server instance. A missing dependency throws. */
export function create_reset_counter(input: ResetCounterInput): ResetCounterModule {
  const storage = module_of(input.modules, 'storage', 'put_core_state') as ResetCounterStorage;
  const server_time = module_of(input.modules, 'server-time', 'get_next_reset') as ResetCounterServerTime;

  /** The count and `reset_at` after the lazy reset; a counter without a row starts at 0 with `reset_at` 0. */
  function read(ctx: RequestCtx, row: GameData.ResetCounterRow): { count: bigint; reset_at: bigint } {
    const stored = storage.get_state(ctx, CoreContract.ResetCounterUserState, BigInt(row.id)) as CoreContract.ResetCounterUserState | null;
    if (stored === null) return { count: 0n, reset_at: 0n };
    const now = server_time.now(ctx);
    if (stored.reset_at !== 0n && now >= stored.reset_at) {
      return { count: 0n, reset_at: server_time.get_next_reset(cycle_of(row), now) };
    }
    return { count: stored.count, reset_at: stored.reset_at };
  }

  function write(ctx: RequestCtx, row: GameData.ResetCounterRow, count: bigint, reset_at: bigint): void {
    const value = new CoreContract.ResetCounterUserState();
    value.id = BigInt(row.id);
    value.count = count;
    value.reset_at = reset_at === 0n ? server_time.get_next_reset(cycle_of(row), server_time.now(ctx)) : reset_at;
    storage.put_core_state(ctx, value);
  }

  return {
    begin_start() {},

    complete_start() {
      return null;
    },

    stop() {},

    get_count(ctx, counter_id) {
      const row = row_of(ctx, counter_id);
      return row === null ? 0n : read(ctx, row).count;
    },

    add_count(ctx, counter_id, amount, limit) {
      const row = row_of(ctx, counter_id);
      if (row === null) throw new RangeError(`reset-counter: ${String(counter_id)} is not a reset counter ID value`);
      const add = positive(amount, 'amount', counter_id);
      // A row limit of 0 is the null of `long?` (`data` `## type`); the data check rejects a written 0.
      const judge = limit === undefined ? (row.limit === 0n ? null : row.limit) : positive(limit, 'limit', counter_id);
      const { count, reset_at } = read(ctx, row);
      if (judge !== null && count + add > judge) return 'LIMIT_REACHED';
      const next = count + add;
      write(ctx, row, next > MAX_COUNT ? MAX_COUNT : next, reset_at);
      return 'OK';
    },

    write_count(ctx, counter_id, count) {
      const row = row_of(ctx, counter_id);
      if (row === null) return false;
      write(ctx, row, count, 0n);
      return true;
    },
  };
}
