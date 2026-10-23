import { existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { setTimeout as real_wait } from 'node:timers/promises';
import { DatabaseSync } from 'node:sqlite';
import * as CoreContract from '../../../generated/contract/core_contract.ts';
import { open_pg_session } from '../../storage/dev/index.ts';
import { call_dev, load_data, read_user_state, send, type SendResult, type TestServer, type TestSession } from '../dev/index.ts';
import { base_settings, core_test_register } from '../dev/runner_input.ts';

export { real_wait };

/** The listening TCP servers of this process: a port a test server left open is one of them. */
export function listening_servers(): number {
  return process.getActiveResourcesInfo().filter((resource) => resource === 'TCPServerWrap').length;
}

/**
 * The listening TCP servers of this process once they are at most `max`, or after 2 s of real time. A server instance
 * stop closes its HTTP server without waiting for the close, so the count drops a moment later.
 */
export async function settled_listening(max: number): Promise<number> {
  for (let waited = 0; listening_servers() > max && waited < 2_000; waited += 20) await real_wait(20);
  return listening_servers();
}

/** Names of `now` that `before` does not have: what an operation left, whatever earlier test servers removed meanwhile. */
export function added(before: readonly string[], now: readonly string[]): string[] {
  return now.filter((name) => !before.includes(name));
}

/** The temporary folders of the test servers of this process. */
export function server_folders(): string[] {
  const prefix = `ogw-test-server-${String(process.pid)}-`;
  return readdirSync(tmpdir()).filter((name) => name.startsWith(prefix)).sort();
}

/** Drops a PostgreSQL database of `OGW_POSTGRESQL` that a test left on purpose. */
export { drop_database } from '../dev/database.ts';

/** A server instance method `stop` that stops the instance, then rejects. */
export function failing_stop(stop: () => Promise<void>): () => Promise<void> {
  return async () => {
    await stop();
    throw new Error('stop fails on purpose');
  };
}

/** Makes `stop()` of the running server instance of a test server stop it, then reject. */
export function fail_next_stop(server: TestServer): void {
  const instance = server.running().instance;
  instance.stop = failing_stop(instance.stop.bind(instance));
}

/** True when one of the server modules is not in this core (its module folder has no entry file). */
export function missing(...modules: string[]): boolean {
  return modules.some((m) => !existsSync(new URL(`../../${m}/index.ts`, import.meta.url)) && !existsSync(new URL(`../../${m}/dev/index.ts`, import.meta.url)));
}

/** The item of the core test data that the testing core tests set balances of. */
export function gold_id(): number {
  return load_data().dev.find_id_value('[testing_gold]');
}

/** The error code of a response; 0 for a success. */
export function error_code(result: SendResult): number {
  return result.envelope.error?.code ?? 0;
}

export const UNAUTHORIZED = CoreContract.CoreError.CORE_ERROR_UNAUTHORIZED;
export const RATE_LIMITED = CoreContract.CoreError.CORE_ERROR_RATE_LIMITED;

/** A request that changes nothing: `Resync`. Its `server_time_at` is the request time. */
export function resync(session: TestSession, request_id?: string, seed?: bigint): Promise<SendResult> {
  return send(session, 'core/Resync', new CoreContract.ResyncRequest(), request_id, undefined, seed);
}

/** Sets the `[testing_gold]` balance of a user with `item-ledger.set_balance` through `call_dev`. */
export function set_gold(server: TestServer, user_id: bigint, amount: bigint): Promise<unknown> {
  return call_dev(server, 'item-ledger', 'set_balance', [gold_id(), amount], user_id);
}

/** The committed `[testing_gold]` balance of a user, or null when the user has no balance item. */
export async function gold_of(server: TestServer, user_id: bigint): Promise<bigint | null> {
  const id = BigInt(gold_id());
  const item = (await read_user_state(server, user_id)).find((i) => i.kind === 'ItemBalanceUserState' && i.item_id === id);
  return item === undefined ? null : (item.value as CoreContract.ItemBalanceUserState).amount;
}

/**
 * A content admin operation (`routing.register_admin_operation`, the admin operation form of `admin-api`). Its
 * handler gets the input and the transaction: the out-of-request ctx of the target user when `user_target` is set,
 * a game tx otherwise.
 */
export interface ContentAdminOperation {
  readonly name: string;
  readonly role: 'read' | 'ops' | 'economy' | 'release';
  readonly body: 'json';
  readonly max_body_bytes: null;
  readonly input: Readonly<Record<string, { readonly type: { readonly kind: 'int64' | 'int32' | 'string' }; readonly optional: boolean }>>;
  readonly user_target: string | null;
  readonly handler: (input: Readonly<Record<string, unknown>>, transaction: unknown) => Record<string, unknown> | string;
  readonly prepare: null;
  readonly audit_args: null;
}

/** The parts of the `core` object of `register` a server core test uses. */
interface RegisterCore {
  readonly routing: { register_admin_operation(operation: ContentAdminOperation): void };
}

/** A `register` that registers content admin operations, and what the default game-less `register` registers. */
export function register_operations(...operations: ContentAdminOperation[]): (core: Readonly<Record<string, unknown>>) => void {
  return (core) => {
    for (const operation of operations) (core as unknown as RegisterCore).routing.register_admin_operation(operation);
    core_test_register(core);
  };
}

/** A content admin operation `game_<name>` of role `read` that answers `{ "from": from }`. */
export function probe(name: string, from: string): ContentAdminOperation {
  return { name: `game_${name}`, role: 'read', body: 'json', max_body_bytes: null, input: {}, user_target: null, handler: () => ({ from }), prepare: null, audit_args: null };
}

/** The number of `routing_rate_counter` rows in the test server's DB (the expiring rows job `storage_sweep` removes). */
export async function rate_counter_rows(server: TestServer): Promise<number> {
  const database = server.shared.database;
  const sql = 'SELECT COUNT(*) AS n FROM routing_rate_counter';
  if (database.connection === null) {
    const db = new DatabaseSync(database.db_argument, { readOnly: true });
    try {
      const row = db.prepare(sql).get() as { n: number };
      return row.n;
    } finally {
      db.close();
    }
  }
  const conn = await open_pg_session(database.connection);
  try {
    const rows = await conn.query(sql);
    return Number(rows[0]?.n ?? 0);
  } finally {
    conn.close();
  }
}

/** The `seed` field of the `request` log line of each request ID. */
export function seeds_by_request(lines: readonly Record<string, unknown>[]): Map<string, unknown> {
  return new Map(lines.filter((l) => l.kind === 'request').map((l) => [String(l.request_id), l.seed]));
}

/**
 * A fake adapter controller (`testing` `fake`): the next result of an adapter operation, a failure condition of
 * it, and the record of the calls it got.
 */
export interface FakeControl {
  set_result(operation: string, result: unknown): void;
  set_failure(operation: string, failure: 'timeout' | 'communication_failure' | 'rejected' | null): void;
  calls(): readonly { readonly operation: string; readonly input: unknown }[];
}

/** The current terms agreements of the game settings `termsDocuments`. */
export function agreements(): CoreContract.TermsAgreement[] {
  const documents = base_settings().termsDocuments as Record<string, { version: number }>;
  const items: [string, CoreContract.TermsItem][] = [['TERMS', CoreContract.TermsItem.TERMS_ITEM_TERMS], ['PRIVACY', CoreContract.TermsItem.TERMS_ITEM_PRIVACY]];
  return items.map(([key, item]) => {
    const agreement = new CoreContract.TermsAgreement();
    agreement.item = item;
    agreement.version = documents[key]?.version ?? 0;
    return agreement;
  });
}

/** A social `Login` request through any session of the server (`Login` takes no access token). */
export function social_login(via: TestSession, provider: CoreContract.LoginProvider, credential: string): Promise<SendResult> {
  const message = new CoreContract.LoginRequest();
  message.provider = provider;
  message.credential = credential;
  message.agreements = agreements();
  return send(via, 'core/Login', message);
}
