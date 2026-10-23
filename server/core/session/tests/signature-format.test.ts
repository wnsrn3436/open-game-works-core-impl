import { createHmac } from 'node:crypto';
import { in_window, is_signature_format, parse_timestamp, request_signature, signature_input, signature_matches, type SignedRequest } from '../signature.ts';

const KEY = 'c2Vzc2lvbi1zaWduaW5nLWtleS1mb3ItdGVzdHMtMDE';
const REQUEST: SignedRequest = {
  name: 'core/Resync',
  request_id: '6f1c2a4e-8b0d-4c3a-9e7f-1a2b3c4d5e6f',
  timestamp: '1800000000000',
  body: new Uint8Array([0x08, 0x01]),
};

describe('signature input', () => {
  it('joins the signature name, request ID, timestamp and lowercase hex body SHA-256 with \\n', () => {
    const empty = { ...REQUEST, body: new Uint8Array(0) };
    expect(signature_input(empty)).toBe(
      'core/Resync\n6f1c2a4e-8b0d-4c3a-9e7f-1a2b3c4d5e6f\n1800000000000\ne3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    );
  });

  it('is the lowercase hex HMAC-SHA256 of the input keyed by the UTF-8 bytes of the signing key', () => {
    const expected = createHmac('sha256', Buffer.from(KEY, 'utf8')).update(signature_input(REQUEST), 'utf8').digest('hex');
    expect(request_signature(KEY, REQUEST)).toBe(expected);
    expect(request_signature(KEY, REQUEST)).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('signature tamper', () => {
  const good = request_signature(KEY, REQUEST);

  it('differs when one body byte, the request ID, the signature name or the timestamp changes', () => {
    const changed: SignedRequest[] = [
      { ...REQUEST, body: new Uint8Array([0x08, 0x00]) },
      { ...REQUEST, request_id: '6f1c2a4e-8b0d-4c3a-9e7f-1a2b3c4d5e60' },
      { ...REQUEST, name: 'core/Logout' },
      { ...REQUEST, timestamp: '1800000000001' },
    ];
    for (const request of changed) expect(signature_matches(request_signature(KEY, request), good)).toBe(false);
    expect(signature_matches(request_signature(KEY, REQUEST), good)).toBe(true);
  });

  it('a game rpc signature and the core rpc signature of the same name do not pass for each other', () => {
    const game = request_signature(KEY, { ...REQUEST, name: 'Resync' });
    const core = request_signature(KEY, { ...REQUEST, name: 'core/Resync' });
    expect(signature_matches(core, game)).toBe(false);
    expect(signature_matches(game, core)).toBe(false);
  });

  it('differs for another signing key', () => {
    expect(signature_matches(request_signature(`${KEY}x`, REQUEST), good)).toBe(false);
  });
});

describe('header format', () => {
  it('takes a decimal Unix ms timestamp and rejects a missing or malformed one', () => {
    expect(parse_timestamp('1800000000000')).toBe(1_800_000_000_000n);
    expect(parse_timestamp('0')).toBe(0n);
    expect(parse_timestamp('9223372036854775807')).toBe(2n ** 63n - 1n);
    for (const bad of [null, undefined, '', ' 1', '1 ', '+1', '-1', '01', '1.0', '1e3', '0x10', 'abc', '9223372036854775808', '12345678901234567890']) {
      expect(parse_timestamp(bad)).toBeNull();
    }
  });

  it('takes a 64 character lowercase hex signature and rejects other values', () => {
    const good = request_signature(KEY, REQUEST);
    expect(is_signature_format(good)).toBe(true);
    for (const bad of [null, undefined, '', good.toUpperCase(), good.slice(1), `${good}0`, `${good.slice(1)}g`]) {
      expect(is_signature_format(bad)).toBe(false);
    }
  });
});

describe('timestamp window', () => {
  it('passes at the window bound on both sides and fails 1 ms outside', () => {
    const now = 1_800_000_000_000n;
    const window = 1000n;
    expect(in_window(now, now, window)).toBe(true);
    expect(in_window(now + window, now, window)).toBe(true);
    expect(in_window(now - window, now, window)).toBe(true);
    expect(in_window(now + window + 1n, now, window)).toBe(false);
    expect(in_window(now - window - 1n, now, window)).toBe(false);
    expect(in_window(now, now, 0n)).toBe(true);
    expect(in_window(now + 1n, now, 0n)).toBe(false);
  });
});
