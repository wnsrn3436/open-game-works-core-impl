/**
 * The Godot client generation targets (`client-core` Godot `### generated code`): GDScript files, the Client build
 * target's data proto and binaries, and the `reserved_name` checks of the Godot generated code.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { runDataTool } from '../src/run.ts';
import { args, enums, fixture, lines, read, specModule, specTable, table, tempDir, writeFiles } from './helpers.ts';

function godot(f: ReturnType<typeof fixture>, extra: string[] = []): ReturnType<typeof runDataTool> {
  return runDataTool(args(f, ['--engine', 'godot', ...extra]));
}

const GODOT_FILES = [
  'client/generated/data/game_data.gd', 'client/generated/data/game_setting.gd', 'client/generated/data/reserved_id.gd',
  'client/generated/data/reserved_string.gd', 'client/generated/data/reserved_sound.gd', 'client/generated/data/game_data.proto',
  'client/dev/generated/data/game_data_dev.gd',
];

const SNAKE = /^[a-z][a-z0-9]*(_[a-z0-9]+)*$/;
const PRIVATE_SNAKE = /^_?[a-z][a-z0-9]*(_[a-z0-9]+)*$/;
const GD_NAME_RULES: readonly { kind: string; at: RegExp; name: RegExp }[] = [
  { kind: 'class variable', at: /^(?:static )?var (\w+)/, name: PRIVATE_SNAKE },
  { kind: 'function', at: /^\s*(?:static )?func (\w+)/, name: PRIVATE_SNAKE },
  { kind: 'constant', at: /^\s*const (\w+)/, name: /^_?[A-Z][A-Z0-9]*(_[A-Z0-9]+)*$/ },
  { kind: 'function variable', at: /^\t+(?:var|for) (\w+)/, name: SNAKE },
];

/** The names of a GDScript text that break the `skills/client-core/engines/godot.md` naming rules (the gdlint name checks). */
function badGdNames(text: string): string[] {
  const bad: string[] = [];
  for (const line of text.split('\n')) {
    for (const rule of GD_NAME_RULES) {
      const name = rule.at.exec(line)?.[1];
      if (name !== undefined && !rule.name.test(name)) bad.push(`${rule.kind} ${name}`);
    }
  }
  return bad;
}

