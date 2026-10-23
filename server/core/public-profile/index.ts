import * as CoreContract from '../../generated/contract/core_contract.ts';
import type { LogEntry, LogFields, Logging } from '../logging/index.ts';
import type { ServerTimeApi } from '../server-time/index.ts';
import type { ColumnInput, DbHandle, RequestCtx, Storage } from '../storage/index.ts';

/** The last active table (`### last active`): `user` scope, key `user_id`, not in the user snapshot. */
export const ACTIVITY_TABLE = 'public_profile_activity';

const INT64_MAX = 2n ** 63n - 1n;

/** The `storage` operations public-profile calls (`storage` `## API`). */
export type PublicProfileStorage = Pick<Storage, 'register_table' | 'run_read_only' | 'run_user_transaction' | 'db' | 'read_db' | 'get_user_record'>;

/** The `server-time` operations public-profile calls (`server-time` `## API`). */
export type PublicProfileServerTime = Pick<ServerTimeApi, 'clock_now'>;

/** The `logging` operations public-profile calls (`logging` `## API`). */
export type PublicProfileLogging = Pick<Logging, 'write'>;

/** A `nickname.get_nicknames` output element: a user that has a nickname. */
export interface UserNickname {
  readonly user_id: bigint;
  readonly nickname: string;
}

/** The `nickname` operations public-profile calls (`nickname` `## API`). */
export interface PublicProfileNickname {
  get_nicknames(ctx: RequestCtx, user_ids: readonly bigint[]): readonly UserNickname[];
}

/** Hook `build_public_profile`: the bytes of the game `PublicProfile` message of the target user. ctx is read only. */
export type BuildPublicProfileHook = (ctx: RequestCtx, user_id: bigint) => Uint8Array;

/** The hook slots `routing` fills after content `register` (`routing` `## API`). */
export interface PublicProfileHookSlots {
  build_public_profile: BuildPublicProfileHook | null;
}

export type InvalidRequest = typeof CoreContract.CoreError.CORE_ERROR_INVALID_REQUEST;

/** The handler of the core `rpc` `GetPublicProfiles`. */
export type GetPublicProfilesHandler = (ctx: RequestCtx, request: CoreContract.GetPublicProfilesRequest) => CoreContract.GetPublicProfilesResponse | InvalidRequest;

/** The `## API` operations of `public-profile`. */
export interface PublicProfileApi {
  GetPublicProfiles: GetPublicProfilesHandler;
  /** No user ID limit: `nickname.get_nicknames` gets `public-profile.maxRequestCount` IDs at most per call. Throws when the hook fails. */
  get_public_profiles(ctx: RequestCtx, user_ids: readonly bigint[]): CoreContract.PublicProfileEntry[];
  is_active_user(ctx: RequestCtx, user_id: bigint): boolean;
  /** Records the last active time; a failed transaction leaves an `error` log and resolves all the same. */
  on_request_start(user_id: bigint): Promise<null>;
}

/** `public-profile` of one server instance: the `## API` operations, the hook slots and the lifecycle. */
export interface PublicProfile extends PublicProfileApi {
  readonly hook_slots: PublicProfileHookSlots;
  begin_start(): void;
  complete_start(): string | null;
  stop(): void;
}

/**
 * The module input (`server-core` `## module`): `settings` holds the keys of `## settings`, `modules` the module
 * objects of `storage`, `nickname`, `logging` and `server-time`. public-profile reads nothing of `server`.
 */
export interface PublicProfileInput {
  readonly settings: Readonly<Record<string, unknown>>;
  readonly modules: Readonly<Record<string, unknown>>;
  readonly server?: unknown;
}

const INVALID_REQUEST: InvalidRequest = CoreContract.CoreError.CORE_ERROR_INVALID_REQUEST;

const ACTIVITY_COLUMNS: readonly ColumnInput[] = [
  { name: 'user_id', type: 'int64' },
  { name: 'last_active_at', type: 'int64' },
];

