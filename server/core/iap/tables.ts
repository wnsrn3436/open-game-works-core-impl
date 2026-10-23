/**
 * The five iap tables (`### grant order`): payment record, binding of an original transaction ID to a user,
 * subscription record, account token mapping and `OTHER_USER` record. A row whose `delete_at` is at or before
 * `server-time.clock_now` counts as absent before `storage.sweep_expired` removes it.
 */
import type { DbHandle } from '../storage/index.ts';
import type { IapStorage } from './deps.ts';

export const PAYMENT = 'iap_payment';
export const BINDING = 'iap_binding';
export const SUBSCRIPTION = 'iap_subscription';
export const ACCOUNT_TOKEN = 'iap_account_token';
export const OTHER_USER = 'iap_other_user';
export const TABLES = [PAYMENT, BINDING, SUBSCRIPTION, ACCOUNT_TOKEN, OTHER_USER] as const;

export type PaymentResult = 'GRANTED' | 'INVALID' | 'REFUNDED';

/** A payment record. `store` is the `IapStore` element name. */
export interface PaymentRow {
  readonly store: string;
  readonly transaction_id: string;
  readonly original_transaction_id: string;
  readonly user_id: bigint;
  readonly sku: string;
  readonly product_id: number;
  readonly spend_amount: bigint;
  readonly purchased_at: bigint;
  readonly verified_at: bigint;
  readonly result: PaymentResult;
  readonly test: boolean;
  readonly reset_at: bigint;
  readonly event_round: number;
  readonly transfer_count: number;
  readonly delete_at: bigint | null;
}

export interface BindingRow {
  readonly store: string;
  readonly original_transaction_id: string;
  readonly user_id: bigint;
  readonly delete_at: bigint | null;
}

/** A subscription record. `state` is the `SubscriptionState` element name. */
export interface SubscriptionRow {
  readonly store: string;
  readonly original_transaction_id: string;
  readonly user_id: bigint;
  readonly product_id: number;
  readonly state: string;
  readonly ends_at: bigint;
  readonly auto_renew: boolean;
  readonly updated_at: bigint;
  readonly delete_at: bigint | null;
}

export interface OtherUserRow {
  readonly store: string;
  readonly transaction_id: string;
  readonly user_id: bigint;
  readonly owner_user_id: bigint;
  readonly product_id: number;
  readonly verified_at: bigint;
  readonly delete_at: bigint | null;
}

/** `sql` with `$LIVE` replaced by the condition that the row's `delete_at` is not reached at parameter `now_param`. */
function live(sql: string, now_param: number): string {
  return sql.split('$LIVE').join(`(delete_at IS NULL OR delete_at > $${String(now_param)})`);
}

/** Registers the five tables (`storage.register_table`). Indexes serve the queries by user and by original transaction ID. */
export function register_tables(storage: IapStorage): void {
  storage.register_table(
    PAYMENT,
    'game',
    [
      { name: 'store', type: 'string' },
      { name: 'transaction_id', type: 'string' },
      { name: 'original_transaction_id', type: 'string' },
      { name: 'user_id', type: 'int64' },
      { name: 'sku', type: 'string' },
      { name: 'product_id', type: 'int32' },
      { name: 'spend_amount', type: 'int64' },
      { name: 'purchased_at', type: 'int64' },
      { name: 'verified_at', type: 'int64' },
      { name: 'result', type: 'string' },
      { name: 'test', type: 'bool' },
      { name: 'reset_at', type: 'int64' },
      { name: 'event_round', type: 'int32' },
      { name: 'transfer_count', type: 'int32' },
      { name: 'delete_at', type: 'int64?' },
    ],
    ['store', 'transaction_id'],
    'delete_at',
    null,
    'user_id',
    [['user_id'], ['store', 'original_transaction_id']],
  );
  storage.register_table(
    BINDING,
    'game',
    [
      { name: 'store', type: 'string' },
      { name: 'original_transaction_id', type: 'string' },
      { name: 'user_id', type: 'int64' },
      { name: 'delete_at', type: 'int64?' },
    ],
    ['store', 'original_transaction_id'],
    'delete_at',
    null,
    'user_id',
    [['user_id']],
  );
  storage.register_table(
    SUBSCRIPTION,
    'game',
    [
      { name: 'store', type: 'string' },
      { name: 'original_transaction_id', type: 'string' },
      { name: 'user_id', type: 'int64' },
      { name: 'product_id', type: 'int32' },
      { name: 'state', type: 'string' },
      { name: 'ends_at', type: 'int64' },
      { name: 'auto_renew', type: 'bool' },
      { name: 'updated_at', type: 'int64' },
      { name: 'delete_at', type: 'int64?' },
    ],
    ['store', 'original_transaction_id'],
    'delete_at',
    null,
    'user_id',
    [['user_id', 'product_id']],
  );
  storage.register_table(
    ACCOUNT_TOKEN,
    'game',
    [
      { name: 'account_token', type: 'string' },
      { name: 'user_id', type: 'int64' },
      { name: 'delete_at', type: 'int64?' },
    ],
    ['account_token'],
    'delete_at',
    null,
    'user_id',
    [['user_id']],
  );
  storage.register_table(
    OTHER_USER,
    'game',
    [
      { name: 'store', type: 'string' },
      { name: 'transaction_id', type: 'string' },
      { name: 'user_id', type: 'int64' },
      { name: 'owner_user_id', type: 'int64' },
      { name: 'product_id', type: 'int32' },
      { name: 'verified_at', type: 'int64' },
      { name: 'delete_at', type: 'int64?' },
    ],
    ['store', 'transaction_id', 'user_id'],
    'delete_at',
    null,
    'user_id',
    [['user_id']],
  );
}

