import { createSign } from 'node:crypto';
import * as CoreContract from '../../../generated/contract/core_contract.ts';
import type { AdapterFailure, AnalyticsAdapter, AnalyticsSendEvent } from '../analytics.ts';
import { code_points } from '../fields.ts';

const Kind = CoreContract.AnalyticsParamKind;

const COLLECT_URL = 'https://www.google-analytics.com/mp/collect';
const DELETION_URL = 'https://www.googleapis.com/analytics/v3/userDeletion/userDeletionRequests:upsert';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const DELETION_SCOPE = 'https://www.googleapis.com/auth/analytics.user.deletion';
const TOKEN_LIFETIME_S = 3600n;

/** GA4 limits: events per call, event name and param key length, string value length, params per event. */
const MAX_EVENTS_PER_CALL = 25;
const MAX_NAME_LENGTH = 40;
const MAX_STRING_LENGTH = 100;
const MAX_PARAMS = 25;

/** The outgoing HTTP adapter: `fetch`, or the override `routing.create_server` takes. */
export type HttpFetch = (url: string, init: RequestInit) => Promise<Response>;

export interface AnalyticsGa4Config {
  readonly fetch: HttpFetch;
  /** game settings `environments.<ENV>.analyticsGa4.measurementId` */
  readonly measurement_id: string;
  /** The value of secret `environments.<ENV>.secrets.analytics`. */
  readonly api_secret: string;
  /** game settings `environments.<ENV>.analyticsGa4.propertyId` */
  readonly property_id: string;
  /** game settings `environments.<ENV>.analyticsGa4.serviceAccountEmail` */
  readonly service_account_email: string;
  /** The private key PEM of secret `environments.<ENV>.secrets.analyticsServiceAccount`. */
  readonly private_key: string;
  /** `routing.externalMaxResponseBytes` */
  readonly max_response_bytes: number;
  /** `server-time.clock_now`, for the access token's `iat`. */
  readonly clock_now: () => bigint;
}

/** One Measurement Protocol call: the body for one user and at most 25 events. */
export interface Ga4Call {
  readonly client_id: string;
  readonly user_id: string;
  readonly events: readonly { name: string; params: Record<string, number | string | boolean>; timestamp_micros: string }[];
}

function ga4_value(param: CoreContract.AnalyticsParam): number | string | boolean | null {
  switch (param.kind) {
    case Kind.ANALYTICS_PARAM_KIND_INT:
      return param.int_value >= BigInt(Number.MIN_SAFE_INTEGER) && param.int_value <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(param.int_value) : param.int_value.toString();
    case Kind.ANALYTICS_PARAM_KIND_DOUBLE:
      return param.double_value;
    case Kind.ANALYTICS_PARAM_KIND_STRING:
      return code_points(param.string_value) > MAX_STRING_LENGTH ? null : param.string_value;
    case Kind.ANALYTICS_PARAM_KIND_BOOL:
      return param.bool_value;
    default:
      return null;
  }
}

/**
 * The Measurement Protocol calls for events: per user, at most 25 events a call. Events whose name is longer than 40
 * characters are left out; so are params whose key is longer than 40 characters, string values longer than 100
 * characters, and params after the 25th of an event.
 */
export function ga4_calls(events: readonly AnalyticsSendEvent[]): Ga4Call[] {
  const by_user = new Map<bigint, Ga4Call['events'][number][]>();
  for (const event of events) {
    if (code_points(event.name) > MAX_NAME_LENGTH) continue;
    const params: Record<string, number | string | boolean> = {};
    for (const param of event.params.slice(0, MAX_PARAMS)) {
      const value = ga4_value(param);
      if (value !== null && code_points(param.key) <= MAX_NAME_LENGTH) params[param.key] = value;
    }
    const list = by_user.get(event.user_id) ?? [];
    list.push({ name: event.name, params, timestamp_micros: (event.time_at * 1000n).toString() });
    by_user.set(event.user_id, list);
  }
  const calls: Ga4Call[] = [];
  for (const [user_id, list] of by_user) {
    for (let i = 0; i < list.length; i += MAX_EVENTS_PER_CALL) {
      calls.push({ client_id: user_id.toString(), user_id: user_id.toString(), events: list.slice(i, i + MAX_EVENTS_PER_CALL) });
    }
  }
  return calls;
}

