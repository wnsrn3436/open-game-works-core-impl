/** The data checks of `reset-counter` `## data` (`src/checks/reset-counter.ts`): every rule makes its ERROR line. */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';
import { fixture, lines, run, table } from './helpers.ts';

const SPEC_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'core-spec');

function spec(name: string): Record<string, unknown> & { name: string } {
  return JSON.parse(readFileSync(join(SPEC_DIR, `${name}.json`), 'utf8')) as Record<string, unknown> & { name: string };
}

const COLUMNS = ['id|id(key)|All', 'limit|long?|All', 'reset|enum<ResetCycle>?|All'];
const MAX = '9007199254740991';

function check(rows: string[][]): ReturnType<typeof run> {
  return run(fixture({
    files: { 'data/tables/reset_counter.csv': table(COLUMNS, rows) },
    settings: { sourceLanguage: 'en', supportedLanguages: ['en'] },
    coreSpec: { version: '0.0.0', modules: [spec('reset-counter'), spec('server-time')] },
    modules: ['reset-counter', 'server-time'],
  }));
}

/** `<file>:<line>:<col> <severity> <code>` of every line of a code. */
function at(r: ReturnType<typeof run>, code: string): string[] {
  return lines(r, code).map((l) => l.split(' ').slice(0, 3).join(' '));
}

function errors(r: ReturnType<typeof run>): string[] {
  return r.stdout.filter((l) => l.split(' ')[1] === 'ERROR');
}

describe('reset-counter data check', () => {
  test('a null limit, a limit of 1 and of 2^53-1 have no ERROR line', () => {
    const r = check([['[a]', 'null', 'Daily'], ['[b]', '1', 'null'], ['[c]', MAX, 'Monthly']]);
    expect(errors(r)).toEqual([]);
    expect(r.code).toBe(0);
  });

  test('a limit of 0, a negative limit and a limit over 2^53-1 are out_of_range', () => {
    const r = check([['[a]', '0', 'Daily'], ['[b]', '-1', 'Weekly'], ['[c]', '9007199254740992', 'null'], ['[d]', '3', 'Daily']]);
    expect(at(r, 'out_of_range')).toEqual([
      'data/tables/reset_counter.csv:5:2 ERROR out_of_range',
      'data/tables/reset_counter.csv:6:2 ERROR out_of_range',
      'data/tables/reset_counter.csv:7:2 ERROR out_of_range',
    ]);
    expect(r.code).toBe(1);
  });

  test('a game that does not use reset-counter has no reset-counter check', () => {
    const r = run(fixture({
      files: { 'data/tables/reset_counter.csv': table(COLUMNS, [['[a]', '0', 'Daily']]) },
      settings: { sourceLanguage: 'en', supportedLanguages: ['en'] },
      coreSpec: { version: '0.0.0', modules: [spec('reset-counter'), spec('server-time')] },
      modules: ['server-time'],
    }));
    expect(lines(r, 'out_of_range')).toEqual([]);
  });
});
