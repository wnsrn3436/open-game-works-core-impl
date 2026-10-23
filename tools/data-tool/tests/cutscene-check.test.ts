/** The data check of `CutsceneCore` (`src/checks/CutsceneCore.ts`). */
import { describe, expect, test } from 'vitest';
import { enums, fixture, run, specModule, specTable, table } from './helpers.ts';

const STEP_COLUMNS = [
  'id|id|All', 'step|int|Client', 'command|enum<CutsceneCommand>|Client', 'wait|bool|Client', 'actor|string|Client',
  'target|string|Client', 'speaker|ref<cutscene_speaker.id>?|Client', 'text|tstring<id,step>|Client', 'resource|reskey?|Client',
  'animation|string|Client', 'duration|duration?|Client', 'cue|enum<CutsceneCue>?|Client', 'next_step|int?|Client',
  'voice|reskey?|Client', 'requirement|requirement<id,step>|Client',
];
const CHOICE_COLUMNS = [
  'id|id|All', 'step|int|Client', 'choice|int|Client', 'text|tstring<id,step,choice>|Client', 'next_step|int|Client',
  'requirement|requirement<id,step,choice>|Client', 'hide_locked|bool|Client',
];
const SPEAKER_COLUMNS = ['id|id(key)|All', 'name|tstring<id>|Client'];
const COMMANDS = ['Line', 'Choice', 'Wait', 'Move', 'Animate', 'Camera', 'Sound', 'Bgm', 'ScreenEffect', 'Staging', 'Cue', 'Jump', 'End', 'Branch'];

const CUTSCENE_CORE = specModule({
  name: 'CutsceneCore',
  side: 'client',
  tables: [specTable('cutscene_step', STEP_COLUMNS), specTable('cutscene_choice', CHOICE_COLUMNS), specTable('cutscene_speaker', SPEAKER_COLUMNS)],
  enums: [{ type: 'CutsceneCommand', elements: COMMANDS }],
});

/** A `cutscene_step` row: the cells by column name; the other cells are the empty values. */
interface Step {
  id?: string;
  step: string;
  command: string;
  wait?: string;
  actor?: string;
  target?: string;
  text?: string;
  resource?: string;
  animation?: string;
  duration?: string;
  cue?: string;
  next_step?: string;
  voice?: string;
  requirement?: string;
}

function stepRow(s: Step): string[] {
  return [
    s.id ?? '[cut_a]', s.step, s.command, s.wait ?? 'false', s.actor ?? '', s.target ?? '', 'null', s.text ?? '',
    s.resource ?? 'null', s.animation ?? '', s.duration ?? 'null', s.cue ?? 'null', s.next_step ?? 'null', s.voice ?? 'null',
    s.requirement ?? '',
  ];
}

/** A `cutscene_choice` row: id, step, choice, next_step, requirement. */
type Choice = [string, string, string, string, string];

function check(steps: Step[], choices: Choice[] = [], modules = ['CutsceneCore']): ReturnType<typeof run> {
  return run(fixture({
    files: {
      'data/tables/cutscene_step.csv': table(STEP_COLUMNS, steps.map(stepRow)),
      'data/tables/cutscene_choice.csv': table(CHOICE_COLUMNS, choices.map(([id, step, choice, next, requirement]) => [id, step, choice, `Choice ${choice}`, next, requirement, 'false'])),
      'data/tables/cutscene_speaker.csv': table(SPEAKER_COLUMNS),
      'data/enums.csv': enums([
        ...COMMANDS.map((element, i) => ['CutsceneCommand', element, i + 1] as [string, string, number]),
        ['CutsceneCue', 'Shake', 1], ['RequirementType', 'Flag', 1],
      ]),
      'data/requirement_types.csv': 'element,target,value,#comment\nFlag,none,false,\n',
    },
    settings: { sourceLanguage: 'en', supportedLanguages: ['en'] },
    coreSpec: { version: '0.0.0', modules: [CUTSCENE_CORE] },
    modules,
  }));
}

const CODES = ['out_of_range', 'duplicate', 'ref_missing', 'required_missing', 'empty_required', 'value_type'];

/** The result lines of the codes of the check, in output order. */
function cutsceneLines(r: ReturnType<typeof run>): string[] {
  return r.stdout.filter((l) => CODES.includes(l.split(' ')[2] ?? ''));
}

