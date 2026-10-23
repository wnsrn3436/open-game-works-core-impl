/**
 * user-snapshot-clone: exports a PROD user's stored state and chosen game state rows as a snapshot, read only, and
 * writes a snapshot over a user or game state rows of STG or DEV to reproduce a PROD problem.
 */
import * as CoreContract from '../../generated/contract/core_contract.ts';
import * as GameContract from '../../generated/contract/game_contract.ts';
import type { ServerTimeApi } from '../server-time/index.ts';
import { StorageMisuse, type DbHandle, type GameTx, type KindClass, type RawRow, type RequestCtx, type Storage } from '../storage/index.ts';
import type { Validation } from '../validation/index.ts';
import {
  check_snapshot_value,
  game_state_snapshot,
  parse_game_state_snapshot,
  parse_user_snapshot,
  raw_row_of,
  serialized_bytes,
  user_snapshot,
  with_key_field,
  type GameStateSnapshot,
  type SnapshotSource,
  type UserSnapshot,
} from './snapshot.ts';

/** The `storage` operations user-snapshot-clone calls. */
export type CloneStorage = Pick<
  Storage,
  | 'register_table'
  | 'db'
  | 'read_db'
  | 'run_user_transaction'
  | 'run_game_transaction'
  | 'lock_game_row'
  | 'get_user_record'
  | 'set_user_created_at'
  | 'sample_users'
  | 'read_user_rows'
  | 'replace_user_rows'
  | 'read_game_rows'
  | 'sample_game_rows'
  | 'replace_game_rows'
>;

/** The `server-time` operations user-snapshot-clone calls. */
export type CloneServerTime = Pick<ServerTimeApi, 'clock_now' | 'schedule_job'>;

/** The `validation` operations user-snapshot-clone calls (`validation` `## API`). */
export type CloneValidation = Pick<Validation, 'parse_version' | 'compare_versions'>;

/** The `session` operation user-snapshot-clone calls (`session` `## API`). */
export interface CloneSession {
  end_session(ctx: RequestCtx): void;
}

/** A log entry of `logging.write` (`logging` `## API`). */
export interface CloneLogEntry {
  readonly kind: 'audit' | 'error';
  readonly level: 'info' | 'error';
  readonly message: string;
  readonly user_id: bigint | null;
  readonly request_id: string | null;
  readonly request: string | null;
  readonly fields: Readonly<Record<string, bigint | string | null>>;
}

/** The `logging` operation user-snapshot-clone calls. */
export interface CloneLogging {
  write(entry: CloneLogEntry): void;
}

/** The `server` fields user-snapshot-clone reads (`server-core` `## module`). */
export interface CloneServer {
  readonly env: 'LOCAL' | 'DEV' | 'STG' | 'PROD';
  readonly data_version: string;
}

/** The module input (`server-core` `## module`). */
export interface UserSnapshotCloneInput {
  readonly settings: Readonly<Record<string, unknown>>;
  readonly modules: Readonly<Record<string, unknown>>;
  readonly server: CloneServer;
}

/** A failure reason of an admin operation's handler or prepare function (`admin-api` `## API`). */
export type FailureReason = 'bad_request' | 'not_found' | 'conflict' | 'external_failed' | 'internal';

/** An input field type of an admin operation (`admin-api` `## API`). */
export type FieldType = { readonly kind: 'int64' } | { readonly kind: 'int32' } | { readonly kind: 'string' } | { readonly kind: 'array'; readonly element: FieldType };

export type AdminInput = Readonly<Record<string, unknown>>;
export type AdminOutput = Readonly<Record<string, unknown>>;

/** The admin operation object a module exports (`admin-api` `## API`). */
export interface AdminOperation {
  readonly name: string;
  readonly role: 'read' | 'ops';
  readonly body: 'json' | 'binary';
  readonly max_body_bytes: number | null;
  readonly input: Readonly<Record<string, { readonly type: FieldType; readonly optional: boolean }>>;
  readonly user_target: string | null;
  readonly handler: (input: AdminInput, transaction: RequestCtx | GameTx, prepared: unknown, body: Uint8Array | null) => AdminOutput | FailureReason;
  readonly prepare: ((input: AdminInput, body: Uint8Array | null) => unknown) | null;
  readonly audit_args: ((input: AdminInput, body: Uint8Array | null) => AdminOutput) | null;
}

