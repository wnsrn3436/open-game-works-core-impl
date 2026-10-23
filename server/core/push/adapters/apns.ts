/**
 * Real adapter `push-apns` (APNs production endpoint) and sandbox adapter `push-apns-sandbox` (APNs development
 * endpoint), with token authentication: an ES256 provider token (`push` `### adapter`).
 */
import type { PushAdapter, PushPayload, SendOutcome } from '../adapter.ts';
import { error_code, http_failure, http_request, json_object, sign_jwt, type Fetch } from './http.ts';

const ENDPOINTS = { 'push-apns': 'https://api.push.apple.com', 'push-apns-sandbox': 'https://api.sandbox.push.apple.com' } as const;
/** APNs takes a provider token for an hour; a new one is made before that. */
const PROVIDER_TOKEN_MS = 50n * 60_000n;

export interface ApnsConfig {
  readonly name: keyof typeof ENDPOINTS;
  /** Game settings `pushApns.keyId`. */
  readonly key_id: string;
  /** Game settings `appleTeamId`. */
  readonly team_id: string;
  /** Game settings `appId`: `apns-topic`. */
  readonly topic: string;
  /** The APNs auth key `.p8` PEM (the secret `environments.<ENV>.secrets.pushApns`). */
  readonly private_key_pem: string;
  readonly fetch: Fetch;
  readonly max_response_bytes: number;
  readonly now: () => bigint;
}

/** APNs reasons that mean the device token is not valid for this app. */
const INVALID_TOKEN_REASONS = new Set(['BadDeviceToken', 'DeviceTokenNotForTopic', 'Unregistered']);

export function create_apns_adapter(config: ApnsConfig): PushAdapter {
  let provider_token: { value: string; made_at: bigint } | null = null;

  function bearer(): string {
    const now = config.now();
    if (provider_token === null || now - provider_token.made_at >= PROVIDER_TOKEN_MS) {
      const value = sign_jwt('ES256', { kid: config.key_id }, { iss: config.team_id, iat: Number(now / 1000n) }, config.private_key_pem);
      provider_token = { value, made_at: now };
    }
    return provider_token.value;
  }

  /** `OK`, `INVALID_TOKEN`, or `FAILED` with the HTTP status and the APNs `reason` of the reply, or the network failure. */
  async function send_one(device_token: string, payload: PushPayload, signal: AbortSignal): Promise<SendOutcome> {
    const reply = await http_request(config.fetch, `${ENDPOINTS[config.name]}/3/device/${encodeURIComponent(device_token)}`, {
      method: 'POST',
      headers: {
        authorization: `bearer ${bearer()}`,
        'apns-topic': config.topic,
        'apns-push-type': 'alert',
        'apns-priority': '10',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ aps: { alert: { title: payload.title, body: payload.body } }, ...payload.data }),
    }, config.max_response_bytes, signal);
    if ('failure' in reply) return { result: 'FAILED', reason: reply.failure };
    if (reply.status === 200) return 'OK';
    if (reply.status === 410) return 'INVALID_TOKEN';
    const reason = error_code(json_object(reply.body)?.reason);
    if (reply.status === 400 && reason !== null && INVALID_TOKEN_REASONS.has(reason)) return 'INVALID_TOKEN';
    return http_failure(reply.status, reason);
  }

  return {
    send: (tokens, payload, signal) => Promise.all(tokens.map((t) => send_one(t, payload, signal))),
  };
}
