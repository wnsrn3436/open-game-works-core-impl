/**
 * Test helpers of the friend core tests: a test server whose `register` keeps the module objects, records the friend
 * hook and runs the function a test sets in the core test data `rpc` `RunCoreTest`.
 */
import * as CoreContract from '../../../generated/contract/core_contract.ts';
import * as GameContract from '../../../generated/contract/game_contract.ts';
import type { RequestCtx, Storage } from '../../storage/index.ts';
import { storage_module } from '../../storage/tests/helpers.ts';
import { advance_time, core_test_register, login, send, start_test_server, stop_test_server, type TestServer, type TestSession } from '../../testing/dev/index.ts';
import { COUNT_TABLE, LINK_TABLE, type FriendChange, type FriendModule } from '../index.ts';

export const { CoreError, FriendState } = CoreContract;

export const START_AT = 1_800_000_000_000n;

/** The module objects of a server instance that the tests use, as `register(core)` gets them. */
export interface Core {
  readonly routing: {
    register_hook(module: string, hook: string, fn: unknown): void;
    register_handler(rpc: string, handler: unknown): void;
  };
  /** The `storage` module object in `Harness.core()`; content `register(core)` gets only its member `content`. */
  readonly storage: Storage;
  readonly friend: FriendModule;
}

/** One call of the hook `on_friend_changed`. */
export interface HookCall {
  readonly user_id: bigint;
  readonly other_id: bigint;
  readonly change: FriendChange;
}

/** What the content `register` of these tests records and does; a test changes these while the server runs. */
export interface ContentState {
  readonly calls: HookCall[];
  /** When true, the hook throws. */
  throw_in_hook: boolean;
  /** What the hook returns after it records the call: `undefined` (none) unless a test sets a value. */
  hook_output: () => unknown;
  /** The body of the `RunCoreTest` handler. */
  run_core_test: ((ctx: RequestCtx) => void) | null;
}

export interface Harness {
  readonly server: TestServer;
  readonly content: ContentState;
  core(): Core;
  friend(): FriendModule;
}

/** The content `register` of these tests: the core test defaults, `on_friend_changed` and the `RunCoreTest` handler. */
function content_register(content: ContentState, keep: (core: Core) => void): (core: Readonly<Record<string, unknown>>) => void {
  return (raw) => {
    const core = raw as unknown as Core;
    keep(core);
    core_test_register(raw, ['RunCoreTest']);
    core.routing.register_hook('friend', 'on_friend_changed', (ctx: RequestCtx, other_id: bigint, change: FriendChange) => {
      if (content.throw_in_hook) throw new Error('on_friend_changed throws in this test');
      content.calls.push({ user_id: ctx.user_id, other_id, change });
      return content.hook_output();
    });
    core.routing.register_handler('RunCoreTest', (ctx: RequestCtx) => {
      content.run_core_test?.(ctx);
      return new GameContract.RunCoreTestResponse();
    });
  };
}

const running: TestServer[] = [];

/** A test server that starts at `START_AT`, with settings overrides. */
export async function start(settings: Record<string, unknown> = {}): Promise<Harness> {
  const content: ContentState = { calls: [], throw_in_hook: false, hook_output: () => undefined, run_core_test: null };
  let kept: Core | null = null;
  const register = content_register(content, (core) => {
    kept = core;
  });
  const server = await start_test_server(START_AT, undefined, undefined, undefined, undefined, settings, register);
  running.push(server);
  const core = (): Core => {
    if (kept === null) throw new Error('register was not called');
    return { ...kept, storage: storage_module(server) };
  };
  return { server, content, core, friend: () => core().friend };
}

export async function stop_all(): Promise<void> {
  for (const server of running.splice(0)) await stop_test_server(server);
}

let next_user = 0;

type Tuple<T, N extends number, R extends T[] = []> = R['length'] extends N ? R : Tuple<T, N, [T, ...R]>;

