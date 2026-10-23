import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { afterAll } from 'vitest';
import { runTool, type RunResult } from '../src/run.ts';

/** `open-game-works-core-impl/proto/`: the base proto of this core. */
export const BASE_PROTO = resolve(import.meta.dirname, '..', '..', '..', 'proto');

/** `open-game-works-core-impl/settings/core-settings.json`: the core settings defaults the base proto `_key` options read. */
export const CORE_SETTINGS = resolve(import.meta.dirname, '..', '..', '..', 'settings', 'core-settings.json');

/** Text of the core settings defaults, for the `core-settings.json` of a test folder. */
export const CORE_SETTINGS_TEXT = readFileSync(CORE_SETTINGS, 'utf8');

/** The core settings defaults with `settings` over them. */
function coreSettings(settings: Readonly<Record<string, unknown>> = {}): Record<string, unknown> {
  return { ...(JSON.parse(CORE_SETTINGS_TEXT) as Record<string, unknown>), ...settings };
}

const made: string[] = [];

afterAll(() => {
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
});

export function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'contract-tool-test-'));
  made.push(dir);
  return dir;
}

export function writeFiles(root: string, files: Readonly<Record<string, string>>): void {
  for (const [path, text] of Object.entries(files)) {
    const full = join(root, path);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, text);
  }
}

/** A data proto with `TableNames` of these tables. */
export function dataProto(tables: readonly string[], extra = ''): string {
  const fields = [...tables].sort().map((t, i) => `  bool ${t} = ${String(i + 1)};`).join('\n');
  return `syntax = "proto3";\npackage ogw.data;\n\nmessage TableNames {\n${fields}\n}\n${extra}`;
}

export interface GameSetup {
  readonly contract?: Readonly<Record<string, string>>;
  readonly tables?: readonly string[];
  readonly dataExtra?: string;
  readonly settings?: Readonly<Record<string, unknown>>;
  readonly modules?: readonly string[];
  /** Text of `ogw/core.proto` in place of the base proto of this core. */
  readonly coreProto?: string;
  readonly previous?: {
    readonly contract: Readonly<Record<string, string>>;
    readonly coreProto?: string;
    readonly settings?: Readonly<Record<string, unknown>>;
    readonly version: number;
  };
}

export const OPTIONS_PROTO_PATH = join(BASE_PROTO, 'ogw', 'options.proto');

/** A base proto folder with the options file of this core and the given core.proto. */
export function baseProtoDir(coreProto: string): string {
  const dir = tempDir();
  writeFiles(dir, { 'ogw/core.proto': coreProto });
  writeFileSync(join(dir, 'ogw', 'options.proto'), readOptions());
  return dir;
}

function readOptions(): string {
  return requireText(OPTIONS_PROTO_PATH);
}

function requireText(path: string): string {
  return readFileSync(path, 'utf8');
}

export interface GameRun extends RunResult {
  readonly game: string;
  readonly lines: string[];
}

/** Writes a game folder and runs the tool on it. */
export function runGame(setup: GameSetup): GameRun {
  const game = tempDir();
  const contract = Object.fromEntries(Object.entries(setup.contract ?? {}).map(([k, v]) => [`contract/${k}`, v]));
  writeFiles(game, { ...contract, 'server/generated/data/game_data.proto': dataProto(setup.tables ?? [], setup.dataExtra) });
  const settings = join(game, 'core-settings.json');
  writeFileSync(settings, JSON.stringify(coreSettings(setup.settings)));
  const args = ['--game', game, '--base-proto', setup.coreProto === undefined ? BASE_PROTO : baseProtoDir(setup.coreProto), '--core-settings', settings];
  if (setup.modules) {
    const modules = join(game, 'modules.json');
    writeFileSync(modules, JSON.stringify(setup.modules));
    args.push('--modules', modules);
  }
  if (setup.previous) {
    const prev = tempDir();
    const prevContract = Object.fromEntries(Object.entries(setup.previous.contract).map(([k, v]) => [`contract/${k}`, v]));
    writeFiles(prev, {
      ...prevContract,
      'proto/ogw/core.proto': setup.previous.coreProto ?? requireText(join(BASE_PROTO, 'ogw', 'core.proto')),
      'proto/ogw/options.proto': readOptions(),
      'core-settings.json': JSON.stringify(coreSettings(setup.previous.settings ?? setup.settings)),
      contract_version: `${String(setup.previous.version)}\n`,
    });
    args.push('--previous', prev);
  }
  const result = runTool(args);
  return { ...result, game, lines: result.stdout.split('\n').filter((l) => l !== '') };
}

export const HEAD = 'syntax = "proto3";\npackage game;\n\nimport "ogw/options.proto";\nimport "ogw/core.proto";\n';

/** A small valid game contract that cases change. */
export function baseContract(): Record<string, string> {
  return {
    'error.proto': `syntax = "proto3";\npackage game;\n\nenum GameError {\n  GAME_ERROR_UNSPECIFIED = 0;\n  GAME_ERROR_NOT_ENOUGH_GOLD = 1000;\n}\n`,
    'service.proto': `${HEAD}
service Game {
  // gold를 쓴다
  // changes: WalletUserState
  rpc Spend(SpendRequest) returns (SpendResponse) {
    option (ogw.retry) = true;
    option (ogw.errors) = "GAME_ERROR_NOT_ENOUGH_GOLD";
  }
}

message SpendRequest {
  int32 amount = 1 [(ogw.v) = {min: 1, max: 100}];
}

message SpendResponse {
}
`,
    'user_state.proto': `syntax = "proto3";\npackage game;\n\n// 지갑\nmessage WalletUserState {\n  int64 gold = 1;\n}\n`,
  };
}
