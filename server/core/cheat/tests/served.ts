/**
 * Cheat requests to a test server of `testing`: the real `routing` DEV code processes them over HTTP. A test file that
 * uses these helpers mocks the generated game cheat contract with `game_cheat_contract_mock.ts`, and `registerDev`
 * registers a handler for each of its `rpc`s.
 */
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import * as CoreContract from '../../../generated/contract/core_contract.ts';
import * as CoreCheatContract from '../../../dev/generated/contract/core_cheat_contract.ts';
import * as GameDataDev from '../../../dev/generated/data/game_data_dev.ts';
import type { RequestCtx, Storage } from '../../storage/index.ts';
import { storage_module } from '../../storage/tests/helpers.ts';
import { sign_request } from '../../session/index.ts';
import * as testing from '../../testing/dev/index.ts';
import type { RawResponse, TestServer, TestSession } from '../../testing/dev/index.ts';
import { GAME_ERROR_CORE_TEST } from './game_cheat_contract_mock.ts';

export const E = CoreContract.CoreError;
export const START_AT = 1_800_000_000_000n;
/** A cheat time offset step, well inside `auth.accessTokenTtlMs`, so that offsets do not expire the access token. */
export const STEP = 60_000n;
export { GAME_ERROR_CORE_TEST };

type Message = { encode(): Uint8Array };
type Handler = (ctx: RequestCtx, request: Message) => Message | number;

/** The `core` object of `registerDev`, with the module operations the tests use. */
export interface DevCore {
  readonly cheat: { register_cheat_handler(name: string, handler: Handler): void };
  readonly 'item-ledger': { add_items(ctx: RequestCtx, items: readonly CoreContract.ItemAmount[]): unknown };
}

/** What the content cheat handlers of `register_cheats` did. */
export interface Calls {
  /** Calls of each content cheat by cheat name. */
  readonly count: Map<string, number>;
  /** `hook_change_source` that `Grant` saw. */
  grant_source: RequestCtx['hook_change_source'] | undefined;
  /** How `Break` ends after it adds items and writes an offset row. */
  break_mode: 'game_error' | 'throw';
  /** The item ID value `Grant` and `Break` add 5 of. */
  item_id: number;
}

export function new_calls(item_id: number): Calls {
  return { count: new Map(), grant_source: undefined, break_mode: 'game_error', item_id };
}

function amount(item_id: number, value: bigint): CoreContract.ItemAmount {
  const item = new CoreContract.ItemAmount();
  item.item_id = item_id;
  item.amount = value;
  return item;
}

/**
 * A `registerDev` that registers a handler for each `rpc` of the mocked game cheat contract. `storage` gives the
 * `storage` module object, through which `Break` writes a row content has no operation for.
 */
export function register_cheats(calls: Calls, storage: () => Storage): (core: Readonly<Record<string, unknown>>) => void {
  return (given) => {
    const core = given as unknown as DevCore;
    const counted = (name: string, run: Handler = () => new CoreCheatContract.SetTimeOffsetResponse()): void => {
      core.cheat.register_cheat_handler(name, (ctx, request) => {
        calls.count.set(name, (calls.count.get(name) ?? 0) + 1);
        return run(ctx, request);
      });
    };
    counted('Touch');
    counted('SetMode');
    counted('SetTimeOffset');
    counted('SetItemBalance', () => new CoreCheatContract.SetItemBalanceResponse());
    counted('Grant', (ctx) => {
      calls.grant_source = ctx.hook_change_source;
      core['item-ledger'].add_items(ctx, [amount(calls.item_id, 5n)]);
      return new CoreCheatContract.SetTimeOffsetResponse();
    });
    counted('Break', (ctx) => {
      core['item-ledger'].add_items(ctx, [amount(calls.item_id, 5n)]);
      storage().db(ctx).query('INSERT INTO cheat_time_offset (user_id, offset_ms) VALUES ($1, $2)', [ctx.user_id, STEP]);
      if (calls.break_mode === 'throw') throw new Error('cheat handler failure');
      return GAME_ERROR_CORE_TEST;
    });
  };
}

export interface StartOptions {
  readonly env?: 'LOCAL' | 'STG';
  readonly settings?: Readonly<Record<string, unknown>>;
  readonly calls?: Calls;
}

const servers: TestServer[] = [];

export async function start(options: StartOptions = {}): Promise<TestServer> {
  const start_at = options.env === 'STG' ? undefined : START_AT;
  const started: { server?: TestServer } = {};
  const storage = (): Storage => {
    if (started.server === undefined) throw new Error('the test server has not started');
    return storage_module(started.server);
  };
  const register_dev = options.calls === undefined ? undefined : register_cheats(options.calls, storage);
  const server = await testing.start_test_server(start_at, undefined, options.env, undefined, undefined, options.settings, undefined, register_dev);
  started.server = server;
  servers.push(server);
  return server;
}

