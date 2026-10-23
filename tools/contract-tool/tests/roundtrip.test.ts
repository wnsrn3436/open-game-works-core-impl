/** Server generated code: protobuf encode and decode round trip, unknown fields, proto3 JSON, field validators, lists. */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import protobuf from 'protobufjs';
import { beforeAll, describe, expect, it } from 'vitest';
import { generateRich, RICH_CONTRACT, RICH_CONTRACT_VERSION, RICH_CORE } from './rich-game.ts';
import { baseContract, runGame, tempDir } from './helpers.ts';

/** What the tests use of a generated message class. */
interface Message {
  encode(): Uint8Array;
  to_json?: () => unknown;
  [field: string]: unknown;
}

interface MessageClass {
  new (): Message;
  decode(bytes: Uint8Array): Message | null;
  from_json?: (json: unknown) => Message | null;
}

type Failure = { path: string; rule: string } | null;

interface RpcInfo {
  name: string;
  request_class: MessageClass;
  response_class: MessageClass;
  silent: boolean;
  retry: boolean;
  sensitive: boolean;
  errors: readonly number[];
  validate: ((message: Message, data: unknown) => Failure) | null;
}

interface KindInfo {
  name: string;
  kind_class: MessageClass;
  store: string;
  column: string;
  is_list: boolean;
  is_public: boolean;
}

type Module = Record<string, unknown>;

let game: string;
let core: Module;
let gameNs: Module;
let coreCheat: Module;
let gameCheat: Module;
let data: unknown;
let root: protobuf.Root;

function cls(ns: Module, name: string): MessageClass {
  const value = ns[name];
  if (typeof value !== 'function') throw new Error(`no class ${name}`);
  return value as MessageClass;
}

function enumOf(ns: Module, name: string): Record<string, number> {
  return ns[name] as Record<string, number>;
}

async function load(path: string): Promise<Module> {
  const mod: unknown = await import(pathToFileURL(join(game, path)).href);
  return mod as Module;
}

/** The contract without ogw options, for protobufjs. */
function plain(text: string): string {
  return text
    .replace(/^import "ogw\/options\.proto";\n/m, '')
    .replace(/^\s*option \(ogw\.[a-z_]+\) = [^;]*;\n/gm, '')
    .replace(/ \[\(ogw\.v\)[^\]]*\]/g, '');
}

function loadProtobufjs(): protobuf.Root {
  const dir = tempDir();
  mkdirSync(join(dir, 'ogw'), { recursive: true });
  writeFileSync(join(dir, 'ogw', 'core.proto'), plain(RICH_CORE));
  for (const [name, text] of Object.entries(RICH_CONTRACT)) writeFileSync(join(dir, name), plain(text));
  const pb = new protobuf.Root();
  pb.resolvePath = (_origin: string, target: string): string => join(dir, target);
  pb.loadSync(Object.keys(RICH_CONTRACT), { keepCase: true });
  return pb;
}

beforeAll(async () => {
  const rich = generateRich(['item', 'quest']);
  expect(rich.code, rich.stdout).toBe(0);
  game = rich.game;
  core = await load('server/generated/contract/core_contract.ts');
  gameNs = await load('server/generated/contract/game_contract.ts');
  coreCheat = await load('server/dev/generated/contract/core_cheat_contract.ts');
  gameCheat = await load('server/dev/generated/contract/game_cheat_contract.ts');
  const dataModule = await load('server/generated/data/game_data.ts');
  data = new (cls(dataModule, 'DataSet'))();
  root = loadProtobufjs();
});

