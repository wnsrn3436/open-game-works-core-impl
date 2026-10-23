import { randomBytes, sign } from 'node:crypto';
import { access_token_key, read_access_token, sha256_hex, sign_access_token, type AccessTokenKey } from '../token.ts';

function key(): AccessTokenKey {
  const made = access_token_key(randomBytes(32).toString('base64'));
  if (made === null) throw new Error('no key');
  return made;
}

function b64(text: string): string {
  return Buffer.from(text, 'utf8').toString('base64url');
}

/** A token of any header and payload text, signed with the key, so only the format is wrong. */
function forge(k: AccessTokenKey, header: string, payload: string): string {
  const input = `${b64(header)}.${b64(payload)}`;
  return `${input}.${sign(null, Buffer.from(input, 'ascii'), k.private_key).toString('base64url')}`;
}

const HEADER = '{"alg":"EdDSA","typ":"ogw-access-v1"}';

describe('access token format', () => {
  it('signs the fixed header and a payload of exp, sid, uid in byte order without whitespace', () => {
    const k = key();
    const token = sign_access_token(k, 42n, 'abc', 1_800_000_000_000n);
    const [header, payload] = token.split('.') as [string, string];
    expect(Buffer.from(header, 'base64url').toString()).toBe(HEADER);
    expect(Buffer.from(payload, 'base64url').toString()).toBe('{"exp":1800000000000,"sid":"abc","uid":"42"}');
    expect(read_access_token(k, token)).toEqual({ user_id: 42n, session_id: 'abc', expires_at: 1_800_000_000_000n });
  });

  it('keeps a user ID above 2^53 exact', () => {
    const k = key();
    const big = 2n ** 62n + 3n;
    expect(read_access_token(k, sign_access_token(k, big, 's', 5n))).toEqual({ user_id: big, session_id: 's', expires_at: 5n });
  });

  it('refuses a token with a changed signature, another key, or a changed payload', () => {
    const k = key();
    const token = sign_access_token(k, 7n, 'sid', 100n);
    const [h, p, s] = token.split('.') as [string, string, string];
    const flipped = `${s.slice(0, -2)}${s.endsWith('AA') ? 'BA' : 'AA'}`;
    expect(read_access_token(k, `${h}.${p}.${flipped}`)).toBe('invalid');
    expect(read_access_token(key(), token)).toBe('invalid');
    expect(read_access_token(k, `${h}.${b64('{"exp":100,"sid":"sid","uid":"8"}')}.${s}`)).toBe('invalid');
  });

  it('refuses keys out of byte order, an unknown key, a duplicate key, whitespace and wrong types even when signed', () => {
    const k = key();
    const payloads = [
      '{"uid":"7","sid":"sid","exp":100}',
      '{"exp":100,"sid":"sid","uid":"7","x":1}',
      '{"exp":100,"exp":100,"sid":"sid","uid":"7"}',
      '{"exp": 100,"sid":"sid","uid":"7"}',
      '{"exp":"100","sid":"sid","uid":"7"}',
      '{"exp":100,"sid":"sid","uid":7}',
      '{"exp":100,"sid":"sid","uid":"07"}',
      '{"exp":100,"sid":"sid"}',
    ];
    for (const payload of payloads) expect(read_access_token(k, forge(k, HEADER, payload))).toBe('invalid');
    expect(read_access_token(k, forge(k, HEADER, '{"exp":100,"sid":"sid","uid":"7"}'))).toEqual({ user_id: 7n, session_id: 'sid', expires_at: 100n });
  });

  it('refuses another header even when signed', () => {
    const k = key();
    expect(read_access_token(k, forge(k, '{"typ":"ogw-access-v1","alg":"EdDSA"}', '{"exp":100,"sid":"sid","uid":"7"}'))).toBe('invalid');
    expect(read_access_token(k, forge(k, '{"alg":"none","typ":"ogw-access-v1"}', '{"exp":100,"sid":"sid","uid":"7"}'))).toBe('invalid');
  });

  it('takes only a 32-byte seed in standard base64 as the key', () => {
    expect(access_token_key(randomBytes(31).toString('base64'))).toBeNull();
    expect(access_token_key(randomBytes(32).toString('base64url'))).toBeNull();
    expect(access_token_key('not a key')).toBeNull();
  });

  it('hashes login tokens to SHA-256 lowercase hex', () => {
    expect(sha256_hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });
});
