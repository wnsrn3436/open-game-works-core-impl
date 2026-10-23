/** `ItemChange` and `ItemMail` of the server generated code of this core's base proto: proto3 JSON round trip. */
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { runTool } from '../src/run.ts';
import { BASE_PROTO, CORE_SETTINGS_TEXT, dataProto, tempDir, writeFiles } from './helpers.ts';

interface Message {
  encode(): Uint8Array;
  to_json(): unknown;
  [field: string]: unknown;
}

interface MessageClass {
  new (): Message;
  decode(bytes: Uint8Array): Message | null;
  from_json(json: unknown): Message | null;
}

let core: Record<string, unknown>;

function cls(name: string): MessageClass {
  const value = core[name];
  if (typeof value !== 'function') throw new Error(`no class ${name}`);
  return value as MessageClass;
}

function make(name: string, fields: Record<string, unknown>): Message {
  return Object.assign(new (cls(name))(), fields);
}

function amount(itemId: number, value: bigint, big = ''): Message {
  return make('ItemAmount', { item_id: itemId, amount: value, big_amount: big });
}

/** to_json, then JSON text, then from_json: the same message as protobuf bytes. */
function roundTrip(name: string, message: Message): Message | null {
  const back = cls(name).from_json(JSON.parse(JSON.stringify(message.to_json())));
  expect(back?.encode(), name).toEqual(message.encode());
  return back;
}

beforeAll(async () => {
  const game = tempDir();
  writeFiles(game, { 'core-settings.json': CORE_SETTINGS_TEXT, 'server/generated/data/game_data.proto': dataProto([]) });
  const result = runTool(['--game', game, '--base-proto', BASE_PROTO, '--core-settings', join(game, 'core-settings.json')]);
  expect(result.stdout + result.stderr).toBe('');
  expect(result.code).toBe(0);
  core = (await import(join(game, 'server', 'generated', 'contract', 'core_contract.ts'))) as Record<string, unknown>;
});

