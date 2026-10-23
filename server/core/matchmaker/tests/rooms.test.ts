/** `### room` and party handling through `/realtime`. */
import * as CoreContract from '../../../generated/contract/core_contract.ts';
import { read_logs, send, type TestSession } from '../../testing/dev/index.ts';
import {
  CoreError,
  GameError,
  K,
  Reason,
  ban,
  barrier,
  calls_of,
  close_and_wait,
  close_code,
  frame,
  harness,
  hold_user_row,
  hold_writes,
  kill_switch,
  kinds,
  match_request,
  mode,
  next,
  online,
  player,
  queued,
  report,
  send_and_wait,
  send_frame,
  settled,
  stop_all,
  tick,
  until_blocked_by,
  version,
  type Conn,
  type Frame,
  type Harness,
  type Hooks,
} from './helpers.ts';

/** Room-only: room capacity is max_players. */
const ROOM4 = mode(7301, { max_players: 4, min_players: 2, allow_queue: false, allow_room: true, max_party_size: 1 });
/** Queue with parties: room capacity is max_party_size. */
const PARTY2 = mode(7302, { max_players: 4, min_players: 4, max_party_size: 2, allow_room: false });
/** Both, parties up to 3. */
const BOTH = mode(7303, { max_players: 4, min_players: 2, max_party_size: 3, allow_room: true, rating_spread: 1_000n });
const QUEUE1 = mode(7304, { allow_room: false, max_party_size: 1 });
const ROOM_TEAMS = mode(7305, { max_players: 4, min_players: 4, team_size: 2, max_party_size: 2, allow_queue: false, allow_room: true });

const MODES = [ROOM4, PARTY2, BOTH, QUEUE1, ROOM_TEAMS];
const RoomStatus = CoreContract.RoomStatus;

afterEach(async () => {
  await stop_all();
});

interface Member {
  readonly session: TestSession;
  readonly user_id: bigint;
  readonly conn: Conn;
}

function failures(frames: readonly Frame[]): [number, number][] {
  return frames.filter((f) => f.kind === K.MATCHMAKER_FRAME_KIND_ROOM_FAILED).map((f) => [f.error_code, f.request]);
}

async function member(h: Harness, data_version?: string, client_version = ''): Promise<Member> {
  const s = await player(h);
  return { session: s, user_id: s.user_id, conn: await online(h, s, data_version ?? h.client_data_version, client_version) };
}

async function create(h: Harness, mode_id: number, host?: Member): Promise<{ host: Member; code: string; state: Frame }> {
  const m = host ?? (await member(h));
  const out = await send_and_wait(m.conn, frame(K.MATCHMAKER_FRAME_KIND_ROOM_CREATE, (f) => {
    f.mode_id = mode_id;
  }));
  const state = out.find((f) => f.kind === K.MATCHMAKER_FRAME_KIND_ROOM_STATE);
  if (state === undefined) throw new Error(`ROOM_CREATE failed: ${JSON.stringify(failures(out))}`);
  return { host: m, code: state.room_code, state };
}

function join_frame(code: string): Frame {
  return frame(K.MATCHMAKER_FRAME_KIND_ROOM_JOIN, (f) => {
    f.room_code = code;
  });
}

async function join(code: string, m: Member): Promise<Frame[]> {
  return send_and_wait(m.conn, join_frame(code));
}

/** A room of `n` members (host first) for the mode. */
async function room(h: Harness, mode_id: number, n: number): Promise<{ members: Member[]; code: string }> {
  const { host, code } = await create(h, mode_id);
  const members = [host];
  for (let i = 1; i < n; i += 1) {
    const m = await member(h);
    const out = await join(code, m);
    if (failures(out).length > 0) throw new Error(`ROOM_JOIN failed: ${JSON.stringify(failures(out))}`);
    members.push(m);
  }
  for (const m of members) await barrier(m.conn);
  return { members, code };
}

function start_frame(): Frame {
  return frame(K.MATCHMAKER_FRAME_KIND_ROOM_START);
}

async function last_state(m: Member): Promise<Frame | undefined> {
  return (await barrier(m.conn)).filter((f) => f.kind === K.MATCHMAKER_FRAME_KIND_ROOM_STATE).at(-1);
}

