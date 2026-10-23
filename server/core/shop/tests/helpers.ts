/**
 * Test servers for `shop` through the `testing` test helpers: `BuyShopProduct` with `send`, balances with
 * `item-ledger`'s `set_balance`, offers with `offer`'s `set_offer`, hooks registered by the test's own `register`, and
 * operations that need a request ctx run inside the core test data `rpc` `RunCoreTest`.
 */
import * as CoreContract from '../../../generated/contract/core_contract.ts';
import * as GameContract from '../../../generated/contract/game_contract.ts';
import * as GameData from '../../../generated/data/game_data.ts';
import type { Pass, RequestCtx } from '../../storage/index.ts';
import * as testing from '../../testing/dev/index.ts';

/** 2027-01-15T08:00:00Z, a Friday. The `[shop_event]` round 1 is active; `[shop_window]` has not started. */
export const START_AT = 1_800_000_000_000n;
export const HOUR_MS = 3_600_000n;
export const DAY_MS = 86_400_000n;
/** 2027-01-16T00:00:00Z: `[shop_event]` round 1 has ended, and `[shop_window]` starts. */
export const JAN_16 = 1_800_057_600_000n;
/** 2027-01-17T00:00:00Z: `[shop_window]` has ended, and `[shop_event]` round 2 starts. */
export const JAN_17 = JAN_16 + DAY_MS;
export const MAX_SAFE = 2n ** 53n - 1n;

export const E = CoreContract.CoreError;
/** The `GameError` the hooks return: the core test data lists it in `(ogw.core_errors)` of `core/BuyShopProduct`. */
export const HOOK_ERROR = GameContract.GameError.GAME_ERROR_CORE_TEST;

type TestServer = Awaited<ReturnType<typeof testing.start_test_server>>;
type TestSession = Awaited<ReturnType<typeof testing.login>>;
export type { TestServer, TestSession };

/** The `item-ledger` operation the hooks call, as content code calls it. */
export interface ContentLedger {
  add_items(ctx: RequestCtx, items: readonly CoreContract.ItemAmount[], source?: { ref?: string; once_key?: string }): unknown;
}

/** The `shop` operation content code calls. */
export interface ContentShop {
  get_purchase_count(ctx: RequestCtx, product_id: number): number;
}

/** The `offer` operation shop reads its purchase count rows with. */
export interface LimitOffer {
  read_purchase_limit(
    ctx: RequestCtx,
    offer_id: number,
    reset: GameData.ResetCycle | null,
    live_event: number,
    count: number,
    reset_at: bigint,
    event_round: number,
  ): { count: number; reset_at: bigint; event_round: number; write_reset_at: bigint };
}

/** The `core` object of `register`: the module objects (or their `content` member) by module name. */
interface RegisterCore {
  readonly routing: {
    register_hook(module: string, hook: string, fn: unknown): void;
    register_handler(name: string, handler: GameContract.RunCoreTestHandler): void;
  };
  readonly validation: { register_requirement_judge(element: number, judge: unknown): void };
  readonly 'item-ledger': ContentLedger;
  readonly shop: ContentShop;
  readonly offer: LimitOffer;
}

/** What a test hook can call: the content operations of `item-ledger` and `shop`, and the `offer` read shop calls. */
export interface HookCore {
  readonly ledger: ContentLedger;
  readonly shop: ContentShop;
  readonly offer: LimitOffer;
}

export type ProductHook = (ctx: RequestCtx, product_id: number, quantity: number, core: HookCore) => Pass | number;
export type BoughtHook = (ctx: RequestCtx, product_id: number, quantity: number, core: HookCore) => unknown;

export interface Hooks {
  validate_shop_purchase?: ProductHook;
  /** Left out: the core test default (`pass`). `null`: not registered. */
  grant_shop_extra?: ProductHook | null;
  on_shop_bought?: BoughtHook;
  /** The judge of `ShopRank`; the core test default (`false`) when left out. */
  shop_rank?: boolean;
}

/** The function the `RunCoreTest` handler of a test server runs, and what it returned. */
interface Runner {
  body: ((ctx: RequestCtx, core: HookCore) => unknown) | null;
  result: unknown;
}

/**
 * A `register` with a `RunCoreTest` handler that runs the runner's function, the core test default judges (`false`
 * per `RequirementType`, as `register_false_judges`) and required hooks, and the hooks of the test.
 */
