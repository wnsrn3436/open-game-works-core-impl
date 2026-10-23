import type { RequestCtx } from '../../storage/index.ts';
import type { AttendanceModule } from '../index.ts';

/** The `## DEV` operations of `attendance`. */
export interface AttendanceDev {
  /**
   * Writes the progress row of the calendar as given, with `reset_at` and `event_round` by the rules of claim step 8.
   * A day of 0 deletes the row. An unknown calendar, a day below 0 or over N and a `claimed_day_number` below 0 throw.
   * The active window, the requirement and the hooks are not looked at.
   */
  set_attendance(ctx: RequestCtx, calendar_id: number, day: number, claimed_day_number: bigint): null;
}

export function create_attendance_dev(attendance: AttendanceModule): AttendanceDev {
  return {
    set_attendance(ctx, calendar_id, day, claimed_day_number) {
      const calendar = attendance.calendar_of(ctx, calendar_id);
      if (calendar === null) throw new RangeError(`attendance: set_attendance of an unknown calendar ${String(calendar_id)}`);
      const n = attendance.day_count(ctx, calendar);
      if (!Number.isSafeInteger(day) || day < 0 || day > n) {
        throw new RangeError(`attendance: set_attendance day ${String(day)} of calendar ${String(calendar_id)} is not 0 to ${String(n)}`);
      }
      // Content cheat code is not type checked against this signature, so the type is checked here.
      const claimed: unknown = claimed_day_number;
      if (typeof claimed !== 'bigint' || claimed < 0n) {
        throw new RangeError(`attendance: set_attendance claimed_day_number ${String(claimed)} is not a game day number of 0 or more`);
      }
      attendance.write_progress(ctx, calendar, day, claimed);
      return null;
    },
  };
}
