import * as CoreCheatContract from '../../../dev/generated/contract/core_cheat_contract.ts';
import { connect_server, login, send_cheat, set_time, start_test_server, stop_test_server, type TestServer } from '../dev/index.ts';
import { resync } from './helpers.ts';

function data_folder(): string {
  return process.env.OGW_SERVER_DATA ?? '';
}

describe('connect_server', () => {
  it('a remote test server with the URL and dev access value of a test server takes login, send and send_cheat', async () => {
    const server = await start_test_server();
    try {
      const remote = await connect_server(server.url, data_folder(), server.dev_access);
      const session = await login(remote, 'remote_user');
      expect((await resync(session)).envelope.error).toBeNull();
      const offset = new CoreCheatContract.SetTimeOffsetRequest();
      offset.offset_ms = 60_000n;
      expect((await send_cheat(session, 'core/cheat/SetTimeOffset', offset)).envelope.error).toBeNull();
      // The next request is signed with the server time the SetTimeOffset response gave.
      expect((await resync(session)).envelope.error).toBeNull();
    } finally {
      await stop_test_server(server);
    }
  });

  it('login with another dev access value throws; set_time and a seed on a remote test server throw', async () => {
    const server = await start_test_server();
    try {
      const wrong = await connect_server(server.url, data_folder(), 'not-the-dev-access');
      await expect(login(wrong, 'remote_user')).rejects.toThrow();
      const remote = await connect_server(server.url, data_folder(), server.dev_access);
      expect(() => {
        set_time(remote as unknown as TestServer, 1n);
      }).toThrow();
      const session = await login(remote, 'remote_seed');
      await expect(resync(session, undefined, 7n)).rejects.toThrow();
    } finally {
      await stop_test_server(server);
    }
  });

  it('connect_server to a URL nothing listens on throws', async () => {
    const server = await start_test_server();
    const url = server.url;
    await stop_test_server(server);
    await expect(connect_server(url, data_folder(), 'x')).rejects.toThrow();
  });
});
