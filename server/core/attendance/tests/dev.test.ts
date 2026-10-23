import * as GameData from '../../../generated/data/game_data.ts';
import * as Testing from '../../testing/dev/index.ts';
import { DAY0, DAY_MS, START_AT, claim, day_number, id_of, ok, progress, progress_of, start, stop, user, type Env } from './helpers.ts';

function set_attendance(env: Env, user_id: bigint, calendar: string | number, day: number, claimed_day_number: bigint): Promise<unknown> {
  const calendar_id = typeof calendar === 'number' ? calendar : id_of(calendar);
  return Testing.call_dev(env.server, 'attendance', 'set_attendance', [calendar_id, day, claimed_day_number], user_id);
}

describe('set_attendance', () => {
  let env: Env | undefined;
  afterEach(async () => {
    await stop(env);
    env = undefined;
  });

  it('sets the progress to the values in DEV, with reset_at and event_round of claim step 8, and the next claim follows it', async () => {
    env = await start();
    const session = await user(env);
    const today = day_number(env, START_AT);

    expect(await set_attendance(env, session.user_id, '[attendance_cycle]', 2, today - 1n)).toBeNull();
    expect(await progress_of(env, session, '[attendance_cycle]')).toMatchObject({ day: 2, claimed_day_number: today - 1n, reset_at: 0n, event_round: 0 });
    const next = await claim(session, '[attendance_cycle]');
    expect(ok(next).day).toBe(3);

    // A smaller day too, and without looking at the active window or the requirement.
    await set_attendance(env, session.user_id, '[attendance_cycle]', 1, today);
    expect(await progress_of(env, session, '[attendance_cycle]')).toMatchObject({ day: 1, claimed_day_number: today });
    await set_attendance(env, session.user_id, '[attendance_locked]', 1, 0n);
    await set_attendance(env, session.user_id, '[attendance_window]', 1, today);
    expect(await progress_of(env, session, '[attendance_locked]')).toMatchObject({ day: 1, claimed_day_number: 0n });
    expect(await progress_of(env, session, '[attendance_window]')).toMatchObject({ day: 1, claimed_day_number: today });

    const monthly_reset = env.core['server-time'].get_next_reset(GameData.ResetCycle.Monthly, START_AT);
    await set_attendance(env, session.user_id, '[attendance_monthly]', 5, today);
    expect(await progress_of(env, session, '[attendance_monthly]')).toMatchObject({ day: 5, reset_at: monthly_reset, event_round: 0 });
    await set_attendance(env, session.user_id, '[attendance_event_once]', 3, today);
    expect(await progress_of(env, session, '[attendance_event_once]')).toMatchObject({ day: 3, event_round: 1 });
  });

  it('deletes the row for day 0', async () => {
    env = await start();
    const session = await user(env);
    expect((await claim(session, '[attendance_cycle]')).code).toBe(0);
    await set_attendance(env, session.user_id, '[attendance_cycle]', 0, 0n);
    expect(await progress_of(env, session, '[attendance_cycle]')).toBeNull();
    // The calendar starts again at day 1 the next game day.
    Testing.set_time(env.server, DAY0 + DAY_MS);
    expect(ok(await claim(session, '[attendance_cycle]')).day).toBe(1);
  });

  it('throws for an unknown calendar, a day below 0 or over N and a claimed_day_number below 0, and changes nothing', async () => {
    env = await start();
    const session = await user(env);
    const today = day_number(env, START_AT);
    expect((await claim(session, '[attendance_cycle]')).code).toBe(0);
    const before = await progress(env, session);

    await expect(set_attendance(env, session.user_id, 0, 1, today)).rejects.toThrow();
    await expect(set_attendance(env, session.user_id, id_of('[attendance_cycle]') + 100_000, 1, today)).rejects.toThrow();
    await expect(set_attendance(env, session.user_id, '[attendance_cycle]', -1, today)).rejects.toThrow();
    await expect(set_attendance(env, session.user_id, '[attendance_cycle]', 4, today)).rejects.toThrow();
    await expect(set_attendance(env, session.user_id, '[attendance_cycle]', 1.5, today)).rejects.toThrow();
    await expect(set_attendance(env, session.user_id, '[attendance_cycle]', 2, -1n)).rejects.toThrow();
    expect(await progress(env, session)).toEqual(before);
  });

  it('is not in a STG server instance', async () => {
    env = await start({ environment: 'STG' });
    expect('set_attendance' in env.core.attendance).toBe(false);
    await expect(Testing.call_dev(env.server, 'attendance', 'set_attendance', [id_of('[attendance_cycle]'), 1, 0n])).rejects.toThrow();
  });
});