const PAYMENT_COLUMNS =
  'store, transaction_id, original_transaction_id, user_id, sku, product_id, spend_amount, purchased_at, verified_at, result, test, reset_at, event_round, transfer_count, delete_at';
const SUBSCRIPTION_COLUMNS = 'store, original_transaction_id, user_id, product_id, state, ends_at, auto_renew, updated_at, delete_at';

const SELECT_PAYMENT = live(`SELECT ${PAYMENT_COLUMNS} FROM ${PAYMENT} WHERE store = $1 AND transaction_id = $2 AND $LIVE`, 3);
const SELECT_PAYMENTS_OF_USER = live(`SELECT ${PAYMENT_COLUMNS} FROM ${PAYMENT} WHERE user_id = $1 AND $LIVE ORDER BY verified_at, store, transaction_id`, 2);
const SELECT_SPEND_OF_USER = live(
  `SELECT spend_amount FROM ${PAYMENT} WHERE user_id = $1 AND result = 'GRANTED' AND test = $2 AND verified_at >= $3 AND verified_at < $4 AND $LIVE`,
  5,
);
const SELECT_GRANTED_OF_USER = live(`SELECT transaction_id FROM ${PAYMENT} WHERE user_id = $1 AND result = 'GRANTED' AND test = $2 AND verified_at >= $3 AND $LIVE LIMIT $4`, 5);
const SELECT_OTHER_DONE_OF_ORIGINAL = live(
  `SELECT transaction_id FROM ${PAYMENT} WHERE store = $1 AND original_transaction_id = $2 AND transaction_id <> $3 AND result IN ('GRANTED', 'REFUNDED') AND $LIVE LIMIT 1`,
  4,
);
const UPSERT_PAYMENT =
  `INSERT INTO ${PAYMENT} (${PAYMENT_COLUMNS}) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15) ` +
  'ON CONFLICT (store, transaction_id) DO UPDATE SET original_transaction_id = excluded.original_transaction_id, user_id = excluded.user_id, ' +
  'sku = excluded.sku, product_id = excluded.product_id, spend_amount = excluded.spend_amount, purchased_at = excluded.purchased_at, ' +
  'verified_at = excluded.verified_at, result = excluded.result, test = excluded.test, reset_at = excluded.reset_at, ' +
  'event_round = excluded.event_round, transfer_count = excluded.transfer_count, delete_at = excluded.delete_at';

const SELECT_BINDING = live(`SELECT store, original_transaction_id, user_id, delete_at FROM ${BINDING} WHERE store = $1 AND original_transaction_id = $2 AND $LIVE`, 3);
const UPSERT_BINDING =
  `INSERT INTO ${BINDING} (store, original_transaction_id, user_id, delete_at) VALUES ($1, $2, $3, $4) ` +
  'ON CONFLICT (store, original_transaction_id) DO UPDATE SET user_id = excluded.user_id, delete_at = excluded.delete_at';

const SELECT_SUBSCRIPTION = live(`SELECT ${SUBSCRIPTION_COLUMNS} FROM ${SUBSCRIPTION} WHERE store = $1 AND original_transaction_id = $2 AND $LIVE`, 3);
const SELECT_SUBSCRIPTIONS_OF_PRODUCT = live(`SELECT ${SUBSCRIPTION_COLUMNS} FROM ${SUBSCRIPTION} WHERE user_id = $1 AND product_id = $2 AND $LIVE`, 3);
const SELECT_SUBSCRIPTIONS_OF_USER = live(`SELECT ${SUBSCRIPTION_COLUMNS} FROM ${SUBSCRIPTION} WHERE user_id = $1 AND $LIVE ORDER BY store, original_transaction_id`, 2);
const UPSERT_SUBSCRIPTION =
  `INSERT INTO ${SUBSCRIPTION} (${SUBSCRIPTION_COLUMNS}) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) ` +
  'ON CONFLICT (store, original_transaction_id) DO UPDATE SET user_id = excluded.user_id, product_id = excluded.product_id, ' +
  'state = excluded.state, ends_at = excluded.ends_at, auto_renew = excluded.auto_renew, updated_at = excluded.updated_at, delete_at = excluded.delete_at';

