/**
 * Device registration (`### device registration`), `queue_push` and `cancel_push` (`### schedule`), and the admin
 * operations of `push`.
 */
import * as CoreContract from '../../generated/contract/core_contract.ts';
import { log, utf8_length, type GameTx, type PushCore, type RequestCtx } from './core.ts';
import { PLATFORM_PROVIDER, PROVIDER_KEY } from './adapter.ts';
import {
  RECORD_SELECT, T_DEVICE, T_HELD, T_LOCK, T_RECORD, check_message, finish_params, finish_sql, insert_record, record_output, stored_args,
  type PushArg, type StoredArg, type Target,
} from './store.ts';

/** A `push_record` row that has not expired (`storage` `### expiry`); `$2` is `clock_now`. */
const LIVE = '(expires_at IS NULL OR expires_at > $2)';

const TIMEZONE_LIMIT = 86_399_999n;

/** The `ad_allowed` and `night_allowed` of the user's `ConsentUserState`. */
function consent_of(core: PushCore, ctx: RequestCtx): { ad: boolean; night: boolean } {
  const consent = core.storage.get_state(ctx, CoreContract.ConsentUserState, 0n) as CoreContract.ConsentUserState | null;
  return {
    ad: consent?.push_ad === CoreContract.ConsentChoice.CONSENT_CHOICE_GRANTED,
    night: consent?.push_night === CoreContract.ConsentChoice.CONSENT_CHOICE_GRANTED,
  };
}

/** The core `rpc` handler of `RegisterPushToken`. */
export function register_push_token(core: PushCore, ctx: RequestCtx, request: CoreContract.RegisterPushTokenRequest): CoreContract.RegisterPushTokenResponse | number {
  const invalid = CoreContract.CoreError.CORE_ERROR_INVALID_REQUEST;
  const provider = PLATFORM_PROVIDER[ctx.platform];
  if (provider === undefined || core.settings.adapters[PROVIDER_KEY[provider]] === null) return invalid;
  const token = request.device_token;
  if (token === '' || utf8_length(token) > core.settings.max_device_token_bytes) return invalid;
  if (!core.settings.supported_languages.includes(request.language)) return invalid;
  if (request.timezone_offset_ms < -TIMEZONE_LIMIT || request.timezone_offset_ms > TIMEZONE_LIMIT) return invalid;
  const consent = consent_of(core, ctx);
  const db = core.storage.db(ctx);
  db.query(`DELETE FROM ${T_DEVICE} WHERE user_id = $1 AND device_token <> $2`, [ctx.user_id, token]);
  db.query(
    `INSERT INTO ${T_DEVICE} (user_id, device_token, session_id, provider, language, timezone_offset_ms, ad_allowed, night_allowed, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     ON CONFLICT (device_token) DO UPDATE SET user_id = excluded.user_id, session_id = excluded.session_id, provider = excluded.provider,
       language = excluded.language, timezone_offset_ms = excluded.timezone_offset_ms, ad_allowed = excluded.ad_allowed,
       night_allowed = excluded.night_allowed, updated_at = excluded.updated_at`,
    [ctx.user_id, token, ctx.session_id, provider, request.language, request.timezone_offset_ms, consent.ad, consent.night, core.time.clock_now()],
  );
  return new CoreContract.RegisterPushTokenResponse();
}

/** `refresh_push_consent`: the user's device registration rows take the user's `ConsentUserState`. */
export function refresh_push_consent(core: PushCore, ctx: RequestCtx): void {
  const consent = consent_of(core, ctx);
  core.storage.db(ctx).query(`UPDATE ${T_DEVICE} SET ad_allowed = $2, night_allowed = $3 WHERE user_id = $1`, [ctx.user_id, consent.ad, consent.night]);
}

/** `remove_user`: the user's device registration rows go, and `SCHEDULED` records only for the user are canceled. */
export function remove_user(core: PushCore, ctx: RequestCtx): void {
  const db = core.storage.db(ctx);
  db.query(`DELETE FROM ${T_DEVICE} WHERE user_id = $1`, [ctx.user_id]);
  db.query(`DELETE FROM ${T_HELD} WHERE user_id = $1`, [ctx.user_id]);
  db.query(finish_sql(`target_user_id = $4 AND status = 'SCHEDULED'`), [...finish_params(core, 'CANCELED'), ctx.user_id]);
}

