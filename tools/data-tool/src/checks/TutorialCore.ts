/**
 * Data checks of `TutorialCore` `## data`: the `tutorial_step` rows. That an anchor of a step with `panel` or `popup`
 * is in that panel or popup prefab is the static check `anchor reference`.
 */
import type { ModuleCheck, ModuleCheckInput } from '../module-check.ts';
import { cellPlace, column, type Row, type Table } from '../model.ts';
import type { Value } from '../values.ts';

function text(value: Value | undefined): string {
  return value?.k === 'text' ? value.v : '';
}

function isTrue(value: Value | undefined): boolean {
  return value?.k === 'bool' && value.v;
}

function element(value: Value | undefined): string | null {
  return value?.k === 'enum' ? value.element : null;
}

function stepOf(row: Row): bigint {
  const value = row.values.get('step');
  return value?.k === 'int' ? value.v : 0n;
}

/** Reports `message` on the cell of `name` in `row` when the table has that column. */
function reporter(input: ModuleCheckInput, table: Table) {
  return (code: 'empty_required' | 'out_of_range', row: Row, name: string, message: string): void => {
    const col = column(table, name);
    if (col) input.report(code, cellPlace(table, row, col), message);
  };
}

type Report = ReturnType<typeof reporter>;

function checkAnchor(report: Report, row: Row): void {
  const v = row.values;
  const anchor = text(v.get('anchor'));
  if (anchor === '' && (isTrue(v.get('pointer')) || isTrue(v.get('restrict_input')) || element(v.get('complete')) === 'AnchorTap')) {
    report('empty_required', row, 'anchor', 'tutorial_step.anchor is empty while pointer or restrict_input is true or complete is AnchorTap');
  }
  const anchorKey = v.get('anchor_key');
  if (anchorKey?.k === 'int' && anchorKey.v < 1n) {
    report('out_of_range', row, 'anchor_key', `tutorial_step.anchor_key ${String(anchorKey.v)} is below 1`);
  }
  if (anchorKey !== undefined && anchorKey.k !== 'null' && anchor === '') {
    report('empty_required', row, 'anchor', 'tutorial_step.anchor is empty while anchor_key is not null');
  }
}

function checkComplete(report: Report, row: Row): void {
  const v = row.values;
  const complete = element(v.get('complete'));
  const requirement = v.get('complete_requirement');
  if (complete === 'Requirement' && requirement?.k === 'req' && requirement.name === null) {
    report('empty_required', row, 'complete_requirement', 'tutorial_step.complete_requirement is empty while complete is Requirement');
  }
  if (complete === 'Cue' && v.get('cue')?.k === 'null') {
    report('empty_required', row, 'cue', 'tutorial_step.cue is null while complete is Cue');
  }
}

function checkPopup(report: Report, row: Row, resumeStart: boolean): void {
  const v = row.values;
  if (v.get('popup')?.k !== 'text') return;
  if (v.get('panel')?.k === 'text') report('out_of_range', row, 'popup', 'tutorial_step.panel and tutorial_step.popup are both not null');
  if (!isTrue(v.get('restrict_input'))) {
    report('out_of_range', row, 'popup', 'tutorial_step.popup is not null while restrict_input is false');
  }
  if (resumeStart) report('out_of_range', row, 'popup', 'tutorial_step.popup is not null on a resume start step');
}

function checkRow(report: Report, row: Row, resumeStart: boolean): void {
  checkAnchor(report, row);
  checkComplete(report, row);
  checkPopup(report, row, resumeStart);
}

export const check: ModuleCheck = (input) => {
  const table = input.data.tables.get('tutorial_step');
  if (!table) return;
  const report = reporter(input, table);
  const groups = new Map<string, Row[]>();
  for (const row of table.rows) {
    const id = row.values.get('id');
    const key = id?.k === 'idname' ? id.name : '';
    const group = groups.get(key);
    if (group) group.push(row);
    else groups.set(key, [row]);
  }
  for (const rows of groups.values()) {
    // a resume start step is the first step of the tutorial or the step right after a step whose save is true
    const ordered = [...rows].sort((a, b) => (stepOf(a) < stepOf(b) ? -1 : stepOf(a) > stepOf(b) ? 1 : a.line - b.line));
    let resumeStart = true;
    for (const row of ordered) {
      checkRow(report, row, resumeStart);
      resumeStart = isTrue(row.values.get('save'));
    }
  }
};
