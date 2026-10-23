/**
 * Test servers of `mission` with a content `register` whose `RunCoreTest` handler runs `add_progress` and
 * `get_progress` inside a request, the mission hooks, and helpers that read what a request committed.
 */
import { readdirSync, readFileSync } from 'node:fs';
import * as CoreContract from '../../../generated/contract/core_contract.ts';
import * as GameContract from '../../../generated/contract/game_contract.ts';
import * as GameData from '../../../generated/data/game_data.ts';
import * as CoreCheatContract from '../../../dev/generated/contract/core_cheat_contract.ts';
import {
  load_data, login, read_user_state, register_required_hooks, send, send_cheat, start_test_server, stop_test_server, type RegisterFunction,
} from '../../testing/dev/index.ts';
import type { DbHandle } from '../../storage/index.ts';
import { storage_module } from '../../storage/tests/helpers.ts';
import type { RequestCtx } from '../deps.ts';
import type { Mission } from '../index.ts';

export const DAY = 86_400_000n;
/** Game settings `dailyResetOffsetMs` of the test servers. */
export const RESET_OFFSET = 14_400_000n;
export const MAX_SAFE = 2n ** 53n - 1n;
export const REJECTED = GameContract.GameError.GAME_ERROR_CORE_TEST;
export const CODE = CoreContract.CoreError;

/** Unix ms of a UTC date and time. */
export function at(year: number, month: number, day: number, hour = 0): bigint {
  return BigInt(Date.UTC(year, month - 1, day, hour));
}

/** The first reset time after `time` of a `ResetCycle` element, from the game day rules of `server-time`. */
export function next_reset(cycle: 'Daily' | 'Weekly' | 'Monthly', time: bigint): bigint {
  const day = (time - RESET_OFFSET) / DAY - ((time - RESET_OFFSET) % DAY < 0n ? 1n : 0n);
  let next: bigint;
  if (cycle === 'Daily') next = day + 1n;
  else if (cycle === 'Weekly') next = ((day + 3n) / 7n + 1n) * 7n - 3n;
  else {
    const date = new Date(Number(day * DAY));
    next = BigInt(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1)) / DAY;
  }
  return next * DAY + RESET_OFFSET;
}

const data = load_data();

/** The ID value of an ID name of the core test data. */
export function id(name: string): number {
  return data.dev.find_id_value(name);
}

export const M = {
  sum_daily: id('[mission_sum_daily]'),
  sum_weekly: id('[mission_sum_weekly]'),
  sum_monthly: id('[mission_sum_monthly]'),
  sum_forever: id('[mission_sum_forever]'),
  max: id('[mission_max]'),
  other: id('[mission_other]'),
  locked: id('[mission_locked]'),
  open: id('[mission_open]'),
  window: id('[mission_window]'),
  overflow: id('[mission_overflow]'),
  event: id('[mission_event]'),
  extra: id('[mission_extra]'),
  extra_only: id('[mission_extra_only]'),
  after: id('[mission_after]'),
  tally: id('[mission_tally]'),
  split: id('[mission_split]'),
};

export const C = {
  sum: id('[mission_count_sum]'),
  max: id('[mission_count_max]'),
  other: id('[mission_count_other]'),
  locked: id('[mission_count_locked]'),
  open: id('[mission_count_open]'),
  window: id('[mission_count_window]'),
  overflow: id('[mission_count_overflow]'),
  event: id('[mission_count_event]'),
  extra: id('[mission_count_extra]'),
  after: id('[mission_count_after]'),
  tally: id('[mission_count_tally]'),
  unused: id('[mission_count_unused]'),
  split: id('[mission_count_split]'),
};

export const GOLD = id('[mission_gold]');
export const GEM = id('[mission_gem]');
export const BEAD = id('[mission_bead]');

/** The mission table row of a mission ID value. */
export function mission_row(mission_id: number): GameData.MissionRow {
  return data.data.MissionTable.get_row(mission_id);
}

