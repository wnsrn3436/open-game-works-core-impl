/**
 * The `/realtime` side of matchmaker in the server instance's memory: connections (`### connection`,
 * `### security`), queues (`### matching`), rooms and parties (`### room`), and match creation
 * (`### match creation`). Each connection's frames are handled one after another.
 */
import { randomInt, randomUUID } from 'node:crypto';
import type { Duplex } from 'node:stream';
import * as CoreContract from '../../generated/contract/core_contract.ts';
import * as GameData from '../../generated/data/game_data.ts';
import type { Connection, ErrorCode } from './deps.ts';
import { run_queue, type MatchRule, type QueueEntry, type QueueMember, type QueueStep } from './matching.ts';
import { build_record, type MatchRecord, type MatchSource } from './records.ts';
import type { Results } from './results.ts';
import { CoreError, FrameKind, duration_of, is_banned, log_error, log_security, mode_of, new_seed, type Env } from './shared.ts';
import { WebSocketConnection, handshake_response, type Violation } from './websocket.ts';

/** The route request `routing` passes (`routing` `## API`); `upgrade` is the WebSocket upgrade's socket. */
export interface RouteRequest {
  readonly method: string;
  readonly path: string;
  readonly headers: Readonly<Record<string, unknown>>;
  readonly upgrade: { readonly socket: Duplex; readonly head: Uint8Array } | null;
}

export interface RouteResponse {
  readonly status: number;
  readonly headers?: Readonly<Record<string, string>>;
  readonly body?: Uint8Array | string;
}

export interface Realtime {
  /** The route `GET /realtime`: null once the WebSocket took the connection. */
  route(request: RouteRequest, ip: string): RouteResponse | null;
  /** The work of job `matchmaker_tick`. */
  tick(): Promise<void>;
  stop(): void;
}

const DATA_VERSION = /^[0-9a-f]{64}-[0-9a-f]{64}$/;
const APP_VERSION = /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/;
const WINDOW_MS = 1000n;
/** Room code draws before a `ROOM_CREATE` is `ROOM_BUSY` (`### room`). */
const ROOM_CODE_DRAWS = 100;
/** The WebSocket close code after `CLOSE`; its reason is the `CLOSE` code. */
const CLOSE_WITH_CODE = 4000;

/** One `/realtime` connection; the `Connection` matchmaker passes to `p2p-signaling` once authenticated. */
class Client implements Connection {
  user_id = 0n;
  authed = false;
  closed = false;
  data_version = '';
  client_version = '';
  ws: WebSocketConnection | null = null;
  /** The frame being handled; the next frame waits for it. */
  chain: Promise<void> = Promise.resolve();
  readonly ip: string;
  readonly #drop: (client: Client) => void;

  constructor(ip: string, drop: (client: Client) => void) {
    this.ip = ip;
    this.#drop = drop;
  }

  send(frame: CoreContract.MatchmakerFrame): void {
    if (!this.closed) this.ws?.send(frame.encode());
  }

  close(): void {
    this.#drop(this);
  }
}

interface Member extends QueueMember {
  readonly client: Client;
}

interface Entry extends QueueEntry {
  readonly members: readonly Member[];
  readonly queue: Queue;
  readonly room: Room | null;
}

interface Queue {
  readonly key: string;
  readonly mode_id: number;
  readonly lockstep: boolean;
  readonly data_version: string;
  readonly client_version: string;
  readonly entries: Entry[];
}

interface Room {
  readonly code: string;
  readonly mode_id: number;
  readonly members: bigint[];
  status: 'Open' | 'Matching';
  readonly lockstep: boolean;
  readonly data_version: string;
  readonly client_version: string;
  entry: Entry | null;
}

interface UserSlot {
  readonly client: Client;
  entry: Entry | null;
  room: Room | null;
}

/** A participant of a match to create, in index order. */
interface Seat {
  readonly user_id: bigint;
  readonly rating: bigint;
  readonly team: number;
  readonly party: number;
  readonly client: Client;
}

/** The rating and block list `prepare_match_request` and its transaction read, or the failure. */
type Prepared =
  | { readonly kind: 'ok'; readonly rating: bigint; readonly blocked: readonly bigint[] }
  | { readonly kind: 'game_error'; readonly code: ErrorCode }
  | { readonly kind: 'failed' };

/** Times within the last 1000 ms by key, for the frame and connection limits. */
class Windows<K> {
  readonly #times = new Map<K, bigint[]>();

  /** Adds `now` for `key` and returns the count within the window. */
  add(key: K, now: bigint): number {
    const list = this.#fresh(key, now);
    list.push(now);
    this.#times.set(key, list);
    return list.length;
  }

  count(key: K, now: bigint): number {
    return this.#fresh(key, now).length;
  }

  #fresh(key: K, now: bigint): bigint[] {
    const list = (this.#times.get(key) ?? []).filter((t) => t > now - WINDOW_MS);
    if (list.length === 0) this.#times.delete(key);
    else this.#times.set(key, list);
    return list;
  }

