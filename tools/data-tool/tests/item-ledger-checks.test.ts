/** The data checks of `item-ledger` `## data` (`src/checks/item-ledger.ts`): every rule makes its ERROR line. */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';
import { fixture, lines, run, specModule, specTable, table } from './helpers.ts';

const SPEC_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'core-spec');
const ITEM_LEDGER = JSON.parse(readFileSync(join(SPEC_DIR, 'item-ledger.json'), 'utf8')) as Record<string, unknown> & { name: string };
const LIST = 'array<{item_id: ref<item.id>, amount: long}>';
/** A core table with a cost column and a column that is not a cost column. */
const SHOP = specModule({ name: 'shop', tables: [specTable('shop_product', ['id|id(key)|All', `cost|${LIST}|All`, `reward|${LIST}|All`])] });

const ITEM = ['id|id(key)|All', 'name|tstring<id>|Client', 'type|enum<ItemType>|All', 'max_amount|long|All', 'overflow|enum<ItemOverflow>|All'];
const OVERFLOW = ['id|id(key)|All', `convert_to|${LIST}|All`];
const RECOVERY = ['id|id(key)|All', 'recovery_interval|duration|All', 'recovery_amount|long|All', 'recovery_cap|long|All', 'cap_bonus_item|ref<item.id>?|All', 'initial_amount|long|All'];
const GROUP = ['id|id(key)|All', 'members|array<ref<item.id>>|All'];
const TIMED = ['id|id(key)|All', 'duration|duration|All'];
const BIG = ['id|id(key)|All', 'max_digits|int|All'];

type Rows = string[][];

interface Data {
  item: Rows;
  item_overflow: Rows;
  item_recovery: Rows;
  item_group: Rows;
  item_timed: Rows;
  item_big: Rows;
  shop_product: Rows;
  /** A content table with an item list column and an item column. */
  reward: Rows;
}

const MAX = '9007199254740991';

function base(): Data {
  return {
    item: [
      ['[gold]', '', 'Currency', '1000', 'Reject'],
      ['[gem_paid]', '', 'Currency', '100', 'Reject'],
      ['[gem_free]', '', 'Currency', '100', 'Reject'],
      ['[gem]', '', 'Currency', '200', 'Reject'],
      ['[shard]', '', 'Goods', '10', 'Convert'],
      ['[dust]', '', 'Goods', '50', 'Discard'],
      ['[stamina]', '', 'Currency', '200', 'Discard'],
      ['[bonus]', '', 'Goods', '100', 'Reject'],
      ['[boost]', '', 'Goods', '3', 'Reject'],
      ['[big_gold]', '', 'Currency', MAX, 'Discard'],
    ],
    item_overflow: [['[shard]', '[dust] 2']],
    item_recovery: [['[stamina]', '1m', '1', '20', '[bonus]', '20']],
    item_group: [['[gem]', '[gem_paid], [gem_free]']],
    item_timed: [['[boost]', '1h']],
    item_big: [['[big_gold]', '20']],
    shop_product: [['[p1]', '[gem] 5', '[gold] 1']],
    reward: [['[r1]', '[gold] 5, [big_gold] 12345678901234567890', '[gem]']],
  };
}

function check(edit: (d: Data) => void = () => {}, settings: Record<string, unknown> = {}): ReturnType<typeof run> {
  const d = base();
  edit(d);
  return run(fixture({
    files: {
      'data/tables/item.csv': table(ITEM, d.item),
      'data/tables/item_overflow.csv': table(OVERFLOW, d.item_overflow),
      'data/tables/item_recovery.csv': table(RECOVERY, d.item_recovery),
      'data/tables/item_group.csv': table(GROUP, d.item_group),
      'data/tables/item_timed.csv': table(TIMED, d.item_timed),
      'data/tables/item_big.csv': table(BIG, d.item_big),
      'data/tables/shop_product.csv': table(SHOP_COLUMNS, d.shop_product),
      'data/tables/reward.csv': table(['id|id(key)|All', `items|${LIST}|All`, 'item|ref<item.id>|All'], d.reward),
    },
    settings: { sourceLanguage: 'en', supportedLanguages: ['en'], ...settings },
    coreSpec: { version: '0.0.0', modules: [ITEM_LEDGER, SHOP] },
    modules: ['item-ledger', 'shop'],
  }));
}

const SHOP_COLUMNS = ['id|id(key)|All', `cost|${LIST}|All`, `reward|${LIST}|All`];

