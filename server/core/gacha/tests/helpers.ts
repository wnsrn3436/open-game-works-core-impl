/**
 * Test servers for the `gacha` core tests: a `register` that registers what a server core test `register` needs
 * (the `RunCoreTest` handler, the `false` judges, the required hooks) plus the test's hooks, and keeps the
 * `core` object. The `RunCoreTest` handler runs a function the test gives inside the request, so module operations run
 * on a real request ctx.
 */
import * as CoreContract from '../../../generated/contract/core_contract.ts';
import * as GameContract from '../../../generated/contract/game_contract.ts';
import type * as GameData from '../../../generated/data/game_data.ts';
import type { RequestCtx } from '../../storage/index.ts';
import {
  call_dev, load_data, login, read_user_state, register_false_judges, register_required_hooks, send, start_test_server, stop_test_server, type TestServer,
  type TestSession,
} from '../../testing/dev/index.ts';

export const START_AT = 1_800_000_000_000n;
/** `[gacha_banner_window]` `start_at` and `end_at` (2027-02-01T00:00:00Z, 2027-03-01T00:00:00Z). */
export const WINDOW_START = 1_801_440_000_000n;
export const WINDOW_END = 1_803_859_200_000n;

const CoreError = CoreContract.CoreError;
export const INVALID_REQUEST = CoreError.CORE_ERROR_INVALID_REQUEST;
export const INTERNAL = CoreError.CORE_ERROR_INTERNAL;
export const SINGLE = CoreContract.GachaDrawMode.GACHA_DRAW_MODE_SINGLE;
export const MULTI = CoreContract.GachaDrawMode.GACHA_DRAW_MODE_MULTI;
export const NORMAL = CoreContract.GachaDrawKind.GACHA_DRAW_KIND_NORMAL;
export const PITY = CoreContract.GachaDrawKind.GACHA_DRAW_KIND_PITY;
export const MULTI_GUARANTEE = CoreContract.GachaDrawKind.GACHA_DRAW_KIND_MULTI_GUARANTEE;
export const GACHA_SOURCE = CoreContract.ItemChangeSource.ITEM_CHANGE_SOURCE_GACHA;

/** The `core` object `register` receives: module name to module object (or its member `content`). */
export type Core = Record<string, Record<string, (...args: never[]) => unknown>>;

/** Hooks a test registers on `gacha`, by hook name. */
export type GachaHooks = Partial<Record<'validate_gacha_draw' | 'grant_gacha_result' | 'on_gacha_drawn', (...args: never[]) => unknown>>;

interface RoutingRegistration {
  register_handler(name: string, handler: (ctx: unknown, request: unknown) => unknown): void;
  register_hook(module: string, hook: string, fn: (...args: never[]) => unknown): void;
}

/** The ID value of an ID name of the core test data. */
export function id(name: string): number {
  return load_data().dev.find_id_value(name);
}

/** The core test data container. */
export function data(): GameData.DataSet {
  return load_data().data;
}

export interface Started {
  readonly server: TestServer;
  /** The `core` object of the last `register` call. */
  core(): Core;
  /** Sends `RunCoreTest` with the seed and returns what `fn` returned inside the request. */
  run<T>(session: TestSession, fn: (ctx: RequestCtx) => T, seed?: bigint): Promise<T>;
}

const servers: TestServer[] = [];

/** An access token lifetime that outlasts the clock moves of the tests (10 years). */
const ACCESS_TOKEN_TTL_MS = 315_360_000_000;

export interface StartOptions {
  /** Hooks registered on `gacha`. */
  readonly hooks?: GachaHooks;
  /** Called in `register` with the `core` object, after the hooks. */
  readonly extra?: (core: Core) => void;
  readonly start_at?: bigint;
  /** Core settings overrides. */
  readonly settings?: Readonly<Record<string, number>>;
}

/** A test server whose `register` adds the hooks on `gacha` and calls `extra` with the `core` object. */
export async function start(options: StartOptions = {}): Promise<Started> {
  const hooks = options.hooks ?? {};
  const extra = options.extra ?? ((): void => undefined);
  let kept: Core | null = null;
  let body: ((ctx: RequestCtx) => unknown) | null = null;
  let result: unknown = undefined;
  const register = (core: Readonly<Record<string, unknown>>): void => {
    const c = core as Core;
    kept = c;
    const routing = c.routing as unknown as RoutingRegistration;
    routing.register_handler('RunCoreTest', (ctx) => {
      if (body !== null) result = body(ctx as RequestCtx);
      return new GameContract.RunCoreTestResponse();
    });
    register_false_judges(core);
    register_required_hooks(core);
    for (const [hook, fn] of Object.entries(hooks)) routing.register_hook('gacha', hook, fn);
    extra(c);
  };
  const settings = { 'auth.accessTokenTtlMs': ACCESS_TOKEN_TTL_MS, ...options.settings };
  const server = await start_test_server(options.start_at ?? START_AT, undefined, undefined, undefined, undefined, settings, register);
  servers.push(server);
  return {
    server,
    core: () => {
      if (kept === null) throw new Error('register was not called');
      return kept;
    },
    async run<T>(session: TestSession, fn: (ctx: RequestCtx) => T, seed?: bigint): Promise<T> {
      body = fn;
      result = undefined;
      const { envelope } = await send(session, 'RunCoreTest', new GameContract.RunCoreTestRequest(), undefined, undefined, seed);
      body = null;
      if (envelope.error !== null) throw new Error(`RunCoreTest failed with code ${String(envelope.error.code)}`);
      return result as T;
    },
  };
}

