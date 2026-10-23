// offer: limited-time offers that a content trigger turns on for one user, stored in `OfferUserState`.
import * as CoreContract from '../../generated/contract/core_contract.ts';
import * as GameData from '../../generated/data/game_data.ts';
import type { LiveEventApi, Logging, RequestCtx, ServerTimeApi, Storage, ValidationApi } from './deps.ts';

const INT64_MAX = 2n ** 63n - 1n;
/** `trigger_count` is `int32`: an offer with no `max_triggers` takes this as `max_triggers`. */
const INT32_MAX = 2 ** 31 - 1;

/** `OfferTriggerResult`. */
export type OfferTriggerResult = 'OK' | 'UNKNOWN_OFFER' | 'UNAVAILABLE' | 'ACTIVE' | 'LIMIT_REACHED' | 'COOLDOWN' | 'LOCKED';

/** `read_purchase_limit`'s output: the purchase count row as the purchase limit read rule reads it. */
export interface PurchaseLimit {
  readonly count: number;
  readonly reset_at: bigint;
  readonly event_round: number;
  /** The `reset_at` to write when the purchase count goes up: the next reset time when the read `reset_at` is 0. */
  readonly write_reset_at: bigint;
}

/** The module input (`server-core` `## module`). offer has no settings. */
export interface OfferInput {
  readonly settings: Readonly<Record<string, unknown>>;
  readonly modules: Readonly<Record<string, unknown>>;
  readonly server?: unknown;
}

/** The `offer` module object: the `## API` operations, the lifecycle and a member its DEV code calls. */
export interface Offer {
  trigger_offer(ctx: RequestCtx, offer_id: number): OfferTriggerResult;
  is_offer_active(ctx: RequestCtx, offer_id: number): boolean;
  get_offer_ends_at(ctx: RequestCtx, offer_id: number): bigint;
  /**
   * Reads a product's purchase count row (`count`, `reset_at`, `event_round`; all 0 for no row) with the round reset
   * of `live_event`, then the offer purchase reset of `offer`, then the lazy reset. `offer` and `live_event` 0 are none.
   */
  read_purchase_limit(
    ctx: RequestCtx,
    offer_id: number,
    reset: GameData.ResetCycle | null,
    live_event_id: number,
    count: number,
    reset_at: bigint,
    event_round: number,
  ): PurchaseLimit;
  begin_start(): void;
  complete_start(): string | null;
  stop(): void;
  /**
   * Called by the DEV code only (`dev/index.ts`): writes the row of a known offer with `started_at` and
   * `trigger_count` and the `event_round` of the round reset rule, or deletes it when `trigger_count` is 0.
   * Throws for an unknown offer and for a `started_at` whose `started_at` + `duration` + `cooldown` is not below 2^63.
   */
  write_offer(ctx: RequestCtx, offer_id: number, started_at: bigint, trigger_count: number): void;
}

/** The module object `name` of `modules`; throws when it has no function `member`. */
function module_of(modules: Readonly<Record<string, unknown>>, name: string, member: string): unknown {
  const module = modules[name] as Record<string, unknown> | undefined;
  if (typeof module?.[member] !== 'function') throw new TypeError(`offer: modules has no ${name}`);
  return module;
}

