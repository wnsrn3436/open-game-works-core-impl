/**
 * idempotency: replays the stored response of a request ID sent again, and records external service callbacks and
 * core notifications by notify ID so that each is processed once.
 */
import { ResponseEnvelope } from '../../generated/contract/core_contract.ts';
import type { ServerTimeApi } from '../server-time/index.ts';
import type { DbHandle, GameTx, RequestCtx, Storage } from '../storage/index.ts';

/** The `storage` operations idempotency calls. */
export type IdempotencyStorage = Pick<Storage, 'register_table' | 'db'>;

/** The `server-time` operation idempotency calls. */
export type IdempotencyServerTime = Pick<ServerTimeApi, 'clock_now'>;

/** The core settings keys of `## settings`. */
type SettingKey =
  | 'idempotency.responseRetentionMs'
  | 'session.signatureWindowMs'
  | 'NetworkCore.maxRetryAgeMs'
  | 'NetworkCore.requestTimeoutMs'
  | 'idempotency.notifyRetentionMs'
  | 'idempotency.maxNotifyIdBytes';

/** The module input (`server-core` `## module`). idempotency reads nothing of `server`. */
export interface IdempotencyInput {
  readonly settings: Readonly<Record<string, unknown>>;
  readonly modules: Readonly<Record<string, unknown>>;
  readonly server?: unknown;
}

export const NAME_MISMATCH = 'NAME_MISMATCH';
export type NameMismatch = typeof NAME_MISMATCH;
export type ClaimResult = 'FIRST' | 'DUPLICATE';

export interface IdempotencyModule {
  begin_start(): void;
  complete_start(): string | null;
  stop(): void;
  find_response(ctx: RequestCtx): Uint8Array | null | NameMismatch;
  find_committed_response(
    db: DbHandle,
    user_id: bigint,
    request_id: string,
    request_name: string,
    response_time: bigint,
  ): Uint8Array | null | NameMismatch;
  save_response(ctx: RequestCtx, response: Uint8Array): void;
  save_withdrawn_response(ctx: RequestCtx, token_hash: string, response: Uint8Array): void;
  find_withdrawn_response(
    db: DbHandle,
    token_hash: string,
    request_id: string,
    request_name: string,
    response_time: bigint,
  ): Uint8Array | null | NameMismatch;
  has_response(db: DbHandle, user_id: bigint, request_id: string): boolean;
  claim_notify(ctx_or_tx: RequestCtx | GameTx, source: string, notify_id: string): ClaimResult;
}

const RESPONSE_TABLE = 'idempotency_response';
const NOTIFY_TABLE = 'idempotency_notify';
const WITHDRAWN_TABLE = 'idempotency_withdrawn_response';

const FIND_RESPONSE = `SELECT request_name, response FROM ${RESPONSE_TABLE} WHERE user_id = $1 AND request_id = $2 AND expires_at > $3`;
const HAS_RESPONSE = `SELECT user_id FROM ${RESPONSE_TABLE} WHERE user_id = $1 AND request_id = $2 AND expires_at > $3`;
const SAVE_RESPONSE =
  `INSERT INTO ${RESPONSE_TABLE} (user_id, request_id, request_name, response, created_at, expires_at) VALUES ($1, $2, $3, $4, $5, $6) ` +
  'ON CONFLICT (user_id, request_id) DO UPDATE SET request_name = excluded.request_name, response = excluded.response, ' +
  'created_at = excluded.created_at, expires_at = excluded.expires_at';
const FIND_WITHDRAWN = `SELECT request_name, response FROM ${WITHDRAWN_TABLE} WHERE token_hash = $1 AND request_id = $2 AND expires_at > $3`;
const SAVE_WITHDRAWN =
  `INSERT INTO ${WITHDRAWN_TABLE} (token_hash, request_id, request_name, response, created_at, expires_at) VALUES ($1, $2, $3, $4, $5, $6) ` +
  'ON CONFLICT (token_hash, request_id) DO UPDATE SET request_name = excluded.request_name, response = excluded.response, ' +
  'created_at = excluded.created_at, expires_at = excluded.expires_at';
// One statement: a new key or an expired row is (re)written and returned; a live row is left and nothing is returned.
const CLAIM_NOTIFY =
  `INSERT INTO ${NOTIFY_TABLE} (source, notify_id, created_at, expires_at) VALUES ($1, $2, $3, $4) ` +
  `ON CONFLICT (source, notify_id) DO UPDATE SET created_at = excluded.created_at, expires_at = excluded.expires_at ` +
  `WHERE ${NOTIFY_TABLE}.expires_at <= $3 RETURNING created_at`;

const utf8 = new TextEncoder();

/** The stored envelope with `server_time_at` set to the response time, or `NAME_MISMATCH` for another request name. */
function replay(rows: readonly Readonly<Record<string, unknown>>[], request_name: string, response_time: bigint): Uint8Array | null | NameMismatch {
  const row = rows[0];
  if (row === undefined) return null;
  if (row['request_name'] !== request_name) return NAME_MISMATCH;
  const stored = row['response'];
  const envelope = stored instanceof Uint8Array ? ResponseEnvelope.decode(stored) : null;
  if (envelope === null) throw new Error(`stored response of request ${request_name} is not a ResponseEnvelope`);
  envelope.server_time_at = response_time;
  return envelope.encode();
}

function is_success(response: Uint8Array): boolean {
  const envelope = ResponseEnvelope.decode(response);
  if (envelope === null) throw new Error('response to save is not a ResponseEnvelope');
  return envelope.error === null;
}

