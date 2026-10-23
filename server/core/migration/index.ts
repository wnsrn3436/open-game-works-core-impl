/**
 * migration: the converters that bring stored UserState, server state and game state items to the meaning of the
 * current contract, the read conversion `convert_item` that `storage` calls, and the batch that converts every user
 * without a request.
 */
import { randomBytes } from 'node:crypto';
import * as CoreContract from '../../generated/contract/core_contract.ts';
import * as GameContract from '../../generated/contract/game_contract.ts';
import type * as GameData from '../../generated/data/game_data.ts';
import type { ServerTimeApi } from '../server-time/index.ts';
import type { DbHandle, GameTx, KindClass, KindValue, Storage } from '../storage/index.ts';

/** The `storage` operations migration calls. */
export type MigrationStorage = Pick<
  Storage,
  'register_table' | 'register_item_converter' | 'run_game_transaction' | 'run_user_transaction' | 'upgrade_user_rows' | 'scan_users' | 'lock_game_row' | 'db' | 'read_db'
>;

/** The `user-snapshot-clone` operation the DEV code of migration calls. */
export interface MigrationSnapshotClone {
  check_snapshot(snapshot: unknown, game_state: boolean): 'OK' | 'bad_request';
}

/** The `server-time` operations migration calls. */
export type MigrationServerTime = Pick<ServerTimeApi, 'clock_now' | 'schedule_job'>;

/** A `logging` log entry (`logging` `## API`); `write` adds `time`. */
export interface LogEntry {
  readonly kind: 'error' | 'core';
  readonly level: 'debug' | 'info' | 'warn' | 'error';
  readonly message: string;
  readonly user_id: bigint | null;
  readonly request_id: string | null;
  readonly request: string | null;
  readonly fields: Readonly<Record<string, unknown>>;
}

/** The `logging` operation migration calls. */
export interface MigrationLogging {
  write(entry: LogEntry): void;
}

/** The kinds, the contract version and the `(ogw.converters)` list migration works with. */
export interface MigrationContract {
  readonly core_kinds: readonly CoreContract.KindInfo[];
  readonly game_kinds: readonly CoreContract.KindInfo[];
  readonly contract_version: number;
  readonly converters: readonly { readonly kind: string; readonly from_version: number }[];
}

/** The module input (`server-core` `## module`). migration reads the server build data of `server`. */
export interface MigrationInput {
  readonly settings: Readonly<Record<string, unknown>>;
  readonly modules: Readonly<Record<string, unknown>>;
  readonly server: { readonly data: GameData.DataSet };
}

/** The delete result of a converter. */
export const DELETE = 'DELETE';
export type Delete = typeof DELETE;

/** A converter hook: the item decoded as the current kind message and the server data, to the item or `DELETE`. */
export type Converter = (item: KindValue, data: GameData.DataSet) => KindValue | Delete;

/** A failure reason of an admin operation handler (`admin-api`). */
export type AdminFailure = 'bad_request' | 'not_found' | 'conflict' | 'external_failed' | 'internal';

/** An admin operation migration exports (`admin-api` TypeScript form). None of the three has an input field. */
export interface AdminOperation {
  readonly name: string;
  readonly role: 'read' | 'release';
  readonly body: 'json';
  readonly max_body_bytes: null;
  readonly input: Readonly<Record<string, never>>;
  readonly user_target: null;
  readonly handler: (input: Readonly<Record<string, unknown>>, tx: GameTx, prepare: unknown, body: Uint8Array | null) => Record<string, unknown> | AdminFailure;
  readonly prepare: null;
  readonly audit_args: null;
}

/** A `migrate_snapshot` record result. */
export type RecordResult = 'OK' | 'DELETED' | 'UNCHANGED' | 'FAILED';

/** The `migration` module object. */
export interface Migration {
  register_converter(kind: KindClass, from_version: number, converter: Converter): void;
  readonly start_migration_batch: AdminOperation;
  readonly get_migration_batch: AdminOperation;
  readonly stop_migration_batch: AdminOperation;
  begin_start(): void;
  complete_start(): string | null;
  stop(): void;
  /** Called by the DEV code only (`migrate_snapshot`): `user-snapshot-clone.check_snapshot`, a DEV dependency. */
  check_snapshot(snapshot: unknown, game_state: boolean): 'OK' | 'bad_request';
  /** Called by the DEV code only (`migrate_snapshot`): one raw row through `convert_item`, without a DB write. */
  migrate_record(table: string, key: string, version: bigint, bytes: Uint8Array): { result: RecordResult; error: string | null };
}

