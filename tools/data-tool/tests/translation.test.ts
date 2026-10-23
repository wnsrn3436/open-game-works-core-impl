/** Translation keys, the glossary, the translation files and their checks (`data` skill `## translation`, `## glossary`). */
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import protobuf from 'protobufjs';
import { describe, expect, test } from 'vitest';
import { writeCsv } from '../src/csv.ts';
import { fixture, lines, read, run, specModule, specTable, table, writeFiles, type Fixture } from './helpers.ts';

const SETTINGS = { sourceLanguage: 'ko', supportedLanguages: ['ko', 'en'] };

function h16(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex').slice(0, 16);
}

function rows(f: Fixture, path: string): string[][] {
  return read(f, path).trimEnd().split('\n').map((l) => l.split(','));
}

const TRANSLATION = protobuf.parse('syntax = "proto3"; message TranslationEntry { string key = 1; string text = 2; } message Translation { repeated TranslationEntry entries = 1; }').root.lookupType('Translation');

/** Entries of a server translation binary. */
function entries(f: Fixture, code: string): { key: string; text: string }[] {
  const bytes = readFileSync(join(f.game, 'server', 'build', 'data', `translation_${code}.bin`));
  return (TRANSLATION.toObject(TRANSLATION.decode(bytes), { defaults: true }) as { entries: { key: string; text: string }[] }).entries;
}

function game(files: Record<string, string> = {}): Fixture {
  return fixture({
    settings: SETTINGS,
    files: {
      'data/tables/hero.csv': table(['id|id(key)|All', 'name|tstring<id>|Client', 'kind|enum<Kind>|All'], [['[knight]', '기사', 'Melee']]),
      'data/tables/hero_level.csv': table(['id|id|All', 'level|int|All', 'kind|enum<Kind>|All', 'desc|tstring<id,level,kind>|Client'], [['[knight]', '3', 'Melee', '기사 레벨 {level}']]),
      'data/enums.csv': 'type,element,value,#comment\nKind,Melee,4,\n',
      'data/glossary.csv': writeCsv([['source', 'id_name', 'note', 'source_hash', 'en'], ['기사', '[knight]', '', '', '']]),
      ...files,
    },
  });
}

