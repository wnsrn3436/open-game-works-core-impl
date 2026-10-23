/** JWT signing and JWS verification for the real store adapters (ES256 and RS256, x5c certificate chains, JWKS). */
import { createPublicKey, sign, verify, X509Certificate, type KeyObject } from 'node:crypto';

export function base64url(bytes: Uint8Array | string): string {
  return Buffer.from(bytes).toString('base64url');
}

function json_part(value: unknown): string {
  return base64url(JSON.stringify(value));
}

/** A compact JWS split into its parts; null when it is not three base64url parts with JSON header and payload. */
export interface DecodedJws {
  readonly header: Record<string, unknown>;
  readonly payload: Record<string, unknown>;
  readonly signing_input: string;
  readonly signature: Buffer;
}

function object_of(text: string): Record<string, unknown> | null {
  try {
    const value = JSON.parse(Buffer.from(text, 'base64url').toString('utf8')) as unknown;
    return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

export function decode_jws(token: string): DecodedJws | null {
  const parts = token.split('.');
  if (parts.length !== 3 || parts.some((p) => !/^[A-Za-z0-9_-]*$/.test(p))) return null;
  const [h = '', p = '', s = ''] = parts;
  const header = object_of(h);
  const payload = object_of(p);
  if (header === null || payload === null) return null;
  return { header, payload, signing_input: `${h}.${p}`, signature: Buffer.from(s, 'base64url') };
}

/** An ES256 JWT signed with a PKCS#8 PEM P-256 private key (`.p8`). */
export function sign_es256(header: Record<string, unknown>, payload: Record<string, unknown>, private_key_pem: string): string {
  const input = `${json_part({ ...header, alg: 'ES256', typ: 'JWT' })}.${json_part(payload)}`;
  const signature = sign('sha256', Buffer.from(input), { key: private_key_pem, dsaEncoding: 'ieee-p1363' });
  return `${input}.${base64url(signature)}`;
}

/** An RS256 JWT signed with a PEM RSA private key. */
export function sign_rs256(payload: Record<string, unknown>, private_key_pem: string): string {
  const input = `${json_part({ alg: 'RS256', typ: 'JWT' })}.${json_part(payload)}`;
  return `${input}.${base64url(sign('RSA-SHA256', Buffer.from(input), private_key_pem))}`;
}

function verify_es256(jws: DecodedJws, key: KeyObject): boolean {
  try {
    return verify('sha256', Buffer.from(jws.signing_input), { key, dsaEncoding: 'ieee-p1363' }, jws.signature);
  } catch {
    return false;
  }
}

/** True when the DER bytes of a certificate hold the encoded object identifier (dotted form). */
export function has_oid(cert: X509Certificate, oid: string): boolean {
  const arcs = oid.split('.').map((a) => BigInt(a));
  const body: number[] = [Number((arcs[0] ?? 0n) * 40n + (arcs[1] ?? 0n))];
  for (const arc of arcs.slice(2)) {
    const bytes: number[] = [Number(arc & 0x7fn)];
    for (let rest = arc >> 7n; rest > 0n; rest >>= 7n) bytes.unshift(Number((rest & 0x7fn) | 0x80n));
    body.push(...bytes);
  }
  return cert.raw.includes(Buffer.from([0x06, body.length, ...body]));
}

/** The certificates of a JWS header `x5c` (leaf first), or null when it has fewer than two or one does not parse. */
function x5c_chain(header: Record<string, unknown>): X509Certificate[] | null {
  if (!Array.isArray(header.x5c) || header.x5c.length < 2) return null;
  try {
    return (header.x5c as unknown[]).map((der) => {
      if (typeof der !== 'string') throw new TypeError('x5c');
      return new X509Certificate(Buffer.from(der, 'base64'));
    });
  } catch {
    return null;
  }
}

/** True when every certificate is valid at `time` and each is issued and signed by the next one. */
function chain_signed(chain: readonly X509Certificate[], time: Date): boolean {
  for (const cert of chain) {
    if (new Date(cert.validFrom) > time || new Date(cert.validTo) < time) return false;
  }
  for (let i = 0; i + 1 < chain.length; i += 1) {
    const cert = chain[i];
    const issuer = chain[i + 1];
    if (cert === undefined || issuer === undefined || !cert.checkIssued(issuer) || !cert.verify(issuer.publicKey)) return false;
  }
  return true;
}

/** True when the top certificate is one of the roots or is signed by one. */
function anchored(top: X509Certificate | undefined, roots: readonly X509Certificate[]): boolean {
  return top !== undefined && roots.some((root) => top.fingerprint256 === root.fingerprint256 || (top.checkIssued(root) && top.verify(root.publicKey)));
}

/**
 * The payload of an ES256 JWS whose header `x5c` chain (leaf first) is signed up to one of the root certificates.
 * The leaf and the next certificate must hold the given object identifiers (Apple's marker extensions); the chain is
 * checked at `at` (Unix ms). Null when anything fails.
 */
export function verify_x5c_jws(token: string, roots: readonly X509Certificate[], leaf_oid: string, intermediate_oid: string, at: bigint): Record<string, unknown> | null {
  const jws = decode_jws(token);
  if (jws === null || jws.header.alg !== 'ES256') return null;
  const chain = x5c_chain(jws.header);
  if (chain === null || !chain_signed(chain, new Date(Number(at))) || !anchored(chain[chain.length - 1], roots)) return null;
  const [leaf, intermediate] = chain;
  if (leaf === undefined || intermediate === undefined || !has_oid(leaf, leaf_oid) || !has_oid(intermediate, intermediate_oid)) return null;
  return verify_es256(jws, leaf.publicKey) ? jws.payload : null;
}

/** Root certificates from a key source value: a list of PEM or base64 DER strings. Null when it is not one. */
export function roots_of(value: unknown): X509Certificate[] | null {
  if (!Array.isArray(value)) return null;
  try {
    return value.map((item) => {
      if (typeof item !== 'string') throw new TypeError('root');
      return new X509Certificate(item.includes('-----BEGIN') ? item : Buffer.from(item, 'base64'));
    });
  } catch {
    return null;
  }
}

/** The payload of an RS256 JWT signed by a key of the JWKS (`{keys: [...]}`) with the header `kid`; null otherwise. */
export function verify_rs256_jwks(token: string, jwks: unknown): Record<string, unknown> | null {
  const jws = decode_jws(token);
  if (jws === null || jws.header.alg !== 'RS256' || typeof jwks !== 'object' || jwks === null) return null;
  const keys = (jwks as { keys?: unknown }).keys;
  if (!Array.isArray(keys)) return null;
  const jwk = keys.find((k) => typeof k === 'object' && k !== null && (k as { kid?: unknown }).kid === jws.header.kid) as Record<string, unknown> | undefined;
  if (jwk === undefined) return null;
  try {
    const key = createPublicKey({ key: jwk, format: 'jwk' });
    return verify('RSA-SHA256', Buffer.from(jws.signing_input), key, jws.signature) ? jws.payload : null;
  } catch {
    return null;
  }
}
