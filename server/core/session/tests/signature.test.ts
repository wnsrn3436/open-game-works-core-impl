import { randomUUID } from 'node:crypto';
import * as CoreContract from '../../../generated/contract/core_contract.ts';
import { sign_request } from '../index.ts';
import { login, new_user, signed, start, stop_all, verify, type Instance, type Signed } from './session_kit.ts';

const UNAUTHORIZED = CoreContract.CoreError.CORE_ERROR_UNAUTHORIZED;
const SESSION_REPLACED = CoreContract.CoreError.CORE_ERROR_SESSION_REPLACED;
const WINDOW = 1000n;

afterEach(() => {
  stop_all();
});

async function signed_in(): Promise<{ instance: Instance; user: bigint; sid: string; key: string }> {
  const instance = await start({ 'session.signatureWindowMs': Number(WINDOW) });
  const user = await new_user(instance.storage);
  const { session_id, signing_key } = await login(instance, user);
  return { instance, user, sid: session_id, key: signing_key };
}

describe('verify_signature tamper', () => {
  it('passes the request as signed and is UNAUTHORIZED when one body byte, the request ID, the name or the timestamp changes', async () => {
    const { instance, user, sid, key } = await signed_in();
    const good = signed(key, 'ClaimQuestReward', instance.time.clock_now(), new Uint8Array([0x08, 0x01, 0x10, 0x02]));
    expect(verify(instance, user, sid, good)).toBe('pass');
    const body = Uint8Array.from(good.body);
    body[2] = 0x11;
    const tampered: Signed[] = [
      { ...good, body },
      { ...good, request_id: randomUUID() },
      { ...good, name: 'ClaimQuestRewards' },
      { ...good, timestamp: String(BigInt(good.timestamp) + 1n) },
    ];
    for (const request of tampered) expect(verify(instance, user, sid, request)).toBe(UNAUTHORIZED);
  });

  it('is UNAUTHORIZED for a signature by another session signing key, or another user', async () => {
    const { instance, user, sid, key } = await signed_in();
    const other = await new_user(instance.storage);
    const other_session = await login(instance, other);
    const now = instance.time.clock_now();
    expect(verify(instance, user, sid, signed(other_session.signing_key, 'Resync', now))).toBe(UNAUTHORIZED);
    expect(verify(instance, other, other_session.session_id, signed(key, 'Resync', now))).toBe(UNAUTHORIZED);
  });

  it('is SESSION_REPLACED for the first session ID and signing key after a second login', async () => {
    const { instance, user, sid, key } = await signed_in();
    const next = await login(instance, user);
    const now = instance.time.clock_now();
    expect(verify(instance, user, sid, signed(key, 'core/Resync', now))).toBe(SESSION_REPLACED);
    expect(verify(instance, user, next.session_id, signed(next.signing_key, 'core/Resync', now))).toBe('pass');
    expect(verify(instance, user, next.session_id, signed(key, 'core/Resync', now))).toBe(UNAUTHORIZED);
  });

  it('checks the session ID before the signature and the timestamp: another session ID is SESSION_REPLACED with a bad signature or timestamp', async () => {
    const { instance, user, sid } = await signed_in();
    const next = await login(instance, user);
    const now = instance.time.clock_now();
    const good = signed(next.signing_key, 'core/Resync', now);
    expect(verify(instance, user, sid, good)).toBe(SESSION_REPLACED);
    expect(verify(instance, user, sid, { ...good, signature: '0'.repeat(64) })).toBe(SESSION_REPLACED);
    expect(verify(instance, user, sid, signed(next.signing_key, 'core/Resync', now + WINDOW + 1n))).toBe(SESSION_REPLACED);
    expect(verify(instance, user, sid, { ...good, timestamp: '+1' })).toBe(UNAUTHORIZED);
  });

  it('reads the session record once: a login committed after check_current gives SESSION_REPLACED, not UNAUTHORIZED', async () => {
    const { instance, user, sid, key } = await signed_in();
    const request = signed(key, 'core/Resync', instance.time.clock_now());
    expect(instance.session.check_current(user, sid)).toBe('pass');
    await login(instance, user);
    expect(verify(instance, user, sid, request)).toBe(SESSION_REPLACED);
  });

  it('is UNAUTHORIZED for a missing or malformed header', async () => {
    const { instance, user, sid, key } = await signed_in();
    const good = signed(key, 'core/Resync', instance.time.clock_now());
    const { session } = instance;
    const check = (timestamp: string | null, signature: string | null): unknown => session.verify_signature(user, sid, good.name, good.request_id, timestamp, signature, good.body);
    expect(check(good.timestamp, good.signature)).toBe('pass');
    expect(check(null, good.signature)).toBe(UNAUTHORIZED);
    expect(check(good.timestamp, null)).toBe(UNAUTHORIZED);
    expect(check(`+${good.timestamp}`, good.signature)).toBe(UNAUTHORIZED);
    expect(check(`0${good.timestamp}`, good.signature)).toBe(UNAUTHORIZED);
    expect(check('1.8e12', good.signature)).toBe(UNAUTHORIZED);
    expect(check(String(2n ** 63n), good.signature)).toBe(UNAUTHORIZED);
    expect(check(good.timestamp, good.signature.toUpperCase())).toBe(UNAUTHORIZED);
    expect(check(good.timestamp, good.signature.slice(1))).toBe(UNAUTHORIZED);
  });

  it('is UNAUTHORIZED for a user without a session record', async () => {
    const { instance, sid, key } = await signed_in();
    const user = await new_user(instance.storage);
    expect(verify(instance, user, sid, signed(key, 'core/Resync', instance.time.clock_now()))).toBe(UNAUTHORIZED);
  });
});

