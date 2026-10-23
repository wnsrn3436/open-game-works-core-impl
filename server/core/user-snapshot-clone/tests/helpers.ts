import * as CoreContract from '../../../generated/contract/core_contract.ts';
import * as CoreCheatContract from '../../../dev/generated/contract/core_cheat_contract.ts';
import type { ServerTime } from '../../server-time/index.ts';
import type { RawRow, RequestCtx, Storage } from '../../storage/index.ts';
import { core_test_register, load_data, login, send, send_admin, send_cheat, start_test_server, type TestServer, type TestSession } from '../../testing/dev/index.ts';
import type { UserSnapshotClone } from '../index.ts';
import { canonical_json } from '../../storage/canonical_json.ts';
import { storage_module } from '../../storage/tests/helpers.ts';
import { records_sha256, type GameStateSnapshot, type SnapshotRecord, type UserSnapshot } from '../snapshot.ts';

export const START_AT = 1_800_000_000_000n;
// Shorter than the default retention of other modules' expiring rows, so a sweep does not expire them.
export const RETENTION_MS = 3_600_000n;
// Every test clock move starts a due sweep, so a test can check the sweep at exactly `expires_at`.
export const SWEEP_MS = 1n;

/** Settings every test server of these tests gets: a short clone retention and sweep interval. */
export const SETTINGS: Readonly<Record<string, unknown>> = {
  'user-snapshot-clone.cloneRetentionMs': Number(RETENTION_MS),
  'user-snapshot-clone.sweepIntervalMs': Number(SWEEP_MS),
};

/** The tables a user snapshot replaces besides the snapshot tables. */
export const STATE_TABLES: ReadonlySet<string> = new Set(['user_state', 'server_state', 'pending_delta']);
/** The tables an import or a clone wipe changes besides the included rows. */
export const CLONE_TABLES: ReadonlySet<string> = new Set(['user', 'user_snapshot_clone_record', 'session_current']);

export type Server = TestServer;
export type Session = TestSession;
export type Json = Readonly<Record<string, unknown>>;

/** The `item-ledger` operation the tests read balances with. */
interface ItemLedger {
  get_balance(ctx: RequestCtx, item_id: number): bigint;
}

/**
 * The module objects the tests use, from the `core` object a content `register` receives, except `storage`: the
 * `storage` module object of the running server instance, whose database access content does not get.
 */
export interface Core {
  readonly storage: Storage;
  readonly 'server-time': ServerTime;
  readonly validation: unknown;
  readonly session: unknown;
  readonly logging: unknown;
  readonly 'item-ledger': ItemLedger;
  readonly 'user-snapshot-clone': UserSnapshotClone;
}


/** The output of `import_user_snapshot` and `import_game_state`. */
export interface ImportOutput {
  readonly replaced_records: number;
  readonly data_version_matches: boolean;
  readonly data_version: string;
}

/** A clone record of `list_clones`: `int64` values are decimal strings. */
export interface CloneJson {
  readonly target_user_id: string;
  readonly source_environment: string;
  readonly source_user_id: string;
  readonly cloned_at: string;
  readonly expires_at: string;
}

export interface AdminReply {
  readonly status: number;
  readonly json: unknown;
}

/**
 * A test server and the `core` object its content `register` received (module objects by module name) with the
 * `storage` module object. The `register` does what the default core test `register` does, so the server starts with
 * its judge hooks.
 */
export async function startServer(overrides: Readonly<Record<string, unknown>> = {}, environment?: 'LOCAL' | 'STG'): Promise<{ server: Server; core: Core }> {
  const received: { core: Readonly<Record<string, unknown>> | null } = { core: null };
  const start_at = environment === 'STG' ? undefined : START_AT;
  const server = await start_test_server(start_at, undefined, environment, undefined, undefined, { ...SETTINGS, ...overrides }, (c) => {
    core_test_register(c);
    received.core = c;
  });
  if (received.core === null) throw new Error('register was not called');
  return { server, core: { ...(received.core as unknown as Core), storage: storage_module(server) } };
}

export async function admin(server: Server, operation: string, body: unknown): Promise<AdminReply> {
  const reply = await send_admin(server, operation, body);
  return { status: reply.status, json: reply.json };
}