/** What the content hooks of a test server do; tests change it between requests. */
export interface HookState {
  /** The judge result of `MissionGate`. */
  gate: boolean;
  validate: 'pass' | GameContract.GameError;
  extra: 'pass' | GameContract.GameError;
  /** `on_mission_claimed`: nothing, `add_progress` on the tally counter, or throw. */
  after: 'none' | 'count' | 'throw';
  /** `item-ledger` `validate_item_change` rejects every item change. */
  reject_items: boolean;
  readonly validate_calls: number[];
  readonly extra_calls: number[];
  readonly after_calls: number[];
}

/**
 * The `storage` the `RunCoreTest` handler gives a test: what it needs to write a row of a core table. It is the
 * `storage` module object; content `register(core)` gets only its member `content`.
 */
export interface ContentStorage {
  db(ctx: RequestCtx): DbHandle;
}

/** What the next `RunCoreTest` request runs: `fn` on the request ctx, then `GAME_ERROR_CORE_TEST` when `fail`. */
interface RunSlot {
  fn: ((ctx: RequestCtx, mission: Mission, storage: ContentStorage) => unknown) | null;
  fail: boolean;
  result: unknown;
  /** The `storage` module object of the test server, once it started. */
  storage: ContentStorage | null;
}

interface Core {
  readonly routing: {
    register_handler(name: string, handler: (ctx: RequestCtx, request: GameContract.RunCoreTestRequest) => unknown): void;
    register_hook(module: string, hook: string, fn: (...args: never[]) => unknown): void;
  };
  readonly validation: { register_requirement_judge(element: number, judge: () => boolean): void };
  readonly mission: Mission;
}

export interface Options {
  readonly start_at?: bigint;
  /** False to leave `grant_mission_extra` unregistered. */
  readonly extra_hook?: boolean;
  readonly settings?: Readonly<Record<string, unknown>>;
  /** The server module list; every server module when not given. */
  readonly server_modules?: readonly string[];
}

export interface TestServer {
  readonly server: Awaited<ReturnType<typeof start_test_server>>;
  readonly hooks: HookState;
  readonly slot: RunSlot;
}

const servers: TestServer['server'][] = [];

/**
 * Makes the content `register` of a test server: the `RunCoreTest` handler over `slot`, a judge for every
 * `RequirementType` element (`MissionGate` gives `hooks.gate`, the others `false`), the mission hooks over `hooks`,
 * and the other hooks server start requires.
 */
export function make_register(hooks: HookState, slot: RunSlot, extra_hook: boolean): RegisterFunction {
  return (given) => {
    const core = given as unknown as Core;
    core.routing.register_handler('RunCoreTest', (ctx) => {
      if (slot.fn !== null) {
        if (slot.storage === null) throw new Error('the test server has not started');
        slot.result = slot.fn(ctx, core.mission, slot.storage);
      }
      return slot.fail ? REJECTED : new GameContract.RunCoreTestResponse();
    });
    for (const value of Object.values(GameData.RequirementType)) {
      if (value === GameData.RequirementType.None) continue;
      core.validation.register_requirement_judge(value, () => (value === GameData.RequirementType.MissionGate ? hooks.gate : false));
    }
    register_required_hooks(given, ['mission.grant_mission_extra']);
    core.routing.register_hook('mission', 'validate_mission_claim', (_ctx: RequestCtx, mission_id: number) => {
      hooks.validate_calls.push(mission_id);
      return hooks.validate;
    });
    if (extra_hook) {
      core.routing.register_hook('mission', 'grant_mission_extra', (_ctx: RequestCtx, mission_id: number) => {
        hooks.extra_calls.push(mission_id);
        return hooks.extra;
      });
    }
    core.routing.register_hook('mission', 'on_mission_claimed', (ctx: RequestCtx, mission_id: number) => {
      hooks.after_calls.push(mission_id);
      if (hooks.after === 'throw') throw new Error('on_mission_claimed test failure');
      if (hooks.after === 'count') core.mission.add_progress(ctx, C.tally, 1n);
      return null;
    });
    core.routing.register_hook('item-ledger', 'validate_item_change', () => (hooks.reject_items ? REJECTED : 'pass'));
  };
}

