import { spawnSync } from 'node:child_process';
import { copyFileSync, cpSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import * as CoreContract from '../../../generated/contract/core_contract.ts';
import * as GameContract from '../../../generated/contract/game_contract.ts';
import * as CoreCheatContract from '../../../dev/generated/contract/core_cheat_contract.ts';
import * as GameData from '../../../generated/data/game_data.ts';
import * as ValidationModule from '../index.ts';
import { PASS } from '../index.ts';
import { emptyData, standalone, withContainer } from './standalone.ts';

const ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
const CORE_SETTINGS = JSON.parse(readFileSync(join(ROOT, 'settings', 'core-settings.json'), 'utf8')) as Record<string, number>;

function setting(key: string): number {
  const value = CORE_SETTINGS[key];
  if (value === undefined) throw new Error(`core settings have no ${key}`);
  return value;
}

/**
 * A game folder with no `contract/`, whose server generated contract code the contract tool makes with `settings` as
 * the merged core settings. Removed after `use`.
 */
async function withGeneratedGame(settings: Record<string, number>, use: (game: string) => Promise<void>): Promise<void> {
  // The real path: the module under test and this test must import the generated code by the same path.
  const game = realpathSync(mkdtempSync(join(tmpdir(), 'validation-game-')));
  try {
    mkdirSync(join(game, 'server', 'generated', 'data'), { recursive: true });
    copyFileSync(join(ROOT, 'server', 'generated', 'data', 'game_data.proto'), join(game, 'server', 'generated', 'data', 'game_data.proto'));
    writeFileSync(join(game, 'core-settings.json'), JSON.stringify(settings));
    const tool = spawnSync(process.execPath, [
      join(ROOT, 'tools', 'contract-tool', 'bin', 'contract-tool.js'),
      '--game', game, '--base-proto', join(ROOT, 'proto'), '--core-settings', join(game, 'core-settings.json'),
    ], { encoding: 'utf8' });
    expect(tool.status, `${tool.stdout}${tool.stderr}`).toBe(0);
    await use(game);
  } finally {
    rmSync(game, { recursive: true, force: true });
  }
}

function make<T extends object>(ctor: new () => T, values: Partial<T>): T {
  return Object.assign(new ctor(), values);
}

const shopProducts = new GameData.ShopProductTable([make(GameData.ShopProductRow, { id: 999 })]);
const v = standalone(withContainer(emptyData(), 'ShopProductTable', shopProducts));

describe('validate_request option boundaries', () => {
  it('int32 min and max: min and max pass, min-1 and max+1 fail', () => {
    const age = (birth_year_month: number) => v.validate_request('core/ConfirmAge', make(CoreContract.ConfirmAgeRequest, { birth_year_month }));
    expect(age(0)).toBe(PASS);
    expect(age(999912)).toBe(PASS);
    expect(age(-1)).toEqual({ path: 'birth_year_month', rule: 'min' });
    expect(age(999913)).toEqual({ path: 'birth_year_month', rule: 'max' });
  });

  it('int64 min and max compare as bigint', () => {
    const push = (timezone_offset_ms: bigint) => v.validate_request('core/RegisterPushToken', make(CoreContract.RegisterPushTokenRequest, { timezone_offset_ms }));
    expect(push(-86399999n)).toBe(PASS);
    expect(push(86399999n)).toBe(PASS);
    expect(push(-86400000n)).toEqual({ path: 'timezone_offset_ms', rule: 'min' });
    expect(push(86400000n)).toEqual({ path: 'timezone_offset_ms', rule: 'max' });
  });

  it('max_len counts UTF-8 bytes of a string', () => {
    const push = (language: string) => v.validate_request('core/RegisterPushToken', make(CoreContract.RegisterPushTokenRequest, { language }));
    expect(push('a'.repeat(35))).toBe(PASS);
    expect(push('a'.repeat(36))).toEqual({ path: 'language', rule: 'max_len' });
    expect(push('가'.repeat(11))).toBe(PASS);
    expect(push('가'.repeat(12))).toEqual({ path: 'language', rule: 'max_len' });
  });

  it('max_len counts bytes of a bytes field', () => {
    const limit = setting('matchmaker.resultMaxBytes');
    const report = (size: number) => v.validate_request('core/ReportMatchResult', make(CoreContract.ReportMatchResultRequest, { result: new Uint8Array(size) }));
    expect(report(limit)).toBe(PASS);
    expect(report(limit + 1)).toEqual({ path: 'result', rule: 'max_len' });
  });

  it('max_chars counts code points of a string', () => {
    const limit = setting('nickname.maxLength');
    const nickname = (text: string) => v.validate_request('core/SetNickname', make(CoreContract.SetNicknameRequest, { nickname: text }));
    expect(nickname('가'.repeat(limit))).toBe(PASS);
    expect(nickname('😀'.repeat(limit))).toBe(PASS);
    expect(nickname('가'.repeat(limit + 1))).toEqual({ path: 'nickname', rule: 'max_chars' });
  });

  it('min_count and max_count bound the element count, and element rules name the element index', () => {
    const limit = setting('public-profile.maxRequestCount');
    const ids = (count: number) => Array.from({ length: count }, (_, i) => BigInt(i + 1));
    const profiles = (user_ids: bigint[]) => v.validate_request('core/GetPublicProfiles', make(CoreContract.GetPublicProfilesRequest, { user_ids }));
    expect(profiles([1n])).toBe(PASS);
    expect(profiles(ids(limit))).toBe(PASS);
    expect(profiles([])).toEqual({ path: 'user_ids', rule: 'min_count' });
    expect(profiles(ids(limit + 1))).toEqual({ path: 'user_ids', rule: 'max_count' });
    expect(profiles([1n, 2n, 0n])).toEqual({ path: 'user_ids[2]', rule: 'min' });
  });
});

describe('validate_request rules', () => {
  it('table rejects an ID value missing from the table and 0', () => {
    const buy = (product_id: number) => v.validate_request('core/BuyShopProduct', make(CoreContract.BuyShopProductRequest, { product_id, quantity: 1 }));
    expect(buy(999)).toBe(PASS);
    expect(buy(998)).toEqual({ path: 'product_id', rule: 'table' });
    expect(buy(0)).toEqual({ path: 'product_id', rule: 'table' });
  });

  it('unique rejects a repeated element', () => {
    const profiles = (user_ids: bigint[]) => v.validate_request('core/GetPublicProfiles', make(CoreContract.GetPublicProfilesRequest, { user_ids }));
    expect(profiles([1n, 2n, 1n])).toEqual({ path: 'user_ids', rule: 'unique' });
  });

  it('rejects an enum value the enum does not define and passes _UNSPECIFIED', () => {
    const login = (provider: number) => v.validate_request('core/Login', make(CoreContract.LoginRequest, { provider: provider as CoreContract.LoginProvider }));
    expect(login(0)).toBe(PASS);
    expect(login(99)).toEqual({ path: 'provider', rule: 'enum' });
  });

  it('rejects a string that is not well-formed UTF-8', () => {
    const message = CoreContract.SetNicknameRequest.decode(new Uint8Array([0x0a, 0x03, 0x41, 0xff, 0x42]));
    if (message === null) throw new Error('the request did not decode');
    expect(v.validate_request('core/SetNickname', message)).toEqual({ path: 'nickname', rule: 'utf8' });
  });

  it('checks the fields of a message inside a message', () => {
    const tooLong = 'x'.repeat(setting('logging.maxErrorMessageLength') + 1);
    const errors = [make(CoreContract.ClientErrorEntry, {}), make(CoreContract.ClientErrorEntry, { message: tooLong })];
    expect(v.validate_request('core/ReportClientErrors', make(CoreContract.ReportClientErrorsRequest, { errors }))).toEqual({ path: 'errors[1].message', rule: 'max_chars' });
    const params = [make(CoreContract.AnalyticsParam, { kind: 99 as CoreContract.AnalyticsParamKind })];
    const events = [make(CoreContract.AnalyticsEvent, { params })];
    expect(v.validate_request('core/ReportAnalyticsEvents', make(CoreContract.ReportAnalyticsEventsRequest, { events }))).toEqual({ path: 'events[0].params[0].kind', rule: 'enum' });
  });

  it('throws for a name that is not a request of the contract and for a message of another class', () => {
    expect(() => v.validate_request('core/NoSuchRequest', new CoreContract.ConfirmAgeRequest())).toThrow();
    expect(() => v.validate_request('core/cheat/SetTimeOffset', new CoreCheatContract.SetTimeOffsetRequest())).toThrow();
    expect(() => v.validate_request('core/ConfirmAge', new CoreContract.SetNicknameRequest())).toThrow();
  });
});

describe('_key options', () => {
  it('use the core settings value the server generated code was made with', () => {
    const nickname = (n: number) => v.validate_request('core/SetNickname', make(CoreContract.SetNicknameRequest, { nickname: 'n'.repeat(n) }));
    expect(nickname(setting('nickname.maxLength'))).toBe(PASS);
    expect(nickname(setting('nickname.maxLength') + 1)).toEqual({ path: 'nickname', rule: 'max_chars' });
    const rows = (n: number) => v.validate_request('core/ListGachaHistory', make(CoreContract.ListGachaHistoryRequest, { max_rows: n }));
    expect(rows(setting('gacha.maxHistoryRows'))).toBe(PASS);
    expect(rows(setting('gacha.maxHistoryRows') + 1)).toEqual({ path: 'max_rows', rule: 'max' });
    const guildName = (n: number) => v.validate_request('core/CreateGuild', make(CoreContract.CreateGuildRequest, { name: 'g'.repeat(n) }));
    expect(guildName(setting('guild.maxNameLength'))).toBe(PASS);
    expect(guildName(setting('guild.maxNameLength') + 1)).toEqual({ path: 'name', rule: 'max_chars' });
  });

  it('change when the contract tool runs again with another core settings value', async () => {
    const limit = setting('nickname.maxLength') + 3;
    await withGeneratedGame({ ...CORE_SETTINGS, 'nickname.maxLength': limit }, async (game) => {
      const generated = (await import(pathToFileURL(join(game, 'server', 'generated', 'contract', 'core_contract.ts')).href)) as typeof CoreContract;
      const check = (n: number) => generated.validate_SetNicknameRequest(make(generated.SetNicknameRequest, { nickname: 'n'.repeat(n) }), emptyData());
      expect(check(limit)).toBeNull();
      expect(check(limit + 1)).toEqual({ path: 'nickname', rule: 'max_chars' });
    });
  });
});

describe('validate_message', () => {
  it('passes MatchInputLog decoded from empty bytes on a server made from a game contract that does not define it', async () => {
    await withGeneratedGame(CORE_SETTINGS, async (game) => {
      // The module and the generated code it imports, at the same relative paths as in a game's `server/`.
      const generatedData = join(game, 'server', 'generated', 'data');
      copyFileSync(join(ROOT, 'server', 'generated', 'data', 'game_data.ts'), join(generatedData, 'game_data.ts'));
      cpSync(join(ROOT, 'server', 'core', 'validation'), join(game, 'server', 'core', 'validation'), { recursive: true, filter: (path) => basename(path) !== 'tests' });
      const url = (...path: string[]) => pathToFileURL(join(game, 'server', ...path)).href;
      const contract = (await import(url('generated', 'contract', 'game_contract.ts'))) as typeof GameContract;
      const data = (await import(url('generated', 'data', 'game_data.ts'))) as typeof GameData;
      const validationModule = (await import(url('core', 'validation', 'index.ts'))) as typeof ValidationModule;
      // The core test contract's MatchInputLog has `inputs`; this contract's has no field.
      expect(Object.keys(new contract.MatchInputLog())).toEqual([]);
      const dataSet = data.load_data_set({ get: () => new Uint8Array(0) } as unknown as ReadonlyMap<string, Uint8Array>);
      if (dataSet === null) throw new Error('an empty data set did not load');
      const validation = validationModule.create_validation({ settings: { supportedLanguages: ['en'] }, modules: {} as ValidationModule.ValidationInput['modules'], server: { data: dataSet } });
      const inputLog = contract.MatchInputLog.decode(new Uint8Array(0));
      if (inputLog === null) throw new Error('empty bytes did not decode');
      expect(validation.validate_message('MatchInputLog', inputLog)).toBe(PASS);
    });
  });

  it('passes the default module messages of the core test contract', () => {
    expect(v.validate_message('MatchResult', new GameContract.MatchResult())).toBe(PASS);
    const inputLog = GameContract.MatchInputLog.decode(new Uint8Array(0));
    if (inputLog === null) throw new Error('empty bytes did not decode');
    expect(v.validate_message('MatchInputLog', inputLog)).toBe(PASS);
    expect(v.validate_message('PlaySessionResult', new GameContract.PlaySessionResult())).toBe(PASS);
    expect(v.validate_message('PlaySessionStartOptions', new GameContract.PlaySessionStartOptions())).toBe(PASS);
    expect(v.validate_message('PlaySessionContinueOptions', new GameContract.PlaySessionContinueOptions())).toBe(PASS);
  });

  it('checks the declarations of MatchResult and MatchInputLog: the boundary passes and one past it fails', () => {
    const match = (values: Partial<GameContract.MatchResult>) => v.validate_message('MatchResult', make(GameContract.MatchResult, values));
    expect(match({ winner: 15, score: 1000 })).toBe(PASS);
    expect(match({ winner: 16 })).toEqual({ path: 'winner', rule: 'max' });
    expect(match({ score: -1 })).toEqual({ path: 'score', rule: 'min' });
    const inputLog = (inputs: number[]) => v.validate_message('MatchInputLog', make(GameContract.MatchInputLog, { inputs }));
    expect(inputLog(new Array<number>(64).fill(9))).toBe(PASS);
    expect(inputLog(new Array<number>(65).fill(0))).toEqual({ path: 'inputs', rule: 'max_count' });
    expect(inputLog([0, 10])).toEqual({ path: 'inputs[1]', rule: 'max' });
  });

  it('checks the declarations of PlaySessionResult, PlaySessionStartOptions and PlaySessionContinueOptions', () => {
    const result = (values: Partial<GameContract.PlaySessionResult>) => v.validate_message('PlaySessionResult', make(GameContract.PlaySessionResult, values));
    expect(result({ score: 1000, inputs: new Array<number>(16).fill(9) })).toBe(PASS);
    expect(result({ score: 1001 })).toEqual({ path: 'score', rule: 'max' });
    expect(result({ inputs: new Array<number>(17).fill(0) })).toEqual({ path: 'inputs', rule: 'max_count' });
    expect(result({ inputs: [-1] })).toEqual({ path: 'inputs[0]', rule: 'min' });
    const start = (booster_count: number) => v.validate_message('PlaySessionStartOptions', make(GameContract.PlaySessionStartOptions, { booster_count }));
    expect(start(3)).toBe(PASS);
    expect(start(4)).toEqual({ path: 'booster_count', rule: 'max' });
    expect(start(-1)).toEqual({ path: 'booster_count', rule: 'min' });
    const resume = (moves: number) => v.validate_message('PlaySessionContinueOptions', make(GameContract.PlaySessionContinueOptions, { moves }));
    expect(resume(10)).toBe(PASS);
    expect(resume(11)).toEqual({ path: 'moves', rule: 'max' });
  });

  it('throws for another message name and for a message of another class', () => {
    expect(() => v.validate_message('PlaySessionLoadout', new GameContract.PlaySessionLoadout())).toThrow();
    expect(() => v.validate_message('PublicProfile', new GameContract.PublicProfile())).toThrow();
    expect(() => v.validate_message('MatchResult', new GameContract.MatchInputLog())).toThrow();
  });
});
