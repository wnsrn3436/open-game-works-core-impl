/** Data checks of `shop` `## data`: the value ranges and column combinations of `shop_product` rows. */
import type { ModuleCheck, ModuleCheckInput } from '../module-check.ts';
import { cellPlace, column, rowPlace, type Row, type Table } from '../model.ts';
import type { Value } from '../values.ts';

function isNull(v: Value | undefined): boolean {
  return v === undefined || v.k === 'null';
}

function int(v: Value | undefined): bigint | null {
  return v?.k === 'int' ? v.v : null;
}

function idName(v: Value | undefined): string {
  return v?.k === 'idname' ? v.name : '';
}

type Report = ModuleCheckInput['report'];

/** `max_quantity` and `limit_count` are 1 or more. */
function checkCounts(table: Table, row: Row, id: string, report: Report): void {
  const maxQuantity = column(table, 'max_quantity');
  const quantity = int(row.values.get('max_quantity'));
  if (maxQuantity && quantity !== null && quantity < 1n) {
    report('out_of_range', cellPlace(table, row, maxQuantity), `shop_product.max_quantity ${quantity.toString()} of ${id} is less than 1`);
  }
  const limitCount = column(table, 'limit_count');
  const count = int(row.values.get('limit_count'));
  if (limitCount && count !== null && count < 1n) {
    report('out_of_range', cellPlace(table, row, limitCount), `shop_product.limit_count ${count.toString()} of ${id} is less than 1`);
  }
}

/** `reset` is null while `limit_count` is null or `offer` is set. */
function checkReset(table: Table, row: Row, id: string, report: Report): void {
  const reset = column(table, 'reset');
  if (!reset || isNull(row.values.get('reset'))) return;
  if (isNull(row.values.get('limit_count'))) {
    report('out_of_range', cellPlace(table, row, reset), `shop_product.reset of ${id} is set while limit_count is null`);
  }
  if (column(table, 'offer') && !isNull(row.values.get('offer'))) {
    report('out_of_range', cellPlace(table, row, reset), `shop_product.reset of ${id} is set while offer is set`);
  }
}

export const check: ModuleCheck = (input) => {
  const table = input.data.tables.get('shop_product');
  if (!table) return;
  const reward = column(table, 'reward');
  const extraGrant = column(table, 'extra_grant');
  for (const row of table.rows) {
    const id = idName(row.values.get('id'));
    checkCounts(table, row, id, input.report);
    checkReset(table, row, id, input.report);
    const rewards = row.values.get('reward');
    const extra = row.values.get('extra_grant');
    if (reward && extraGrant && rewards?.k === 'list' && rewards.items.length === 0 && extra?.k === 'bool' && !extra.v) {
      input.report('out_of_range', rowPlace(table, row), `shop_product ${id} has an empty reward and extra_grant false`);
    }
  }
};