export function encodeJson(value: unknown): Uint8Array {
  return new TextEncoder().encode(typeof value === 'string' ? value : JSON.stringify(value));
}

export async function importSnapshot(server: Server, target: bigint, snapshot: unknown): Promise<AdminReply> {
  const body = snapshot instanceof Uint8Array ? snapshot : encodeJson(snapshot);
  const reply = await send_admin(server, 'import_user_snapshot', { binary: body, query: { target_user_id: String(target) } });
  return { status: reply.status, json: reply.json };
}

export async function importGameState(server: Server, snapshot: unknown, target_key?: bigint): Promise<AdminReply> {
  const body = snapshot instanceof Uint8Array ? snapshot : encodeJson(snapshot);
  const reply = await send_admin(server, 'import_game_state', { binary: body, query: target_key === undefined ? {} : { target_key: String(target_key) } });
  return { status: reply.status, json: reply.json };
}

/** The output of a successful import. */
export function imported(reply: AdminReply): ImportOutput {
  if (reply.status !== 200) throw new Error(`import: ${String(reply.status)} ${JSON.stringify(reply.json)}`);
  return reply.json as ImportOutput;
}

export async function exportSnapshot(server: Server, user_id: bigint): Promise<UserSnapshot> {
  const reply = await admin(server, 'export_user_snapshot', { user_id: String(user_id) });
  if (reply.status !== 200) throw new Error(`export_user_snapshot of ${String(user_id)}: ${String(reply.status)} ${JSON.stringify(reply.json)}`);
  return reply.json as UserSnapshot;
}

export async function exportGameState(server: Server, kind: string, keys: readonly bigint[]): Promise<GameStateSnapshot> {
  const reply = await admin(server, 'export_game_state', { kind, keys: keys.map(String) });
  if (reply.status !== 200) throw new Error(`export_game_state: ${String(reply.status)} ${JSON.stringify(reply.json)}`);
  return reply.json as GameStateSnapshot;
}

export async function listClones(server: Server): Promise<CloneJson[]> {
  const reply = await admin(server, 'list_clones', {});
  if (reply.status !== 200) throw new Error(`list_clones: ${String(reply.status)}`);
  return (reply.json as { clones: CloneJson[] }).clones;
}

/** A copy of a snapshot with `records` replaced and `sha256` made for them. */
export function withRecords<T extends GameStateSnapshot>(snapshot: T, records: readonly SnapshotRecord[]): T {
  return { ...snapshot, records, sha256: records_sha256(records) };
}

/** A copy of a snapshot with fields changed, keeping `sha256`. */
export function withFields(snapshot: GameStateSnapshot, fields: Json): Json {
  return { ...snapshot, ...fields };
}

let accounts = 0;
const account_names = new Map<bigint, string>();

/** A new user logged in with a new dev account. */
export async function newUser(server: Server, prefix = 'clone'): Promise<Session> {
  accounts += 1;
  const name = `${prefix}_${String(accounts)}`;
  const session = await login(server, name);
  account_names.set(session.user_id, name);
  return session;
}

/** The dev account name of a user `newUser` made. */
export function accountName(user_id: bigint): string {
  const name = account_names.get(user_id);
  if (name === undefined) throw new Error(`no dev account for ${String(user_id)}`);
  return name;
}

/** A new login of a user `newUser` made: a new session. */
export function loginAgain(server: Server, user_id: bigint): Promise<Session> {
  return login(server, accountName(user_id));
}

/** Data rows the tests use, found in the server build data by what the test needs. */
export function testItems(): { plain: number; recovery: number; template: number } {
  const { data } = load_data();
  const special = new Set<number>([
    ...data.ItemRecoveryTable.all_rows().map((r) => r.id),
    ...data.ItemTimedTable.all_rows().map((r) => r.id),
    ...data.ItemBigTable.all_rows().map((r) => r.id),
    ...data.ItemGroupTable.all_rows().map((r) => r.id),
  ]);
  const plain = data.ItemTable.all_rows().find((r) => !special.has(r.id) && r.max_amount >= 1000n);
  const recovery = data.ItemRecoveryTable.all_rows().find((r) => r.initial_amount < r.recovery_cap);
  const template = data.MailTemplateTable.all_rows()[0];
  if (plain === undefined || recovery === undefined || template === undefined) throw new Error('the core test data has no plain item, recovery item or mail template');
  return { plain: plain.id, recovery: recovery.id, template: template.id };
}

