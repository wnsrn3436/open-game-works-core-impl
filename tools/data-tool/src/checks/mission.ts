/** Data check of `mission` (its spec `## data`): the `target` range, and a reward or extra grant on every mission. */
import { cellPlace, column, rowPlace } from '../model.ts';
import type { ModuleCheck } from '../module-check.ts';

const MAX_SAFE = 2n ** 53n - 1n;

export const check: ModuleCheck = ({ data, report }) => {
  const table = data.tables.get('mission');
  if (table === undefined) return;
  const target = column(table, 'target');
  const reward = column(table, 'reward');
  for (const row of table.rows) {
    const t = row.values.get('target');
    if (target !== undefined && t?.k === 'int' && (t.v < 1n || t.v > MAX_SAFE)) {
      report('out_of_range', cellPlace(table, row, target), `mission.target ${String(t.v)} is not 1 to 2^53-1`);
    }
    const r = row.values.get('reward');
    const extra = row.values.get('extra_grant');
    if (r?.k === 'list' && r.items.length === 0 && extra?.k === 'bool' && !extra.v) {
      report('empty_required', reward === undefined ? rowPlace(table, row) : cellPlace(table, row, reward), 'mission.reward is empty while extra_grant is false');
    }
  }
};
