/**
 * Data check of `rating` (its spec `## data`): the `rating_rule` and `rating_tier` rules. `season_reward` of at most
 * `mailbox.maxAttachments` items is a server start check, not a data check.
 */
import type { ModuleCheck } from '../module-check.ts';
import { cellPlace, cellText, column, type Row, type Table } from '../model.ts';

/** The integer value of a cell, or null when the cell is null or not an integer. */
function int(row: Row, name: string): bigint | null {
  const value = row.values.get(name);
  return value?.k === 'int' ? value.v : null;
}

/** The ID name of a `ref` or `id` cell, or null when the cell is null. */
function ref(row: Row, name: string): string | null {
  const value = row.values.get(name);
  return value?.k === 'idname' ? value.name : null;
}

function count(row: Row, name: string): number {
  const value = row.values.get(name);
  return value?.k === 'list' ? value.items.length : 0;
}

type Report = Parameters<ModuleCheck>[0]['report'];
type Code = Parameters<Report>[0];

/** Reports a cell of a row, the message led by the row's ID name. */
function at(report: Report, table: Table, row: Row, name: string, code: Code, message: string): void {
  const col = column(table, name);
  if (col === undefined) return;
  report(code, cellPlace(table, row, col), `${cellText(row, column(table, 'id') ?? col)}: ${message}`);
}

/** The `rating_tier` rule: distinct `min_rating` within a rule. Returns the rules that have a tier with a season reward. */
function check_tiers(report: Report, tiers: Table): Set<string> {
  const rewarded = new Set<string>();
  const seen = new Map<string, Set<bigint>>();
  for (const row of tiers.rows) {
    const rule = ref(row, 'rule');
    const min = int(row, 'min_rating');
    if (rule === null) continue;
    if (count(row, 'season_reward') > 0) rewarded.add(rule);
    if (min === null) continue;
    const mins = seen.get(rule) ?? new Set<bigint>();
    if (mins.has(min)) at(report, tiers, row, 'min_rating', 'duplicate', `min_rating ${String(min)} is also the min_rating of another rating_tier row of ${rule}`);
    mins.add(min);
    seen.set(rule, mins);
  }
  return rewarded;
}

/** The value rules of a `rating_rule` row that do not depend on its tiers. */
function check_values(report: Report, rules: Table, row: Row): void {
  const lower = (name: string, min: bigint): void => {
    const value = int(row, name);
    if (value !== null && value < min) at(report, rules, row, name, 'out_of_range', `${name} ${String(value)} is less than ${String(min)}`);
  };
  lower('scale', 1n);
  lower('k_factor', 0n);
  lower('placement_k_factor', 0n);
  lower('placement_matches', 0n);
  lower('soft_reset_permille', 0n);
  lower('reward_min_games', 0n);
  const permille = int(row, 'soft_reset_permille');
  if (permille !== null && permille > 1000n) at(report, rules, row, 'soft_reset_permille', 'out_of_range', `soft_reset_permille ${String(permille)} is more than 1000`);
  const min_rating = int(row, 'min_rating');
  if (min_rating === null) return;
  for (const name of ['initial_rating', 'soft_reset_target']) {
    const value = int(row, name);
    if (value !== null && min_rating > value) at(report, rules, row, 'min_rating', 'out_of_range', `min_rating ${String(min_rating)} is more than ${name} ${String(value)}`);
  }
}

/** The rules of a `rating_rule` row that has a tier with a season reward. */
function check_rewarded(report: Report, rules: Table, row: Row): void {
  const games = int(row, 'reward_min_games');
  if (games !== null && games < 1n) at(report, rules, row, 'reward_min_games', 'out_of_range', 'reward_min_games is less than 1 while a rating_tier row of the rule has a season_reward');
  for (const name of ['season_board', 'reward_mail']) {
    if (row.values.get(name)?.k === 'null') at(report, rules, row, name, 'empty_required', `${name} is empty while a rating_tier row of the rule has a season_reward`);
  }
}

export const check: ModuleCheck = ({ data, report }) => {
  const rules = data.tables.get('rating_rule');
  const tiers = data.tables.get('rating_tier');
  if (rules === undefined) return;
  const rewarded = tiers === undefined ? new Set<string>() : check_tiers(report, tiers);
  for (const row of rules.rows) {
    check_values(report, rules, row);
    const id = ref(row, 'id');
    if (id !== null && rewarded.has(id)) check_rewarded(report, rules, row);
  }
};
