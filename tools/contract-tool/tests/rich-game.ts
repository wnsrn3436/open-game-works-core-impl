/** A game contract and base proto that use every type, option and generated item, for the generation tests. */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { runTool } from '../src/run.ts';
import { dataProto, HEAD, OPTIONS_PROTO_PATH, tempDir, writeFiles } from './helpers.ts';

export const RICH_CORE = `syntax = "proto3";
package ogw.core;

import "ogw/options.proto";

service Core {
  // login
  // changes: all
  rpc Login(LoginRequest) returns (LoginResponse) {
    option (ogw.sensitive) = true;
  }
  // play
  // changes: ItemBalanceUserState, content
  rpc StartPlay(StartPlayRequest) returns (StartPlayResponse) {
    option (ogw.retry) = true;
  }
}

service CoreCheat {
  // dev login
  // changes: none
  rpc DevLogin(DevLoginRequest) returns (DevLoginResponse);
}

message LoginRequest {
  string token = 1 [(ogw.v) = {max_len_key: "auth.tokenMaxLength"}];
  repeated ItemAmount wanted = 2 [(ogw.v) = {max_count: 2}];
}

message LoginResponse {
  int64 user_id = 1;
}

message StartPlayRequest {
  int32 stage_id = 1 [(ogw.v) = {table: "stage"}];
}

message StartPlayResponse {
}

message DevLoginRequest {
  string name = 1 [(ogw.v) = {max_chars: 8}];
  DevOnly extra = 2;
}

message DevLoginResponse {
}

message DevOnly {
  int32 level = 1 [(ogw.v) = {min: 0, max: 9}];
}

message ItemAmount {
  int32 item_id = 1 [(ogw.v) = {table: "item"}];
  int64 amount = 2 [(ogw.v) = {min: 0, max: 1000000000000}];
  string big_amount = 3 [(ogw.v) = {max_len: 30}];
}

enum ItemChangeSource {
  ITEM_CHANGE_SOURCE_UNSPECIFIED = 0;
  ITEM_CHANGE_SOURCE_SHOP = 1;
  ITEM_CHANGE_SOURCE_IAP_REFUND = 2;
}

message ItemChange {
  int32 item_id = 1;
  int64 delta = 2;
  string big_delta = 3;
  ItemChangeSource source = 4;
}

message ItemMail {
  int64 mail_id = 1;
  ItemChangeSource source = 2;
  string ref = 3;
  repeated ItemAmount items = 4;
}

message ItemBalanceUserState {
  int64 id = 1;
  int64 amount = 2;
  string big_amount = 3;
}

message ConsentUserState {
  int64 agreed_at = 1;
}
`;

export const RICH_SETTINGS = { 'auth.tokenMaxLength': 16 };

/** Contract version of the previous build the rich game is compared with; its kinds are unchanged. */
export const RICH_CONTRACT_VERSION = 3;

