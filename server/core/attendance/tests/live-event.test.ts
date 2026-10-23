import { DAY0, DAY_MS, E, HOUR_MS, START_AT, amount, at, balance, claim, day_number, ok, pairs, progress_of, start, stop, user, type Env } from './helpers.ts';

const GOLD = '[attendance_gold]';

describe('ClaimAttendance of a calendar bound to a repeated live_event', () => {
  let env: Env | undefined;
  afterEach(async () => {
    await stop(env);
    env = undefined;
  });

  it('claims day 1 on the first claim of round 2 after a Once calendar reached day N in round 1', async () => {
    // `[attendance_event_long]`: round n runs from DAY0 + 7(n − 1) days for 3 days.
    env = await start();
    const session = await user(env);
    const days: number[] = [];
    for (let i = 0n; i < 3n; i += 1n) {
      at(env, START_AT + i * DAY_MS);
      const result = await claim(session, '[attendance_event_once]');
      expect(result.code).toBe(0);
      days.push(ok(result).day);
    }
    expect(days).toEqual([1, 2, 3]);
    expect(await progress_of(env, session, '[attendance_event_once]')).toMatchObject({ day: 3, event_round: 1 });

    // After round 1 ends, the calendar is out of its active window.
    at(env, DAY0 + 3n * DAY_MS);
    expect((await claim(session, '[attendance_event_once]')).code).toBe(E.CORE_ERROR_ATTENDANCE_UNAVAILABLE);

    const round_2 = DAY0 + 7n * DAY_MS + HOUR_MS;
    at(env, round_2);
    const result = await claim(session, '[attendance_event_once]');
    expect(result.code).toBe(0);
    expect(ok(result).day).toBe(1);
    expect(pairs(ok(result).items)).toEqual(pairs([amount(GOLD, 10n)]));
    expect(await progress_of(env, session, '[attendance_event_once]')).toMatchObject({ day: 1, claimed_day_number: day_number(env, round_2), event_round: 2 });
    expect(await balance(env, session, GOLD)).toBe(70n);
  });

  it('grants day 1 again in round 2 when round 2 starts on the game day of a round 1 claim', async () => {
    // `[attendance_event_half]`: round 1 is 00:00–12:00 and round 2 is 12:00–24:00 of DAY0.
    env = await start();
    const session = await user(env);
    const first = await claim(session, '[attendance_event_cycle]');
    expect(first.code).toBe(0);
    expect(ok(first).day).toBe(1);
    at(env, DAY0 + 11n * HOUR_MS);
    expect((await claim(session, '[attendance_event_cycle]')).code).toBe(E.CORE_ERROR_ATTENDANCE_ALREADY_CLAIMED);

    const round_2 = DAY0 + 13n * HOUR_MS;
    at(env, round_2);
    expect(day_number(env, round_2)).toBe(day_number(env, START_AT));
    const second = await claim(session, '[attendance_event_cycle]');
    expect(second.code).toBe(0);
    expect(ok(second).day).toBe(1);
    expect(ok(second).mailed).toBe(false);
    expect(ok(second).items).not.toEqual([]);
    expect(pairs(ok(second).items)).toEqual(pairs([amount(GOLD, 10n)]));
    expect(second.envelope.item_changes.map((change) => change.delta)).toEqual([10n]);
    expect(await balance(env, session, GOLD)).toBe(20n);
    expect(await progress_of(env, session, '[attendance_event_cycle]')).toMatchObject({ day: 1, claimed_day_number: day_number(env, round_2), event_round: 2 });
  });
});
