/**
 * Server generated code: the table binaries the tool encodes decode with the generated `load_data_set` into the
 * cell values, and decode the same with an independent protobuf reader of the generated `game_data.proto`.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import protobuf from 'protobufjs';
import { describe, expect, test } from 'vitest';
import { enums, fixture, run, table, typeErrors, writeFiles, type Fixture } from './helpers.ts';

/** A hand-written `CoreContract.ItemAmount` with the `server-core` `## generated code` API. */
const CORE_CONTRACT = `export class ItemAmount {
  item_id = 0;
  amount = 0n;
  big_amount = "";

  static decode(bytes: Uint8Array): ItemAmount | null {
    const m = new ItemAmount();
    let pos = 0;
    const varint = (): bigint => {
      let r = 0n;
      let s = 0n;
      for (;;) {
        const b = bytes[pos++];
        if (b === undefined) throw new Error("eof");
        r |= BigInt(b & 0x7f) << s;
        if ((b & 0x80) === 0) return r;
        s += 7n;
      }
    };
    try {
      while (pos < bytes.length) {
        const tag = Number(varint());
        if (tag === 8) m.item_id = Number(BigInt.asIntN(32, varint()));
        else if (tag === 16) m.amount = BigInt.asIntN(64, varint());
        else if (tag === 26) {
          const n = Number(varint());
          m.big_amount = new TextDecoder().decode(bytes.subarray(pos, pos + n));
          pos += n;
        } else return null;
      }
    } catch {
      return null;
    }
    return m;
  }
}
`;

const MONSTER = table(
  ['id|id(key)|All', 'name_text|tstring<id>|Client', 'hp|int|All', 'gold|long|All', 'speed|float|All', 'ratio|double|Server', 'boss|bool|All',
    'note|string|Server', 'icon|reskey|Client', 'pos|vector2<int>|All', 'scale|vector3<float>|Client', 'element|enum<Element>|All',
    'weak|enum<Element>?|All', 'spawn_at|datetime?|All', 'respawn|duration|All', 'drops|array<int>|All', 'tags|array<string>|Server',
    'path|array<vector2<int>>|All', 'grid|array<array<int>>|All', 'waves|array<{minion: ref<monster.id>, count: int}>|All',
    'reward|array<{item_id: ref<item.id>, amount: long}>|All', 'unlock|requirement|All', 'level|int?|All', '#memo', 'friend|ref<monster.id>?|All'],
  [
    ['[slime]', '슬라임', '10', '9007199254740993', '1.5', '0.25', 'false', 'kill [bat] first', 'icon/slime', '1,-2', '1,2.5,3', 'Fire',
      'null', '2026-01-02T03:04:05Z', '1h30m', '1,2,3', 'a\nb', '1,2\n3,4', '1,2\n\n3', '[bat] 2, [bat] 1',
      '[gold] 5, [gem] 123456789012345678901234567890', 'Level(3) & (Has([gem]) | Level(5))', '-7', 'memo text', '[bat]'],
    ['[bat]', '박쥐', '-2147483648', '-1', '0', '0', 'true', '', 'icon/bat', '0,0', '0,0,0', 'Water', 'Fire', 'null', '0ms', '', '', '', '', '', '', '', 'null', '', 'null'],
    ['#[ghost]', '유령', '1', '1', '1', '1', 'true', '', 'icon/ghost', '0,0', '0,0,0', 'Fire', 'null', 'null', '1s', '', '', '', '', '', '', '', 'null', '', 'null'],
  ],
);

const STAGE = table(['id|id|All', 'wave|int|All', 'text|tstring<id,wave>|Client'], [['[forest]', '1', '첫 웨이브'], ['[forest]', '2', '두 번째'], ['[cave]', '1', '동굴']]);
const ITEM = table(['id|id(key)|All', 'kind|enum<Element>|All'], [['[gold]', 'Fire'], ['[gem]', 'Water']]);

