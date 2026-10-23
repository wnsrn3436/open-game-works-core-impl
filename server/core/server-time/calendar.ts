/**
 * Game day and `ResetCycle` arithmetic (`server-time` `## behavior` game day and `ResetCycle`). Every value is
 * `bigint`; o is game settings `dailyResetOffsetMs`.
 */

export const DAY_MS = 86_400_000n;

export type Cycle = 'Daily' | 'Weekly' | 'Monthly';

function floor_div(a: bigint, b: bigint): bigint {
  const q = a / b;
  return a % b !== 0n && a < 0n !== b < 0n ? q - 1n : q;
}

/** The UTC year and month of day number `z` (days since 1970-01-01). */
function civil_from_days(day: bigint): { year: bigint; month: bigint } {
  const z = day + 719_468n;
  const era = floor_div(z, 146_097n);
  const doe = z - era * 146_097n;
  const yoe = (doe - doe / 1_460n + doe / 36_524n - doe / 146_096n) / 365n;
  const doy = doe - (365n * yoe + yoe / 4n - yoe / 100n);
  const mp = (5n * doy + 2n) / 153n;
  const month = mp < 10n ? mp + 3n : mp - 9n;
  return { year: yoe + era * 400n + (month <= 2n ? 1n : 0n), month };
}

/** The day number (days since 1970-01-01) of the UTC date `year`-`month`-01. */
function days_from_civil(year: bigint, month: bigint): bigint {
  const y = month <= 2n ? year - 1n : year;
  const era = floor_div(y, 400n);
  const yoe = y - era * 400n;
  const doy = (153n * (month > 2n ? month - 3n : month + 9n) + 2n) / 5n;
  const doe = yoe * 365n + yoe / 4n - yoe / 100n + doy;
  return era * 146_097n + doe - 719_468n;
}

/** ⌊(t − o) ÷ 1 day⌋. */
export function day_number(offset_ms: bigint, time: bigint): bigint {
  return floor_div(time - offset_ms, DAY_MS);
}

/** The first game day of the period that holds game day `day`, and the first game day of the next period. */
function period_days(cycle: Cycle, day: bigint): { first: bigint; next: bigint } {
  if (cycle === 'Daily') return { first: day, next: day + 1n };
  if (cycle === 'Weekly') {
    // Game day 0 is a Thursday (1970-01-01), so Mondays are the days d with (d + 3) mod 7 = 0.
    const first = floor_div(day + 3n, 7n) * 7n - 3n;
    return { first, next: first + 7n };
  }
  const { year, month } = civil_from_days(day);
  return { first: days_from_civil(year, month), next: month === 12n ? days_from_civil(year + 1n, 1n) : days_from_civil(year, month + 1n) };
}

/** The start time of the period that holds `time`. */
export function period_start(offset_ms: bigint, cycle: Cycle, time: bigint): bigint {
  return period_days(cycle, day_number(offset_ms, time)).first * DAY_MS + offset_ms;
}

/** The start time of the period after the one that holds `time`. */
export function next_reset(offset_ms: bigint, cycle: Cycle, time: bigint): bigint {
  return period_days(cycle, day_number(offset_ms, time)).next * DAY_MS + offset_ms;
}

/** The number of the period that holds `time`; two adjacent periods differ by 1. */
export function period_number(offset_ms: bigint, cycle: Cycle, time: bigint): bigint {
  const day = day_number(offset_ms, time);
  if (cycle === 'Daily') return day;
  if (cycle === 'Weekly') return floor_div(day + 3n, 7n);
  const { year, month } = civil_from_days(day);
  return (year - 1970n) * 12n + (month - 1n);
}

/** The window start of the fixed window of length `length_ms` that holds `time`: ⌊t ÷ L⌋ × L. */
export function window_start(length_ms: bigint, time: bigint): bigint {
  return floor_div(time, length_ms) * length_ms;
}
