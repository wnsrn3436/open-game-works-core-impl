/** Data checks of `PushCore` `## data`: a `local_push.delay` is null or at least 1 ms. */
import { cellPlace, column } from '../model.ts';
import type { ModuleCheck } from '../module-check.ts';

export const check: ModuleCheck = (input) => {
  const table = input.data.tables.get('local_push');
  const delay = table ? column(table, 'delay') : undefined;
  if (!table || !delay) return;
  for (const row of table.rows) {
    const v = row.values.get('delay');
    if (v?.k !== 'int' || v.v >= 1n) continue;
    const id = row.values.get('id');
    const name = id?.k === 'idname' ? id.name : `line ${String(row.line)}`;
    input.report('out_of_range', cellPlace(table, row, delay), `local_push.delay ${v.v.toString()} ms of ${name} is not null or at least 1 ms`);
  }
};
