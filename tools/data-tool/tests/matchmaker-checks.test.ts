/** The data checks of `matchmaker` `## data` (`src/checks/matchmaker.ts`): every rule makes its ERROR line. */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';
import { fixture, lines, run, specModule, table } from './helpers.ts';

const SPEC_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'core-spec');
const MATCHMAKER = JSON.parse(readFileSync(join(SPEC_DIR, 'matchmaker.json'), 'utf8')) as Record<string, unknown> & { name: string };
/** The table `match_mode` refers to, without the rest of `rating`. */
const RATING = specModule({ name: 'rating', tables: [{ name: 'rating_rule', columns: [{ description: '', target: 'All', type: 'id(key)', name: 'id' }] }] });
const MODE = [
  'id|id(key)|All', 'min_players|int|All', 'max_players|int|All', 'match_wait|duration|Server', 'prepare_time|duration|All',
  'max_duration|duration|All', 'result_rule|enum<MatchResultRule>|All', 'rating_spread|long|Server', 'rating_spread_per_sec|long|Server',
  'max_party_size|int|All', 'team_size|int|All', 'rating_rule|ref<rating_rule.id>?|All', 'allow_queue|bool|All', 'allow_room|bool|All',
];
/** Column number (1-based) of each `match_mode` column. */
const COL = Object.fromEntries(MODE.map((c, i) => [c.split('|')[0] ?? '', i + 1]));

type ModeRow = Record<string, string>;

const BASE: ModeRow = {
  id: '[duel]', min_players: '2', max_players: '2', match_wait: '30s', prepare_time: '3s', max_duration: '10m', result_rule: 'Consensus',
  rating_spread: '0', rating_spread_per_sec: '0', max_party_size: '1', team_size: '0', rating_rule: 'null', allow_queue: 'true', allow_room: 'false',
};
const TEAMS: ModeRow = {
  ...BASE, id: '[teams]', min_players: '4', max_players: '4', result_rule: 'Majority', rating_spread: '100', rating_spread_per_sec: '10',
  max_party_size: '2', team_size: '2', allow_room: 'true',
};

function cells(row: ModeRow): string[] {
  return MODE.map((c) => row[c.split('|')[0] ?? ''] ?? '');
}

/** `[duel]` is data line 5 and `[teams]` line 6. */
function check(duel: ModeRow = {}, teams: ModeRow = {}, modules: string[] = ['matchmaker']): ReturnType<typeof run> {
  return run(fixture({
    files: {
      'data/tables/match_mode.csv': table(MODE, [cells({ ...BASE, ...duel }), cells({ ...TEAMS, ...teams })]),
      'data/tables/rating_rule.csv': table(['id|id(key)|All']),
    },
    settings: { sourceLanguage: 'en', supportedLanguages: ['en'] },
    coreSpec: { version: '0.0.0', modules: [MATCHMAKER, RATING] },
    modules,
  }));
}

function errors(r: ReturnType<typeof run>): string[] {
  return r.stdout.filter((l) => l.split(' ')[1] === 'ERROR');
}

/** The `out_of_range` places as `<line>:<column>`. */
function places(r: ReturnType<typeof run>): string[] {
  return lines(r, 'out_of_range').map((l) => (l.split(' ')[0] ?? '').split(':').slice(1).join(':'));
}

function at(line: number, name: string): string {
  return `${String(line)}:${String(COL[name])}`;
}

describe('matchmaker data check', () => {
  test('the base data has no ERROR line', () => {
    const r = check();
    expect(errors(r)).toEqual([]);
    expect(r.code).toBe(0);
  });

  test('min_players below 2 is out_of_range', () => {
    const r = check({ min_players: '1' });
    expect(places(r)).toEqual([at(5, 'min_players')]);
    expect(r.code).not.toBe(0);
  });

  test('max_players below min_players is out_of_range', () => {
    const r = check({ min_players: '3', max_players: '2', max_party_size: '1' });
    expect(places(r)).toEqual([at(5, 'max_players')]);
    expect(r.code).not.toBe(0);
  });

  test.each(['match_wait', 'prepare_time', 'max_duration'])('%s of 0 is out_of_range', (name) => {
    const r = check({ [name]: '0s' });
    expect(places(r)).toEqual([at(5, name)]);
    expect(r.code).not.toBe(0);
  });

  test.each(['rating_spread', 'rating_spread_per_sec'])('a negative %s is out_of_range', (name) => {
    const r = check({ [name]: '-1' });
    expect(places(r)).toEqual([at(5, name)]);
    expect(r.code).not.toBe(0);
  });

  test('max_party_size below 1 and above max_players are out_of_range', () => {
    expect(places(check({ max_party_size: '0' }))).toEqual([at(5, 'max_party_size')]);
    expect(places(check({ max_party_size: '3' }))).toEqual([at(5, 'max_party_size')]);
  });

  test('a negative team_size is out_of_range', () => {
    const r = check({ team_size: '-1' });
    expect(places(r)).toEqual([at(5, 'team_size')]);
    expect(r.code).not.toBe(0);
  });

  test('with teams, max_players not a multiple of team_size and max_party_size over team_size are out_of_range', () => {
    expect(places(check({}, { min_players: '2', max_players: '5', max_party_size: '2', team_size: '2' }))).toEqual([at(6, 'max_players')]);
    expect(places(check({}, { max_party_size: '3', team_size: '2', max_players: '4' }))).toEqual([at(6, 'max_party_size')]);
  });

  test('allow_queue and allow_room both false is out_of_range', () => {
    const r = check({ allow_queue: 'false', allow_room: 'false' });
    expect(places(r)).toEqual([at(5, 'allow_queue')]);
    expect(r.code).not.toBe(0);
  });

  test('a game without matchmaker is not checked', () => {
    const r = check({ min_players: '1', allow_queue: 'false', allow_room: 'false' }, {}, []);
    expect(places(r)).toEqual([]);
  });
});
