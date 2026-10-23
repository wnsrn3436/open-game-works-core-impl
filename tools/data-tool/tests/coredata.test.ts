/** Core data put into the data folder, `banned_word` rows, and the binary build that changes nothing. */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { fixture, has, lines, read, run, specModule, specTable, table, writeFiles } from './helpers.ts';

const SPEC = {
  version: '1.0.0',
  modules: [
    specModule({
      name: 'shop', side: 'server',
      tables: [specTable('shop_product', ['id|id(key)|All', 'item|ref<item.id>|All', 'reset|enum<ResetCycle>?|All'])],
      reserved: [
        { table: 'reserved_id', id: '[shop_mail]', requiredWhen: null, rowOf: 'mail_template' },
        { table: 'reserved_string', id: '[shop_title]', requiredWhen: null, rowOf: null },
      ],
      invariants: [{ kind: 'child_exists', table: 'shop_product', column: 'id', group: '', min: '', max: '', child_table: 'item', child_column: 'id' }],
    }),
    specModule({ name: 'item-ledger', tables: [specTable('item', ['id|id(key)|All', 'type|enum<ItemType>|All'])], enums: [{ type: 'ItemType', elements: ['Currency', 'Goods'] }] }),
    specModule({ name: 'mailbox', tables: [specTable('mail_template', ['id|id(key)|All', 'title|tstring<id>|Client'])] }),
    specModule({ name: 'server-time', enums: [{ type: 'ResetCycle', elements: ['Daily', 'Weekly'] }] }),
    specModule({ name: 'ShopCore', side: 'client', reserved: [{ table: 'reserved_id', id: '[shop_mail]', requiredWhen: null, rowOf: null }, { table: 'reserved_sound', id: '[shop_buy]', requiredWhen: null, rowOf: null }] }),
    specModule({ name: 'validation', tables: [specTable('banned_word', ['id|id(key)|All', 'word|string|Server', 'match|enum<BannedWordMatch>|Server'])], enums: [{ type: 'BannedWordMatch', elements: ['Contains', 'Exact'] }] }),
    specModule({ name: 'unused', tables: [specTable('unused_table', ['id|id(key)|All'])], enums: [{ type: 'UnusedKind', elements: ['A'] }] }),
  ],
};

