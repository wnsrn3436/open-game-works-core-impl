/**
 * Data checks of `CutsceneCore` `## data`: the rows of `cutscene_step` and `cutscene_choice`. The rows of one `id` are
 * one cutscene. The `ref` of `speaker`, the types, the enums and the requirement expressions are checked for every game.
 */
import { cellPlace, column, rowPlace, type Row, type Table } from '../model.ts';
import type { ModuleCheck, ModuleCheckInput } from '../module-check.ts';
import { isSnakeCase } from '../types.ts';
import type { Value } from '../values.ts';

/** Whether a command must fill a column it uses (`required`) or may leave it empty (`optional`). */
type Use = 'required' | 'optional';

/** The `cutscene_step` columns a command uses, by column (`## data` `used by command`). `id`, `step` and `command` are used by all. */
const USES: ReadonlyMap<string, Readonly<Record<string, Use>>> = new Map<string, Readonly<Record<string, Use>>>([
  ['wait', { Move: 'optional', Animate: 'optional', Camera: 'optional', ScreenEffect: 'optional', Staging: 'optional' }],
  ['actor', { Move: 'required', Animate: 'required', Staging: 'optional' }],
  ['target', { Move: 'required', Camera: 'required' }],
  ['speaker', { Line: 'optional' }],
  ['text', { Line: 'required' }],
  ['resource', { Line: 'optional', Bgm: 'optional', Move: 'required', Camera: 'required', Sound: 'required', ScreenEffect: 'required', Staging: 'required' }],
  ['animation', { Animate: 'required' }],
  ['duration', { Wait: 'required' }],
  ['cue', { Cue: 'required' }],
  ['next_step', { Jump: 'required', Branch: 'required' }],
  ['voice', { Line: 'optional' }],
  ['requirement', { Branch: 'required' }],
]);

/** Whether a cell value is the empty value of its type: an empty `string` or `tstring`, `null`, `false`, an empty requirement. */
function isEmpty(value: Value): boolean {
  switch (value.k) {
    case 'null':
      return true;
    case 'text':
      return value.v === '';
    case 'bool':
      return !value.v;
    case 'req':
      return value.name === null;
    default:
      return false;
  }
}

function idOf(row: Row): string | null {
  const id = row.values.get('id');
  return id?.k === 'idname' ? id.name : null;
}

function intOf(row: Row, name: string): number | null {
  const value = row.values.get(name);
  return value?.k === 'int' ? Number(value.v) : null;
}

function enumOf(row: Row, name: string): string | null {
  const value = row.values.get(name);
  return value?.k === 'enum' ? value.element : null;
}

function report(input: ModuleCheckInput, table: Table, row: Row, name: string, code: Parameters<ModuleCheckInput['report']>[0], message: string): void {
  const col = column(table, name);
  input.report(code, col ? cellPlace(table, row, col) : rowPlace(table, row), message);
}

/** The `cutscene_step` rows of each cutscene, by `step`. The first row of a `step` wins. */
function stepsOf(input: ModuleCheckInput, table: Table): Map<string, Map<number, Row>> {
  const cutscenes = new Map<string, Map<number, Row>>();
  for (const row of table.rows) {
    const id = idOf(row);
    const step = intOf(row, 'step');
    if (id === null || step === null) continue;
    if (step < 1) report(input, table, row, 'step', 'out_of_range', `cutscene_step ${id} step ${String(step)} is less than 1`);
    let steps = cutscenes.get(id);
    if (!steps) {
      steps = new Map();
      cutscenes.set(id, steps);
    }
    if (steps.has(step)) {
      report(input, table, row, 'step', 'duplicate', `cutscene_step ${id} step ${String(step)} is in another row of the cutscene`);
      continue;
    }
    steps.set(step, row);
  }
  return cutscenes;
}

function checkColumns(input: ModuleCheckInput, table: Table, row: Row, id: string, step: number, command: string): void {
  for (const [name, uses] of USES) {
    const value = row.values.get(name);
    if (value === undefined) continue;
    const use = uses[command];
    if (use === undefined) {
      if (!isEmpty(value)) report(input, table, row, name, 'out_of_range', `cutscene_step ${id} step ${String(step)}: ${command} does not use ${name}, which is not empty`);
    } else if (use === 'required' && isEmpty(value)) {
      report(input, table, row, name, 'empty_required', `cutscene_step ${id} step ${String(step)}: ${name} of ${command} is empty`);
    }
  }
  for (const name of ['actor', 'target']) {
    const value = row.values.get(name);
    if (value?.k === 'text' && value.v !== '' && !isSnakeCase(value.v)) {
      report(input, table, row, name, 'value_type', `cutscene_step ${id} step ${String(step)}: ${name} ${JSON.stringify(value.v)} is not snake_case`);
    }
  }
}

