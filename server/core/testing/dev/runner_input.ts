import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as GameContract from '../../../generated/contract/game_contract.ts';
import * as GameData from '../../../generated/data/game_data.ts';
import * as GameCheatContract from '../../../dev/generated/contract/game_cheat_contract.ts';
import type { RegisterFunction } from '../../routing/index.ts';

export type { RegisterFunction } from '../../routing/index.ts';

/** Settings values by core settings key and game settings path, as `server/generated/core_settings.json` holds them. */
export type SettingsValues = Readonly<Record<string, unknown>>;

/** The DB kinds of a test server. */
export type DbKind = 'sqlite' | 'postgresql';

/** `server/` of the checkout this file is in: the game's `server/` or the core's `server/`. */
export const SERVER_ROOT = fileURLToPath(new URL('../../../', import.meta.url));

/** The checkout root: the game repo root, or the core repo root for a server core test. */
const CHECKOUT_ROOT = join(SERVER_ROOT, '..');

function env(name: string): string | null {
  const value = process.env[name];
  return value === undefined || value === '' ? null : value;
}

/** The inputs the test runner gives as environment variables (`### test run`). Only the test helper reads them. */
export const runner = {
  server_modules_file: (): string | null => env('OGW_SERVER_MODULES'),
  server_data: (): string | null => env('OGW_SERVER_DATA'),
  shared_fixtures: (): string | null => env('OGW_SHARED_FIXTURES'),
  core_fixtures: (): string | null => env('OGW_CORE_FIXTURES'),
  postgresql: (): string | null => env('OGW_POSTGRESQL'),
  default_db: (): DbKind => {
    const value = env('OGW_DEFAULT_DB');
    if (value === 'sqlite' || value === 'postgresql') return value;
    throw new Error(`testing: OGW_DEFAULT_DB is ${JSON.stringify(value)}, not sqlite or postgresql`);
  },
  /** A server regression test gets the server module list; a server core test does not. */
  is_regression: (): boolean => env('OGW_SERVER_MODULES') !== null,
};

/** The server build data folder; a run without one throws. */
export function server_data_folder(): string {
  const folder = runner.server_data();
  if (folder === null || !existsSync(folder)) throw new Error(`testing: the server build data folder ${JSON.stringify(folder)} does not exist`);
  return folder;
}

function read_json(path: string): unknown {
  return JSON.parse(readFileSync(path, 'utf8')) as unknown;
}

function is_object(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * The server module list of a test server: the test runner's list, or every server core module of this checkout
 * for a server core test (`server-core` `## folder`: a module folder with its entry file).
 */
export function server_module_list(): string[] {
  const file = runner.server_modules_file();
  if (file !== null) {
    const list = read_json(file);
    if (!Array.isArray(list) || !list.every((m) => typeof m === 'string')) throw new Error(`testing: ${file} is not a JSON array of module names`);
    return list;
  }
  const core = join(SERVER_ROOT, 'core');
  return readdirSync(core, { withFileTypes: true })
    .filter((e) => e.isDirectory() && (existsSync(join(core, e.name, 'index.ts')) || existsSync(join(core, e.name, 'dev', 'index.ts'))))
    .map((e) => e.name)
    .sort();
}

/** The empty value of a spec settings type (`core` `## core settings`). */
function empty_value(type: string): unknown {
  if (type.endsWith('?')) return null;
  if (type === 'string') return '';
  if (type === 'integer' || type === 'number') return 0;
  if (type === 'boolean') return false;
  if (type === 'object') return {};
  return [];
}

function value_at(settings: unknown, path: string): unknown {
  let current = settings;
  for (const segment of path.split('.')) {
    if (!is_object(current)) return undefined;
    current = current[segment];
  }
  return current;
}

/**
 * The settings values of a server core test, which has no `server/generated/core_settings.json`: the core settings
 * file with the game settings values every module spec reads (`source` `game` rows of `core-spec/`) from the core
 * test data game settings. A missing game settings value is the empty value of its type.
 */
function core_test_settings(): Record<string, unknown> {
  const core = read_json(join(CHECKOUT_ROOT, 'settings', 'core-settings.json'));
  const game = read_json(join(CHECKOUT_ROOT, 'test-data', 'settings.json'));
  if (!is_object(core) || !is_object(game)) throw new Error('testing: the core settings file or the core test data game settings is not a JSON object');
  const environments = is_object(game.environments) ? Object.keys(game.environments) : [];
  const values: Record<string, unknown> = { ...core };
  for (const row of game_setting_rows()) {
    const paths = row.key.includes('<ENV>') ? environments.map((e) => row.key.replaceAll('<ENV>', e)) : [row.key];
    for (const path of paths) {
      if (path in values) continue;
      const given = value_at(game, path);
      values[path] = given === undefined ? empty_value(row.type) : given;
    }
  }
  return values;
}

/** The settings rows of every module of `core-spec/`, in module file order; none when the checkout has no `core-spec/`. */
function setting_rows(): { key: string; type: string; source: string }[] {
  const spec_dir = join(CHECKOUT_ROOT, 'core-spec');
  if (!existsSync(spec_dir)) return [];
  const rows: { key: string; type: string; source: string }[] = [];
  for (const file of readdirSync(spec_dir).filter((f) => f.endsWith('.json')).sort()) {
    const spec = read_json(join(spec_dir, file));
    for (const row of is_object(spec) && Array.isArray(spec.settings) ? (spec.settings as unknown[]) : []) {
      if (is_object(row) && typeof row.key === 'string' && typeof row.type === 'string' && typeof row.source === 'string') rows.push({ key: row.key, type: row.type, source: row.source });
    }
  }
  return rows;
}

/** The `source` `game` settings rows of every module of `core-spec/`, in module file order. */
function game_setting_rows(): { key: string; type: string }[] {
  return setting_rows().filter((row) => row.source === 'game');
}

/**
 * The merged core settings and the game settings values core reads: `server/generated/core_settings.json` of a
 * game, or for a server core test the values made from the core settings file and the core test data.
 */
export function base_settings(): Record<string, unknown> {
  const generated = join(SERVER_ROOT, 'generated', 'core_settings.json');
  if (existsSync(generated)) {
    const values = read_json(generated);
    if (!is_object(values)) throw new Error(`testing: ${generated} is not a JSON object`);
    return { ...values };
  }
  return core_test_settings();
}

/** An integer core settings value of `testing`. */
export function testing_setting(settings: SettingsValues, key: 'testing.maxFixtureBytes' | 'testing.backgroundWaitTimeoutMs' | 'testing.defaultStartAt'): bigint {
  const value = settings[key];
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) throw new Error(`testing: core settings ${key} is not an integer`);
  return BigInt(value);
}

