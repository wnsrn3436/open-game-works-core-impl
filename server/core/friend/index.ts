/**
 * friend: the friend relation between two users (request, accept, decline, cancel, remove), the friend list and
 * the search of users by nickname.
 */
import * as CoreContract from '../../generated/contract/core_contract.ts';
import type { ServerTimeApi } from '../server-time/index.ts';
import type { ColumnInput, DbHandle, RequestCtx, Storage } from '../storage/index.ts';

/** The `storage` operations friend calls. */
export type FriendStorage = Pick<Storage, 'register_table' | 'lock_game_row' | 'db' | 'get_state'>;

/** The `server-time` operation friend calls. */
export type FriendServerTime = Pick<ServerTimeApi, 'now'>;

/** The `nickname` operation friend calls (`nickname` `## API`). */
export interface FriendNickname {
  find_user_ids_by_nickname(ctx: RequestCtx, nickname: string, max: number): bigint[];
}

/** The `public-profile` operations friend calls (`public-profile` `## API`). */
export interface FriendPublicProfile {
  get_public_profiles(ctx: RequestCtx, user_ids: readonly bigint[]): CoreContract.PublicProfileEntry[];
  is_active_user(ctx: RequestCtx, user_id: bigint): boolean;
}

/** The function friend gives to `block-report.register_block_listener`. A lock failure throws. */
export type BlockListener = (ctx: RequestCtx, blocker_id: bigint, blocked_id: bigint) => void;

/** The `block-report` operations friend calls (`block-report` `## API`). */
export interface FriendBlockReport {
  is_blocked_either(ctx: RequestCtx, a: bigint, b: bigint): boolean;
  register_block_listener(fn: BlockListener): void;
}

/** What the after hook `on_friend_changed` gets: which change happened. */
export type FriendChange = 'Requested' | 'Accepted' | 'Declined' | 'Canceled' | 'Removed';

/**
 * The hook `on_friend_changed`: ctx of the user who sent the rpc, the other user ID and the change. Its output is none;
 * content may register a function that returns a value, which fails the request.
 */
export type FriendChangedHook = (ctx: RequestCtx, other_id: bigint, change: FriendChange) => unknown;

/** The hook slots `routing` fills after content `register`. */
export interface FriendHookSlots {
  on_friend_changed: FriendChangedHook | null;
}

/** The module input (`server-core` `## module`). friend reads nothing of `server`. */
export interface FriendInput {
  readonly settings: Readonly<Record<string, unknown>>;
  readonly modules: Readonly<Record<string, unknown>>;
  readonly server?: unknown;
}

type CoreError = CoreContract.CoreError;
export type Failed = 'FAILED';

/** The `friend` module object: the core `rpc` handlers, the internal operations, the hook slots and the lifecycle. */
export interface FriendModule {
  SendFriendRequest(ctx: RequestCtx, request: CoreContract.SendFriendRequestRequest): CoreContract.SendFriendRequestResponse | CoreError;
  AcceptFriendRequest(ctx: RequestCtx, request: CoreContract.AcceptFriendRequestRequest): CoreContract.AcceptFriendRequestResponse | CoreError;
  DeclineFriendRequest(ctx: RequestCtx, request: CoreContract.DeclineFriendRequestRequest): CoreContract.DeclineFriendRequestResponse | CoreError;
  CancelFriendRequest(ctx: RequestCtx, request: CoreContract.CancelFriendRequestRequest): CoreContract.CancelFriendRequestResponse | CoreError;
  RemoveFriend(ctx: RequestCtx, request: CoreContract.RemoveFriendRequest): CoreContract.RemoveFriendResponse | CoreError;
  GetFriends(ctx: RequestCtx, request: CoreContract.GetFriendsRequest): CoreContract.GetFriendsResponse;
  SearchUsers(ctx: RequestCtx, request: CoreContract.SearchUsersRequest): CoreContract.SearchUsersResponse | CoreError;
  are_friends(ctx: RequestCtx, a: bigint, b: bigint): boolean;
  list_friend_ids(ctx: RequestCtx, user_id: bigint): bigint[];
  remove_user(ctx: RequestCtx): null | Failed;
  readonly hook_slots: FriendHookSlots;
  begin_start(): void;
  complete_start(): string | null;
  stop(): void;
}

