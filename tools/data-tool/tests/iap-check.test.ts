/** The data checks of `iap` (`src/checks/iap.ts`): one ERROR per broken `iap_product` rule. */
import { describe, expect, test } from 'vitest';
import { enums, fixture, lines, run, specModule, specTable, table } from './helpers.ts';

const COLUMNS = [
  'id|id(key)|All',
  'name|tstring<id>|Client',
  'type|enum<IapProductType>|All',
  'sku_apple|string|All',
  'sku_google|string|All',
  'reward|array<{item_id: ref<item.id>, amount: long}>|All',
  'daily_reward|array<{item_id: ref<item.id>, amount: long}>|All',
  'extra_grant|bool|All',
  'limit_count|int?|All',
  'reset|enum<ResetCycle>?|All',
  'pass_days|int?|All',
  'requirement|requirement|All',
  'start_at|datetime?|All',
  'end_at|datetime?|All',
  'live_event|ref<live_event.id>?|All',
  'offer|ref<offer.id>?|All',
  'spend_amount|long|Server',
];

const SPEC = {
  version: '1.0.0',
  modules: [
    specModule({ name: 'iap', tables: [specTable('iap_product', COLUMNS)], enums: [{ type: 'IapProductType', elements: ['Consumable', 'NonConsumable', 'Subscription'] }] }),
    specModule({ name: 'item-ledger', tables: [specTable('item', ['id|id(key)|All'])] }),
    specModule({ name: 'live-event', tables: [specTable('live_event', ['id|id(key)|All'])] }),
    specModule({ name: 'offer', tables: [specTable('offer', ['id|id(key)|All'])] }),
    specModule({ name: 'server-time', enums: [{ type: 'ResetCycle', elements: ['Daily', 'Weekly', 'Monthly'] }] }),
  ],
};

type Row = Record<string, string>;

const BASE: Row = {
  name: 'P',
  type: 'Consumable',
  sku_apple: '',
  sku_google: '',
  reward: '[gem] 1',
  daily_reward: '',
  extra_grant: 'false',
  limit_count: 'null',
  reset: 'null',
  pass_days: 'null',
  requirement: '',
  start_at: 'null',
  end_at: 'null',
  live_event: 'null',
  offer: 'null',
  spend_amount: '0',
};

function products(rows: Record<string, Row>, settings: Record<string, unknown> = {}) {
  const names = COLUMNS.map((c) => c.split('|')[0] ?? '');
  const f = fixture({
    coreSpec: SPEC,
    modules: ['iap'],
    settings: { sourceLanguage: 'ko', supportedLanguages: ['ko'], ...settings },
    files: {
      'data/enums.csv': enums([
        ['IapProductType', 'Consumable', 1],
        ['IapProductType', 'NonConsumable', 2],
        ['IapProductType', 'Subscription', 3],
        ['ResetCycle', 'Daily', 1],
        ['ResetCycle', 'Weekly', 2],
        ['ResetCycle', 'Monthly', 3],
      ]),
      'data/tables/item.csv': table(['id|id(key)|All'], [['[gem]']]),
      'data/tables/live_event.csv': table(['id|id(key)|All'], [['[ev]']]),
      'data/tables/offer.csv': table(['id|id(key)|All'], [['[of]']]),
      'data/tables/iap_product.csv': table(
        COLUMNS,
        Object.entries(rows).map(([id, row]) => names.map((n) => (n === 'id' ? id : ({ ...BASE, ...row })[n] ?? ''))),
      ),
    },
  });
  return run(f);
}

/** The iap check messages of a run, without the place. */
function iap_errors(r: ReturnType<typeof run>): string[] {
  return [...lines(r, 'out_of_range'), ...lines(r, 'duplicate')].filter((l) => l.includes('iap_product.')).map((l) => l.split(' ').slice(1).join(' '));
}

