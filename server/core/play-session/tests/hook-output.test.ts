import { read_logs, read_user_state } from '../../testing/dev/index.ts';
import {
  CoreError,
  GOLD,
  INSTANT,
  TIMED,
  amount,
  continue_session,
  finish,
  harness,
  item_ledger,
  opened,
  player,
  start,
  stop_all,
  type Harness,
} from './helpers.ts';

afterEach(async () => {
  await stop_all();
});

/** A `CoreError` value (`BANNED`, below 1000) and 999: neither is a `GameError` (`storage` `## API`). */
const NOT_GAME_ERRORS = [CoreError.CORE_ERROR_BANNED, 999] as const;

function logs(h: Harness): string {
  return JSON.stringify(read_logs(h.server));
}

async function balances(h: Harness, user_id: bigint): Promise<number> {
  return (await read_user_state(h.server, user_id)).filter((e) => e.kind === 'ItemBalanceUserState').length;
}

describe('hook output', () => {
  it('answers INTERNAL with no play session row or hook change when prepare_play_session returns a number below 1000 or a bare pass', async () => {
    let out: Uint8Array | number | 'pass' = NOT_GAME_ERRORS[0];
    let gold = 0;
    const h = await harness({
      prepare: (core, ctx) => {
        expect(item_ledger(core).add_items(ctx, [amount(gold, 2n)], {})).toBe('OK');
        return out as Uint8Array | number;
      },
    });
    gold = h.id(GOLD);
    const s = await player(h);
    for (const value of [...NOT_GAME_ERRORS, 'pass' as const]) {
      out = value;
      expect((await start(s, h.id(TIMED))).code).toBe(CoreError.CORE_ERROR_INTERNAL);
      expect(await balances(h, s.user_id)).toBe(0);
    }
    expect(logs(h)).toContain(`hook prepare_play_session returned ${String(CoreError.CORE_ERROR_BANNED)}, not pass or a GameError`);
    expect(logs(h)).toContain('hook prepare_play_session returned 999, not pass or a GameError');
    expect(logs(h)).toContain('hook prepare_play_session returned an output that is not of its form');
    // No row was written: a finish has no play session.
    expect((await finish(s, crypto.randomUUID())).code).toBe(CoreError.CORE_ERROR_PLAY_SESSION_NOT_FOUND);
    out = new Uint8Array(0);
    expect((await start(s, h.id(TIMED))).code).toBe(0);
    expect(await balances(h, s.user_id)).toBe(1);
  });

  it('answers INTERNAL with no continue row or hook change when continue_play_session returns a number below 1000', async () => {
    let out: number | 'pass' = NOT_GAME_ERRORS[0];
    let gold = 0;
    const h = await harness({
      continue: (core, ctx) => {
        expect(item_ledger(core).add_items(ctx, [amount(gold, 3n)], {})).toBe('OK');
        return out;
      },
    });
    gold = h.id(GOLD);
    const s = await player(h);
    const started = await opened(s, h.id(TIMED));
    for (const value of NOT_GAME_ERRORS) {
      out = value;
      expect((await continue_session(s, started.play_session_id)).code).toBe(CoreError.CORE_ERROR_INTERNAL);
      expect(await balances(h, s.user_id)).toBe(0);
    }
    expect(logs(h)).toContain(`hook continue_play_session returned ${String(CoreError.CORE_ERROR_BANNED)}, not pass or a GameError`);
    expect(logs(h)).toContain('hook continue_play_session returned 999, not pass or a GameError');
    out = 'pass';
    expect((await continue_session(s, started.play_session_id)).response?.continue_count).toBe(1);
  });

  it('answers INTERNAL, not the CoreError, and keeps the row and state when apply_play_session returns a number below 1000', async () => {
    let out: number | 'pass' = NOT_GAME_ERRORS[0];
    let gold = 0;
    const h = await harness({
      apply: (core, ctx) => {
        expect(item_ledger(core).add_items(ctx, [amount(gold, 4n)], {})).toBe('OK');
        return out;
      },
    });
    gold = h.id(GOLD);
    const s = await player(h);
    const started = await opened(s, h.id(INSTANT));
    for (const value of NOT_GAME_ERRORS) {
      out = value;
      expect((await finish(s, started.play_session_id)).code).toBe(CoreError.CORE_ERROR_INTERNAL);
      expect(await balances(h, s.user_id)).toBe(0);
    }
    expect(logs(h)).toContain(`hook apply_play_session returned ${String(CoreError.CORE_ERROR_BANNED)}, not pass or a GameError`);
    expect(logs(h)).toContain('hook apply_play_session returned 999, not pass or a GameError');
    out = 'pass';
    expect((await finish(s, started.play_session_id)).code).toBe(0);
    expect(await balances(h, s.user_id)).toBe(1);
  });
});