export const LINK_TABLE = 'friend_link';
export const COUNT_TABLE = 'friend_count';

const LINK_COLUMNS: readonly ColumnInput[] = [
  { name: 'user_id', type: 'int64' },
  { name: 'other_id', type: 'int64' },
  { name: 'state', type: 'string' },
  { name: 'created_at', type: 'int64' },
  { name: 'updated_at', type: 'int64' },
];

const COUNT_COLUMNS: readonly ColumnInput[] = [
  { name: 'user_id', type: 'int64' },
  { name: 'friend_count', type: 'int32' },
  { name: 'sent_count', type: 'int32' },
  { name: 'received_count', type: 'int32' },
];

const SELECT_LINK = `SELECT state FROM ${LINK_TABLE} WHERE user_id = $1 AND other_id = $2`;
const SELECT_LINKS = `SELECT other_id, state, updated_at FROM ${LINK_TABLE} WHERE user_id = $1`;
const SELECT_FRIEND_IDS = `SELECT other_id FROM ${LINK_TABLE} WHERE user_id = $1 AND state = $2 ORDER BY other_id`;
const INSERT_LINK = `INSERT INTO ${LINK_TABLE} (user_id, other_id, state, created_at, updated_at) VALUES ($1, $2, $3, $4, $4)`;
const UPDATE_LINK = `UPDATE ${LINK_TABLE} SET state = $3, updated_at = $4 WHERE user_id = $1 AND other_id = $2`;
const DELETE_PAIR = `DELETE FROM ${LINK_TABLE} WHERE (user_id = $1 AND other_id = $2) OR (user_id = $2 AND other_id = $1)`;
const DELETE_LINK = `DELETE FROM ${LINK_TABLE} WHERE user_id = $1 AND other_id = $2`;
const DELETE_USER_LINKS = `DELETE FROM ${LINK_TABLE} WHERE user_id = $1`;
const SELECT_COUNT = `SELECT friend_count, sent_count, received_count FROM ${COUNT_TABLE} WHERE user_id = $1`;
const UPSERT_COUNT =
  `INSERT INTO ${COUNT_TABLE} (user_id, friend_count, sent_count, received_count) VALUES ($1, $2, $3, $4) ` +
  'ON CONFLICT (user_id) DO UPDATE SET friend_count = excluded.friend_count, sent_count = excluded.sent_count, received_count = excluded.received_count';
const DELETE_COUNT = `DELETE FROM ${COUNT_TABLE} WHERE user_id = $1`;

const { CoreError, FriendState } = CoreContract;

/** The `state` column stores the element name of `FriendState`. */
const FRIEND = 'FRIEND_STATE_FRIEND';
const SENT = 'FRIEND_STATE_SENT';
const RECEIVED = 'FRIEND_STATE_RECEIVED';
type LinkState = typeof FRIEND | typeof SENT | typeof RECEIVED;

const STATE_VALUE: Readonly<Record<LinkState, CoreContract.FriendState>> = {
  [FRIEND]: FriendState.FRIEND_STATE_FRIEND,
  [SENT]: FriendState.FRIEND_STATE_SENT,
  [RECEIVED]: FriendState.FRIEND_STATE_RECEIVED,
};

/** `GetFriends` order: `Friend`, `Received`, `Sent`. */
const LIST_ORDER: Readonly<Record<LinkState, number>> = { [FRIEND]: 0, [RECEIVED]: 1, [SENT]: 2 };

interface Counts {
  friend_count: number;
  sent_count: number;
  received_count: number;
}

