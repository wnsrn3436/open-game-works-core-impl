/** Test helpers of the nickname core tests: a test server whose `register` keeps the module objects. */
import { appendFileSync, cpSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as CoreContract from '../../../generated/contract/core_contract.ts';
import * as GameContract from '../../../generated/contract/game_contract.ts';
import type { RequestCtx, Storage } from '../../storage/index.ts';
import { storage_module } from '../../storage/tests/helpers.ts';
import {
  call_dev,
  core_test_register,
  core_test_server_paths,
  load_data,
  login,
  read_user_state,
  send,
  start_test_server,
  type DbKind,
  type RemoteServer,
  type TestServer,
  type TestSession,
} from '../../testing/dev/index.ts';
import type { AdminOperation, Nickname } from '../index.ts';

/** The server build data folder of this run, from `core_test_server_paths`. */
const run_paths = core_test_server_paths();

/** The module objects of a server instance these tests use, as `register(core)` gets them. */
export interface Core {
  readonly nickname: Nickname;
  /** The `storage` module object; content `register(core)` gets only its member `content`. */
  readonly storage: Storage;
  readonly 'item-ledger': {
    add_items(ctx: RequestCtx, items: readonly CoreContract.ItemAmount[], source: { source?: number; ref?: string; once_key?: string }): unknown;
  };
  readonly routing: {
    register_hook(module: string, hook: string, fn: unknown): void;
    register_admin_operation(operation: unknown): void;
  };
}

/** What a test changes in the content `register`. */
export interface ContentState {
  /** The `GameError` the `validate_item_change` hook returns for a `Nickname` change; 0 passes. */
  reject_nickname_cost: number;
}

export interface Harness {
  readonly server: TestServer;
  readonly content: ContentState;
  /** The module objects of the server instance the test server runs now. */
  core(): Core;
  nickname(): Nickname;
}

/** An admin operation the content registers: `get_nicknames` called by a content handler. */
function get_nicknames_operation(core: Core): Omit<AdminOperation, 'input'> & { readonly input: Readonly<Record<string, unknown>> } {
  return {
    name: 'game_get_nicknames',
    role: 'read',
    body: 'json',
    max_body_bytes: null,
    input: {
      user_id: { type: { kind: 'int64' }, optional: false },
      targets: { type: { kind: 'array', element: { kind: 'int64' } }, optional: false },
    },
    user_target: 'user_id',
    handler: (input, transaction) => ({ users: core.nickname.get_nicknames(transaction as RequestCtx, input.targets as bigint[]) }),
    prepare: null,
    audit_args: null,
  };
}

/** The content `register` of these tests: the defaults every server core test registers, a `validate_item_change` hook and a content admin operation. */
export function content_register(content: ContentState, keep: (core: Core) => void): (core: Readonly<Record<string, unknown>>) => void {
  return (registered) => {
    const core = registered as unknown as Core;
    keep(core);
    core_test_register(registered);
    core.routing.register_hook('item-ledger', 'validate_item_change', (_ctx: RequestCtx, source: { source: number }) =>
      source.source === CoreContract.ItemChangeSource.ITEM_CHANGE_SOURCE_NICKNAME && content.reject_nickname_cost !== 0 ? content.reject_nickname_cost : 'pass',
    );
    core.routing.register_admin_operation(get_nicknames_operation(core));
  };
}

/** A test server with `nicknameUnique`, more settings overrides, an optional server build data folder and DB kind. */
export async function start(unique: boolean, settings: Record<string, unknown> = {}, data_folder?: string, db?: DbKind): Promise<Harness> {
  const content: ContentState = { reject_nickname_cost: 0 };
  const kept: { core: Core | null } = { core: null };
  const register = content_register(content, (c) => {
    kept.core = c;
  });
  const server = await start_test_server(undefined, db, undefined, undefined, undefined, { nicknameUnique: unique, ...settings }, register, undefined, undefined, data_folder);
  const core = (): Core => {
    if (kept.core === null) throw new Error('register was not called');
    return { ...kept.core, storage: storage_module(server) };
  };
  return { server, content, core, nickname: () => core().nickname };
}

export interface SetResult {
  /** `ServerError.code`, 0 on success. */
  readonly code: number;
  readonly nickname: string | null;
  readonly envelope: CoreContract.ResponseEnvelope;
}

export async function set_nickname(session: TestSession, nickname: string): Promise<SetResult> {
  const request = new CoreContract.SetNicknameRequest();
  request.nickname = nickname;
  const { envelope, response } = await send(session, 'core/SetNickname', request);
  return { code: envelope.error?.code ?? 0, nickname: response instanceof CoreContract.SetNicknameResponse ? response.nickname : null, envelope };
}

export async function withdraw(session: TestSession): Promise<number> {
  const { envelope } = await send(session, 'core/Withdraw', new CoreContract.WithdrawRequest());
  return envelope.error?.code ?? 0;
}

/** The committed `NicknameUserState` of a user, or null. */
export async function nickname_state(server: TestServer, user_id: bigint): Promise<CoreContract.NicknameUserState | null> {
  const item = (await read_user_state(server, user_id)).find((i) => i.kind === 'NicknameUserState');
  return item === undefined ? null : (item.value as CoreContract.NicknameUserState);
}

/** The ID value of an ID name of the core test data. */
export function id_value(id_name: string): number {
  return load_data().dev.find_id_value(id_name);
}

/** The item the core test data `nickname_cost` rows take. */
export const COST_ITEM = '[nickname_gem]';

export async function set_gems(server: TestServer, user_id: bigint, balance: bigint): Promise<void> {
  await call_dev(server, 'item-ledger', 'set_balance', [id_value(COST_ITEM), balance], user_id);
}

export async function gems(server: TestServer, user_id: bigint): Promise<bigint> {
  const id = BigInt(id_value(COST_ITEM));
  const item = (await read_user_state(server, user_id)).find((i) => i.kind === 'ItemBalanceUserState' && i.item_id === id);
  return item === undefined ? 0n : (item.value as CoreContract.ItemBalanceUserState).amount;
}

/** Runs `fn` in an out-of-request change of `user_id` and returns its result. */
export async function in_user_transaction<T>(core: Core, user_id: bigint, fn: (ctx: RequestCtx) => T): Promise<T> {
  const result: { value?: T } = {};
  const outcome = await core.storage.run_user_transaction(user_id, (ctx) => {
    result.value = fn(ctx);
    return 'pass';
  });
  if (outcome !== 'COMMITTED' || !('value' in result)) throw new Error(`user transaction ended with ${outcome}`);
  return result.value as T;
}

/** A logged-in test session for each name, in the order of the names. */
export async function users<const N extends readonly string[]>(server: TestServer | RemoteServer, names: N): Promise<{ readonly [K in keyof N]: TestSession }> {
  const sessions: TestSession[] = [];
  for (const name of names) sessions.push(await login(server, name));
  return sessions as unknown as { readonly [K in keyof N]: TestSession };
}

export const CoreError = CoreContract.CoreError;
export const GameError = GameContract.GameError;

function varint(value: number | bigint): number[] {
  let v = BigInt(value);
  const out: number[] = [];
  do {
    let byte = Number(v & 0x7fn);
    v >>= 7n;
    if (v !== 0n) byte |= 0x80;
    out.push(byte);
  } while (v !== 0n);
  return out;
}

/** The ID value of the `nickname_cost` row `cost_data_folder` adds. */
const ADDED_COST_ROW_ID = 990_001;

/**
 * A server build data folder: a copy of the core test data with one more `nickname_cost` row that costs `amount` of
 * `COST_ITEM` for `change_number`. The caller removes the folder.
 */
export function cost_data_folder(change_number: number, amount: bigint): string {
  const folder = mkdtempSync(join(tmpdir(), 'nickname-data-'));
  cpSync(run_paths.data_folder, folder, { recursive: true });
  const cost = new CoreContract.ItemAmount();
  cost.item_id = id_value(COST_ITEM);
  cost.amount = amount;
  const item = cost.encode();
  const row = [0x08, ...varint(ADDED_COST_ROW_ID), 0x10, ...varint(change_number), 0x1a, ...varint(item.length), ...item];
  appendFileSync(join(folder, 'nickname_cost.bin'), Uint8Array.from([0x0a, ...varint(row.length), ...row]));
  return folder;
}