export async function stop_all(): Promise<void> {
  for (const server of servers.splice(0)) await stop_test_server(server);
}

/** Sets an item balance of the user through `item-ledger.set_balance`. */
export async function set_balance(server: TestServer, user_id: bigint, item: string, balance: bigint): Promise<void> {
  const result = await call_dev(server, 'item-ledger', 'set_balance', [id(item), balance], user_id);
  if (result !== 'OK') throw new Error(`set_balance ${item}: ${String(result)}`);
}

/** The committed balance of an item (0 when there is no row). */
export async function balance(server: TestServer, user_id: bigint, item: string): Promise<bigint> {
  const state = await read_user_state(server, user_id);
  const row = state.find((s) => s.kind === 'ItemBalanceUserState' && s.item_id === BigInt(id(item)));
  return row === undefined ? 0n : (row.value as CoreContract.ItemBalanceUserState).amount;
}

/** The committed `GachaPityUserState` of a pity owner banner, or null. */
export async function pity(server: TestServer, user_id: bigint, owner: string): Promise<CoreContract.GachaPityUserState | null> {
  const state = await read_user_state(server, user_id);
  const row = state.find((s) => s.kind === 'GachaPityUserState' && s.item_id === BigInt(id(owner)));
  return row === undefined ? null : (row.value as CoreContract.GachaPityUserState);
}

export function draw_request(banner: string, mode: CoreContract.GachaDrawMode = SINGLE, use_ticket = false): CoreContract.DrawGachaRequest {
  const request = new CoreContract.DrawGachaRequest();
  request.banner_id = id(banner);
  request.mode = mode;
  request.use_ticket = use_ticket;
  return request;
}

export interface Drawn {
  readonly envelope: CoreContract.ResponseEnvelope;
  readonly response: CoreContract.DrawGachaResponse | null;
}

export async function draw(session: TestSession, banner: string, mode: CoreContract.GachaDrawMode = SINGLE, options: { ticket?: boolean; seed?: bigint; request_id?: string } = {}): Promise<Drawn> {
  const result = await send(session, 'core/DrawGacha', draw_request(banner, mode, options.ticket ?? false), options.request_id, undefined, options.seed);
  return { envelope: result.envelope, response: result.response as CoreContract.DrawGachaResponse | null };
}

export function error_code(result: { readonly envelope: CoreContract.ResponseEnvelope }): number {
  return result.envelope.error?.code ?? 0;
}

/** The delta entries of a kind in the response's `user_state`, decoded. */
export function delta_of<T>(envelope: CoreContract.ResponseEnvelope, kind: { name: string; decode(bytes: Uint8Array): T | null }): { id: bigint; value: T | null; deleted: boolean }[] {
  return (envelope.user_state?.entries ?? [])
    .filter((entry) => entry.kind === kind.name)
    .map((entry) => ({ id: entry.id, value: entry.deleted ? null : kind.decode(entry.value), deleted: entry.deleted }));
}

/** `item_id` and signed delta of each `ItemChange`, in order. */
/**
 * The `item_changes` of a response without the `Cheat` changes of `set_balance`: an out-of-request change comes in the
 * next response of the user.
 */
export function gacha_changes(envelope: CoreContract.ResponseEnvelope): CoreContract.ItemChange[] {
  return envelope.item_changes.filter((change) => change.source !== CoreContract.ItemChangeSource.ITEM_CHANGE_SOURCE_CHEAT);
}

export function changes(envelope: CoreContract.ResponseEnvelope): [number, bigint, CoreContract.ItemChangeSource][] {
  return gacha_changes(envelope).map((change) => [change.item_id, change.delta, change.source]);
}

/** `(item ID value, amount)` of an `ItemAmount` list. */
export function amounts(items: readonly CoreContract.ItemAmount[]): [number, bigint][] {
  return items.map((item) => [item.item_id, item.amount]);
}

export function item(name: string, amount: bigint): CoreContract.ItemAmount {
  const out = new CoreContract.ItemAmount();
  out.item_id = id(name);
  out.amount = amount;
  return out;
}

export async function history(session: TestSession, banner: string | 0, cursor: bigint, max_rows: number): Promise<{ code: number; entries: CoreContract.GachaHistoryEntry[] }> {
  const request = new CoreContract.ListGachaHistoryRequest();
  request.banner_id = banner === 0 ? 0 : id(banner);
  request.cursor_draw_seq = cursor;
  request.max_rows = max_rows;
  const result = await send(session, 'core/ListGachaHistory', request);
  const response = result.response as CoreContract.ListGachaHistoryResponse | null;
  return { code: error_code(result), entries: response?.entries ?? [] };
}

export { login, type TestServer, type TestSession };
