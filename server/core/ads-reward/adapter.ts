/**
 * The ads adapter interface (`ads-reward` `## settings`): `parse`, `fetch_keys`, `verify`. The real adapter is
 * `adapters/admob.ts`; the fake adapter is the DEV code `dev/adapters/fake.ts`.
 */

/** What `parse` takes out of a callback query. */
export interface ParsedCallback {
  /** The key ID in canonical decimal form. */
  readonly key_id: string;
  /** The part of the query the signature covers. */
  readonly signed_text: string;
  readonly signature: string;
  /** The reward notify ID as the query has it, empty when missing. The client sets it: `parse` does not check it. */
  readonly notify_id: string;
  /** The user ID text as the query has it, empty when missing. The client sets it: `parse` does not check it. */
  readonly user_id: string;
}

export const FORMAT_ERROR = 'FORMAT_ERROR';
export type FormatError = typeof FORMAT_ERROR;

/** A failure of a key source or of `fetch_keys` (`server-core` `## adapter`). */
export type KeyFetchFailure = 'timeout' | 'communication_failure';

/** Resolves `timeout` once the signal aborts, at once when it has already aborted. */
export function timeout_on_abort(signal: AbortSignal): Promise<KeyFetchFailure> {
  return new Promise((resolve) => {
    if (signal.aborted) resolve('timeout');
    else
      signal.addEventListener(
        'abort',
        () => {
          resolve('timeout');
        },
        { once: true },
      );
  });
}

/** The signing keys by key ID (canonical decimal). */
export type KeyList<K> = ReadonlyMap<string, K>;

export interface AdsAdapter<K = unknown> {
  /** The adapter name: `ads-admob` or `fake`. It is the `claim_notify` source. */
  readonly name: string;
  parse(query: string): ParsedCallback | FormatError;
  /** Calls the adapter's key source. The signal aborts at `ads-reward.keyFetchTimeoutMs`. */
  fetch_keys(signal: AbortSignal): Promise<KeyList<K> | KeyFetchFailure>;
  verify(signed_text: string, signature: string, key: K): boolean;
}

/** A key source: the provider's public keys, or a failure (`server-core` `## adapter`). */
export type KeySource = () => Promise<unknown>;

/** The network name of the callback path `GET /ads/callback/<network>` for an adapter name. */
export function network_name(adapter_name: string): string | null {
  if (adapter_name === 'ads-admob') return 'admob';
  if (adapter_name === 'fake') return 'fake';
  return null;
}

const INT64_MAX = 2n ** 63n - 1n;
const DECIMAL = /^(0|[1-9][0-9]{0,18})$/;

/** A decimal integer from 0 to 2^63 − 1 without leading zeros, or null. */
export function parse_decimal(text: string): bigint | null {
  if (!DECIMAL.test(text)) return null;
  const value = BigInt(text);
  return value <= INT64_MAX ? value : null;
}

/** A user ID: a decimal integer from 1 to 2^63 − 1 without leading zeros, or null. */
export function parse_user_id(text: string): bigint | null {
  const value = parse_decimal(text);
  return value !== null && value >= 1n ? value : null;
}

/** The reward notify IDs the server makes: UUID v4, lower case. */
export const NOTIFY_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/** The bytes of a base64url text with or without padding, or null when it is not base64url. */
export function base64url_bytes(text: string): Uint8Array | null {
  const body = text.replace(/=+$/, '');
  if (body.length === 0 || !/^[A-Za-z0-9_-]+$/.test(body) || body.length % 4 === 1) return null;
  const bytes = Buffer.from(body, 'base64url');
  return Buffer.from(bytes).toString('base64url') === body ? new Uint8Array(bytes) : null;
}