type SettingKey = 'migration.batchSize' | 'migration.batchIntervalMs' | 'migration.batchLeaseMs' | 'migration.maxRecordedFailures';

const CONVERTER_TABLE = 'migration_converter';
const BATCH_TABLE = 'migration_batch';
const JOB = 'migration_batch';
const STATE_TABLES: readonly string[] = ['user_state', 'server_state', 'game_state'];

const INSERT_CONVERTER = `INSERT INTO ${CONVERTER_TABLE} (kind, from_version, registered_at) VALUES ($1, $2, $3) ON CONFLICT (kind, from_version) DO NOTHING`;
const NEWER_CONVERTER = `SELECT from_version FROM ${CONVERTER_TABLE} WHERE kind = $1 AND from_version >= $2 AND from_version < $3 ORDER BY from_version LIMIT 1`;
const RUNNING = `SELECT batch_id FROM ${BATCH_TABLE} WHERE status = 'RUNNING' ORDER BY started_at DESC, batch_id DESC LIMIT 1`;
const INSERT_BATCH =
  `INSERT INTO ${BATCH_TABLE} (batch_id, status, target_version, cursor_user_id, converted_users, failed_users, failed_count, lease_owner, ` +
  `lease_until_at, started_at, updated_at) VALUES ($1, 'RUNNING', $2, 0, 0, '[]', 0, '', 0, $3, $3)`;
const LATEST_BATCH = `SELECT * FROM ${BATCH_TABLE} ORDER BY started_at DESC, batch_id DESC LIMIT 1`;
const STOP_BATCH = `UPDATE ${BATCH_TABLE} SET status = 'STOPPED', updated_at = $1 WHERE status = 'RUNNING' RETURNING batch_id`;
const BATCH_STATUS = `SELECT status FROM ${BATCH_TABLE} WHERE batch_id = $1`;
const TAKE_LEASE =
  `UPDATE ${BATCH_TABLE} SET lease_owner = $1, lease_until_at = $2, updated_at = $3 ` +
  `WHERE batch_id = $4 AND status = 'RUNNING' AND lease_until_at <= $3 AND target_version <= $5 RETURNING cursor_user_id, target_version`;
const MARK_DONE = `UPDATE ${BATCH_TABLE} SET status = 'DONE', updated_at = $1 WHERE batch_id = $2 AND status = 'RUNNING' AND lease_owner = $3`;
const LEASED_FAILURES = `SELECT failed_users FROM ${BATCH_TABLE} WHERE batch_id = $1 AND lease_owner = $2`;
const STEP_END =
  `UPDATE ${BATCH_TABLE} SET cursor_user_id = COALESCE($1, cursor_user_id), converted_users = converted_users + $2, ` +
  `failed_count = failed_count + $3, failed_users = $4, lease_until_at = $5, updated_at = $5 WHERE batch_id = $6 AND lease_owner = $7 RETURNING batch_id`;

function integer_setting(settings: Readonly<Record<string, unknown>>, key: SettingKey): number {
  const value = settings[key];
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) throw new TypeError(`migration: setting ${key} is not an integer`);
  return value;
}

function module_of(modules: Readonly<Record<string, unknown>>, name: string, member: string): unknown {
  const module = modules[name] as Record<string, unknown> | undefined;
  if (typeof module?.[member] !== 'function') throw new TypeError(`migration: modules has no ${name}`);
  return module;
}

function secure_id(): string {
  return randomBytes(16).toString('base64url');
}

function message_of(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** The failed user IDs of a batch record, then the step's failed users not in it, ascending, up to `max`. */
function merge_failures(stored: unknown, step: readonly bigint[], max: number): string[] {
  const parsed: unknown = typeof stored === 'string' ? JSON.parse(stored) : [];
  const out = Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string') : [];
  const seen = new Set(out);
  for (const user_id of [...step].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))) {
    if (out.length >= max) break;
    const text = String(user_id);
    if (seen.has(text)) continue;
    seen.add(text);
    out.push(text);
  }
  return out;
}

