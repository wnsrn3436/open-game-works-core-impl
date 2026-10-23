/** The OS push service adapter interface (`push` `### adapter`). Fake, sandbox and real adapters share it. */

/** The result for one device token. */
export type SendResult = 'OK' | 'INVALID_TOKEN' | 'FAILED';

/**
 * `FAILED` with why it failed, such as the HTTP status, the APNs `reason`, the FCM error code or a network error.
 * The reason never has the device token; `push` writes it in the first failure log's `reason`.
 */
export interface SendFailure {
  readonly result: 'FAILED';
  readonly reason: string;
}

/** What an adapter gives for one device token: a result, or `FAILED` with its reason. */
export type SendOutcome = SendResult | SendFailure;

/** The push service of a device registration row. */
export type Provider = 'fcm' | 'apns';

/** What a push carries to a device: `title`, `body`, and data `message_id` and `push_id` as decimal strings. */
export interface PushPayload {
  readonly title: string;
  readonly body: string;
  readonly data: { readonly message_id: string; readonly push_id: string };
}

export interface PushAdapter {
  /**
   * Sends one payload to device tokens of one provider. The result has one element per token in token order.
   * `signal` aborts at the `push.sendTimeoutMs` time limit; the caller then treats every token as `FAILED`.
   */
  send(tokens: readonly string[], payload: PushPayload, signal: AbortSignal): Promise<SendOutcome[]>;
}

/** Adapter keys of `push` and the adapter names each takes. */
export const ADAPTER_NAMES = {
  'push-fcm': ['fake', 'push-fcm'],
  'push-apns': ['fake', 'push-apns-sandbox', 'push-apns'],
} as const;

export type AdapterKey = keyof typeof ADAPTER_NAMES;

export const PROVIDER_KEY: Readonly<Record<Provider, AdapterKey>> = { fcm: 'push-fcm', apns: 'push-apns' };

/** The provider of a device registration row by `X-Ogw-Platform`; other platforms have none. */
export const PLATFORM_PROVIDER: Readonly<Record<string, Provider>> = { android: 'fcm', ios: 'apns' };
