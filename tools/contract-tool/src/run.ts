/** The contract tool run: arguments, checks before generation, generation. */
import { join } from 'node:path';
import { checkCompatibility, contractVersion } from './compat.ts';
import { Diagnostics, InputFailure } from './diagnostics.ts';
import { generateGodot, GODOT_DEV_DIR, GODOT_DIR } from './gen/godot.ts';
import { generateServer, SERVER_DEV_DIR, SERVER_DIR } from './gen/server.ts';
import { clientCoreTypeNames, gamePaths, loadBaseProto, loadContractVersion, loadDataProto, loadGameContract, loadJsonObject, loadModules, type LoadedFile } from './load.ts';
import { buildModel, type EnumDef, type MessageDef, type Model } from './model.ts';
import { upperSnake } from './names.ts';
import { replaceTargets } from './output.ts';
import { MODULE_MESSAGES, orderedKinds, type CheckContext } from './rules/context.ts';
import { checkFields } from './rules/fields.ts';
import { checkFiles } from './rules/files.ts';
import { checkGodotNames } from './rules/godot.ts';
import { checkKinds, checkModuleMessages } from './rules/kinds.ts';
import { checkNames } from './rules/names.ts';
import { checkRpcs } from './rules/rpcs.ts';
import { typeSets } from './typesets.ts';

export interface RunResult {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

interface Args {
  game: string | null;
  engine: string | null;
  baseProto: string | null;
  coreSettings: string | null;
  modules: string | null;
  previous: string | null;
  baseProtoOnly: boolean;
}

const VALUE_ARGS: Readonly<Record<string, keyof Args>> = {
  '--game': 'game', '--engine': 'engine', '--base-proto': 'baseProto', '--core-settings': 'coreSettings', '--modules': 'modules', '--previous': 'previous',
};

function parseArgs(argv: readonly string[]): Args {
  const args: Args = { game: null, engine: null, baseProto: null, coreSettings: null, modules: null, previous: null, baseProtoOnly: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i] ?? '';
    if (arg === '--base-proto-only') {
      args.baseProtoOnly = true;
      continue;
    }
    const key = VALUE_ARGS[arg];
    const value = argv[i + 1];
    if (key === undefined) throw new InputFailure(`unknown argument ${arg}`);
    if (value === undefined || value.startsWith('--')) throw new InputFailure(`${arg} needs a value`);
    if (args[key] !== null) throw new InputFailure(`${arg} is given twice`);
    (args as unknown as Record<string, string>)[key] = value;
    i += 1;
  }
  checkArgs(args);
  return args;
}

function checkArgs(args: Args): void {
  if (args.baseProto === null) throw new InputFailure('--base-proto is required');
  if (args.coreSettings === null) throw new InputFailure('--core-settings is required');
  if (!args.baseProtoOnly) {
    if (args.game === null) throw new InputFailure('--game is required');
    return;
  }
  if (args.previous === null) throw new InputFailure('--base-proto-only needs --previous');
  if (args.game !== null || args.engine !== null || args.modules !== null) throw new InputFailure('--base-proto-only takes only --base-proto, --core-settings and --previous');
}

function model(files: readonly LoadedFile[], settings: Readonly<Record<string, unknown>>, diagnostics: Diagnostics): Model {
  return buildModel({ files, settings }, diagnostics);
}

/** Previous build: base proto and, unless `baseOnly`, game contract. Any problem in it is an input failure. */
function previousModel(dir: string, baseOnly: boolean): Model {
  const diagnostics = new Diagnostics();
  const settings = loadJsonObject(join(dir, 'core-settings.json'), 'previous core settings');
  const base = loadBaseProto(join(dir, 'proto'), null);
  const game = baseOnly ? [] : loadGameContract(join(dir, 'contract'), join(dir, 'contract'), null);
  const built = model([...base, ...game], settings, diagnostics);
  if (diagnostics.count > 0) throw new InputFailure(`previous build ${dir} has problems:\n${diagnostics.lines().join('\n')}`);
  return built;
}

function baseProtoOnly(args: Args): RunResult {
  const diagnostics = new Diagnostics();
  const settings = loadJsonObject(args.coreSettings ?? '', '--core-settings');
  const previous = previousModel(args.previous ?? '', true);
  const current = model(loadBaseProto(args.baseProto ?? '', diagnostics), settings, diagnostics);
  checkCompatibility(previous, current, diagnostics, ['ogw.core']);
  return finish(diagnostics);
}