/** A QuestUserState with every field set. */
function fullQuest(): Message {
  const kind = enumOf(gameNs, 'QuestKind');
  const source = enumOf(core, 'ItemChangeSource');
  const quest = new (cls(gameNs, 'QuestUserState'))();
  const reward = (amount: bigint): Message => {
    const r = new (cls(gameNs, 'Reward'))();
    Object.assign(r, { item_id: 5, amount, big_amount: '', source: source.ITEM_CHANGE_SOURCE_IAP_REFUND });
    return r;
  };
  const item = new (cls(core, 'ItemAmount'))();
  Object.assign(item, { item_id: 2, amount: 9007199254740991n, big_amount: '' });
  Object.assign(quest, {
    id: 42n, i32: -7, i64: -9223372036854775808n, f32: 1.5, f64: -2.25, flag: true, text: '퀘스트 ✓', blob: new Uint8Array([0, 255, 7]),
    kind: kind.QUEST_KIND_WEEKLY, reward: reward(9223372036854775807n),
    list_i32: [1, -1, 2147483647, -2147483648], list_i64: [0n, -1n, 123456789012345n], list_f32: [0.5, -0.25], list_f64: [1e300, -0.5],
    list_flag: [true, false, true], list_text: ['a', '', '한글'], list_blob: [new Uint8Array([1]), new Uint8Array(0)],
    list_kind: [kind.QUEST_KIND_DAILY, kind.QUEST_KIND_UNSPECIFIED], list_reward: [reward(1n), reward(-2n)], items: [item], started_at: 1700000000000n,
  });
  return quest;
}

function protobufjsObject(typeName: string, bytes: Uint8Array): Record<string, unknown> {
  const type = root.lookupType(typeName);
  return type.toObject(type.decode(bytes), { longs: String, enums: Number, bytes: Array, defaults: true, arrays: true });
}

