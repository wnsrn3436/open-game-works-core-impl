/**
 * live-event: the schedule of the `live_event` rows and the active window of data rows, the participation of a user
 * in an event round, and the settlement of ended rounds through the content hook `settle_live_event`.
 */
import * as CoreContract from '../../generated/contract/core_contract.ts';
import type * as GameData from '../../generated/data/game_data.ts';
import type { ServerTimeApi } from '../server-time/index.ts';
import type { FailureCode, Pass, RequestCtx, Storage } from '../storage/index.ts';

/** The `storage` operations live-event calls. */
export type LiveEventStorage = Pick<Storage, 'get_state' | 'list_state' | 'put_core_state' | 'run_user_transaction' | 'with_hook_change_source' | 'check_hook_output'>;

/** The `server-time` operations live-event calls. */
export type LiveEventServerTime = Pick<ServerTimeApi, 'is_reached' | 'is_reached_strict'>;

/** A log entry of `logging.write` (`logging` `## API`). */
export interface LiveEventLogEntry {
  readonly kind: 'error';
  readonly level: 'error';
  readonly message: string;
  readonly user_id: bigint | null;
  readonly request_id: string | null;
  readonly request: string | null;
  readonly fields: Readonly<Record<string, unknown>>;
}

/** The `logging` operation live-event calls. */
export interface LiveEventLogging {
  write(entry: LiveEventLogEntry): void;
}

/** What live-event reads of the `server` input: the server build data. */
export interface LiveEventServer {
  readonly data: GameData.DataSet;
}

/** The module input (`server-core` `## module`). */
export interface LiveEventInput {
  readonly settings: Readonly<Record<string, unknown>>;
  readonly modules: Readonly<Record<string, unknown>>;
  readonly server: LiveEventServer;
}

export type LiveEventResult = 'OK' | 'NOT_ACTIVE' | 'NOT_SETTLED' | 'UNKNOWN_EVENT';

/** A round of an event: `round` 0 with times is the next round, `(0, 0, 0)` is none. */
export interface LiveEventRound {
  readonly round: number;
  readonly start_at: bigint;
  readonly end_at: bigint;
}

/** An active event of `get_active_events`. */
export interface ActiveLiveEvent extends LiveEventRound {
  readonly event_id: number;
}

export interface LiveEventParticipation {
  readonly round: number;
  readonly settled: boolean;
}

/** The hook `settle_live_event`: `pass` or a `GameError` value. */
export type SettleLiveEventHook = (ctx: RequestCtx, event_id: number, round: number) => Pass | number;

export interface LiveEventHookSlots {
  settle_live_event: SettleLiveEventHook | null;
}

export interface LiveEventModule {
  begin_start(): void;
  complete_start(): string | null;
  stop(): void;
  readonly hook_slots: LiveEventHookSlots;
  get_active_events(ctx: RequestCtx): ActiveLiveEvent[];
  is_active(ctx: RequestCtx, event_id: number): boolean;
  is_in_active_window(ctx: RequestCtx, start_at: bigint | null | undefined, end_at: bigint | null | undefined, live_event: number | null | undefined): boolean;
  get_round(ctx: RequestCtx, event_id: number): LiveEventRound;
  get_latest_round(event_id: number, time: bigint): LiveEventRound;
  round_to_write(ctx: RequestCtx, live_event: number | null | undefined): number;
  is_round_reset(ctx: RequestCtx, live_event: number | null | undefined, event_round: number): boolean;
  join_event(ctx: RequestCtx, event_id: number): LiveEventResult;
  get_participation(ctx: RequestCtx, event_id: number): LiveEventParticipation;
  on_request_start(user_id: bigint): Promise<void>;
}

const NO_ROUND: LiveEventRound = { round: 0, start_at: 0n, end_at: 0n };
const INT64_MAX = 2n ** 63n - 1n;
const INT32_MAX = 2n ** 31n - 1n;
const Entry = CoreContract.LiveEventEntryUserState;