let operations = 0;

export async function grant(server: Server, user_id: bigint, item_id: number, amount: bigint): Promise<void> {
  operations += 1;
  const reply = await admin(server, 'grant_items', { operation_id: `clone-test-${String(operations)}`, user_id: String(user_id), items: [{ item_id, amount: String(amount) }] });
  if (reply.status !== 200) throw new Error(`grant_items: ${String(reply.status)} ${JSON.stringify(reply.json)}`);
}

/** Sends a mail with one attachment and returns its mail ID. */
export async function mail(server: Server, user_id: bigint, template_id: number, item_id: number, amount: bigint): Promise<bigint> {
  operations += 1;
  const reply = await admin(server, 'send_mail', {
    operation_id: `clone-test-${String(operations)}`,
    user_id: String(user_id),
    mail: { template_id, attachments: [{ item_id, amount: String(amount) }] },
  });
  if (reply.status !== 200) throw new Error(`send_mail: ${String(reply.status)} ${JSON.stringify(reply.json)}`);
  return BigInt((reply.json as { mail_id: string }).mail_id);
}

export async function claimMail(session: Session, mail_id: bigint): Promise<{ envelope: CoreContract.ResponseEnvelope; response: CoreContract.ClaimMailResponse | null }> {
  const request = new CoreContract.ClaimMailRequest();
  request.mail_id = mail_id;
  const { envelope, response } = await send(session, 'core/ClaimMail', request);
  return { envelope, response: response as CoreContract.ClaimMailResponse | null };
}

/** `Resync` with `full`: the envelope's error, null on success. */
export async function resync(session: Session): Promise<CoreContract.ServerError | null> {
  const request = new CoreContract.ResyncRequest();
  request.full = true;
  return (await send(session, 'core/Resync', request)).envelope.error;
}

export async function withdraw(session: Session): Promise<void> {
  const { envelope } = await send(session, 'core/Withdraw', new CoreContract.WithdrawRequest());
  if (envelope.error !== null) throw new Error('Withdraw failed');
}

/** `DevLogin` again with an account name: the `AuthResult`. */
export async function devLogin(session: Session, account_name: string): Promise<CoreContract.AuthResult> {
  const request = new CoreCheatContract.DevLoginRequest();
  request.account_name = account_name;
  const response = (await send_cheat(session, 'core/cheat/DevLogin', request)).response as CoreCheatContract.DevLoginResponse | null;
  if (response?.result == null) throw new Error('DevLogin failed');
  return response.result;
}

export function kindInfo(name: string): CoreContract.KindInfo {
  const info = CoreContract.KINDS.find((k) => k.name === name);
  if (info === undefined) throw new Error(`no kind ${name}`);
  return info;
}

/** Writes a `user_state` row as stored bytes and a contract version, for rows a request cannot write. */
export async function putRawUserState(core: Core, user_id: bigint, kind: CoreContract.KindInfo, item_id: bigint, value: Uint8Array, version: bigint): Promise<void> {
  const result = await core.storage.run_user_transaction(user_id, (ctx) => {
    core.storage
      .db(ctx)
      .query(
        `INSERT INTO ${kind.store} (user_id, kind, item_id, value, contract_version, updated_at) VALUES ($1, $2, $3, $4, $5, $6) ` +
          'ON CONFLICT (user_id, kind, item_id) DO UPDATE SET value = excluded.value, contract_version = excluded.contract_version',
        [user_id, kind.column, item_id, value, version, 0n],
      );
    return 'pass';
  });
  if (result !== 'COMMITTED') throw new Error(`putRawUserState: ${result}`);
}

/** The names of every table of the server's database. */
export function tableNames(core: Core): string[] {
  const db = core.storage.read_db();
  let rows;
  try {
    rows = db.query("SELECT name AS name FROM sqlite_master WHERE type = 'table'");
  } catch {
    rows = db.query("SELECT table_name AS name FROM information_schema.tables WHERE table_schema = current_schema() AND table_type = 'BASE TABLE'");
  }
  return rows.map((r) => String(r['name'])).sort();
}