function finish(diagnostics: Diagnostics): RunResult {
  const lines = diagnostics.lines();
  return { code: lines.length > 0 ? 1 : 0, stdout: lines.map((l) => `${l}\n`).join(''), stderr: '' };
}

/** Adds the classes the generated code always has: module messages the game did not define, and `GameError`. */
function complete(built: Model): void {
  const game = built.types.game;
  for (const name of MODULE_MESSAGES) {
    if (game.has(name)) continue;
    const stub: MessageDef = { kind: 'message', pkg: 'game', name, file: null, node: null, fields: [], isPublic: false, converters: [], deprecated: false };
    game.set(name, stub);
  }
  if (!game.has('GameError')) {
    const pos = { file: '', line: 0, column: 0 };
    const stub: EnumDef = { kind: 'enum', pkg: 'game', name: 'GameError', file: null, node: null, values: [{ name: `${upperSnake('GameError')}_UNSPECIFIED`, number: 0, pos, deprecated: false }], deprecated: false };
    game.set('GameError', stub);
  }
}

/** (kind, from version) of `(ogw.converters)` in `GameContract.KINDS` order, then from version. */
function converters(built: Model): { kind: string; from_version: number }[] {
  return orderedKinds(built.types.game.values()).flatMap((k) => [...k.converters].sort((a, b) => (a.value < b.value ? -1 : 1)).map((c) => ({ kind: k.name, from_version: Number(c.value) })));
}

/** Engines with a client generation target. */
const ENGINES: ReadonlySet<string> = new Set(['godot']);

function gameRun(args: Args): RunResult {
  if (args.engine !== null && !ENGINES.has(args.engine)) throw new InputFailure(`the contract tool has no client generation target for engine ${args.engine}`);
  const gameDir = args.game ?? '';
  const { contractDir, outRoot, clientRoot } = gamePaths(gameDir, args.baseProto ?? '', args.engine);
  const settings = loadJsonObject(args.coreSettings ?? '', '--core-settings');
  const modules = args.modules === null ? null : loadModules(args.modules);
  const data = loadDataProto(join(outRoot, 'server', 'generated', 'data', 'game_data.proto'));
  const diagnostics = new Diagnostics();
  const base = loadBaseProto(args.baseProto ?? '', diagnostics);
  const game = loadGameContract(contractDir, 'contract', diagnostics);
  const built = model([...base, ...game], settings, diagnostics);
  const ctx: CheckContext = { model: built, diagnostics, tableNames: data.tableNames, dataNames: data.names, modules };
  checkFiles(ctx);
  checkNames(ctx);
  checkRpcs(ctx);
  checkFields(ctx);
  checkModuleMessages(ctx);
  if (clientRoot !== null) checkGodotNames(ctx, clientCoreTypeNames(clientRoot));
  let version = 1;
  if (args.previous !== null) {
    const previous = previousModel(args.previous, false);
    checkCompatibility(previous, built, diagnostics, ['ogw.core', 'game']);
    version = contractVersion({ model: previous, version: loadContractVersion(args.previous) }, built);
  }
  checkKinds(ctx, version);
  if (diagnostics.count > 0) return finish(diagnostics);
  complete(built);
  const files = generateServer({ model: built, sets: typeSets(built), tableNames: data.tableNames, contractVersion: version, converters: converters(built) });
  replaceTargets(outRoot, [SERVER_DIR, SERVER_DEV_DIR], files);
  if (clientRoot !== null) replaceTargets(clientRoot, [GODOT_DIR, GODOT_DEV_DIR], generateGodot({ model: built, sets: typeSets(built) }));
  return finish(diagnostics);
}

/** Runs the tool with command line arguments. Exit code 0 success, 1 violations, 2 argument or input file problems. */
export function runTool(argv: readonly string[]): RunResult {
  try {
    const args = parseArgs(argv);
    return args.baseProtoOnly ? baseProtoOnly(args) : gameRun(args);
  } catch (error) {
    if (error instanceof InputFailure) return { code: 2, stdout: '', stderr: `${error.message}\n` };
    // Exit code 1 always comes with violation lines, so a file system error (reading or writing) is also code 2.
    return { code: 2, stdout: '', stderr: `${error instanceof Error ? error.message : String(error)}\n` };
  }
}