function game(): Fixture {
  const f = fixture({
    settings: { sourceLanguage: 'ko', supportedLanguages: ['ko', 'en'] },
    files: {
      'data/tables/monster.csv': MONSTER,
      'data/tables/stage.csv': STAGE,
      'data/tables/item.csv': ITEM,
      'data/tables/language.csv': table(['id|id(key)|All', 'code|string|All'], [['[ko]', 'ko'], ['[en]', 'en']]),
      'data/enums.csv': enums([['Element', 'Fire', 1], ['Element', 'Water', 2], ['RequirementType', 'Level', 1], ['RequirementType', 'Has', 2]]),
      'data/requirement_types.csv': 'element,target,value,#comment\nLevel,none,true,\nHas,ref<item.id>,false,\n',
      'data/system/game_setting.csv': table(['id|id(key)|All', 'target|string|None', 'data_type|string|None', 'value|string|All'], [
        ['[max_stamina]', 'All', 'int', '120'], ['[boss_monster]', 'Server', 'ref<monster.id>', '[slime]'], ['[spawn_rate]', 'All', 'float', '0.75'],
        ['[start_pos]', 'All', 'vector2<int>', '3, 4'], ['[first_drops]', 'All', 'array<int>', '[gold],7'], ['[client_only]', 'Client', 'bool', 'true'],
        ['[season_start]', 'All', 'datetime', '2026-01-01T00:00:00Z'], ['[open_rule]', 'All', 'requirement', 'Level(2)'], ['[home_element]', 'All', 'enum<Element>', 'Water'],
        ['[motto]', 'All', 'string', 'beat [slime]'],
      ]),
      'data/system/reserved_id.csv': table(['id|id(key)|All', 'target|string|None', 'value|string|All'], [['[first_monster]', 'All', '[slime]'], ['[client_monster]', 'Client', '[bat]']]),
      'data/system/reserved_string.csv': table(['id|id(key)|All', 'text|tstring<id>|All'], [['[hello]', '안녕']]),
      'resource/resources.csv': 'key,description\nicon/slime,\nicon/bat,\nicon/ghost,\n',
    },
  });
  writeFiles(f.game, { 'server/generated/contract/core_contract.ts': CORE_CONTRACT });
  return f;
}

function binaries(f: Fixture): Map<string, Uint8Array> {
  const dir = join(f.game, 'server', 'build', 'data');
  return new Map(readdirSync(dir).filter((n) => n.endsWith('.bin')).map((n) => [n, new Uint8Array(readFileSync(join(dir, n)))]));
}

function registry(f: Fixture): Record<string, number> {
  return JSON.parse(readFileSync(f.registry, 'utf8')) as Record<string, number>;
}

type Obj = Record<string, unknown>;

interface Container {
  get_row(id: number): Obj;
  has_row(id: number): boolean;
  get_rows(id: number): Obj[];
  has_rows(id: number): boolean;
  all_rows(): Obj[];
  empty_row(): Obj;
}

interface GameDataModule {
  load_data_set(files: ReadonlyMap<string, Uint8Array>): Obj | null;
  load_translation(bytes: Uint8Array): ReadonlyMap<string, string> | null;
}

function tbl(set: Obj, name: string): Container {
  return set[name] as Container;
}

function acc(set: Obj, name: string): Record<string, (() => unknown) | undefined> {
  return set[name] as Record<string, (() => unknown) | undefined>;
}

async function load(f: Fixture): Promise<{ set: Obj; ids: Record<string, number> }> {
  const mod = (await import(join(f.game, 'server', 'generated', 'data', 'game_data.ts'))) as GameDataModule;
  const set = mod.load_data_set(binaries(f));
  expect(set).not.toBeNull();
  return { set: set as Obj, ids: registry(f) };
}