/** A valid cutscene that uses every command. */
const VALID: Step[] = [
  { step: '1', command: 'Line', text: 'Hello', voice: 'voice/cut_a_1' },
  { step: '2', command: 'Line', text: 'Hi', resource: 'image/portrait_a' },
  { step: '3', command: 'Move', wait: 'true', actor: 'hero', target: 'spot_a', resource: 'tween/move' },
  { step: '4', command: 'Animate', actor: 'hero', animation: 'wave' },
  { step: '5', command: 'Camera', target: 'spot_a', resource: 'tween/camera' },
  { step: '6', command: 'ScreenEffect', resource: 'tween/fade' },
  { step: '7', command: 'Staging', resource: 'prefab/sparkle' },
  { step: '8', command: 'Staging', actor: 'hero', resource: 'prefab/sparkle' },
  { step: '9', command: 'Sound', resource: 'sfx/boom' },
  { step: '10', command: 'Bgm', resource: 'bgm/theme' },
  { step: '11', command: 'Bgm' },
  { step: '12', command: 'Wait', duration: '500ms' },
  { step: '13', command: 'Cue', cue: 'Shake' },
  { step: '14', command: 'Branch', next_step: '16', requirement: 'Flag()' },
  { step: '15', command: 'Jump', next_step: '17' },
  { step: '16', command: 'Choice' },
  { step: '17', command: 'End' },
];
const VALID_CHOICES: Choice[] = [['[cut_a]', '16', '1', '17', ''], ['[cut_a]', '16', '2', '1', 'Flag()']];