function register_with(hooks: Hooks, runner: Runner): (core: Readonly<Record<string, unknown>>) => void {
  return (input) => {
    const core = input as unknown as RegisterCore;
    const content: HookCore = { ledger: core['item-ledger'], shop: core.shop, offer: core.offer };
    core.routing.register_handler('RunCoreTest', (ctx) => {
      if (runner.body !== null) runner.result = runner.body(ctx, content);
      return new GameContract.RunCoreTestResponse();
    });
    for (const value of Object.values(GameData.RequirementType)) {
      if (value === GameData.RequirementType.None) continue;
      const passed = value === GameData.RequirementType.ShopRank && hooks.shop_rank === true;
      core.validation.register_requirement_judge(value, () => passed);
    }
    const { validate_shop_purchase: validate, grant_shop_extra: extra, on_shop_bought: bought } = hooks;
    testing.register_required_hooks(input, extra === undefined ? [] : ['shop.grant_shop_extra']);
    if (validate !== undefined) core.routing.register_hook('shop', 'validate_shop_purchase', (ctx: RequestCtx, id: number, q: number) => validate(ctx, id, q, content));
    if (extra !== undefined && extra !== null) core.routing.register_hook('shop', 'grant_shop_extra', (ctx: RequestCtx, id: number, q: number) => extra(ctx, id, q, content));
    if (bought !== undefined) core.routing.register_hook('shop', 'on_shop_bought', (ctx: RequestCtx, id: number, q: number) => bought(ctx, id, q, content));
  };
}

/** An access token that outlives the clock moves of the tests. */
const SETTINGS = { 'auth.accessTokenTtlMs': Number(10_000n * DAY_MS) };

const running: TestServer[] = [];
const runners = new Map<TestServer, Runner>();

/** A LOCAL test server at `start_at` with the hooks. `stop_all` stops it. A start failure throws `StartFailure`. */
export async function start(hooks: Hooks = {}, start_at: bigint = START_AT): Promise<TestServer> {
  const runner: Runner = { body: null, result: undefined };
  const server = await testing.start_test_server(start_at, undefined, undefined, undefined, undefined, SETTINGS, register_with(hooks, runner));
  running.push(server);
  runners.set(server, runner);
  return server;
}

export async function stop_all(): Promise<void> {
  for (const server of running.splice(0)) {
    runners.delete(server);
    await testing.stop_test_server(server);
  }
}

/** Sends `RunCoreTest` for the session and returns what `fn` returned inside that request. */
export async function run<T>(server: TestServer, session: TestSession, fn: (ctx: RequestCtx, core: HookCore) => T): Promise<T> {
  const runner = runners.get(server);
  if (runner === undefined) throw new Error('run: not a test server of start');
  runner.body = fn;
  runner.result = undefined;
  try {
    const { envelope } = await testing.send(session, 'RunCoreTest', new GameContract.RunCoreTestRequest());
    if (envelope.error !== null) throw new Error(`RunCoreTest failed with code ${String(envelope.error.code)}`);
  } finally {
    runner.body = null;
  }
  return runner.result as T;
}

let account = 0;

export async function user(server: TestServer): Promise<TestSession> {
  account += 1;
  return testing.login(server, `shop_user_${String(account)}`);
}

/** The ID value of an ID name of the core test data. */
export function id(name: string): number {
  return testing.load_data().dev.find_id_value(name);
}

export function data(): GameData.DataSet {
  return testing.load_data().data;
}

export interface Bought {
  readonly envelope: CoreContract.ResponseEnvelope;
  readonly response: CoreContract.BuyShopProductResponse | null;
  /** The error code; 0 on success. */
  readonly code: number;
}

export async function buy(session: TestSession, product: string, quantity = 1, accept_loss = false, request_id?: string): Promise<Bought> {
  const request = new CoreContract.BuyShopProductRequest();
  request.product_id = id(product);
  request.quantity = quantity;
  request.accept_loss = accept_loss;
  const { envelope, response } = await testing.send(session, 'core/BuyShopProduct', request, request_id);
  return { envelope, response: response as CoreContract.BuyShopProductResponse | null, code: envelope.error?.code ?? 0 };
}

/** Sets a committed balance with `item-ledger`'s DEV `set_balance`. */
export async function set_balance(server: TestServer, session: TestSession, item: string, amount: bigint): Promise<void> {
  const result = await testing.call_dev(server, 'item-ledger', 'set_balance', [id(item), amount], session.user_id);
  if (result !== 'OK') throw new Error(`set_balance ${item}: ${String(result)}`);
}