describe('sign_request', () => {
  it('makes an X-Ogw-Signature that verify_signature passes, and the exported function is the same as the module method', async () => {
    const { instance, user, sid, key } = await signed_in();
    const request_id = randomUUID();
    const timestamp = String(instance.time.clock_now());
    const body = new Uint8Array([0x08, 0x01, 0x10, 0x02]);
    const signature = instance.session.sign_request(key, 'ClaimQuestReward', request_id, timestamp, body);
    expect(signature).toMatch(/^[0-9a-f]{64}$/);
    expect(sign_request(key, 'ClaimQuestReward', request_id, timestamp, body)).toBe(signature);
    expect(instance.session.verify_signature(user, sid, 'ClaimQuestReward', request_id, timestamp, signature, body)).toBe('pass');
  });

  it('makes a signature that verify_signature finds UNAUTHORIZED when one input changes', async () => {
    const { instance, user, sid, key } = await signed_in();
    const request_id = randomUUID();
    const timestamp = String(instance.time.clock_now());
    const body = new Uint8Array([0x08, 0x01]);
    const verify_with = (signature: string): unknown => instance.session.verify_signature(user, sid, 'core/Resync', request_id, timestamp, signature, body);
    const sign: typeof sign_request = (...args) => instance.session.sign_request(...args);
    expect(verify_with(sign(key, 'core/Resync', request_id, timestamp, body))).toBe('pass');
    expect(verify_with(sign(`${key}x`, 'core/Resync', request_id, timestamp, body))).toBe(UNAUTHORIZED);
    expect(verify_with(sign(key, 'Resync', request_id, timestamp, body))).toBe(UNAUTHORIZED);
    expect(verify_with(sign(key, 'core/Resync', randomUUID(), timestamp, body))).toBe(UNAUTHORIZED);
    expect(verify_with(sign(key, 'core/Resync', request_id, String(BigInt(timestamp) + 1n), body))).toBe(UNAUTHORIZED);
    expect(verify_with(sign(key, 'core/Resync', request_id, timestamp, new Uint8Array([0x08, 0x02])))).toBe(UNAUTHORIZED);
  });
});

describe('verify_signature window', () => {
  it('passes a timestamp on the window bound and is UNAUTHORIZED 1 ms outside it, on both sides', async () => {
    const { instance, user, sid, key } = await signed_in();
    const now = instance.time.clock_now();
    expect(verify(instance, user, sid, signed(key, 'core/Resync', now + WINDOW))).toBe('pass');
    expect(verify(instance, user, sid, signed(key, 'core/Resync', now - WINDOW))).toBe('pass');
    expect(verify(instance, user, sid, signed(key, 'core/Resync', now + WINDOW + 1n))).toBe(UNAUTHORIZED);
    expect(verify(instance, user, sid, signed(key, 'core/Resync', now - WINDOW - 1n))).toBe(UNAUTHORIZED);
  });

  it('follows the clock', async () => {
    const { instance, user, sid, key } = await signed_in();
    const request = signed(key, 'core/Resync', instance.time.clock_now());
    instance.clock.advance(WINDOW);
    expect(verify(instance, user, sid, request)).toBe('pass');
    instance.clock.advance(1n);
    expect(verify(instance, user, sid, request)).toBe(UNAUTHORIZED);
  });

  it('compares with server-time.user_now, which has the user’s cheat time offset in DEV', async () => {
    const { instance, user, sid, key } = await signed_in();
    const offset = 3_600_000n;
    instance.offsets.set(user, offset);
    const now = instance.time.clock_now();
    expect(instance.time.user_now(user, instance.storage.read_db())).toBe(now + offset);
    expect(verify(instance, user, sid, signed(key, 'core/Resync', now + offset + WINDOW))).toBe('pass');
    expect(verify(instance, user, sid, signed(key, 'core/Resync', now + offset + WINDOW + 1n))).toBe(UNAUTHORIZED);
    expect(verify(instance, user, sid, signed(key, 'core/Resync', now))).toBe(UNAUTHORIZED);
  });
});

describe('verify_signature name', () => {
  it('signs the request name: a game rpc and a core rpc of the same name do not pass for each other', async () => {
    const { instance, user, sid, key } = await signed_in();
    const now = instance.time.clock_now();
    const game = signed(key, 'Resync', now);
    const core = signed(key, 'core/Resync', now);
    expect(verify(instance, user, sid, game)).toBe('pass');
    expect(verify(instance, user, sid, core)).toBe('pass');
    expect(verify(instance, user, sid, { ...game, name: 'core/Resync' })).toBe(UNAUTHORIZED);
    expect(verify(instance, user, sid, { ...core, name: 'Resync' })).toBe(UNAUTHORIZED);
  });
});
