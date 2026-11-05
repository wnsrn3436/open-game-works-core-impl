/** The data check of `InputCore` (`src/checks/InputCore.ts`). */
import { describe, expect, test } from 'vitest';
import { enums, fixture, lines, run, specModule, specTable, table } from './helpers.ts';

const COLUMNS = ['id|id(key)|All', 'family|enum<InputPromptFamily>|Client', 'input|string|Client', 'icon|reskey?|Client', 'name|tstring<id>|Client'];
const FAMILIES = ['Touch', 'KeyboardMouse', 'Generic', 'Xbox', 'PlayStation', 'Nintendo'];

const INPUT_CORE = specModule({
  name: 'InputCore',
  tables: [specTable('input_prompt', COLUMNS)],
  enums: [{ type: 'InputPromptFamily', elements: FAMILIES }],
});

function check(rows: [string, string][], modules = ['InputCore']): ReturnType<typeof run> {
  const cells = rows.map(([family, input], i) => [`[prompt_${String(i)}]`, family, input, 'null', `Prompt ${String(i)}`]);
  const glossary = ['source,id_name,note,source_hash', ...rows.map((_, i) => `Prompt ${String(i)},[prompt_${String(i)}],,`)].join('\n') + '\n';
  return run(fixture({
    files: {
      'data/tables/input_prompt.csv': table(COLUMNS, cells),
      'data/enums.csv': enums(FAMILIES.map((element, i) => ['InputPromptFamily', element, i + 1] as [string, string, number])),
      'data/glossary.csv': glossary,
    },
    settings: { sourceLanguage: 'en', supportedLanguages: ['en'] },
    coreSpec: { version: '0.0.0', modules: [INPUT_CORE] },
    modules,
  }));
}

/** Rows of `Touch` inputs with these `name` source texts, and a `ko` translation file of these texts by row index. */
function checkNames(names: string[], ko: Map<number, string>, modules = ['InputCore']): ReturnType<typeof run> {
  const cells = names.map((name, i) => [`[prompt_${String(i)}]`, 'Touch', `action_${String(i)}`, 'null', name]);
  const glossary = ['source,id_name,note,source_hash,ko', ...names.map((name, i) => `${name},[prompt_${String(i)}],,,${name}`)].join('\n') + '\n';
  const translations = ['key,source,source_hash,current_hash,text',
    ...[...ko].map(([i, text]) => `input_prompt.name.[prompt_${String(i)}],${names[i] ?? ''},h,h,${text}`)].join('\n') + '\n';
  return run(fixture({
    files: {
      'data/tables/input_prompt.csv': table(COLUMNS, cells),
      'data/enums.csv': enums(FAMILIES.map((element, i) => ['InputPromptFamily', element, i + 1] as [string, string, number])),
      'data/glossary.csv': glossary,
      'data/translations/ko.csv': translations,
    },
    settings: { sourceLanguage: 'en', supportedLanguages: ['en', 'ko'] },
    coreSpec: { version: '0.0.0', modules: [INPUT_CORE] },
    modules,
  }));
}

/** `translation_format` lines of the InputCore check, without the lines of the common format check. */
function promptNameLines(r: ReturnType<typeof run>): string[] {
  return lines(r, 'translation_format').filter((l) => l.includes('input_prompt name has an input prompt token'));
}

describe('InputCore data check', () => {
  test('valid rows pass', () => {
    const r = check([['Touch', 'jump'], ['KeyboardMouse', 'Space'], ['KeyboardMouse', 'mouse_left'], ['Generic', 'a'], ['Xbox', 'left_x-'],
      ['PlayStation', 'trigger_right+'], ['Nintendo', 'dpad_up'], ['Generic', 'start']]);
    expect(lines(r, 'duplicate')).toEqual([]);
    expect(lines(r, 'value_type')).toEqual([]);
    expect(lines(r, 'empty_required')).toEqual([]);
  });

  test('two rows of the same family and input are duplicate', () => {
    const r = check([['Generic', 'a'], ['Xbox', 'a'], ['Generic', 'a']]);
    expect(lines(r, 'duplicate')).toEqual([
      'data/tables/input_prompt.csv:7:3 ERROR duplicate input_prompt family Generic and input "a" are in another row',
    ]);
    expect(r.code).toBe(1);
  });

  test('an empty input is empty_required', () => {
    const r = check([['Touch', '']]);
    expect(lines(r, 'empty_required')).toEqual(['data/tables/input_prompt.csv:5:3 ERROR empty_required input_prompt.input is empty']);
    expect(lines(r, 'value_type')).toEqual([]);
  });

  test('a Touch input that is not snake_case is value_type', () => {
    const r = check([['Touch', 'Jump']]);
    expect(lines(r, 'value_type')).toEqual([
      'data/tables/input_prompt.csv:5:3 ERROR value_type input_prompt.input "Jump" of family Touch is not snake_case',
    ]);
  });

  test('a gamepad family input that is not a gamepad button or axis direction name is value_type', () => {
    const r = check([['Generic', 'Space'], ['Xbox', 'left_x'], ['PlayStation', 'trigger_left-'], ['Nintendo', 'mouse_left']]);
    expect(lines(r, 'value_type')).toEqual([
      'data/tables/input_prompt.csv:5:3 ERROR value_type input_prompt.input "Space" of family Generic is not a gamepad button or gamepad axis direction name',
      'data/tables/input_prompt.csv:6:3 ERROR value_type input_prompt.input "left_x" of family Xbox is not a gamepad button or gamepad axis direction name',
      'data/tables/input_prompt.csv:7:3 ERROR value_type input_prompt.input "trigger_left-" of family PlayStation is not a gamepad button or gamepad axis direction name',
      'data/tables/input_prompt.csv:8:3 ERROR value_type input_prompt.input "mouse_left" of family Nintendo is not a gamepad button or gamepad axis direction name',
    ]);
  });

  test('the check does not run when InputCore is not in --modules', () => {
    const r = check([['Touch', 'Jump'], ['Generic', 'a'], ['Generic', 'a']], []);
    expect(lines(r, 'value_type')).toEqual([]);
    expect(lines(r, 'duplicate')).toEqual([]);
  });

  test('a name text of any language with an input prompt token is translation_format', () => {
    const r = checkNames(['Jump', 'Press {action:jump}', 'Fire'], new Map([[0, '점프'], [1, '{action:jump} 누르기'], [2, '{action:fire} 발사']]));
    expect(promptNameLines(r)).toEqual([
      'data/tables/input_prompt.csv:6:5 ERROR translation_format input_prompt.name.[prompt_1]: an input_prompt name has an input prompt token',
      'data/translations/ko.csv:3:5 ERROR translation_format input_prompt.name.[prompt_1]: the ko input_prompt name has an input prompt token',
      'data/translations/ko.csv:4:5 ERROR translation_format input_prompt.name.[prompt_2]: the ko input_prompt name has an input prompt token',
    ]);
    expect(r.code).toBe(1);
  });

  test('a name with braces that are not an input prompt token passes the input prompt token rule', () => {
    const r = checkNames(['Jump {count}', 'Hold {action}'], new Map([[0, '점프 {count}']]));
    expect(promptNameLines(r)).toEqual([]);
  });

  test('the name rule does not run when InputCore is not in --modules', () => {
    const r = checkNames(['Press {action:jump}'], new Map([[0, '{action:jump} 누르기']]), []);
    expect(promptNameLines(r)).toEqual([]);
  });
});
