import { createVerify, generateKeyPairSync } from 'node:crypto';
import * as CoreContract from '../../../generated/contract/core_contract.ts';
import { create_analytics_ga4_adapter, deletion_assertion, ga4_calls, type HttpFetch } from '../adapters/analytics_ga4.ts';
import type { AnalyticsSendEvent } from '../analytics.ts';
import { to_param } from '../analytics.ts';

const NOW = 1_700_000_000_000n;
const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const PRIVATE_PEM = privateKey.export({ type: 'pkcs8', format: 'pem' });
const PUBLIC_PEM = publicKey.export({ type: 'spki', format: 'pem' });

function event(user_id: bigint, name: string, time_at: bigint, params: readonly (readonly [string, bigint | number | string | boolean])[] = []): AnalyticsSendEvent {
  return { user_id, name, time_at, params: params.map(([k, v]) => to_param(k, v)) };
}

interface Call {
  readonly url: URL;
  readonly init: RequestInit;
}

/** An outgoing HTTP adapter that records calls and answers from `answer`. */
function recording(answer: (call: Call) => Response | Promise<Response>): { fetch: HttpFetch; calls: Call[] } {
  const calls: Call[] = [];
  return {
    calls,
    fetch: (url, init) => {
      const call = { url: new URL(url), init };
      calls.push(call);
      return Promise.resolve(answer(call));
    },
  };
}

function adapter(fetch: HttpFetch, max_response_bytes = 1024): ReturnType<typeof create_analytics_ga4_adapter> {
  return create_analytics_ga4_adapter({
    fetch,
    measurement_id: 'G-TEST',
    api_secret: 'mp-secret',
    property_id: '123456',
    service_account_email: 'deleter@example.iam.gserviceaccount.com',
    private_key: PRIVATE_PEM,
    max_response_bytes,
    clock_now: () => NOW,
  });
}

const signal = (): AbortSignal => new AbortController().signal;

describe('analytics-ga4 Measurement Protocol body', () => {
  it('has client_id and user_id as the user ID and each event with name, params and timestamp_micros', () => {
    const calls = ga4_calls([event(42n, 'stage_clear', 1_000n, [['stage', 3n], ['ratio', 0.5], ['boss', 'ogre'], ['first', true]])]);
    expect(calls).toEqual([
      { client_id: '42', user_id: '42', events: [{ name: 'stage_clear', params: { stage: 3, ratio: 0.5, boss: 'ogre', first: true }, timestamp_micros: '1000000' }] },
    ]);
  });

  it('puts at most 25 events in one call and one user in each call', () => {
    const events = [...Array.from({ length: 30 }, (_, i) => event(1n, 'e', BigInt(i))), event(2n, 'e', 0n)];
    const calls = ga4_calls(events);
    expect(calls.map((c) => [c.user_id, c.events.length])).toEqual([
      ['1', 25],
      ['1', 5],
      ['2', 1],
    ]);
  });

  it('leaves out names and keys over 40 characters, string values over 100 characters and params after the 25th', () => {
    const long_key = 'k'.repeat(41);
    const params: [string, bigint | string][] = [
      [long_key, 1n],
      ['ok_key', 'v'.repeat(100)],
      ['long_value', 'v'.repeat(101)],
      ...Array.from({ length: 30 }, (_, i): [string, bigint] => [`p${String(i)}`, BigInt(i)]),
    ];
    const [call] = ga4_calls([event(1n, 'n'.repeat(41), 0n), event(1n, 'kept', 0n, params)]);
    expect(call?.events.map((e) => e.name)).toEqual(['kept']);
    const sent = call?.events[0]?.params ?? {};
    expect(Object.keys(sent)).toEqual(['ok_key', ...Array.from({ length: 22 }, (_, i) => `p${String(i)}`)]);
  });
});

