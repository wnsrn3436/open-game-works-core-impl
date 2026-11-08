/**
 * Step 7, the minimum app version judgement: `APP_UPDATE_REQUIRED` from `game-update.is_below_min_version` with the
 * `min_version` of the `app` entry of the current deploy list.
 */
import * as CoreContract from '../../../generated/contract/core_contract.ts';
import { admin, client_data_version, code, E, echo, game_register, login, missing, new_calls, send, start, stop, type TestServer } from './support.ts';

vi.mock('../../../generated/contract/game_contract.ts', async (import_original) => (await import('./game_contract_mock.ts')).mock_game_contract(await import_original()));

const servers: TestServer[] = [];
afterEach(async () => {
  for (const server of servers.splice(0)) await stop(server);
});

/** Publishes a deploy list whose `app` entry of android has `min_version` 1.2.0. */
async function publish_min_version(server: TestServer): Promise<void> {
  const body = {
    app: { android: { min_version: '1.2.0', recommended_version: '2.0.0', store_url: 'https://play.example.com/app' } },
    patches: { '2.0.0': { data_version: client_data_version(), data_files: [], translation_files: [], bundle_files: [] } },
  };
  const published = await admin(server, 'publish_deploy_list', body);
  expect(published.status).toBe(200);
}

const version = (client_version: string, platform = 'android'): { headers: Record<string, string> } => ({ headers: { 'X-Ogw-Client-Version': client_version, 'X-Ogw-Platform': platform } });

describe('step 7: the minimum app version', () => {
  it('answers APP_UPDATE_REQUIRED below min_version without the handler, also with the data version of client_data_version, and passes min_version, an empty version and a platform without an app entry', async () => {
    const calls = new_calls();
    const server = await start({ register: game_register(calls) });
    servers.push(server);
    const session = await login(server, 'min_version');
    await publish_min_version(server);
    const data_version = { 'X-Ogw-Data-Version': client_data_version() };
    expect(code(await send(session, 'Echo', echo(), { headers: { ...version('1.1.9').headers, ...data_version } }))).toBe(E.CORE_ERROR_APP_UPDATE_REQUIRED);
    expect(code(await send(session, 'core/Resync', new CoreContract.ResyncRequest(), version('0.9.99')))).toBe(E.CORE_ERROR_APP_UPDATE_REQUIRED);
    expect(calls.echo).toBe(0);
    expect(code(await send(session, 'Echo', echo(), version('1.2.0')))).toBe(0);
    expect(code(await send(session, 'Echo', echo(), version('')))).toBe(0);
    expect(code(await send(session, 'Echo', echo(), version('1.1.9', 'ios')))).toBe(0);
    expect(calls.echo).toBe(3);
  });

  it('answers APP_UPDATE_REQUIRED to Login and AutoLogin below min_version, and handles GetNotices below it', async () => {
    const server = await start({ register: game_register(new_calls()) });
    servers.push(server);
    const session = await login(server, 'min_version_tokenless');
    await publish_min_version(server);
    expect(code(await send(session, 'core/Login', new CoreContract.LoginRequest(), version('1.1.9')))).toBe(E.CORE_ERROR_APP_UPDATE_REQUIRED);
    expect(code(await send(session, 'core/AutoLogin', new CoreContract.AutoLoginRequest(), version('1.1.9')))).toBe(E.CORE_ERROR_APP_UPDATE_REQUIRED);
    expect(code(await send(session, 'core/GetNotices', new CoreContract.GetNoticesRequest(), version('1.1.9')))).toBe(0);
    // At min_version, Login goes on to decoding and its handler: not the step 7 answer.
    expect(code(await send(session, 'core/Login', new CoreContract.LoginRequest(), version('1.2.0')))).not.toBe(E.CORE_ERROR_APP_UPDATE_REQUIRED);
  });

  it.skipIf(missing('play-session', 'matchmaker'))('brings FinishPlaySession, ContinuePlaySession and ReportMatchResult below min_version to their handlers', async () => {
    const server = await start({ register: game_register(new_calls()) });
    servers.push(server);
    const session = await login(server, 'min_version_play');
    await publish_min_version(server);
    const id = '0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d';
    const finish = new CoreContract.FinishPlaySessionRequest();
    finish.play_session_id = id;
    const resume = new CoreContract.ContinuePlaySessionRequest();
    resume.play_session_id = id;
    const report = new CoreContract.ReportMatchResultRequest();
    report.match_id = id;
    const requests: [string, CoreContract.FinishPlaySessionRequest | CoreContract.ContinuePlaySessionRequest | CoreContract.ReportMatchResultRequest][] = [
      ['core/FinishPlaySession', finish],
      ['core/ContinuePlaySession', resume],
      ['core/ReportMatchResult', report],
    ];
    for (const [name, message] of requests) {
      expect([E.CORE_ERROR_PLAY_SESSION_NOT_FOUND, E.CORE_ERROR_MATCH_NOT_FOUND]).toContain(code(await send(session, name, message, version('1.1.9'))));
    }
  });
});