interface Registered {
  readonly info: CoreContract.KindInfo;
  readonly from_version: bigint;
  readonly converter: Converter;
}

/** The outcome of one item conversion: bytes of the current contract, a delete, or a failure with its from version. */
type Conversion =
  | { readonly kind: 'bytes'; readonly bytes: Uint8Array; readonly applied: boolean }
  | { readonly kind: 'delete' }
  | { readonly kind: 'failed'; readonly from_version: bigint; readonly reason: string };

/** Makes `migration` with an explicit contract; `create_migration` passes the generated contract code. */
export function create_migration_with(input: MigrationInput, contract: MigrationContract): Migration {
  const storage = module_of(input.modules, 'storage', 'register_table') as MigrationStorage;
  const time = module_of(input.modules, 'server-time', 'clock_now') as MigrationServerTime;
  const logging = module_of(input.modules, 'logging', 'write') as MigrationLogging;
  const data = input.server.data;
  const batch_size = integer_setting(input.settings, 'migration.batchSize');
  const interval_ms = BigInt(integer_setting(input.settings, 'migration.batchIntervalMs'));
  const lease_ms = BigInt(integer_setting(input.settings, 'migration.batchLeaseMs'));
  const max_failures = integer_setting(input.settings, 'migration.maxRecordedFailures');
  const current = BigInt(contract.contract_version);

  const by_class = new Map<unknown, CoreContract.KindInfo>();
  for (const info of [...contract.core_kinds, ...contract.game_kinds]) by_class.set(info.kind_class, info);
  const game_kinds = new Map<unknown, CoreContract.KindInfo>(contract.game_kinds.map((info) => [info.kind_class, info]));
  const declared = new Set(contract.converters.map((c) => `${c.kind}:${String(c.from_version)}`));

  const registered = new Map<string, Registered>();
  // The registered converters of each kind name in from version order, so a conversion steps only over them.
  const by_kind = new Map<string, Registered[]>();
  const start_errors: string[] = [];
  let phase: 'created' | 'starting' | 'started' | 'stopped' = 'created';
  let rows_written = false;

  const log_error = (message: string, user_id: bigint | null, fields: Record<string, unknown>): void => {
    logging.write({ kind: 'error', level: 'error', message, user_id, request_id: null, request: null, fields: { ...fields, stack_trace: null } });
  };

  const log_core = (level: 'info' | 'warn', message: string, fields: Record<string, unknown>): void => {
    logging.write({ kind: 'core', level, message, user_id: null, request_id: null, request: null, fields: { ...fields, module: 'migration' } });
  };

  /** Whether `stop()` began; read through a call because it changes while the job awaits. */
  const stopped = (): boolean => phase === 'stopped';

  /**
   * An `error` log of job `migration_batch`, unless `stop()` began: a failure after that (e.g. a DB connection closed
   * under a running transaction) is not logged (`server-time` `### scheduler`).
   */
  const job_error = (message: string, user_id: bigint | null, fields: Record<string, unknown>): void => {
    if (!stopped()) log_error(message, user_id, fields);
  };

  /** Applies the registered converters from the stored version up to the current one (`### convert_item`). */
  const convert = (db: DbHandle, info: CoreContract.KindInfo, version: bigint, bytes: Uint8Array): Conversion => {
    if (version > current) {
      const row = db.query(NEWER_CONVERTER, [info.column, current, version])[0];
      if (row === undefined) return { kind: 'bytes', bytes, applied: false };
      return { kind: 'failed', from_version: row['from_version'] as bigint, reason: `a converter of from version ${String(row['from_version'])} is registered` };
    }
    if (version === current) return { kind: 'bytes', bytes, applied: false };
    let value: KindValue | null = info.kind_class.decode(bytes);
    if (value === null) return { kind: 'failed', from_version: version, reason: `the stored bytes are not a ${info.name} message` };
    let applied = false;
    for (const entry of (by_kind.get(info.name) ?? []).filter((e) => e.from_version >= version)) {
      const from = entry.from_version;
      const id = info.is_list ? (value as unknown as Record<string, unknown>)['id'] : null;
      let out: KindValue | Delete;
      try {
        out = entry.converter(value, data);
      } catch (error) {
        return { kind: 'failed', from_version: from, reason: `the converter threw: ${message_of(error)}` };
      }
      if (out === DELETE) return { kind: 'delete' };
      if (!(out instanceof info.kind_class)) return { kind: 'failed', from_version: from, reason: `the converter did not return a ${info.name} message` };
      if (info.is_list && (out as unknown as Record<string, unknown>)['id'] !== id) {
        return { kind: 'failed', from_version: from, reason: `the converter changed the id of a ${info.name} item` };
      }
      value = out;
      applied = true;
    }
    return { kind: 'bytes', bytes: applied ? value.encode() : bytes, applied };
  };

  /** A conversion that leaves an `error` log when it fails (`### convert_item`). */
  const convert_logged = (db: DbHandle, info: CoreContract.KindInfo | undefined, item_id: bigint, version: bigint, bytes: Uint8Array): Conversion => {
    const result: Conversion = info === undefined ? { kind: 'failed', from_version: version, reason: 'the kind is not a kind of the contract' } : convert(db, info, version, bytes);
    if (result.kind === 'failed') {
      log_error('item conversion failed', null, {
        item_kind: info?.column ?? '',
        item_id: String(item_id),
        stored_version: String(version),
        from_version: String(result.from_version),
        error: result.reason,
      });
    }
    return result;
  };

  /** `convert_item`: the read conversion `storage` calls. */
  const convert_item = (db: DbHandle, kind: KindClass, item_id: bigint, version: bigint, bytes: Uint8Array): Uint8Array | Delete | 'FAILED' => {
    const result = convert_logged(db, by_class.get(kind), item_id, version, bytes);
    return result.kind === 'bytes' ? result.bytes : result.kind === 'delete' ? DELETE : 'FAILED';
  };

  const record_error = (error: string): void => {
    start_errors.push(`register_converter: ${error}`);
  };

  const register_converter = (kind: KindClass, from_version: number, converter: Converter): void => {
    if (phase === 'started' || phase === 'stopped') throw new Error('migration: register_converter after server start');
    if (phase !== 'starting') {
      record_error('called outside register');
      return;
    }
    const info = game_kinds.get(kind);
    if (info === undefined) {
      record_error(`${String((kind as { name?: unknown } | null)?.name)} is not a kind of user_state.proto, server_state.proto or game_state.proto`);
      return;
    }
    if (typeof from_version !== 'number' || !Number.isSafeInteger(from_version) || from_version < 1 || BigInt(from_version) >= current) {
      record_error(`from version ${String(from_version)} of ${info.name} is not in [1, ${String(current)})`);
      return;
    }
    if (typeof converter !== 'function') {
      record_error(`the converter of ${info.name} from version ${String(from_version)} is not a function`);
      return;
    }
    const key = `${info.name}:${String(from_version)}`;
    if (registered.has(key)) {
      record_error(`${info.name} from version ${String(from_version)} is registered twice`);
      return;
    }
    if (!declared.has(key)) {
      record_error(`${info.name} from version ${String(from_version)} is not in GameContract.CONVERTERS`);
      return;
    }
    const entry: Registered = { info, from_version: BigInt(from_version), converter };
    registered.set(key, entry);
    by_kind.set(info.name, [...(by_kind.get(info.name) ?? []), entry].sort((a, b) => (a.from_version < b.from_version ? -1 : 1)));
  };

  /** Writes a `migration_converter` row for each registered converter that has none, in one game transaction. */
  const insert_converter_rows = async (): Promise<boolean> => {
    if (registered.size === 0) return true;
    try {
      const result = await storage.run_game_transaction((tx) => {
        const handle = storage.db(tx);
        const now = time.clock_now();
        for (const entry of registered.values()) handle.query(INSERT_CONVERTER, [entry.info.column, entry.from_version, now]);
        return true;
      });
      if (result === true) return true;
      job_error('migration_converter rows were not written', null, { error: 'the game transaction failed' });
    } catch (error) {
      job_error('migration_converter rows were not written', null, { error: message_of(error) });
    }
    return false;
  };

  /**
   * The step-end write (and the `DONE` write when no user was left): `LOST` when the conditional update changed no
   * row. The lease write of another server instance does not take the batch record lock, so it can commit between the
   * read of `failed_users` and the update; then only the update, which PostgreSQL checks against the committed row,
   * sees that the lease is gone.
   */
  const finish_step = (batch_id: string, owner: string, done: boolean, cursor: bigint | null, converted: bigint, failed: readonly bigint[]): Promise<'WRITTEN' | 'LOST' | 'FAILED'> =>
    storage.run_game_transaction((tx) => {
      if (storage.lock_game_row(tx, BATCH_TABLE, [batch_id]) === 'FAILED') return 'FAILED' as const;
      const handle = storage.db(tx);
      const now = time.clock_now();
      if (done) handle.query(MARK_DONE, [now, batch_id, owner]);
      const row = handle.query(LEASED_FAILURES, [batch_id, owner])[0];
      if (row === undefined) return 'LOST' as const;
      const failed_users = JSON.stringify(merge_failures(row['failed_users'], failed, max_failures));
      const written = handle.query(STEP_END, [cursor, converted, BigInt(failed.length), failed_users, now, batch_id, owner]);
      return written.length === 0 ? ('LOST' as const) : ('WRITTEN' as const);
    });

  /** One batch step (`### batch`). It ends without writing the batch record at the first check after `stop()` began. */
  const step = async (): Promise<void> => {
    const running = storage.read_db().query(RUNNING, [])[0];
    if (running === undefined) return;
    const batch_id = String(running['batch_id']);
    const owner = secure_id();
    const lease = await storage.run_game_transaction((tx) => {
      const now = time.clock_now();
      // A batch whose target_version is above this server instance's contract version is left to a newer instance.
      return storage.db(tx).query(TAKE_LEASE, [owner, now + lease_ms, now, batch_id, current])[0] ?? null;
    });
    if (stopped()) return;
    if (lease === 'FAILED') {
      log_error('migration batch lease failed', null, { batch_id });
      return;
    }
    if (lease === null) return;
    const target = lease['target_version'] as bigint;
    const users = storage.scan_users(storage.read_db(), lease['cursor_user_id'] as bigint, batch_size, target);
    let cursor: bigint | null = null;
    let converted = 0n;
    const failed: bigint[] = [];
    for (const user_id of users) {
      if (storage.read_db().query(BATCH_STATUS, [batch_id])[0]?.['status'] !== 'RUNNING') break;
      cursor = user_id;
      let result: string;
      try {
        result = await storage.run_user_transaction(user_id, (ctx) => (storage.upgrade_user_rows(ctx) === 'FAILED' ? CoreContract.CoreError.CORE_ERROR_INTERNAL : 'pass'));
      } catch (error) {
        result = `FAILED: ${message_of(error)}`;
      }
      // The lease ends on its own and another server instance goes on from cursor_user_id.
      if (stopped()) return;
      if (result === 'COMMITTED') converted += 1n;
      else if (result !== 'WITHDRAWN') {
        failed.push(user_id);
        log_error('migration batch user conversion failed', user_id, { batch_id, result });
      }
    }
    const written = await finish_step(batch_id, owner, users.length === 0, cursor, converted, failed);
    if (stopped()) return;
    if (written === 'LOST') log_core('warn', 'migration batch lease lost; the step is dropped', { batch_id });
    if (written === 'FAILED') log_error('migration batch step end write failed', null, { batch_id });
  };

  /** Job `migration_batch`: the `migration_converter` rows until this server instance has written them, then a step. */
  const run_job = async (): Promise<void> => {
    if (!rows_written) rows_written = await insert_converter_rows();
    if (stopped()) return;
    try {
      await step();
    } catch (error) {
      job_error('migration batch step failed', null, { error: message_of(error) });
    }
  };

  const admin = (name: string, role: 'read' | 'release', handler: AdminOperation['handler']): AdminOperation => ({
    name,
    role,
    body: 'json',
    max_body_bytes: null,
    input: {},
    user_target: null,
    handler,
    prepare: null,
    audit_args: null,
  });

  return {
    register_converter,
    start_migration_batch: admin('start_migration_batch', 'release', (_input, tx) => {
      if (storage.lock_game_row(tx, BATCH_TABLE, ['']) === 'FAILED') return 'internal';
      const handle = storage.db(tx);
      if (handle.query(RUNNING, []).length > 0) return 'conflict';
      const batch_id = secure_id();
      handle.query(INSERT_BATCH, [batch_id, current, time.clock_now()]);
      return { batch_id };
    }),
    get_migration_batch: admin('get_migration_batch', 'read', (_input, tx) => {
      const row = storage.db(tx).query(LATEST_BATCH, [])[0];
      if (row === undefined) return 'not_found';
      return {
        batch_id: row['batch_id'],
        status: row['status'],
        target_version: row['target_version'],
        cursor_user_id: row['cursor_user_id'],
        converted_users: row['converted_users'],
        failed_users: JSON.parse(String(row['failed_users'])) as unknown,
        failed_count: row['failed_count'],
        lease_owner: row['lease_owner'],
        lease_until_at: row['lease_until_at'],
        started_at: row['started_at'],
        updated_at: row['updated_at'],
      };
    }),
    stop_migration_batch: admin('stop_migration_batch', 'release', (_input, tx) => {
      const stopped = storage.db(tx).query(STOP_BATCH, [time.clock_now()]);
      return stopped.length === 0 ? 'not_found' : {};
    }),
    begin_start: () => {
      phase = 'starting';
      storage.register_table(
        CONVERTER_TABLE,
        'game',
        [
          { name: 'kind', type: 'string' },
          { name: 'from_version', type: 'int64' },
          { name: 'registered_at', type: 'int64' },
        ],
        ['kind', 'from_version'],
        null,
        null,
      );
      storage.register_table(
        BATCH_TABLE,
        'game',
        [
          { name: 'batch_id', type: 'string' },
          { name: 'status', type: 'string' },
          { name: 'target_version', type: 'int64' },
          { name: 'cursor_user_id', type: 'int64' },
          { name: 'converted_users', type: 'int64' },
          { name: 'failed_users', type: 'string' },
          { name: 'failed_count', type: 'int64' },
          { name: 'lease_owner', type: 'string' },
          { name: 'lease_until_at', type: 'int64' },
          { name: 'started_at', type: 'int64' },
          { name: 'updated_at', type: 'int64' },
        ],
        ['batch_id'],
        null,
        null,
      );
      storage.register_item_converter(convert_item);
      time.schedule_job(JOB, interval_ms, run_job);
    },
    complete_start: () => {
      for (const c of contract.converters) {
        if (!registered.has(`${c.kind}:${String(c.from_version)}`)) record_error(`${c.kind} from version ${String(c.from_version)} of GameContract.CONVERTERS is not registered`);
      }
      if (start_errors.length > 0) return `migration: ${start_errors.join('; ')}`;
      phase = 'started';
      return null;
    },
    stop: () => {
      phase = 'stopped';
    },
    check_snapshot: (snapshot, game_state) => {
      // A DEV dependency: routing fills it in after migration is made, so it is looked up on each call.
      const clone = module_of(input.modules, 'user-snapshot-clone', 'check_snapshot') as MigrationSnapshotClone;
      return clone.check_snapshot(snapshot, game_state);
    },
    migrate_record: (table, key, version, bytes) => {
      if (!STATE_TABLES.includes(table)) return { result: 'UNCHANGED', error: null };
      const slash = key.indexOf('/');
      const id_text = key.slice(slash + 1);
      if (slash < 0 || !/^(0|[1-9][0-9]*)$/.test(id_text)) return { result: 'FAILED', error: `the key ${key} is not <kind>/<item ID>` };
      const column = key.slice(0, slash);
      const info = [...by_class.values()].find((k) => k.column === column && k.store === table);
      if (info === undefined) return { result: 'UNCHANGED', error: null };
      const out = convert_logged(storage.read_db(), info, BigInt(id_text), version, bytes);
      if (out.kind === 'failed') return { result: 'FAILED', error: `from version ${String(out.from_version)}: ${out.reason}` };
      if (out.kind === 'delete') return { result: 'DELETED', error: null };
      const decoded = info.kind_class.decode(out.bytes);
      const again = decoded === null ? null : info.kind_class.decode(decoded.encode());
      if (again === null) return { result: 'FAILED', error: `the converted bytes are not a ${info.name} message` };
      return { result: out.applied ? 'OK' : 'UNCHANGED', error: null };
    },
  };
}

/** The `migration` module of one server instance (`server-core` `## module`). */
export function create_migration(input: MigrationInput): Migration {
  return create_migration_with(input, {
    core_kinds: CoreContract.KINDS,
    game_kinds: GameContract.KINDS,
    contract_version: GameContract.CONTRACT_VERSION,
    converters: GameContract.CONVERTERS,
  });
}