const SELECT_ACCOUNT_TOKEN = live(`SELECT account_token, user_id FROM ${ACCOUNT_TOKEN} WHERE account_token = $1 AND $LIVE`, 2);
const INSERT_ACCOUNT_TOKEN =
  `INSERT INTO ${ACCOUNT_TOKEN} (account_token, user_id, delete_at) VALUES ($1, $2, NULL) ` +
  `ON CONFLICT (account_token) DO UPDATE SET user_id = excluded.user_id, delete_at = NULL WHERE ${ACCOUNT_TOKEN}.delete_at IS NOT NULL AND ${ACCOUNT_TOKEN}.delete_at <= $3`;

const OTHER_USER_COLUMNS = 'store, transaction_id, user_id, owner_user_id, product_id, verified_at, delete_at';
const SELECT_OTHER_USER_OF_USER = live(`SELECT ${OTHER_USER_COLUMNS} FROM ${OTHER_USER} WHERE user_id = $1 AND $LIVE ORDER BY verified_at, store, transaction_id`, 2);
const UPSERT_OTHER_USER =
  `INSERT INTO ${OTHER_USER} (${OTHER_USER_COLUMNS}) VALUES ($1, $2, $3, $4, $5, $6, NULL) ` +
  'ON CONFLICT (store, transaction_id, user_id) DO UPDATE SET owner_user_id = excluded.owner_user_id, product_id = excluded.product_id, ' +
  'verified_at = excluded.verified_at, delete_at = NULL';

function big(value: unknown): bigint {
  if (typeof value === 'bigint') return value;
  if (typeof value === 'number') return BigInt(value);
  throw new TypeError(`iap: ${String(value)} is not an int64 column value`);
}

function nullable_big(value: unknown): bigint | null {
  return value === null || value === undefined ? null : big(value);
}

function payment_of(row: Record<string, unknown>): PaymentRow {
  return {
    store: String(row.store),
    transaction_id: String(row.transaction_id),
    original_transaction_id: String(row.original_transaction_id),
    user_id: big(row.user_id),
    sku: String(row.sku),
    product_id: Number(row.product_id),
    spend_amount: big(row.spend_amount),
    purchased_at: big(row.purchased_at),
    verified_at: big(row.verified_at),
    result: String(row.result) as PaymentResult,
    test: row.test === true,
    reset_at: big(row.reset_at),
    event_round: Number(row.event_round),
    transfer_count: Number(row.transfer_count),
    delete_at: nullable_big(row.delete_at),
  };
}

function binding_of(row: Record<string, unknown>): BindingRow {
  return { store: String(row.store), original_transaction_id: String(row.original_transaction_id), user_id: big(row.user_id), delete_at: nullable_big(row.delete_at) };
}

function subscription_of(row: Record<string, unknown>): SubscriptionRow {
  return {
    store: String(row.store),
    original_transaction_id: String(row.original_transaction_id),
    user_id: big(row.user_id),
    product_id: Number(row.product_id),
    state: String(row.state),
    ends_at: big(row.ends_at),
    auto_renew: row.auto_renew === true,
    updated_at: big(row.updated_at),
    delete_at: nullable_big(row.delete_at),
  };
}

function other_user_of(row: Record<string, unknown>): OtherUserRow {
  return {
    store: String(row.store),
    transaction_id: String(row.transaction_id),
    user_id: big(row.user_id),
    owner_user_id: big(row.owner_user_id),
    product_id: Number(row.product_id),
    verified_at: big(row.verified_at),
    delete_at: nullable_big(row.delete_at),
  };
}

export function select_payment(db: DbHandle, store: string, transaction_id: string, now: bigint): PaymentRow | null {
  const row = db.query(SELECT_PAYMENT, [store, transaction_id, now])[0];
  return row === undefined ? null : payment_of(row);
}

export function select_payments_of_user(db: DbHandle, user_id: bigint, now: bigint): PaymentRow[] {
  return db.query(SELECT_PAYMENTS_OF_USER, [user_id, now]).map(payment_of);
}

