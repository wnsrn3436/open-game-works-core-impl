/** Command line: arguments, exit codes, stdout and stderr, and the built single file. */
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { runTool } from '../src/run.ts';
import { baseContract, BASE_PROTO, CORE_SETTINGS_TEXT, dataProto, tempDir, writeFiles } from './helpers.ts';

const TOOL_DIR = resolve(import.meta.dirname, '..');

function game(contract: Record<string, string>): string {
  const dir = tempDir();
  const files = Object.fromEntries(Object.entries(contract).map(([k, v]) => [`contract/${k}`, v]));
  writeFiles(dir, { ...files, 'core-settings.json': CORE_SETTINGS_TEXT, 'server/generated/data/game_data.proto': dataProto([]) });
  return dir;
}

function args(dir: string): string[] {
  return ['--game', dir, '--base-proto', BASE_PROTO, '--core-settings', join(dir, 'core-settings.json')];
}

describe('command line', () => {
  const inputFailures: [string, (dir: string) => string[]][] = [
    ['unknown argument', (dir) => [...args(dir), '--fast']],
    ['missing --game', (dir) => args(dir).slice(2)],
    ['missing --base-proto', (dir) => ['--game', dir, '--core-settings', join(dir, 'core-settings.json')]],
    ['missing --core-settings', (dir) => ['--game', dir, '--base-proto', BASE_PROTO]],
    ['argument without value', (dir) => [...args(dir), '--modules']],
    ['argument twice', (dir) => [...args(dir), '--game', dir]],
    ['game folder missing', (dir) => ['--game', join(dir, 'none'), ...args(dir).slice(2)]],
    ['base proto folder without base proto', (dir) => ['--game', dir, '--base-proto', dir, '--core-settings', join(dir, 'core-settings.json')]],
    ['core settings not JSON', (dir) => {
      writeFileSync(join(dir, 'bad.json'), '{');
      return ['--game', dir, '--base-proto', BASE_PROTO, '--core-settings', join(dir, 'bad.json')];
    }],
    ['modules not an array of names', (dir) => {
      writeFileSync(join(dir, 'modules.json'), '{"a": 1}');
      return [...args(dir), '--modules', join(dir, 'modules.json')];
    }],
    ['contract/ not a folder', (dir) => {
      rmSync(join(dir, 'contract'), { recursive: true });
      writeFileSync(join(dir, 'contract'), '');
      return args(dir);
    }],
    ['contract file a dangling symlink', (dir) => {
      symlinkSync(join(dir, 'none.proto'), join(dir, 'contract', 'realtime.proto'));
      return args(dir);
    }],
    ['engine without a client generation target', (dir) => [...args(dir), '--engine', 'unity']],
    ['base-proto-only with --game', (dir) => ['--base-proto-only', ...args(dir), '--previous', dir]],
  ];
  for (const [name, make] of inputFailures) {
    it(`exit code 2: ${name}`, () => {
      const dir = game(baseContract());
      const result = runTool(make(dir));
      expect(result.code).toBe(2);
      expect(result.stdout).toBe('');
      expect(result.stderr).not.toBe('');
      expect(existsSync(join(dir, 'server', 'generated', 'contract'))).toBe(false);
    });
  }

  it('a file system error writing a generation target is exit code 2, not 1', () => {
    const dir = game(baseContract());
    mkdirSync(join(dir, 'server', 'generated', 'contract', 'game_contract.ts'), { recursive: true });
    const result = runTool(args(dir));
    expect(result.code).toBe(2);
    expect(result.stdout).toBe('');
    expect(result.stderr).not.toBe('');
  });

  it('violations are stdout lines and exit code 1; success is exit code 0', () => {
    const contract = baseContract();
    contract['user_state.proto'] = (contract['user_state.proto'] ?? '').replace('int64 gold = 1;', 'uint64 gold = 1;\n  sint32 gem = 2;');
    const bad = runTool(args(game(contract)));
    expect(bad.code).toBe(1);
    expect(bad.stdout.trimEnd().split('\n')).toEqual([
      'contract/user_state.proto:6:3 ERROR scalar type uint64 is not allowed; use int32, int64, float, double, bool, string or bytes',
      'contract/user_state.proto:7:3 ERROR scalar type sint32 is not allowed; use int32, int64, float, double, bool, string or bytes',
    ]);
    const good = runTool(args(game(baseContract())));
    expect(good).toEqual({ code: 0, stdout: '', stderr: '' });
  });

  it('the source entry runs in node', () => {
    const dir = game(baseContract());
    const result = spawnSync(process.execPath, [join(TOOL_DIR, 'src', 'main.ts'), ...args(dir)], { encoding: 'utf8' });
    expect(result.stderr).toBe('');
    expect(result.status).toBe(0);
    expect(existsSync(join(dir, 'server', 'generated', 'contract', 'game_contract.ts'))).toBe(true);
  });

  it('npm run build makes bin/contract-tool.js, which runs alone', () => {
    const build = spawnSync('npm', ['run', 'build'], { cwd: TOOL_DIR, encoding: 'utf8' });
    expect(build.status, build.stderr).toBe(0);
    const work = tempDir();
    const bin = join(work, 'contract-tool.js');
    copyFileSync(join(TOOL_DIR, 'bin', 'contract-tool.js'), bin);
    const dir = game(baseContract());
    const ok = spawnSync(process.execPath, [bin, ...args(dir)], { cwd: work, encoding: 'utf8' });
    expect(ok.stderr).toBe('');
    expect(ok.status).toBe(0);
    const missing = spawnSync(process.execPath, [bin, '--game', dir], { cwd: work, encoding: 'utf8' });
    expect(missing.status).toBe(2);
    expect(missing.stderr).toContain('--base-proto is required');
  });
});
