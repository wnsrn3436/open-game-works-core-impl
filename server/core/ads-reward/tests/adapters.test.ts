import { generateKeyPairSync, randomBytes, randomUUID, sign } from 'node:crypto';
import { FORMAT_ERROR, network_name, type ParsedCallback } from '../adapter.ts';
import { admob_key_source, admob_keys, create_admob_adapter } from '../adapters/admob.ts';
import { create_fake_adapter } from '../dev/adapters/fake.ts';

function parsed(value: ParsedCallback | typeof FORMAT_ERROR): ParsedCallback {
  if (value === FORMAT_ERROR) throw new Error('format error');
  return value;
}

describe('fake ads adapter', () => {
  it('parses and verifies the query of sign_callback with the key of its key ID', async () => {
    const { adapter, controller } = create_fake_adapter('ads');
    const notify_id = randomUUID();
    const query = controller.sign_callback(notify_id, 42n, 1n);
    expect(query.startsWith(`notify_id=${notify_id}&user_id=42&key_id=1&signature=`)).toBe(true);
    const callback = parsed(adapter.parse(query));
    expect([callback.notify_id, callback.user_id, callback.key_id]).toEqual([notify_id, '42', '1']);
    const keys = await adapter.fetch_keys(new AbortController().signal);
    if (typeof keys === 'string') throw new Error(keys);
    const key = keys.get('1');
    if (key === undefined) throw new Error('no key 1');
    expect(adapter.verify(callback.signed_text, callback.signature, key)).toBe(true);
    expect(adapter.verify(`${callback.signed_text}x`, callback.signature, key)).toBe(false);
    expect(adapter.verify(callback.signed_text, callback.signature, new Uint8Array(randomBytes(32)))).toBe(false);
    expect(controller.calls().map((c) => c.operation)).toEqual(['parse', 'fetch_keys', 'verify', 'verify', 'verify']);
  });

  it('takes the key list and the fetch_keys failure from its controller', async () => {
    const { adapter, controller } = create_fake_adapter('ads');
    const key = new Uint8Array(randomBytes(32));
    controller.set_result('fetch_keys', [{ key_id: 7n, key }]);
    const keys = await adapter.fetch_keys(new AbortController().signal);
    expect(typeof keys === 'string' ? keys : [...keys.keys()]).toEqual(['7']);
    expect(() => controller.sign_callback(randomUUID(), 1n, 1n)).toThrow();
    controller.set_failure('fetch_keys', 'communication_failure');
    expect(await adapter.fetch_keys(new AbortController().signal)).toBe('communication_failure');
    controller.set_failure('fetch_keys', 'timeout');
    const limit = new AbortController();
    const pending = adapter.fetch_keys(limit.signal);
    limit.abort();
    expect(await pending).toBe('timeout');
    controller.set_failure('fetch_keys', null);
    expect(typeof (await adapter.fetch_keys(new AbortController().signal))).toBe('object');
  });

  it('answers a format error to a missing or reordered parameter, or a malformed key_id or signature', () => {
    const { adapter, controller } = create_fake_adapter('ads');
    const notify_id = randomUUID();
    const good = controller.sign_callback(notify_id, 5n, 1n);
    const signature = good.slice(good.indexOf('&signature=') + '&signature='.length);
    const bad = [
      '',
      `notify_id=${notify_id}&user_id=5&key_id=1`,
      `user_id=5&notify_id=${notify_id}&key_id=1&signature=${signature}`,
      `notify_id=${notify_id}&key_id=1&signature=${signature}`,
      `notify_id=${notify_id}&user_id=5&key_id=x&signature=${signature}`,
      `notify_id=${notify_id}&user_id=5&key_id=01&signature=${signature}`,
      `notify_id=${notify_id}&user_id=5&key_id=1&signature=${signature}=`,
      `notify_id=${notify_id}&user_id=5&key_id=1&signature=${signature.slice(1)}`,
      `${good}&more=1`,
    ];
    for (const query of bad) expect(adapter.parse(query)).toBe(FORMAT_ERROR);
    expect(adapter.parse(good)).not.toBe(FORMAT_ERROR);
  });

  it('does not check the reward notify ID and the user ID, and returns an empty value as an empty string', () => {
    const { adapter } = create_fake_adapter('ads');
    const signature = 'A'.repeat(43);
    const values: { notify_id: string; user_id: string }[] = [
      { notify_id: randomUUID().toUpperCase(), user_id: '5' },
      { notify_id: `${randomUUID()}0`, user_id: '05' },
      { notify_id: '', user_id: '0' },
      { notify_id: 'x', user_id: '9223372036854775808' },
      { notify_id: '', user_id: '' },
      { notify_id: randomUUID(), user_id: 'x' },
    ];
    for (const { notify_id, user_id } of values) {
      const callback = parsed(adapter.parse(`notify_id=${notify_id}&user_id=${user_id}&key_id=1&signature=${signature}`));
      expect([callback.notify_id, callback.user_id, callback.key_id]).toEqual([notify_id, user_id, '1']);
    }
  });
});