describe('encode and decode', () => {
  it('a message with every field type round trips', () => {
    const quest = fullQuest();
    const bytes = quest.encode();
    const decoded = cls(gameNs, 'QuestUserState').decode(bytes);
    expect(decoded).not.toBeNull();
    expect(decoded?.encode()).toEqual(bytes);
    expect({ ...decoded, reward: { ...(decoded?.reward as object) } }).toMatchObject({ id: 42n, i64: -9223372036854775808n, text: '퀘스트 ✓', list_i32: [1, -1, 2147483647, -2147483648] });
    expect((decoded?.reward as Message).amount).toBe(9223372036854775807n);
    expect((decoded?.items as Message[])[0]?.amount).toBe(9007199254740991n);
  });

  it('bytes equal the protobuf encoding of protobufjs, both ways', () => {
    const quest = fullQuest();
    const bytes = quest.encode();
    const type = root.lookupType('game.QuestUserState');
    const reencoded = type.encode(type.decode(bytes)).finish();
    expect(Array.from(reencoded)).toEqual(Array.from(bytes));
    const object = protobufjsObject('game.QuestUserState', bytes);
    expect(object.id).toBe('42');
    expect(object.i64).toBe('-9223372036854775808');
    expect(object.list_i64).toEqual(['0', '-1', '123456789012345']);
    expect(object.text).toBe('퀘스트 ✓');
    expect(object.blob).toEqual([0, 255, 7]);
    expect(object.f32).toBe(1.5);
    expect((object.reward as Record<string, unknown>).amount).toBe('9223372036854775807');
    expect((object.items as Record<string, unknown>[])[0]?.amount).toBe('9007199254740991');
  });

  it('decodes what protobufjs encodes, including unpacked repeated numbers', () => {
    const type = root.lookupType('game.QuestUserState');
    const message = type.fromObject({ id: '9', i32: -3, list_i32: [5, 6], list_kind: [2], text: 'x', reward: { item_id: 1, amount: '-5' } });
    const decoded = cls(gameNs, 'QuestUserState').decode(type.encode(message).finish());
    expect(decoded?.id).toBe(9n);
    expect(decoded?.i32).toBe(-3);
    expect(decoded?.list_i32).toEqual([5, 6]);
    expect(decoded?.list_kind).toEqual([2]);
    expect((decoded?.reward as Message).amount).toBe(-5n);
    // field 11 list_i32 unpacked: tag (11 << 3 | 0), values 5 and 6
    const unpacked = cls(gameNs, 'QuestUserState').decode(new Uint8Array([88, 5, 88, 6]));
    expect(unpacked?.list_i32).toEqual([5, 6]);
  });

  it('default values are not written and decode to defaults', () => {
    const empty = new (cls(gameNs, 'QuestUserState'))();
    expect(empty.encode()).toEqual(new Uint8Array(0));
    const decoded = cls(gameNs, 'QuestUserState').decode(new Uint8Array(0));
    expect(decoded?.reward).toBeNull();
    expect(decoded?.list_text).toEqual([]);
    expect(decoded?.blob).toEqual(new Uint8Array(0));
    expect(decoded?.i64).toBe(0n);
  });

  it('a singular message field written twice is merged', () => {
    // reward (field 10) twice: first item_id 1, then amount 2
    const bytes = new Uint8Array([82, 2, 8, 1, 82, 2, 16, 2]);
    const decoded = cls(gameNs, 'QuestUserState').decode(bytes);
    expect((decoded?.reward as Message).item_id).toBe(1);
    expect((decoded?.reward as Message).amount).toBe(2n);
  });

  it('unknown fields are kept and written back', () => {
    // Detail with an unknown varint field 9 and an unknown length-delimited field 10
    const bytes = new Uint8Array([8, 3, 72, 150, 1, 82, 2, 104, 105]);
    const decoded = cls(gameNs, 'Detail').decode(bytes);
    expect(decoded?.count).toBe(3);
    expect(decoded?.encode()).toEqual(bytes);
    if (decoded) decoded.count = 4;
    expect(decoded?.encode()).toEqual(new Uint8Array([8, 4, 72, 150, 1, 82, 2, 104, 105]));
  });

  it('unknown enum values are kept', () => {
    const decoded = cls(gameNs, 'Detail').decode(new Uint8Array([16, 9]));
    expect(decoded?.kind).toBe(9);
    expect(decoded?.encode()).toEqual(new Uint8Array([16, 9]));
  });

  it('bad UTF-8 decodes, fails the utf8 rule, and encodes as well-formed UTF-8 with U+FFFD in place of each bad byte', () => {
    const bytes = new Uint8Array([26, 3, 0x61, 0xff, 0x62]);
    const request = cls(gameNs, 'ClaimQuestRequest').decode(bytes);
    expect(request).not.toBeNull();
    expect(request?.note).toBe('a\uDCFFb');
    expect(request?.encode()).toEqual(new Uint8Array([26, 5, 0x61, 0xef, 0xbf, 0xbd, 0x62]));
  });

  it.each([
    ['a lone low surrogate decode makes of a bad byte', 'a\uDC80b'],
    ['the highest of them', '\uDCFF'],
    ['a lone high surrogate', 'a\uD83Db'],
    ['a lone low surrogate outside them', '\uDE00x'],
    ['a high surrogate at the end', 'x\uD800'],
  ])('a string the server code sets with %s encodes as well-formed UTF-8 with U+FFFD', (_name, text) => {
    const request = new (cls(gameNs, 'ClaimQuestRequest'))();
    request.note = text;
    const bytes = request.encode();
    const payload = new TextEncoder().encode(text.toWellFormed());
    expect(bytes).toEqual(new Uint8Array([26, payload.length, ...payload]));
    expect(new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(2))).toBe(text.toWellFormed());
    expect(cls(gameNs, 'ClaimQuestRequest').decode(bytes)?.note).toBe(text.toWellFormed());
  });

  it('a leading U+FEFF is kept and encodes back to the same bytes', () => {
    // note (field 3) = "\uFEFFabc"
    const bytes = new Uint8Array([26, 6, 0xef, 0xbb, 0xbf, 0x61, 0x62, 0x63]);
    const request = cls(gameNs, 'ClaimQuestRequest').decode(bytes);
    expect(request?.note).toBe('\uFEFFabc');
    expect(request?.encode()).toEqual(bytes);
  });

  it('a U+FEFF after a bad byte is kept and encodes back with the bad byte as U+FFFD', () => {
    const bytes = new Uint8Array([26, 6, 0xff, 0x78, 0xef, 0xbb, 0xbf, 0x79]);
    const request = cls(gameNs, 'ClaimQuestRequest').decode(bytes);
    expect(request?.note).toBe('\uDCFFx\uFEFFy');
    expect(request?.encode()).toEqual(new Uint8Array([26, 8, 0xef, 0xbf, 0xbd, 0x78, 0xef, 0xbb, 0xbf, 0x79]));
  });

  it('many occurrences of a singular message field decode in linear time', () => {
    // reward (field 10) with an empty payload, 65536 times: 128 KB
    const count = 65536;
    const bytes = new Uint8Array(count * 2);
    for (let i = 0; i < count; i += 1) bytes[i * 2] = 82;
    const started = performance.now();
    const decoded = cls(gameNs, 'QuestUserState').decode(bytes);
    const elapsed = performance.now() - started;
    expect(decoded?.reward).not.toBeNull();
    expect(elapsed).toBeLessThan(500);
  });

  const malformed: [string, number[]][] = [
    ['truncated varint', [8, 0x80]],
    ['truncated length', [26, 5, 0x61]],
    ['wire type not of the field', [13, 0, 0, 0, 0]],
    ['field number 0', [0, 1]],
    ['group wire type', [11, 12]],
    ['bad nested message', [42, 2, 8, 0x80]],
    ['varint longer than 10 bytes', [8, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0x01]],
  ];
  for (const [name, bytes] of malformed) {
    it(`decode is null: ${name}`, () => {
      expect(cls(gameNs, 'ClaimQuestRequest').decode(new Uint8Array(bytes))).toBeNull();
    });
  }

  it('decode is null past the nesting limit', () => {
    const nested = (levels: number): Uint8Array => {
      let bytes = new Uint8Array([16, 1]);
      for (let i = 0; i < levels; i += 1) bytes = new Uint8Array([10, ...lengthBytes(bytes.length), ...bytes]);
      return bytes;
    };
    expect(cls(gameNs, 'TreeNode').decode(nested(50))).not.toBeNull();
    expect(cls(gameNs, 'TreeNode').decode(nested(150))).toBeNull();
  });

  it('cheat messages use game, core and core cheat types', () => {
    const request = new (cls(gameCheat, 'AddGoldRequest'))();
    const item = new (cls(core, 'ItemAmount'))();
    item.item_id = 1;
    const dev = new (cls(coreCheat, 'DevOnly'))();
    dev.level = 4;
    Object.assign(request, { amount: 5n, kind: 1, item, dev });
    const decoded = cls(gameCheat, 'AddGoldRequest').decode(request.encode());
    expect(decoded?.amount).toBe(5n);
    expect((decoded?.dev as Message).level).toBe(4);
    expect((decoded?.item as Message).item_id).toBe(1);
  });

  it('realtime messages round trip', () => {
    const message = new (cls(gameNs, 'RealtimeMessage'))();
    Object.assign(message, { kind: 1, x: 0.5, y: -3 });
    const decoded = cls(gameNs, 'RealtimeMessage').decode(message.encode());
    expect(decoded).toMatchObject({ kind: 1, x: 0.5, y: -3 });
  });
});

