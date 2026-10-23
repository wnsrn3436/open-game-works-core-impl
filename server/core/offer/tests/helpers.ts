/**
 * Test servers for `offer` through the `testing` test helpers. The game `rpc` `RunCoreTest` runs a function the test
 * gives inside the request, so offer operations run on a real request ctx and its response delta.
 */
import * as CoreContract from '../../../generated/contract/core_contract.ts';
import * as GameContract from '../../../generated/contract/game_contract.ts';
import * as GameData from '../../../generated/data/game_data.ts';
import type { RequestCtx } from '../../storage/index.ts';
import * as Testing from '../../testing/dev/index.ts';
import type { Offer } from '../index.ts';

export type TestServer = Testing.TestServer;
export type TestSession = Awaited<ReturnType<typeof Testing.login>>;

export const MINUTE = 60_000n;
export const HOUR = 3_600_000n;
export const DAY = 86_400_000n;

/** Unix ms of an ISO 8601 UTC time. */
export function at(iso: string): bigint {
  return BigInt(Date.parse(iso));
}

/** The start time of the LOCAL test servers. */
export const START_TIME = at('2027-01-10T00:00:00Z');

/** The `GameError` of the core test data contract that a `RunCoreTest` handler ends with. */
export const GAME_ERROR = GameContract.GameError.GAME_ERROR_CORE_TEST;

/** Not an ID value of the `offer` table. */
export const UNKNOWN_OFFER_ID = 2_000_000_000;

/** The offer rows of the core test data (`test-data/data/tables/offer.csv`) by ID name. */
export function offer_id(name: '[offer_basic]' | '[offer_window]' | '[offer_locked]' | '[offer_event]' | '[shop_offer]'): number {
  const value = Testing.load_data().dev.find_id_value(name);
  if (value === 0) throw new Error(`${name} is not in the core test data`);
  return value;
}

/** A handler result that ends the request with a `GameError`. */
export interface Failed {
  readonly failed: number;
}

export interface Server {
  readonly server: TestServer;
  /** The `offer` object that content `register` received. */
  readonly offer: Offer;
  /** The result of the `Level` requirement judge hook. */
  judge: boolean;
  /** The body the `RunCoreTest` handler runs; set by `request`. */
  body: ((ctx: RequestCtx) => unknown) | null;
  result: unknown;
}

export interface StartOptions {
  readonly environment?: 'LOCAL' | 'STG';
  readonly settings?: Readonly<Record<string, unknown>>;
}

const running: TestServer[] = [];

/** Access tokens outlive the clock moves of the tests. */
const BASE_SETTINGS = { 'auth.accessTokenTtlMs': Number(1_000n * DAY) };

/** Stops the test servers the test started. */
export async function stop_all(): Promise<void> {
  for (const server of running.splice(0)) await Testing.stop_test_server(server);
}

/**
 * A test server with a `RunCoreTest` handler, a judge hook per `RequirementType` element (`Level` gives
 * `judge`, the others `false`) and the hooks server start requires.
 */
export async function start(options: StartOptions = {}): Promise<Server> {
  const holder: { offer: Offer | null; state: Server | null } = { offer: null, state: null };
  const register = (core: Readonly<Record<string, unknown>>): void => {
    holder.offer = core.offer as Offer;
    // A game `rpc` handler ends with a `GameError` value; `RunCoreTest` lists none, and routing passes any.
    const routing = core.routing as { register_handler(name: string, handler: (ctx: RequestCtx) => GameContract.RunCoreTestResponse | number): void };
    routing.register_handler('RunCoreTest', (ctx) => {
      const state = holder.state;
      const body = state?.body ?? null;
      if (state === null || body === null) return new GameContract.RunCoreTestResponse();
      const value = body(ctx);
      if (typeof value === 'object' && value !== null && 'failed' in value) return (value as Failed).failed;
      state.result = value;
      return new GameContract.RunCoreTestResponse();
    });
    const validation = core.validation as { register_requirement_judge(type: number, judge: () => boolean): void };
    for (const type of Object.values(GameData.RequirementType)) {
      if (type === GameData.RequirementType.None) continue;
      validation.register_requirement_judge(type, () => type === GameData.RequirementType.Level && holder.state?.judge === true);
    }
    Testing.register_required_hooks(core);
  };
  const local = (options.environment ?? 'LOCAL') === 'LOCAL';
  const server = await Testing.start_test_server(local ? START_TIME : undefined, undefined, options.environment, undefined, undefined, { ...BASE_SETTINGS, ...options.settings }, register);
  running.push(server);
  if (holder.offer === null) throw new Error('register did not run');
  const state: Server = { server, offer: holder.offer, judge: false, body: null, result: undefined };
  holder.state = state;
  return state;
}

let account = 0;

/** A new user logged in with a dev account. */
export function user(s: Server): Promise<TestSession> {
  account += 1;
  return Testing.login(s.server, `offer_user_${String(account)}`);
}

