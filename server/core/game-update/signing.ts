/**
 * The deploy list signing key (`game-update` `### signature`): an Ed25519 private key seed of 32 bytes in standard
 * base64, its public key and key ID, and the signature JSON. The private key does not leave this file's objects.
 */
import { createHash, createPrivateKey, createPublicKey, sign, type KeyObject } from 'node:crypto';
import { canonical_json } from '../storage/index.ts';

/** PKCS #8 DER prefix of an Ed25519 private key; the 32 byte seed follows. */
const ED25519_PKCS8_PREFIX = Buffer.from('302e020100300506032b657004220420', 'hex');
const KEY_BYTES = 32;

/** Standard base64 bytes of `text`, or null when `text` is not the standard base64 of those bytes. */
export function decode_base64(text: string): Uint8Array | null {
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(text) || text.length % 4 !== 0) return null;
  const bytes = Buffer.from(text, 'base64');
  return bytes.toString('base64') === text ? new Uint8Array(bytes) : null;
}

/** The key ID of a public key: the first 16 lowercase hex characters of its SHA-256. */
export function key_id_of(public_key: Uint8Array): string {
  return createHash('sha256').update(public_key).digest('hex').slice(0, 16);
}

export interface SigningKey {
  /** The Ed25519 public key, 32 bytes. */
  readonly public_key: Uint8Array;
  /** `public_key` in standard base64: the form of an `updatePublicKeys` item. */
  readonly public_key_base64: string;
  readonly key_id: string;
  /** The signature JSON bytes of deploy list bytes of that `sequence`. */
  signature_json(deploy_list: Uint8Array, sequence: bigint): Uint8Array;
}

/** The signing key of a seed in standard base64, or null when the value is not 32 bytes of standard base64. */
export function load_signing_key(seed_base64: string): SigningKey | null {
  const seed = decode_base64(seed_base64);
  if (seed === null || seed.length !== KEY_BYTES) return null;
  const private_key: KeyObject = createPrivateKey({ key: Buffer.concat([ED25519_PKCS8_PREFIX, seed]), format: 'der', type: 'pkcs8' });
  const spki = createPublicKey(private_key).export({ format: 'der', type: 'spki' });
  const public_key = new Uint8Array(spki.subarray(spki.length - KEY_BYTES));
  const key_id = key_id_of(public_key);
  return {
    public_key,
    public_key_base64: Buffer.from(public_key).toString('base64'),
    key_id,
    signature_json: (deploy_list, sequence) => {
      const signature = sign(null, deploy_list, private_key).toString('base64');
      return Buffer.from(canonical_json({ key_id, sequence, signature }), 'utf8');
    },
  };
}

/** True when `public_key` is one of the standard base64 public keys of `trusted`. */
export function is_trusted(public_key: Uint8Array, trusted: readonly unknown[]): boolean {
  return trusted.some((item) => {
    if (typeof item !== 'string') return false;
    const bytes = decode_base64(item);
    return bytes !== null && Buffer.from(bytes).equals(Buffer.from(public_key));
  });
}
