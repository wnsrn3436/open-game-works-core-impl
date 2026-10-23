import { randomUUID } from 'node:crypto';
import * as CoreContract from '../../../generated/contract/core_contract.ts';
import * as CoreCheatContract from '../../../dev/generated/contract/core_cheat_contract.ts';
import { sign_request } from '../../session/index.ts';
import { advance_time, call_dev, login, read_logs, send, send_admin, send_cheat, send_raw, start_test_server, stop_test_server, wait_background, type TestServer, type TestSession } from '../dev/index.ts';
import { UNAUTHORIZED, error_code, gold_id, resync, seeds_by_request, social_login } from './helpers.ts';

/**
 * A cheat request as `send_cheat` makes it, sent with `send_raw`: the test server's dev access value, the session's
 * access token and a valid signature. Gives the error code of its `ResponseEnvelope`, 0 for a success.
 */
async function raw_cheat(server: TestServer, session: TestSession, name: string, body: Uint8Array): Promise<number | undefined> {
  const request_id = randomUUID();
  const timestamp = server.shared.clock.now().toString();
  const headers = {
    'Content-Type': 'application/x-protobuf',
    'X-Ogw-Request-Id': request_id,
    'X-Ogw-Data-Version': server.shared.data_version,
    'X-Ogw-Client-Version': '',
    'X-Ogw-Platform': 'linux',
    Authorization: `Bearer ${session.access_token}`,
    'X-Ogw-Timestamp': timestamp,
    'X-Ogw-Signature': sign_request(session.session_signing_key, name, request_id, timestamp, body),
    'X-Ogw-Dev-Access': server.dev_access,
  };
  const reply = await send_raw(server, 'POST', `/${name}`, headers, body);
  expect(reply.status).toBe(200);
  const envelope = CoreContract.ResponseEnvelope.decode(reply.body);
  return envelope === null ? undefined : (envelope.error?.code ?? 0);
}

