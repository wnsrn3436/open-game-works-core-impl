/**
 * Data checks of `ChatCore` `## data`: the `badge` row that the reserved ID `[chat_badge]` points to has `persist`
 * `false` and `display` `Count`. Whether the row exists is the reserved ID reference check (`check-refs.ts`).
 */
import { cellPlace, cellText, column, type Row, type Table } from '../model.ts';
import type { ModuleCheck, ModuleCheckInput } from '../module-check.ts';

const RESERVED = '[chat_badge]';

/** The ID name `[chat_badge]` points to in `reserved_id`; an empty string when there is none. */
function reservedTarget(input: ModuleCheckInput): string {
  const reserved = input.data.tables.get('reserved_id');
  if (!reserved) return '';
  const idCol = column(reserved, 'id');
  const valueCol = column(reserved, 'value');
  if (!idCol || !valueCol) return '';
  const entry = reserved.rows.find((r) => cellText(r, idCol) === RESERVED);
  return entry ? cellText(entry, valueCol) : '';
}

function checkBadgeRow(input: ModuleCheckInput, badge: Table, row: Row, target: string): void {
  const persist = column(badge, 'persist');
  const persistValue = row.values.get('persist');
  if (persist && persistValue?.k === 'bool' && persistValue.v) {
    input.report('out_of_range', cellPlace(badge, row, persist), `badge ${target} of ${RESERVED} has persist true; it must be false`);
  }
  const display = column(badge, 'display');
  const displayValue = row.values.get('display');
  if (display && displayValue?.k === 'enum' && displayValue.element !== 'Count') {
    input.report('out_of_range', cellPlace(badge, row, display), `badge ${target} of ${RESERVED} has display ${displayValue.element}; it must be Count`);
  }
}

export const check: ModuleCheck = (input) => {
  const badge = input.data.tables.get('badge');
  const badgeId = badge ? column(badge, 'id') : undefined;
  if (!badge || !badgeId) return;
  const target = reservedTarget(input);
  const row = badge.rows.find((r) => cellText(r, badgeId) === target);
  if (row) checkBadgeRow(input, badge, row, target);
};
