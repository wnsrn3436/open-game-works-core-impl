import * as CoreContract from '../../../generated/contract/core_contract.ts';
import { close, connect, login, read_frame, send_frame, start_test_server, stop_test_server } from '../dev/index.ts';
import { missing } from './helpers.ts';

describe('realtime connection', () => {
  // `matchmaker` is not in this core yet.
  it.skipIf(missing('matchmaker'))('HELLO through connect and send_frame gets HELLO_ACK from read_frame on a matchmaker test server', async () => {
    const server = await start_test_server(undefined, undefined, undefined, true);
    try {
      const session = await login(server, 'realtime_user');
      const connection = await connect(server);
      const frame = new CoreContract.MatchmakerFrame();
      frame.kind = CoreContract.MatchmakerFrameKind.MATCHMAKER_FRAME_KIND_HELLO;
      frame.access_token = session.access_token;
      frame.data_version = server.shared.data_version;
      frame.client_version = '';
      send_frame(connection, frame);
      const ack = await read_frame(connection, 10_000n);
      expect(ack?.kind).toBe(CoreContract.MatchmakerFrameKind.MATCHMAKER_FRAME_KIND_HELLO_ACK);
      close(connection);
      expect(await read_frame(connection, 10_000n)).toBeNull();
      expect(() => {
        send_frame(connection, frame);
      }).toThrow();
    } finally {
      await stop_test_server(server);
    }
  });

  it.skipIf(missing('matchmaker'))('read_frame throws when no frame comes within the wait', async () => {
    const server = await start_test_server(undefined, undefined, undefined, true);
    try {
      const connection = await connect(server);
      await expect(read_frame(connection, 200n)).rejects.toThrow();
      close(connection);
    } finally {
      await stop_test_server(server);
    }
  });

  it('connect to a test server without matchmaker throws', async () => {
    const server = await start_test_server();
    try {
      await expect(connect(server)).rejects.toThrow();
    } finally {
      await stop_test_server(server);
    }
  });
});
