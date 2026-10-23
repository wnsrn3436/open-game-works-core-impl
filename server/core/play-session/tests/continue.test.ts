import { read_user_state, set_time } from '../../testing/dev/index.ts';
import {
  CONTINUES,
  CoreError,
  GOLD,
  GAME_ERROR,
  TIMED,
  amount,
  bytes_equal,
  continue_options,
  continue_session,
  finish,
  harness,
  hook_calls,
  item_ledger,
  new_request_id,
  opened,
  player,
  stop_all,
  without_server_time,
} from './helpers.ts';

afterEach(async () => {
  await stop_all();
});

describe('ContinuePlaySession', () => {
  it('calls continue_play_session once per continue, answers continue_count 1 and 2, and the finish record holds the options in order', async () => {
    const h = await harness();
    const s = await player(h);
    const started = await opened(s, h.id(TIMED));
    const first = continue_options(3);
    const second = continue_options(7);
    const a = await continue_session(s, started.play_session_id, first);
    expect(a.response?.continue_count).toBe(1);
    expect(hook_calls(h, 'continue_play_session').length).toBe(1);
    const b = await continue_session(s, started.play_session_id, second);
    expect(b.response?.continue_count).toBe(2);
    const calls = hook_calls(h, 'continue_play_session');
    expect(calls.length).toBe(2);
    expect(calls[0] !== undefined && bytes_equal(calls[0].bytes, first)).toBe(true);
    expect(calls[1]?.record?.continues.length).toBe(1);
    set_time(h.server, started.started_at + h.data.PlaySessionModeTable.get_row(h.id(TIMED)).min_duration);
    expect((await finish(s, started.play_session_id)).code).toBe(0);
    const record = hook_calls(h, 'verify_play_session')[0]?.record;
    expect(record?.continues.length).toBe(2);
    expect(record !== null && record !== undefined && bytes_equal(record.continues[0] as Uint8Array, first) && bytes_equal(record.continues[1] as Uint8Array, second)).toBe(true);
  });

  it('answers PLAY_SESSION_CONTINUE_LIMIT without calling the hook after max_continue_count continues', async () => {
    const h = await harness();
    const s = await player(h);
    const started = await opened(s, h.id(TIMED));
    const max = CONTINUES;
    for (let i = 0; i < max; i += 1) expect((await continue_session(s, started.play_session_id)).code).toBe(0);
    const out = await continue_session(s, started.play_session_id);
    expect(out.code).toBe(CoreError.CORE_ERROR_PLAY_SESSION_CONTINUE_LIMIT);
    expect(hook_calls(h, 'continue_play_session').length).toBe(max);
  });

  it('keeps the continue rows and the stored state after a GameError of continue_play_session', async () => {
    let refuse = true;
    let gold = 0;
    const h = await harness({
      continue: (core, ctx) => {
        expect(item_ledger(core).add_items(ctx, [amount(gold, 3n)], {})).toBe('OK');
        return refuse ? GAME_ERROR : 'pass';
      },
    });
    gold = h.id(GOLD);
    const s = await player(h);
    const started = await opened(s, h.id(TIMED));
    const out = await continue_session(s, started.play_session_id);
    expect(out.code).toBe(GAME_ERROR);
    expect((await read_user_state(h.server, s.user_id)).filter((e) => e.kind === 'ItemBalanceUserState')).toEqual([]);
    refuse = false;
    const next = await continue_session(s, started.play_session_id);
    expect(next.response?.continue_count).toBe(1);
    expect(hook_calls(h, 'continue_play_session')[1]?.record?.continues.length).toBe(0);
  });

  it('answers PLAY_SESSION_NOT_FOUND for no play session and another play_session_id, and PLAY_SESSION_EXPIRED at started_at + max_duration', async () => {
    const h = await harness();
    const s = await player(h);
    expect((await continue_session(s, crypto.randomUUID())).code).toBe(CoreError.CORE_ERROR_PLAY_SESSION_NOT_FOUND);
    const started = await opened(s, h.id(TIMED));
    expect((await continue_session(s, crypto.randomUUID())).code).toBe(CoreError.CORE_ERROR_PLAY_SESSION_NOT_FOUND);
    expect((await continue_session(s, 'not-a-uuid')).code).toBe(CoreError.CORE_ERROR_INVALID_REQUEST);
    set_time(h.server, started.started_at + h.data.PlaySessionModeTable.get_row(h.id(TIMED)).max_duration);
    expect((await continue_session(s, started.play_session_id)).code).toBe(CoreError.CORE_ERROR_PLAY_SESSION_EXPIRED);
    expect(hook_calls(h, 'continue_play_session')).toEqual([]);
  });

  it('answers the first response to the same request ID sent again and adds one continue row', async () => {
    const h = await harness();
    const s = await player(h);
    const started = await opened(s, h.id(TIMED));
    const request_id = new_request_id();
    const first = await continue_session(s, started.play_session_id, continue_options(2), request_id);
    const again = await continue_session(s, started.play_session_id, continue_options(2), request_id);
    expect(first.response?.continue_count).toBe(1);
    expect(again.response?.continue_count).toBe(1);
    expect(without_server_time(again.envelope)).toEqual(without_server_time(first.envelope));
    expect(hook_calls(h, 'continue_play_session').length).toBe(1);
    const next = await continue_session(s, started.play_session_id);
    expect(next.response?.continue_count).toBe(2);
  });

  it('answers INVALID_REQUEST without calling the hook for options that break the PlaySessionContinueOptions declaration', async () => {
    const h = await harness();
    const s = await player(h);
    const started = await opened(s, h.id(TIMED));
    expect((await continue_session(s, started.play_session_id, continue_options(-1))).code).toBe(CoreError.CORE_ERROR_INVALID_REQUEST);
    expect((await continue_session(s, started.play_session_id, continue_options(11))).code).toBe(CoreError.CORE_ERROR_INVALID_REQUEST);
    expect((await continue_session(s, started.play_session_id, new Uint8Array([0xff, 0xff, 0xff]))).code).toBe(CoreError.CORE_ERROR_INVALID_REQUEST);
    expect(hook_calls(h, 'continue_play_session')).toEqual([]);
  });

  it('leaves the record continues empty after a new StartPlaySession', async () => {
    const h = await harness();
    const s = await player(h);
    const a = await opened(s, h.id(TIMED));
    expect((await continue_session(s, a.play_session_id)).code).toBe(0);
    expect((await continue_session(s, a.play_session_id)).code).toBe(0);
    const b = await opened(s, h.id(TIMED));
    const out = await continue_session(s, b.play_session_id);
    expect(out.response?.continue_count).toBe(1);
    expect(hook_calls(h, 'continue_play_session')[2]?.record?.continues).toEqual([]);
    set_time(h.server, b.started_at + h.data.PlaySessionModeTable.get_row(h.id(TIMED)).min_duration);
    expect((await finish(s, b.play_session_id)).code).toBe(0);
    expect(hook_calls(h, 'verify_play_session')[0]?.record?.continues.length).toBe(1);
  });
});