describe('Godot generation targets', () => {
  test('--engine godot writes the GDScript files, the Client data proto and the client binaries', () => {
    const f = fixture({
      files: {
        'data/enums.csv': enums([['Grade', 'Silver', 1], ['Grade', 'Gold', 2]]),
        'data/tables/hero.csv': table(
          ['id|id(key)|All', 'grade|enum<Grade>|All', 'cell|vector2<int>|All', 'grid|array<array<int>>|All', 'secret|int|Server', 'slots|array<{grade: enum<Grade>, count: int}>|Client'],
          [['[a]', 'Gold', '1,2', '1,2\n3', '9', 'Silver 2']],
        ),
        'data/tables/hero_level.csv': table(['id|id|All', 'level|int|All'], [['[a]', '1'], ['[a]', '2']]),
        'data/system/game_setting.csv': table(['id|id(key)|All', 'target|string|None', 'data_type|string|None', 'value|string|All'], [['[max_level]', 'All', 'int', '5'], ['[server_rate]', 'Server', 'int', '3']]),
      },
    });
    const r = godot(f);
    expect(r.stderr).toEqual([]);
    expect(r.code).toBe(0);
    for (const path of GODOT_FILES) expect(existsSync(join(f.game, path))).toBe(true);
    for (const name of ['hero.bin', 'hero_level.bin', 'data_version']) expect(existsSync(join(f.game, 'client/build/data', name))).toBe(true);
    const gd = read(f, 'client/generated/data/game_data.gd');
    expect(gd).toContain('class_name GameData');
    expect(gd).toContain('enum Grade {\n\tNONE = 0,\n\tSILVER = 1,\n\tGOLD = 2,\n}');
    expect(gd).toContain('\tvar grade: Grade = Grade.NONE');
    expect(gd).toContain('\tvar cell: Vector2i = Vector2i.ZERO');
    expect(gd).toContain('\tvar grid: Array[PackedInt32Array] = []');
    expect(gd).toContain('\tvar slots: Array[HeroSlotsItem] = []');
    expect(gd).not.toContain('var secret');
    expect(gd).toContain('static func get_rows(id: int) -> Array[HeroLevelRow]:');
    expect(gd).toContain('static func get_row(id: int) -> HeroRow:');
    expect(gd).toContain('static func load_tables(files: Dictionary[String, PackedByteArray]) -> bool:');
    const setting = read(f, 'client/generated/data/game_setting.gd');
    expect(setting).toContain('static func max_level() -> int:');
    expect(setting).not.toContain('server_rate');
    expect(read(f, 'client/dev/generated/data/game_data_dev.gd')).toContain('static func set_setting_max_level(value: int) -> void:');
    expect(read(f, 'client/generated/data/game_data.proto')).toContain('message HeroRow');
    expect(read(f, 'client/generated/data/game_data.proto')).not.toContain('secret');
    expect(read(f, 'client/build/data/data_version').trim()).toBe(read(f, 'server/build/data/client_data_version').trim());
  });

  test('the generated GDScript names follow the Godot naming rules', () => {
    const f = fixture({
      files: {
        'data/enums.csv': enums([['Grade', 'Silver', 1]]),
        'data/tables/hero.csv': table(['id|id(key)|All', 'grade|enum<Grade>|All', 'cell|vector2<int>|All', 'pos|vector3<float>|All'], [['[a]', 'Silver', '1,2', '1,2,3']]),
        'data/system/game_setting.csv': table(['id|id(key)|All', 'target|string|None', 'data_type|string|None', 'value|string|All'], [
          ['[max_level]', 'All', 'int', '5'], ['[rate]', 'All', 'float', '0.5'], ['[spawn]', 'All', 'vector2<int>', '1,2'],
          ['[aim]', 'All', 'vector3<float>', '1,2,3'], ['[levels]', 'All', 'array<int>', '1,2'], ['[grade]', 'All', 'enum<Grade>', 'Silver'],
        ]),
      },
    });
    const r = godot(f);
    expect(r.stderr).toEqual([]);
    const setting = read(f, 'client/generated/data/game_setting.gd');
    expect(setting).toContain('static func _parse_vector2i(text: String) -> Vector2i:');
    expect(setting).toContain('static func _parse_vector3(text: String) -> Vector3:');
    expect(read(f, 'client/dev/generated/data/game_data_dev.gd')).toContain('\tGameSetting._test_spawn = value');
    for (const path of GODOT_FILES.filter((p) => p.endsWith('.gd'))) expect({ path, bad: badGdNames(read(f, path)) }).toEqual({ path, bad: [] });
  });

  test('without --engine nothing is written under client/', () => {
    const f = fixture({ files: { 'data/tables/hero.csv': table(['id|id(key)|All'], [['[a]']]) } });
    expect(runDataTool(args(f)).code).toBe(0);
    expect(existsSync(join(f.game, 'client'))).toBe(false);
  });

  test('a binary build writes only the client binaries', () => {
    const f = fixture({ files: { 'data/tables/hero.csv': table(['id|id(key)|All'], [['[a]']]) } });
    expect(godot(f).code).toBe(0);
    writeFileSync(join(f.game, 'client/generated/data/game_data.gd'), 'stale');
    const r = godot(f, ['--binary']);
    expect(r.code).toBe(0);
    expect(read(f, 'client/generated/data/game_data.gd')).toBe('stale');
    expect(existsSync(join(f.game, 'client/build/data/hero.bin'))).toBe(true);
  });

  test('the engine meta file of a generated file stays, a file no longer generated goes', () => {
    const f = fixture({ files: { 'data/tables/hero.csv': table(['id|id(key)|All'], [['[a]']]) } });
    expect(godot(f).code).toBe(0);
    writeFiles(f.game, { 'client/generated/data/game_data.gd.uid': 'uid://keep\n', 'client/generated/data/old.gd': 'x', 'client/generated/data/old.gd.uid': 'uid://old\n' });
    expect(godot(f).code).toBe(0);
    expect(read(f, 'client/generated/data/game_data.gd.uid')).toBe('uid://keep\n');
    expect(existsSync(join(f.game, 'client/generated/data/old.gd'))).toBe(false);
    expect(existsSync(join(f.game, 'client/generated/data/old.gd.uid'))).toBe(false);
  });

  test('the core test data writes into the core Godot project', () => {
    const impl = tempDir();
    const f = fixture({ files: { 'data/tables/hero.csv': table(['id|id(key)|All'], [['[a]']]) } });
    const game = join(impl, 'test-data');
    const baseProto = join(impl, 'proto');
    execFileSync('cp', ['-R', f.game, game]);
    execFileSync('cp', ['-R', f.baseProto, baseProto]);
    expect(runDataTool(args({ ...f, game, baseProto })).code).toBe(0);
    writeFileSync(f.registry, '{}');
    const r = runDataTool(args({ ...f, game, baseProto }, ['--engine', 'godot', '--binary']));
    expect(r.stderr).toEqual([]);
    expect(existsSync(join(impl, 'client', 'godot', 'generated', 'data', 'game_data.gd'))).toBe(true);
    expect(existsSync(join(impl, 'client', 'godot', 'build', 'data', 'hero.bin'))).toBe(true);
    expect(existsSync(join(game, 'client'))).toBe(false);
  });
});

