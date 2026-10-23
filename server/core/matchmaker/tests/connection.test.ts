/** `### connection` and `### security`: `HELLO`, the checks before frames, replaced connections and the limits. */
import { advance_time, read_logs, send_raw, wait_background, type TestSession } from '../../testing/dev/index.ts';
import {
  CoreError,
  K,
  ban,
  barrier,
  close_code,
  connect,
  frame,
  harness,
  hello,
  kinds,
  maintenance,
  match_request,
  mode,
  next,
  online,
  player,
  read_frame,
  room_frame,
  send_frame,
  stop_all,
  tick,
  version,
  ws_close,
  type Harness,
} from './helpers.ts';

const DUEL = mode(7101);
const ROOMS = mode(7102, { max_players: 4, allow_room: true, max_party_size: 2 });

afterEach(async () => {
  await stop_all();
});

async function hello_code(h: Harness, data_version: string, client_version = '', session?: TestSession): Promise<number | null> {
  const s = session ?? (await player(h));
  const conn = await connect(h.server);
  send_frame(conn, hello(s, data_version, client_version));
  const f = await read_frame(conn, 5_000n);
  if (f?.kind === K.MATCHMAKER_FRAME_KIND_HELLO_ACK) return 0;
  if (f?.kind !== K.MATCHMAKER_FRAME_KIND_CLOSE) return null;
  expect(await read_frame(conn, 5_000n)).toBeNull();
  expect(ws_close(conn)).toEqual({ code: 4000, reason: String(f.code) });
  return f.code;
}

describe('HELLO', () => {
  it('closes a connection whose first frame is MATCH_REQUEST', async () => {
    const h = await harness({ modes: [DUEL] });
    const conn = await connect(h.server);
    send_frame(conn, match_request(DUEL.id));
    expect(await read_frame(conn, 5_000n)).toBeNull();
  });

  it('closes a connection not authenticated within matchmaker.helloTimeoutMs and keeps an authenticated one', async () => {
    const h = await harness({ modes: [DUEL], settings: { 'matchmaker.helloTimeoutMs': 300 } });
    const idle = await connect(h.server);
    const authed = await online(h, await player(h));
    expect(await read_frame(idle, 3_000n)).toBeNull();
    await new Promise((resolve) => setTimeout(resolve, 400));
    await barrier(authed);
    expect(read_logs(h.server, 'security').some((l) => l['reason'] === 'hello_timeout')).toBe(true);
  });

  it('answers a banned user and a HELLO during maintenance with CLOSE of that code, then closes with 4000 and the code', async () => {
    const h = await harness({ modes: [DUEL] });
    const banned = await player(h);
    const other = await player(h);
    await ban(h, banned.user_id);
    const conn = await connect(h.server);
    send_frame(conn, hello(banned, h.client_data_version));
    expect(await close_code(conn)).toBe(CoreError.CORE_ERROR_BANNED);
    expect(ws_close(conn)).toEqual({ code: 4000, reason: String(CoreError.CORE_ERROR_BANNED) });
    await maintenance(h, true);
    const during = await connect(h.server);
    send_frame(during, hello(other, h.client_data_version));
    expect(await close_code(during)).toBe(CoreError.CORE_ERROR_MAINTENANCE);
    expect(ws_close(during)).toEqual({ code: 4000, reason: String(CoreError.CORE_ERROR_MAINTENANCE) });
  });

  it('answers a bad access token with CLOSE UNAUTHORIZED and a security log', async () => {
    const h = await harness({ modes: [DUEL] });
    const s = await player(h);
    const conn = await connect(h.server);
    const bad = hello(s, h.client_data_version);
    bad.access_token = 'not-a-token';
    send_frame(conn, bad);
    expect(await close_code(conn)).toBe(CoreError.CORE_ERROR_UNAUTHORIZED);
    expect(read_logs(h.server, 'security').some((l) => l['reason'] === 'unauthorized')).toBe(true);
  });

  it('answers a malformed data_version or client_version with CLOSE INVALID_REQUEST', async () => {
    const h = await harness({ modes: [DUEL] });
    expect(await hello_code(h, 'abc-def')).toBe(CoreError.CORE_ERROR_INVALID_REQUEST);
    expect(await hello_code(h, h.client_data_version, '1.2')).toBe(CoreError.CORE_ERROR_INVALID_REQUEST);
  });

  it('decides the data version as routing step 7: protocol hash, data hash with is_data_update_ready or an empty client_version', async () => {
    const compat = version('b', '2');
    const h = await harness({ modes: [DUEL], client_data_version: version('a', '1'), compat_client_data_version: compat });
    expect(await hello_code(h, version('c', '1'))).toBe(CoreError.CORE_ERROR_APP_UPDATE_REQUIRED);
    expect(await hello_code(h, version('a', '9'), '')).toBe(CoreError.CORE_ERROR_DATA_UPDATE_REQUIRED);
    // No deploy list is published, so is_data_update_ready is false for an app version.
    expect(await hello_code(h, version('a', '9'), '1.0.0')).toBe(0);
    expect(await hello_code(h, compat)).toBe(0);
    expect(await hello_code(h, version('b', '9'), '')).toBe(CoreError.CORE_ERROR_DATA_UPDATE_REQUIRED);
    // client_data_version itself differs from the server build data's data version and is accepted.
    expect(await hello_code(h, version('a', '1'))).toBe(0);
  });

  it('closes the earlier connection of a user with CLOSE SESSION_REPLACED when a new one authenticates', async () => {
    const h = await harness({ modes: [DUEL] });
    const s = await player(h);
    const first = await online(h, s);
    await online(h, s);
    expect(await close_code(first)).toBe(CoreError.CORE_ERROR_SESSION_REPLACED);
  });

  it('drops frames it cannot read, text-like kinds from the server side and a second HELLO after authentication', async () => {
    const h = await harness({ modes: [DUEL] });
    const s = await player(h);
    const conn = await online(h, s);
    send_frame(conn, new Uint8Array([0xff, 0xff, 0xff]));
    send_frame(conn, frame(K.MATCHMAKER_FRAME_KIND_MATCH_FOUND));
    send_frame(conn, hello(s, h.client_data_version));
    await barrier(conn);
  });
});