/** `<file>:<line>:<col> <severity> <code>` of every line of a code. */
function at(r: ReturnType<typeof run>, code: string): string[] {
  return lines(r, code).map((l) => l.split(' ').slice(0, 3).join(' '));
}

function errors(r: ReturnType<typeof run>): string[] {
  return r.stdout.filter((l) => l.split(' ')[1] === 'ERROR');
}

function set(rows: Rows, id: string, col: number, value: string): void {
  const row = rows.find((r) => r[0] === id);
  if (!row) throw new Error(`no row ${id}`);
  row[col] = value;
}

describe('item-ledger data check', () => {
  test('the base data has no ERROR line', () => {
    const r = check();
    expect(errors(r)).toEqual([]);
    expect(r.code).toBe(0);
  });

  test('max_amount out of 1 to 2^53-1', () => {
    const r = check((d) => {
      set(d.item, '[gold]', 3, '0');
      set(d.item, '[dust]', 3, '9007199254740992');
    });
    expect(at(r, 'out_of_range')).toEqual(expect.arrayContaining(['data/tables/item.csv:5:4 ERROR out_of_range', 'data/tables/item.csv:10:4 ERROR out_of_range']));
  });

  describe('item_overflow', () => {
    test('a Convert item without a row is required_missing', () => {
      const r = check((d) => { d.item_overflow = []; });
      expect(at(r, 'required_missing')).toEqual(['data/tables/item.csv:9:5 ERROR required_missing']);
    });

    test('a row of an item that is not Convert is out_of_range', () => {
      const r = check((d) => { d.item_overflow.push(['[dust]', '[gold] 1']); });
      expect(at(r, 'out_of_range')).toEqual(['data/tables/item_overflow.csv:6:1 ERROR out_of_range']);
    });

    test('an empty convert_to is empty_required', () => {
      const r = check((d) => { set(d.item_overflow, '[shard]', 1, ''); });
      expect(at(r, 'empty_required')).toEqual(['data/tables/item_overflow.csv:5:2 ERROR empty_required']);
    });

    test('convert_to with the item itself is cycle', () => {
      const r = check((d) => { set(d.item_overflow, '[shard]', 1, '[shard] 1'); });
      expect(at(r, 'cycle')).toEqual(['data/tables/item_overflow.csv:5:2 ERROR cycle']);
    });

    test('convert_to with a Convert item is out_of_range', () => {
      const r = check((d) => {
        d.item.push(['[shard2]', '', 'Goods', '10', 'Convert']);
        d.item_overflow.push(['[shard2]', '[dust] 1']);
        set(d.item_overflow, '[shard]', 1, '[shard2] 1');
      });
      expect(at(r, 'out_of_range')).toEqual(['data/tables/item_overflow.csv:5:2 ERROR out_of_range']);
    });

    test('a row whose id is not in the item table is ref_missing', () => {
      const r = check((d) => { d.item_overflow.push(['[nothing]', '[dust] 1']); });
      expect(at(r, 'ref_missing')).toEqual(['data/tables/item_overflow.csv:6:1 ERROR ref_missing']);
    });
  });

  describe('item_recovery', () => {
    test('recovery_interval, recovery_amount and recovery_cap less than 1', () => {
      const r = check((d) => { d.item_recovery = [['[stamina]', '0ms', '0', '0', '[bonus]', '0']]; });
      expect(at(r, 'out_of_range')).toEqual([
        'data/tables/item_recovery.csv:5:2 ERROR out_of_range', 'data/tables/item_recovery.csv:5:3 ERROR out_of_range', 'data/tables/item_recovery.csv:5:4 ERROR out_of_range',
      ]);
    });

    test('recovery_cap over max_amount', () => {
      const r = check((d) => { set(d.item_recovery, '[stamina]', 3, '201'); });
      expect(at(r, 'out_of_range')).toEqual(expect.arrayContaining(['data/tables/item_recovery.csv:5:4 ERROR out_of_range']));
    });

    test('initial_amount below 0 or over max_amount', () => {
      expect(at(check((d) => { set(d.item_recovery, '[stamina]', 5, '-1'); }), 'out_of_range')).toEqual(['data/tables/item_recovery.csv:5:6 ERROR out_of_range']);
      expect(at(check((d) => { set(d.item_recovery, '[stamina]', 5, '201'); }), 'out_of_range')).toEqual(['data/tables/item_recovery.csv:5:6 ERROR out_of_range']);
    });

    test('a cap_bonus_item that is a recovery, group, timed or big item', () => {
      for (const bonus of ['[stamina]', '[gem]', '[boost]', '[big_gold]']) {
        const r = check((d) => {
          set(d.item_recovery, '[stamina]', 4, bonus);
          for (const row of d.item) if (row[0] === bonus) row[3] = row[3] === MAX ? MAX : '1';
          if (bonus === '[gem]') d.item_group = [['[gem]', '[gem_paid]']];
          if (bonus === '[gem]') set(d.item, '[gem]', 3, '100');
          if (bonus === '[gem]') set(d.item, '[gem_paid]', 3, '100');
        });
        expect(at(r, 'out_of_range'), bonus).toContain('data/tables/item_recovery.csv:5:5 ERROR out_of_range');
      }
    });

    test('recovery_cap + the max_amount of cap_bonus_item over max_amount', () => {
      const r = check((d) => { set(d.item, '[bonus]', 3, '181'); });
      expect(at(r, 'out_of_range')).toEqual(['data/tables/item_recovery.csv:5:5 ERROR out_of_range']);
    });

    test('a row whose id is not in the item table is ref_missing', () => {
      const r = check((d) => { d.item_recovery.push(['[nothing]', '1m', '1', '1', 'null', '0']); });
      expect(at(r, 'ref_missing')).toEqual(['data/tables/item_recovery.csv:6:1 ERROR ref_missing']);
    });
  });

  describe('item_group', () => {
    test('empty members and a member twice', () => {
      const empty = check((d) => {
        set(d.item_group, '[gem]', 1, '');
        set(d.item, '[gem]', 3, '0');
      });
      expect(at(empty, 'out_of_range')).toContain('data/tables/item_group.csv:5:2 ERROR out_of_range');
      const twice = check((d) => { set(d.item_group, '[gem]', 1, '[gem_paid], [gem_paid]'); });
      expect(at(twice, 'out_of_range')).toContain('data/tables/item_group.csv:5:2 ERROR out_of_range');
    });

    test('a member that is the group item, a recovery, group, timed or big item', () => {
      for (const m of ['[gem]', '[stamina]', '[boost]', '[big_gold]']) {
        const r = check((d) => { set(d.item_group, '[gem]', 1, `[gem_paid], ${m}`); });
        expect(at(r, 'out_of_range'), m).toContain('data/tables/item_group.csv:5:2 ERROR out_of_range');
      }
      const nested = check((d) => {
        d.item.push(['[gem2]', '', 'Currency', '200', 'Reject']);
        d.item_group.push(['[gem2]', '[gem]']);
      });
      expect(at(nested, 'out_of_range')).toContain('data/tables/item_group.csv:6:2 ERROR out_of_range');
    });

    test('max_amount that is not the sum of the members, or a sum over 2^53-1', () => {
      expect(at(check((d) => { set(d.item, '[gem]', 3, '199'); }), 'out_of_range')).toEqual(['data/tables/item_group.csv:5:1 ERROR out_of_range']);
      const over = check((d) => {
        set(d.item, '[gem_paid]', 3, MAX);
        set(d.item, '[gem_free]', 3, '1');
        set(d.item, '[gem]', 3, MAX);
      });
      expect(at(over, 'out_of_range')).toEqual(['data/tables/item_group.csv:5:1 ERROR out_of_range']);
    });
  });

  describe('item_timed', () => {
    test('duration less than 1, max_amount × duration over 2^53-1', () => {
      expect(at(check((d) => { set(d.item_timed, '[boost]', 1, '0ms'); }), 'out_of_range')).toEqual(['data/tables/item_timed.csv:5:2 ERROR out_of_range']);
      expect(at(check((d) => { set(d.item, '[boost]', 3, '9007199254741'); }), 'out_of_range')).toEqual(['data/tables/item_timed.csv:5:2 ERROR out_of_range']);
    });

    test('overflow that is not Reject or Discard', () => {
      const r = check((d) => {
        set(d.item, '[boost]', 4, 'Convert');
        d.item_overflow.push(['[boost]', '[dust] 1']);
      });
      expect(at(r, 'out_of_range')).toContain('data/tables/item_timed.csv:5:1 ERROR out_of_range');
    });
  });

  describe('item_big', () => {
    test('max_digits below 16 or over item-ledger.bigMaxDigits', () => {
      expect(at(check((d) => { set(d.item_big, '[big_gold]', 1, '15'); }), 'out_of_range')).toContain('data/tables/item_big.csv:5:2 ERROR out_of_range');
      const over = check((d) => { set(d.item_big, '[big_gold]', 1, '30'); }, { core: { 'item-ledger.bigMaxDigits': 25 } });
      expect(at(over, 'out_of_range')).toEqual(['data/tables/item_big.csv:5:2 ERROR out_of_range']);
      expect(errors(check((d) => { set(d.item_big, '[big_gold]', 1, '25'); }, { core: { 'item-ledger.bigMaxDigits': 25 } }))).toEqual([]);
    });

    test('max_amount that is not 2^53-1, overflow that is not Reject or Discard', () => {
      expect(at(check((d) => { set(d.item, '[big_gold]', 3, '1000'); }), 'out_of_range')).toEqual(['data/tables/item_big.csv:5:1 ERROR out_of_range']);
      const convert = check((d) => {
        set(d.item, '[big_gold]', 4, 'Convert');
        d.item_overflow.push(['[big_gold]', '[dust] 1']);
      });
      expect(at(convert, 'out_of_range')).toContain('data/tables/item_big.csv:5:1 ERROR out_of_range');
    });
  });

  describe('item kind rule', () => {
    test('an item in two kind tables', () => {
      const r = check((d) => { d.item_timed.push(['[big_gold]', '1h']); });
      expect(at(r, 'out_of_range')).toEqual(expect.arrayContaining(['data/tables/item_big.csv:5:1 ERROR out_of_range', 'data/tables/item_timed.csv:6:1 ERROR out_of_range']));
    });

    test('an item_overflow row item or convert_to item that is a group, timed or big item', () => {
      for (const target of ['[gem]', '[boost]', '[big_gold]']) {
        const r = check((d) => { set(d.item_overflow, '[shard]', 1, `${target} 1`); });
        expect(at(r, 'out_of_range'), target).toContain('data/tables/item_overflow.csv:5:2 ERROR out_of_range');
      }
      const row = check((d) => {
        set(d.item, '[gem]', 4, 'Convert');
        d.item_overflow.push(['[gem]', '[dust] 1']);
      });
      expect(at(row, 'out_of_range')).toContain('data/tables/item_overflow.csv:6:1 ERROR out_of_range');
    });

    test('a timed item in a cost column, a group item in a core table item column that is not a cost column', () => {
      expect(at(check((d) => { set(d.shop_product, '[p1]', 1, '[boost] 1'); }), 'out_of_range')).toEqual(['data/tables/shop_product.csv:5:2 ERROR out_of_range']);
      expect(at(check((d) => { set(d.shop_product, '[p1]', 2, '[gem] 1'); }), 'out_of_range')).toEqual(['data/tables/shop_product.csv:5:3 ERROR out_of_range']);
    });

    test('a group item in a content table and in a cost column has no line', () => {
      expect(errors(check())).toEqual([]);
    });
  });

  describe('item list column', () => {
    test('an item twice and an amount less than 1 are value_type', () => {
      expect(at(check((d) => { d.reward[0] = ['[r1]', '[gold] 1, [gold] 2', '[gold]']; }), 'value_type')).toEqual(['data/tables/reward.csv:5:2 ERROR value_type']);
      expect(at(check((d) => { d.reward[0] = ['[r1]', '[gold] 0', '[gold]']; }), 'value_type')).toEqual(['data/tables/reward.csv:5:2 ERROR value_type']);
      expect(at(check((d) => { set(d.shop_product, '[p1]', 1, '[gold] -3'); }), 'value_type')).toEqual(['data/tables/shop_product.csv:5:2 ERROR value_type']);
    });

    test('an amount over the item amount limit is out_of_range', () => {
      expect(at(check((d) => { d.reward[0] = ['[r1]', '[gold] 9007199254740992', '[gold]']; }), 'out_of_range')).toEqual(['data/tables/reward.csv:5:2 ERROR out_of_range']);
      expect(at(check((d) => { d.reward[0] = ['[r1]', '[big_gold] 100000000000000000000', '[gold]']; }), 'out_of_range')).toEqual(['data/tables/reward.csv:5:2 ERROR out_of_range']);
      expect(errors(check((d) => { d.reward[0] = ['[r1]', '[big_gold] 99999999999999999999', '[gold]']; }))).toEqual([]);
    });
  });
});
