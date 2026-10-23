/**
 * Test helpers of the `ads-reward` core tests over `testing` (`server/core/testing/dev/index.ts`).
 */
import { createHmac, randomBytes, randomUUID } from 'node:crypto';
import { cpSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as CoreCheatContract from '../../../dev/generated/contract/core_cheat_contract.ts';
import * as CoreContract from '../../../generated/contract/core_contract.ts';
import * as GameContract from '../../../generated/contract/game_contract.ts';
import * as GameData from '../../../generated/data/game_data.ts';
import * as Testing from '../../testing/dev/index.ts';
import { register_false_judges, register_required_hooks } from '../../testing/dev/index.ts';
import type { FakeAdsController } from '../dev/adapters/fake.ts';

export interface TestServer {
  readonly url: string;
  readonly port: number;
  readonly dev_access: string;
}

export interface TestSession {
  readonly user_id: bigint;
  readonly access_token: string;
}

export interface Sent<T> {
  readonly envelope: CoreContract.ResponseEnvelope;
  readonly response: T | null;
}

export interface Raw {
  readonly status: number;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: Uint8Array;
}

export interface StateEntry {
  readonly kind: string;
  readonly item_id: bigint;
  readonly value: unknown;
}

export interface LogLine {
  readonly kind: string;
  readonly level: string;
  readonly message: string;
  readonly reason?: string;
  readonly ip?: string;
  readonly [field: string]: unknown;
}

/** A content `register(core)`: `core` holds the server modules by name. */
export type Register = (core: Record<string, unknown>) => void;

/**
 * The default `register` of a server core test plus `ads-reward` hooks registered with `routing.register_hook`.
 * `handlers` replaces the default handlers of game `rpc`s by name; each gets the `core` of `register`.
 */
export function hooks(
  map: Readonly<Record<string, (...args: never[]) => unknown>>,
  handlers: Readonly<Record<string, (core: Record<string, unknown>, ctx: never) => unknown>> = {},
): Register {
  return (core) => {
    const routing = core.routing as { register_handler(name: string, handler: (ctx: never) => unknown): void; register_hook(module: string, hook: string, fn: unknown): void };
    for (const info of GameContract.RPCS) {
      const handler = handlers[info.name];
      routing.register_handler(info.name, handler === undefined ? () => new info.response_class() : (ctx) => handler(core, ctx));
    }
    register_false_judges(core);
    register_required_hooks(core, ['ads-reward.grant_ad_extra']);
    for (const [name, fn] of Object.entries(map)) routing.register_hook('ads-reward', name, fn);
  };
}

/** The `testing` DEV operations the tests use, in the TypeScript form of the `testing` spec. */
interface TestingApi {
  start_test_server(
    start_at?: bigint,
    db?: 'sqlite' | 'postgresql',
    env?: 'LOCAL' | 'STG',
    matchmaker?: boolean,
    real_adapters?: Record<string, string>,
    settings?: Record<string, unknown>,
    register?: Register,
    register_dev?: Register,
    server_modules?: readonly string[],
    data_folder?: string,
  ): Promise<TestServer>;
  stop_test_server(server: TestServer): Promise<void>;
  restart_test_server(server: TestServer, register?: Register, register_dev?: Register): Promise<TestServer>;
  login(server: TestServer, account: string): Promise<TestSession>;
  send(session: TestSession, request: string, message: unknown): Promise<Sent<unknown>>;
  send_cheat(session: TestSession, request: string, message: unknown): Promise<Sent<unknown>>;
  send_raw(server: TestServer, method: string, path: string, headers: Record<string, string>, body: Uint8Array | null): Promise<Raw>;
  read_user_state(server: TestServer, user_id: bigint): Promise<StateEntry[]>;
  set_time(server: TestServer, time: bigint): void;
  advance_time(server: TestServer, ms: bigint): void;
  fake(server: TestServer, service: string): unknown;
  set_key_source(server: TestServer, adapter_key: string, value: unknown): void;
  wait_background(server: TestServer): Promise<void>;
  load_data(): { data: GameData.DataSet; dev: { find_id_value(name: string): number; find_id_name(value: number): string } };
  read_logs(server: TestServer, kind?: string, level?: string): LogLine[];
  send_admin(server: TestServer, operation: string, body: unknown): Promise<{ status: number; json: unknown }>;
}

export const T = Testing as unknown as TestingApi;

export const DAY_MS = 86_400_000n;
export const MINUTE_MS = 60_000n;
/** A UTC midnight; tests set the clock to it and the day boundary offset to 0. */
export const T0 = 1_799_971_200_000n;
export const CLAIM_WAIT_MS = 2_000n;
export const POLL_MS = 200n;

/** Settings of the LOCAL test servers: the fake ads adapter, a known day boundary, a short claim wait. */
export const LOCAL_SETTINGS: Readonly<Record<string, unknown>> = {
  'environments.<ENV>.adapters.ads': 'fake',
  dailyResetOffsetMs: 0,
  'ads-reward.claimWaitMs': Number(CLAIM_WAIT_MS),
  'ads-reward.claimPollIntervalMs': Number(POLL_MS),
};

export const { data, dev } = T.load_data();
export const id = (name: string): number => dev.find_id_value(name);

export const GEM = (): number => id('[ad_gem]');
export const CAPPED = (): number => id('[ad_capped]');
export const BASIC = (): number => id('[ad_rewarded_basic]');
export const DAILY = (): number => id('[ad_rewarded_daily]');
export const ONCE = (): number => id('[ad_rewarded_once]');
export const CAPPED_PLACEMENT = (): number => id('[ad_rewarded_capped]');
export const INTERSTITIAL = (): number => id('[ad_interstitial]');

export interface Started {
  readonly server: TestServer;
  readonly ads: FakeAdsController;
}

/** A LOCAL test server at `T0` with the fake ads adapter. */
export async function start(settings: Record<string, unknown> = {}, register?: Register, data_folder?: string): Promise<Started> {
  const server = await T.start_test_server(T0, undefined, undefined, undefined, undefined, { ...LOCAL_SETTINGS, ...settings }, register, undefined, undefined, data_folder);
  return { server, ads: T.fake(server, 'ads') as FakeAdsController };
}

let accounts = 0;
const account_names = new Map<bigint, string>();

export async function user(server: TestServer): Promise<TestSession> {
  accounts += 1;
  const name = `ads_${String(accounts)}_${randomUUID().slice(0, 8)}`;
  const session = await T.login(server, name);
  account_names.set(session.user_id, name);
  return session;
}

/** A new session of the same user, for a test clock moved past the access token TTL. */
export async function relogin(server: TestServer, session: TestSession): Promise<TestSession> {
  const name = account_names.get(session.user_id);
  if (name === undefined) throw new Error(`no account of user ${String(session.user_id)}`);
  return T.login(server, name);
}

export function error_of(sent: Sent<unknown>): number {
  return sent.envelope.error?.code ?? 0;
}

export async function begin(session: TestSession, placement_id: number): Promise<Sent<CoreContract.BeginAdRewardResponse>> {
  const request = new CoreContract.BeginAdRewardRequest();
  request.placement_id = placement_id;
  return (await T.send(session, 'core/BeginAdReward', request)) as Sent<CoreContract.BeginAdRewardResponse>;
}

/** `BeginAdReward` that has to succeed: the reward notify ID. */
export async function notify_of(session: TestSession, placement_id: number): Promise<string> {
  const sent = await begin(session, placement_id);
  if (sent.response === null) throw new Error(`BeginAdReward failed with ${String(error_of(sent))}`);
  return sent.response.notify_id;
}

export function claim(session: TestSession, notify_id: string): Promise<Sent<CoreContract.ClaimAdRewardResponse>> {
  const request = new CoreContract.ClaimAdRewardRequest();
  request.notify_id = notify_id;
  return T.send(session, 'core/ClaimAdReward', request) as Promise<Sent<CoreContract.ClaimAdRewardResponse>>;
}

export function fake_callback(session: TestSession, notify_id: string): Promise<Sent<unknown>> {
  const request = new CoreCheatContract.FakeAdCallbackRequest();
  request.notify_id = notify_id;
  return T.send_cheat(session, 'core/cheat/FakeAdCallback', request);
}

export function callback(server: TestServer, query: string, network = 'fake'): Promise<Raw> {
  return T.send_raw(server, 'GET', `/ads/callback/${network}?${query}`, {}, null);
}

/** A fake ads callback signed with key 1 of the fake key list. */
export function signed(started: Started, notify_id: string, user_id: bigint, key_id: bigint = 1n): Promise<Raw> {
  return callback(started.server, started.ads.sign_callback(notify_id, user_id, key_id));
}

/** A fake ads query signed with a key that is not the key list's key of that key ID. */
export function query_with_key(notify_id: string, user_id: bigint, key_id: bigint, key: Uint8Array = randomBytes(32)): string {
  const text = `notify_id=${notify_id}&user_id=${String(user_id)}&key_id=${String(key_id)}`;
  return `${text}&signature=${createHmac('sha256', key).update(text, 'utf8').digest('base64url')}`;
}

/** Waits real time. */
export function real_wait(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/** Moves the test clock a poll interval at a time until the promise settles. */
export async function drive<R>(server: TestServer, pending: Promise<R>): Promise<R> {
  const progress = { settled: false };
  const done = pending.finally(() => {
    progress.settled = true;
  });
  for (let i = 0; i < 200; i += 1) {
    await real_wait(20);
    if (progress.settled) break;
    T.advance_time(server, POLL_MS);
  }
  return done;
}

/** True when the promise has not settled within the real time. */
export async function still_pending(pending: Promise<unknown>, ms: number): Promise<boolean> {
  const marker = Symbol('pending');
  return (await Promise.race([pending, real_wait(ms).then(() => marker)])) === marker;
}

export async function state(server: TestServer, user_id: bigint, kind: string): Promise<StateEntry[]> {
  return (await T.read_user_state(server, user_id)).filter((entry) => entry.kind === kind);
}

/** The committed balance of an item, 0 without one. */
export async function balance(server: TestServer, user_id: bigint, item_id: number): Promise<bigint> {
  const entry = (await state(server, user_id, 'ItemBalanceUserState')).find((e) => e.item_id === BigInt(item_id));
  return entry === undefined ? 0n : (entry.value as CoreContract.ItemBalanceUserState).amount;
}

export async function reward_count(server: TestServer, user_id: bigint, placement_id: number): Promise<CoreContract.AdRewardCountUserState | null> {
  const entry = (await state(server, user_id, 'AdRewardCountUserState')).find((e) => e.item_id === BigInt(placement_id));
  return entry === undefined ? null : (entry.value as CoreContract.AdRewardCountUserState);
}

/** The entries of a delta of a kind. */
export function entries(delta: CoreContract.UserStateDelta | null, kind: string): CoreContract.UserStateEntry[] {
  return (delta?.entries ?? []).filter((entry) => entry.kind === kind);
}

/** The balance an `ItemBalanceUserState` delta entry carries. */
export function balance_entry(delta: CoreContract.UserStateDelta | null, item_id: number): bigint | null {
  const entry = entries(delta, 'ItemBalanceUserState').find((e) => e.id === BigInt(item_id));
  return entry === undefined ? null : (CoreContract.ItemBalanceUserState.decode(entry.value)?.amount ?? null);
}

export function amounts(items: readonly CoreContract.ItemAmount[]): [number, bigint][] {
  return items.map((item) => [item.item_id, item.amount]);
}

export function item(item_id: number, amount: bigint): CoreContract.ItemAmount {
  const value = new CoreContract.ItemAmount();
  value.item_id = item_id;
  value.amount = amount;
  return value;
}

/** Protobuf varint of a non-negative integer. */
function varint(value: number): number[] {
  const out: number[] = [];
  let v = BigInt(value);
  do {
    let byte = Number(v & 0x7fn);
    v >>= 7n;
    if (v > 0n) byte |= 0x80;
    out.push(byte);
  } while (v > 0n);
  return out;
}

function field_varint(no: number, value: number): number[] {
  return value === 0 ? [] : [...varint((no << 3) | 0), ...varint(value)];
}

function field_bytes(no: number, bytes: Uint8Array): number[] {
  return [...varint((no << 3) | 2), ...varint(bytes.byteLength), ...bytes];
}

/**
 * An `AdPlacementRow` of the server data proto (`server/generated/data/game_data.proto`): field 1 `id`, 2 `type`,
 * 3 `reward`, 4 `extra_grant`, 5 `limit_count`, 6 `reset`.
 */
function placement_row(row: GameData.AdPlacementRow): Uint8Array {
  const bytes = [
    ...field_varint(1, row.id),
    ...field_varint(2, row.type),
    ...row.reward.flatMap((reward) => field_bytes(3, reward.encode())),
    ...field_varint(4, row.extra_grant ? 1 : 0),
    ...field_varint(5, row.limit_count),
    ...field_varint(6, row.reset),
  ];
  return new Uint8Array(bytes);
}

/**
 * A copy of the run's server build data whose `ad_placement` also has `extra`. The core test data has no
 * `extra_grant` row: every test server without a `grant_ad_extra` hook would fail to start.
 */
export function data_with_placements(extra: readonly GameData.AdPlacementRow[]): string {
  const source = Testing.core_test_server_paths().data_folder;
  const folder = mkdtempSync(join(tmpdir(), 'ads-reward-data-'));
  cpSync(source, folder, { recursive: true });
  const rows = [...data.AdPlacementTable.all_rows(), ...extra];
  const table = rows.flatMap((row) => field_bytes(1, placement_row(row)));
  writeFileSync(join(folder, 'ad_placement.bin'), new Uint8Array(table));
  const files = new Map(readdirSync(folder).map((name) => [name, new Uint8Array(readFileSync(join(folder, name)))]));
  const loaded = GameData.load_data_set(files);
  if (loaded === null || loaded.AdPlacementTable.all_rows().length !== rows.length) throw new Error('the ad_placement copy does not load');
  return folder;
}

/** Puts the run's `ad_placement` back into a `data_with_placements` folder, for a `restart_test_server` without `extra`. */
export function drop_placements(folder: string): void {
  const source = Testing.core_test_server_paths().data_folder;
  cpSync(join(source, 'ad_placement.bin'), join(folder, 'ad_placement.bin'));
}

export function placement(fields: Partial<GameData.AdPlacementRow> & { id: number }): GameData.AdPlacementRow {
  return Object.assign(new GameData.AdPlacementRow(), fields);
}
