/**
 * What the social login adapters (`### external service`) share: the adapter interfaces, the result shape, provider
 * JWKS caching and RS256 ID token checks, and form POSTs through the outgoing HTTP adapter.
 */
import { createPublicKey, verify, type webcrypto } from 'node:crypto';
import type { HttpAdapter, KeySource } from '../deps.ts';

type JsonWebKey = webcrypto.JsonWebKey;

/** Why an adapter call failed: the provider refused, the time limit passed, or the call did not complete. */
export type AdapterFailure = 'rejected' | 'timeout' | 'communication';

export type AdapterResult<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly failure: AdapterFailure };

export const rejected = { ok: false, failure: 'rejected' } as const;

export function ok<T>(value: T): AdapterResult<T> {
  return { ok: true, value };
}

/** Every call takes the signal that aborts at the call's time limit (`auth.socialVerifyTimeoutMs`). */
export interface SocialAdapter {
  /** The provider account ID of a credential issued to this game. */
  verify(credential: string, signal: AbortSignal): Promise<AdapterResult<string>>;
}

export interface AppleAdapter extends SocialAdapter {
  /** The refresh token of the credential's authorization code. */
  exchange(credential: string, signal: AbortSignal): Promise<AdapterResult<string>>;
  revoke(refresh_token: string, signal: AbortSignal): Promise<AdapterResult<true>>;
}

export interface GoogleAdapter extends SocialAdapter {
  /** The ID token of a desktop credential. */
  exchange_desktop(desktop_credential: string, signal: AbortSignal): Promise<AdapterResult<string>>;
}

export interface DesktopCredential {
  readonly authorization_code: string;
  readonly code_verifier: string;
  readonly redirect_uri: string;
}

/** True when a credential is a JSON object, so a desktop credential rather than a Google ID token. */
export function is_desktop_credential(credential: string): boolean {
  return credential.trimStart().startsWith('{');
}

/**
 * The desktop credential of a JSON text, or null when the JSON is not that form or `redirect_uri` is not
 * `http://127.0.0.1:<port 1 to 65535>`.
 */