describe('rooms', () => {
  it('gives ROOM_CREATE a ROOM_STATE with the code and one host, and both members get a two member ROOM_STATE after a ROOM_JOIN', async () => {
    const h = await harness({ modes: MODES });
    const { host, code, state } = await create(h, ROOM4.id);
    expect(code).toMatch(/^[A-Z0-9]{6}$/);
    expect(state.room_members).toEqual([host.user_id]);
    expect(state.room_status).toBe(RoomStatus.ROOM_STATUS_OPEN);
    const guest = await member(h);
    const joined = await join(code, guest);
    expect(joined.find((f) => f.kind === K.MATCHMAKER_FRAME_KIND_ROOM_STATE)?.room_members).toEqual([host.user_id, guest.user_id]);
    expect((await last_state(host))?.room_members).toEqual([host.user_id, guest.user_id]);
  });

  it('answers the second ROOM_CREATE with ROOM_FAILED ROOM_BUSY ROOM_CREATE when roomCodeAlphabet is A and roomCodeLength is 1, keeps one room, and goes on handling frames', async () => {
    const h = await harness({ modes: MODES, settings: { 'matchmaker.roomCodeAlphabet': 'A', 'matchmaker.roomCodeLength': 1 } });
    const { host, code } = await create(h, ROOM4.id);
    expect(code).toBe('A');
    const second = await member(h);
    const out = await send_and_wait(second.conn, frame(K.MATCHMAKER_FRAME_KIND_ROOM_CREATE, (f) => {
      f.mode_id = ROOM4.id;
    }));
    expect(failures(out)).toEqual([[CoreError.CORE_ERROR_ROOM_BUSY, K.MATCHMAKER_FRAME_KIND_ROOM_CREATE]]);
    expect(out.some((f) => f.kind === K.MATCHMAKER_FRAME_KIND_ROOM_STATE)).toBe(false);
    expect(await last_state(host)).toBeUndefined();
    // The second user is in no room: its ROOM_JOIN of the one room goes in.
    expect((await join(code, second)).find((f) => f.kind === K.MATCHMAKER_FRAME_KIND_ROOM_STATE)?.room_members).toEqual([host.user_id, second.user_id]);
    // A later frame of the host is still handled.
    await send_and_wait(host.conn, frame(K.MATCHMAKER_FRAME_KIND_ROOM_LEAVE));
    const left = await last_state(second);
    expect(left?.room_code).toBe('A');
    expect(left?.room_members).toEqual([second.user_id]);
  });

  it('answers an unknown code with ROOM_NOT_FOUND, a full room with ROOM_FULL, and ROOM_CREATE or ROOM_JOIN of a user in a room or queue with ROOM_BUSY', async () => {
    const h = await harness({ modes: MODES });
    const lone = await member(h);
    expect(failures(await join('ZZZZZZ', lone))).toEqual([[CoreError.CORE_ERROR_ROOM_NOT_FOUND, K.MATCHMAKER_FRAME_KIND_ROOM_JOIN]]);
    const { members, code } = await room(h, ROOM4.id, 4);
    expect(failures(await join(code, lone))).toEqual([[CoreError.CORE_ERROR_ROOM_FULL, K.MATCHMAKER_FRAME_KIND_ROOM_JOIN]]);
    const host = members[0];
    if (host === undefined) throw new Error('no host');
    const busy_create = await send_and_wait(host.conn, frame(K.MATCHMAKER_FRAME_KIND_ROOM_CREATE, (f) => {
      f.mode_id = ROOM4.id;
    }));
    expect(failures(busy_create)).toEqual([[CoreError.CORE_ERROR_ROOM_BUSY, K.MATCHMAKER_FRAME_KIND_ROOM_CREATE]]);
    const other = await create(h, ROOM4.id);
    expect(failures(await join(other.code, host))).toEqual([[CoreError.CORE_ERROR_ROOM_BUSY, K.MATCHMAKER_FRAME_KIND_ROOM_JOIN]]);
    const waiting = await queued(h, QUEUE1.id);
    expect(failures(await join(other.code, { session: waiting.session, user_id: waiting.session.user_id, conn: waiting.conn }))).toEqual([
      [CoreError.CORE_ERROR_ROOM_BUSY, K.MATCHMAKER_FRAME_KIND_ROOM_JOIN],
    ]);
    const busy_queue_create = await send_and_wait(waiting.conn, frame(K.MATCHMAKER_FRAME_KIND_ROOM_CREATE, (f) => {
      f.mode_id = ROOM4.id;
    }));
    expect(failures(busy_queue_create)).toEqual([[CoreError.CORE_ERROR_ROOM_BUSY, K.MATCHMAKER_FRAME_KIND_ROOM_CREATE]]);
  });

  it('caps a room at max_party_size when allow_room is false and at max_players when it is true', async () => {
    const h = await harness({ modes: MODES });
    const party = await room(h, PARTY2.id, 2);
    expect(failures(await join(party.code, await member(h)))).toEqual([[CoreError.CORE_ERROR_ROOM_FULL, K.MATCHMAKER_FRAME_KIND_ROOM_JOIN]]);
    const full = await room(h, ROOM4.id, 4);
    expect(failures(await join(full.code, await member(h)))).toEqual([[CoreError.CORE_ERROR_ROOM_FULL, K.MATCHMAKER_FRAME_KIND_ROOM_JOIN]]);
  });

  it('answers ROOM_JOIN with ROOM_VERSION_MISMATCH when HELLO data_version or client_version differ from the room creator, keeping the members', async () => {
    const compat = version('b', '2');
    const h = await harness({ modes: MODES, compat_client_data_version: compat });
    const { host, code } = await create(h, ROOM4.id);
    const other_data = await member(h, compat);
    const other_app = await member(h, undefined, '1.0.0');
    expect(failures(await join(code, other_data))).toEqual([[CoreError.CORE_ERROR_ROOM_VERSION_MISMATCH, K.MATCHMAKER_FRAME_KIND_ROOM_JOIN]]);
    expect(failures(await join(code, other_app))).toEqual([[CoreError.CORE_ERROR_ROOM_VERSION_MISMATCH, K.MATCHMAKER_FRAME_KIND_ROOM_JOIN]]);
    const same = await member(h);
    expect((await join(code, same)).find((f) => f.kind === K.MATCHMAKER_FRAME_KIND_ROOM_STATE)?.room_members).toEqual([host.user_id, same.user_id]);
  });

  it('makes the next member host when the host leaves, removes the room with its last member, and drops a member whose connection closed', async () => {
    const h = await harness({ modes: MODES });
    const { members, code } = await room(h, ROOM4.id, 3);
    const [a, b, c] = members;
    if (a === undefined || b === undefined || c === undefined) throw new Error('room');
    await send_and_wait(a.conn, frame(K.MATCHMAKER_FRAME_KIND_ROOM_LEAVE));
    expect((await last_state(b))?.room_members).toEqual([b.user_id, c.user_id]);
    await close_and_wait(c.conn);
    expect((await last_state(b))?.room_members).toEqual([b.user_id]);
    await send_and_wait(b.conn, frame(K.MATCHMAKER_FRAME_KIND_ROOM_LEAVE));
    expect(failures(await join(code, a))).toEqual([[CoreError.CORE_ERROR_ROOM_NOT_FOUND, K.MATCHMAKER_FRAME_KIND_ROOM_JOIN]]);
  });

  it('sends ROOM_KICKED to the target of a host ROOM_KICK and removes it; a non-host ROOM_KICK or ROOM_START is ROOM_NOT_HOST', async () => {
    const h = await harness({ modes: MODES });
    const { members } = await room(h, ROOM4.id, 3);
    const [a, b, c] = members;
    if (a === undefined || b === undefined || c === undefined) throw new Error('room');
    const kicked = await send_and_wait(a.conn, frame(K.MATCHMAKER_FRAME_KIND_ROOM_KICK, (f) => {
      f.user_id = c.user_id;
    }));
    expect(kinds(await barrier(c.conn))).toContain(K.MATCHMAKER_FRAME_KIND_ROOM_KICKED);
    expect(kicked.filter((f) => f.kind === K.MATCHMAKER_FRAME_KIND_ROOM_STATE).at(-1)?.room_members).toEqual([a.user_id, b.user_id]);
    expect(failures(await send_and_wait(b.conn, frame(K.MATCHMAKER_FRAME_KIND_ROOM_KICK, (f) => {
      f.user_id = a.user_id;
    })))).toEqual([[CoreError.CORE_ERROR_ROOM_NOT_HOST, K.MATCHMAKER_FRAME_KIND_ROOM_KICK]]);
    expect(failures(await send_and_wait(b.conn, start_frame()))).toEqual([[CoreError.CORE_ERROR_ROOM_NOT_HOST, K.MATCHMAKER_FRAME_KIND_ROOM_START]]);
    expect(failures(await send_and_wait(a.conn, frame(K.MATCHMAKER_FRAME_KIND_ROOM_KICK, (f) => {
      f.user_id = a.user_id;
    })))).toEqual([[CoreError.CORE_ERROR_INVALID_REQUEST, K.MATCHMAKER_FRAME_KIND_ROOM_KICK]]);
  });

  it('answers ROOM_START below min_players with ROOM_NOT_ENOUGH_PLAYERS; a started match has members in room order, party 1 for all, and the room stays Open', async () => {
    const h = await harness({ modes: MODES, hooks: { apply_mismatch: () => 'pass' } });
    const single = await create(h, ROOM4.id);
    expect(failures(await send_and_wait(single.host.conn, start_frame()))).toEqual([
      [CoreError.CORE_ERROR_ROOM_NOT_ENOUGH_PLAYERS, K.MATCHMAKER_FRAME_KIND_ROOM_START],
    ]);
    const { members, code } = await room(h, ROOM4.id, 3);
    const host = members[0];
    if (host === undefined) throw new Error('room');
    const out = await send_and_wait(host.conn, start_frame());
    const found = out.find((f) => f.kind === K.MATCHMAKER_FRAME_KIND_MATCH_FOUND);
    expect(found?.players.map((p) => p.user_id)).toEqual(members.map((m) => m.user_id));
    expect(found?.players.map((p) => p.party)).toEqual([1, 1, 1]);
    expect(found?.players.map((p) => p.team)).toEqual([0, 0, 0]);
    expect(out.some((f) => f.kind === K.MATCHMAKER_FRAME_KIND_ROOM_STATE && f.room_status !== RoomStatus.ROOM_STATUS_OPEN)).toBe(false);
    // The room and its members are still there, Open: a new member joins and sees all four.
    const late = await member(h);
    const joined = (await join(code, late)).find((f) => f.kind === K.MATCHMAKER_FRAME_KIND_ROOM_STATE);
    expect(joined?.room_members).toEqual([...members.map((m) => m.user_id), late.user_id]);
    expect(joined?.room_status).toBe(RoomStatus.ROOM_STATUS_OPEN);
  });

  it('numbers teams of a ROOM_START match by index divided by team_size', async () => {
    const h = await harness({ modes: MODES });
    const { members } = await room(h, ROOM_TEAMS.id, 4);
    const host = members[0];
    if (host === undefined) throw new Error('room');
    const found = (await send_and_wait(host.conn, start_frame())).find((f) => f.kind === K.MATCHMAKER_FRAME_KIND_MATCH_FOUND);
    expect(found?.players.map((p) => p.team)).toEqual([0, 0, 1, 1]);
  });
});

