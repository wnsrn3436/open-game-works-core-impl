/** The data check of `ShortcutCore` (`src/checks/ShortcutCore.ts`). */
import { describe, expect, test } from 'vitest';
import { enums, fixture, lines, run, specModule, specTable, table } from './helpers.ts';

const COLUMNS = ['id|id(key)|All', 'scene|reskey|Client', 'panels|array<reskey>|Client', 'stack|enum<ShortcutStack>|Client',
  'args|array<int>|Client', 'requirement|requirement|Client', '#comment'];

const SHORTCUT_CORE = specModule({
  name: 'ShortcutCore',
  side: 'client',
  lifecycle: true,
  tables: [specTable('shortcut', COLUMNS.filter((c) => !c.startsWith('#')))],
  enums: [{ type: 'ShortcutStack', elements: ['Root', 'Top'] }],
});

/** Runs the data tool on `shortcut` rows of (panels, args). */
function check(rows: [string, string][], modules = ['ShortcutCore']): ReturnType<typeof run> {
  const cells = rows.map(([panels, args], i) => [`[shortcut_${String(i)}]`, 'scene/lobby', panels, 'Root', args, '', '']);
  return run(fixture({
    files: {
      'data/tables/shortcut.csv': table(COLUMNS, cells),
      'data/enums.csv': enums([['ShortcutStack', 'Root', 1], ['ShortcutStack', 'Top', 2]]),
    },
    settings: { sourceLanguage: 'en', supportedLanguages: ['en'] },
    coreSpec: { version: '0.0.0', modules: [SHORTCUT_CORE] },
    modules,
  }));
}

describe('ShortcutCore data check', () => {
  test('rows with panels, and rows with neither panels nor args, pass', () => {
    const r = check([['prefab/panel/shop', ''], ['prefab/panel/shop', '3,[shortcut_0]'], ['prefab/panel/a\nprefab/panel/b', '1'], ['', '']]);
    expect(lines(r, 'out_of_range')).toEqual([]);
  });

  test('a row with an empty panels and a non-empty args is out_of_range', () => {
    const r = check([['prefab/panel/shop', '1'], ['', '1,2']]);
    expect(lines(r, 'out_of_range')).toEqual([
      'data/tables/shortcut.csv:6:5 ERROR out_of_range shortcut.args is not empty while shortcut.panels is empty',
    ]);
    expect(r.code).toBe(1);
  });

  test('the check does not run when ShortcutCore is not in --modules', () => {
    const r = check([['', '1,2']], []);
    expect(lines(r, 'out_of_range')).toEqual([]);
  });
});
