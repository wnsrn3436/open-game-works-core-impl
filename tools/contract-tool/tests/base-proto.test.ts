/** The base proto of this core (`proto/`) generates without violations, for a game and for the core test data folder. */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { runTool } from '../src/run.ts';
import { BASE_PROTO, CORE_SETTINGS_TEXT, dataProto, tempDir, writeFiles } from './helpers.ts';

const CONTRACT = 'server/generated/contract';
const DEV = 'server/dev/generated/contract';

describe('base proto of this core', () => {
  it('options.proto is the option file the contract defines', () => {
    const text = readFileSync(join(BASE_PROTO, 'ogw', 'options.proto'), 'utf8');
    for (const line of ['package ogw;', 'repeated string core_errors = 51001;', 'optional bool silent = 51002;', 'optional bool retry = 51003;',
      'optional string errors = 51004;', 'optional bool public = 51005;', 'optional FieldRules v = 51006;', 'optional bool sensitive = 51007;',
      'repeated int64 converters = 51008;', 'optional string max_count_key = 13;']) {
      expect(text).toContain(line);
    }
  });

  it('generates for a game without a contract', () => {
    const game = tempDir();
    writeFiles(game, { 'core-settings.json': CORE_SETTINGS_TEXT, 'server/generated/data/game_data.proto': dataProto([]) });
    const result = runTool(['--game', game, '--base-proto', BASE_PROTO, '--core-settings', join(game, 'core-settings.json')]);
    expect(result.stdout + result.stderr).toBe('');
    expect(result.code).toBe(0);
    for (const file of ['wire.ts', 'core_contract.ts', 'game_contract.ts', 'contract_version', 'converters.json']) {
      expect(existsSync(join(game, CONTRACT, file)), file).toBe(true);
    }
    for (const file of ['core_cheat_contract.ts', 'game_cheat_contract.ts']) expect(existsSync(join(game, DEV, file)), file).toBe(true);
    const core = readFileSync(join(game, CONTRACT, 'core_contract.ts'), 'utf8');
    for (const name of ['ResponseEnvelope', 'ServerError', 'BanDetail', 'UserStateDelta', 'UserStateEntry']) expect(core).toContain(`export class ${name} {`);
  });

  it('writes the core test data generation targets next to test-data/', async () => {
    const impl = tempDir();
    writeFiles(impl, {
      'proto/ogw/options.proto': readFileSync(join(BASE_PROTO, 'ogw', 'options.proto'), 'utf8'),
      'proto/ogw/core.proto': readFileSync(join(BASE_PROTO, 'ogw', 'core.proto'), 'utf8'),
      'test-data/settings.json': '{}',
      'server/generated/data/game_data.proto': dataProto(['item']),
      'core-settings.json': CORE_SETTINGS_TEXT,
    });
    const result = runTool(['--game', join(impl, 'test-data'), '--base-proto', join(impl, 'proto'), '--core-settings', join(impl, 'core-settings.json')]);
    expect(result.stdout + result.stderr).toBe('');
    expect(result.code).toBe(0);
    expect(existsSync(join(impl, CONTRACT, 'core_contract.ts'))).toBe(true);
    expect(existsSync(join(impl, DEV, 'game_cheat_contract.ts'))).toBe(true);
    expect(existsSync(join(impl, 'test-data', 'server'))).toBe(false);
    const envelopeModule: unknown = await import(join(impl, CONTRACT, 'core_contract.ts'));
    const { ResponseEnvelope, ServerError } = envelopeModule as Record<string, new () => Record<string, unknown> & { encode(): Uint8Array }>;
    if (ResponseEnvelope === undefined || ServerError === undefined) throw new Error('no envelope classes');
    const envelope = new ResponseEnvelope();
    const error = new ServerError();
    error.code = 1000;
    Object.assign(envelope, { server_time_at: 5n, error, body: new Uint8Array([1, 2]) });
    // server_time_at = 1 (varint 5), error = 2 (code 1000), body = 7
    expect(Array.from(envelope.encode())).toEqual([8, 5, 18, 3, 8, 232, 7, 58, 2, 1, 2]);
  });

  it('a test-data folder that is not under the parent of --base-proto is a game folder', () => {
    const impl = tempDir();
    writeFiles(impl, {
      'proto/ogw/options.proto': readFileSync(join(BASE_PROTO, 'ogw', 'options.proto'), 'utf8'),
      'proto/ogw/core.proto': readFileSync(join(BASE_PROTO, 'ogw', 'core.proto'), 'utf8'),
      'test-data/settings.json': '{}',
      'core-settings.json': CORE_SETTINGS_TEXT,
    });
    const result = runTool(['--game', join(impl, 'test-data'), '--base-proto', BASE_PROTO, '--core-settings', join(impl, 'core-settings.json')]);
    expect(result.stdout + result.stderr).toBe('');
    expect(result.code).toBe(0);
    expect(existsSync(join(impl, 'test-data', CONTRACT, 'core_contract.ts'))).toBe(true);
    expect(existsSync(join(impl, CONTRACT))).toBe(false);
  });

  it('a game without GameError gets GameError with only GAME_ERROR_UNSPECIFIED, as a const object and a type', () => {
    const game = tempDir();
    writeFiles(game, { 'core-settings.json': CORE_SETTINGS_TEXT, 'server/generated/data/game_data.proto': dataProto([]) });
    expect(runTool(['--game', game, '--base-proto', BASE_PROTO, '--core-settings', join(game, 'core-settings.json')]).code).toBe(0);
    const text = readFileSync(join(game, CONTRACT, 'game_contract.ts'), 'utf8');
    expect(text).toContain('export const GameError = {\n  GAME_ERROR_UNSPECIFIED: 0,\n} as const;\nexport type GameError = (typeof GameError)[keyof typeof GameError];\n');
  });

  it('only the generated code imports wire.ts, and no generated file exports its names', () => {
    const game = tempDir();
    writeFiles(game, { 'core-settings.json': CORE_SETTINGS_TEXT, 'server/generated/data/game_data.proto': dataProto([]) });
    expect(runTool(['--game', game, '--base-proto', BASE_PROTO, '--core-settings', join(game, 'core-settings.json')]).code).toBe(0);
    for (const file of [`${CONTRACT}/core_contract.ts`, `${CONTRACT}/game_contract.ts`, `${DEV}/core_cheat_contract.ts`, `${DEV}/game_cheat_contract.ts`]) {
      const text = readFileSync(join(game, file), 'utf8');
      expect(text, file).not.toMatch(/export \* from|export \{[^}]*\} from|export \* as/);
    }
  });

  it('replaces the generation target folders: stale files go, unchanged files are not rewritten', () => {
    const game = tempDir();
    writeFiles(game, {
      'core-settings.json': CORE_SETTINGS_TEXT,
      'server/generated/data/game_data.proto': dataProto([]),
      [`${CONTRACT}/old.ts`]: 'stale',
      [`${DEV}/sub/old.ts`]: 'stale',
      'server/generated/data/keep.ts': 'kept',
    });
    const args = ['--game', game, '--base-proto', BASE_PROTO, '--core-settings', join(game, 'core-settings.json')];
    expect(runTool(args).code).toBe(0);
    expect(existsSync(join(game, CONTRACT, 'old.ts'))).toBe(false);
    expect(existsSync(join(game, DEV, 'sub'))).toBe(false);
    expect(existsSync(join(game, 'server/generated/data/keep.ts'))).toBe(true);
    const wire = join(game, CONTRACT, 'wire.ts');
    writeFileSync(join(game, CONTRACT, 'marker'), 'x');
    const before = readFileSync(wire, 'utf8');
    expect(runTool(args).code).toBe(0);
    expect(readFileSync(wire, 'utf8')).toBe(before);
    expect(existsSync(join(game, CONTRACT, 'marker'))).toBe(false);
  });
});