describe('member rating resolution', () => {
  it('closes a banned non-host member with CLOSE BANNED at ROOM_START, removes it, and the rest get ROOM_FAILED BANNED ROOM_START without a match', async () => {
    const h = await harness({ modes: MODES });
    const { members } = await room(h, ROOM4.id, 3);
    const [a, b, c] = members;
    if (a === undefined || b === undefined || c === undefined) throw new Error('room');
    await ban(h, b.user_id);
    const out = await send_and_wait(a.conn, start_frame());
    expect(failures(out)).toEqual([[CoreError.CORE_ERROR_BANNED, K.MATCHMAKER_FRAME_KIND_ROOM_START]]);
    expect(out.some((f) => f.kind === K.MATCHMAKER_FRAME_KIND_MATCH_FOUND)).toBe(false);
    expect(await close_code(b.conn)).toBe(CoreError.CORE_ERROR_BANNED);
    expect(failures(await barrier(c.conn))).toEqual([[CoreError.CORE_ERROR_BANNED, K.MATCHMAKER_FRAME_KIND_ROOM_START]]);
    expect(out.filter((f) => f.kind === K.MATCHMAKER_FRAME_KIND_ROOM_STATE).at(-1)?.room_members).toEqual([a.user_id, c.user_id]);
  });

  it('does the same for a host MATCH_REQUEST and leaves no party entry', async () => {
    const h = await harness({ modes: MODES });
    const { members } = await room(h, PARTY2.id, 2);
    const [a, b] = members;
    if (a === undefined || b === undefined) throw new Error('room');
    await ban(h, b.user_id);
    const out = await send_and_wait(a.conn, match_request(PARTY2.id));
    expect(failures(out)).toEqual([[CoreError.CORE_ERROR_BANNED, K.MATCHMAKER_FRAME_KIND_MATCH_REQUEST]]);
    expect(await close_code(b.conn)).toBe(CoreError.CORE_ERROR_BANNED);
    // No party entry: the host is free to create another room.
    await send_and_wait(a.conn, frame(K.MATCHMAKER_FRAME_KIND_ROOM_LEAVE));
    await create(h, ROOM4.id, a);
  });

  it('sends every member ROOM_FAILED with the GameError and the host frame kind when one member prepare_match_request fails', async () => {
    let refused: bigint | null = null;
    const hooks: Hooks = { prepare: (_core, ctx) => (ctx.user_id === refused ? GameError.GAME_ERROR_CORE_TEST : 0n) };
    const h = await harness({ modes: MODES, hooks });
    const { members } = await room(h, BOTH.id, 3);
    const [a, b, c] = members;
    if (a === undefined || b === undefined || c === undefined) throw new Error('room');
    refused = c.user_id;
    for (const [send, kind] of [[start_frame(), K.MATCHMAKER_FRAME_KIND_ROOM_START], [match_request(BOTH.id), K.MATCHMAKER_FRAME_KIND_MATCH_REQUEST]] as const) {
      expect(failures(await send_and_wait(a.conn, send))).toEqual([[GameError.GAME_ERROR_CORE_TEST, kind]]);
      for (const m of [b, c]) expect(failures(await barrier(m.conn))).toEqual([[GameError.GAME_ERROR_CORE_TEST, kind]]);
    }
  });

  it('gives every member prepare_match_request the room members in order for a host MATCH_REQUEST of three members', async () => {
    const h = await harness({ modes: MODES, hooks: { prepare: () => 0n } });
    const { members } = await room(h, BOTH.id, 3);
    const host = members[0];
    if (host === undefined) throw new Error('room');
    await send_and_wait(host.conn, match_request(BOTH.id));
    const ids = members.map((m) => m.user_id);
    const calls = calls_of(h, 'prepare_match_request');
    expect(calls.map((c) => c.user_id)).toEqual(ids);
    expect(calls.every((c) => c.user_ids.join(',') === ids.join(','))).toBe(true);
  });

  it('calls validate_party with the mode, the members with ratings in room order and the host frame kind; a GameError fails every member and the room stays Open', async () => {
    let answer: 'pass' | number = GameError.GAME_ERROR_CORE_TEST;
    const ratings = new Map<bigint, bigint>();
    const hooks: Hooks = { prepare: (_core, ctx) => ratings.get(ctx.user_id) ?? 0n, validate_party: () => answer };
    const h = await harness({ modes: MODES, hooks });
    const { members } = await room(h, BOTH.id, 2);
    const [a, b] = members;
    if (a === undefined || b === undefined) throw new Error('room');
    ratings.set(a.user_id, 40n);
    ratings.set(b.user_id, 70n);
    expect(failures(await send_and_wait(a.conn, match_request(BOTH.id)))).toEqual([[GameError.GAME_ERROR_CORE_TEST, K.MATCHMAKER_FRAME_KIND_MATCH_REQUEST]]);
    expect(failures(await barrier(b.conn))).toEqual([[GameError.GAME_ERROR_CORE_TEST, K.MATCHMAKER_FRAME_KIND_MATCH_REQUEST]]);
    const call = calls_of(h, 'validate_party')[0];
    expect(call?.mode_id).toBe(BOTH.id);
    expect(call?.members).toEqual([{ user_id: a.user_id, rating: 40n }, { user_id: b.user_id, rating: 70n }]);
    expect(call?.request).toBe(K.MATCHMAKER_FRAME_KIND_MATCH_REQUEST);
    expect(failures(await send_and_wait(a.conn, start_frame()))).toEqual([[GameError.GAME_ERROR_CORE_TEST, K.MATCHMAKER_FRAME_KIND_ROOM_START]]);
    expect(calls_of(h, 'validate_party')[1]?.request).toBe(K.MATCHMAKER_FRAME_KIND_ROOM_START);
    // Still Open and without a party entry: a host MATCH_REQUEST that passes goes on.
    answer = 'pass';
    const ok = await send_and_wait(a.conn, match_request(BOTH.id));
    expect(ok.filter((f) => f.kind === K.MATCHMAKER_FRAME_KIND_ROOM_STATE).at(-1)?.room_status).toBe(RoomStatus.ROOM_STATUS_MATCHING);
  });

  it('sends every member ROOM_FAILED ROOM_BUSY when a member leaves while resolution waits on a later member\'s transaction, also when that member\'s prepare_match_request fails (PostgreSQL)', async () => {
    let refused: bigint | null = null;
    const hooks: Hooks = { prepare: (_core, ctx) => (ctx.user_id === refused ? GameError.GAME_ERROR_CORE_TEST : 0n) };
    const h = await harness({ modes: MODES, hooks, db: 'postgresql', settings: { 'storage.userLockWaitMs': 20_000 } });
    const { members } = await room(h, ROOM4.id, 3);
    const [a, b, c] = members;
    if (a === undefined || b === undefined || c === undefined) throw new Error('room');
    refused = b.user_id;
    // b's transaction waits for b's user row while the host's ROOM_START resolves the members; c's connection closes then.
    const b_row = await hold_user_row(h, b.user_id);
    send_frame(a.conn, start_frame());
    await until_blocked_by(h.server, b_row.pid);
    await close_and_wait(c.conn);
    expect((await next(b.conn, K.MATCHMAKER_FRAME_KIND_ROOM_STATE)).room_members).toEqual([a.user_id, b.user_id]);
    await b_row.release();
    const out = await barrier(a.conn);
    expect(failures(out)).toEqual([[CoreError.CORE_ERROR_ROOM_BUSY, K.MATCHMAKER_FRAME_KIND_ROOM_START]]);
    expect(failures(await barrier(b.conn))).toEqual([[CoreError.CORE_ERROR_ROOM_BUSY, K.MATCHMAKER_FRAME_KIND_ROOM_START]]);
    expect(out.some((f) => f.kind === K.MATCHMAKER_FRAME_KIND_MATCH_FOUND)).toBe(false);
    expect(calls_of(h, 'prepare_match_request').map((x) => x.user_id)).toEqual([a.user_id, b.user_id]);
  });

  it('sends every member ROOM_FAILED ROOM_BUSY and starts no later member\'s transaction when a member leaves while resolution waits on the first member\'s transaction (PostgreSQL)', async () => {
    const h = await harness({ modes: MODES, hooks: { prepare: () => 0n }, db: 'postgresql', settings: { 'storage.userLockWaitMs': 20_000 } });
    const { members } = await room(h, ROOM4.id, 3);
    const [a, b, c] = members;
    if (a === undefined || b === undefined || c === undefined) throw new Error('room');
    // a's transaction has not ended when c's connection closes, so resolution sees the change before b's transaction.
    const a_row = await hold_user_row(h, a.user_id);
    send_frame(a.conn, start_frame());
    await until_blocked_by(h.server, a_row.pid);
    await close_and_wait(c.conn);
    expect((await next(b.conn, K.MATCHMAKER_FRAME_KIND_ROOM_STATE)).room_members).toEqual([a.user_id, b.user_id]);
    await a_row.release();
    const out = await barrier(a.conn);
    expect(failures(out)).toEqual([[CoreError.CORE_ERROR_ROOM_BUSY, K.MATCHMAKER_FRAME_KIND_ROOM_START]]);
    expect(failures(await barrier(b.conn))).toEqual([[CoreError.CORE_ERROR_ROOM_BUSY, K.MATCHMAKER_FRAME_KIND_ROOM_START]]);
    expect(out.some((f) => f.kind === K.MATCHMAKER_FRAME_KIND_MATCH_FOUND)).toBe(false);
    expect(calls_of(h, 'prepare_match_request').map((x) => x.user_id)).toEqual([a.user_id]);
  });

  it('sends every member ROOM_FAILED INTERNAL when a member prepare_match_request transaction is WITHDRAWN', async () => {
    const h = await harness({ modes: MODES, hooks: { prepare: () => 0n } });
    const { members } = await room(h, BOTH.id, 2);
    const [a, b] = members;
    if (a === undefined || b === undefined) throw new Error('room');
    expect((await send(b.session, 'core/Withdraw', new CoreContract.WithdrawRequest())).envelope.error).toBeNull();
    for (const [sent, kind] of [[start_frame(), K.MATCHMAKER_FRAME_KIND_ROOM_START], [match_request(BOTH.id), K.MATCHMAKER_FRAME_KIND_MATCH_REQUEST]] as const) {
      const out = await send_and_wait(a.conn, sent);
      expect(failures(out)).toEqual([[CoreError.CORE_ERROR_INTERNAL, kind]]);
      expect(failures(await barrier(b.conn))).toEqual([[CoreError.CORE_ERROR_INTERNAL, kind]]);
      expect(out.some((f) => f.kind === K.MATCHMAKER_FRAME_KIND_MATCH_FOUND || f.kind === K.MATCHMAKER_FRAME_KIND_ROOM_STATE)).toBe(false);
    }
  });

  it('sends every member ROOM_FAILED INTERNAL and logs an error when validate_party or a member prepare_match_request returns a number below 1000', async () => {
    let party: unknown = 'pass';
    let prepared: unknown = 0n;
    const hooks: Hooks = { prepare: () => prepared as bigint, validate_party: () => party as 'pass' };
    const h = await harness({ modes: MODES, hooks });
    const { members } = await room(h, BOTH.id, 2);
    const [a, b] = members;
    if (a === undefined || b === undefined) throw new Error('room');
    const sends = [[start_frame(), K.MATCHMAKER_FRAME_KIND_ROOM_START], [match_request(BOTH.id), K.MATCHMAKER_FRAME_KIND_MATCH_REQUEST]] as const;
    for (const value of [5, 999, -1]) {
      party = value;
      for (const [sent, kind] of sends) {
        const out = await send_and_wait(a.conn, sent);
        expect(failures(out)).toEqual([[CoreError.CORE_ERROR_INTERNAL, kind]]);
        expect(failures(await barrier(b.conn))).toEqual([[CoreError.CORE_ERROR_INTERNAL, kind]]);
        expect(out.some((f) => f.kind === K.MATCHMAKER_FRAME_KIND_MATCH_FOUND || f.kind === K.MATCHMAKER_FRAME_KIND_ROOM_STATE)).toBe(false);
      }
    }
    expect(read_logs(h.server, 'error').filter((l) => String(l['message']).startsWith('hook validate_party returned'))).toHaveLength(6);
    party = 'pass';
    prepared = 5;
    for (const [sent, kind] of sends) {
      expect(failures(await send_and_wait(a.conn, sent))).toEqual([[CoreError.CORE_ERROR_INTERNAL, kind]]);
      expect(failures(await barrier(b.conn))).toEqual([[CoreError.CORE_ERROR_INTERNAL, kind]]);
    }
    // Still Open without a party entry.
    prepared = 0n;
    const ok = await send_and_wait(a.conn, match_request(BOTH.id));
    expect(ok.filter((f) => f.kind === K.MATCHMAKER_FRAME_KIND_ROOM_STATE).at(-1)?.room_status).toBe(RoomStatus.ROOM_STATUS_MATCHING);
  });

  it('treats a server without validate_party as pass', async () => {
    const h = await harness({ modes: MODES });
    const { members } = await room(h, BOTH.id, 2);
    const host = members[0];
    if (host === undefined) throw new Error('room');
    const out = await send_and_wait(host.conn, match_request(BOTH.id));
    expect(failures(out)).toEqual([]);
  });
});

