/**
 * The test record (`### test run`): with `OGW_TEST_RECORD` given, one JSON object line per event appended to that
 * file. Each line goes in one append of the whole line, so the lines that test workers of one run write together do
 * not mix. Without `OGW_TEST_RECORD`, nothing is written.
 */
import { appendFileSync } from 'node:fs';
import * as GameContract from '../../../generated/contract/game_contract.ts';
import { runner } from './runner_input.ts';

/** One line of the test record. */
export type TestRecordLine =
  | { readonly kind: 'admin_operation'; readonly operation: string }
  | { readonly kind: 'admin'; readonly operation: string; readonly status: number }
  | { readonly kind: 'game_error'; readonly request: string; readonly error: string };

/** Appends one line to the test record of the run; none without `OGW_TEST_RECORD`. */
export function record(line: TestRecordLine): void {
  const file = runner.test_record();
  if (file === null) return;
  appendFileSync(file, `${JSON.stringify(line)}\n`, { flag: 'a' });
}

/** The member name of `GameContract.GameError` of each value. */
const GAME_ERROR_NAMES: ReadonlyMap<number, string> = new Map(Object.entries(GameContract.GameError).map(([name, value]) => [value as number, name]));

/** The values of `GameError` other than 0 are 1000 or more (`contract`); the others are `CoreError`. */
const GAME_ERROR_MIN = 1000;

/**
 * The `game_error` line of a response: when its error `code` is a `GameError` value other than 0, its member name, or
 * its decimal string when it has none.
 */
export function record_game_error(request: string, code: number | null): void {
  if (code === null || code < GAME_ERROR_MIN) return;
  record({ kind: 'game_error', request, error: GAME_ERROR_NAMES.get(code) ?? String(code) });
}
