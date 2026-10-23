import { lstatSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, isAbsolute, join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as GameData from '../../../generated/data/game_data.ts';
import * as GameDataDev from '../../../dev/generated/data/game_data_dev.ts';
import { base_settings, runner, server_data_folder, testing_setting } from './runner_input.ts';

/** This folder: stack frames in it are the test helper's own, not the calling test file's. */
const HELPER_DIR = dirname(fileURLToPath(import.meta.url));

function max_fixture_bytes(): number {
  return Number(testing_setting(base_settings(), 'testing.maxFixtureBytes'));
}

/** The file path of a stack frame line, or null. */
function frame_file(line: string): string | null {
  const match = /\(?((?:file:\/\/)?\/[^():]+):\d+:\d+\)?$/.exec(line.trim());
  if (match?.[1] === undefined) return null;
  const file = match[1];
  return file.startsWith('file://') ? fileURLToPath(file) : file;
}

/** The test file that called the test helper: the first stack frame outside the test helper and `node_modules`. */
function calling_file(): string {
  const stack = new Error().stack ?? '';
  for (const line of stack.split('\n').slice(1)) {
    const file = frame_file(line);
    if (file === null || file.startsWith(HELPER_DIR + sep) || file.split(sep).includes('node_modules')) continue;
    return file;
  }
  throw new Error('testing: read_fixture cannot find the calling test file');
}

/** Reads a regular file of at most `testing.maxFixtureBytes`; anything else throws. */
function read_limited(path: string, what: string): Uint8Array {
  const stat = statSync(path, { throwIfNoEntry: false });
  if (stat?.isFile() !== true) throw new Error(`testing: ${what} is not a regular file`);
  if (stat.size > max_fixture_bytes()) throw new Error(`testing: ${what} is larger than testing.maxFixtureBytes`);
  return new Uint8Array(readFileSync(path));
}

/**
 * `read_fixture`: the bytes of a regular file below `fixtures/` next to the calling test file. An absolute path,
 * a `..` segment, a symbolic link on the way, a target that is not a regular file and a file over
 * `testing.maxFixtureBytes` throw.
 */
export function read_fixture(relative_path: string): Uint8Array {
  if (relative_path === '' || isAbsolute(relative_path)) throw new Error(`testing: fixture path ${JSON.stringify(relative_path)} is not a relative path`);
  const segments = relative_path.split(/[\\/]/);
  if (segments.some((s) => s === '..' || s === '.' || s === '')) throw new Error(`testing: fixture path ${JSON.stringify(relative_path)} has a '..', '.' or empty segment`);
  let path = join(dirname(calling_file()), 'fixtures');
  for (const segment of ['', ...segments]) {
    path = segment === '' ? path : join(path, segment);
    const stat = lstatSync(path, { throwIfNoEntry: false });
    if (stat === undefined) throw new Error(`testing: fixture ${relative_path} does not exist`);
    if (stat.isSymbolicLink()) throw new Error(`testing: fixture path ${relative_path} goes through a symbolic link`);
  }
  return read_limited(path, `fixture ${relative_path}`);
}

const SHARED_NAME = /^[a-z0-9]+(?:_[a-z0-9]+)*(?:\.[a-z0-9]+(?:_[a-z0-9]+)*)*$/;
const CORE_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** `read_shared_fixture`: `<name>.json` of the shared fixture folder. `name` is snake_case parts joined by `.`. */
export function read_shared_fixture(name: string): Uint8Array {
  if (!SHARED_NAME.test(name)) throw new Error(`testing: shared fixture name ${JSON.stringify(name)} is not snake_case parts joined by '.'`);
  const folder = runner.shared_fixtures();
  if (folder === null) throw new Error('testing: this run has no shared fixture folder');
  return read_limited(join(folder, `${name}.json`), `shared fixture ${name}`);
}

/** `read_core_fixture`: `<name>.json` of the core fixture folder. `name` is kebab-case. */
export function read_core_fixture(name: string): Uint8Array {
  if (!CORE_NAME.test(name)) throw new Error(`testing: core fixture name ${JSON.stringify(name)} is not kebab-case`);
  const folder = runner.core_fixtures();
  if (folder === null) throw new Error('testing: this run has no core fixture folder');
  return read_limited(join(folder, `${name}.json`), `core fixture ${name}`);
}

/** What `load_data` gives: the container and accessors of the server build data, and the server DEV accessor. */
export interface LoadedData {
  readonly data: GameData.DataSet;
  readonly dev: { readonly find_id_value: (id_name: string) => number; readonly find_id_name: (id_value: number) => string };
}

/** `load_data`: the server build data folder the test runner gives, loaded by the generated load entry point. */
export function load_data(): LoadedData {
  const folder = server_data_folder();
  const files = new Map<string, Uint8Array>();
  for (const entry of readdirSync(folder, { withFileTypes: true })) {
    if (entry.isFile()) files.set(entry.name, new Uint8Array(readFileSync(join(folder, entry.name))));
  }
  const data = GameData.load_data_set(files);
  if (data === null) throw new Error(`testing: the server build data in ${folder} does not load`);
  return { data, dev: { find_id_value: GameDataDev.find_id_value, find_id_name: GameDataDev.find_id_name } };
}

/**
 * `non_integer_values`: values an integer field takes nothing of, as JSON texts so that `1.0` stays `1.0`:
 * `true`, `false`, `1.0`, `1.5`, `"1"`, `null`.
 */
export function non_integer_values(): readonly string[] {
  return ['true', 'false', '1.0', '1.5', '"1"', 'null'];
}
