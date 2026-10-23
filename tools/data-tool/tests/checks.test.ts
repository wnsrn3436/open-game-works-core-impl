/** Every data check code of `data` skill `### data check`: data that breaks a rule makes that line. */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { tableTypeNames } from '../src/schema.ts';
import { parseColumnType } from '../src/types.ts';
import { enums, fixture, lines, read, run, specModule, specTable, table, type FixtureOptions } from './helpers.ts';

const SYS_ID = ['id|id(key)|All', 'target|string|None', 'value|string|All'];
const SYS_SETTING = ['id|id(key)|All', 'target|string|None', 'data_type|string|None', 'value|string|All'];

function check(options: FixtureOptions, extra: string[] = []): ReturnType<typeof run> {
  return run(fixture(options), extra);
}

function tables(files: Record<string, string>, more: FixtureOptions = {}): ReturnType<typeof run> {
  return check({ ...more, files: { ...files, ...(more.files ?? {}) } });
}

/** The line, without the message, for every line of a code. */
function at(r: ReturnType<typeof run>, code: string): string[] {
  return lines(r, code).map((l) => l.split(' ').slice(0, 3).join(' '));
}

describe('structure', () => {
  test('a file that is not UTF-8', () => {
    const f = fixture({ files: { 'data/tables/a.csv': table(['id|id(key)|All'], [['[a]']]) } });
    writeFileSync(join(f.game, 'data', 'tables', 'b.csv'), Buffer.from([0xff, 0xfe, 0x00]));
    const r = run(f);
    expect(at(r, 'structure')).toEqual(['data/tables/b.csv:1:1 ERROR structure']);
    expect(r.code).toBe(1);
  });

  test('a file that is not RFC 4180', () => {
    expect(at(tables({ 'data/tables/a.csv': 'x,y\n"a"b,c\n' }), 'structure')).toEqual(['data/tables/a.csv:2:1 ERROR structure']);
  });

  test('a header that is not 4 rows, a bad type, a bad build target, a bad first column', () => {
    const r = tables({
      'data/tables/a.csv': 'x\nAll\nid(key)\n',
      'data/tables/b.csv': table(['id|id(key)|All', 'v|integer|All']),
      'data/tables/c.csv': table(['id|id(key)|All', 'v|int|Both']),
      'data/tables/d.csv': table(['key|int|All']),
      'data/tables/e.csv': table(['id|id(key)|Client']),
    });
    expect(at(r, 'structure')).toEqual([
      'data/tables/a.csv:1:1 ERROR structure', 'data/tables/b.csv:3:2 ERROR structure', 'data/tables/c.csv:2:2 ERROR structure',
      'data/tables/d.csv:4:1 ERROR structure', 'data/tables/e.csv:4:1 ERROR structure',
    ]);
  });

  test('a comment column with a type, a record with another field count', () => {
    const r = tables({
      'data/tables/a.csv': 'x,\nAll,All\nid(key),int\nid,#memo\n',
      'data/tables/b.csv': `${table(['id|id(key)|All', 'v|int|All'])}[b],1,2\n`,
    });
    expect(at(r, 'structure')).toEqual(['data/tables/a.csv:2:2 ERROR structure', 'data/tables/b.csv:5:1 ERROR structure']);
  });

  test('requirement key columns that do not fit the first column', () => {
    const r = tables({
      'data/tables/a.csv': table(['id|id(key)|All', 'r|requirement<id>|All']),
      'data/tables/b.csv': table(['id|id|All', 'r|requirement|All']),
      'data/tables/c.csv': table(['id|id|All', 't|tstring<id,note>|All', 'note|string|All']),
    });
    expect(at(r, 'structure')).toEqual(['data/tables/a.csv:3:2 ERROR structure', 'data/tables/b.csv:3:2 ERROR structure', 'data/tables/c.csv:3:2 ERROR structure']);
  });

  test('a long key column of tstring<...> and requirement<...> is an integer key column', () => {
    const f = fixture({
      files: {
        'data/tables/season.csv': table(['id|id|All', 'season|long|All', 'desc|tstring<id,season>|All', 'req|requirement<id,season>|All'], [['[s]', '1', '시즌1', 'Level(1)'], ['[s]', '2', '시즌2', 'Level(2)']]),
        'data/enums.csv': 'type,element,value,#comment\nRequirementType,Level,1,\n',
        'data/requirement_types.csv': 'element,target,value,#comment\nLevel,none,true,\n',
      },
    });
    const r = run(f);
    expect(r).toEqual({ code: 0, stdout: [], stderr: [] });
    expect(read(f, 'data/translations/ko.csv')).toContain('season.desc.[s].2');
    expect(Object.keys(JSON.parse(readFileSync(f.registry, 'utf8')) as object)).toEqual(['[req__season__req__s__1__1]', '[req__season__req__s__2__1]', '[s]']);
  });

  test('a system table schema, a file in data/system/ that is not a system table, data/tables/requirement.csv', () => {
    const r = tables({
      'data/system/reserved_id.csv': table(['id|id(key)|All', 'value|string|All']),
      'data/system/extra.csv': table(['id|id(key)|All']),
      'data/tables/requirement.csv': table(['id|id(key)|All']),
    });
    expect(at(r, 'structure')).toEqual(['data/system/extra.csv:1:1 ERROR structure', 'data/system/reserved_id.csv:1:1 ERROR structure', 'data/tables/requirement.csv:1:1 ERROR structure']);
  });

  test('the fixed-format files with another header', () => {
    const r = tables({
      'data/enums.csv': 'type,element\n',
      'data/invariants.csv': 'kind,table\n',
      'data/requirement_types.csv': 'element,target\n',
      'data/simulation_tables.csv': 'name\n',
      'data/glossary.csv': 'source\n',
      'data/translations/ko.csv': 'key,text\n',
    });
    expect(at(r, 'structure')).toEqual([
      'data/enums.csv:1:1 ERROR structure', 'data/glossary.csv:1:1 ERROR structure', 'data/invariants.csv:1:1 ERROR structure',
      'data/requirement_types.csv:1:1 ERROR structure', 'data/simulation_tables.csv:1:1 ERROR structure', 'data/translations/ko.csv:1:1 ERROR structure',
    ]);
  });

  test('a core table header or a core enum that is not the core data', () => {
    const spec = { version: '1.0.0', modules: [specModule({ name: 'm', tables: [specTable('thing', ['id|id(key)|All', 'n|int|All'])], enums: [{ type: 'Kind', elements: ['A', 'B'] }] })] };
    const r = check({
      coreSpec: spec, modules: ['m'],
      files: { 'data/tables/thing.csv': table(['id|id(key)|All', 'n|long|All']), 'data/enums.csv': enums([['Kind', 'A', 1], ['Kind', 'B', 3]]) },
    });
    expect(at(r, 'structure')).toEqual(['data/enums.csv:1:1 ERROR structure', 'data/tables/thing.csv:1:1 ERROR structure']);
  });

  test('an ID registry that does not pass the form check', () => {
    const r = check({ files: { 'data/tables/a.csv': table(['id|id(key)|All'], [['[a]']]) }, registry: { '[a]': 1, '[b]': 1 } });
    expect(at(r, 'structure')).toEqual(['id_registry.json:1:1 ERROR structure']);
    expect(r.code).toBe(1);
  });

  test('requirement_types.csv with a bad target or value', () => {
    const r = tables({
      'data/enums.csv': enums([['RequirementType', 'Level', 1], ['RequirementType', 'Has', 2]]),
      'data/requirement_types.csv': 'element,target,value,#comment\nLevel,none,yes,\nHas,table<x>,false,\n',
    });
    expect(at(r, 'structure')).toEqual(['data/requirement_types.csv:2:3 ERROR structure', 'data/requirement_types.csv:3:2 ERROR structure']);
  });

  test('an invariant kind that is not one of the three', () => {
    const r = tables({ 'data/tables/a.csv': table(['id|id(key)|All', 'n|int|All']), 'data/invariants.csv': 'kind,table,column,group,min,max,child_table,child_column\nsorted,a,n,,,,,\n' });
    expect(at(r, 'structure')).toEqual(['data/invariants.csv:2:1 ERROR structure']);
  });
});

