/**
 * The real ads adapter `ads-admob`: AdMob server-side verification. The signature is an ECDSA P-256 SHA-256
 * signature in base64url; the keys are AdMob's `verifier-keys.json` entries (`keyId`, `base64`).
 */
import { createPublicKey, verify, type KeyObject } from 'node:crypto';
import { base64url_bytes, FORMAT_ERROR, parse_decimal, type AdsAdapter, type KeyFetchFailure, type KeyList, type KeySource, type ParsedCallback } from '../adapter.ts';

export const ADMOB_KEYS_URL = 'https://www.gstatic.com/admob/reward/verifier-keys.json';

const SIGNATURE = '&signature=';

function decode_value(text: string): string | null {
  try {
    return decodeURIComponent(text.replace(/\+/g, ' '));
  } catch {
    return null;
  }
}

/** The query parameters by name; null when a parameter is malformed or repeated. */
function parameters(query: string): { names: string[]; values: Map<string, string> } | null {
  const names: string[] = [];
  const values = new Map<string, string>();
  for (const part of query.split('&')) {
    const at = part.indexOf('=');
    if (at <= 0) return null;
    const name = part.slice(0, at);
    const value = decode_value(part.slice(at + 1));
    if (value === null || values.has(name)) return null;
    names.push(name);
    values.set(name, value);
  }
  return { names, values };
}

/** True when `signature` and `key_id` are the last two parameters, in this order. */
function ends_with_signature(names: readonly string[]): boolean {
  return names.length >= 3 && names[names.length - 2] === 'signature' && names[names.length - 1] === 'key_id';
}

function parse(query: string): ParsedCallback | typeof FORMAT_ERROR {
  const params = parameters(query);
  const at = query.lastIndexOf(SIGNATURE);
  if (params === null || at < 0 || !ends_with_signature(params.names)) return FORMAT_ERROR;
  const { values } = params;
  const key_id = parse_decimal(values.get('key_id') ?? '');
  const signature = values.get('signature') ?? '';
  if (key_id === null || base64url_bytes(signature) === null) return FORMAT_ERROR;
  const notify_id = values.get('custom_data') ?? '';
  const user_id = values.get('user_id') ?? '';
  return { key_id: key_id.toString(), signed_text: query.slice(0, at), signature, notify_id, user_id };
}

/** The keys of a key source value: the `keys` entries of `verifier-keys.json`. Null when it is malformed. */
export function admob_keys(value: unknown): KeyList<KeyObject> | null {
  if (!Array.isArray(value)) return null;
  const keys = new Map<string, KeyObject>();
  for (const entry of value as unknown[]) {
    if (typeof entry !== 'object' || entry === null) return null;
    const { keyId, base64 } = entry as { keyId?: unknown; base64?: unknown };
    const id = typeof keyId === 'number' && Number.isSafeInteger(keyId) ? parse_decimal(String(keyId)) : typeof keyId === 'string' ? parse_decimal(keyId) : null;
    if (id === null || typeof base64 !== 'string') return null;
    try {
      keys.set(id.toString(), createPublicKey({ key: Buffer.from(base64, 'base64'), format: 'der', type: 'spki' }));
    } catch {
      return null;
    }
  }
  return keys;
}

/** The `ads-admob` adapter that reads its keys from `key_source`. */
export function create_admob_adapter(key_source: KeySource): AdsAdapter<KeyObject> {
  return {
    name: 'ads-admob',
    parse,
    fetch_keys: async (): Promise<KeyList<KeyObject> | KeyFetchFailure> => {
      let value: unknown;
      try {
        value = await key_source();
      } catch {
        return 'communication_failure';
      }
      if (value === 'timeout' || value === 'communication_failure') return value;
      return admob_keys(value) ?? 'communication_failure';
    },
    verify: (signed_text, signature, key) => {
      const bytes = base64url_bytes(signature);
      if (bytes === null) return false;
      try {
        return verify('sha256', Buffer.from(signed_text, 'utf8'), { key, dsaEncoding: 'der' }, bytes);
      } catch {
        return false;
      }
    },
  };
}

/** What the server key source of `ads-admob` uses. */
export interface AdmobKeySourceInput {
  readonly fetch: typeof globalThis.fetch;
  /** `server-time.network_time_limit` of `ads-reward.keyFetchTimeoutMs`, made at each call. */
  readonly time_limit: () => AbortSignal;
  /** `routing.externalMaxResponseBytes`. */
  readonly max_response_bytes: number;
}

/** The response body, or null when it is longer than `max` bytes; reading stops there. */
async function read_limited(response: Response, max: number): Promise<Uint8Array | null> {
  const body = response.body as AsyncIterable<Uint8Array> | null;
  if (body === null) return new Uint8Array();
  const parts: Uint8Array[] = [];
  let total = 0;
  for await (const part of body) {
    total += part.byteLength;
    if (total > max) return null;
    parts.push(part);
  }
  return Buffer.concat(parts);
}

/** The server key source of `ads-admob`: the `keys` of `verifier-keys.json`. */
export function admob_key_source(input: AdmobKeySourceInput): KeySource {
  return async () => {
    let signal: AbortSignal;
    try {
      signal = input.time_limit();
    } catch {
      return 'timeout';
    }
    try {
      const response = await input.fetch(ADMOB_KEYS_URL, { signal });
      if (response.status !== 200) return 'communication_failure';
      const body = await read_limited(response, input.max_response_bytes);
      if (body === null) return 'communication_failure';
      const json = JSON.parse(Buffer.from(body).toString('utf8')) as { keys?: unknown };
      return json.keys ?? 'communication_failure';
    } catch {
      return signal.aborted ? 'timeout' : 'communication_failure';
    }
  };
}
