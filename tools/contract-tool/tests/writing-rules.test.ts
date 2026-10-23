/** Each writing rule violation makes an ERROR line, exit code 1, and no generated file. */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { baseContract, HEAD, runGame, type GameSetup } from './helpers.ts';

/** A core.proto with core `rpc`s and a core kind, for rules about the base proto. */
const CORE_WITH_RPCS = `syntax = "proto3";
package ogw.core;

import "ogw/options.proto";

service Core {
  // login
  // changes: all
  rpc Login(LoginRequest) returns (LoginResponse);
  // auto login
  // changes: all
  rpc AutoLogin(AutoLoginRequest) returns (AutoLoginResponse);
  // refresh
  // changes: all
  rpc RefreshToken(RefreshTokenRequest) returns (RefreshTokenResponse);
  // play
  // changes: ItemBalanceUserState, content
  rpc StartPlay(StartPlayRequest) returns (StartPlayResponse) {
    option (ogw.retry) = true;
  }
}

message LoginRequest {
  string token = 1 [(ogw.v) = {max_len_key: "auth.tokenMaxLength"}];
}

message LoginResponse {
}

message AutoLoginRequest {
}

message AutoLoginResponse {
}

message RefreshTokenRequest {
}

message RefreshTokenResponse {
}

message StartPlayRequest {
  int32 stage_id = 1 [(ogw.v) = {table: "stage"}];
}

message StartPlayResponse {
}

message ItemBalanceUserState {
  int64 id = 1;
}
`;

/** `CORE_WITH_RPCS` with `service CoreCheat`: `CheatAmount` and `CheatKind` are only reached from it. */
const CORE_WITH_CHEAT = `${CORE_WITH_RPCS}
service CoreCheat {
  // grant
  // changes: none
  rpc Grant(GrantRequest) returns (GrantResponse);
}

message GrantRequest {
  repeated CheatAmount amounts = 1 [(ogw.v) = {max_count: 5}];
  CheatKind kind = 2;
}

message GrantResponse {
}

message CheatAmount {
  int32 item_id = 1 [(ogw.v) = {min: 0, max: 9}];
}

enum CheatKind {
  CHEAT_KIND_UNSPECIFIED = 0;
  CHEAT_KIND_ALL = 1;
}
`;

/** `CORE_WITH_RPCS` with enum `Foo`, whose value `FOO_BAR_X` the cases about enum value names reuse. */
const CORE_WITH_FOO = `${CORE_WITH_RPCS}
enum Foo {
  FOO_UNSPECIFIED = 0;
  FOO_BAR_X = 1;
}
`;

const CHEAT_SETUP = { coreProto: CORE_WITH_CHEAT, settings: { 'auth.tokenMaxLength': 64 }, tables: ['stage'] } as const;

function withService(body: string): Record<string, string> {
  const contract = baseContract();
  contract['service.proto'] = `${contract['service.proto'] ?? ''}\n${body}\n`;
  return contract;
}

function replace(file: string, from: string, to: string): Record<string, string> {
  const contract = baseContract();
  const text = contract[file] ?? '';
  if (!text.includes(from)) throw new Error(`case setup: ${from} not in ${file}`);
  contract[file] = text.replace(from, to);
  return contract;
}

/** `baseContract()` without error.proto and `(ogw.errors)`, with `body` added to service.proto. */
function withoutErrorProto(body: string): Record<string, string> {
  const contract = replace('service.proto', '    option (ogw.errors) = "GAME_ERROR_NOT_ENOUGH_GOLD";\n', '');
  delete contract['error.proto'];
  contract['service.proto'] = `${contract['service.proto'] ?? ''}\n${body}\n`;
  return contract;
}

/** `withoutErrorProto` with an `rpc <name>` added to `service Game`. */
function withGameRpc(name: string): Record<string, string> {
  const contract = withoutErrorProto(`message ${name}Request {\n}\n\nmessage ${name}Response {\n}`);
  contract['service.proto'] = (contract['service.proto'] ?? '').replace('service Game {', `service Game {\n  // x\n  // changes: none\n  rpc ${name}(${name}Request) returns (${name}Response);\n`);
  return contract;
}

interface Case {
  readonly name: string;
  readonly setup: GameSetup;
  /** Text the ERROR line holds. */
  readonly error: string;
  /** `<file>:<line>` the ERROR line starts with. */
  readonly at?: string;
}