/** `count` new dev logins. */
export async function users<N extends number>(h: Harness, count: N): Promise<Tuple<TestSession, N>> {
  const sessions: TestSession[] = [];
  for (let i = 0; i < count; i += 1) {
    next_user += 1;
    sessions.push(await login(h.server, `friend_${String(next_user)}`));
  }
  return sessions as Tuple<TestSession, N>;
}

export function id(session: TestSession): bigint {
  return session.user_id;
}

export interface Sent<R> {
  /** `ServerError.code`, 0 on success. */
  readonly code: number;
  readonly response: R | null;
  readonly envelope: CoreContract.ResponseEnvelope;
}

async function rpc<R>(session: TestSession, name: string, request: { encode(): Uint8Array }): Promise<Sent<R>> {
  const { envelope, response } = await send(session, name, request);
  return { code: envelope.error?.code ?? 0, response: response as R | null, envelope };
}

function with_user<T extends { user_id: bigint }>(request: T, user_id: bigint): T {
  request.user_id = user_id;
  return request;
}

export function send_request(session: TestSession, target: bigint): Promise<Sent<CoreContract.SendFriendRequestResponse>> {
  return rpc(session, 'core/SendFriendRequest', with_user(new CoreContract.SendFriendRequestRequest(), target));
}

export function accept(session: TestSession, target: bigint): Promise<Sent<CoreContract.AcceptFriendRequestResponse>> {
  return rpc(session, 'core/AcceptFriendRequest', with_user(new CoreContract.AcceptFriendRequestRequest(), target));
}

export function decline(session: TestSession, target: bigint): Promise<Sent<CoreContract.DeclineFriendRequestResponse>> {
  return rpc(session, 'core/DeclineFriendRequest', with_user(new CoreContract.DeclineFriendRequestRequest(), target));
}

export function cancel(session: TestSession, target: bigint): Promise<Sent<CoreContract.CancelFriendRequestResponse>> {
  return rpc(session, 'core/CancelFriendRequest', with_user(new CoreContract.CancelFriendRequestRequest(), target));
}

export function remove(session: TestSession, target: bigint): Promise<Sent<CoreContract.RemoveFriendResponse>> {
  return rpc(session, 'core/RemoveFriend', with_user(new CoreContract.RemoveFriendRequest(), target));
}

export function get_friends(session: TestSession): Promise<Sent<CoreContract.GetFriendsResponse>> {
  return rpc(session, 'core/GetFriends', new CoreContract.GetFriendsRequest());
}

export function search(session: TestSession, nickname: string): Promise<Sent<CoreContract.SearchUsersResponse>> {
  const request = new CoreContract.SearchUsersRequest();
  request.nickname = nickname;
  return rpc(session, 'core/SearchUsers', request);
}

export function block(session: TestSession, target: bigint): Promise<Sent<CoreContract.BlockUserResponse>> {
  return rpc(session, 'core/BlockUser', with_user(new CoreContract.BlockUserRequest(), target));
}

export function withdraw(session: TestSession): Promise<Sent<CoreContract.WithdrawResponse>> {
  return rpc(session, 'core/Withdraw', new CoreContract.WithdrawRequest());
}

/** `ConfirmAge` with a birth year-month `yyyymm`; throws when it does not succeed. Returns the new `ConsentUserState`. */
export async function confirm_age(session: TestSession, birth_year_month: number): Promise<CoreContract.ConsentUserState> {
  const request = new CoreContract.ConfirmAgeRequest();
  request.birth_year_month = birth_year_month;
  const sent = await rpc<CoreContract.ConfirmAgeResponse>(session, 'core/ConfirmAge', request);
  if (sent.code !== 0 || sent.response?.consent == null) throw new Error(`ConfirmAge ${String(birth_year_month)} failed with ${String(sent.code)}`);
  return sent.response.consent;
}

