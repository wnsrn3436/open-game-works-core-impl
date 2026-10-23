import * as CoreContract from '../../generated/contract/core_contract.ts';
import type { LogEntry, LogFields } from '../logging/index.ts';
import type { ServerTimeApi } from '../server-time/index.ts';
import type { ColumnInput, DbHandle, GameTx, RequestCtx, Storage } from '../storage/index.ts';

/** The block row table (`user` scope, key `(user_id, blocked_id)`, in the user snapshot). */
export const BLOCK_TABLE = 'block_report_block';
/** The report row table (`game` scope, key `report_id`, expiry column `expires_at`). */
export const REPORT_TABLE = 'block_report_report';
/** The table of the one row holding the last given `report_id` (`game` scope, key `id`). */
export const SEQUENCE_TABLE = 'block_report_sequence';
/** The report count counter table (`user` scope, key `user_id`, expiry column `expires_at`, not in the user snapshot). */
export const COUNT_TABLE = 'block_report_count';

const MODULE = 'block-report';
const REASON_TABLE = 'report_reason';

type DbParam = NonNullable<Parameters<DbHandle['query']>[1]>[number];
const SEQUENCE_ID = 0n;

/** The `storage` operations block-report calls (`storage` `## API`). */
export type BlockReportStorage = Pick<Storage, 'register_table' | 'db' | 'lock_game_row'>;

/** The `server-time` operations block-report calls (`server-time` `## API`). */
export type BlockReportServerTime = Pick<ServerTimeApi, 'now' | 'clock_now' | 'get_window_start'>;

/** The `logging` operation block-report calls (`logging` `## API`). */
export interface BlockReportLogging {
  write(entry: LogEntry): null;
}

/** The `validation` operations block-report calls (`validation` `## API`). */
export interface BlockReportValidation {
  has_table_id(table: string, id: number): boolean;
  is_plain_text(text: string, max_code_points: number): boolean;
}

/** The `public-profile` operations block-report calls (`public-profile` `## API`). */
export interface BlockReportPublicProfile {
  is_active_user(ctx: RequestCtx, user_id: bigint): boolean;
  get_public_profiles(ctx: RequestCtx, user_ids: readonly bigint[]): CoreContract.PublicProfileEntry[];
}

/** `ReportResult` of `add_report`. */
export type ReportResult = 'OK' | 'LIMIT' | 'INVALID_INPUT';

/** A function `register_block_listener` takes: called in the `BlockUser` transaction after the block row is written. */
export type BlockListener = (ctx: RequestCtx, blocker_id: bigint, blocked_id: bigint) => void;

type InvalidRequest = typeof CoreContract.CoreError.CORE_ERROR_INVALID_REQUEST;
type UserNotFound = typeof CoreContract.CoreError.CORE_ERROR_USER_NOT_FOUND;
type BlockLimit = typeof CoreContract.CoreError.CORE_ERROR_BLOCK_LIMIT;
type ReportLimit = typeof CoreContract.CoreError.CORE_ERROR_REPORT_LIMIT;

/** The handlers of the core `rpc`s of block-report. */
export type BlockUserHandler = (ctx: RequestCtx, request: CoreContract.BlockUserRequest) => CoreContract.BlockUserResponse | InvalidRequest | UserNotFound | BlockLimit;
export type UnblockUserHandler = (ctx: RequestCtx, request: CoreContract.UnblockUserRequest) => CoreContract.UnblockUserResponse | InvalidRequest;
export type GetBlockedUsersHandler = (ctx: RequestCtx, request: CoreContract.GetBlockedUsersRequest) => CoreContract.GetBlockedUsersResponse;
export type ReportUserHandler = (ctx: RequestCtx, request: CoreContract.ReportUserRequest) => CoreContract.ReportUserResponse | InvalidRequest | UserNotFound | ReportLimit;

/** A failure reason of an admin operation handler (`admin-api`). */
export type AdminFailure = 'bad_request' | 'not_found' | 'conflict' | 'external_failed' | 'internal';

type AdminFieldType = { readonly kind: 'int64' | 'int32' | 'string' } | { readonly kind: 'enum'; readonly elements: readonly string[] };

