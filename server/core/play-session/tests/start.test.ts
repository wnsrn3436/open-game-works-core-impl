import { read_logs, read_user_state, set_time } from '../../testing/dev/index.ts';
import type { PlaySessionRecord } from '../index.ts';
import {
  CoreError,
  GOLD,
  GAME_ERROR,
  INSTANT,
  START_AT,
  TIMED,
  amount,
  bytes_equal,
  continue_session,
  finish,
  harness,
  hook_calls,
  item_ledger,
  loadout_bytes,
  opened,
  play_session,
  player,
  start,
  start_options,
  stop_all,
} from './helpers.ts';

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

afterEach(async () => {
  await stop_all();
});

/** A prepare hook that records what `get_active_play_session` returns before the new row is written. */
function peeking(seen: (PlaySessionRecord | null)[]): Parameters<typeof harness>[0] {
  return {
    prepare: (core, ctx) => {
      seen.push(play_session(core).get_active_play_session(ctx));
      return new Uint8Array(0);
    },
  };
}

describe('StartPlaySession', () => {
  it('returns a play session ID and started_at, and a second start replaces the play session', async () => {
    const seen: (PlaySessionRecord | null)[] = [];
    const h = await harness(peeking(seen));
    const s = await player(h);
    const first = await opened(s, h.id(TIMED));
    expect(first.play_session_id).toMatch(UUID_V4);
    expect(first.started_at).toBe(START_AT);
    const second = await opened(s, h.id(INSTANT));
    expect(second.play_session_id).toMatch(UUID_V4);
    expect(second.play_session_id).not.toBe(first.play_session_id);
    // The second start saw the first play session as the user's one play session.
    expect(seen[0]).toBeNull();
    expect(seen[1]?.play_session_id).toBe(first.play_session_id);
    expect(seen[1]?.mode_id).toBe(h.id(TIMED));
    // The first play session is gone; the second one finishes.
    expect((await finish(s, first.play_session_id)).code).toBe(CoreError.CORE_ERROR_PLAY_SESSION_NOT_FOUND);
    expect((await finish(s, second.play_session_id)).code).toBe(0);
  });

  it('passes the options bytes to prepare_play_session and the same bytes as record options to verify and apply', async () => {
    const h = await harness();
    const s = await player(h);
    const options = start_options(2);
    const started = await opened(s, h.id(INSTANT), options);
    expect((await finish(s, started.play_session_id)).code).toBe(0);
    const [prepare] = hook_calls(h, 'prepare_play_session');
    expect(prepare !== undefined && bytes_equal(prepare.bytes, options)).toBe(true);
    for (const hook of ['verify_play_session', 'apply_play_session'] as const) {
      const [call] = hook_calls(h, hook);
      expect(call?.record !== null && call?.record !== undefined && bytes_equal(call.record.options, options)).toBe(true);
    }
  });

  it('answers INVALID_REQUEST without calling a hook for options that break the PlaySessionStartOptions declaration', async () => {
    const h = await harness();
    const s = await player(h);
    const out = await start(s, h.id(TIMED), start_options(4));
    expect(out.code).toBe(CoreError.CORE_ERROR_INVALID_REQUEST);
    const garbage = await start(s, h.id(TIMED), new Uint8Array([0xff, 0xff, 0xff]));
    expect(garbage.code).toBe(CoreError.CORE_ERROR_INVALID_REQUEST);
    expect(h.calls).toEqual([]);
  });

  it('answers the GameError of prepare_play_session and keeps no play session row', async () => {
    let refuse = true;
    const seen: (PlaySessionRecord | null)[] = [];
    const h = await harness({
      prepare: (core, ctx) => {
        seen.push(play_session(core).get_active_play_session(ctx));
        return refuse ? GAME_ERROR : new Uint8Array(0);
      },
    });
    const s = await player(h);
    const out = await start(s, h.id(TIMED));
    expect(out.code).toBe(GAME_ERROR);
    expect(out.response).toBeNull();
    refuse = false;
    await opened(s, h.id(TIMED));
    expect(seen).toEqual([null, null]);
  });

  it('sends the loadout of prepare_play_session in the response and as record loadout to verify and apply, also after a continue', async () => {
    const loadout = loadout_bytes(1234n, 'team');
    const h = await harness({ prepare: () => loadout });
    const s = await player(h);
    const started = await opened(s, h.id(TIMED));
    expect(bytes_equal(started.loadout, loadout)).toBe(true);
    expect((await continue_session(s, started.play_session_id)).code).toBe(0);
    set_time(h.server, started.started_at + h.data.PlaySessionModeTable.get_row(h.id(TIMED)).min_duration);
    expect((await finish(s, started.play_session_id)).code).toBe(0);
    for (const hook of ['continue_play_session', 'verify_play_session', 'apply_play_session'] as const) {
      const [call] = hook_calls(h, hook);
      expect(call?.record !== null && call?.record !== undefined && bytes_equal(call.record.loadout, loadout)).toBe(true);
    }
  });

  it('answers INTERNAL for a loadout over play-session.loadoutMaxBytes and keeps neither the row nor the hook changes', async () => {
    const seen: (PlaySessionRecord | null)[] = [];
    let big = true;
    let gold = 0;
    const h = await harness(
      {
        prepare: (core, ctx) => {
          seen.push(play_session(core).get_active_play_session(ctx));
          expect(item_ledger(core).add_items(ctx, [amount(gold, 5n)], {})).toBe('OK');
          return new Uint8Array(big ? 17 : 16);
        },
      },
      { 'play-session.loadoutMaxBytes': 16 },
    );
    gold = h.id(GOLD);
    const s = await player(h);
    const out = await start(s, h.id(TIMED));
    expect(out.code).toBe(CoreError.CORE_ERROR_INTERNAL);
    const errors = read_logs(h.server, 'error').filter((l) => 'loadout_bytes' in l);
    expect(errors.length).toBe(1);
    expect(errors[0]?.['mode_id']).toBe(h.id(TIMED));
    expect(errors[0]?.['loadout_bytes']).toBe(17);
    expect((await read_user_state(h.server, s.user_id)).filter((e) => e.kind === 'ItemBalanceUserState')).toEqual([]);
    big = false;
    const ok = await start(s, h.id(TIMED));
    expect(ok.code).toBe(0);
    expect(ok.response?.loadout.length).toBe(16);
    expect(seen).toEqual([null, null]);
    const balances = (await read_user_state(h.server, s.user_id)).filter((e) => e.kind === 'ItemBalanceUserState');
    expect(balances.length).toBe(1);
  });
});

