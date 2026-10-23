/** The command line: arguments, exit codes, the built `bin/data-tool.js`, the core test data folder, module checks. */
import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';
import { Diagnostics } from '../src/diag.ts';
import { runModuleChecks, type ModuleCheck } from '../src/module-check.ts';
import { failureLine, oneLine, parseArgs, runDataTool } from '../src/run.ts';
import { args, fixture, REQUIREMENT_MODULE, table, tempDir, writeFiles } from './helpers.ts';
import type { RunContext } from '../src/context.ts';
import { readDataFolder } from '../src/data.ts';

const TOOL = join(dirname(fileURLToPath(import.meta.url)), '..');

describe('command line', () => {
  test('missing or unknown arguments and input files that are not there are exit code 2', () => {
    expect(parseArgs(['--game'])).toBeTypeOf('string');
    expect(parseArgs(['--what', 'x'])).toBeTypeOf('string');
    const f = fixture();
    expect(runDataTool(args(f).slice(2)).code).toBe(2);
    expect(runDataTool([...args(f), '--bogus']).code).toBe(2);
    writeFileSync(f.coreSpec, '{"modules": 3}');
    expect(runDataTool(args(f)).code).toBe(2);
    const g = fixture();
    writeFileSync(g.settings, '{"sourceLanguage": "ko"}');
    expect(runDataTool(args(g)).code).toBe(2);
    const h = fixture();
    writeFileSync(h.modules, '{}');
    expect(runDataTool(args(h)).code).toBe(2);
  });

  test('a game settings language tag that is not a BCP 47 tag is exit code 2 before any file is read or written', () => {
    const hero = table(['id|id(key)|All', 'desc|tstring<id>|All'], [['[a]', '영웅']]);
    for (const settings of [{ sourceLanguage: 'ko', supportedLanguages: ['ko', '../../server/escaped'] }, { sourceLanguage: '../ko', supportedLanguages: ['ko'] }]) {
      const f = fixture({ settings, files: { 'data/tables/hero.csv': hero } });
      const r = runDataTool(args(f));
      expect(r.code).toBe(2);
      expect(r.stdout).toEqual([]);
      expect(r.stderr[0]).toContain('BCP 47');
      expect(existsSync(join(f.game, 'server'))).toBe(false);
      expect(existsSync(join(f.game, 'data/translations'))).toBe(false);
    }
  });

  test('--engine of an engine without client generated code is exit code 2', () => {
    const r = runDataTool([...args(fixture()), '--engine', 'unity']);
    expect(r.code).toBe(2);
    expect(r.stderr[0]).toContain('unity');
  });

  test('a --previous folder that is not there, or has no finished binary build, is exit code 2 before any file is written', () => {
    const hero = table(['id|id(key)|All', 'desc|tstring<id>|All'], [['[a]', '영웅']]);
    const f = fixture({ files: { 'data/tables/hero.csv': hero } });
    const built = join(f.root, 'built');
    writeFiles(built, { 'data/tables/hero.csv': hero, 'server/build/data/data_version': `${'a'.repeat(64)}-${'b'.repeat(64)}\n` });
    const noBuild = join(f.root, 'no-build');
    writeFiles(noBuild, { 'data/tables/hero.csv': hero });
    const badVersion = join(f.root, 'bad-version');
    writeFiles(badVersion, { 'data/tables/hero.csv': hero, 'server/build/data/data_version': 'abc\n' });
    const file = join(f.root, 'file');
    writeFileSync(file, '');
    for (const [prev, why] of [[join(f.root, 'nonexistent'), 'is not a folder'], [file, 'is not a folder'], [noBuild, 'no finished binary build'], [badVersion, 'is not a data version']] as const) {
      const r = runDataTool([...args(f), '--previous', prev]);
      expect(r.code).toBe(2);
      expect(r.stdout).toEqual([]);
      expect(r.stderr[0]).toContain(why);
      expect(existsSync(join(f.game, 'server'))).toBe(false);
      expect(existsSync(join(f.game, 'data/translations'))).toBe(false);
    }
    expect(runDataTool([...args(f), '--previous', built]).code).toBe(0);
  });

  test('exit code 1 with an ERROR line writes no generation target', () => {
    const f = fixture({ files: { 'data/tables/a.csv': table(['id|id(key)|All', 'n|int|All'], [['[a]', 'x']]) } });
    const r = runDataTool(args(f));
    expect(r.code).toBe(1);
    expect(existsSync(join(f.game, 'server'))).toBe(false);
  });

  test('a generation target that cannot be written is exit code 2 with the reason, and no generation target folder changes', () => {
    const f = fixture({ files: { 'data/tables/unit.csv': table(['id|id(key)|All', 'hp|int|All'], [['[a]', '1']]) } });
    expect(runDataTool(args(f)).code).toBe(0);
    const snapshot = (): string[] => ['server/generated/data', 'server/dev/generated/data', 'server/build/data'].flatMap((folder) => {
      const dir = join(f.game, folder);
      return readdirSync(dir).sort().map((name) => `${folder}/${name} ${readFileSync(join(dir, name)).toString('hex')}`);
    });
    const before = snapshot();
    writeFiles(f.game, { 'data/tables/unit.csv': table(['id|id(key)|All', 'hp|int|All', 'mp|int|All'], [['[a]', '1', '2']]) });
    const build = join(f.game, 'server', 'build', 'data');
    chmodSync(build, 0o555);
    try {
      const r = runDataTool(args(f));
      expect(r.code).toBe(2);
      expect(r.stdout).toEqual([]);
      expect(r.stderr).toHaveLength(1);
      expect(r.stderr[0]).toMatch(/^the generation targets were not written: EACCES/);
    } finally {
      chmodSync(build, 0o755);
    }
    expect(snapshot()).toEqual(before);
  });

  test.skipIf(process.platform !== 'darwin')('a generation target that cannot be replaced after others were: every folder is put back as it was', () => {
    const f = fixture({ files: { 'data/tables/unit.csv': table(['id|id(key)|All', 'hp|int|All'], [['[a]', '1']]) } });
    expect(runDataTool(args(f)).code).toBe(0);
    const folders = ['server/generated/data', 'server/dev/generated/data', 'server/build/data'];
    const snapshot = (): string[] => folders.flatMap((folder) => {
      const dir = join(f.game, folder);
      return readdirSync(dir).sort().map((name) => `${folder}/${name} ${readFileSync(join(dir, name)).toString('hex')}`);
    });
    const before = snapshot();
    writeFiles(f.game, { 'data/tables/unit.csv': table(['id|id(key)|All', 'hp|int|All', 'mp|int|All'], [['[a]', '1', '2']]) });
    // the last folder replaced holds a file that neither a link nor a rename can move
    const locked = join(f.game, 'server', 'build', 'data', 'unit.bin');
    execFileSync('chflags', ['uchg', locked]);
    try {
      const r = runDataTool(args(f));
      expect(r.code).toBe(2);
      expect(r.stderr[0]).toMatch(/^the generation targets were not written: /);
      expect(r.stderr[0]).not.toContain('could not be put back');
    } finally {
      execFileSync('chflags', ['nouchg', locked]);
    }
    expect(snapshot()).toEqual(before);
  });

  test('the built bin/data-tool.js runs alone with node and prints data check lines', () => {
    const work = tempDir();
    const bin = join(work, 'data-tool.js');
    writeFileSync(bin, readFileSync(join(TOOL, 'bin', 'data-tool.js')));
    const f = fixture({ files: { 'data/tables/a.csv': table(['id|id(key)|All', 'n|int|All'], [['[a]', 'x']]) } });
    const bad = spawnSync(process.execPath, [bin, ...args(f)], { cwd: work, encoding: 'utf8' });
    expect(bad.status).toBe(1);
    expect(bad.stdout).toMatch(/^data\/tables\/a\.csv:5:2 ERROR value_type /);
    writeFiles(f.game, { 'data/tables/a.csv': table(['id|id(key)|All', 'n|int|All'], [['[a]', '1']]) });
    execFileSync(process.execPath, [bin, ...args(f)], { cwd: work });
    expect(existsSync(join(f.game, 'server', 'generated', 'data', 'game_data.ts'))).toBe(true);
    expect(spawnSync(process.execPath, [bin], { encoding: 'utf8' }).status).toBe(2);
  });

  test('the core test data folder: a binary build issues into --id-registry and writes next to the folder', () => {
    const impl = tempDir();
    const f = fixture({ files: { 'data/tables/a.csv': table(['id|id(key)|All'], [['[a]']]) } });
    const game = join(impl, 'test-data');
    const baseProto = join(impl, 'proto');
    execFileSync('cp', ['-R', f.game, game]);
    execFileSync('cp', ['-R', f.baseProto, baseProto]);
    const argv = args({ ...f, game, baseProto }, ['--binary']);
    expect(runDataTool(argv).code).toBe(1);
    expect(runDataTool(args({ ...f, game, baseProto })).code).toBe(0);
    writeFileSync(f.registry, '{}');
    const r = runDataTool(argv);
    expect(r.stderr).toEqual([]);
    expect(r.code).toBe(0);
    expect(JSON.parse(readFileSync(f.registry, 'utf8'))).toEqual({ '[a]': 1287278444 });
    expect(existsSync(join(impl, 'server', 'generated', 'data', 'game_data.ts'))).toBe(true);
    expect(existsSync(join(impl, 'server', 'build', 'data', 'a.bin'))).toBe(true);
    expect(existsSync(join(game, 'server'))).toBe(false);
  });

  test('a test-data folder that is not under the parent of the --base-proto folder is a game folder', () => {
    const impl = tempDir();
    mkdirSync(join(impl, 'core-spec'));
    mkdirSync(join(impl, 'proto'));
    const f = fixture({ files: { 'data/tables/a.csv': table(['id|id(key)|All'], [['[a]']]) } });
    const game = join(impl, 'test-data');
    execFileSync('cp', ['-R', f.game, game]);
    expect(runDataTool(args({ ...f, game })).code).toBe(0);
    writeFileSync(f.registry, '{}');
    const r = runDataTool(args({ ...f, game }, ['--binary']));
    expect(r.code).toBe(1);
    expect(r.stderr.join('\n')).toContain('[a]');
    expect(JSON.parse(readFileSync(f.registry, 'utf8'))).toEqual({});
    expect(existsSync(join(game, 'server', 'generated', 'data', 'game_data.ts'))).toBe(true);
    expect(existsSync(join(impl, 'server'))).toBe(false);
  });

  test('requirement cells with a --core-spec that has no requirement table or no RequirementLogic are exit code 2', () => {
    const files = {
      'data/enums.csv': 'type,element,value,#comment\nRequirementType,Level,1,\n',
      'data/requirement_types.csv': 'element,target,value,#comment\nLevel,none,true,\n',
      'data/tables/a.csv': table(['id|id(key)|All', 'r|requirement|All'], [['[a]', 'Level(1)']]),
    };
    const f = fixture({ files });
    expect(runDataTool(args(f)).code).toBe(0);
    writeFileSync(f.coreSpec, JSON.stringify({ version: '0.0.0', modules: [] }));
    const noTable = runDataTool(args(f));
    expect(noTable.code).toBe(2);
    expect(noTable.stderr[0]).toContain('requirement table');
    const spec = { version: '0.0.0', modules: [{ ...REQUIREMENT_MODULE, enums: [] }] };
    writeFileSync(f.coreSpec, JSON.stringify(spec));
    const noLogic = runDataTool(args(f));
    expect(noLogic.code).toBe(2);
    expect(noLogic.stderr[0]).toContain('RequirementLogic');
    const g = fixture({ files: { 'data/tables/a.csv': table(['id|id(key)|All'], [['[a]']]) } });
    writeFileSync(g.coreSpec, JSON.stringify({ version: '0.0.0', modules: [] }));
    expect(runDataTool(args(g)).code).toBe(0);
    expect(readFileSync(join(g.game, 'server', 'generated', 'data', 'game_data.proto'), 'utf8')).not.toContain('RequirementRow');
  });

  test('the stderr reason is one line: a data tool fault gives its error and the frame it was thrown in, not the whole stack', () => {
    const fault = new TypeError('first\nsecond');
    const line = failureLine(fault);
    expect(line).not.toMatch(/[\r\n]/);
    expect(line).toMatch(/^data tool fault: TypeError: first; second \(at .*cli\.test\.ts:\d+:\d+\)$/);
    expect(failureLine('thrown text\n')).toBe('data tool fault: thrown text');
    expect(oneLine(' a \r\n\n b\r c ')).toBe('a; b; c');
    expect(runDataTool(['--game', 'x\ny']).stderr).toEqual(['--base-proto is required']);
  });
});