/** Sum of `spend_amount` of the user's `GRANTED` payment records of the `test` flag verified in `[from, to)`. */
export function sum_spend_of_user(db: DbHandle, user_id: bigint, test: boolean, from: bigint, to: bigint, now: bigint): bigint {
  let sum = 0n;
  for (const row of db.query(SELECT_SPEND_OF_USER, [user_id, test, from, to, now])) sum += big(row.spend_amount);
  return sum;
}

/** The number of the user's `GRANTED` payment records of the `test` flag verified at or after `from`, counted up to `max`. */
export function count_granted_of_user(db: DbHandle, user_id: bigint, test: boolean, from: bigint, max: number, now: bigint): number {
  return db.query(SELECT_GRANTED_OF_USER, [user_id, test, from, max, now]).length;
}

/** True when the user has a `GRANTED` payment record of the `test` flag. */
export function has_granted_of_user(db: DbHandle, user_id: bigint, test: boolean, now: bigint): boolean {
  return count_granted_of_user(db, user_id, test, -(2n ** 63n), 1, now) > 0;
}

/** True when a payment record of the original transaction ID with another transaction ID is `GRANTED` or `REFUNDED`. */
export function has_other_done_of_original(db: DbHandle, store: string, original_transaction_id: string, transaction_id: string, now: bigint): boolean {
  return db.query(SELECT_OTHER_DONE_OF_ORIGINAL, [store, original_transaction_id, transaction_id, now]).length > 0;
}

export function upsert_payment(db: DbHandle, row: PaymentRow): void {
  db.query(UPSERT_PAYMENT, [
    row.store,
    row.transaction_id,
    row.original_transaction_id,
    row.user_id,
    row.sku,
    row.product_id,
    row.spend_amount,
    row.purchased_at,
    row.verified_at,
    row.result,
    row.test,
    row.reset_at,
    row.event_round,
    row.transfer_count,
    row.delete_at,
  ]);
}

export function select_binding(db: DbHandle, store: string, original_transaction_id: string, now: bigint): BindingRow | null {
  const row = db.query(SELECT_BINDING, [store, original_transaction_id, now])[0];
  return row === undefined ? null : binding_of(row);
}

export function upsert_binding(db: DbHandle, row: BindingRow): void {
  db.query(UPSERT_BINDING, [row.store, row.original_transaction_id, row.user_id, row.delete_at]);
}

export function select_subscription(db: DbHandle, store: string, original_transaction_id: string, now: bigint): SubscriptionRow | null {
  const row = db.query(SELECT_SUBSCRIPTION, [store, original_transaction_id, now])[0];
  return row === undefined ? null : subscription_of(row);
}

export function select_subscriptions_of_product(db: DbHandle, user_id: bigint, product_id: number, now: bigint): SubscriptionRow[] {
  return db.query(SELECT_SUBSCRIPTIONS_OF_PRODUCT, [user_id, product_id, now]).map(subscription_of);
}

export function select_subscriptions_of_user(db: DbHandle, user_id: bigint, now: bigint): SubscriptionRow[] {
  return db.query(SELECT_SUBSCRIPTIONS_OF_USER, [user_id, now]).map(subscription_of);
}

export function upsert_subscription(db: DbHandle, row: SubscriptionRow): void {
  db.query(UPSERT_SUBSCRIPTION, [row.store, row.original_transaction_id, row.user_id, row.product_id, row.state, row.ends_at, row.auto_renew, row.updated_at, row.delete_at]);
}

/** The user of an account token mapping, or null. */
export function select_account_token_user(db: DbHandle, account_token: string, now: bigint): bigint | null {
  const row = db.query(SELECT_ACCOUNT_TOKEN, [account_token, now])[0];
  return row === undefined ? null : big(row.user_id);
}

/** Writes the (account token, user ID) row unless a live row is there. */
export function insert_account_token(db: DbHandle, account_token: string, user_id: bigint, now: bigint): void {
  db.query(INSERT_ACCOUNT_TOKEN, [account_token, user_id, now]);
}

export function select_other_user_of_user(db: DbHandle, user_id: bigint, now: bigint): OtherUserRow[] {
  return db.query(SELECT_OTHER_USER_OF_USER, [user_id, now]).map(other_user_of);
}

export function upsert_other_user(db: DbHandle, row: Omit<OtherUserRow, 'delete_at'>): void {
  db.query(UPSERT_OTHER_USER, [row.store, row.transaction_id, row.user_id, row.owner_user_id, row.product_id, row.verified_at]);
}

/** `remove_user`: sets `delete_at` of every row of the user in the five tables. */
export function mark_user_rows(db: DbHandle, user_id: bigint, delete_at: bigint): void {
  for (const table of TABLES) db.query(`UPDATE ${table} SET delete_at = $1 WHERE user_id = $2`, [delete_at, user_id]);
}
