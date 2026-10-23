/**
 * `ranking` `## data`: `ranking_board` `size` at least 1, `cycle` and `live_event` not both; `ranking_reward` rows
 * of a board (`ref_missing` otherwise) whose `reward_mail` is not null, and `1 ≤ rank_from ≤ rank_to ≤ size`
 * without overlapping ranges of one board. `reward` of at most `mailbox.maxAttachments` items is a server start
 * check, not a data check.
 */
import { cellPlace, column, rowPlace, type Row, type Table } from '../model.ts';
import type { ModuleCheck, ModuleCheckInput } from '../module-check.ts';
import type { Value } from '../values.ts';

interface BoardInfo {
  readonly size: bigint | null;
  readonly hasRewardMail: boolean;
}

function intOf(value: Value | undefined): bigint | null {
  return value?.k === 'int' ? value.v : null;
}

function nameOf(value: Value | undefined): string | null {
  return value?.k === 'idname' ? value.name : null;
}

function isNull(value: Value | undefined): boolean {
  return value === undefined || value.k === 'null';
}

function reportAt(input: ModuleCheckInput, table: Table, row: Row, name: string, code: 'out_of_range' | 'ref_missing', message: string): void {
  const col = column(table, name);
  input.report(code, col === undefined ? rowPlace(table, row) : cellPlace(table, row, col), message);
}

function checkBoards(input: ModuleCheckInput, boards: Table): Map<string, BoardInfo> {
  const info = new Map<string, BoardInfo>();
  for (const row of boards.rows) {
    const id = nameOf(row.values.get('id'));
    const size = intOf(row.values.get('size'));
    if (size !== null && size < 1n) reportAt(input, boards, row, 'size', 'out_of_range', `ranking_board ${id ?? ''} size ${String(size)} is below 1`);
    if (!isNull(row.values.get('cycle')) && !isNull(row.values.get('live_event'))) {
      reportAt(input, boards, row, 'live_event', 'out_of_range', `ranking_board ${id ?? ''} has both cycle and live_event`);
    }
    if (id !== null) info.set(id, { size, hasRewardMail: !isNull(row.values.get('reward_mail')) });
  }
  return info;
}

function checkRange(input: ModuleCheckInput, rewards: Table, row: Row, id: string, board: BoardInfo, taken: Map<string, [bigint, bigint][]>): void {
  const from = intOf(row.values.get('rank_from'));
  const to = intOf(row.values.get('rank_to'));
  if (from === null || to === null) return;
  if (from < 1n || from > to || (board.size !== null && to > board.size)) {
    reportAt(input, rewards, row, 'rank_from', 'out_of_range', `ranking_reward ${id} range ${String(from)}-${String(to)} is not within 1 to the board size`);
    return;
  }
  const ranges = taken.get(id) ?? [];
  if (ranges.some(([a, b]) => from <= b && a <= to)) reportAt(input, rewards, row, 'rank_from', 'out_of_range', `ranking_reward ${id} range ${String(from)}-${String(to)} overlaps another range of the board`);
  ranges.push([from, to]);
  taken.set(id, ranges);
}

function checkRewards(input: ModuleCheckInput, rewards: Table, boards: Map<string, BoardInfo>): void {
  const taken = new Map<string, [bigint, bigint][]>();
  for (const row of rewards.rows) {
    const id = nameOf(row.values.get('id'));
    if (id === null) continue;
    const board = boards.get(id);
    if (board === undefined) {
      reportAt(input, rewards, row, 'id', 'ref_missing', `ranking_reward ${id} is not a ranking_board ID name`);
      continue;
    }
    if (!board.hasRewardMail) reportAt(input, rewards, row, 'id', 'out_of_range', `ranking_reward ${id}: the board's reward_mail is null`);
    checkRange(input, rewards, row, id, board, taken);
  }
}

export const check: ModuleCheck = (input) => {
  const boards = input.data.tables.get('ranking_board');
  const info = boards === undefined ? new Map<string, BoardInfo>() : checkBoards(input, boards);
  const rewards = input.data.tables.get('ranking_reward');
  if (rewards !== undefined) checkRewards(input, rewards, info);
};
