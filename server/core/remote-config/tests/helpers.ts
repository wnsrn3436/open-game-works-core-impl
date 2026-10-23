/**
 * Helpers of the remote-config core tests over the `testing` test helpers. `run` calls module operations that need a
 * ctx: when the core test data has the rpc `RunCoreTest`, its handler runs the function in that request, with the ctx
 * and the `core` object content `register` got; otherwise the function runs in a request transaction of the
 * instance's `storage`. Admin operations go through `send_admin`.
 */
import { randomUUID } from 'node:crypto';
import * as CoreContract from '../../../generated/contract/core_contract.ts';
import * as GameContract from '../../../generated/contract/game_contract.ts';
import * as GameDataDev from '../../../dev/generated/data/game_data_dev.ts';
import type { GameTx, RequestCtx, Storage } from '../../storage/index.ts';
import { storage_module } from '../../storage/tests/helpers.ts';
import * as testing from '../../testing/dev/index.ts';
import { register_false_judges, register_required_hooks } from '../../testing/dev/index.ts';
import type { RemoteConfigModule } from '../index.ts';

export type Server = testing.TestServer;
export type Session = testing.TestSession;

export const START_AT = 1_800_000_000_000n;
export const DAY = 86_400_000n;
/**
 * `remote-config.cacheMs` of the test servers: below every other job period of the core settings, so moving the clock
 * by it starts only the cache job (two instances' write jobs at once on one SQLite file wait on each other).
 */
export const CACHE_MS = 1_000n;
export const MAX_GROUPS = 10;
export const MAX_STRING_BYTES = 1024;

/** The settings every remote-config test server uses, so expected values do not hang on the core settings defaults. */
export const SETTINGS: Readonly<Record<string, unknown>> = {
  'remote-config.cacheMs': Number(CACHE_MS),
  'remote-config.maxGroups': MAX_GROUPS,
  'remote-config.maxStringBytes': MAX_STRING_BYTES,
};

/** ID value of an ID name of the core test data. */
export function id(name: string): number {
  return GameDataDev.find_id_value(name);
}

export const KEY = {
  flag: id('[rc_flag]'),
  count: id('[rc_count]'),
  title: id('[rc_title]'),
  threshold: id('[rc_threshold]'),
  hidden_flag: id('[rc_hidden_flag]'),
} as const;

export const EXPERIMENT = { a: id('[exp_a]'), b: id('[exp_b]'), c: id('[exp_c]') } as const;

/** An ID value no `remote_config_key` or `experiment` row has. */
export const UNKNOWN_ID = 999_999;

export const CoreError = CoreContract.CoreError;

/** The `core` object content `register` gets, as these tests use it. */
export interface Core {
  readonly 'remote-config': RemoteConfigModule;
  readonly storage: Storage;
  readonly routing: { register_handler(name: string, handler: (ctx: RequestCtx, request: unknown) => unknown): void };
}

type RunFunction = (ctx: RequestCtx, core: Core) => unknown;

interface Pending {
  readonly fn: RunFunction;
  done: boolean;
  value: unknown;
}

/** The function of each `RunCoreTest` request ID that has not been answered yet. */
const pending = new Map<string, Pending>();

const RUN_CORE_TEST = 'RunCoreTest';

/** `RunCoreTest` of the core test data; undefined while the core test data has no such rpc. */
const RUN_INFO = GameContract.RPCS.find((rpc) => rpc.name === RUN_CORE_TEST);

/** True when `run` goes through `RunCoreTest`, so a throw is an `INTERNAL` response that `routing` logs. */
export const OVER_HTTP = RUN_INFO !== undefined;

/** The `core` object of the last `register` call: the instance that start, restart or peer start just made. */
let registered: Core | null = null;
const cores = new WeakMap<Server, Core>();

/**
 * `register` of every remote-config test server: the `RunCoreTest` handler, an empty response handler for each other
 * `service Game` rpc of the core test data, and the judge hooks.
 */