function lengthBytes(n: number): number[] {
  const out: number[] = [];
  let v = n;
  while (v >= 0x80) {
    out.push((v & 0x7f) | 0x80);
    v >>>= 7;
  }
  out.push(v);
  return out;
}

describe('proto3 JSON', () => {
  it('kind classes, ItemChange and ItemMail have JSON methods; other messages do not', () => {
    for (const [ns, name] of [[gameNs, 'QuestUserState'], [gameNs, 'ProfileUserState'], [gameNs, 'SeedServerState'], [gameNs, 'Reward'], [core, 'ItemChange'], [core, 'ItemMail'], [core, 'ItemBalanceUserState'], [core, 'ItemAmount']] as const) {
      expect(typeof cls(ns, name).from_json, name).toBe('function');
    }
    for (const [ns, name] of [[gameNs, 'BossGameState'], [gameNs, 'ClaimQuestRequest'], [core, 'LoginRequest']] as const) {
      expect(cls(ns, name).from_json, name).toBeUndefined();
    }
  });

  it('cheat request classes and what they reach have JSON methods and round trip', () => {
    for (const [ns, name] of [[gameCheat, 'AddGoldRequest'], [coreCheat, 'DevLoginRequest'], [coreCheat, 'DevOnly']] as const) {
      expect(typeof cls(ns, name).from_json, name).toBe('function');
    }
    expect(cls(gameCheat, 'AddGoldResponse').from_json).toBeUndefined();
    const dev = new (cls(coreCheat, 'DevOnly'))();
    dev.level = 4;
    const item = new (cls(core, 'ItemAmount'))();
    item.item_id = 2;
    const add = new (cls(gameCheat, 'AddGoldRequest'))();
    Object.assign(add, { amount: 900n, kind: enumOf(gameNs, 'QuestKind').QUEST_KIND_WEEKLY, item, dev });
    const addJson = add.to_json?.();
    expect(addJson).toEqual({ amount: '900', kind: 'QUEST_KIND_WEEKLY', item: { item_id: 2 }, dev: { level: 4 } });
    expect(cls(gameCheat, 'AddGoldRequest').from_json?.(addJson)).toEqual(add);
    const login = new (cls(coreCheat, 'DevLoginRequest'))();
    Object.assign(login, { name: 'tester', extra: dev });
    const loginJson = login.to_json?.();
    expect(loginJson).toEqual({ name: 'tester', extra: { level: 4 } });
    expect(cls(coreCheat, 'DevLoginRequest').from_json?.(loginJson)).toEqual(login);
  });

  it('to_json uses proto names, int64 strings, enum names, base64 bytes and leaves defaults out', () => {
    const quest = fullQuest();
    const json = quest.to_json?.() as Record<string, unknown>;
    expect(json.id).toBe('42');
    expect(json.i64).toBe('-9223372036854775808');
    expect(json.kind).toBe('QUEST_KIND_WEEKLY');
    expect(json.blob).toBe('AP8H');
    expect(json.list_i64).toEqual(['0', '-1', '123456789012345']);
    expect(json.list_kind).toEqual(['QUEST_KIND_DAILY', 'QUEST_KIND_UNSPECIFIED']);
    expect(json.started_at).toBe('1700000000000');
    expect((json.reward as Record<string, unknown>).source).toBe('ITEM_CHANGE_SOURCE_IAP_REFUND');
    expect((json.reward as Record<string, unknown>).big_amount).toBeUndefined();
    const empty = new (cls(gameNs, 'QuestUserState'))();
    expect(empty.to_json?.()).toEqual({});
  });

  it('to_json keeps the number of an enum value the enum does not define', () => {
    const quest = new (cls(gameNs, 'QuestUserState'))();
    Object.assign(quest, { kind: 77, list_kind: [2, 77] });
    const json = quest.to_json?.() as Record<string, unknown>;
    expect(json.kind).toBe(77);
    expect(json.list_kind).toEqual(['QUEST_KIND_WEEKLY', 77]);
  });

  it('from_json of to_json is the same message', () => {
    const quest = fullQuest();
    const back = cls(gameNs, 'QuestUserState').from_json?.(quest.to_json?.());
    expect(back?.encode()).toEqual(quest.encode());
  });

  it('from_json takes JSON names, numbers for int64 and enums, and ignores unknown keys', () => {
    const back = cls(gameNs, 'QuestUserState').from_json?.({ listI32: [1, '2'], i64: 5, kind: 2, startedAt: '7', other: true, reward: null });
    expect(back?.list_i32).toEqual([1, 2]);
    expect(back?.i64).toBe(5n);
    expect(back?.kind).toBe(2);
    expect(back?.started_at).toBe(7n);
    expect(back?.reward).toBeNull();
  });

  it('ItemChange and ItemMail convert', () => {
    const change = new (cls(core, 'ItemChange'))();
    Object.assign(change, { item_id: 3, delta: -10n, source: 1 });
    expect(change.to_json?.()).toEqual({ item_id: 3, delta: '-10', source: 'ITEM_CHANGE_SOURCE_SHOP' });
    const mail = new (cls(core, 'ItemMail'))();
    const item = new (cls(core, 'ItemAmount'))();
    Object.assign(item, { item_id: 1, amount: 0n, big_amount: '99999999999999999999' });
    Object.assign(mail, { mail_id: 8n, ref: 'r', items: [item] });
    const json = mail.to_json?.();
    expect(json).toEqual({ mail_id: '8', ref: 'r', items: [{ item_id: 1, big_amount: '99999999999999999999' }] });
    expect(cls(core, 'ItemMail').from_json?.(json)?.encode()).toEqual(mail.encode());
  });

  const bad: [string, unknown][] = [
    ['not an object', [1]],
    ['null', null],
    ['int64 not an integer', { id: '1.5' }],
    ['int64 out of range', { id: '9223372036854775808' }],
    ['int32 out of range', { i32: 2147483648 }],
    ['unknown enum name', { kind: 'QUEST_KIND_YEARLY' }],
    ['bool as string', { flag: 'true' }],
    ['repeated not an array', { list_i32: 1 }],
    ['bad base64', { blob: '***' }],
    ['bad nested message', { reward: { amount: 'x' } }],
    ['enum name toString', { kind: 'toString' }],
    ['enum name constructor', { kind: 'constructor' }],
    ['enum name __proto__', { kind: '__proto__' }],
    ['enum name hasOwnProperty in a list', { list_kind: ['hasOwnProperty'] }],
  ];
  for (const [name, json] of bad) {
    it(`from_json is null: ${name}`, () => {
      expect(cls(gameNs, 'QuestUserState').from_json?.(json)).toBeNull();
    });
  }

  it('from_json reads own keys only: fields named like Object members', async () => {
    const run = runGame({
      contract: {
        ...baseContract(),
        'user_state.proto': 'syntax = "proto3";\npackage game;\n\nmessage ObjectNamesUserState {\n  int64 value_of = 1;\n  int32 to_string = 2;\n  string has_own_property = 3;\n}\n',
      },
    });
    expect(run.code, run.stdout + run.stderr).toBe(0);
    const ns = (await import(pathToFileURL(join(run.game, 'server/generated/contract/game_contract.ts')).href)) as Module;
    const kind = cls(ns, 'ObjectNamesUserState');
    expect(kind.from_json?.({})?.value_of).toBe(0n);
    const empty = new kind();
    expect(kind.from_json?.(empty.to_json?.())?.encode()).toEqual(empty.encode());
    const full = new kind();
    Object.assign(full, { value_of: 3n, to_string: 4, has_own_property: 'x' });
    expect(kind.from_json?.(full.to_json?.())?.encode()).toEqual(full.encode());
    expect(kind.from_json?.({ valueOf: '5', toString: 6 })).toMatchObject({ value_of: 5n, to_string: 6 });
  });

  it('float special values', () => {
    const quest = new (cls(gameNs, 'QuestUserState'))();
    quest.f64 = Infinity;
    quest.list_f64 = [NaN, -Infinity];
    const json = quest.to_json?.() as Record<string, unknown>;
    expect(json.f64).toBe('Infinity');
    expect(json.list_f64).toEqual(['NaN', '-Infinity']);
    const back = cls(gameNs, 'QuestUserState').from_json?.(json);
    expect(back?.f64).toBe(Infinity);
    expect(Number.isNaN((back?.list_f64 as number[])[0])).toBe(true);
  });
});

