/**
 * The members `iap` uses of the module objects of its dependencies (`## dependency`), as their spec `## API` gives
 * them, and the module input. Every name here is an operation of that spec.
 */
import type * as CoreContract from '../../generated/contract/core_contract.ts';
import type * as GameData from '../../generated/data/game_data.ts';
import type { IdempotencyModule } from '../idempotency/index.ts';
import type { Logging } from '../logging/index.ts';
import type { ServerTimeApi } from '../server-time/index.ts';
import type { DbHandle, RequestCtx, Storage } from '../storage/index.ts';
import type { HttpFetch, KeySource } from './adapter.ts';

/** `item-ledger` change source. */
export interface ChangeSource {
  readonly source: CoreContract.ItemChangeSource;
  readonly ref: string;
  readonly once_key: string;
}

/** One element of the `item-ledger.revoke_items` output. */
export interface RevokedItem {
  readonly item_id: number;
  readonly shortfall: bigint;
}

export interface IapItemLedger {
  /** The item list, or an `ItemChangeResult` failure element. */
  revoke_items(ctx: RequestCtx, items: readonly CoreContract.ItemAmount[], source: ChangeSource): readonly RevokedItem[] | string;
}

/** `mailbox.grant_or_mail` output: `Granted`, `AlreadyApplied`, `Mailed` with the mail IDs, or a failure value in `result`. */
export type GrantOrMailResult =
  | { readonly result: 'Granted' }
  | { readonly result: 'AlreadyApplied' }
  | { readonly result: 'Mailed'; readonly mail_ids: readonly bigint[] }
  | { readonly result: string };

export interface IapMailbox {
  grant_or_mail(ctx: RequestCtx, items: readonly CoreContract.ItemAmount[], source: ChangeSource, template_id: number, args: readonly CoreContract.MailArg[]): GrantOrMailResult;
  cancel_mail_by_once_key(ctx: RequestCtx, once_key: string): readonly CoreContract.ItemAmount[];
}

export interface IapLiveEvent {
  /** Each of `start_at`, `end_at`, `live_event` is null when the data row has none. */
  is_in_active_window(ctx: RequestCtx, start_at: bigint | null, end_at: bigint | null, live_event: number | null): boolean;
  /** `live_event` 0 is none. */
  round_to_write(ctx: RequestCtx, live_event: number): number;
  is_round_reset(ctx: RequestCtx, live_event: number, event_round: number): boolean;
}

export interface IapOffer {
  is_offer_active(ctx: RequestCtx, offer_id: number): boolean;
  /** `offer_id` and `live_event` 0 are none; `count`, `reset_at`, `event_round` are 0 for no row. */
  read_purchase_limit(
    ctx: RequestCtx,
    offer_id: number,
    reset: GameData.ResetCycle | null,
    live_event: number,
    count: number,
    reset_at: bigint,
    event_round: number,
  ): { readonly count: number; readonly reset_at: bigint; readonly event_round: number; readonly write_reset_at: bigint };
}

export interface IapValidation {
  evaluate_requirement(ctx: RequestCtx, requirement_id: number): { readonly passed: boolean; readonly failed_requirement_id: number };
}

export type IapStorage = Pick<
  Storage,
  | 'get_state'
  | 'put_core_state'
  | 'delete_core_state'
  | 'run_user_transaction'
  | 'run_game_transaction'
  | 'with_hook_change_source'
  | 'lock_game_row'
  | 'after_commit'
  | 'db'
  | 'read_db'
  | 'register_table'
>;

export type IapServerTime = Pick<ServerTimeApi, 'now' | 'clock_now' | 'get_day_number' | 'get_period_start' | 'get_next_reset' | 'network_time_limit'>;

export type IapLogging = Pick<Logging, 'write' | 'track_core_event'>;

export type IapIdempotency = Pick<IdempotencyModule, 'claim_notify'>;

/** `register_account_lookup` input: true when the user has a social account link. */
export type HasSocialLink = (db: DbHandle, user_id: bigint) => boolean;

/** Hook `validate_iap_purchase`: `pass` or a `GameError`. */
export type ValidateIapPurchaseHook = (ctx: RequestCtx, product_id: number) => unknown;
/** Hook `grant_iap_extra`: `pass` or a `GameError`. */
export type GrantIapExtraHook = (ctx: RequestCtx, product_id: number, transaction_id: string) => unknown;
/** Hook `revoke_iap`: no output. */
export type RevokeIapHook = (ctx: RequestCtx, product_id: number, transaction_id: string, reason: 'refund' | 'transfer', items: readonly CoreContract.ItemAmount[]) => unknown;

/** The hook slots `routing` fills after `register` (`routing` `## API`). */
export interface IapHookSlots {
  validate_iap_purchase: ValidateIapPurchaseHook | null;
  grant_iap_extra: GrantIapExtraHook | null;
  revoke_iap: RevokeIapHook | null;
}

/** The fields of the module input `server` (`server-core` `## module`) that iap reads. */
export interface IapServer {
  readonly env: 'LOCAL' | 'DEV' | 'STG' | 'PROD';
  /** `--db`; non-null only on a LOCAL server and a test server, which read secrets from `--secret-file` by secret key. */
  readonly db: string | null;
  readonly dev: boolean;
  /** The server build data. */
  readonly data: GameData.DataSet;
  readonly fetch: HttpFetch;
  read_secret(name: string): string | null;
  readonly key_sources: Readonly<Record<string, KeySource | undefined>>;
  readonly fake_adapters: Readonly<Record<string, unknown>>;
}

/** The module input (`server-core` `## module`). */
export interface IapInput {
  readonly settings: Readonly<Record<string, unknown>>;
  readonly modules: Readonly<Record<string, unknown>>;
  readonly server: IapServer;
}

/** The dependency module objects iap calls. */
export interface IapModules {
  readonly storage: IapStorage;
  readonly time: IapServerTime;
  readonly logging: IapLogging;
  readonly idempotency: IapIdempotency;
  readonly item_ledger: IapItemLedger;
  readonly mailbox: IapMailbox;
  readonly live_event: IapLiveEvent;
  readonly offer: IapOffer;
  readonly validation: IapValidation;
}

function module_of(modules: Readonly<Record<string, unknown>>, name: string): unknown {
  const value = modules[name];
  if (value === undefined || value === null) throw new TypeError(`iap: module ${name} is missing`);
  return value;
}

/** The dependency module objects from the module input; a missing one throws. */
export function read_modules(modules: Readonly<Record<string, unknown>>): IapModules {
  return {
    storage: module_of(modules, 'storage') as IapStorage,
    time: module_of(modules, 'server-time') as IapServerTime,
    logging: module_of(modules, 'logging') as IapLogging,
    idempotency: module_of(modules, 'idempotency') as IapIdempotency,
    item_ledger: module_of(modules, 'item-ledger') as IapItemLedger,
    mailbox: module_of(modules, 'mailbox') as IapMailbox,
    live_event: module_of(modules, 'live-event') as IapLiveEvent,
    offer: module_of(modules, 'offer') as IapOffer,
    validation: module_of(modules, 'validation') as IapValidation,
  };
}
