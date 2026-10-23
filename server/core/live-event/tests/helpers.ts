/**
 * A test server for `live-event` tests. Its `register` registers the game `rpc` `RunCoreTest`, whose handler runs a
 * function the test gives inside the request, and `settle_live_event`, which calls `settle.impl` and counts its calls.
 */
import { randomUUID } from 'node:crypto';
import * as CoreContract from '../../../generated/contract/core_contract.ts';
import * as GameContract from '../../../generated/contract/game_contract.ts';
import type { RequestCtx, Storage } from '../../storage/index.ts';
import { storage_module } from '../../storage/tests/helpers.ts';
import * as T from '../../testing/dev/index.ts';
import type { LiveEventModule, LiveEventRound, SettleLiveEventHook } from '../index.ts';

export const DAY = 86_400_000n;
export const HOUR = 3_600_000n;
/** 2027-01-01T00:00:00Z: `start_at` of the `live_event` rows of the core test data these tests use. */
export const S = 1_798_761_600_000n;
export const SILENT_MARGIN_MS = 5_000n;
/** An access token lifetime longer than every time move of these tests. */
const ACCESS_TOKEN_TTL_MS = 10_000n * DAY;

/** The `live_event` rows of the core test data by ID name. */
export const EVENT = {
  once: '[live_event_once]',
  weekly: '[live_event_weekly]',
  daily: '[live_event_daily]',
  no_settle: '[live_event_no_settle]',
} as const;

/** The `GameError` value a failing `settle_live_event` of these tests returns. */
export const GAME_ERROR = GameContract.GameError.GAME_ERROR_CORE_TEST;

export interface SettleCall {
  readonly event_id: number;
  readonly round: number;
  readonly hook_change_source: RequestCtx['hook_change_source'];
}

export interface Env {
  readonly server: T.TestServer;
  readonly core: Readonly<Record<string, unknown>>;
  readonly live: LiveEventModule;
  /** The `storage` module object: content `register(core)` gets only its member `content`. */
  readonly storage: Storage;
  readonly settle: { impl: SettleLiveEventHook | null; calls: SettleCall[] };
  /** Sends `RunCoreTest` as the session and returns what `fn` returned inside the handler, with the envelope. */
  request<R>(session: T.TestSession, fn: (ctx: RequestCtx) => R): Promise<{ value: R; envelope: CoreContract.ResponseEnvelope }>;
  /** `request` that returns only what `fn` returned. */
  run<R>(session: T.TestSession, fn: (ctx: RequestCtx) => R): Promise<R>;
}

const running: T.TestServer[] = [];

type Outcome = { readonly ok: true; readonly value: unknown } | { readonly ok: false; readonly error: unknown };

/** Starts a test server at `start_at` with `server-time.silentMarginMs` at `SILENT_MARGIN_MS`. */
export async function start(start_at: bigint = S - DAY): Promise<Env> {
  const hold: { core: Readonly<Record<string, unknown>> | null } = { core: null };
  let body: ((ctx: RequestCtx) => unknown) | null = null;
  let outcome: Outcome | null = null;
  const settle: Env['settle'] = { impl: null, calls: [] };
  const register = (given: Readonly<Record<string, unknown>>): void => {
    hold.core = given;
    const routing = given['routing'] as {
      register_handler(name: string, handler: GameContract.RunCoreTestHandler): void;
      register_hook(module: string, hook: string, fn: unknown): void;
    };
    routing.register_handler('RunCoreTest', (ctx) => {
      if (body !== null) {
        try {
          outcome = { ok: true, value: body(ctx) };
        } catch (error) {
          outcome = { ok: false, error };
        }
      }
      return new GameContract.RunCoreTestResponse();
    });
    T.register_false_judges(given);
    T.register_required_hooks(given);
    const hook: SettleLiveEventHook = (ctx, event_id, round) => {
      settle.calls.push({ event_id, round, hook_change_source: ctx.hook_change_source });
      return settle.impl === null ? 'pass' : settle.impl(ctx, event_id, round);
    };
    routing.register_hook('live-event', 'settle_live_event', hook);
  };
  const settings = { 'server-time.silentMarginMs': Number(SILENT_MARGIN_MS), 'auth.accessTokenTtlMs': Number(ACCESS_TOKEN_TTL_MS) };
  const server = await T.start_test_server(start_at, undefined, undefined, undefined, undefined, settings, register);
  running.push(server);
  if (hold.core === null) throw new Error('register was not called');
  const kept: Readonly<Record<string, unknown>> = hold.core;
  const request = async <R>(session: T.TestSession, fn: (ctx: RequestCtx) => R): Promise<{ value: R; envelope: CoreContract.ResponseEnvelope }> => {
    body = fn;
    outcome = null;
    const { envelope } = await T.send(session, 'RunCoreTest', new GameContract.RunCoreTestRequest());
    body = null;
    const got = outcome as Outcome | null;
    if (envelope.error !== null) throw new Error(`RunCoreTest failed with code ${String(envelope.error.code)}`);
    if (got === null) throw new Error('the RunCoreTest handler did not run');
    if (!got.ok) throw got.error;
    return { value: got.value as R, envelope };
  };
  return {
    server,
    core: kept,
    live: kept['live-event'] as LiveEventModule,
    storage: storage_module(server),
    settle,
    request,
    run: async (session, fn) => (await request(session, fn)).value,
  };
}

