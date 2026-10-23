/**
 * Unit tests of the account token, the fake adapter and the real adapters with an outgoing HTTP adapter that answers
 * in the test, a test certificate chain carrying Apple's marker extensions, and keys made in the test.
 */
import { createHmac, createPublicKey, generateKeyPairSync, sign, verify, X509Certificate } from 'node:crypto';
import { readFileSync } from 'node:fs';
import * as CoreContract from '../../../generated/contract/core_contract.ts';
import { account_token_of } from '../account_token.ts';
import { is_failure, within_limit, type AdapterCall, type HttpFetch, type StoreTransaction } from '../adapter.ts';
import { apple_transaction_id, create_apple_adapter, APPLE_INTERMEDIATE_OID, APPLE_LEAF_OID, APPLE_ROOT_CA_G3 } from '../adapters/apple.ts';
import { create_google_adapter } from '../adapters/google.ts';
import { base64url, has_oid, verify_rs256_jwks, verify_x5c_jws } from '../adapters/jws.ts';
import { create_fake_adapter, parse_fake_notification, sign_fake_notification } from '../dev/adapters/fake.ts';

const chain = JSON.parse(readFileSync(new URL('./fixtures/apple-test-chain.json', import.meta.url), 'utf8')) as Record<'root' | 'intermediate' | 'leaf' | 'plain_leaf' | 'leaf_key', string>;
const NOW = 1_772_409_600_000n;
const der = (pem: string): string => new X509Certificate(pem).raw.toString('base64');

function call(now: bigint = NOW): AdapterCall {
  return { signal: new AbortController().signal, now, app_id: 'com.example.app', fake_subscription_period_ms: 300_000 };
}

