/** The data check of `push` (`src/checks/push.ts`). */
import { describe, expect, test } from 'vitest';
import { enums, fixture, lines, run, specModule, specTable, table } from './helpers.ts';

const PUSH = specModule({
  name: 'push',
  tables: [specTable('push_message', ['id|id(key)|All', 'title|tstring<id>|Server', 'body|tstring<id>|Server', 'kind|enum<PushKind>|Server'])],
  enums: [{ type: 'PushKind', elements: ['Info', 'Ad'] }],
});

function check(adPush: boolean | null, kinds: string[], modules = ['push']): ReturnType<typeof run> {
  const rows = kinds.map((kind, i) => [`[push_${String(i)}]`, `Title ${String(i)}`, `Body ${String(i)}`, kind]);
  const settings: Record<string, unknown> = { sourceLanguage: 'ko', supportedLanguages: ['ko'] };
  if (adPush !== null) settings.pushConsent = { adPush, nightStartMinute: 1320, nightEndMinute: 480 };
  return run(fixture({
    files: {
      'data/tables/push_message.csv': table(['id|id(key)|All', 'title|tstring<id>|Server', 'body|tstring<id>|Server', 'kind|enum<PushKind>|Server'], rows),
      'data/enums.csv': enums([['PushKind', 'Info', 1], ['PushKind', 'Ad', 2]]),
    },
    settings,
    coreSpec: { version: '0.0.0', modules: [PUSH] },
    modules,
  }));
}

describe('push data check', () => {
  test('an Ad push_message row is an ERROR when pushConsent.adPush is false', () => {
    const r = check(false, ['Info', 'Ad', 'Ad']);
    expect(lines(r, 'out_of_range')).toEqual([
      'data/tables/push_message.csv:6:4 ERROR out_of_range push_message kind is Ad while game settings pushConsent.adPush is false',
      'data/tables/push_message.csv:7:4 ERROR out_of_range push_message kind is Ad while game settings pushConsent.adPush is false',
    ]);
    expect(r.code).toBe(1);
  });

  test('an Ad row is an ERROR when game settings have no pushConsent', () => {
    expect(lines(check(null, ['Ad']), 'out_of_range')).toHaveLength(1);
  });

  test('Ad rows pass when pushConsent.adPush is true, and Info rows always pass', () => {
    expect(lines(check(true, ['Info', 'Ad']), 'out_of_range')).toEqual([]);
    expect(lines(check(false, ['Info']), 'out_of_range')).toEqual([]);
  });

  test('the check does not run when push is not in --modules', () => {
    expect(lines(check(false, ['Ad'], []), 'out_of_range')).toEqual([]);
  });
});
