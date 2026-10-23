import { createHash, createSign, generateKeyPairSync, randomUUID, type KeyObject } from 'node:crypto';
import * as CoreContract from '../../../generated/contract/core_contract.ts';
import {
  advance_time,
  call_dev,
  close,
  connect,
  fake,
  load_data,
  login,
  read_frame,
  read_user_state,
  send,
  send_admin,
  send_frame,
  send_raw,
  set_key_source,
  start_test_server,
  stop_test_server,
  wait_background,
  type RealtimeConnection,
  type TestServer,
  type TestSession,
} from '../dev/index.ts';
import { error_code, missing, resync, social_login, type FakeControl } from './helpers.ts';

const SOCIAL_LOGIN_INVALID = CoreContract.CoreError.CORE_ERROR_SOCIAL_LOGIN_INVALID;
const EXTERNAL_SERVICE_FAILED = CoreContract.CoreError.CORE_ERROR_EXTERNAL_SERVICE_FAILED;
const GOOGLE = CoreContract.LoginProvider.LOGIN_PROVIDER_GOOGLE;

function base64url(value: string | Buffer): string {
  return Buffer.from(value).toString('base64url');
}

interface TestKey {
  readonly kid: string;
  readonly private_key: KeyObject;
  readonly jwk: Record<string, unknown>;
}

function test_key(kid: string): TestKey {
  const pair = generateKeyPairSync('rsa', { modulusLength: 2048 });
  return { kid, private_key: pair.privateKey, jwk: { ...pair.publicKey.export({ format: 'jwk' }), kid, alg: 'RS256', use: 'sig' } };
}

/** A Google ID token signed by `key` (RS256). */
function google_token(key: TestKey, claims: Record<string, unknown>): string {
  const head = base64url(JSON.stringify({ alg: 'RS256', kid: key.kid, typ: 'JWT' }));
  const body = base64url(JSON.stringify(claims));
  const signature = createSign('RSA-SHA256').update(`${head}.${body}`).sign(key.private_key);
  return `${head}.${body}.${base64url(signature)}`;
}

function google_claims(server: TestServer, now_ms: bigint): Record<string, unknown> {
  const exp = Number(now_ms / 1000n) + 3600;
  return { iss: 'https://accounts.google.com', aud: server.settings()['loginGoogle.serverClientId'], sub: 'google-account-1', iat: exp - 7200, exp };
}

async function hello(server: TestServer, session: TestSession): Promise<RealtimeConnection> {
  const connection = await connect(server);
  const frame = new CoreContract.MatchmakerFrame();
  frame.kind = CoreContract.MatchmakerFrameKind.MATCHMAKER_FRAME_KIND_HELLO;
  frame.access_token = session.access_token;
  frame.data_version = server.shared.data_version;
  frame.client_version = '';
  send_frame(connection, frame);
  return connection;
}

/** Reads frames until one of `kind`. */
async function frame_of(connection: RealtimeConnection, kind: CoreContract.MatchmakerFrameKind): Promise<CoreContract.MatchmakerFrame> {
  for (;;) {
    const frame = await read_frame(connection, 10_000n);
    if (frame === null) throw new Error('the realtime connection closed');
    if (frame.kind === kind) return frame;
  }
}