export async function stop_all(): Promise<void> {
  for (const server of running.splice(0)) await T.stop_test_server(server);
}

/** The ID value of an ID name of the core test data. */
export function id_of(name: string): number {
  const value = T.load_data().dev.find_id_value(name);
  if (value === 0) throw new Error(`${name} is not in the core test data`);
  return value;
}

/**
 * Runs `fn` in a `storage` request transaction of the user, `silent` or not. No game `rpc` of the core test data is
 * `silent`, so the `silent` comparison takes its ctx from here.
 */
export async function in_transaction<R>(env: Env, user_id: bigint, fn: (ctx: RequestCtx) => R, silent: boolean): Promise<R> {
  const fields = { request_name: 'RunCoreTest', request_id: randomUUID(), silent, retry: false, session_id: '', client_version: '', platform: '' };
  const result = await env.storage.run_request_transaction(user_id, fields, fn);
  if (result === 'FAILED' || result === 'WITHDRAWN') throw new Error(`request transaction ${String(result)}`);
  return result;
}

export function round(round_number: number, start_at: bigint, end_at: bigint): LiveEventRound {
  return { round: round_number, start_at, end_at };
}

/** The committed `LiveEventEntryUserState` items of a user. */
export async function entries(env: Env, user_id: bigint): Promise<CoreContract.LiveEventEntryUserState[]> {
  const all = await T.read_user_state(env.server, user_id);
  return all.filter((e) => e.kind === 'LiveEventEntryUserState').map((e) => e.value as CoreContract.LiveEventEntryUserState);
}

/** The `LiveEventEntryUserState` upserts of a delta, decoded. */
export function delta_entries(delta: CoreContract.UserStateDelta | null): CoreContract.LiveEventEntryUserState[] {
  const out: CoreContract.LiveEventEntryUserState[] = [];
  for (const entry of delta?.entries ?? []) {
    if (entry.kind !== 'LiveEventEntryUserState' || entry.deleted) continue;
    const value = CoreContract.LiveEventEntryUserState.decode(entry.value);
    if (value === null) throw new Error('not a LiveEventEntryUserState');
    out.push(value);
  }
  return out;
}

/** The `LiveEventEntryUserState` upserts of an envelope: its `user_state` and `pending_user_state`. */
export function envelope_entries(envelope: CoreContract.ResponseEnvelope): CoreContract.LiveEventEntryUserState[] {
  return [...delta_entries(envelope.user_state), ...delta_entries(envelope.pending_user_state)];
}

/** `error` log lines of the server whose message names live events. */
export function live_event_errors(env: Env): Record<string, unknown>[] {
  return T.read_logs(env.server, 'error', 'error').filter((line) => String(line['message']).includes('live event'));
}

/** Sends `core/Resync` (not full), the request that only runs request start and delivers pending deltas. */
export async function resync(session: T.TestSession): Promise<CoreContract.ResponseEnvelope> {
  const request = new CoreContract.ResyncRequest();
  const { envelope } = await T.send(session, 'core/Resync', request);
  if (envelope.error !== null) throw new Error(`Resync failed with code ${String(envelope.error.code)}`);
  return envelope;
}

/** The `kind` column value of `LiveEventEntryUserState` rows. */
const ENTRY_COLUMN = CoreContract.KINDS.find((kind) => kind.name === 'LiveEventEntryUserState')?.column ?? '';

/** Writes `entry` as the user's `LiveEventEntryUserState` row with a raw upsert, which makes no delta entry. */
export function put_entry(storage: Storage, ctx: RequestCtx, entry: CoreContract.LiveEventEntryUserState): void {
  storage.db(ctx).query(
    'INSERT INTO user_state (user_id, kind, item_id, value, contract_version, updated_at) VALUES ($1, $2, $3, $4, $5, $6) ' +
      'ON CONFLICT (user_id, kind, item_id) DO UPDATE SET value = excluded.value, contract_version = excluded.contract_version, updated_at = excluded.updated_at',
    [ctx.user_id, ENTRY_COLUMN, entry.id, entry.encode(), BigInt(GameContract.CONTRACT_VERSION), ctx.request_time],
  );
}