describe('ads-admob adapter', () => {
  const pair = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const base64 = pair.publicKey.export({ format: 'der', type: 'spki' }).toString('base64');
  const text = `ad_network=5450213213286189855&ad_unit=1234567890&custom_data=${randomUUID()}&reward_amount=1&reward_item=coin&timestamp=150777&transaction_id=abc&user_id=12`;
  const signature = sign('sha256', Buffer.from(text, 'utf8'), { key: pair.privateKey, dsaEncoding: 'der' }).toString('base64url');

  it('parses the query, verifies the ECDSA signature with the key of key_id and rejects another text', async () => {
    const adapter = create_admob_adapter(() => Promise.resolve([{ keyId: 3335741209, base64 }]));
    const callback = parsed(adapter.parse(`${text}&signature=${signature}&key_id=3335741209`));
    expect([callback.user_id, callback.key_id, callback.signed_text]).toEqual(['12', '3335741209', text]);
    const keys = await adapter.fetch_keys(new AbortController().signal);
    if (typeof keys === 'string') throw new Error(keys);
    const key = keys.get('3335741209');
    if (key === undefined) throw new Error('no key');
    expect(adapter.verify(callback.signed_text, callback.signature, key)).toBe(true);
    expect(adapter.verify(`${callback.signed_text}&x=1`, callback.signature, key)).toBe(false);
  });

  it('answers a format error when signature and key_id are not the last two parameters, or key_id or signature is malformed', () => {
    const adapter = create_admob_adapter(() => Promise.resolve([]));
    expect(adapter.parse(`${text}&key_id=1&signature=${signature}`)).toBe(FORMAT_ERROR);
    expect(adapter.parse(`${text}&signature=${signature}`)).toBe(FORMAT_ERROR);
    expect(adapter.parse(`${text}&signature=%%&key_id=1`)).toBe(FORMAT_ERROR);
    expect(adapter.parse(`${text}&signature=@@&key_id=1`)).toBe(FORMAT_ERROR);
    expect(adapter.parse(`${text}&signature=${signature}&key_id=x`)).toBe(FORMAT_ERROR);
    expect(adapter.parse(`a&${text}&signature=${signature}&key_id=1`)).toBe(FORMAT_ERROR);
  });

  it('does not check custom_data and user_id, and returns a missing or empty one as an empty string', () => {
    const adapter = create_admob_adapter(() => Promise.resolve([]));
    const long = '가'.repeat(36);
    const uuid = /custom_data=([^&]*)/.exec(text)?.[1] ?? '';
    const cases: [string, string, string][] = [
      [text.replace('user_id=12', 'user_id='), '', uuid],
      [text.replace('user_id=12', 'user_id=x'), 'x', uuid],
      [text.replace(/&user_id=12$/, ''), '', uuid],
      [text.replace(/custom_data=[^&]*/, 'custom_data='), '12', ''],
      [text.replace(/custom_data=[^&]*&/, ''), '12', ''],
      [text.replace(/custom_data=[^&]*/, `custom_data=${encodeURIComponent(long)}`), '12', long],
    ];
    for (const [query, user_id, notify_id] of cases) {
      const callback = parsed(adapter.parse(`${query}&signature=${signature}&key_id=1`));
      expect([callback.user_id, callback.notify_id]).toEqual([user_id, notify_id]);
    }
  });

  it('turns a key source failure or a malformed key list into a fetch_keys failure', async () => {
    expect(await create_admob_adapter(() => Promise.resolve('timeout')).fetch_keys(new AbortController().signal)).toBe('timeout');
    expect(await create_admob_adapter(() => Promise.resolve({ keys: 1 })).fetch_keys(new AbortController().signal)).toBe('communication_failure');
    expect(admob_keys([{ keyId: 1, base64: 'not a key' }])).toBeNull();
    expect(admob_keys([{ keyId: '1', base64 }])?.has('1')).toBe(true);
  });

  it('reads the keys of verifier-keys.json in its server key source, and fails over the response byte limit', async () => {
    const body = JSON.stringify({ keys: [{ keyId: 9, base64 }] });
    const fetch = (() => Promise.resolve(new Response(body, { status: 200 }))) as typeof globalThis.fetch;
    const time_limit = (): AbortSignal => new AbortController().signal;
    expect(await admob_key_source({ fetch, time_limit, max_response_bytes: 10_000 })()).toEqual([{ keyId: 9, base64 }]);
    expect(await admob_key_source({ fetch, time_limit, max_response_bytes: 10 })()).toBe('communication_failure');
    const failing = (() => Promise.reject(new Error('down'))) as typeof globalThis.fetch;
    expect(await admob_key_source({ fetch: failing, time_limit, max_response_bytes: 10_000 })()).toBe('communication_failure');
  });
});

describe('ads-reward network names', () => {
  it('maps adapter names to callback networks', () => {
    expect([network_name('ads-admob'), network_name('fake'), network_name('other')]).toEqual(['admob', 'fake', null]);
  });
});
