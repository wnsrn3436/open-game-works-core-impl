/** The data check of `NoticeCore` (`src/checks/NoticeCore.ts`). */
import { describe, expect, test } from 'vitest';
import { enums, fixture, lines, run, specModule, specTable, table } from './helpers.ts';

const BADGE_COLUMNS = ['id|id(key)|All', 'parent|ref<badge.id>?|Client', 'display|enum<BadgeDisplay>|Client', 'persist|bool|Client', 'requirement|requirement|Client'];
const SYS_ID = ['id|id(key)|All', 'target|string|None', 'value|string|All'];

const BADGE = specModule({
  name: 'BadgeCore', side: 'client', lifecycle: true,
  tables: [specTable('badge', BADGE_COLUMNS)],
  enums: [{ type: 'BadgeDisplay', elements: ['Dot', 'Count'] }],
});
const NOTICE = specModule({
  name: 'NoticeCore', side: 'client', lifecycle: true, dependencies: ['BadgeCore'],
  reserved: [{ table: 'reserved_id', id: '[notice_badge]', requiredWhen: null, rowOf: 'badge' }],
});

function check(persist: string, modules = ['NoticeCore', 'BadgeCore']): ReturnType<typeof run> {
  return run(fixture({
    files: {
      'data/tables/badge.csv': table(BADGE_COLUMNS, [['[badge_notice]', 'null', 'Dot', persist, ''], ['[badge_other]', 'null', 'Dot', 'true', '']]),
      'data/system/reserved_id.csv': table(SYS_ID, [['[notice_badge]', 'Client', '[badge_notice]']]),
      'data/enums.csv': enums([['BadgeDisplay', 'Dot', 1], ['BadgeDisplay', 'Count', 2]]),
    },
    coreSpec: { version: '0.0.0', modules: [BADGE, NOTICE] },
    modules,
  }));
}

describe('NoticeCore data check', () => {
  test('the [notice_badge] badge row with persist true is an ERROR', () => {
    const r = check('true');
    expect(lines(r, 'out_of_range')).toEqual([
      'data/tables/badge.csv:5:4 ERROR out_of_range badge [badge_notice] of [notice_badge] has persist true; it must be false',
    ]);
    expect(r.code).toBe(1);
  });

  test('persist false passes, and other badge rows are not checked', () => {
    expect(lines(check('false'), 'out_of_range')).toEqual([]);
  });

  test('the check does not run when NoticeCore is not in --modules', () => {
    expect(lines(check('true', ['BadgeCore']), 'out_of_range')).toEqual([]);
  });
});
