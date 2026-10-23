/** The data check of `LocalizationCore` `## data` (`src/checks/LocalizationCore.ts`): every rule makes its ERROR line. */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';
import { fixture, lines, run, table } from './helpers.ts';

const SPEC_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'core-spec');
const spec = (name: string): Record<string, unknown> => JSON.parse(readFileSync(join(SPEC_DIR, `${name}.json`), 'utf8')) as Record<string, unknown>;

const LANGUAGE = ['id|id(key)|All', 'code|string|All', 'name|tstring<id>|Client', 'font|reskey|Client', 'fallback|ref<language.id>?|Client', 'order|int|Client'];

function check(rows: string[][], supported: string[], modules: string[] = ['LocalizationCore']): ReturnType<typeof run> {
  return run(fixture({
    files: { 'data/tables/language.csv': table(LANGUAGE, rows) },
    settings: { sourceLanguage: 'en', supportedLanguages: supported },
    coreSpec: { version: '0.0.0', modules: [spec('InputCore'), spec('LocalizationCore')] },
    modules,
  }));
}

/** The place and code of every line of a code, without the message. */
function at(r: ReturnType<typeof run>, code: string): string[] {
  return lines(r, code).map((l) => l.split(' ').slice(0, 3).join(' '));
}

describe('language rows of supportedLanguages', () => {
  test('one row for each supported language has no LocalizationCore line', () => {
    const r = check([['[lang_en]', 'en', 'English', 'font/main', 'null', '1'], ['[lang_ko]', 'ko', '한국어', 'font/main', '[lang_en]', '2']], ['en', 'ko']);
    expect(at(r, 'out_of_range')).toEqual([]);
    expect(at(r, 'required_missing')).toEqual([]);
  });

  test('a row whose code is not a supported language is out_of_range', () => {
    const r = check([['[lang_en]', 'en', 'English', 'font/main', 'null', '1'], ['[lang_ja]', 'ja', '日本語', 'font/main', 'null', '2']], ['en']);
    expect(at(r, 'out_of_range')).toEqual(['data/tables/language.csv:6:2 ERROR out_of_range']);
    expect(r.code).toBe(1);
  });

  test('a supported language without a row is required_missing', () => {
    const r = check([['[lang_en]', 'en', 'English', 'font/main', 'null', '1']], ['en', 'ko']);
    expect(at(r, 'required_missing')).toEqual(['data/tables/language.csv:1:1 ERROR required_missing']);
    expect(r.code).toBe(1);
  });

  test('a code that differs from the supported language only in case is out_of_range and leaves that language without a row', () => {
    const r = check([['[lang_en]', 'en', 'English', 'font/main', 'null', '1'], ['[lang_zh]', 'zh-hans', '简体中文', 'font/main', 'null', '2']], ['en', 'zh-Hans']);
    expect(at(r, 'out_of_range')).toEqual(['data/tables/language.csv:6:2 ERROR out_of_range']);
    expect(at(r, 'required_missing')).toEqual(['data/tables/language.csv:1:1 ERROR required_missing']);
  });

  test('the check runs only when LocalizationCore is in --modules', () => {
    const r = check([['[lang_ja]', 'ja', '日本語', 'font/main', 'null', '1']], ['en'], []);
    expect(at(r, 'out_of_range')).toEqual([]);
    expect(at(r, 'required_missing')).toEqual([]);
  });
});