describe('CutsceneCore data check', () => {
  test('a valid cutscene passes', () => {
    const r = check(VALID, VALID_CHOICES);
    expect(cutsceneLines(r)).toEqual([]);
  });

  test('a step below 1 is out_of_range and a step twice in a cutscene is duplicate', () => {
    const r = check([
      { step: '0', command: 'End' }, { step: '1', command: 'End' }, { step: '1', command: 'End' },
      { id: '[cut_b]', step: '1', command: 'End' },
    ]);
    expect(cutsceneLines(r)).toEqual([
      'data/tables/cutscene_step.csv:5:2 ERROR out_of_range cutscene_step [cut_a] step 0 is less than 1',
      'data/tables/cutscene_step.csv:7:2 ERROR duplicate cutscene_step [cut_a] step 1 is in another row of the cutscene',
    ]);
    expect(r.code).toBe(1);
  });

  test('a next_step that is not a step of the cutscene is ref_missing, in cutscene_step and cutscene_choice', () => {
    const r = check([
      { step: '1', command: 'Jump', next_step: '3' }, { step: '2', command: 'Choice' },
      { id: '[cut_b]', step: '3', command: 'End' },
    ], [['[cut_a]', '2', '1', '9', '']]);
    expect(cutsceneLines(r)).toEqual([
      'data/tables/cutscene_choice.csv:5:5 ERROR ref_missing cutscene_choice [cut_a] step 2: next_step 9 is not a step of the cutscene',
      'data/tables/cutscene_step.csv:5:13 ERROR ref_missing cutscene_step [cut_a] step 1: next_step 3 is not a step of the cutscene',
    ]);
  });

  test('a next_step of Jump or Branch that is not after its step is out_of_range', () => {
    const r = check([
      { step: '1', command: 'End' }, { step: '2', command: 'Jump', next_step: '2' },
      { step: '3', command: 'Branch', next_step: '1', requirement: 'Flag()' },
    ]);
    expect(cutsceneLines(r)).toEqual([
      'data/tables/cutscene_step.csv:6:13 ERROR out_of_range cutscene_step [cut_a] step 2: next_step 2 of Jump is not after the step',
      'data/tables/cutscene_step.csv:7:13 ERROR out_of_range cutscene_step [cut_a] step 3: next_step 1 of Branch is not after the step',
    ]);
  });

  test('a Choice without a cutscene_choice row that has no requirement is required_missing', () => {
    const r = check([
      { step: '1', command: 'Choice' }, { step: '2', command: 'Choice' }, { step: '3', command: 'End' },
    ], [['[cut_a]', '1', '1', '3', 'Flag()'], ['[cut_a]', '2', '1', '3', '']]);
    expect(cutsceneLines(r)).toEqual([
      'data/tables/cutscene_step.csv:5:1 ERROR required_missing cutscene_step [cut_a] step 1: the Choice has no cutscene_choice row without a requirement',
    ]);
  });

  test('cutscene_choice rows: the same choice twice is duplicate, no step row is ref_missing, a step that is not Choice is out_of_range', () => {
    const r = check([
      { step: '1', command: 'Choice' }, { step: '2', command: 'End' },
    ], [
      ['[cut_a]', '1', '1', '2', ''], ['[cut_a]', '1', '1', '2', ''], ['[cut_a]', '5', '1', '2', ''], ['[cut_a]', '2', '1', '2', ''],
    ]);
    expect(cutsceneLines(r)).toEqual([
      'data/tables/cutscene_choice.csv:6:3 ERROR duplicate cutscene_choice [cut_a] step 1 choice 1 is in another row',
      'data/tables/cutscene_choice.csv:7:2 ERROR ref_missing cutscene_choice [cut_a] step 5 has no cutscene_step row',
      'data/tables/cutscene_choice.csv:8:2 ERROR out_of_range cutscene_choice [cut_a] step 2: the cutscene_step command is not Choice',
    ]);
  });

  test('a column the command does not use is out_of_range when it is not empty', () => {
    const r = check([
      { step: '1', command: 'Line', text: 'Hello', wait: 'true', animation: 'wave' },
      { step: '2', command: 'Sound', resource: 'sfx/boom', duration: '0ms', voice: 'voice/x' },
      { step: '3', command: 'End', cue: 'Shake', requirement: 'Flag()', target: 'spot' },
    ]);
    expect(cutsceneLines(r)).toEqual([
      'data/tables/cutscene_step.csv:5:4 ERROR out_of_range cutscene_step [cut_a] step 1: Line does not use wait, which is not empty',
      'data/tables/cutscene_step.csv:5:10 ERROR out_of_range cutscene_step [cut_a] step 1: Line does not use animation, which is not empty',
      'data/tables/cutscene_step.csv:6:11 ERROR out_of_range cutscene_step [cut_a] step 2: Sound does not use duration, which is not empty',
      'data/tables/cutscene_step.csv:6:14 ERROR out_of_range cutscene_step [cut_a] step 2: Sound does not use voice, which is not empty',
      'data/tables/cutscene_step.csv:7:6 ERROR out_of_range cutscene_step [cut_a] step 3: End does not use target, which is not empty',
      'data/tables/cutscene_step.csv:7:12 ERROR out_of_range cutscene_step [cut_a] step 3: End does not use cue, which is not empty',
      'data/tables/cutscene_step.csv:7:15 ERROR out_of_range cutscene_step [cut_a] step 3: End does not use requirement, which is not empty',
    ]);
  });

  test('an empty column the command uses is empty_required unless it is wait or may be empty', () => {
    const r = check([
      { step: '1', command: 'Line' },
      { step: '2', command: 'Move', actor: 'hero' },
      { step: '3', command: 'Animate' },
      { step: '4', command: 'Wait' },
      { step: '5', command: 'Cue' },
      { step: '6', command: 'Branch' },
      { step: '7', command: 'Staging', resource: 'prefab/sparkle' },
      { step: '8', command: 'Bgm' },
    ]);
    expect(cutsceneLines(r)).toEqual([
      'data/tables/cutscene_step.csv:5:8 ERROR empty_required cutscene_step [cut_a] step 1: text of Line is empty',
      'data/tables/cutscene_step.csv:6:6 ERROR empty_required cutscene_step [cut_a] step 2: target of Move is empty',
      'data/tables/cutscene_step.csv:6:9 ERROR empty_required cutscene_step [cut_a] step 2: resource of Move is empty',
      'data/tables/cutscene_step.csv:7:5 ERROR empty_required cutscene_step [cut_a] step 3: actor of Animate is empty',
      'data/tables/cutscene_step.csv:7:10 ERROR empty_required cutscene_step [cut_a] step 3: animation of Animate is empty',
      'data/tables/cutscene_step.csv:8:11 ERROR empty_required cutscene_step [cut_a] step 4: duration of Wait is empty',
      'data/tables/cutscene_step.csv:9:12 ERROR empty_required cutscene_step [cut_a] step 5: cue of Cue is empty',
      'data/tables/cutscene_step.csv:10:13 ERROR empty_required cutscene_step [cut_a] step 6: next_step of Branch is empty',
      'data/tables/cutscene_step.csv:10:15 ERROR empty_required cutscene_step [cut_a] step 6: requirement of Branch is empty',
    ]);
  });

  test('an actor or target that is not snake_case is value_type', () => {
    const r = check([
      { step: '1', command: 'Move', actor: 'Hero', target: 'spot-a', resource: 'tween/move' },
      { step: '2', command: 'End' },
    ]);
    expect(cutsceneLines(r)).toEqual([
      'data/tables/cutscene_step.csv:5:5 ERROR value_type cutscene_step [cut_a] step 1: actor "Hero" is not snake_case',
      'data/tables/cutscene_step.csv:5:6 ERROR value_type cutscene_step [cut_a] step 1: target "spot-a" is not snake_case',
    ]);
  });

  test('the same voice in two cutscene_step rows is duplicate, also across cutscenes', () => {
    const r = check([
      { step: '1', command: 'Line', text: 'A', voice: 'voice/same' },
      { step: '2', command: 'Line', text: 'B' },
      { step: '3', command: 'Line', text: 'C' },
      { id: '[cut_b]', step: '1', command: 'Line', text: 'D', voice: 'voice/same' },
    ]);
    expect(cutsceneLines(r)).toEqual([
      'data/tables/cutscene_step.csv:8:14 ERROR duplicate cutscene_step voice voice/same is in another cutscene_step row',
    ]);
  });

  test('the check does not run when CutsceneCore is not in --modules', () => {
    const r = check([{ step: '0', command: 'Line' }, { step: '0', command: 'Jump', next_step: '9' }], [], []);
    expect(cutsceneLines(r)).toEqual([]);
  });
});
