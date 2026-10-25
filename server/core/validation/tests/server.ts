/**
 * Test server instances of `validation` with its dependencies `storage` and `item-ledger` (and theirs, `server-time`
 * and `logging`) on SQLite or PostgreSQL by the run's DB kind, started in dependency order. The test plays the
 * parts of content `register` (the `core` object) and of `routing` (the request transaction around a handler and the
 * hook slots of `item-ledger`). The core test data has `requirement` rows, so a server starts only with the judge
 * hooks of their types. `storage` runs with the test game contract of the storage tests, which has game kinds.
 */
import * as CoreContract from '../../../generated/contract/core_contract.ts';
import * as GameData from '../../../generated/data/game_data.ts';
import * as GameDataDev from '../../../dev/generated/data/game_data_dev.ts';
import { create_item_ledger, type ItemLedger, type ItemLedgerContent, type ValidateItemChangeHook } from '../../item-ledger/index.ts';
import { create_logging_dev } from '../../logging/dev/index.ts';
import { create_logging } from '../../logging/index.ts';
import { create_server_time_dev } from '../../server-time/dev/index.ts';
import { create_server_time, type ClockAdapter } from '../../server-time/index.ts';
import { create_storage_with, type GameTx, type RequestCtx, type Storage } from '../../storage/index.ts';
import { core_settings, new_db, raw_rows, test_server, type DbTarget } from '../../storage/tests/helpers.ts';
import { TEST_CONTRACT } from '../../storage/tests/kinds.ts';
import { create_validation, type RequirementJudge, type Validation } from '../index.ts';

export { DB_KIND } from '../../storage/tests/helpers.ts';

export const START_AT = 1_800_000_000_000n;

/** A clock that moves only when the test moves it. */
export class TestClock implements ClockAdapter {
  readonly real_time = false;
  #time: bigint;
  readonly #listeners = new Set<() => void>();

  constructor(time: bigint) {
    this.#time = time;
  }

  now(): bigint {
    return this.#time;
  }

