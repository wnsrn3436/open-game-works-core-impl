// mission: progress counters of missions and achievements, their reset, and the reward claim.
import * as CoreContract from '../../generated/contract/core_contract.ts';
import type * as GameContract from '../../generated/contract/game_contract.ts';
import * as GameData from '../../generated/data/game_data.ts';
import type {
  MissionLiveEvent, MissionLogging, MissionMailbox, MissionServerTime, MissionStorage, MissionValidation, RequestCtx,
} from './deps.ts';

const CoreError = CoreContract.CoreError;
type CoreErrorValue = CoreContract.CoreError;
type GameErrorValue = GameContract.GameError;

const MAX_SAFE = 2n ** 53n - 1n;
const MISSION_SOURCE = CoreContract.ItemChangeSource.ITEM_CHANGE_SOURCE_MISSION;

/** `(progress, claimed)` of `get_progress`. */
export interface Progress {
  readonly progress: bigint;
  readonly claimed: boolean;
}

export type ValidateMissionClaimHook = (ctx: RequestCtx, mission_id: number) => 'pass' | GameErrorValue;
export type GrantMissionExtraHook = (ctx: RequestCtx, mission_id: number) => 'pass' | GameErrorValue;
export type OnMissionClaimedHook = (ctx: RequestCtx, mission_id: number) => null | undefined;

/** The hook slots `routing` fills with the hooks content registered. */
export interface MissionHookSlots {
  validate_mission_claim: ValidateMissionClaimHook | null;
  grant_mission_extra: GrantMissionExtraHook | null;
  on_mission_claimed: OnMissionClaimedHook | null;
}

/** The module input (`server-core` `## module`). mission has no settings. */
export interface MissionInput {
  readonly settings: Readonly<Record<string, unknown>>;
  readonly modules: Readonly<Record<string, unknown>>;
  readonly server: { readonly data: GameData.DataSet };
}

/** The `mission` module object. */
export interface Mission {
  add_progress(ctx: RequestCtx, counter_id: number, amount: bigint | number): number[];
  get_progress(ctx: RequestCtx, mission_id: number): Progress;
  ClaimMission(ctx: RequestCtx, request: CoreContract.ClaimMissionRequest): CoreContract.ClaimMissionResponse | GameErrorValue | CoreErrorValue;
  readonly hook_slots: MissionHookSlots;
  begin_start(): void;
  complete_start(): string | null;
  stop(): void;
  /** For the DEV code: writes the row of `SetMissionProgress`. */
  set_progress(ctx: RequestCtx, mission_id: number, progress: bigint, claimed: boolean): 'pass' | CoreErrorValue;
}

/** A `MissionProgressUserState` row after round reset and lazy reset, as it would be stored. */
interface Row {
  progress: bigint;
  claimed: boolean;
  reset_at: bigint;
  event_round: number;
}

function module_of<T>(modules: Readonly<Record<string, unknown>>, name: string, member: keyof T & string): T {
  const module = modules[name] as Record<string, unknown> | undefined;
  if (typeof module?.[member] !== 'function') throw new TypeError(`mission: modules has no ${name}`);
  return module as T;
}

/** `ResetCycle?`: `None` is null. */
function cycle_of(row: GameData.MissionRow): GameData.ResetCycle | null {
  return row.reset === GameData.ResetCycle.None ? null : row.reset;
}

