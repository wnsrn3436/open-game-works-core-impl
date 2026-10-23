import { createHash, createPublicKey, randomBytes, verify } from 'node:crypto';
import { decode_base64, is_trusted, key_id_of, load_signing_key } from '../signing.ts';

/** SPKI DER prefix of an Ed25519 public key; the 32 byte key follows. */
const SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex');

function verifies(public_key: Uint8Array, data: Uint8Array, signature_base64: string): boolean {
  const key = createPublicKey({ key: Buffer.concat([SPKI_PREFIX, public_key]), format: 'der', type: 'spki' });
  return verify(null, data, key, Buffer.from(signature_base64, 'base64'));
}

describe('signing key', () => {
  it('signs deploy list bytes so that the public key verifies them, and the signature JSON carries key_id and sequence', () => {
    const key = load_signing_key(randomBytes(32).toString('base64'));
    expect(key).not.toBeNull();
    if (key === null) return;
    const data = Buffer.from('{"format":1}', 'utf8');
    const signature = JSON.parse(Buffer.from(key.signature_json(data, 1234567890123n)).toString('utf8')) as { key_id: string; sequence: number; signature: string };
    expect(Object.keys(signature).sort()).toEqual(['key_id', 'sequence', 'signature']);
    expect(signature.sequence).toBe(1234567890123);
    expect(signature.key_id).toBe(key.key_id);
    expect(Buffer.from(signature.signature, 'base64')).toHaveLength(64);
    expect(verifies(key.public_key, data, signature.signature)).toBe(true);
    expect(verifies(key.public_key, Buffer.from('{"format":2}', 'utf8'), signature.signature)).toBe(false);
  });

  it('gives a 32 byte public key in standard base64 and a key ID of the first 16 hex of its SHA-256', () => {
    const key = load_signing_key(randomBytes(32).toString('base64'));
    if (key === null) throw new Error('no key');
    const decoded = decode_base64(key.public_key_base64);
    expect(decoded).toHaveLength(32);
    expect(key.key_id).toBe(createHash('sha256').update(decoded as Uint8Array).digest('hex').slice(0, 16));
    expect(key.key_id).toMatch(/^[0-9a-f]{16}$/);
    expect(key_id_of(key.public_key)).toBe(key.key_id);
  });

  it('derives the RFC 8032 public key of a known seed', () => {
    // RFC 8032 section 7.1, TEST 1.
    const seed = Buffer.from('9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60', 'hex');
    const key = load_signing_key(seed.toString('base64'));
    expect(Buffer.from(key?.public_key ?? []).toString('hex')).toBe('d75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a');
  });

  it('rejects a seed that is not 32 bytes of standard base64', () => {
    expect(load_signing_key(randomBytes(31).toString('base64'))).toBeNull();
    expect(load_signing_key(randomBytes(33).toString('base64'))).toBeNull();
    expect(load_signing_key(randomBytes(32).toString('base64url').replace(/=/g, ''))).toBeNull();
    expect(load_signing_key('')).toBeNull();
  });

  it('trusts a public key only when updatePublicKeys holds it', () => {
    const key = load_signing_key(randomBytes(32).toString('base64'));
    const other = load_signing_key(randomBytes(32).toString('base64'));
    if (key === null || other === null) throw new Error('no key');
    expect(is_trusted(key.public_key, [other.public_key_base64, key.public_key_base64])).toBe(true);
    expect(is_trusted(key.public_key, [other.public_key_base64])).toBe(false);
    expect(is_trusted(key.public_key, [])).toBe(false);
    expect(is_trusted(key.public_key, [1, null])).toBe(false);
  });
});