export function new_hooks(): HookState {
  return { gate: false, validate: 'pass', extra: 'pass', after: 'none', reject_items: false, validate_calls: [], extra_calls: [], after_calls: [] };
}

export function new_slot(): RunSlot {
  return { fn: null, fail: false, result: undefined, storage: null };
}

/**
 * The settings overrides of the test servers: a 4-hour daily reset offset, an access token that outlives the time
 * jumps of the tests (about 10 years), and `extra`.
 */
export function test_settings(extra: Readonly<Record<string, unknown>> = {}): Record<string, unknown> {
  return { dailyResetOffsetMs: Number(RESET_OFFSET), 'auth.accessTokenTtlMs': Number(3_650n * DAY), ...extra };
}

/** Server modules of `core-spec/` whose dependency closure reaches none of `modules`. */
export function modules_without(...modules: string[]): string[] {
  const dir = new URL('../../../../core-spec/', import.meta.url);
  const specs = readdirSync(dir).map((f) => JSON.parse(readFileSync(new URL(f, dir), 'utf8')) as { name: string; side: string; dependencies: string[] });
  const server = new Map(specs.filter((s) => s.side === 'server').map((s) => [s.name, s.dependencies]));
  const reaches = (name: string, seen = new Set<string>()): boolean => {
    if (modules.includes(name)) return true;
    if (seen.has(name)) return false;
    seen.add(name);
    return (server.get(name) ?? []).some((d) => reaches(d, seen));
  };
  return [...server.keys()].filter((m) => !reaches(m)).sort();
}

/** A LOCAL test server with the mission content hooks, and every server module unless `options.server_modules`. */
export async function start(options: Options = {}): Promise<TestServer> {
  const hooks = new_hooks();
  const slot = new_slot();
  const server = await start_test_server(
    options.start_at ?? at(2026, 12, 2, 12), undefined, 'LOCAL', undefined, undefined, test_settings(options.settings),
    make_register(hooks, slot, options.extra_hook ?? true), undefined, options.server_modules,
  );
  slot.storage = storage_module(server);
  servers.push(server);
  return { server, hooks, slot };
}

export async function stop_all(): Promise<void> {
  for (const server of servers.splice(0)) await stop_test_server(server);
}

export type Session = Awaited<ReturnType<typeof login>>;

let accounts = 0;
const slots = new WeakMap<Session, RunSlot>();

export async function new_user(s: TestServer): Promise<Session> {
  accounts += 1;
  const session = await login(s.server, `mission_${String(accounts)}`);
  slots.set(session, s.slot);
  return session;
}

export type Sent = Awaited<ReturnType<typeof send>>;

/** The error code of a response: 0 on success. */
export function code_of(sent: Sent): number {
  return sent.envelope.error?.code ?? 0;
}

/** Sends `RunCoreTest` that runs `fn` on its ctx; with `fail` the handler then ends with `GAME_ERROR_CORE_TEST`. */
export async function run<T>(session: Session, fn: (ctx: RequestCtx, mission: Mission, storage: ContentStorage) => T, fail = false): Promise<{ sent: Sent; result: T | undefined }> {
  const slot = slots.get(session);
  if (slot === undefined) throw new Error('the session was not made by new_user');
  slot.fn = fn;
  slot.fail = fail;
  slot.result = undefined;
  try {
    const sent = await send(session, 'RunCoreTest', new GameContract.RunCoreTestRequest());
    return { sent, result: slot.result as T | undefined };
  } finally {
    slot.fn = null;
    slot.fail = false;
  }
}

/** `add_progress` inside `RunCoreTest`; with `fail` the handler ends with a `GameError` after it. */
export async function add(session: Session, counter_id: number, amount: bigint | number, fail = false): Promise<Sent> {
  return (await run(session, (ctx, mission) => mission.add_progress(ctx, counter_id, amount), fail)).sent;
}