function integer_setting(settings: Readonly<Record<string, unknown>>, key: SettingKey): bigint {
  const value = settings[key];
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) throw new TypeError(`idempotency: setting ${key} is not an integer`);
  return BigInt(value);
}

function module_of(modules: Readonly<Record<string, unknown>>, name: string, member: string): unknown {
  const module = modules[name] as Record<string, unknown> | undefined;
  if (typeof module?.[member] !== 'function') throw new TypeError(`idempotency: modules has no ${name}`);
  return module;
}

/** Makes `idempotency` for one server instance. A missing setting or dependency throws. */
export function create_idempotency(input: IdempotencyInput): IdempotencyModule {
  const storage = module_of(input.modules, 'storage', 'register_table') as IdempotencyStorage;
  const server_time = module_of(input.modules, 'server-time', 'clock_now') as IdempotencyServerTime;
  const settings = input.settings;
  const response_retention_ms = integer_setting(settings, 'idempotency.responseRetentionMs');
  const signature_window_ms = integer_setting(settings, 'session.signatureWindowMs');
  const retry_reach_ms = integer_setting(settings, 'NetworkCore.maxRetryAgeMs') + integer_setting(settings, 'NetworkCore.requestTimeoutMs');
  const notify_retention_ms = integer_setting(settings, 'idempotency.notifyRetentionMs');
  const max_notify_id_bytes = Number(integer_setting(settings, 'idempotency.maxNotifyIdBytes'));

  return {
    begin_start() {
      storage.register_table(
        RESPONSE_TABLE,
        'user',
        [
          { name: 'user_id', type: 'int64' },
          { name: 'request_id', type: 'string' },
          { name: 'request_name', type: 'string' },
          { name: 'response', type: 'bytes' },
          { name: 'created_at', type: 'int64' },
          { name: 'expires_at', type: 'int64' },
        ],
        ['user_id', 'request_id'],
        'expires_at',
        false,
      );
      storage.register_table(
        NOTIFY_TABLE,
        'game',
        [
          { name: 'source', type: 'string' },
          { name: 'notify_id', type: 'string' },
          { name: 'created_at', type: 'int64' },
          { name: 'expires_at', type: 'int64' },
        ],
        ['source', 'notify_id'],
        'expires_at',
        null,
      );
      storage.register_table(
        WITHDRAWN_TABLE,
        'game',
        [
          { name: 'token_hash', type: 'string' },
          { name: 'request_id', type: 'string' },
          { name: 'request_name', type: 'string' },
          { name: 'response', type: 'bytes' },
          { name: 'created_at', type: 'int64' },
          { name: 'expires_at', type: 'int64' },
        ],
        ['token_hash', 'request_id'],
        'expires_at',
        null,
      );
    },

    complete_start() {
      if (response_retention_ms <= 2n * signature_window_ms) {
        return `idempotency.responseRetentionMs (${String(response_retention_ms)}) is not greater than 2 x session.signatureWindowMs (${String(2n * signature_window_ms)})`;
      }
      if (response_retention_ms <= retry_reach_ms) {
        return `idempotency.responseRetentionMs (${String(response_retention_ms)}) is not greater than NetworkCore.maxRetryAgeMs + NetworkCore.requestTimeoutMs (${String(retry_reach_ms)})`;
      }
      return null;
    },

    stop() {},

    find_response(ctx) {
      const rows = storage.db(ctx).query(FIND_RESPONSE, [ctx.user_id, ctx.request_id, server_time.clock_now()]);
      return replay(rows, ctx.request_name, ctx.request_time);
    },

    find_committed_response(db, user_id, request_id, request_name, response_time) {
      const rows = db.query(FIND_RESPONSE, [user_id, request_id, server_time.clock_now()]);
      return replay(rows, request_name, response_time);
    },

    save_response(ctx, response) {
      if (ctx.user_deleted || !is_success(response)) return;
      const created_at = server_time.clock_now();
      storage
        .db(ctx)
        .query(SAVE_RESPONSE, [ctx.user_id, ctx.request_id, ctx.request_name, response, created_at, created_at + response_retention_ms]);
    },

    save_withdrawn_response(ctx, token_hash, response) {
      if (!ctx.user_deleted || !is_success(response)) return;
      const created_at = server_time.clock_now();
      storage
        .db(ctx)
        .query(SAVE_WITHDRAWN, [token_hash, ctx.request_id, ctx.request_name, response, created_at, created_at + response_retention_ms]);
    },

    find_withdrawn_response(db, token_hash, request_id, request_name, response_time) {
      const rows = db.query(FIND_WITHDRAWN, [token_hash, request_id, response_time]);
      return replay(rows, request_name, response_time);
    },

    has_response(db, user_id, request_id) {
      return db.query(HAS_RESPONSE, [user_id, request_id, server_time.clock_now()]).length > 0;
    },

    claim_notify(ctx_or_tx, source, notify_id) {
      const bytes = utf8.encode(notify_id).length;
      if (bytes < 1 || bytes > max_notify_id_bytes) {
        throw new Error(`notify ID of ${source} is ${String(bytes)} bytes, outside 1..${String(max_notify_id_bytes)}`);
      }
      const created_at = server_time.clock_now();
      const rows = storage.db(ctx_or_tx).query(CLAIM_NOTIFY, [source, notify_id, created_at, created_at + notify_retention_ms]);
      return rows.length > 0 ? 'FIRST' : 'DUPLICATE';
    },
  };
}
