/** Data checks of `offer` `## data`: `duration` is 1 or more, `cooldown` 0 or more, `duration` + `cooldown` at most 2^53-1, a `max_triggers` that is not null 1 or more. */
import type { ModuleCheck } from '../module-check.ts';
import { cellPlace, rowPlace } from '../model.ts';

const MAX_SAFE = 2n ** 53n - 1n;
/** Column name to the lowest value a value that is not null may have. */
const LOWEST: readonly (readonly [string, bigint])[] = [['duration', 1n], ['cooldown', 0n], ['max_triggers', 1n]];

export const check: ModuleCheck = (input) => {
  const table = input.data.tables.get('offer');
  if (table === undefined) return;
  for (const [name, lowest] of LOWEST) {
    const column = table.columns.find((c) => c.name === name);
    if (column === undefined) continue;
    for (const row of table.rows) {
      const value = row.values.get(name);
      if (value?.k === 'int' && value.v < lowest) input.report('out_of_range', cellPlace(table, row, column), `offer ${name} ${String(value.v)} is below ${String(lowest)}`);
    }
  }
  for (const row of table.rows) {
    const duration = row.values.get('duration');
    const cooldown = row.values.get('cooldown');
    if (duration?.k !== 'int' || cooldown?.k !== 'int' || duration.v + cooldown.v <= MAX_SAFE) continue;
    input.report('out_of_range', rowPlace(table, row), `offer duration + cooldown ${String(duration.v + cooldown.v)} is over 2^53-1`);
  }
};
