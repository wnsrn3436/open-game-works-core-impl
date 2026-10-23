/**
 * The data check of `mission` (`src/checks/mission.ts`): each rule of the mission spec `## data` makes an ERROR, so
 * the data does not build and the server does not start with it.
 */
import { describe, expect, test } from 'vitest';
import { enums, fixture, lines, run, specModule, specTable, table } from './helpers.ts';

const MISSION_COLUMNS = [
  'id|id(key)|All', 'name|tstring<id>|Client', 'desc|tstring<id>|Client', 'counter|ref<mission_counter.id>|All', 'target|long|All',
  'reset|enum<ResetCycle>?|All', 'requirement|requirement|All', 'reward|array<{item_id: ref<item.id>, amount: long}>|All',
  'extra_grant|bool|All', 'start_at|datetime?|All', 'end_at|datetime?|All', 'live_event|ref<live_event.id>?|All',
];

const SPEC = {
  version: '0.0.0',
  modules: [
    specModule({
      name: 'mission',
      tables: [specTable('mission_counter', ['id|id(key)|All', 'mode|enum<MissionCounterMode>|All']), specTable('mission', MISSION_COLUMNS)],
      usedTables: ['item', 'live_event'],
      enums: [{ type: 'MissionCounterMode', elements: ['Sum', 'Max'] }],
    }),
    specModule({ name: 'item-ledger', tables: [specTable('item', ['id|id(key)|All'])] }),
    specModule({ name: 'live-event', tables: [specTable('live_event', ['id|id(key)|All'])] }),
    specModule({ name: 'server-time', enums: [{ type: 'ResetCycle', elements: ['Daily', 'Weekly', 'Monthly'] }] }),
  ],
};

/** A mission row: `[id, target, reward, extra_grant]`. */
function mission(id: string, target: string, reward: string, extra: string): string[] {
  return [id, '', '', '[count_wins]', target, 'Daily', '', reward, extra, 'null', 'null', 'null'];
}

function check(rows: string[][], modules = ['mission']): ReturnType<typeof run> {
  return run(fixture({
    coreSpec: SPEC,
    modules,
    settings: { sourceLanguage: 'en', supportedLanguages: ['en'] },
    files: {
      'data/enums.csv': enums([['MissionCounterMode', 'Sum', 1], ['MissionCounterMode', 'Max', 2], ['ResetCycle', 'Daily', 1], ['ResetCycle', 'Weekly', 2], ['ResetCycle', 'Monthly', 3]]),
      'data/tables/item.csv': table(['id|id(key)|All'], [['[gold]']]),
      'data/tables/live_event.csv': table(['id|id(key)|All']),
      'data/tables/mission_counter.csv': table(['id|id(key)|All', 'mode|enum<MissionCounterMode>|All'], [['[count_wins]', 'Sum']]),
      'data/tables/mission.csv': table(MISSION_COLUMNS, rows),
    },
  }));
}

/** The place and code of every line of a code. */
function at(r: ReturnType<typeof run>, code: string): string[] {
  return lines(r, code).map((l) => l.split(' ').slice(0, 3).join(' '));
}

describe('mission data check', () => {
  test('rows that keep the rules build', () => {
    const r = check([
      mission('[m_low]', '1', '[gold] 10', 'false'),
      mission('[m_high]', '9007199254740991', '', 'true'),
      mission('[m_both]', '5', '[gold] 1', 'true'),
    ]);
    expect(at(r, 'out_of_range')).toEqual([]);
    expect(at(r, 'empty_required')).toEqual([]);
    expect(r.stdout.filter((l) => l.includes(' ERROR '))).toEqual([]);
    expect(r.code).toBe(0);
  });

  test('a target below 1 or above 2^53-1 is out_of_range', () => {
    const r = check([
      mission('[m_zero]', '0', '[gold] 10', 'false'),
      mission('[m_negative]', '-3', '[gold] 10', 'false'),
      mission('[m_over]', '9007199254740992', '[gold] 10', 'false'),
    ]);
    expect(at(r, 'out_of_range')).toEqual([
      'data/tables/mission.csv:5:5 ERROR', 'data/tables/mission.csv:6:5 ERROR', 'data/tables/mission.csv:7:5 ERROR',
    ].map((p) => `${p} out_of_range`));
    expect(r.code).toBe(1);
  });

  test('an empty reward with extra_grant false is empty_required', () => {
    const r = check([mission('[m_nothing]', '3', '', 'false')]);
    expect(at(r, 'empty_required')).toEqual(['data/tables/mission.csv:5:8 ERROR empty_required']);
    expect(r.code).toBe(1);
  });

  test('the check runs only when mission is a module of the game', () => {
    const r = check([mission('[m_nothing]', '0', '', 'false')], []);
    expect(at(r, 'out_of_range')).toEqual([]);
    expect(at(r, 'empty_required')).toEqual([]);
  });
});