  advance(ms: bigint): void {
    this.#time += ms;
    for (const listener of [...this.#listeners]) listener();
  }

  subscribe(listener: () => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }
}

/** The `core` object content `register` receives: module name → module object, or its member `content`. */
export interface TestCore {
  readonly validation: Validation;
  readonly storage: Storage;
  readonly 'item-ledger': ItemLedgerContent;
}

/** Content `register(core)`, plus the `item-ledger` hook `validate_item_change` content gives to `register_hook`. */
export interface Register {
  (core: TestCore): void;
}

export interface Started {
  readonly db: DbTarget;
  readonly clock: TestClock;
  readonly core: TestCore;
  readonly storage: Storage;
  readonly ledger: ItemLedger;
  readonly validation: Validation;
  /** What `item-ledger`'s hook slot `validate_item_change` calls; null does the `default` (`pass`). */
  validate_item_change: ValidateItemChangeHook | null;
  stop(): void;
}

const running: Started[] = [];

/** Starts the modules in dependency order around `register`. Returns the server start failure reason on failure. */
export async function startOrFail(register: Register = registerJudges): Promise<Started | string> {
  const db = await new_db();
  const clock = new TestClock(START_AT);
  const time = create_server_time({ settings: { 'server-time.silentMarginMs': 5000, dailyResetOffsetMs: 0 }, modules: {} });
  create_server_time_dev(time).set_clock(clock);
  const settings = { ...core_settings(), 'environments.<ENV>.adapters.analytics': 'fake', supportedLanguages: ['en'] };
  const server = test_server(db, { server_modules: ['item-ledger', 'logging', 'server-time', 'storage', 'validation'] });
  const storage = create_storage_with({ settings, modules: { 'server-time': time }, server }, TEST_CONTRACT);
  const logging = create_logging({ settings, modules: { storage, 'server-time': time }, server });
  create_logging_dev(logging);
  const ledger = create_item_ledger({ settings, modules: { storage, 'server-time': time, logging }, server });
  const validation = create_validation({ settings: { supportedLanguages: settings.supportedLanguages }, modules: { storage, 'item-ledger': ledger }, server });
  const modules = [time, storage, logging, ledger, validation];
  const core: TestCore = { validation, storage, 'item-ledger': ledger.content };
  const stop = (): void => {
    for (const m of [...modules].reverse()) m.stop();
  };
  const started: Started = { db, clock, core, storage, ledger, validation, validate_item_change: null, stop };
  // What `routing` does with the hooks content gives to `register_hook`.
  ledger.hook_slots.validate_item_change = (ctx, source, list) => (started.validate_item_change ? started.validate_item_change(ctx, source, list) : 'pass');
  for (const m of modules) m.begin_start();
  register(core);
  let failure: string | null = null;
  for (const m of modules) failure ??= m.complete_start();
  if (failure !== null) {
    stop();
    return failure;
  }
  // Server start ends: every job runs once.
  time.end_start();
  running.push(started);
  return started;
}

export async function startServer(register: Register = registerJudges): Promise<Started> {
  const started = await startOrFail(register);
  if (typeof started === 'string') throw new Error(`server start failed: ${started}`);
  return started;
}

/** Stops every server instance the test file started. */
export function stopAll(): void {
  for (const s of running.splice(0)) s.stop();
}

/** ID value of an ID name of the core test data; 0 stays 0. */
export function idOf(name: string | 0): number {
  if (name === 0) return 0;
  const id = GameDataDev.find_id_value(name);
  if (id === 0) throw new Error(`the core test data has no ID name ${name}`);
  return id;
}

/** The top `requirement` row of a `game_setting` row of the core test data. */
export function requirementOf(setting: string, row = 1): number {
  return idOf(`[req__game_setting__value__${setting}__${String(row)}]`);
}

export function amount(itemId: number, value: bigint): CoreContract.ItemAmount {
  return Object.assign(new CoreContract.ItemAmount(), { item_id: itemId, amount: value });
}

/** Judge hooks for the types of the core test data's server `requirement` rows. */
export function registerJudges(core: TestCore, flag: (ctx: RequestCtx, type: GameData.RequirementType) => boolean = () => true): void {
  const { FlagA, FlagB, FlagC, ItemAtLeast } = GameData.RequirementType;
  for (const type of [FlagA, FlagB, FlagC]) core.validation.register_requirement_judge(type, (ctx) => flag(ctx, type));
  const itemAtLeast: RequirementJudge = (ctx, row) => core['item-ledger'].get_balance(ctx, row.target_id) >= row.value;
  core.validation.register_requirement_judge(ItemAtLeast, itemAtLeast);
  registerOtherJudges(core);
}

/** The types of the core test data these tests judge themselves; `ClientOnly` is used only by `Client` columns. */
const OWN_TYPES: readonly GameData.RequirementType[] = (({ None, FlagA, FlagB, FlagC, ItemAtLeast, ClientOnly }) => [None, FlagA, FlagB, FlagC, ItemAtLeast, ClientOnly])(GameData.RequirementType);

/** A judge hook returning `false` for each type other modules' core test data rows use. */
export function registerOtherJudges(core: TestCore): void {
  for (const type of Object.values(GameData.RequirementType)) {
    if (!OWN_TYPES.includes(type)) core.validation.register_requirement_judge(type, () => false);
  }
}

/** A new user, created at the clock's time. */
export async function newUser(started: Started): Promise<bigint> {
  const userId = await started.storage.run_game_transaction((tx: GameTx) => started.storage.create_user(tx).user_id);
  if (typeof userId !== 'bigint') throw new Error(`create_user: ${userId}`);
  return userId;
}

/** Runs `fn` in a user transaction that always rolls back. */
export async function inRollback<T>(started: Started, userId: bigint, fn: (ctx: RequestCtx) => T): Promise<T> {
  const result = await started.storage.run_rollback_transaction(userId, fn);
  if (result === 'FAILED') throw new Error('run_rollback_transaction: FAILED');
  if (result === 'WITHDRAWN') throw new Error('run_rollback_transaction: WITHDRAWN');
  return result;
}

let nextRequest = 0;

/**
 * Runs `fn` as a request handler: committed when it returns; rolled back and rejected when it throws, which
 * `routing` ends with `INTERNAL`.
 */
export async function inRequest<T>(started: Started, userId: bigint, fn: (ctx: RequestCtx) => T, requestName = 'core/Test'): Promise<T> {
  nextRequest += 1;
  const fields = { request_name: requestName, request_id: `request-${String(nextRequest)}`, silent: false, retry: false, session_id: 'session-1', client_version: '1.0.0', platform: 'android' };
  const result = await started.storage.run_request_transaction(userId, fields, fn);
  if (result === 'FAILED') throw new Error('run_request_transaction: FAILED');
  if (result === 'WITHDRAWN') throw new Error('run_request_transaction: WITHDRAWN');
  return result;
}

/** The stored rows of a user in every table that holds the user's saved state, for before/after comparisons. */
export function savedState(started: Started, userId: bigint): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const table of ['user_state', 'server_state', 'pending_delta']) out[table] = raw_rows(started.storage, table, userId);
  return out;
}
