/** One run of the data tool (`data` tool.md `## CLI`, `## processing`). */
import { existsSync, readdirSync, readFileSync, realpathSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { build, genEnums, genTables } from './build.ts';
import { checkEnums, checkRequirementTypes } from './check-enums.ts';
import { checkInvariants } from './check-invariants.ts';
import { checkNames } from './check-names.ts';
import { checkCycles, checkMadeNames, checkReferences, checkSimulationTables, collectIds } from './check-refs.ts';
import { checkSchemas, checkValues, LANGUAGE_TAG } from './check-tables.ts';
import type { RunContext } from './context.ts';
import { insertCoreData, makeBannedWords } from './coredata.ts';
import { coreDataOf, readCoreSpec, REQUIREMENT_TABLE } from './corespec.ts';
import { changedFiles, readDataFolder, REQUIREMENT_TYPES_HEADER, writeChangedFiles } from './data.ts';
import { Diagnostics, filePlace } from './diag.ts';
import { checkFormats } from './format.ts';
import { readFlatFile } from './load.ts';
import { flatText } from './model.ts';
import { runModuleChecks } from './module-check.ts';
import { checkPrevious, readPrevious, type Previous } from './previous.ts';
import { protocolHash, protoText } from './proto.ts';
import { itemAmountFields, namesOf } from './protonames.ts';
import { OutputError, replaceFolders } from './output.ts';
import { branchStore, fileStore, REGISTRY_FILE, RegistryError, type Registry, type RegistryStore } from './registry.ts';
import { targetSchema, TARGETS, type Target } from './schema.ts';
import { isItemAmountList, parseColumnType } from './types.ts';
import { checkGlossaryNames, checkTranslationState, collectTexts, syncTranslations, textsByKey } from './translation.ts';

export interface Args {
  game: string;
  engine: string | null;
  baseProto: string;
  gameSettings: string;
  coreSpec: string;
  modules: string;
  binary: boolean;
  strict: boolean;
  previous: string | null;
  idRegistry: string | null;
}

export interface RunResult {
  code: 0 | 1 | 2;
  stdout: string[];
  stderr: string[];
}

class InputError extends Error {}

const VALUE_FLAGS = new Map<string, keyof Args>([
  ['--game', 'game'], ['--engine', 'engine'], ['--base-proto', 'baseProto'], ['--game-settings', 'gameSettings'],
  ['--core-spec', 'coreSpec'], ['--modules', 'modules'], ['--previous', 'previous'], ['--id-registry', 'idRegistry'],
]);

/** Parses the command line; a string is why it is wrong. */
export function parseArgs(argv: readonly string[]): Args | string {
  const out: Record<string, string | boolean | null> = { engine: null, previous: null, idRegistry: null, binary: false, strict: false };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i] as string;
    if (a === '--binary' || a === '--strict') {
      out[a.slice(2)] = true;
      continue;
    }
    const key = VALUE_FLAGS.get(a);
    const value = argv[i + 1];
    if (key === undefined) return `unknown argument ${a}`;
    if (value === undefined || value.startsWith('--')) return `${a} needs a value`;
    out[key] = value;
    i += 1;
  }
  for (const flag of ['game', 'baseProto', 'gameSettings', 'coreSpec', 'modules']) {
    if (typeof out[flag] !== 'string') return `--${flag.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)} is required`;
  }
  return out as unknown as Args;
}

function readJson(path: string, what: string): unknown {
  if (!existsSync(path)) throw new InputError(`${what} ${path} is not there`);
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as unknown;
  } catch {
    throw new InputError(`${what} ${path} is not JSON`);
  }
}

/**
 * The core test data folder: `test-data/` under the parent of the `--base-proto` folder. Its generation targets go
 * next to it.
 */
export function isCoreTestData(game: string, baseProto: string): boolean {
  return realpathSync(game) === join(dirname(realpathSync(baseProto)), 'test-data');
}