/** Moves the test clock to `time`. */
export function set_time(s: Server, time: bigint): void {
  Testing.set_time(s.server, time);
}

export interface OfferRowValue {
  readonly id: bigint;
  readonly started_at: bigint;
  readonly trigger_count: number;
  readonly event_round: number;
}

function row_value(value: CoreContract.OfferUserState): OfferRowValue {
  return { id: value.id, started_at: value.started_at, trigger_count: value.trigger_count, event_round: value.event_round };
}

export interface RequestResult<T> {
  /** The handler's value, or null when it ended with a `GameError`. */
  readonly value: T | null;
  /** The error code of the response, or 0. */
  readonly code: number;
  /** The `OfferUserState` entries of the response delta that are not deletions. */
  readonly delta: OfferRowValue[];
}

/** One `RunCoreTest` request of the session that runs `handler`. A `{ failed }` value ends it with that `GameError`. */
export async function request<T>(s: Server, session: TestSession, handler: (ctx: RequestCtx) => T | Failed): Promise<RequestResult<T>> {
  s.body = handler;
  s.result = undefined;
  try {
    const { envelope } = await Testing.send(session, 'RunCoreTest', new GameContract.RunCoreTestRequest());
    const delta = (envelope.user_state?.entries ?? [])
      .filter((e) => e.kind === 'OfferUserState' && !e.deleted)
      .map((e) => {
        const value = CoreContract.OfferUserState.decode(e.value);
        if (value === null) throw new Error('OfferUserState entry does not decode');
        return row_value(value);
      });
    if (envelope.error !== null) return { value: null, code: envelope.error.code, delta };
    return { value: s.result as T, code: 0, delta };
  } finally {
    s.body = null;
  }
}

/** Runs `fn` in a request and returns its value; throws when the request fails. */
export async function call<T>(s: Server, session: TestSession, fn: (ctx: RequestCtx) => T): Promise<T> {
  const result = await request(s, session, fn);
  if (result.code !== 0) throw new Error(`request failed with ${String(result.code)}`);
  return result.value as T;
}

/** `trigger_offer` in a request of its own. */
export function trigger(s: Server, session: TestSession, id: number): Promise<string> {
  return call(s, session, (ctx) => s.offer.trigger_offer(ctx, id));
}

/** `is_offer_active` and `get_offer_ends_at` in a request of their own. */
export function view(s: Server, session: TestSession, id: number): Promise<{ active: boolean; ends_at: bigint }> {
  return call(s, session, (ctx) => ({ active: s.offer.is_offer_active(ctx, id), ends_at: s.offer.get_offer_ends_at(ctx, id) }));
}

/** `set_offer` through `testing.call_dev`. */
export function set_offer(s: Server, session: TestSession, id: number, started_at: unknown, trigger_count: unknown): Promise<unknown> {
  return Testing.call_dev(s.server, 'offer', 'set_offer', [id, started_at, trigger_count], session.user_id);
}

/** The user's committed `OfferUserState` rows, item ID ascending. */
export async function stored(s: Server, session: TestSession): Promise<OfferRowValue[]> {
  const items = await Testing.read_user_state(s.server, session.user_id);
  return items.filter((item) => item.kind === 'OfferUserState').map((item) => row_value(item.value as CoreContract.OfferUserState));
}

/** Rows sorted by offer ID value, as `stored` returns them. */
export function by_id(rows: OfferRowValue[]): OfferRowValue[] {
  return [...rows].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/** The `core_offer_triggered` events the fake analytics adapter received, after the background work ends. */
export async function triggered_events(s: Server): Promise<{ user_id: bigint; params: CoreContract.AnalyticsParam[] }[]> {
  await Testing.wait_background(s.server);
  const controller = Testing.fake(s.server, 'analytics') as { calls(): { operation: string; input: unknown }[] };
  return controller
    .calls()
    .filter((c) => c.operation === 'send')
    .flatMap((c) => c.input as { user_id: bigint; name: string; params: CoreContract.AnalyticsParam[] }[])
    .filter((e) => e.name === 'core_offer_triggered')
    .map((e) => ({ user_id: e.user_id, params: [...e.params] }));
}

/** An `UpdateConsent` request with the analytics choice. */
export function consent(analytics: CoreContract.ConsentChoice): CoreContract.UpdateConsentRequest {
  const message = new CoreContract.UpdateConsentRequest();
  message.privacy_version = 1;
  message.ad_personalization = CoreContract.ConsentChoice.CONSENT_CHOICE_DENIED;
  message.analytics = analytics;
  message.tracking = CoreContract.TrackingStatus.TRACKING_STATUS_NOT_APPLICABLE;
  return message;
}

/** The `error` log lines of `trigger_offer`. */
export function trigger_error_logs(s: Server): Record<string, unknown>[] {
  return Testing.read_logs(s.server, 'error', 'error').filter((line) => typeof line.message === 'string' && line.message.startsWith('trigger_offer'));
}
