/** Data checks of `reset-counter` `## data`: a `reset_counter.limit` that is not null is 1 to 2^53-1. */
import type { ModuleCheck } from '../module-check.ts';
import { cellPlace, column } from '../model.ts';

const MAX_SAFE = 2n ** 53n - 1n;

export const check: ModuleCheck = (input) => {
  const table = input.data.tables.get('reset_counter');
  if (!table) return;
  const limit = column(table, 'limit');
  if (!limit) return;
  for (const row of table.rows) {
    const v = row.values.get('limit');
    if (v?.k !== 'int' || (v.v >= 1n && v.v <= MAX_SAFE)) continue;
    const id = row.values.get('id');
    const name = id?.k === 'idname' ? id.name : `line ${String(row.line)}`;
    input.report('out_of_range', cellPlace(table, row, limit), `reset_counter.limit ${v.v.toString()} of ${name} is not 1 to 2^53-1`);
  }
};