/** Makes `offer` for one server instance. A missing dependency module throws. */
export function create_offer(input: OfferInput): Offer {
  const { modules } = input;
  const storage = module_of(modules, 'storage', 'get_state') as Storage;
  const time = module_of(modules, 'server-time', 'now') as ServerTimeApi;
  const logging = module_of(modules, 'logging', 'write') as Logging;
  const live_event = module_of(modules, 'live-event', 'round_to_write') as LiveEventApi;
  const validation = module_of(modules, 'validation', 'evaluate_requirement') as ValidationApi;

  const find_row = (ctx: RequestCtx, offer_id: number): GameData.OfferRow | null =>
    Number.isSafeInteger(offer_id) && ctx.data.OfferTable.has_row(offer_id) ? ctx.data.OfferTable.get_row(offer_id) : null;

  /** The stored row as round reset reads it; null for no row and for a row whose `trigger_count` is 0. */
  const read_state = (ctx: RequestCtx, row: GameData.OfferRow): CoreContract.OfferUserState | null => {
    const stored = storage.get_state(ctx, CoreContract.OfferUserState, BigInt(row.id)) as CoreContract.OfferUserState | null;
    if (stored === null) return null;
    if (live_event.is_round_reset(ctx, row.live_event, stored.event_round)) return null;
    return stored.trigger_count === 0 ? null : stored;
  };

  const ends_at = (row: GameData.OfferRow, state: CoreContract.OfferUserState): bigint => state.started_at + row.duration;

  const is_active = (ctx: RequestCtx, row: GameData.OfferRow, state: CoreContract.OfferUserState | null): boolean =>
    state !== null && !time.is_reached_strict(ctx, ends_at(row, state));

  const write_state = (ctx: RequestCtx, row: GameData.OfferRow, started_at: bigint, trigger_count: number): CoreContract.OfferUserState => {
    const state = new CoreContract.OfferUserState();
    state.id = BigInt(row.id);
    state.started_at = started_at;
    state.trigger_count = trigger_count;
    state.event_round = live_event.round_to_write(ctx, row.live_event);
    storage.put_core_state(ctx, state);
    return state;
  };

  const log_unknown = (ctx: RequestCtx, offer_id: number): void => {
    logging.write({
      kind: 'error',
      level: 'error',
      message: 'trigger_offer: the offer ID value is not in the offer table',
      user_id: ctx.user_id,
      request_id: ctx.request_id === '' ? null : ctx.request_id,
      request: ctx.request_name === '' ? null : ctx.request_name,
      fields: { offer_id: String(offer_id), stack_trace: null },
    });
  };

  const get_offer_ends_at = (ctx: RequestCtx, offer_id: number): bigint => {
    const row = find_row(ctx, offer_id);
    const state = row === null ? null : read_state(ctx, row);
    return row === null || state === null ? 0n : ends_at(row, state);
  };

  return {
    trigger_offer(ctx, offer_id) {
      const row = find_row(ctx, offer_id);
      if (row === null) {
        log_unknown(ctx, offer_id);
        return 'UNKNOWN_OFFER';
      }
      if (!live_event.is_in_active_window(ctx, row.start_at, row.end_at, row.live_event)) return 'UNAVAILABLE';
      const state = read_state(ctx, row);
      if (is_active(ctx, row, state)) return 'ACTIVE';
      const count = state?.trigger_count ?? 0;
      if (count >= (row.max_triggers === 0 ? INT32_MAX : row.max_triggers)) return 'LIMIT_REACHED';
      const now = time.now(ctx);
      if (state !== null && now < ends_at(row, state) + row.cooldown) return 'COOLDOWN';
      if (!validation.evaluate_requirement(ctx, row.requirement).passed) return 'LOCKED';
      const written = write_state(ctx, row, now, count + 1);
      logging.track_core_event(ctx, 'core_offer_triggered', [
        ['offer_id', BigInt(row.id)],
        ['trigger_count', BigInt(written.trigger_count)],
      ]);
      return 'OK';
    },
    is_offer_active(ctx, offer_id) {
      const row = find_row(ctx, offer_id);
      return row !== null && is_active(ctx, row, read_state(ctx, row));
    },
    get_offer_ends_at,
    read_purchase_limit(ctx, offer_id, reset, live_event_id, count, reset_at, event_round) {
      // The next reset time: the offer end time, else the next `reset` boundary, else 0 (no reset).
      const next_reset = (): bigint =>
        offer_id !== 0 ? get_offer_ends_at(ctx, offer_id) : time.get_next_reset(reset === GameData.ResetCycle.None ? null : reset, time.now(ctx));
      if (live_event.is_round_reset(ctx, live_event_id, event_round)) {
        count = 0;
        event_round = live_event.round_to_write(ctx, live_event_id);
        reset_at = next_reset();
      }
      if (offer_id !== 0 && reset_at !== 0n) {
        const offer_ends_at = get_offer_ends_at(ctx, offer_id);
        if (reset_at !== offer_ends_at) {
          count = 0;
          reset_at = offer_ends_at;
        }
      }
      if (reset_at !== 0n && time.is_reached_strict(ctx, reset_at)) {
        count = 0;
        reset_at = next_reset();
      }
      return { count, reset_at, event_round, write_reset_at: reset_at === 0n ? next_reset() : reset_at };
    },
    begin_start() {},
    complete_start: () => null,
    stop() {},
    write_offer(ctx, offer_id, started_at, trigger_count) {
      const row = find_row(ctx, offer_id);
      if (row === null) throw new RangeError(`offer: write_offer: offer ID value ${String(offer_id)} is not in the offer table`);
      if (started_at + row.duration + row.cooldown > INT64_MAX) {
        throw new RangeError(`offer: write_offer: started_at ${String(started_at)} + duration + cooldown is not below 2^63`);
      }
      if (trigger_count === 0) storage.delete_core_state(ctx, CoreContract.OfferUserState, BigInt(row.id));
      else write_state(ctx, row, started_at, trigger_count);
    },
  };
}
