/**
 * Real adapter `push-fcm`: FCM HTTP v1 API. The access token is an RS256 JWT of the service account exchanged at
 * the OAuth 2.0 token endpoint (`push` `### adapter`).
 */
import type { PushAdapter, PushPayload, SendFailure, SendOutcome } from '../adapter.ts';
import { error_code, http_failure, http_request, json_object, sign_jwt, type Fetch } from './http.ts';

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const SCOPE = 'https://www.googleapis.com/auth/firebase.messaging';
/** The assertion's life, and how long before the access token's expiry a new one is taken. */
const ASSERTION_SECONDS = 3600n;
const REFRESH_MARGIN_MS = 60_000n;

export interface FcmConfig {
  readonly project_id: string;
  readonly service_account_email: string;
  /** The service account private key PEM (the secret `environments.<ENV>.secrets.pushFcm`). */
  readonly private_key_pem: string;
  readonly fetch: Fetch;
  /** `routing.externalMaxResponseBytes`. */
  readonly max_response_bytes: number;
  /** `server-time.clock_now`. */
  readonly now: () => bigint;
}

/** The object elements of a JSON array; a value that is not an array has none. */
function objects(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? (value as unknown[]).filter((v): v is Record<string, unknown> => typeof v === 'object' && v !== null) : [];
}

/**
 * Whether a 400 or 404 error response says the registration token is no longer valid: FCM error code `UNREGISTERED`, or
 * `INVALID_ARGUMENT` with a `BadRequest` field violation on `message.token`. `INVALID_ARGUMENT` also comes for payload
 * problems (a message over the size limit, an invalid data key); those leave the token alone.
 */
function is_invalid_token(body: string): boolean {
  const details = error_details(body);
  const codes = details.map((d) => d.errorCode);
  if (codes.includes('UNREGISTERED')) return true;
  if (!codes.includes('INVALID_ARGUMENT')) return false;
  return details.some((d) => objects(d.fieldViolations).some((v) => v.field === 'message.token'));
}

function error_details(body: string): Record<string, unknown>[] {
  return objects(objects([json_object(body)?.error])[0]?.details);
}

/** The FCM error code of an error response (`UNAVAILABLE`, `QUOTA_EXCEEDED`), else its `error.status`, else null. */
function fcm_error_code(body: string): string | null {
  for (const detail of error_details(body)) {
    const code = error_code(detail.errorCode);
    if (code !== null) return code;
  }
  return error_code(objects([json_object(body)?.error])[0]?.status);
}

export function create_fcm_adapter(config: FcmConfig): PushAdapter {
  let token: { value: string; expires_at: bigint } | null = null;

  /** The access token, or `FAILED` with why the token endpoint did not give one. */
  async function access_token(signal: AbortSignal): Promise<string | SendFailure> {
    const now = config.now();
    if (token !== null && now < token.expires_at - REFRESH_MARGIN_MS) return token.value;
    const iat = now / 1000n;
    const assertion = sign_jwt('RS256', {}, {
      iss: config.service_account_email, scope: SCOPE, aud: TOKEN_URL, iat: Number(iat), exp: Number(iat + ASSERTION_SECONDS),
    }, config.private_key_pem);
    const reply = await http_request(config.fetch, TOKEN_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }).toString(),
    }, config.max_response_bytes, signal);
    if ('failure' in reply) return { result: 'FAILED', reason: `token exchange ${reply.failure}` };
    if (reply.status !== 200) return { result: 'FAILED', reason: `token exchange ${http_failure(reply.status, error_code(json_object(reply.body)?.error)).reason}` };
    const json = json_object(reply.body);
    const value = json?.access_token;
    const expires_in = json?.expires_in;
    if (typeof value !== 'string' || typeof expires_in !== 'number' || !Number.isSafeInteger(expires_in)) return { result: 'FAILED', reason: 'token exchange HTTP 200 without access_token and expires_in' };
    token = { value, expires_at: now + BigInt(expires_in) * 1000n };
    return value;
  }

  /** `OK`, `INVALID_TOKEN`, or `FAILED` with the HTTP status and the FCM error code of the reply, or the network failure. */
  async function send_one(device_token: string, payload: PushPayload, bearer: string, signal: AbortSignal): Promise<SendOutcome> {
    const url = `https://fcm.googleapis.com/v1/projects/${encodeURIComponent(config.project_id)}/messages:send`;
    const reply = await http_request(config.fetch, url, {
      method: 'POST',
      headers: { authorization: `Bearer ${bearer}`, 'content-type': 'application/json' },
      body: JSON.stringify({ message: { token: device_token, notification: { title: payload.title, body: payload.body }, data: payload.data } }),
    }, config.max_response_bytes, signal);
    if ('failure' in reply) return { result: 'FAILED', reason: reply.failure };
    if (reply.status === 200) return 'OK';
    if ((reply.status === 400 || reply.status === 404) && is_invalid_token(reply.body)) return 'INVALID_TOKEN';
    return http_failure(reply.status, fcm_error_code(reply.body));
  }

  return {
    send: async (tokens, payload, signal) => {
      const bearer = await access_token(signal);
      if (typeof bearer !== 'string') return tokens.map(() => bearer);
      return Promise.all(tokens.map((t) => send_one(t, payload, bearer, signal)));
    },
  };
}
