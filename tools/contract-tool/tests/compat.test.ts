/** Backward compatibility with the last PROD build (`--previous`), contract version, and `--base-proto-only`. */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { runTool } from '../src/run.ts';
import { baseContract, BASE_PROTO, CORE_SETTINGS_TEXT, HEAD, OPTIONS_PROTO_PATH, runGame, tempDir, writeFiles } from './helpers.ts';

/** A previous contract with more in it than `baseContract()`. */
function richer(): Record<string, string> {
  const contract = baseContract();
  contract['service.proto'] = `${HEAD}
option (ogw.core_errors) = "StartPlay:GAME_ERROR_NOT_ENOUGH_GOLD";

service Game {
  // gold를 쓴다
  // changes: WalletUserState
  rpc Spend(SpendRequest) returns (SpendResponse) {
    option (ogw.retry) = true;
    option (ogw.errors) = "GAME_ERROR_NOT_ENOUGH_GOLD";
  }
  // 조회
  // changes: none
  rpc Look(LookRequest) returns (LookResponse) {
    option (ogw.silent) = true;
  }
}

message SpendRequest {
  int32 amount = 1 [(ogw.v) = {min: 1, max: 100}];
  string note = 2 [(ogw.v) = {max_len: 20}];
  repeated int32 slot_ids = 3 [(ogw.v) = {max_count: 5, min: 0, max: 9}];
}

message SpendResponse {
}

message LookRequest {
}

message LookResponse {
}
`;
  return contract;
}

const CORE = `syntax = "proto3";
package ogw.core;

import "ogw/options.proto";

service Core {
  // play
  // changes: content
  rpc StartPlay(StartPlayRequest) returns (StartPlayResponse) {
    option (ogw.retry) = true;
  }
}

message StartPlayRequest {
  string token = 1 [(ogw.v) = {max_len_key: "play.tokenMaxLength"}];
}

message StartPlayResponse {
}

enum ItemChangeSource {
  ITEM_CHANGE_SOURCE_UNSPECIFIED = 0;
  ITEM_CHANGE_SOURCE_SHOP = 1;
}
`;

/** `CORE` with a second core `rpc`, for a `(ogw.core_errors)` option added for it. */
const CORE_TWO_RPCS = `${CORE.replace('    option (ogw.retry) = true;\n  }\n', '    option (ogw.retry) = true;\n  }\n  // end\n  // changes: none\n  rpc EndPlay(EndPlayRequest) returns (EndPlayResponse);\n')}
message EndPlayRequest {
}

message EndPlayResponse {
}
`;

const SETTINGS = { 'play.tokenMaxLength': 64 };

interface Pair {
  readonly name: string;
  readonly current: Record<string, string>;
  readonly error: string;
  readonly coreProto?: string;
  readonly settings?: Record<string, unknown>;
  /** Previous contract in place of `previousContract()`. */
  readonly previous?: Record<string, string>;
}

/** `richer()` with replacements: [file, from, to] each. */
function richerEdits(...edits: readonly (readonly [string, string | RegExp, string])[]): Record<string, string> {
  const contract = richer();
  for (const [file, from, to] of edits) {
    const text = contract[file] ?? '';
    if (typeof from === 'string' ? !text.includes(from) : !from.test(text)) throw new Error(`case setup: ${String(from)} not in ${file}`);
    contract[file] = text.replace(from, to);
  }
  return contract;
}

function richerEdit(file: string, from: string, to: string): Record<string, string> {
  return richerEdits([file, from, to]);
}

function withPublicWallet(contract: Record<string, string>): Record<string, string> {
  return { ...contract, 'user_state.proto': `${HEAD}\n// 지갑\nmessage WalletUserState {\n  option (ogw.public) = true;\n  int64 gold = 1;\n}\n` };
}

