/**
 * attendance: data-defined attendance calendars where a user claims one reward per game day. It judges the progress
 * mode, the progress reset cycle, the active window and the unlock requirement, stores the progress in the core
 * UserState kind `AttendanceUserState` and grants the reward with `mailbox.grant_or_mail`.
 */
import * as CoreContract from '../../generated/contract/core_contract.ts';
import type * as GameContract from '../../generated/contract/game_contract.ts';
import * as GameData from '../../generated/data/game_data.ts';
import type { LiveEventModule } from '../live-event/index.ts';
import type { Logging } from '../logging/index.ts';
import type { Mailbox } from '../mailbox/index.ts';
import type { ServerTimeApi } from '../server-time/index.ts';
import type { Pass, RequestCtx, Storage } from '../storage/index.ts';
import type { Validation } from '../validation/index.ts';

/** The `storage` operations attendance calls. */
export type AttendanceStorage = Pick<Storage, 'get_state' | 'put_core_state' | 'delete_core_state' | 'with_hook_change_source' | 'check_hook_output'>;

/** The `server-time` operations attendance calls. */
export type AttendanceServerTime = Pick<ServerTimeApi, 'now' | 'get_day_number' | 'get_next_reset'>;

/** The `logging` operations attendance calls. */
export type AttendanceLogging = Pick<Logging, 'write' | 'track_core_event'>;

/** The `mailbox` operation attendance calls. */
export type AttendanceMailbox = Pick<Mailbox, 'grant_or_mail'>;

/** The `live-event` operations attendance calls. */
export type AttendanceLiveEvent = Pick<LiveEventModule, 'is_in_active_window' | 'get_round'>;

/** The `validation` operation attendance calls. */
export type AttendanceValidation = Pick<Validation, 'evaluate_requirement'>;

/** The module input (`server-core` `## module`). attendance has no settings and reads the server build data of `server`. */
export interface AttendanceInput {
  readonly settings: Readonly<Record<string, unknown>>;
  readonly modules: Readonly<Record<string, unknown>>;
  readonly server: { readonly data: GameData.DataSet };
}

/** `validate_attendance_claim` and `grant_attendance_extra`: ctx, calendar ID value, next day. */
export type AttendanceClaimHook = (ctx: RequestCtx, calendar_id: number, day: number) => Pass | GameContract.GameError;

/** `on_attendance_claimed` (after hook): ctx, calendar ID value, claimed day. */
export type AttendanceClaimedHook = (ctx: RequestCtx, calendar_id: number, day: number) => null;

/** The hook slots routing fills from `register_hook` after `register`. */
export interface AttendanceHookSlots {
  validate_attendance_claim: AttendanceClaimHook | null;
  grant_attendance_extra: AttendanceClaimHook | null;
  on_attendance_claimed: AttendanceClaimedHook | null;
}

/** The output of `get_attendance`. */
export interface AttendanceState {
  /** The last claimed day of the current progress; 0 when none. */
  readonly day: number;
  /** The day a claim now would get; 0 when a claim now gets nothing. */
  readonly next_day: number;
}

export type ClaimAttendanceOutput = CoreContract.ClaimAttendanceResponse | CoreContract.CoreError | GameContract.GameError;

export interface AttendanceModule {
  begin_start(): void;
  complete_start(): string | null;
  stop(): void;
  readonly hook_slots: AttendanceHookSlots;
  ClaimAttendance(ctx: RequestCtx, request: CoreContract.ClaimAttendanceRequest): ClaimAttendanceOutput;
  get_attendance(ctx: RequestCtx, calendar_id: number): AttendanceState;
  /** For the DEV code: the calendar row of an ID value, or null for an unknown one. */
  calendar_of(ctx: RequestCtx, calendar_id: number): GameData.AttendanceCalendarRow | null;
  /** For the DEV code: the day count N of a calendar. */
  day_count(ctx: RequestCtx, calendar: GameData.AttendanceCalendarRow): number;
  /**
   * For the DEV code: writes the progress row as given, with `reset_at` and `event_round` by the rules of claim
   * step 8, or deletes it when the day is 0.
   */
  write_progress(ctx: RequestCtx, calendar: GameData.AttendanceCalendarRow, day: number, claimed_day_number: bigint): void;
}

