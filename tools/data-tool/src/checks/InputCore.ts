/**
 * Data checks of `InputCore` `## data`: the `input_prompt` rows. A `KeyboardMouse` row's `input` must be an engine key
 * name or a mouse button name; engine key names are engine-specific, so the static check `action reference` checks it.
 * A `name` text of any language has no input prompt token.
 */
import { tokensOf } from '../format.ts';
import type { ModuleCheck, ModuleCheckInput } from '../module-check.ts';
import { cellPlace, cellText, column, flatPlace, flatText, type Table } from '../model.ts';
import { keyPart, translationKey } from '../translation.ts';
import { isSnakeCase } from '../types.ts';

/** Gamepad button names (`InputCore` `### action`). */
const PAD_BUTTONS: ReadonlySet<string> = new Set([
  'a', 'b', 'x', 'y', 'back', 'guide', 'start', 'left_stick', 'right_stick', 'left_shoulder', 'right_shoulder',
  'dpad_up', 'dpad_down', 'dpad_left', 'dpad_right',
]);

/** Gamepad axis direction names: an axis name and `-` or `+`; the triggers have `+` only. */
const PAD_AXIS_DIRECTIONS: ReadonlySet<string> = new Set([
  ...['left_x', 'left_y', 'right_x', 'right_y'].flatMap((axis) => [`${axis}-`, `${axis}+`]),
  'trigger_left+', 'trigger_right+',
]);

/** Prompt families of gamepads. */
const GAMEPAD_FAMILIES: ReadonlySet<string> = new Set(['Generic', 'Xbox', 'PlayStation', 'Nintendo']);

/** The reason a `family` `input` pair is not a prompt input name of that family, or undefined when it is one. */
function inputNameError(family: string, name: string): string | undefined {
  if (family === 'Touch' && !isSnakeCase(name)) return `input_prompt.input ${JSON.stringify(name)} of family Touch is not snake_case`;
  if (GAMEPAD_FAMILIES.has(family) && !PAD_BUTTONS.has(name) && !PAD_AXIS_DIRECTIONS.has(name)) {
    return `input_prompt.input ${JSON.stringify(name)} of family ${family} is not a gamepad button or gamepad axis direction name`;
  }
  return undefined;
}

/** Whether a text has an input prompt token. */
function hasPromptToken(text: string): boolean {
  return tokensOf(text).some((t) => t.kind === 'prompt');
}

/**
 * `translation_format` for each `name` text with an input prompt token: the source text, and the translation of every
 * other language (the file of the source language holds the source text again).
 */
function checkNames(input: ModuleCheckInput, table: Table): void {
  const name = column(table, 'name');
  const type = name?.type;
  if (!name || type?.k !== 'tstring') return;
  const keys = new Set<string>();
  for (const row of table.rows) {
    const source = cellText(row, name);
    if (source === '') continue;
    const key = translationKey(table.name, name.name, type.keyCols.map((c) => keyPart(table, row, c)));
    keys.add(key);
    if (hasPromptToken(source)) input.report('translation_format', cellPlace(table, row, name), `${key}: an input_prompt name has an input prompt token`);
  }
  const sourceLanguage = input.settings.sourceLanguage;
  for (const [lang, file] of input.data.translations) {
    if (!file || lang === sourceLanguage) continue;
    for (const record of file.records) {
      const key = flatText(record, 'key');
      if (keys.has(key) && hasPromptToken(flatText(record, 'text'))) {
        input.report('translation_format', flatPlace(file, record, 'text'), `${key}: the ${lang} input_prompt name has an input prompt token`);
      }
    }
  }
}

export const check: ModuleCheck = (input) => {
  const table = input.data.tables.get('input_prompt');
  if (!table) return;
  checkNames(input, table);
  const text = column(table, 'input');
  if (!text || !column(table, 'family')) return;
  const seen = new Set<string>();
  for (const row of table.rows) {
    const familyValue = row.values.get('family');
    const inputValue = row.values.get('input');
    if (familyValue?.k !== 'enum' || inputValue?.k !== 'text') continue;
    const place = cellPlace(table, row, text);
    const name = inputValue.v;
    if (name === '') {
      input.report('empty_required', place, 'input_prompt.input is empty');
      continue;
    }
    const key = `${familyValue.element}\u0000${name}`;
    if (seen.has(key)) input.report('duplicate', place, `input_prompt family ${familyValue.element} and input ${JSON.stringify(name)} are in another row`);
    seen.add(key);
    const error = inputNameError(familyValue.element, name);
    if (error !== undefined) input.report('value_type', place, error);
  }
};