export async function stop_all(): Promise<void> {
  for (const server of servers.splice(0)) await testing.stop_test_server(server);
}

export function code(sent: { envelope: CoreContract.ResponseEnvelope }): number {
  return sent.envelope.error?.code ?? 0;
}

export function logs(server: TestServer, kind: string): Record<string, unknown>[] {
  return testing.read_logs(server, kind);
}

/** The `audit` lines of cheat requests. */
export function cheat_audits(server: TestServer): Record<string, unknown>[] {
  return logs(server, 'audit').filter((line) => /^(core\/)?cheat\//.test(String(line['request'])));
}

/** The ID value of the item `[gold]` of the core test data. */
export function gold(): number {
  return GameDataDev.find_id_value('[gold]');
}

/** The server time of the user: `server_time_at` of a `Resync`. */
export async function user_time(session: TestSession): Promise<bigint> {
  return (await testing.send(session, 'core/Resync', new CoreContract.ResyncRequest())).envelope.server_time_at;
}

export function set_time_offset(offset_ms: bigint): CoreCheatContract.SetTimeOffsetRequest {
  const request = new CoreCheatContract.SetTimeOffsetRequest();
  request.offset_ms = offset_ms;
  return request;
}

export function set_user_state(kind: string, item_id: bigint, value_json: string): CoreCheatContract.SetUserStateRequest {
  const request = new CoreCheatContract.SetUserStateRequest();
  request.kind = kind;
  request.item_id = item_id;
  request.value_json = value_json;
  return request;
}

export function dev_login_request(account_name: string): CoreCheatContract.DevLoginRequest {
  const request = new CoreCheatContract.DevLoginRequest();
  request.account_name = account_name;
  return request;
}

function client_data_version(): string {
  return readFileSync(`${testing.core_test_server_paths().data_folder}/client_data_version`, 'utf8').trim();
}

/** The common header of a request without access token. */
export function plain_headers(extra: Readonly<Record<string, string>> = {}): Record<string, string> {
  return {
    'Content-Type': 'application/x-protobuf',
    'X-Ogw-Request-Id': randomUUID(),
    'X-Ogw-Data-Version': client_data_version(),
    'X-Ogw-Client-Version': '1.0.0',
    'X-Ogw-Platform': 'linux',
    ...extra,
  };
}

export interface RawCheat {
  /** Header `X-Ogw-Dev-Access`; null leaves it out. Default: the dev access value. */
  readonly dev_access?: string | null;
  /** Default: the session's access token. */
  readonly access_token?: string;
  /** The request name the signature signs. Default: the request name. */
  readonly sign_name?: string;
  /** `X-Ogw-Timestamp`. Default: the user's server time. */
  readonly timestamp?: bigint;
  /** The request body. Default: the message's protobuf bytes. */
  readonly body?: Uint8Array;
}

/** A signed cheat request sent as given with `send_raw`, and its `ResponseEnvelope`. */
export async function raw_cheat(server: TestServer, session: TestSession, name: string, message: Message, options: RawCheat = {}): Promise<CoreContract.ResponseEnvelope> {
  const body = options.body ?? message.encode();
  const timestamp = (options.timestamp ?? (await user_time(session))).toString();
  const request_id = randomUUID();
  const signature = sign_request(session.session_signing_key, options.sign_name ?? name, request_id, timestamp, body);
  const headers = plain_headers({
    'Authorization': `Bearer ${options.access_token ?? session.access_token}`,
    'X-Ogw-Request-Id': request_id,
    'X-Ogw-Timestamp': timestamp,
    'X-Ogw-Signature': signature,
  });
  const dev_access = options.dev_access === undefined ? server.dev_access : options.dev_access;
  if (dev_access !== null) headers['X-Ogw-Dev-Access'] = dev_access;
  return envelope_of(await testing.send_raw(server, 'POST', `/${name}`, headers, body));
}

/** `DevLogin` sent as given with `send_raw`, and its `ResponseEnvelope`. */
export async function raw_dev_login(server: TestServer, account_name: string, dev_access: string | null = server.dev_access, extra: Readonly<Record<string, string>> = {}, body?: Uint8Array): Promise<CoreContract.ResponseEnvelope> {
  const headers = plain_headers(extra);
  if (dev_access !== null) headers['X-Ogw-Dev-Access'] = dev_access;
  return envelope_of(await testing.send_raw(server, 'POST', '/core/cheat/DevLogin', headers, body ?? dev_login_request(account_name).encode()));
}

export function envelope_of(response: RawResponse): CoreContract.ResponseEnvelope {
  const envelope = CoreContract.ResponseEnvelope.decode(response.body);
  if (envelope === null) throw new Error(`HTTP ${String(response.status)} has no ResponseEnvelope`);
  return envelope;
}