function integer_setting(settings: Readonly<Record<string, unknown>>, key: string, min: number): number {
  const value = settings[key];
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min) {
    throw new TypeError(`public-profile: setting ${key} is not an integer of ${String(min)} or more`);
  }
  return value;
}

function required_module<T>(modules: Readonly<Record<string, unknown>>, name: string, methods: readonly (keyof T & string)[]): T {
  const module = modules[name];
  if (typeof module !== 'object' || module === null) throw new TypeError(`public-profile: module ${name} is missing`);
  const record = module as Record<string, unknown>;
  const missing = methods.find((method) => typeof record[method] !== 'function');
  if (missing !== undefined) throw new TypeError(`public-profile: module ${name} has no ${missing}`);
  return module as T;
}

function compare(a: bigint, b: bigint): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** `items` split into consecutive lists of `size` items, the last one shorter. */
function chunks<T>(items: readonly T[], size: number): T[][] {
  const result: T[][] = [];
  for (let i = 0; i < items.length; i += size) result.push(items.slice(i, i + size));
  return result;
}

function int64(value: unknown, what: string): bigint {
  if (typeof value === 'bigint') return value;
  if (typeof value === 'number' && Number.isSafeInteger(value)) return BigInt(value);
  throw new TypeError(`public-profile: ${what} is not an integer`);
}

/** The `last_active_at` of each user that has a row in the last active table. */
function read_activity(db: DbHandle, user_ids: readonly bigint[]): Map<bigint, bigint> {
  const result = new Map<bigint, bigint>();
  if (user_ids.length === 0) return result;
  const params = user_ids.map((_, i) => `$${String(i + 1)}`).join(', ');
  for (const row of db.query(`SELECT user_id, last_active_at FROM ${ACTIVITY_TABLE} WHERE user_id IN (${params})`, user_ids)) {
    result.set(int64(row.user_id, `${ACTIVITY_TABLE}.user_id`), int64(row.last_active_at, `${ACTIVITY_TABLE}.last_active_at`));
  }
  return result;
}

/** Whether `user_ids` passes the `(ogw.v)` of `GetPublicProfilesRequest.user_ids`. */
function valid_request_ids(user_ids: readonly bigint[], max_count: number): boolean {
  if (user_ids.length < 1 || user_ids.length > max_count) return false;
  if (user_ids.some((id) => id < 1n || id > INT64_MAX)) return false;
  return new Set(user_ids).size === user_ids.length;
}