/** `add_progress` inside `RunCoreTest`: the changed mission IDs, or the error code. */
export async function add_ids(session: Session, counter_id: number, amount: bigint | number): Promise<number[] | number> {
  const { sent, result } = await run(session, (ctx, mission) => mission.add_progress(ctx, counter_id, amount));
  const code = code_of(sent);
  return code !== 0 || result === undefined ? code : result;
}

/** `get_progress` inside `RunCoreTest`. */
export async function progress(session: Session, mission_id: number): Promise<{ progress: bigint; claimed: boolean }> {
  const { sent, result } = await run(session, (ctx, mission) => mission.get_progress(ctx, mission_id));
  if (result === undefined) throw new Error(`get_progress failed with code ${String(code_of(sent))}`);
  return { progress: result.progress, claimed: result.claimed };
}

export async function claim(session: Session, mission_id: number): Promise<Sent> {
  const request = new CoreContract.ClaimMissionRequest();
  request.mission_id = mission_id;
  return send(session, 'core/ClaimMission', request);
}

export async function set_progress(session: Session, mission_id: number, value: bigint, claimed: boolean): Promise<Sent> {
  const request = new CoreCheatContract.SetMissionProgressRequest();
  request.mission_id = mission_id;
  request.progress = value;
  request.claimed = claimed;
  return send_cheat(session, 'core/cheat/SetMissionProgress', request);
}

type StateEntry = Awaited<ReturnType<typeof read_user_state>>[number];

/** The committed UserState of a user. */
export async function state(s: TestServer, session: Session): Promise<StateEntry[]> {
  return read_user_state(s.server, session.user_id);
}

/** The committed `MissionProgressUserState` row of a mission, or null. */
export async function stored(s: TestServer, session: Session, mission_id: number): Promise<CoreContract.MissionProgressUserState | null> {
  const entry = (await state(s, session)).find((e) => e.kind === 'MissionProgressUserState' && e.item_id === BigInt(mission_id));
  return entry === undefined ? null : (entry.value as CoreContract.MissionProgressUserState);
}

/** The committed balance of an item. */
export async function balance(s: TestServer, session: Session, item_id: number): Promise<bigint> {
  const entry = (await state(s, session)).find((e) => e.kind === 'ItemBalanceUserState' && e.item_id === BigInt(item_id));
  return entry === undefined ? 0n : (entry.value as CoreContract.ItemBalanceUserState).amount;
}

/** The committed mails of a user. */
export async function mails(s: TestServer, session: Session): Promise<CoreContract.MailUserState[]> {
  return (await state(s, session)).filter((e) => e.kind === 'MailUserState').map((e) => e.value as CoreContract.MailUserState);
}

/** The `MissionProgressUserState` upserts of a response delta. */
export function delta_progress(sent: Sent): CoreContract.MissionProgressUserState[] {
  const entries = sent.envelope.user_state?.entries ?? [];
  return entries
    .filter((e) => e.kind === 'MissionProgressUserState' && !e.deleted)
    .map((e) => CoreContract.MissionProgressUserState.decode(e.value))
    .filter((v): v is CoreContract.MissionProgressUserState => v !== null);
}

/** The kinds of a response delta's entries. */
export function delta_kinds(sent: Sent): string[] {
  return (sent.envelope.user_state?.entries ?? []).map((e) => e.kind);
}

/** An `ItemAmount`. */
export function item(item_id: number, amount: bigint): CoreContract.ItemAmount {
  const value = new CoreContract.ItemAmount();
  value.item_id = item_id;
  value.amount = amount;
  return value;
}

/** Plain objects of `ItemAmount` values, for comparison. */
export function plain(items: readonly CoreContract.ItemAmount[]): { item_id: number; amount: bigint; big_amount: string }[] {
  return items.map((i) => ({ item_id: i.item_id, amount: i.amount, big_amount: i.big_amount }));
}
