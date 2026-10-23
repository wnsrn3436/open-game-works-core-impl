/** The data checks of `play-session` `## data` (`src/checks/play-session.ts`): every rule makes its ERROR line. */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';
import { fixture, lines, run, table } from './helpers.ts';

const SPEC_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'core-spec');
const PLAY_SESSION = JSON.parse(readFileSync(join(SPEC_DIR, 'play-session.json'), 'utf8')) as Record<string, unknown> & { name: string };
const MODE = ['id|id(key)|All', 'min_duration|duration|Server', 'max_duration|duration|All', 'max_continue_count|int|All'];

/** `[timed]` is data line 5 and `[instant]` line 6. */
function check(edit: (rows: string[][]) => void = () => {}, modules: string[] = ['play-session']): ReturnType<typeof run> {
  const rows = [
    ['[timed]', '10s', '10m', '2'],
    ['[instant]', '0s', '10m', '0'],
  ];
  edit(rows);
  return run(fixture({
    files: { 'data/tables/play_session_mode.csv': table(MODE, rows) },
    settings: { sourceLanguage: 'en', supportedLanguages: ['en'] },
    coreSpec: { version: '0.0.0', modules: [PLAY_SESSION] },
    modules,
  }));
}

function at(r: ReturnType<typeof run>, code: string): string[] {
  return lines(r, code).map((l) => l.split(' ').slice(0, 3).join(' '));
}

function errors(r: ReturnType<typeof run>): string[] {
  return r.stdout.filter((l) => l.split(' ')[1] === 'ERROR');
}

describe('play-session data check', () => {
  test('the base data has no ERROR line', () => {
    const r = check();
    expect(errors(r)).toEqual([]);
    expect(r.code).toBe(0);
  });

  test('max_duration of 0 is out_of_range', () => {
    const r = check((rows) => {
      rows[1] = ['[instant]', '0s', '0s', '0'];
    });
    expect(at(r, 'out_of_range')).toEqual(expect.arrayContaining(['data/tables/play_session_mode.csv:6:3 ERROR out_of_range']));
    expect(r.code).not.toBe(0);
  });

  test('min_duration equal to max_duration is out_of_range', () => {
    const r = check((rows) => {
      rows[0] = ['[timed]', '10m', '10m', '2'];
    });
    expect(at(r, 'out_of_range')).toEqual(['data/tables/play_session_mode.csv:5:2 ERROR out_of_range']);
    expect(r.code).not.toBe(0);
  });

  test('min_duration over max_duration is out_of_range', () => {
    const r = check((rows) => {
      rows[0] = ['[timed]', '11m', '10m', '2'];
    });
    expect(at(r, 'out_of_range')).toEqual(['data/tables/play_session_mode.csv:5:2 ERROR out_of_range']);
  });

  test('a negative max_continue_count is out_of_range', () => {
    const r = check((rows) => {
      rows[0] = ['[timed]', '10s', '10m', '-1'];
    });
    expect(at(r, 'out_of_range')).toEqual(['data/tables/play_session_mode.csv:5:4 ERROR out_of_range']);
    expect(r.code).not.toBe(0);
  });

  test('a game without play-session is not checked', () => {
    const r = check((rows) => {
      rows[0] = ['[timed]', '11m', '10m', '-1'];
    }, []);
    expect(at(r, 'out_of_range')).toEqual([]);
  });
});