function register(core: Readonly<Record<string, unknown>>): void {
  const own = core as unknown as Core;
  for (const info of GameContract.RPCS) {
    if (info.name !== RUN_CORE_TEST) {
      own.routing.register_handler(info.name, () => new info.response_class());
      continue;
    }
    own.routing.register_handler(RUN_CORE_TEST, (ctx) => {
      const job = pending.get(ctx.request_id);
      if (job === undefined) throw new Error(`no core test function for request ${ctx.request_id}`);
      job.value = job.fn(ctx, own);
      job.done = true;
      return new info.response_class();
    });
  }
  register_false_judges(core);
  register_required_hooks(core);
  registered = own;
}

function take_registered(server: Server): Server {
  if (registered === null) throw new Error('the test server did not call register');
  cores.set(server, registered);
  registered = null;
  return server;
}

/**
 * The `core` object of a test server's running instance, with the `storage` module object: content `register(core)`
 * gets only its member `content`.
 */
export function core_of(server: Server): Core {
  const core = cores.get(server);
  if (core === undefined) throw new Error('not a remote-config test server');
  return { ...core, storage: storage_module(server) };
}

const started: Server[] = [];

afterEach(async () => {
  for (const server of started.splice(0).reverse()) if (!server.stopped) await testing.stop_test_server(server);
});

/** A LOCAL test server at `START_AT` with `SETTINGS` and the given settings overrides. */
export async function start(settings: Readonly<Record<string, unknown>> = {}): Promise<Server> {
  const server = await testing.start_test_server(START_AT, undefined, undefined, undefined, undefined, { ...SETTINGS, ...settings }, register);
  started.push(server);
  return take_registered(server);
}

/** Another server instance of the test server: same DB and clock, its own cache and scheduler. */
export async function peer(server: Server): Promise<Server> {
  const other = await testing.start_peer_server(server);
  started.push(other);
  return take_registered(other);
}

/** The test server on a new server instance. */
export async function restart(server: Server): Promise<Server> {
  return take_registered(await testing.restart_test_server(server));
}

/** Moves the test clock and waits for the jobs it starts on every given instance. */
export async function advance(ms: bigint, ...servers: readonly Server[]): Promise<void> {
  const [first] = servers;
  if (first === undefined) throw new Error('advance needs a test server');
  testing.advance_time(first, ms);
  for (const server of servers) await testing.wait_background(server);
}

let user_seq = 0;
const account_names = new WeakMap<Session, string>();

async function login_as(server: Server, account_name: string): Promise<Session> {
  const session = await testing.login(server, account_name);
  account_names.set(session, account_name);
  return session;
}

/** A new user of the test server. */
export function new_user(server: Server): Promise<Session> {
  user_seq += 1;
  return login_as(server, `remote_config_user_${String(user_seq)}`);
}

/** A new session of the same user, for a request after the clock moved past the access token's lifetime. */
export function relogin(session: Session): Promise<Session> {
  const name = account_names.get(session);
  if (name === undefined) throw new Error('not a session of new_user');
  return login_as(session.server as Server, name);
}

/** The session of the same user on another instance of the test server. */
export function on(server: Server, session: Session): Session {
  return { ...session, server };
}

export interface RunResult<T> {
  /** `ServerError.code` of `RunCoreTest`; 0 on success. Without `RunCoreTest`, `INTERNAL` when the function threw. */
  readonly code: number;
  /** What the function returned; undefined when the request failed. */
  readonly value: T | undefined;
  /** What the function threw; known only without `RunCoreTest`. */
  readonly thrown: unknown;
}

const FIELDS = { request_name: RUN_CORE_TEST, silent: false, retry: false, session_id: '', client_version: '', platform: '' };

