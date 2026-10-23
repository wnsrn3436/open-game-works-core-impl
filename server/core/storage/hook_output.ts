import type { FailureCode, Pass } from './core.ts';

/** The smallest `GameError` value (`storage` `## API`). */
const GAME_ERROR_MIN = 1000;

/**
 * The output of a `pass`-or-`GameError` content hook: `pass`, or a safe integer `number` of 1000 and up as the
 * `GameError`. Any other output is a wrong output form and throws with the hook name.
 */
export function check_hook_output(hook: string, output: unknown): Pass | FailureCode {
  if (output === 'pass') return 'pass';
  if (typeof output === 'number' && Number.isSafeInteger(output) && output >= GAME_ERROR_MIN) return output;
  const shown = typeof output === 'string' ? JSON.stringify(output) : typeof output === 'number' ? String(output) : output === null ? 'null' : typeof output;
  throw new TypeError(`hook ${hook} returned ${shown}, not pass or a GameError`);
}