describe('reserved_name of the Godot generated code', () => {
  test('a GDScript keyword or RefCounted member column, a Variant or engine class type name, and a client core type name', () => {
    const f = fixture({
      files: {
        'data/enums.csv': enums([['Node', 'A', 1], ['Grade', 'String', 1]]),
        'data/tables/vector3.csv': table(['id|id(key)|All'], [['[v]']]),
        'data/tables/hero.csv': table(['id|id(key)|All', 'script|int|All', 'func|int|All', 'match|int|All'], [['[a]', '1', '2', '3']]),
        'data/tables/fancy_box.csv': table(['id|id(key)|All'], [['[b]']]),
        'client/core/fancy/fancy_core.gd': 'class_name FancyBoxRow\nextends RefCounted\n',
        'client/core/fancy/tests/test_x.gd': 'class_name HeroTable\nextends RefCounted\n',
      },
    });
    const r = godot(f);
    expect(r.code).toBe(1);
    const reserved = lines(r, 'reserved_name').map((l) => l.split(' ').slice(3).join(' '));
    expect(reserved).toEqual(expect.arrayContaining([
      'column name script is a reserved word of the generated code',
      'column name func is a reserved word of the generated code',
      'type name Node is a GDScript or engine name of the Godot generated code',
      'type name FancyBoxRow is a client core type name',
    ]));
    expect(reserved.join('\n')).not.toContain('match');
    expect(reserved.join('\n')).not.toContain('String');
    expect(reserved.join('\n')).not.toContain('HeroTable');
    expect(reserved.some((l) => l.startsWith('table name vector3'))).toBe(false);
    expect(existsSync(join(f.game, 'client', 'generated'))).toBe(false);
  });

  test('without --engine the Godot names pass', () => {
    const f = fixture({ files: { 'data/tables/hero.csv': table(['id|id(key)|All', 'script|int|All'], [['[a]', '1']]) } });
    expect(runDataTool(args(f)).code).toBe(0);
  });

  test('a core table column that is a soft GDScript keyword builds', () => {
    const spec = { version: '0.0.0', modules: [specModule({ name: 'validation', tables: [specTable('banned_word', ['id|id(key)|All', 'word|string|Server', 'match|int|Server'])] })] };
    const f = fixture({ coreSpec: spec, modules: ['validation'] });
    expect(godot(f).stderr).toEqual([]);
  });
});

test('both tools keep the same Godot name lists', () => {
  const here = readFileSync(join(import.meta.dirname, '..', 'src', 'godot-names.ts'), 'utf8');
  const contract = readFileSync(join(import.meta.dirname, '..', '..', 'contract-tool', 'src', 'godot-names.ts'), 'utf8');
  expect(here).toBe(contract);
});
