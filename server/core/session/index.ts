import { randomBytes } from 'node:crypto';
import * as CoreContract from '../../generated/contract/core_contract.ts';
import type { ServerTimeApi } from '../server-time/index.ts';
import type { ColumnInput, DbHandle, RequestCtx, Storage } from '../storage/index.ts';
import { in_window, is_signature_format, parse_timestamp, request_signature, signature_matches } from './signature.ts';

/** The session record table (`user` scope, key `user_id`, not in the user snapshot). */
const SESSION_TABLE = 'session_current';

const SESSION_ID_BYTES = 16;
const SIGNING_KEY_BYTES = 32;

/** The `storage` operations session calls (`storage` `## API`). */
export type SessionStorage = Pick<Storage, 'register_table' | 'db' | 'read_db' | 'read_full_state'>;

/** The `server-time` operations session calls (`server-time` `## API`). */
export type SessionServerTime = Pick<ServerTimeApi, 'now' | 'user_now'>;

/** The output of `start_session`: the new session ID and its session signing key. */
export interface SessionStart {
  readonly session_id: string;
  readonly signing_key: string;
}

export type Pass = 'pass';
export type Unauthorized = typeof CoreContract.CoreError.CORE_ERROR_UNAUTHORIZED;
export type SessionReplaced = typeof CoreContract.CoreError.CORE_ERROR_SESSION_REPLACED;

/** The handler of the core `rpc` `Resync`. */
export type ResyncHandler = (ctx: RequestCtx, request: CoreContract.ResyncRequest) => CoreContract.ResyncResponse;

/** The `## API` operations of `session`. */
export interface SessionApi {
  start_session(ctx: RequestCtx): SessionStart;
  end_session(ctx: RequestCtx): void;
  check_current(user_id: bigint, session_id: string): Pass | Unauthorized | SessionReplaced;
  /** `timestamp` and `signature` are the `X-Ogw-Timestamp` and `X-Ogw-Signature` values, null when missing. */
  verify_signature(
    user_id: bigint,
    session_id: string,
    name: string,
    request_id: string,
    timestamp: string | null,
    signature: string | null,
    body: Uint8Array,
  ): Pass | Unauthorized | SessionReplaced;
  /** `timestamp` is the `X-Ogw-Timestamp` value. */
  sign_request(signing_key: string, name: string, request_id: string, timestamp: string, body: Uint8Array): string;
  Resync: ResyncHandler;
}

/** `session` of one server instance: the `## API` operations and the lifecycle of `server-core` `## module`. */
export interface Session extends SessionApi {
  begin_start(): void;
  complete_start(): string | null;
  stop(): void;
}

/**
 * The module input (`server-core` `## module`): `settings` holds `session.signatureWindowMs`, `modules` the module
 * objects of `storage` and `server-time`. session reads nothing of `server`.
 */
export interface SessionInput {
  readonly settings: Readonly<Record<string, unknown>>;
  readonly modules: Readonly<Record<string, unknown>>;
  readonly server?: unknown;
}

const UNAUTHORIZED: Unauthorized = CoreContract.CoreError.CORE_ERROR_UNAUTHORIZED;
const SESSION_REPLACED: SessionReplaced = CoreContract.CoreError.CORE_ERROR_SESSION_REPLACED;

const SESSION_COLUMNS: readonly ColumnInput[] = [
  { name: 'user_id', type: 'int64' },
  { name: 'session_id', type: 'string' },
  { name: 'signing_key', type: 'string' },
  { name: 'started_at', type: 'int64' },
];

function window_setting(settings: Readonly<Record<string, unknown>>): bigint {
  const value = settings['session.signatureWindowMs'];
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new TypeError('session: setting session.signatureWindowMs is not an integer of 0 or more');
  }
  return BigInt(value);
}