describe('room failures', () => {
  it('sends ROOM_FAILED of ROOM_CREATE, ROOM_JOIN, ROOM_KICK only to the sender with that kind', async () => {
    const h = await harness({ modes: MODES });
    const { members, code } = await room(h, ROOM4.id, 4);
    const [a, b] = members;
    if (a === undefined || b === undefined) throw new Error('room');
    const outsider = await member(h);
    expect(failures(await join(code, outsider))).toEqual([[CoreError.CORE_ERROR_ROOM_FULL, K.MATCHMAKER_FRAME_KIND_ROOM_JOIN]]);
    expect(failures(await send_and_wait(a.conn, frame(K.MATCHMAKER_FRAME_KIND_ROOM_CREATE, (f) => {
      f.mode_id = ROOM4.id;
    })))).toEqual([[CoreError.CORE_ERROR_ROOM_BUSY, K.MATCHMAKER_FRAME_KIND_ROOM_CREATE]]);
    expect(failures(await send_and_wait(b.conn, frame(K.MATCHMAKER_FRAME_KIND_ROOM_KICK, (f) => {
      f.user_id = a.user_id;
    })))).toEqual([[CoreError.CORE_ERROR_ROOM_NOT_HOST, K.MATCHMAKER_FRAME_KIND_ROOM_KICK]]);
    // Nobody else got those failures.
    for (const m of members.slice(2)) expect(failures(await barrier(m.conn))).toEqual([]);
  });

  it('answers a room MATCH_REQUEST of allow_queue false with ROOM_FAILED INVALID_REQUEST MATCH_REQUEST', async () => {
    const h = await harness({ modes: MODES });
    const { members } = await room(h, ROOM4.id, 2);
    const host = members[0];
    if (host === undefined) throw new Error('room');
    expect(failures(await send_and_wait(host.conn, match_request(ROOM4.id)))).toEqual([[CoreError.CORE_ERROR_INVALID_REQUEST, K.MATCHMAKER_FRAME_KIND_MATCH_REQUEST]]);
  });

  it('answers ROOM_START of allow_room false with ROOM_FAILED INVALID_REQUEST without a match, and ROOM_CREATE of a mode no room can be made for', async () => {
    const h = await harness({ modes: MODES });
    const { members } = await room(h, PARTY2.id, 2);
    const host = members[0];
    if (host === undefined) throw new Error('room');
    const out = await send_and_wait(host.conn, start_frame());
    expect(failures(out)).toEqual([[CoreError.CORE_ERROR_INVALID_REQUEST, K.MATCHMAKER_FRAME_KIND_ROOM_START]]);
    expect(out.some((f) => f.kind === K.MATCHMAKER_FRAME_KIND_MATCH_FOUND)).toBe(false);
    const lone = await member(h);
    const created = await send_and_wait(lone.conn, frame(K.MATCHMAKER_FRAME_KIND_ROOM_CREATE, (f) => {
      f.mode_id = QUEUE1.id;
    }));
    expect(failures(created)).toEqual([[CoreError.CORE_ERROR_INVALID_REQUEST, K.MATCHMAKER_FRAME_KIND_ROOM_CREATE]]);
    expect(created.some((f) => f.kind === K.MATCHMAKER_FRAME_KIND_ROOM_STATE)).toBe(false);
  });
});