/** Locks `push_target_lock` of the target user; a wait over the limit throws, so the request is `INTERNAL`. */
function lock_target(core: PushCore, ctx: RequestCtx, user_id: bigint): void {
  if (core.storage.lock_game_row(ctx, T_LOCK, [user_id]) === 'FAILED') throw new Error(`push: push_target_lock of user ${String(user_id)} timed out`);
}

/** The time checks of a new record: `from` ≤ `send_at` ≤ `from` + `push.maxScheduleAheadMs`. */
function check_send_at(core: PushCore, send_at: bigint, from: bigint): string | null {
  return send_at < from || send_at > from + core.settings.max_schedule_ahead_ms ? `send_at ${String(send_at)} is out of range` : null;
}

/** `queue_push`: a `SCHEDULED` record for one user in the ctx transaction. Its push ID, or 0 when nothing is scheduled. */
export function queue_push(core: PushCore, ctx: RequestCtx, user_id: bigint, message_id: number, args: readonly PushArg[], send_at: bigint, dedupe_key: string): bigint {
  const stored = stored_args(args);
  const reason = stored === null
    ? 'args is not a PushArg list'
    : typeof dedupe_key !== 'string' || utf8_length(dedupe_key) > core.settings.max_dedupe_key_bytes
      ? 'dedupe_key is too long'
      : check_message(core, message_id, stored) ?? check_send_at(core, send_at, core.time.now(ctx));
  if (reason !== null || stored === null) {
    log(core, 'error', 'queue_push is not scheduled', { reason: reason ?? '', message_id }, ctx);
    return 0n;
  }
  lock_target(core, ctx, user_id);
  const db = core.storage.db(ctx);
  const [count] = db.query(`SELECT COUNT(*) AS n FROM ${T_RECORD} WHERE target_user_id = $1 AND status = 'SCHEDULED'`, [user_id]);
  if (BigInt(count?.n as bigint | number) >= BigInt(core.settings.max_scheduled_per_user)) {
    log(core, 'warn', 'queue_push is over the scheduled push limit of the user', { message_id }, ctx);
    return 0n;
  }
  if (dedupe_key !== '') cancel_scheduled(core, ctx, user_id, dedupe_key);
  return insert_record(core, db, { source: 'handler', message_id, args: stored, send_at, target: { user_ids: [user_id] }, dedupe_key });
}

function cancel_scheduled(core: PushCore, ctx: RequestCtx, user_id: bigint, dedupe_key: string): void {
  core.storage.db(ctx).query(finish_sql(`target_user_id = $4 AND dedupe_key = $5 AND status = 'SCHEDULED'`), [...finish_params(core, 'CANCELED'), user_id, dedupe_key]);
}

/** `cancel_push`: the `SCHEDULED` records of (user, `dedupe_key`) are canceled. An empty `dedupe_key` names none. */
export function cancel_push(core: PushCore, ctx: RequestCtx, user_id: bigint, dedupe_key: string): void {
  if (dedupe_key === '') return;
  lock_target(core, ctx, user_id);
  cancel_scheduled(core, ctx, user_id, dedupe_key);
}

/** The admin operation object of `admin-api` (`admin-api` `## API`). */
export interface AdminOperation {
  readonly name: string;
  readonly role: 'read' | 'ops';
  readonly body: 'json';
  readonly max_body_bytes: null;
  readonly input: Readonly<Record<string, FieldSpec>>;
  readonly user_target: null;
  readonly handler: (input: Record<string, unknown>, tx: GameTx, prepared: unknown, body: Uint8Array | null) => unknown;
  readonly prepare: null;
  readonly audit_args: null;
}

type FieldType =
  | { kind: 'int64' } | { kind: 'int32' } | { kind: 'string' }
  | { kind: 'array'; element: FieldType }
  | { kind: 'object'; fields: Record<string, FieldSpec> }
  | { kind: 'object_union'; fields: Record<string, FieldType> };

