/** Data checks of `play-session` `## data`: the `play_session_mode` rows. */
import type { ModuleCheck } from '../module-check.ts';
import { cellPlace, column } from '../model.ts';
import type { Value } from '../values.ts';

function int(v: Value | undefined): bigint | null {
  return v?.k === 'int' ? v.v : null;
}

export const check: ModuleCheck = (input) => {
  const table = input.data.tables.get('play_session_mode');
  if (!table) return;
  const minCol = column(table, 'min_duration');
  const maxCol = column(table, 'max_duration');
  const continueCol = column(table, 'max_continue_count');
  for (const row of table.rows) {
    const min = int(row.values.get('min_duration'));
    const max = int(row.values.get('max_duration'));
    const count = int(row.values.get('max_continue_count'));
    if (maxCol && max !== null && max <= 0n) {
      input.report('out_of_range', cellPlace(table, row, maxCol), `play_session_mode.max_duration ${String(max)} is not greater than 0`);
    }
    if (minCol && min !== null && max !== null && min >= max) {
      input.report('out_of_range', cellPlace(table, row, minCol), `play_session_mode.min_duration ${String(min)} is not less than max_duration ${String(max)}`);
    }
    if (continueCol && count !== null && count < 0n) {
      input.report('out_of_range', cellPlace(table, row, continueCol), `play_session_mode.max_continue_count ${String(count)} is negative`);
    }
  }
};