describe('translation files', () => {
  test('keys from tstring cells, the source language file and a new language file', () => {
    const f = game();
    run(f);
    expect(rows(f, 'data/translations/ko.csv')).toEqual([
      ['key', 'source', 'source_hash', 'current_hash', 'text'],
      ['hero.name.[knight]', '기사', h16('기사'), h16('기사'), '기사'],
      ['hero_level.desc.[knight].3.Melee', '기사 레벨 {level}', h16('기사 레벨 {level}'), h16('기사 레벨 {level}'), '기사 레벨 {level}'],
    ]);
    const glossaryHash = h16('기사\n기사\t');
    expect(rows(f, 'data/translations/en.csv')).toEqual([
      ['key', 'source', 'source_hash', 'current_hash', 'text'],
      ['hero.name.[knight]', '기사', '', glossaryHash, ''],
      ['hero_level.desc.[knight].3.Melee', '기사 레벨 {level}', '', h16('기사 레벨 {level}\n기사\t'), ''],
    ]);
    expect(rows(f, 'data/glossary.csv')[1]).toEqual(['기사', '[knight]', '', h16('기사'), '']);
  });

  test('current_hash puts the matching glossary rows in byte order of source, whatever their order in the glossary', () => {
    const f = game({
      'data/tables/weapon.csv': table(['id|id(key)|All', 'name|tstring<id>|Client'], [['[sword]', '검']]),
      'data/tables/story.csv': table(['id|id(key)|All', 'text|tstring<id>|Client'], [['[s1]', '기사의 검']]),
      'data/glossary.csv': writeCsv([
        ['source', 'id_name', 'note', 'source_hash', 'en'],
        ['기사', '[knight]', '', h16('기사'), 'Knight'],
        ['검', '[sword]', '', h16('검'), 'Sword'],
      ]),
    });
    run(f);
    expect(Buffer.compare(Buffer.from('검'), Buffer.from('기사'))).toBe(-1);
    expect(rows(f, 'data/translations/en.csv').find((r) => r[0] === 'story.text.[s1]')).toEqual(['story.text.[s1]', '기사의 검', '', h16('기사의 검\n검\tSword\n기사\tKnight'), '']);
  });

  test('a changed source text makes a translation stale, a removed text removes its row, missing ones are WARN', () => {
    const f = game();
    run(f);
    writeFiles(f.game, {
      'data/glossary.csv': writeCsv([['source', 'id_name', 'note', 'source_hash', 'en'], ['기사', '[knight]', '', h16('기사'), 'Knight']]),
    });
    let r = run(f);
    const en = rows(f, 'data/translations/en.csv');
    const nameHash = h16('기사\n기사\tKnight');
    expect(en[1]).toEqual(['hero.name.[knight]', '기사', '', nameHash, '']);
    writeFiles(f.game, { 'data/translations/en.csv': writeCsv([en[0] as string[], ['hero.name.[knight]', '기사', nameHash, nameHash, 'Knight'], en[2] as string[]]) });
    r = run(f);
    expect(lines(r, 'translation_missing').map((l) => l.split(' ').slice(0, 2).join(' '))).toEqual(['data/translations/en.csv:3:5 WARN']);
    expect(lines(r, 'translation_stale')).toEqual([]);
    writeFiles(f.game, { 'data/tables/hero.csv': table(['id|id(key)|All', 'name|tstring<id>|Client', 'kind|enum<Kind>|All'], [['[knight]', '기사', 'Melee']]), 'data/tables/hero_level.csv': table(['id|id|All', 'level|int|All', 'kind|enum<Kind>|All', 'desc|tstring<id,level,kind>|Client']) });
    writeFiles(f.game, { 'data/glossary.csv': writeCsv([['source', 'id_name', 'note', 'source_hash', 'en'], ['기사', '[knight]', '', h16('기사'), 'Sir']]) });
    r = run(f);
    expect(rows(f, 'data/translations/en.csv').map((x) => x[0])).toEqual(['key', 'hero.name.[knight]']);
    expect(lines(r, 'translation_stale').map((l) => l.split(' ').slice(0, 2).join(' '))).toEqual(['data/translations/en.csv:2:5 WARN']);
    expect(r.code).toBe(0);
  });

  test('a glossary row whose source changed loses its translations; language names are themselves', () => {
    const f = game({
      'data/tables/language.csv': table(['id|id(key)|All', 'code|string|All', 'name|tstring<id>|Client'], [['[ko]', 'ko', '한국어'], ['[en]', 'en', 'English']]),
      'data/glossary.csv': writeCsv([
        ['source', 'id_name', 'note', 'source_hash', 'en'],
        ['기사', '[knight]', '', h16('옛 이름'), 'Old'],
        ['한국어', '[ko]', '', h16('한국어'), ''],
        ['English', '[en]', '', h16('English'), ''],
      ]),
    });
    const r = run(f);
    expect(rows(f, 'data/glossary.csv').slice(1)).toEqual([
      ['기사', '[knight]', '', h16('기사'), ''],
      ['한국어', '[ko]', '', h16('한국어'), '한국어'],
      ['English', '[en]', '', h16('English'), 'English'],
    ]);
    expect(lines(r, 'glossary_missing')).toEqual([]);
    expect(lines(r, 'translation_missing').filter((l) => l.startsWith('data/glossary.csv')).length).toBe(1);
  });

  test('glossary_missing: a glossary row matches only with both the ID name in id_name and the name text in source', () => {
    const glossary = (rows: string[][]): string => writeCsv([['source', 'id_name', 'note', 'source_hash', 'en'], ...rows]);
    const missing = (rows: string[][]): string[] => lines(run(game({ 'data/glossary.csv': glossary(rows) })), 'glossary_missing').map((l) => l.split(' ').slice(0, 3).join(' '));
    expect(missing([['기사', '[knight]', '', '', 'Knight']])).toEqual([]);
    expect(missing([['기사단', '[knight]', '', '', '']])).toEqual(['data/tables/hero.csv:5:2 ERROR glossary_missing']);
    expect(missing([['기사', '', '', '', '']])).toEqual(['data/tables/hero.csv:5:2 ERROR glossary_missing']);
  });

  test('glossary_missing: a name column with build target None is not checked', () => {
    const f = game({ 'data/tables/monster.csv': table(['id|id(key)|All', 'name|tstring<id>|None'], [['[slime]', '슬라임']]) });
    const r = run(f);
    expect(lines(r, 'glossary_missing')).toEqual([]);
    expect(r.code).toBe(0);
  });

  test('glossary_missing: a name text without its glossary row', () => {
    const f = game({ 'data/glossary.csv': writeCsv([['source', 'id_name', 'note', 'source_hash', 'en'], ['기사', '[other]', '', '', '']]) });
    const r = run(f);
    expect(lines(r, 'glossary_missing').map((l) => l.split(' ').slice(0, 3).join(' '))).toEqual(['data/tables/hero.csv:5:2 ERROR glossary_missing']);
    expect(r.code).toBe(1);
  });

  test('the translation binary has one entry per built translation key, with the translation of the key before value replacement', () => {
    const f = game({ 'data/tables/language.csv': table(['id|id(key)|All', 'code|string|All'], [['[ko]', 'ko'], ['[en]', 'en']]) });
    writeFiles(f.game, {
      'data/tables/hero_level.csv': table(['id|id|All', 'level|int|All', 'desc|tstring<id>|All'], [['[knight]', '1', '기사'], ['[knight]', '2', '기사']]),
      'data/glossary.csv': writeCsv([['source', 'id_name', 'note', 'source_hash', 'en'], ['기사', '[knight]', '', h16('기사'), 'Knight'], ['한국어', '[ko]', '', '', ''], ['English', '[en]', '', '', '']]),
    });
    run(f);
    writeFiles(f.game, { 'data/translations/en.csv': read(f, 'data/translations/en.csv').replace(/^(hero_level\.desc\.\[knight\],기사,,[0-9a-f]+,)$/m, '$1Knight') });
    expect(read(f, 'data/translations/en.csv')).toContain(',Knight\n');
    expect(run(f).code).toBe(0);
    const registry = JSON.parse(readFileSync(f.registry, 'utf8')) as Record<string, number>;
    const key = `hero_level.desc.${String(registry['[knight]'])}`;
    expect(entries(f, 'ko').filter((e) => e.key === key)).toEqual([{ key, text: '기사' }]);
    expect(entries(f, 'en').filter((e) => e.key === key)).toEqual([{ key, text: 'Knight' }]);
    expect(entries(f, 'en').map((e) => e.key)).toEqual([...new Set(entries(f, 'en').map((e) => e.key))]);
  });

  test('the translation binary of a language code with upper case letters is named with the code in lower case', () => {
    const f = fixture({
      settings: { sourceLanguage: 'ko', supportedLanguages: ['ko', 'zh-Hans'] },
      files: {
        'data/tables/hero.csv': table(['id|id(key)|All', 'desc|tstring<id>|All'], [['[knight]', '기사다']]),
        'data/tables/language.csv': table(['id|id(key)|All', 'code|string|All'], [['[ko]', 'ko'], ['[zh_hans]', 'zh-Hans']]),
      },
    });
    run(f);
    writeFiles(f.game, { 'data/translations/zh-Hans.csv': read(f, 'data/translations/zh-Hans.csv').replace(/^(hero\.desc\.\[knight\],기사다,,[0-9a-f]+,)$/m, '$1骑士') });
    expect(run(f).code).toBe(0);
    const built = readdirSync(join(f.game, 'server', 'build', 'data')).filter((n) => n.startsWith('translation_'));
    expect(built).toEqual(['translation_ko.bin', 'translation_zh-hans.bin']);
    const registry = JSON.parse(readFileSync(f.registry, 'utf8')) as Record<string, number>;
    expect(entries(f, 'zh-hans')).toEqual([{ key: `hero.desc.${String(registry['[knight]'])}`, text: '骑士' }]);
  });

  test('built translation keys in the translation binary use ID values and enum values', () => {
    const f = game({ 'data/tables/language.csv': table(['id|id(key)|All', 'code|string|All'], [['[ko]', 'ko']]) });
    writeFiles(f.game, { 'data/tables/hero_level.csv': table(['id|id|All', 'level|int|All', 'kind|enum<Kind>|All', 'desc|tstring<id,level,kind>|All'], [['[knight]', '3', 'Melee', '기사 레벨 {level}']]) });
    expect(run(f).code).toBe(0);
    const registry = JSON.parse(read({ ...f, game: f.root }, 'id_registry.json')) as Record<string, number>;
    const bin = read(f, 'server/build/data/translation_ko.bin');
    expect(bin).toContain(`hero_level.desc.${String(registry['[knight]'])}.3.4`);
    expect(bin).toContain('기사 레벨 {level}');
  });
});