describe('requests', () => {
  it('two requests with the same seed get the same random seed, and seeds of concurrent requests do not mix', async () => {
    const server = await start_test_server();
    try {
      const session = await login(server, 'seeds');
      const same = [randomUUID(), randomUUID()];
      await resync(session, same[0], 42n);
      await resync(session, same[1], 42n);
      const concurrent = [1n, 2n, 3n, 4n, 5n].map((seed) => ({ id: randomUUID(), seed }));
      await Promise.all(concurrent.map((c) => resync(session, c.id, c.seed)));
      const seeds = seeds_by_request(read_logs(server, 'request'));
      expect(seeds.get(same[0] ?? '')).toBe('42');
      expect(seeds.get(same[1] ?? '')).toBe('42');
      for (const c of concurrent) expect(seeds.get(c.id)).toBe(c.seed.toString());
    } finally {
      await stop_test_server(server);
    }
  });

  it('the request time after advance_time is later by that much', async () => {
    const server = await start_test_server(1_767_225_600_000n);
    try {
      const session = await login(server, 'advance');
      const before = (await resync(session)).envelope.server_time_at;
      advance_time(server, 12_345n);
      expect((await resync(session)).envelope.server_time_at).toBe(before + 12_345n);
      expect(() => {
        advance_time(server, -1n);
      }).toThrow();
    } finally {
      await stop_test_server(server);
    }
  });

  it('a request whose signature header is overridden is UNAUTHORIZED', async () => {
    const server = await start_test_server();
    try {
      const session = await login(server, 'signature');
      expect(error_code(await resync(session))).toBe(0);
      const wrong = await send(session, 'core/Resync', new CoreContract.ResyncRequest(), undefined, undefined, undefined, { 'X-Ogw-Signature': '0'.repeat(64) });
      expect(error_code(wrong)).toBe(UNAUTHORIZED);
    } finally {
      await stop_test_server(server);
    }
  });

  it('the signature covers the encoded request message and a raw body replaces the body after signing', async () => {
    const server = await start_test_server();
    try {
      const session = await login(server, 'raw_body');
      const message = new CoreContract.ResyncRequest();
      const same = await send(session, 'core/Resync', message, undefined, undefined, undefined, undefined, message.encode());
      expect(error_code(same)).toBe(0);
      const other = await send(session, 'core/Resync', message, undefined, undefined, undefined, undefined, Uint8Array.of(0xff));
      expect(error_code(other)).toBe(UNAUTHORIZED);
    } finally {
      await stop_test_server(server);
    }
  });

  it('a STG test server starts in the test process without registerDev; its cheat path is UNAUTHORIZED and send_cheat, call_dev, advance_time, wait_background throw', async () => {
    let dev_calls = 0;
    const registerDev = (): void => {
      dev_calls += 1;
    };
    const server = await start_test_server(undefined, undefined, 'STG', undefined, undefined, undefined, undefined, registerDev);
    try {
      expect(dev_calls).toBe(0);
      const session = await login(server, 'stg');
      expect(session.user_id).toBeGreaterThan(0n);
      // The same request a LOCAL test server takes: the dev access value, a valid session and signature.
      const body = new CoreCheatContract.SetTimeOffsetRequest().encode();
      expect(await raw_cheat(server, session, 'core/cheat/SetTimeOffset', body)).toBe(UNAUTHORIZED);
      await expect(send_cheat(session, 'core/cheat/SetTimeOffset', new CoreCheatContract.SetTimeOffsetRequest())).rejects.toThrow();
      await expect(call_dev(server, 'item-ledger', 'set_balance', [gold_id(), 1n], session.user_id)).rejects.toThrow();
      expect(() => {
        advance_time(server, 1n);
      }).toThrow();
      await expect(wait_background(server)).rejects.toThrow();
    } finally {
      await stop_test_server(server);
    }
  });

  it('send signs with the user_now of a user with a cheat time offset after a GetNotices response and an error response', async () => {
    const server = await start_test_server();
    try {
      const session = await login(server, 'offset_notices');
      // An offset past session.signatureWindowMs and within auth.accessTokenTtlMs: a timestamp of clock_now would be UNAUTHORIZED.
      const offset = new CoreCheatContract.SetTimeOffsetRequest();
      offset.offset_ms = 600_000n;
      expect((await send_cheat(session, 'core/cheat/SetTimeOffset', offset)).envelope.error).toBeNull();
      // GetNotices finds no user, so its server_time_at is clock_now.
      const notices = await send(session, 'core/GetNotices', new CoreContract.GetNoticesRequest());
      expect(notices.envelope.error).toBeNull();
      expect(notices.envelope.server_time_at).toBe(server.shared.clock.now());
      expect(error_code(await resync(session))).toBe(0);
      // A wrong signature ends at step 5 with clock_now.
      const wrong = await send(session, 'core/Resync', new CoreContract.ResyncRequest(), undefined, undefined, undefined, { 'X-Ogw-Signature': '0'.repeat(64) });
      expect(error_code(wrong)).toBe(UNAUTHORIZED);
      expect(error_code(await resync(session))).toBe(0);
    } finally {
      await stop_test_server(server);
    }
  });

  it('send keeps signing with the user_now of a user with a cheat time offset after a Login of another user through the session', async () => {
    const server = await start_test_server();
    try {
      const session = await login(server, 'offset_other_login');
      // An offset past session.signatureWindowMs and within auth.accessTokenTtlMs: a timestamp of clock_now would be UNAUTHORIZED.
      const offset = new CoreCheatContract.SetTimeOffsetRequest();
      offset.offset_ms = 600_000n;
      expect((await send_cheat(session, 'core/cheat/SetTimeOffset', offset)).envelope.error).toBeNull();
      // A social Login through the session logs in a new user with no offset; its server_time_at is that user's time.
      const other = await social_login(session, CoreContract.LoginProvider.LOGIN_PROVIDER_GOOGLE, 'fake:offset_other');
      expect(other.envelope.error).toBeNull();
      const other_user = (other.response as CoreContract.LoginResponse).result?.user_id;
      expect(other_user).not.toBe(session.user_id);
      expect(other.envelope.server_time_at).toBe(server.shared.clock.now());
      const after = await resync(session);
      expect(error_code(after)).toBe(0);
      expect(after.envelope.server_time_at).toBe(server.shared.clock.now() + 600_000n);
    } finally {
      await stop_test_server(server);
    }
  });

  it('a LOCAL test server takes the cheat request a STG test server rejects', async () => {
    const server = await start_test_server();
    try {
      const session = await login(server, 'local_cheat');
      expect(await raw_cheat(server, session, 'core/cheat/SetTimeOffset', new CoreCheatContract.SetTimeOffsetRequest().encode())).toBe(0);
    } finally {
      await stop_test_server(server);
    }
  });

  it('send_admin calls an admin operation as an operator; an overridden secret is 401 and operator read on an economy operation is 403', async () => {
    const server = await start_test_server();
    try {
      expect((await send_admin(server, 'get_switches', {})).status).toBe(200);
      expect((await send_admin(server, 'get_switches', {}, undefined, 'not-the-secret')).status).toBe(401);
      expect((await send_admin(server, 'get_switches', {}, 'read')).status).toBe(200);
      expect((await send_admin(server, 'grant_items', {}, 'read')).status).toBe(403);
    } finally {
      await stop_test_server(server);
    }
  });
});
