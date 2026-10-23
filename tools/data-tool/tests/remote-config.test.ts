/** The data check of `remote-config` `## data`: `remote_config_key.default_value` reads as its `type`. */
import { describe, expect, test } from 'vitest';
import { enums, fixture, lines, run, specModule, specTable, table } from './helpers.ts';

const COLUMNS = ['id|id(key)|All', 'type|enum<RemoteConfigType>|All', 'default_value|string|All', 'client|bool|All'];

const REMOTE_CONFIG = specModule({
  name: 'remote-config',
  tables: [specTable('remote_config_key', COLUMNS), specTable('experiment', ['id|id(key)|All'])],
  enums: [{ type: 'RemoteConfigType', elements: ['Bool', 'Int', 'String'] }],
});

const ENUMS = enums([['RemoteConfigType', 'Bool', 1], ['RemoteConfigType', 'Int', 2], ['RemoteConfigType', 'String', 3]]);

function check(rows: string[][], settings: Record<string, unknown> = {}): ReturnType<typeof run> {
  return run(fixture({
    coreSpec: { version: '0.0.0', modules: [REMOTE_CONFIG] },
    modules: ['remote-config'],
    settings: { sourceLanguage: 'ko', supportedLanguages: ['ko'], ...settings },
    files: { 'data/tables/remote_config_key.csv': table(COLUMNS, rows), 'data/enums.csv': ENUMS },
  }));
}

/** `<file>:<line>:<column> <severity> <code>` of every `value_type` line. */
function valueType(r: ReturnType<typeof run>): string[] {
  return lines(r, 'value_type').map((l) => l.split(' ').slice(0, 3).join(' '));
}

describe('remote_config_key default_value', () => {
  test('values that read as their type pass', () => {
    const r = check([
      ['[flag_on]', 'Bool', 'true', 'true'],
      ['[flag_off]', 'Bool', 'false', 'false'],
      ['[count]', 'Int', '-9223372036854775808', 'true'],
      ['[big]', 'Int', '9223372036854775807', 'false'],
      ['[title]', 'String', '안녕', 'true'],
      ['[empty]', 'String', '', 'true'],
    ]);
    expect(r).toEqual({ code: 0, stdout: [], stderr: [] });
  });

  test('a Bool value other than true and false is value_type ERROR', () => {
    const r = check([['[a]', 'Bool', 'TRUE', 'true'], ['[b]', 'Bool', '1', 'true'], ['[c]', 'Bool', '', 'true']]);
    expect(valueType(r)).toEqual([
      'data/tables/remote_config_key.csv:5:3 ERROR value_type',
      'data/tables/remote_config_key.csv:6:3 ERROR value_type',
      'data/tables/remote_config_key.csv:7:3 ERROR value_type',
    ]);
    expect(r.code).toBe(1);
  });

  test('an Int value that is not a long integer is value_type ERROR', () => {
    const r = check([['[a]', 'Int', '1.5', 'true'], ['[b]', 'Int', '9223372036854775808', 'true'], ['[c]', 'Int', 'x', 'true'], ['[d]', 'Int', '', 'true']]);
    expect(valueType(r)).toEqual([
      'data/tables/remote_config_key.csv:5:3 ERROR value_type',
      'data/tables/remote_config_key.csv:6:3 ERROR value_type',
      'data/tables/remote_config_key.csv:7:3 ERROR value_type',
      'data/tables/remote_config_key.csv:8:3 ERROR value_type',
    ]);
    expect(r.code).toBe(1);
  });

  test('a String value of any length passes: its byte limit is a server start check', () => {
    const r = check([['[long]', 'String', 'x'.repeat(5000), 'true']], { core: { 'remote-config.maxStringBytes': 6 } });
    expect(r).toEqual({ code: 0, stdout: [], stderr: [] });
  });
});