/** A clone record (`### clone wipe`). */
export interface CloneRecord {
  readonly target_user_id: bigint;
  readonly source_environment: string;
  readonly source_user_id: bigint;
  readonly cloned_at: bigint;
  readonly expires_at: bigint;
}

export interface UserSnapshotClone {
  readonly export_user_snapshot: AdminOperation;
  readonly sample_user_ids: AdminOperation;
  readonly import_user_snapshot: AdminOperation;
  readonly list_clones: AdminOperation;
  readonly wipe_clone: AdminOperation;
  readonly export_game_state: AdminOperation;
  readonly sample_game_state: AdminOperation;
  readonly import_game_state: AdminOperation;
  /** Internal operation for `migration` DEV code: `import_user_snapshot` check 2 on a JSON value. Reads and writes nothing. */
  check_snapshot(snapshot: unknown, game_state: boolean): 'OK' | 'bad_request';
  begin_start(): void;
  complete_start(): string | null;
  stop(): void;
}

const CLONE_TABLE = 'user_snapshot_clone_record';
const SWEEP_JOB = 'user_snapshot_clone_sweep';

const CLONE_COLUMNS = 'target_user_id, source_environment, source_user_id, cloned_at, expires_at';
const READ_CLONE = `SELECT ${CLONE_COLUMNS} FROM ${CLONE_TABLE} WHERE target_user_id = $1`;
const LIST_CLONES = `SELECT ${CLONE_COLUMNS} FROM ${CLONE_TABLE} ORDER BY target_user_id`;
const EXPIRED_CLONES = `SELECT target_user_id FROM ${CLONE_TABLE} WHERE expires_at <= $1 ORDER BY target_user_id`;
const DELETE_CLONE = `DELETE FROM ${CLONE_TABLE} WHERE target_user_id = $1`;
const WRITE_CLONE =
  `INSERT INTO ${CLONE_TABLE} (${CLONE_COLUMNS}) VALUES ($1, $2, $3, $4, $5) ` +
  'ON CONFLICT (target_user_id) DO UPDATE SET source_environment = excluded.source_environment, ' +
  'source_user_id = excluded.source_user_id, cloned_at = excluded.cloned_at, expires_at = excluded.expires_at';

type SettingKey = 'user-snapshot-clone.maxSnapshotBytes' | 'user-snapshot-clone.maxSampleCount' | 'user-snapshot-clone.cloneRetentionMs' | 'user-snapshot-clone.sweepIntervalMs';

function integer_setting(settings: Readonly<Record<string, unknown>>, key: SettingKey): number {
  const value = settings[key];
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) throw new TypeError(`user-snapshot-clone: setting ${key} is not an integer`);
  return value;
}

function string_setting(settings: Readonly<Record<string, unknown>>, key: string): string {
  const value = settings[key];
  if (typeof value !== 'string') throw new TypeError(`user-snapshot-clone: setting ${key} is not a string`);
  return value;
}

/** The module object `name` of `modules`, checked by one of its methods. */
function module_of(modules: Readonly<Record<string, unknown>>, name: string, member: string): unknown {
  const module = modules[name] as Record<string, unknown> | undefined;
  if (typeof module?.[member] !== 'function') throw new TypeError(`user-snapshot-clone: modules has no ${name}`);
  return module;
}

function big(value: unknown): bigint {
  if (typeof value === 'bigint') return value;
  if (typeof value === 'number' || typeof value === 'string') return BigInt(value);
  throw new TypeError(`user-snapshot-clone: ${String(value)} is not an integer`);
}

function clone_of(row: Readonly<Record<string, unknown>>): CloneRecord {
  return {
    target_user_id: big(row['target_user_id']),
    source_environment: String(row['source_environment']),
    source_user_id: big(row['source_user_id']),
    cloned_at: big(row['cloned_at']),
    expires_at: big(row['expires_at']),
  };
}

function read_clone(db: DbHandle, target_user_id: bigint): CloneRecord | null {
  const row = db.query(READ_CLONE, [target_user_id])[0];
  return row === undefined ? null : clone_of(row);
}

