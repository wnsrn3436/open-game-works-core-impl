import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

/** `X-Ogw-Timestamp`: Unix ms as a decimal integer without sign or leading zero, below 2^63. */
const TIMESTAMP = /^(0|[1-9][0-9]{0,18})$/;
const TIMESTAMP_LIMIT = 2n ** 63n;
/** `X-Ogw-Signature`: HMAC-SHA256 as lowercase hex. */
const SIGNATURE = /^[0-9a-f]{64}$/;

/** The request a signature covers. */
export interface SignedRequest {
  /** Signature name: the contract request name. Example: `ClaimQuestReward`, `core/RefreshToken`. */
  readonly name: string;
  readonly request_id: string;
  /** The `X-Ogw-Timestamp` value as sent. */
  readonly timestamp: string;
  readonly body: Uint8Array;
}

/**
 * The signature input: signature name, request ID, `X-Ogw-Timestamp` value and the lowercase hex SHA-256 of the
 * body, joined with `\n`.
 */
export function signature_input(request: SignedRequest): string {
  const body_hash = createHash('sha256').update(request.body).digest('hex');
  return [request.name, request.request_id, request.timestamp, body_hash].join('\n');
}

/** The `X-Ogw-Signature` value of a request: HMAC-SHA256 keyed by the UTF-8 bytes of the session signing key. */
export function request_signature(signing_key: string, request: SignedRequest): string {
  return createHmac('sha256', Buffer.from(signing_key, 'utf8')).update(signature_input(request), 'utf8').digest('hex');
}

/** The `X-Ogw-Timestamp` value as Unix ms, or null when the header is missing or its format is wrong. */
export function parse_timestamp(header: string | null | undefined): bigint | null {
  if (header === null || header === undefined || !TIMESTAMP.test(header)) return null;
  const value = BigInt(header);
  return value < TIMESTAMP_LIMIT ? value : null;
}

/** True when the `X-Ogw-Signature` value has the lowercase hex format. */
export function is_signature_format(header: string | null | undefined): header is string {
  return header !== null && header !== undefined && SIGNATURE.test(header);
}

/** Compares a well-formed `X-Ogw-Signature` value with the expected one in constant time. */
export function signature_matches(expected: string, given: string): boolean {
  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(given, 'utf8');
  return a.length === b.length && timingSafeEqual(a, b);
}

/** True when the timestamp differs from the compare time by at most the window. */
export function in_window(timestamp: bigint, compare_time: bigint, window_ms: bigint): boolean {
  const diff = timestamp - compare_time;
  return (diff < 0n ? -diff : diff) <= window_ms;
}