describe('get_active_play_session', () => {
  it('returns the active play session and none without a row, at started_at + max_duration and after FinishPlaySession', async () => {
    const seen: (PlaySessionRecord | null)[] = [];
    const h = await harness({
      ...peeking(seen),
      continue: (core, ctx, record) => {
        const active = play_session(core).get_active_play_session(ctx);
        expect(active).toEqual({ ...record, finished_at: 0n });
        seen.push(active);
        return 'pass';
      },
    });
    const s = await player(h);
    const mode = h.data.PlaySessionModeTable.get_row(h.id(TIMED));

    // No row.
    const a = await opened(s, h.id(TIMED));
    // Active: the continue hook reads the record.
    expect((await continue_session(s, a.play_session_id)).code).toBe(0);
    expect(seen[1]?.play_session_id).toBe(a.play_session_id);
    expect(seen[1]?.continues.length).toBe(0);
    expect(seen[1]?.finished_at).toBe(0n);
    // At started_at + max_duration the next start sees none.
    set_time(h.server, a.started_at + mode.max_duration);
    const b = await opened(s, h.id(TIMED));
    expect(seen[2]).toBeNull();
    // After FinishPlaySession the next start sees none.
    set_time(h.server, b.started_at + mode.min_duration);
    expect((await finish(s, b.play_session_id)).code).toBe(0);
    await opened(s, h.id(TIMED));
    expect(seen[0]).toBeNull();
    expect(seen[3]).toBeNull();
    // One millisecond before max_duration the play session is still active.
    const c = await opened(s, h.id(TIMED));
    set_time(h.server, c.started_at + mode.max_duration - 1n);
    await opened(s, h.id(TIMED));
    expect(seen[5]?.play_session_id).toBe(c.play_session_id);
  });
});