describe('analytics-ga4 adapter', () => {
  it('posts to the Measurement Protocol collect URL with measurement_id and api_secret', async () => {
    const http = recording(() => new Response(null, { status: 204 }));
    const events = Array.from({ length: 26 }, (_, i) => event(9n, 'tap', BigInt(i)));
    expect(await adapter(http.fetch).send(events, signal())).toBeNull();
    expect(http.calls).toHaveLength(2);
    const first = http.calls[0] as Call;
    expect(`${first.url.origin}${first.url.pathname}`).toBe('https://www.google-analytics.com/mp/collect');
    expect(first.url.searchParams.get('measurement_id')).toBe('G-TEST');
    expect(first.url.searchParams.get('api_secret')).toBe('mp-secret');
    expect(first.init.method).toBe('POST');
    expect((JSON.parse(first.init.body as string) as { events: unknown[] }).events).toHaveLength(25);
  });

  it('fails on an HTTP status that is not 2xx, a communication failure and a response over the byte limit', async () => {
    expect(await adapter(recording(() => new Response('no', { status: 500 })).fetch).send([event(1n, 'a', 0n)], signal())).toBe('rejected');
    expect(await adapter(() => Promise.reject(new TypeError('fetch failed'))).send([event(1n, 'a', 0n)], signal())).toBe('communication_failure');
    expect(await adapter(recording(() => new Response('x'.repeat(2000), { status: 200 })).fetch).send([event(1n, 'a', 0n)], signal())).toBe('communication_failure');
  });

  it('signs the deletion access token request with RS256 and the deletion scope', () => {
    const jwt = deletion_assertion('deleter@example.iam.gserviceaccount.com', PRIVATE_PEM, NOW / 1000n);
    const [header, claims, signature] = jwt.split('.') as [string, string, string];
    expect(JSON.parse(Buffer.from(header, 'base64url').toString())).toEqual({ alg: 'RS256', typ: 'JWT' });
    expect(JSON.parse(Buffer.from(claims, 'base64url').toString())).toEqual({
      iss: 'deleter@example.iam.gserviceaccount.com',
      scope: 'https://www.googleapis.com/auth/analytics.user.deletion',
      aud: 'https://oauth2.googleapis.com/token',
      iat: Number(NOW / 1000n),
      exp: Number(NOW / 1000n) + 3600,
    });
    const verify = createVerify('RSA-SHA256');
    verify.update(`${header}.${claims}`);
    expect(verify.verify(PUBLIC_PEM, Buffer.from(signature, 'base64url'))).toBe(true);
  });

  it('deletes user data with USER_ID and CLIENT_ID requests and succeeds only when both are HTTP 200', async () => {
    const statuses: number[] = [200, 200];
    const http = recording((call) => {
      if (call.url.hostname === 'oauth2.googleapis.com') return Response.json({ access_token: 'token-1', expires_in: 3600 });
      return new Response('{}', { status: statuses.shift() ?? 500 });
    });
    expect(await adapter(http.fetch).delete_user_data(77n, signal())).toBe(true);
    const [token, first, second] = http.calls as [Call, Call, Call];
    expect(new URLSearchParams(token.init.body as string).get('grant_type')).toBe('urn:ietf:params:oauth:grant-type:jwt-bearer');
    for (const [call, type] of [
      [first, 'USER_ID'],
      [second, 'CLIENT_ID'],
    ] as const) {
      expect(call.url.toString()).toBe('https://www.googleapis.com/analytics/v3/userDeletion/userDeletionRequests:upsert');
      expect((call.init.headers as Record<string, string>).Authorization).toBe('Bearer token-1');
      expect(JSON.parse(call.init.body as string)).toEqual({ kind: 'analytics#userDeletionRequest', id: { type, userId: '77' }, propertyId: '123456' });
    }
    statuses.push(200, 403);
    expect(await adapter(http.fetch).delete_user_data(77n, signal())).toBe(false);
    const refused = recording(() => new Response('{}', { status: 401 }));
    expect(await adapter(refused.fetch).delete_user_data(77n, signal())).toBe(false);
    expect(refused.calls).toHaveLength(1);
  });

  it('keeps the AnalyticsParam int64 values beyond 2^53 as strings', () => {
    const big = new CoreContract.AnalyticsParam();
    big.key = 'big';
    big.kind = CoreContract.AnalyticsParamKind.ANALYTICS_PARAM_KIND_INT;
    big.int_value = 2n ** 60n;
    const [call] = ga4_calls([{ user_id: 1n, name: 'e', time_at: 0n, params: [big] }]);
    expect(call?.events[0]?.params).toEqual({ big: (2n ** 60n).toString() });
  });
});