describe('iap data checks', () => {
  test('rows that keep every rule have no iap check line', () => {
    const r = products({
      '[gems]': { sku_apple: 'a', sku_google: 'g' },
      '[daily]': { limit_count: '1', reset: 'Daily', sku_apple: 'a2' },
      '[unlock]': { type: 'NonConsumable', limit_count: '1' },
      '[vip]': { type: 'Subscription', daily_reward: '[gem] 1' },
      '[pass]': { pass_days: '30', daily_reward: '[gem] 2' },
      '[offer_pack]': { limit_count: '1', offer: '[of]' },
      '[extra]': { reward: '', extra_grant: 'true' },
    });
    expect(iap_errors(r)).toEqual([]);
  });

  test('a NonConsumable needs limit_count 1 and a Subscription limit_count null', () => {
    expect(iap_errors(products({ '[a]': { type: 'NonConsumable', limit_count: '2' }, '[b]': { type: 'NonConsumable' }, '[c]': { type: 'Subscription', limit_count: '1' } }))).toEqual([
      'ERROR out_of_range iap_product.limit_count of [a]: a NonConsumable has limit_count 1',
      'ERROR out_of_range iap_product.limit_count of [b]: a NonConsumable has limit_count 1',
      'ERROR out_of_range iap_product.limit_count of [c]: a Subscription has limit_count null',
    ]);
  });

  test('NonConsumable and Subscription rows have reset, pass_days and offer null', () => {
    const r = products({ '[a]': { type: 'NonConsumable', limit_count: '1', reset: 'Daily', pass_days: '3', offer: '[of]' }, '[b]': { type: 'Subscription', pass_days: '3' } });
    expect(iap_errors(r)).toEqual([
      'ERROR out_of_range iap_product.reset of [a]: a NonConsumable has reset null',
      'ERROR out_of_range iap_product.reset of [a]: reset is null when limit_count is null or offer is not null',
      'ERROR out_of_range iap_product.pass_days of [a]: a NonConsumable has pass_days null',
      'ERROR out_of_range iap_product.offer of [a]: a NonConsumable has offer null',
      'ERROR out_of_range iap_product.pass_days of [b]: a Subscription has pass_days null',
    ]);
  });

  test('reset is null when limit_count is null or offer is set', () => {
    expect(iap_errors(products({ '[a]': { reset: 'Weekly' }, '[b]': { limit_count: '1', reset: 'Weekly', offer: '[of]' } }))).toEqual([
      'ERROR out_of_range iap_product.reset of [a]: reset is null when limit_count is null or offer is not null',
      'ERROR out_of_range iap_product.reset of [b]: reset is null when limit_count is null or offer is not null',
    ]);
  });

  test('pass_days and limit_count are 1 or more when set', () => {
    expect(iap_errors(products({ '[a]': { limit_count: '0' }, '[b]': { pass_days: '0', daily_reward: '[gem] 1' } }))).toEqual([
      'ERROR out_of_range iap_product.limit_count of [a]: limit_count is 1 or more',
      'ERROR out_of_range iap_product.pass_days of [b]: pass_days is 1 or more',
    ]);
  });

  test('daily_reward is empty except for a Subscription and a Consumable with pass_days', () => {
    expect(iap_errors(products({ '[a]': { daily_reward: '[gem] 1' }, '[b]': { type: 'NonConsumable', limit_count: '1', daily_reward: '[gem] 1' } }))).toEqual([
      'ERROR out_of_range iap_product.daily_reward of [a]: daily_reward is empty except for a Subscription and a Consumable with pass_days',
      'ERROR out_of_range iap_product.daily_reward of [b]: daily_reward is empty except for a Subscription and a Consumable with pass_days',
    ]);
  });

  test('spend_amount is 0 or more, and 1 or more for a row with a SKU while purchaseLimits.monthlyBelowAge is not empty', () => {
    expect(iap_errors(products({ '[a]': { spend_amount: '-1' } }))).toEqual(['ERROR out_of_range iap_product.spend_amount of [a]: spend_amount is 0 or more']);
    const limited = { purchaseLimits: { monthlyBelowAge: { '19': 100 } } };
    expect(iap_errors(products({ '[a]': { sku_google: 'g' }, '[b]': {} }, limited))).toEqual([
      'ERROR out_of_range iap_product.spend_amount of [a]: spend_amount is 1 or more for a row with a SKU while game settings purchaseLimits.monthlyBelowAge is not empty',
    ]);
    expect(iap_errors(products({ '[a]': { sku_google: 'g' } }))).toEqual([]);
  });

  test('a SKU that is not empty is unique in its column', () => {
    expect(iap_errors(products({ '[a]': { sku_apple: 's', sku_google: 's' }, '[b]': { sku_apple: 's' }, '[c]': { sku_google: 'g' }, '[d]': { sku_google: 'g' } }))).toEqual([
      'ERROR duplicate iap_product.sku_apple of [b]: SKU s is also the sku_apple of [a]',
      'ERROR duplicate iap_product.sku_google of [d]: SKU g is also the sku_google of [c]',
    ]);
  });

  test('a row with empty reward and daily_reward and extra_grant false grants nothing', () => {
    expect(iap_errors(products({ '[a]': { reward: '' } }))).toEqual(['ERROR out_of_range iap_product.reward of [a]: a row with empty reward and daily_reward needs extra_grant true']);
  });
});