const cases: Case[] = [
  { name: 'syntax is proto3', setup: { contract: replace('user_state.proto', 'syntax = "proto3";', 'syntax = "proto2";') }, error: 'syntax = "proto3"', at: 'contract/user_state.proto:1' },
  { name: 'package is game', setup: { contract: replace('user_state.proto', 'package game;', 'package other;') }, error: 'package is game', at: 'contract/user_state.proto:2' },
  { name: 'syntax error', setup: { contract: replace('user_state.proto', 'int64 gold = 1;', 'int64 gold = ;') }, error: 'syntax:', at: 'contract/user_state.proto:6' },
  { name: 'unknown contract file', setup: { contract: { ...baseContract(), 'misc.proto': 'syntax = "proto3";\npackage game;\n' } }, error: 'misc.proto is not a game contract file', at: 'contract/misc.proto:1' },
  { name: 'file that is not a proto in contract/', setup: { contract: { ...baseContract(), 'notes.txt': 'x' } }, error: 'file notes.txt is not a game contract file', at: 'contract/notes.txt:1' },
  { name: 'folder in contract/', setup: { contract: { ...baseContract(), 'old/service.proto': 'x' } }, error: 'folder old is not a game contract file', at: 'contract/old:1' },
  { name: 'PascalCase without two capitals in a row', setup: { contract: withService('message UIState {\n}') }, error: 'message name UIState is not PascalCase' },
  { name: 'rpc option outside the spec', setup: { contract: replace('service.proto', 'option (ogw.retry) = true;', 'option (ogw.retry) = true;\n    option idempotency_level = NO_SIDE_EFFECTS;') }, error: 'option idempotency_level is not allowed on an rpc' },
  { name: 'core option where the spec does not put it', setup: { contract: withService('message Card {\n  option (ogw.silent) = true;\n}') }, error: 'option (ogw.silent) is not allowed on a message' },
  { name: 'file option outside the spec', setup: { contract: replace('service.proto', 'service Game {', 'option java_package = "x";\n\nservice Game {') }, error: 'file option java_package is not allowed' },
  { name: 'enum option outside the spec', setup: { contract: withService('enum Tier {\n  option allow_alias = true;\n  TIER_UNSPECIFIED = 0;\n}') }, error: 'option allow_alias is not allowed on enum' },
  { name: 'nested message', setup: { contract: withService('message Outer {\n  message Inner {\n  }\n}') }, error: 'nested message Inner' },
  { name: 'nested enum', setup: { contract: withService('message Outer {\n  enum Inner {\n    INNER_UNSPECIFIED = 0;\n  }\n}') }, error: 'nested enum Inner' },
  { name: 'oneof', setup: { contract: withService('message Outer {\n  oneof choice {\n    int32 a = 1;\n  }\n}') }, error: 'oneof is not allowed' },
  { name: 'map', setup: { contract: withService('message Outer {\n  map<int32, int32> counts = 1;\n}') }, error: 'map is not allowed' },
  { name: 'optional', setup: { contract: withService('message Outer {\n  optional int32 a = 1;\n}') }, error: 'optional is not allowed' },
  { name: 'group', setup: { contract: withService('message Outer {\n  repeated group Item = 1 {\n  }\n}') }, error: 'group is not allowed' },
  { name: 'extend', setup: { contract: withService('extend google.protobuf.FieldOptions {\n  int32 x = 50000;\n}') }, error: 'extend is not allowed' },
  {
    name: 'streaming rpc',
    setup: { contract: replace('service.proto', 'rpc Spend(SpendRequest)', 'rpc Spend(stream SpendRequest)') },
    error: 'streaming rpc is not allowed',
  },
  { name: 'scalar type', setup: { contract: replace('user_state.proto', 'int64 gold = 1;', 'uint64 gold = 1;') }, error: 'scalar type uint64 is not allowed' },
  { name: 'message name PascalCase', setup: { contract: withService('message bad_name {\n}') }, error: 'message name bad_name is not PascalCase' },
  { name: 'enum name PascalCase', setup: { contract: withService('enum BAD {\n  BAD_UNSPECIFIED = 0;\n}') }, error: 'enum name BAD is not PascalCase' },
  { name: 'type name unique across files', setup: { contract: withService('message WalletUserState {\n}') }, error: 'type name WalletUserState is already used' },
  { name: 'field name snake_case', setup: { contract: replace('user_state.proto', 'int64 gold = 1;', 'int64 goldAmount = 1;') }, error: 'field name goldAmount is not snake_case' },
  { name: 'field number used twice', setup: { contract: replace('user_state.proto', 'int64 gold = 1;', 'int64 gold = 1;\n  int64 gem = 1;') }, error: 'field number 1 is already used' },
  { name: 'field JSON name used twice', setup: { contract: replace('user_state.proto', 'int64 gold = 1;', 'int64 gold = 1;\n  int32 slot_1 = 2;\n  int32 slot1 = 3;') }, error: 'field slot1 has JSON name slot1, which conflicts with field slot_1' },
  { name: 'field number range', setup: { contract: replace('user_state.proto', 'int64 gold = 1;', 'int64 gold = 19000;') }, error: 'field number 19000 is not allowed' },
  { name: 'enum value prefix', setup: { contract: withService('enum Color {\n  COLOR_UNSPECIFIED = 0;\n  RED = 1;\n}') }, error: 'enum value RED is not COLOR_<VALUE>' },
  { name: 'enum first value', setup: { contract: withService('enum Color {\n  COLOR_RED = 0;\n}') }, error: 'first value of Color is COLOR_UNSPECIFIED = 0' },
  {
    name: 'enum value names unique in package',
    setup: { contract: withService('enum Foo {\n  FOO_UNSPECIFIED = 0;\n  FOO_BAR_X = 1;\n}\nenum FooBar {\n  FOO_BAR_UNSPECIFIED = 0;\n  FOO_BAR_X = 1;\n}') },
    error: 'enum value name FOO_BAR_X is already used',
  },
  {
    name: 'enum value names unique in the base proto package',
    setup: { contract: baseContract(), coreProto: `${CORE_WITH_FOO}\nenum FooBar {\n  FOO_BAR_UNSPECIFIED = 0;\n  FOO_BAR_X = 1;\n}\n`, settings: { 'auth.tokenMaxLength': 64 }, tables: ['stage'] },
    error: 'enum value name FOO_BAR_X is already used',
  },
  { name: 'enum name kind suffix', setup: { contract: withService('enum ModeUserState {\n  MODE_USER_STATE_UNSPECIFIED = 0;\n}') }, error: 'ends with UserState' },
  { name: 'built-in type name', setup: { contract: withService('message Map {\n}') }, error: 'message name Map is a name the generated TypeScript uses' },
  { name: 'reserved word field name', setup: { contract: replace('user_state.proto', 'int64 gold = 1;', 'int64 class = 1;') }, error: 'field name class is a name the generated TypeScript uses' },
  { name: 'field name of generated member', setup: { contract: replace('user_state.proto', 'int64 gold = 1;', 'int64 encode = 1;') }, error: 'field name encode is a name the generated TypeScript uses' },
  { name: 'handler type name', setup: { contract: withService('message SpendHandler {\n}') }, error: 'type name SpendHandler is the generated handler type name of rpc Spend' },
  { name: 'error type name', setup: { contract: withService('message SpendError {\n}') }, error: 'type name SpendError is the generated handler type name of rpc Spend' },
  { name: 'error type name of GameError without error.proto', setup: { contract: withGameRpc('Game') }, error: 'rpc name Game makes GameError, a type name the generated code always declares' },
  { name: 'data proto type name', setup: { contract: withService('message QuestRow {\n}'), dataExtra: '\nmessage QuestRow {\n  int32 id = 1;\n}\n' }, error: 'QuestRow is a message or enum name of the data proto' },
  { name: 'data proto import', setup: { contract: replace('user_state.proto', 'package game;', 'package game;\n\nimport "server/generated/data/game_data.proto";') }, error: 'does not import the data proto' },
  { name: 'unknown import', setup: { contract: replace('user_state.proto', 'package game;', 'package game;\n\nimport "other.proto";') }, error: 'import "other.proto" is not a game contract file' },
  { name: 'type from a file not imported', setup: { contract: withService('message Holder {\n  WalletUserState wallet = 1;\n}') }, error: 'which this file does not import' },
  { name: 'unknown type', setup: { contract: withService('message Holder {\n  Missing missing = 1;\n}') }, error: 'unknown type Missing' },
  { name: 'ogw option without import', setup: { contract: replace('user_state.proto', 'int64 gold = 1;', 'int64 gold = 1;\n  option (ogw.public) = true;') }, error: 'does not import "ogw/options.proto"' },
  { name: 'unknown option', setup: { contract: replace('user_state.proto', 'int64 gold = 1;', 'int64 gold = 1 [packed = true];') }, error: 'option packed is not allowed on a field' },
  {
    name: 'cheat.proto imported by another file',
    setup: {
      contract: {
        ...replace('user_state.proto', 'package game;', 'package game;\n\nimport "cheat.proto";'),
        'cheat.proto': `${HEAD}\nservice Cheat {\n  // gold\n  // changes: WalletUserState\n  rpc AddGold(AddGoldRequest) returns (AddGoldResponse);\n}\n\nmessage AddGoldRequest {\n}\n\nmessage AddGoldResponse {\n}\n`,
      },
    },
    error: 'only cheat.proto imports cheat.proto',
  },
  {
    name: 'cheat message uses a server state type',
    setup: {
      contract: {
        ...baseContract(),
        'server_state.proto': 'syntax = "proto3";\npackage game;\n\nmessage SeedServerState {\n  int64 seed = 1;\n}\n',
        'cheat.proto': `${HEAD}\nimport "server_state.proto";\n\nservice Cheat {\n  // seed\n  // changes: SeedServerState\n  rpc SetSeed(SetSeedRequest) returns (SetSeedResponse);\n}\n\nmessage SetSeedRequest {\n  SeedServerState seed = 1;\n}\n\nmessage SetSeedResponse {\n}\n`,
      },
    },
    error: 'cheat.proto does not use SeedServerState of server_state.proto',
  },
  {
    name: 'cheat message uses a game state type',
    setup: {
      contract: {
        ...baseContract(),
        'game_state.proto': 'syntax = "proto3";\npackage game;\n\nmessage BossGameState {\n  int64 key = 1;\n  int64 hp = 2;\n}\n',
        'cheat.proto': `${HEAD}\nimport "game_state.proto";\n\nservice Cheat {\n  // boss\n  // changes: none\n  rpc SetBoss(SetBossRequest) returns (SetBossResponse);\n}\n\nmessage SetBossRequest {\n  BossGameState boss = 1;\n}\n\nmessage SetBossResponse {\n}\n`,
      },
    },
    error: 'cheat.proto does not use BossGameState of game_state.proto',
  },
  { name: 'kind in its file', setup: { contract: withService('message BagUserState {\n}') }, error: 'UserState kind BagUserState is in user_state.proto' },
  { name: 'server state kind in its file', setup: { contract: withService('message BagServerState {\n}') }, error: 'ServerState kind BagServerState is in server_state.proto' },
  { name: 'GameError in error.proto', setup: { contract: { ...replace('error.proto', 'enum GameError', 'enum OtherError'), 'service.proto': `${baseContract()['service.proto'] ?? ''}\nenum GameError {\n  GAME_ERROR_UNSPECIFIED = 0;\n}\n` } }, error: 'GameError is in error.proto' },
  { name: 'error.proto declares GameError', setup: { contract: replace('error.proto', 'enum GameError', 'enum OtherError') }, error: 'error.proto declares enum GameError' },
  { name: 'RealtimeMessage in realtime.proto', setup: { contract: withService('message RealtimeMessage {\n}') }, error: 'RealtimeMessage is in realtime.proto' },
  { name: 'realtime.proto declares RealtimeMessage', setup: { contract: { ...baseContract(), 'realtime.proto': 'syntax = "proto3";\npackage game;\n\nmessage Ping {\n}\n' } }, error: 'realtime.proto declares message RealtimeMessage' },
  {
    name: 'module message in service.proto',
    setup: { contract: replace('user_state.proto', 'int64 gold = 1;\n}', 'int64 gold = 1;\n}\n\nmessage PublicProfile {\n}') },
    error: 'module message PublicProfile is in service.proto',
  },
  { name: 'GameError is an enum', setup: { contract: withoutErrorProto('message GameError {\n  int32 x = 1;\n}') }, error: 'GameError is an enum in error.proto' },
  { name: 'RealtimeMessage is a message', setup: { contract: withService('enum RealtimeMessage {\n  REALTIME_MESSAGE_UNSPECIFIED = 0;\n}') }, error: 'RealtimeMessage is a message in realtime.proto' },
  { name: 'module message is a message', setup: { contract: replace('user_state.proto', 'int64 gold = 1;\n}', 'int64 gold = 1;\n}\n\nenum MatchResult {\n  MATCH_RESULT_UNSPECIFIED = 0;\n}') }, error: 'module message MatchResult is a message in service.proto' },
  { name: 'module message is a message in service.proto', setup: { contract: withService('enum PlaySessionResult {\n  PLAY_SESSION_RESULT_UNSPECIFIED = 0;\n}') }, error: 'module message PlaySessionResult is a message in service.proto' },
  { name: 'rpc name PascalCase', setup: { contract: replace('service.proto', 'rpc Spend(', 'rpc spend(') }, error: 'rpc name spend is not PascalCase' },
  { name: 'rpc name without two capitals in a row', setup: { contract: replace('service.proto', 'rpc Spend(', 'rpc UISpend(') }, error: 'rpc name UISpend is not PascalCase' },
  { name: 'rpc name that makes a built-in type name', setup: { contract: replace('service.proto', 'rpc Spend(', 'rpc Range(') }, error: 'rpc name Range makes RangeError, a name the generated TypeScript uses' },
  { name: 'core_errors value has a colon', setup: { contract: replace('service.proto', 'service Game {', 'option (ogw.core_errors) = "StartPlay";\n\nservice Game {'), coreProto: CORE_WITH_RPCS, settings: { 'auth.tokenMaxLength': 64 }, tables: ['stage'] }, error: '(ogw.core_errors) value is "<core rpc>:<GameError>,..."' },
  { name: 'service name', setup: { contract: withService('service Other {\n}') }, error: 'service Other is not allowed here' },
  { name: 'service file', setup: { contract: { ...baseContract(), 'cheat.proto': `${HEAD}\nservice Game {\n}\n` } }, error: 'service Game is in service.proto' },
  { name: 'rpc comment changes line', setup: { contract: replace('service.proto', '  // changes: WalletUserState\n', '') }, error: 'last comment line of rpc Spend is "changes: <saved state>"' },
  { name: 'rpc changes value', setup: { contract: replace('service.proto', '// changes: WalletUserState', '// changes:') }, error: 'changes: of rpc Spend is empty' },
  { name: 'retry on state change', setup: { contract: replace('service.proto', '    option (ogw.retry) = true;\n', '') }, error: 'needs option (ogw.retry) = true' },
  { name: 'errors name is a GameError value', setup: { contract: replace('service.proto', '"GAME_ERROR_NOT_ENOUGH_GOLD"', '"GAME_ERROR_MISSING"') }, error: 'lists GAME_ERROR_MISSING, which is not a GameError value' },
  { name: 'errors name twice', setup: { contract: replace('service.proto', '"GAME_ERROR_NOT_ENOUGH_GOLD"', '"GAME_ERROR_NOT_ENOUGH_GOLD,GAME_ERROR_NOT_ENOUGH_GOLD"') }, error: 'lists GAME_ERROR_NOT_ENOUGH_GOLD twice' },
  { name: 'errors without UNSPECIFIED', setup: { contract: replace('service.proto', '"GAME_ERROR_NOT_ENOUGH_GOLD"', '"GAME_ERROR_UNSPECIFIED"') }, error: 'does not list GAME_ERROR_UNSPECIFIED' },
  { name: 'GameError values from 1000', setup: { contract: replace('error.proto', '= 1000', '= 999') }, error: 'GameError value GAME_ERROR_NOT_ENOUGH_GOLD is 1000 or more' },
  { name: 'request message name', setup: { contract: replace('service.proto', 'rpc Spend(SpendRequest)', 'rpc Spend(SpendResponse)') }, error: 'request message of rpc Spend is SpendRequest' },
  { name: 'Request suffix only for rpc messages', setup: { contract: withService('message OtherRequest {\n}') }, error: 'message OtherRequest ends with Request or Response but is not the request or response of an rpc' },
  {
    name: 'request message in service.proto',
    setup: {
      contract: {
        ...replace('service.proto', 'message SpendRequest {\n  int32 amount = 1 [(ogw.v) = {min: 1, max: 100}];\n}\n', 'import "user_state.proto";\n'),
        'user_state.proto': `${HEAD}\nmessage WalletUserState {\n  int64 gold = 1;\n}\n\nmessage SpendRequest {\n  int32 amount = 1 [(ogw.v) = {min: 1, max: 100}];\n}\n`,
      },
    },
    error: 'SpendRequest is in service.proto',
  },
  { name: 'string declares max_len or max_chars', setup: { contract: replace('service.proto', 'int32 amount = 1 [(ogw.v) = {min: 1, max: 100}];', 'int32 amount = 1 [(ogw.v) = {min: 1, max: 100}];\n  string note = 2;') }, error: 'declares (ogw.v) max_len or max_chars' },
  { name: 'bytes declares max_len', setup: { contract: replace('service.proto', 'int32 amount = 1 [(ogw.v) = {min: 1, max: 100}];', 'int32 amount = 1 [(ogw.v) = {min: 1, max: 100}];\n  bytes blob = 2;') }, error: 'declares (ogw.v) max_len' },
  { name: 'repeated declares max_count', setup: { contract: replace('service.proto', 'int32 amount = 1 [(ogw.v) = {min: 1, max: 100}];', 'repeated int32 amount = 1 [(ogw.v) = {min: 1, max: 100}];') }, error: 'declares (ogw.v) max_count' },
  { name: 'integer declares min and max', setup: { contract: replace('service.proto', '[(ogw.v) = {min: 1, max: 100}]', '[(ogw.v) = {min: 1}]') }, error: 'declares (ogw.v) min and max, or table' },
  {
    name: 'reached message declares validation',
    setup: { contract: replace('service.proto', 'int32 amount = 1 [(ogw.v) = {min: 1, max: 100}];\n}', 'int32 amount = 1 [(ogw.v) = {min: 1, max: 100}];\n  Detail detail = 2;\n}\n\nmessage Detail {\n  int64 count = 1;\n}') },
    error: 'field count of Detail is validated',
  },
  {
    name: 'module message declares validation',
    setup: { contract: withService('message MatchResult {\n  int32 score = 1;\n}') },
    error: 'field score of MatchResult is validated',
  },
  { name: 'max_len on an integer', setup: { contract: replace('service.proto', '{min: 1, max: 100}', '{min: 1, max: 100, max_len: 3}') }, error: 'max_len is for string and bytes fields' },
  { name: 'max_chars on bytes', setup: { contract: replace('service.proto', 'int32 amount = 1 [(ogw.v) = {min: 1, max: 100}];', 'int32 amount = 1 [(ogw.v) = {min: 1, max: 100}];\n  bytes blob = 2 [(ogw.v) = {max_len: 3, max_chars: 3}];') }, error: 'max_chars is for string fields' },
  { name: 'unique on a single field', setup: { contract: replace('service.proto', '{min: 1, max: 100}', '{min: 1, max: 100, unique: true}') }, error: 'unique is for repeated fields' },
  { name: 'max_count on a single field', setup: { contract: replace('service.proto', '{min: 1, max: 100}', '{min: 1, max: 100, max_count: 3}') }, error: 'min_count and max_count are for repeated fields' },
  {
    name: 'unique on messages',
    setup: { contract: replace('service.proto', 'int32 amount = 1 [(ogw.v) = {min: 1, max: 100}];\n}', 'int32 amount = 1 [(ogw.v) = {min: 1, max: 100}];\n  repeated Detail details = 2 [(ogw.v) = {max_count: 3, unique: true}];\n}\n\nmessage Detail {\n}') },
    error: 'unique is not for message fields',
  },
  { name: 'min and max on a string', setup: { contract: replace('service.proto', 'int32 amount = 1 [(ogw.v) = {min: 1, max: 100}];', 'int32 amount = 1 [(ogw.v) = {min: 1, max: 100}];\n  string note = 2 [(ogw.v) = {max_len: 3, min: 1}];') }, error: 'min and max are for integer fields' },
  { name: 'table on int64', setup: { contract: replace('service.proto', 'int32 amount = 1 [(ogw.v) = {min: 1, max: 100}];', 'int64 quest_id = 1 [(ogw.v) = {table: "quest"}];'), tables: ['quest'] }, error: 'table is for int32 ID value fields' },
  { name: 'table of the server build target', setup: { contract: replace('service.proto', 'int32 amount = 1 [(ogw.v) = {min: 1, max: 100}];', 'int32 quest_id = 1 [(ogw.v) = {table: "quest"}];') }, error: 'table quest is not a table of the server build target' },
  { name: 'min not above max', setup: { contract: replace('service.proto', '{min: 1, max: 100}', '{min: 100, max: 1}') }, error: 'min is greater than max' },
  { name: 'min in int32 range', setup: { contract: replace('service.proto', '{min: 1, max: 100}', '{min: -3000000000, max: 100}') }, error: 'out of the int32 range' },
  { name: 'unknown (ogw.v) option', setup: { contract: replace('service.proto', '{min: 1, max: 100}', '{min: 1, max: 100, maximum: 3}') }, error: '(ogw.v) has no option maximum' },
  { name: 'same (ogw.v) option twice', setup: { contract: replace('service.proto', '{min: 1, max: 100}', '{min: 1, max: 100}, (ogw.v).max = 5') }, error: '(ogw.v) sets max twice' },
  { name: 'game contract _key option', setup: { contract: replace('service.proto', '{min: 1, max: 100}', '{min: 1, max_key: "shop.maxAmount"}'), settings: { 'shop.maxAmount': 5 } }, error: 'game contract does not use the _key option max_key' },
  { name: 'time field is int64', setup: { contract: replace('user_state.proto', 'int64 gold = 1;', 'int64 gold = 1;\n  int32 opened_at = 2;') }, error: 'field opened_at is a time or duration and is int64' },
  { name: 'duration field is int64', setup: { contract: replace('user_state.proto', 'int64 gold = 1;', 'int64 gold = 1;\n  double cooldown_ms = 2;') }, error: 'field cooldown_ms is a time or duration and is int64' },
  { name: 'big encoding pair', setup: { contract: replace('user_state.proto', 'int64 gold = 1;', 'int64 gold = 1;\n  string big_gem = 2;') }, error: 'big encoding field big_gem needs int64 gem' },
  { name: 'list kind id', setup: { contract: replace('user_state.proto', 'int64 gold = 1;', 'int64 gold = 1;\n  int32 id = 2;') }, error: 'field id of kind WalletUserState is int64 id = 1' },
  { name: 'game state kind key', setup: { contract: { ...baseContract(), 'game_state.proto': 'syntax = "proto3";\npackage game;\n\nmessage BossGameState {\n  int64 hp = 1;\n}\n' } }, error: 'game state kind BossGameState has field int64 key = 1' },
  { name: 'public only on UserState kinds', setup: { contract: withService('message Card {\n  option (ogw.public) = true;\n}') }, error: '(ogw.public) is only on UserState kinds' },
  {
    name: 'public not on a server state kind',
    setup: { contract: { ...baseContract(), 'server_state.proto': `${HEAD}\n// 시드\nmessage SeedServerState {\n  option (ogw.public) = true;\n  int64 seed = 1;\n}\n` } },
    error: '(ogw.public) is only on UserState kinds', at: 'contract/server_state.proto:8',
  },
  {
    name: 'game type reaches a core cheat message',
    setup: { ...CHEAT_SETUP, contract: replace('user_state.proto', 'int64 gold = 1;', 'int64 gold = 1;\n  repeated ogw.core.CheatAmount last = 2;') },
    error: 'user_state.proto does not use CheatAmount, which only service CoreCheat reaches, as a field type', at: 'contract/user_state.proto:7',
  },
  {
    name: 'game type reaches a core cheat enum',
    setup: { ...CHEAT_SETUP, contract: withService('// 미리보기\nmessage GrantPreview {\n  ogw.core.CheatKind kind = 1;\n}') },
    error: 'service.proto does not use CheatKind, which only service CoreCheat reaches, as a field type',
  },
  {
    name: 'converters below contract version',
    setup: { contract: { ...baseContract(), 'user_state.proto': `${HEAD}\nmessage WalletUserState {\n  option (ogw.converters) = 1;\n  int64 gold = 1;\n}\n` } },
    error: '(ogw.converters) 1 is not 1 or more and less than contract version 1',
  },
  {
    name: 'converters 1 or more',
    setup: {
      contract: { ...baseContract(), 'user_state.proto': `${HEAD}\nmessage WalletUserState {\n  option (ogw.converters) = 0;\n  int64 gold = 1;\n}\n` },
      previous: { contract: baseContract(), version: 2 },
    },
    error: '(ogw.converters) 0 is not 1 or more and less than contract version 2',
  },
  {
    name: 'converters not negative',
    setup: {
      contract: { ...baseContract(), 'user_state.proto': `${HEAD}\nmessage WalletUserState {\n  option (ogw.converters) = -1;\n  int64 gold = 1;\n}\n` },
      previous: { contract: baseContract(), version: 2 },
    },
    error: '(ogw.converters) -1 is not 1 or more and less than contract version 2',
  },
  {
    name: 'converters once per value in a kind',
    setup: {
      contract: { ...baseContract(), 'user_state.proto': `${HEAD}\nmessage WalletUserState {\n  option (ogw.converters) = 1;\n  option (ogw.converters) = 1;\n  int64 gold = 1;\n}\n` },
      previous: { contract: baseContract(), version: 2 },
    },
    error: '(ogw.converters) 1 is written twice',
  },
  { name: 'converters only on kinds', setup: { contract: withService('message Card {\n  option (ogw.converters) = 1;\n}') }, error: '(ogw.converters) is only on game UserState' },
  { name: 'module message of --modules', setup: { contract: baseContract(), modules: ['matchmaker'] }, error: 'module matchmaker needs module message MatchResult in service.proto' },
  { name: 'module message of play-session', setup: { contract: baseContract(), modules: ['play-session'] }, error: 'module play-session needs module message PlaySessionResult in service.proto' },
  { name: 'core_errors names a core rpc', setup: { contract: replace('service.proto', 'service Game {', 'option (ogw.core_errors) = "Missing:GAME_ERROR_NOT_ENOUGH_GOLD";\n\nservice Game {'), coreProto: CORE_WITH_RPCS, settings: { 'auth.tokenMaxLength': 64 } }, error: '(ogw.core_errors) names Missing, which is not an rpc of service Core' },
  {
    name: 'core_errors once per core rpc',
    setup: {
      contract: replace('service.proto', 'service Game {', 'option (ogw.core_errors) = "StartPlay:GAME_ERROR_NOT_ENOUGH_GOLD";\noption (ogw.core_errors) = "StartPlay:GAME_ERROR_NOT_ENOUGH_GOLD";\n\nservice Game {'),
      coreProto: CORE_WITH_RPCS, settings: { 'auth.tokenMaxLength': 64 },
    },
    error: '(ogw.core_errors) for StartPlay is written twice',
  },
  { name: 'core_errors names GameError values', setup: { contract: replace('service.proto', 'service Game {', 'option (ogw.core_errors) = "StartPlay:GAME_ERROR_OTHER";\n\nservice Game {'), coreProto: CORE_WITH_RPCS, settings: { 'auth.tokenMaxLength': 64 } }, error: '(ogw.core_errors) lists GAME_ERROR_OTHER' },
  { name: 'core_errors only in service.proto', setup: { contract: replace('user_state.proto', 'package game;', 'package game;\n\nimport "ogw/options.proto";\n\noption (ogw.core_errors) = "StartPlay:GAME_ERROR_NOT_ENOUGH_GOLD";'), coreProto: CORE_WITH_RPCS, settings: { 'auth.tokenMaxLength': 64 } }, error: '(ogw.core_errors) is a file option of service.proto' },
  { name: 'base proto _key in core settings', setup: { contract: baseContract(), coreProto: CORE_WITH_RPCS }, error: 'core settings key auth.tokenMaxLength of max_len_key is missing' },
  { name: 'base proto _key is an integer', setup: { contract: baseContract(), coreProto: CORE_WITH_RPCS, settings: { 'auth.tokenMaxLength': 'long' } }, error: 'core settings key auth.tokenMaxLength of max_len_key is not an integer' },
  { name: 'game kind name differs from base kind', setup: { contract: replace('user_state.proto', 'WalletUserState', 'ItemBalanceUserState'), coreProto: CORE_WITH_RPCS, settings: { 'auth.tokenMaxLength': 64 } }, error: 'kind ItemBalanceUserState has the name of a base proto kind' },
  { name: 'core rpc retry', setup: { contract: baseContract(), coreProto: CORE_WITH_RPCS.replace('    option (ogw.retry) = true;\n', ''), settings: { 'auth.tokenMaxLength': 64 } }, error: 'rpc StartPlay changes saved state and needs option (ogw.retry) = true' },
  { name: 'core rpc errors option', setup: { contract: baseContract(), coreProto: CORE_WITH_RPCS.replace('option (ogw.retry) = true;', 'option (ogw.retry) = true;\n    option (ogw.errors) = "X";'), settings: { 'auth.tokenMaxLength': 64 } }, error: 'core rpc does not list (ogw.errors)' },
  { name: 'base proto writing rules', setup: { contract: baseContract(), coreProto: CORE_WITH_RPCS.replace('int64 id = 1;', 'uint32 id = 1;'), settings: { 'auth.tokenMaxLength': 64 } }, error: 'scalar type uint32 is not allowed' },
  {
    name: 'game request reaches a base proto table outside the build target',
    setup: {
      contract: replace('service.proto', 'int32 amount = 1 [(ogw.v) = {min: 1, max: 100}];', 'int32 amount = 1 [(ogw.v) = {min: 1, max: 100}];\n  repeated ogw.core.Cost costs = 2 [(ogw.v) = {max_count: 2}];'),
      coreProto: `${CORE_WITH_RPCS}\nmessage Cost {\n  int32 item_id = 1 [(ogw.v) = {table: "item"}];\n}\n`, settings: { 'auth.tokenMaxLength': 64 }, tables: ['stage'],
    },
    error: 'SpendRequest reaches Cost.item_id with table item, which is not a table of the server build target',
  },
  {
    name: 'validated module message reaches a base proto table outside the build target',
    setup: {
      contract: withService('message MatchResult {\n  repeated ogw.core.Cost costs = 1 [(ogw.v) = {max_count: 2}];\n}'),
      coreProto: `${CORE_WITH_RPCS}\nmessage Cost {\n  int32 item_id = 1 [(ogw.v) = {table: "item"}];\n}\n`, settings: { 'auth.tokenMaxLength': 64 }, tables: ['stage'],
    },
    error: 'MatchResult reaches Cost.item_id with table item, which is not a table of the server build target',
  },
  { name: 'game field table outside the build target', setup: { contract: replace('user_state.proto', 'int64 gold = 1;', 'int64 gold = 1;\n  int32 hero_id = 2 [(ogw.v) = {table: "hero"}];') }, error: 'table hero is not a table of the server build target' },
  { name: 'base proto package', setup: { contract: baseContract(), coreProto: CORE_WITH_RPCS.replace('package ogw.core;', 'package ogw.other;'), settings: { 'auth.tokenMaxLength': 64 } }, error: 'package is ogw.core' },
];