describe('kill switch', () => {
  it('answers ROOM_CREATE, ROOM_START and a host MATCH_REQUEST with ROOM_FAILED FEATURE_DISABLED while the kill switch MATCH_REQUEST is on', async () => {
    const h = await harness({ modes: MODES, hooks: { prepare: () => 0n } });
    const lone = await member(h);
    await kill_switch(h, true);
    const created = await send_and_wait(lone.conn, frame(K.MATCHMAKER_FRAME_KIND_ROOM_CREATE, (f) => {
      f.mode_id = BOTH.id;
    }));
    expect(failures(created)).toEqual([[CoreError.CORE_ERROR_FEATURE_DISABLED, K.MATCHMAKER_FRAME_KIND_ROOM_CREATE]]);
    expect(created.some((f) => f.kind === K.MATCHMAKER_FRAME_KIND_ROOM_STATE)).toBe(false);
    await kill_switch(h, false);
    const { members } = await room(h, BOTH.id, 2);
    const [a, b] = members;
    if (a === undefined || b === undefined) throw new Error('room');
    await kill_switch(h, true);
    for (const [sent, kind] of [[start_frame(), K.MATCHMAKER_FRAME_KIND_ROOM_START], [match_request(BOTH.id), K.MATCHMAKER_FRAME_KIND_MATCH_REQUEST]] as const) {
      const out = await send_and_wait(a.conn, sent);
      expect(failures(out)).toEqual([[CoreError.CORE_ERROR_FEATURE_DISABLED, kind]]);
      expect(out.some((f) => f.kind === K.MATCHMAKER_FRAME_KIND_MATCH_FOUND || f.kind === K.MATCHMAKER_FRAME_KIND_ROOM_STATE)).toBe(false);
      expect(failures(await barrier(b.conn))).toEqual([]);
    }
    expect(calls_of(h, 'prepare_match_request')).toEqual([]);
  });
});

