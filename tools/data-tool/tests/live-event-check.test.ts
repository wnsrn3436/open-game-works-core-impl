/** The data check of `live-event` (`src/checks/live-event.ts`): a row that breaks a rule makes an ERROR line. */
import { cpSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { fixture, lines, run, specModule, specTable, table, writeFiles, type Fixture } from './helpers.ts';

const COLUMNS = ['id|id(key)|All', 'name|tstring<id>|Client', 'start_at|datetime|All', 'end_at|datetime|All', 'repeat|duration?|All', 'repeat_until|datetime?|All', 'settle|bool|Server'];
const SPEC = { version: '1.0.0', modules: [specModule({ name: 'live-event', tables: [specTable('live_event', COLUMNS)] })] };

type EventRow = [id: string, start: string, end: string, repeat: string, until: string];

function events(rows: EventRow[]): string {
  return table(COLUMNS, rows.map(([id, start, end, repeat, until]) => [id, '', start, end, repeat, until, 'true']));
}

function game(rows: EventRow[]): Fixture {
  return fixture({ coreSpec: SPEC, modules: ['live-event'], files: { 'data/tables/live_event.csv': events(rows) } });
}

/** `<place> <severity> <code> <message>` without the message, for the lines of a code. */
function at(r: ReturnType<typeof run>, code: string): string[] {
  return lines(r, code).map((l) => l.split(' ').slice(0, 3).join(' '));
}

const FILE = 'data/tables/live_event.csv';

describe('live_event rules', () => {
  test('valid rows make no line', () => {
    const r = run(game([
      ['[once]', '2027-01-01T00:00:00Z', '2027-01-02T00:00:00Z', 'null', 'null'],
      ['[weekly]', '2027-01-01T00:00:00Z', '2027-01-02T00:00:00Z', '7d', '2027-01-22T00:00:00Z'],
      ['[back_to_back]', '2027-01-01T00:00:00Z', '2027-01-02T00:00:00Z', '1d', 'null'],
    ]));
    expect(at(r, 'out_of_range')).toEqual([]);
    expect(r.code).toBe(0);
  });

  test('end_at that is not after start_at', () => {
    const r = run(game([
      ['[same]', '2027-01-01T00:00:00Z', '2027-01-01T00:00:00Z', 'null', 'null'],
      ['[before]', '2027-01-02T00:00:00Z', '2027-01-01T00:00:00Z', 'null', 'null'],
    ]));
    expect(at(r, 'out_of_range')).toEqual([`${FILE}:5:4 ERROR out_of_range`, `${FILE}:6:4 ERROR out_of_range`]);
    expect(r.code).toBe(1);
  });

  test('repeat shorter than end_at - start_at', () => {
    const r = run(game([['[overlap]', '2027-01-01T00:00:00Z', '2027-01-02T00:00:00Z', '23h59m59s999ms', 'null']]));
    expect(at(r, 'out_of_range')).toEqual([`${FILE}:5:5 ERROR out_of_range`]);
    expect(r.code).toBe(1);
  });

  test('repeat_until without repeat', () => {
    const r = run(game([['[until_only]', '2027-01-01T00:00:00Z', '2027-01-02T00:00:00Z', 'null', '2027-02-01T00:00:00Z']]));
    expect(at(r, 'out_of_range')).toEqual([`${FILE}:5:6 ERROR out_of_range`]);
    expect(r.code).toBe(1);
  });

  test('repeat_until at or before start_at', () => {
    const r = run(game([
      ['[until_at_start]', '2027-01-01T00:00:00Z', '2027-01-02T00:00:00Z', '7d', '2027-01-01T00:00:00Z'],
      ['[until_before]', '2027-01-01T00:00:00Z', '2027-01-02T00:00:00Z', '7d', '2026-12-31T00:00:00Z'],
    ]));
    expect(at(r, 'out_of_range')).toEqual([`${FILE}:5:6 ERROR out_of_range`, `${FILE}:6:6 ERROR out_of_range`]);
    expect(r.code).toBe(1);
  });
});

describe('live_event rows of the PROD data tag data', () => {
  /** A `--previous` folder whose `live_event` has these rows, after a binary build. */
  function previous(f: Fixture, rows: EventRow[]): string {
    const dir = join(f.root, 'previous');
    cpSync(f.game, dir, { recursive: true });
    writeFiles(dir, { 'data/tables/live_event.csv': events(rows) });
    expect(run({ ...f, game: dir }).code).toBe(0);
    return dir;
  }

  // Started: start_at is before the check time. Not started: start_at is far after it.
  const STARTED: EventRow = ['[started]', '2020-01-01T00:00:00Z', '2020-01-02T00:00:00Z', '7d', '2020-03-01T00:00:00Z'];
  const FUTURE: EventRow = ['[future]', '2999-01-01T00:00:00Z', '2999-01-02T00:00:00Z', '7d', '2999-03-01T00:00:00Z'];

  test('a started row keeps start_at, repeat and repeat_until, and may move end_at earlier only', () => {
    const f = game([STARTED, FUTURE]);
    const prev = previous(f, [STARTED, FUTURE]);
    writeFiles(f.game, { 'data/tables/live_event.csv': events([
      ['[started]', '2020-01-01T00:00:00Z', '2020-01-01T12:00:00Z', '7d', '2020-03-01T00:00:00Z'],
      ['[future]', '2999-02-01T00:00:00Z', '2999-02-02T00:00:00Z', '1d', 'null'],
    ]) });
    const r = run(f, ['--previous', prev]);
    expect(at(r, 'prod_change')).toEqual([]);
  });

  test('a started row whose start_at, repeat, repeat_until change or whose end_at moves later', () => {
    const f = game([STARTED]);
    const prev = previous(f, [STARTED]);
    writeFiles(f.game, { 'data/tables/live_event.csv': events([['[started]', '2020-01-01T01:00:00Z', '2020-01-03T00:00:00Z', '14d', '2020-04-01T00:00:00Z']]) });
    const r = run(f, ['--previous', prev]);
    expect(at(r, 'prod_change')).toEqual([`${FILE}:5:3 ERROR prod_change`, `${FILE}:5:4 ERROR prod_change`, `${FILE}:5:5 ERROR prod_change`, `${FILE}:5:6 ERROR prod_change`]);
    expect(r.code).toBe(1);
  });

  test('a started row whose repeat becomes null', () => {
    const f = game([STARTED]);
    const prev = previous(f, [STARTED]);
    writeFiles(f.game, { 'data/tables/live_event.csv': events([['[started]', '2020-01-01T00:00:00Z', '2020-01-02T00:00:00Z', 'null', 'null']]) });
    const r = run(f, ['--previous', prev]);
    expect(at(r, 'prod_change')).toEqual([`${FILE}:5:5 ERROR prod_change`, `${FILE}:5:6 ERROR prod_change`]);
    expect(r.code).toBe(1);
  });
});