export function parse_desktop_credential(credential: string): DesktopCredential | null {
  let value: unknown;
  try {
    value = JSON.parse(credential);
  } catch {
    return null;
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const keys = Object.keys(value).sort();
  if (keys.join(',') !== 'authorization_code,code_verifier,redirect_uri') return null;
  const { authorization_code, code_verifier, redirect_uri } = value as Record<string, unknown>;
  if (typeof authorization_code !== 'string' || typeof code_verifier !== 'string' || typeof redirect_uri !== 'string') return null;
  const port = /^http:\/\/127\.0\.0\.1:([1-9][0-9]{0,4})$/.exec(redirect_uri)?.[1];
  if (port === undefined || Number(port) > 65_535) return null;
  return { authorization_code, code_verifier, redirect_uri };
}

/** The Apple credential `{"identity_token": ..., "authorization_code": ...}`, or null. */
export function parse_apple_credential(credential: string): { identity_token: string; authorization_code: string } | null {
  let value: unknown;
  try {
    value = JSON.parse(credential);
  } catch {
    return null;
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const { identity_token, authorization_code } = value as Record<string, unknown>;
  if (Object.keys(value).length !== 2 || typeof identity_token !== 'string' || typeof authorization_code !== 'string') return null;
  return { identity_token, authorization_code };
}

function aborted(signal: AbortSignal): AdapterFailure {
  return signal.aborted ? 'timeout' : 'communication';
}

/**
 * A provider JWKS kept in the server instance's memory for `cache_ms`; a `kid` not in the kept keys fetches again.
 * `now` is `server-time.clock_now`.
 */
export class JwksCache {
  private keys: readonly JsonWebKey[] = [];
  private fetched_at: bigint | null = null;
  private readonly source: KeySource;
  private readonly cache_ms: bigint;
  private readonly now: () => bigint;

  constructor(source: KeySource, cache_ms: bigint, now: () => bigint) {
    this.source = source;
    this.cache_ms = cache_ms;
    this.now = now;
  }

  private find(kid: string): JsonWebKey | null {
    return this.keys.find((key) => (key as { kid?: unknown }).kid === kid) ?? null;
  }

  async key(kid: string, signal: AbortSignal): Promise<AdapterResult<JsonWebKey>> {
    const fresh = this.fetched_at !== null && this.now() < this.fetched_at + this.cache_ms;
    const kept = fresh ? this.find(kid) : null;
    if (kept !== null) return ok(kept);
    const fetched = await this.source(signal).catch(() => ({ ok: false, failure: aborted(signal) === 'timeout' ? 'timeout' : 'communication' }) as const);
    if (!fetched.ok) return { ok: false, failure: fetched.failure };
    this.keys = fetched.keys;
    this.fetched_at = this.now();
    const key = this.find(kid);
    return key === null ? rejected : ok(key);
  }
}

/** A key source that GETs a JWKS document from `url`. */
export function url_key_source(http: HttpAdapter, url: string, max_response_bytes: number): KeySource {
  return async (signal) => {
    let response;
    try {
      response = await http({ method: 'GET', url, headers: { accept: 'application/json' }, body: null, max_response_bytes, signal });
    } catch {
      return { ok: false, failure: aborted(signal) === 'timeout' ? 'timeout' : 'communication' };
    }
    if (!response.ok) return { ok: false, failure: response.failure === 'timeout' ? 'timeout' : 'communication' };
    if (response.status !== 200) return { ok: false, failure: 'communication' };
    const json = parse_json(response.body);
    const keys = (json as { keys?: unknown } | null)?.keys;
    if (!Array.isArray(keys)) return { ok: false, failure: 'communication' };
    return { ok: true, keys: keys.filter((k): k is JsonWebKey => typeof k === 'object' && k !== null) };
  };
}

export function parse_json(bytes: Uint8Array): unknown {
  try {
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } catch {
    return null;
  }
}

function json_part(part: string): Record<string, unknown> | null {
  if (!/^[A-Za-z0-9_-]+$/.test(part)) return null;
  const value = parse_json(Buffer.from(part, 'base64url'));
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

export interface IdTokenRules {
  readonly issuers: readonly string[];
  readonly audiences: readonly string[];
}

/** The header, payload and signature of a JWS compact string; null when it is not one. */
function split_jws(token: string): { header: Record<string, unknown>; payload: Record<string, unknown>; input: string; signature: Buffer } | null {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [header_part, payload_part, signature_part] = parts as [string, string, string];
  const header = json_part(header_part);
  const payload = json_part(payload_part);
  if (header === null || payload === null || !/^[A-Za-z0-9_-]+$/.test(signature_part)) return null;
  return { header, payload, input: `${header_part}.${payload_part}`, signature: Buffer.from(signature_part, 'base64url') };
}

/** The `sub` of claims whose `iss`, `aud` and `exp` (seconds, after `now` ms) pass; null otherwise. */
function checked_subject(payload: Record<string, unknown>, rules: IdTokenRules, now: bigint): string | null {
  const { iss, aud, exp, sub } = payload;
  if (typeof iss !== 'string' || !rules.issuers.includes(iss)) return null;
  const audiences: unknown[] = Array.isArray(aud) ? aud : [aud];
  if (!audiences.some((x) => typeof x === 'string' && x !== '' && rules.audiences.includes(x))) return null;
  if (typeof exp !== 'number' || !Number.isFinite(exp) || BigInt(Math.floor(exp)) * 1000n <= now) return null;
  return typeof sub === 'string' && sub !== '' ? sub : null;
}

/**
 * The `sub` of an RS256 ID token whose signature matches a provider key, whose `iss` and `aud` are allowed and
 * whose `exp` (seconds) is after `now` (Unix ms). Key fetch failures are `timeout` or `communication`.
 */
export async function verify_id_token(token: string, jwks: JwksCache, rules: IdTokenRules, now: bigint, signal: AbortSignal): Promise<AdapterResult<string>> {
  const jws = split_jws(token);
  if (jws?.header.alg !== 'RS256' || typeof jws.header.kid !== 'string') return rejected;
  const key = await jwks.key(jws.header.kid, signal);
  if (!key.ok) return key;
  let valid: boolean;
  try {
    valid = verify('RSA-SHA256', Buffer.from(jws.input, 'ascii'), createPublicKey({ key: key.value, format: 'jwk' }), jws.signature);
  } catch {
    valid = false;
  }
  const subject = valid ? checked_subject(jws.payload, rules, now) : null;
  return subject === null ? rejected : ok(subject);
}

/**
 * POSTs a form and returns the JSON object of an HTTP 200 response. HTTP 400 and 401 are the provider refusing;
 * other statuses and bodies that are not a JSON object are communication failures.
 */
export async function post_form(http: HttpAdapter, url: string, form: Readonly<Record<string, string>>, max_response_bytes: number, signal: AbortSignal): Promise<AdapterResult<Record<string, unknown>>> {
  const body = new TextEncoder().encode(new URLSearchParams(form).toString());
  let response;
  try {
    response = await http({ method: 'POST', url, headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' }, body, max_response_bytes, signal });
  } catch {
    return { ok: false, failure: aborted(signal) };
  }
  if (!response.ok) return { ok: false, failure: response.failure === 'timeout' ? 'timeout' : 'communication' };
  if (response.status === 400 || response.status === 401) return rejected;
  if (response.status !== 200) return { ok: false, failure: 'communication' };
  const json = response.body.length === 0 ? {} : parse_json(response.body);
  if (typeof json !== 'object' || json === null || Array.isArray(json)) return { ok: false, failure: 'communication' };
  return ok(json as Record<string, unknown>);
}
