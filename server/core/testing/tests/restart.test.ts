import { randomUUID } from 'node:crypto';
import * as CoreContract from '../../../generated/contract/core_contract.ts';
import { fake, login, read_logs, restart_test_server, set_time, start_test_server, stop_test_server } from '../dev/index.ts';
import { UNAUTHORIZED, error_code, gold_of, resync, set_gold, social_login, type FakeControl } from './helpers.ts';

describe('restart_test_server', () => {
  it('keeps UserState', async () => {
    const server = await start_test_server();
    try {
      const session = await login(server, 'restart_state');
      await set_gold(server, session.user_id, 77n);
      await restart_test_server(server);
      expect(await gold_of(server, session.user_id)).toBe(77n);
    } finally {
      await stop_test_server(server);
    }
  });

  it('keeps the moved clock, the session, the fake result and the log lines', async () => {
    const server = await start_test_server();
    try {
      const session = await login(server, 'restart_all');
      const before = randomUUID();
      // Within the access token lifetime, so the session's access token is still valid after the move.
      const moved = (await resync(session, before)).envelope.server_time_at + 60_000n;
      set_time(server, moved);
      const google = fake(server, 'login-google') as FakeControl;
      google.set_failure('verify', 'rejected');
      await restart_test_server(server);
      const after = randomUUID();
      const result = await resync(session, after);
      expect(error_code(result)).not.toBe(UNAUTHORIZED);
      expect(result.envelope.error).toBeNull();
      expect(result.envelope.server_time_at).toBe(moved);
      const social = await social_login(session, CoreContract.LoginProvider.LOGIN_PROVIDER_GOOGLE, 'fake:restart');
      expect(error_code(social)).toBe(CoreContract.CoreError.CORE_ERROR_SOCIAL_LOGIN_INVALID);
      const ids = read_logs(server, 'request').map((line) => line.request_id);
      expect(ids).toContain(before);
      expect(ids).toContain(after);
    } finally {
      await stop_test_server(server);
    }
  });
});