async function content_function(file: string, name: string): Promise<RegisterFunction> {
  if (!existsSync(file)) throw new Error(`testing: ${file} does not exist`);
  const module = (await import(new URL(`file://${file}`).href)) as Record<string, unknown>;
  const fn = module[name];
  if (typeof fn !== 'function') throw new Error(`testing: ${file} does not export ${name}`);
  return fn as RegisterFunction;
}

interface CoreRegistration {
  routing: {
    register_handler(name: string, handler: (...args: never[]) => unknown): void;
    register_hook(module: string, hook: string, hook_function: (...args: never[]) => unknown): void;
  };
  validation?: { register_requirement_judge(type: GameData.RequirementType, judge: () => boolean): void };
  cheat?: { register_cheat_handler(name: string, handler: (...args: never[]) => unknown): void };
}

/**
 * The judge hook of `validation` that a server core test registers for every `RequirementType` element of the server
 * build data: it returns `false`. Nothing is registered when `validation` is not in the server module list.
 */
export function register_false_judges(core: Readonly<Record<string, unknown>>): void {
  const validation = (core as unknown as CoreRegistration).validation;
  if (validation === undefined) return;
  for (const type of Object.values(GameData.RequirementType)) {
    if (type !== GameData.RequirementType.None) validation.register_requirement_judge(type, () => false);
  }
}

/**
 * The hooks a server start requires by data rows, with what a server core test without a game registers for them:
 * module, hook, hook function.
 */
const REQUIRED_HOOKS: readonly (readonly [string, string, () => unknown])[] = [
  ['ads-reward', 'grant_ad_extra', () => 'pass'],
  ['attendance', 'grant_attendance_extra', () => 'pass'],
  ['iap', 'grant_iap_extra', () => 'pass'],
  ['mission', 'grant_mission_extra', () => 'pass'],
  ['shop', 'grant_shop_extra', () => 'pass'],
  ['play-session', 'continue_play_session', () => 'pass'],
  ['iap', 'revoke_iap', () => null],
  ['matchmaker', 'replay_match', () => 'reject'],
];

/**
 * The hooks of `REQUIRED_HOOKS` whose module is in the server module list, so that the data rows of the core test
 * data do not stop a test server. A server core test with its own `register` calls this too, leaving out the hooks
 * it registers itself.
 */
export function register_required_hooks(core: Readonly<Record<string, unknown>>, except: readonly string[] = []): void {
  const routing = (core as unknown as CoreRegistration).routing;
  for (const [module, hook, hook_function] of REQUIRED_HOOKS) {
    if (module in core && !except.includes(`${module}.${hook}`)) routing.register_hook(module, hook, hook_function);
  }
}

/**
 * The `register` of a server core test without a game: a handler that returns an empty response message for each
 * `service Game` `rpc` of the core test data not in `not_registered`, the judge hooks of `register_false_judges` and
 * the hooks of `register_required_hooks`. A server core test with its own `register` calls it with the names of the
 * `rpc` handlers it registers itself.
 */
export function core_test_register(core: Readonly<Record<string, unknown>>, not_registered: readonly string[] = []): void {
  const routing = (core as unknown as CoreRegistration).routing;
  for (const info of GameContract.RPCS) {
    if (!not_registered.includes(info.name)) routing.register_handler(info.name, () => new info.response_class());
  }
  register_false_judges(core);
  register_required_hooks(core);
}

/** The `registerDev` of a server core test: a cheat handler for each `service Cheat` `rpc` that returns an empty response. */
export const core_test_register_dev: RegisterFunction = (core) => {
  const cheat = (core as unknown as CoreRegistration).cheat;
  if (cheat === undefined) return;
  for (const info of GameCheatContract.RPCS) cheat.register_cheat_handler(info.name.slice('cheat/'.length), () => new info.response_class());
};

/**
 * The content registration functions of a test server that was not given them: the game's `server/main.ts`
 * `register` and `server/dev/main.ts` `registerDev` in a server regression test, `core_test_register` and
 * `core_test_register_dev` in a server core test.
 */
export async function default_register(): Promise<{ register: RegisterFunction; registerDev: RegisterFunction }> {
  if (!runner.is_regression()) return { register: core_test_register, registerDev: core_test_register_dev };
  return {
    register: await content_function(join(SERVER_ROOT, 'main.ts'), 'register'),
    registerDev: await content_function(join(SERVER_ROOT, 'dev', 'main.ts'), 'registerDev'),
  };
}

/** `client_data_version` of a server build data folder (`data` tool.md): one data version line. */
export function client_data_version(data_folder: string): string {
  return readFileSync(join(data_folder, 'client_data_version'), 'utf8').trim();
}
