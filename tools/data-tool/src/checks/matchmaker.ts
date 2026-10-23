/**
 * Data checks of `matchmaker` `## data`: the `match_mode` rows. `max_players` ≤ `matchmaker.maxPlayers` and the
 * `rating` server module rule need the merged core settings and the server module list, which a module check does
 * not get, so the server start of `matchmaker` checks those two.
 */
import type { ModuleCheck, ModuleCheckInput } from '../module-check.ts';
import { cellPlace, column, rowPlace, type Row, type Table } from '../model.ts';
import type { Value } from '../values.ts';

function int(v: Value | undefined): bigint | null {
  return v?.k === 'int' ? v.v : null;
}

function bool(v: Value | undefined): boolean | null {
  return v?.k === 'bool' ? v.v : null;
}

type Report = (name: string, message: string) => void;

function reporter(input: ModuleCheckInput, table: Table, row: Row): Report {
  return (name, message) => {
    const col = column(table, name);
    input.report('out_of_range', col ? cellPlace(table, row, col) : rowPlace(table, row), `match_mode.${message}`);
  };
}

function checkPlayers(row: Row, report: Report): void {
  const min = int(row.values.get('min_players'));
  const max = int(row.values.get('max_players'));
  if (min !== null && min < 2n) report('min_players', `min_players ${String(min)} is less than 2`);
  if (min !== null && max !== null && max < min) report('max_players', `max_players ${String(max)} is less than min_players ${String(min)}`);
}

function checkPeriods(row: Row, report: Report): void {
  for (const name of ['match_wait', 'prepare_time', 'max_duration']) {
    const value = int(row.values.get(name));
    if (value !== null && value <= 0n) report(name, `${name} ${String(value)} is not greater than 0`);
  }
  for (const name of ['rating_spread', 'rating_spread_per_sec']) {
    const value = int(row.values.get(name));
    if (value !== null && value < 0n) report(name, `${name} ${String(value)} is negative`);
  }
}

function checkParty(row: Row, report: Report): void {
  const max = int(row.values.get('max_players'));
  const party = int(row.values.get('max_party_size'));
  const team = int(row.values.get('team_size'));
  if (party !== null && party < 1n) report('max_party_size', `max_party_size ${String(party)} is less than 1`);
  if (party !== null && max !== null && party > max) report('max_party_size', `max_party_size ${String(party)} is greater than max_players ${String(max)}`);
  if (team !== null && team < 0n) report('team_size', `team_size ${String(team)} is negative`);
  if (team !== null && team > 0n) {
    if (max !== null && max % team !== 0n) report('max_players', `max_players ${String(max)} is not a multiple of team_size ${String(team)}`);
    if (party !== null && party > team) report('max_party_size', `max_party_size ${String(party)} is greater than team_size ${String(team)}`);
  }
}

function checkEntry(row: Row, report: Report): void {
  const queue = bool(row.values.get('allow_queue'));
  const room = bool(row.values.get('allow_room'));
  if (queue === false && room === false) report('allow_queue', 'allow_queue and allow_room are both false');
}

export const check: ModuleCheck = (input) => {
  const table = input.data.tables.get('match_mode');
  if (!table) return;
  for (const row of table.rows) {
    const report = reporter(input, table, row);
    checkPlayers(row, report);
    checkPeriods(row, report);
    checkParty(row, report);
    checkEntry(row, report);
  }
};
