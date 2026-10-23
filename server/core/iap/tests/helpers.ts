/**
 * iap core test helpers on `testing` test servers: products and items of the core test data, fake receipts, requests,
 * and reads of UserState, payment records and logs.
 */
import { cpSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as CoreCheatContract from '../../../dev/generated/contract/core_cheat_contract.ts';
import * as CoreContract from '../../../generated/contract/core_contract.ts';
import * as GameContract from '../../../generated/contract/game_contract.ts';
import * as GameData from '../../../generated/data/game_data.ts';
import * as testing from '../../testing/dev/index.ts';
import { is_failure, type StoreAdapter } from '../adapter.ts';
import type { FakeIapController } from '../dev/adapters/fake.ts';

export const APPLE = CoreContract.IapStore.IAP_STORE_APPLE;
export const GOOGLE = CoreContract.IapStore.IAP_STORE_GOOGLE;
export const Status = CoreContract.PurchaseStatus;
export const CoreError = CoreContract.CoreError;
export const State = CoreContract.SubscriptionState;

/** 2026-03-02T00:00:00Z, a Monday and the first day of a game month window in March. */
export const START = 1_772_409_600_000n;
export const DAY = 86_400_000n;
/** `iap.withdrawnRecordRetentionMs`. */
export const RETENTION_MS = 157_680_000_000n;

export type TestServer = Awaited<ReturnType<typeof testing.start_test_server>>;
export type Session = Awaited<ReturnType<typeof testing.login>>;
export type Sent<T> = { envelope: CoreContract.ResponseEnvelope; response: T | null };

const loaded = testing.load_data();
export const data: GameData.DataSet = loaded.data;
export const id = (name: string): number => loaded.dev.find_id_value(name);
export const product = (name: string): GameData.IapProductRow => data.IapProductTable.get_row(id(name));
export const GEM = (): number => id('[item_iap_gem]');
export const CAPPED = (): number => id('[item_iap_capped]');

/** Game settings path of the `login-google` adapter, set to `fake` on servers whose tests need social account links. */
export const SOCIAL = { 'environments.<ENV>.adapters.login-google': 'fake' } as const;

export interface StartOptions {
  readonly start_at?: bigint;
  readonly settings?: Readonly<Record<string, unknown>>;
  /** The test's own `register`; by default `register_hooks({})`. */
  readonly register?: (core: Record<string, unknown>) => void;
  readonly data_folder?: string;
}

const servers: TestServer[] = [];

afterEach(async () => {
  for (const server of servers.splice(0)) await testing.stop_test_server(server);
});

/** An access token lifetime that outlasts the clock moves of the tests (10 years). */
const ACCESS_TOKEN_TTL_MS = 315_360_000_000;

/**
 * A LOCAL test server of the run's DB kind with the fake `iap-apple` and `iap-google` adapters of the core test data.
 * Its access tokens outlast the clock moves of the tests.
 */
export async function start(options: StartOptions = {}): Promise<TestServer> {
  const server = await testing.start_test_server(
    options.start_at ?? START,
    undefined,
    undefined,
    undefined,
    undefined,
    { 'auth.accessTokenTtlMs': ACCESS_TOKEN_TTL_MS, ...options.settings },
    options.register ?? register_hooks({}),
    undefined,
    undefined,
    options.data_folder,
  );
  servers.push(server);
  return server;
}

/** A fake receipt `fake:<SKU>:<transaction ID>:<account token>[:<original transaction ID>]`. */
export function receipt(sku: string, transaction_id: string, account_token: string, original_transaction_id?: string): string {
  return `fake:${sku}:${transaction_id}:${account_token}${original_transaction_id === undefined ? '' : `:${original_transaction_id}`}`;
}

export function code_of(sent: Sent<unknown>): number | null {
  return sent.envelope.error?.code ?? null;
}

export async function check_purchase(session: Session, store: CoreContract.IapStore, product_name: string): Promise<Sent<CoreContract.CheckPurchaseResponse>> {
  const request = new CoreContract.CheckPurchaseRequest();
  request.store = store;
  request.product_id = id(product_name);
  return (await testing.send(session, 'core/CheckPurchase', request)) as Sent<CoreContract.CheckPurchaseResponse>;
}

/** The session user's account token (`CheckPurchase` of `[iap_gems]` on `APPLE`). */
export async function account_token(session: Session): Promise<string> {
  const sent = await check_purchase(session, APPLE, '[iap_gems]');
  if (sent.response === null) throw new Error(`CheckPurchase failed: ${String(code_of(sent))}`);
  return sent.response.account_token;
}

export async function verify(session: Session, store: CoreContract.IapStore, data_text: string, request_id?: string): Promise<Sent<CoreContract.VerifyPurchaseResponse>> {
  const request = new CoreContract.VerifyPurchaseRequest();
  request.store = store;
  request.receipt = data_text;
  return (await testing.send(session, 'core/VerifyPurchase', request, request_id)) as Sent<CoreContract.VerifyPurchaseResponse>;
}

export async function recover(session: Session, store: CoreContract.IapStore, data_text: string): Promise<Sent<CoreContract.RecoverPurchaseResponse>> {
  const request = new CoreContract.RecoverPurchaseRequest();
  request.store = store;
  request.receipt = data_text;
  return (await testing.send(session, 'core/RecoverPurchase', request)) as Sent<CoreContract.RecoverPurchaseResponse>;
}

/** The purchase status of a `VerifyPurchase` or `RecoverPurchase` result; throws on an error response. */
export function status_of(sent: Sent<{ status: CoreContract.PurchaseStatus }>): CoreContract.PurchaseStatus {
  if (sent.response === null) throw new Error(`error response ${String(code_of(sent))}`);
  return sent.response.status;
}

export async function claim_daily(session: Session, product_name: string): Promise<Sent<CoreContract.ClaimIapDailyResponse>> {
  const request = new CoreContract.ClaimIapDailyRequest();
  request.product_id = id(product_name);
  return (await testing.send(session, 'core/ClaimIapDaily', request)) as Sent<CoreContract.ClaimIapDailyResponse>;
}

export async function sync_subscriptions(session: Session): Promise<Sent<CoreContract.SyncSubscriptionsResponse>> {
  return (await testing.send(session, 'core/SyncSubscriptions', new CoreContract.SyncSubscriptionsRequest())) as Sent<CoreContract.SyncSubscriptionsResponse>;
}

async function state_of<T>(server: TestServer, user_id: bigint, kind: string, item_id: bigint): Promise<T | null> {
  const rows = await testing.read_user_state(server, user_id);
  const row = rows.find((r: { kind: string; item_id: bigint }) => r.kind === kind && r.item_id === item_id);
  return row === undefined ? null : (row.value as T);
}

export async function balance(server: TestServer, user_id: bigint, item_id: number = GEM()): Promise<bigint> {
  const row = await state_of<CoreContract.ItemBalanceUserState>(server, user_id, 'ItemBalanceUserState', BigInt(item_id));
  if (row === null) return 0n;
  return row.big_amount !== '' ? BigInt(row.big_amount) : row.amount;
}

export function purchase_row(server: TestServer, user_id: bigint, product_name: string): Promise<CoreContract.IapPurchaseUserState | null> {
  return state_of(server, user_id, 'IapPurchaseUserState', BigInt(id(product_name)));
}

export async function purchase_count_of(server: TestServer, user_id: bigint, product_name: string): Promise<number> {
  return (await purchase_row(server, user_id, product_name))?.count ?? 0;
}

export function subscription_row(server: TestServer, user_id: bigint, product_name: string): Promise<CoreContract.SubscriptionUserState | null> {
  return state_of(server, user_id, 'SubscriptionUserState', BigInt(id(product_name)));
}

export async function mails(server: TestServer, user_id: bigint): Promise<CoreContract.MailUserState[]> {
  const rows = await testing.read_user_state(server, user_id);
  return rows.filter((r: { kind: string }) => r.kind === 'MailUserState').map((r: { value: unknown }) => r.value as CoreContract.MailUserState);
}

/** A payment record as `list_payments` gives it in admin JSON (int64 as decimal strings). */
export interface PaymentJson {
  readonly store: string;
  readonly transaction_id: string;
  readonly original_transaction_id: string;
  readonly user_id: string;
  readonly product_id: number;
  readonly result: string;
  readonly test: boolean;
  readonly reset_at: string;
  readonly event_round: number;
  readonly transfer_count: number;
  readonly delete_at: string | null;
}

export interface OtherUserJson {
  readonly store: string;
  readonly transaction_id: string;
  readonly user_id: string;
  readonly owner_user_id: string;
  readonly product_id: number;
}

export async function list_payments(server: TestServer, user_id: bigint): Promise<{ payments: PaymentJson[]; other_user_attempts: OtherUserJson[] }> {
  const sent = await testing.send_admin(server, 'list_payments', { user_id: user_id.toString() });
  if (sent.status !== 200) throw new Error(`list_payments failed: ${String(sent.status)}`);
  return sent.json as { payments: PaymentJson[]; other_user_attempts: OtherUserJson[] };
}

export async function payment(server: TestServer, user_id: bigint, transaction_id: string): Promise<PaymentJson | undefined> {
  return (await list_payments(server, user_id)).payments.find((p) => p.transaction_id === transaction_id);
}

/** `revoke_test_grant` of an `APPLE` store transaction through `admin-api`. */
export function revoke_test_grant(server: TestServer, user_id: bigint, transaction_id: string, operation_id: string): ReturnType<typeof testing.send_admin> {
  return testing.send_admin(server, 'revoke_test_grant', { operation_id, user_id: user_id.toString(), store: 'APPLE', transaction_id });
}

/**
 * Makes the fake adapter of a store answer `verify` or `lookup_subscription` with no purchase time, as `iap-google`
 * answers a subscription in `SUBSCRIPTION_STATE_PENDING` (no `startTime`).
 */
export function without_purchase_time(server: TestServer, store: CoreContract.IapStore, operation: 'verify' | 'lookup_subscription'): void {
  const adapter = server.shared.fakes.get(store === APPLE ? 'iap-apple' : 'iap-google')?.adapter as StoreAdapter;
  if (operation === 'verify') {
    const store_verify = adapter.verify.bind(adapter);
    adapter.verify = async (text, call) => {
      const got = await store_verify(text, call);
      return is_failure(got) || got.transaction === null ? got : { ...got, transaction: { ...got.transaction, purchased_at: null } };
    };
    return;
  }
  const store_lookup = adapter.lookup_subscription.bind(adapter);
  adapter.lookup_subscription = async (original, latest, call) => {
    const got = await store_lookup(original, latest, call);
    return is_failure(got) ? got : { ...got, purchased_at: null };
  };
}

/** The `purchased_at` of the user's payment record of a transaction ID, as stored (`export_personal_data`). */
export async function stored_purchased_at(server: TestServer, user_id: bigint, transaction_id: string): Promise<{ result: unknown; purchased_at: unknown } | undefined> {
  const row = (await exported_rows(server, user_id, 'iap_payment')).find((r) => r['transaction_id'] === transaction_id);
  return row === undefined ? undefined : { result: row['result'], purchased_at: row['purchased_at'] };
}

/** DEV cheat `SetTimeOffset` of the session's user. */
export function set_time_offset(session: Session, offset_ms: bigint): ReturnType<typeof testing.send_cheat> {
  const request = new CoreCheatContract.SetTimeOffsetRequest();
  request.offset_ms = offset_ms;
  return testing.send_cheat(session, 'core/cheat/SetTimeOffset', request);
}

/** The fake adapter controller of a store (`testing.fake` service `iap-apple` or `iap-google`). */
export function fake_store(server: TestServer, store: CoreContract.IapStore = APPLE): FakeIapController {
  return testing.fake(server, store === APPLE ? 'iap-apple' : 'iap-google') as FakeIapController;
}

/** Links a social account (fake `login-google` credential) to the session's user. The server needs `SOCIAL`. */
export async function link_social(session: Session, account: string): Promise<void> {
  const request = new CoreContract.LinkAccountRequest();
  request.provider = CoreContract.LoginProvider.LOGIN_PROVIDER_GOOGLE;
  request.credential = `fake:${account}`;
  const sent = await testing.send(session, 'core/LinkAccount', request);
  if (sent.envelope.error !== null) throw new Error(`LinkAccount failed: ${String(sent.envelope.error.code)}`);
}

export async function withdraw(session: Session): Promise<void> {
  const sent = await testing.send(session, 'core/Withdraw', new CoreContract.WithdrawRequest());
  if (sent.envelope.error !== null) throw new Error(`Withdraw failed: ${String(sent.envelope.error.code)}`);
}

/** The params of the user's server analytics events of a name (`logging` admin `list_server_events`), in order. */
export async function core_events(server: TestServer, user_id: bigint, name: string): Promise<Record<string, bigint | number | string | boolean>[]> {
  const sent = await testing.send_admin(server, 'list_server_events', { user_id: user_id.toString(), name, from_at: (START - DAY).toString(), to_at: (START + 30n * DAY).toString(), limit: 100 });
  if (sent.status !== 200) throw new Error(`list_server_events failed: ${String(sent.status)}`);
  const entries = (sent.json as { entries: { params: string }[] }).entries;
  return entries.map((entry) => {
    const event = CoreContract.AnalyticsEvent.decode(Buffer.from(entry.params, 'base64'));
    const out: Record<string, bigint | number | string | boolean> = {};
    for (const param of event?.params ?? []) {
      const kind = param.kind;
      out[param.key] =
        kind === CoreContract.AnalyticsParamKind.ANALYTICS_PARAM_KIND_INT
          ? param.int_value
          : kind === CoreContract.AnalyticsParamKind.ANALYTICS_PARAM_KIND_DOUBLE
            ? param.double_value
            : kind === CoreContract.AnalyticsParamKind.ANALYTICS_PARAM_KIND_BOOL
              ? param.bool_value
              : param.string_value;
    }
    return out;
  });
}

/** The `once_key` of each item history row of the user (`admin-api` `list_item_history`), in order. */
export async function history_once_keys(server: TestServer, user_id: bigint): Promise<string[]> {
  const sent = await testing.send_admin(server, 'list_item_history', { user_id: user_id.toString(), from_at: (START - DAY).toString(), to_at: (START + 30n * DAY).toString(), after_seq: '0', limit: 100 });
  if (sent.status !== 200) throw new Error(`list_item_history failed: ${String(sent.status)}`);
  return (sent.json as { entries: { once_key: string }[] }).entries.map((entry) => entry.once_key);
}

interface Registration {
  readonly routing: {
    register_handler(name: string, handler: () => unknown): void;
    register_hook(module: string, hook: string, fn: unknown): void;
  };
  readonly 'item-ledger': { revoke_items(ctx: unknown, items: readonly CoreContract.ItemAmount[]): unknown };
}

/**
 * The hook `revoke_iap` that does what its default does: `item-ledger.revoke_items` of the revoke list, in the change
 * source iap opens around the hook. The core test data has an `extra_grant` row, so a server cannot start without it.
 */
export function default_like_revoke(core: Record<string, unknown>): (ctx: unknown, product_id: number, transaction_id: string, reason: string, items: readonly CoreContract.ItemAmount[]) => null {
  const ledger = (core as unknown as Registration)['item-ledger'];
  return (ctx, _product_id, _transaction_id, _reason, items) => {
    if (items.length > 0) ledger.revoke_items(ctx, items);
    return null;
  };
}

/**
 * A test `register`: a `RunCoreTest` handler for each `service Game` rpc, the false judge hooks, the hooks server start
 * requires except the given iap hooks, and the given iap hooks. `revoke_iap` defaults to `default_like_revoke`.
 * A hook given as `null` is left unregistered.
 */
export function register_hooks(hooks: Readonly<Record<string, unknown>>): (core: Record<string, unknown>) => void {
  return (core) => {
    const reg = core as unknown as Registration;
    for (const info of GameContract.RPCS) reg.routing.register_handler(info.name, () => new info.response_class());
    testing.register_false_judges(core);
    const given: Record<string, unknown> = { revoke_iap: default_like_revoke(core), ...hooks };
    testing.register_required_hooks(core, Object.keys(given).map((name) => `iap.${name}`));
    for (const [name, fn] of Object.entries(given)) if (fn !== null) reg.routing.register_hook('iap', name, fn);
  };
}

/** The user's rows of a table in `admin-api` `export_personal_data` (int64 as decimal strings). */
export async function exported_rows(server: TestServer, user_id: bigint, table: string): Promise<Record<string, unknown>[]> {
  const sent = await testing.send_admin(server, 'export_personal_data', { user_id: user_id.toString() });
  if (sent.status !== 200) throw new Error(`export_personal_data failed: ${String(sent.status)}`);
  return (sent.json as { tables: Record<string, Record<string, unknown>[]> }).tables[table] ?? [];
}

/** Sets the user's balance of an item (`item-ledger` DEV `set_balance`). */
export async function set_balance(server: TestServer, user_id: bigint, item_id: number, amount: bigint): Promise<void> {
  await testing.call_dev(server, 'item-ledger', 'set_balance', [item_id, amount], user_id);
}

/** Log lines of a kind whose `reason` field is the given one. */
export function logs_with_reason(server: TestServer, kind: string, reason: string): Promise<Record<string, unknown>[]> {
  return Promise.resolve(testing.read_logs(server, kind).filter((line: Record<string, unknown>) => line.reason === reason));
}

/** The `ItemChange`s of a response and of the out-of-request changes it carries. */
export function item_changes(sent: Sent<unknown>): CoreContract.ItemChange[] {
  return [...sent.envelope.item_changes];
}

/** True when the envelope's pending UserState delta has an entry of the kind. */
export function has_pending(sent: Sent<unknown>, kind: string): boolean {
  return (sent.envelope.pending_user_state?.entries ?? []).some((e) => e.kind === kind);
}

function read_varint(bytes: Uint8Array, at: number): [bigint, number] {
  let value = 0n;
  let shift = 0n;
  for (;;) {
    const byte = bytes[at] ?? 0;
    at += 1;
    value |= BigInt(byte & 0x7f) << shift;
    shift += 7n;
    if ((byte & 0x80) === 0) return [value, at];
  }
}

/** True when an encoded `IapProductRow` has `extra_grant` (field 7) true. */
function has_extra_grant(row: Uint8Array): boolean {
  let at = 0;
  while (at < row.length) {
    const [tag, after_tag] = read_varint(row, at);
    const field = Number(tag >> 3n);
    const wire = Number(tag & 7n);
    if (wire === 0) {
      const [value, next] = read_varint(row, after_tag);
      if (field === 7) return value !== 0n;
      at = next;
    } else if (wire === 2) {
      const [length, next] = read_varint(row, after_tag);
      at = next + Number(length);
    } else if (wire === 1) {
      at = after_tag + 8;
    } else {
      at = after_tag + 4;
    }
  }
  return false;
}

/**
 * A copy of the server build data folder without the `extra_grant` rows of `iap_product`, for the tests of the
 * default `revoke_iap` (a server with such a row does not start without the hook).
 */
export function data_folder_without_extra_grant(): string {
  const source = testing.core_test_server_paths().data_folder;
  const folder = join(mkdtempSync(join(tmpdir(), 'iap-data-')), 'data');
  cpSync(source, folder, { recursive: true });
  const file = join(folder, 'iap_product.bin');
  const bytes = new Uint8Array(readFileSync(file));
  const kept: Uint8Array[] = [];
  let at = 0;
  while (at < bytes.length) {
    const [, after_tag] = read_varint(bytes, at);
    const [length, start_at] = read_varint(bytes, after_tag);
    const end = start_at + Number(length);
    if (!has_extra_grant(bytes.subarray(start_at, end))) kept.push(bytes.subarray(at, end));
    at = end;
  }
  writeFileSync(file, Buffer.concat(kept));
  return folder;
}

/** A test server without the `extra_grant` rows and without hook `revoke_iap`, so that the default revoke runs. */
export function start_default_revoke(options: StartOptions = {}): Promise<TestServer> {
  return start({ ...options, data_folder: data_folder_without_extra_grant(), register: register_hooks({ revoke_iap: null, grant_iap_extra: null }) });
}

export function item(item_id: number, amount: bigint): CoreContract.ItemAmount {
  const out = new CoreContract.ItemAmount();
  out.item_id = item_id;
  out.amount = amount;
  return out;
}