/** Runs `fn` as the user in a request of the session's test server instance (`RunCoreTest`, or a request transaction). */
export async function run<T>(session: Session, fn: (ctx: RequestCtx, core: Core) => T): Promise<RunResult<T>> {
  const request_id = randomUUID();
  if (RUN_INFO === undefined) {
    const core = core_of(session.server as Server);
    let thrown: unknown = undefined;
    const result = await core.storage
      .run_request_transaction(session.user_id, { ...FIELDS, request_id }, (ctx) => fn(ctx, core))
      .catch((error: unknown) => {
        thrown = error;
        return 'THREW' as const;
      });
    if (result === 'THREW') return { code: CoreError.CORE_ERROR_INTERNAL, value: undefined, thrown };
    if (result === 'FAILED') throw new Error('request transaction FAILED');
    if (result === 'WITHDRAWN') throw new Error('request transaction WITHDRAWN');
    return { code: 0, value: result as T, thrown: undefined };
  }
  const job: Pending = { fn, done: false, value: undefined };
  pending.set(request_id, job);
  try {
    const { envelope } = await testing.send(session, RUN_CORE_TEST, new RUN_INFO.request_class(), request_id);
    const code = envelope.error?.code ?? 0;
    return { code, value: code === 0 && job.done ? (job.value as T) : undefined, thrown: undefined };
  } finally {
    pending.delete(request_id);
  }
}

/** Like `run`, and throws when the request fails. */
export async function run_ok<T>(session: Session, fn: (ctx: RequestCtx, core: Core) => T): Promise<T> {
  const result = await run(session, fn);
  if (result.code !== 0) throw new Error(`RunCoreTest failed with ${String(result.code)}`);
  return result.value as T;
}

/** `get_config` of one key in its own request. */
export function config(session: Session, key_id: number): Promise<CoreContract.RemoteConfigValue> {
  return run_ok(session, (ctx, core) => core['remote-config'].get_config(ctx, key_id));
}

/** The plain value of `get_config` of one key in its own request. */
export async function value(session: Session, key_id: number): Promise<boolean | bigint | string> {
  return plain(await config(session, key_id));
}

/** The `GetRemoteConfig` response of the user over HTTP. */
export async function get_remote_config(session: Session): Promise<CoreContract.GetRemoteConfigResponse> {
  const { envelope, response } = await testing.send(session, 'core/GetRemoteConfig', new CoreContract.GetRemoteConfigRequest());
  if (envelope.error !== null) throw new Error(`GetRemoteConfig failed with ${String(envelope.error.code)}`);
  return response as CoreContract.GetRemoteConfigResponse;
}

/** The output JSON of an admin operation, or its failure reason (`bad_request`, `not_found`, `conflict`, ...). */
export async function admin(server: Server, operation: string, body: Readonly<Record<string, unknown>> | string = {}): Promise<Record<string, unknown> | string> {
  const reply = await testing.send_admin(server, operation, body);
  const json = (reply.json ?? {}) as Record<string, unknown>;
  if (reply.status === 200) return json;
  return typeof json['error'] === 'string' ? json['error'] : `HTTP ${String(reply.status)}`;
}

export function set_value(server: Server, key_id: number, value_json: unknown): Promise<Record<string, unknown> | string> {
  return admin(server, 'set_config_value', { key_id, value: value_json });
}

export function clear_value(server: Server, key_id: number): Promise<Record<string, unknown> | string> {
  return admin(server, 'clear_config_value', { key_id });
}

export function stop_experiment(server: Server, experiment_id: number): Promise<Record<string, unknown> | string> {
  return admin(server, 'stop_experiment', { experiment_id });
}

export interface GroupInput {
  readonly name: string;
  readonly weight: number;
  readonly values: readonly unknown[];
}

export interface ExperimentInput {
  readonly operation_id?: string;
  readonly experiment_id: number;
  readonly salt?: string;
  readonly start_at?: bigint;
  readonly end_at?: bigint;
  readonly key_ids: readonly number[];
  readonly groups: readonly GroupInput[];
}

