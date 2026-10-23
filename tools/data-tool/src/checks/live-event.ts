/**
 * Data check of `live-event` (its spec `## data`): the schedule rules of each `live_event` row, and the schedule
 * of a row of the PROD data tag data that has started, which the data must keep.
 */
import type { Place } from '../diag.ts';
import type { ModuleCheck, ModuleCheckInput } from '../module-check.ts';
import { cellPlace, cellText, column, rowPlace, type Row, type Table } from '../model.ts';
import { parseDatetime, parseDuration } from '../values.ts';

const TABLE = 'live_event';

/** A row's schedule; null fields are null cells. */
interface Schedule {
  start: bigint | null;
  end: bigint | null;
  repeat: bigint | null;
  until: bigint | null;
}

function built(row: Row, name: string): bigint | null {
  const v = row.values.get(name);
  return v?.k === 'int' ? v.v : null;
}

/** The schedule of a row of the PROD data tag data, which has no values: read from the cell text. */
function fromText(table: Table, row: Row): Schedule {
  const text = (name: string): string => {
    const col = column(table, name);
    return col === undefined ? 'null' : cellText(row, col);
  };
  return { start: parseDatetime(text('start_at')), end: parseDatetime(text('end_at')), repeat: parseDuration(text('repeat')), until: parseDatetime(text('repeat_until')) };
}

function idOf(table: Table, row: Row): string {
  const col = column(table, 'id');
  return col === undefined ? '' : cellText(row, col);
}

type Report = ModuleCheckInput['report'];
type PlaceOf = (row: Row, name: string) => Place;

/** The schedule rules of one row: `end_at` after `start_at`, rounds that do not overlap, `repeat_until`. */
function check_schedule(id: string, row: Row, s: Schedule, place: PlaceOf, report: Report): void {
  if (s.start !== null && s.end !== null && s.end <= s.start) {
    report('out_of_range', place(row, 'end_at'), `live_event ${id}: end_at is not after start_at`);
  }
  if (s.start !== null && s.end !== null && s.repeat !== null && s.repeat < s.end - s.start) {
    report('out_of_range', place(row, 'repeat'), `live_event ${id}: repeat is shorter than end_at - start_at, so rounds overlap`);
  }
  if (s.repeat === null && s.until !== null) {
    report('out_of_range', place(row, 'repeat_until'), `live_event ${id}: repeat_until is set while repeat is null`);
  }
  if (s.start !== null && s.until !== null && s.until <= s.start) {
    report('out_of_range', place(row, 'repeat_until'), `live_event ${id}: repeat_until is not after start_at`);
  }
}

/** A live event that has started in the PROD data tag keeps `start_at`, `repeat`, `repeat_until` and an `end_at` not later. */
function check_started(id: string, before: Schedule, current: { row: Row; s: Schedule }, place: PlaceOf, report: Report): void {
  const { row: nowRow, s } = current;
  for (const [name, a, b] of [['start_at', before.start, s.start], ['repeat', before.repeat, s.repeat], ['repeat_until', before.until, s.until]] as const) {
    if (a !== b) report('prod_change', place(nowRow, name), `live_event ${id} has started in the PROD data tag; ${name} changed`);
  }
  if (before.end !== null && s.end !== null && s.end > before.end) {
    report('prod_change', place(nowRow, 'end_at'), `live_event ${id} has started in the PROD data tag; end_at moved later`);
  }
}

export const check: ModuleCheck = (input) => {
  const { data, previous, report } = input;
  const table = data.tables.get(TABLE);
  if (table === undefined) return;
  const place: PlaceOf = (row, name) => {
    const col = column(table, name);
    return col === undefined ? rowPlace(table, row) : cellPlace(table, row, col);
  };
  const now = new Map<string, { row: Row; s: Schedule }>();
  for (const row of table.rows) {
    const id = idOf(table, row);
    const s: Schedule = { start: built(row, 'start_at'), end: built(row, 'end_at'), repeat: built(row, 'repeat'), until: built(row, 'repeat_until') };
    now.set(id, { row, s });
    check_schedule(id, row, s, place, report);
  }

  const prev = previous?.tables.get(TABLE);
  if (prev === undefined) return;
  const checkedAt = BigInt(Date.now());
  for (const row of prev.rows) {
    const id = idOf(prev, row);
    const before = fromText(prev, row);
    const current = now.get(id);
    if (current === undefined || before.start === null || before.start > checkedAt) continue;
    check_started(id, before, current, place, report);
  }
};