describe('match creation failure', () => {
  it('sends each participant MATCH_FAILED CREATE_FAILED with an error log when the match record save fails, and a party room goes back to Open', async () => {
    const h = await harness({ modes: MODES, settings: { 'storage.userLockWaitMs': 200 } });
    const { members } = await room(h, PARTY2.id, 2);
    const [a, b] = members;
    if (a === undefined || b === undefined) throw new Error('room');
    await send_and_wait(a.conn, match_request(PARTY2.id));
    const solos = [await queued(h, PARTY2.id), await queued(h, PARTY2.id)];
    const release = await hold_writes(h, 'matchmaker_match');
    try {
      await tick(h);
    } finally {
      await release();
    }
    const seen = new Map<Conn, Frame[]>();
    for (const conn of [a.conn, b.conn, ...solos.map((q) => q.conn)]) {
      const frames = await barrier(conn);
      seen.set(conn, frames);
      expect(frames.filter((f) => f.kind === K.MATCHMAKER_FRAME_KIND_MATCH_FAILED).map((f) => [f.reason, f.error_code])).toEqual([[Reason.MATCH_FAIL_REASON_CREATE_FAILED, 0]]);
      expect(kinds(frames)).not.toContain(K.MATCHMAKER_FRAME_KIND_MATCH_FOUND);
    }
    expect(read_logs(h.server, 'error').filter((l) => l['message'] === 'match record save failed')).toHaveLength(1);
    for (const m of [a, b]) {
      expect(seen.get(m.conn)?.filter((f) => f.kind === K.MATCHMAKER_FRAME_KIND_ROOM_STATE).at(-1)?.room_status).toBe(RoomStatus.ROOM_STATUS_OPEN);
    }
    // Open without a party entry: the host can ask again.
    const again = await send_and_wait(a.conn, match_request(PARTY2.id));
    expect(again.filter((f) => f.kind === K.MATCHMAKER_FRAME_KIND_ROOM_STATE).at(-1)?.room_status).toBe(RoomStatus.ROOM_STATUS_MATCHING);
  });
});

