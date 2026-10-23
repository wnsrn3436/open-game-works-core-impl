import { truncate_ip } from '../../logging/log_line.ts';
import { core_settings } from '../../storage/tests/helpers.ts';
import { read_logs, read_user_state, set_time } from '../../testing/dev/index.ts';
import {
  CoreError,
  GOLD,
  GAME_ERROR,
  INSTANT,
  TIMED,
  amount,
  bytes_equal,
  finish,
  harness,
  hook_calls,
  item_ledger,
  new_request_id,
  opened,
  player,
  result_bytes,
  stop_all,
  without_server_time,
  type Harness,
} from './helpers.ts';

/** The client IP of a test request: the TCP peer, since a LOCAL server ignores X-Forwarded-For (`routing`). */
const CLIENT_IP = '127.0.0.1';

afterEach(async () => {
  await stop_all();
});

function mode(h: Harness, name: string): { min: bigint; max: bigint } {
  const row = h.data.PlaySessionModeTable.get_row(h.id(name));
  return { min: row.min_duration, max: row.max_duration };
}

function security(h: Harness, reason: string): Record<string, unknown>[] {
  return read_logs(h.server, 'security').filter((l) => l['reason'] === reason);
}

describe('FinishPlaySession', () => {
  it('calls verify_play_session and apply_play_session once in this order after min_duration, deletes the row and answers the result', async () => {
    const h = await harness();
    const s = await player(h);
    const started = await opened(s, h.id(TIMED));
    set_time(h.server, started.started_at + mode(h, TIMED).min);
    const result = result_bytes(77, [1, 2, 3]);
    const out = await finish(s, started.play_session_id, result);
    expect(out.code).toBe(0);
    expect(out.response !== null && bytes_equal(out.response.result, result)).toBe(true);
    expect(h.calls.map((c) => c.hook)).toEqual(['prepare_play_session', 'verify_play_session', 'apply_play_session']);
    for (const call of h.calls.slice(1)) {
      expect(bytes_equal(call.bytes, result)).toBe(true);
      expect(call.record?.play_session_id).toBe(started.play_session_id);
      expect(call.record?.finished_at).toBe(started.started_at + mode(h, TIMED).min);
    }
    // The row is gone.
    expect((await finish(s, started.play_session_id)).code).toBe(CoreError.CORE_ERROR_PLAY_SESSION_NOT_FOUND);
  });

  it('answers PLAY_SESSION_REJECTED with a security log of the truncated client IP when verify_play_session rejects, without apply, keeping the row and state', async () => {
    let reject = true;
    const h = await harness({ verify: () => (reject ? 'reject' : 'pass') });
    const s = await player(h);
    const started = await opened(s, h.id(INSTANT));
    const out = await finish(s, started.play_session_id);
    expect(out.code).toBe(CoreError.CORE_ERROR_PLAY_SESSION_REJECTED);
    expect(hook_calls(h, 'apply_play_session')).toEqual([]);
    const logs = security(h, 'play_session_rejected');
    expect(logs.length).toBe(1);
    expect(logs[0]?.['play_session_id']).toBe(started.play_session_id);
    expect(logs[0]?.['mode_id']).toBe(h.id(INSTANT));
    expect(logs[0]?.['ip']).toBe(truncate_ip(CLIENT_IP));
    expect((await read_user_state(h.server, s.user_id)).filter((e) => e.kind === 'ItemBalanceUserState')).toEqual([]);
    reject = false;
    expect((await finish(s, started.play_session_id)).code).toBe(0);
  });

  it('answers PLAY_SESSION_TOO_FAST with a security log of the truncated client IP at started_at + min_duration - 1 and keeps the row', async () => {
    const h = await harness();
    const s = await player(h);
    const started = await opened(s, h.id(TIMED));
    set_time(h.server, started.started_at + mode(h, TIMED).min - 1n);
    const out = await finish(s, started.play_session_id);
    expect(out.code).toBe(CoreError.CORE_ERROR_PLAY_SESSION_TOO_FAST);
    expect(hook_calls(h, 'verify_play_session')).toEqual([]);
    const logs = security(h, 'play_session_too_fast');
    expect(logs.length).toBe(1);
    expect(logs[0]?.['mode_id']).toBe(h.id(TIMED));
    // `logging` writes a bigint field as a decimal string.
    expect(logs[0]?.['elapsed_ms']).toBe(String(mode(h, TIMED).min - 1n));
    expect(logs[0]?.['ip']).toBe(truncate_ip(CLIENT_IP));
    set_time(h.server, started.started_at + mode(h, TIMED).min);
    expect((await finish(s, started.play_session_id)).code).toBe(0);
  });

  it('calls verify_play_session at the request time of started_at in a mode with min_duration 0, with finished_at - started_at of 0', async () => {
    const h = await harness();
    expect(mode(h, INSTANT).min).toBe(0n);
    const s = await player(h);
    const started = await opened(s, h.id(INSTANT));
    const out = await finish(s, started.play_session_id);
    expect(out.code).toBe(0);
    const record = hook_calls(h, 'verify_play_session')[0]?.record;
    expect(record).toBeDefined();
    expect(record !== null && record !== undefined ? record.finished_at - record.started_at : -1n).toBe(0n);
    expect(security(h, 'play_session_too_fast')).toEqual([]);
  });

  it('answers PLAY_SESSION_EXPIRED at started_at + max_duration', async () => {
    const h = await harness();
    const s = await player(h);
    const started = await opened(s, h.id(TIMED));
    set_time(h.server, started.started_at + mode(h, TIMED).max);
    expect((await finish(s, started.play_session_id)).code).toBe(CoreError.CORE_ERROR_PLAY_SESSION_EXPIRED);
    expect(hook_calls(h, 'verify_play_session')).toEqual([]);
  });

  it('answers PLAY_SESSION_NOT_FOUND for no play session, another ID and a second finish, and the first response to the same request ID', async () => {
    const h = await harness();
    const s = await player(h);
    expect((await finish(s, crypto.randomUUID())).code).toBe(CoreError.CORE_ERROR_PLAY_SESSION_NOT_FOUND);
    const started = await opened(s, h.id(INSTANT));
    expect((await finish(s, crypto.randomUUID())).code).toBe(CoreError.CORE_ERROR_PLAY_SESSION_NOT_FOUND);
    expect(h.calls.map((c) => c.hook)).toEqual(['prepare_play_session']);
    const request_id = new_request_id();
    const first = await finish(s, started.play_session_id, result_bytes(5), request_id);
    expect(first.code).toBe(0);
    const calls = h.calls.length;
    const again = await finish(s, started.play_session_id, result_bytes(5), request_id);
    expect(without_server_time(again.envelope)).toEqual(without_server_time(first.envelope));
    const other = await finish(s, started.play_session_id, result_bytes(5));
    expect(other.code).toBe(CoreError.CORE_ERROR_PLAY_SESSION_NOT_FOUND);
    expect(h.calls.length).toBe(calls);
  });

  it('answers INVALID_REQUEST without a hook for a result over the (ogw.v) limit or against the PlaySessionResult declaration', async () => {
    const h = await harness();
    const s = await player(h);
    const started = await opened(s, h.id(INSTANT));
    // `max_len_key` `play-session.resultMaxBytes` is the core settings default the contract tool built the validator with.
    const over = new Uint8Array((core_settings()['play-session.resultMaxBytes'] as number) + 1);
    expect((await finish(s, started.play_session_id, over)).code).toBe(CoreError.CORE_ERROR_INVALID_REQUEST);
    expect((await finish(s, started.play_session_id, result_bytes(1, new Array<number>(17).fill(1)))).code).toBe(CoreError.CORE_ERROR_INVALID_REQUEST);
    expect((await finish(s, started.play_session_id, result_bytes(1001))).code).toBe(CoreError.CORE_ERROR_INVALID_REQUEST);
    expect((await finish(s, started.play_session_id, new Uint8Array([0xff, 0xff]))).code).toBe(CoreError.CORE_ERROR_INVALID_REQUEST);
    expect((await finish(s, `${started.play_session_id}0`)).code).toBe(CoreError.CORE_ERROR_INVALID_REQUEST);
    expect(h.calls.map((c) => c.hook)).toEqual(['prepare_play_session']);
    expect((await finish(s, started.play_session_id, result_bytes(1000))).code).toBe(0);
  });

  it('keeps the row and the stored state after a GameError of apply_play_session', async () => {
    let refuse = true;
    let gold = 0;
    const h = await harness({
      apply: (core, ctx) => {
        expect(item_ledger(core).add_items(ctx, [amount(gold, 4n)], {})).toBe('OK');
        return refuse ? GAME_ERROR : 'pass';
      },
    });
    gold = h.id(GOLD);
    const s = await player(h);
    const started = await opened(s, h.id(INSTANT));
    const out = await finish(s, started.play_session_id);
    expect(out.code).toBe(GAME_ERROR);
    expect((await read_user_state(h.server, s.user_id)).filter((e) => e.kind === 'ItemBalanceUserState')).toEqual([]);
    refuse = false;
    const done = await finish(s, started.play_session_id);
    expect(done.code).toBe(0);
    expect((await read_user_state(h.server, s.user_id)).filter((e) => e.kind === 'ItemBalanceUserState').length).toBe(1);
  });
});