describe('fake adapters', () => {
  it('a result and a failure condition set on a fake adapter are used by the next call, and the calls are recorded', async () => {
    const server = await start_test_server();
    try {
      const session = await login(server, 'fake_user');
      const google = fake(server, 'login-google') as FakeControl;
      google.set_failure('verify', 'rejected');
      expect(error_code(await social_login(session, GOOGLE, 'fake:account_a'))).toBe(SOCIAL_LOGIN_INVALID);
      google.set_failure('verify', 'timeout');
      expect(error_code(await social_login(session, GOOGLE, 'fake:account_a'))).toBe(EXTERNAL_SERVICE_FAILED);
      google.set_failure('verify', null);
      expect(error_code(await social_login(session, GOOGLE, 'fake:account_a'))).toBe(0);
      expect(google.calls().filter((call) => call.operation === 'verify')).toHaveLength(3);
      expect(() => fake(server, 'no-such-service')).toThrow();
    } finally {
      await stop_test_server(server);
    }
  });

  // `iap` is not in this core yet.
  it.skipIf(missing('iap'))('a subscription snapshot set by the fake controller is used by the next VerifyPurchase and by send_fake_subscription_notify', async () => {
    const server = await start_test_server();
    try {
      const session = await login(server, 'subscriber');
      const product_id = load_data().dev.find_id_value('[testing_subscription]');
      const check = new CoreContract.CheckPurchaseRequest();
      check.store = CoreContract.IapStore.IAP_STORE_APPLE;
      check.product_id = product_id;
      const token = (await send(session, 'core/CheckPurchase', check)).response as CoreContract.CheckPurchaseResponse;
      const apple = fake(server, 'iap-apple') as FakeControl;
      const now = (await resync(session)).envelope.server_time_at;
      const snapshot = (ends_at: bigint): Record<string, unknown> => ({
        state: CoreContract.SubscriptionState.SUBSCRIPTION_STATE_ACTIVE,
        ends_at,
        auto_renew: false,
        latest_transaction_id: 'testing_tx_1',
        sku: 'testing.subscription.apple',
        purchased_at: now,
        test: true,
      });
      apple.set_result('lookup_subscription', snapshot(now + 1_000_000n));
      const verify = new CoreContract.VerifyPurchaseRequest();
      verify.store = CoreContract.IapStore.IAP_STORE_APPLE;
      verify.receipt = `fake:testing.subscription.apple:testing_tx_1:${token.account_token}`;
      expect(error_code(await send(session, 'core/VerifyPurchase', verify))).toBe(0);
      const ends_at = async (): Promise<bigint | null> => {
        const item = (await read_user_state(server, session.user_id)).find((i) => i.kind === 'SubscriptionUserState');
        return item === undefined ? null : (item.value as CoreContract.SubscriptionUserState).ends_at;
      };
      expect(await ends_at()).toBe(now + 1_000_000n);
      const status = await call_dev(server, 'iap', 'send_fake_subscription_notify', [CoreContract.IapStore.IAP_STORE_APPLE, 'testing_tx_1', snapshot(now + 2_000_000n)]);
      expect(status).toBe(200);
      expect(await ends_at()).toBe(now + 2_000_000n);
    } finally {
      await stop_test_server(server);
    }
  });

  // `matchmaker` and `p2p-signaling` are not in this core yet.
  it.skipIf(missing('matchmaker', 'p2p-signaling'))('a turn relay set by the fake controller is used by the next call', async () => {
    const server = await start_test_server(undefined, undefined, undefined, true);
    try {
      const relay = { url: 'turn:relay.example.com:3478', username: 'testing', credential: 'secret' };
      (fake(server, 'turn') as FakeControl).set_result('issue_relays', [relay]);
      const mode_id = load_data().dev.find_id_value('[testing_duel]');
      const connections: RealtimeConnection[] = [];
      for (const name of ['turn_a', 'turn_b']) {
        const connection = await hello(server, await login(server, name));
        await frame_of(connection, CoreContract.MatchmakerFrameKind.MATCHMAKER_FRAME_KIND_HELLO_ACK);
        const request = new CoreContract.MatchmakerFrame();
        request.kind = CoreContract.MatchmakerFrameKind.MATCHMAKER_FRAME_KIND_MATCH_REQUEST;
        request.mode_id = mode_id;
        send_frame(connection, request);
        connections.push(connection);
      }
      // A connection handles its frames in order: the MATCH_REJOINED of an unknown match comes after the MATCH_REQUEST.
      for (const connection of connections) {
        const rejoin = new CoreContract.MatchmakerFrame();
        rejoin.kind = CoreContract.MatchmakerFrameKind.MATCHMAKER_FRAME_KIND_MATCH_REJOIN;
        rejoin.match_id = 'none';
        send_frame(connection, rejoin);
        await frame_of(connection, CoreContract.MatchmakerFrameKind.MATCHMAKER_FRAME_KIND_MATCH_REJOINED);
      }
      // The test clock moves only by the test: one matchmaker_tick.
      advance_time(server, 1_000n);
      await wait_background(server);
      for (const connection of connections) {
        const found = await frame_of(connection, CoreContract.MatchmakerFrameKind.MATCHMAKER_FRAME_KIND_MATCH_FOUND);
        expect(found.transport?.relays.map((r) => r.url)).toEqual([relay.url]);
        close(connection);
      }
    } finally {
      await stop_test_server(server);
    }
  });

  it('a cdn base URL set by the fake controller is used by the next call', async () => {
    const server = await start_test_server();
    try {
      const cdn = fake(server, 'cdn') as FakeControl;
      cdn.set_result('base_url', 'https://cdn.example.com/files/');
      cdn.set_result('put', true);
      const bytes = new TextEncoder().encode('testing update file');
      const sha256 = createHash('sha256').update(bytes).digest('hex');
      expect((await send_admin(server, 'put_update_file', { binary: bytes, query: { sha256 } }, 'ogw')).status).toBe(200);
      const published = await send_admin(server, 'publish_deploy_list', {
        app: { linux: { min_version: '1.0.0', recommended_version: '1.0.0', store_url: 'https://example.com/app' } },
        patches: { '1.0.0': { data_version: server.shared.data_version, data_files: [{ name: 'item.bin', size: bytes.length, sha256 }], translation_files: [], bundle_files: [] } },
      });
      expect(published.status).toBe(200);
      const list = await send_raw(server, 'GET', '/update/deploy_list.json', {}, null);
      expect((JSON.parse(new TextDecoder().decode(list.body)) as { file_base_url: string }).file_base_url).toBe('https://cdn.example.com/files/');
    } finally {
      await stop_test_server(server);
    }
  });

  // `ads-reward` is not in this core yet.
  it.skipIf(missing('ads-reward'))('GET /ads/callback/fake is HTTP 503 when the fake ads key list fetch fails', async () => {
    const server = await start_test_server();
    try {
      const session = await login(server, 'ads_user');
      const ads = fake(server, 'ads') as FakeControl & { sign_callback(notify_id: string, user_id: bigint, key_id: number): string };
      const query = ads.sign_callback(randomUUID(), session.user_id, 1);
      ads.set_failure('fetch_keys', 'communication_failure');
      expect((await send_raw(server, 'GET', `/ads/callback/fake?${query}`, {}, null)).status).toBe(503);
    } finally {
      await stop_test_server(server);
    }
  });
});