describe('server generated code round trip', () => {
  test('every column type decodes to its cell value', async () => {
    const f = game();
    const r = run(f);
    expect(r.stderr).toEqual([]);
    expect(r.stdout.filter((l) => !l.includes('translation_missing'))).toEqual([]);
    expect(r.code).toBe(0);
    expect(typeErrors(f)).toEqual([]);
    const { set, ids } = await load(f);
    const id = (n: string): number => ids[n] as number;
    const slime = tbl(set, 'MonsterTable').get_row(id('[slime]'));
    expect(slime.id).toBe(id('[slime]'));
    expect(slime.hp).toBe(10);
    expect(slime.gold).toBe(9007199254740993n);
    expect(slime.speed).toBe(1.5);
    expect(slime.ratio).toBe(0.25);
    expect(slime.boss).toBe(false);
    expect(slime.note).toBe(`kill ${String(id('[bat]'))} first`);
    expect(slime.icon).toBeUndefined();
    expect(slime.name_text).toBeUndefined();
    expect({ ...(slime.pos as Obj) }).toEqual({ x: 1, y: -2 });
    expect(slime.scale).toBeUndefined();
    expect(slime.element).toBe(1);
    expect(slime.weak).toBe(0);
    expect(slime.spawn_at).toBe(BigInt(Date.UTC(2026, 0, 2, 3, 4, 5)));
    expect(slime.respawn).toBe(5_400_000n);
    expect(slime.drops).toEqual([1, 2, 3]);
    expect(slime.tags).toEqual(['a', 'b']);
    expect((slime.path as Obj[]).map((p) => ({ ...p }))).toEqual([{ x: 1, y: 2 }, { x: 3, y: 4 }]);
    expect(slime.grid).toEqual([[1, 2], [], [3]]);
    expect((slime.waves as Obj[]).map((w) => ({ ...w }))).toEqual([{ minion: id('[bat]'), count: 2 }, { minion: id('[bat]'), count: 1 }]);
    expect((slime.reward as Obj[]).map((w) => ({ ...w }))).toEqual([
      { item_id: id('[gold]'), amount: 5n, big_amount: '' },
      { item_id: id('[gem]'), amount: 0n, big_amount: '123456789012345678901234567890' },
    ]);
    expect(slime.level).toBe(-7);
    expect(slime.friend).toBe(id('[bat]'));
    const bat = tbl(set, 'MonsterTable').get_row(id('[bat]'));
    expect(bat.hp).toBe(-2147483648);
    expect(bat.gold).toBe(-1n);
    expect(bat.boss).toBe(true);
    expect(bat.weak).toBe(1);
    expect(bat.drops).toEqual([]);
    expect({ ...(bat.pos as Obj) }).toEqual({ x: 0, y: 0 });
    expect(bat.unlock).toBe(0);
    expect(tbl(set, 'MonsterTable').all_rows().length).toBe(2);
    expect(tbl(set, 'MonsterTable').has_row(12345)).toBe(false);
    expect(tbl(set, 'MonsterTable').get_row(12345)).toBe(tbl(set, 'MonsterTable').empty_row());
    expect(ids['[ghost]']).toBeUndefined();
  });

  test('requirement rows, id tables and accessors', async () => {
    const f = game();
    expect(run(f).code).toBe(0);
    const { set, ids } = await load(f);
    const id = (n: string): number => ids[n] as number;
    const slime = tbl(set, 'MonsterTable').get_row(id('[slime]'));
    const top = tbl(set, 'RequirementTable').get_row(slime.unlock as number);
    expect(slime.unlock).toBe(id('[req__monster__unlock__slime__1]'));
    expect(top.type).toBe(0);
    expect(top.logic).toBe(1);
    expect(top.children).toEqual([id('[req__monster__unlock__slime__2]'), id('[req__monster__unlock__slime__3]')]);
    const level = tbl(set, 'RequirementTable').get_row(id('[req__monster__unlock__slime__2]'));
    expect([level.type, level.target_id, level.value, level.logic]).toEqual([1, 0, 3n, 0]);
    const any = tbl(set, 'RequirementTable').get_row(id('[req__monster__unlock__slime__3]'));
    expect(any.logic).toBe(2);
    expect(any.children).toEqual([id('[req__monster__unlock__slime__4]'), id('[req__monster__unlock__slime__5]')]);
    const has = tbl(set, 'RequirementTable').get_row(id('[req__monster__unlock__slime__4]'));
    expect([has.type, has.target_id]).toEqual([2, id('[gem]')]);
    const forest = tbl(set, 'StageTable').get_rows(id('[forest]'));
    expect(forest.map((r) => r.wave)).toEqual([1, 2]);
    expect(tbl(set, 'StageTable').has_rows(999)).toBe(false);
    expect(tbl(set, 'StageTable').get_rows(999)).toEqual([]);
    expect(acc(set, 'GameSetting').max_stamina?.()).toBe(120);
    expect(acc(set, 'GameSetting').boss_monster?.()).toBe(id('[slime]'));
    expect(acc(set, 'GameSetting').spawn_rate?.()).toBe(0.75);
    expect({ ...(acc(set, 'GameSetting').start_pos?.() as Obj) }).toEqual({ x: 3, y: 4 });
    expect(acc(set, 'GameSetting').first_drops?.()).toEqual([id('[gold]'), 7]);
    expect(acc(set, 'GameSetting').client_only).toBeUndefined();
    expect(acc(set, 'GameSetting').season_start?.()).toBe(BigInt(Date.UTC(2026, 0, 1)));
    expect(acc(set, 'GameSetting').open_rule?.()).toBe(id('[req__game_setting__value__open_rule__1]'));
    expect(acc(set, 'GameSetting').home_element?.()).toBe(2);
    expect(acc(set, 'GameSetting').motto?.()).toBe(`beat ${String(id('[slime]'))}`);
    expect(acc(set, 'ReservedId').first_monster?.()).toBe(id('[slime]'));
    expect(acc(set, 'ReservedId').client_monster?.()).toBe(0);
    expect(acc(set, 'ReservedString').hello?.()).toBe(`reserved_string.text.${String(id('[hello]'))}`);
  });

  test('the DEV accessor maps ID names and ID values both ways', async () => {
    const f = game();
    expect(run(f).code).toBe(0);
    const ids = registry(f);
    const dev = (await import(join(f.game, 'server', 'dev', 'generated', 'data', 'game_data_dev.ts'))) as { find_id_value(n: string): number; find_id_name(v: number): string };
    expect(dev.find_id_value('[slime]')).toBe(ids['[slime]']);
    expect(dev.find_id_name(ids['[slime]'] as number)).toBe('[slime]');
    expect(dev.find_id_value('[nothing]')).toBe(0);
    expect(dev.find_id_name(99999)).toBe('');
  });

  test('enums are const objects with a type alias; data enums named like globals outside the data skill list keep the code working', async () => {
    const f = fixture({
      files: {
        'data/tables/gate.csv': table(['id|id(key)|All', 'view|enum<DataView>|All', 'map|enum<ReadonlyMap>?|All', 'text|enum<TextDecoder>|All', 'label|tstring<id>|All'], [['[g]', 'Wide', 'Big', 'Utf', '문']]),
        'data/enums.csv': enums([['DataView', 'Wide', 3], ['ReadonlyMap', 'Big', 1], ['TextDecoder', 'Utf', 1]]),
      },
    });
    const r = run(f);
    expect(r.stdout).toEqual([]);
    expect(r.code).toBe(0);
    expect(typeErrors(f)).toEqual([]);
    const text = readFileSync(join(f.game, 'server', 'generated', 'data', 'game_data.ts'), 'utf8');
    expect(text).toContain('export const DataView = {\n  None: 0,\n  Wide: 3,\n} as const;\nexport type DataView = (typeof DataView)[keyof typeof DataView];\n');
    const { set, ids } = await load(f);
    const row = tbl(set, 'GateTable').get_row(ids['[g]'] as number);
    expect([row.view, row.map, row.text, row.label]).toEqual([3, 1, 1, `gate.label.${String(ids['[g]'])}`]);
  });

  test('an int key column holding an ID name builds the ID value into the translation key; the translation file keeps the ID name', async () => {
    const f = fixture({
      files: {
        'data/tables/stage.csv': table(['id|id(key)|All'], [['[stage_1]']]),
        'data/tables/reward.csv': table(['id|id|All', 'stage|int|All', 'desc|tstring<id,stage>|All'], [['[r]', '[stage_1]', '보상'], ['[r]', '2', '둘']]),
      },
    });
    expect(run(f)).toEqual({ code: 0, stdout: [], stderr: [] });
    expect(readFileSync(join(f.game, 'data', 'translations', 'ko.csv'), 'utf8')).toContain('reward.desc.[r].[stage_1],');
    const { set, ids } = await load(f);
    const rows = tbl(set, 'RewardTable').get_rows(ids['[r]'] as number);
    expect(rows.map((x) => [x.stage, x.desc])).toEqual([
      [ids['[stage_1]'], `reward.desc.${String(ids['[r]'])}.${String(ids['[stage_1]'])}`],
      [2, `reward.desc.${String(ids['[r]'])}.2`],
    ]);
  });

  test('a bundle list field of type id holds the ID value', async () => {
    const f = fixture({
      files: {
        'data/tables/monster.csv': table(['id|id(key)|All'], [['[slime]']]),
        'data/tables/wave.csv': table(['id|id(key)|All', 'spawns|array<{monster: id, count: int}>|All'], [['[w1]', '[slime] 5, [slime] 2']]),
      },
    });
    expect(run(f)).toEqual({ code: 0, stdout: [], stderr: [] });
    expect(typeErrors(f)).toEqual([]);
    expect(readFileSync(join(f.game, 'server', 'generated', 'data', 'game_data.proto'), 'utf8')).toContain('message WaveSpawnsItem {\n  int32 monster = 1;\n  int32 count = 2;\n}');
    const { set, ids } = await load(f);
    const w1 = tbl(set, 'WaveTable').get_row(ids['[w1]'] as number);
    expect((w1.spawns as Obj[]).map((x) => ({ ...x }))).toEqual([{ monster: ids['[slime]'], count: 5 }, { monster: ids['[slime]'], count: 2 }]);
    const missing = fixture({ files: { 'data/tables/wave.csv': table(['id|id(key)|All', 'spawns|array<{monster: id, count: int}>|All'], [['[w1]', '[ghost] 1']]) } });
    expect(run(missing).stdout.map((l) => l.split(' ').slice(0, 3).join(' '))).toEqual(['data/tables/wave.csv:5:2 ERROR ref_missing']);
  });

  test('accessors named table read their rows; the accessor classes keep their table where no accessor name can go', async () => {
    const f = fixture({
      files: {
        'data/tables/item.csv': table(['id|id(key)|All'], [['[sword]']]),
        'data/system/game_setting.csv': table(['id|id(key)|All', 'target|string|None', 'data_type|string|None', 'value|string|All'], [['[table]', 'All', 'int', '3']]),
        'data/system/reserved_id.csv': table(['id|id(key)|All', 'target|string|None', 'value|string|All'], [['[table]', 'All', '[sword]']]),
        'data/system/reserved_string.csv': table(['id|id(key)|All', 'text|tstring<id>|All'], [['[table]', '탁자']]),
      },
    });
    expect(run(f)).toEqual({ code: 0, stdout: [], stderr: [] });
    expect(typeErrors(f)).toEqual([]);
    const { set, ids } = await load(f);
    expect(acc(set, 'GameSetting').table?.()).toBe(3);
    expect(acc(set, 'ReservedId').table?.()).toBe(ids['[sword]']);
    expect(acc(set, 'ReservedString').table?.()).toBe(`reserved_string.text.${String(ids['[table]'])}`);
  });

  test('tables whose names differ only by underscores make different constant names', async () => {
    const f = fixture({ files: { 'data/tables/x_axis.csv': table(['id|id(key)|All', 'v|int|All'], [['[a]', '1']]), 'data/tables/xaxis.csv': table(['id|id(key)|All', 'v|int|All'], [['[b]', '2']]) } });
    expect(run(f)).toEqual({ code: 0, stdout: [], stderr: [] });
    expect(typeErrors(f)).toEqual([]);
    const { set, ids } = await load(f);
    expect(tbl(set, 'XAxisTable').get_row(ids['[a]'] as number).v).toBe(1);
    expect(tbl(set, 'XaxisTable').get_row(ids['[b]'] as number).v).toBe(2);
    expect(tbl(set, 'XAxisTable').empty_row()).not.toBe(tbl(set, 'XaxisTable').empty_row());
  });

  test('a table binary that does not decode fails the load', async () => {
    const f = game();
    expect(run(f).code).toBe(0);
    const mod = (await import(join(f.game, 'server', 'generated', 'data', 'game_data.ts'))) as GameDataModule;
    const files = binaries(f);
    files.set('monster.bin', new Uint8Array([0x0a, 0x7f, 0x01]));
    expect(mod.load_data_set(files)).toBeNull();
    files.delete('monster.bin');
    expect(mod.load_data_set(files)).toBeNull();
  });

  test('load_translation reads a translation binary into its texts by build translation key', async () => {
    const f = game();
    expect(run(f).code).toBe(0);
    const mod = (await import(join(f.game, 'server', 'generated', 'data', 'game_data.ts'))) as GameDataModule;
    const key = `reserved_string.text.${String(registry(f)['[hello]'])}`;
    const bins = binaries(f);
    expect([...(mod.load_translation(bins.get('translation_ko.bin') as Uint8Array) ?? [])]).toEqual([[key, '안녕']]);
    expect(mod.load_translation(bins.get('translation_en.bin') as Uint8Array)?.get(key)).toBe('안녕');
    expect(mod.load_translation(new Uint8Array())?.size).toBe(0);
  });

  test('load_translation is null for bytes that do not decode as Translation, also after valid entries', async () => {
    const f = game();
    expect(run(f).code).toBe(0);
    const mod = (await import(join(f.game, 'server', 'generated', 'data', 'game_data.ts'))) as GameDataModule;
    const valid = binaries(f).get('translation_ko.bin') as Uint8Array;
    expect(mod.load_translation(new Uint8Array([0x0a, 0x05, 0x01]))).toBeNull();
    expect(mod.load_translation(new Uint8Array([...valid, 0x0a, 0x05, 0x0a, 0x01]))).toBeNull();
    expect(mod.load_translation(new Uint8Array([...valid, 0x08, 0x01]))).toBeNull();
    expect(mod.load_translation(new Uint8Array([...valid, 0x0a, 0x02, 0x08, 0x01]))).toBeNull();
  });

  test('an independent protobuf reader of game_data.proto reads the binaries the same', () => {
    const f = game();
    expect(run(f).code).toBe(0);
    const ids = registry(f);
    const root = new protobuf.Root();
    root.resolvePath = (_origin: string, target: string) => (target === 'ogw/core.proto' ? join(f.baseProto, 'ogw', 'core.proto') : target);
    root.loadSync(join(f.game, 'server', 'generated', 'data', 'game_data.proto'), { keepCase: true });
    const bins = binaries(f);
    const monsters = root.lookupType('ogw.data.MonsterTable').toObject(root.lookupType('ogw.data.MonsterTable').decode(bins.get('monster.bin') as Uint8Array), { longs: String, defaults: true }) as { rows: Record<string, unknown>[] };
    const slime = monsters.rows.find((x) => x.id === ids['[slime]']) as Obj;
    expect(slime.gold).toBe('9007199254740993');
    expect(slime.grid).toEqual([{ values: [1, 2] }, { values: [] }, { values: [3] }]);
    expect((slime.reward as Obj[])[1]?.big_amount).toBe('123456789012345678901234567890');
    expect(slime.element).toBe(1);
    const translation = root.lookupType('ogw.data.Translation');
    const en = translation.toObject(translation.decode(bins.get('translation_en.bin') as Uint8Array)) as { entries: { key: string; text: string }[] };
    expect(en.entries.map((e) => e.key)).toEqual([`reserved_string.text.${String(ids['[hello]'])}`]);
    expect(en.entries[0]?.text).toBe('안녕');
  });
});