interface Link {
  readonly other_id: bigint;
  readonly state: LinkState;
  readonly updated_at: bigint;
}

function integer_setting(settings: Readonly<Record<string, unknown>>, key: string): number {
  const value = settings[key];
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) throw new TypeError(`friend: setting ${key} is not an integer of 0 or more`);
  return value;
}

function boolean_setting(settings: Readonly<Record<string, unknown>>, key: string): boolean {
  const value = settings[key];
  if (typeof value !== 'boolean') throw new TypeError(`friend: setting ${key} is not a boolean`);
  return value;
}

function required_module<T>(modules: Readonly<Record<string, unknown>>, name: string, methods: readonly (keyof T & string)[]): T {
  const module = modules[name];
  if (typeof module !== 'object' || module === null) throw new TypeError(`friend: module ${name} is missing`);
  const record = module as Record<string, unknown>;
  const missing = methods.find((method) => typeof record[method] !== 'function');
  if (missing !== undefined) throw new TypeError(`friend: module ${name} has no ${missing}`);
  return module as T;
}

function link_state(value: unknown): LinkState {
  if (value === FRIEND || value === SENT || value === RECEIVED) return value;
  throw new TypeError(`friend: ${LINK_TABLE} has a state ${String(value)}`);
}

function big(value: unknown): bigint {
  if (typeof value !== 'bigint') throw new TypeError(`friend: an int64 column is ${typeof value}`);
  return value;
}

function int(value: unknown): number {
  if (typeof value !== 'number') throw new TypeError(`friend: an int32 column is ${typeof value}`);
  return value;
}

function read_state(db: DbHandle, user_id: bigint, other_id: bigint): LinkState | null {
  const row = db.query(SELECT_LINK, [user_id, other_id])[0];
  return row === undefined ? null : link_state(row['state']);
}

function read_links(db: DbHandle, user_id: bigint): Link[] {
  return db.query(SELECT_LINKS, [user_id]).map((row) => ({ other_id: big(row['other_id']), state: link_state(row['state']), updated_at: big(row['updated_at']) }));
}

function read_counts(db: DbHandle, user_id: bigint): Counts {
  const row = db.query(SELECT_COUNT, [user_id])[0];
  if (row === undefined) return { friend_count: 0, sent_count: 0, received_count: 0 };
  return { friend_count: int(row['friend_count']), sent_count: int(row['sent_count']), received_count: int(row['received_count']) };
}

function write_counts(db: DbHandle, user_id: bigint, counts: Counts): void {
  db.query(UPSERT_COUNT, [user_id, counts.friend_count, counts.sent_count, counts.received_count]);
}

/** The state the other user of a link row sees. */
function mirror(state: LinkState): LinkState {
  return state === SENT ? RECEIVED : state === RECEIVED ? SENT : FRIEND;
}

/** Deletes the two link rows of the users and takes the relation, `state` as `a` saw it, out of both users' counts. */
function delete_relation(db: DbHandle, a: bigint, b: bigint, state: LinkState): void {
  db.query(DELETE_PAIR, [a, b]);
  shift_counts(db, a, state, -1);
  shift_counts(db, b, mirror(state), -1);
}

function compare_ids(a: bigint, b: bigint): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Adds `delta` to the counts of the user, by the state that user saw: `Friend`, `Sent` or `Received`. */
function shift_counts(db: DbHandle, user_id: bigint, state: LinkState, delta: number): void {
  const counts = read_counts(db, user_id);
  if (state === FRIEND) counts.friend_count += delta;
  else if (state === SENT) counts.sent_count += delta;
  else counts.received_count += delta;
  write_counts(db, user_id, counts);
}