describe('real adapters', () => {
  it('real login-google verifies only tokens signed by the key source key; before set_key_source Login is EXTERNAL_SERVICE_FAILED', async () => {
    const server = await start_test_server(undefined, undefined, undefined, undefined, { 'login-google': 'login-google' }, { 'loginGoogle.serverClientId': 'testing-server-client', 'loginGoogle.desktopClientId': 'testing-desktop-client' });
    try {
      const session = await login(server, 'google_real');
      const key = test_key('testing-key');
      const other = test_key('testing-key');
      const now = (await resync(session)).envelope.server_time_at;
      const token = google_token(key, google_claims(server, now));
      expect(error_code(await social_login(session, GOOGLE, token))).toBe(EXTERNAL_SERVICE_FAILED);
      set_key_source(server, 'login-google', { keys: [key.jwk] });
      expect(error_code(await social_login(session, GOOGLE, token))).toBe(0);
      expect(error_code(await social_login(session, GOOGLE, google_token(other, google_claims(server, now))))).toBe(SOCIAL_LOGIN_INVALID);
      // A desktop credential needs the Google token endpoint: an outgoing call outside the key source fails.
      const desktop = JSON.stringify({ authorization_code: 'code', code_verifier: 'verifier', redirect_uri: 'http://127.0.0.1:8123' });
      expect(error_code(await social_login(session, GOOGLE, desktop))).toBe(EXTERNAL_SERVICE_FAILED);
      expect(() => {
        set_key_source(server, 'login-apple', { keys: [] });
      }).toThrow();
      expect(() => fake(server, 'login-google')).toThrow();
    } finally {
      await stop_test_server(server);
    }
  });

  it('a test server with real login-apple starts without the host secret store', async () => {
    const server = await start_test_server(undefined, undefined, undefined, undefined, { 'login-apple': 'login-apple' });
    try {
      expect(server.shared.secrets.file.loginApple).toContain('BEGIN PRIVATE KEY');
      expect((await login(server, 'apple_real')).user_id).toBeGreaterThan(0n);
    } finally {
      await stop_test_server(server);
    }
  });
});
