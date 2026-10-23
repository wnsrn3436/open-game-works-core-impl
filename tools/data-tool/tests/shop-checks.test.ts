/** The data checks of `shop` `## data` (`src/checks/shop.ts`): every rule makes its ERROR line. */
import { describe, expect, test } from 'vitest';
import { fixture, lines, run, specModule, specTable, table } from './helpers.ts';

const LIST = 'array<{item_id: ref<item.id>, amount: long}>';
const PRODUCT = [
  'id|id(key)|All', 'name|tstring<id>|Client', `cost|${LIST}|All`, `reward|${LIST}|All`, 'extra_grant|bool|All', 'max_quantity|int|All',
  'limit_count|int?|All', 'reset|enum<ResetCycle>?|All', 'start_at|datetime?|All', 'end_at|datetime?|All', 'live_event|ref<live_event.id>?|All',
  'requirement|requirement|All', 'offer|ref<offer.id>?|All',
];
/** The `shop` module of `core-spec.json` with its table, and `ResetCycle` of `server-time`. */
const SHOP = specModule({ name: 'shop', tables: [specTable('shop_product', PRODUCT)], enums: [{ type: 'ResetCycle', elements: ['Daily', 'Weekly', 'Monthly'] }] });

type Row = string[];

/** A valid row: name, cost, reward, extra_grant, max_quantity, limit_count, reset, start_at, end_at, live_event, requirement, offer. */
function product(id: string, edit: Partial<Record<'reward' | 'extra_grant' | 'max_quantity' | 'limit_count' | 'reset' | 'offer', string>> = {}): Row {
  return [
    id, '', '[gold] 10', edit.reward ?? '[gem] 1', edit.extra_grant ?? 'false', edit.max_quantity ?? '1', edit.limit_count ?? 'null',
    edit.reset ?? 'null', 'null', 'null', 'null', '', edit.offer ?? 'null',
  ];
}

function check(rows: Row[]): ReturnType<typeof run> {
  return run(fixture({
    files: {
      'data/tables/item.csv': table(['id|id(key)|All'], [['[gold]'], ['[gem]']]),
      'data/tables/live_event.csv': table(['id|id(key)|All'], [['[event]']]),
      'data/tables/offer.csv': table(['id|id(key)|All'], [['[sale]']]),
      'data/tables/shop_product.csv': table(PRODUCT, rows),
    },
    settings: { sourceLanguage: 'en', supportedLanguages: ['en'] },
    coreSpec: { version: '0.0.0', modules: [SHOP] },
    modules: ['shop'],
  }));
}

/** `<file>:<line>:<col> <severity> <code>` of every line of a code. */
function at(r: ReturnType<typeof run>, code: string): string[] {
  return lines(r, code).map((l) => l.split(' ').slice(0, 3).join(' '));
}

function errors(r: ReturnType<typeof run>): string[] {
  return r.stdout.filter((l) => l.split(' ')[1] === 'ERROR');
}

const FILE = 'data/tables/shop_product.csv';

describe('shop data check', () => {
  test('valid rows have no ERROR line', () => {
    const r = check([
      product('[p_plain]'),
      product('[p_daily]', { limit_count: '3', reset: 'Daily', max_quantity: '3' }),
      product('[p_offer]', { limit_count: '1', offer: '[sale]' }),
      product('[p_extra]', { reward: '', extra_grant: 'true' }),
    ]);
    expect(errors(r)).toEqual([]);
    expect(r.code).toBe(0);
  });

  test('max_quantity below 1 is out_of_range', () => {
    const r = check([product('[p_zero]', { max_quantity: '0' }), product('[p_negative]', { max_quantity: '-1' })]);
    expect(at(r, 'out_of_range')).toEqual([`${FILE}:5:6 ERROR out_of_range`, `${FILE}:6:6 ERROR out_of_range`]);
    expect(r.code).toBe(1);
  });

  test('limit_count below 1 is out_of_range', () => {
    const r = check([product('[p_zero]', { limit_count: '0' })]);
    expect(at(r, 'out_of_range')).toEqual([`${FILE}:5:7 ERROR out_of_range`]);
  });

  test('reset without limit_count is out_of_range', () => {
    const r = check([product('[p_reset]', { reset: 'Weekly' })]);
    expect(at(r, 'out_of_range')).toEqual([`${FILE}:5:8 ERROR out_of_range`]);
  });

  test('reset with offer is out_of_range', () => {
    const r = check([product('[p_reset]', { limit_count: '1', reset: 'Monthly', offer: '[sale]' })]);
    expect(at(r, 'out_of_range')).toEqual([`${FILE}:5:8 ERROR out_of_range`]);
  });

  test('an empty reward with extra_grant false is out_of_range', () => {
    const r = check([product('[p_empty]', { reward: '' })]);
    expect(at(r, 'out_of_range')).toEqual([`${FILE}:5:1 ERROR out_of_range`]);
  });
});
