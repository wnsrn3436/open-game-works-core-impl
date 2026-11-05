/**
 * `VerifyPurchase` and `RecoverPurchase` through the real `iap-google`, `iap-apple` and `iap-apple-sandbox` adapters
 * on a test server: the fake adapter of the store answers with the real adapter's `verify` and `lookup_subscription`,
 * whose outgoing HTTP adapter answers in the test and records the requests. Also the fake receipt forms and the
 * product of a snapshot SKU.
 */
import { generateKeyPairSync, sign, X509Certificate } from 'node:crypto';
import { readFileSync } from 'node:fs';
import * as testing from '../../testing/dev/index.ts';
import type { HttpFetch, StoreAdapter } from '../adapter.ts';
import { create_apple_adapter } from '../adapters/apple.ts';
import { create_google_adapter } from '../adapters/google.ts';
import { base64url } from '../adapters/jws.ts';
import { product_by_sku, ProductType } from '../context.ts';
import {
  account_token,
  APPLE,
  balance,
  code_of,
  CoreError,
  DAY,
  data,
  exported_rows,
  fake_store,
  GOOGLE,
  GOOGLE_APP_ID,
  link_social,
  list_payments,
  receipt,
  recover,
  SOCIAL,
  start,
  START,
  State,
  Status,
  status_of,
  subscription_row,
  sync_subscriptions,
  verify,
  type Sent,
  type Session,
  type TestServer,
} from './helpers.ts';

const API = `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${GOOGLE_APP_ID}`;
const PRODUCTION = 'https://api.storekit.itunes.apple.com';
const SANDBOX = 'https://api.storekit-sandbox.itunes.apple.com';