function required_module<T>(modules: Readonly<Record<string, unknown>>, name: string, methods: readonly (keyof T & string)[]): T {
  const module = modules[name];
  if (typeof module !== 'object' || module === null) throw new TypeError(`session: module ${name} is missing`);
  const record = module as Record<string, unknown>;
  const missing = methods.find((method) => typeof record[method] !== 'function');
  if (missing !== undefined) throw new TypeError(`session: module ${name} has no ${missing}`);
  return module as T;
}

/** The session record columns of a user that check and signature verification read; null when there is none. */
function read_record(db: DbHandle, user_id: bigint): { session_id: string; signing_key: string } | null {
  const rows = db.query(`SELECT session_id, signing_key FROM ${SESSION_TABLE} WHERE user_id = $1`, [user_id]);
  const row = rows[0];
  if (row === undefined) return null;
  const { session_id, signing_key } = row;
  if (typeof session_id !== 'string' || typeof signing_key !== 'string') throw new TypeError(`session: ${SESSION_TABLE} row of user ${String(user_id)} has a wrong type`);
  return { session_id, signing_key };
}

function delete_record(db: DbHandle, user_id: bigint): void {
  db.query(`DELETE FROM ${SESSION_TABLE} WHERE user_id = $1`, [user_id]);
}

/** `sign_request`: the `X-Ogw-Signature` value of a request, the same as the module object's method. */
export function sign_request(signing_key: string, name: string, request_id: string, timestamp: string, body: Uint8Array): string {
  return request_signature(signing_key, { name, request_id, timestamp, body });
}

/**
 * Makes `session` for one server instance and registers its session record table. A missing setting or module
 * throws.
 */
export function create_session(input: SessionInput): Session {
  const window_ms = window_setting(input.settings);
  const storage = required_module<SessionStorage>(input.modules, 'storage', ['register_table', 'db', 'read_db', 'read_full_state']);
  const server_time = required_module<SessionServerTime>(input.modules, 'server-time', ['now', 'user_now']);
  storage.register_table(SESSION_TABLE, 'user', SESSION_COLUMNS, ['user_id'], null, false);

  return {
    start_session: (ctx) => {
      const session_id = randomBytes(SESSION_ID_BYTES).toString('base64url');
      const signing_key = randomBytes(SIGNING_KEY_BYTES).toString('base64url');
      const db = storage.db(ctx);
      delete_record(db, ctx.user_id);
      db.query(
        `INSERT INTO ${SESSION_TABLE} (user_id, session_id, signing_key, started_at) VALUES ($1, $2, $3, $4)`,
        [ctx.user_id, session_id, signing_key, server_time.now(ctx)],
      );
      return { session_id, signing_key };
    },
    end_session: (ctx) => {
      delete_record(storage.db(ctx), ctx.user_id);
    },
    check_current: (user_id, session_id) => {
      const record = read_record(storage.read_db(), user_id);
      if (record === null) return UNAUTHORIZED;
      return record.session_id === session_id ? 'pass' : SESSION_REPLACED;
    },
    verify_signature: (user_id, session_id, name, request_id, timestamp, signature, body) => {
      const time = parse_timestamp(timestamp);
      if (timestamp === null || time === null || !is_signature_format(signature)) return UNAUTHORIZED;
      const db = storage.read_db();
      const record = read_record(db, user_id);
      if (record === null) return UNAUTHORIZED;
      if (record.session_id !== session_id) return SESSION_REPLACED;
      const expected = sign_request(record.signing_key, name, request_id, timestamp, body);
      if (!signature_matches(expected, signature)) return UNAUTHORIZED;
      return in_window(time, server_time.user_now(user_id, db), window_ms) ? 'pass' : UNAUTHORIZED;
    },
    sign_request,
    Resync: (ctx, request) => {
      if (request.full) storage.read_full_state(ctx);
      return new CoreContract.ResyncResponse();
    },
    begin_start: () => {},
    complete_start: () => null,
    stop: () => {},
  };
}