/** The schedule of one `live_event` row. `repeat` and `repeat_until` are 0 for null. */
interface Schedule {
  readonly start: bigint;
  readonly end: bigint;
  readonly repeat: bigint;
  readonly until: bigint;
  /** The last round number; 0 when there is none. */
  readonly last: bigint;
}

function ceil_div(a: bigint, b: bigint): bigint {
  return a <= 0n ? 0n : (a + b - 1n) / b;
}

function min(a: bigint, b: bigint): bigint {
  return a < b ? a : b;
}

/**
 * The last round: `repeat_until` bounds the rounds of a repeated event, and a round exists only while its end time
 * is a valid target (below 2^63) and its number fits the `int32` `round` of `LiveEventEntryUserState`.
 */
function schedule_of(row: GameData.LiveEventRow): Schedule {
  const { start_at: start, end_at: end, repeat, repeat_until: until } = row;
  let last: bigint;
  if (repeat <= 0n) {
    last = 1n;
  } else {
    const by_target = end > INT64_MAX ? 0n : (INT64_MAX - end) / repeat + 1n;
    last = min(by_target, INT32_MAX);
    if (until > 0n) last = min(last, ceil_div(until - start, repeat));
  }
  if (start < 0n || end > INT64_MAX) last = 0n;
  return { start, end, repeat, until, last };
}

function round_of(s: Schedule, n: bigint): LiveEventRound {
  const shift = (n - 1n) * s.repeat;
  return { round: Number(n), start_at: s.start + shift, end_at: s.end + shift };
}

function integer_id(event_id: unknown): number | null {
  return typeof event_id === 'number' && Number.isSafeInteger(event_id) ? event_id : null;
}

function is_none(value: bigint | number | null | undefined): value is 0 | 0n | null | undefined {
  return value === null || value === undefined || value === 0n || value === 0;
}

function module_of<T>(modules: Readonly<Record<string, unknown>>, name: string, member: keyof T & string): T {
  const module = modules[name] as Record<string, unknown> | undefined;
  if (typeof module?.[member] !== 'function') throw new TypeError(`live-event: modules has no ${name}`);
  return module as T;
}

