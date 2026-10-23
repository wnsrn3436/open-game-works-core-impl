/** The data check of `ChatCore` (`src/checks/ChatCore.ts`). */
import { describe, expect, test } from 'vitest';
import { enums, fixture, lines, run, specModule, specTable, table } from './helpers.ts';

const BADGE_COLUMNS = ['id|id(key)|All', 'parent|ref<badge.id>?|Client', 'display|enum<BadgeDisplay>|Client', 'persist|bool|Client', 'requirement|requirement|Client'];
const SYS_ID = ['id|id(key)|All', 'target|string|None', 'value|string|All'];

const BADGE = specModule({
  name: 'BadgeCore', side: 'client', lifecycle: true,
  tables: [specTable('badge', BADGE_COLUMNS)],
  enums: [{ type: 'BadgeDisplay', elements: ['Dot', 'Count'] }],
});
const CHAT = specModule({
  name: 'ChatCore', side: 'client', lifecycle: true, dependencies: ['BadgeCore'],
  reserved: [{ table: 'reserved_id', id: '[chat_badge]', requiredWhen: null, rowOf: 'badge' }],
});

function check(display: string, persist: string, modules = ['ChatCore', 'BadgeCore']): ReturnType<typeof run> {
  return run(fixture({
    files: {
      'data/tables/badge.csv': table(BADGE_COLUMNS, [['[badge_chat]', 'null', display, persist, ''], ['[badge_other]', 'null', 'Dot', 'true', '']]),
      'data/system/reserved_id.csv': table(SYS_ID, [['[chat_badge]', 'Client', '[badge_chat]']]),
      'data/enums.csv': enums([['BadgeDisplay', 'Dot', 1], ['BadgeDisplay', 'Count', 2]]),
    },
    coreSpec: { version: '0.0.0', modules: [BADGE, CHAT] },
    modules,
  }));
}

describe('ChatCore data check', () => {
  test('the [chat_badge] badge row with display Dot is an ERROR', () => {
    const r = check('Dot', 'false');
    expect(lines(r, 'out_of_range')).toEqual([
      'data/tables/badge.csv:5:3 ERROR out_of_range badge [badge_chat] of [chat_badge] has display Dot; it must be Count',
    ]);
    expect(r.code).toBe(1);
  });

  test('the [chat_badge] badge row with persist true is an ERROR', () => {
    expect(lines(check('Count', 'true'), 'out_of_range')).toEqual([
      'data/tables/badge.csv:5:4 ERROR out_of_range badge [badge_chat] of [chat_badge] has persist true; it must be false',
    ]);
  });

  test('display Count and persist false pass, and other badge rows are not checked', () => {
    const r = check('Count', 'false');
    expect(lines(r, 'out_of_range')).toEqual([]);
  });

  test('the check does not run when ChatCore is not in --modules', () => {
    expect(lines(check('Dot', 'true', ['BadgeCore']), 'out_of_range')).toEqual([]);
  });
});