/** Reads a response body up to `max` bytes. Null when it is longer. */
export async function read_limited(response: Response, max: number): Promise<Uint8Array | null> {
  if (response.body === null) return new Uint8Array(0);
  const reader = (response.body as ReadableStream<Uint8Array>).getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    // The body stream of a `fetch` response carries bytes.
    const read = (await reader.read()) as { readonly done: true } | { readonly done: false; readonly value: Uint8Array };
    if (read.done) break;
    const value = read.value;
    total += value.byteLength;
    if (total > max) {
      await reader.cancel().catch(() => undefined);
      return null;
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let at = 0;
  for (const chunk of chunks) {
    out.set(chunk, at);
    at += chunk.byteLength;
  }
  return out;
}

function base64url(data: string | Uint8Array): string {
  return Buffer.from(data).toString('base64url');
}

/** The RS256 JWT the token endpoint exchanges for a User Deletion API access token. */
export function deletion_assertion(service_account_email: string, private_key: string, now_s: bigint): string {
  const header = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claims = base64url(
    JSON.stringify({ iss: service_account_email, scope: DELETION_SCOPE, aud: TOKEN_URL, iat: Number(now_s), exp: Number(now_s + TOKEN_LIFETIME_S) }),
  );
  const signer = createSign('RSA-SHA256');
  signer.update(`${header}.${claims}`);
  return `${header}.${claims}.${signer.sign(private_key, 'base64url')}`;
}

/**
 * The `analytics-ga4` real adapter: GA4 Measurement Protocol and the Google Analytics User Deletion API. `send` fails
 * with `rejected` on an HTTP status that is not 2xx.
 */
export function create_analytics_ga4_adapter(config: AnalyticsGa4Config): AnalyticsAdapter {
  /** One HTTP call. A failure is `timeout` (the signal aborted), or `communication_failure` (no response, or a body over the limit). */
  const call = async (url: string, init: RequestInit): Promise<{ status: number; body: Uint8Array } | AdapterFailure> => {
    let response: Response;
    try {
      response = await config.fetch(url, init);
    } catch {
      return init.signal?.aborted === true ? 'timeout' : 'communication_failure';
    }
    const body = await read_limited(response, config.max_response_bytes).catch(() => undefined);
    if (body === undefined) return init.signal?.aborted === true ? 'timeout' : 'communication_failure';
    if (body === null) return 'communication_failure';
    return { status: response.status, body };
  };

  const access_token = async (signal: AbortSignal): Promise<string | null> => {
    const assertion = deletion_assertion(config.service_account_email, config.private_key, config.clock_now() / 1000n);
    const form = new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion });
    const result = await call(TOKEN_URL, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: form.toString(), signal });
    if (typeof result === 'string' || result.status !== 200) return null;
    try {
      const json = JSON.parse(new TextDecoder().decode(result.body)) as { access_token?: unknown };
      return typeof json.access_token === 'string' && json.access_token !== '' ? json.access_token : null;
    } catch {
      return null;
    }
  };

  return {
    async send(events, signal) {
      const query = new URLSearchParams({ measurement_id: config.measurement_id, api_secret: config.api_secret });
      for (const body of ga4_calls(events)) {
        const result = await call(`${COLLECT_URL}?${query.toString()}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
          signal,
        });
        if (typeof result === 'string') return result;
        if (result.status < 200 || result.status >= 300) return 'rejected';
      }
      return null;
    },
    async delete_user_data(user_id, signal) {
      const token = await access_token(signal);
      if (token === null) return false;
      for (const type of ['USER_ID', 'CLIENT_ID']) {
        const body = { kind: 'analytics#userDeletionRequest', id: { type, userId: user_id.toString() }, propertyId: config.property_id };
        const result = await call(DELETION_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify(body),
          signal,
        });
        if (typeof result === 'string' || result.status !== 200) return false;
      }
      return true;
    },
  };
}