function claim(fields: Record<string, unknown>): Message {
  const request = new (cls(gameNs, 'ClaimQuestRequest'))();
  const detail = new (cls(gameNs, 'Detail'))();
  Object.assign(request, { quest_id: 7, details: [detail] }, fields);
  return request;
}

function validateClaim(fields: Record<string, unknown>): Failure {
  const validate = gameNs.validate_ClaimQuestRequest as (m: Message, d: unknown) => Failure;
  return validate(claim(fields), data);
}

describe('field validators', () => {
  it('a valid request passes', () => {
    expect(validateClaim({ slot_ids: [1, 2], note: '한글', tags: ['a', 'b'], bet: -5n, proof: new Uint8Array(4), item_ids: [1, 2], seals: [new Uint8Array([1, 2]), new Uint8Array([1, 3])] })).toBeNull();
  });

  const failures: [string, Record<string, unknown>, string, string][] = [
    ['table value 0', { quest_id: 0 }, 'quest_id', 'table'],
    ['table value not in the table', { quest_id: 8 }, 'quest_id', 'table'],
    ['table of a table keyed by id', { item_ids: [1, 3] }, 'item_ids[1]', 'table'],
    ['max_count', { slot_ids: [1, 2, 3, 4, 5] }, 'slot_ids', 'max_count'],
    ['min_count', { details: [] }, 'details', 'min_count'],
    ['unique', { slot_ids: [1, 1] }, 'slot_ids', 'unique'],
    ['unique strings', { tags: ['a', 'a'] }, 'tags', 'unique'],
    ['unique bytes compares contents', { seals: [new Uint8Array([1, 2]), new Uint8Array([1, 2])] }, 'seals', 'unique'],
    ['min of an element', { slot_ids: [5, 0] }, 'slot_ids[1]', 'min'],
    ['max of an element', { slot_ids: [101] }, 'slot_ids[0]', 'max'],
    ['max_len counts UTF-8 bytes', { note: '가나다라' }, 'note', 'max_len'],
    ['max_chars counts code points', { note: 'abcde' }, 'note', 'max_chars'],
    ['max_chars of an element', { tags: ['abcd'] }, 'tags[0]', 'max_chars'],
    ['utf8', { note: `a${String.fromCharCode(0xdcff)}` }, 'note', 'utf8'],
    ['enum value not defined', { kind: 7 }, 'kind', 'enum'],
    ['int64 min', { bet: -6n }, 'bet', 'min'],
    ['int64 max', { bet: 9000000000001n }, 'bet', 'max'],
    ['bytes max_len', { proof: new Uint8Array(5) }, 'proof', 'max_len'],
  ];
  for (const [name, fields, path, rule] of failures) {
    it(`fails: ${name}`, () => {
      expect(validateClaim(fields)).toEqual({ path, rule });
    });
  }

  it('nested message paths', () => {
    const detail = new (cls(gameNs, 'Detail'))();
    detail.count = 6;
    expect(validateClaim({ detail })).toEqual({ path: 'detail.count', rule: 'max' });
    expect(validateClaim({ details: [new (cls(gameNs, 'Detail'))(), detail] })).toEqual({ path: 'details[1].count', rule: 'max' });
    const bad = new (cls(gameNs, 'Detail'))();
    bad.kind = 99;
    expect(validateClaim({ detail: bad })).toEqual({ path: 'detail.kind', rule: 'enum' });
    const item = new (cls(core, 'ItemAmount'))();
    item.item_id = 5;
    expect(validateClaim({ costs: [item] })).toEqual({ path: 'costs[0].item_id', rule: 'table' });
  });

  it('the first failure in field order is returned', () => {
    expect(validateClaim({ quest_id: 0, slot_ids: [0] })).toEqual({ path: 'quest_id', rule: 'table' });
  });

  it('module message validators', () => {
    const result = new (cls(gameNs, 'MatchResult'))();
    result.scores = [1, 11];
    expect((gameNs.validate_MatchResult as (m: Message, d: unknown) => Failure)(result, data)).toEqual({ path: 'scores[1]', rule: 'max' });
    const play = new (cls(gameNs, 'PlaySessionResult'))();
    play.stars = 4;
    expect((gameNs.validate_PlaySessionResult as (m: Message, d: unknown) => Failure)(play, data)).toEqual({ path: 'stars', rule: 'max' });
    const start = new (cls(gameNs, 'PlaySessionStartOptions'))();
    expect((gameNs.validate_PlaySessionStartOptions as (m: Message, d: unknown) => Failure)(start, data)).toBeNull();
    expect(gameNs.validate_PlaySessionLoadout).toBeUndefined();
  });

  it('core and cheat validators use the core settings value of _key options', () => {
    const login = new (cls(core, 'LoginRequest'))();
    login.token = 'x'.repeat(17);
    expect((core.validate_LoginRequest as (m: Message, d: unknown) => Failure)(login, data)).toEqual({ path: 'token', rule: 'max_len' });
    login.token = 'x'.repeat(16);
    expect((core.validate_LoginRequest as (m: Message, d: unknown) => Failure)(login, data)).toBeNull();
    const dev = new (cls(coreCheat, 'DevLoginRequest'))();
    dev.name = '가나다라마바사아자';
    expect((coreCheat.validate_DevLoginRequest as (m: Message, d: unknown) => Failure)(dev, data)).toEqual({ path: 'name', rule: 'max_chars' });
    const gold = new (cls(gameCheat, 'AddGoldRequest'))();
    gold.amount = 0n;
    expect((gameCheat.validate_AddGoldRequest as (m: Message, d: unknown) => Failure)(gold, data)).toEqual({ path: 'amount', rule: 'min' });
  });
});

