/**
 * Test servers for `attendance` through the `testing` test helpers: `ClaimAttendance` with `send`, the game `rpc`
 * `RunCoreTest` whose handler runs a function the test gives inside the request, the module objects that
 * `register(core)` received, and the hooks the test registers.
 */
import * as CoreContract from '../../../generated/contract/core_contract.ts';
import * as GameContract from '../../../generated/contract/game_contract.ts';
import * as Testing from '../../testing/dev/index.ts';
import type { ServerTimeApi } from '../../server-time/index.ts';
import type { RequestCtx, StorageContent } from '../../storage/index.ts';
import { storage_module } from '../../storage/tests/helpers.ts';
import type { AttendanceClaimedHook, AttendanceClaimHook, AttendanceModule } from '../index.ts';

/** 2027-03-01T00:00:00Z: the start of game day 20878 with `dailyResetOffsetMs` 0, and of round 1 of both test events. */
export const DAY0 = 1_803_859_200_000n;
export const HOUR_MS = 3_600_000n;
export const DAY_MS = 86_400_000n;
/** The test servers start an hour into `DAY0`. */
export const START_AT = DAY0 + HOUR_MS;
export const CLAIM = 'core/ClaimAttendance';
export const KIND = 'AttendanceUserState';
/** The `GameError` of the core test data that `(ogw.core_errors)` lists for `ClaimAttendance`. */
export const REFUSED = GameContract.GameError.GAME_ERROR_CORE_TEST;
export const E = CoreContract.CoreError;
/** An access token lifetime longer than every clock move of these tests. */
const ACCESS_TOKEN_TTL_MS = 400n * DAY_MS;

export type TestServer = Testing.TestServer;
export type TestSession = Testing.TestSession;

/** `item-ledger` as content code calls it. */
export interface ContentLedger {
  add_items(ctx: RequestCtx, items: readonly CoreContract.ItemAmount[], source: { source: number; ref: string; once_key: string }): unknown;
}

/** The `core` object of `register`: the module objects (or their `content` member) by module name. */
export interface RegisterCore {
  readonly routing: {
    register_handler(name: string, handler: GameContract.RunCoreTestHandler): void;
    register_hook(module: string, hook: string, fn: unknown): void;
  };
  readonly 'item-ledger': ContentLedger;
  readonly storage: StorageContent;
  readonly 'server-time': ServerTimeApi;
  readonly attendance: AttendanceModule;
}

export interface Hooks {
  validate_attendance_claim?: AttendanceClaimHook;
  grant_attendance_extra?: AttendanceClaimHook;
  /** Its return value is the hook output; `undefined` is `null`. */
  on_attendance_claimed?: (ctx: RequestCtx, calendar_id: number, day: number, ledger: ContentLedger) => unknown;
  validate_item_change?: () => 'pass' | number;
}

type Outcome = { readonly ok: true; readonly value: unknown } | { readonly ok: false; readonly error: unknown };

export interface Env {
  server: TestServer;
  /** The `core` object the last `register` received. */
  core: RegisterCore;
  /** The function the next `RunCoreTest` handler runs, and what it gave. */
  body: ((ctx: RequestCtx) => unknown) | null;
  outcome: Outcome | null;
}

/**
 * A `register` with the `RunCoreTest` handler, the core test judges (`false` per `RequirementType`), the hooks server
 * start requires except those the test gives or names in `except`, and the test's hooks.
 */
