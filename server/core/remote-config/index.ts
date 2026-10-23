/**
 * remote-config: config values and feature flags operators change without a data patch, and experiment groups of
 * users. Keys, types and default values are in data; overrides and experiments are game rows cached in memory.
 */
import * as CoreContract from '../../generated/contract/core_contract.ts';
import type * as GameData from '../../generated/data/game_data.ts';
import type { Logging } from '../logging/index.ts';
import type { ServerTimeApi } from '../server-time/index.ts';
import type { GameTx, RequestCtx, Storage } from '../storage/index.ts';
import { assign_group } from './assign.ts';
import { decode_stored, encode_stored, parse_admin_value, parse_default, to_json, to_proto, type Value, type ValueType, type_of } from './values.ts';

/** The `storage` operations remote-config calls. */
export type RemoteConfigStorage = Pick<Storage, 'register_table' | 'db' | 'read_db' | 'lock_game_row' | 'after_commit'>;

/** The `server-time` operations remote-config calls. */
export type RemoteConfigServerTime = Pick<ServerTimeApi, 'now' | 'clock_now' | 'schedule_job'>;

/** The `logging` operation remote-config calls. */
export type RemoteConfigLogging = Pick<Logging, 'write'>;

/** The fields of the module input `server` (`server-core` `## module`) that remote-config reads. */
export interface RemoteConfigServer {
  readonly data: GameData.DataSet;
}

/** The module input (`server-core` `## module`). */
export interface RemoteConfigInput {
  readonly settings: Readonly<Record<string, unknown>>;
  readonly modules: Readonly<Record<string, unknown>>;
  readonly server: RemoteConfigServer;
}

/** The core settings keys of `## settings`. */
type SettingKey = 'remote-config.maxStringBytes' | 'remote-config.maxGroups' | 'remote-config.cacheMs';

/** An admin field type (`admin-api` admin operation TypeScript form). */
export type AdminFieldType =
  | { readonly kind: 'int64' | 'int32' | 'bool' | 'string' | 'json' }
  | { readonly kind: 'array'; readonly element: AdminFieldType }
  | { readonly kind: 'object'; readonly fields: Readonly<Record<string, AdminField>> };

export interface AdminField {
  readonly type: AdminFieldType;
  readonly optional: boolean;
}

export type AdminFailure = 'bad_request' | 'not_found' | 'conflict' | 'internal';

/** An admin operation remote-config exports; `routing` passes it to `admin-api.register_admin_operation`. */
export interface AdminOperation {
  readonly name: string;
  readonly role: 'read' | 'ops';
  readonly body: 'json';
  readonly max_body_bytes: null;
  readonly input: Readonly<Record<string, AdminField>>;
  readonly user_target: null;
  readonly handler: (input: Readonly<Record<string, unknown>>, tx: GameTx, prepare: unknown, body: Uint8Array | null) => Record<string, unknown> | AdminFailure;
  readonly prepare: null;
  readonly audit_args: null;
}

export interface ClientConfig {
  readonly entries: CoreContract.RemoteConfigEntry[];
  readonly assignments: CoreContract.ExperimentAssignment[];
}

export interface RemoteConfigModule {
  begin_start(): void;
  complete_start(): string | null;
  stop(): void;
  get_config(ctx: RequestCtx, key_id: number): CoreContract.RemoteConfigValue;
  get_client_config(ctx: RequestCtx): ClientConfig;
  /** Core `rpc` `GetRemoteConfig`. */
  GetRemoteConfig(ctx: RequestCtx, request: CoreContract.GetRemoteConfigRequest): CoreContract.GetRemoteConfigResponse;
  readonly set_config_value: AdminOperation;
  readonly clear_config_value: AdminOperation;
  readonly put_experiment: AdminOperation;
  readonly stop_experiment: AdminOperation;
  readonly list_remote_config: AdminOperation;
}

const OVERRIDE_TABLE = 'remote_config_override';
const EXPERIMENT_TABLE = 'remote_config_experiment';
const CACHE_JOB = 'remote_config_cache';

const SELECT_OVERRIDES = `SELECT key_id, value, updated_at FROM ${OVERRIDE_TABLE} ORDER BY key_id`;
const SELECT_EXPERIMENTS = `SELECT experiment_id, salt, start_at, end_at, key_ids, groups, stopped, updated_at FROM ${EXPERIMENT_TABLE} ORDER BY experiment_id`;
const SELECT_EXPERIMENT = `SELECT experiment_id FROM ${EXPERIMENT_TABLE} WHERE experiment_id = $1`;
const UPSERT_OVERRIDE =
  `INSERT INTO ${OVERRIDE_TABLE} (key_id, value, updated_at) VALUES ($1, $2, $3) ` +
  'ON CONFLICT (key_id) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at';
