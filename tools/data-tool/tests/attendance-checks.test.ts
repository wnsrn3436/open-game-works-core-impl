/**
 * The data rules of `attendance` `## data`: the data check of `src/checks/attendance.ts` and the invariants of
 * `attendance_reward` and `attendance_calendar`. Every rule makes its ERROR line, so the binary build fails and the
 * server does not start with that data.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';
import { fixture, run, table } from './helpers.ts';

const SPEC_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'core-spec');
const MODULES = ['attendance', 'item-ledger', 'mailbox', 'live-event', 'validation', 'storage', 'server-time', 'logging'];

function spec(name: string): Record<string, unknown> & { name: string } {
  return JSON.parse(readFileSync(join(SPEC_DIR, `${name}.json`), 'utf8')) as Record<string, unknown> & { name: string };
}

const ITEM = ['id|id(key)|All', 'name|tstring<id>|Client', 'type|enum<ItemType>|All', 'max_amount|long|All', 'overflow|enum<ItemOverflow>|All'];
const CALENDAR = [
  'id|id(key)|All', 'name|tstring<id>|Client', 'mode|enum<AttendanceMode>|All', 'reset|enum<ResetCycle>?|All', 'requirement|requirement|All',
  'start_at|datetime?|All', 'end_at|datetime?|All', 'live_event|ref<live_event.id>?|All',
];
const REWARD = ['id|id|All', 'day|int|All', 'reward|array<{item_id: ref<item.id>, amount: long}>|All', 'extra_grant|bool|All'];
const REWARD_FILE = 'data/tables/attendance_reward.csv';
const CALENDAR_FILE = 'data/tables/attendance_calendar.csv';

function check(calendars: string[][], rewards: string[][], modules: string[] = MODULES): ReturnType<typeof run> {
  return run(fixture({
    files: {
      'data/tables/item.csv': table(ITEM, [['[gold]', '', 'Currency', '1000', 'Reject']]),
      [CALENDAR_FILE]: table(CALENDAR, calendars),
      [REWARD_FILE]: table(REWARD, rewards),
    },
    settings: { sourceLanguage: 'en', supportedLanguages: ['en'] },
    coreSpec: { version: '0.0.0', modules: MODULES.map(spec) },
    modules,
  }));
}

const calendar = (id: string): string[] => [id, '', 'Cycle', 'null', '', 'null', 'null', 'null'];

/** `<file>:<line>:<col> <severity> <code>` of the ERROR lines about the attendance tables. */
function attendance_errors(r: ReturnType<typeof run>): string[] {
  return r.stdout
    .map((l) => l.split(' ').slice(0, 3).join(' '))
    .filter((l) => l.split(' ')[1] === 'ERROR' && (l.startsWith(REWARD_FILE) || l.startsWith(CALENDAR_FILE)));
}

describe('attendance data check', () => {
  test('rows with a reward, rows with only extra_grant, and days 1 to N of each calendar have no ERROR line', () => {
    const r = check([calendar('[a]'), calendar('[b]')], [
      ['[a]', '1', '[gold] 10', 'false'],
      ['[a]', '2', '', 'true'],
      ['[a]', '3', '[gold] 5', 'true'],
      ['[b]', '1', '[gold] 1', 'false'],
    ]);
    expect(attendance_errors(r)).toEqual([]);
  });

  test('a row with an empty reward and extra_grant false is out_of_range', () => {
    const r = check([calendar('[a]')], [
      ['[a]', '1', '[gold] 10', 'false'],
      ['[a]', '2', '', 'false'],
    ]);
    expect(attendance_errors(r)).toEqual([`${REWARD_FILE}:6:3 ERROR out_of_range`]);
    expect(r.code).toBe(1);
  });

  test('days of a calendar that are not 1 to N without gaps are order', () => {
    const gap = check([calendar('[a]')], [
      ['[a]', '1', '[gold] 10', 'false'],
      ['[a]', '3', '[gold] 10', 'false'],
    ]);
    expect(attendance_errors(gap).map((l) => l.split(' ').slice(1).join(' '))).toContain('ERROR order');
    expect(gap.code).toBe(1);
    const twice = check([calendar('[a]')], [
      ['[a]', '1', '[gold] 10', 'false'],
      ['[a]', '1', '[gold] 20', 'false'],
    ]);
    expect(attendance_errors(twice).map((l) => l.split(' ').slice(1).join(' '))).toContain('ERROR order');
  });

  test('a calendar without a day and a day of no calendar are required_missing', () => {
    const r = check([calendar('[a]'), calendar('[b]')], [
      ['[a]', '1', '[gold] 10', 'false'],
    ]);
    expect(attendance_errors(r)).toEqual([`${CALENDAR_FILE}:6:1 ERROR required_missing`]);
    expect(r.code).toBe(1);

    const orphan = check([calendar('[a]')], [
      ['[a]', '1', '[gold] 10', 'false'],
      ['[c]', '1', '[gold] 10', 'false'],
    ]);
    expect(orphan.stdout.some((l) => l.startsWith(`${REWARD_FILE}:6:`) && l.split(' ')[1] === 'ERROR')).toBe(true);
    expect(orphan.code).toBe(1);
  });

  test('a game that does not use attendance has no attendance check', () => {
    const r = check([calendar('[a]')], [['[a]', '1', '', 'false']], MODULES.filter((m) => m !== 'attendance'));
    expect(r.stdout.filter((l) => l.startsWith(REWARD_FILE) && l.split(' ')[2] === 'out_of_range')).toEqual([]);
  });
});
