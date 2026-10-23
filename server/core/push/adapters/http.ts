/** What the real push adapters share: outgoing HTTP with a response size limit, and JWT signing. */
import { sign } from 'node:crypto';
import type { SendFailure } from '../adapter.ts';

/** The outgoing HTTP adapter (`server.fetch`). */
export type Fetch = (input: string, init: RequestInit) => Promise<Response>;

export interface HttpReply {
  readonly status: number;
  readonly body: string;
}

/** Why a request got no reply, for an adapter's `FAILED` reason. It has no URL, header or body. */
export interface HttpFailure {
  readonly failure: string;
}

/** The system error code of a network failure (`ECONNREFUSED`, `UND_ERR_SOCKET`), or the error's name. */
function network_error(error: unknown): string {
  if (error instanceof Error && error.name === 'AbortError') return 'aborted';
  const cause = error instanceof Error ? (error.cause as { code?: unknown } | undefined) : undefined;
  const code = typeof cause?.code === 'string' ? cause.code : (error as { code?: unknown } | null)?.code;
  const name = typeof code === 'string' ? code : error instanceof Error ? error.name : typeof error;
  return `network error ${/^[A-Za-z0-9_]{1,64}$/.test(name) ? name : 'unknown'}`;
}

/**
 * One HTTP request. The body is read up to `max_bytes`. A longer body, a network failure and an abort of `signal`
 * are a failure with its reason. The reason never has the error's message, which can have the URL.
 */
export async function http_request(fetch: Fetch, url: string, init: RequestInit, max_bytes: number, signal: AbortSignal): Promise<HttpReply | HttpFailure> {
  try {
    const response = await fetch(url, { ...init, signal });
    const reader = response.body?.getReader() as ReadableStreamDefaultReader<Uint8Array> | undefined;
    const chunks: Uint8Array[] = [];
    let size = 0;
    for (;;) {
      if (reader === undefined) break;
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > max_bytes) {
        await reader.cancel();
        return { failure: `HTTP ${String(response.status)} response over routing.externalMaxResponseBytes` };
      }
      chunks.push(value);
    }
    const bytes = new Uint8Array(size);
    let at = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, at);
      at += chunk.byteLength;
    }
    return { status: response.status, body: new TextDecoder().decode(bytes) };
  } catch (error) {
    return { failure: signal.aborted ? 'aborted' : network_error(error) };
  }
}

/** A provider's error code from a response body, when it is a plain code word (`BadDeviceToken`, `UNAVAILABLE`). */
export function error_code(value: unknown): string | null {
  return typeof value === 'string' && /^[A-Za-z_]{1,64}$/.test(value) ? value : null;
}

/** `FAILED` for an HTTP reply that is not a success: the status and, when there is one, the provider's error code. */
export function http_failure(status: number, code: string | null): SendFailure {
  return { result: 'FAILED', reason: code === null ? `HTTP ${String(status)}` : `HTTP ${String(status)} ${code}` };
}

/** A JSON body's object, or null. */
export function json_object(text: string): Record<string, unknown> | null {
  try {
    const value: unknown = JSON.parse(text);
    return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function base64url(data: string | Uint8Array): string {
  return Buffer.from(data).toString('base64url');
}

/** A signed JWT: `RS256` with an RSA private key PEM, `ES256` with a P-256 private key PEM. */
export function sign_jwt(alg: 'RS256' | 'ES256', header: Record<string, unknown>, claims: Record<string, unknown>, private_key_pem: string): string {
  const input = `${base64url(JSON.stringify({ alg, typ: 'JWT', ...header }))}.${base64url(JSON.stringify(claims))}`;
  const signature = alg === 'RS256'
    ? sign('sha256', Buffer.from(input), private_key_pem)
    : sign('sha256', Buffer.from(input), { key: private_key_pem, dsaEncoding: 'ieee-p1363' });
  return `${input}.${base64url(signature)}`;
}
