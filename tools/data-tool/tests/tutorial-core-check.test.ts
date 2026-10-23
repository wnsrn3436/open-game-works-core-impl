/** The data check of `TutorialCore` (`src/checks/TutorialCore.ts`). */
import { describe, expect, test } from 'vitest';
import { enums, fixture, lines, run, specModule, specTable, table } from './helpers.ts';

const TUTORIAL = ['id|id(key)|All', 'order|int|Client', 'start_requirement|requirement|Client', 'skippable|bool|Client'];
const STEP = [
  'id|id|All', 'step|int|All', 'text|tstring<id,step>|Client', 'anchor|string|Client', 'anchor_key|int?|Client',
  'panel|reskey?|Client', 'popup|reskey?|Client', 'pointer|bool|Client', 'restrict_input|bool|Client',
  'complete|enum<TutorialComplete>|Client', 'complete_requirement|requirement<id,step>|Client', 'cue|enum<TutorialCue>?|Client',
  'save|bool|Client',
];
const COMPLETES = ['Advance', 'AnchorTap', 'Requirement', 'Cue'];

const TUTORIAL_CORE = specModule({
  name: 'TutorialCore',
  tables: [specTable('tutorial', TUTORIAL), specTable('tutorial_step', STEP)],
  enums: [{ type: 'TutorialComplete', elements: COMPLETES }],
});

/** A step row; `cells` overrides the cells of a plain `Advance` step by column name. */
interface StepCells {
  step: number;
  anchor?: string;
  anchor_key?: string;
  panel?: string;
  popup?: string;
  pointer?: string;
  restrict_input?: string;
  complete?: string;
  complete_requirement?: string;
  cue?: string;
  save?: string;
}

function stepRow(id: string, s: StepCells): string[] {
  return [
    id, String(s.step), `Step ${String(s.step)}`, s.anchor ?? '', s.anchor_key ?? 'null', s.panel ?? 'null', s.popup ?? 'null',
    s.pointer ?? 'false', s.restrict_input ?? 'false', s.complete ?? 'Advance', s.complete_requirement ?? '', s.cue ?? 'null',
    s.save ?? 'false',
  ];
}

function check(steps: StepCells[], modules = ['TutorialCore']): ReturnType<typeof run> {
  return run(fixture({
    files: {
      'data/tables/tutorial.csv': table(TUTORIAL, [['[tutorial_a]', '1', '', 'false']]),
      'data/tables/tutorial_step.csv': table(STEP, steps.map((s) => stepRow('[tutorial_a]', s))),
      'data/tables/item.csv': table(['id|id(key)|All'], [['[item_key]']]),
      'data/enums.csv': enums([
        ...COMPLETES.map((element, i) => ['TutorialComplete', element, i + 1] as [string, string, number]),
        ['TutorialCue', 'Opened', 1], ['RequirementType', 'FlagA', 1],
      ]),
      'data/requirement_types.csv': 'element,target,value,#comment\nFlagA,none,false,\n',
    },
    settings: { sourceLanguage: 'en', supportedLanguages: ['en'] },
    coreSpec: { version: '0.0.0', modules: [TUTORIAL_CORE] },
    modules,
  }));
}

/** The `empty_required` and `out_of_range` lines of the run. */
function faults(r: ReturnType<typeof run>): string[] {
  return [...lines(r, 'empty_required'), ...lines(r, 'out_of_range')];
}

