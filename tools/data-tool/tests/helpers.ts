/** Test fixtures: a game folder with data files, base proto, game settings, core-spec.json and modules. */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import ts from 'typescript';
import { afterEach } from 'vitest';
import { writeCsv } from '../src/csv.ts';
import { runDataTool, type RunResult } from '../src/run.ts';

export interface FixtureOptions {
  /** Files of the game folder by path, e.g. `data/tables/item.csv`. */
  files?: Record<string, string>;
  settings?: Record<string, unknown>;
  coreSpec?: unknown;
  modules?: string[];
  /** Files of the base proto folder by path. */
  baseProto?: Record<string, string>;
  registry?: Record<string, number>;
}

export interface Fixture {
  root: string;
  game: string;
  baseProto: string;
  settings: string;
  coreSpec: string;
  modules: string;
  registry: string;
}

const made: string[] = [];

afterEach(() => {
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
});

export function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'data-tool-test-'));
  made.push(dir);
  return dir;
}

export function writeFiles(root: string, files: Record<string, string>): void {
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  }
}

export const ITEM_AMOUNT_PROTO = `syntax = "proto3";
package ogw.core;

message ItemAmount {
  int32 item_id = 1;
  int64 amount = 2;
  string big_amount = 3;
}
`;

/** The `RequirementCore` module of `core-spec.json`: the `requirement` table and `RequirementLogic`. */
export const REQUIREMENT_MODULE = {
  name: 'RequirementCore', side: 'client', lifecycle: true, dependencies: [], optionalDependencies: [], devDependencies: [], settings: [],
  settingsConstraints: [], usedTables: [], invariants: [], reserved: [], formatArguments: [], collectedData: [], adapters: [], operations: [],
  tables: [{ name: 'requirement', columns: [
    { description: '', target: 'All', type: 'id(key)', name: 'id' }, { description: '', target: 'All', type: 'enum<RequirementType>?', name: 'type' },
    { description: '', target: 'All', type: 'int', name: 'target_id' }, { description: '', target: 'All', type: 'long', name: 'value' },
    { description: '', target: 'All', type: 'array<ref<requirement.id>>', name: 'children' }, { description: '', target: 'All', type: 'enum<RequirementLogic>?', name: 'logic' },
  ] }],
  enums: [{ type: 'RequirementLogic', elements: ['All', 'Any'] }],
};

/** A core-spec.json with the `RequirementCore` module when the given one does not have it. */
function withRequirementModule(spec: unknown): unknown {
  const s = (spec ?? { version: '0.0.0', modules: [] }) as { modules?: { name?: string }[] };
  if (!Array.isArray(s.modules) || s.modules.some((m) => m.name === REQUIREMENT_MODULE.name)) return spec;
  return { ...s, modules: [...s.modules, REQUIREMENT_MODULE] };
}

export function fixture(options: FixtureOptions = {}): Fixture {
  const root = tempDir();
  const f: Fixture = {
    root, game: join(root, 'game'), baseProto: join(root, 'proto'), settings: join(root, 'settings.json'),
    coreSpec: join(root, 'core-spec.json'), modules: join(root, 'modules.json'), registry: join(root, 'id_registry.json'),
  };
  mkdirSync(f.game, { recursive: true });
  writeFiles(f.game, options.files ?? {});
  mkdirSync(f.baseProto, { recursive: true });
  writeFiles(f.baseProto, options.baseProto ?? { 'ogw/core.proto': ITEM_AMOUNT_PROTO });
  writeFileSync(f.settings, JSON.stringify(options.settings ?? { sourceLanguage: 'ko', supportedLanguages: ['ko'] }));
  writeFileSync(f.coreSpec, JSON.stringify(withRequirementModule(options.coreSpec)));
  writeFileSync(f.modules, JSON.stringify(options.modules ?? []));
  writeFileSync(f.registry, JSON.stringify(options.registry ?? {}));
  return f;
}

export function args(f: Fixture, extra: string[] = []): string[] {
  return ['--game', f.game, '--base-proto', f.baseProto, '--game-settings', f.settings, '--core-spec', f.coreSpec, '--modules', f.modules, '--id-registry', f.registry, ...extra];
}

export function run(f: Fixture, extra: string[] = []): RunResult {
  return runDataTool(args(f, extra));
}

/** A table CSV: header rows from `columns` as `name|type|target` (comment columns are `#name`), then data rows. */
export function table(columns: string[], rows: string[][] = [], descriptions: string[] = []): string {
  const parts = columns.map((c): string[] => (c.startsWith('#') ? [c, '', ''] : c.split('|')));
  return writeCsv([
    parts.map((_, i) => descriptions[i] ?? ''),
    parts.map((p) => p[2] ?? ''),
    parts.map((p) => p[1] ?? ''),
    parts.map((p) => p[0] ?? ''),
    ...rows,
  ]);
}

/** A data/enums.csv text. */
export function enums(rows: [string, string, number][]): string {
  return writeCsv([['type', 'element', 'value', '#comment'], ...rows.map(([t, e, v]) => [t, e, String(v), ''])]);
}

export function read(f: Fixture, path: string): string {
  return readFileSync(join(f.game, path), 'utf8');
}

export function has(f: Fixture, path: string): boolean {
  return existsSync(join(f.game, path));
}

/** Result lines with the given code. */
export function lines(r: RunResult, code: string): string[] {
  return r.stdout.filter((l) => l.split(' ')[2] === code);
}

/** A core-spec.json module with defaults for every field. */
export function specModule(m: Record<string, unknown> & { name: string }): Record<string, unknown> {
  return {
    side: 'server', lifecycle: false, dependencies: [], optionalDependencies: [], devDependencies: [], settings: [],
    settingsConstraints: [], tables: [], usedTables: [], enums: [], invariants: [], reserved: [], formatArguments: [],
    collectedData: [], adapters: [], operations: [], ...m,
  };
}

export function specTable(name: string, columns: string[]): { name: string; columns: { description: string; target: string; type: string; name: string }[] } {
  return { name, columns: columns.map((c) => {
    const [n, type, target] = c.split('|') as [string, string, string];
    return { description: '', target, type, name: n };
  }) };
}

/** Type errors of the generated server code under strict TypeScript options. */
export function typeErrors(f: Fixture): string[] {
  const file = join(f.game, 'server', 'generated', 'data', 'game_data.ts');
  const program = ts.createProgram([file, join(f.game, 'server', 'dev', 'generated', 'data', 'game_data_dev.ts')], {
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler,
    lib: ['lib.es2022.d.ts', 'lib.dom.d.ts'], strict: true, noEmit: true, allowImportingTsExtensions: true,
    erasableSyntaxOnly: true, verbatimModuleSyntax: true, noUncheckedIndexedAccess: true, exactOptionalPropertyTypes: true,
    noUnusedLocals: true, noUnusedParameters: true, noImplicitReturns: true, skipLibCheck: true, types: [],
  });
  return ts.getPreEmitDiagnostics(program).map((d) => {
    const pos = d.file && d.start !== undefined ? d.file.getLineAndCharacterOfPosition(d.start) : null;
    return `${d.file?.fileName.split('/').pop() ?? ''}:${String((pos?.line ?? 0) + 1)} ${ts.flattenDiagnosticMessageText(d.messageText, '\n')}`;
  });
}
