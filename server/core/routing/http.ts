/**
 * Request parsing of routing without module state: common header, client IP, truncated IP, CORS origin, body
 * reading with a byte limit and a time limit, and the data version step.
 */
import { createHash } from 'node:crypto';
import { isIPv4 } from 'node:net';
import type { Readable } from 'node:stream';
import type { CommonHeaders } from './module_api.ts';

export const PLATFORMS: ReadonlySet<string> = new Set(['android', 'ios', 'web', 'windows', 'macos', 'linux']);

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const DATA_VERSION = /^[0-9a-f]{64}-[0-9a-f]{64}$/;
const APP_VERSION = /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/;
const BEARER = /^Bearer ([\x21-\x7e]+)$/;

/** Requests that carry no `Authorization`. */
const NO_AUTHORIZATION: ReadonlySet<string> = new Set(['core/Login', 'core/GetTerms', 'core/GetNotices', 'core/cheat/DevLogin']);

export type HeaderMap = Readonly<Record<string, string | string[] | undefined>>;

/** One header value; null when the header is missing or repeated. */
export function header(headers: HeaderMap, name: string): string | null {
  const value = headers[name.toLowerCase()];
  return typeof value === 'string' ? value : null;
}

/** True when the value is a data version `<protocol hash>-<data hash>`. */
export function is_data_version(value: string): boolean {
  return DATA_VERSION.test(value);
}

/** True when the value is an app version `<major>.<minor>.<patch>`. */
export function is_app_version(value: string): boolean {
  return APP_VERSION.test(value);
}

/** The common header of a request (step 3), or null when one of them does not have its format. */
export function parse_common_headers(request_name: string, headers: HeaderMap): CommonHeaders | null {
  const request_id = header(headers, 'x-ogw-request-id');
  const data_version = header(headers, 'x-ogw-data-version');
  const client_version = header(headers, 'x-ogw-client-version');
  const platform = header(headers, 'x-ogw-platform');
  if (request_id === null || !UUID_V4.test(request_id)) return null;
  if (data_version === null || !is_data_version(data_version)) return null;
  if (client_version === null || (client_version !== '' && !is_app_version(client_version))) return null;
  if (platform === null || !PLATFORMS.has(platform)) return null;
  let authorization: string | null = null;
  if (!NO_AUTHORIZATION.has(request_name)) {
    const value = header(headers, 'authorization');
    const match = value === null ? null : BEARER.exec(value);
    if (match === null) return null;
    authorization = match[1] ?? null;
  }
  return {
    request_id,
    authorization,
    data_version,
    client_version,
    platform,
    timestamp: header(headers, 'x-ogw-timestamp'),
    signature: header(headers, 'x-ogw-signature'),
  };
}

/** The SHA-256 lower case hex of the UTF-8 bytes of a string (access token hash). */
export function sha256_hex(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

/** The peer address of a TCP connection; an IPv4-mapped IPv6 address is its IPv4 address. */
export function peer_address(remote: string | undefined): string {
  const address = remote ?? '';
  return address.startsWith('::ffff:') && isIPv4(address.slice(7)) ? address.slice(7) : address;
}

/**
 * The client IP: the TCP peer address when the trusted proxy count is 0, otherwise the value n-th from the
 * right of `X-Forwarded-For`, or the peer address when there is no such value.
 */
export function client_ip(trusted_proxy_count: number, forwarded_for: string | null, remote: string | undefined): string {
  const peer = peer_address(remote);
  if (trusted_proxy_count <= 0 || forwarded_for === null) return peer;
  const values = forwarded_for.split(',').map((v) => v.trim()).filter((v) => v !== '');
  const value = values[values.length - trusted_proxy_count];
  return value === undefined ? peer : value;
}

/** True when the origin is allowed: LOCAL allows every `localhost` and `127.0.0.1` origin. */
export function is_allowed_origin(origin: string, env: string, allowed: readonly string[]): boolean {
  if (env === 'LOCAL') {
    try {
      const url = new URL(origin);
      return url.origin === origin && (url.hostname === 'localhost' || url.hostname === '127.0.0.1');
    } catch {
      return false;
    }
  }
  return allowed.includes(origin);
}

/** The common header names a client sends, for `Access-Control-Allow-Headers`. */
export const COMMON_HEADER_NAMES: readonly string[] = [
  'X-Ogw-Request-Id',
  'Authorization',
  'X-Ogw-Data-Version',
  'X-Ogw-Client-Version',
  'X-Ogw-Platform',
  'X-Ogw-Timestamp',
  'X-Ogw-Signature',
  'Content-Type',
];

/** The headers of an allowed origin's preflight response. */
export function preflight_headers(origin: string, max_age_ms: number, cheat: boolean): Record<string, string> {
  const allow = cheat ? [...COMMON_HEADER_NAMES, 'X-Ogw-Dev-Access'] : COMMON_HEADER_NAMES;
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'POST',
    'Access-Control-Allow-Headers': allow.join(', '),
    'Access-Control-Max-Age': String(Math.floor(max_age_ms / 1000)),
    'Vary': 'Origin',
  };
}

