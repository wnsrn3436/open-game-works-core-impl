import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as CoreContract from '../../../generated/contract/core_contract.ts';
import { core_test_server_paths } from '../../testing/dev/index.ts';
import { client_data_version, code, E, echo, game_register, login, missing, new_calls, send, start, stop, type TestServer } from './support.ts';

vi.mock('../../../generated/contract/game_contract.ts', async (import_original) => (await import('./game_contract_mock.ts')).mock_game_contract(await import_original()));

const servers: TestServer[] = [];
afterEach(async () => {
  for (const server of servers.splice(0)) await stop(server);
});

const hex = (c: string): string => c.repeat(64);
const protocol = (v: string): string => v.slice(0, 64);
const data_hash = (v: string): string => v.slice(65);

/** A copy of the server build data folder with `compat_client_data_version`. */
function data_with_compat(compat: string): string {
  const source = core_test_server_paths().data_folder;
  const folder = mkdtempSync(join(tmpdir(), 'routing-data-'));
  cpSync(source, folder, { recursive: true });
  writeFileSync(join(folder, 'compat_client_data_version'), `${compat}\n`);
  return folder;
}

describe('data version', () => {
  it('passes a request with client_data_version though the server build data has its own data version, and answers APP_UPDATE_REQUIRED to another protocol hash', async () => {
    const calls = new_calls();
    const server = await start({ register: game_register(calls) });
    servers.push(server);
    const session = await login(server, 'version');
    const client = client_data_version();
    const server_version = readFileSync(join(core_test_server_paths().data_folder, 'data_version'), 'utf8').trim();
    expect(server_version.length).toBe(129);
    expect(code(await send(session, 'Echo', echo(), { headers: { 'X-Ogw-Data-Version': client } }))).toBe(0);
    const other = protocol(client) === hex('1') ? hex('2') : hex('1');
    expect(code(await send(session, 'Echo', echo(), { headers: { 'X-Ogw-Data-Version': `${other}-${data_hash(client)}` } }))).toBe(E.CORE_ERROR_APP_UPDATE_REQUIRED);
    expect(calls.echo).toBe(1);
  });

  it('passes another data hash to the handler while the data update is not ready, and answers DATA_UPDATE_REQUIRED with an empty client version', async () => {
    const calls = new_calls();
    const server = await start({ register: game_register(calls) });
    servers.push(server);
    const session = await login(server, 'data_hash');
    const client = client_data_version();
    const other_data = `${protocol(client)}-${data_hash(client) === hex('3') ? hex('4') : hex('3')}`;
    expect(code(await send(session, 'Echo', echo(), { headers: { 'X-Ogw-Data-Version': other_data, 'X-Ogw-Client-Version': '1.0.0' } }))).toBe(0);
    expect(calls.echo).toBe(1);
    expect(code(await send(session, 'Echo', echo(), { headers: { 'X-Ogw-Data-Version': other_data, 'X-Ogw-Client-Version': '' } }))).toBe(E.CORE_ERROR_DATA_UPDATE_REQUIRED);
    expect(calls.echo).toBe(1);
  });

  // `play-session` and `matchmaker` are not in this core yet; `parsing.test.ts` checks the step 7 decision of these requests.
  it.skipIf(missing('play-session', 'matchmaker'))('brings FinishPlaySession, ContinuePlaySession and ReportMatchResult with only another data hash to their handlers', async () => {
    const calls = new_calls();
    const server = await start({ register: game_register(calls) });
    servers.push(server);
    const session = await login(server, 'play');
    const client = client_data_version();
    const other_data = `${protocol(client)}-${data_hash(client) === hex('3') ? hex('4') : hex('3')}`;
    const other_protocol = `${protocol(client) === hex('5') ? hex('6') : hex('5')}-${data_hash(client)}`;
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
      const reached = code(await send(session, name, message, { headers: { 'X-Ogw-Data-Version': other_data, 'X-Ogw-Client-Version': '' } }));
      expect(reached).not.toBe(E.CORE_ERROR_DATA_UPDATE_REQUIRED);
      expect([E.CORE_ERROR_PLAY_SESSION_NOT_FOUND, E.CORE_ERROR_MATCH_NOT_FOUND]).toContain(reached);
      expect(code(await send(session, name, message, { headers: { 'X-Ogw-Data-Version': other_protocol } }))).toBe(E.CORE_ERROR_APP_UPDATE_REQUIRED);
    }
    expect(code(await send(session, 'Echo', echo(), { headers: { 'X-Ogw-Data-Version': other_data, 'X-Ogw-Client-Version': '' } }))).toBe(E.CORE_ERROR_DATA_UPDATE_REQUIRED);
  });

  it('passes a request equal to compat_client_data_version, and does not start with a compat_client_data_version of the client protocol hash', async () => {
    const client = client_data_version();
    const compat = `${protocol(client) === hex('7') ? hex('8') : hex('7')}-${hex('9')}`;
    const folder = data_with_compat(compat);
    const same_protocol = data_with_compat(`${protocol(client)}-${hex('a')}`);
    try {
      const calls = new_calls();
      const server = await start({ register: game_register(calls), data_folder: folder });
      servers.push(server);
      const session = await login(server, 'compat');
      expect(code(await send(session, 'Echo', echo(), { headers: { 'X-Ogw-Data-Version': compat } }))).toBe(0);
      expect(code(await send(session, 'Echo', echo(), { headers: { 'X-Ogw-Data-Version': `${protocol(compat)}-${hex('b')}`, 'X-Ogw-Client-Version': '' } }))).toBe(E.CORE_ERROR_DATA_UPDATE_REQUIRED);
      expect(calls.echo).toBe(1);
      await expect(start({ register: game_register(new_calls()), data_folder: same_protocol })).rejects.toThrow();
    } finally {
      rmSync(folder, { recursive: true, force: true });
      rmSync(same_protocol, { recursive: true, force: true });
    }
  });
});