export async function set_nickname(session: TestSession, nickname: string): Promise<void> {
  const request = new CoreContract.SetNicknameRequest();
  request.nickname = nickname;
  const sent = await rpc(session, 'core/SetNickname', request);
  if (sent.code !== 0) throw new Error(`SetNickname ${nickname} failed with ${String(sent.code)}`);
}

/** Runs `fn` in a `RunCoreTest` request of the session's user and returns its result; throws when the request fails. */
export async function run_core_test<T>(h: Harness, session: TestSession, fn: (ctx: RequestCtx) => T): Promise<T> {
  const results: T[] = [];
  h.content.run_core_test = (ctx) => {
    results.push(fn(ctx));
  };
  try {
    const sent = await rpc(session, 'RunCoreTest', new GameContract.RunCoreTestRequest());
    if (sent.code !== 0) throw new Error(`RunCoreTest failed with ${String(sent.code)}`);
  } finally {
    h.content.run_core_test = null;
  }
  const [result] = results;
  if (results.length !== 1 || result === undefined) throw new Error('RunCoreTest did not run the function once');
  return result;
}

/** Makes two users friends: a request of `a` and its accept by `b`. */
export async function befriend(a: TestSession, b: TestSession): Promise<void> {
  expect((await send_request(a, id(b))).code).toBe(0);
  expect((await accept(b, id(a))).code).toBe(0);
}

export function advance(h: Harness, ms: bigint): void {
  advance_time(h.server, ms);
}

/** A `friend_link` row: `state` is the `FriendState` element name. */
export interface LinkRow {
  readonly user_id: bigint;
  readonly other_id: bigint;
  readonly state: string;
  readonly created_at: bigint;
  readonly updated_at: bigint;
}

export interface CountRow {
  readonly user_id: bigint;
  readonly friend_count: number;
  readonly sent_count: number;
  readonly received_count: number;
}

export interface Counts {
  readonly friend_count: number;
  readonly sent_count: number;
  readonly received_count: number;
}

/** Every committed `friend_link` row, by `(user_id, other_id)`. */
export function links(h: Harness): LinkRow[] {
  const rows = h.core().storage.read_db().query(`SELECT user_id, other_id, state, created_at, updated_at FROM ${LINK_TABLE} ORDER BY user_id, other_id`, []);
  return rows as unknown as LinkRow[];
}

/** Every committed `friend_count` row, by `user_id`. */
export function count_rows(h: Harness): CountRow[] {
  const rows = h.core().storage.read_db().query(`SELECT user_id, friend_count, sent_count, received_count FROM ${COUNT_TABLE} ORDER BY user_id`, []);
  return rows as unknown as CountRow[];
}

/** The committed counts of a user; zeros when there is no row. */
export function counts(h: Harness, user_id: bigint): Counts {
  const row = count_rows(h).find((r) => r.user_id === user_id);
  return { friend_count: row?.friend_count ?? 0, sent_count: row?.sent_count ?? 0, received_count: row?.received_count ?? 0 };
}

/** The committed link state of (user, other) as an element name, or null. */
export function state_of(h: Harness, user_id: bigint, other_id: bigint): string | null {
  return links(h).find((r) => r.user_id === user_id && r.other_id === other_id)?.state ?? null;
}

/** Both tables at once, to compare before and after a request. */
export function snapshot(h: Harness): { links: LinkRow[]; counts: CountRow[] } {
  return { links: links(h), counts: count_rows(h) };
}

/** Every user's counts equal the number of its link rows of each state. */
export function expect_counts_match_links(h: Harness, user_ids: readonly bigint[]): void {
  const all = links(h);
  for (const user_id of user_ids) {
    const mine = all.filter((r) => r.user_id === user_id);
    expect(counts(h, user_id)).toEqual({
      friend_count: mine.filter((r) => r.state === 'FRIEND_STATE_FRIEND').length,
      sent_count: mine.filter((r) => r.state === 'FRIEND_STATE_SENT').length,
      received_count: mine.filter((r) => r.state === 'FRIEND_STATE_RECEIVED').length,
    });
  }
}
