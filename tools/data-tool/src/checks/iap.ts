/**
 * Data checks of `iap` (`iap` `## data`): the `iap_product` rules by product type, `limit_count`, `reset`,
 * `pass_days`, `daily_reward`, `spend_amount`, SKU uniqueness, and a row that grants nothing.
 */
import type { ModuleCheck } from '../module-check.ts';
import { cellPlace, column, rowPlace, type Row, type Table } from '../model.ts';
import type { Value } from '../values.ts';

const TABLE = 'iap_product';

function value(row: Row, name: string): Value | undefined {
  return row.values.get(name);
}

function is_null(v: Value | undefined): boolean {
  return v === undefined || v.k === 'null';
}

function int(v: Value | undefined): bigint | null {
  return v?.k === 'int' ? v.v : null;
}

function element(v: Value | undefined): string {
  return v?.k === 'enum' ? v.element : '';
}

function text(v: Value | undefined): string {
  return v?.k === 'text' ? v.v : '';
}

function is_empty_list(v: Value | undefined): boolean {
  return v === undefined || (v.k === 'list' && v.items.length === 0);
}

function place(table: Table, row: Row, name: string) {
  const col = column(table, name);
  return col === undefined ? rowPlace(table, row) : cellPlace(table, row, col);
}

type Report = (name: string, message: string, code?: 'out_of_range' | 'duplicate') => void;

/** The rules of a `NonConsumable` and a `Subscription` row: `limit_count`, and null `reset`, `pass_days`, `offer`. */
function check_non_consumable(row: Row, type: string, report: Report): void {
  if (type !== 'NonConsumable' && type !== 'Subscription') return;
  if (type === 'NonConsumable' && int(value(row, 'limit_count')) !== 1n) report('limit_count', 'a NonConsumable has limit_count 1');
  if (type === 'Subscription' && !is_null(value(row, 'limit_count'))) report('limit_count', 'a Subscription has limit_count null');
  if (!is_null(value(row, 'reset'))) report('reset', `a ${type} has reset null`);
  if (!is_null(value(row, 'pass_days'))) report('pass_days', `a ${type} has pass_days null`);
  if (!is_null(value(row, 'offer'))) report('offer', `a ${type} has offer null`);
}

/** The `type`, `limit_count`, `reset`, `pass_days`, `offer` and `daily_reward` rules of one row. */
function check_type_rules(row: Row, report: Report): void {
  const type = element(value(row, 'type'));
  const limit = int(value(row, 'limit_count'));
  const pass_days = int(value(row, 'pass_days'));
  const reset_null = is_null(value(row, 'reset'));
  const offer_null = is_null(value(row, 'offer'));
  check_non_consumable(row, type, report);
  if (!reset_null && (is_null(value(row, 'limit_count')) || !offer_null)) report('reset', 'reset is null when limit_count is null or offer is not null');
  if (limit !== null && limit < 1n) report('limit_count', 'limit_count is 1 or more');
  if (pass_days !== null && pass_days < 1n) report('pass_days', 'pass_days is 1 or more');
  const daily_allowed = type === 'Subscription' || (type === 'Consumable' && pass_days !== null);
  if (!daily_allowed && !is_empty_list(value(row, 'daily_reward'))) report('daily_reward', 'daily_reward is empty except for a Subscription and a Consumable with pass_days');
}

/** The `spend_amount` rules of one row. */
function check_spend(row: Row, spend_limited: boolean, report: Report): void {
  const spend = int(value(row, 'spend_amount'));
  if (spend === null) return;
  const has_sku = text(value(row, 'sku_apple')) !== '' || text(value(row, 'sku_google')) !== '';
  if (spend < 0n) report('spend_amount', 'spend_amount is 0 or more');
  if (spend < 1n && spend_limited && has_sku) report('spend_amount', 'spend_amount is 1 or more for a row with a SKU while game settings purchaseLimits.monthlyBelowAge is not empty');
}

/** No two rows share a SKU of a store. */
function check_skus(row: Row, id: string, seen: ReadonlyMap<string, Map<string, string>>, report: Report): void {
  for (const [name, skus] of seen) {
    const sku = text(value(row, name));
    if (sku === '') continue;
    const first = skus.get(sku);
    if (first !== undefined) report(name, `SKU ${sku} is also the ${name} of ${first}`, 'duplicate');
    else skus.set(sku, id);
  }
}

export const check: ModuleCheck = (input) => {
  const table = input.data.tables.get(TABLE);
  if (table === undefined) return;
  const monthly = input.settings.purchaseLimits as { monthlyBelowAge?: Record<string, unknown> } | undefined;
  const spend_limited = Object.keys(monthly?.monthlyBelowAge ?? {}).length > 0;
  const seen = new Map<string, Map<string, string>>([
    ['sku_apple', new Map()],
    ['sku_google', new Map()],
  ]);
  for (const row of table.rows) {
    const id = row.cells[0]?.text ?? '';
    const report: Report = (name, message, code = 'out_of_range') => {
      input.report(code, place(table, row, name), `${TABLE}.${name} of ${id}: ${message}`);
    };
    check_type_rules(row, report);
    check_spend(row, spend_limited, report);
    check_skus(row, id, seen, report);
    const extra = value(row, 'extra_grant');
    if (is_empty_list(value(row, 'reward')) && is_empty_list(value(row, 'daily_reward')) && extra?.k === 'bool' && !extra.v) report('reward', 'a row with empty reward and daily_reward needs extra_grant true');
  }
};