function register_with(env: Partial<Env>, hooks: Hooks, except: readonly string[]) {
  return (given: Readonly<Record<string, unknown>>): void => {
    const core = given as unknown as RegisterCore;
    env.core = core;
    core.routing.register_handler('RunCoreTest', (ctx) => {
      const body = env.body ?? null;
      if (body !== null) {
        try {
          env.outcome = { ok: true, value: body(ctx) };
        } catch (error) {
          env.outcome = { ok: false, error };
        }
      }
      return new GameContract.RunCoreTestResponse();
    });
    Testing.register_false_judges(given);
    const skipped = hooks.grant_attendance_extra === undefined ? except : [...except, 'attendance.grant_attendance_extra'];
    Testing.register_required_hooks(given, skipped);
    for (const name of ['validate_attendance_claim', 'grant_attendance_extra'] as const) {
      const hook = hooks[name];
      if (hook !== undefined) core.routing.register_hook('attendance', name, hook);
    }
    const claimed = hooks.on_attendance_claimed;
    if (claimed !== undefined) {
      const ledger = core['item-ledger'];
      const hook: AttendanceClaimedHook = (ctx, calendar_id, day) => {
        const output: unknown = claimed(ctx, calendar_id, day, ledger);
        return (output ?? null) as null;
      };
      core.routing.register_hook('attendance', 'on_attendance_claimed', hook);
    }
    if (hooks.validate_item_change !== undefined) core.routing.register_hook('item-ledger', 'validate_item_change', hooks.validate_item_change);
  };
}

export interface StartOptions {
  hooks?: Hooks;
  settings?: Readonly<Record<string, unknown>>;
  start_at?: bigint;
  /** `<module>.<hook>` names of the hooks server start requires that the test leaves unregistered. */
  except?: readonly string[];
  environment?: 'LOCAL' | 'STG';
}

/** A test server at `START_AT` with the hooks and settings overrides given. */
export async function start(options: StartOptions = {}): Promise<Env> {
  const env: Partial<Env> = { body: null, outcome: null };
  const register = register_with(env, options.hooks ?? {}, options.except ?? []);
  const settings = { 'auth.accessTokenTtlMs': Number(ACCESS_TOKEN_TTL_MS), ...options.settings };
  const stg = options.environment === 'STG';
  env.server = await Testing.start_test_server(stg ? undefined : (options.start_at ?? START_AT), undefined, options.environment, undefined, undefined, settings, register);
  return env as Env;
}

export async function stop(env: Env | undefined): Promise<void> {
  if (env !== undefined) await Testing.stop_test_server(env.server);
}

let account = 0;

export async function user(env: Env): Promise<TestSession> {
  account += 1;
  return Testing.login(env.server, `attendance_user_${String(account)}`);
}

/** Sends `RunCoreTest` as the session and returns what `fn` returned inside the handler; a throw in `fn` is rethrown. */
export async function run<R>(env: Env, session: TestSession, fn: (ctx: RequestCtx) => R): Promise<R> {
  env.body = fn;
  env.outcome = null;
  const { envelope } = await Testing.send(session, 'RunCoreTest', new GameContract.RunCoreTestRequest());
  env.body = null;
  const got = env.outcome as Outcome | null;
  if (envelope.error !== null) throw new Error(`RunCoreTest failed with code ${String(envelope.error.code)}`);
  if (got === null) throw new Error('the RunCoreTest handler did not run');
  if (!got.ok) throw got.error;
  return got.value as R;
}

export function id_of(name: string): number {
  const value = Testing.load_data().dev.find_id_value(name);
  if (value === 0) throw new Error(`${name} is not in the core test data`);
  return value;
}

export interface Claimed {
  readonly envelope: CoreContract.ResponseEnvelope;
  readonly response: CoreContract.ClaimAttendanceResponse | null;
  /** The error code; 0 on success. */
  readonly code: number;
}

export async function claim(session: TestSession, calendar: string | number, request_id?: string): Promise<Claimed> {
  const request = new CoreContract.ClaimAttendanceRequest();
  request.calendar_id = typeof calendar === 'number' ? calendar : id_of(calendar);
  const { envelope, response } = await Testing.send(session, CLAIM, request, request_id);
  return { envelope, response: response as CoreContract.ClaimAttendanceResponse | null, code: envelope.error?.code ?? 0 };
}

