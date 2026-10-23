/**
 * The Godot client generation targets (`client-core` Godot `### generated code`) and the names the generated GDScript
 * cannot use. The encode and decode round trip in Godot is `tools/tests/godot/test_contract_*.gd`.
 */
import { cpSync, existsSync, mkdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { runTool } from '../src/run.ts';
import { baseContract, BASE_PROTO, CORE_SETTINGS_TEXT, dataProto, HEAD, tempDir, writeFiles } from './helpers.ts';

/** `open-game-works-core-impl/client/godot/core/`: the Godot client core of this core. */
const CLIENT_CORE = resolve(import.meta.dirname, '..', '..', '..', 'client', 'godot', 'core');

const CLIENT_FILES = [
  'client/generated/contract/core_contract.gd', 'client/generated/contract/game_contract.gd',
  'client/dev/generated/contract/core_cheat_contract.gd', 'client/dev/generated/contract/game_cheat_contract.gd',
  'client/dev/generated/contract/contract_json_dev.gd',
];

function game(contract: Record<string, string>, extra: Record<string, string> = {}): string {
  const dir = tempDir();
  const files = Object.fromEntries(Object.entries(contract).map(([k, v]) => [`contract/${k}`, v]));
  writeFiles(dir, { ...files, ...extra, 'core-settings.json': CORE_SETTINGS_TEXT, 'server/generated/data/game_data.proto': dataProto([]) });
  return dir;
}

function run(dir: string, engine: string | null = 'godot'): ReturnType<typeof runTool> {
  return runTool(['--game', dir, '--base-proto', BASE_PROTO, '--core-settings', join(dir, 'core-settings.json'), ...(engine === null ? [] : ['--engine', engine])]);
}

function text(dir: string, path: string): string {
  return readFileSync(join(dir, path), 'utf8');
}

const CHEAT = `syntax = "proto3";
package game;

import "ogw/options.proto";

service Cheat {
  // gold를 준다
  // changes: WalletUserState
  rpc AddGold(AddGoldRequest) returns (AddGoldResponse);
}

message AddGoldRequest {
  int32 amount = 1 [(ogw.v) = {min: 1, max: 100}];
}

message AddGoldResponse {
}
`;

const SERVER_STATE = 'syntax = "proto3";\npackage game;\n\n// 판정용\nmessage SeedServerState {\n  int64 seed = 1;\n}\n';

describe('Godot generation targets', () => {
  it('writes the client and client DEV files with --engine godot', () => {
    const dir = game({ ...baseContract(), 'cheat.proto': CHEAT, 'server_state.proto': SERVER_STATE });
    const result = run(dir);
    expect(result.stdout).toBe('');
    expect(result.code).toBe(0);
    for (const path of CLIENT_FILES) expect(existsSync(join(dir, path))).toBe(true);
    const gameGd = text(dir, 'client/generated/contract/game_contract.gd');
    expect(gameGd).toContain('class_name GameContract\nextends RefCounted');
    expect(gameGd).toContain('class SpendRequest extends ContractRequest:');
    expect(gameGd).toContain('\t\treturn "Spend"');
    expect(gameGd).toContain('class WalletUserState extends ContractMessage:');
    expect(gameGd).toContain('\t\tContractKind.new("WalletUserState", WalletUserState, false),');
    expect(gameGd).toContain('static func core_errors(request_name: String) -> PackedInt32Array:');
    // a server state kind is not in the client type set
    expect(gameGd).not.toContain('SeedServerState');
    const cheatGd = text(dir, 'client/dev/generated/contract/game_cheat_contract.gd');
    expect(cheatGd).toContain('class AddGoldRequest extends ContractRequest:');
    expect(cheatGd).toContain('\t\treturn "cheat/AddGold"');
    const coreGd = text(dir, 'client/generated/contract/core_contract.gd');
    expect(coreGd).toContain('class_name CoreContract');
    expect(coreGd).toContain('class ItemAmount extends ContractMessage:');
    expect(coreGd).toContain('\t\treturn "core/Login"');
    const json = text(dir, 'client/dev/generated/contract/contract_json_dev.gd');
    expect(json).toContain('static func to_json(message: ContractMessage) -> String:');
    expect(json).toContain('if message is GameContract.WalletUserState:');
  });

  it('maps every proto field type to its GDScript type', () => {
    const userState = `syntax = "proto3";
package game;

message KitUserState {
  int64 id = 1;
  int32 a = 2;
  float b = 3;
  double c = 4;
  bool d = 5;
  string e = 6;
  bytes f = 7;
  Shape g = 8;
  Part h = 9;
  repeated int32 i = 10;
  repeated int64 j = 11;
  repeated float k = 12;
  repeated double l = 13;
  repeated bool m = 14;
  repeated string n = 15;
  repeated bytes o = 16;
  repeated Shape p = 17;
  repeated Part q = 18;
}

enum Shape {
  SHAPE_UNSPECIFIED = 0;
  SHAPE_ROUND = 1;
}

message Part {
  int32 size = 1;
}
`;
    const dir = game({ ...baseContract(), 'user_state.proto': userState });
    expect(run(dir).code).toBe(0);
    const gd = text(dir, 'client/generated/contract/game_contract.gd');
    for (const line of [
      'var id: int = 0', 'var a: int = 0', 'var b: float = 0.0', 'var c: float = 0.0', 'var d: bool = false', 'var e: String = ""',
      'var f: PackedByteArray = PackedByteArray()', 'var g: Shape = Shape.SHAPE_UNSPECIFIED', 'var h: Part = null',
      'var i: PackedInt32Array = PackedInt32Array()', 'var j: PackedInt64Array = PackedInt64Array()', 'var k: PackedFloat32Array = PackedFloat32Array()',
      'var l: PackedFloat64Array = PackedFloat64Array()', 'var m: Array[bool] = []', 'var n: PackedStringArray = PackedStringArray()',
      'var o: Array[PackedByteArray] = []', 'var p: PackedInt32Array = PackedInt32Array()', 'var q: Array[Part] = []',
    ]) expect(gd).toContain(`\t${line}\n`);
    expect(gd).toContain('enum Shape {\n\tSHAPE_UNSPECIFIED = 0,\n\tSHAPE_ROUND = 1,\n}');
    expect(gd).toContain('\t\tContractKind.new("KitUserState", KitUserState, true),');
  });

  it('follows the GDScript name rules: snake_case functions and function-scope variables, no leading _ on a variable', () => {
    const dir = game({ ...baseContract(), 'cheat.proto': CHEAT });
    expect(run(dir).code).toBe(0);
    for (const path of CLIENT_FILES) {
      const gd = text(dir, path);
      for (const [, name] of gd.matchAll(/^\s*(?:static )?func ([A-Za-z0-9_]+)\(/gm)) expect(name, path).toMatch(/^_?[a-z][a-z0-9]*(?:_[a-z0-9]+)*$/);
      for (const [, name] of gd.matchAll(/^\t\t+var ([A-Za-z0-9_]+)/gm)) expect(name, path).toMatch(/^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$/);
    }
    const json = text(dir, 'client/dev/generated/contract/contract_json_dev.gd');
    expect(json).toContain('\t\treturn _text_game_contract_wallet_user_state(message as GameContract.WalletUserState)');
    expect(json).toContain('static func _read_core_contract_item_amount(m: CoreContract.ItemAmount, data: Variant) -> bool:');
  });

  it('gives the method variables of a message names that are not its field names', () => {
    const userState = `syntax = "proto3";
package game;

message KitUserState {
  int64 id = 1;
  int32 out = 2;
  int32 other = 3;
  int32 reader = 4;
  int32 tag = 5;
  int32 wire = 6;
  repeated Part item = 7;
  int32 item_2 = 8;
}

message Part {
  int32 size = 1;
}
`;
    const dir = game({ ...baseContract(), 'user_state.proto': userState });
    expect(run(dir).code).toBe(0);
    const gd = text(dir, 'client/generated/contract/game_contract.gd');
    const kit = gd.slice(gd.indexOf('class KitUserState'), gd.indexOf('class Part'));
    for (const line of [
      '\t\tvar out_2: PackedByteArray = PackedByteArray()', '\t\t_put_int32(out_2, 2, out)', '\t\tfor item_3: Part in item:',
      '\t\tvar other_2: KitUserState = _source as KitUserState', '\t\ttag = other_2.tag',
      '\t\tvar reader_2: ContractMessage._WireReader = ContractMessage._WireReader.new(_bytes)', '\t\t\tvar tag_2: int = reader_2.tag()',
      '\t\t\tvar wire_2: int = tag_2 & 7', '\t\t\tmatch tag_2 >> 3:', '\t\t\t\t\tvar item_3: Part = Part.new()', '\t\t\t\t\titem.append(item_3)',
      '\t\t\t\t\twire = reader_2.int32(wire_2)',
    ]) expect(kit).toContain(line);
  });

  it('writes nothing under client/ without --engine', () => {
    const dir = game(baseContract());
    expect(run(dir, null).code).toBe(0);
    expect(existsSync(join(dir, 'client'))).toBe(false);
  });

  it('keeps the engine meta file of a generated file and drops a file no longer generated', () => {
    const dir = game(baseContract());
    expect(run(dir).code).toBe(0);
    writeFiles(dir, {
      'client/generated/contract/game_contract.gd.uid': 'uid://keep\n',
      'client/generated/contract/old.gd': 'x',
      'client/generated/contract/old.gd.uid': 'uid://old\n',
    });
    expect(run(dir).code).toBe(0);
    expect(text(dir, 'client/generated/contract/game_contract.gd.uid')).toBe('uid://keep\n');
    expect(existsSync(join(dir, 'client/generated/contract/old.gd'))).toBe(false);
    expect(existsSync(join(dir, 'client/generated/contract/old.gd.uid'))).toBe(false);
  });

  it('the core test data writes into the core Godot project', () => {
    const impl = tempDir();
    mkdirSync(join(impl, 'proto', 'ogw'), { recursive: true });
    for (const name of ['core.proto', 'options.proto']) writeFiles(impl, { [`proto/ogw/${name}`]: readFileSync(join(BASE_PROTO, 'ogw', name), 'utf8') });
    const contract = Object.fromEntries(Object.entries(baseContract()).map(([k, v]) => [`test-data/contract/${k}`, v]));
    writeFiles(impl, { ...contract, 'core-settings.json': CORE_SETTINGS_TEXT });
    const result = runTool(['--game', join(impl, 'test-data'), '--engine', 'godot', '--base-proto', join(impl, 'proto'), '--core-settings', join(impl, 'core-settings.json')]);
    expect(result.stderr).toBe('');
    expect(existsSync(join(impl, 'client', 'godot', 'generated', 'contract', 'game_contract.gd'))).toBe(true);
    expect(existsSync(join(impl, 'test-data', 'client'))).toBe(false);
  });
});

describe('names the Godot generated code cannot use', () => {
  const userState = (body: string): string => `syntax = "proto3";\npackage game;\n\n${body}`;

  it('a GDScript keyword, a Variant type, an engine class or a global enum as a message or enum name', () => {
    const dir = game({ ...baseContract(), 'user_state.proto': userState('message Node {\n}\n\nmessage Vector2 {\n}\n\nenum Side {\n  SIDE_UNSPECIFIED = 0;\n}\n\nmessage ContractKind {\n}\n') });
    const result = run(dir);
    expect(result.code).toBe(1);
    for (const name of ['message name Node', 'message name Vector2', 'enum name Side', 'message name ContractKind']) {
      expect(result.stdout).toContain(`${name} is a name the generated GDScript uses`);
    }
    expect(existsSync(join(dir, 'client'))).toBe(false);
    expect(run(dir, null).code).toBe(0);
  });

  it('a field name that is a GDScript keyword or a member of the message classes', () => {
    const dir = game({ ...baseContract(), 'user_state.proto': userState('message KitUserState {\n  int32 script = 1;\n  int32 decode = 2;\n  int32 func = 3;\n  int32 match = 4;\n}\n') });
    const result = run(dir);
    expect(result.code).toBe(1);
    for (const name of ['script', 'decode', 'func']) expect(result.stdout).toContain(`field name ${name} is a name the generated GDScript uses`);
    expect(result.stdout).not.toContain('field name match');
  });

  it('a game message or enum named like a client core type; a class in tests/ is not one', () => {
    const extra = {
      'client/core/fancy_core/fancy_core.gd': 'class_name FancyCore\nextends RefCounted\n',
      'client/core/fancy_core/dev/fancy_core_dev.gd': 'class_name FancyCoreDev\nextends RefCounted\n',
      'client/core/fancy_core/tests/test_fancy.gd': 'class_name FancyTest\nextends RefCounted\n',
    };
    const dir = game({ ...baseContract(), 'user_state.proto': userState('message FancyCore {\n}\n\nmessage FancyCoreDev {\n}\n\nmessage FancyTest {\n}\n') }, extra);
    const result = run(dir);
    expect(result.code).toBe(1);
    expect(result.stdout).toContain('message name FancyCore is a client core type name');
    expect(result.stdout).toContain('message name FancyCoreDev is a client core type name');
    expect(result.stdout).not.toContain('FancyTest');
  });

  it('a base proto message or enum named like a client core type', () => {
    const extra = {
      'client/core/analytics_core/analytics_event.gd': 'class_name AnalyticsEvent\nextends RefCounted\n',
      'client/core/item_core/item_change_source.gd': 'class_name ItemChangeSource\nextends RefCounted\n',
    };
    const dir = game({ ...baseContract(), 'service.proto': `${HEAD}\nservice Game {\n}\n` }, extra);
    const result = run(dir);
    expect(result.code).toBe(1);
    const core = readFileSync(join(BASE_PROTO, 'ogw', 'core.proto'), 'utf8').split('\n');
    const lineOf = (declaration: string): string => String(core.indexOf(declaration) + 1);
    const lines = result.stdout.split('\n');
    expect(lines.find((l) => l.includes('message name AnalyticsEvent is a client core type name'))).toMatch(new RegExp(`core\\.proto:${lineOf('message AnalyticsEvent {')}:\\d+ ERROR `));
    expect(lines.find((l) => l.includes('enum name ItemChangeSource is a client core type name'))).toMatch(new RegExp(`core\\.proto:${lineOf('enum ItemChangeSource {')}:\\d+ ERROR `));
    expect(existsSync(join(dir, 'client', 'generated'))).toBe(false);
  });

  it('the base proto of this core passes with the client core type names of this core', () => {
    const dir = game({ ...baseContract(), 'service.proto': `${HEAD}\nservice Game {\n}\n` });
    cpSync(CLIENT_CORE, join(dir, 'client', 'core'), { recursive: true, filter: (src) => statSync(src).isDirectory() || src.endsWith('.gd') });
    const result = run(dir);
    expect(result.stdout).toBe('');
    expect(result.code).toBe(0);
  });

  it('the base proto of this core passes', () => {
    const dir = game({ ...baseContract(), 'service.proto': `${HEAD}\nservice Game {\n}\n` });
    expect(run(dir).stdout).toBe('');
  });
});
