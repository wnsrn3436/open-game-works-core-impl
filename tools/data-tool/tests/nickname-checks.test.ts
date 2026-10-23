/** The data checks of `nickname` `## data` (`src/checks/nickname.ts`): every rule makes its ERROR line. */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';
import { fixture, lines, run, table } from './helpers.ts';

const SPEC_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'core-spec');
const spec = (name: string): Record<string, unknown> => JSON.parse(readFileSync(join(SPEC_DIR, `${name}.json`), 'utf8')) as Record<string, unknown>;

const ITEM = ['id|id(key)|All', 'name|tstring<id>|Client', 'type|enum<ItemType>|All', 'max_amount|long|All', 'overflow|enum<ItemOverflow>|All'];
const COST = ['id|id(key)|All', 'change_number|int|All', 'cost|array<{item_id: ref<item.id>, amount: long}>|All'];

function check(rows: string[][], modules: string[] = ['nickname']): ReturnType<typeof run> {
  return run(fixture({
    files: {
      'data/tables/item.csv': table(ITEM, [['[gem]', '', 'Currency', '1000', 'Reject']]),
      'data/tables/nickname_cost.csv': table(COST, rows),
    },
    settings: { sourceLanguage: 'en', supportedLanguages: ['en'] },
    coreSpec: { version: '0.0.0', modules: [spec('item-ledger'), spec('nickname')] },
    modules,
  }));
}

/** The place and code of every line of a code, without the message. */
function at(r: ReturnType<typeof run>, code: string): string[] {
  return lines(r, code).map((l) => l.split(' ').slice(0, 3).join(' '));
}

describe('nickname_cost', () => {
  test('change_number 0 and more, each in one row, has no nickname line', () => {
    const r = check([['[first]', '0', ''], ['[second]', '1', '[gem] 10'], ['[later]', '3', '[gem] 50']]);
    expect(at(r, 'out_of_range')).toEqual([]);
    expect(at(r, 'duplicate')).toEqual([]);
  });

  test('a change_number less than 0 is out_of_range', () => {
    const r = check([['[first]', '0', ''], ['[bad]', '-1', '[gem] 10']]);
    expect(at(r, 'out_of_range')).toEqual(['data/tables/nickname_cost.csv:6:2 ERROR out_of_range']);
    expect(r.code).toBe(1);
  });

  test('a change_number in two rows is duplicate', () => {
    const r = check([['[a]', '1', '[gem] 10'], ['[b]', '1', '[gem] 20']]);
    expect(at(r, 'duplicate')).toEqual(['data/tables/nickname_cost.csv:6:2 ERROR duplicate']);
    expect(r.code).toBe(1);
  });

  test('the check runs only when nickname is in --modules', () => {
    const r = check([['[a]', '1', '[gem] 10'], ['[b]', '1', '[gem] 20'], ['[c]', '-2', '']], []);
    expect(at(r, 'duplicate')).toEqual([]);
    expect(at(r, 'out_of_range')).toEqual([]);
  });
});