describe('core data', () => {
  test('core tables, the tables they read or point to, enums, invariants and required reserved rows go into data', () => {
    const f = fixture({ coreSpec: SPEC, modules: ['shop', 'ShopCore'] });
    const r = run(f);
    expect(r.code).toBe(1);
    expect(read(f, 'data/tables/shop_product.csv')).toBe(',,\nAll,All,All\nid(key),ref<item.id>,enum<ResetCycle>?\nid,item,reset\n');
    expect(read(f, 'data/tables/item.csv')).toBe(',\nAll,All\nid(key),enum<ItemType>\nid,type\n');
    expect(read(f, 'data/tables/mail_template.csv')).toBe(',\nAll,Client\nid(key),tstring<id>\nid,title\n');
    expect(has(f, 'data/tables/unused_table.csv')).toBe(false);
    expect(read(f, 'data/enums.csv').split('\n').sort()).toEqual(['', 'ItemType,Currency,1,', 'ItemType,Goods,2,', 'ResetCycle,Daily,1,', 'ResetCycle,Weekly,2,', 'type,element,value,#comment']);
    expect(read(f, 'data/invariants.csv')).toBe('kind,table,column,group,min,max,child_table,child_column\nchild_exists,shop_product,id,,,,item,id\n');
    expect(read(f, 'data/system/reserved_id.csv')).toBe(',,\nAll,None,All\nid(key),string,string\nid,target,value\n[shop_mail],All,\n');
    expect(read(f, 'data/system/reserved_string.csv')).toBe(',\nAll,All\nid(key),tstring<id>\nid,text\n[shop_title],\n');
    expect(read(f, 'data/system/reserved_sound.csv')).toBe(',\nAll,Client\nid(key),reskey\nid,sound\n[shop_buy],\n');
    expect(read(f, 'data/requirement_types.csv')).toBe('element,target,value,#comment\n');
    expect(lines(r, 'empty_required').length).toBe(3);
  });

  test('enum elements go to the end of data/enums.csv in core-spec.json module order, spec order inside a module', () => {
    const f = fixture({ coreSpec: SPEC, modules: ['shop', 'ShopCore'], files: { 'data/enums.csv': 'type,element,value,#comment\nKind,A,1,game\nItemType,Goods,2,\n' } });
    run(f);
    expect(read(f, 'data/enums.csv')).toBe('type,element,value,#comment\nKind,A,1,game\nItemType,Goods,2,\nItemType,Currency,1,\nResetCycle,Daily,1,\nResetCycle,Weekly,2,\n');
  });

  test('a second run changes nothing, and a binary build of matched data writes only build files', () => {
    const f = fixture({ coreSpec: SPEC, modules: ['shop'] });
    run(f);
    writeFiles(f.game, {
      'data/tables/item.csv': table(['id|id(key)|All', 'type|enum<ItemType>|All'], [['[gold]', 'Currency']]),
      'data/tables/shop_product.csv': table(['id|id(key)|All', 'item|ref<item.id>|All', 'reset|enum<ResetCycle>?|All'], [['[gold]', '[gold]', 'null']]),
      'data/tables/mail_template.csv': table(['id|id(key)|All', 'title|tstring<id>|Client'], [['[mail]', '우편']]),
      'data/system/reserved_id.csv': table(['id|id(key)|All', 'target|string|None', 'value|string|All'], [['[shop_mail]', 'Server', '[mail]']]),
      'data/system/reserved_string.csv': table(['id|id(key)|All', 'text|tstring<id>|All'], [['[shop_title]', '상점']]),
    });
    expect(run(f).stdout).toEqual([]);
    const before = read(f, 'data/translations/ko.csv');
    const proto = read(f, 'server/generated/data/game_data.proto');
    writeFiles(f.game, { 'server/generated/data/game_data.proto': 'stale' });
    const r = run(f, ['--binary']);
    expect(r.code).toBe(0);
    expect(read(f, 'data/translations/ko.csv')).toBe(before);
    expect(read(f, 'server/generated/data/game_data.proto')).toBe('stale');
    expect(has(f, 'server/build/data/shop_product.bin')).toBe(true);
    expect(proto).toContain('message ShopProductRow');
  });

  test('a binary build fails without writing when core data, banned words or translations would change a file', () => {
    const f = fixture({ coreSpec: SPEC, modules: ['shop'] });
    const r = run(f, ['--binary']);
    expect(r.code).toBe(1);
    expect(r.stderr.join('\n')).toContain('data/tables/shop_product.csv');
    expect(has(f, 'data/tables/shop_product.csv')).toBe(false);
    expect(has(f, 'server/build/data')).toBe(false);
  });

  test('a core table and a system table that are there but do not read are left byte for byte, and so are the translation files', () => {
    const files = {
      'data/tables/item.csv': `${table(['id|id(key)|All', 'type|enum<ItemType>|All'], [['[a]', 'Currency']])}[b],"Goods\n`,
      'data/tables/mail_template.csv': `${table(['id|id(key)|All', 'title|tstring<id>|Client'], [['[m]', '보상']])}[n],"끝\n`,
      'data/system/reserved_id.csv': `${table(['id|id(key)|All', 'target|string|None', 'value|string|All'], [['[shop_mail]', 'All', ''], ['[other]', 'All', '']])}[last],"All\n`,
      'data/translations/ko.csv': 'key,source,source_hash,current_hash,text\nmail_template.title.[m],보상,h,h,보상\n',
    };
    const f = fixture({ coreSpec: SPEC, modules: ['shop', 'ShopCore'], files });
    // A CSV saved as CP949 is not UTF-8.
    const cp949 = Buffer.concat([Buffer.from(table(['id|id(key)|All', 'text|tstring<id>|All'], [['[shop_title]', '']])), Buffer.from([0xc7, 0xd1, 0x0a])]);
    writeFileSync(join(f.game, 'data/system/reserved_string.csv'), cp949);
    const r = run(f);
    expect(r.code).toBe(1);
    expect(lines(r, 'structure').map((l) => l.split(':')[0])).toEqual(['data/system/reserved_id.csv', 'data/system/reserved_string.csv', 'data/tables/item.csv', 'data/tables/mail_template.csv']);
    for (const [path, text] of Object.entries(files)) expect(read(f, path)).toBe(text);
    expect(readFileSync(join(f.game, 'data/system/reserved_string.csv')).equals(cp949)).toBe(true);
    expect(read(f, 'data/tables/shop_product.csv')).toBe(',,\nAll,All,All\nid(key),ref<item.id>,enum<ResetCycle>?\nid,item,reset\n');
  });

  test('banned_word rows are remade from the banned word lists in supportedLanguages order', () => {
    const f = fixture({
      coreSpec: SPEC, modules: ['validation'],
      settings: { sourceLanguage: 'ko', supportedLanguages: ['ko', 'zh-Hans', 'en'] },
      files: {
        'records/setup/banned-words/ko.txt': '나쁜말\r\n\n  욕설  \n',
        'records/setup/banned-words/zh-Hans.txt': '坏\n',
        'data/tables/banned_word.csv': table(['id|id(key)|All', 'word|string|Server', 'match|enum<BannedWordMatch>|Server'], [['[old]', 'gone', 'Exact']]),
      },
    });
    expect(run(f).code).toBe(0);
    expect(read(f, 'data/tables/banned_word.csv').split('\n').slice(4)).toEqual(['[banned_ko_1],나쁜말,Contains', '[banned_ko_3],욕설,Contains', '[banned_zh_hans_1],坏,Contains', '']);
    const registry = JSON.parse(readFileSync(f.registry, 'utf8')) as Record<string, number>;
    expect(Object.keys(registry)).toContain('[banned_zh_hans_1]');
  });

  test('a reserved ID both a client and a server module name holds All; one row per name', () => {
    const f = fixture({ coreSpec: SPEC, modules: ['shop', 'ShopCore'] });
    run(f);
    run(f);
    expect(read(f, 'data/system/reserved_id.csv').split('\n').filter((l) => l.startsWith('[shop_mail]'))).toEqual(['[shop_mail],All,']);
  });

  test('a core table with comment columns keeps them and matches the core data header', () => {
    const f = fixture({ coreSpec: SPEC, modules: ['item-ledger'], files: { 'data/tables/item.csv': table(['id|id(key)|All', '#memo', 'type|enum<ItemType>|All'], [['[gold]', 'note', 'Goods']]) } });
    const r = run(f);
    expect(r.stdout).toEqual([]);
    expect(r.code).toBe(0);
    expect(read(f, 'data/tables/item.csv')).toContain('[gold],note,Goods');
    expect(readFileSync(join(f.game, 'server', 'generated', 'data', 'game_data.proto'), 'utf8')).toContain('ItemType type = 2;');
  });
});
