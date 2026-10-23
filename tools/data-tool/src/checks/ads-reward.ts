/**
 * Data checks of `ads-reward` `## data`: the `ad_placement` rules. Every rule is `out_of_range`.
 */
import type { ModuleCheck } from '../module-check.ts';
import { cellPlace, column, rowPlace, type Row } from '../model.ts';
import type { Value } from '../values.ts';

const INTERSTITIAL_ONLY = ['min_interval', 'first_show_after', 'every_n'] as const;
const AT_LEAST_ONE = ['min_interval', 'first_show_after', 'every_n', 'limit_count'] as const;

function value(row: Row, name: string): Value | undefined {
  return row.values.get(name);
}

function isNull(v: Value | undefined): boolean {
  return v === undefined || v.k === 'null';
}

function isEmptyList(v: Value | undefined): boolean {
  return v === undefined || (v.k === 'list' && v.items.length === 0);
}

function typeOf(row: Row): string {
  const v = value(row, 'type');
  return v?.k === 'enum' ? v.element : '';
}

function isTrue(v: Value | undefined): boolean {
  return v?.k === 'bool' && v.v;
}

type Report = (name: string, message: string) => void;

function checkRewarded(row: Row, report: Report): void {
  if (!isEmptyList(value(row, 'suppress_if_product'))) report('suppress_if_product', 'suppress_if_product is empty when type is Rewarded');
  if (isEmptyList(value(row, 'reward')) && !isTrue(value(row, 'extra_grant'))) report('reward', 'a Rewarded placement has a reward or extra_grant');
}

function checkNotRewarded(row: Row, report: Report): void {
  if (!isEmptyList(value(row, 'reward'))) report('reward', 'reward is empty when type is not Rewarded');
  if (isTrue(value(row, 'extra_grant'))) report('extra_grant', 'extra_grant is false when type is not Rewarded');
  if (!isNull(value(row, 'limit_count'))) report('limit_count', 'limit_count is null when type is not Rewarded');
}

function checkRow(row: Row, report: Report): void {
  const type = typeOf(row);
  for (const name of AT_LEAST_ONE) {
    const v = value(row, name);
    if (v?.k === 'int' && v.v < 1n) report(name, `${name} is 1 or more when it is not null`);
  }
  if (type !== 'Interstitial') {
    for (const name of INTERSTITIAL_ONLY) if (!isNull(value(row, name))) report(name, `${name} is null when type is not Interstitial`);
  }
  if (type === 'Rewarded') checkRewarded(row, report);
  else checkNotRewarded(row, report);
}

export const check: ModuleCheck = (input) => {
  const table = input.data.tables.get('ad_placement');
  if (table === undefined) return;
  for (const row of table.rows) {
    checkRow(row, (name, message) => {
      const col = column(table, name);
      input.report('out_of_range', col === undefined ? rowPlace(table, row) : cellPlace(table, row, col), message);
    });
  }
};