function message_of(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Makes `public-profile` for one server instance and registers its last active table. A missing setting or module throws. */
export function create_public_profile(input: PublicProfileInput): PublicProfile {
  const { settings } = input;
  const max_request_count = integer_setting(settings, 'public-profile.maxRequestCount', 1);
  const max_profile_bytes = integer_setting(settings, 'public-profile.maxProfileBytes', 1);
  const granularity_ms = BigInt(integer_setting(settings, 'public-profile.lastActiveGranularityMs', 0));
  const storage = required_module<PublicProfileStorage>(input.modules, 'storage', ['register_table', 'run_read_only', 'run_user_transaction', 'db', 'read_db', 'get_user_record']);
  const nickname = required_module<PublicProfileNickname>(input.modules, 'nickname', ['get_nicknames']);
  const logging = required_module<PublicProfileLogging>(input.modules, 'logging', ['write']);
  const server_time = required_module<PublicProfileServerTime>(input.modules, 'server-time', ['clock_now']);
  storage.register_table(ACTIVITY_TABLE, 'user', ACTIVITY_COLUMNS, ['user_id'], null, false);

  const hook_slots: PublicProfileHookSlots = { build_public_profile: null };

  const write_error = (user_id: bigint, message: string, fields: LogFields): void => {
    const entry: LogEntry = { kind: 'error', level: 'error', message, user_id, request_id: null, request: null, fields: { stack_trace: null, ...fields } };
    logging.write(entry);
  };

  const is_active_user = (ctx: RequestCtx, user_id: bigint): boolean => {
    const record = storage.get_user_record(storage.db(ctx), user_id);
    return record !== null && record.withdrawn_at === null;
  };

  /**
   * The hook output of one target user. A hook throw or a wrong output throws with the target user ID in the message;
   * `routing` logs it as the request's `error` log.
   */
  const build_profile = (ctx: RequestCtx, user_id: bigint): Uint8Array => {
    const hook = hook_slots.build_public_profile;
    if (hook === null) return new Uint8Array(0);
    let output: unknown;
    try {
      output = hook(ctx, user_id);
    } catch (error) {
      throw new Error(`public-profile: build_public_profile of user ${String(user_id)} threw: ${message_of(error)}`, { cause: error });
    }
    if (!(output instanceof Uint8Array) || output.length > max_profile_bytes) {
      const reason = output instanceof Uint8Array ? `the output is ${String(output.length)} bytes, over public-profile.maxProfileBytes` : 'the output is not bytes';
      throw new Error(`public-profile: build_public_profile of user ${String(user_id)}: ${reason}`);
    }
    return output;
  };

  const get_public_profiles = (ctx: RequestCtx, user_ids: readonly bigint[]): CoreContract.PublicProfileEntry[] => {
    return storage.run_read_only(ctx, () => {
      const ids = [...new Set(user_ids)].sort(compare).filter((id) => is_active_user(ctx, id));
      const profiles = new Map(ids.map((id) => [id, build_profile(ctx, id)] as const));
      const nicknames = new Map<bigint, string>();
      const activity = new Map<bigint, bigint>();
      for (const chunk of chunks(ids, max_request_count)) {
        for (const entry of nickname.get_nicknames(ctx, chunk)) nicknames.set(entry.user_id, entry.nickname);
        // `public-profile.lastActiveGranularityMs` 0: `last_active_at` is 0 even for a row written under another value.
        if (granularity_ms !== 0n) for (const [id, at] of read_activity(storage.db(ctx), chunk)) activity.set(id, at);
      }
      return ids.map((id) => {
        const entry = new CoreContract.PublicProfileEntry();
        entry.user_id = id;
        entry.nickname = nicknames.get(id) ?? '';
        entry.profile = profiles.get(id) ?? new Uint8Array(0);
        entry.last_active_at = activity.get(id) ?? 0n;
        return entry;
      });
    });
  };

  const on_request_start = async (user_id: bigint): Promise<null> => {
    if (granularity_ms === 0n) return null;
    const v = (server_time.clock_now() / granularity_ms) * granularity_ms;
    let result: Awaited<ReturnType<Storage['run_user_transaction']>>;
    try {
      const stored = read_activity(storage.read_db(), [user_id]).get(user_id);
      if (stored !== undefined && stored >= v) return null;
      result = await storage.run_user_transaction(user_id, (ctx) => {
        storage.db(ctx).query(
          `INSERT INTO ${ACTIVITY_TABLE} (user_id, last_active_at) VALUES ($1, $2) ON CONFLICT (user_id) DO UPDATE SET last_active_at = ` +
            `CASE WHEN ${ACTIVITY_TABLE}.last_active_at > excluded.last_active_at THEN ${ACTIVITY_TABLE}.last_active_at ELSE excluded.last_active_at END`,
          [user_id, v],
        );
        return 'pass';
      });
    } catch (error) {
      write_error(user_id, 'public-profile: recording the last active time failed', { reason: message_of(error) });
      return null;
    }
    if (result !== 'COMMITTED' && result !== 'WITHDRAWN') {
      write_error(user_id, 'public-profile: recording the last active time failed', { reason: result });
    }
    return null;
  };

  return {
    GetPublicProfiles: (ctx, request) => {
      if (!valid_request_ids(request.user_ids, max_request_count)) return INVALID_REQUEST;
      const response = new CoreContract.GetPublicProfilesResponse();
      response.profiles = get_public_profiles(ctx, request.user_ids);
      return response;
    },
    get_public_profiles,
    is_active_user,
    on_request_start,
    hook_slots,
    begin_start: () => {},
    complete_start: () => null,
    stop: () => {},
  };
}