const DELETE_OVERRIDE = `DELETE FROM ${OVERRIDE_TABLE} WHERE key_id = $1`;
const UPSERT_EXPERIMENT =
  `INSERT INTO ${EXPERIMENT_TABLE} (experiment_id, salt, start_at, end_at, key_ids, groups, stopped, updated_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) ` +
  'ON CONFLICT (experiment_id) DO UPDATE SET salt = excluded.salt, start_at = excluded.start_at, end_at = excluded.end_at, ' +
  'key_ids = excluded.key_ids, groups = excluded.groups, stopped = excluded.stopped, updated_at = excluded.updated_at';
const STOP_EXPERIMENT = `UPDATE ${EXPERIMENT_TABLE} SET stopped = $2, updated_at = $3 WHERE experiment_id = $1`;

/** The experiment ID value no experiment has; `put_experiment` locks its row key to serialize overlap checks. */
const PUT_LOCK_KEY = 0;

const MODULE = 'remote-config';

const utf8 = new TextEncoder();

/** A `put_experiment` group as `admin-api` passes it. */
interface AdminGroup {
  readonly name: string;
  readonly weight: number;
  readonly values: readonly unknown[];
}

/** A stored experiment group: values in `key_ids` order as stored texts. */
interface StoredGroup {
  readonly name: string;
  readonly weight: number;
  readonly values: readonly string[];
}

/** One experiment in the cache. A value is null when its key is not in data or does not match the key type. */
interface CachedExperiment {
  readonly id: number;
  readonly salt: string;
  readonly start_at: bigint;
  readonly end_at: bigint;
  readonly stopped: boolean;
  readonly key_ids: readonly number[];
  readonly groups: readonly { readonly name: string; readonly weight: bigint; readonly values: readonly (Value | null)[] }[];
}

/** An experiment that has a key, with the index of the key in its `key_ids`. */
interface KeyExperiment {
  readonly experiment: CachedExperiment;
  readonly index: number;
}

/** The override and experiment cache. Experiments not in data are left out; experiments are in ID value order. */
interface Cache {
  readonly overrides: ReadonlyMap<number, Value>;
  /** The experiments of each key, in ID value order. */
  readonly by_key: ReadonlyMap<number, readonly KeyExperiment[]>;
  /** The experiments with a key whose `client` is true, in ID value order. */
  readonly client_experiments: readonly CachedExperiment[];
}

/** What one request reads: the cache of its first read and the user's group of each experiment it assigned. */
interface TxView {
  readonly cache: Cache;
  readonly groups: Map<number, CachedExperiment['groups'][number]>;
}

const EMPTY_CACHE: Cache = { overrides: new Map(), by_key: new Map(), client_experiments: [] };

type Row = Readonly<Record<string, unknown>>;

function integer_setting(settings: Readonly<Record<string, unknown>>, key: SettingKey): number {
  const value = settings[key];
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) throw new TypeError(`remote-config: setting ${key} is not an integer`);
  return value;
}

function module_of(modules: Readonly<Record<string, unknown>>, name: string, member: string): unknown {
  const module = modules[name] as Record<string, unknown> | undefined;
  if (typeof module?.[member] !== 'function') throw new TypeError(`remote-config: modules has no ${name}`);
  return module;
}

function as_bigint(value: unknown): bigint {
  if (typeof value === 'bigint') return value;
  if (typeof value === 'number' && Number.isSafeInteger(value)) return BigInt(value);
  throw new TypeError(`remote-config: ${String(value)} is not an integer column value`);
}

function as_number(value: unknown): number {
  return Number(as_bigint(value));
}

function as_bool(value: unknown): boolean {
  return value === true || value === 1 || value === 1n;
}

function parse_json(text: unknown, what: string): unknown {
  if (typeof text !== 'string') throw new TypeError(`remote-config: ${what} is not a text column value`);
  return JSON.parse(text);
}

function stored_key_ids(text: unknown): number[] {
  return parse_json(text, 'key_ids') as number[];
}

function stored_groups(text: unknown): StoredGroup[] {
  return parse_json(text, 'groups') as StoredGroup[];
}