describe('ItemChange and ItemMail of the base proto in proto3 JSON', () => {
  it('ItemChange: proto names, int64 strings, the enum name, defaults left out, and back', () => {
    const source = core.ItemChangeSource as Record<string, number>;
    const change = make('ItemChange', { item_id: 7, delta: -5n, overflow: 3n, source: source.ITEM_CHANGE_SOURCE_IAP_REFUND, ref: 'tx-1' });
    expect(change.to_json()).toEqual({ item_id: 7, delta: '-5', overflow: '3', source: 'ITEM_CHANGE_SOURCE_IAP_REFUND', ref: 'tx-1' });
    const back = roundTrip('ItemChange', change);
    expect(back).toMatchObject({ item_id: 7, delta: -5n, overflow: 3n, source: source.ITEM_CHANGE_SOURCE_IAP_REFUND, ref: 'tx-1', big_delta: '', big_overflow: '' });
    expect(make('ItemChange', {}).to_json()).toEqual({});
    roundTrip('ItemChange', make('ItemChange', {}));
  });

  it('ItemChange: the big encoding pairs and int64 limits', () => {
    const big = make('ItemChange', { item_id: 1, delta: 0n, big_delta: '-123456789012345678901234567890', overflow: 0n, big_overflow: '99999999999999999999' });
    expect(big.to_json()).toEqual({ item_id: 1, big_delta: '-123456789012345678901234567890', big_overflow: '99999999999999999999' });
    roundTrip('ItemChange', big);
    const limits = make('ItemChange', { item_id: 2147483647, delta: -9223372036854775808n, overflow: 9223372036854775807n });
    expect(roundTrip('ItemChange', limits)).toMatchObject({ item_id: 2147483647, delta: -9223372036854775808n, overflow: 9223372036854775807n });
  });

  it('ItemChange: every ItemChangeSource value goes by its name', () => {
    const source = core.ItemChangeSource as Record<string, number>;
    expect(Object.keys(source).length).toBeGreaterThan(1);
    for (const [name, value] of Object.entries(source)) {
      if (value === 0) continue;
      const change = make('ItemChange', { item_id: 1, delta: 1n, source: value });
      expect((change.to_json() as Record<string, unknown>).source).toBe(name);
      expect(roundTrip('ItemChange', change)?.source).toBe(value);
    }
  });

  it('ItemMail: nested ItemAmount list with a big amount, and back', () => {
    const source = core.ItemChangeSource as Record<string, number>;
    const mail = make('ItemMail', {
      mail_id: 9007199254740993n,
      source: source.ITEM_CHANGE_SOURCE_SHOP,
      ref: 'core/BuyShopProduct',
      items: [amount(3, 5n), amount(4, 0n, '123456789012345678901234567890'), amount(5, -9007199254740991n)],
    });
    expect(mail.to_json()).toEqual({
      mail_id: '9007199254740993',
      source: 'ITEM_CHANGE_SOURCE_SHOP',
      ref: 'core/BuyShopProduct',
      items: [{ item_id: 3, amount: '5' }, { item_id: 4, big_amount: '123456789012345678901234567890' }, { item_id: 5, amount: '-9007199254740991' }],
    });
    const back = roundTrip('ItemMail', mail);
    const items = back?.items as Message[];
    expect(items.map((item) => [item.item_id, item.amount, item.big_amount])).toEqual([[3, 5n, ''], [4, 0n, '123456789012345678901234567890'], [5, -9007199254740991n, '']]);
    expect(items[0]).toBeInstanceOf(cls('ItemAmount'));
    expect(make('ItemMail', {}).to_json()).toEqual({});
    roundTrip('ItemMail', make('ItemMail', {}));
  });

  it('from_json also takes JSON names, int64 numbers and enum numbers', () => {
    const change = cls('ItemChange').from_json({ itemId: 7, delta: -5, bigOverflow: '1', source: 3 });
    expect(change).toMatchObject({ item_id: 7, delta: -5n, big_overflow: '1', source: 3 });
    const mail = cls('ItemMail').from_json({ mailId: 2, items: [{ itemId: 1, bigAmount: '10' }] });
    expect(mail?.mail_id).toBe(2n);
    expect((mail?.items as Message[])[0]).toMatchObject({ item_id: 1, amount: 0n, big_amount: '10' });
  });

  const invalid: [string, string, unknown][] = [
    ['ItemChange', 'not an object', 'x'],
    ['ItemChange', 'an int64 that is not an integer', { delta: '1.5' }],
    ['ItemChange', 'an int64 out of range', { delta: '9223372036854775808' }],
    ['ItemChange', 'an int32 out of range', { item_id: 2147483648 }],
    ['ItemChange', 'an unknown enum name', { source: 'ITEM_CHANGE_SOURCE_NONE' }],
    ['ItemChange', 'a string field with a number', { ref: 1 }],
    ['ItemMail', 'items not a list', { items: { item_id: 1 } }],
    ['ItemMail', 'an item that is not an object', { items: [1] }],
    ['ItemMail', 'a bad field in an item', { items: [{ amount: 'x' }] }],
  ];
  for (const [name, what, json] of invalid) {
    it(`from_json is null: ${name} with ${what}`, () => {
      expect(cls(name).from_json(json)).toBeNull();
    });
  }

  it('ResponseEnvelope carries item_changes as field 5 and item_mails as field 6', () => {
    const change = make('ItemChange', { item_id: 1, delta: 2n });
    const mail = make('ItemMail', { mail_id: 3n, items: [amount(1, 4n)] });
    const envelope = make('ResponseEnvelope', { item_changes: [change], item_mails: [mail] });
    const bytes = envelope.encode();
    const changeBytes = change.encode();
    const mailBytes = mail.encode();
    expect(Array.from(bytes)).toEqual([0x2a, changeBytes.length, ...changeBytes, 0x32, mailBytes.length, ...mailBytes]);
    const back = cls('ResponseEnvelope').decode(bytes);
    expect((back?.item_changes as Message[]).map((c) => c.encode())).toEqual([changeBytes]);
    expect((back?.item_mails as Message[]).map((m) => m.encode())).toEqual([mailBytes]);
  });
});
