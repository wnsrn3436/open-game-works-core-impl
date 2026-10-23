/** Data versions, the generation target folders, and the checks against the PROD data tag data of `--previous`. */
import { cpSync, existsSync, mkdirSync, readFileSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import protobuf from 'protobufjs';
import { describe, expect, test } from 'vitest';
import { stripProtoComments } from '../src/proto.ts';
import { replaceFolder } from '../src/output.ts';
import { fixture, has, lines, read, run, specModule, specTable, table, writeFiles, type Fixture } from './helpers.ts';

const SETTING = ['id|id(key)|All', 'target|string|None', 'data_type|string|None', 'value|string|All'];

function base(): Fixture {
  return fixture({
    files: {
      'data/tables/unit.csv': table(['id|id(key)|All', 'hp|int|All', 'secret|int|Server'], [['[a]', '1', '2'], ['[b]', '3', '4']], ['', '체력']),
      'data/system/game_setting.csv': table(SETTING, [['[cap]', 'All', 'int', '10']]),
    },
  });
}

function version(f: Fixture, file: string): [string, string] {
  return read(f, `server/build/data/${file}`).trim().split('-') as [string, string];
}

/** A `--previous` folder: a copy of the game after a binary build. */
function snapshot(f: Fixture): string {
  const dir = join(f.root, 'previous');
  cpSync(f.game, dir, { recursive: true });
  mkdirSync(join(dir, 'client', 'build', 'data'), { recursive: true });
  writeFileSync(join(dir, 'client', 'build', 'data', 'data_version'), read(f, 'server/build/data/client_data_version'));
  return dir;
}

describe('data version', () => {
  test('each build target has <protocol hash>-<data hash>; comments do not change the protocol hash', () => {
    const f = base();
    expect(run(f).code).toBe(0);
    const server = read(f, 'server/build/data/data_version');
    expect(server).toMatch(/^[0-9a-f]{64}-[0-9a-f]{64}\n$/);
    expect(read(f, 'server/build/data/client_data_version')).toMatch(/^[0-9a-f]{64}-[0-9a-f]{64}\n$/);
    expect(version(f, 'data_version')[0]).not.toBe(version(f, 'client_data_version')[0]);
    expect(read(f, 'server/generated/data/game_data.proto')).toContain('  // 체력\n  int32 hp = 2;');
    writeFiles(f.game, { 'data/tables/unit.csv': table(['id|id(key)|All', 'hp|int|All', 'secret|int|Server'], [['[a]', '1', '2'], ['[b]', '3', '4']], ['', '바뀐 설명']) });
    const [protocol, data] = version(f, 'data_version');
    expect(run(f).code).toBe(0);
    expect(version(f, 'data_version')).toEqual([protocol, data]);
    writeFiles(f.game, { 'data/tables/unit.csv': table(['id|id(key)|All', 'hp|int|All', 'secret|int|Server'], [['[a]', '1', '2'], ['[b]', '3', '5']]) });
    expect(run(f).code).toBe(0);
    expect(version(f, 'data_version')[0]).toBe(protocol);
    expect(version(f, 'data_version')[1]).not.toBe(data);
    expect(stripProtoComments('a\n  // x\nb // y\n\nc')).toBe('a\nb\n\nc');
  });

  test('a generation target folder is replaced: files the run does not make go', () => {
    const f = base();
    writeFiles(f.game, { 'server/build/data/old.bin': 'x', 'server/generated/data/old.ts': 'x' });
    expect(run(f).code).toBe(0);
    expect(has(f, 'server/build/data/old.bin')).toBe(false);
    expect(has(f, 'server/generated/data/old.ts')).toBe(false);
    expect(has(f, 'server/build/data/unit.bin')).toBe(true);
  });

  test('a generation target folder is replaced by writing only the files whose bytes differ', () => {
    const f = base();
    expect(run(f).code).toBe(0);
    const old = new Date('2020-01-01T00:00:00Z');
    const paths = ['server/build/data/unit.bin', 'server/build/data/game_setting.bin', 'server/generated/data/game_data.proto'].map((p) => join(f.game, p));
    for (const p of paths) utimesSync(p, old, old);
    expect(run(f).code).toBe(0);
    expect(paths.map((p) => statSync(p).mtimeMs)).toEqual(paths.map(() => old.getTime()));
    writeFiles(f.game, { 'data/tables/unit.csv': table(['id|id(key)|All', 'hp|int|All', 'secret|int|Server'], [['[a]', '5', '2'], ['[b]', '3', '4']], ['', '체력']) });
    expect(run(f).code).toBe(0);
    expect(statSync(paths[0] as string).mtimeMs).not.toBe(old.getTime());
    expect(paths.slice(1).map((p) => statSync(p).mtimeMs)).toEqual([old.getTime(), old.getTime()]);
  });

  test('column descriptions holding /* and */ are comments only: a type change between them changes the protocol hash', () => {
    const hero = (b: string): string => table(['id|id(key)|All', 'a|int|All', `b|${b}|All`, 'c|int|All'], [['[h]', '1', '2', '3']], ['', 'see /* note', '', 'end */ here']);
    const f = fixture({ files: { 'data/tables/hero.csv': hero('int') } });
    expect(run(f).code).toBe(0);
    const [protocol] = version(f, 'data_version');
    writeFiles(f.game, { 'data/tables/hero.csv': hero('long') });
    expect(run(f).code).toBe(0);
    expect(version(f, 'data_version')[0]).not.toBe(protocol);
    expect(stripProtoComments('  // see /* note\n  int64 b = 3;\n  // end */ here\nx')).toBe('  int64 b = 3;\nx');
  });

  test('remote_config_key rows whose client is false are server data only', () => {
    const remoteConfig = specModule({
      name: 'remote-config',
      tables: [specTable('remote_config_key', ['id|id(key)|All', 'type|enum<RemoteConfigType>|All', 'default_value|string|All', 'client|bool|All'])],
      enums: [{ type: 'RemoteConfigType', elements: ['Bool', 'Int', 'String'] }],
    });
    const keys = (shown: string, hidden: string): string => table(['id|id(key)|All', 'type|enum<RemoteConfigType>|All', 'default_value|string|All', 'client|bool|All'],
      [['[shown]', 'Int', shown, 'true'], ['[hidden]', 'Int', hidden, 'false']]);
    const f = fixture({ coreSpec: { version: '0.0.0', modules: [remoteConfig] }, modules: ['remote-config'], files: { 'data/tables/remote_config_key.csv': keys('1', '2') } });
    expect(run(f)).toEqual({ code: 0, stdout: [], stderr: [] });
    const ids = JSON.parse(readFileSync(f.registry, 'utf8')) as Record<string, number>;
    const root = new protobuf.Root();
    root.loadSync(join(f.game, 'server', 'generated', 'data', 'game_data.proto'), { keepCase: true });
    const type = root.lookupType('ogw.data.RemoteConfigKeyTable');
    const rows = (type.toObject(type.decode(readFileSync(join(f.game, 'server', 'build', 'data', 'remote_config_key.bin')))) as { rows: { id: number }[] }).rows;
    expect(rows.map((x) => x.id).sort()).toEqual([ids['[shown]'], ids['[hidden]']].sort());
    const client = version(f, 'client_data_version');
    const server = version(f, 'data_version');
    writeFiles(f.game, { 'data/tables/remote_config_key.csv': keys('1', '20') });
    expect(run(f).code).toBe(0);
    expect(version(f, 'client_data_version')).toEqual(client);
    expect(version(f, 'data_version')[1]).not.toBe(server[1]);
    writeFiles(f.game, { 'data/tables/remote_config_key.csv': keys('10', '20') });
    expect(run(f).code).toBe(0);
    expect(version(f, 'client_data_version')[1]).not.toBe(client[1]);
  });

  test('a generation target path outside its folder is refused before anything is written', () => {
    const f = base();
    const dir = join(f.root, 'out');
    expect(() => { replaceFolder(dir, new Map([['ok.bin', 'x'], ['../escaped.bin', 'y']])); }).toThrow(/outside/);
    expect(existsSync(dir)).toBe(false);
    expect(existsSync(join(f.root, 'escaped.bin'))).toBe(false);
  });

  test('compat_client_data_version is the previous client data version when the client protocol hash changed', () => {
    const f = base();
    expect(run(f).code).toBe(0);
    const prev = snapshot(f);
    expect(run(f, ['--previous', prev]).code).toBe(0);
    expect(has(f, 'server/build/data/compat_client_data_version')).toBe(false);
    writeFiles(f.game, { 'data/tables/unit.csv': table(['id|id(key)|All', 'hp|int|All', 'secret|int|Server', 'speed|int|Client'], [['[a]', '1', '2', '1'], ['[b]', '3', '4', '1']]) });
    expect(run(f, ['--previous', prev]).code).toBe(0);
    expect(read(f, 'server/build/data/compat_client_data_version')).toBe(readFileSync(join(prev, 'client', 'build', 'data', 'data_version'), 'utf8'));
  });
});

describe('protocol_change and prod_change', () => {
  test('under the same protocol hash: a deleted accessor row, a changed data_type, a shrunk target, id and id(key)', () => {
    const f = fixture({
      files: {
        'data/tables/unit.csv': table(['id|id(key)|All'], [['[a]']]),
        'data/system/game_setting.csv': table(SETTING, [['[cap]', 'All', 'int', '10'], ['[rate]', 'All', 'int', '1'], ['[mode]', 'All', 'int', '1']]),
      },
    });
    expect(run(f).code).toBe(0);
    const prev = snapshot(f);
    writeFiles(f.game, {
      'data/tables/unit.csv': table(['id|id|All'], [['[a]']]),
      'data/system/game_setting.csv': table(SETTING, [['[rate]', 'All', 'long', '1'], ['[mode]', 'Server', 'int', '1']]),
    });
    const r = run(f, ['--previous', prev]);
    expect(lines(r, 'protocol_change').map((l) => l.split(' ').slice(3).join(' '))).toEqual([
      'game_setting row [cap] that an accessor reads was deleted under the same protocol hash',
      '[cap] of table game_setting in the PROD data tag data is not in the table',
      'game_setting [rate] data_type changed under the same protocol hash',
      'game_setting [mode] target shrank under the same protocol hash',
      'unit first column changed between id and id(key) under the same protocol hash',
    ]);
    expect(r.code).toBe(1);
  });

  test('with the protocol hash changed: a changed data_type, a shrunk target, id and id(key) are no protocol_change', () => {
    const f = fixture({
      files: {
        'data/tables/unit.csv': table(['id|id(key)|All'], [['[a]']]),
        'data/system/game_setting.csv': table(SETTING, [['[rate]', 'All', 'int', '1'], ['[mode]', 'All', 'int', '1']]),
      },
    });
    expect(run(f).code).toBe(0);
    const prev = snapshot(f);
    const [protocol] = version(f, 'data_version');
    writeFiles(f.game, {
      'data/tables/unit.csv': table(['id|id|All', 'hp|int|All'], [['[a]', '1']]),
      'data/system/game_setting.csv': table(SETTING, [['[rate]', 'All', 'long', '1'], ['[mode]', 'Server', 'int', '1']]),
    });
    const r = run(f, ['--previous', prev]);
    expect(r).toEqual({ code: 0, stdout: [], stderr: [] });
    expect(version(f, 'data_version')[0]).not.toBe(protocol);
    expect(read(f, 'server/build/data/client_data_version').split('-')[0]).not.toBe(readFileSync(join(prev, 'client', 'build', 'data', 'data_version'), 'utf8').split('-')[0]);
  });

  test('an ID name of a table in the PROD data tag data that the table no longer has, except requirement rows', () => {
    const f = fixture({ files: { 'data/tables/unit.csv': table(['id|id(key)|All', 'hp|int|All'], [['[a]', '1'], ['[b]', '2']]) } });
    expect(run(f).code).toBe(0);
    const prev = snapshot(f);
    writeFiles(f.game, { 'data/tables/unit.csv': table(['id|id(key)|All', 'hp|int|All', 'mp|int|All'], [['[a]', '1', '0']]) });
    const r = run(f, ['--previous', prev]);
    expect(lines(r, 'protocol_change').map((l) => l.split(' ').slice(3).join(' '))).toEqual(['[b] of table unit in the PROD data tag data is not in the table']);
  });

  test('banned_word rows the banned word lists no longer make are not deleted ID names', () => {
    const validation = specModule({ name: 'validation', tables: [specTable('banned_word', ['id|id(key)|All', 'word|string|Server', 'match|enum<BannedWordMatch>|Server'])], enums: [{ type: 'BannedWordMatch', elements: ['Contains', 'Exact'] }] });
    const f = fixture({
      coreSpec: { version: '1.0.0', modules: [validation] }, modules: ['validation'],
      files: { 'records/setup/banned-words/ko.txt': '나쁜말\n욕설\n', 'data/tables/unit.csv': table(['id|id(key)|All'], [['[a]'], ['[b]']]) },
    });
    expect(run(f).code).toBe(0);
    expect(read(f, 'data/tables/banned_word.csv')).toContain('[banned_ko_2],욕설,Contains');
    const prev = snapshot(f);
    writeFiles(f.game, { 'records/setup/banned-words/ko.txt': '나쁜말\n', 'data/tables/unit.csv': table(['id|id(key)|All'], [['[a]']]) });
    const r = run(f, ['--previous', prev]);
    expect(read(f, 'data/tables/banned_word.csv')).not.toContain('[banned_ko_2]');
    expect(lines(r, 'protocol_change').map((l) => l.split(' ').slice(3).join(' '))).toEqual(['[b] of table unit in the PROD data tag data is not in the table']);
  });

  test('a changed value of a row of a data/simulation_tables.csv table, and a deleted resource key', () => {
    const f = fixture({
      files: {
        'data/tables/wave.csv': table(['id|id|All', 'n|int|All', 'time|duration|All', 'note|string|None'], [['[w]', '1', '1m', 'a'], ['[w]', '2', '2m', 'b']]),
        'data/simulation_tables.csv': 'table\nwave\n',
        'resource/resources.csv': 'key\nicon/a\nicon/b\n',
      },
    });
    expect(run(f).code).toBe(0);
    const prev = snapshot(f);
    writeFiles(f.game, {
      'data/tables/wave.csv': table(['id|id|All', 'n|int|All', 'time|duration|All', 'note|string|None', 'extra|int|All'], [['[w]', '1', '60s', 'changed', '5'], ['[w]', '2', '2m', 'b', '6']]),
      'resource/resources.csv': 'key\nicon/a\n',
    });
    expect(lines(run(f, ['--previous', prev]), 'prod_change').map((l) => l.split(' ').slice(3).join(' '))).toEqual(['resource key icon/b of the PROD data tag was deleted']);
    writeFiles(f.game, { 'data/tables/wave.csv': table(['id|id|All', 'n|int|All', 'time|duration|All', 'note|string|None'], [['[w]', '1', '1m', 'a'], ['[w]', '2', '3m', 'b']]) });
    expect(lines(run(f, ['--previous', prev]), 'prod_change').map((l) => l.split(' ').slice(3).join(' '))).toEqual([
      'wave [w] time changed; the table is in data/simulation_tables.csv',
      'resource key icon/b of the PROD data tag was deleted',
    ]);
  });

  test('a file of the PROD data tag data the checks read that does not read is a structure ERROR line at that file of --previous', () => {
    const f = fixture({
      files: {
        'data/tables/unit.csv': table(['id|id(key)|All'], [['[a]'], ['[b]']]),
        'data/tables/item.csv': table(['id|id(key)|All'], [['[x]']]),
        'data/system/game_setting.csv': table(SETTING, [['[cap]', 'All', 'int', '10']]),
        'data/simulation_tables.csv': 'table\nunit\n',
        'resource/resources.csv': 'key\nicon/a\n',
      },
    });
    expect(run(f).code).toBe(0);
    const prev = snapshot(f);
    // the checks would pass without these files: [b] is deleted, [cap] is deleted, icon/a is deleted
    writeFiles(prev, { 'data/tables/unit.csv': 'id\n"cut', 'resource/resources.csv': 'key\n"cut', 'data/system/game_setting.csv': 'id\n' });
    writeFileSync(join(prev, 'data', 'simulation_tables.csv'), Buffer.from([0x74, 0xff, 0x0a]));
    // a file that reads with a problem the PROD build had passed with an older rule makes no line
    writeFiles(prev, { 'data/tables/item.csv': `${table(['id|id(key)|All'])}[x],extra\n` });
    writeFiles(f.game, { 'data/tables/unit.csv': table(['id|id(key)|All'], [['[a]']]), 'data/system/game_setting.csv': table(SETTING), 'resource/resources.csv': 'key\n' });
    const r = run(f, ['--previous', prev]);
    expect(r.code).toBe(1);
    expect(lines(r, 'structure').map((l) => `${l.split(' ')[0] ?? ''} ${l.split(' ').slice(3).join(' ')}`)).toEqual([
      `${join(prev, 'data/simulation_tables.csv')}:1:1 the PROD data tag file of --previous does not read, so the checks against it cannot run: the file is not UTF-8`,
      `${join(prev, 'data/system/game_setting.csv')}:1:1 the PROD data tag file of --previous does not read, so the checks against it cannot run: the header is not 4 rows`,
      `${join(prev, 'data/tables/unit.csv')}:2:1 the PROD data tag file of --previous does not read, so the checks against it cannot run: the file is not RFC 4180 CSV: unterminated quoted field`,
      `${join(prev, 'resource/resources.csv')}:2:1 the PROD data tag file of --previous does not read, so the checks against it cannot run: the file is not RFC 4180 CSV: unterminated quoted field`,
    ]);
    expect(r.stdout.filter((l) => l.includes('item.csv'))).toEqual([]);
  });

  test('rows of a data/simulation_tables.csv group compare as a multiset: reordering is no change, a swap across rows is', () => {
    const wave = (rows: string[][]): string => table(['id|id|All', 'n|int|All', 'm|int|All'], rows);
    const f = fixture({ files: { 'data/tables/wave.csv': wave([['[w]', '1', '10'], ['[w]', '2', '20']]), 'data/simulation_tables.csv': 'table\nwave\n' } });
    expect(run(f).code).toBe(0);
    const prev = snapshot(f);
    writeFiles(f.game, { 'data/tables/wave.csv': wave([['[w]', '2', '20'], ['[w]', '1', '10']]) });
    const reordered = run(f, ['--previous', prev]);
    expect(lines(reordered, 'prod_change')).toEqual([]);
    expect(reordered.code).toBe(0);
    writeFiles(f.game, { 'data/tables/wave.csv': wave([['[w]', '1', '20'], ['[w]', '2', '10']]) });
    expect(lines(run(f, ['--previous', prev]), 'prod_change').map((l) => l.split(' ').slice(0, 1).concat(l.split(' ').slice(3)).join(' '))).toEqual([
      'data/tables/wave.csv:5:1 wave [w] rows changed; the table is in data/simulation_tables.csv',
    ]);
    writeFiles(f.game, { 'data/tables/wave.csv': wave([['[w]', '2', '20'], ['[w]', '1', '11']]) });
    expect(lines(run(f, ['--previous', prev]), 'prod_change').map((l) => l.split(' ').slice(0, 1).concat(l.split(' ').slice(3)).join(' '))).toEqual([
      'data/tables/wave.csv:5:3 wave [w] m changed; the table is in data/simulation_tables.csv',
    ]);
  });
});