function key_type(data: GameData.DataSet, key_id: number): ValueType | null {
  if (!data.RemoteConfigKeyTable.has_row(key_id)) return null;
  return type_of(data.RemoteConfigKeyTable.get_row(key_id).type);
}

function is_client_key(data: GameData.DataSet, key_id: number): boolean {
  return data.RemoteConfigKeyTable.has_row(key_id) && data.RemoteConfigKeyTable.get_row(key_id).client;
}

function overlaps(a_start: bigint, a_end: bigint, b_start: bigint, b_end: bigint): boolean {
  return a_start < b_end && b_start < a_end;
}

function is_active(experiment: CachedExperiment, time: bigint): boolean {
  return !experiment.stopped && experiment.start_at <= time && time < experiment.end_at;
}

/** Makes `remote-config` for one server instance. A missing setting or dependency throws. */
export function create_remote_config(input: RemoteConfigInput): RemoteConfigModule {
  const storage = module_of(input.modules, 'storage', 'register_table') as RemoteConfigStorage;
  const server_time = module_of(input.modules, 'server-time', 'schedule_job') as RemoteConfigServerTime;
  const logging = module_of(input.modules, 'logging', 'write') as RemoteConfigLogging;
  const max_string_bytes = integer_setting(input.settings, 'remote-config.maxStringBytes');
  const max_groups = integer_setting(input.settings, 'remote-config.maxGroups');
  const cache_ms = BigInt(integer_setting(input.settings, 'remote-config.cacheMs'));
  const data = input.server.data;

  let cache: Cache = EMPTY_CACHE;
  // The view a transaction reads: the cache of its first read, so that a key keeps its value within one request.
  let by_tx = new WeakMap<object, TxView>();
  // The `client` rows of `remote_config_key` in ID value order; data does not change on a server instance.
  let client_rows: readonly GameData.RemoteConfigKeyRow[] | null = null;

  const warn = (message: string, fields: Record<string, number | string>): void => {
    logging.write({ kind: 'core', level: 'warn', message, user_id: null, request_id: null, request: null, fields: { ...fields, module: MODULE } });
  };

  const log_error = (message: string): void => {
    logging.write({ kind: 'error', level: 'error', message, user_id: null, request_id: null, request: null, fields: { stack_trace: null } });
  };

  /** The server start failure of a `String` key whose `default_value` is over `remote-config.maxStringBytes`, or null. */
  const default_value_failure = (): string | null => {
    const over = data.RemoteConfigKeyTable.all_rows().filter((row) => type_of(row.type) === 'String' && utf8.encode(row.default_value).length > max_string_bytes);
    if (over.length === 0) return null;
    const ids = over.map((row) => row.id).sort((a, b) => a - b).join(', ');
    return `remote-config: default_value of String key ${ids} is over remote-config.maxStringBytes ${String(max_string_bytes)} bytes`;
  };

  /** Builds the cache from the stored rows. With `report`, logs a `warn` line for every stored value it leaves out. */
  const build = (override_rows: readonly Row[], experiment_rows: readonly Row[], report: boolean): Cache => {
    const overrides = new Map<number, Value>();
    for (const row of override_rows) {
      const key_id = as_number(row['key_id']);
      const type = key_type(data, key_id);
      if (type === null) {
        if (report) warn('remote config override of a key not in data is not used', { key_id });
        continue;
      }
      const value = decode_stored(String(row['value']));
      if (value?.type !== type) {
        if (report) warn('remote config override does not match the key type and is not used', { key_id });
        continue;
      }
      overrides.set(key_id, value);
    }
    const experiments: CachedExperiment[] = [];
    for (const row of experiment_rows) {
      const id = as_number(row['experiment_id']);
      if (!data.ExperimentTable.has_row(id)) {
        if (report) warn('remote config experiment not in data is not used', { experiment_id: id });
        continue;
      }
      const key_ids = stored_key_ids(row['key_ids']);
      const types = key_ids.map((key_id) => key_type(data, key_id));
      if (report) {
        key_ids.forEach((key_id, i) => {
          if (types[i] === null) warn('remote config experiment value of a key not in data is not used', { experiment_id: id, key_id });
        });
      }
      const groups = stored_groups(row['groups']).map((group) => ({
        name: group.name,
        weight: BigInt(group.weight),
        values: key_ids.map((key_id, i) => {
          const type = types[i];
          if (type === null || type === undefined) return null;
          const value = decode_stored(group.values[i] ?? '');
          if (value?.type === type) return value;
          if (report) warn('remote config experiment value does not match the key type and is not used', { experiment_id: id, key_id, group: group.name });
          return null;
        }),
      }));
      experiments.push({
        id,
        salt: String(row['salt']),
        start_at: as_bigint(row['start_at']),
        end_at: as_bigint(row['end_at']),
        stopped: as_bool(row['stopped']),
        key_ids,
        groups,
      });
    }
    experiments.sort((a, b) => a.id - b.id);
    const by_key = new Map<number, KeyExperiment[]>();
    for (const experiment of experiments) {
      experiment.key_ids.forEach((key_id, index) => {
        const list = by_key.get(key_id) ?? [];
        list.push({ experiment, index });
        by_key.set(key_id, list);
      });
    }
    const client_experiments = experiments.filter((experiment) => experiment.key_ids.some((key_id) => is_client_key(data, key_id)));
    return { overrides, by_key, client_experiments };
  };

  /** Reads both tables from the committed state into the cache. */
  const reload = (report: boolean): void => {
    const db = storage.read_db();
    cache = build(db.query(SELECT_OVERRIDES, []), db.query(SELECT_EXPERIMENTS, []), report);
  };

  const refresh_after = (tx: GameTx): void => {
    storage.after_commit(tx, () => {
      try {
        reload(false);
      } catch (error) {
        log_error(`remote config cache reload failed: ${String(error)}`);
      }
    });
  };

  const view_of = (ctx: RequestCtx): TxView => {
    let view = by_tx.get(ctx);
    if (view === undefined) {
      view = { cache, groups: new Map() };
      by_tx.set(ctx, view);
    }
    return view;
  };

  /** The group of the request's user in an experiment, assigned once per request. */
  const group_of = (ctx: RequestCtx, view: TxView, experiment: CachedExperiment): CachedExperiment['groups'][number] => {
    let group = view.groups.get(experiment.id);
    if (group === undefined) {
      group = assign_group(experiment.salt, experiment.groups, ctx.user_id);
      view.groups.set(experiment.id, group);
    }
    return group;
  };

  /** The value of a key at `time`: an active experiment's group value, then the override, then `default_value`. */
  const value_of = (ctx: RequestCtx, view: TxView, time: bigint, key_id: number, row: GameData.RemoteConfigKeyRow): Value => {
    const type = type_of(row.type);
    if (type === null) throw new Error(`remote-config: key ${String(key_id)} has no RemoteConfigType`);
    for (const { experiment, index } of view.cache.by_key.get(key_id) ?? []) {
      if (!is_active(experiment, time)) continue;
      const value = group_of(ctx, view, experiment).values[index];
      if (value !== null && value !== undefined) return value;
    }
    const override = view.cache.overrides.get(key_id);
    if (override !== undefined) return override;
    const fallback = parse_default(type, row.default_value);
    if (fallback === null) throw new Error(`remote-config: default_value of key ${String(key_id)} does not read as ${type}`);
    return fallback;
  };

  const get_client_config = (ctx: RequestCtx): ClientConfig => {
    const view = view_of(ctx);
    const time = server_time.now(ctx);
    client_rows ??= [...data.RemoteConfigKeyTable.all_rows()].filter((row) => row.client).sort((a, b) => a.id - b.id);
    const entries = client_rows.map((row) => {
      const entry = new CoreContract.RemoteConfigEntry();
      entry.key_id = row.id;
      entry.value = to_proto(value_of(ctx, view, time, row.id, row));
      return entry;
    });
    const assignments = view.cache.client_experiments
      .filter((experiment) => is_active(experiment, time))
      .map((experiment) => {
        const assignment = new CoreContract.ExperimentAssignment();
        assignment.experiment_id = experiment.id;
        assignment.group = group_of(ctx, view, experiment).name;
        return assignment;
      });
    return { entries, assignments };
  };

  const json: AdminField = { type: { kind: 'json' }, optional: false };
  const int32: AdminField = { type: { kind: 'int32' }, optional: false };
  const int64: AdminField = { type: { kind: 'int64' }, optional: false };
  const string: AdminField = { type: { kind: 'string' }, optional: false };

  const operation = (
    name: string,
    role: 'read' | 'ops',
    fields: Readonly<Record<string, AdminField>>,
    handler: (input: Readonly<Record<string, unknown>>, tx: GameTx) => Record<string, unknown> | AdminFailure,
  ): AdminOperation => ({
    name,
    role,
    body: 'json',
    max_body_bytes: null,
    input: fields,
    user_target: null,
    handler: (input, tx) => handler(input, tx),
    prepare: null,
    audit_args: null,
  });

  const set_config_value = operation('set_config_value', 'ops', { key_id: int32, value: json }, (input, tx) => {
    const key_id = input['key_id'] as number;
    const type = key_type(data, key_id);
    if (type === null) return 'not_found';
    const value = parse_admin_value(type, input['value'], max_string_bytes);
    if (value === null) return 'bad_request';
    storage.db(tx).query(UPSERT_OVERRIDE, [key_id, encode_stored(value), server_time.clock_now()]);
    refresh_after(tx);
    return {};
  });

  const clear_config_value = operation('clear_config_value', 'ops', { key_id: int32 }, (input, tx) => {
    const key_id = input['key_id'] as number;
    if (key_type(data, key_id) === null) return 'not_found';
    storage.db(tx).query(DELETE_OVERRIDE, [key_id]);
    refresh_after(tx);
    return {};
  });

  const group_field: AdminField = {
    type: {
      kind: 'object',
      fields: {
        name: string,
        weight: int32,
        values: { type: { kind: 'array', element: { kind: 'json' } }, optional: false },
      },
    },
    optional: false,
  };

  /** The `put_experiment` groups to store, or the failure reason of the input rules. */
  const experiment_groups = (
    salt: string,
    start_at: bigint,
    end_at: bigint,
    key_ids: readonly number[],
    groups: readonly AdminGroup[],
  ): StoredGroup[] | AdminFailure => {
    const types: ValueType[] = [];
    for (const key_id of key_ids) {
      const type = key_type(data, key_id);
      if (type === null) return 'not_found';
      types.push(type);
    }
    if (salt === '' || start_at >= end_at) return 'bad_request';
    if (key_ids.length < 1 || new Set(key_ids).size !== key_ids.length) return 'bad_request';
    if (groups.length < 2 || groups.length > max_groups) return 'bad_request';
    if (new Set(groups.map((group) => group.name)).size !== groups.length) return 'bad_request';
    const stored: StoredGroup[] = [];
    for (const group of groups) {
      if (group.weight < 1 || group.values.length !== types.length) return 'bad_request';
      const values: string[] = [];
      for (const [i, type] of types.entries()) {
        const value = parse_admin_value(type, group.values[i], max_string_bytes);
        if (value === null) return 'bad_request';
        values.push(encode_stored(value));
      }
      stored.push({ name: group.name, weight: group.weight, values });
    }
    return stored;
  };

  /** True when another stored experiment in data, not stopped, overlaps the period and shares a key. */
  const overlaps_other = (tx: GameTx, experiment_id: number, start_at: bigint, end_at: bigint, key_ids: readonly number[]): boolean => {
    const keys = new Set(key_ids);
    return storage
      .db(tx)
      .query(SELECT_EXPERIMENTS, [])
      .some((row) => {
        const other_id = as_number(row['experiment_id']);
        if (other_id === experiment_id || as_bool(row['stopped']) || !data.ExperimentTable.has_row(other_id)) return false;
        if (!overlaps(start_at, end_at, as_bigint(row['start_at']), as_bigint(row['end_at']))) return false;
        return stored_key_ids(row['key_ids']).some((key_id) => keys.has(key_id));
      });
  };

  const put_experiment = operation(
    'put_experiment',
    'ops',
    {
      operation_id: string,
      experiment_id: int32,
      salt: string,
      start_at: int64,
      end_at: int64,
      key_ids: { type: { kind: 'array', element: { kind: 'int32' } }, optional: false },
      groups: { type: { kind: 'array', element: group_field.type }, optional: false },
    },
    (input, tx) => {
      const experiment_id = input['experiment_id'] as number;
      const key_ids = input['key_ids'] as readonly number[];
      const salt = input['salt'] as string;
      const start_at = input['start_at'] as bigint;
      const end_at = input['end_at'] as bigint;
      if (!data.ExperimentTable.has_row(experiment_id)) return 'not_found';
      const groups = experiment_groups(salt, start_at, end_at, key_ids, input['groups'] as readonly AdminGroup[]);
      if (typeof groups === 'string') return groups;
      if (storage.lock_game_row(tx, EXPERIMENT_TABLE, [PUT_LOCK_KEY]) === 'FAILED') return 'internal';
      if (overlaps_other(tx, experiment_id, start_at, end_at, key_ids)) return 'conflict';
      storage
        .db(tx)
        .query(UPSERT_EXPERIMENT, [experiment_id, salt, start_at, end_at, JSON.stringify(key_ids), JSON.stringify(groups), false, server_time.clock_now()]);
      refresh_after(tx);
      return { experiment_id };
    },
  );

  const stop_experiment = operation('stop_experiment', 'ops', { experiment_id: int32 }, (input, tx) => {
    const experiment_id = input['experiment_id'] as number;
    if (!data.ExperimentTable.has_row(experiment_id)) return 'not_found';
    const db = storage.db(tx);
    if (db.query(SELECT_EXPERIMENT, [experiment_id]).length === 0) return 'not_found';
    db.query(STOP_EXPERIMENT, [experiment_id, true, server_time.clock_now()]);
    refresh_after(tx);
    return {};
  });

  const stored_json = (text: unknown): boolean | bigint | string | null => {
    const value = decode_stored(String(text));
    return value === null ? null : to_json(value);
  };

  const list_remote_config = operation('list_remote_config', 'read', {}, (_input, tx) => {
    const db = storage.db(tx);
    const overrides = db.query(SELECT_OVERRIDES, []).map((row) => ({
      key_id: as_number(row['key_id']),
      value: stored_json(row['value']),
      updated_at: as_bigint(row['updated_at']),
    }));
    const experiments = db.query(SELECT_EXPERIMENTS, []).map((row) => ({
      experiment_id: as_number(row['experiment_id']),
      salt: String(row['salt']),
      start_at: as_bigint(row['start_at']),
      end_at: as_bigint(row['end_at']),
      key_ids: stored_key_ids(row['key_ids']),
      groups: stored_groups(row['groups']).map((group) => ({
        name: group.name,
        weight: group.weight,
        values: group.values.map(stored_json),
      })),
      stopped: as_bool(row['stopped']),
      updated_at: as_bigint(row['updated_at']),
    }));
    return { overrides, experiments };
  });

  return {
    begin_start() {
      storage.register_table(
        OVERRIDE_TABLE,
        'game',
        [
          { name: 'key_id', type: 'int32' },
          { name: 'value', type: 'string' },
          { name: 'updated_at', type: 'int64' },
        ],
        ['key_id'],
        null,
        null,
      );
      storage.register_table(
        EXPERIMENT_TABLE,
        'game',
        [
          { name: 'experiment_id', type: 'int32' },
          { name: 'salt', type: 'string' },
          { name: 'start_at', type: 'int64' },
          { name: 'end_at', type: 'int64' },
          { name: 'key_ids', type: 'string' },
          { name: 'groups', type: 'string' },
          { name: 'stopped', type: 'bool' },
          { name: 'updated_at', type: 'int64' },
        ],
        ['experiment_id'],
        null,
        null,
      );
      server_time.schedule_job(CACHE_JOB, cache_ms, () => {
        try {
          reload(false);
        } catch (error) {
          log_error(`remote config cache reload failed: ${String(error)}`);
        }
      });
    },

    complete_start() {
      const failure = default_value_failure();
      if (failure !== null) {
        log_error(failure);
        return failure;
      }
      try {
        reload(true);
      } catch (error) {
        const reason = `remote-config: reading the stored overrides and experiments failed: ${String(error)}`;
        log_error(reason);
        return reason;
      }
      return null;
    },

    stop() {
      cache = EMPTY_CACHE;
      by_tx = new WeakMap();
    },

    get_config(ctx, key_id) {
      if (!data.RemoteConfigKeyTable.has_row(key_id)) throw new Error(`remote-config: get_config of key ID value ${String(key_id)} not in remote_config_key`);
      return to_proto(value_of(ctx, view_of(ctx), server_time.now(ctx), key_id, data.RemoteConfigKeyTable.get_row(key_id)));
    },

    get_client_config,

    GetRemoteConfig(ctx) {
      const { entries, assignments } = get_client_config(ctx);
      const response = new CoreContract.GetRemoteConfigResponse();
      response.entries = entries;
      response.assignments = assignments;
      return response;
    },

    set_config_value,
    clear_config_value,
    put_experiment,
    stop_experiment,
    list_remote_config,
  };
}