describe('checks before frames', () => {
  async function room_with_guest(h: Harness): Promise<{ host: Awaited<ReturnType<typeof online>>; code: string }> {
    const host = await online(h, await player(h));
    send_frame(host, room_frame(K.MATCHMAKER_FRAME_KIND_ROOM_CREATE, (f) => {
      f.mode_id = ROOMS.id;
    }));
    const state = await next(host, K.MATCHMAKER_FRAME_KIND_ROOM_STATE);
    return { host, code: state.room_code };
  }

  it('answers MATCH_REQUEST, ROOM_CREATE, ROOM_JOIN, ROOM_START with CLOSE MAINTENANCE once the switch cache refreshed, leaving no queue entry or room', async () => {
    const h = await harness({ modes: [DUEL, ROOMS] });
    const queued = await online(h, await player(h));
    send_frame(queued, match_request(DUEL.id));
    await barrier(queued);
    const creator = await online(h, await player(h));
    const joiner = await online(h, await player(h));
    const { host: starter, code } = await room_with_guest(h);
    await maintenance(h, true);
    advance_time(h.server, 5_001n);
    await wait_background(h.server);
    send_frame(queued, match_request(DUEL.id));
    send_frame(creator, room_frame(K.MATCHMAKER_FRAME_KIND_ROOM_CREATE, (f) => {
      f.mode_id = ROOMS.id;
    }));
    send_frame(joiner, room_frame(K.MATCHMAKER_FRAME_KIND_ROOM_JOIN, (f) => {
      f.room_code = code;
    }));
    send_frame(starter, room_frame(K.MATCHMAKER_FRAME_KIND_ROOM_START));
    for (const conn of [queued, creator, joiner, starter]) expect(await close_code(conn)).toBe(CoreError.CORE_ERROR_MAINTENANCE);
    await maintenance(h, false);
    advance_time(h.server, 5_001n);
    await wait_background(h.server);
    // The room is gone with its only member, and the queue entry is gone: a new player waits alone.
    const other = await online(h, await player(h));
    send_frame(other, room_frame(K.MATCHMAKER_FRAME_KIND_ROOM_JOIN, (f) => {
      f.room_code = code;
    }));
    expect((await next(other, K.MATCHMAKER_FRAME_KIND_ROOM_FAILED)).error_code).toBe(CoreError.CORE_ERROR_ROOM_NOT_FOUND);
    send_frame(other, match_request(DUEL.id));
    await barrier(other);
    await tick(h);
    expect(kinds(await barrier(other))).not.toContain(K.MATCHMAKER_FRAME_KIND_MATCH_FOUND);
  });

  it('answers the same frames of a user banned after HELLO with CLOSE BANNED', async () => {
    const h = await harness({ modes: [DUEL, ROOMS] });
    const kinds = [K.MATCHMAKER_FRAME_KIND_MATCH_REQUEST, K.MATCHMAKER_FRAME_KIND_ROOM_CREATE, K.MATCHMAKER_FRAME_KIND_ROOM_JOIN, K.MATCHMAKER_FRAME_KIND_ROOM_START];
    for (const kind of kinds) {
      const s = await player(h);
      const conn = await online(h, s);
      await ban(h, s.user_id);
      send_frame(conn, frame(kind, (f) => {
        f.mode_id = kind === K.MATCHMAKER_FRAME_KIND_MATCH_REQUEST ? DUEL.id : ROOMS.id;
        f.room_code = 'AAAAAA';
      }));
      expect(await close_code(conn)).toBe(CoreError.CORE_ERROR_BANNED);
    }
  });
});