export const RICH_CONTRACT: Readonly<Record<string, string>> = {
  'error.proto': `syntax = "proto3";
package game;

enum GameError {
  GAME_ERROR_UNSPECIFIED = 0;
  GAME_ERROR_NOT_ENOUGH_GOLD = 1000;
  GAME_ERROR_QUEST_LOCKED = 1001;
  GAME_ERROR_NO_LIVES = 1002;
}
`,
  'service.proto': `${HEAD}
import "user_state.proto";

option (ogw.core_errors) = "StartPlay:GAME_ERROR_NO_LIVES,GAME_ERROR_QUEST_LOCKED";

service Game {
  // quest 보상을 받는다
  // changes: QuestUserState, ItemBalanceUserState
  rpc ClaimQuest(ClaimQuestRequest) returns (ClaimQuestResponse) {
    option (ogw.retry) = true;
    option (ogw.errors) = "GAME_ERROR_NOT_ENOUGH_GOLD,GAME_ERROR_QUEST_LOCKED";
  }
  // 목록을 본다
  // changes: none
  rpc ListQuests(ListQuestsRequest) returns (ListQuestsResponse) {
    option (ogw.silent) = true;
  }
}

message ClaimQuestRequest {
  int32 quest_id = 1 [(ogw.v) = {table: "quest"}];
  repeated int32 slot_ids = 2 [(ogw.v) = {max_count: 4, min: 1, max: 100, unique: true}];
  string note = 3 [(ogw.v) = {max_len: 9, max_chars: 4}];
  QuestKind kind = 4;
  Detail detail = 5;
  repeated Detail details = 6 [(ogw.v) = {max_count: 3, min_count: 1}];
  int64 bet = 7 [(ogw.v) = {min: -5, max: 9000000000000}];
  bytes proof = 8 [(ogw.v) = {max_len: 4}];
  repeated string tags = 9 [(ogw.v) = {max_count: 3, max_chars: 3, unique: true}];
  bool fast = 10;
  double ratio = 11;
  repeated ogw.core.ItemAmount costs = 12 [(ogw.v) = {max_count: 2}];
  repeated int32 item_ids = 13 [(ogw.v) = {max_count: 2, table: "item"}];
  repeated bytes seals = 14 [(ogw.v) = {max_count: 2, max_len: 2, unique: true}];
}

message Detail {
  int32 count = 1 [(ogw.v) = {min: 0, max: 5}];
  QuestKind kind = 2;
}

message ClaimQuestResponse {
  QuestUserState quest = 1;
}

message ListQuestsRequest {
}

message ListQuestsResponse {
  repeated QuestUserState quests = 1;
}

message MatchResult {
  repeated int32 scores = 1 [(ogw.v) = {max_count: 4, min: 0, max: 10}];
}

message PlaySessionResult {
  int32 stars = 1 [(ogw.v) = {min: 0, max: 3}];
}

message PlaySessionLoadout {
  repeated int32 hero_ids = 1;
}

// 재귀 message
message TreeNode {
  TreeNode child = 1;
  int32 value = 2;
}
`,
  'user_state.proto': `${HEAD}
// quest
message QuestUserState {
  option (ogw.public) = true;
  option (ogw.converters) = 1;
  option (ogw.converters) = 2;
  int64 id = 1;
  int32 i32 = 2;
  int64 i64 = 3;
  float f32 = 4;
  double f64 = 5;
  bool flag = 6;
  string text = 7;
  bytes blob = 8;
  QuestKind kind = 9;
  Reward reward = 10;
  repeated int32 list_i32 = 11;
  repeated int64 list_i64 = 12;
  repeated float list_f32 = 13;
  repeated double list_f64 = 14;
  repeated bool list_flag = 15;
  repeated string list_text = 16;
  repeated bytes list_blob = 17;
  repeated QuestKind list_kind = 18;
  repeated Reward list_reward = 19;
  repeated ogw.core.ItemAmount items = 20;
  int64 started_at = 21;
}

// 보상
message Reward {
  int32 item_id = 1;
  int64 amount = 2;
  string big_amount = 3;
  ogw.core.ItemChangeSource source = 4;
}

enum QuestKind {
  QUEST_KIND_UNSPECIFIED = 0;
  QUEST_KIND_DAILY = 1;
  QUEST_KIND_WEEKLY = 2;
}

// profile
message ProfileUserState {
  string title = 1;
}
`,
  'server_state.proto': `${HEAD}
message SeedServerState {
  option (ogw.converters) = 1;
  int64 seed = 1;
}
`,
  'game_state.proto': `${HEAD}
message BossGameState {
  int64 key = 1;
  int64 hp = 2;
}
`,
  'realtime.proto': `syntax = "proto3";
package game;

enum RealtimeKind {
  REALTIME_KIND_UNSPECIFIED = 0;
  REALTIME_KIND_MOVE = 1;
}

message RealtimeMessage {
  RealtimeKind kind = 1;
  float x = 2;
  float y = 3;
}
`,
  'cheat.proto': `${HEAD}
import "user_state.proto";

service Cheat {
  // gold를 준다
  // changes: ItemBalanceUserState
  rpc AddGold(AddGoldRequest) returns (AddGoldResponse) {
    option (ogw.errors) = "GAME_ERROR_NOT_ENOUGH_GOLD";
  }
}

message AddGoldRequest {
  int64 amount = 1 [(ogw.v) = {min: 1, max: 1000}];
  QuestKind kind = 2;
  ogw.core.ItemAmount item = 3;
  ogw.core.DevOnly dev = 4;
}

message AddGoldResponse {
  QuestUserState quest = 1;
}
`,
};

/** Stubs of the files the generated code imports: data code and request ctx. */
export const STUBS: Readonly<Record<string, string>> = {
  'server/core/storage/request_ctx.ts': 'export interface RequestCtx {\n  readonly user_id: bigint;\n}\n',
  'server/generated/data/game_data.ts': `export class QuestTable {
  has_row(id: number): boolean {
    return id === 0 || id === 7;
  }
}

export class ItemTable {
  has_rows(id: number): boolean {
    return id === 1 || id === 2;
  }
}

export class StageTable {
  has_row(id: number): boolean {
    return id === 3;
  }
}

export class DataSet {
  readonly QuestTable = new QuestTable();
  readonly ItemTable = new ItemTable();
  readonly StageTable = new StageTable();
}
`,
};

export interface RichGame {
  readonly game: string;
  readonly base: string;
  readonly code: number;
  readonly stdout: string;
}

/** Generates the rich game. `tables` are the server build target tables. */
export function generateRich(tables: readonly string[] = ['item', 'quest']): RichGame {
  const game = tempDir();
  const base = tempDir();
  writeFiles(base, { 'ogw/core.proto': RICH_CORE, 'ogw/options.proto': readFileSync(OPTIONS_PROTO_PATH, 'utf8') });
  const contract = Object.fromEntries(Object.entries(RICH_CONTRACT).map(([k, v]) => [`contract/${k}`, v]));
  writeFiles(game, { ...contract, 'server/generated/data/game_data.proto': dataProto(tables), ...STUBS });
  const settings = join(game, 'core-settings.json');
  writeFileSync(settings, JSON.stringify(RICH_SETTINGS));
  const modules = join(game, 'modules.json');
  writeFileSync(modules, JSON.stringify(['matchmaker', 'play-session']));
  const previous = tempDir();
  writeFiles(previous, {
    ...contract,
    'proto/ogw/core.proto': RICH_CORE,
    'proto/ogw/options.proto': readFileSync(OPTIONS_PROTO_PATH, 'utf8'),
    'core-settings.json': JSON.stringify(RICH_SETTINGS),
    contract_version: `${String(RICH_CONTRACT_VERSION)}\n`,
  });
  const result = runTool(['--game', game, '--base-proto', base, '--core-settings', settings, '--modules', modules, '--previous', previous]);
  return { game, base, code: result.code, stdout: result.stdout + result.stderr };
}