function readSettings(path: string): { settings: Record<string, unknown>; source: string; languages: string[] } {
  const json = readJson(path, '--game-settings');
  if (typeof json !== 'object' || json === null || Array.isArray(json)) throw new InputError('--game-settings is not a JSON object');
  const settings = json as Record<string, unknown>;
  const source = settings.sourceLanguage;
  const languages = settings.supportedLanguages;
  if (typeof source !== 'string') throw new InputError('game settings sourceLanguage is not a string');
  if (!Array.isArray(languages) || !languages.every((l) => typeof l === 'string')) throw new InputError('game settings supportedLanguages is not a list of language tags');
  // The tags name files under data/translations/ and records/setup/banned-words/, so only the BCP 47 form is let in.
  for (const tag of [source, ...languages]) {
    if (!LANGUAGE_TAG.test(tag)) throw new InputError(`game settings language tag ${JSON.stringify(tag)} is not a BCP 47 tag`);
  }
  return { settings, source, languages };
}

function readResources(game: string): Set<string> {
  const file = readFlatFile(game, 'resource/resources.csv', ['key'], new Diagnostics(false));
  return new Set((file?.records ?? []).map((r) => flatText(r, 'key')).filter((k) => k !== ''));
}

function checkBannedWordFiles(ctx: RunContext, modules: ReadonlySet<string>): void {
  if (!['nickname', 'guild', 'chat'].some((m) => modules.has(m))) return;
  for (const lang of ctx.languages) {
    const file = `records/setup/banned-words/${lang}.txt`;
    const path = join(ctx.data.root, file);
    const blank = !existsSync(path) || readFileSync(path, 'utf8').trim() === '';
    if (blank) ctx.diags.add('banned_word_missing', filePlace(file), `${lang} has no banned word list`);
  }
}

function runChecks(ctx: RunContext, modules: ReadonlySet<string>, previous: Previous | null): void {
  ctx.enums = checkEnums(ctx);
  ctx.requirementForms = checkRequirementTypes(ctx);
  checkSchemas(ctx);
  checkValues(ctx);
  collectIds(ctx);
  checkReferences(ctx);
  checkMadeNames(ctx);
  checkCycles(ctx);
  checkInvariants(ctx);
  checkSimulationTables(ctx);
  checkNames(ctx);
  const texts = textsByKey(collectTexts(ctx.data), ctx.diags);
  checkTranslationState(ctx.data, ctx.sourceLanguage, ctx.diags);
  checkGlossaryNames(ctx.data, ctx.diags);
  checkFormats(ctx.data, ctx.core, texts, ctx.sourceLanguage, ctx.diags);
  checkBannedWordFiles(ctx, modules);
  runModuleChecks(ctx, modules, previous?.data ?? null);
}

function protocolsOf(ctx: RunContext): Record<Target, string> {
  const tables = genTables(ctx);
  const enums = genEnums(ctx, tables);
  const out = {} as Record<Target, string>;
  for (const t of TARGETS) out[t] = protocolHash(new Map([['game_data.proto', protoText(targetSchema(t, tables, enums))]]));
  return out;
}

/**
 * Writes the generation target folders of the server folder and, with an engine, of the client folder, all or
 * nothing; OutputError when they were not written.
 */
function writeOutputs(roots: readonly { root: string; files: ReadonlyMap<string, Uint8Array | string> }[], commitFiles: boolean): void {
  const folders = commitFiles ? ['generated/data', 'dev/generated/data', 'build/data'] : ['build/data'];
  replaceFolders(roots.flatMap(({ root, files }) => folders.map((folder) => ({
    dir: join(root, folder),
    files: new Map([...files].filter(([p]) => p.startsWith(`${folder}/`)).map(([p, c]) => [p.slice(folder.length + 1), c])),
  }))));
}

interface Prepared {
  ctx: RunContext;
  modules: Set<string>;
  coreTest: boolean;
  /** The Godot project of the client generation targets, or null without `--engine`. */
  clientRoot: string | null;
}

/** Engines with a client generation target. */
const ENGINES: ReadonlySet<string> = new Set(['godot']);

/** `.gd` files under a folder, without `tests/` folders. */
function gdFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    if (e.isDirectory()) return e.name === 'tests' ? [] : gdFiles(join(dir, e.name));
    return e.name.endsWith('.gd') ? [join(dir, e.name)] : [];
  });
}

/**
 * Client core type names (`client-core` Godot `### generated code`): every `class_name` of the `.gd` files of the
 * client core folder `core/` of the Godot project, `dev/` included and `tests/` left out.
 */
export function clientCoreTypeNames(clientRoot: string): Set<string> {
  const names = new Set<string>();
  for (const path of gdFiles(join(clientRoot, 'core'))) {
    for (const match of readFileSync(path, 'utf8').matchAll(/^class_name\s+([A-Za-z_][A-Za-z0-9_]*)/gm)) names.add(match[1] ?? '');
  }
  return names;
}