function cell(value: unknown): unknown {
  if (typeof value === 'bigint') return `${String(value)}n`;
  if (value instanceof Uint8Array) return `b64:${Buffer.from(value).toString('base64')}`;
  return value;
}

/** Every committed row of every table, as canonical text per table, rows sorted. */
export function dumpDb(core: Core): Map<string, string[]> {
  const db = core.storage.read_db();
  const out = new Map<string, string[]>();
  for (const table of tableNames(core)) {
    const rows = db.query(`SELECT * FROM "${table}"`);
    out.set(table, rows.map((row) => canonical_json(Object.fromEntries(Object.entries(row).map(([k, v]) => [k, cell(v)])))).sort());
  }
  return out;
}

/** The text of `dumpDb` rows that hold this user ID as a column value. */
export function userMark(user_id: bigint): string {
  return `"${String(user_id)}n"`;
}

/** The dump without the given tables. */
export function without(dump: Map<string, string[]>, tables: ReadonlySet<string>): Map<string, string[]> {
  return new Map([...dump].filter(([table]) => !tables.has(table)));
}

/** The raw rows `read_user_rows` returns for a user, read in a transaction that is rolled back. */
export async function userRows(core: Core, user_id: bigint): Promise<RawRow[]> {
  const rows = await core.storage.run_rollback_transaction(user_id, (ctx) => core.storage.read_user_rows(ctx));
  if (typeof rows === 'string') throw new Error(`read_user_rows: ${rows}`);
  return rows;
}

export function userRecord(core: Core, user_id: bigint): { created_at: bigint; withdrawn_at: bigint | null } {
  const record = core.storage.get_user_record(core.storage.read_db(), user_id);
  if (record === null) throw new Error(`no user ${String(user_id)}`);
  return record;
}

/** A user's balance of an item at the current clock time, read in a transaction that is rolled back. */
export async function balance(core: Core, user_id: bigint, item_id: number): Promise<bigint> {
  const amount = await core.storage.run_rollback_transaction(user_id, (ctx) => core['item-ledger'].get_balance(ctx, item_id));
  if (typeof amount === 'string') throw new Error(`get_balance: ${amount}`);
  return amount;
}

/** Committed clone records. */
export function cloneRecords(core: Core): Json[] {
  return core.storage.read_db().query('SELECT * FROM user_snapshot_clone_record ORDER BY target_user_id');
}

/** Committed `session_current` rows of a user. */
export function sessionRows(core: Core, user_id: bigint): Json[] {
  return core.storage.read_db().query('SELECT user_id FROM session_current WHERE user_id = $1', [user_id]);
}

/** A user with included rows of several kinds and excluded rows: login, an item grant, a mail, a lower-version row. */
export async function richUser(server: Server, core: Core, prefix = 'source'): Promise<Session> {
  const session = await newUser(server, prefix);
  const items = testItems();
  await grant(server, session.user_id, items.plain, 500n);
  await mail(server, session.user_id, items.template, items.plain, 7n);
  await resync(session);
  // A lower-version row last: a request would upgrade it.
  await putRawUserState(core, session.user_id, kindInfo('ConsentUserState'), 0n, new CoreContract.ConsentUserState().encode(), 0n);
  return session;
}

/** The record list of user rows as a snapshot writes them. */
export function recordsOf(rows: readonly RawRow[]): SnapshotRecord[] {
  return rows.map((r) => ({ table: r.table, key: r.key, contract_version: Number(r.contract_version), value: Buffer.from(r.value).toString('base64') }));
}

/** How many times `fn` calls `JSON.parse` on `text`. */
export async function jsonParses(text: string, fn: () => Promise<void>): Promise<number> {
  const original = JSON.parse;
  let count = 0;
  JSON.parse = ((value: string, reviver?: Parameters<typeof JSON.parse>[1]): unknown => {
    if (value === text) count += 1;
    return original(value, reviver);
  }) as typeof JSON.parse;
  try {
    await fn();
  } finally {
    JSON.parse = original;
  }
  return count;
}

/** The tables an import or clone wipe of these snapshots may change. */
export function changeable(...snapshots: readonly GameStateSnapshot[]): Set<string> {
  const tables = new Set([...STATE_TABLES, ...CLONE_TABLES]);
  for (const snapshot of snapshots) for (const record of snapshot.records) tables.add(record.table);
  return tables;
}