function checkSteps(input: ModuleCheckInput, table: Table, cutscenes: Map<string, Map<number, Row>>): void {
  const voices = new Set<string>();
  for (const row of table.rows) {
    const id = idOf(row);
    const step = intOf(row, 'step');
    const command = enumOf(row, 'command');
    if (id === null || step === null) continue;
    if (command !== null) checkColumns(input, table, row, id, step, command);
    const next = intOf(row, 'next_step');
    if (next !== null) {
      if (!cutscenes.get(id)?.has(next)) {
        report(input, table, row, 'next_step', 'ref_missing', `cutscene_step ${id} step ${String(step)}: next_step ${String(next)} is not a step of the cutscene`);
      }
      if ((command === 'Jump' || command === 'Branch') && next <= step) {
        report(input, table, row, 'next_step', 'out_of_range', `cutscene_step ${id} step ${String(step)}: next_step ${String(next)} of ${command} is not after the step`);
      }
    }
    const voice = row.values.get('voice');
    if (voice?.k === 'text' && voice.v !== '') {
      if (voices.has(voice.v)) report(input, table, row, 'voice', 'duplicate', `cutscene_step voice ${voice.v} is in another cutscene_step row`);
      voices.add(voice.v);
    }
  }
}

/** Checks that the `step` of a `cutscene_choice` row is a `Choice` step and its `next_step` a step of the cutscene. */
function checkChoiceSteps(input: ModuleCheckInput, choices: Table, row: Row, steps: Map<number, Row> | undefined, id: string, step: number): void {
  const stepRow = steps?.get(step);
  const command = stepRow ? enumOf(stepRow, 'command') : null;
  if (!stepRow) {
    report(input, choices, row, 'step', 'ref_missing', `cutscene_choice ${id} step ${String(step)} has no cutscene_step row`);
  } else if (command !== null && command !== 'Choice') {
    report(input, choices, row, 'step', 'out_of_range', `cutscene_choice ${id} step ${String(step)}: the cutscene_step command is not Choice`);
  }
  const next = intOf(row, 'next_step');
  if (next !== null && !steps?.has(next)) {
    report(input, choices, row, 'next_step', 'ref_missing', `cutscene_choice ${id} step ${String(step)}: next_step ${String(next)} is not a step of the cutscene`);
  }
}

/** Checks one `cutscene_choice` row; adds `<id>\0<step>` to `open` when the choice has no requirement. */
function checkChoice(input: ModuleCheckInput, choices: Table, row: Row, cutscenes: Map<string, Map<number, Row>>, seen: Set<string>, open: Set<string>): void {
  const id = idOf(row);
  const step = intOf(row, 'step');
  const choice = intOf(row, 'choice');
  if (id === null || step === null) return;
  if (choice !== null) {
    const key = `${id}\u0000${String(step)}\u0000${String(choice)}`;
    if (seen.has(key)) report(input, choices, row, 'choice', 'duplicate', `cutscene_choice ${id} step ${String(step)} choice ${String(choice)} is in another row`);
    seen.add(key);
  }
  checkChoiceSteps(input, choices, row, cutscenes.get(id), id, step);
  const requirement = row.values.get('requirement');
  if (requirement?.k === 'req' && requirement.name === null) open.add(`${id}\u0000${String(step)}`);
}

function checkChoices(input: ModuleCheckInput, choices: Table | undefined, steps: Table, cutscenes: Map<string, Map<number, Row>>): void {
  /** `<id>\0<step>` of the `Choice` steps that have a choice without a requirement. */
  const open = new Set<string>();
  const seen = new Set<string>();
  if (choices) for (const row of choices.rows) checkChoice(input, choices, row, cutscenes, seen, open);
  for (const row of steps.rows) {
    const id = idOf(row);
    const step = intOf(row, 'step');
    if (id === null || step === null || enumOf(row, 'command') !== 'Choice') continue;
    if (!open.has(`${id}\u0000${String(step)}`)) {
      input.report('required_missing', rowPlace(steps, row), `cutscene_step ${id} step ${String(step)}: the Choice has no cutscene_choice row without a requirement`);
    }
  }
}

export const check: ModuleCheck = (input) => {
  const steps = input.data.tables.get('cutscene_step');
  if (!steps) return;
  const cutscenes = stepsOf(input, steps);
  checkSteps(input, steps, cutscenes);
  checkChoices(input, input.data.tables.get('cutscene_choice'), steps, cutscenes);
};
