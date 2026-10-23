import { randomUUID } from 'node:crypto';
import * as CoreContract from '../../../generated/contract/core_contract.ts';
import * as CoreCheatContract from '../../../dev/generated/contract/core_cheat_contract.ts';
import { advance_time, fake, login, read_logs, send, send_cheat, start_peer_server, start_test_server, stop_test_server, wait_background, type SendResult, type TestServer, type TestSession } from '../dev/index.ts';
import { UNAUTHORIZED, error_code, gold_id, rate_counter_rows, resync, social_login, type FakeControl } from './helpers.ts';

/** Two requests of the session with a wrong signature: two `security` lines of one window in the session's server instance. */
async function wrong_signatures(session: TestSession): Promise<void> {
  for (let i = 0; i < 2; i += 1) {
    const result = await send(session, 'core/Resync', new CoreContract.ResyncRequest(), undefined, undefined, undefined, { 'X-Ogw-Signature': '0'.repeat(64) });
    expect(error_code(result)).toBe(UNAUTHORIZED);
  }
}

/** The `repeated` summary lines job `logging_security_flush` left in the log of a test server (or peer). */
function repeated_lines(server: TestServer): Record<string, unknown>[] {
  return read_logs(server, 'security').filter((line) => line.reason === 'repeated');
}

function balance_request(amount: bigint): CoreCheatContract.SetItemBalanceRequest {
  const message = new CoreCheatContract.SetItemBalanceRequest();
  message.item_id = gold_id();
  message.balance = amount;
  return message;
}

/** The `[testing_gold]` amount in the full UserState a login response carries. */
function login_gold(result: SendResult): bigint | null {
  const entry = result.envelope.user_state?.entries.find((e) => e.kind === 'ItemBalanceUserState' && e.id === BigInt(gold_id()));
  return entry === undefined ? null : (CoreContract.ItemBalanceUserState.decode(entry.value)?.amount ?? null);
}

async function dev_login_result(server: Parameters<typeof login>[0], name: string): Promise<SendResult> {
  const session = await login(server, name);
  // A second DevLogin through the session's server gives the login response with the full UserState.
  const message = new CoreCheatContract.DevLoginRequest();
  message.account_name = name;
  return send_cheat(session, 'core/cheat/DevLogin', message);
}

describe('start_peer_server', () => {
  it('UserState a peer request writes is read by the original test server, and the other way', async () => {
    const origin = await start_test_server();
    const peer = await start_peer_server(origin);
    try {
      const on_peer = await login(peer, 'shared_user');
      await send_cheat(on_peer, 'core/cheat/SetItemBalance', balance_request(11n));
      expect(login_gold(await dev_login_result(origin, 'shared_user'))).toBe(11n);
      const on_origin = await login(origin, 'shared_user');
      await send_cheat(on_origin, 'core/cheat/SetItemBalance', balance_request(22n));
      expect(login_gold(await dev_login_result(peer, 'shared_user'))).toBe(22n);
    } finally {
      await stop_test_server(origin);
    }
  });

  it('advance_time on the original test server moves the peer request time and runs due jobs of both; the original serves after the peer stops', async () => {
    const origin = await start_test_server();
    const peer = await start_peer_server(origin);
    try {
      const on_peer = await login(peer, 'peer_time');
      const before = (await resync(on_peer)).envelope.server_time_at;
      expect(await rate_counter_rows(origin)).toBeGreaterThan(0);
      // The security log windows are in each instance's memory, so only that instance's job leaves their summary line.
      await wrong_signatures(on_peer);
      await wrong_signatures(await login(origin, 'origin_time'));
      expect(repeated_lines(peer)).toHaveLength(0);
      expect(repeated_lines(origin)).toHaveLength(0);
      const interval = BigInt(origin.settings()['routing.storageSweepIntervalMs'] as number);
      const window = BigInt(origin.settings()['logging.securityRepeatWindowMs'] as number);
      const step = (interval > window * 2n ? interval : window * 2n) + 60_000n;
      advance_time(origin, step);
      await wait_background(origin);
      await wait_background(peer);
      expect(await rate_counter_rows(origin)).toBe(0);
      expect(repeated_lines(peer)).toHaveLength(1);
      expect(repeated_lines(origin)).toHaveLength(1);
      expect((await resync(on_peer)).envelope.server_time_at).toBe(before + step);
      await stop_test_server(peer);
      const on_origin = await login(origin, 'peer_time');
      expect((await resync(on_origin)).envelope.error).toBeNull();
    } finally {
      await stop_test_server(origin);
    }
  });

  it('read_logs of a peer and of the original give their own lines; a peer fake adapter call is in the original controller record', async () => {
    const origin = await start_test_server();
    const peer = await start_peer_server(origin);
    try {
      const on_origin = await login(origin, 'logs_origin');
      const on_peer = await login(peer, 'logs_peer');
      const origin_id = randomUUID();
      const peer_id = randomUUID();
      await resync(on_origin, origin_id);
      await resync(on_peer, peer_id);
      const origin_ids = read_logs(origin, 'request').map((l) => l.request_id);
      const peer_ids = read_logs(peer, 'request').map((l) => l.request_id);
      expect(origin_ids).toContain(origin_id);
      expect(origin_ids).not.toContain(peer_id);
      expect(peer_ids).toContain(peer_id);
      expect(peer_ids).not.toContain(origin_id);
      const google = fake(origin, 'login-google') as FakeControl;
      const calls = google.calls().length;
      await social_login(on_peer, CoreContract.LoginProvider.LOGIN_PROVIDER_GOOGLE, 'fake:peer_call');
      expect(google.calls().length).toBe(calls + 1);
      expect(fake(peer, 'login-google')).toBe(google);
    } finally {
      await stop_test_server(origin);
    }
  });
});
