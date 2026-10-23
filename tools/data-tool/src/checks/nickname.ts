/** Data checks of `nickname` `## data`: `nickname_cost.change_number` is 0 or more and unique in the table. */
import type { ModuleCheck } from '../module-check.ts';
import { cellPlace, column } from '../model.ts';

export const check: ModuleCheck = (input) => {
  const table = input.data.tables.get('nickname_cost');
  if (!table) return;
  const col = column(table, 'change_number');
  if (!col) return;
  const seen = new Set<bigint>();
  for (const row of table.rows) {
    const value = row.values.get('change_number');
    if (value?.k !== 'int') continue;
    const place = cellPlace(table, row, col);
    if (value.v < 0n) input.report('out_of_range', place, `nickname_cost.change_number ${value.v.toString()} is less than 0`);
    if (seen.has(value.v)) input.report('duplicate', place, `nickname_cost.change_number ${value.v.toString()} is in another row`);
    seen.add(value.v);
  }
};