/** Turns an offer on with `offer`'s DEV `set_offer`. */
export async function set_offer(server: TestServer, session: TestSession, offer: string, started_at: bigint, trigger_count: number): Promise<void> {
  await testing.call_dev(server, 'offer', 'set_offer', [id(offer), started_at, trigger_count], session.user_id);
}

async function states(server: TestServer, session: TestSession, kind: string): Promise<{ item_id: bigint; value: unknown }[]> {
  return (await testing.read_user_state(server, session.user_id)).filter((s) => s.kind === kind);
}

/** The committed balance of an item. A big item's balance is read from its big encoding pair. */
export async function balance(server: TestServer, session: TestSession, item: string): Promise<bigint> {
  const entry = (await states(server, session, 'ItemBalanceUserState')).find((s) => s.item_id === BigInt(id(item)));
  if (entry === undefined) return 0n;
  const value = entry.value as CoreContract.ItemBalanceUserState;
  return value.big_amount !== '' ? BigInt(value.big_amount) : value.amount;
}

/** The committed `ShopPurchaseUserState` row of a product, or null. */
export async function purchase_row(server: TestServer, session: TestSession, product: string): Promise<CoreContract.ShopPurchaseUserState | null> {
  const entry = (await states(server, session, 'ShopPurchaseUserState')).find((s) => s.item_id === BigInt(id(product)));
  return entry === undefined ? null : (entry.value as CoreContract.ShopPurchaseUserState);
}

export async function mails(server: TestServer, session: TestSession): Promise<CoreContract.MailUserState[]> {
  return (await states(server, session, 'MailUserState')).map((s) => s.value as CoreContract.MailUserState);
}

/** Every UserState of a user, encoded, to compare the state before and after a request. */
export async function snapshot(server: TestServer, session: TestSession): Promise<string[]> {
  return (await testing.read_user_state(server, session.user_id)).map((s) => {
    const value = s.value as { encode(): Uint8Array };
    return `${s.kind}:${String(s.item_id)}:${Buffer.from(value.encode()).toString('hex')}`;
  });
}

/** The decoded entries of a kind in the response delta. */
export function delta_of<T>(envelope: CoreContract.ResponseEnvelope, kind: { name: string; decode(bytes: Uint8Array): T | null }): { id: bigint; value: T | null; deleted: boolean }[] {
  const entries = envelope.user_state?.entries ?? [];
  return entries.filter((e) => e.kind === kind.name).map((e) => ({ id: e.id, value: e.deleted ? null : kind.decode(e.value), deleted: e.deleted }));
}

/**
 * The `ItemChange` of an item with source `Shop` in a response. The response also carries the pending `ItemChange`s
 * of the DEV `set_balance` calls before it.
 */
export function shop_change(envelope: CoreContract.ResponseEnvelope, item: string): CoreContract.ItemChange | undefined {
  return envelope.item_changes.find((c) => c.item_id === id(item) && c.source === CoreContract.ItemChangeSource.ITEM_CHANGE_SOURCE_SHOP);
}

/** The amount of an item in a list of `ItemAmount`, from its big encoding pair. */
export function amount_in(items: readonly CoreContract.ItemAmount[], item: string): bigint {
  const entry = items.find((i) => i.item_id === id(item));
  if (entry === undefined) return 0n;
  return entry.big_amount !== '' ? BigInt(entry.big_amount) : entry.amount;
}

/** The `core_shop_bought` events stored for a user (`logging` admin operation `list_server_events`): name and int params. */
export async function server_events(server: TestServer, session: TestSession): Promise<{ name: string; params: [string, bigint][] }[]> {
  const result = await testing.send_admin(server, 'list_server_events', {
    user_id: String(session.user_id), name: 'core_shop_bought', from_at: String(START_AT - DAY_MS), to_at: String(START_AT + DAY_MS), limit: 100,
  });
  if (result.status !== 200) throw new Error(`list_server_events: ${String(result.status)}`);
  const entries = ((result.json ?? {}) as { entries?: { name: string; params: string }[] }).entries ?? [];
  return entries.map((e) => {
    const event = CoreContract.AnalyticsEvent.decode(new Uint8Array(Buffer.from(e.params, 'base64')));
    return { name: e.name, params: (event?.params ?? []).map((p): [string, bigint] => [p.key, p.int_value]) };
  });
}

export function item_amount(item: string, amount: bigint): CoreContract.ItemAmount {
  const value = new CoreContract.ItemAmount();
  value.item_id = id(item);
  if (amount <= MAX_SAFE) value.amount = amount;
  else value.big_amount = amount.toString();
  return value;
}