/**
 * Reads a body. null when the received bytes pass `max_bytes` (counted as they arrive, whatever
 * `Content-Length` says) or `signal` aborts before the body ends.
 */
export function read_body(stream: Readable, max_bytes: number, signal: AbortSignal): Promise<Uint8Array | null> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    let total = 0;
    let done = false;
    const finish = (value: Uint8Array | null): void => {
      if (done) return;
      done = true;
      stream.off('data', on_data);
      stream.off('end', on_end);
      stream.off('error', on_error);
      stream.off('close', on_close);
      signal.removeEventListener('abort', on_abort);
      if (value === null) stream.pause();
      resolve(value);
    };
    const on_data = (chunk: Buffer | string): void => {
      const bytes = typeof chunk === 'string' ? Buffer.from(chunk) : chunk;
      total += bytes.length;
      if (total > max_bytes) {
        finish(null);
        return;
      }
      chunks.push(bytes);
    };
    const on_end = (): void => {
      finish(new Uint8Array(Buffer.concat(chunks, total)));
    };
    const on_error = (): void => {
      finish(null);
    };
    const on_close = on_error;
    const on_abort = on_error;
    if (signal.aborted) {
      finish(null);
      return;
    }
    signal.addEventListener('abort', on_abort);
    stream.on('data', on_data);
    stream.on('end', on_end);
    stream.on('error', on_error);
    stream.on('close', on_close);
  });
}

export type DataVersionResult = 'pass' | 'APP_UPDATE_REQUIRED' | 'DATA_UPDATE_REQUIRED';

function protocol_hash(version: string): string {
  return version.slice(0, version.indexOf('-'));
}

/**
 * Step 7. The base version is the one of `client_data_version` and `compat_client_data_version` whose protocol
 * hash is the request's. A data hash that differs is `DATA_UPDATE_REQUIRED` only when the client version is empty
 * or the data update is ready, and never for the requests that keep a started play.
 */
export function check_data_version(
  request_version: string,
  client_data_version: string,
  compat_client_data_version: string | null,
  data_hash_exempt: boolean,
  client_version: string,
  is_data_update_ready: (app_version: string) => boolean,
): DataVersionResult {
  const protocol = protocol_hash(request_version);
  const base = [client_data_version, compat_client_data_version].find((v) => v !== null && protocol_hash(v) === protocol);
  if (base === undefined || base === null) return 'APP_UPDATE_REQUIRED';
  if (base === request_version || data_hash_exempt) return 'pass';
  return client_version === '' || is_data_update_ready(client_version) ? 'DATA_UPDATE_REQUIRED' : 'pass';
}

/** The server start check of the two data versions read from the server build data; null when they pass. */
export function data_version_failure(client_data_version: string | null, compat_client_data_version: string | null): string | null {
  if (client_data_version === null || !is_data_version(client_data_version)) return 'client_data_version is missing or is not <protocol hash>-<data hash>';
  if (compat_client_data_version === null) return null;
  if (!is_data_version(compat_client_data_version)) return 'compat_client_data_version is not <protocol hash>-<data hash>';
  if (protocol_hash(compat_client_data_version) === protocol_hash(client_data_version)) return 'compat_client_data_version has the protocol hash of client_data_version';
  return null;
}
