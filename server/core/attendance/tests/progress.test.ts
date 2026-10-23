import * as CoreContract from '../../../generated/contract/core_contract.ts';
import * as Testing from '../../testing/dev/index.ts';
import { START_AT, at, day_number, id_of, progress_of, put_progress, run, start, stop, user, type Env } from './helpers.ts';

/** A case of the core test fixture `attendance-progress`. */
interface ProgressCase {
  readonly name: string;
  readonly input: {
    /** The `attendance_calendar` ID name. */
    readonly calendar: string;
    /** N: the day count of the calendar. */
    readonly day_count: number;
    /** The `live_event` ID name of the calendar, or null. */
    readonly live_event: string | null;
    /** The `AttendanceUserState` row before the call (`id` as the calendar ID name), or null for no row. */
    readonly state: { id: string; day: number; claimed_day_number: number; reset_at: number; event_round: number } | null;
    /** The request time. Unix ms. */
    readonly time: number;
  };
  readonly expected: { readonly day: number; readonly next_day: number };
}

function cases(): ProgressCase[] {
  const bytes = Testing.read_core_fixture('attendance-progress');
  return (JSON.parse(Buffer.from(bytes).toString('utf8')) as { cases: ProgressCase[] }).cases;
}

describe('get_attendance', () => {
  let env: Env;
  beforeAll(async () => {
    env = await start();
  });
  afterAll(async () => {
    await stop(env);
  });

  it('matches every case of the core test fixture attendance-progress', async () => {
    const { data } = Testing.load_data();
    const all = cases();
    expect(all.length).toBeGreaterThan(0);
    for (const c of all) {
      const calendar_id = id_of(c.input.calendar);
      const row = data.AttendanceCalendarTable.get_row(calendar_id);
      expect(data.AttendanceRewardTable.get_rows(calendar_id).length, c.name).toBe(c.input.day_count);
      expect(row.live_event, c.name).toBe(c.input.live_event === null ? 0 : id_of(c.input.live_event));

      at(env, BigInt(c.input.time));
      const session = await user(env);
      const state = c.input.state;
      if (state !== null) {
        const value = new CoreContract.AttendanceUserState();
        value.id = BigInt(id_of(state.id));
        value.day = state.day;
        value.claimed_day_number = BigInt(state.claimed_day_number);
        value.reset_at = BigInt(state.reset_at);
        value.event_round = state.event_round;
        await run(env, session, (ctx) => {
          put_progress(env, ctx, value);
        });
      }
      const got = await run(env, session, (ctx) => {
        expect(ctx.request_time, c.name).toBe(BigInt(c.input.time));
        return env.core.attendance.get_attendance(ctx, calendar_id);
      });
      expect({ name: c.name, ...got }).toEqual({ name: c.name, ...c.expected });
    }
  });

  it('answers (0, 0) for an unknown calendar ID value and writes nothing for a progress it reads as reset', async () => {
    at(env, START_AT);
    const session = await user(env);
    const value = new CoreContract.AttendanceUserState();
    value.id = BigInt(id_of('[attendance_monthly]'));
    value.day = 2;
    value.claimed_day_number = day_number(env, START_AT) - 1n;
    value.reset_at = START_AT - 1n;
    await run(env, session, (ctx) => {
      put_progress(env, ctx, value);
    });
    const before = await Testing.read_user_state(env.server, session.user_id);

    expect(await run(env, session, (ctx) => env.core.attendance.get_attendance(ctx, 0))).toEqual({ day: 0, next_day: 0 });
    const read = await run(env, session, (ctx) => env.core.attendance.get_attendance(ctx, id_of('[attendance_monthly]')));
    expect(read).toEqual({ day: 0, next_day: 1 });
    expect(await Testing.read_user_state(env.server, session.user_id)).toEqual(before);
    expect(await progress_of(env, session, '[attendance_monthly]')).toMatchObject({ day: 2, reset_at: START_AT - 1n });
  });
});
