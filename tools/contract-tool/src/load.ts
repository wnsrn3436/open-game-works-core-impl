/** Reading the input files: game contract, base proto, data proto, core settings, modules, previous build. */
import { existsSync, readdirSync, readFileSync, statSync, type Stats } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import type { FileNode } from './ast.ts';
import { InputFailure, type Diagnostics } from './diagnostics.ts';
import type { Pkg } from './model.ts';
import { parseProto, SyntaxFailure } from './parser.ts';
import { GAME_FILES } from './rules/context.ts';

export interface LoadedFile {
  readonly node: FileNode;
  readonly pkg: Pkg;
  readonly name: string;
}

function readText(path: string): string {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    throw new InputFailure(`cannot read ${path}`);
  }
}

function statPath(path: string): Stats {
  try {
    return statSync(path);
  } catch {
    throw new InputFailure(`cannot read ${path}`);
  }
}

/** Sorted entry names of a folder. */
function listDir(dir: string): string[] {
  if (!statPath(dir).isDirectory()) throw new InputFailure(`${dir} is not a folder`);
  try {
    return readdirSync(dir).sort();
  } catch {
    throw new InputFailure(`cannot read ${dir}`);
  }
}

/** Parses a file; a syntax error is a violation when `diagnostics` is given and an input failure otherwise. */
function parse(path: string, display: string, importPath: string, diagnostics: Diagnostics | null): FileNode | null {
  try {
    return parseProto(readText(path), display, importPath);
  } catch (error) {
    if (!(error instanceof SyntaxFailure)) throw error;
    if (diagnostics === null) throw new InputFailure(`${display}:${String(error.line)}:${String(error.column)} ${error.message}`);
    diagnostics.error({ file: display, line: error.line, column: error.column }, `syntax: ${error.message}`);
    return null;
  }
}

/**
 * Game contract files of `contractDir`, by file name. A missing folder is an empty contract. A file or folder that is
 * not a game contract file is a violation when `diagnostics` is given and is left out.
 */
export function loadGameContract(contractDir: string, displayDir: string, diagnostics: Diagnostics | null): LoadedFile[] {
  if (!existsSync(contractDir)) return [];
  const names: string[] = [];
  for (const name of listDir(contractDir)) {
    const isFile = statPath(join(contractDir, name)).isFile();
    if (isFile && (GAME_FILES as readonly string[]).includes(name)) {
      names.push(name);
      continue;
    }
    const what = isFile ? 'file' : 'folder';
    diagnostics?.error({ file: `${displayDir}/${name}`, line: 1, column: 1 }, `${what} ${name} is not a game contract file; contract/ holds only ${GAME_FILES.join(', ')}`);
  }
  const files: LoadedFile[] = [];
  for (const name of names) {
    const node = parse(join(contractDir, name), `${displayDir}/${name}`, name, diagnostics);
    if (node) files.push({ node, pkg: 'game', name });
  }
  return files;
}

/** `ogw/core.proto` of a base proto folder; `ogw/options.proto` must be there too. */
export function loadBaseProto(baseDir: string, diagnostics: Diagnostics | null): LoadedFile[] {
  const options = join(baseDir, 'ogw', 'options.proto');
  const core = join(baseDir, 'ogw', 'core.proto');
  if (!existsSync(options)) throw new InputFailure(`no ogw/options.proto in base proto folder ${baseDir}`);
  if (!existsSync(core)) throw new InputFailure(`no ogw/core.proto in base proto folder ${baseDir}`);
  parse(options, options, 'ogw/options.proto', null);
  const node = parse(core, core, 'ogw/core.proto', diagnostics);
  return node ? [{ node, pkg: 'ogw.core', name: 'core.proto' }] : [];
}

export interface DataProto {
  /** Fields of `TableNames`: the tables of the server build target. */
  readonly tableNames: Set<string>;
  /** Message and enum names. */
  readonly names: Set<string>;
}

/** Table names and type names of the server data proto. A missing file is a game without data. */
export function loadDataProto(path: string): DataProto {
  if (!existsSync(path)) return { tableNames: new Set(), names: new Set() };
  const node = parse(path, path, 'game_data.proto', null);
  if (node === null) return { tableNames: new Set(), names: new Set() };
  const tables = node.messages.find((m) => m.name === 'TableNames');
  return {
    tableNames: new Set(tables?.fields.map((f) => f.name) ?? []),
    names: new Set([...node.messages.map((m) => m.name), ...node.enums.map((e) => e.name)]),
  };
}

export function loadJsonObject(path: string, what: string): Record<string, unknown> {
  let value: unknown;
  try {
    value = JSON.parse(readText(path));
  } catch (error) {
    if (error instanceof InputFailure) throw error;
    throw new InputFailure(`${what} ${path} is not JSON`);
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new InputFailure(`${what} ${path} is not a JSON object`);
  return value as Record<string, unknown>;
}

export function loadModules(path: string): string[] {
  let value: unknown;
  try {
    value = JSON.parse(readText(path));
  } catch (error) {
    if (error instanceof InputFailure) throw error;
    throw new InputFailure(`--modules ${path} is not JSON`);
  }
  if (!Array.isArray(value)) throw new InputFailure(`--modules ${path} is not a JSON array of module names`);
  const names: unknown[] = value;
  if (!names.every((v): v is string => typeof v === 'string')) throw new InputFailure(`--modules ${path} is not a JSON array of module names`);
  return names;
}

/** Contract version of a previous build folder. */
export function loadContractVersion(previousDir: string): number {
  const text = readText(join(previousDir, 'contract_version')).trim();
  if (!/^[1-9][0-9]*$/.test(text)) throw new InputFailure(`contract_version of ${previousDir} is not an integer 1 or more`);
  return Number(text);
}

/**
 * Where the tool reads and writes for `--game`. The core test data folder is `test-data/` under the parent of the
 * `--base-proto` folder; its server paths are under that parent folder.
 */
export function gamePaths(gameDir: string, baseProtoDir: string, engine: string | null = null): { contractDir: string; outRoot: string; clientRoot: string | null } {
  if (!existsSync(gameDir) || !statSync(gameDir).isDirectory()) throw new InputFailure(`--game ${gameDir} is not a folder`);
  const implDir = dirname(resolve(baseProtoDir));
  const isCoreTestData = resolve(gameDir) === join(implDir, 'test-data');
  // The Godot project is `client/` of a game (`client-content` Godot `## project`); core test data writes into the core project.
  const clientRoot = engine === null ? null : isCoreTestData ? join(implDir, 'client', engine) : join(gameDir, 'client');
  return { contractDir: join(gameDir, 'contract'), outRoot: isCoreTestData ? implDir : gameDir, clientRoot };
}

/** `.gd` files under a folder, without `tests/` folders. */
function gdFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const name of listDir(dir)) {
    const path = join(dir, name);
    if (statPath(path).isDirectory()) {
      if (name !== 'tests') out.push(...gdFiles(path));
    } else if (name.endsWith('.gd')) {
      out.push(path);
    }
  }
  return out;
}

/**
 * Client core type names (`client-core` Godot `### generated code`): every `class_name` the `.gd` files of the client
 * core folder `core/` of the Godot project declare, `dev/` included and `tests/` left out. No folder is no names.
 */
export function clientCoreTypeNames(clientRoot: string): Set<string> {
  const names = new Set<string>();
  for (const path of gdFiles(join(clientRoot, 'core'))) {
    for (const match of readText(path).matchAll(/^class_name\s+([A-Za-z_][A-Za-z0-9_]*)/gm)) names.add(match[1] ?? '');
  }
  return names;
}