describe('module checks', () => {
  test('the check of each module of --modules runs and reports data check lines', () => {
    const f = fixture({ files: { 'data/tables/language.csv': table(['id|id(key)|All', 'code|string|All'], [['[ko]', 'ko']]) } });
    const diags = new Diagnostics(false);
    const data = readDataFolder(f.game, ['ko'], 'ko', diags);
    const ctx = { data, diags, settings: { supportedLanguages: ['ko', 'en'] }, requirementRows: [], core: { allTables: new Map() } } as unknown as RunContext;
    const seen: string[] = [];
    const lang: ModuleCheck = (input) => {
      seen.push('LocalizationCore');
      const t = input.data.tables.get('language');
      if (t && t.rows.length !== (input.settings.supportedLanguages as string[]).length) input.report('out_of_range', { file: t.file, line: 1, col: 1 }, 'language code set is not supportedLanguages');
    };
    const other: ModuleCheck = () => { seen.push('other'); };
    runModuleChecks(ctx, new Set(['LocalizationCore']), null, new Map([['LocalizationCore', lang], ['other', other]]));
    expect(seen).toEqual(['LocalizationCore']);
    expect(diags.lines()).toEqual(['data/tables/language.csv:1:1 ERROR out_of_range language code set is not supportedLanguages']);
  });
});
