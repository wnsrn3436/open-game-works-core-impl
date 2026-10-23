import {
  BUMP,
  INVALID_REQUEST,
  OTHER,
  RETENTION_MS,
  START_AT,
  bump,
  calls,
  decode,
  failing,
  new_user,
  other,
  rows,
  send,
  server,
  step_of,
  stop_all,
  without_time,
} from './helpers.ts';

const ROW = 'SELECT request_name, created_at, expires_at FROM idempotency_response WHERE user_id = $1 AND request_id = $2';

afterEach(() => {
  stop_all();
  calls.clear();
});

describe('request ID', () => {
  it('calls the handler once for a request ID sent twice and answers the same fields but server_time_at', async () => {
    const s = await server();
    const user = await new_user(s);
    const first = await send(s, user, BUMP, 'req-x', bump(s));
    s.clock.advance(1n);
    const second = await send(s, user, BUMP, 'req-x', bump(s));
    expect(calls.get(BUMP)).toBe(1);
    expect(first.error).toBeNull();
    expect(first.user_state?.entries.length ?? 0).toBeGreaterThan(0);
    expect(second.server_time_at).not.toBe(first.server_time_at);
    expect(without_time(second)).toEqual(without_time(first));
  });

  it('sets server_time_at of a replay after advance_time to the request time of the replayed request, delta and body unchanged', async () => {
    const s = await server();
    const user = await new_user(s);
    const first = await send(s, user, BUMP, 'req-x', bump(s));
    await send(s, user, BUMP, 'req-y', bump(s));
    s.clock.advance(1_000n);
    const again = await send(s, user, BUMP, 'req-x', bump(s));
    expect(first.server_time_at).toBe(START_AT);
    expect(again.server_time_at).toBe(START_AT + 1_000n);
    expect(again.user_state?.encode()).toEqual(first.user_state?.encode());
    expect(step_of(again)).toBe(1);
    expect(again.body).toEqual(first.body);
  });

  it('gives a request ID sent while the first one is in progress the first response at its own request time', async () => {
    const s = await server();
    const user = await new_user(s);
    const offset = 5_000n;
    s.offsets.set(user, offset);
    // Every send reads the committed responses before any of the transactions commits, so each later send finds
    // none there and waits for the user lock that the first request holds; find_response then replays it.
    const [first, ...later] = await Promise.all([0, 1, 2, 3, 4].map(() => send(s, user, BUMP, 'req-x', bump(s))));
    if (first === undefined) throw new Error('no response');
    expect(calls.get(BUMP)).toBe(1);
    expect(step_of(first)).toBe(1);
    for (const result of later) {
      expect(result.server_time_at).toBe(START_AT + offset);
      expect(without_time(result)).toEqual(without_time(first));
    }
  });

  it('find_response sets server_time_at to the request time of ctx, with a cheat time offset after the clock moves', async () => {
    const s = await server();
    const user = await new_user(s);
    const first = await send(s, user, BUMP, 'req-x', bump(s));
    const offset = 7_000n;
    s.offsets.set(user, offset);
    s.clock.advance(1_000n);
    const fields = { request_name: BUMP, request_id: 'req-x', silent: false, retry: false, session_id: '', client_version: '', platform: '' };
    let request_time = 0n;
    const found = await s.storage.run_request_transaction(user, fields, (ctx) => {
      request_time = ctx.request_time;
      return s.idempotency.find_response(ctx);
    });
    expect(request_time).toBe(START_AT + 1_000n + offset);
    expect(found).toBeInstanceOf(Uint8Array);
    const replayed = decode(found as Uint8Array);
    expect(replayed.server_time_at).toBe(request_time);
    expect(without_time(replayed)).toEqual(without_time(first));
    expect(calls.get(BUMP)).toBe(1);
  });

  it('answers INVALID_REQUEST without the handler for a request ID of another request name and keeps the stored response', async () => {
    const s = await server();
    const user = await new_user(s);
    const first = await send(s, user, BUMP, 'req-a', bump(s));
    const mismatch = await send(s, user, OTHER, 'req-a', other());
    expect(mismatch.error?.code).toBe(INVALID_REQUEST);
    expect(calls.get(OTHER)).toBeUndefined();
    // find_response in the user transaction answers the same.
    const fields = { request_name: OTHER, request_id: 'req-a', silent: false, retry: false, session_id: '', client_version: '', platform: '' };
    expect(await s.storage.run_request_transaction(user, fields, (ctx) => s.idempotency.find_response(ctx))).toBe('NAME_MISMATCH');
    expect(rows(s, ROW, [user, 'req-a'])).toEqual([{ request_name: BUMP, created_at: START_AT, expires_at: START_AT + RETENTION_MS }]);
    const again = await send(s, user, BUMP, 'req-a', bump(s));
    expect(without_time(again)).toEqual(without_time(first));
    expect(calls.get(BUMP)).toBe(1);
  });

  it('does not store an error response, so the same request ID runs the handler again', async () => {
    const s = await server();
    const user = await new_user(s);
    const failed = await send(s, user, BUMP, 'req-x', failing(INVALID_REQUEST));
    expect(failed.error?.code).toBe(INVALID_REQUEST);
    expect(rows(s, ROW, [user, 'req-x'])).toEqual([]);
    const retried = await send(s, user, BUMP, 'req-x', bump(s));
    expect(retried.error).toBeNull();
    expect(calls.get(BUMP)).toBe(1);
    expect(step_of(retried)).toBe(1);
  });

  it('keeps the same request ID of two users apart', async () => {
    const s = await server();
    const a = await new_user(s);
    const b = await new_user(s);
    const first = await send(s, a, BUMP, 'req-x', bump(s));
    await send(s, a, BUMP, 'req-y', bump(s));
    const of_b = await send(s, b, BUMP, 'req-x', bump(s));
    expect(calls.get(BUMP)).toBe(3);
    expect(step_of(of_b)).toBe(1);
    const again = await send(s, a, BUMP, 'req-x', bump(s));
    expect(calls.get(BUMP)).toBe(3);
    expect(without_time(again)).toEqual(without_time(first));
  });

  it('find_committed_response replays a committed row with server_time_at changed, NAME_MISMATCH for another name, none for no row', async () => {
    const s = await server();
    const user = await new_user(s);
    const first = await send(s, user, BUMP, 'req-x', bump(s));
    const db = s.storage.read_db();
    const found = s.idempotency.find_committed_response(db, user, 'req-x', BUMP, 777n);
    expect(found).toBeInstanceOf(Uint8Array);
    const envelope = decode(found as Uint8Array);
    expect(envelope.server_time_at).toBe(777n);
    expect(without_time(envelope)).toEqual(without_time(first));
    expect(s.idempotency.find_committed_response(db, user, 'req-x', OTHER, 777n)).toBe('NAME_MISMATCH');
    expect(s.idempotency.find_committed_response(db, user, 'req-missing', BUMP, 777n)).toBeNull();
  });

  it('has_response sees a live stored row of any request name and no expired row', async () => {
    const s = await server();
    const user = await new_user(s);
    await send(s, user, BUMP, 'req-x', bump(s));
    const db = s.storage.read_db();
    expect(s.idempotency.has_response(db, user, 'req-x')).toBe(true);
    expect(s.idempotency.has_response(db, user, 'req-missing')).toBe(false);
    s.clock.advance(RETENTION_MS - 1n);
    expect(s.idempotency.has_response(db, user, 'req-x')).toBe(true);
    s.clock.advance(1n);
    expect(s.idempotency.has_response(db, user, 'req-x')).toBe(false);
  });

  it('deletes a stored response after its retention, and the same request ID is then a new request', async () => {
    const s = await server();
    const user = await new_user(s);
    await send(s, user, BUMP, 'req-x', bump(s));
    s.clock.advance(RETENTION_MS);
    expect(await s.storage.sweep_expired()).toBeGreaterThan(0);
    expect(rows(s, ROW, [user, 'req-x'])).toEqual([]);
    const again = await send(s, user, BUMP, 'req-x', bump(s));
    expect(calls.get(BUMP)).toBe(2);
    expect(step_of(again)).toBe(2);
    expect(again.server_time_at).toBe(START_AT + RETENTION_MS);
  });

  it('does not find an expired stored response that is not deleted yet: the handler runs and a new response is stored', async () => {
    const s = await server();
    const user = await new_user(s);
    await send(s, user, BUMP, 'req-x', bump(s));
    s.clock.advance(RETENTION_MS);
    expect(rows(s, ROW, [user, 'req-x']).length).toBe(1);
    const again = await send(s, user, BUMP, 'req-x', bump(s));
    expect(calls.get(BUMP)).toBe(2);
    expect(step_of(again)).toBe(2);
    expect(rows(s, ROW, [user, 'req-x'])).toEqual([{ request_name: BUMP, created_at: START_AT + RETENTION_MS, expires_at: START_AT + 2n * RETENTION_MS }]);
    const replay = await send(s, user, BUMP, 'req-x', bump(s));
    expect(calls.get(BUMP)).toBe(2);
    expect(without_time(replay)).toEqual(without_time(again));
  });

  it('stores created_at at clock_now for a user with a cheat time offset and replays until clock_now reaches its expiry', async () => {
    const s = await server();
    const user = await new_user(s);
    const offset = 10n * RETENTION_MS;
    s.offsets.set(user, offset);
    const first = await send(s, user, BUMP, 'req-x', bump(s));
    expect(first.server_time_at).toBe(START_AT + offset);
    expect(rows(s, ROW, [user, 'req-x'])).toEqual([{ request_name: BUMP, created_at: START_AT, expires_at: START_AT + RETENTION_MS }]);
    s.clock.advance(RETENTION_MS - 1n);
    const replay = await send(s, user, BUMP, 'req-x', bump(s));
    expect(calls.get(BUMP)).toBe(1);
    expect(without_time(replay)).toEqual(without_time(first));
    s.clock.advance(1n);
    const fresh = await send(s, user, BUMP, 'req-x', bump(s));
    expect(calls.get(BUMP)).toBe(2);
    expect(step_of(fresh)).toBe(2);
  });
});