function json_response(status: number, body: unknown): Response {
  return new Response(typeof body === 'string' ? body : JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

/** An outgoing HTTP adapter that answers by URL and records the requested URLs. */
function http(route: (url: string) => Response): { fetch: HttpFetch; requests: string[] } {
  const requests: string[] = [];
  return {
    requests,
    fetch: (url) => {
      requests.push(url);
      return Promise.resolve(route(url));
    },
  };
}

/** Makes the fake adapter of the store answer `verify` and `lookup_subscription` as the given real adapter. */
function answer_with(server: TestServer, adapter_key: 'iap-apple' | 'iap-google', real: StoreAdapter): void {
  const adapter = server.shared.fakes.get(adapter_key)?.adapter as StoreAdapter;
  adapter.verify = real.verify.bind(real);
  adapter.lookup_subscription = real.lookup_subscription.bind(real);
}

/** `iap-google` as the server makes it, with an outgoing HTTP adapter that gives the token endpoint answer and then `route`. */
function as_google(server: TestServer, route: (url: string) => Response): string[] {
  const answer = http((url) => (url === 'https://oauth2.googleapis.com/token' ? json_response(200, { access_token: 'at', expires_in: 3600 }) : route(url)));
  answer_with(
    server,
    'iap-google',
    create_google_adapter({
      private_key_pem: generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({ type: 'pkcs8', format: 'pem' }),
      service_account_email: 'svc@example.iam.gserviceaccount.com',
      notification_service_account_email: 'push@example.iam.gserviceaccount.com',
      notification_audience: 'https://dev.example.com/iap/notify/google',
      package_name: GOOGLE_APP_ID,
      is_subscription_sku: (sku) => product_by_sku(data, GOOGLE, sku)?.type === ProductType.Subscription,
      fetch: answer.fetch,
      key_source: () => Promise.resolve({ keys: [] }),
      max_response_bytes: 1_048_576,
      clock_now: () => START,
    }),
  );
  return answer.requests;
}

function google_receipt(productId: string, purchaseToken: string, extra: Record<string, unknown> = {}): string {
  return JSON.stringify({ packageName: GOOGLE_APP_ID, productId, purchaseToken, ...extra });
}

const product_url = (sku: string, token: string): string => `${API}/purchases/products/${sku}/tokens/${token}`;
const subscription_url = (token: string): string => `${API}/purchases/subscriptionsv2/tokens/${token}`;

/** A `purchases.products` answer of a paid purchase at `START`. */
function product_answer(fields: Record<string, unknown> = {}): Record<string, unknown> {
  return { purchaseState: 0, purchaseTimeMillis: START.toString(), orderId: 'GPA.0', ...fields };
}

/** A `purchases.subscriptionsv2` answer of one line item. */
function subscription_answer(account: string, line: Record<string, unknown>, fields: Record<string, unknown> = {}): Record<string, unknown> {
  return { subscriptionState: 'SUBSCRIPTION_STATE_ACTIVE', startTime: new Date(Number(START)).toISOString(), obfuscatedExternalAccountId: account, lineItems: [line], ...fields };
}

const chain = JSON.parse(readFileSync(new URL('./fixtures/apple-test-chain.json', import.meta.url), 'utf8')) as Record<'root' | 'intermediate' | 'leaf' | 'plain_leaf' | 'leaf_key', string>;
const der = (pem: string): string => new X509Certificate(pem).raw.toString('base64');
const API_KEY_PEM = generateKeyPairSync('ec', { namedCurve: 'P-256' }).privateKey.export({ type: 'pkcs8', format: 'pem' });

/** An ES256 JWS signed through the key source root. */
function signed(payload: Record<string, unknown>): string {
  const header = { alg: 'ES256', x5c: [der(chain.leaf), der(chain.intermediate), der(chain.root)] };
  const input = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(payload))}`;
  return `${input}.${base64url(sign('sha256', Buffer.from(input), { key: chain.leaf_key, dsaEncoding: 'ieee-p1363' }))}`;
}

/** A JWS of the payload that does not pass the certificate chain verification: its signature is of another payload. */
function unsigned(payload: Record<string, unknown>): string {
  const [header = '', , signature = ''] = signed({ other: true }).split('.');
  return `${header}.${base64url(JSON.stringify(payload))}.${signature}`;
}

/** `iap-apple` or `iap-apple-sandbox` as the server makes it, with the test chain root as its key source. */
function as_apple(server: TestServer, route: (url: string) => Response, name: 'iap-apple' | 'iap-apple-sandbox' = 'iap-apple'): string[] {
  const answer = http(route);
  answer_with(
    server,
    'iap-apple',
    create_apple_adapter({
      name,
      private_key_pem: API_KEY_PEM,
      key_id: 'KEY1',
      issuer_id: 'issuer-1',
      bundle_id: GOOGLE_APP_ID,
      app_apple_id: 1234,
      fetch: answer.fetch,
      key_source: () => Promise.resolve([chain.root]),
      max_response_bytes: 1_048_576,
    }),
  );
  return answer.requests;
}

/** Signed transaction info of the app at `START`. */
function apple_tx(transactionId: string, fields: Record<string, unknown> = {}): Record<string, unknown> {
  return { transactionId, originalTransactionId: transactionId, productId: 'gems_apple', bundleId: GOOGLE_APP_ID, purchaseDate: Number(START), environment: 'Production', ...fields };
}

async function payments_of(server: TestServer, session: Session): Promise<Record<string, unknown>[]> {
  return (await list_payments(server, session.user_id)).payments as unknown as Record<string, unknown>[];
}

function error_count(server: TestServer): number {
  return testing.read_logs(server, 'error').length;
}

function result_of(sent: Sent<{ status: number; product_id: number }>): { status: number; product_id: number } | number | null {
  return sent.response === null ? code_of(sent) : { status: sent.response.status, product_id: sent.response.product_id };
}

describe('iap-google receipts', () => {
  it('a subscriptionsv2 answer with testPurchase is a test transaction for the receipt and the lookup, without it not; purchases.products purchaseType 0 is one', async () => {
    const server = await start();
    const a = await testing.login(server, 'a');
    const token = await account_token(a);
    const end = new Date(Number(START + DAY)).toISOString();
    let answer = subscription_answer(token, { productId: 'vip_google', latestSuccessfulOrderId: 'GPA.t-1', expiryTime: end }, { testPurchase: {} });
    as_google(server, (url) => {
      if (url === subscription_url('sub-tok')) return json_response(200, answer);
      if (url === product_url('gems_google', 'p-test')) return json_response(200, product_answer({ orderId: 'GPA.p-1', purchaseType: 0 }));
      if (url === product_url('gems_google', 'p-paid')) return json_response(200, product_answer({ orderId: 'GPA.p-2' }));
      return json_response(404, {});
    });
    expect(status_of(await verify(a, GOOGLE, google_receipt('vip_google', 'sub-tok')))).toBe(Status.PURCHASE_STATUS_GRANTED);
    answer = subscription_answer(token, { productId: 'vip_google', latestSuccessfulOrderId: 'GPA.t-2', expiryTime: new Date(Number(START + 2n * DAY)).toISOString() });
    testing.set_time(server, START + DAY);
    expect(code_of(await sync_subscriptions(a))).toBeNull();
    expect(status_of(await verify(a, GOOGLE, google_receipt('gems_google', 'p-test')))).toBe(Status.PURCHASE_STATUS_GRANTED);
    expect(status_of(await verify(a, GOOGLE, google_receipt('gems_google', 'p-paid')))).toBe(Status.PURCHASE_STATUS_GRANTED);
    const test_of = new Map((await payments_of(server, a)).map((p) => [p.transaction_id, p.test]));
    expect(Object.fromEntries(test_of)).toEqual({ 'GPA.t-1': true, 'GPA.t-2': false, 'GPA.p-1': true, 'GPA.p-2': false });
  });

  it('a receipt whose productId is the sku_google of a Subscription row goes to subscriptionsv2, of a Consumable row or of no row to purchases.products', async () => {
    const server = await start();
    const a = await testing.login(server, 'a');
    const requests = as_google(server, () => json_response(404, {}));
    for (const [sku, token] of [['vip_google', 's'], ['gems_google', 'c'], ['no_such_google', 'n']]) await verify(a, GOOGLE, google_receipt(sku ?? '', token ?? ''));
    expect(requests.filter((url) => url.startsWith(API))).toEqual([subscription_url('s'), product_url('gems_google', 'c'), product_url('no_such_google', 'n')]);
  });

  it('a Subscription receipt whose answer has only a line item of another productId is INVALID with product ID value 0 and no payment record; a granted receipt keeps the receipt productId as its SKU', async () => {
    const server = await start();
    const a = await testing.login(server, 'a');
    const token = await account_token(a);
    const end = new Date(Number(START + 30n * DAY)).toISOString();
    as_google(server, (url) => {
      if (url === subscription_url('other-line')) return json_response(200, subscription_answer(token, { productId: 'vip_plus_google', latestSuccessfulOrderId: 'GPA.o-1', expiryTime: end }));
      if (url === product_url('gems_google', 'sku-tok')) return json_response(200, product_answer({ orderId: 'GPA.s-1', productId: 'vip_google' }));
      return json_response(404, {});
    });
    expect(result_of(await verify(a, GOOGLE, google_receipt('vip_google', 'other-line')))).toEqual({ status: Status.PURCHASE_STATUS_INVALID, product_id: 0 });
    expect(await balance(server, a.user_id)).toBe(0n);
    expect(await payments_of(server, a)).toEqual([]);
    expect(status_of(await verify(a, GOOGLE, google_receipt('gems_google', 'sku-tok')))).toBe(Status.PURCHASE_STATUS_GRANTED);
    expect((await payments_of(server, a)).map((p) => [p.transaction_id, p.sku])).toEqual([['GPA.s-1', 'gems_google']]);
  });

  it('VerifyPurchase of a Subscription with expiryTime 2030-01-01T00:00:00Z and autoRenewEnabled true is ACTIVE with ends_at 1893456000000 and auto_renew true; SUBSCRIPTION_STATE_CANCELED gives auto_renew false', async () => {
    const server = await start();
    const a = await testing.login(server, 'a');
    const b = await testing.login(server, 'b');
    const token_a = await account_token(a);
    const token_b = await account_token(b);
    const line = (order: string): Record<string, unknown> => ({ productId: 'vip_google', latestSuccessfulOrderId: order, expiryTime: '2030-01-01T00:00:00Z', autoRenewingPlan: { autoRenewEnabled: true } });
    as_google(server, (url) => {
      if (url === subscription_url('active')) return json_response(200, subscription_answer(token_a, line('GPA.a-1')));
      if (url === subscription_url('canceled')) return json_response(200, subscription_answer(token_b, line('GPA.c-1'), { subscriptionState: 'SUBSCRIPTION_STATE_CANCELED' }));
      return json_response(404, {});
    });
    expect(status_of(await verify(a, GOOGLE, google_receipt('vip_google', 'active')))).toBe(Status.PURCHASE_STATUS_GRANTED);
    expect(status_of(await verify(b, GOOGLE, google_receipt('vip_google', 'canceled')))).toBe(Status.PURCHASE_STATUS_GRANTED);
    const row_a = await subscription_row(server, a.user_id, '[iap_vip]');
    const row_b = await subscription_row(server, b.user_id, '[iap_vip]');
    expect([row_a?.state, row_a?.ends_at, row_a?.auto_renew]).toEqual([State.SUBSCRIPTION_STATE_ACTIVE, 1_893_456_000_000n, true]);
    expect([row_b?.state, row_b?.ends_at, row_b?.auto_renew]).toEqual([State.SUBSCRIPTION_STATE_ACTIVE, 1_893_456_000_000n, false]);
  });

  it('a Consumable receipt whose purchases.products answer is HTTP 400, 404 or 410 is INVALID, and HTTP 401, 429, 500 or a 200 body that is not a JSON object is IAP_VERIFY_UNAVAILABLE, with no payment record', async () => {
    const server = await start();
    const a = await testing.login(server, 'a');
    const answers: Record<string, [number, unknown]> = { s400: [400, {}], s404: [404, {}], s410: [410, {}], s401: [401, {}], s429: [429, {}], s500: [500, {}], array: [200, '[1]'], text: [200, 'not json'] };
    as_google(server, (url) => {
      const token = url.slice(url.lastIndexOf('/') + 1);
      const [status, body] = answers[token] ?? [404, {}];
      return json_response(status, body);
    });
    const got: Record<string, unknown> = {};
    for (const token of Object.keys(answers)) got[token] = result_of(await verify(a, GOOGLE, google_receipt('gems_google', token)));
    const invalid = { status: Status.PURCHASE_STATUS_INVALID, product_id: 0 };
    const unavailable = CoreError.CORE_ERROR_IAP_VERIFY_UNAVAILABLE;
    expect(got).toEqual({ s400: invalid, s404: invalid, s410: invalid, s401: unavailable, s429: unavailable, s500: unavailable, array: unavailable, text: unavailable });
    expect(await payments_of(server, a)).toEqual([]);
  });

  it('a receipt that is not JSON, a JSON array, an object without purchaseToken and an object whose productId is the number 1 are INVALID with no payment record and no outgoing request', async () => {
    const server = await start();
    const a = await testing.login(server, 'a');
    const requests = as_google(server, () => json_response(200, product_answer()));
    for (const text of ['not json', '["gems_google","tok"]', JSON.stringify({ packageName: GOOGLE_APP_ID, productId: 'gems_google' }), JSON.stringify({ packageName: GOOGLE_APP_ID, productId: 1, purchaseToken: 'tok' })]) {
      expect(result_of(await verify(a, GOOGLE, text))).toEqual({ status: Status.PURCHASE_STATUS_INVALID, product_id: 0 });
    }
    expect(requests).toEqual([]);
    expect(await payments_of(server, a)).toEqual([]);
  });

  it('a product receipt with an orderId answer has that orderId as transaction_id and original_transaction_id, and without one the purchase token as both', async () => {
    const server = await start();
    const a = await testing.login(server, 'a');
    as_google(server, (url) => {
      if (url === product_url('gems_google', 'with-order')) return json_response(200, product_answer({ orderId: 'GPA.w-1' }));
      if (url === product_url('gems_google', 'promo-tok')) return json_response(200, product_answer({ orderId: undefined }));
      return json_response(404, {});
    });
    expect(status_of(await verify(a, GOOGLE, google_receipt('gems_google', 'with-order')))).toBe(Status.PURCHASE_STATUS_GRANTED);
    expect(status_of(await verify(a, GOOGLE, google_receipt('gems_google', 'promo-tok')))).toBe(Status.PURCHASE_STATUS_GRANTED);
    expect((await payments_of(server, a)).map((p) => [p.transaction_id, p.original_transaction_id]).sort()).toEqual([
      ['GPA.w-1', 'GPA.w-1'],
      ['promo-tok', 'promo-tok'],
    ]);
  });

  it('purchaseState 2 is PENDING with no payment record; 1, 3 or none is INVALID with an INVALID payment record of the orderId; 1 or 2 without purchaseTimeMillis is IAP_VERIFY_UNAVAILABLE', async () => {
    const server = await start();
    const a = await testing.login(server, 'a');
    const answers: Record<string, Record<string, unknown>> = {
      pending: product_answer({ orderId: 'GPA.pending', purchaseState: 2 }),
      canceled: product_answer({ orderId: 'GPA.canceled', purchaseState: 1 }),
      three: product_answer({ orderId: 'GPA.three', purchaseState: 3 }),
      none: product_answer({ orderId: 'GPA.none', purchaseState: undefined }),
      'no-time-1': product_answer({ orderId: 'GPA.no-time-1', purchaseState: 1, purchaseTimeMillis: undefined }),
      'no-time-2': product_answer({ orderId: 'GPA.no-time-2', purchaseState: 2, purchaseTimeMillis: undefined }),
    };
    as_google(server, (url) => {
      const answer = answers[url.slice(url.lastIndexOf('/') + 1)];
      return answer === undefined ? json_response(404, {}) : json_response(200, answer);
    });
    const got: Record<string, unknown> = {};
    for (const token of Object.keys(answers)) got[token] = result_of(await verify(a, GOOGLE, google_receipt('gems_google', token)));
    const gems = data.IapProductTable.all_rows().find((row) => row.sku_google === 'gems_google')?.id ?? -1;
    const invalid = { status: Status.PURCHASE_STATUS_INVALID, product_id: gems };
    expect(got).toEqual({
      pending: { status: Status.PURCHASE_STATUS_PENDING, product_id: gems },
      canceled: invalid,
      three: invalid,
      none: invalid,
      'no-time-1': CoreError.CORE_ERROR_IAP_VERIFY_UNAVAILABLE,
      'no-time-2': CoreError.CORE_ERROR_IAP_VERIFY_UNAVAILABLE,
    });
    expect(await balance(server, a.user_id)).toBe(0n);
    expect((await payments_of(server, a)).map((p) => [p.transaction_id, p.result]).sort()).toEqual([
      ['GPA.canceled', 'INVALID'],
      ['GPA.none', 'INVALID'],
      ['GPA.three', 'INVALID'],
    ]);
  });

  it('the account token is obfuscatedExternalAccountId of the answer in lowercase, not obfuscatedAccountId of the receipt JSON; another packageName is INVALID', async () => {
    const server = await start({ settings: SOCIAL });
    const a = await testing.login(server, 'a');
    const b = await testing.login(server, 'b');
    await link_social(b, 'b-google');
    const token_a = await account_token(a);
    const token_b = await account_token(b);
    as_google(server, (url) => {
      if (url === product_url('gems_google', 'mine')) return json_response(200, product_answer({ orderId: 'GPA.mine', obfuscatedExternalAccountId: token_a.toUpperCase() }));
      if (url === product_url('gems_google', 'theirs')) return json_response(200, product_answer({ orderId: 'GPA.theirs', obfuscatedExternalAccountId: token_b }));
      if (url === product_url('gems_google', 'other-app')) return json_response(200, product_answer({ orderId: 'GPA.other-app', obfuscatedExternalAccountId: token_a }));
      return json_response(404, {});
    });
    expect(status_of(await verify(a, GOOGLE, google_receipt('gems_google', 'mine', { obfuscatedAccountId: token_b })))).toBe(Status.PURCHASE_STATUS_GRANTED);
    expect(status_of(await verify(a, GOOGLE, google_receipt('gems_google', 'theirs', { obfuscatedAccountId: token_a })))).toBe(Status.PURCHASE_STATUS_OTHER_USER);
    expect(status_of(await verify(a, GOOGLE, google_receipt('gems_google', 'other-app', { packageName: 'com.other.app' })))).toBe(Status.PURCHASE_STATUS_INVALID);
    expect(await balance(server, a.user_id)).toBe(100n);
  });
});

describe('iap-apple receipts', () => {
  it('a receipt that names no requested transaction ID is INVALID with no outgoing request; 404 then 200 takes the sandbox answer; 404 twice, 400 and an unverified signedTransactionInfo are INVALID; 401, 429, 500 and a 200 body that is not a JSON object are IAP_VERIFY_UNAVAILABLE', async () => {
    const server = await start();
    const a = await testing.login(server, 'a');
    const token = await account_token(a);
    const named = as_apple(server, () => json_response(200, { signedTransactionInfo: signed(apple_tx('1')) }));
    for (const text of ['abc', '1'.repeat(65), signed({ transactionId: 'abc' }), signed({ transactionId: 1 }), `${signed(apple_tx('1'))}.x`]) {
      expect(result_of(await verify(a, APPLE, text))).toEqual({ status: Status.PURCHASE_STATUS_INVALID, product_id: 0 });
    }
    expect(named).toEqual([]);
    const answers: Record<string, [number, number, unknown]> = {
      '101': [404, 200, { signedTransactionInfo: signed(apple_tx('101', { environment: 'Sandbox', appAccountToken: token })) }],
      '102': [404, 404, {}],
      '103': [400, 200, {}],
      '104': [200, 200, { signedTransactionInfo: unsigned(apple_tx('104', { appAccountToken: token })) }],
      '105': [401, 200, {}],
      '106': [429, 200, {}],
      '107': [500, 200, {}],
      '108': [200, 200, 'not json'],
    };
    const requests = as_apple(server, (url) => {
      const [production = 404, sandbox = 404, body = {}] = answers[url.slice(url.lastIndexOf('/') + 1)] ?? [];
      return json_response(url.startsWith(PRODUCTION) ? production : sandbox, url.startsWith(PRODUCTION) && production === 404 ? {} : body);
    });
    const got: Record<string, unknown> = {};
    for (const id of Object.keys(answers)) got[id] = result_of(await verify(a, APPLE, id));
    const invalid = { status: Status.PURCHASE_STATUS_INVALID, product_id: 0 };
    const unavailable = CoreError.CORE_ERROR_IAP_VERIFY_UNAVAILABLE;
    const gems = data.IapProductTable.all_rows().find((row) => row.sku_apple === 'gems_apple')?.id ?? -1;
    expect(got).toEqual({ '101': { status: Status.PURCHASE_STATUS_GRANTED, product_id: gems }, '102': invalid, '103': invalid, '104': invalid, '105': unavailable, '106': unavailable, '107': unavailable, '108': unavailable });
    expect(requests.filter((url) => url.endsWith('/101'))).toEqual([`${PRODUCTION}/inApps/v1/transactions/101`, `${SANDBOX}/inApps/v1/transactions/101`]);
    expect((await payments_of(server, a)).map((p) => p.transaction_id)).toEqual(['101']);
  });

  it('an unverified JWS receipt names only the requested transaction ID: the verified answer gives the account token and the transaction ID', async () => {
    const server = await start();
    const a = await testing.login(server, 'a');
    const b = await testing.login(server, 'b');
    const token_a = await account_token(a);
    const token_b = await account_token(b);
    const answers: Record<string, Record<string, unknown>> = {
      '201': apple_tx('2001', { appAccountToken: token_b }),
      '202': apple_tx('2002', { appAccountToken: token_a }),
      '203': apple_tx('2003', { appAccountToken: token_a.toUpperCase() }),
    };
    const requests = as_apple(server, (url) => {
      const answer = answers[url.slice(url.lastIndexOf('/') + 1)];
      return answer === undefined ? json_response(404, {}) : json_response(200, { signedTransactionInfo: signed(answer) });
    });
    expect(status_of(await verify(a, APPLE, unsigned(apple_tx('201', { appAccountToken: token_a }))))).toBe(Status.PURCHASE_STATUS_OTHER_USER);
    expect(requests).toEqual([`${PRODUCTION}/inApps/v1/transactions/201`]);
    expect(await balance(server, a.user_id)).toBe(0n);
    expect(await payments_of(server, a)).toEqual([]);
    expect(await payments_of(server, b)).toEqual([]);
    expect(status_of(await verify(a, APPLE, unsigned(apple_tx('202', { appAccountToken: token_b }))))).toBe(Status.PURCHASE_STATUS_GRANTED);
    expect(status_of(await verify(a, APPLE, unsigned(apple_tx('203', { appAccountToken: token_b }))))).toBe(Status.PURCHASE_STATUS_GRANTED);
    expect((await payments_of(server, a)).map((p) => p.transaction_id).sort()).toEqual(['2002', '2003']);
    expect(await balance(server, a.user_id)).toBe(200n);
  });

  it('a Subscription of a Sandbox transaction is looked up in sandbox only: status 4 with a verified renewal info gives GRACE_PERIOD, status 1 with an unverified one ACTIVE without auto_renew; status 6, no matching item and 404 are IAP_VERIFY_UNAVAILABLE; iap-apple-sandbox looks up a Production transaction in sandbox', async () => {
    const server = await start();
    const users = await Promise.all(['a', 'b', 'c', 'd', 'e', 'f'].map((name) => testing.login(server, name)));
    const tokens = await Promise.all(users.map((user) => account_token(user)));
    const grace_end = START + 10n * DAY;
    const expires = START + 30n * DAY;
    const tx = (id: string, i: number, environment = 'Sandbox'): Record<string, unknown> =>
      apple_tx(id, { productId: 'vip_apple', environment, appAccountToken: tokens[i], expiresDate: Number(expires) });
    const item = (id: string, i: number, status: number, renewal: string, environment?: string): Record<string, unknown> => ({ originalTransactionId: id, status, signedTransactionInfo: signed(tx(id, i, environment)), signedRenewalInfo: renewal });
    const statuses: Record<string, [number, unknown]> = {
      '301': [200, { data: [{ lastTransactions: [item('301', 0, 4, signed({ autoRenewStatus: 1, gracePeriodExpiresDate: Number(grace_end) }))] }] }],
      '302': [200, { data: [{ lastTransactions: [item('302', 1, 1, unsigned({ autoRenewStatus: 1 }))] }] }],
      '303': [200, { data: [{ lastTransactions: [item('303', 2, 6, signed({ autoRenewStatus: 1 }))] }] }],
      '304': [200, { data: [{ lastTransactions: [item('399', 3, 1, signed({ autoRenewStatus: 1 }))] }] }],
      '305': [404, {}],
    };
    const route = (environment: string) => (url: string): Response => {
      const id = url.slice(url.lastIndexOf('/') + 1);
      if (url.includes('/inApps/v1/transactions/')) {
        if (url.startsWith(PRODUCTION) && environment === 'Sandbox') return json_response(404, {});
        const i = Number(id) - 301;
        return json_response(200, { signedTransactionInfo: signed(tx(id, i, environment)) });
      }
      if (url.startsWith(PRODUCTION)) return json_response(500, {});
      const [status = 404, body = {}] = statuses[id] ?? [];
      return json_response(status, body);
    };
    const requests = as_apple(server, route('Sandbox'));
    const got: unknown[] = [];
    for (const [i, id] of ['301', '302', '303', '304', '305'].entries()) got.push(result_of(await verify(users[i] as Session, APPLE, id)));
    const vip = data.IapProductTable.all_rows().find((row) => row.sku_apple === 'vip_apple')?.id ?? -1;
    const granted = { status: Status.PURCHASE_STATUS_GRANTED, product_id: vip };
    const unavailable = CoreError.CORE_ERROR_IAP_VERIFY_UNAVAILABLE;
    expect(got).toEqual([granted, granted, unavailable, unavailable, unavailable]);
    expect(requests.filter((url) => url.includes('/subscriptions/'))).toEqual(['301', '302', '303', '304', '305'].map((id) => `${SANDBOX}/inApps/v1/subscriptions/${id}`));
    const grace = await subscription_row(server, (users[0] as Session).user_id, '[iap_vip]');
    expect([grace?.state, grace?.ends_at, grace?.auto_renew]).toEqual([State.SUBSCRIPTION_STATE_GRACE_PERIOD, grace_end, true]);
    const active = await subscription_row(server, (users[1] as Session).user_id, '[iap_vip]');
    expect([active?.state, active?.ends_at, active?.auto_renew]).toEqual([State.SUBSCRIPTION_STATE_ACTIVE, expires, false]);
    for (const user of users.slice(2, 5)) expect(await payments_of(server, user)).toEqual([]);

    statuses['306'] = [200, { data: [{ lastTransactions: [item('306', 5, 1, signed({ autoRenewStatus: 1 }), 'Production')] }] }];
    const sandbox_requests = as_apple(server, route('Production'), 'iap-apple-sandbox');
    expect(status_of(await verify(users[5] as Session, APPLE, '306'))).toBe(Status.PURCHASE_STATUS_GRANTED);
    expect(sandbox_requests).toEqual([`${SANDBOX}/inApps/v1/transactions/306`, `${SANDBOX}/inApps/v1/subscriptions/306`]);
  });
});

describe('fake receipts and the product of a SKU', () => {
  it('a receipt without fake:, of 3 parts or of 6 parts is INVALID with product ID value 0 and no payment record also when the controller result is VALID', async () => {
    const server = await start();
    const a = await testing.login(server, 'a');
    const token = await account_token(a);
    fake_store(server).set_result('verify', 'VALID');
    for (const text of [`gems_apple:fr-1:${token}`, 'fake:gems_apple:fr-2', `fake:gems_apple:fr-3:${token}:fr-3:x`]) {
      expect(result_of(await verify(a, APPLE, text))).toEqual({ status: Status.PURCHASE_STATUS_INVALID, product_id: 0 });
    }
    expect(await payments_of(server, a)).toEqual([]);
  });

  it('an empty account token part with a receipt that is not a device receipt is INVALID and leaves no binding', async () => {
    const server = await start();
    const a = await testing.login(server, 'a');
    fake_store(server).set_result('verify', { result: 'VALID', device_receipt: false });
    expect(status_of(await verify(a, APPLE, 'fake:noads_apple:fe-1:'))).toBe(Status.PURCHASE_STATUS_INVALID);
    expect(await exported_rows(server, a.user_id, 'iap_binding')).toEqual([]);
    expect(await balance(server, a.user_id)).toBe(0n);
  });

  it('an empty SKU part is INVALID with one error log and no grant, also with an iap_product row whose SKUs are empty', async () => {
    const server = await start();
    const a = await testing.login(server, 'a');
    const token = await account_token(a);
    expect(data.IapProductTable.all_rows().some((row) => row.sku_apple === '' && row.sku_google === '')).toBe(true);
    for (const store of [APPLE, GOOGLE]) {
      const errors = error_count(server);
      expect(result_of(await recover(a, store, `fake::fs-${String(store)}:${token}`))).toEqual({ status: Status.PURCHASE_STATUS_INVALID, product_id: 0 });
      expect(error_count(server) - errors).toBe(1);
    }
    expect(await balance(server, a.user_id)).toBe(0n);
  });

  it('a subscription notification of APPLE whose snapshot SKU is empty or the sku_google of another Subscription row grants and changes nothing, with one error log', async () => {
    const server = await start();
    const u = await testing.login(server, 'u');
    const token = await account_token(u);
    expect(status_of(await verify(u, APPLE, receipt('vip_apple', 'ps-1', token)))).toBe(Status.PURCHASE_STATUS_GRANTED);
    const before = { subscriptions: await exported_rows(server, u.user_id, 'iap_subscription'), payments: await payments_of(server, u), row: await subscription_row(server, u.user_id, '[iap_vip]'), gems: await balance(server, u.user_id) };
    for (const sku of ['', 'vip_google_only']) {
      const errors = error_count(server);
      const snapshot = { state: 'ACTIVE', latest_transaction_id: `ps-${sku}-2`, sku, ends_at: (START + 60n * DAY).toString(), purchased_at: START.toString() };
      expect(await testing.call_dev(server, 'iap', 'send_fake_subscription_notify', [APPLE, 'ps-1', snapshot])).toBe(200);
      expect(error_count(server) - errors).toBe(1);
      expect(await exported_rows(server, u.user_id, 'iap_subscription')).toEqual(before.subscriptions);
      expect(await payments_of(server, u)).toEqual(before.payments);
      expect(await subscription_row(server, u.user_id, '[iap_vip]')).toEqual(before.row);
      expect(await subscription_row(server, u.user_id, '[iap_vip_google_only]')).toBeNull();
      expect(await balance(server, u.user_id)).toBe(before.gems);
    }
  });
});
