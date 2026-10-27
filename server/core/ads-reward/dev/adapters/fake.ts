/**
 * The fake ads adapter (DEV code) and its controller, the `testing` `fake` controller of service `ads`.
 *
 * Query: `notify_id=<reward notify ID>&user_id=<user ID>&key_id=<key ID>&signature=<signature>` in this order. The
 * signature is the HMAC-SHA256 of the query before `&signature=` with the key ID's 32 byte key, in base64url
 * without padding.
 */
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { base64url_bytes, FORMAT_ERROR, parse_decimal, timeout_on_abort, type AdsAdapter, type KeyFetchFailure, type KeyList, type ParsedCallback } from '../../adapter.ts';

const KEY_BYTES = 32;
const QUERY = /^notify_id=([^&]*)&user_id=([^&]*)&key_id=([^&]*)&signature=([^&]*)$/;
const SIGNATURE = '&signature=';

/** A failure condition of the `testing` fake controller; null clears it. */
export type FakeFailure = 'timeout' | 'communication_failure' | 'rejected' | null;

/** A key of the fake key list: `set_result('fetch_keys', [...])` takes these. */
export interface FakeAdsKey {
  readonly key_id: bigint | number | string;
  readonly key: Uint8Array;
}

export interface FakeCall {
  readonly operation: string;
  readonly input: readonly unknown[];
}

/** The `testing` fake adapter controller of service `ads`. */
export interface FakeAdsController {
  /** `fetch_keys` takes a list of `FakeAdsKey`. */
  set_result(operation: string, result: unknown): void;
  set_failure(operation: string, failure: FakeFailure): void;
  calls(): FakeCall[];
  /** A query signed with the key of `key_id` in the current key list. Throws when the list has no such key. */
  sign_callback(notify_id: string, user_id: bigint | number | string, key_id: bigint | number | string): string;
}

function key_map(keys: readonly FakeAdsKey[]): Map<string, Uint8Array> {
  const map = new Map<string, Uint8Array>();
  for (const { key_id, key } of keys) {
    const id = parse_decimal(String(key_id));
    if (id === null || !(key instanceof Uint8Array) || key.byteLength !== KEY_BYTES) throw new TypeError('fake ads: a key is a key ID and 32 bytes');
    map.set(id.toString(), new Uint8Array(key));
  }
  return map;
}

function sign(signed_text: string, key: Uint8Array): string {
  return createHmac('sha256', key).update(signed_text, 'utf8').digest('base64url');
}

function parse(query: string): ParsedCallback | typeof FORMAT_ERROR {
  const match = QUERY.exec(query);
  if (match === null) return FORMAT_ERROR;
  const [, notify_id = '', user_id = '', key_text = '', signature = ''] = match;
  const bytes = base64url_bytes(signature);
  if (parse_decimal(key_text) === null) return FORMAT_ERROR;
  if (bytes === null || bytes.byteLength !== KEY_BYTES || signature.endsWith('=')) return FORMAT_ERROR;
  return { key_id: key_text, signed_text: query.slice(0, query.indexOf(SIGNATURE)), signature, notify_id, user_id, ad_unit: '' };
}

/**
 * Makes the fake adapter of adapter key `ads`. Without a key list from the controller, `fetch_keys` returns key
 * ID 1 with a 32 byte secure random key made here.
 */
export function create_fake_adapter(adapter_key: string): { adapter: AdsAdapter<Uint8Array>; controller: FakeAdsController } {
  if (adapter_key !== 'ads') throw new TypeError(`fake ads: adapter key ${adapter_key} is not ads`);
  let keys = key_map([{ key_id: 1n, key: new Uint8Array(randomBytes(KEY_BYTES)) }]);
  let fetch_failure: FakeFailure = null;
  const calls: FakeCall[] = [];

  const adapter: AdsAdapter<Uint8Array> = {
    name: 'fake',
    parse: (query) => {
      calls.push({ operation: 'parse', input: [query] });
      return parse(query);
    },
    fetch_keys: async (signal): Promise<KeyList<Uint8Array> | KeyFetchFailure> => {
      calls.push({ operation: 'fetch_keys', input: [] });
      await Promise.resolve();
      if (fetch_failure === 'timeout') return timeout_on_abort(signal);
      if (fetch_failure !== null) return 'communication_failure';
      return new Map(keys);
    },
    verify: (signed_text, signature, key) => {
      calls.push({ operation: 'verify', input: [signed_text, signature] });
      const bytes = base64url_bytes(signature);
      return bytes !== null && bytes.byteLength === KEY_BYTES && timingSafeEqual(bytes, Buffer.from(sign(signed_text, key), 'base64url'));
    },
  };

  const controller: FakeAdsController = {
    set_result: (operation, result) => {
      if (operation !== 'fetch_keys' || !Array.isArray(result)) throw new TypeError('fake ads: set_result takes fetch_keys and a key list');
      keys = key_map(result as FakeAdsKey[]);
    },
    set_failure: (operation, failure) => {
      if (operation !== 'fetch_keys') throw new TypeError('fake ads: set_failure takes fetch_keys');
      fetch_failure = failure;
    },
    calls: () => [...calls],
    sign_callback: (notify_id, user_id, key_id) => {
      const id = parse_decimal(String(key_id));
      const key = id === null ? undefined : keys.get(id.toString());
      if (id === null || key === undefined) throw new TypeError(`fake ads: no key ${String(key_id)} in the key list`);
      const signed_text = `notify_id=${notify_id}&user_id=${String(user_id)}&key_id=${id.toString()}`;
      return `${signed_text}${SIGNATURE}${sign(signed_text, key)}`;
    },
  };
  return { adapter, controller };
}
