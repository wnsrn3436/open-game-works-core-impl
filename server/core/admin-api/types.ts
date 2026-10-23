/**
 * Types of admin-api: the admin operation form that modules and content hand to `register_admin_operation`, the
 * route form `routing` collects, the module input, and the dependencies as admin-api calls them.
 */
import type { ItemLedger } from '../item-ledger/index.ts';
import type { Logging } from '../logging/index.ts';
import type { Mailbox } from '../mailbox/index.ts';
import type { ServerTimeApi } from '../server-time/index.ts';
import type { GameTx, RequestCtx, Storage } from '../storage/index.ts';

/** Admin operation roles. `privacy` is only for admin-api's own `export_personal_data`. */
export type Role = 'read' | 'ops' | 'economy' | 'release' | 'privacy';
export const ROLES: readonly Role[] = ['read', 'ops', 'economy', 'release', 'privacy'];
/** The roles a module or content admin operation may have. */
export const EXPORTED_ROLES: readonly Role[] = ['read', 'ops', 'economy', 'release'];

/** Failure reasons a handler function may return. */
export type HandlerFailure = 'bad_request' | 'not_found' | 'conflict' | 'external_failed' | 'internal';
export const HANDLER_FAILURES: readonly HandlerFailure[] = ['bad_request', 'not_found', 'conflict', 'external_failed', 'internal'];
/** Failure reasons a prepare function may return. */
export type PrepareFailure = 'bad_request' | 'not_found' | 'conflict' | 'external_failed';
export const PREPARE_FAILURES: readonly PrepareFailure[] = ['bad_request', 'not_found', 'conflict', 'external_failed'];

/** Admin field type. */
export type FieldType =
  | { readonly kind: 'int64' }
  | { readonly kind: 'int32' }
  | { readonly kind: 'bool' }
  | { readonly kind: 'string' }
  | { readonly kind: 'enum'; readonly elements: readonly string[] }
  | { readonly kind: 'array'; readonly element: FieldType }
  | { readonly kind: 'object'; readonly fields: FieldMap }
  | { readonly kind: 'object_union'; readonly fields: Readonly<Record<string, FieldType>> }
  | { readonly kind: 'json' };

/** An input field: its type and whether it may be left out. */
export interface FieldSpec {
  readonly type: FieldType;
  readonly optional?: boolean;
}

export type FieldMap = Readonly<Record<string, FieldSpec>>;

/**
 * Input that passed the body rules. `int64` is `bigint`, `int32` is `number`, `enum` is the element name, an
 * `object union` is an object with its one key, `json` is the JSON value with integers outside the safe range as
 * `bigint`. A left out optional field is absent.
 */
export type AdminInput = Readonly<Record<string, unknown>>;

/** JSON object an admin operation answers with. `bigint` becomes a decimal string, bytes become standard base64. */
export type AdminOutput = Readonly<Record<string, unknown>>;

/** The transaction of a handler function: the target user's out-of-request ctx, or a game tx. */
export type AdminTransaction = RequestCtx | GameTx;

/**
 * An admin operation a module exports or content registers (`## API` "TypeScript shape of an admin operation"):
 * `{name, role, body, max_body_bytes, input, user_target, handler, prepare, audit_args}`.
 */
export interface AdminOperation {
  readonly name: string;
  readonly role: Role;
  /** `binary`: the body is raw bytes and the input fields are the query string. */
  readonly body: 'json' | 'binary';
  /** Byte limit of a `binary` body; null (or left out) for a `json` body. */
  readonly max_body_bytes?: number | null;
  readonly input: FieldMap;
  /** The `int64` input field with the target user ID of a user-targeted operation, or null. */
  readonly user_target: string | null;
  /**
   * Runs in the transaction admin-api opens: the target user's out-of-request ctx when `user_target` is set, a game
   * tx otherwise. A failure reason rolls that transaction back. `body` is the raw body of a `binary` operation.
   * Synchronous: it runs inside the transaction.
   */
  readonly handler: (input: AdminInput, transaction: AdminTransaction, prepare_value: unknown, body: Uint8Array | null) => AdminOutput | HandlerFailure;
  /** Runs outside a transaction before the handler function; returns the prepare value or a failure reason. */
  readonly prepare?: ((input: AdminInput, body: Uint8Array | null) => unknown) | null;
  /** `args` of the `audit` log when the operation's spec sets them. `body` is the raw body of a `binary` operation. */
  readonly audit_args?: ((input: AdminInput, body: Uint8Array | null) => AdminOutput) | null;
}

/** The HTTP request `routing` gives a route handler (`routing` `## API` route form). */
export interface RouteRequest {
  readonly method: string;
  /** Path without the query string. */
  readonly path: string;
  /** The query string without `?`; empty when there is none. */
  readonly query: string;
  /** Lower case header names. */
  readonly headers: Readonly<Record<string, string | undefined>>;
  /** Reads the body: null when it passes `max_bytes` or the reading takes longer than `timeout_ms`. */
  read_body(max_bytes: number, timeout_ms: number): Promise<Uint8Array | null>;
}

export interface RouteResponse {
  readonly status: number;
  readonly headers: Record<string, string>;
  readonly body: Uint8Array;
}

/** The fields of the module input `server` (`server-core` `## module`) that admin-api reads. */
export interface AdminApiServer {
  /** `--db`; not null on a LOCAL server and a test server, which use the fixed operators. */
  readonly db: string | null;
  /** The secret adapter. */
  read_secret(name: string): string | null;
}

/** `iap` as admin-api calls it (optional dependency). */
export interface IapModule {
  list_payments(user_id: bigint): { readonly payments: readonly unknown[]; readonly other_user_attempts: readonly unknown[] };
}

/** `ranking` as admin-api calls it (optional dependency). */
export interface RankingModule {
  remove_user(ctx: RequestCtx): unknown;
}

export interface AdminApiModules {
  readonly storage: Storage;
  readonly 'server-time': ServerTimeApi;
  readonly logging: Pick<Logging, 'write' | 'with_audit_actor'>;
  readonly 'item-ledger': Pick<ItemLedger, 'add_items' | 'revoke_items' | 'list_history'>;
  readonly mailbox: Pick<Mailbox, 'send_mail' | 'broadcast_mail' | 'cancel_broadcast' | 'mail_input_from_json'>;
  readonly iap?: IapModule;
  readonly ranking?: RankingModule;
}

/** The module input (`server-core` `## module`). */
export interface AdminApiInput {
  readonly settings: Readonly<Record<string, unknown>>;
  readonly modules: AdminApiModules;
  readonly server: AdminApiServer;
}

/** The admin-api module object: the route, the internal operations and the lifecycle. */
export interface AdminApi {
  'POST /admin/<operation>'(request: RouteRequest, client_ip: string): Promise<RouteResponse>;
  begin_start(): void;
  complete_start(): string | null;
  stop(): void;
  register_admin_operation(module: string, operation: AdminOperation): void;
  is_maintenance(): boolean;
  is_banned(user_id: bigint): { readonly banned: boolean; readonly until_at: bigint };
  ip_in_cidrs(client_ip: string, cidrs: readonly string[]): boolean;
  is_kill_switched(request_name: string): boolean;
}