describe('security', () => {
  it('closes a connection on a frame over matchmaker.maxFrameBytes', async () => {
    const h = await harness({ modes: [DUEL], settings: { 'matchmaker.maxFrameBytes': 1024 } });
    const conn = await online(h, await player(h));
    send_frame(conn, new Uint8Array(1025));
    expect(await read_frame(conn, 5_000n)).toBeNull();
    expect(read_logs(h.server, 'security').some((l) => l['reason'] === 'frame_too_large')).toBe(true);
  });

  it('closes with CLOSE RATE_LIMITED past matchmaker.framesPerSecond in 1000 ms, and a new connection of the user shares the counter', async () => {
    const h = await harness({ modes: [DUEL], settings: { 'matchmaker.framesPerSecond': 3 } });
    const s = await player(h);
    const conn = await online(h, s);
    for (let i = 0; i < 4; i += 1) send_frame(conn, frame(K.MATCHMAKER_FRAME_KIND_MATCH_CANCEL));
    expect(await close_code(conn)).toBe(CoreError.CORE_ERROR_RATE_LIMITED);
    const again = await online(h, s);
    send_frame(again, frame(K.MATCHMAKER_FRAME_KIND_MATCH_CANCEL));
    expect(await close_code(again)).toBe(CoreError.CORE_ERROR_RATE_LIMITED);
    advance_time(h.server, 1_000n);
    const later = await online(h, s);
    await barrier(later);
  });

  it('refuses new connections of an IP past matchmaker.preAuthConnections and preAuthAcceptsPerSecond', async () => {
    const h = await harness({ modes: [DUEL], settings: { 'matchmaker.preAuthConnections': 2, 'matchmaker.preAuthAcceptsPerSecond': 10_000 } });
    await connect(h.server);
    await connect(h.server);
    await expect(connect(h.server)).rejects.toThrow();
    const accepts = await harness({ modes: [DUEL], settings: { 'matchmaker.preAuthAcceptsPerSecond': 2 } });
    await connect(accepts.server);
    await connect(accepts.server);
    await expect(connect(accepts.server)).rejects.toThrow();
    advance_time(accepts.server, 1_000n);
    await connect(accepts.server);
    expect(read_logs(accepts.server, 'security').some((l) => l['reason'] === 'pre_auth_connection_limit')).toBe(true);
  });

  it('closes an unauthenticated connection past matchmaker.preAuthFramesPerSecond of its IP', async () => {
    const h = await harness({ modes: [DUEL], settings: { 'matchmaker.preAuthFramesPerSecond': 1 } });
    const first = await online(h, await player(h));
    const s = await player(h);
    const conn = await connect(h.server);
    send_frame(conn, hello(s, h.client_data_version));
    expect(await read_frame(conn, 5_000n)).toBeNull();
    expect(read_logs(h.server, 'security').some((l) => l['reason'] === 'pre_auth_frame_limit')).toBe(true);
    // Frames after authentication count against the user, not the IP.
    await barrier(first);
  });

  it('serves /realtime only on a server instance started with --matchmaker', async () => {
    const h = await harness({ modes: [DUEL], matchmaker: false });
    const out = await send_raw(h.server, 'GET', '/realtime', {}, new Uint8Array(0));
    expect(out.status).toBe(404);
  });
});
