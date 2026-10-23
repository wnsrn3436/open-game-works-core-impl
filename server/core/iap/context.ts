/** What every part of one iap module instance shares: dependencies, settings, adapters, hooks, product lookups and logs. */
import * as CoreContract from '../../generated/contract/core_contract.ts';
import * as GameData from '../../generated/data/game_data.ts';
import type { LogFields, LogKind, Level } from '../logging/index.ts';
import type { RequestCtx } from '../storage/index.ts';
import type { StoreAdapter, StoreNotification } from './adapter.ts';
import type { HasSocialLink, IapHookSlots, IapModules } from './deps.ts';
import type { IapSettings } from './settings.ts';

export const MODULE = 'iap';
export const CoreError = CoreContract.CoreError;
export const IapStore = CoreContract.IapStore;
export const PurchaseStatus = CoreContract.PurchaseStatus;
export const SubscriptionState = CoreContract.SubscriptionState;
export const ItemChangeSource = CoreContract.ItemChangeSource;
export const ProductType = GameData.IapProductType;

export type Store = typeof IapStore.IAP_STORE_APPLE | typeof IapStore.IAP_STORE_GOOGLE;

/** A store's adapter: the adapter name game settings chose (`fake`, `iap-apple`, `iap-apple-sandbox`, `iap-google`) and the adapter. */
export interface StoreBinding {
  readonly name: string;
  readonly adapter: StoreAdapter;
}

/** The DEV code's parser of fake adapter store notifications, signed with the server instance's fake notification key. */
export type FakeNotificationParser = (headers: Readonly<Record<string, string>>, body: Uint8Array) => StoreNotification | 'bad_signature' | 'bad_format';

export interface IapContext {
  readonly m: IapModules;
  readonly settings: IapSettings;
  /** The server build data (`server.data`), for work outside a transaction. */
  readonly data: GameData.DataSet;
  readonly hooks: IapHookSlots;
  /** The adapters of the stores game settings give one; filled during server start. */
  readonly adapters: Map<Store, StoreBinding>;
  /** The `iapAccountToken` secret value; filled during server start. */
  account_key: string;
  /** `register_account_lookup`'s function. */
  has_social_link: HasSocialLink | null;
  /** Set by the DEV code in a server instance with DEV code. */
  fake_notification: FakeNotificationParser | null;
}

const STORE_NAMES: ReadonlyMap<number, string> = new Map([
  [IapStore.IAP_STORE_APPLE, 'IAP_STORE_APPLE'],
  [IapStore.IAP_STORE_GOOGLE, 'IAP_STORE_GOOGLE'],
]);

export function is_store(value: unknown): value is Store {
  return value === IapStore.IAP_STORE_APPLE || value === IapStore.IAP_STORE_GOOGLE;
}

/** The `IapStore` element name: the `store` column value and the `<store>` of a `once_key`. */
export function store_name(store: Store): string {
  return STORE_NAMES.get(store) ?? '';
}

export function store_of_name(name: string): Store | null {
  for (const [store, element] of STORE_NAMES) if (element === name) return store as Store;
  return null;
}

const STATE_NAMES: ReadonlyMap<number, string> = new Map(
  Object.entries(SubscriptionState)
    .filter(([, value]) => value !== SubscriptionState.SUBSCRIPTION_STATE_UNSPECIFIED)
    .map(([name, value]) => [value, name]),
);

/** The `SubscriptionState` element name: the `state` column value. */
export function state_name(state: CoreContract.SubscriptionState): string {
  return STATE_NAMES.get(state) ?? 'SUBSCRIPTION_STATE_UNSPECIFIED';
}

export function state_of_name(name: string): CoreContract.SubscriptionState {
  for (const [value, element] of STATE_NAMES) if (element === name) return value as CoreContract.SubscriptionState;
  return SubscriptionState.SUBSCRIPTION_STATE_UNSPECIFIED;
}

/** Entitlement states (`### subscription`). */
export function is_entitled_state(state: CoreContract.SubscriptionState): boolean {
  return state === SubscriptionState.SUBSCRIPTION_STATE_ACTIVE || state === SubscriptionState.SUBSCRIPTION_STATE_GRACE_PERIOD;
}

export function sku_of(product: GameData.IapProductRow, store: Store): string {
  return store === IapStore.IAP_STORE_APPLE ? product.sku_apple : product.sku_google;
}

const SKU_INDEX = new WeakMap<GameData.DataSet, Map<string, GameData.IapProductRow>>();

/** The `iap_product` row whose SKU column of the store is `sku`, or null. */
export function product_by_sku(data: GameData.DataSet, store: Store, sku: string): GameData.IapProductRow | null {
  if (sku === '') return null;
  let index = SKU_INDEX.get(data);
  if (index === undefined) {
    index = new Map();
    for (const row of data.IapProductTable.all_rows()) {
      if (row.sku_apple !== '') index.set(`${String(IapStore.IAP_STORE_APPLE)}:${row.sku_apple}`, row);
      if (row.sku_google !== '') index.set(`${String(IapStore.IAP_STORE_GOOGLE)}:${row.sku_google}`, row);
    }
    SKU_INDEX.set(data, index);
  }
  return index.get(`${String(store)}:${sku}`) ?? null;
}

/** A pass: a `Consumable` with `pass_days`. */
export function is_pass(product: GameData.IapProductRow): boolean {
  return product.type === ProductType.Consumable && product.pass_days > 0;
}

/** The store transaction's grant `once_key` for a `transfer_count`. */
export function grant_once_key(store: Store, transaction_id: string, transfer_count: number): string {
  const base = `iap:${store_name(store)}:${transaction_id}`;
  return transfer_count === 0 ? base : `${base}:t${String(transfer_count)}`;
}

/** Writes one server log line. With a ctx, the line carries its user, request ID and request name. */
export function log(c: IapContext, ctx: RequestCtx | null, kind: LogKind, level: Level, message: string, fields: LogFields = {}): void {
  c.m.logging.write({
    kind,
    level,
    message,
    user_id: ctx?.user_id ?? null,
    request_id: ctx !== null && ctx.request_id !== '' ? ctx.request_id : null,
    request: ctx !== null && ctx.request_name !== '' ? ctx.request_name : null,
    fields: kind === 'core' ? { module: MODULE, ...fields } : fields,
  });
}

/** Writes a line without a ctx for a user. */
export function log_user(c: IapContext, user_id: bigint | null, kind: LogKind, level: Level, message: string, fields: LogFields = {}): void {
  c.m.logging.write({ kind, level, message, user_id, request_id: null, request: null, fields: kind === 'core' ? { module: MODULE, ...fields } : fields });
}

/** `pass`, or the `GameError` or `CoreError` a hook gave. */
export function is_failure_code(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0;
}