const breaking: Pair[] = [
  { name: 'rpc removed', current: richerEdit('service.proto', '  // 조회\n  // changes: none\n  rpc Look(LookRequest) returns (LookResponse) {\n    option (ogw.silent) = true;\n  }\n', ''), error: 'rpc Look of service Game was removed or renamed' },
  { name: 'message removed', current: richerEdits(['service.proto', 'message LookResponse {\n}\n', ''], ['service.proto', 'returns (LookResponse)', 'returns (SpendResponse)']), error: 'message LookResponse was removed or renamed' },
  { name: 'field removed', current: richerEdit('service.proto', '  string note = 2 [(ogw.v) = {max_len: 20}];\n', ''), error: 'field 2 note of SpendRequest was removed' },
  { name: 'field renamed', current: richerEdit('service.proto', 'string note = 2', 'string memo = 2'), error: 'field 2 of SpendRequest was renamed from note to memo' },
  { name: 'field number changed', current: richerEdit('service.proto', 'string note = 2', 'string note = 4'), error: 'field note of SpendRequest changed its number 2' },
  { name: 'field type changed', current: richerEdit('service.proto', 'int32 amount = 1 [(ogw.v) = {min: 1, max: 100}];', 'int64 amount = 1 [(ogw.v) = {min: 1, max: 100}];'), error: 'field amount of SpendRequest changed its type from int32 to int64' },
  { name: 'field made repeated', current: richerEdit('service.proto', 'string note = 2 [(ogw.v) = {max_len: 20}];', 'repeated string note = 2 [(ogw.v) = {max_len: 20, max_count: 2}];'), error: 'changed its type from string to repeated string' },
  { name: 'enum value removed', current: richerEdits(['error.proto', '  GAME_ERROR_NOT_ENOUGH_GOLD = 1000;\n', '  GAME_ERROR_OTHER = 1001;\n'], ['service.proto', /GAME_ERROR_NOT_ENOUGH_GOLD/g, 'GAME_ERROR_OTHER']), error: 'enum value GAME_ERROR_NOT_ENOUGH_GOLD of GameError was removed or renamed' },
  { name: 'enum value number changed', current: richerEdit('error.proto', '= 1000', '= 1001'), error: 'changed its number from 1000 to 1001' },
  { name: 'request type changed', current: richerEdit('service.proto', 'rpc Look(LookRequest) returns (LookResponse)', 'rpc Look(LookRequest) returns (SpendResponse)'), error: 'rpc Look changed its request or response type' },
  { name: 'silent added', current: richerEdit('service.proto', '    option (ogw.retry) = true;\n    option (ogw.errors)', '    option (ogw.retry) = true;\n    option (ogw.silent) = true;\n    option (ogw.errors)'), error: 'rpc Spend changed (ogw.silent)' },
  { name: 'silent changed', current: richerEdit('service.proto', '    option (ogw.silent) = true;\n', ''), error: 'rpc Look changed (ogw.silent)' },
  { name: 'retry removed', current: richerEdit('service.proto', '// changes: WalletUserState\n  rpc Spend(SpendRequest) returns (SpendResponse) {\n    option (ogw.retry) = true;\n', '// changes: none\n  rpc Spend(SpendRequest) returns (SpendResponse) {\n'), error: 'rpc Spend removed (ogw.retry)' },
  { name: 'errors name removed', current: richerEdit('service.proto', '    option (ogw.errors) = "GAME_ERROR_NOT_ENOUGH_GOLD";\n', ''), error: 'rpc Spend removed GAME_ERROR_NOT_ENOUGH_GOLD from (ogw.errors)' },
  { name: 'core_errors name removed', current: richerEdit('service.proto', 'option (ogw.core_errors) = "StartPlay:GAME_ERROR_NOT_ENOUGH_GOLD";\n', ''), error: '(ogw.core_errors) of StartPlay removed GAME_ERROR_NOT_ENOUGH_GOLD' },
  { name: 'max narrowed', current: richerEdit('service.proto', '{min: 1, max: 100}', '{min: 1, max: 99}'), error: 'field amount of SpendRequest narrows validation: max' },
  { name: 'min raised', current: richerEdit('service.proto', '{min: 1, max: 100}', '{min: 2, max: 100}'), error: 'narrows validation: min' },
  { name: 'max_len narrowed', current: richerEdit('service.proto', '{max_len: 20}', '{max_len: 19}'), error: 'narrows validation: max_len' },
  { name: 'max_chars added', current: richerEdit('service.proto', '{max_len: 20}', '{max_len: 20, max_chars: 10}'), error: 'narrows validation: max_chars' },
  { name: 'max_count narrowed', current: richerEdit('service.proto', '{max_count: 5, min: 0, max: 9}', '{max_count: 4, min: 0, max: 9}'), error: 'narrows validation: max_count' },
  { name: 'min_count added', current: richerEdit('service.proto', '{max_count: 5, min: 0, max: 9}', '{min_count: 1, max_count: 5, min: 0, max: 9}'), error: 'field slot_ids of SpendRequest narrows validation: min_count' },
  { name: 'table added to an existing field', current: richerEdit('service.proto', '{min: 1, max: 100}', '{table: "quest"}'), error: 'field amount of SpendRequest narrows validation: table' },
  {
    name: 'table changed',
    previous: withPublicWallet(richerEdit('service.proto', '  repeated int32 slot_ids', '  int32 quest_id = 4 [(ogw.v) = {table: "quest"}];\n  repeated int32 slot_ids')),
    current: richerEdit('service.proto', '  repeated int32 slot_ids', '  int32 quest_id = 4 [(ogw.v) = {table: "stage"}];\n  repeated int32 slot_ids'),
    error: 'field quest_id of SpendRequest narrows validation: table',
  },
  { name: 'unique added', current: richerEdit('service.proto', '{max_count: 5, min: 0, max: 9}', '{max_count: 5, min: 0, max: 9, unique: true}'), error: 'narrows validation: unique' },
  { name: 'new field with table', current: richerEdit('service.proto', '  repeated int32 slot_ids', '  int32 quest_id = 4 [(ogw.v) = {table: "quest"}];\n  repeated int32 slot_ids'), error: 'new field quest_id of existing message SpendRequest has a default value that fails validation' },
  { name: 'new field with min above 0', current: richerEdit('service.proto', '  repeated int32 slot_ids', '  int32 level = 4 [(ogw.v) = {min: 1, max: 9}];\n  repeated int32 slot_ids'), error: 'new field level of existing message SpendRequest' },
  { name: 'new field with max below 0', current: richerEdit('service.proto', '  repeated int32 slot_ids', '  int32 debt = 4 [(ogw.v) = {min: -9, max: -1}];\n  repeated int32 slot_ids'), error: 'new field debt of existing message SpendRequest' },
  { name: 'new field with min_count', current: richerEdit('service.proto', '  repeated int32 slot_ids', '  repeated int32 picks = 4 [(ogw.v) = {min_count: 1, max_count: 3, min: 0, max: 9}];\n  repeated int32 slot_ids'), error: 'new field picks of existing message SpendRequest' },
  {
    name: 'public removed',
    current: { ...richer(), 'user_state.proto': 'syntax = "proto3";\npackage game;\n\n// 지갑\nmessage WalletUserState {\n  int64 gold = 1;\n}\n' },
    error: '(ogw.public) was removed from WalletUserState',
  },
  { name: 'base proto narrowed by core settings', current: richer(), settings: { 'play.tokenMaxLength': 32 }, error: 'field token of StartPlayRequest narrows validation: max_len' },
  { name: 'base proto enum value removed', current: richer(), coreProto: CORE.replace('  ITEM_CHANGE_SOURCE_SHOP = 1;\n', ''), error: 'enum value ITEM_CHANGE_SOURCE_SHOP of ItemChangeSource was removed or renamed' },
];