/** Two groups of weight 1 named `g1` and `g2`. */
export function two_groups(values_1: readonly unknown[], values_2: readonly unknown[] = values_1): GroupInput[] {
  return [
    { name: 'g1', weight: 1, values: values_1 },
    { name: 'g2', weight: 1, values: values_2 },
  ];
}

/** `put_experiment` with a new `operation_id`, salt `salt`, and the period [START_AT, START_AT + 1 day) by default. */
export function put_experiment(server: Server, input: ExperimentInput): Promise<Record<string, unknown> | string> {
  return admin(server, 'put_experiment', {
    operation_id: randomUUID(),
    salt: 'salt',
    start_at: START_AT,
    end_at: START_AT + DAY,
    ...input,
  });
}

/**
 * Writes stored rows the admin operations would not write, as rows an older data version left: an override row, or
 * an experiment row with its group values as stored texts (`true`/`false`, a decimal integer, or a JSON string).
 */
export async function write_rows(server: Server, write: (query: (sql: string, params: readonly unknown[]) => unknown) => void): Promise<void> {
  const storage = core_of(server).storage;
  const result = await storage.run_game_transaction((tx: GameTx) => {
    const db = storage.db(tx) as unknown as { query(sql: string, params: readonly unknown[]): unknown };
    write((sql, params) => db.query(sql, params));
    return 'done';
  });
  if (result === 'FAILED') throw new Error('writing the stored rows failed');
}

export function insert_override(query: (sql: string, params: readonly unknown[]) => unknown, key_id: number, stored: string): void {
  query('INSERT INTO remote_config_override (key_id, value, updated_at) VALUES ($1, $2, $3)', [key_id, stored, START_AT]);
}

export interface StoredExperiment {
  readonly experiment_id: number;
  readonly key_ids: readonly number[];
  readonly groups: readonly { readonly name: string; readonly weight: number; readonly values: readonly string[] }[];
  readonly salt?: string;
  readonly start_at?: bigint;
  readonly end_at?: bigint;
}

export function insert_experiment(query: (sql: string, params: readonly unknown[]) => unknown, e: StoredExperiment): void {
  query(
    'INSERT INTO remote_config_experiment (experiment_id, salt, start_at, end_at, key_ids, groups, stopped, updated_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)',
    [e.experiment_id, e.salt ?? 'salt', e.start_at ?? START_AT, e.end_at ?? START_AT + DAY, JSON.stringify(e.key_ids), JSON.stringify(e.groups), false, START_AT],
  );
}

/** The plain value of a `RemoteConfigValue`, checking that only the field of its kind holds a value. */
export function plain(v: CoreContract.RemoteConfigValue): boolean | bigint | string {
  const Kind = CoreContract.RemoteConfigValueKind;
  const set = { bool: v.bool_value, int: v.int_value !== 0n, string: v.string_value !== '' };
  switch (v.kind) {
    case Kind.REMOTE_CONFIG_VALUE_KIND_BOOL:
      expect(set.int || set.string).toBe(false);
      return v.bool_value;
    case Kind.REMOTE_CONFIG_VALUE_KIND_INT:
      expect(set.bool || set.string).toBe(false);
      return v.int_value;
    case Kind.REMOTE_CONFIG_VALUE_KIND_STRING:
      expect(set.bool || set.int).toBe(false);
      return v.string_value;
    default:
      throw new Error(`RemoteConfigValue kind ${String(v.kind)}`);
  }
}

/** A field of a log line, at its top level or in `fields`. */
export function field(line: Record<string, unknown>, name: string): unknown {
  if (name in line) return line[name];
  const fields = line['fields'];
  return typeof fields === 'object' && fields !== null ? (fields as Record<string, unknown>)[name] : undefined;
}

/** The `warn` lines remote-config wrote. */
export function warnings(server: Server): Record<string, unknown>[] {
  return testing.read_logs(server, 'core', 'warn').filter((line) => field(line, 'module') === 'remote-config');
}