/** An admin operation object (`admin-api`): `routing` hands it to `admin-api.register_admin_operation`. */
export interface AdminOperation {
  readonly name: string;
  readonly role: 'read' | 'ops';
  readonly body: 'json';
  readonly max_body_bytes: null;
  readonly input: Readonly<Record<string, { readonly type: AdminFieldType; readonly optional: boolean }>>;
  readonly user_target: null;
  readonly handler: (input: Readonly<Record<string, unknown>>, tx: GameTx, prepare_value: unknown, body: Uint8Array | null) => Record<string, unknown> | AdminFailure;
  readonly prepare: null;
  readonly audit_args: null;
}

/** The `## API` operations of block-report. */
export interface BlockReportApi {
  BlockUser: BlockUserHandler;
  UnblockUser: UnblockUserHandler;
  GetBlockedUsers: GetBlockedUsersHandler;
  ReportUser: ReportUserHandler;
  is_blocked(ctx: RequestCtx, blocker_id: bigint, blocked_id: bigint): boolean;
  is_blocked_either(ctx: RequestCtx, a: bigint, b: bigint): boolean;
  list_blocked_ids(ctx: RequestCtx, user_id: bigint): bigint[];
  add_report(
    ctx: RequestCtx,
    target_id: bigint,
    reason_id: number,
    context: CoreContract.ReportContext,
    ref: string,
    comment: string,
    evidence: string,
  ): ReportResult;
  /** Throws after `complete_start`; a second registration of the same function fails server start. */
  register_block_listener(listener: BlockListener): null;
  remove_user(ctx: RequestCtx): null;
  readonly list_reports: AdminOperation;
  readonly resolve_report: AdminOperation;
}

/** block-report of one server instance: the `## API` operations and the lifecycle of `server-core` `## module`. */
export interface BlockReport extends BlockReportApi {
  begin_start(): void;
  complete_start(): string | null;
  stop(): void;
}

/**
 * The module input (`server-core` `## module`): `settings` holds the `block-report` core settings, `modules` the
 * module objects of `storage`, `server-time`, `logging`, `validation` and `public-profile`. block-report reads nothing
 * of `server`.
 */
export interface BlockReportInput {
  readonly settings: Readonly<Record<string, unknown>>;
  readonly modules: Readonly<Record<string, unknown>>;
  readonly server?: unknown;
}

const CoreError = CoreContract.CoreError;
const INVALID_REQUEST: InvalidRequest = CoreError.CORE_ERROR_INVALID_REQUEST;
const USER_NOT_FOUND: UserNotFound = CoreError.CORE_ERROR_USER_NOT_FOUND;
const BLOCK_LIMIT: BlockLimit = CoreError.CORE_ERROR_BLOCK_LIMIT;
const REPORT_LIMIT: ReportLimit = CoreError.CORE_ERROR_REPORT_LIMIT;

const OPEN = 'Open';
const RESOLVED = 'Resolved';

/** Element names of `ReportContext` by value, without `_UNSPECIFIED`. */
const CONTEXT_NAMES: ReadonlyMap<number, string> = new Map(
  Object.entries(CoreContract.ReportContext)
    .filter(([, value]) => value !== CoreContract.ReportContext.REPORT_CONTEXT_UNSPECIFIED)
    .map(([name, value]) => [value, name]),
);

const BLOCK_COLUMNS: readonly ColumnInput[] = [
  { name: 'user_id', type: 'int64' },
  { name: 'blocked_id', type: 'int64' },
  { name: 'created_at', type: 'int64' },
];

const REPORT_COLUMNS: readonly ColumnInput[] = [
  { name: 'report_id', type: 'int64' },
  { name: 'reporter_id', type: 'int64' },
  { name: 'target_id', type: 'int64' },
  { name: 'reason_id', type: 'int32' },
  { name: 'context', type: 'string' },
  { name: 'ref', type: 'string' },
  { name: 'comment', type: 'string' },
  { name: 'evidence', type: 'string' },
  { name: 'status', type: 'string' },
  { name: 'created_at', type: 'int64' },
  { name: 'resolved_at', type: 'int64' },
  { name: 'resolution', type: 'string' },
  { name: 'expires_at', type: 'int64?' },
];

const SEQUENCE_COLUMNS: readonly ColumnInput[] = [
  { name: 'id', type: 'int64' },
  { name: 'last_report_id', type: 'int64' },
];

const COUNT_COLUMNS: readonly ColumnInput[] = [
  { name: 'user_id', type: 'int64' },
  { name: 'window_start', type: 'int64' },
  { name: 'count', type: 'int64' },
  { name: 'expires_at', type: 'int64' },
];