/** The response of a successful claim; throws for an error response. */
export function ok(result: Claimed): CoreContract.ClaimAttendanceResponse {
  if (result.response === null) throw new Error(`ClaimAttendance failed with code ${String(result.code)}`);
  return result.response;
}

/** Moves the test clock to the time. */
export function at(env: Env, time: bigint): void {
  Testing.set_time(env.server, time);
}

export function day_number(env: Env, time: bigint): bigint {
  return env.core['server-time'].get_day_number(time);
}

/** The committed `AttendanceUserState` rows of the user, item ID ascending. */
export async function progress(env: Env, session: TestSession): Promise<CoreContract.AttendanceUserState[]> {
  const items = await Testing.read_user_state(env.server, session.user_id);
  return items.filter((item) => item.kind === KIND).map((item) => item.value as CoreContract.AttendanceUserState);
}

/** The committed `AttendanceUserState` row of one calendar, or null. */
export async function progress_of(env: Env, session: TestSession, calendar: string): Promise<CoreContract.AttendanceUserState | null> {
  const id = BigInt(id_of(calendar));
  return (await progress(env, session)).find((row) => row.id === id) ?? null;
}

/** The committed balance of an item. */
export async function balance(env: Env, session: TestSession, name: string): Promise<bigint> {
  const id = BigInt(id_of(name));
  const items = await Testing.read_user_state(env.server, session.user_id);
  const entry = items.find((item) => item.kind === 'ItemBalanceUserState' && item.item_id === id);
  return entry === undefined ? 0n : (entry.value as CoreContract.ItemBalanceUserState).amount;
}

/** The committed mails of the user. */
export async function mails(env: Env, session: TestSession): Promise<CoreContract.MailUserState[]> {
  const items = await Testing.read_user_state(env.server, session.user_id);
  return items.filter((item) => item.kind === 'MailUserState').map((item) => item.value as CoreContract.MailUserState);
}

/** The upserted values of a kind in a delta, decoded. */
export function delta_values<T>(delta: CoreContract.UserStateDelta | null, kind: string, decode: (bytes: Uint8Array) => T | null): T[] {
  if (delta === null) return [];
  return delta.entries
    .filter((entry) => entry.kind === kind && !entry.deleted)
    .map((entry) => {
      const value = decode(entry.value);
      if (value === null) throw new Error(`undecodable ${kind} entry`);
      return value;
    });
}

export function attendance_delta(envelope: CoreContract.ResponseEnvelope): CoreContract.AttendanceUserState[] {
  return delta_values(envelope.user_state, KIND, (bytes) => CoreContract.AttendanceUserState.decode(bytes));
}

export function amount(name: string, value: bigint): CoreContract.ItemAmount {
  const item = new CoreContract.ItemAmount();
  item.item_id = id_of(name);
  item.amount = value;
  return item;
}

/** `[item ID value, amount]` of `ItemAmount` values, for comparing lists. */
export function pairs(items: readonly CoreContract.ItemAmount[]): [number, bigint][] {
  return items.map((item) => [item.item_id, item.amount]);
}

/** The `kind` column value of `AttendanceUserState` rows. */
const ATTENDANCE_COLUMN = CoreContract.KINDS.find((kind) => kind.name === 'AttendanceUserState')?.column ?? '';

/** Writes `value` as the user's `AttendanceUserState` row with a raw upsert through the `storage` module object. */
export function put_progress(env: Env, ctx: RequestCtx, value: CoreContract.AttendanceUserState): void {
  storage_module(env.server).db(ctx).query(
    'INSERT INTO user_state (user_id, kind, item_id, value, contract_version, updated_at) VALUES ($1, $2, $3, $4, $5, $6) ' +
      'ON CONFLICT (user_id, kind, item_id) DO UPDATE SET value = excluded.value, contract_version = excluded.contract_version, updated_at = excluded.updated_at',
    [ctx.user_id, ATTENDANCE_COLUMN, value.id, value.encode(), BigInt(GameContract.CONTRACT_VERSION), ctx.request_time],
  );
}