describe('lists and constants', () => {
  it('RPCS of each name space', () => {
    const rpcs = (ns: Module): RpcInfo[] => ns.RPCS as RpcInfo[];
    const gameError = enumOf(gameNs, 'GameError');
    expect(rpcs(gameNs).map((r) => [r.name, r.silent, r.retry, r.sensitive, r.errors])).toEqual([
      ['ClaimQuest', false, true, false, [gameError.GAME_ERROR_NOT_ENOUGH_GOLD, gameError.GAME_ERROR_QUEST_LOCKED]],
      ['ListQuests', true, false, false, []],
    ]);
    expect(rpcs(core).map((r) => [r.name, r.sensitive, r.validate === null])).toEqual([['core/Login', true, false], ['core/StartPlay', false, true]]);
    expect(rpcs(coreCheat).map((r) => r.name)).toEqual(['core/cheat/DevLogin']);
    expect(rpcs(gameCheat).map((r) => [r.name, r.errors])).toEqual([['cheat/AddGold', [gameError.GAME_ERROR_NOT_ENOUGH_GOLD]]]);
    const claimRpc = rpcs(gameNs)[0];
    expect(claimRpc?.request_class).toBe(cls(gameNs, 'ClaimQuestRequest'));
    expect(claimRpc?.response_class).toBe(cls(gameNs, 'ClaimQuestResponse'));
    expect(claimRpc?.validate?.(claim({ quest_id: 0 }), data)).toEqual({ path: 'quest_id', rule: 'table' });
  });

  it('KINDS in store order with storage columns', () => {
    const kinds = (ns: Module): KindInfo[] => ns.KINDS as KindInfo[];
    expect(kinds(gameNs).map((k) => [k.name, k.store, k.column, k.is_list, k.is_public])).toEqual([
      ['QuestUserState', 'user_state', 'quest_user_state', true, true],
      ['ProfileUserState', 'user_state', 'profile_user_state', false, false],
      ['SeedServerState', 'server_state', 'seed_server_state', false, false],
      ['BossGameState', 'game_state', 'boss_game_state', false, false],
    ]);
    expect(kinds(gameNs)[0]?.kind_class).toBe(cls(gameNs, 'QuestUserState'));
    expect(kinds(core).map((k) => [k.name, k.store, k.is_list])).toEqual([['ItemBalanceUserState', 'user_state', true], ['ConsentUserState', 'user_state', false]]);
  });

  it('CORE_ERRORS, CONTRACT_VERSION, CONVERTERS and their files', () => {
    const gameError = enumOf(gameNs, 'GameError');
    expect([...(gameNs.CORE_ERRORS as Map<string, number[]>)]).toEqual([['core/StartPlay', [gameError.GAME_ERROR_NO_LIVES, gameError.GAME_ERROR_QUEST_LOCKED]]]);
    expect(gameNs.CONTRACT_VERSION).toBe(RICH_CONTRACT_VERSION);
    const converters = [{ kind: 'QuestUserState', from_version: 1 }, { kind: 'QuestUserState', from_version: 2 }, { kind: 'SeedServerState', from_version: 1 }];
    expect(gameNs.CONVERTERS).toEqual(converters);
    expect(readFileSync(join(game, 'server/generated/contract/contract_version'), 'utf8')).toBe(`${String(RICH_CONTRACT_VERSION)}\n`);
    expect(JSON.parse(readFileSync(join(game, 'server/generated/contract/converters.json'), 'utf8'))).toEqual(converters);
  });

  it('module messages the game does not define are field-less classes', () => {
    const options = new (cls(gameNs, 'PlaySessionContinueOptions'))();
    expect(options.encode()).toEqual(new Uint8Array(0));
    expect(cls(gameNs, 'PublicProfile').decode(new Uint8Array([8, 1]))?.encode()).toEqual(new Uint8Array([8, 1]));
    expect(cls(gameNs, 'PlaySessionLoadout').decode(new Uint8Array([8, 1]))?.hero_ids).toEqual([1]);
  });

  it('the server type set has no DEV types and the DEV set has them', () => {
    expect(core.DevOnly).toBeUndefined();
    expect(core.DevLoginRequest).toBeUndefined();
    expect(typeof coreCheat.DevOnly).toBe('function');
    expect(gameNs.AddGoldRequest).toBeUndefined();
    expect(typeof core.ItemAmount).toBe('function');
  });
});