const CoreError = CoreContract.CoreError;
const Kind = CoreContract.AttendanceUserState;
const SOURCE = CoreContract.ItemChangeSource.ITEM_CHANGE_SOURCE_ATTENDANCE;
const CORE_EVENT = 'core_attendance_claimed';
const ONCE_KEY_PREFIX = 'attendance:';

/** The progress of a calendar after the round reset, the lazy reset and the Streak missed-day rule. */
interface Progress {
  readonly day: number;
  readonly claimed_day_number: bigint;
}

/** A claim that passed steps 1 to 4: the calendar, today, the next day and its `attendance_reward` row. */
interface ClaimPlan {
  readonly calendar: GameData.AttendanceCalendarRow;
  readonly today: bigint;
  readonly next_day: number;
  readonly day_row: GameData.AttendanceRewardRow;
  /** The hook and mailbox change source ref: `<calendar ID value>:<next day>`. */
  readonly ref: string;
}

/** The module object `name` of `modules`; throws when it has no function `member`. */
function module_of(modules: Readonly<Record<string, unknown>>, name: string, member: string): unknown {
  const module = modules[name] as Record<string, unknown> | undefined;
  if (typeof module?.[member] !== 'function') throw new TypeError(`attendance: modules has no ${name}`);
  return module;
}

/** `ResetCycle?` of a calendar row: `None` is null. */
function reset_of(calendar: GameData.AttendanceCalendarRow): GameData.ResetCycle | null {
  return calendar.reset === GameData.ResetCycle.None ? null : calendar.reset;
}

