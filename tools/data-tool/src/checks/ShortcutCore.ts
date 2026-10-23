/** Data checks of `ShortcutCore` `## data`: a `shortcut` row with an empty `panels` has an empty `args`. */
import { cellPlace, column } from '../model.ts';
import type { ModuleCheck } from '../module-check.ts';

export const check: ModuleCheck = (input) => {
  const table = input.data.tables.get('shortcut');
  const args = table ? column(table, 'args') : undefined;
  if (!table || !args) return;
  for (const row of table.rows) {
    const panelsValue = row.values.get('panels');
    const argsValue = row.values.get('args');
    if (panelsValue?.k !== 'list' || argsValue?.k !== 'list') continue;
    if (panelsValue.items.length === 0 && argsValue.items.length > 0) {
      input.report('out_of_range', cellPlace(table, row, args), 'shortcut.args is not empty while shortcut.panels is empty');
    }
  }
};