interface FieldSpec {
  readonly type: FieldType;
  readonly optional: boolean;
}

const req = (type: FieldType): FieldSpec => ({ type, optional: false });
const INT64: FieldType = { kind: 'int64' };
const STRINGS: FieldType = { kind: 'array', element: { kind: 'string' } };

function admin(name: string, role: 'read' | 'ops', input: Record<string, FieldSpec>, handler: AdminOperation['handler']): AdminOperation {
  return { name, role, body: 'json', max_body_bytes: null, input, user_target: null, handler, prepare: null, audit_args: null };
}

/** `schedule_push`, `cancel_scheduled_push`, `get_push`, `list_pushes`. Each handler runs in a game tx. */
export function admin_operations(core: PushCore): AdminOperation[] {
  const db = (tx: GameTx): ReturnType<PushCore['storage']['db']> => core.storage.db(tx);
  return [
    admin('schedule_push', 'ops', {
      operation_id: req({ kind: 'string' }),
      message_id: req({ kind: 'int32' }),
      args: req({ kind: 'array', element: { kind: 'object', fields: {
        name: req({ kind: 'string' }),
        value: req({ kind: 'object_union', fields: { int_value: INT64, text_value: { kind: 'string' } } }),
      } } }),
      send_at: req(INT64),
      target: req({ kind: 'object_union', fields: {
        user_ids: { kind: 'array', element: INT64 },
        filter: { kind: 'object', fields: { platforms: req(STRINGS), languages: req(STRINGS), active_within_ms: req(INT64) } },
      } }),
    }, (input, tx) => {
      const args = input.args as StoredArg[];
      const target = input.target as Target;
      const message_id = input.message_id as number;
      const send_at = input.send_at as bigint;
      const count = 'user_ids' in target ? target.user_ids.length : 1;
      if (count < 1 || count > core.settings.max_target_user_ids) return 'bad_request';
      if ('filter' in target && target.filter.active_within_ms < 0n) return 'bad_request';
      if (check_message(core, message_id, args) !== null || check_send_at(core, send_at, core.time.clock_now()) !== null) return 'bad_request';
      return { push_id: insert_record(core, db(tx), { source: 'operator', message_id, args, send_at, target, dedupe_key: '' }) };
    }),
    admin('cancel_scheduled_push', 'ops', { push_id: req(INT64) }, (input, tx) => {
      const push_id = input.push_id as bigint;
      // The changed row decides: a claim of job `push_send` that commits first leaves no `SCHEDULED` row to change.
      const changed = db(tx).query(`${finish_sql(`push_id = $4 AND status = 'SCHEDULED'`)} RETURNING push_id`, [...finish_params(core, 'CANCELED'), push_id]);
      if (changed.length > 0) return {};
      const [row] = db(tx).query(`SELECT status FROM ${T_RECORD} WHERE push_id = $1 AND ${LIVE}`, [push_id, core.time.clock_now()]);
      return row === undefined ? 'not_found' : 'conflict';
    }),
    admin('get_push', 'read', { push_id: req(INT64) }, (input, tx) => {
      const [row] = db(tx).query(`SELECT ${RECORD_SELECT} FROM ${T_RECORD} WHERE push_id = $1 AND ${LIVE}`, [input.push_id as bigint, core.time.clock_now()]);
      return row === undefined ? 'not_found' : record_output(row);
    }),
    admin('list_pushes', 'read', { from_at: req(INT64), to_at: req(INT64), limit: req({ kind: 'int32' }) }, (input, tx) => {
      const rows = db(tx).query(
        `SELECT ${RECORD_SELECT} FROM ${T_RECORD} WHERE send_at >= $1 AND send_at < $2 AND (expires_at IS NULL OR expires_at > $4)
         ORDER BY send_at, push_id LIMIT $3`,
        [input.from_at as bigint, input.to_at as bigint, input.limit as number, core.time.clock_now()],
      );
      return { pushes: rows.map(record_output) };
    }),
  ];
}