describe('party', () => {
  it('puts one party entry with the largest member rating for a host MATCH_REQUEST, makes the room Matching, and keeps the party together with one party number', async () => {
    const ratings = new Map<bigint, bigint>();
    const h = await harness({ modes: MODES, hooks: { prepare: (_core, ctx) => ratings.get(ctx.user_id) ?? 0n, apply_mismatch: () => 'pass' } });
    const { members } = await room(h, PARTY2.id, 2);
    const [a, b] = members;
    if (a === undefined || b === undefined) throw new Error('room');
    ratings.set(a.user_id, 10n);
    ratings.set(b.user_id, 900n);
    const out = await send_and_wait(a.conn, match_request(PARTY2.id));
    expect(out.filter((f) => f.kind === K.MATCHMAKER_FRAME_KIND_ROOM_STATE).at(-1)?.room_status).toBe(RoomStatus.ROOM_STATUS_MATCHING);
    // A solo pair of rating 900 only matches the party if the party entry has rating 900 (spread 0).
    const s1 = await player(h);
    const s2 = await player(h);
    ratings.set(s1.user_id, 900n);
    ratings.set(s2.user_id, 900n);
    const q1 = await queued(h, PARTY2.id, s1);
    await queued(h, PARTY2.id, s2);
    await tick(h);
    const found = await next(q1.conn, K.MATCHMAKER_FRAME_KIND_MATCH_FOUND);
    expect(found.players.map((p) => p.user_id)).toEqual([a.user_id, b.user_id, s1.user_id, s2.user_id]);
    expect(found.players.map((p) => p.party)).toEqual([1, 1, 0, 0]);
    expect((await last_state(a))?.room_status).toBe(RoomStatus.ROOM_STATUS_OPEN);
    await report(q1.session, found.match_id, new Uint8Array([1]));
    await report(a.session, found.match_id, new Uint8Array([2]));
    await settled(h);
    expect(calls_of(h, 'apply_match_mismatch').map((c) => c.record?.source)).toEqual(['Queue', 'Queue', 'Queue', 'Queue']);
    expect(calls_of(h, 'apply_match_mismatch')[0]?.record?.parties).toEqual([1, 1, 0, 0]);
  });

  it('answers MATCH_REQUEST of a room over max_party_size with ROOM_PARTY_TOO_LARGE and a non-host MATCH_REQUEST with ROOM_NOT_HOST; a member leaving Matching takes the entry out', async () => {
    const h = await harness({ modes: MODES });
    const both = await room(h, BOTH.id, 3);
    const [a, b, c] = both.members;
    if (a === undefined || b === undefined || c === undefined) throw new Error('room');
    expect(failures(await send_and_wait(b.conn, match_request(BOTH.id)))).toEqual([[CoreError.CORE_ERROR_ROOM_NOT_HOST, K.MATCHMAKER_FRAME_KIND_MATCH_REQUEST]]);
    const four = await member(h);
    await join(both.code, four);
    expect(failures(await send_and_wait(a.conn, match_request(BOTH.id)))).toEqual([[CoreError.CORE_ERROR_ROOM_PARTY_TOO_LARGE, K.MATCHMAKER_FRAME_KIND_MATCH_REQUEST]]);
    await send_and_wait(four.conn, frame(K.MATCHMAKER_FRAME_KIND_ROOM_LEAVE));
    await send_and_wait(a.conn, match_request(BOTH.id));
    expect((await last_state(b))?.room_status).toBe(RoomStatus.ROOM_STATUS_MATCHING);
    await send_and_wait(c.conn, frame(K.MATCHMAKER_FRAME_KIND_ROOM_LEAVE));
    expect((await last_state(a))?.room_status).toBe(RoomStatus.ROOM_STATUS_OPEN);
    // No entry left: a solo user waiting alone does not match with the old party.
    const solo = await queued(h, BOTH.id);
    await tick(h, BOTH.match_wait);
    expect(kinds(await barrier(solo.conn))).not.toContain(K.MATCHMAKER_FRAME_KIND_MATCH_FOUND);
  });

  it('answers a host ROOM_START or MATCH_REQUEST of a Matching room with ROOM_BUSY; a host MATCH_CANCEL takes the party entry out and makes the room Open, and a non-host MATCH_CANCEL is dropped', async () => {
    const h = await harness({ modes: MODES });
    const { members } = await room(h, BOTH.id, 2);
    const [a, b] = members;
    if (a === undefined || b === undefined) throw new Error('room');
    await send_and_wait(a.conn, match_request(BOTH.id));
    expect((await last_state(b))?.room_status).toBe(RoomStatus.ROOM_STATUS_MATCHING);
    for (const [sent, kind] of [[start_frame(), K.MATCHMAKER_FRAME_KIND_ROOM_START], [match_request(BOTH.id), K.MATCHMAKER_FRAME_KIND_MATCH_REQUEST]] as const) {
      const out = await send_and_wait(a.conn, sent);
      expect(failures(out)).toEqual([[CoreError.CORE_ERROR_ROOM_BUSY, kind]]);
      expect(out.some((f) => f.kind === K.MATCHMAKER_FRAME_KIND_MATCH_FOUND || f.kind === K.MATCHMAKER_FRAME_KIND_ROOM_STATE)).toBe(false);
    }
    expect(await send_and_wait(b.conn, frame(K.MATCHMAKER_FRAME_KIND_MATCH_CANCEL))).toEqual([]);
    expect(await barrier(a.conn)).toEqual([]);
    const cancelled = await send_and_wait(a.conn, frame(K.MATCHMAKER_FRAME_KIND_MATCH_CANCEL));
    expect(cancelled.filter((f) => f.kind === K.MATCHMAKER_FRAME_KIND_ROOM_STATE).at(-1)?.room_status).toBe(RoomStatus.ROOM_STATUS_OPEN);
    expect((await last_state(b))?.room_status).toBe(RoomStatus.ROOM_STATUS_OPEN);
    // No entry left: a solo user waiting alone gets TIMEOUT instead of a match with the party.
    const solo = await queued(h, BOTH.id);
    await tick(h, BOTH.match_wait);
    expect((await next(solo.conn, K.MATCHMAKER_FRAME_KIND_MATCH_FAILED)).reason).toBe(Reason.MATCH_FAIL_REASON_TIMEOUT);
  });

  it('records source Room for a ROOM_START match and Queue for queue matches with a party entry', async () => {
    const h = await harness({ modes: MODES, hooks: { apply_mismatch: () => 'pass' } });
    const r = await room(h, ROOM4.id, 2);
    const [a, b] = r.members;
    if (a === undefined || b === undefined) throw new Error('room');
    const found = (await send_and_wait(a.conn, start_frame())).find((f) => f.kind === K.MATCHMAKER_FRAME_KIND_MATCH_FOUND);
    await report(a.session, found?.match_id ?? '', new Uint8Array([1]));
    await report(b.session, found?.match_id ?? '', new Uint8Array([2]));
    await settled(h);
    expect(calls_of(h, 'apply_match_mismatch').map((c) => c.record?.source)).toEqual(['Room', 'Room']);
  });
});