const REPORT_FIELDS = 'report_id, reporter_id, target_id, reason_id, context, ref, comment, evidence, status, created_at, resolved_at, resolution, expires_at';

const INT64 = { kind: 'int64' } as const;
const INT32 = { kind: 'int32' } as const;
const STRING = { kind: 'string' } as const;

interface Settings {
  readonly max_blocks: number;
  readonly report_window_ms: bigint;
  readonly max_reports_per_window: bigint;
  readonly report_retention_ms: bigint;
  readonly max_ref_bytes: number;
  readonly max_comment_length: number;
  readonly max_evidence_bytes: number;
}

function integer_setting(settings: Readonly<Record<string, unknown>>, key: string): number {
  const value = settings[key];
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new TypeError(`${MODULE}: setting ${key} is not an integer of 0 or more`);
  }
  return value;
}

function read_settings(settings: Readonly<Record<string, unknown>>): Settings {
  return {
    max_blocks: integer_setting(settings, 'block-report.maxBlocks'),
    report_window_ms: BigInt(integer_setting(settings, 'block-report.reportWindowMs')),
    max_reports_per_window: BigInt(integer_setting(settings, 'block-report.maxReportsPerWindow')),
    report_retention_ms: BigInt(integer_setting(settings, 'block-report.reportRetentionMs')),
    max_ref_bytes: integer_setting(settings, 'block-report.maxRefBytes'),
    max_comment_length: integer_setting(settings, 'block-report.maxCommentLength'),
    max_evidence_bytes: integer_setting(settings, 'block-report.maxEvidenceBytes'),
  };
}

function required_module<T>(modules: Readonly<Record<string, unknown>>, name: string, methods: readonly (keyof T & string)[]): T {
  const module = modules[name];
  if (typeof module !== 'object' || module === null) throw new TypeError(`${MODULE}: module ${name} is missing`);
  const record = module as Record<string, unknown>;
  const missing = methods.find((method) => typeof record[method] !== 'function');
  if (missing !== undefined) throw new TypeError(`${MODULE}: module ${name} has no ${missing}`);
  return module as T;
}

function int64_of(value: unknown, table: string, column: string): bigint {
  if (typeof value !== 'bigint') throw new TypeError(`${MODULE}: ${table}.${column} is not an int64`);
  return value;
}

function utf8_bytes(text: string): number {
  return Buffer.byteLength(text, 'utf8');
}

/** A report row as the admin operation output object: column names as keys, `expires_at` null while `Open`. */
function report_of(row: Readonly<Record<string, unknown>>): Record<string, unknown> {
  return {
    report_id: row.report_id,
    reporter_id: row.reporter_id,
    target_id: row.target_id,
    reason_id: row.reason_id,
    context: row.context,
    ref: row.ref,
    comment: row.comment,
    evidence: row.evidence,
    status: row.status,
    created_at: row.created_at,
    resolved_at: row.resolved_at,
    resolution: row.resolution,
    expires_at: row.expires_at,
  };
}

/**
 * Makes block-report for one server instance and registers its tables. A missing setting or module throws.
 */