describe('bad_name', () => {
  test('table, column, ID name and enum names', () => {
    const r = tables({
      'data/tables/BadTable.csv': table(['id|id(key)|All']),
      'data/tables/a.csv': table(['id|id(key)|All', 'BadColumn|int|All', 's|string|All'], [['[Bad-Id]', '1', ''], ['[ok]', '2', 'see [Bad Name]']]),
      'data/enums.csv': enums([['bad_type', 'Good', 1], ['Good', 'bad_element', 1]]),
    });
    expect(at(r, 'bad_name')).toEqual([
      'data/enums.csv:2:1 ERROR bad_name', 'data/enums.csv:3:2 ERROR bad_name', 'data/tables/BadTable.csv:1:1 ERROR bad_name',
      'data/tables/a.csv:4:2 ERROR bad_name', 'data/tables/a.csv:5:1 ERROR bad_name', 'data/tables/a.csv:6:3 ERROR bad_name',
    ]);
  });
});

describe('reserved_name', () => {
  test('reserved words, accessor names, the req__ prefix and None', () => {
    const r = tables({
      'data/tables/class.csv': table(['id|id(key)|All', 'constructor|int|All'], [['[req__mine]', '1']]),
      'data/system/game_setting.csv': table(SYS_SETTING, [['[1st]', 'All', 'int', '1'], ['[delete]', 'All', 'int', '2']]),
      'data/enums.csv': enums([['Kind', 'None', 1]]),
    });
    expect(at(r, 'reserved_name')).toEqual([
      'data/enums.csv:2:2 ERROR reserved_name', 'data/system/game_setting.csv:5:1 ERROR reserved_name', 'data/system/game_setting.csv:6:1 ERROR reserved_name',
      'data/tables/class.csv:1:1 ERROR reserved_name', 'data/tables/class.csv:4:2 ERROR reserved_name', 'data/tables/class.csv:5:1 ERROR reserved_name',
    ]);
  });

  test('the TypeScript reserved words and global names of the data skill; contextual keywords and other globals are names', () => {
    const r = tables({
      'data/tables/thing.csv': table(['id|id(key)|All', 'type|int|All', 'eval|int|All', 'arguments|int|All', 'prototype|int|All', '__proto__|int|All'], [['[a]', '1', '2', '3', '4', '5']]),
      'data/system/game_setting.csv': table(SYS_SETTING, [['[type]', 'All', 'int', '1'], ['[let]', 'All', 'int', '2']]),
      'data/enums.csv': enums([['Promise', 'A', 1], ['BigInt', 'A', 1], ['DataView', 'A', 1], ['Symbol', 'A', 1]]),
    });
    expect(at(r, 'reserved_name')).toEqual([
      'data/enums.csv:2:1 ERROR reserved_name', 'data/enums.csv:3:1 ERROR reserved_name', 'data/system/game_setting.csv:6:1 ERROR reserved_name',
      'data/tables/thing.csv:4:5 ERROR reserved_name', 'data/tables/thing.csv:4:6 ERROR reserved_name',
    ]);
  });

  test('the type names the check knows for a table are the messages the data proto has for it', () => {
    const f = fixture({ files: {
      'data/tables/item.csv': table(['id|id(key)|All']),
      'data/tables/wave.csv': table(['id|id(key)|All', 'spawn|array<{monster: ref<wave.id>, count: int}>|All', 'cost|array<{item_id: ref<item.id>, amount: long}>|All', 'grid|array<array<int>>|All', 'n|int|All']),
    } });
    expect(run(f).code).toBe(0);
    const proto = readFileSync(join(f.game, 'server', 'generated', 'data', 'game_data.proto'), 'utf8');
    const messages = [...proto.matchAll(/^message (Wave\w*) \{/gm)].map((m) => m[1]).sort();
    const names = tableTypeNames('wave', ['spawn|array<{monster: ref<wave.id>, count: int}>', 'cost|array<{item_id: ref<item.id>, amount: long}>', 'grid|array<array<int>>', 'n|int'].map((c) => {
      const [name, type] = c.split('|') as [string, string];
      return { name, type: parseColumnType(type) };
    }));
    expect([names.row, names.table, ...names.columns.values()].sort()).toEqual(messages);
    expect(messages).toEqual(['WaveGridList', 'WaveRow', 'WaveSpawnItem', 'WaveTable']);
  });

  test('the data proto table messages are the TypeScript container classes, also for a table name with underscores', () => {
    const f = fixture({ files: { 'data/tables/monster_drop.csv': table(['id|id(key)|All', 'n|int|All']) } });
    expect(run(f).code).toBe(0);
    const proto = readFileSync(join(f.game, 'server', 'generated', 'data', 'game_data.proto'), 'utf8');
    const code = readFileSync(join(f.game, 'server', 'generated', 'data', 'game_data.ts'), 'utf8');
    const messages = [...proto.matchAll(/^message (\w+Table) \{/gm)].map((m) => m[1]).sort();
    const containers = [...code.matchAll(/^export class (\w+Table) \{/gm)].map((m) => m[1]).sort();
    expect(messages).toContain(tableTypeNames('monster_drop', []).table);
    expect(messages).toContain('MonsterDropTable');
    expect(containers).toEqual(messages);
  });

  test('a core-only bundle column that is not the item bundle list makes an Item type name, found by parsing the type', () => {
    const spec = { version: '1.0.0', modules: [specModule({ name: 'm', tables: [specTable('shop', ['id|id(key)|All', 'cost|array<{item_id: ref<item.id>, amount: long?}>|All', 'pay|array<{item_id: ref<item.id>, amount: long}>|All', 'grid|array<array<int>>|All'])] })] };
    const r = check({ coreSpec: spec, modules: [], files: { 'data/enums.csv': enums([['ShopCostItem', 'A', 1], ['ShopPayItem', 'A', 1], ['ShopGridList', 'A', 1]]) } });
    expect(at(r, 'reserved_name')).toEqual(['data/enums.csv:2:1 ERROR reserved_name', 'data/enums.csv:4:1 ERROR reserved_name']);
  });

  test('type names the data tool makes that clash', () => {
    const r = check({
      files: {
        'data/tables/vector2.csv': table(['id|id(key)|All']),
        'data/tables/item.csv': table(['id|id(key)|All']),
        'data/enums.csv': enums([['Vector2', 'A', 1], ['ItemRow', 'A', 1], ['Quest', 'A', 1]]),
        'contract/service.proto': 'syntax = "proto3";\npackage game;\n// message Ignored {}\nmessage Quest {}\n',
      },
    });
    expect(at(r, 'reserved_name')).toEqual(['data/enums.csv:2:1 ERROR reserved_name', 'data/enums.csv:3:1 ERROR reserved_name', 'data/enums.csv:4:1 ERROR reserved_name']);
  });

  test('data enum value names that clash, a core table or enum of a module the game does not use', () => {
    const spec = { version: '1.0.0', modules: [specModule({ name: 'm', tables: [specTable('thing', ['id|id(key)|All'])], enums: [{ type: 'CoreKind', elements: ['A'] }] })] };
    const r = check({
      coreSpec: spec, modules: [],
      files: { 'data/tables/thing.csv': table(['id|id(key)|All']), 'data/enums.csv': enums([['CoreKind', 'A', 1], ['ItemType', 'A', 1], ['Item', 'TypeA', 1]]) },
    });
    expect(at(r, 'reserved_name')).toEqual(['data/enums.csv:2:1 ERROR reserved_name', 'data/enums.csv:4:2 ERROR reserved_name', 'data/tables/thing.csv:1:1 ERROR reserved_name']);
  });
});

describe('value_type', () => {
  test('cells that do not read as their type', () => {
    const r = tables({
      'data/tables/a.csv': table(
        ['id|id(key)|All', 'i|int|All', 'l|long|All', 'f|float|All', 'b|bool|All', 'e|enum<Kind>|All', 'v|vector2<int>|All', 'd|datetime|All', 'u|duration|All', 'k|reskey|All', 'x|enum<Kind>?|All'],
        [
          ['[a]', '2147483648', '1', '1.0', 'true', 'A', '1,2', '2026-01-01T00:00:00Z', '1s', 'icon/a', 'A'],
          ['[b]', '1', '1e3', '1', 'true', 'A', '1,2', '2026-01-01T00:00:00Z', '1s', 'icon/a', 'A'],
          ['[c]', '1', '1', '1.5e2', 'yes', 'A', '1,2', '2026-01-01T00:00:00Z', '1s', 'icon/a', 'A'],
          ['[d]', '1', '1', '1', 'true', 'None', '1', '2026-01-01T00:00:00', '1s', 'icon/a', 'None'],
          ['[e]', '1', '1', '1', 'true', '', '1,2', '2026-02-30T00:00:00Z', '30m1h', 'Icon/A', 'A'],
        ],
      ),
      'data/enums.csv': enums([['Kind', 'A', 1]]),
      'resource/resources.csv': 'key\nicon/a\n',
    });
    expect(at(r, 'value_type')).toEqual([
      'data/tables/a.csv:5:2 ERROR value_type', 'data/tables/a.csv:6:3 ERROR value_type', 'data/tables/a.csv:7:4 ERROR value_type',
      'data/tables/a.csv:7:5 ERROR value_type', 'data/tables/a.csv:8:6 ERROR value_type', 'data/tables/a.csv:8:7 ERROR value_type',
      'data/tables/a.csv:8:8 ERROR value_type', 'data/tables/a.csv:8:11 ERROR value_type', 'data/tables/a.csv:9:6 ERROR value_type',
      'data/tables/a.csv:9:8 ERROR value_type', 'data/tables/a.csv:9:9 ERROR value_type', 'data/tables/a.csv:9:10 ERROR value_type',
    ]);
  });

  test('a datetime that is not a real date or time, and a bundle group with more or fewer fields than the header', () => {
    const r = tables({
      'data/tables/a.csv': table(['id|id(key)|All', 'd|datetime|All', 'w|array<{monster: ref<a.id>, count: int}>|All'], [
        ['[a]', '2026-02-28T23:59:59Z', '[a] 5, [b] 9'],
        ['[b]', '2026-02-30T00:00Z', '[a] 5 9'],
        ['[c]', '2026-01-01T24:00Z', '[a]'],
        ['[d]', '2026-01-01T00:60Z', ''],
        ['[e]', '2026-01-01T00:00:60Z', ''],
        ['[f]', '2026-04-31T00:00Z', ''],
      ]),
    });
    expect(at(r, 'value_type')).toEqual([
      'data/tables/a.csv:6:2 ERROR value_type', 'data/tables/a.csv:6:3 ERROR value_type', 'data/tables/a.csv:7:2 ERROR value_type',
      'data/tables/a.csv:7:3 ERROR value_type', 'data/tables/a.csv:8:2 ERROR value_type', 'data/tables/a.csv:9:2 ERROR value_type',
      'data/tables/a.csv:10:2 ERROR value_type',
    ]);
  });

  test('a requirement expression with bad syntax, an unknown type, wrong arguments or a mixed parenthesis', () => {
    const r = tables({
      'data/tables/a.csv': table(['id|id(key)|All', 'r|requirement|All'], [['[a]', 'Level(1'], ['[b]', 'Nope(1)'], ['[c]', 'Level()'], ['[d]', 'Level(1) & Level(2) | Level(3)'], ['[e]', 'Kind(Z)'], ['[f]', 'Level(1) & (Kind(A))']]),
      'data/enums.csv': enums([['RequirementType', 'Level', 1], ['RequirementType', 'Kind', 2], ['Rank', 'A', 1]]),
      'data/requirement_types.csv': 'element,target,value,#comment\nLevel,none,true,\nKind,enum<Rank>,false,\n',
    });
    expect(at(r, 'value_type')).toEqual(['data/tables/a.csv:5:2 ERROR value_type', 'data/tables/a.csv:6:2 ERROR value_type', 'data/tables/a.csv:7:2 ERROR value_type', 'data/tables/a.csv:8:2 ERROR value_type', 'data/tables/a.csv:9:2 ERROR value_type']);
  });

  test('a float cell above the float maximum and a requirement value outside int64; double and int64 limits read', () => {
    const r = tables({
      'data/tables/a.csv': table(['id|id(key)|All', 'f|float|All', 'd|double|All', 'r|requirement|All'], [
        ['[a]', '1000000000000000000000000000000000000000.0', '1000000000000000000000000000000000000000.0', 'Level(9223372036854775808)'],
        ['[b]', '340000000000000000000000000000000000000.0', '1', 'Level(9223372036854775807)'],
        ['[c]', '-1000000000000000000000000000000000000000.0', '1', 'Level(-9223372036854775809)'],
        ['[d]', '1', '1', 'Level(-9223372036854775808)'],
      ]),
      'data/enums.csv': enums([['RequirementType', 'Level', 1]]),
      'data/requirement_types.csv': 'element,target,value,#comment\nLevel,none,true,\n',
    });
    expect(at(r, 'value_type')).toEqual(['data/tables/a.csv:5:2 ERROR value_type', 'data/tables/a.csv:5:4 ERROR value_type', 'data/tables/a.csv:7:2 ERROR value_type', 'data/tables/a.csv:7:4 ERROR value_type']);
  });

  test('a game_setting data_type it does not take, a value that does not read, an item amount that is not a big integer', () => {
    const r = tables({
      'data/system/game_setting.csv': table(SYS_SETTING, [['[a]', 'All', 'tstring<id>', 'x'], ['[b]', 'All', 'int?', '1'], ['[c]', 'All', 'int', 'x'], ['[d]', 'Both', 'int', '1']]),
      'data/tables/item.csv': table(['id|id(key)|All', 'cost|array<{item_id: ref<item.id>, amount: long}>|All'], [['[gold]', '[gold] 01']]),
    });
    expect(at(r, 'value_type')).toEqual(['data/system/game_setting.csv:5:3 ERROR value_type', 'data/system/game_setting.csv:6:3 ERROR value_type', 'data/system/game_setting.csv:7:4 ERROR value_type', 'data/system/game_setting.csv:8:2 ERROR value_type', 'data/tables/item.csv:5:2 ERROR value_type']);
  });
});

describe('language code', () => {
  test('a code that is not a BCP 47 tag is value_type, two codes the same in lower case are duplicate; no translation binary is written', () => {
    const qa = specModule({ name: 'QACore', side: 'client', usedTables: ['language'] });
    const localization = specModule({ name: 'LocalizationCore', side: 'client', tables: [specTable('language', ['id|id(key)|All', 'code|string|All'])] });
    const f = fixture({
      coreSpec: { version: '0.0.0', modules: [qa, localization] }, modules: ['QACore'],
      files: { 'data/tables/language.csv': table(['id|id(key)|All', 'code|string|All'], [['[ko]', 'ko'], ['[escape]', '../../../../escaped'], ['[ko_upper]', 'KO'], ['[en]', 'en-US']]) },
    });
    const r = run(f);
    expect(at(r, 'value_type')).toEqual(['data/tables/language.csv:6:2 ERROR value_type']);
    expect(at(r, 'duplicate')).toEqual(['data/tables/language.csv:7:2 ERROR duplicate']);
    expect(r.code).toBe(1);
    expect(existsSync(join(f.game, 'server'))).toBe(false);
    expect(existsSync(join(f.root, 'escaped.bin'))).toBe(false);
  });
});

describe('value_type of system tables', () => {
  test('a game_setting or reserved_id target that is not All, Client or Server, a reserved_id value that is not an ID name', () => {
    const r = tables({
      'data/tables/item.csv': table(['id|id(key)|All'], [['[sword]']]),
      'data/system/game_setting.csv': table(SYS_SETTING, [['[a]', 'client', 'int', '1'], ['[b]', '', 'int', '1']]),
      'data/system/reserved_id.csv': table(SYS_ID, [['[c]', 'Both', '[sword]'], ['[d]', 'All', 'sword'], ['[e]', 'All', '[sword] [sword]'], ['[f]', 'Server', '[sword]']]),
    });
    expect(at(r, 'value_type')).toEqual([
      'data/system/game_setting.csv:5:2 ERROR value_type', 'data/system/game_setting.csv:6:2 ERROR value_type', 'data/system/reserved_id.csv:5:2 ERROR value_type',
      'data/system/reserved_id.csv:6:3 ERROR value_type', 'data/system/reserved_id.csv:7:3 ERROR value_type',
    ]);
  });
});

describe('empty_required', () => {
  test('empty cells of types whose empty cell is an error, empty reserved string text and reserved ID value', () => {
    const r = tables({
      'data/tables/a.csv': table(['id|id(key)|All', 'i|int|All', 's|string|All', 'r|ref<a.id>|All'], [['[a]', '', '', '[a]'], ['[b]', '1', '', '']]),
      'data/system/reserved_string.csv': table(['id|id(key)|All', 'text|tstring<id>|All'], [['[hello]', '']]),
      'data/system/reserved_id.csv': table(SYS_ID, [['[first]', 'All', '']]),
    });
    expect(at(r, 'empty_required')).toEqual(['data/system/reserved_id.csv:5:3 ERROR empty_required', 'data/system/reserved_string.csv:5:2 ERROR empty_required', 'data/tables/a.csv:5:2 ERROR empty_required', 'data/tables/a.csv:6:4 ERROR empty_required']);
  });

  test('a reserved ID that is required only under a game settings value', () => {
    const spec = { version: '1.0.0', modules: [specModule({ name: 'push', reserved: [{ table: 'reserved_id', id: '[ad_label]', requiredWhen: { path: 'pushConsent.adPush', value: true }, rowOf: null }] })] };
    const files = { 'data/system/reserved_id.csv': table(SYS_ID, [['[ad_label]', 'Server', '']]) };
    expect(lines(check({ coreSpec: spec, modules: ['push'], files, settings: { sourceLanguage: 'ko', supportedLanguages: ['ko'], pushConsent: { adPush: false } } }), 'empty_required')).toEqual([]);
    expect(at(check({ coreSpec: spec, modules: ['push'], files, settings: { sourceLanguage: 'ko', supportedLanguages: ['ko'], pushConsent: { adPush: true } } }), 'empty_required')).toEqual(['data/system/reserved_id.csv:5:3 ERROR empty_required']);
  });
});

describe('duplicate', () => {
  test('id(key), enum element and value, translation key source, requirement row key, simulation table, requirement_types element', () => {
    const r = tables({
      'data/tables/a.csv': table(['id|id(key)|All'], [['[a]'], ['[a]']]),
      'data/tables/b.csv': table(['id|id|All', 'n|int|All', 't|tstring<id,n>|All', 'r|requirement<id>|All'], [['[b]', '1', 'x', ''], ['[b]', '1', 'y', ''], ['[c]', '1', '', 'Level(1)'], ['[c]', '2', '', 'Level(2)']]),
      'data/enums.csv': enums([['Kind', 'A', 1], ['Kind', 'A', 2], ['Kind', 'B', 1], ['RequirementType', 'Level', 1]]),
      'data/requirement_types.csv': 'element,target,value,#comment\nLevel,none,true,\nLevel,none,true,\n',
      'data/simulation_tables.csv': 'table\na\na\n',
    });
    expect(at(r, 'duplicate')).toEqual([
      'data/enums.csv:3:2 ERROR duplicate', 'data/enums.csv:4:3 ERROR duplicate', 'data/requirement_types.csv:3:1 ERROR duplicate',
      'data/simulation_tables.csv:3:1 ERROR duplicate', 'data/tables/a.csv:6:1 ERROR duplicate', 'data/tables/b.csv:6:3 ERROR duplicate',
      'data/tables/b.csv:8:4 ERROR duplicate',
    ]);
  });
});

describe('ref_missing', () => {
  test('ref values, ID names in integer and string cells, reserved ID values and requirement targets', () => {
    const r = tables({
      'data/tables/a.csv': table(['id|id(key)|All', 'r|ref<a.id>?|All', 'n|int|All', 's|string|All', 'c|ref<b.code>|All', 'q|requirement|All'], [
        ['[a]', '[zz]', '[yy]', 'see [xx]', 'k2', 'Has([ww])'],
        ['[a2]', 'null', '1', '', 'k1', ''],
      ]),
      'data/tables/b.csv': table(['id|id(key)|All', 'code|string|All'], [['[b]', 'k1']]),
      'data/system/reserved_id.csv': table(SYS_ID, [['[first]', 'All', '[none]'], ['[self]', 'All', '[first]']]),
      'data/enums.csv': enums([['RequirementType', 'Has', 1]]),
      'data/requirement_types.csv': 'element,target,value,#comment\nHas,ref<a.id>,false,\n',
    });
    expect(at(r, 'ref_missing')).toEqual([
      'data/system/reserved_id.csv:5:3 ERROR ref_missing', 'data/system/reserved_id.csv:6:3 ERROR ref_missing',
      'data/tables/a.csv:5:2 ERROR ref_missing', 'data/tables/a.csv:5:3 ERROR ref_missing', 'data/tables/a.csv:5:4 ERROR ref_missing',
      'data/tables/a.csv:5:5 ERROR ref_missing', 'data/tables/a.csv:5:6 ERROR ref_missing',
    ]);
  });

  test('id values outside the first column: a game_setting id or array<id> value and array<id> cells', () => {
    const r = tables({
      'data/tables/item.csv': table(['id|id(key)|All'], [['[sword]']]),
      'data/tables/pack.csv': table(['id|id(key)|All', 'items|array<id>|All', 'more|array<array<id>>|All'], [['[p]', '[nothing_here],[sword]', '[sword]\n[nope]']]),
      'data/system/game_setting.csv': table(SYS_SETTING, [['[start_item]', 'All', 'id', '[swrod]'], ['[start_items]', 'All', 'array<id>', '[swrod],[sword]'], ['[good]', 'All', 'id', '[sword]']]),
    });
    expect(at(r, 'ref_missing')).toEqual([
      'data/system/game_setting.csv:5:4 ERROR ref_missing', 'data/system/game_setting.csv:6:4 ERROR ref_missing',
      'data/tables/pack.csv:5:2 ERROR ref_missing', 'data/tables/pack.csv:5:3 ERROR ref_missing',
    ]);
    expect(r.code).toBe(1);
  });

  test('a reserved ID that is not a row of its table, requirement_types and invariants that name nothing', () => {
    const spec = { version: '1.0.0', modules: [specModule({ name: 'm', tables: [specTable('mail_template', ['id|id(key)|All'])], reserved: [{ table: 'reserved_id', id: '[reward_mail]', requiredWhen: null, rowOf: 'mail_template' }] })] };
    const r = check({
      coreSpec: spec, modules: ['m'],
      files: {
        'data/tables/item.csv': table(['id|id(key)|All'], [['[gold]']]),
        'data/system/reserved_id.csv': table(SYS_ID, [['[reward_mail]', 'Server', '[gold]']]),
        'data/enums.csv': enums([['RequirementType', 'Level', 1]]),
        'data/requirement_types.csv': 'element,target,value,#comment\nLevel,ref<nothing.id>,false,\nGhost,none,false,\n',
        'data/invariants.csv': 'kind,table,column,group,min,max,child_table,child_column\nchild_exists,item,nope,,,,,\nchild_exists,item,id,,,,nothing,id\n',
        'data/simulation_tables.csv': 'table\nnothing\n',
      },
    });
    expect(at(r, 'ref_missing')).toEqual([
      'data/invariants.csv:2:1 ERROR ref_missing', 'data/invariants.csv:3:1 ERROR ref_missing', 'data/requirement_types.csv:2:2 ERROR ref_missing',
      'data/requirement_types.csv:3:1 ERROR ref_missing', 'data/simulation_tables.csv:2:1 ERROR ref_missing', 'data/system/reserved_id.csv:5:3 ERROR ref_missing',
    ]);
  });
});

describe('required_missing', () => {
  test('key_range and child_exists, a RequirementType element without a row, a required reserved row in a binary build', () => {
    const r = tables({
      'data/tables/level.csv': table(['id|id(key)|All', 'n|int|All'], [['[l1]', '1'], ['[l3]', '3']]),
      'data/tables/quest.csv': table(['id|id(key)|All'], [['[q1]'], ['[q2]']]),
      'data/tables/quest_step.csv': table(['id|id|All'], [['[q1]']]),
      'data/system/game_setting.csv': table(SYS_SETTING, [['[max_level]', 'All', 'int', '3']]),
      'data/invariants.csv': 'kind,table,column,group,min,max,child_table,child_column\nkey_range,level,n,,1,[max_level],,\nchild_exists,quest,id,,,,quest_step,id\n',
      'data/enums.csv': enums([['RequirementType', 'Level', 1]]),
      'data/requirement_types.csv': 'element,target,value,#comment\n',
    });
    expect(at(r, 'required_missing')).toEqual(['data/invariants.csv:2:1 ERROR required_missing', 'data/requirement_types.csv:1:1 ERROR required_missing', 'data/tables/quest.csv:6:1 ERROR required_missing']);
  });
});

describe('out_of_range', () => {
  test('a datetime? that is not more than 0, an enum value under 1, a reserved ID target that does not hold its module side', () => {
    const spec = { version: '1.0.0', modules: [specModule({ name: 'm', side: 'client', reserved: [{ table: 'reserved_id', id: '[client_thing]', requiredWhen: null, rowOf: null }] })] };
    const r = check({
      coreSpec: spec, modules: ['m'],
      files: {
        'data/tables/a.csv': table(['id|id(key)|All', 'at|datetime?|All'], [['[a]', '1970-01-01T00:00:00Z'], ['[b]', 'null']]),
        'data/enums.csv': enums([['Kind', 'A', 0]]),
        'data/system/reserved_id.csv': table(SYS_ID, [['[client_thing]', 'Server', '[a]']]),
      },
    });
    expect(at(r, 'out_of_range')).toEqual(['data/enums.csv:2:3 ERROR out_of_range', 'data/system/reserved_id.csv:5:2 ERROR out_of_range', 'data/tables/a.csv:5:2 ERROR out_of_range']);
  });
  test('a datetime? array element or bundle field that is not more than 0, and a game_setting array<datetime?> value', () => {
    const r = tables({
      'data/tables/ev.csv': table(['id|id(key)|All', 'at|array<datetime?>|All', 'w|array<{n: int, at: datetime?}>|All', 'grid|array<array<datetime?>>|All'], [
        ['[e]', '1970-01-01T00:00Z', '1 1970-01-01T00:00Z', ''],
        ['[f]', 'null, 2026-01-01T00:00Z', '1 null, 2 2026-01-01T00:00Z', '2026-01-01T00:00Z\n1970-01-01T00:00Z'],
      ]),
      'data/system/game_setting.csv': table(SYS_SETTING, [['[times]', 'All', 'array<datetime?>', '2026-01-01T00:00Z, 1970-01-01T00:00Z'], ['[ok]', 'All', 'array<datetime?>', 'null']]),
    });
    expect(at(r, 'out_of_range')).toEqual([
      'data/system/game_setting.csv:5:4 ERROR out_of_range', 'data/tables/ev.csv:5:2 ERROR out_of_range', 'data/tables/ev.csv:5:3 ERROR out_of_range', 'data/tables/ev.csv:6:4 ERROR out_of_range',
    ]);
    expect(r.stdout.filter((l) => !l.includes(' out_of_range '))).toEqual([]);
  });
});

describe('order', () => {
  test('order_column with a gap or a repeat, in groups', () => {
    const r = tables({
      'data/tables/step.csv': table(['id|id|All', 'order|int|All'], [['[a]', '1'], ['[a]', '3'], ['[b]', '1'], ['[b]', '1'], ['[c]', '2'], ['[c]', '1']]),
      'data/invariants.csv': 'kind,table,column,group,min,max,child_table,child_column\norder_column,step,order,id,,,,\n',
    });
    expect(at(r, 'order')).toEqual(['data/tables/step.csv:5:2 ERROR order', 'data/tables/step.csv:7:2 ERROR order']);
  });
});

describe('cycle', () => {
  test('ref values that come back to the same row', () => {
    const r = tables({
      'data/tables/badge.csv': table(['id|id(key)|All', 'parent|ref<badge.id>?|All'], [['[a]', '[b]'], ['[b]', '[c]'], ['[c]', '[a]'], ['[d]', 'null'], ['[e]', '[d]']]),
    });
    expect(at(r, 'cycle')).toEqual(['data/tables/badge.csv:5:1 ERROR cycle']);
  });

  test('a ref chain of 6000 rows is checked without a stack overflow, and a cycle at its end is found', () => {
    const n = 6000;
    const chain = (last: string): string[][] => Array.from({ length: n }, (_, i) => [`[s_${String(i)}]`, i === n - 1 ? last : `[s_${String(i + 1)}]`]);
    const ok = tables({ 'data/tables/stage.csv': table(['id|id(key)|All', 'next|ref<stage.id>?|All'], chain('null')) });
    expect(ok.stdout).toEqual([]);
    expect(ok.code).toBe(0);
    const back = tables({ 'data/tables/stage.csv': table(['id|id(key)|All', 'next|ref<stage.id>?|All'], chain('[s_0]')) });
    expect(at(back, 'cycle')).toEqual(['data/tables/stage.csv:5:1 ERROR cycle']);
  });
});

describe('ref types that come back', () => {
  test('a ref column type whose target leads back to itself is a structure line on its type cell, and its cells are not read', () => {
    const r = tables({
      'data/tables/node.csv': table(['id|id(key)|All', 'parent|ref<node.parent>|All', 'a|ref<node.b>|All', 'b|array<ref<node.a>>|All', 'c|ref<node.parent>?|All'], [['[a]', '[a]', '[a]', '[a]', 'null']]),
      'data/system/game_setting.csv': table(SYS_SETTING, [['[root]', 'All', 'ref<node.parent>', '[a]']]),
    });
    expect(at(r, 'structure')).toEqual([
      'data/system/game_setting.csv:5:4 ERROR structure', 'data/tables/node.csv:3:2 ERROR structure', 'data/tables/node.csv:3:3 ERROR structure',
      'data/tables/node.csv:3:4 ERROR structure', 'data/tables/node.csv:3:5 ERROR structure',
    ]);
    expect(r.stdout.filter((l) => !l.includes(' structure '))).toEqual([]);
    expect(r.code).toBe(1);
  });
});

describe('ref types that reach a column of more than one value', () => {
  test('a ref whose target, after following ref to ref, is a list, tstring or requirement column is a structure line on its type cell, and its cells are not read', () => {
    const r = tables({
      'data/tables/a.csv': table(['id|id(key)|All', 'tags|array<int>|All', 'grid|array<array<int>>|All', 'desc|tstring<id>|All', 'n|int|All'], [['[a]', '1,2', '', '설명', '1']]),
      'data/tables/b.csv': table(
        ['id|id(key)|All', 't|ref<a.tags>|All', 'g|ref<a.grid>|All', 'd|ref<a.desc>?|All', 'list|array<ref<a.tags>>|All', 'w|array<{x: ref<a.tags>, n: int}>|All', 'ok|ref<a.n>|All'],
        [['[b]', '1,2', '', '설명', '1', '1 1', '1']],
      ),
      'data/tables/c.csv': table(['id|id(key)|All', 's|ref<b.t>|All', 'ok|ref<b.ok>|All'], [['[c]', '1,2', '1']]),
      'data/system/game_setting.csv': table(SYS_SETTING, [['[tags]', 'All', 'ref<a.tags>', '1,2'], ['[n]', 'All', 'ref<b.ok>', '1']]),
    });
    expect(at(r, 'structure')).toEqual([
      'data/system/game_setting.csv:5:4 ERROR structure', 'data/tables/b.csv:3:2 ERROR structure', 'data/tables/b.csv:3:3 ERROR structure',
      'data/tables/b.csv:3:4 ERROR structure', 'data/tables/b.csv:3:5 ERROR structure', 'data/tables/b.csv:3:6 ERROR structure',
      'data/tables/c.csv:3:2 ERROR structure',
    ]);
    expect(r.stdout.filter((l) => !l.includes(' structure ') && !l.includes(' glossary_missing '))).toEqual([]);
    expect(r.code).toBe(1);
  });
});

describe('resource_missing', () => {
  test('a reskey that is not in resources.csv is WARN, and ERROR with --strict', () => {
    const files = { 'data/tables/a.csv': table(['id|id(key)|All', 'icon|reskey|All', 'more|array<reskey>|All'], [['[a]', 'icon/a', 'icon/b\nicon/c']]), 'resource/resources.csv': 'key\nicon/a\nicon/b\n' };
    const loose = check({ files });
    expect(at(loose, 'resource_missing')).toEqual(['data/tables/a.csv:5:3 WARN resource_missing']);
    expect(loose.code).toBe(0);
    const strict = check({ files }, ['--strict']);
    expect(at(strict, 'resource_missing')).toEqual(['data/tables/a.csv:5:3 ERROR resource_missing']);
    expect(strict.code).toBe(1);
  });
});

describe('banned_word_missing', () => {
  test('a supported language without a banned word list when nickname, guild or chat is used', () => {
    const settings = { sourceLanguage: 'ko', supportedLanguages: ['ko', 'en', 'ja'] };
    const files = { 'records/setup/banned-words/ko.txt': 'bad\n', 'records/setup/banned-words/en.txt': '  \n\n' };
    const r = check({ settings, files, modules: ['nickname'] });
    expect(at(r, 'banned_word_missing')).toEqual(['records/setup/banned-words/en.txt:1:1 WARN banned_word_missing', 'records/setup/banned-words/ja.txt:1:1 WARN banned_word_missing']);
    expect(lines(check({ settings, files }), 'banned_word_missing')).toEqual([]);
  });
});