describe('writing rules', () => {
  it('a valid contract passes', () => {
    const run = runGame({ contract: baseContract() });
    expect(run.stdout).toBe('');
    expect(run.code).toBe(0);
  });

  it('deprecated is an option the contract may use, also on a file', () => {
    const contract = replace('service.proto', 'service Game {', 'option deprecated = true;\n\nservice Game {');
    contract['user_state.proto'] = (contract['user_state.proto'] ?? '').replace('int64 gold = 1;', 'int64 gold = 1 [deprecated = true];');
    const run = runGame({ contract });
    expect(run.stdout).toBe('');
    expect(run.code).toBe(0);
  });

  it('core rpcs Login, AutoLogin and RefreshToken change state without retry', () => {
    const run = runGame({ contract: baseContract(), coreProto: CORE_WITH_RPCS, settings: { 'auth.tokenMaxLength': 64 }, tables: ['stage'] });
    expect(run.stdout).toBe('');
    expect(run.code).toBe(0);
  });

  it('enum value names are unique per package: a game value may have the name of a base proto value', () => {
    const run = runGame({
      contract: withService('enum FooBar {\n  FOO_BAR_UNSPECIFIED = 0;\n  FOO_BAR_X = 1;\n}'),
      coreProto: CORE_WITH_FOO, settings: { 'auth.tokenMaxLength': 64 }, tables: ['stage'],
    });
    expect(run.stdout).toBe('');
    expect(run.code).toBe(0);
  });

  it('cheat.proto may use core cheat types, and they stay in the DEV generation target', () => {
    const contract = {
      ...baseContract(),
      'cheat.proto': `${HEAD}\nservice Cheat {\n  // grant\n  // changes: none\n  rpc GrantMore(GrantMoreRequest) returns (GrantMoreResponse);\n}\n\nmessage GrantMoreRequest {\n  repeated ogw.core.CheatAmount amounts = 1 [(ogw.v) = {max_count: 5}];\n}\n\nmessage GrantMoreResponse {\n}\n`,
    };
    const run = runGame({ ...CHEAT_SETUP, contract });
    expect(run.stdout).toBe('');
    expect(run.code).toBe(0);
    const game = readFileSync(join(run.game, 'server', 'generated', 'contract', 'game_contract.ts'), 'utf8');
    expect(game).not.toContain('core_cheat_contract');
    expect(readFileSync(join(run.game, 'server', 'dev', 'generated', 'contract', 'core_cheat_contract.ts'), 'utf8')).toContain('CheatAmount');
  });

  for (const c of cases) {
    it(c.name, () => {
      const run = runGame(c.setup);
      expect(run.code, run.stdout + run.stderr).toBe(1);
      const line = run.lines.find((l) => l.includes(` ERROR `) && l.includes(c.error));
      expect(line, `no ERROR line with "${c.error}" in:\n${run.stdout}`).toBeDefined();
      expect(line).toMatch(/^[^:]+:\d+:\d+ ERROR /);
      if (c.at !== undefined) expect(line?.startsWith(`${c.at}:`), line).toBe(true);
      expect(existsSync(join(run.game, 'server', 'generated', 'contract'))).toBe(false);
    });
  }
});