export function create_block_report(input: BlockReportInput): BlockReport {
  const settings = read_settings(input.settings);
  const storage = required_module<BlockReportStorage>(input.modules, 'storage', ['register_table', 'db', 'lock_game_row']);
  const time = required_module<BlockReportServerTime>(input.modules, 'server-time', ['now', 'clock_now', 'get_window_start']);
  const logging = required_module<BlockReportLogging>(input.modules, 'logging', ['write']);
  const validation = required_module<BlockReportValidation>(input.modules, 'validation', ['has_table_id', 'is_plain_text']);
  const profiles = required_module<BlockReportPublicProfile>(input.modules, 'public-profile', ['is_active_user', 'get_public_profiles']);

  storage.register_table(BLOCK_TABLE, 'user', BLOCK_COLUMNS, ['user_id', 'blocked_id'], null, true);
  storage.register_table(REPORT_TABLE, 'game', REPORT_COLUMNS, ['report_id'], 'expires_at', null, 'reporter_id', [
    ['reporter_id', 'target_id', 'context', 'ref'],
    ['target_id'],
    ['status', 'created_at'],
  ]);
  storage.register_table(SEQUENCE_TABLE, 'game', SEQUENCE_COLUMNS, ['id'], null, null);
  storage.register_table(COUNT_TABLE, 'user', COUNT_COLUMNS, ['user_id'], 'expires_at', false);

  const listeners: BlockListener[] = [];
  const start_errors: string[] = [];
  let started = false;

  const core_log = (ctx: RequestCtx | null, level: 'info' | 'warn' | 'error', message: string, fields: LogFields): void => {
    const common = {
      level,
      message,
      user_id: ctx?.user_id ?? null,
      request_id: ctx === null || ctx.request_id === '' ? null : ctx.request_id,
      request: ctx === null || ctx.request_name === '' ? null : ctx.request_name,
    };
    if (level === 'error') logging.write({ kind: 'error', ...common, fields: { ...fields, stack_trace: null } });
    else logging.write({ kind: 'core', ...common, fields: { ...fields, module: MODULE } });
  };

  const blocked_rows = (db: DbHandle, user_id: bigint): { blocked_id: bigint; created_at: bigint }[] =>
    db
      .query(`SELECT blocked_id, created_at FROM ${BLOCK_TABLE} WHERE user_id = $1 ORDER BY blocked_id`, [user_id])
      .map((row) => ({ blocked_id: int64_of(row.blocked_id, BLOCK_TABLE, 'blocked_id'), created_at: int64_of(row.created_at, BLOCK_TABLE, 'created_at') }));

  const has_block = (db: DbHandle, blocker_id: bigint, blocked_id: bigint): boolean =>
    db.query(`SELECT 1 AS found FROM ${BLOCK_TABLE} WHERE user_id = $1 AND blocked_id = $2`, [blocker_id, blocked_id]).length > 0;

  /** The `ReportContext` element name of a valid `add_report` input, or null for the `INVALID_INPUT` conditions. */
  const valid_context_name = (reason_id: number, context: CoreContract.ReportContext, ref: string, comment: string, evidence: string): string | null => {
    const name = CONTEXT_NAMES.get(context);
    if (
      name === undefined ||
      !validation.has_table_id(REASON_TABLE, reason_id) ||
      utf8_bytes(ref) > settings.max_ref_bytes ||
      (comment !== '' && !validation.is_plain_text(comment, settings.max_comment_length)) ||
      utf8_bytes(evidence) > settings.max_evidence_bytes
    ) {
      return null;
    }
    return name;
  };

  /** `add_report`; `log_invalid` is false for `ReportUser`, whose `INVALID_INPUT` is `INVALID_REQUEST` without a log. */
  const add_report = (
    ctx: RequestCtx,
    target_id: bigint,
    reason_id: number,
    context: CoreContract.ReportContext,
    ref: string,
    comment: string,
    evidence: string,
    log_invalid: boolean,
  ): ReportResult => {
    const context_name = valid_context_name(reason_id, context, ref, comment, evidence);
    if (context_name === null) {
      if (log_invalid) core_log(ctx, 'error', 'add_report got an invalid input', { target_id, reason_id, context });
      return 'INVALID_INPUT';
    }
    const db = storage.db(ctx);
    const open = db.query(
      `SELECT report_id FROM ${REPORT_TABLE} WHERE reporter_id = $1 AND target_id = $2 AND context = $3 AND ref = $4 AND status = $5`,
      [ctx.user_id, target_id, context_name, ref, OPEN],
    );
    if (open.length > 0) return 'OK';

    const request_time = time.now(ctx);
    const clock_now = time.clock_now();
    const window_start = time.get_window_start(settings.report_window_ms, request_time);
    const window_end = window_start + settings.report_window_ms;
    const counted = db.query(`SELECT count FROM ${COUNT_TABLE} WHERE user_id = $1 AND window_start = $2 AND expires_at > $3`, [ctx.user_id, window_start, clock_now]);
    const count = counted.length === 0 ? 0n : int64_of(counted[0]?.count, COUNT_TABLE, 'count');
    if (count >= settings.max_reports_per_window) {
      core_log(ctx, 'warn', 'report limit reached', { reporter_id: ctx.user_id });
      return 'LIMIT';
    }

    if (storage.lock_game_row(ctx, SEQUENCE_TABLE, [SEQUENCE_ID]) === 'FAILED') {
      throw new Error(`${MODULE}: the ${SEQUENCE_TABLE} row lock wait went over its limit`);
    }
    const sequence = db.query(
      `INSERT INTO ${SEQUENCE_TABLE} (id, last_report_id) VALUES ($1, 1) ON CONFLICT (id) DO UPDATE SET last_report_id = ${SEQUENCE_TABLE}.last_report_id + 1 RETURNING last_report_id`,
      [SEQUENCE_ID],
    );
    const report_id = int64_of(sequence[0]?.last_report_id, SEQUENCE_TABLE, 'last_report_id');
    db.query(
      `INSERT INTO ${REPORT_TABLE} (${REPORT_FIELDS}) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
      [report_id, ctx.user_id, target_id, reason_id, context_name, ref, comment, evidence, OPEN, request_time, 0n, '', null],
    );
    db.query(
      `INSERT INTO ${COUNT_TABLE} (user_id, window_start, count, expires_at) VALUES ($1, $2, 1, $3) ON CONFLICT (user_id) DO UPDATE SET ` +
        `count = CASE WHEN ${COUNT_TABLE}.window_start = $2 AND ${COUNT_TABLE}.expires_at > $4 THEN ${COUNT_TABLE}.count + 1 ELSE 1 END, ` +
        `window_start = $2, expires_at = $3`,
      [ctx.user_id, window_start, window_end, clock_now],
    );
    core_log(ctx, 'info', 'report added', { report_id, target_id, reason_id });
    return 'OK';
  };

  const list_reports_handler = (input: Readonly<Record<string, unknown>>, tx: GameTx): Record<string, unknown> | AdminFailure => {
    const after_created_at = input.after_created_at as bigint | undefined;
    const after_report_id = input.after_report_id as bigint | undefined;
    if ((after_created_at === undefined) !== (after_report_id === undefined)) return 'bad_request';
    const params: DbParam[] = [input.status as string, input.from_at as bigint, input.to_at as bigint, time.clock_now()];
    let cursor = '';
    if (after_created_at !== undefined && after_report_id !== undefined) {
      params.push(after_created_at, after_report_id);
      cursor = ` AND (created_at > $5 OR (created_at = $5 AND report_id > $6))`;
    }
    params.push(input.limit as number);
    const rows = storage
      .db(tx)
      .query(
        `SELECT ${REPORT_FIELDS} FROM ${REPORT_TABLE} WHERE status = $1 AND created_at >= $2 AND created_at < $3 ` +
          `AND (expires_at IS NULL OR expires_at > $4)${cursor} ORDER BY created_at, report_id LIMIT $${String(params.length)}`,
        params,
      );
    return { reports: rows.map(report_of) };
  };

  const resolve_report_handler = (input: Readonly<Record<string, unknown>>, tx: GameTx): Record<string, unknown> | AdminFailure => {
    const report_id = input.report_id as bigint;
    const resolution = input.resolution as string;
    if (storage.lock_game_row(tx, REPORT_TABLE, [report_id]) === 'FAILED') return 'internal';
    const db = storage.db(tx);
    const clock_now = time.clock_now();
    const rows = db.query(`SELECT status FROM ${REPORT_TABLE} WHERE report_id = $1 AND (expires_at IS NULL OR expires_at > $2)`, [report_id, clock_now]);
    const row = rows[0];
    if (row === undefined) return 'not_found';
    if (row.status === RESOLVED) return 'conflict';
    if (resolution === '') return 'bad_request';
    db.query(`UPDATE ${REPORT_TABLE} SET status = $1, resolved_at = $2, expires_at = $3, resolution = $4 WHERE report_id = $5`, [
      RESOLVED,
      clock_now,
      clock_now + settings.report_retention_ms,
      resolution,
      report_id,
    ]);
    return {};
  };

  return {
    BlockUser: (ctx, request) => {
      const target = request.user_id;
      if (target === ctx.user_id) return INVALID_REQUEST;
      if (!profiles.is_active_user(ctx, target)) return USER_NOT_FOUND;
      const db = storage.db(ctx);
      if (has_block(db, ctx.user_id, target)) return new CoreContract.BlockUserResponse();
      let kept = 0;
      for (const row of blocked_rows(db, ctx.user_id)) {
        if (profiles.is_active_user(ctx, row.blocked_id)) kept += 1;
        else db.query(`DELETE FROM ${BLOCK_TABLE} WHERE user_id = $1 AND blocked_id = $2`, [ctx.user_id, row.blocked_id]);
      }
      if (kept >= settings.max_blocks) return BLOCK_LIMIT;
      db.query(`INSERT INTO ${BLOCK_TABLE} (user_id, blocked_id, created_at) VALUES ($1, $2, $3)`, [ctx.user_id, target, time.now(ctx)]);
      for (const listener of listeners) listener(ctx, ctx.user_id, target);
      return new CoreContract.BlockUserResponse();
    },
    UnblockUser: (ctx, request) => {
      if (request.user_id === ctx.user_id) return INVALID_REQUEST;
      storage.db(ctx).query(`DELETE FROM ${BLOCK_TABLE} WHERE user_id = $1 AND blocked_id = $2`, [ctx.user_id, request.user_id]);
      return new CoreContract.UnblockUserResponse();
    },
    GetBlockedUsers: (ctx) => {
      const rows = blocked_rows(storage.db(ctx), ctx.user_id);
      const response = new CoreContract.GetBlockedUsersResponse();
      if (rows.length === 0) return response;
      const by_id = new Map(profiles.get_public_profiles(ctx, rows.map((row) => row.blocked_id)).map((profile) => [profile.user_id, profile]));
      const entries: CoreContract.BlockedUserEntry[] = [];
      for (const row of rows) {
        const profile = by_id.get(row.blocked_id);
        if (profile === undefined) continue;
        const entry = new CoreContract.BlockedUserEntry();
        entry.profile = profile;
        entry.blocked_at = row.created_at;
        entries.push(entry);
      }
      entries.sort((a, b) => {
        if (a.blocked_at !== b.blocked_at) return a.blocked_at > b.blocked_at ? -1 : 1;
        const a_id = a.profile?.user_id ?? 0n;
        const b_id = b.profile?.user_id ?? 0n;
        return a_id < b_id ? -1 : a_id > b_id ? 1 : 0;
      });
      response.blocked = entries;
      return response;
    },
    ReportUser: (ctx, request) => {
      if (request.user_id === ctx.user_id) return INVALID_REQUEST;
      if (!profiles.is_active_user(ctx, request.user_id)) return USER_NOT_FOUND;
      const result = add_report(ctx, request.user_id, request.reason_id, request.context, request.ref, request.comment, '', false);
      if (result === 'LIMIT') return REPORT_LIMIT;
      if (result === 'INVALID_INPUT') return INVALID_REQUEST;
      return new CoreContract.ReportUserResponse();
    },
    is_blocked: (ctx, blocker_id, blocked_id) => has_block(storage.db(ctx), blocker_id, blocked_id),
    is_blocked_either: (ctx, a, b) => {
      const db = storage.db(ctx);
      return has_block(db, a, b) || has_block(db, b, a);
    },
    list_blocked_ids: (ctx, user_id) => blocked_rows(storage.db(ctx), user_id).map((row) => row.blocked_id),
    add_report: (ctx, target_id, reason_id, context, ref, comment, evidence) => add_report(ctx, target_id, reason_id, context, ref, comment, evidence, true),
    register_block_listener: (listener) => {
      if (started) throw new Error(`${MODULE}: register_block_listener was called after server start`);
      if (listeners.includes(listener)) {
        core_log(null, 'error', 'register_block_listener got the same function twice', {});
        start_errors.push(`${MODULE}: register_block_listener got the same function twice`);
        return null;
      }
      listeners.push(listener);
      return null;
    },
    remove_user: (ctx) => {
      storage.db(ctx).query(`UPDATE ${REPORT_TABLE} SET evidence = $1 WHERE target_id = $2`, ['', ctx.user_id]);
      return null;
    },
    list_reports: {
      name: 'list_reports',
      role: 'read',
      body: 'json',
      max_body_bytes: null,
      input: {
        status: { type: { kind: 'enum', elements: [OPEN, RESOLVED] }, optional: false },
        from_at: { type: INT64, optional: false },
        to_at: { type: INT64, optional: false },
        after_created_at: { type: INT64, optional: true },
        after_report_id: { type: INT64, optional: true },
        limit: { type: INT32, optional: false },
      },
      user_target: null,
      handler: (input, tx) => list_reports_handler(input, tx),
      prepare: null,
      audit_args: null,
    },
    resolve_report: {
      name: 'resolve_report',
      role: 'ops',
      body: 'json',
      max_body_bytes: null,
      input: {
        operation_id: { type: STRING, optional: false },
        report_id: { type: INT64, optional: false },
        resolution: { type: STRING, optional: false },
      },
      user_target: null,
      handler: (input, tx) => resolve_report_handler(input, tx),
      prepare: null,
      audit_args: null,
    },
    begin_start: () => {},
    complete_start: () => {
      started = true;
      return start_errors[0] ?? null;
    },
    stop: () => {},
  };
}
