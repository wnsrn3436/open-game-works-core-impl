/** The data check of `offer` (`src/checks/offer.ts`): each rule of `offer` `## data` makes an ERROR. */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { fixture, lines, run, table } from './helpers.ts';

const CORE_SPEC_DIR = join(import.meta.dirname, '..', '..', '..', 'core-spec');

function specOf(name: string): unknown {
  return JSON.parse(readFileSync(join(CORE_SPEC_DIR, `${name}.json`), 'utf8')) as unknown;
}

const OFFER_COLUMNS = [
  'id|id(key)|All', 'name|tstring<id>|Client', 'duration|duration|All', 'cooldown|duration|All', 'max_triggers|int?|All',
  'requirement|requirement|All', 'start_at|datetime?|All', 'end_at|datetime?|All', 'live_event|ref<live_event.id>?|All',
];
const LIVE_EVENT_COLUMNS = [
  'id|id(key)|All', 'name|tstring<id>|Client', 'start_at|datetime|All', 'end_at|datetime|All', 'repeat|duration?|All',
  'repeat_until|datetime?|All', 'settle|bool|Server',
];

/** A data check run of `offer` rows `[id, duration, cooldown, max_triggers]`; the other cells are empty or null. */
function check(rows: [string, string, string, string][], modules: string[] = ['offer']): ReturnType<typeof run> {
  const f = fixture({
    files: {
      'data/tables/offer.csv': table(OFFER_COLUMNS, rows.map(([id, duration, cooldown, max]) => [id, `Offer ${id}`, duration, cooldown, max, '', 'null', 'null', 'null'])),
      'data/tables/live_event.csv': table(LIVE_EVENT_COLUMNS),
      'data/glossary.csv': ['source,id_name,note,source_hash', ...rows.map(([id]) => `Offer ${id},${id},,`)].join('\n') + '\n',
    },
    settings: { sourceLanguage: 'en', supportedLanguages: ['en'] },
    coreSpec: { version: '0.0.0', modules: [specOf('offer'), specOf('live-event')] },
    modules,
  });
  return run(f);
}

/** The place and severity of each `out_of_range` line. */
function out_of_range(r: ReturnType<typeof run>): string[] {
  return lines(r, 'out_of_range').map((l) => l.split(' ').slice(0, 2).join(' '));
}

describe('offer data check', () => {
  test('rows within the rules make no line', () => {
    const r = check([['[a]', '1ms', '0ms', '1'], ['[b]', '1h', '30m', 'null']]);
    expect(out_of_range(r)).toEqual([]);
    expect(r.code).toBe(0);
  });

  test('a duration below 1 is an ERROR', () => {
    const r = check([['[a]', '0ms', '0ms', 'null']]);
    expect(out_of_range(r)).toEqual(['data/tables/offer.csv:5:3 ERROR']);
    expect(r.code).toBe(1);
  });

  test('a max_triggers below 1 that is not null is an ERROR', () => {
    const r = check([['[a]', '1h', '0ms', '0'], ['[b]', '1h', '0ms', '-2']]);
    expect(out_of_range(r)).toEqual(['data/tables/offer.csv:5:5 ERROR', 'data/tables/offer.csv:6:5 ERROR']);
    expect(r.code).toBe(1);
  });

  test('cooldown 0 and more passes; the duration type has no negative value', () => {
    expect(out_of_range(check([['[a]', '1h', '0ms', 'null']]))).toEqual([]);
    expect(lines(check([['[a]', '1h', '-1ms', 'null']]), 'value_type')).toHaveLength(1);
  });

  test('duration + cooldown of 2^53-1 passes and over 2^53-1 is an ERROR', () => {
    const at = check([['[a]', '9007199254740990ms', '1ms', 'null'], ['[b]', '9007199254740991ms', '0ms', 'null']]);
    expect(out_of_range(at)).toEqual([]);
    expect(at.code).toBe(0);
    const over = check([['[a]', '9007199254740991ms', '1ms', 'null'], ['[b]', '9007199254740992ms', '0ms', 'null']]);
    expect(out_of_range(over)).toEqual(['data/tables/offer.csv:5:1 ERROR', 'data/tables/offer.csv:6:1 ERROR']);
    expect(over.code).toBe(1);
  });

  test('the check runs only when offer is a module of --modules', () => {
    expect(out_of_range(check([['[a]', '0ms', '0ms', '0']], ['live-event']))).toEqual([]);
  });
});
