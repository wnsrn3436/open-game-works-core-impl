/**
 * `remote-config` `## data`: `remote_config_key.default_value` reads as the row's `type` (`Bool` is `true` or
 * `false`, `Int` is a `long` integer; any text is a `String`). A violation is data check `value_type`. The byte
 * limit of a `String` value is checked at server start, where the merged core settings are known.
 */
import type { ModuleCheck } from '../module-check.ts';
import { cellPlace, cellText, column } from '../model.ts';
import { parseInt64 } from '../values.ts';

export const check: ModuleCheck = (input) => {
  const table = input.data.tables.get('remote_config_key');
  if (!table) return;
  const typeCol = column(table, 'type');
  const valueCol = column(table, 'default_value');
  if (!typeCol || !valueCol) return;
  for (const row of table.rows) {
    const type = row.values.get('type');
    if (type?.k !== 'enum') continue;
    const text = cellText(row, valueCol);
    const place = cellPlace(table, row, valueCol);
    if (type.element === 'Bool') {
      if (text !== 'true' && text !== 'false') input.report('value_type', place, `default_value ${JSON.stringify(text)} of a Bool key is not true or false`);
    } else if (type.element === 'Int') {
      if (parseInt64(text) === null) input.report('value_type', place, `default_value ${JSON.stringify(text)} of an Int key is not a long integer`);
    }
  }
};
