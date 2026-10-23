/** Data checks of `attendance` `## data`: an `attendance_reward` row has a `reward` or an `extra_grant` of true. */
import type { ModuleCheck } from '../module-check.ts';
import { cellPlace, column } from '../model.ts';

export const check: ModuleCheck = (input) => {
  const table = input.data.tables.get('attendance_reward');
  if (!table) return;
  const reward = column(table, 'reward');
  if (!reward || !column(table, 'extra_grant')) return;
  for (const row of table.rows) {
    const items = row.values.get('reward');
    const extra = row.values.get('extra_grant');
    if (items?.k !== 'list' || items.items.length > 0 || extra?.k !== 'bool' || extra.v) continue;
    const id = row.values.get('id');
    const day = row.values.get('day');
    const name = id?.k === 'idname' ? id.name : `line ${String(row.line)}`;
    const which = day?.k === 'int' ? ` day ${day.v.toString()}` : '';
    input.report('out_of_range', cellPlace(table, row, reward), `attendance_reward ${name}${which} has an empty reward and extra_grant false`);
  }
};