describe('TutorialCore data check', () => {
  test('valid steps pass', () => {
    const r = check([
      { step: 1, anchor: 'start_button', pointer: 'true', restrict_input: 'true', complete: 'AnchorTap', save: 'true' },
      { step: 2, anchor: 'slot', anchor_key: '[item_key]', panel: 'prefab/panel/bag', complete: 'Advance' },
      { step: 3, anchor: 'ok_button', popup: 'prefab/popup/reward', restrict_input: 'true', complete: 'Advance' },
      { step: 4, complete: 'Requirement', complete_requirement: 'FlagA()' },
      { step: 5, complete: 'Cue', cue: 'Opened' },
    ]);
    expect(faults(r)).toEqual([]);
    expect(r.code).toBe(0);
  });

  test('pointer, restrict_input or AnchorTap without anchor is empty_required', () => {
    const r = check([
      { step: 1, pointer: 'true' },
      { step: 2, restrict_input: 'true' },
      { step: 3, complete: 'AnchorTap' },
    ]);
    expect(lines(r, 'empty_required')).toEqual([
      'data/tables/tutorial_step.csv:5:4 ERROR empty_required tutorial_step.anchor is empty while pointer or restrict_input is true or complete is AnchorTap',
      'data/tables/tutorial_step.csv:6:4 ERROR empty_required tutorial_step.anchor is empty while pointer or restrict_input is true or complete is AnchorTap',
      'data/tables/tutorial_step.csv:7:4 ERROR empty_required tutorial_step.anchor is empty while pointer or restrict_input is true or complete is AnchorTap',
    ]);
    expect(r.code).toBe(1);
  });

  test('Requirement without complete_requirement is empty_required', () => {
    const r = check([{ step: 1, complete: 'Requirement' }]);
    expect(lines(r, 'empty_required')).toEqual([
      'data/tables/tutorial_step.csv:5:11 ERROR empty_required tutorial_step.complete_requirement is empty while complete is Requirement',
    ]);
  });

  test('anchor_key below 1 is out_of_range and anchor_key without anchor is empty_required', () => {
    const r = check([
      { step: 1, anchor: 'slot', anchor_key: '-3' },
      { step: 2, anchor_key: '[item_key]' },
    ]);
    expect(lines(r, 'out_of_range')).toEqual([
      'data/tables/tutorial_step.csv:5:5 ERROR out_of_range tutorial_step.anchor_key -3 is below 1',
    ]);
    expect(lines(r, 'empty_required')).toEqual([
      'data/tables/tutorial_step.csv:6:4 ERROR empty_required tutorial_step.anchor is empty while anchor_key is not null',
    ]);
  });

  test('Cue with a null cue is empty_required', () => {
    const r = check([{ step: 1, complete: 'Cue' }]);
    expect(lines(r, 'empty_required')).toEqual([
      'data/tables/tutorial_step.csv:5:12 ERROR empty_required tutorial_step.cue is null while complete is Cue',
    ]);
  });

  test('panel and popup both not null is out_of_range', () => {
    const r = check([
      { step: 1, save: 'true' },
      { step: 2, anchor: 'ok', panel: 'prefab/panel/bag', popup: 'prefab/popup/reward', restrict_input: 'true' },
    ]);
    expect(lines(r, 'out_of_range')).toEqual([
      'data/tables/tutorial_step.csv:6:7 ERROR out_of_range tutorial_step.panel and tutorial_step.popup are both not null',
      'data/tables/tutorial_step.csv:6:7 ERROR out_of_range tutorial_step.popup is not null on a resume start step',
    ]);
  });

  test('popup with restrict_input false is out_of_range', () => {
    const r = check([
      { step: 1 },
      { step: 2, anchor: 'ok', popup: 'prefab/popup/reward' },
    ]);
    expect(lines(r, 'out_of_range')).toEqual([
      'data/tables/tutorial_step.csv:6:7 ERROR out_of_range tutorial_step.popup is not null while restrict_input is false',
    ]);
  });

  test('popup on the first step or on the step after a save step is out_of_range', () => {
    const r = check([
      { step: 1, anchor: 'ok', popup: 'prefab/popup/reward', restrict_input: 'true' },
      { step: 2, save: 'true' },
      { step: 3, anchor: 'ok', popup: 'prefab/popup/reward', restrict_input: 'true' },
      { step: 4, anchor: 'ok', popup: 'prefab/popup/reward', restrict_input: 'true' },
    ]);
    expect(lines(r, 'out_of_range')).toEqual([
      'data/tables/tutorial_step.csv:5:7 ERROR out_of_range tutorial_step.popup is not null on a resume start step',
      'data/tables/tutorial_step.csv:7:7 ERROR out_of_range tutorial_step.popup is not null on a resume start step',
    ]);
  });

  test('the check does not run when TutorialCore is not in --modules', () => {
    const r = check([{ step: 1, pointer: 'true' }, { step: 2, complete: 'Cue' }], []);
    expect(faults(r)).toEqual([]);
  });
});