/** Makes `live-event` for one server instance. A missing dependency throws. */
export function create_live_event(input: LiveEventInput): LiveEventModule {
  const storage = module_of<LiveEventStorage>(input.modules, 'storage', 'run_user_transaction');
  const time = module_of<LiveEventServerTime>(input.modules, 'server-time', 'is_reached');
  const logging = module_of<LiveEventLogging>(input.modules, 'logging', 'write');
  const hook_slots: LiveEventHookSlots = { settle_live_event: null };

  function log_error(ctx: RequestCtx | null, user_id: bigint | null, message: string, stack_trace: string | null = null): void {
    logging.write({
      kind: 'error',
      level: 'error',
      message,
      user_id: ctx?.user_id ?? user_id,
      request_id: ctx === null || ctx.request_id === '' ? null : ctx.request_id,
      request: ctx === null || ctx.request_name === '' ? null : ctx.request_name,
      fields: { stack_trace },
    });
  }

  function schedule(data: GameData.DataSet, event_id: unknown): Schedule | null {
    const id = integer_id(event_id);
    if (id === null || !data.LiveEventTable.has_row(id)) return null;
    return schedule_of(data.LiveEventTable.get_row(id));
  }

  /** The largest round whose start time `is_reached`, or 0. Rounds reached form a prefix of 1..last. */
  function latest_reached(ctx: RequestCtx, s: Schedule): bigint {
    let lo = 0n;
    let hi = s.last;
    while (lo < hi) {
      const mid = (lo + hi + 1n) / 2n;
      if (time.is_reached(ctx, round_of(s, mid).start_at)) lo = mid;
      else hi = mid - 1n;
    }
    return lo;
  }

  /** The active round, or the next round with round 0, or `(0, 0, 0)`. */
  function round_at(ctx: RequestCtx, s: Schedule): LiveEventRound {
    const n = latest_reached(ctx, s);
    if (n > 0n) {
      const current = round_of(s, n);
      if (!time.is_reached_strict(ctx, current.end_at)) return current;
    }
    if (n + 1n > s.last) return NO_ROUND;
    const next = round_of(s, n + 1n);
    return { round: 0, start_at: next.start_at, end_at: next.end_at };
  }

  function active_round(ctx: RequestCtx, s: Schedule | null): number {
    return s === null ? 0 : round_at(ctx, s).round;
  }

  /** `get_round`: the round of `round_at`, or `(0, 0, 0)` with an error log for an event not in live_event. */
  function get_round(ctx: RequestCtx, event_id: number): LiveEventRound {
    const s = schedule(ctx.data, event_id);
    if (s === null) {
      log_error(ctx, null, `get_round of live event ${String(event_id)}: the event is not in live_event`);
      return NO_ROUND;
    }
    return round_at(ctx, s);
  }

  /** `get_round` of a data row's `live_event`: the active round, or 0. */
  function row_round(ctx: RequestCtx, live_event: number | null | undefined): number {
    return is_none(live_event) ? 0 : get_round(ctx, live_event).round;
  }

  function entry_of(ctx: RequestCtx, event_id: number): CoreContract.LiveEventEntryUserState | null {
    return storage.get_state(ctx, Entry, BigInt(event_id)) as CoreContract.LiveEventEntryUserState | null;
  }

  /** Calls `settle_live_event`: `pass`, or the failure code that rolls the settlement back after its error log. */
  function call_settle_hook(ctx: RequestCtx, event_id: number, round: number): Pass | FailureCode {
    const hook = hook_slots.settle_live_event;
    if (hook === null) return 'pass';
    const ref = `${String(event_id)}:${String(round)}`;
    let out: unknown;
    try {
      out = storage.with_hook_change_source(ctx, CoreContract.ItemChangeSource.ITEM_CHANGE_SOURCE_LIVE_EVENT, ref, () => hook(ctx, event_id, round));
    } catch (error) {
      log_error(ctx, null, `settle_live_event of live event ${ref} threw`, error instanceof Error ? (error.stack ?? error.message) : String(error));
      return CoreContract.CoreError.CORE_ERROR_INTERNAL;
    }
    let result: Pass | FailureCode;
    try {
      result = storage.check_hook_output('settle_live_event', out);
    } catch (error) {
      log_error(ctx, null, `settle_live_event of live event ${ref}: ${error instanceof Error ? error.message : String(error)}`);
      return CoreContract.CoreError.CORE_ERROR_INTERNAL;
    }
    if (result === 'pass') return 'pass';
    log_error(ctx, null, `settle_live_event of live event ${ref} returned GameError ${String(result)}`);
    return result;
  }

  /** Whether a participation is due for settlement: not settled, and an event not in live_event or an ended round. */
  function is_due(ctx: RequestCtx, entry: CoreContract.LiveEventEntryUserState): boolean {
    if (entry.settled) return false;
    const s = schedule(ctx.data, Number(entry.id));
    return s === null || (entry.round >= 1 && round_of(s, BigInt(entry.round)).end_at <= ctx.request_time);
  }

  /** The user's participations that are due for settlement, in ID order. */
  function due_entries(ctx: RequestCtx): CoreContract.LiveEventEntryUserState[] {
    return (storage.list_state(ctx, Entry) as CoreContract.LiveEventEntryUserState[]).filter((entry) => is_due(ctx, entry));
  }

  /** Settles a participation read in this change when it is still due. */
  function settle_entry(ctx: RequestCtx, entry: CoreContract.LiveEventEntryUserState | null): Pass | FailureCode {
    if (entry === null || !is_due(ctx, entry)) return 'pass';
    const event_id = Number(entry.id);
    if (schedule(ctx.data, event_id) === null) {
      log_error(ctx, null, `participation of live event ${String(entry.id)} round ${String(entry.round)} is settled without the hook: the event is not in live_event`);
    } else if (ctx.data.LiveEventTable.get_row(event_id).settle) {
      const result = call_settle_hook(ctx, event_id, entry.round);
      if (result !== 'pass') return result;
    }
    entry.settled = true;
    storage.put_core_state(ctx, entry);
    return 'pass';
  }

  /** Runs one settlement change of `on_request_start`; false when the user is withdrawn or the transaction failed. */
  async function settlement_change(user_id: bigint, fn: (ctx: RequestCtx) => Pass | FailureCode): Promise<boolean> {
    let result;
    try {
      result = await storage.run_user_transaction(user_id, fn);
    } catch (error) {
      log_error(null, user_id, 'live event settlement threw', error instanceof Error ? (error.stack ?? error.message) : String(error));
      return false;
    }
    if (result === 'FAILED') {
      log_error(null, user_id, 'live event settlement transaction failed');
      return false;
    }
    return result !== 'WITHDRAWN';
  }

  return {
    begin_start() {},

    complete_start() {
      return null;
    },

    stop() {},

    hook_slots,

    get_active_events(ctx) {
      const out: ActiveLiveEvent[] = [];
      const rows = [...ctx.data.LiveEventTable.all_rows()].sort((a, b) => a.id - b.id);
      for (const row of rows) {
        const round = round_at(ctx, schedule_of(row));
        if (round.round > 0) out.push({ event_id: row.id, ...round });
      }
      return out;
    },

    is_active(ctx, event_id) {
      return active_round(ctx, schedule(ctx.data, event_id)) > 0;
    },

    is_in_active_window(ctx, start_at, end_at, live_event) {
      if (!is_none(start_at) && !time.is_reached(ctx, start_at)) return false;
      if (!is_none(end_at) && time.is_reached_strict(ctx, end_at)) return false;
      if (!is_none(live_event) && active_round(ctx, schedule(ctx.data, live_event)) === 0) return false;
      return true;
    },

    get_round,

    get_latest_round(event_id, at) {
      const s = schedule(input.server.data, event_id);
      if (s === null) {
        log_error(null, null, `get_latest_round of live event ${String(event_id)}: the event is not in live_event`);
        return NO_ROUND;
      }
      if (s.last < 1n || at < s.start) return NO_ROUND;
      const n = s.repeat > 0n ? min((at - s.start) / s.repeat + 1n, s.last) : 1n;
      return round_of(s, n);
    },

    round_to_write(ctx, live_event) {
      return row_round(ctx, live_event);
    },

    is_round_reset(ctx, live_event, event_round) {
      const round = row_round(ctx, live_event);
      return round !== 0 && round !== event_round;
    },

    join_event(ctx, event_id) {
      const s = schedule(ctx.data, event_id);
      if (s === null) {
        log_error(ctx, null, `join_event of live event ${String(event_id)}: the event is not in live_event`);
        return 'UNKNOWN_EVENT';
      }
      const round = active_round(ctx, s);
      if (round === 0) return 'NOT_ACTIVE';
      const entry = entry_of(ctx, event_id);
      if (entry !== null && entry.round === round) return 'OK';
      if (entry !== null && !entry.settled) return 'NOT_SETTLED';
      const joined = new Entry();
      joined.id = BigInt(event_id);
      joined.round = round;
      joined.joined_at = ctx.request_time;
      joined.settled = false;
      storage.put_core_state(ctx, joined);
      return 'OK';
    },

    get_participation(ctx, event_id) {
      const id = integer_id(event_id);
      const entry = id === null || id < 0 ? null : entry_of(ctx, id);
      return entry === null ? { round: 0, settled: false } : { round: entry.round, settled: entry.settled };
    },

    async on_request_start(user_id) {
      // The first change lists the due participations once and settles the first; each later change re-reads one row.
      let due: bigint[] = [];
      const first = (ctx: RequestCtx): Pass | FailureCode => {
        const entries = due_entries(ctx);
        due = entries.map((entry) => entry.id);
        return settle_entry(ctx, entries[0] ?? null);
      };
      if (!(await settlement_change(user_id, first))) return;
      for (const id of due.slice(1)) {
        const later = (ctx: RequestCtx): Pass | FailureCode => settle_entry(ctx, storage.get_state(ctx, Entry, id) as CoreContract.LiveEventEntryUserState | null);
        if (!(await settlement_change(user_id, later))) return;
      }
    },
  };
}
