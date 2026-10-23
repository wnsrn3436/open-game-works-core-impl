/** Data checks of `push` (`push` spec `## data`). */
import { cellPlace, column } from '../model.ts';
import type { ModuleCheck } from '../module-check.ts';

/** A `push_message` row whose `kind` is `Ad` while game settings `pushConsent.adPush` is not `true`. */
export const check: ModuleCheck = (input) => {
  const table = input.data.tables.get('push_message');
  const kind = table ? column(table, 'kind') : undefined;
  if (!table || !kind) return;
  const consent = input.settings.pushConsent as { adPush?: unknown } | undefined;
  if (consent?.adPush === true) return;
  for (const row of table.rows) {
    const value = row.values.get('kind');
    if (value?.k === 'enum' && value.element === 'Ad') {
      input.report('out_of_range', cellPlace(table, row, kind), 'push_message kind is Ad while game settings pushConsent.adPush is false');
    }
  }
};