  prune(now: bigint): void {
    for (const key of [...this.#times.keys()]) this.#fresh(key, now);
  }

  clear(): void {
    this.#times.clear();
  }
}

function frame_of(kind: CoreContract.MatchmakerFrameKind, fill: (f: CoreContract.MatchmakerFrame) => void = () => {}): CoreContract.MatchmakerFrame {
  const f = new CoreContract.MatchmakerFrame();
  f.kind = kind;
  fill(f);
  return f;
}

function protocol_hash(version: string): string {
  return version.slice(0, 64);
}

function data_hash(version: string): string {
  return version.slice(65);
}

function rule_of(mode: GameData.MatchModeRow): MatchRule {
  return {
    min_players: mode.min_players,
    max_players: mode.max_players,
    match_wait: mode.match_wait,
    rating_spread: mode.rating_spread,
    rating_spread_per_sec: mode.rating_spread_per_sec,
    team_size: mode.team_size,
  };
}

/** Modes a room can be made for: `allow_room`, or `allow_queue` with parties of 2 or more. */
function room_mode(mode: GameData.MatchModeRow): boolean {
  return mode.allow_room || (mode.allow_queue && mode.max_party_size >= 2);
}

export function create_realtime(env: Env, results: Results): Realtime {
  const { settings, server, server_time, storage } = env;
  const users = new Map<bigint, UserSlot>();
  const clients = new Set<Client>();
  const queues = new Map<string, Queue>();
  const rooms = new Map<string, Room>();
  const ip_accepts = new Windows<string>();
  const ip_frames = new Windows<string>();
  const user_frames = new Windows<bigint>();
  const pre_auth = new Map<string, number>();

  const now = (): bigint => server_time.clock_now();
  const lockstep_of = (frame: CoreContract.MatchmakerFrame): boolean => server.dev && frame.lockstep;

  // ----- sending

  const match_failed = (client: Client, reason: CoreContract.MatchFailReason, error_code = 0): void => {
    client.send(frame_of(FrameKind.MATCHMAKER_FRAME_KIND_MATCH_FAILED, (f) => {
      f.reason = reason;
      f.error_code = error_code;
    }));
  };

  const room_failed = (client: Client, error_code: number, request: CoreContract.MatchmakerFrameKind): void => {
    client.send(frame_of(FrameKind.MATCHMAKER_FRAME_KIND_ROOM_FAILED, (f) => {
      f.error_code = error_code;
      f.request = request;
    }));
  };

  const client_of = (user_id: bigint): Client | null => users.get(user_id)?.client ?? null;

  const send_room_state = (room: Room): void => {
    const state = frame_of(FrameKind.MATCHMAKER_FRAME_KIND_ROOM_STATE, (f) => {
      f.room_code = room.code;
      f.mode_id = room.mode_id;
      f.room_members = [...room.members];
      f.room_status = room.status === 'Open' ? CoreContract.RoomStatus.ROOM_STATUS_OPEN : CoreContract.RoomStatus.ROOM_STATUS_MATCHING;
      f.lockstep = room.lockstep;
    });
    for (const id of room.members) client_of(id)?.send(state);
  };

  /**
   * Sends `CLOSE` with the code, then closes the connection with WebSocket close code 4000 and the code as its decimal
   * reason, so a client that drops the `CLOSE` frame at the close still gets the code.
   */
  const close_with = (client: Client, code: number): void => {
    client.send(frame_of(FrameKind.MATCHMAKER_FRAME_KIND_CLOSE, (f) => {
      f.code = code;
    }));
    if (!client.closed) client.ws?.close(CLOSE_WITH_CODE, String(code));
    drop(client);
  };

  // ----- queues

  const queue_of = (mode_id: number, lockstep: boolean, data_version: string, client_version: string): Queue => {
    const key = `${String(mode_id)}/${lockstep ? '1' : '0'}/${data_version}/${client_version}`;
    let queue = queues.get(key);
    if (queue === undefined) {
      queue = { key, mode_id, lockstep, data_version, client_version, entries: [] };
      queues.set(key, queue);
    }
    return queue;
  };

  /** Takes an entry out of its queue and its members' slots; a party's room becomes `Open`. */
  const remove_entry = (entry: Entry, notify_room = true): void => {
    const at = entry.queue.entries.indexOf(entry);
    if (at >= 0) entry.queue.entries.splice(at, 1);
    for (const m of entry.members) {
      const slot = users.get(m.user_id);
      if (slot?.entry === entry) slot.entry = null;
    }
    const room = entry.room;
    if (room !== null && room.entry === entry) {
      room.entry = null;
      room.status = 'Open';
      if (notify_room && rooms.get(room.code) === room) send_room_state(room);
    }
  };

  const enqueue = (entry: Entry): void => {
    entry.queue.entries.push(entry);
    for (const m of entry.members) {
      const slot = users.get(m.user_id);
      if (slot !== undefined) slot.entry = entry;
    }
  };

  // ----- rooms

  const leave_room = (user_id: bigint): void => {
    const slot = users.get(user_id);
    const room = slot?.room ?? null;
    if (slot === undefined || room === null) return;
    if (room.status === 'Matching' && room.entry !== null) remove_entry(room.entry, false);
    room.status = 'Open';
    const at = room.members.indexOf(user_id);
    if (at >= 0) room.members.splice(at, 1);
    slot.room = null;
    if (room.members.length === 0) rooms.delete(room.code);
    else send_room_state(room);
  };

  /** A room code no room has, or null when all `ROOM_CODE_DRAWS` draws collide. */
  const new_room_code = (): string | null => {
    const alphabet = settings.room_code_alphabet;
    for (let draw = 0; draw < ROOM_CODE_DRAWS; draw += 1) {
      let code = '';
      for (let i = 0; i < settings.room_code_length; i += 1) code += alphabet[randomInt(alphabet.length)] ?? '';
      if (!rooms.has(code)) return code;
    }
    return null;
  };

  // ----- connections

  /** Takes a connection that stopped being unauthenticated out of its IP's concurrent pre-auth count. */
  const release_pre_auth = (ip: string): void => {
    const left = (pre_auth.get(ip) ?? 1) - 1;
    if (left <= 0) pre_auth.delete(ip);
    else pre_auth.set(ip, left);
  };

  function drop(client: Client): void {
    if (client.closed) return;
    client.closed = true;
    clients.delete(client);
    client.ws?.close();
    if (!client.authed) {
      release_pre_auth(client.ip);
      return;
    }
    const slot = users.get(client.user_id);
    if (slot?.client === client) {
      if (slot.room !== null) leave_room(client.user_id);
      else if (slot.entry !== null) remove_entry(slot.entry);
      users.delete(client.user_id);
    }
    if (env.stopped()) return;
    const change = env.p2p.connection_closed(client);
    if (change !== null) void results.participant_change(change);
  }

  /** The data version decision of `routing` request processing order 7 without the core `rpc` exception. */
  const data_version_error = (data_version: string, client_version: string): number | null => {
    const candidates = [server.client_data_version, server.compat_client_data_version];
    const base = candidates.find((v): v is string => typeof v === 'string' && protocol_hash(v) === protocol_hash(data_version));
    if (base === undefined) return CoreError.CORE_ERROR_APP_UPDATE_REQUIRED;
    if (data_hash(base) === data_hash(data_version)) return null;
    if (client_version === '' || env.game_update.is_data_update_ready(client_version)) return CoreError.CORE_ERROR_DATA_UPDATE_REQUIRED;
    return null;
  };

  /** The replay version check: the connection's data version must be the server's `client_data_version`. */
  const replay_version_error = (client: Client): number | null => {
    if (client.data_version === server.client_data_version) return null;
    return protocol_hash(client.data_version) === protocol_hash(server.client_data_version)
      ? CoreError.CORE_ERROR_DATA_UPDATE_REQUIRED
      : CoreError.CORE_ERROR_APP_UPDATE_REQUIRED;
  };

  const auth_reason = (code: number): string => {
    if (code === CoreError.CORE_ERROR_TOKEN_EXPIRED) return 'token_expired';
    if (code === CoreError.CORE_ERROR_SESSION_REPLACED) return 'session_replaced';
    return 'unauthorized';
  };

  /** The user of a `HELLO`, or the `CLOSE` code it fails with (and the `security` reason of an auth failure). */
  const hello_user = (client: Client, frame: CoreContract.MatchmakerFrame): bigint | { readonly code: number } => {
    const verified = env.auth.verify_access_token(frame.access_token);
    if (typeof verified === 'number') {
      log_security(env, auth_reason(verified), client.ip, null);
      return { code: verified };
    }
    const current = env.session.check_current(verified.user_id, verified.session_id);
    if (current !== 'pass') {
      log_security(env, auth_reason(current), client.ip, verified.user_id);
      return { code: current };
    }
    if (env.admin.is_maintenance()) return { code: CoreError.CORE_ERROR_MAINTENANCE };
    if (is_banned(env, verified.user_id)) return { code: CoreError.CORE_ERROR_BANNED };
    if (!DATA_VERSION.test(frame.data_version) || (frame.client_version !== '' && !APP_VERSION.test(frame.client_version))) {
      return { code: CoreError.CORE_ERROR_INVALID_REQUEST };
    }
    const version_error = data_version_error(frame.data_version, frame.client_version);
    return version_error === null ? verified.user_id : { code: version_error };
  };

  const hello = (client: Client, frame: CoreContract.MatchmakerFrame): void => {
    const user_id = hello_user(client, frame);
    if (typeof user_id === 'object') {
      close_with(client, user_id.code);
      return;
    }
    const before = users.get(user_id);
    if (before !== undefined) close_with(before.client, CoreError.CORE_ERROR_SESSION_REPLACED);
    release_pre_auth(client.ip);
    client.authed = true;
    client.user_id = user_id;
    client.data_version = frame.data_version;
    client.client_version = frame.client_version;
    users.set(client.user_id, { client, entry: null, room: null });
    client.send(frame_of(FrameKind.MATCHMAKER_FRAME_KIND_HELLO_ACK, (f) => {
      f.server_time_at = now();
    }));
  };

  /** Maintenance and ban before `MATCH_REQUEST`, `ROOM_CREATE`, `ROOM_JOIN`, `ROOM_START`; false closed it. */
  const admitted = (client: Client): boolean => {
    if (env.admin.is_maintenance()) {
      close_with(client, CoreError.CORE_ERROR_MAINTENANCE);
      return false;
    }
    if (is_banned(env, client.user_id)) {
      close_with(client, CoreError.CORE_ERROR_BANNED);
      return false;
    }
    return true;
  };

  /** Still the user's connection after an await. */
  const live = (client: Client): UserSlot | null => {
    const slot = users.get(client.user_id);
    return !client.closed && slot?.client === client ? slot : null;
  };

  /** The `GameError` of a hook output that is not `pass`, by `storage.check_hook_output`; null for any other output. */
  const game_error_of = (hook: string, output: unknown): number | null => {
    if (output === 'pass') return null;
    try {
      const checked = storage.check_hook_output(hook, output);
      return checked === 'pass' ? null : checked;
    } catch {
      return null;
    }
  };

  /** `prepare_match_request` in a rollback transaction of the user, with the rating and block list it reads. */
  const prepare = async (user_id: bigint, mode: GameData.MatchModeRow, member_ids: readonly bigint[]): Promise<Prepared> => {
    try {
      const out = await storage.run_rollback_transaction(user_id, (ctx): Prepared => {
        const hook = env.hooks.prepare_match_request;
        let rating = 0n;
        if (hook !== null) {
          let value: unknown;
          try {
            value = hook(ctx, mode.id, member_ids);
          } catch (error) {
            log_error(env, `prepare_match_request threw: ${error instanceof Error ? error.message : String(error)}`, { mode_id: mode.id }, user_id);
            return { kind: 'failed' };
          }
          if (typeof value !== 'bigint') {
            const code = game_error_of('prepare_match_request', value);
            if (code !== null) return { kind: 'game_error', code };
            log_error(env, 'prepare_match_request returned a value that is neither a rating nor a GameError', { mode_id: mode.id }, user_id);
            return { kind: 'failed' };
          }
          rating = value;
        }
        if (mode.rating_rule !== 0 && env.rating !== null) rating = env.rating.get_rating(ctx, mode.rating_rule).rating;
        const blocked = env.block_report === null ? [] : env.block_report.list_blocked_ids(ctx, user_id);
        return { kind: 'ok', rating, blocked: [...blocked] };
      });
      return out === 'FAILED' || out === 'WITHDRAWN' ? { kind: 'failed' } : out;
    } catch (error) {
      log_error(env, `match request preparation threw: ${error instanceof Error ? error.message : String(error)}`, { mode_id: mode.id }, user_id);
      return { kind: 'failed' };
    }
  };

  const solo_match_request = async (client: Client, slot: UserSlot, frame: CoreContract.MatchmakerFrame): Promise<void> => {
    if (slot.entry !== null) remove_entry(slot.entry);
    if (env.admin.is_kill_switched('MATCH_REQUEST')) {
      match_failed(client, CoreContract.MatchFailReason.MATCH_FAIL_REASON_REJECTED, CoreError.CORE_ERROR_FEATURE_DISABLED);
      return;
    }
    const mode = mode_of(env, frame.mode_id);
    if (mode === null || !mode.allow_queue) {
      match_failed(client, CoreContract.MatchFailReason.MATCH_FAIL_REASON_INVALID_MODE);
      return;
    }
    if (mode.result_rule === GameData.MatchResultRule.ServerReplay) {
      const version_error = replay_version_error(client);
      if (version_error !== null) {
        match_failed(client, CoreContract.MatchFailReason.MATCH_FAIL_REASON_REJECTED, version_error);
        return;
      }
    }
    const prepared = await prepare(client.user_id, mode, [client.user_id]);
    const now_slot = live(client);
    if (now_slot === null) return;
    if (prepared.kind !== 'ok') {
      match_failed(client, CoreContract.MatchFailReason.MATCH_FAIL_REASON_REJECTED, prepared.kind === 'game_error' ? prepared.code : 0);
      return;
    }
    if (now_slot.room !== null || now_slot.entry !== null) return;
    const lockstep = lockstep_of(frame);
    const queue = queue_of(mode.id, lockstep, client.data_version, client.client_version);
    const member: Member = { user_id: client.user_id, rating: prepared.rating, blocked: new Set(prepared.blocked), client };
    enqueue({ members: [member], rating: prepared.rating, entered_at: now(), queue, room: null });
  };

  /** Sends `ROOM_FAILED` with the code and the host frame kind to every member of the room. */
  const fail_room = (room: Room, code: number, request: CoreContract.MatchmakerFrameKind): void => {
    for (const id of room.members) {
      const client = client_of(id);
      if (client !== null) room_failed(client, code, request);
    }
  };

  /** Closes the banned members with `CLOSE` `BANNED` and fails the rest; false when no member is banned. */
  const refuse_banned = (room: Room, request: CoreContract.MatchmakerFrameKind): boolean => {
    const banned = room.members.filter((id) => is_banned(env, id));
    if (banned.length === 0) return false;
    for (const id of banned) {
      const client = client_of(id);
      if (client !== null) close_with(client, CoreError.CORE_ERROR_BANNED);
    }
    fail_room(room, CoreError.CORE_ERROR_BANNED, request);
    return true;
  };

  /** True when the room still exists, `Open`, with the same members in the same order. */
  const room_unchanged = (room: Room, ids: readonly bigint[]): boolean =>
    rooms.get(room.code) === room && room.status === 'Open' && room.members.length === ids.length && room.members.every((id, i) => id === ids[i]);

  /**
   * `prepare_match_request` of each member in room order: the members, or the failure code of the first failure.
   * A member change while a transaction is awaited is `ROOM_BUSY`, before any failure of that member.
   */
  const prepare_members = async (room: Room, ids: readonly bigint[], mode: GameData.MatchModeRow): Promise<Member[] | number> => {
    const members: Member[] = [];
    for (const id of ids) {
      const client = client_of(id);
      if (client === null || !room_unchanged(room, ids)) return CoreError.CORE_ERROR_ROOM_BUSY;
      const prepared = await prepare(id, mode, ids);
      if (!room_unchanged(room, ids)) return CoreError.CORE_ERROR_ROOM_BUSY;
      if (prepared.kind === 'game_error') return prepared.code;
      if (prepared.kind === 'failed') return CoreError.CORE_ERROR_INTERNAL;
      members.push({ user_id: id, rating: prepared.rating, blocked: new Set(prepared.blocked), client });
    }
    return members;
  };

  /** `validate_party`: null for `pass` (or no hook), else the failure code. */
  const party_failure = (mode: GameData.MatchModeRow, members: readonly Member[], request: CoreContract.MatchmakerFrameKind): number | null => {
    const hook = env.hooks.validate_party;
    if (hook === null) return null;
    let out: unknown;
    try {
      out = hook(mode.id, members.map((m) => ({ user_id: m.user_id, rating: m.rating })), request);
    } catch (error) {
      log_error(env, `validate_party threw: ${error instanceof Error ? error.message : String(error)}`, { mode_id: mode.id });
      return CoreError.CORE_ERROR_INTERNAL;
    }
    try {
      const checked = storage.check_hook_output('validate_party', out);
      return checked === 'pass' ? null : checked;
    } catch (error) {
      log_error(env, error instanceof Error ? error.message : String(error), { mode_id: mode.id });
      return CoreError.CORE_ERROR_INTERNAL;
    }
  };

  /**
   * Member rating resolution of a room for the host's `ROOM_START` or `MATCH_REQUEST`: the members, or null after
   * the failure was sent.
   */
  const resolve_members = async (room: Room, mode: GameData.MatchModeRow, request: CoreContract.MatchmakerFrameKind): Promise<Member[] | null> => {
    if (refuse_banned(room, request)) return null;
    const members = await prepare_members(room, [...room.members], mode);
    const failure = typeof members === 'number' ? members : party_failure(mode, members, request);
    if (failure !== null || typeof members === 'number') {
      fail_room(room, failure ?? CoreError.CORE_ERROR_INTERNAL, request);
      return null;
    }
    return members;
  };

  /** A room frame or party request of the host that failed before member rating resolution, or null to go on. */
  const host_error = (slot: UserSlot, room: Room | null): number | null => {
    if (room === null || room.members[0] !== slot.client.user_id) return CoreError.CORE_ERROR_ROOM_NOT_HOST;
    if (room.status === 'Matching') return CoreError.CORE_ERROR_ROOM_BUSY;
    if (env.admin.is_kill_switched('MATCH_REQUEST')) return CoreError.CORE_ERROR_FEATURE_DISABLED;
    return null;
  };

  /** The failure of a host `MATCH_REQUEST` in a room before member rating resolution, or null. */
  const party_request_error = (slot: UserSlot, room: Room, frame: CoreContract.MatchmakerFrame, mode: GameData.MatchModeRow | null): number | null => {
    const error = host_error(slot, room);
    if (error !== null) return error;
    if (frame.mode_id !== room.mode_id || mode === null || !mode.allow_queue) return CoreError.CORE_ERROR_INVALID_REQUEST;
    if (mode.result_rule === GameData.MatchResultRule.ServerReplay) {
      const version_error = replay_version_error(slot.client);
      if (version_error !== null) return version_error;
    }
    return room.members.length > mode.max_party_size ? CoreError.CORE_ERROR_ROOM_PARTY_TOO_LARGE : null;
  };

  const party_match_request = async (client: Client, slot: UserSlot, room: Room, frame: CoreContract.MatchmakerFrame): Promise<void> => {
    const request = FrameKind.MATCHMAKER_FRAME_KIND_MATCH_REQUEST;
    const mode = mode_of(env, room.mode_id);
    const error = party_request_error(slot, room, frame, mode);
    if (error !== null || mode === null) {
      room_failed(client, error ?? CoreError.CORE_ERROR_INVALID_REQUEST, request);
      return;
    }
    const members = await resolve_members(room, mode, request);
    if (members === null || live(client) === null) return;
    const queue = queue_of(mode.id, room.lockstep, client.data_version, client.client_version);
    const rating = members.reduce((max, m) => (m.rating > max ? m.rating : max), members[0]?.rating ?? 0n);
    const entry: Entry = { members, rating, entered_at: now(), queue, room };
    enqueue(entry);
    room.entry = entry;
    room.status = 'Matching';
    send_room_state(room);
  };

  const match_request = async (client: Client, frame: CoreContract.MatchmakerFrame): Promise<void> => {
    const slot = live(client);
    if (slot === null) return;
    if (slot.room === null) {
      await solo_match_request(client, slot, frame);
      return;
    }
    await party_match_request(client, slot, slot.room, frame);
  };

  const match_cancel = (client: Client): void => {
    const slot = live(client);
    if (slot === null) return;
    const room = slot.room;
    if (room === null) {
      if (slot.entry !== null) remove_entry(slot.entry);
      return;
    }
    if (room.members[0] !== client.user_id || room.status !== 'Matching' || room.entry === null) return;
    remove_entry(room.entry);
  };

  const room_create_error = (slot: UserSlot, mode: GameData.MatchModeRow | null): number | null => {
    if (slot.room !== null || slot.entry !== null) return CoreError.CORE_ERROR_ROOM_BUSY;
    if (env.admin.is_kill_switched('MATCH_REQUEST')) return CoreError.CORE_ERROR_FEATURE_DISABLED;
    return mode === null || !room_mode(mode) ? CoreError.CORE_ERROR_INVALID_REQUEST : null;
  };

  const room_create = (client: Client, frame: CoreContract.MatchmakerFrame): void => {
    const slot = live(client);
    if (slot === null) return;
    const mode = mode_of(env, frame.mode_id);
    const error = room_create_error(slot, mode);
    if (error !== null || mode === null) {
      room_failed(client, error ?? CoreError.CORE_ERROR_INVALID_REQUEST, FrameKind.MATCHMAKER_FRAME_KIND_ROOM_CREATE);
      return;
    }
    const code = new_room_code();
    if (code === null) {
      room_failed(client, CoreError.CORE_ERROR_ROOM_BUSY, FrameKind.MATCHMAKER_FRAME_KIND_ROOM_CREATE);
      return;
    }
    const room: Room = {
      code,
      mode_id: mode.id,
      members: [client.user_id],
      status: 'Open',
      lockstep: lockstep_of(frame),
      data_version: client.data_version,
      client_version: client.client_version,
      entry: null,
    };
    rooms.set(room.code, room);
    slot.room = room;
    send_room_state(room);
  };

  /** The room a `ROOM_JOIN` joins, or its failure code. */
  const room_to_join = (slot: UserSlot, frame: CoreContract.MatchmakerFrame): Room | number => {
    if (slot.room !== null || slot.entry !== null) return CoreError.CORE_ERROR_ROOM_BUSY;
    const room = rooms.get(frame.room_code);
    if (room === undefined || room.lockstep !== lockstep_of(frame)) return CoreError.CORE_ERROR_ROOM_NOT_FOUND;
    if (room.data_version !== slot.client.data_version || room.client_version !== slot.client.client_version) return CoreError.CORE_ERROR_ROOM_VERSION_MISMATCH;
    if (room.status === 'Matching') return CoreError.CORE_ERROR_ROOM_BUSY;
    const mode = mode_of(env, room.mode_id);
    const capacity = mode === null ? 0 : mode.allow_room ? mode.max_players : mode.max_party_size;
    return room.members.length >= capacity ? CoreError.CORE_ERROR_ROOM_FULL : room;
  };

  const room_join = (client: Client, frame: CoreContract.MatchmakerFrame): void => {
    const slot = live(client);
    if (slot === null) return;
    const room = room_to_join(slot, frame);
    if (typeof room === 'number') {
      room_failed(client, room, FrameKind.MATCHMAKER_FRAME_KIND_ROOM_JOIN);
      return;
    }
    room.members.push(client.user_id);
    slot.room = room;
    send_room_state(room);
  };

  const room_kick = (client: Client, frame: CoreContract.MatchmakerFrame): void => {
    const slot = live(client);
    if (slot === null) return;
    const request = FrameKind.MATCHMAKER_FRAME_KIND_ROOM_KICK;
    const room = slot.room;
    if (room === null || room.members[0] !== client.user_id) {
      room_failed(client, CoreError.CORE_ERROR_ROOM_NOT_HOST, request);
      return;
    }
    if (frame.user_id === client.user_id || !room.members.includes(frame.user_id)) {
      room_failed(client, CoreError.CORE_ERROR_INVALID_REQUEST, request);
      return;
    }
    client_of(frame.user_id)?.send(frame_of(FrameKind.MATCHMAKER_FRAME_KIND_ROOM_KICKED));
    leave_room(frame.user_id);
  };

  /** The failure of a host `ROOM_START` before member rating resolution, or null. */
  const room_start_error = (slot: UserSlot, room: Room | null, mode: GameData.MatchModeRow | null): number | null => {
    const error = host_error(slot, room);
    if (error !== null) return error;
    if (room === null || mode === null || !mode.allow_room) return CoreError.CORE_ERROR_INVALID_REQUEST;
    if (mode.result_rule === GameData.MatchResultRule.ServerReplay) {
      const version_error = replay_version_error(slot.client);
      if (version_error !== null) return version_error;
    }
    return room.members.length < mode.min_players ? CoreError.CORE_ERROR_ROOM_NOT_ENOUGH_PLAYERS : null;
  };

  const room_start = async (client: Client): Promise<void> => {
    const slot = live(client);
    if (slot === null) return;
    const request = FrameKind.MATCHMAKER_FRAME_KIND_ROOM_START;
    const room = slot.room;
    const mode = room === null ? null : mode_of(env, room.mode_id);
    const error = room_start_error(slot, room, mode);
    if (error !== null || room === null || mode === null) {
      room_failed(client, error ?? CoreError.CORE_ERROR_INVALID_REQUEST, request);
      return;
    }
    const members = await resolve_members(room, mode, request);
    if (members === null || live(client) === null) return;
    const seats: Seat[] = members.map((m, i) => ({
      user_id: m.user_id,
      rating: m.rating,
      team: mode.team_size > 0 ? Math.floor(i / mode.team_size) : 0,
      party: 1,
      client: m.client,
    }));
    await create_match(mode, room.lockstep, room.data_version, room.client_version, 'Room', seats, []);
  };

  const p2p_frame = async (client: Client, frame: CoreContract.MatchmakerFrame): Promise<void> => {
    const change = env.p2p.handle_frame(client, frame);
    if (change !== null) await results.participant_change(change);
  };

  /** The handler of each client frame kind after `HELLO`; kinds without one are dropped. */
  const handlers: ReadonlyMap<number, (client: Client, frame: CoreContract.MatchmakerFrame) => void | Promise<void>> = new Map<
    number,
    (client: Client, frame: CoreContract.MatchmakerFrame) => void | Promise<void>
  >([
    [FrameKind.MATCHMAKER_FRAME_KIND_MATCH_REQUEST, async (client, frame) => {
      if (admitted(client)) await match_request(client, frame);
    }],
    [FrameKind.MATCHMAKER_FRAME_KIND_MATCH_CANCEL, (client) => {
      match_cancel(client);
    }],
    [FrameKind.MATCHMAKER_FRAME_KIND_ROOM_CREATE, (client, frame) => {
      if (admitted(client)) room_create(client, frame);
    }],
    [FrameKind.MATCHMAKER_FRAME_KIND_ROOM_JOIN, (client, frame) => {
      if (admitted(client)) room_join(client, frame);
    }],
    [FrameKind.MATCHMAKER_FRAME_KIND_ROOM_START, async (client) => {
      if (admitted(client)) await room_start(client);
    }],
    [FrameKind.MATCHMAKER_FRAME_KIND_ROOM_LEAVE, (client) => {
      if (live(client) !== null) leave_room(client.user_id);
    }],
    [FrameKind.MATCHMAKER_FRAME_KIND_ROOM_KICK, (client, frame) => {
      room_kick(client, frame);
    }],
    [FrameKind.MATCHMAKER_FRAME_KIND_PEER_SIGNAL, p2p_frame],
    [FrameKind.MATCHMAKER_FRAME_KIND_MATCH_LEAVE, p2p_frame],
    [FrameKind.MATCHMAKER_FRAME_KIND_MATCH_REJOIN, p2p_frame],
  ]);

  const handle = async (client: Client, payload: Uint8Array): Promise<void> => {
    if (client.closed) return;
    const frame = CoreContract.MatchmakerFrame.decode(payload);
    if (!client.authed) {
      if (frame === null || frame.kind !== FrameKind.MATCHMAKER_FRAME_KIND_HELLO) drop(client);
      else hello(client, frame);
      return;
    }
    const handler = frame === null ? undefined : handlers.get(frame.kind);
    if (frame !== null && handler !== undefined) await handler(client, frame);
  };

  /** Counts a frame against the user or pre-auth IP limit; false when it closed the connection. */
  const count_frame = (client: Client): boolean => {
    const at = now();
    if (client.authed) {
      if (user_frames.add(client.user_id, at) <= settings.frames_per_second) return true;
      log_security(env, 'rate_limited', client.ip, client.user_id);
      close_with(client, CoreError.CORE_ERROR_RATE_LIMITED);
      return false;
    }
    if (ip_frames.add(client.ip, at) <= settings.pre_auth_frames_per_second) return true;
    log_security(env, 'pre_auth_frame_limit', client.ip, null);
    drop(client);
    return false;
  };

  const violation = (client: Client, reason: Violation): void => {
    if (reason !== 'protocol') log_security(env, reason, client.ip, client.authed ? client.user_id : null);
  };

  /** Refuses a new connection over a pre-auth limit, without the WebSocket handshake. */
  const refuse = (socket: Duplex, status: string): void => {
    socket.end(`HTTP/1.1 ${status}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`, () => {
      socket.destroy();
    });
  };

  const route = (request: RouteRequest, ip: string): RouteResponse | null => {
    if (!server.matchmaker || env.stopped()) return { status: 404 };
    const upgrade = request.upgrade;
    if (upgrade === null) return { status: 404 };
    const accept = handshake_response(request.headers);
    if (accept === null) {
      refuse(upgrade.socket, '400 Bad Request');
      return null;
    }
    const at = now();
    if (ip_accepts.count(ip, at) >= settings.pre_auth_accepts_per_second || (pre_auth.get(ip) ?? 0) >= settings.pre_auth_connections) {
      log_security(env, 'pre_auth_connection_limit', ip, null);
      refuse(upgrade.socket, '429 Too Many Requests');
      return null;
    }
    ip_accepts.add(ip, at);
    pre_auth.set(ip, (pre_auth.get(ip) ?? 0) + 1);
    const client = new Client(ip, drop);
    clients.add(client);
    upgrade.socket.write(accept);
    client.ws = new WebSocketConnection(upgrade.socket, upgrade.head, {
      max_frame_bytes: settings.max_frame_bytes,
      frame_time_limit: () => server_time.network_time_limit(settings.frame_read_timeout_ms),
      frame: () => count_frame(client),
      binary: (payload) => {
        client.chain = client.chain
          .then(() => handle(client, payload))
          .catch((error: unknown) => {
            if (!env.stopped()) log_error(env, `realtime frame handling threw: ${error instanceof Error ? error.message : String(error)}`, {}, client.user_id || null);
          });
      },
      text: () => {
        if (!client.authed) drop(client);
      },
      violation: (reason) => {
        violation(client, reason);
      },
      closed: () => {
        drop(client);
      },
    });
    server_time.network_time_limit(settings.hello_timeout_ms).addEventListener('abort', () => {
      if (client.authed || client.closed) return;
      log_security(env, 'hello_timeout', ip, null);
      drop(client);
    }, { once: true });
    return null;
  };

  // ----- match creation

  const new_record = (
    mode: GameData.MatchModeRow,
    lockstep: boolean,
    data_version: string,
    client_version: string,
    source: MatchSource,
    seats: readonly Seat[],
  ): MatchRecord => {
    return build_record({
      match_id: randomUUID(),
      mode_id: mode.id,
      source,
      lockstep,
      seed: new_seed(),
      created_at: now(),
      prepare_time: mode.prepare_time,
      duration: duration_of(env, mode, lockstep),
      report_margin_ms: settings.report_margin_ms,
      data_version,
      client_version,
      seats,
    });
  };

  /** Steps 1 to 3 of `### match creation`; party rooms go back to `Open` after `MATCH_FOUND`. */
  async function create_match(
    mode: GameData.MatchModeRow,
    lockstep: boolean,
    data_version: string,
    client_version: string,
    source: MatchSource,
    seats: readonly Seat[],
    party_rooms: readonly Room[],
  ): Promise<void> {
    const record = new_record(mode, lockstep, data_version, client_version, source, seats);
    const reopen = (): void => {
      for (const room of party_rooms) {
        if (room.entry !== null || room.status !== 'Matching') continue;
        room.status = 'Open';
        if (rooms.get(room.code) === room) send_room_state(room);
      }
    };
    if (!(await results.create(record))) {
      log_error(env, 'match record save failed', { match_id: record.match_id, mode_id: mode.id });
      for (const s of seats) match_failed(s.client, CoreContract.MatchFailReason.MATCH_FAIL_REASON_CREATE_FAILED);
      reopen();
      return;
    }
    const duration = duration_of(env, mode, lockstep);
    let transport: CoreContract.Transport;
    try {
      transport = await env.p2p.prepare_transport(record.match_id, record.start_at, duration);
    } catch (error) {
      log_error(env, `prepare_transport threw: ${error instanceof Error ? error.message : String(error)}`, { match_id: record.match_id });
      transport = new CoreContract.Transport();
    }
    if (env.stopped()) return;
    const players = seats.map((s, index) => {
      const p = new CoreContract.MatchPlayer();
      p.user_id = s.user_id;
      p.index = index;
      p.team = s.team;
      p.party = s.party;
      return p;
    });
    const changes = [...env.p2p.open_match_session(record.match_id, players, seats.map((s) => s.client), transport, record.start_at + duration)];
    for (const s of seats) {
      if (!s.client.closed) continue;
      const change = env.p2p.connection_closed(s.client);
      if (change !== null) changes.push(change);
    }
    await Promise.all(changes.map((change) => results.participant_change(change)));
    seats.forEach((s, index) => {
      s.client.send(frame_of(FrameKind.MATCHMAKER_FRAME_KIND_MATCH_FOUND, (f) => {
        f.match_id = record.match_id;
        f.mode_id = mode.id;
        f.players = players;
        f.my_index = index;
        f.seed = record.seed;
        f.start_at = record.start_at;
        f.transport = transport;
        f.lockstep = lockstep;
      }));
    });
    reopen();
  }

  /** The match of a queue step: entries in collected order, party numbers from 1 in that order. */
  const queue_match = (mode: GameData.MatchModeRow, queue: Queue, step: Extract<QueueStep<Entry>, { kind: 'match' }>): Promise<void> => {
    const seats: Seat[] = [];
    const party_rooms: Room[] = [];
    let party = 0;
    step.entries.forEach((entry, i) => {
      const number = entry.room === null ? 0 : (party += 1);
      if (entry.room !== null) party_rooms.push(entry.room);
      for (const m of entry.members) seats.push({ user_id: m.user_id, rating: m.rating, team: step.teams[i] ?? 0, party: number, client: m.client });
    });
    return create_match(mode, queue.lockstep, queue.data_version, queue.client_version, 'Queue', seats, party_rooms);
  };

  const tick = async (): Promise<void> => {
    try {
      await run_tick();
    } catch (error) {
      if (!env.stopped()) log_error(env, `matchmaker_tick threw: ${error instanceof Error ? error.message : String(error)}`, {});
    }
  };

  const run_tick = async (): Promise<void> => {
    if (env.stopped()) return;
    const at = now();
    const creations: Promise<void>[] = [];
    for (const queue of [...queues.values()]) {
      const mode = mode_of(env, queue.mode_id);
      if (mode === null) continue;
      for (const step of run_queue(queue.entries, rule_of(mode), at)) {
        if (step.kind === 'timeout') {
          const entry = step.entry;
          remove_entry(entry);
          for (const m of entry.members) match_failed(m.client, CoreContract.MatchFailReason.MATCH_FAIL_REASON_TIMEOUT);
          continue;
        }
        for (const entry of step.entries) {
          for (const m of entry.members) {
            const slot = users.get(m.user_id);
            if (slot?.entry === entry) slot.entry = null;
          }
          if (entry.room !== null && entry.room.entry === entry) entry.room.entry = null;
        }
        creations.push(queue_match(mode, queue, step));
      }
      if (queue.entries.length === 0) queues.delete(queue.key);
    }
    ip_accepts.prune(at);
    ip_frames.prune(at);
    user_frames.prune(at);
    await Promise.all(creations);
  };

  const stop = (): void => {
    for (const client of [...clients]) {
      client.closed = true;
      client.ws?.close();
    }
    clients.clear();
    users.clear();
    queues.clear();
    rooms.clear();
    pre_auth.clear();
    ip_accepts.clear();
    ip_frames.clear();
    user_frames.clear();
  };

  return { route, tick, stop };
}

