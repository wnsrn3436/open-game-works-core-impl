/** The data check of `PushCore` `## data` (`src/checks/PushCore.ts`): every rule makes its ERROR line. */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';
import { fixture, lines, run, table } from './helpers.ts';

const SPEC_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'core-spec');
const spec = (name: string): Record<string, unknown> => JSON.parse(readFileSync(join(SPEC_DIR, `${name}.json`), 'utf8')) as Record<string, unknown>;

const LOCAL_PUSH = ['id|id(key)|All', 'title|tstring<id>|Client', 'body|tstring<id>|Client', 'delay|duration?|Client'];

function check(rows: string[][], modules: string[] = ['PushCore']): ReturnType<typeof run> {
  return run(fixture({
    files: { 'data/tables/local_push.csv': table(LOCAL_PUSH, rows) },
    settings: { sourceLanguage: 'en', supportedLanguages: ['en'] },
    coreSpec: { version: '0.0.0', modules: [spec('PushCore')] },
    modules,
  }));
}

/** `<file>:<line>:<col> <severity> <code>` of every line of a code. */
function at(r: ReturnType<typeof run>, code: string): string[] {
  return lines(r, code).map((l) => l.split(' ').slice(0, 3).join(' '));
}

describe('PushCore data check', () => {
  test('a null delay and a delay of 1 ms or more have no out_of_range line', () => {
    const r = check([['[push_a]', 'A', 'A body', 'null'], ['[push_b]', 'B', 'B body', '1ms'], ['[push_c]', 'C', 'C body', '1d']]);
    expect(at(r, 'out_of_range')).toEqual([]);
    expect(r.code).toBe(0);
  });

  test('a delay of 0 is out_of_range', () => {
    const r = check([['[push_a]', 'A', 'A body', '0ms'], ['[push_b]', 'B', 'B body', '5m'], ['[push_c]', 'C', 'C body', '0s']]);
    expect(at(r, 'out_of_range')).toEqual([
      'data/tables/local_push.csv:5:4 ERROR out_of_range',
      'data/tables/local_push.csv:7:4 ERROR out_of_range',
    ]);
    expect(r.code).toBe(1);
  });

  test('a game that does not use PushCore has no PushCore check', () => {
    const r = check([['[push_a]', 'A', 'A body', '0ms']], []);
    expect(at(r, 'out_of_range')).toEqual([]);
  });
});
