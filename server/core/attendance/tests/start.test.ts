import * as Testing from '../../testing/dev/index.ts';
import { claim, id_of, ok, start, stop, user, type Env } from './helpers.ts';

describe('server start with attendance', () => {
  let env: Env | undefined;
  afterEach(async () => {
    await stop(env);
    env = undefined;
  });

  it('fails with an error log when an attendance_reward row has extra_grant true and content registered no grant_attendance_extra', async () => {
    // Day 2 of `[attendance_extra]` in the core test data has extra_grant true.
    expect(Testing.load_data().data.AttendanceRewardTable.get_rows(id_of('[attendance_extra]')).some((row) => row.extra_grant)).toBe(true);
    const failure: unknown = await start({ except: ['attendance.grant_attendance_extra'] }).then(
      (started) => {
        env = started;
        return null;
      },
      (error: unknown) => error,
    );
    expect(failure).toBeInstanceOf(Testing.StartFailure);
    const { message, logs } = failure as Testing.StartFailure;
    expect(message).toMatch(/grant_attendance_extra/);
    // attendance's own error log line; routing logs the start failure reason as another line.
    const errors = logs.filter((line) => line.kind === 'error' && line.level === 'error' && 'calendar_ids' in line);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatchObject({ message: expect.stringMatching(/grant_attendance_extra/) as unknown, calendar_ids: [id_of('[attendance_extra]')] });
  });

  it('starts with extra_grant rows when content registered grant_attendance_extra', async () => {
    env = await start({ hooks: { grant_attendance_extra: () => 'pass' } });
    const session = await user(env);
    expect(ok(await claim(session, '[attendance_extra]')).day).toBe(1);
  });
});