/** An ES256 JWS signed by the test leaf with the given x5c chain. */
function signed(payload: Record<string, unknown>, leaf = chain.leaf): string {
  const header = { alg: 'ES256', x5c: [der(leaf), der(chain.intermediate), der(chain.root)] };
  const input = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(payload))}`;
  const signature = sign('sha256', Buffer.from(input), { key: chain.leaf_key, dsaEncoding: 'ieee-p1363' });
  return `${input}.${base64url(signature)}`;
}

function json_response(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

interface Recorded {
  readonly url: string;
  readonly init: RequestInit;
}

/** An outgoing HTTP adapter that answers by URL and records the requests. */
function http(routes: (url: string, init: RequestInit) => Response): { fetch: HttpFetch; requests: Recorded[] } {
  const requests: Recorded[] = [];
  return {
    requests,
    fetch: (url, init) => {
      requests.push({ url, init });
      return Promise.resolve(routes(url, init));
    },
  };
}

const API_KEY = generateKeyPairSync('ec', { namedCurve: 'P-256' });
const API_KEY_PEM = API_KEY.privateKey.export({ type: 'pkcs8', format: 'pem' });

function apple(fetch: HttpFetch, name: 'iap-apple' | 'iap-apple-sandbox' = 'iap-apple', max = 1_048_576) {
  return create_apple_adapter({
    name,
    private_key_pem: API_KEY_PEM,
    key_id: 'KEY1',
    issuer_id: 'issuer-1',
    bundle_id: 'com.example.app',
    app_apple_id: 1234,
    fetch,
    key_source: () => Promise.resolve([chain.root]),
    max_response_bytes: max,
  });
}

const TX = { transactionId: '2000001', originalTransactionId: '2000000', productId: 'gems_apple', bundleId: 'com.example.app', purchaseDate: 1_772_400_000_000, environment: 'Sandbox', appAccountToken: 'AAAAAAAA-BBBB-4CCC-8DDD-EEEEEEEEEEEE' };

describe('account token', () => {
  it('is the first 16 bytes of HMAC-SHA256 of the user ID text in lowercase UUID form, the same for the same user', () => {
    const token = account_token_of('key', 42n);
    const hex = createHmac('sha256', 'key').update('42').digest('hex').slice(0, 32);
    expect(token).toBe(`${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`);
    expect(account_token_of('key', 42n)).toBe(token);
    expect(account_token_of('key', 43n)).not.toBe(token);
    expect(account_token_of('other', 42n)).not.toBe(token);
  });
});

describe('time limit', () => {
  it('gives timeout when the signal aborts before the call ends, and communication_failure for a throw', async () => {
    const controller = new AbortController();
    const time = { network_time_limit: () => controller.signal };
    const pending = within_limit(time, 10, () => new Promise<string>(() => undefined));
    controller.abort();
    expect(await pending).toBe('timeout');
    expect(await within_limit({ network_time_limit: () => new AbortController().signal }, 10, () => Promise.reject(new Error('x')))).toBe('communication_failure');
    expect(await within_limit({ network_time_limit: () => new AbortController().signal }, 10, () => Promise.resolve('ok'))).toBe('ok');
  });
});

describe('fake adapter', () => {
  it('reads fake receipts; results, test flag, purchase time and app ID follow the controller; unset is VALID test transaction', async () => {
    const { adapter, controller } = create_fake_adapter('iap-apple');
    const first = await adapter.verify('fake:gems_apple:t-1:tok', call());
    expect(first).toEqual({ status: 'VALID', transaction: { sku: 'gems_apple', transaction_id: 't-1', account_token: 'tok', original_transaction_id: 't-1', app_id: 'com.example.app', purchased_at: NOW, test: true, device_receipt: true, ack: null } });
    const empty_token = await adapter.verify('fake:gems_apple:t-2:', call());
    expect(is_failure(empty_token) ? null : empty_token.transaction?.account_token).toBe('');
    const with_original = await adapter.verify('fake:vip_apple:t-3:tok:o-1', call());
    expect(is_failure(with_original) ? null : with_original.transaction?.original_transaction_id).toBe('o-1');
    expect(await adapter.verify('nope', call())).toEqual({ status: 'INVALID', transaction: null });
    controller.set_result('verify', { result: 'PENDING', test: false, purchased_at: '5', app_id: 'com.other' });
    const pending = await adapter.verify('fake:gems_apple:t-4:tok', call());
    expect(is_failure(pending) ? null : [pending.status, pending.transaction?.test, pending.transaction?.purchased_at, pending.transaction?.app_id]).toEqual(['PENDING', false, 5n, 'com.other']);
    controller.set_failure('verify', 'timeout');
    expect(await adapter.verify('fake:gems_apple:t-5:tok', call())).toBe('timeout');
    controller.set_failure('verify', null);
    expect(controller.calls().filter((c) => c.operation === 'verify')).toHaveLength(6);
    expect(() => {
      controller.set_result('verify', 'MAYBE');
    }).toThrow();
    expect(() => {
      controller.set_failure('verify', 'boom' as never);
    }).toThrow();
    expect(() => {
      create_fake_adapter('ads');
    }).toThrow();
  });

  it('gives the subscription snapshot from the last verified store transaction, the controller result and a one-time snapshot', async () => {
    const { adapter, controller } = create_fake_adapter('iap-google');
    await adapter.verify('fake:vip_google:s-1:tok', call());
    expect(await adapter.lookup_subscription('s-1', null, call())).toEqual({
      state: CoreContract.SubscriptionState.SUBSCRIPTION_STATE_ACTIVE,
      ends_at: NOW + 300_000n,
      auto_renew: true,
      latest_transaction_id: 's-1',
      sku: 'vip_google',
      purchased_at: NOW,
      test: true,
    });
    controller.set_result('lookup_subscription', { state: 'GRACE_PERIOD', ends_at: 99 });
    adapter.set_snapshot('s-1', { latest_transaction_id: 's-2', state: 'SUBSCRIPTION_STATE_EXPIRED' });
    const once = await adapter.lookup_subscription('s-1', null, call());
    expect(is_failure(once) ? null : [once.state, once.ends_at, once.latest_transaction_id]).toEqual([CoreContract.SubscriptionState.SUBSCRIPTION_STATE_EXPIRED, 99n, 's-2']);
    const after = await adapter.lookup_subscription('s-1', null, call());
    expect(is_failure(after) ? null : [after.state, after.latest_transaction_id]).toEqual([CoreContract.SubscriptionState.SUBSCRIPTION_STATE_GRACE_PERIOD, 's-1']);
    expect(await adapter.lookup_subscription('unknown', null, call())).toBe('rejected');
    controller.set_failure('lookup_subscription', 'communication_failure');
    expect(await adapter.lookup_subscription('s-1', null, call())).toBe('communication_failure');
    expect(() => {
      controller.set_result('lookup_subscription', { state: 'SLEEPING' });
    }).toThrow();
  });

  it('records purchase acknowledgements with their kind and fails them by the controller', async () => {
    const { adapter, controller } = create_fake_adapter('iap-google');
    const tx: StoreTransaction = { transaction_id: 'a-1', original_transaction_id: 'a-1', sku: 's', app_id: 'x', account_token: '', purchased_at: 0n, test: true, device_receipt: true, ack: null };
    expect(await adapter.acknowledge(tx, 'consume', call())).toBeNull();
    controller.set_failure('acknowledge', 'rejected');
    expect(await adapter.acknowledge(tx, 'acknowledge', call())).toBe('rejected');
    expect(controller.calls().map((c) => c.input)).toEqual([
      { transaction_id: 'a-1', kind: 'consume' },
      { transaction_id: 'a-1', kind: 'acknowledge' },
    ]);
  });

  it('marks a receipt as a device receipt unless the controller verify result sets device_receipt false', async () => {
    const { adapter, controller } = create_fake_adapter('iap-google');
    const device = async (): Promise<boolean | undefined> => {
      const got = await adapter.verify('fake:gems_google:d-1:tok', call());
      return is_failure(got) ? undefined : got.transaction?.device_receipt;
    };
    expect(await device()).toBe(true);
    controller.set_result('verify', { result: 'VALID', device_receipt: false });
    expect(await device()).toBe(false);
    controller.set_result('verify', 'VALID');
    expect(await device()).toBe(true);
    expect(() => {
      controller.set_result('verify', { result: 'VALID', device_receipt: 'no' });
    }).toThrow();
  });

  it('holds verify and lookup calls until release(n) lets the first n go, or hold(false) lets all go', async () => {
    const { adapter, controller } = create_fake_adapter('iap-apple');
    controller.hold(true);
    const order: string[] = [];
    const first = adapter.verify('fake:gems_apple:h-1:tok', call()).then(() => {
      order.push('first');
    });
    const second = adapter.lookup_subscription('h-2', null, call()).then(() => {
      order.push('second');
    });
    const third = adapter.verify('fake:gems_apple:h-3:tok', call()).then(() => {
      order.push('third');
    });
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(order).toEqual([]);
    controller.release(1);
    await first;
    expect(order).toEqual(['first']);
    controller.hold(false);
    await Promise.all([second, third]);
    expect(order).toEqual(['first', 'second', 'third']);
    expect(() => {
      controller.release(-1);
    }).toThrow();
  });

  it('reads a fake notification body only in the JSON form and with the HMAC-SHA256 signature of the key', () => {
    const key = Buffer.alloc(32, 7);
    const body = Buffer.from(JSON.stringify({ notification_id: 'n-1', kind: 'REFUND', transaction_id: 't-1' }));
    const good = { 'x-ogw-fake-signature': sign_fake_notification(key, body) };
    expect(parse_fake_notification(key, good, body)).toEqual({ notification_id: 'n-1', kind: 'REFUND', value: 't-1' });
    expect(parse_fake_notification(key, {}, body)).toBe('bad_signature');
    expect(parse_fake_notification(Buffer.alloc(32, 8), good, body)).toBe('bad_signature');
    expect(parse_fake_notification(key, good, Buffer.from('not json'))).toBe('bad_format');
    const other = Buffer.from(JSON.stringify({ notification_id: 'n-2', kind: 'PAUSE', transaction_id: '' }));
    expect(parse_fake_notification(key, { 'x-ogw-fake-signature': sign_fake_notification(key, other) }, other)).toBe('bad_format');
  });
});

describe('JWS certificate chain', () => {
  it('checks the x5c chain up to the root, Apple marker extensions and the leaf signature', () => {
    const roots = [new X509Certificate(chain.root)];
    expect(has_oid(new X509Certificate(chain.leaf), APPLE_LEAF_OID)).toBe(true);
    expect(has_oid(new X509Certificate(chain.intermediate), APPLE_INTERMEDIATE_OID)).toBe(true);
    expect(has_oid(new X509Certificate(chain.plain_leaf), APPLE_LEAF_OID)).toBe(false);
    expect(verify_x5c_jws(signed({ a: 1 }), roots, APPLE_LEAF_OID, APPLE_INTERMEDIATE_OID, NOW)).toEqual({ a: 1 });
    expect(verify_x5c_jws(signed({ a: 1 }, chain.plain_leaf), roots, APPLE_LEAF_OID, APPLE_INTERMEDIATE_OID, NOW)).toBeNull();
    expect(verify_x5c_jws(signed({ a: 1 }), [new X509Certificate(APPLE_ROOT_CA_G3)], APPLE_LEAF_OID, APPLE_INTERMEDIATE_OID, NOW)).toBeNull();
    const [h, , s] = signed({ a: 1 }).split('.');
    expect(verify_x5c_jws(`${h ?? ''}.${base64url(JSON.stringify({ a: 2 }))}.${s ?? ''}`, roots, APPLE_LEAF_OID, APPLE_INTERMEDIATE_OID, NOW)).toBeNull();
    expect(verify_x5c_jws(signed({ a: 1 }), roots, APPLE_LEAF_OID, APPLE_INTERMEDIATE_OID, 4_102_444_800_001n)).toBeNull();
  });

  it('keeps Apple Root CA - G3 in the code', () => {
    expect(new X509Certificate(APPLE_ROOT_CA_G3).fingerprint256.replaceAll(':', '')).toBe('63343ABFB89A6A03EBB57E9B3F5FA7BE7C4F5C756F3017B3A8C488C3653E9179');
  });
});

describe('iap-apple', () => {
  it('takes the transaction ID from a transaction JWS or digits', () => {
    expect(apple_transaction_id('2000001')).toBe('2000001');
    expect(apple_transaction_id(signed(TX))).toBe('2000001');
    expect(apple_transaction_id('fake:x:y:z')).toBeNull();
  });

  it('looks in production, then in sandbox for a sandbox store transaction, with an ES256 bearer JWT; a VALID test transaction from sandbox', async () => {
    const { fetch, requests } = http((url) =>
      url.startsWith('https://api.storekit.itunes.apple.com') ? json_response(404, {}) : json_response(200, { signedTransactionInfo: signed(TX) }),
    );
    const result = await apple(fetch).verify('2000001', call());
    expect(result).toEqual({
      status: 'VALID',
      transaction: { transaction_id: '2000001', original_transaction_id: '2000000', sku: 'gems_apple', app_id: 'com.example.app', account_token: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee', purchased_at: 1_772_400_000_000n, test: true, device_receipt: false, ack: null },
    });
    expect(requests.map((r) => r.url)).toEqual(['https://api.storekit.itunes.apple.com/inApps/v1/transactions/2000001', 'https://api.storekit-sandbox.itunes.apple.com/inApps/v1/transactions/2000001']);
    const bearer = String((requests[0]?.init.headers as Record<string, string>).authorization).slice('Bearer '.length);
    const [h = '', p = '', s = ''] = bearer.split('.');
    expect(JSON.parse(Buffer.from(h, 'base64url').toString())).toEqual({ kid: 'KEY1', alg: 'ES256', typ: 'JWT' });
    expect(JSON.parse(Buffer.from(p, 'base64url').toString())).toEqual({ iss: 'issuer-1', iat: 1_772_409_600, exp: 1_772_409_900, aud: 'appstoreconnect-v1', bid: 'com.example.app' });
    expect(verify('sha256', Buffer.from(`${h}.${p}`), { key: createPublicKey(API_KEY_PEM), dsaEncoding: 'ieee-p1363' }, Buffer.from(s, 'base64url'))).toBe(true);
  });

  it('a transaction JWS receipt that passes the certificate chain check and names the verified transaction is a device receipt; a transaction ID receipt and a JWS that fails the chain check are not', async () => {
    const answer = http(() => json_response(200, { signedTransactionInfo: signed(TX) }));
    const device = async (receipt: string): Promise<boolean | undefined> => {
      const got = await apple(answer.fetch).verify(receipt, call());
      if (is_failure(got)) return undefined;
      expect(got.status).toBe('VALID');
      return got.transaction?.device_receipt;
    };
    expect(await device(signed(TX))).toBe(true);
    expect(await device('2000001')).toBe(false);
    expect(await device(signed(TX, chain.plain_leaf))).toBe(false);
    expect(await device(signed({ ...TX, transactionId: '2000002' }))).toBe(false);
    const [h, , s] = signed(TX).split('.');
    expect(await device(`${h ?? ''}.${base64url(JSON.stringify({ ...TX, originalTransactionId: '1' }))}.${s ?? ''}`)).toBe(false);
  });

  it('iap-apple-sandbox asks sandbox only; another bundle ID and a revoked transaction are INVALID; a response body over the limit is communication_failure', async () => {
    const sandbox = http(() => json_response(200, { signedTransactionInfo: signed({ ...TX, bundleId: 'com.other' }) }));
    const other = await apple(sandbox.fetch, 'iap-apple-sandbox').verify('2000001', call());
    expect(is_failure(other) ? other : other.status).toBe('INVALID');
    expect(sandbox.requests.map((r) => r.url.split('/inApps')[0])).toEqual(['https://api.storekit-sandbox.itunes.apple.com']);
    const revoked = http(() => json_response(200, { signedTransactionInfo: signed({ ...TX, revocationDate: 1 }) }));
    const r = await apple(revoked.fetch).verify('2000001', call());
    expect(is_failure(r) ? r : r.status).toBe('INVALID');
    const big = http(() => json_response(200, { signedTransactionInfo: signed(TX), pad: 'x'.repeat(4000) }));
    expect(await apple(big.fetch, 'iap-apple', 1000).verify('2000001', call())).toBe('communication_failure');
    const down = http(() => json_response(503, {}));
    expect(await apple(down.fetch).verify('2000001', call())).toBe('communication_failure');
    const missing = http(() => json_response(404, {}));
    expect(await apple(missing.fetch).verify('2000001', call())).toEqual({ status: 'INVALID', transaction: null });
  });

  it('maps the subscription status lookup', async () => {
    const tx = { ...TX, productId: 'vip_apple', expiresDate: 1_772_500_000_000 };
    const statuses = http(() =>
      json_response(200, {
        data: [{ lastTransactions: [{ originalTransactionId: '2000000', status: 4, signedTransactionInfo: signed(tx), signedRenewalInfo: signed({ autoRenewStatus: 1, gracePeriodExpiresDate: 1_772_600_000_000 }) }] }],
      }),
    );
    expect(await apple(statuses.fetch).lookup_subscription('2000000', null, call())).toEqual({
      state: CoreContract.SubscriptionState.SUBSCRIPTION_STATE_GRACE_PERIOD,
      ends_at: 1_772_600_000_000n,
      auto_renew: true,
      latest_transaction_id: '2000001',
      sku: 'vip_apple',
      purchased_at: 1_772_400_000_000n,
      test: true,
    });
  });

  it('reads a signed notification: REFUND gives the transaction ID, DID_RENEW the original transaction ID, others OTHER; a bad chain is bad_signature and a body without signedPayload is bad_format', async () => {
    const adapter = apple(http(() => json_response(500, {})).fetch);
    const body = (type: string, data: Record<string, unknown> = {}): Uint8Array =>
      Buffer.from(JSON.stringify({ signedPayload: signed({ notificationType: type, notificationUUID: `u-${type}`, data: { bundleId: 'com.example.app', environment: 'Sandbox', signedTransactionInfo: signed(TX), ...data } }) }));
    expect(await adapter.parse_notification?.({}, body('REFUND'), call())).toEqual({ notification_id: 'u-REFUND', kind: 'REFUND', value: '2000001' });
    expect(await adapter.parse_notification?.({}, body('DID_RENEW'), call())).toEqual({ notification_id: 'u-DID_RENEW', kind: 'SUBSCRIPTION', value: '2000000' });
    expect(await adapter.parse_notification?.({}, body('TEST'), call())).toEqual({ notification_id: 'u-TEST', kind: 'OTHER', value: '' });
    expect(await adapter.parse_notification?.({}, body('REFUND', { bundleId: 'com.other' }), call())).toBe('bad_signature');
    expect(await adapter.parse_notification?.({}, body('REFUND', { environment: 'Production', appAppleId: 9 }), call())).toBe('bad_signature');
    const forged = Buffer.from(JSON.stringify({ signedPayload: signed({ notificationType: 'REFUND', notificationUUID: 'x' }, chain.plain_leaf) }));
    expect(await adapter.parse_notification?.({}, forged, call())).toBe('bad_signature');
    expect(await adapter.parse_notification?.({}, Buffer.from('{}'), call())).toBe('bad_format');
  });
});

const SERVICE_KEY = generateKeyPairSync('rsa', { modulusLength: 2048 });
const SERVICE_KEY_PEM = SERVICE_KEY.privateKey.export({ type: 'pkcs8', format: 'pem' });
const OIDC_KEY = generateKeyPairSync('rsa', { modulusLength: 2048 });
const JWKS = { keys: [{ ...OIDC_KEY.publicKey.export({ format: 'jwk' }), kid: 'k1', alg: 'RS256', use: 'sig' }] };

function oidc(claims: Record<string, unknown>, key = OIDC_KEY.privateKey): string {
  const input = `${base64url(JSON.stringify({ alg: 'RS256', kid: 'k1', typ: 'JWT' }))}.${base64url(JSON.stringify(claims))}`;
  return `${input}.${base64url(sign('RSA-SHA256', Buffer.from(input), key))}`;
}

function google(fetch: HttpFetch, max = 1_048_576) {
  return create_google_adapter({
    private_key_pem: SERVICE_KEY_PEM,
    service_account_email: 'svc@example.iam.gserviceaccount.com',
    notification_service_account_email: 'push@example.iam.gserviceaccount.com',
    notification_audience: 'https://dev.example.com/iap/notify/google',
    package_name: 'com.example.app',
    is_subscription_sku: (sku) => sku.startsWith('vip'),
    fetch,
    key_source: () => Promise.resolve(JWKS),
    max_response_bytes: max,
    clock_now: () => NOW,
  });
}

const PURCHASE_JSON = JSON.stringify({ orderId: 'GPA.1', packageName: 'com.example.app', productId: 'gems_google', purchaseTime: 1_772_400_000_000, purchaseToken: 'tok-1' });

describe('iap-google', () => {
  it('gets an access token with an RS256 service account JWT and verifies a product purchase; purchaseType 0 is a test transaction', async () => {
    const { fetch, requests } = http((url) => {
      if (url === 'https://oauth2.googleapis.com/token') return json_response(200, { access_token: 'at-1', expires_in: 3600 });
      return json_response(200, { purchaseState: 0, orderId: 'GPA.1', purchaseTimeMillis: '1772400000000', purchaseType: 0, obfuscatedExternalAccountId: 'TOKEN-A' });
    });
    const adapter = google(fetch);
    const result = await adapter.verify(PURCHASE_JSON, call());
    expect(result).toEqual({
      status: 'VALID',
      transaction: { transaction_id: 'GPA.1', original_transaction_id: 'GPA.1', sku: 'gems_google', app_id: 'com.example.app', account_token: 'token-a', purchased_at: 1_772_400_000_000n, test: true, device_receipt: true, ack: { token: 'tok-1', product_id: 'gems_google' } },
    });
    expect(requests[1]?.url).toBe('https://androidpublisher.googleapis.com/androidpublisher/v3/applications/com.example.app/purchases/products/gems_google/tokens/tok-1');
    expect((requests[1]?.init.headers as Record<string, string>).authorization).toBe('Bearer at-1');
    const assertion = new URLSearchParams(requests[0]?.init.body as string).get('assertion') ?? '';
    const [h = '', p = '', s = ''] = assertion.split('.');
    expect(JSON.parse(Buffer.from(p, 'base64url').toString())).toEqual({ iss: 'svc@example.iam.gserviceaccount.com', scope: 'https://www.googleapis.com/auth/androidpublisher', aud: 'https://oauth2.googleapis.com/token', iat: 1_772_409_600, exp: 1_772_413_200 });
    expect(verify('RSA-SHA256', Buffer.from(`${h}.${p}`), SERVICE_KEY.publicKey, Buffer.from(s, 'base64url'))).toBe(true);
    await adapter.verify(PURCHASE_JSON, call());
    expect(requests.filter((r) => r.url === 'https://oauth2.googleapis.com/token')).toHaveLength(1);
  });

  it('PENDING for purchaseState 2, INVALID for a canceled purchase and a token Google does not know, communication_failure for a body over the limit', async () => {
    const answer = (state: number | null, status = 200) =>
      http((url) =>
        url.endsWith('/token') ? json_response(200, { access_token: 'at' }) : state === null ? json_response(status, {}) : json_response(200, { purchaseState: state, orderId: 'GPA.2', purchaseTimeMillis: '1772400000000' }),
      );
    const pending = await google(answer(2).fetch).verify(PURCHASE_JSON, call());
    expect(is_failure(pending) ? pending : pending.status).toBe('PENDING');
    const canceled = await google(answer(1).fetch).verify(PURCHASE_JSON, call());
    expect(is_failure(canceled) ? canceled : canceled.status).toBe('INVALID');
    expect(await google(answer(null, 404).fetch).verify(PURCHASE_JSON, call())).toEqual({ status: 'INVALID', transaction: null });
    expect(await google(answer(null, 500).fetch).verify(PURCHASE_JSON, call())).toBe('communication_failure');
    const big = http((url) => (url.endsWith('/token') ? json_response(200, { access_token: 'at' }) : json_response(200, { purchaseState: 0, pad: 'x'.repeat(4000) })));
    expect(await google(big.fetch, 1000).verify(PURCHASE_JSON, call())).toBe('communication_failure');
    expect(await google(answer(0).fetch).verify('not json', call())).toEqual({ status: 'INVALID', transaction: null });
  });

  it('takes the transaction ID and purchase time from the API response, not from the receipt; a promo code purchase without an API order ID is the purchase token', async () => {
    const forged = (order_id: string): string => JSON.stringify({ ...JSON.parse(PURCHASE_JSON), orderId: order_id, purchaseTime: 1 });
    const answer = (body: Record<string, unknown>) => http((url) => (url.endsWith('/token') ? json_response(200, { access_token: 'at' }) : json_response(200, body)));
    const ordered = answer({ purchaseState: 0, orderId: 'GPA.1', purchaseTimeMillis: '1772400000000' });
    for (const order_id of ['GPA.x-1', 'GPA.x-2', '']) {
      const got = await google(ordered.fetch).verify(forged(order_id), call());
      expect(is_failure(got) ? got : { id: got.transaction?.transaction_id, original: got.transaction?.original_transaction_id, at: got.transaction?.purchased_at }).toEqual({
        id: 'GPA.1',
        original: 'GPA.1',
        at: 1_772_400_000_000n,
      });
    }
    const promo = answer({ purchaseState: 0, purchaseTimeMillis: '1772400000000' });
    for (const order_id of ['GPA.x-1', 'GPA.x-2']) {
      const got = await google(promo.fetch).verify(forged(order_id), call());
      expect(is_failure(got) ? got : [got.transaction?.transaction_id, got.transaction?.original_transaction_id]).toEqual(['tok-1', 'tok-1']);
    }
  });

  it('a subscription receipt: the transaction ID is the order ID of the receipt product line item in subscriptionsv2; a product that is no line item is INVALID', async () => {
    const { fetch } = http((url) => {
      if (url.endsWith('/token')) return json_response(200, { access_token: 'at' });
      return json_response(200, {
        subscriptionState: 'SUBSCRIPTION_STATE_ACTIVE',
        latestOrderId: 'GPA.9..0',
        startTime: '2026-03-01T00:00:00Z',
        lineItems: [{ productId: 'vip_google', latestSuccessfulOrderId: 'GPA.9..1', expiryTime: '2026-04-01T00:00:00Z', autoRenewingPlan: { autoRenewEnabled: true } }],
        externalAccountIdentifiers: { obfuscatedExternalAccountId: 'TOKEN-A' },
      });
    });
    const sub = (product_id: string, order_id: string): string =>
      JSON.stringify({ orderId: order_id, packageName: 'com.example.app', productId: product_id, purchaseTime: 1, purchaseToken: 'sub-token' });
    for (const order_id of ['GPA.x-1', 'GPA.x-2', '']) {
      const got = await google(fetch).verify(sub('vip_google', order_id), call());
      expect(got).toEqual({
        status: 'VALID',
        transaction: {
          transaction_id: 'GPA.9..1',
          original_transaction_id: 'sub-token',
          sku: 'vip_google',
          app_id: 'com.example.app',
          account_token: 'token-a',
          purchased_at: BigInt(Date.parse('2026-03-01T00:00:00Z')),
          test: false,
          device_receipt: true,
          ack: { token: 'sub-token', product_id: 'vip_google' },
        },
      });
    }
    expect(await google(fetch).verify(sub('vip_gold_google', 'GPA.9..1'), call())).toEqual({ status: 'INVALID', transaction: null });
    expect((await google(fetch).lookup_subscription('sub-token', null, call())) as { latest_transaction_id: string }).toMatchObject({ latest_transaction_id: 'GPA.9..1' });
  });

  it('a response without a purchase time is bad_response; a pending subscription, which has no startTime, has no purchase time (the request time)', async () => {
    const answer = (body: Record<string, unknown>) => http((url) => (url.endsWith('/token') ? json_response(200, { access_token: 'at' }) : json_response(200, body)));
    for (const state of [0, 1, 2]) {
      expect(await google(answer({ purchaseState: state, orderId: 'GPA.3' }).fetch).verify(PURCHASE_JSON, call())).toBe('bad_response');
      expect(await google(answer({ purchaseState: state, orderId: 'GPA.3', purchaseTimeMillis: 'soon' }).fetch).verify(PURCHASE_JSON, call())).toBe('bad_response');
    }
    const sub = JSON.stringify({ packageName: 'com.example.app', productId: 'vip_google', purchaseToken: 'sub-token' });
    const line = { productId: 'vip_google', latestSuccessfulOrderId: 'GPA.9..1', expiryTime: '2026-04-01T00:00:00Z' };
    for (const state of ['SUBSCRIPTION_STATE_ACTIVE', 'SUBSCRIPTION_STATE_CANCELED', 'SUBSCRIPTION_STATE_IN_GRACE_PERIOD', 'SUBSCRIPTION_STATE_ON_HOLD', 'SUBSCRIPTION_STATE_EXPIRED']) {
      const { fetch } = answer({ subscriptionState: state, lineItems: [line] });
      expect(await google(fetch).verify(sub, call())).toBe('bad_response');
      expect(await google(fetch).lookup_subscription('sub-token', null, call())).toBe('bad_response');
    }
    for (const [state, status] of [
      ['SUBSCRIPTION_STATE_PENDING', 'PENDING'],
      ['SUBSCRIPTION_STATE_PENDING_PURCHASE_CANCELED', 'INVALID'],
    ] as const) {
      const { fetch } = answer({ subscriptionState: state, lineItems: [line] });
      const got = await google(fetch).verify(sub, call());
      expect(is_failure(got) ? got : [got.status, got.transaction?.purchased_at]).toEqual([status, null]);
      expect((await google(fetch).lookup_subscription('sub-token', null, call())) as { purchased_at: bigint | null }).toMatchObject({ purchased_at: null });
    }
    expect(await google(answer({ subscriptionState: 'SUBSCRIPTION_STATE_UNKNOWN', startTime: '2026-03-01T00:00:00Z', lineItems: [line] }).fetch).lookup_subscription('sub-token', null, call())).toBe('rejected');
  });

  it('a 200 answer whose body is not a JSON object is an adapter call failure for a product, a subscription and a subscription lookup', async () => {
    const answer = (body: string) => http((url) => (url.endsWith('/token') ? json_response(200, { access_token: 'at' }) : new Response(body, { status: 200 })));
    const sub = JSON.stringify({ packageName: 'com.example.app', productId: 'vip_google', purchaseToken: 'sub-token' });
    for (const body of ['not json', '', '[1]', 'null', '"text"', '7']) {
      expect(await google(answer(body).fetch).verify(PURCHASE_JSON, call())).toBe('communication_failure');
      expect(await google(answer(body).fetch).verify(sub, call())).toBe('communication_failure');
      expect(await google(answer(body).fetch).lookup_subscription('sub-token', null, call())).toBe('communication_failure');
    }
  });

  it('maps subscriptionsv2 to a snapshot, and acknowledges by kind, taking an already acknowledged purchase as success', async () => {
    const { fetch, requests } = http((url, init) => {
      if (url.endsWith('/token')) return json_response(200, { access_token: 'at' });
      if (url.includes('subscriptionsv2')) {
        return json_response(200, {
          subscriptionState: 'SUBSCRIPTION_STATE_IN_GRACE_PERIOD',
          latestOrderId: 'GPA.9..1',
          startTime: '2026-03-01T00:00:00Z',
          lineItems: [{ productId: 'vip_google', expiryTime: '2026-04-01T00:00:00Z', autoRenewingPlan: { autoRenewEnabled: true } }],
          acknowledgementState: 'ACKNOWLEDGEMENT_STATE_ACKNOWLEDGED',
        });
      }
      if (init.method === 'POST') return json_response(400, { error: 'already' });
      return json_response(200, { consumptionState: 1, acknowledgementState: 1 });
    });
    const adapter = google(fetch);
    expect(await adapter.lookup_subscription('sub-token', null, call())).toEqual({
      state: CoreContract.SubscriptionState.SUBSCRIPTION_STATE_GRACE_PERIOD,
      ends_at: BigInt(Date.parse('2026-04-01T00:00:00Z')),
      auto_renew: true,
      latest_transaction_id: 'GPA.9..1',
      sku: 'vip_google',
      purchased_at: BigInt(Date.parse('2026-03-01T00:00:00Z')),
      test: false,
    });
    const tx: StoreTransaction = { transaction_id: 'GPA.1', original_transaction_id: 'GPA.1', sku: 'gems_google', app_id: '', account_token: '', purchased_at: 0n, test: false, device_receipt: true, ack: { token: 'tok-1', product_id: 'gems_google' } };
    expect(await adapter.acknowledge(tx, 'consume', call())).toBeNull();
    expect(await adapter.acknowledge(tx, 'acknowledge', call())).toBeNull();
    expect(await adapter.acknowledge({ ...tx, ack: { token: 'sub-token', product_id: 'vip_google' } }, 'subscription_acknowledge', call())).toBeNull();
    expect(requests.filter((r) => r.init.method === 'POST' && !r.url.endsWith('/token')).map((r) => r.url.split('/applications/com.example.app')[1])).toEqual([
      '/purchases/products/gems_google/tokens/tok-1:consume',
      '/purchases/products/gems_google/tokens/tok-1:acknowledge',
      '/purchases/subscriptions/vip_google/tokens/sub-token:acknowledge',
    ]);
  });

  it('reads a Pub/Sub push with an OIDC token of the key source keys, email, email_verified and audience; anything else is bad_signature, a body not in the push form bad_format', async () => {
    const adapter = google(http(() => json_response(500, {})).fetch);
    const good = { iss: 'https://accounts.google.com', email: 'push@example.iam.gserviceaccount.com', email_verified: true, aud: 'https://dev.example.com/iap/notify/google', exp: 1_772_409_700 };
    const push = (inner: Record<string, unknown>): Uint8Array =>
      Buffer.from(JSON.stringify({ message: { messageId: 'm-1', data: Buffer.from(JSON.stringify({ packageName: 'com.example.app', ...inner })).toString('base64') }, subscription: 's' }));
    const headers = (claims: Record<string, unknown>, key = OIDC_KEY.privateKey) => ({ authorization: `Bearer ${oidc(claims, key)}` });
    expect(await adapter.parse_notification?.(headers(good), push({ voidedPurchaseNotification: { orderId: 'GPA.1', purchaseToken: 't' } }), call())).toEqual({ notification_id: 'm-1', kind: 'REFUND', value: 'GPA.1' });
    expect(await adapter.parse_notification?.(headers(good), push({ subscriptionNotification: { notificationType: 2, purchaseToken: 'sub-token' } }), call())).toEqual({ notification_id: 'm-1', kind: 'SUBSCRIPTION', value: 'sub-token' });
    expect(await adapter.parse_notification?.(headers(good), push({ subscriptionNotification: { notificationType: 4, purchaseToken: 'sub-token' } }), call())).toEqual({ notification_id: 'm-1', kind: 'OTHER', value: '' });
    expect(await adapter.parse_notification?.(headers(good), push({ testNotification: {} }), call())).toEqual({ notification_id: 'm-1', kind: 'OTHER', value: '' });
    for (const claims of [{ ...good, aud: 'https://other' }, { ...good, email: 'x@y' }, { ...good, email_verified: false }, { ...good, exp: 1 }, { ...good, iss: 'evil' }]) {
      expect(await adapter.parse_notification?.(headers(claims), push({ testNotification: {} }), call())).toBe('bad_signature');
    }
    expect(await adapter.parse_notification?.(headers(good, generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey), push({ testNotification: {} }), call())).toBe('bad_signature');
    expect(await adapter.parse_notification?.({}, push({ testNotification: {} }), call())).toBe('bad_signature');
    expect(await adapter.parse_notification?.(headers(good), push({ packageName: 'com.other' }), call())).toBe('bad_signature');
    expect(await adapter.parse_notification?.(headers(good), Buffer.from('{}'), call())).toBe('bad_format');
    expect(verify_rs256_jwks(oidc(good), JWKS)).toEqual(good);
  });
});