/** Previous contract: `richer()` with a public wallet kind. */
function previousContract(): Record<string, string> {
  return withPublicWallet(richer());
}

describe('backward compatibility', () => {
  it('an unchanged contract passes and keeps the contract version', () => {
    const run = runGame({ contract: previousContract(), coreProto: CORE, settings: SETTINGS, previous: { contract: previousContract(), coreProto: CORE, version: 3 } });
    expect(run.stdout).toBe('');
    expect(run.code).toBe(0);
    expect(readFileSync(join(run.game, 'server/generated/contract/contract_version'), 'utf8')).toBe('3\n');
  });

  it('compatible changes pass', () => {
    const current = previousContract();
    current['service.proto'] = (current['service.proto'] ?? '')
      .replace('{min: 1, max: 100}', '{min: 0, max: 1000}')
      .replace('{max_len: 20}', '{max_len: 40}')
      .replace('    option (ogw.silent) = true;\n', '    option (ogw.silent) = true;\n    option (ogw.sensitive) = true;\n')
      .replace('  repeated int32 slot_ids', '  int32 bonus = 4 [(ogw.v) = {min: 0, max: 9}];\n  string memo = 5 [(ogw.v) = {max_len: 9}];\n  repeated int32 slot_ids')
      .replace('message LookResponse {\n}', 'message LookResponse {\n}\n\nmessage Extra {\n  int32 count = 1;\n}');
    current['error.proto'] = (current['error.proto'] ?? '').replace('= 1000;', '= 1000;\n  GAME_ERROR_TOO_MANY = 1001;');
    current['service.proto'] = current['service.proto']
      .replace('"GAME_ERROR_NOT_ENOUGH_GOLD";\n  }', '"GAME_ERROR_NOT_ENOUGH_GOLD,GAME_ERROR_TOO_MANY";\n  }')
      .replace('    option (ogw.silent) = true;\n', '    option (ogw.silent) = true;\n    option (ogw.retry) = true;\n')
      .replace('"StartPlay:GAME_ERROR_NOT_ENOUGH_GOLD";', '"StartPlay:GAME_ERROR_NOT_ENOUGH_GOLD,GAME_ERROR_TOO_MANY";\noption (ogw.core_errors) = "EndPlay:GAME_ERROR_TOO_MANY";');
    const run = runGame({ contract: current, coreProto: CORE_TWO_RPCS, settings: { 'play.tokenMaxLength': 128 }, previous: { contract: previousContract(), coreProto: CORE_TWO_RPCS, settings: SETTINGS, version: 2 } });
    expect(run.stdout).toBe('');
    expect(run.code).toBe(0);
    expect(readFileSync(join(run.game, 'server/generated/contract/contract_version'), 'utf8')).toBe('2\n');
    const game = readFileSync(join(run.game, 'server/generated/contract/game_contract.ts'), 'utf8');
    expect(game).toContain("['core/StartPlay', [GameError.GAME_ERROR_NOT_ENOUGH_GOLD, GameError.GAME_ERROR_TOO_MANY]]");
    expect(game).toContain("['core/EndPlay', [GameError.GAME_ERROR_TOO_MANY]]");
  });

  it('(ogw.public) added to a kind and a new UserState kind pass', () => {
    const current = withPublicWallet(richer());
    current['user_state.proto'] = `${current['user_state.proto'] ?? ''}\n// 가방\nmessage BagUserState {\n  int64 id = 1;\n  int32 size = 2;\n}\n`;
    const run = runGame({ contract: current, coreProto: CORE, settings: SETTINGS, previous: { contract: richer(), coreProto: CORE, version: 2 } });
    expect(run.stdout).toBe('');
    expect(run.code).toBe(0);
    expect(readFileSync(join(run.game, 'server/generated/contract/contract_version'), 'utf8')).toBe('3\n');
  });

  it('a changed kind raises the contract version', () => {
    const current = previousContract();
    current['user_state.proto'] = (current['user_state.proto'] ?? '').replace('int64 gold = 1;', 'int64 gold = 1;\n  int64 gem = 2;');
    const run = runGame({ contract: current, coreProto: CORE, settings: SETTINGS, previous: { contract: previousContract(), coreProto: CORE, version: 2 } });
    expect(run.code, run.stdout).toBe(0);
    expect(readFileSync(join(run.game, 'server/generated/contract/contract_version'), 'utf8')).toBe('3\n');
  });

  describe('a change in what a kind reaches raises the contract version', () => {
    const wallet = `${HEAD}
// 지갑
message WalletUserState {
  int64 gold = 1 [(ogw.v) = {min: 0, max: 100}];
  Purse purse = 2;
  PurseKind kind = 3;
}

// 지갑 안의 주머니
message Purse {
  int64 amount = 1;
}

enum PurseKind {
  PURSE_KIND_UNSPECIFIED = 0;
  PURSE_KIND_SMALL = 1;
}
`;
    const versionAfter = (userState: string): string => {
      const prev = { ...baseContract(), 'user_state.proto': wallet };
      const run = runGame({ contract: { ...baseContract(), 'user_state.proto': userState }, previous: { contract: prev, version: 2 } });
      expect(run.code, run.stdout).toBe(0);
      return readFileSync(join(run.game, 'server/generated/contract/contract_version'), 'utf8');
    };
    const edit = (from: string, to: string): string => {
      if (!wallet.includes(from)) throw new Error(`case setup: ${from} not in user_state.proto`);
      return wallet.replace(from, to);
    };

    it('unchanged keeps it', () => {
      expect(versionAfter(wallet)).toBe('2\n');
    });
    it('a field added to a message the kind reaches', () => {
      expect(versionAfter(edit('  int64 amount = 1;', '  int64 amount = 1;\n  int64 limit = 2;'))).toBe('3\n');
    });
    it('a value added to an enum the kind reaches', () => {
      expect(versionAfter(edit('  PURSE_KIND_SMALL = 1;', '  PURSE_KIND_SMALL = 1;\n  PURSE_KIND_LARGE = 2;'))).toBe('3\n');
    });
    it('deprecated on an enum the kind reaches', () => {
      expect(versionAfter(edit('enum PurseKind {', 'enum PurseKind {\n  option deprecated = true;'))).toBe('3\n');
    });
    it('deprecated on a value of an enum the kind reaches', () => {
      expect(versionAfter(edit('  PURSE_KIND_SMALL = 1;', '  PURSE_KIND_SMALL = 1 [deprecated = true];'))).toBe('3\n');
    });
    it('a changed (ogw.v) on a kind field', () => {
      expect(versionAfter(edit('{min: 0, max: 100}', '{min: 0, max: 200}'))).toBe('3\n');
    });
  });

  it('a new rpc may reuse an existing message that no request reached, without the checks for existing validated messages', () => {
    const prev = baseContract();
    prev['service.proto'] = `${prev['service.proto'] ?? ''}\nmessage Detail {\n  int32 count = 1;\n}\n`;
    const current = baseContract();
    current['service.proto'] = (current['service.proto'] ?? '').replace('  }\n}\n', '  }\n  // 조회\n  // changes: none\n  rpc Look(LookRequest) returns (LookResponse);\n}\n') + `
message LookRequest {
  Detail detail = 1;
}

message LookResponse {
}

message Detail {
  int32 count = 1 [(ogw.v) = {min: 0, max: 9}];
  int32 quest_id = 2 [(ogw.v) = {table: "quest"}];
}
`;
    const run = runGame({ contract: current, tables: ['quest'], previous: { contract: prev, version: 1 } });
    expect(run.stdout).toBe('');
    expect(run.code).toBe(0);
  });

  it('converters.json follows the order of GameContract.KINDS', () => {
    const contract = baseContract();
    contract['user_state.proto'] = (contract['user_state.proto'] ?? '').replace('package game;\n', 'package game;\n\nimport "ogw/options.proto";\n')
      .replace('message WalletUserState {\n', 'message WalletUserState {\n  option (ogw.converters) = 1;\n');
    contract['server_state.proto'] = `${HEAD}\n// 시드\nmessage SeedServerState {\n  option (ogw.converters) = 1;\n  int64 seed = 1;\n}\n`;
    contract['game_state.proto'] = `${HEAD}\n// 공동 boss\nmessage BossGameState {\n  option (ogw.converters) = 1;\n  int64 key = 1;\n}\n`;
    const run = runGame({ contract, previous: { contract, version: 2 } });
    expect(run.code, run.stdout).toBe(0);
    const kinds = [...readFileSync(join(run.game, 'server/generated/contract/game_contract.ts'), 'utf8').matchAll(/\{ name: '(\w+)', kind_class:/g)].map((m) => m[1]);
    const listed = (JSON.parse(readFileSync(join(run.game, 'server/generated/contract/converters.json'), 'utf8')) as { kind: string }[]).map((c) => c.kind);
    expect(listed).toEqual(['WalletUserState', 'SeedServerState', 'BossGameState']);
    expect(listed).toEqual(kinds);
  });

  it('a comment and a converter do not change the contract version, and converters are listed', () => {
    const current = previousContract();
    current['user_state.proto'] = (current['user_state.proto'] ?? '').replace('  int64 gold = 1;', '  option (ogw.converters) = 1;\n  // 보유 gold\n  int64 gold = 1;');
    const run = runGame({ contract: current, coreProto: CORE, settings: SETTINGS, previous: { contract: previousContract(), coreProto: CORE, version: 2 } });
    expect(run.code, run.stdout).toBe(0);
    expect(readFileSync(join(run.game, 'server/generated/contract/contract_version'), 'utf8')).toBe('2\n');
    expect(JSON.parse(readFileSync(join(run.game, 'server/generated/contract/converters.json'), 'utf8'))).toEqual([{ kind: 'WalletUserState', from_version: 1 }]);
  });

  it('a removed converter breaks compatibility', () => {
    const prev = previousContract();
    prev['user_state.proto'] = (prev['user_state.proto'] ?? '').replace('  int64 gold = 1;', '  option (ogw.converters) = 1;\n  int64 gold = 1;');
    const run = runGame({ contract: previousContract(), coreProto: CORE, settings: SETTINGS, previous: { contract: prev, coreProto: CORE, version: 2 } });
    expect(run.code).toBe(1);
    expect(run.stdout).toContain('(ogw.converters) 1 was removed from WalletUserState');
  });

  for (const pair of breaking) {
    it(`breaks: ${pair.name}`, () => {
      const run = runGame({
        contract: pair.current, coreProto: pair.coreProto ?? CORE, settings: pair.settings ?? SETTINGS, tables: ['quest', 'stage'],
        previous: { contract: pair.previous ?? previousContract(), coreProto: CORE, settings: SETTINGS, version: 1 },
      });
      expect(run.code, run.stdout + run.stderr).toBe(1);
      expect(run.lines.some((l) => /^[^:]+:\d+:\d+ ERROR /.test(l) && l.includes(pair.error)), `no "${pair.error}" in:\n${run.stdout}`).toBe(true);
    });
  }

  it('a previous folder without contract_version is an input failure', () => {
    const run = runGame({ contract: baseContract(), previous: { contract: baseContract(), version: 1 } });
    expect(run.code).toBe(0);
    const prev = tempDir();
    writeFiles(prev, { 'core-settings.json': CORE_SETTINGS_TEXT, 'proto/ogw/core.proto': readFileSync(join(BASE_PROTO, 'ogw/core.proto'), 'utf8'), 'proto/ogw/options.proto': readFileSync(OPTIONS_PROTO_PATH, 'utf8') });
    const settings = join(prev, 'core-settings.json');
    const result = runTool(['--game', run.game, '--base-proto', BASE_PROTO, '--core-settings', settings, '--previous', prev]);
    expect(result.code).toBe(2);
    expect(result.stderr).toContain('contract_version');
  });
});

/** `--base-proto-only`: previous `proto/` against the base proto, nothing written, game contract not read. */
function baseOnly(previousCore: string, currentCore: string, previousSettings: object = SETTINGS, currentSettings: object = SETTINGS): ReturnType<typeof runTool> {
  const prev = tempDir();
  writeFiles(prev, {
    'proto/ogw/core.proto': previousCore,
    'proto/ogw/options.proto': readFileSync(OPTIONS_PROTO_PATH, 'utf8'),
    'core-settings.json': JSON.stringify(previousSettings),
    'contract/service.proto': 'this is not read',
  });
  const cur = tempDir();
  writeFiles(cur, { 'ogw/core.proto': currentCore, 'ogw/options.proto': readFileSync(OPTIONS_PROTO_PATH, 'utf8') });
  const settings = join(cur, 'core-settings.json');
  writeFileSync(settings, JSON.stringify(currentSettings));
  return runTool(['--base-proto-only', '--base-proto', cur, '--core-settings', settings, '--previous', prev]);
}

describe('--base-proto-only', () => {
  it('the same base proto passes', () => {
    const result = baseOnly(CORE, CORE);
    expect(result.stdout).toBe('');
    expect(result.code).toBe(0);
  });

  it('additions pass', () => {
    const result = baseOnly(CORE, CORE.replace('  ITEM_CHANGE_SOURCE_SHOP = 1;\n', '  ITEM_CHANGE_SOURCE_SHOP = 1;\n  ITEM_CHANGE_SOURCE_MAIL = 2;\n').replace('message StartPlayResponse {\n}', 'message StartPlayResponse {\n  int64 started_at = 1;\n}'));
    expect(result.stdout).toBe('');
    expect(result.code).toBe(0);
  });

  it('the base proto of this core against itself passes', () => {
    const core = readFileSync(join(BASE_PROTO, 'ogw/core.proto'), 'utf8');
    const settings = JSON.parse(CORE_SETTINGS_TEXT) as object;
    const result = baseOnly(core, core, settings, settings);
    expect(result.stdout).toBe('');
    expect(result.code).toBe(0);
  });

  const pairs: { name: string; current: string; error: string; settings?: object }[] = [
    { name: 'rpc removed', current: CORE.replace(/ {2}\/\/ play[\s\S]*?\n {2}}\n/, ''), error: 'rpc StartPlay of service Core was removed or renamed' },
    { name: 'field removed', current: CORE.replace('  string token = 1 [(ogw.v) = {max_len_key: "play.tokenMaxLength"}];\n', ''), error: 'field 1 token of StartPlayRequest was removed' },
    { name: 'field type changed', current: CORE.replace('string token = 1', 'bytes token = 1'), error: 'changed its type from string to bytes' },
    { name: 'enum value removed', current: CORE.replace('  ITEM_CHANGE_SOURCE_SHOP = 1;\n', ''), error: 'enum value ITEM_CHANGE_SOURCE_SHOP of ItemChangeSource was removed or renamed' },
    { name: 'retry removed', current: CORE.replace('// changes: content', '// changes: none').replace('    option (ogw.retry) = true;\n', ''), error: 'rpc StartPlay removed (ogw.retry)' },
    { name: '_key value narrowed', current: CORE, settings: { 'play.tokenMaxLength': 16 }, error: 'narrows validation: max_len' },
    { name: '_key replaced by a smaller number', current: CORE.replace('{max_len_key: "play.tokenMaxLength"}', '{max_len: 10}'), error: 'narrows validation: max_len' },
    { name: 'message removed', current: CORE.replace('enum ItemChangeSource {\n  ITEM_CHANGE_SOURCE_UNSPECIFIED = 0;\n  ITEM_CHANGE_SOURCE_SHOP = 1;\n}\n', ''), error: 'enum ItemChangeSource was removed or renamed' },
  ];
  for (const pair of pairs) {
    it(`breaks: ${pair.name}`, () => {
      const result = baseOnly(CORE, pair.current, SETTINGS, pair.settings ?? SETTINGS);
      expect(result.code, result.stdout + result.stderr).toBe(1);
      expect(result.stdout.split('\n').some((l) => /^[^:]+:\d+:\d+ ERROR /.test(l) && l.includes(pair.error)), result.stdout).toBe(true);
    });
  }

  it('needs --previous', () => {
    const result = runTool(['--base-proto-only', '--base-proto', BASE_PROTO, '--core-settings', join(BASE_PROTO, 'none.json')]);
    expect(result.code).toBe(2);
  });
});
