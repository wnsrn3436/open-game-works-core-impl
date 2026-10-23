/**
 * `array<{item_id: ref<item.id>, amount: long}>` with the base proto of this core: the column builds as the
 * `repeated` of `ogw.core.ItemAmount`, an amount whose absolute value is at most 2^53−1 goes in `amount`, a larger
 * one in `big_amount`, and an amount that is not a big integer is `value_type`.
 */
import { copyFileSync, mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import protobuf from 'protobufjs';
import { describe, expect, test } from 'vitest';
import { fixture, lines, run, table, type Fixture } from './helpers.ts';

/** `open-game-works-core-impl/proto/`: the base proto of this core. */
const BASE_PROTO = resolve(import.meta.dirname, '..', '..', '..', 'proto');

/** `descriptor.proto` that `ogw/options.proto` imports, from the protobuf reader package. */
const DESCRIPTOR_PROTO = resolve(import.meta.dirname, '..', 'node_modules', 'protobufjs', 'google', 'protobuf', 'descriptor.proto');

/** `open-game-works-core-impl/server/generated/contract/`: the server generated code of the base proto. */
const CORE_CONTRACT = resolve(import.meta.dirname, '..', '..', '..', 'server', 'generated', 'contract');

const ITEM = table(['id|id(key)|All'], [['[gold]'], ['[gem]']]);
const PAY = 'pay|array<{item_id: ref<item.id>, amount: long}>|All';
const MAX_SAFE = '9007199254740991';

function game(rows: string[][]): Fixture {
  return fixture({
    baseProto: {
      'ogw/core.proto': readFileSync(join(BASE_PROTO, 'ogw', 'core.proto'), 'utf8'),
      'ogw/options.proto': readFileSync(join(BASE_PROTO, 'ogw', 'options.proto'), 'utf8'),
    },
    files: { 'data/tables/item.csv': ITEM, 'data/tables/shop.csv': table(['id|id(key)|All', PAY], rows) },
  });
}

const ROWS = [
  ['[small]', `[gold] 5, [gem] -${MAX_SAFE}`],
  ['[edge]', `[gold] ${MAX_SAFE}, [gem] 9007199254740992`],
  ['[huge]', '[gold] -123456789012345678901234567890'],
  ['[none]', ''],
];

function registry(f: Fixture): Record<string, number> {
  return JSON.parse(readFileSync(f.registry, 'utf8')) as Record<string, number>;
}

function binaries(f: Fixture): Map<string, Uint8Array> {
  const dir = join(f.game, 'server', 'build', 'data');
  return new Map(readdirSync(dir).filter((n) => n.endsWith('.bin')).map((n) => [n, new Uint8Array(readFileSync(join(dir, n)))]));
}

type Obj = Record<string, unknown>;

describe('ItemAmount column with the base proto of this core', () => {
  test('the column is the repeated of ogw.core.ItemAmount in the data proto', () => {
    const f = game(ROWS);
    const r = run(f);
    expect(r.stdout.filter((l) => l.includes(' ERROR '))).toEqual([]);
    expect(r.code).toBe(0);
    const proto = readFileSync(join(f.game, 'server', 'generated', 'data', 'game_data.proto'), 'utf8');
    expect(proto).toContain('import "ogw/core.proto";');
    expect(proto).toMatch(/\n {2}repeated ogw\.core\.ItemAmount pay = \d+;\n/);
  });

  test('a protobuf reader of the base proto reads amount up to 2^53−1 in amount and a larger one in big_amount', () => {
    const f = game(ROWS);
    expect(run(f).code).toBe(0);
    const ids = registry(f);
    const root = new protobuf.Root();
    root.resolvePath = (_origin: string, target: string) => {
      if (target === 'google/protobuf/descriptor.proto') return DESCRIPTOR_PROTO;
      return target.startsWith('ogw/') ? join(f.baseProto, target) : target;
    };
    root.loadSync(join(f.game, 'server', 'generated', 'data', 'game_data.proto'), { keepCase: true });
    const type = root.lookupType('ogw.data.ShopTable');
    const shop = type.toObject(type.decode(binaries(f).get('shop.bin') as Uint8Array), { longs: String, defaults: true }) as { rows: { id: number; pay: Obj[] }[] };
    const pay = (name: string): Obj[] => (shop.rows.find((row) => row.id === ids[name]) as { pay: Obj[] }).pay;
    const gold = ids['[gold]'];
    const gem = ids['[gem]'];
    expect(pay('[small]')).toEqual([{ item_id: gold, amount: '5', big_amount: '' }, { item_id: gem, amount: `-${MAX_SAFE}`, big_amount: '' }]);
    expect(pay('[edge]')).toEqual([{ item_id: gold, amount: MAX_SAFE, big_amount: '' }, { item_id: gem, amount: '0', big_amount: '9007199254740992' }]);
    expect(pay('[huge]')).toEqual([{ item_id: gold, amount: '0', big_amount: '-123456789012345678901234567890' }]);
    expect(pay('[none]')).toEqual([]);
  });

  test('the server generated code loads the column as CoreContract.ItemAmount of the base proto', async () => {
    const f = game(ROWS);
    expect(run(f).code).toBe(0);
    const contract = join(f.game, 'server', 'generated', 'contract');
    mkdirSync(contract, { recursive: true });
    for (const file of ['core_contract.ts', 'wire.ts']) copyFileSync(join(CORE_CONTRACT, file), join(contract, file));
    const mod = (await import(join(f.game, 'server', 'generated', 'data', 'game_data.ts'))) as { load_data_set(files: ReadonlyMap<string, Uint8Array>): Obj | null };
    const core = (await import(join(contract, 'core_contract.ts'))) as { ItemAmount: new () => object };
    const set = mod.load_data_set(binaries(f));
    expect(set).not.toBeNull();
    const ids = registry(f);
    const table = (set as Obj).ShopTable as { get_row(id: number): Obj };
    const pay = (name: string): Obj[] => table.get_row(ids[name] as number).pay as Obj[];
    for (const item of [...pay('[small]'), ...pay('[edge]'), ...pay('[huge]')]) expect(item).toBeInstanceOf(core.ItemAmount);
    const plain = (name: string): Obj[] => pay(name).map((item) => ({ item_id: item.item_id, amount: item.amount, big_amount: item.big_amount }));
    const gold = ids['[gold]'];
    const gem = ids['[gem]'];
    expect(plain('[small]')).toEqual([{ item_id: gold, amount: 5n, big_amount: '' }, { item_id: gem, amount: -9007199254740991n, big_amount: '' }]);
    expect(plain('[edge]')).toEqual([{ item_id: gold, amount: 9007199254740991n, big_amount: '' }, { item_id: gem, amount: 0n, big_amount: '9007199254740992' }]);
    expect(plain('[huge]')).toEqual([{ item_id: gold, amount: 0n, big_amount: '-123456789012345678901234567890' }]);
    expect(pay('[none]')).toEqual([]);
  });

  test('an amount that is not a big integer is value_type', () => {
    const bad = ['01', '-0', '+5', '1.5', '1e3', '5x', ''];
    const f = game(bad.map((amount, i) => [`[bad_${String(i)}]`, `[gold] ${amount}`]));
    const r = run(f);
    expect(r.code).toBe(1);
    expect(lines(r, 'value_type').map((l) => l.split(' ').slice(0, 3).join(' '))).toEqual(bad.map((_, i) => `data/tables/shop.csv:${String(i + 5)}:2 ERROR value_type`));
  });
});
