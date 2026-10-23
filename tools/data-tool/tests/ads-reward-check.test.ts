/** The data checks of `ads-reward` (`src/checks/ads-reward.ts`): each `ad_placement` rule makes an ERROR. */
import { describe, expect, test } from 'vitest';
import { fixture, lines, run, specModule, specTable, table } from './helpers.ts';

const AD_PLACEMENT = [
  'id|id(key)|All',
  'type|enum<AdType>|All',
  'reward|array<{item_id: ref<item.id>, amount: long}>|All',
  'extra_grant|bool|All',
  'limit_count|int?|All',
  'reset|enum<ResetCycle>?|All',
  'min_interval|duration?|Client',
  'first_show_after|duration?|Client',
  'every_n|int?|Client',
  'suppress_if_product|array<ref<iap_product.id>>|Client',
];

const SPEC = {
  version: '1.0.0',
  modules: [
    specModule({ name: 'ads-reward', tables: [specTable('ad_placement', AD_PLACEMENT)], enums: [{ type: 'AdType', elements: ['Rewarded', 'Interstitial', 'Banner'] }] }),
    specModule({ name: 'server-time', enums: [{ type: 'ResetCycle', elements: ['Daily', 'Weekly', 'Monthly'] }] }),
    specModule({ name: 'item-ledger', tables: [specTable('item', ['id|id(key)|All'])] }),
    specModule({ name: 'iap', tables: [specTable('iap_product', ['id|id(key)|All'])] }),
  ],
};

/** An `ad_placement` row: id, type, reward, extra_grant, limit_count, reset, min_interval, first_show_after, every_n, suppress_if_product. */
type PlacementRow = [string, string, string, string, string, string, string, string, string, string];

const GOOD: PlacementRow[] = [
  ['[ad_rewarded]', 'Rewarded', '[gem] 10', 'false', '3', 'Daily', 'null', 'null', 'null', ''],
  ['[ad_extra]', 'Rewarded', '', 'true', 'null', 'null', 'null', 'null', 'null', ''],
  ['[ad_interstitial]', 'Interstitial', '', 'false', 'null', 'null', '30s', '1m', '3', '[no_ads]'],
  ['[ad_banner]', 'Banner', '', 'false', 'null', 'null', 'null', 'null', 'null', '[no_ads]'],
];

/** The `out_of_range` lines as `<file>:<line>:<column>`, for data rows after the four good rows. */
function outOfRange(rows: PlacementRow[]): string[] {
  const f = fixture({
    coreSpec: SPEC,
    modules: ['ads-reward', 'server-time', 'item-ledger', 'iap'],
    files: {
      'data/tables/ad_placement.csv': table(AD_PLACEMENT, [...GOOD, ...rows]),
      'data/tables/item.csv': table(['id|id(key)|All'], [['[gem]']]),
      'data/tables/iap_product.csv': table(['id|id(key)|All'], [['[no_ads]']]),
    },
  });
  const r = run(f);
  return lines(r, 'out_of_range').map((l) => l.split(' ').slice(0, 2).join(' '));
}

/** Line of the n-th added row (the header is 4 lines, then the four good rows). */
function line(n: number): string {
  return `data/tables/ad_placement.csv:${String(4 + GOOD.length + n)}`;
}

describe('ads-reward data check', () => {
  test('good rows make no line', () => {
    expect(outOfRange([])).toEqual([]);
  });

  test('min_interval, first_show_after, every_n of a row whose type is not Interstitial are null', () => {
    expect(outOfRange([['[a]', 'Rewarded', '[gem] 1', 'false', 'null', 'null', '30s', 'null', 'null', '']])).toEqual([`${line(1)}:7 ERROR`]);
    expect(outOfRange([['[a]', 'Banner', '', 'false', 'null', 'null', 'null', '1m', 'null', '']])).toEqual([`${line(1)}:8 ERROR`]);
    expect(outOfRange([['[a]', 'Rewarded', '[gem] 1', 'false', 'null', 'null', 'null', 'null', '2', '']])).toEqual([`${line(1)}:9 ERROR`]);
  });

  test('suppress_if_product of a Rewarded row is empty', () => {
    expect(outOfRange([['[a]', 'Rewarded', '[gem] 1', 'false', 'null', 'null', 'null', 'null', 'null', '[no_ads]']])).toEqual([`${line(1)}:10 ERROR`]);
  });

  test('min_interval, first_show_after, every_n, limit_count are 1 or more when not null', () => {
    expect(outOfRange([['[a]', 'Interstitial', '', 'false', 'null', 'null', '0s', '0s', '0', '']])).toEqual([`${line(1)}:7 ERROR`, `${line(1)}:8 ERROR`, `${line(1)}:9 ERROR`]);
    expect(outOfRange([['[a]', 'Rewarded', '[gem] 1', 'false', '0', 'null', 'null', 'null', 'null', '']])).toEqual([`${line(1)}:5 ERROR`]);
  });

  test('a row whose type is not Rewarded has an empty reward, extra_grant false and a null limit_count', () => {
    expect(outOfRange([['[a]', 'Interstitial', '[gem] 1', 'false', 'null', 'null', 'null', 'null', 'null', '']])).toEqual([`${line(1)}:3 ERROR`]);
    expect(outOfRange([['[a]', 'Banner', '', 'true', 'null', 'null', 'null', 'null', 'null', '']])).toEqual([`${line(1)}:4 ERROR`]);
    expect(outOfRange([['[a]', 'Interstitial', '', 'false', '2', 'null', 'null', 'null', 'null', '']])).toEqual([`${line(1)}:5 ERROR`]);
  });

  test('a Rewarded row with an empty reward and extra_grant false is an ERROR, so the server does not start', () => {
    expect(outOfRange([['[a]', 'Rewarded', '', 'false', 'null', 'null', 'null', 'null', 'null', '']])).toEqual([`${line(1)}:3 ERROR`]);
  });
});