/** Makes `friend` for one server instance. A missing setting or dependency throws. */
export function create_friend(input: FriendInput): FriendModule {
  const settings = input.settings;
  const max_friends = integer_setting(settings, 'friend.maxFriends');
  const max_sent = integer_setting(settings, 'friend.maxSentRequests');
  const max_received = integer_setting(settings, 'friend.maxReceivedRequests');
  const max_search = integer_setting(settings, 'friend.maxSearchResults');
  const max_lookup = integer_setting(settings, 'nickname.maxLookupCount');
  const max_profiles = integer_setting(settings, 'public-profile.maxRequestCount');
  const allow_child = boolean_setting(settings, 'chat.allowChild');
  if (max_profiles < 1) throw new TypeError('friend: setting public-profile.maxRequestCount is below 1');

  const storage = required_module<FriendStorage>(input.modules, 'storage', ['register_table', 'lock_game_row', 'db', 'get_state']);
  const server_time = required_module<FriendServerTime>(input.modules, 'server-time', ['now']);
  const nickname = required_module<FriendNickname>(input.modules, 'nickname', ['find_user_ids_by_nickname']);
  const profile = required_module<FriendPublicProfile>(input.modules, 'public-profile', ['get_public_profiles', 'is_active_user']);
  const block = required_module<FriendBlockReport>(input.modules, 'block-report', ['is_blocked_either', 'register_block_listener']);

  const hook_slots: FriendHookSlots = { on_friend_changed: null };

  /**
   * Calls the after hook in the transaction of the change. A throw of the hook and an output that is not none (a value
   * or a Promise) go to `routing` as a throw, which ends the request with `INTERNAL`.
   */
  const changed = (ctx: RequestCtx, other_id: bigint, change: FriendChange): void => {
    const hook = hook_slots.on_friend_changed;
    if (hook === null) return;
    const output = hook(ctx, other_id, change);
    if (output !== undefined && output !== null) throw new TypeError(`friend: hook on_friend_changed returned a value of type ${typeof output}, not its output form`);
  };

  /** Locks the `friend_count` rows of the two users, the smaller user ID first. */
  const lock_pair = (ctx: RequestCtx, a: bigint, b: bigint): Failed | null => {
    const [first, second] = a < b ? [a, b] : [b, a];
    if (storage.lock_game_row(ctx, COUNT_TABLE, [first]) === 'FAILED') return 'FAILED';
    if (storage.lock_game_row(ctx, COUNT_TABLE, [second]) === 'FAILED') return 'FAILED';
    return null;
  };

  /** `AcceptFriendRequest` steps 2 to 5 on a `Received` row of (me, target). */
  const accept = (ctx: RequestCtx, db: DbHandle, me: bigint, target: bigint): CoreError | null => {
    const mine = read_counts(db, me);
    if (mine.friend_count >= max_friends) return CoreError.CORE_ERROR_FRIEND_LIMIT;
    const theirs = read_counts(db, target);
    if (theirs.friend_count >= max_friends) return CoreError.CORE_ERROR_FRIEND_TARGET_LIMIT;
    const now = server_time.now(ctx);
    db.query(UPDATE_LINK, [me, target, FRIEND, now]);
    db.query(UPDATE_LINK, [target, me, FRIEND, now]);
    mine.received_count -= 1;
    mine.friend_count += 1;
    theirs.sent_count -= 1;
    theirs.friend_count += 1;
    write_counts(db, me, mine);
    write_counts(db, target, theirs);
    return null;
  };

  /**
   * Decline, cancel and remove: locks both count rows, needs the (me, target) row in `state`, deletes both rows and
   * takes the relation out of both users' counts.
   */
  const drop = (ctx: RequestCtx, target: bigint, state: LinkState, missing: CoreError, change: FriendChange): CoreError | null => {
    const me = ctx.user_id;
    if (target < 1n) return CoreError.CORE_ERROR_INVALID_REQUEST;
    if (lock_pair(ctx, me, target) === 'FAILED') return CoreError.CORE_ERROR_INTERNAL;
    const db = storage.db(ctx);
    if (read_state(db, me, target) !== state) return missing;
    delete_relation(db, me, target, state);
    changed(ctx, target, change);
    return null;
  };

  /** Profiles of the user IDs, `public-profile.maxRequestCount` users per call, by user ID. */
  const profiles_of = (ctx: RequestCtx, user_ids: readonly bigint[]): Map<bigint, CoreContract.PublicProfileEntry> => {
    const found = new Map<bigint, CoreContract.PublicProfileEntry>();
    for (let start = 0; start < user_ids.length; start += max_profiles) {
      for (const entry of profile.get_public_profiles(ctx, user_ids.slice(start, start + max_profiles))) found.set(entry.user_id, entry);
    }
    return found;
  };

  /** The block listener: deletes the relation of the two users and takes it out of their counts. */
  const on_block: BlockListener = (ctx, blocker_id, blocked_id) => {
    if (lock_pair(ctx, blocker_id, blocked_id) === 'FAILED') throw new Error('friend: friend_count lock wait timed out in the block listener');
    const db = storage.db(ctx);
    const state = read_state(db, blocker_id, blocked_id);
    if (state !== null) delete_relation(db, blocker_id, blocked_id, state);
  };

  return {
    SendFriendRequest: (ctx, request) => {
      const me = ctx.user_id;
      const target = request.user_id;
      if (target < 1n || target === me) return CoreError.CORE_ERROR_INVALID_REQUEST;
      if (lock_pair(ctx, me, target) === 'FAILED') return CoreError.CORE_ERROR_INTERNAL;
      const db = storage.db(ctx);
      const state = read_state(db, me, target);
      if (!profile.is_active_user(ctx, target)) return CoreError.CORE_ERROR_USER_NOT_FOUND;
      if (block.is_blocked_either(ctx, me, target)) return CoreError.CORE_ERROR_BLOCKED;
      const response = new CoreContract.SendFriendRequestResponse();
      if (state === FRIEND) return CoreError.CORE_ERROR_FRIEND_ALREADY;
      if (state === SENT) {
        response.state = FriendState.FRIEND_STATE_SENT;
        return response;
      }
      if (state === RECEIVED) {
        const failure = accept(ctx, db, me, target);
        if (failure !== null) return failure;
        changed(ctx, target, 'Accepted');
        response.state = FriendState.FRIEND_STATE_FRIEND;
        return response;
      }
      const mine = read_counts(db, me);
      if (mine.friend_count >= max_friends) return CoreError.CORE_ERROR_FRIEND_LIMIT;
      if (mine.sent_count >= max_sent) return CoreError.CORE_ERROR_FRIEND_REQUEST_LIMIT;
      const theirs = read_counts(db, target);
      if (theirs.friend_count >= max_friends || theirs.received_count >= max_received) return CoreError.CORE_ERROR_FRIEND_TARGET_LIMIT;
      const now = server_time.now(ctx);
      db.query(INSERT_LINK, [me, target, SENT, now]);
      db.query(INSERT_LINK, [target, me, RECEIVED, now]);
      mine.sent_count += 1;
      theirs.received_count += 1;
      write_counts(db, me, mine);
      write_counts(db, target, theirs);
      changed(ctx, target, 'Requested');
      response.state = FriendState.FRIEND_STATE_SENT;
      return response;
    },
    AcceptFriendRequest: (ctx, request) => {
      const me = ctx.user_id;
      const target = request.user_id;
      if (target < 1n) return CoreError.CORE_ERROR_INVALID_REQUEST;
      if (lock_pair(ctx, me, target) === 'FAILED') return CoreError.CORE_ERROR_INTERNAL;
      const db = storage.db(ctx);
      if (read_state(db, me, target) !== RECEIVED) return CoreError.CORE_ERROR_FRIEND_REQUEST_NOT_FOUND;
      const failure = accept(ctx, db, me, target);
      if (failure !== null) return failure;
      changed(ctx, target, 'Accepted');
      return new CoreContract.AcceptFriendRequestResponse();
    },
    DeclineFriendRequest: (ctx, request) =>
      drop(ctx, request.user_id, RECEIVED, CoreError.CORE_ERROR_FRIEND_REQUEST_NOT_FOUND, 'Declined') ?? new CoreContract.DeclineFriendRequestResponse(),
    CancelFriendRequest: (ctx, request) =>
      drop(ctx, request.user_id, SENT, CoreError.CORE_ERROR_FRIEND_REQUEST_NOT_FOUND, 'Canceled') ?? new CoreContract.CancelFriendRequestResponse(),
    RemoveFriend: (ctx, request) => drop(ctx, request.user_id, FRIEND, CoreError.CORE_ERROR_FRIEND_NOT_FOUND, 'Removed') ?? new CoreContract.RemoveFriendResponse(),
    GetFriends: (ctx) => {
      const links = read_links(storage.db(ctx), ctx.user_id).sort(
        (a, b) => LIST_ORDER[a.state] - LIST_ORDER[b.state] || compare_ids(b.updated_at, a.updated_at) || compare_ids(a.other_id, b.other_id),
      );
      const found = profiles_of(ctx, links.map((link) => link.other_id));
      const response = new CoreContract.GetFriendsResponse();
      for (const link of links) {
        const entry = found.get(link.other_id);
        if (entry === undefined) continue;
        const friend = new CoreContract.FriendEntry();
        friend.profile = entry;
        friend.state = STATE_VALUE[link.state];
        friend.updated_at = link.updated_at;
        response.friends.push(friend);
      }
      return response;
    },
    SearchUsers: (ctx, request) => {
      if (!allow_child) {
        const consent = storage.get_state(ctx, CoreContract.ConsentUserState, 0n);
        if (consent instanceof CoreContract.ConsentUserState && consent.child) return CoreError.CORE_ERROR_CHILD_RESTRICTED;
      }
      const me = ctx.user_id;
      const ids = nickname
        .find_user_ids_by_nickname(ctx, request.nickname, max_lookup)
        .filter((id) => id !== me && !block.is_blocked_either(ctx, me, id))
        .sort(compare_ids)
        .slice(0, max_search);
      const response = new CoreContract.SearchUsersResponse();
      if (ids.length > 0) response.users = profile.get_public_profiles(ctx, ids);
      return response;
    },
    are_friends: (ctx, a, b) => read_state(storage.db(ctx), a, b) === FRIEND,
    list_friend_ids: (ctx, user_id) => storage.db(ctx).query(SELECT_FRIEND_IDS, [user_id, FRIEND]).map((row) => big(row['other_id'])),
    remove_user: (ctx) => {
      const me = ctx.user_id;
      const db = storage.db(ctx);
      const others = read_links(db, me).map((link) => link.other_id);
      const locked = [me, ...others].sort(compare_ids);
      for (const user_id of locked) {
        if (storage.lock_game_row(ctx, COUNT_TABLE, [user_id]) === 'FAILED') return 'FAILED';
      }
      const lockset = new Set(locked);
      const links = read_links(db, me);
      if (links.some((link) => !lockset.has(link.other_id))) return 'FAILED';
      // The user's own count row goes, so only the others' counts come down. Each row is picked by its key.
      for (const link of links) {
        shift_counts(db, link.other_id, mirror(link.state), -1);
        db.query(DELETE_LINK, [link.other_id, me]);
      }
      db.query(DELETE_USER_LINKS, [me]);
      db.query(DELETE_COUNT, [me]);
      return null;
    },
    hook_slots,
    begin_start: () => {
      storage.register_table(LINK_TABLE, 'game', LINK_COLUMNS, ['user_id', 'other_id'], null, null, 'user_id');
      storage.register_table(COUNT_TABLE, 'game', COUNT_COLUMNS, ['user_id'], null, null, 'user_id');
      block.register_block_listener(on_block);
    },
    complete_start: () => null,
    stop: () => {},
  };
}