describe('translation_format', () => {
  function format(files: Record<string, string>, coreSpec?: unknown, modules: string[] = []): string[] {
    const r = run(fixture({ settings: SETTINGS, coreSpec, modules, files }));
    return lines(r, 'translation_format').map((l) => l.split(' ').slice(0, 3).join(' '));
  }

  test('a translation whose format arguments or input prompt actions differ, {action}, a non-snake action, an unknown formatter', () => {
    const tr = (key: string, text: string): string[] => [key, '', 'x', 'y', text];
    const found = format({
      'data/tables/msg.csv': table(['id|id(key)|All', 'text|tstring<id>|Client'], [['[a]', '{count} 개'], ['[b]', '{action:jump} 눌러'], ['[c]', '{action} 눌러'], ['[d]', '{action:Jump}'], ['[e]', '{n:weird}']]),
      'data/translations/en.csv': writeCsv([['key', 'source', 'source_hash', 'current_hash', 'text'], tr('msg.text.[a]', '{total} items'), tr('msg.text.[b]', 'press {action:run}'), tr('msg.text.[c]', ''), tr('msg.text.[d]', ''), tr('msg.text.[e]', '')]),
    });
    expect(found).toEqual([
      'data/tables/msg.csv:7:2 ERROR translation_format', 'data/tables/msg.csv:8:2 ERROR translation_format', 'data/tables/msg.csv:9:2 ERROR translation_format',
      'data/translations/en.csv:2:5 ERROR translation_format', 'data/translations/en.csv:3:5 ERROR translation_format',
    ]);
  });

  test('an input prompt token in a Server tstring text', () => {
    expect(format({ 'data/tables/push.csv': table(['id|id(key)|All', 'body|tstring<id>|Server'], [['[a]', '{action:open} 열기']]) })).toEqual(['data/tables/push.csv:5:2 ERROR translation_format']);
  });

  test('core-given texts take only the arguments core gives, with formatters that take their kind', () => {
    const spec = {
      version: '1.0.0',
      modules: [
        specModule({
          name: 'm', side: 'server',
          tables: [specTable('mail_template', ['id|id(key)|All', 'title|tstring<id>|Client']), specTable('board', ['id|id(key)|All', 'reward_mail|ref<mail_template.id>?|Server']), specTable('local_push', ['id|id(key)|All', 'title|tstring<id>|Client'])],
          reserved: [{ table: 'reserved_string', id: '[greet]', requiredWhen: null, rowOf: null }, { table: 'reserved_id', id: '[gift_mail]', requiredWhen: null, rowOf: 'mail_template' }],
          formatArguments: [
            { text: '[greet]', arguments: [{ name: 'name', kind: 'string' }] },
            { text: '[gift_mail]', arguments: [{ name: 'count', kind: 'integer' }] },
            { text: 'board.reward_mail', arguments: [{ name: 'rank', kind: 'integer' }] },
            { text: 'local_push.title', arguments: [] },
          ],
        }),
      ],
    };
    const found = format({
      'data/system/reserved_string.csv': table(['id|id(key)|All', 'text|tstring<id>|All'], [['[greet]', '{name:ordinal}님 {name}']]),
      'data/system/reserved_id.csv': table(['id|id(key)|All', 'target|string|None', 'value|string|All'], [['[gift_mail]', 'Server', '[gift]']]),
      'data/tables/mail_template.csv': table(['id|id(key)|All', 'title|tstring<id>|Client'], [['[gift]', '{count:n}개 {rank}'], ['[season]', '{rank:ordinal} {count}']]),
      'data/tables/board.csv': table(['id|id(key)|All', 'reward_mail|ref<mail_template.id>?|Server'], [['[weekly]', '[season]']]),
      'data/tables/local_push.csv': table(['id|id(key)|All', 'title|tstring<id>|Client'], [['[come]', '{who} 돌아와']]),
    }, spec, ['m']);
    expect(found).toEqual([
      'data/system/reserved_string.csv:5:2 ERROR translation_format', 'data/tables/local_push.csv:5:2 ERROR translation_format',
      'data/tables/mail_template.csv:5:2 ERROR translation_format', 'data/tables/mail_template.csv:6:2 ERROR translation_format',
    ]);
  });
});