/** The `mission` module of one server instance (`server-core` `## module`). */
export function create_mission(input: MissionInput): Mission {
  const storage = module_of<MissionStorage>(input.modules, 'storage', 'put_core_state');
  const time = module_of<MissionServerTime>(input.modules, 'server-time', 'get_next_reset');
  const live_event = module_of<MissionLiveEvent>(input.modules, 'live-event', 'is_in_active_window');
  const validation = module_of<MissionValidation>(input.modules, 'validation', 'evaluate_requirement');
  const mailbox = module_of<MissionMailbox>(input.modules, 'mailbox', 'grant_or_mail');
  const logging = module_of<MissionLogging>(input.modules, 'logging', 'track_core_event');
  const hook_slots: MissionHookSlots = { validate_mission_claim: null, grant_mission_extra: null, on_mission_claimed: null };
  const by_counter = new WeakMap<GameData.DataSet, ReadonlyMap<number, readonly GameData.MissionRow[]>>();

  /** The missions of each counter, in the order of the `mission` table. */
  function missions_of(data: GameData.DataSet, counter_id: number): readonly GameData.MissionRow[] {
    let index = by_counter.get(data);
    if (index === undefined) {
      const map = new Map<number, GameData.MissionRow[]>();
      for (const row of data.MissionTable.all_rows()) {
        const list = map.get(row.counter);
        if (list === undefined) map.set(row.counter, [row]);
        else list.push(row);
      }
      index = map;
      by_counter.set(data, index);
    }
    return index.get(counter_id) ?? [];
  }

  /** `is_in_active_window` of the row's values; 0 is none there. */
  const in_window = (ctx: RequestCtx, row: GameData.MissionRow): boolean =>
    live_event.is_in_active_window(ctx, row.start_at, row.end_at, row.live_event);

  /** The round to write in `event_round` (`live-event.round_to_write`). */
  const round_of = (ctx: RequestCtx, row: GameData.MissionRow): number => live_event.round_to_write(ctx, row.live_event);

  const next_reset = (ctx: RequestCtx, row: GameData.MissionRow): bigint => time.get_next_reset(cycle_of(row), time.now(ctx));

  /** A fresh row: the first value, the next reset time and the round rule. */
  const fresh = (ctx: RequestCtx, row: GameData.MissionRow, event_round: number): Row => ({ progress: 0n, claimed: false, reset_at: next_reset(ctx, row), event_round });

  /** The stored row read through round reset, then lazy reset. A missing row is the first value. */
  function read(ctx: RequestCtx, row: GameData.MissionRow): Row {
    const stored = storage.get_state(ctx, CoreContract.MissionProgressUserState, BigInt(row.id)) as CoreContract.MissionProgressUserState | null;
    if (stored === null) return fresh(ctx, row, round_of(ctx, row));
    let current: Row = { progress: stored.progress, claimed: stored.claimed, reset_at: stored.reset_at, event_round: stored.event_round };
    if (live_event.is_round_reset(ctx, row.live_event, current.event_round)) current = fresh(ctx, row, round_of(ctx, row));
    if (current.reset_at !== 0n && time.now(ctx) >= current.reset_at) current = fresh(ctx, row, current.event_round);
    return current;
  }

  function write(ctx: RequestCtx, mission_id: number, row: Row): void {
    const value = new CoreContract.MissionProgressUserState();
    value.id = BigInt(mission_id);
    value.progress = row.progress;
    value.claimed = row.claimed;
    value.reset_at = row.reset_at;
    value.event_round = row.event_round;
    storage.put_core_state(ctx, value);
  }

  const call_hook = <T>(ctx: RequestCtx, mission_id: number, fn: () => T): T => storage.with_hook_change_source(ctx, MISSION_SOURCE, String(mission_id), fn);

  const add_progress: Mission['add_progress'] = (ctx, counter_id, amount) => {
    const counter = ctx.data.MissionCounterTable;
    if (!counter.has_row(counter_id)) throw new RangeError(`mission: add_progress got an unknown counter ${String(counter_id)}`);
    if (typeof amount === 'number' && !Number.isInteger(amount)) throw new RangeError('mission: add_progress amount is not an integer');
    let value = BigInt(amount);
    if (value < 1n) throw new RangeError(`mission: add_progress amount ${String(value)} is less than 1`);
    if (value > MAX_SAFE) value = MAX_SAFE;
    const mode = counter.get_row(counter_id).mode;
    const changed: number[] = [];
    for (const row of missions_of(ctx.data, counter_id)) {
      if (!in_window(ctx, row)) continue;
      const current = read(ctx, row);
      if (current.claimed || current.progress >= row.target) continue;
      let progress = mode === GameData.MissionCounterMode.Max ? (value > current.progress ? value : current.progress) : current.progress + value;
      if (progress > row.target) progress = row.target;
      if (progress === current.progress) continue;
      write(ctx, row.id, { ...current, progress });
      changed.push(row.id);
    }
    return changed.sort((a, b) => a - b);
  };

  const get_progress: Mission['get_progress'] = (ctx, mission_id) => {
    const table = ctx.data.MissionTable;
    if (!table.has_row(mission_id)) return { progress: 0n, claimed: false };
    const current = read(ctx, table.get_row(mission_id));
    return { progress: current.progress, claimed: current.claimed };
  };

  /** The claim checks before the hooks, in order: active window, requirement, already claimed, not completed. */
  const claim_refusal = (ctx: RequestCtx, row: GameData.MissionRow, current: Row): CoreErrorValue | null => {
    if (!in_window(ctx, row)) return CoreError.CORE_ERROR_MISSION_UNAVAILABLE;
    if (!validation.evaluate_requirement(ctx, row.requirement).passed) return CoreError.CORE_ERROR_MISSION_LOCKED;
    if (current.claimed) return CoreError.CORE_ERROR_MISSION_ALREADY_CLAIMED;
    if (current.progress < row.target) return CoreError.CORE_ERROR_MISSION_NOT_COMPLETED;
    return null;
  };

  /** Grants or mails the reward: the granted items of the response, or null when the grant failed. */
  const grant_reward = (ctx: RequestCtx, row: GameData.MissionRow, current: Row): CoreContract.ItemAmount[] | null => {
    if (row.reward.length === 0) return [];
    const id = row.id;
    const source = { source: MISSION_SOURCE, ref: String(id), once_key: `mission:${String(id)}:${String(current.event_round)}:${String(current.reset_at)}` };
    const granted = mailbox.grant_or_mail(ctx, row.reward, source, ctx.data.ReservedId.mission_reward_mail(), []);
    if (granted.result === 'Granted') return [...row.reward];
    return granted.result === 'AlreadyApplied' || granted.result === 'Mailed' ? [] : null;
  };

  const ClaimMission: Mission['ClaimMission'] = (ctx, request) => {
    const id = request.mission_id;
    const table = ctx.data.MissionTable;
    if (!table.has_row(id)) return CoreError.CORE_ERROR_INVALID_REQUEST;
    const row = table.get_row(id);
    const current = read(ctx, row);
    const refusal = claim_refusal(ctx, row, current);
    if (refusal !== null) return refusal;

    const validate = hook_slots.validate_mission_claim;
    if (validate !== null) {
      const result = storage.check_hook_output('validate_mission_claim', call_hook(ctx, id, () => validate(ctx, id)));
      if (result !== 'pass') return result as GameErrorValue | CoreErrorValue;
    }

    const response = new CoreContract.ClaimMissionResponse();
    const granted = grant_reward(ctx, row, current);
    if (granted === null) return CoreError.CORE_ERROR_INTERNAL;
    response.items = granted;

    if (row.extra_grant) {
      const extra = hook_slots.grant_mission_extra;
      if (extra === null) return CoreError.CORE_ERROR_INTERNAL;
      const result = storage.check_hook_output('grant_mission_extra', call_hook(ctx, id, () => extra(ctx, id)));
      if (result !== 'pass') return result as GameErrorValue | CoreErrorValue;
    }

    write(ctx, id, { ...current, claimed: true });

    const after = hook_slots.on_mission_claimed;
    if (after !== null) {
      const output: unknown = call_hook(ctx, id, () => after(ctx, id));
      if (output !== null && output !== undefined) throw new TypeError('mission: hook on_mission_claimed returned a value');
    }

    logging.track_core_event(ctx, 'core_mission_claimed', [['mission_id', BigInt(id)]]);
    return response;
  };

  const set_progress: Mission['set_progress'] = (ctx, mission_id, progress, claimed) => {
    const table = ctx.data.MissionTable;
    if (!table.has_row(mission_id)) return CoreError.CORE_ERROR_INVALID_REQUEST;
    const row = table.get_row(mission_id);
    if (progress < 0n || progress > row.target) return CoreError.CORE_ERROR_INVALID_REQUEST;
    write(ctx, mission_id, { progress, claimed, reset_at: next_reset(ctx, row), event_round: round_of(ctx, row) });
    return 'pass';
  };

  return {
    add_progress,
    get_progress,
    ClaimMission,
    hook_slots,
    begin_start: () => undefined,
    complete_start: () => {
      if (hook_slots.grant_mission_extra !== null) return null;
      const row = input.server.data.MissionTable.all_rows().find((r) => r.extra_grant);
      if (row === undefined) return null;
      return `mission: mission ${String(row.id)} has extra_grant true but content registered no grant_mission_extra hook`;
    },
    stop: () => undefined,
    set_progress,
  };
}
