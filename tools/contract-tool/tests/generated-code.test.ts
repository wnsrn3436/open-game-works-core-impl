/** The server generated code type-checks under strict settings and runs in `node` with type stripping. */
import { spawnSync } from 'node:child_process';
import { readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { generateRich } from './rich-game.ts';

/** Uses the generated types the way content code does: handler types, error unions, lists. */
const USAGE = `import * as GameContract from './generated/contract/game_contract.ts';
import * as CoreContract from './generated/contract/core_contract.ts';
import * as GameCheatContract from './dev/generated/contract/game_cheat_contract.ts';
import type { RequestCtx } from './core/storage/request_ctx.ts';

export const claim: GameContract.ClaimQuestHandler = (_ctx: RequestCtx, request) => {
  if (request.quest_id === 0) return GameContract.GameError.GAME_ERROR_QUEST_LOCKED;
  const response = new GameContract.ClaimQuestResponse();
  response.quest = new GameContract.QuestUserState();
  response.quest.items.push(new CoreContract.ItemAmount());
  return response;
};

export const list: GameContract.ListQuestsHandler = () => new GameContract.ListQuestsResponse();
export const gold: GameCheatContract.AddGoldHandler = () => GameContract.GameError.GAME_ERROR_NOT_ENOUGH_GOLD;
export const never: GameContract.ListQuestsError[] = [];
export const kinds: readonly CoreContract.KindInfo[] = [...CoreContract.KINDS, ...GameContract.KINDS];
export const rpcs: readonly CoreContract.RpcInfo[] = [...GameContract.RPCS, ...GameCheatContract.RPCS];
export const errors: readonly GameContract.GameError[] | undefined = GameContract.CORE_ERRORS.get('core/StartPlay');
export const version: number = GameContract.CONTRACT_VERSION;
export const kind: CoreContract.ItemChangeSource = CoreContract.ItemChangeSource.ITEM_CHANGE_SOURCE_SHOP;
`;

/** Usage that must not type-check: an error the rpc does not list. */
const MISUSE = `import * as GameContract from './generated/contract/game_contract.ts';

export const claim: GameContract.ClaimQuestHandler = () => GameContract.GameError.GAME_ERROR_NO_LIVES;
`;

function tsFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return tsFiles(path);
    return name.endsWith('.ts') ? [path] : [];
  });
}

/** The compiler options `ogw code check` uses for TypeScript: the server code has the node types. */
const OPTIONS: ts.CompilerOptions = {
  target: ts.ScriptTarget.ES2024, module: ts.ModuleKind.NodeNext, moduleResolution: ts.ModuleResolutionKind.NodeNext, lib: ['lib.es2024.d.ts'],
  types: ['node'], typeRoots: [resolve(import.meta.dirname, '..', 'node_modules', '@types')], strict: true, noEmit: true, allowImportingTsExtensions: true, erasableSyntaxOnly: true, verbatimModuleSyntax: true,
  noUncheckedIndexedAccess: true, noFallthroughCasesInSwitch: true, skipLibCheck: true,
};

/** Type errors of the server folder of a generated game; `server/package.json` makes its files ES modules. */
function serverDiagnostics(game: string): string[] {
  writeFileSync(join(game, 'server', 'package.json'), '{"type": "module"}\n');
  return diagnostics(tsFiles(join(game, 'server')));
}

function diagnostics(files: readonly string[]): string[] {
  const program = ts.createProgram(files, OPTIONS);
  return ts.getPreEmitDiagnostics(program).map((d) => {
    const where = d.file && d.start !== undefined ? `${d.file.fileName}:${String(d.file.getLineAndCharacterOfPosition(d.start).line + 1)}` : '';
    return `${where} ${ts.flattenDiagnosticMessageText(d.messageText, '\n')}`;
  });
}

describe('generated code', () => {
  it('type-checks with strict and erasable-syntax-only settings', () => {
    const rich = generateRich();
    expect(rich.code, rich.stdout).toBe(0);
    writeFileSync(join(rich.game, 'server', 'usage.ts'), USAGE);
    expect(serverDiagnostics(rich.game)).toEqual([]);
  });

  it('does not type-check a handler that returns an error its rpc does not list', () => {
    const rich = generateRich();
    writeFileSync(join(rich.game, 'server', 'usage.ts'), MISUSE);
    const errors = serverDiagnostics(rich.game);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatch(/usage\.ts:3 Type '1002' is not assignable to type 'ClaimQuestResponse \| ClaimQuestError'/);
  });

  it('runs in node with type stripping', () => {
    const rich = generateRich();
    const files = ['generated/contract/game_contract.ts', 'dev/generated/contract/game_cheat_contract.ts', 'dev/generated/contract/core_cheat_contract.ts'];
    const script = files.map((f) => `await import(${JSON.stringify(pathToFileURL(join(rich.game, 'server', f)).href)});`).join('\n')
      + `\nconst g = await import(${JSON.stringify(pathToFileURL(join(rich.game, 'server', files[0] ?? '')).href)});`
      + '\nconst q = new g.QuestUserState(); q.id = 5n; q.list_i32 = [1, -2];'
      + '\nconst d = g.QuestUserState.decode(q.encode());'
      + '\nconsole.log(String(d.id), d.list_i32.join(","), g.RPCS.length, g.KINDS.length);';
    const result = spawnSync(process.execPath, ['--input-type=module', '-e', script], { encoding: 'utf8' });
    expect(result.stderr).toBe('');
    expect(result.stdout.trim()).toBe('5 1,-2 2 4');
  });
});
