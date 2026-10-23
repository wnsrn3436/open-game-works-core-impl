import * as CoreContract from '../../../generated/contract/core_contract.ts';
import * as GameData from '../../../generated/data/game_data.ts';
import {
  DAY_MS,
  E,
  START_AT,
  amount,
  at,
  attendance_delta,
  balance,
  claim,
  day_number,
  delta_values,
  id_of,
  ok,
  pairs,
  progress,
  progress_of,
  start,
  stop,
  user,
  type Env,
  type TestSession,
} from './helpers.ts';

const GOLD = '[attendance_gold]';

/** Claims once a game day from the current clock, moving the clock a game day after each claim; returns the days. */
async function days_claimed(env: Env, session: TestSession, calendar: string, count: number, from: bigint): Promise<number[]> {
  const days: number[] = [];
  for (let i = 0; i < count; i += 1) {
    at(env, from + BigInt(i) * DAY_MS);
    const result = await claim(session, calendar);
    expect(result.code).toBe(0);
    days.push(ok(result).day);
  }
  return days;
}

describe('ClaimAttendance', () => {
  let env: Env | undefined;
  afterEach(async () => {
    await stop(env);
    env = undefined;
  });

  it('grants day 1 with source Attendance and sends AttendanceUserState day 1 and today in the same response delta', async () => {
    env = await start();
    const session = await user(env);
    const calendar = id_of('[attendance_cycle]');
    const result = await claim(session, '[attendance_cycle]');
    expect(result.code).toBe(0);
    expect(ok(result).day).toBe(1);
    expect(ok(result).mailed).toBe(false);
    expect(pairs(ok(result).items)).toEqual(pairs([amount(GOLD, 10n)]));

    const today = day_number(env, START_AT);
    const rows = attendance_delta(result.envelope);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: BigInt(calendar), day: 1, claimed_day_number: today, reset_at: 0n, event_round: 0 });

    const changes = result.envelope.item_changes;
    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatchObject({ item_id: id_of(GOLD), delta: 10n, source: CoreContract.ItemChangeSource.ITEM_CHANGE_SOURCE_ATTENDANCE, ref: `${String(calendar)}:1` });
    const balances = delta_values(result.envelope.user_state, 'ItemBalanceUserState', (bytes) => CoreContract.ItemBalanceUserState.decode(bytes));
    expect(balances.map((row) => [row.id, row.amount])).toEqual([[BigInt(id_of(GOLD)), 10n]]);

    expect(await balance(env, session, GOLD)).toBe(10n);
    expect(await progress_of(env, session, '[attendance_cycle]')).toMatchObject({ day: 1, claimed_day_number: today });
  });

  it('answers ATTENDANCE_ALREADY_CLAIMED on the same game day up to the next game day boundary − 1 and grants at the boundary', async () => {
    env = await start();
    const session = await user(env);
    expect((await claim(session, '[attendance_cycle]')).code).toBe(0);

    const again = await claim(session, '[attendance_cycle]');
    expect(again.code).toBe(E.CORE_ERROR_ATTENDANCE_ALREADY_CLAIMED);
    expect(again.response).toBeNull();

    const boundary = env.core['server-time'].get_next_reset(GameData.ResetCycle.Daily, START_AT);
    at(env, boundary - 1n);
    expect((await claim(session, '[attendance_cycle]')).code).toBe(E.CORE_ERROR_ATTENDANCE_ALREADY_CLAIMED);
    expect(await balance(env, session, GOLD)).toBe(10n);
    expect(await progress_of(env, session, '[attendance_cycle]')).toMatchObject({ day: 1, claimed_day_number: day_number(env, START_AT) });

    at(env, boundary);
    const next = await claim(session, '[attendance_cycle]');
    expect(next.code).toBe(0);
    expect(ok(next).day).toBe(2);
    expect(await balance(env, session, GOLD)).toBe(30n);
    expect(await progress_of(env, session, '[attendance_cycle]')).toMatchObject({ day: 2, claimed_day_number: day_number(env, boundary) });
  });

  it('starts Cycle at 1 after day N', async () => {
    env = await start();
    const session = await user(env);
    expect(await days_claimed(env, session, '[attendance_cycle]', 5, START_AT)).toEqual([1, 2, 3, 1, 2]);
    expect(await balance(env, session, GOLD)).toBe(10n + 20n + 30n + 10n + 20n);
  });

  it('answers ATTENDANCE_COMPLETED for Once after day N and keeps progress and balance', async () => {
    env = await start();
    const session = await user(env);
    expect(await days_claimed(env, session, '[attendance_once]', 3, START_AT)).toEqual([1, 2, 3]);
    for (const time of [START_AT + 3n * DAY_MS, START_AT + 10n * DAY_MS]) {
      at(env, time);
      const done = await claim(session, '[attendance_once]');
      expect(done.code).toBe(E.CORE_ERROR_ATTENDANCE_COMPLETED);
      expect(done.envelope.item_changes).toEqual([]);
    }
    expect(await balance(env, session, GOLD)).toBe(60n);
    expect(await progress_of(env, session, '[attendance_once]')).toMatchObject({ day: 3, claimed_day_number: day_number(env, START_AT + 2n * DAY_MS) });
  });

  it('starts Streak at 1 after a skipped game day, and starts it at 1 after day N', async () => {
    env = await start();
    const session = await user(env);
    expect(await days_claimed(env, session, '[attendance_streak]', 2, START_AT)).toEqual([1, 2]);
    // Game day START + 2 is skipped.
    expect(await days_claimed(env, session, '[attendance_streak]', 4, START_AT + 3n * DAY_MS)).toEqual([1, 2, 3, 1]);
    const skipped = await progress_of(env, session, '[attendance_streak]');
    expect(skipped).toMatchObject({ day: 1, claimed_day_number: day_number(env, START_AT + 6n * DAY_MS) });
  });

  it('keeps Cycle and Once progress over skipped game days', async () => {
    env = await start();
    const session = await user(env);
    // The clock only moves forward: the Once calendar starts after the Cycle calendar's claims.
    for (const [calendar, from] of [['[attendance_cycle]', START_AT], ['[attendance_once]', START_AT + 20n * DAY_MS]] as const) {
      expect(await days_claimed(env, session, calendar, 1, from)).toEqual([1]);
      expect(await days_claimed(env, session, calendar, 1, from + 3n * DAY_MS)).toEqual([2]);
      expect(await days_claimed(env, session, calendar, 1, from + 9n * DAY_MS)).toEqual([3]);
    }
  });

  it('starts a Monthly reset calendar at day 1 on the first claim after the game month boundary', async () => {
    // 2027-03-30T01:00:00Z: two game days before the game month boundary of April.
    const march_30 = START_AT + 29n * DAY_MS;
    env = await start({ start_at: march_30 });
    const session = await user(env);
    const boundary = env.core['server-time'].get_next_reset(GameData.ResetCycle.Monthly, march_30);
    expect(day_number(env, boundary) - day_number(env, march_30)).toBe(2n);

    expect(await days_claimed(env, session, '[attendance_monthly]', 1, march_30)).toEqual([1]);
    const first = await progress_of(env, session, '[attendance_monthly]');
    expect(first).toMatchObject({ day: 1, reset_at: boundary });
    at(env, boundary - 1n);
    expect(ok(await claim(session, '[attendance_monthly]')).day).toBe(2);

    at(env, boundary);
    const reset = await claim(session, '[attendance_monthly]');
    expect(reset.code).toBe(0);
    expect(ok(reset).day).toBe(1);
    const next_boundary = env.core['server-time'].get_next_reset(GameData.ResetCycle.Monthly, boundary);
    expect(await progress_of(env, session, '[attendance_monthly]')).toMatchObject({ day: 1, claimed_day_number: day_number(env, boundary), reset_at: next_boundary });
  });

  it('answers INVALID_REQUEST for a calendar ID value not in attendance_calendar and keeps progress and balance', async () => {
    env = await start();
    const session = await user(env);
    expect((await claim(session, '[attendance_cycle]')).code).toBe(0);
    const before = await progress(env, session);

    const ids = calendar_ids();
    for (const calendar_id of [0, Math.max(...ids) + 1000, -1]) {
      const result = await claim(session, calendar_id);
      expect(result.code).toBe(E.CORE_ERROR_INVALID_REQUEST);
      expect(result.response).toBeNull();
      expect(result.envelope.item_changes).toEqual([]);
    }
    expect(await progress(env, session)).toEqual(before);
    expect(await balance(env, session, GOLD)).toBe(10n);
  });

  it('applies a ClaimAttendance sent again with the same request ID once', async () => {
    env = await start();
    const session = await user(env);
    const request_id = '2b8f6c1e-5d4a-4f3b-9e2d-7a1c0b9d8e01';
    const first = await claim(session, '[attendance_cycle]', request_id);
    expect(first.code).toBe(0);
    const again = await claim(session, '[attendance_cycle]', request_id);
    expect(again.code).toBe(0);
    expect(ok(again).day).toBe(1);
    expect(pairs(ok(again).items)).toEqual(pairs(ok(first).items));
    expect(await balance(env, session, GOLD)).toBe(10n);
    expect(await progress_of(env, session, '[attendance_cycle]')).toMatchObject({ day: 1 });

    // On the next game day, inside the response retention, the same request ID still answers the stored response
    // instead of claiming day 2.
    at(env, env.core['server-time'].get_next_reset(GameData.ResetCycle.Daily, START_AT));
    const later = await claim(session, '[attendance_cycle]', request_id);
    expect(ok(later).day).toBe(1);
    expect(await balance(env, session, GOLD)).toBe(10n);
  });
});

/** Every calendar ID value of the core test data. */
function calendar_ids(): number[] {
  return [
    '[attendance_cycle]', '[attendance_once]', '[attendance_streak]', '[attendance_monthly]', '[attendance_event_once]',
    '[attendance_event_cycle]', '[attendance_window]', '[attendance_locked]', '[attendance_gem_daily]', '[attendance_extra]',
  ].map(id_of);
}
