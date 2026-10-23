/**
 * Login tokens and access tokens (`### token`). A login token is 32 secure random bytes in base64url; the DB keeps
 * only its SHA-256. An access token is a JWS compact of fixed header `{"alg":"EdDSA","typ":"ogw-access-v1"}` and
 * payload `{"exp":<ms>,"sid":"<session ID>","uid":"<user ID>"}` with keys in byte order and no whitespace.
 */
import { createHash, createPrivateKey, createPublicKey, randomBytes, sign, verify, type KeyObject } from 'node:crypto';

const HEADER = '{"alg":"EdDSA","typ":"ogw-access-v1"}';
const HEADER_B64 = Buffer.from(HEADER, 'utf8').toString('base64url');
const MAX_INT64 = 2n ** 63n - 1n;
/** PKCS #8 DER prefix of an Ed25519 private key; the 32-byte seed follows. */
const ED25519_PKCS8_PREFIX = Buffer.from('302e020100300506032b657004220420', 'hex');

/** The value of a decimal text of an `int64` of 1 or more with no sign or leading zero; null otherwise. */
export function positive_int64(text: string): bigint | null {
  if (!/^[1-9][0-9]{0,18}$/.test(text)) return null;
  const value = BigInt(text);
  return value > MAX_INT64 ? null : value;
}

/** SHA-256 lowercase hex of a string's UTF-8 bytes. */
export function sha256_hex(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

/** A new login token. */
export function new_login_token(): string {
  return randomBytes(32).toString('base64url');
}

export interface AccessTokenKey {
  readonly private_key: KeyObject;
  readonly public_key: KeyObject;
}

/** The access token key of an Ed25519 seed (32 bytes, standard base64); null when the value is not one. */
export function access_token_key(seed_base64: string): AccessTokenKey | null {
  if (!/^[A-Za-z0-9+/]{43}=$/.test(seed_base64)) return null;
  const seed = Buffer.from(seed_base64, 'base64');
  if (seed.length !== 32) return null;
  const private_key = createPrivateKey({ key: Buffer.concat([ED25519_PKCS8_PREFIX, seed]), format: 'der', type: 'pkcs8' });
  return { private_key, public_key: createPublicKey(private_key) };
}

function payload_text(user_id: bigint, session_id: string, expires_at: bigint): string {
  return `{"exp":${expires_at.toString()},"sid":${JSON.stringify(session_id)},"uid":"${user_id.toString()}"}`;
}

/** An access token for (user ID, session ID) that expires at `expires_at` (Unix ms). */
export function sign_access_token(key: AccessTokenKey, user_id: bigint, session_id: string, expires_at: bigint): string {
  const input = `${HEADER_B64}.${Buffer.from(payload_text(user_id, session_id, expires_at), 'utf8').toString('base64url')}`;
  return `${input}.${sign(null, Buffer.from(input, 'ascii'), key.private_key).toString('base64url')}`;
}

export interface AccessTokenClaims {
  readonly user_id: bigint;
  readonly session_id: string;
  readonly expires_at: bigint;
}

const BASE64URL = /^[A-Za-z0-9_-]*$/;

function base64url_bytes(part: string): Buffer | null {
  if (!BASE64URL.test(part) || part.length % 4 === 1) return null;
  const bytes = Buffer.from(part, 'base64url');
  // Only the canonical encoding: no trailing bits that another string would also decode to.
  return bytes.toString('base64url') === part ? bytes : null;
}

/** The claims of a payload that is exactly the canonical form, or null. */
function parse_payload(text: string): AccessTokenClaims | null {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const { exp, sid, uid } = value as Record<string, unknown>;
  if (typeof exp !== 'number' || !Number.isSafeInteger(exp) || exp < 0) return null;
  if (typeof sid !== 'string' || typeof uid !== 'string') return null;
  const user_id = positive_int64(uid);
  if (user_id === null) return null;
  const claims = { user_id, session_id: sid, expires_at: BigInt(exp) };
  // Duplicate keys, unknown keys, keys out of byte order and whitespace all make the text differ from this.
  return payload_text(claims.user_id, claims.session_id, claims.expires_at) === text ? claims : null;
}

/**
 * The claims of a token with the fixed header, a valid signature and a canonical payload; `invalid` otherwise. The
 * caller checks the length limit and the expiry.
 */
export function read_access_token(key: AccessTokenKey, token: string): AccessTokenClaims | 'invalid' {
  const parts = token.split('.');
  if (parts.length !== 3) return 'invalid';
  const [header, payload, signature] = parts as [string, string, string];
  if (header !== HEADER_B64) return 'invalid';
  const payload_bytes = base64url_bytes(payload);
  const signature_bytes = base64url_bytes(signature);
  if (payload_bytes === null || signature_bytes === null || signature_bytes.length !== 64) return 'invalid';
  if (!verify(null, Buffer.from(`${header}.${payload}`, 'ascii'), key.public_key, signature_bytes)) return 'invalid';
  const text = new TextDecoder('utf-8', { fatal: true });
  let decoded: string;
  try {
    decoded = text.decode(payload_bytes);
  } catch {
    return 'invalid';
  }
  return parse_payload(decoded) ?? 'invalid';
}