function prepare(args: Args, diags: Diagnostics): Prepared {
  const { settings, source, languages } = readSettings(args.gameSettings);
  const spec = readCoreSpec(readJson(args.coreSpec, '--core-spec'));
  if (typeof spec === 'string') throw new InputError(`--core-spec: ${spec}`);
  const modulesJson = readJson(args.modules, '--modules');
  if (!Array.isArray(modulesJson) || !modulesJson.every((m) => typeof m === 'string')) throw new InputError('--modules is not a JSON array of module names');
  if (!existsSync(args.game)) throw new InputError(`--game ${args.game} is not there`);
  if (!existsSync(args.baseProto)) throw new InputError(`--base-proto ${args.baseProto} is not there`);
  const modules = new Set(modulesJson);
  const coreTest = isCoreTestData(args.game, args.baseProto);
  // The Godot project is `client/` of a game (`client-content` Godot `## project`); core test data writes into the core project.
  const clientRoot = args.engine === null ? null : coreTest ? join(dirname(realpathSync(args.baseProto)), 'client', args.engine) : join(args.game, 'client');
  const data = readDataFolder(args.game, languages, source, diags);
  const ctx: RunContext = {
    data, core: coreDataOf(spec, [...modules]), diags, settings, sourceLanguage: source, languages,
    enums: new Map(), requirementForms: new Map(), requirementRows: [], settingTypes: new Map(), ids: new Map(),
    protoNames: namesOf([join(args.game, 'contract'), args.baseProto]), resources: readResources(args.game), strict: args.strict,
    godot: clientRoot === null ? null : { coreTypes: clientCoreTypeNames(clientRoot) },
  };
  return { ctx, modules, coreTest, clientRoot };
}

/** Core data, `banned_word` rows and translations; a list of the files a binary build would change. */
function matchData(p: Prepared, args: Args): string[] {
  const { ctx } = p;
  insertCoreData(ctx.data, ctx.core);
  makeBannedWords(ctx.data, ctx.core, ctx.languages);
  syncTranslations(ctx.data, ctx.languages, ctx.sourceLanguage, ctx.diags);
  const types = ctx.data.requirementTypes;
  if (types && !types.exists && !args.binary) {
    types.header = [...REQUIREMENT_TYPES_HEADER];
    types.changed = true;
  }
  const changed = changedFiles(ctx.data);
  if (args.binary) return [...changed.keys()];
  writeChangedFiles(args.game, changed);
  return [];
}

function readRegistry(store: RegistryStore, diags: Diagnostics): Registry | null {
  const reg = store.read();
  if (typeof reg !== 'string') return reg;
  diags.add('structure', filePlace(REGISTRY_FILE), `the ID registry does not pass the form check: ${reg}`);
  return null;
}

function issueIds(p: Prepared, args: Args, store: RegistryStore, registry: Registry): Registry | RunResult {
  const names = new Set(p.ctx.ids.keys());
  const missing = [...names].filter((n) => !registry.has(n));
  if (missing.length === 0) return registry;
  if (args.binary && !p.coreTest) {
    return { code: 1, stdout: p.ctx.diags.lines(), stderr: [`the ID registry has no ID value for ${missing.slice(0, 20).join(', ')}${missing.length > 20 ? ' ...' : ''}; run the data tool without --binary first`] };
  }
  const issued = store.issue(names);
  if (typeof issued === 'string') throw new InputError(`ID registry: ${issued}`);
  return issued;
}

/** `requirement` rows build into the `requirement` table and `RequirementLogic` enum of `--core-spec`. */
function checkRequirementSpec(ctx: RunContext): void {
  if (ctx.requirementRows.length === 0) return;
  if (!ctx.core.allTables.has(REQUIREMENT_TABLE)) throw new InputError(`--core-spec has no ${REQUIREMENT_TABLE} table for the requirement cells`);
  if (!ctx.enums.has('RequirementLogic') && !ctx.core.allEnums.has('RequirementLogic')) throw new InputError('--core-spec has no RequirementLogic enum for the requirement cells');
}

function compatVersion(prev: Previous | null, client: string): string | null {
  if (prev?.clientVersion == null) return null;
  return prev.clientVersion.split('-')[0] === client.split('-')[0] ? null : prev.clientVersion;
}

