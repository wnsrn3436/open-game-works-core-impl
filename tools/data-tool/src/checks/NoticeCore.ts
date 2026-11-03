/**
 * Data check of `NoticeCore` `## data`: the `badge` row that the reserved ID `[notice_badge]` points to has `persist`
 * `false`. Whether the row exists is the reserved ID reference check (`check-refs.ts`).
 */
import { cellPlace, cellText, column } from '../model.ts';
import type { ModuleCheck, ModuleCheckInput } from '../module-check.ts';

const RESERVED = '[notice_badge]';

/** The ID name `[notice_badge]` points to in `reserved_id`; an empty string when there is none. */
function reservedTarget(input: ModuleCheckInput): string {
  const reserved = input.data.tables.get('reserved_id');
  if (!reserved) return '';
  const idCol = column(reserved, 'id');
  const valueCol = column(reserved, 'value');
  if (!idCol || !valueCol) return '';
  const entry = reserved.rows.find((r) => cellText(r, idCol) === RESERVED);
  return entry ? cellText(entry, valueCol) : '';
}

export const check: ModuleCheck = (input) => {
  const badge = input.data.tables.get('badge');
  const badgeId = badge ? column(badge, 'id') : undefined;
  if (!badge || !badgeId) return;
  const target = reservedTarget(input);
  const row = badge.rows.find((r) => cellText(r, badgeId) === target);
  const persist = column(badge, 'persist');
  const persistValue = row?.values.get('persist');
  if (row && persist && persistValue?.k === 'bool' && persistValue.v) {
    input.report('out_of_range', cellPlace(badge, row, persist), `badge ${target} of ${RESERVED} has persist true; it must be false`);
  }
};