/** The game state kinds of this server's contract (`game_state.proto`), by kind message name. */
function game_state_kinds(): ReadonlyMap<string, CoreContract.KindInfo> {
  return new Map([...CoreContract.KINDS, ...GameContract.KINDS].filter((k) => k.store === 'game_state').map((k) => [k.name, k]));
}

/**
 * A body parser that parses each body once. `admin-api` passes the same body to `audit_args` and then to `prepare`,
 * and a parse is proportional to the body size.
 */
function parse_once<T>(parse: (body: Uint8Array) => T | null): (body: Uint8Array | null) => T | null {
  const parsed = new WeakMap<Uint8Array, T | null>();
  return (body) => {
    if (body === null) return null;
    if (parsed.has(body)) return parsed.get(body) ?? null;
    const value = parse(body);
    parsed.set(body, value);
    return value;
  };
}

/** What a clone wipe needs to know besides the target user (`### clone wipe`). */
interface WipeCondition {
  /** `wipe_clone`'s `cloned_at`: the re-read clone record must have it. */
  readonly cloned_at: bigint | null;
  /** The sweep job: the re-read clone record must have reached `expires_at`. */
  readonly expired: boolean;
  /** The `request` field of the `audit` log. */
  readonly request: string | null;
}

/** Makes `user-snapshot-clone` for one server instance. A missing setting or dependency throws. */
export function create_user_snapshot_clone(input: UserSnapshotCloneInput): UserSnapshotClone {
  const validation = module_of(input.modules, 'validation', 'parse_version') as CloneValidation;
  const storage = module_of(input.modules, 'storage', 'read_user_rows') as CloneStorage;
  const session = module_of(input.modules, 'session', 'end_session') as CloneSession;
  const server_time = module_of(input.modules, 'server-time', 'clock_now') as CloneServerTime;
  const logging = module_of(input.modules, 'logging', 'write') as CloneLogging;
  const { settings, server } = input;
  const max_snapshot_bytes = integer_setting(settings, 'user-snapshot-clone.maxSnapshotBytes');
  const max_sample_count = integer_setting(settings, 'user-snapshot-clone.maxSampleCount');
  const clone_retention_ms = BigInt(integer_setting(settings, 'user-snapshot-clone.cloneRetentionMs'));
  const sweep_interval_ms = BigInt(integer_setting(settings, 'user-snapshot-clone.sweepIntervalMs'));
  const app_id = string_setting(settings, 'appId');
  const core_version_text = string_setting(settings, 'coreVersion');
  const parse_version = (text: string) => validation.parse_version(text);
  const core_version = parse_version(core_version_text);
  if (core_version === null) throw new TypeError(`user-snapshot-clone: setting coreVersion ${core_version_text} is not <major>.<minor>.<patch>`);
  const contract_version = GameContract.CONTRACT_VERSION;
  const kinds = game_state_kinds();
  const user_snapshot_of = parse_once((body) => parse_user_snapshot(body, parse_version));
  const game_state_snapshot_of = parse_once((body) => parse_game_state_snapshot(body, parse_version));

  const source = (): SnapshotSource => ({
    app_id,
    source_environment: server.env,
    exported_at: server_time.clock_now(),
    contract_version,
    data_version: server.data_version,
    core_version: core_version_text,
  });

  /** `import_user_snapshot` checks 1, 3 and 4 on a snapshot that passed check 2. */
  const import_checks = (snapshot: GameStateSnapshot): FailureReason | null => {
    if (snapshot.app_id !== app_id) return 'conflict';
    if (snapshot.contract_version > contract_version || snapshot.records.some((r) => r.contract_version > contract_version)) return 'conflict';
    const version = parse_version(snapshot.core_version);
    if (version === null) return 'bad_request';
    if (validation.compare_versions(version, core_version) > 0) return 'conflict';
    return null;
  };

  const write_audit = (target_user_id: bigint, source_user_id: bigint, request: string | null): void => {
    logging.write({
      kind: 'audit',
      level: 'info',
      message: 'clone wiped',
      user_id: target_user_id,
      request_id: null,
      request,
      fields: { reason: 'clone_wiped', target_user_id, source_user_id },
    });
  };

  /** Whether the re-read clone record is the one the wipe is for. */
  const wipes = (record: CloneRecord | null, condition: WipeCondition): record is CloneRecord => {
    if (record === null) return false;
    if (condition.cloned_at !== null && record.cloned_at !== condition.cloned_at) return false;
    return !condition.expired || record.expires_at <= server_time.clock_now();
  };

  /**
   * One clone wipe (`### clone wipe`): the deleted clone record, null when nothing was deleted, or `FAILED` when
   * a transaction failed.
   */
  const clone_wipe = async (target_user_id: bigint, condition: WipeCondition): Promise<CloneRecord | null | 'FAILED'> => {
    let wiped: CloneRecord | null = null;
    const result = await storage.run_user_transaction(target_user_id, (ctx) => {
      if (storage.lock_game_row(ctx, CLONE_TABLE, [target_user_id]) === 'FAILED') return CoreContract.CoreError.CORE_ERROR_INTERNAL;
      const record = read_clone(storage.db(ctx), target_user_id);
      if (!wipes(record, condition)) return 'pass';
      storage.replace_user_rows(ctx, []);
      session.end_session(ctx);
      storage.db(ctx).query(DELETE_CLONE, [target_user_id]);
      wiped = record;
      return 'pass';
    });
    if (result === 'WITHDRAWN') {
      const deleted = await storage.run_game_transaction((tx) => {
        if (storage.lock_game_row(tx, CLONE_TABLE, [target_user_id]) === 'FAILED') return 'FAILED';
        const record = read_clone(storage.db(tx), target_user_id);
        if (!wipes(record, condition)) return null;
        storage.db(tx).query(DELETE_CLONE, [target_user_id]);
        return record;
      });
      if (deleted === 'FAILED') return 'FAILED';
      wiped = deleted;
    } else if (result !== 'COMMITTED') {
      return 'FAILED';
    }
    if (wiped !== null) write_audit(target_user_id, wiped.source_user_id, condition.request);
    return wiped;
  };

  /** The job `user_snapshot_clone_sweep`: a clone wipe of every expired clone record. */
  const sweep = async (): Promise<void> => {
    let targets: bigint[];
    try {
      targets = storage
        .read_db()
        .query(EXPIRED_CLONES, [server_time.clock_now()])
        .map((row) => big(row['target_user_id']));
    } catch (error) {
      log_error('clone sweep could not read expired clone records', null, error);
      return;
    }
    for (const target of targets) {
      let result: CloneRecord | null | 'FAILED';
      try {
        result = await clone_wipe(target, { cloned_at: null, expired: true, request: null });
      } catch (error) {
        log_error('clone sweep failed', target, error);
        continue;
      }
      if (result === 'FAILED') log_error('clone sweep failed', target, null);
    }
  };

  const log_error = (message: string, user_id: bigint | null, error: unknown): void => {
    logging.write({
      kind: 'error',
      level: 'error',
      message,
      user_id,
      request_id: null,
      request: null,
      fields: { stack_trace: error instanceof Error ? (error.stack ?? error.message) : null },
    });
  };

  const export_user_snapshot: AdminOperation = {
    name: 'export_user_snapshot',
    role: 'read',
    body: 'json',
    max_body_bytes: null,
    input: { user_id: { type: { kind: 'int64' }, optional: false } },
    user_target: 'user_id',
    handler: (_input, transaction) => {
      const ctx = transaction as RequestCtx;
      const rows = storage.read_user_rows(ctx);
      const record = storage.get_user_record(storage.db(ctx), ctx.user_id);
      if (record === null) return 'not_found';
      const snapshot = user_snapshot(source(), ctx.user_id, record.created_at, rows);
      if (serialized_bytes(snapshot) > max_snapshot_bytes) return 'conflict';
      return snapshot as unknown as AdminOutput;
    },
    prepare: null,
    audit_args: null,
  };

  const sample_user_ids: AdminOperation = {
    name: 'sample_user_ids',
    role: 'read',
    body: 'json',
    max_body_bytes: null,
    input: { count: { type: { kind: 'int32' }, optional: false } },
    user_target: null,
    handler: (input, transaction) => {
      const count = input['count'] as number;
      if (count < 1 || count > max_sample_count) return 'bad_request';
      return { user_ids: storage.sample_users(storage.db(transaction), count) };
    },
    prepare: null,
    audit_args: null,
  };

  const import_user_snapshot: AdminOperation = {
    name: 'import_user_snapshot',
    role: 'ops',
    body: 'binary',
    max_body_bytes: max_snapshot_bytes,
    input: { target_user_id: { type: { kind: 'int64' }, optional: false } },
    user_target: 'target_user_id',
    prepare: (_input, body) => {
      if (server.env === 'PROD') return 'conflict';
      const snapshot = user_snapshot_of(body);
      if (snapshot === null) return 'bad_request';
      const failure = import_checks(snapshot);
      return failure ?? snapshot;
    },
    handler: (_input, transaction, prepared) => {
      const ctx = transaction as RequestCtx;
      const snapshot = prepared as UserSnapshot;
      let replaced: number;
      try {
        replaced = storage.replace_user_rows(ctx, snapshot.records.map(raw_row_of));
      } catch (error) {
        // `replace_user_rows` throws, and changes nothing, on a record it does not take (check 5).
        if (error instanceof StorageMisuse) return 'bad_request';
        throw error;
      }
      storage.set_user_created_at(ctx, BigInt(snapshot.user_created_at));
      session.end_session(ctx);
      if (storage.lock_game_row(ctx, CLONE_TABLE, [ctx.user_id]) === 'FAILED') return 'internal';
      const cloned_at = server_time.clock_now();
      storage
        .db(ctx)
        .query(WRITE_CLONE, [ctx.user_id, snapshot.source_environment, BigInt(snapshot.source_user_id), cloned_at, cloned_at + clone_retention_ms]);
      return { replaced_records: replaced, data_version_matches: snapshot.data_version === server.data_version, data_version: server.data_version };
    },
    audit_args: (input, body) => {
      const snapshot = user_snapshot_of(body);
      return {
        source_environment: snapshot?.source_environment ?? null,
        source_user_id: snapshot?.source_user_id ?? null,
        sha256: snapshot?.sha256 ?? null,
        target_user_id: input['target_user_id'] ?? null,
      };
    },
  };

  const list_clones: AdminOperation = {
    name: 'list_clones',
    role: 'read',
    body: 'json',
    max_body_bytes: null,
    input: {},
    user_target: null,
    handler: (_input, transaction) => ({ clones: storage.db(transaction).query(LIST_CLONES).map(clone_of) }),
    prepare: null,
    audit_args: null,
  };

  const wipe_clone: AdminOperation = {
    name: 'wipe_clone',
    role: 'ops',
    body: 'json',
    max_body_bytes: null,
    input: { target_user_id: { type: { kind: 'int64' }, optional: false }, cloned_at: { type: { kind: 'int64' }, optional: true } },
    user_target: null,
    // The clone wipe runs here, outside the handler function's transaction. A failed transaction throws: 500.
    prepare: async (input) => {
      const target = input['target_user_id'] as bigint;
      const cloned_at = (input['cloned_at'] as bigint | undefined) ?? null;
      const result = await clone_wipe(target, { cloned_at, expired: false, request: 'wipe_clone' });
      if (result === 'FAILED') throw new Error(`clone wipe of user ${String(target)} failed`);
      return result === null ? 'not_found' : result;
    },
    handler: () => ({}),
    audit_args: null,
  };

  /** The game state kind of a `kind` input, or null when it is not one of `game_state.proto`. */
  const kind_class = (name: unknown): KindClass | null => {
    const info = typeof name === 'string' ? kinds.get(name) : undefined;
    return info === undefined ? null : info.kind_class;
  };

  const game_state_output = (rows: readonly RawRow[]): AdminOutput | FailureReason => {
    const snapshot = game_state_snapshot(source(), rows);
    if (serialized_bytes(snapshot) > max_snapshot_bytes) return 'conflict';
    return snapshot as unknown as AdminOutput;
  };

  const export_game_state: AdminOperation = {
    name: 'export_game_state',
    role: 'read',
    body: 'json',
    max_body_bytes: null,
    input: { kind: { type: { kind: 'string' }, optional: false }, keys: { type: { kind: 'array', element: { kind: 'int64' } }, optional: false } },
    user_target: null,
    handler: (input, transaction) => {
      const kind = kind_class(input['kind']);
      const keys = input['keys'] as readonly bigint[];
      if (kind === null || keys.length === 0 || keys.length > max_sample_count) return 'bad_request';
      if (keys.some((k) => k < 0n) || new Set(keys).size !== keys.length) return 'bad_request';
      return game_state_output(storage.read_game_rows(storage.db(transaction), kind, keys));
    },
    prepare: null,
    audit_args: null,
  };

  const sample_game_state: AdminOperation = {
    name: 'sample_game_state',
    role: 'read',
    body: 'json',
    max_body_bytes: null,
    input: { kind: { type: { kind: 'string' }, optional: false }, count: { type: { kind: 'int32' }, optional: false } },
    user_target: null,
    handler: (input, transaction) => {
      const kind = kind_class(input['kind']);
      const count = input['count'] as number;
      if (kind === null || count < 1 || count > max_sample_count) return 'bad_request';
      return game_state_output(storage.sample_game_rows(storage.db(transaction), kind, count));
    },
    prepare: null,
    audit_args: null,
  };

  /**
   * The raw rows to write for a game state snapshot that passed checks 1 to 4, or `bad_request` for a `target_key` the
   * snapshot cannot take. The table, kind and key checks are `storage.replace_game_rows`'s.
   */
  const game_rows = (snapshot: GameStateSnapshot, target_key: bigint | null): RawRow[] | 'bad_request' => {
    if (target_key !== null && (snapshot.records.length !== 1 || target_key < 0n)) return 'bad_request';
    const rows: RawRow[] = [];
    for (const record of snapshot.records) {
      const row = raw_row_of(record);
      if (target_key === null) {
        rows.push(row);
        continue;
      }
      const value = with_key_field(row.value, target_key);
      if (value === null) return 'bad_request';
      // A key without `/` names no kind column and is kept, so `replace_game_rows` refuses it.
      rows.push({ table: row.table, key: row.key.replace(/\/[^/]*$/, `/${String(target_key)}`), contract_version: row.contract_version, value });
    }
    return rows;
  };

  const import_game_state: AdminOperation = {
    name: 'import_game_state',
    role: 'ops',
    body: 'binary',
    max_body_bytes: max_snapshot_bytes,
    input: { target_key: { type: { kind: 'int64' }, optional: true } },
    user_target: null,
    prepare: (input, body) => {
      if (server.env === 'PROD') return 'conflict';
      const snapshot = game_state_snapshot_of(body);
      if (snapshot === null) return 'bad_request';
      const failure = import_checks(snapshot);
      if (failure !== null) return failure;
      const rows = game_rows(snapshot, (input['target_key'] as bigint | undefined) ?? null);
      return rows === 'bad_request' ? rows : { snapshot, rows };
    },
    handler: (_input, transaction, prepared) => {
      const { snapshot, rows } = prepared as { snapshot: GameStateSnapshot; rows: RawRow[] };
      let replaced: number | 'FAILED';
      try {
        replaced = storage.replace_game_rows(transaction as GameTx, rows);
      } catch (error) {
        if (error instanceof StorageMisuse) return 'bad_request';
        throw error;
      }
      if (replaced === 'FAILED') return 'internal';
      return { replaced_records: replaced, data_version_matches: snapshot.data_version === server.data_version, data_version: server.data_version };
    },
    audit_args: (input, body) => {
      const snapshot = game_state_snapshot_of(body);
      return {
        source_environment: snapshot?.source_environment ?? null,
        keys: snapshot?.records.map((r) => r.key) ?? [],
        sha256: snapshot?.sha256 ?? null,
        target_key: input['target_key'] ?? null,
      };
    },
  };

  return {
    export_user_snapshot,
    sample_user_ids,
    import_user_snapshot,
    list_clones,
    wipe_clone,
    export_game_state,
    sample_game_state,
    import_game_state,
    check_snapshot: (snapshot, game_state) => (check_snapshot_value(snapshot, game_state, parse_version) ? 'OK' : 'bad_request'),
    begin_start() {
      storage.register_table(
        CLONE_TABLE,
        'game',
        [
          { name: 'target_user_id', type: 'int64' },
          { name: 'source_environment', type: 'string' },
          { name: 'source_user_id', type: 'int64' },
          { name: 'cloned_at', type: 'int64' },
          { name: 'expires_at', type: 'int64' },
        ],
        ['target_user_id'],
        null,
        null,
        'target_user_id',
        [['expires_at']],
      );
      server_time.schedule_job(SWEEP_JOB, sweep_interval_ms, sweep);
    },
    complete_start: () => null,
    stop() {},
  };
}