function execute(args: Args): RunResult {
  if (args.engine !== null && !ENGINES.has(args.engine)) throw new InputError(`--engine ${args.engine}: the data tool makes no client generated code for this engine`);
  const diags = new Diagnostics(args.strict);
  const p = prepare(args, diags);
  const previous = args.previous === null ? null : readPrevious(args.previous, p.ctx, 'client/build/data');
  if (typeof previous === 'string') throw new InputError(`--previous: ${previous}`);
  const stale = matchData(p, args);
  if (stale.length > 0) return { code: 1, stdout: diags.lines(), stderr: [`the data is not matched; run the data tool without --binary and commit: ${stale.join(', ')}`] };
  runChecks(p.ctx, p.modules, previous);
  if (previous) checkPrevious(p.ctx, previous, protocolsOf(p.ctx));
  const store = args.idRegistry === null ? branchStore(args.game) : fileStore(args.idRegistry);
  const registry = readRegistry(store, diags);
  if (diags.hasErrors() || registry === null) return { code: 1, stdout: diags.lines(), stderr: [] };
  checkRequirementSpec(p.ctx);
  const ids = issueIds(p, args, store, registry);
  if ('code' in ids) return ids;
  return buildAndWrite(p, args, previous, ids);
}

/** Builds with the issued ID values and writes the generation targets. */
function buildAndWrite(p: Prepared, args: Args, previous: Previous | null, ids: Registry): RunResult {
  const usesItemAmount = [...p.ctx.data.tables.values()].some((t) => t.columns.some((c) => c.type !== null && isItemAmountList(c.type)))
    || [...p.ctx.core.allTables.values()].some((t) => t.table.columns.some((c) => isItemAmountList(parseColumnType(c.type))));
  const itemAmount = itemAmountFields(args.baseProto);
  if (usesItemAmount && itemAmount === null) throw new InputError('the base proto has no message ItemAmount with item_id, amount and big_amount');
  const used = new Map([...ids].filter(([n]) => p.ctx.ids.has(n)));
  const out = build(p.ctx, used, itemAmount);
  const compat = compatVersion(previous, out.versions.Client);
  if (compat !== null) out.server.set('build/data/compat_client_data_version', `${compat}\n`);
  const serverRoot = p.coreTest ? join(resolve(args.game), '..', 'server') : join(args.game, 'server');
  const roots = [{ root: serverRoot, files: out.server }];
  if (p.clientRoot !== null) roots.push({ root: p.clientRoot, files: out.client });
  writeOutputs(roots, !args.binary || p.coreTest);
  return { code: 0, stdout: p.ctx.diags.lines(), stderr: [] };
}

/** Text as one stderr line: its lines, trimmed and without the empty ones, joined with `; ` (`data` tool.md `## CLI`). */
export function oneLine(text: string): string {
  return text.split(/\r?\n|\r/).map((l) => l.trim()).filter((l) => l !== '').join('; ');
}

/**
 * The reason of a run that could not go on: an argument or input file that is wrong, or an input, output or ID
 * registry that could not be read or written (exit code 2). Anything else is a fault of the data tool: its error and
 * the frame it was thrown in, not the whole stack, so the reason stays one line.
 */
export function failureLine(error: unknown): string {
  if (error instanceof InputError || error instanceof OutputError || error instanceof RegistryError) return oneLine(error.message);
  const code = (error as { code?: unknown }).code;
  // a Node error message already starts with its code
  if (error instanceof Error && typeof code === 'string') return oneLine(error.message.startsWith(`${code}:`) ? error.message : `${code}: ${error.message}`);
  if (!(error instanceof Error)) return oneLine(`data tool fault: ${String(error)}`);
  const frame = (error.stack ?? '').split('\n').find((l) => /^\s+at /.test(l))?.trim();
  return oneLine(`data tool fault: ${error.name}: ${error.message}${frame === undefined ? '' : ` (${frame})`}`);
}

/** Runs the data tool. */
export function runDataTool(argv: readonly string[]): RunResult {
  const args = parseArgs(argv);
  if (typeof args === 'string') return { code: 2, stdout: [], stderr: [oneLine(args)] };
  try {
    const result = execute(args);
    return { ...result, stderr: result.stderr.map(oneLine) };
  } catch (error) {
    return { code: 2, stdout: [], stderr: [failureLine(error)] };
  }
}