/** Makes `attendance` for one server instance. A missing dependency throws. */
export function create_attendance(input: AttendanceInput): AttendanceModule {
  const storage = module_of(input.modules, 'storage', 'put_core_state') as AttendanceStorage;
  const server_time = module_of(input.modules, 'server-time', 'get_day_number') as AttendanceServerTime;
  const logging = module_of(input.modules, 'logging', 'track_core_event') as AttendanceLogging;
  const mailbox = module_of(input.modules, 'mailbox', 'grant_or_mail') as AttendanceMailbox;
  const live_event = module_of(input.modules, 'live-event', 'is_in_active_window') as AttendanceLiveEvent;
  const validation = module_of(input.modules, 'validation', 'evaluate_requirement') as AttendanceValidation;
  const hook_slots: AttendanceHookSlots = { validate_attendance_claim: null, grant_attendance_extra: null, on_attendance_claimed: null };

  const calendar_of = (ctx: RequestCtx, calendar_id: number): GameData.AttendanceCalendarRow | null => {
    if (!Number.isSafeInteger(calendar_id)) return null;
    const table = ctx.data.AttendanceCalendarTable;
    return table.has_row(calendar_id) ? table.get_row(calendar_id) : null;
  };

  const day_rows = (ctx: RequestCtx, calendar: GameData.AttendanceCalendarRow): readonly GameData.AttendanceRewardRow[] =>
    ctx.data.AttendanceRewardTable.has_rows(calendar.id) ? ctx.data.AttendanceRewardTable.get_rows(calendar.id) : [];

  const day_count = (ctx: RequestCtx, calendar: GameData.AttendanceCalendarRow): number => day_rows(ctx, calendar).length;

  /** The round reset field `event_round` to write: the round of the calendar's live event, or 0 without one. */
  const event_round_of = (ctx: RequestCtx, calendar: GameData.AttendanceCalendarRow): number =>
    calendar.live_event === 0 ? 0 : live_event.get_round(ctx, calendar.live_event).round;

  /** The `reset_at` to write: the next reset of the calendar's reset cycle, or 0 without one. */
  const reset_at_of = (ctx: RequestCtx, calendar: GameData.AttendanceCalendarRow): bigint => {
    const reset = reset_of(calendar);
    return reset === null ? 0n : server_time.get_next_reset(reset, server_time.now(ctx));
  };

  const today_of = (ctx: RequestCtx): bigint => server_time.get_day_number(server_time.now(ctx));

  /** Whether a round of the calendar's live event other than the round of the progress row has started. */
  const is_new_round = (ctx: RequestCtx, calendar: GameData.AttendanceCalendarRow, row_round: number): boolean => {
    if (calendar.live_event === 0) return false;
    const round = live_event.get_round(ctx, calendar.live_event).round;
    return round !== 0 && round !== row_round;
  };

  /** Reads the progress row and applies, in order, the round reset, the lazy reset and the Streak missed-day rule. */
  const read_progress = (ctx: RequestCtx, calendar: GameData.AttendanceCalendarRow, today: bigint): Progress => {
    const stored = storage.get_state(ctx, Kind, BigInt(calendar.id));
    const row = stored instanceof Kind ? stored : new Kind();
    let { day, claimed_day_number, reset_at } = row;
    if (is_new_round(ctx, calendar, row.event_round)) {
      day = 0;
      claimed_day_number = 0n;
      reset_at = reset_at_of(ctx, calendar);
    }
    if (reset_at !== 0n && server_time.now(ctx) >= reset_at) {
      day = 0;
      claimed_day_number = 0n;
    }
    if (calendar.mode === GameData.AttendanceMode.Streak && claimed_day_number !== 0n && today - claimed_day_number > 1n) day = 0;
    return { day, claimed_day_number };
  };

  const in_window = (ctx: RequestCtx, calendar: GameData.AttendanceCalendarRow): boolean =>
    live_event.is_in_active_window(ctx, calendar.start_at, calendar.end_at, calendar.live_event);

  /** The next day of a progress inside the active window and not claimed today; 0 when there is none. */
  const next_day_of = (calendar: GameData.AttendanceCalendarRow, progress: Progress, n: number): number => {
    if (n === 0) return 0;
    if (progress.day < n) return progress.day + 1;
    return calendar.mode === GameData.AttendanceMode.Once ? 0 : 1;
  };

  const write_progress = (ctx: RequestCtx, calendar: GameData.AttendanceCalendarRow, day: number, claimed_day_number: bigint): void => {
    const id = BigInt(calendar.id);
    if (day === 0) {
      storage.delete_core_state(ctx, Kind, id);
      return;
    }
    const row = new Kind();
    row.id = id;
    row.day = day;
    row.claimed_day_number = claimed_day_number;
    row.reset_at = reset_at_of(ctx, calendar);
    row.event_round = event_round_of(ctx, calendar);
    storage.put_core_state(ctx, row);
  };

  /** Calls a hook under the change source of this claim. */
  const in_hook = <T>(ctx: RequestCtx, ref: string, fn: () => T): T => storage.with_hook_change_source(ctx, SOURCE, ref, fn);

  /** Claim steps 1 to 4, after the calendar ID value check. */
  const plan_claim = (ctx: RequestCtx, calendar: GameData.AttendanceCalendarRow): ClaimPlan | CoreContract.CoreError => {
    if (!in_window(ctx, calendar)) return CoreError.CORE_ERROR_ATTENDANCE_UNAVAILABLE;
    if (!validation.evaluate_requirement(ctx, calendar.requirement).passed) return CoreError.CORE_ERROR_ATTENDANCE_LOCKED;
    const today = today_of(ctx);
    const progress = read_progress(ctx, calendar, today);
    if (progress.claimed_day_number === today) return CoreError.CORE_ERROR_ATTENDANCE_ALREADY_CLAIMED;
    const rows = day_rows(ctx, calendar);
    const next_day = next_day_of(calendar, progress, rows.length);
    if (next_day === 0) return CoreError.CORE_ERROR_ATTENDANCE_COMPLETED;
    const day_row = rows.find((row) => row.day === next_day);
    if (day_row === undefined) throw new RangeError(`attendance: calendar ${String(calendar.id)} has no day ${String(next_day)}`);
    return { calendar, today, next_day, day_row, ref: `${String(calendar.id)}:${String(next_day)}` };
  };

  /** Claim step 6: the reward through `grant_or_mail`, written into the response. */
  const grant_reward = (ctx: RequestCtx, plan: ClaimPlan, response: CoreContract.ClaimAttendanceResponse): Pass | CoreContract.CoreError => {
    const reward = plan.day_row.reward;
    if (reward.length === 0) return 'pass';
    const event_round = event_round_of(ctx, plan.calendar);
    const once_key = `${ONCE_KEY_PREFIX}${String(plan.calendar.id)}:${String(event_round)}:${String(plan.today)}`;
    const granted = mailbox.grant_or_mail(ctx, reward, { source: SOURCE, ref: plan.ref, once_key }, ctx.data.ReservedId.attendance_reward_mail(), []);
    switch (granted.result) {
      case 'Granted':
        response.items = [...reward];
        return 'pass';
      case 'Mailed':
        response.mailed = true;
        return 'pass';
      case 'AlreadyApplied':
        return 'pass';
      default:
        return CoreError.CORE_ERROR_INTERNAL;
    }
  };

  /** Claim steps 5 and 7: the content hooks that can refuse the claim. */
  const run_hook = (ctx: RequestCtx, plan: ClaimPlan, name: 'validate_attendance_claim' | 'grant_attendance_extra'): Pass | GameContract.GameError => {
    const hook = hook_slots[name];
    if (hook === null) {
      if (name === 'validate_attendance_claim') return 'pass';
      throw new Error(`attendance: day ${plan.ref} has extra_grant but no grant_attendance_extra hook`);
    }
    // A wrong output form throws, so the request ends with `INTERNAL`.
    const output: unknown = in_hook(ctx, plan.ref, () => hook(ctx, plan.calendar.id, plan.next_day));
    return storage.check_hook_output(name, output) as Pass | GameContract.GameError;
  };

  return {
    begin_start() {},

    complete_start() {
      if (hook_slots.grant_attendance_extra !== null) return null;
      const rows = input.server.data.AttendanceRewardTable.all_rows().filter((row) => row.extra_grant);
      if (rows.length === 0) return null;
      const message = 'attendance_reward has extra_grant rows but content registered no grant_attendance_extra hook';
      logging.write({
        kind: 'error',
        level: 'error',
        message,
        user_id: null,
        request_id: null,
        request: null,
        fields: { stack_trace: null, calendar_ids: [...new Set(rows.map((row) => row.id))] },
      });
      return message;
    },

    stop() {},

    hook_slots,

    ClaimAttendance(ctx, request) {
      const calendar = calendar_of(ctx, request.calendar_id);
      if (calendar === null) return CoreError.CORE_ERROR_INVALID_REQUEST;
      const plan = plan_claim(ctx, calendar);
      if (typeof plan === 'number') return plan;

      const verdict = run_hook(ctx, plan, 'validate_attendance_claim');
      if (verdict !== 'pass') return verdict;
      const response = new CoreContract.ClaimAttendanceResponse();
      response.day = plan.next_day;
      const granted = grant_reward(ctx, plan, response);
      if (granted !== 'pass') return granted;
      if (plan.day_row.extra_grant) {
        const extra = run_hook(ctx, plan, 'grant_attendance_extra');
        if (extra !== 'pass') return extra;
      }

      write_progress(ctx, calendar, plan.next_day, plan.today);
      const claimed = hook_slots.on_attendance_claimed;
      if (claimed !== null) {
        const output: unknown = in_hook(ctx, plan.ref, () => claimed(ctx, calendar.id, plan.next_day));
        if (output !== null && output !== undefined) throw new TypeError('attendance: hook on_attendance_claimed returned a value other than null');
      }
      logging.track_core_event(ctx, CORE_EVENT, [
        ['calendar_id', calendar.id],
        ['day', plan.next_day],
      ]);
      return response;
    },

    get_attendance(ctx, calendar_id) {
      const calendar = calendar_of(ctx, calendar_id);
      if (calendar === null) return { day: 0, next_day: 0 };
      const today = today_of(ctx);
      const progress = read_progress(ctx, calendar, today);
      if (!in_window(ctx, calendar) || progress.claimed_day_number === today) return { day: progress.day, next_day: 0 };
      return { day: progress.day, next_day: next_day_of(calendar, progress, day_count(ctx, calendar)) };
    },

    calendar_of,
    day_count,
    write_progress,
  };
}
