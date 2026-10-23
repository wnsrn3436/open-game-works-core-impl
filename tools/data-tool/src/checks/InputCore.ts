/**
 * Data checks of `InputCore` `## data`: the `input_prompt` rows. A `KeyboardMouse` row's `input` must be an engine key
 * name or a mouse button name; engine key names are engine-specific, so the static check `action reference` checks it.
 */
import type { ModuleCheck } from '../module-check.ts';
import { cellPlace, column } from '../model.ts';
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

export const check: ModuleCheck = (input) => {
  const table = input.data.tables.get('input_prompt');
  const text = table ? column(table, 'input') : undefined;
  if (!table || !text || !column(table, 'family')) return;
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
