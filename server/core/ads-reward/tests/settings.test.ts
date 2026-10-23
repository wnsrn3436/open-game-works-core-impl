import { readFileSync } from 'node:fs';
import { read_settings } from '../deps.ts';
import { BASIC, balance, GEM, LOCAL_SETTINGS, notify_of, signed, start, T, T0, user } from './helpers.ts';

const ROOT = new URL('../../../../settings/', import.meta.url);
const CORE_SETTINGS = JSON.parse(readFileSync(new URL('core-settings.json', ROOT), 'utf8')) as Record<string, unknown>;
const SCHEMA = JSON.parse(readFileSync(new URL('core-settings.schema.json', ROOT), 'utf8')) as {
  properties: Record<string, { minimum?: number }>;
};
const SETTINGS = { ...CORE_SETTINGS, 'environments.<ENV>.adapters.ads': 'fake' };
const ONE_OR_MORE = [
  'ads-reward.ticketTtlMs',
  'ads-reward.claimPollIntervalMs',
  'ads-reward.keyCacheMs',
  'ads-reward.keyFetchTimeoutMs',
  'ads-reward.callbackRateLimitPerMinute',
];

describe('ads-reward settings', () => {
  it.each(ONE_OR_MORE)('refuses the value 0 for %s and accepts 1', (key) => {
    expect(() => read_settings({ ...SETTINGS, [key]: 0 })).toThrow(`ads-reward: setting ${key} is not an integer of 1 or more`);
    expect(() => read_settings({ ...SETTINGS, [key]: 1 })).not.toThrow();
  });

  it.each(ONE_OR_MORE)('gives %s the minimum 1 in core-settings.schema.json', (key) => {
    expect(SCHEMA.properties[key]?.minimum).toBe(1);
  });
});

describe('ads-reward idempotency.maxNotifyIdBytes', () => {
  it('does not start with an error log when idempotency.maxNotifyIdBytes is 35, and starts and grants when it is 36', async () => {
    const settings = { ...LOCAL_SETTINGS, 'idempotency.maxNotifyIdBytes': 35 };
    const failed = await T.start_test_server(T0, undefined, undefined, undefined, undefined, settings).then(
      () => null,
      (error: unknown) => error as Error & { logs?: { level: string; message: string }[] },
    );
    expect(failed?.message).toMatch(/idempotency\.maxNotifyIdBytes/);
    expect(failed?.logs?.some((l) => l.level === 'error' && l.message.includes('idempotency.maxNotifyIdBytes'))).toBe(true);
    const s = await start({ 'idempotency.maxNotifyIdBytes': 36 });
    try {
      const session = await user(s.server);
      const notify_id = await notify_of(session, BASIC());
      expect((await signed(s, notify_id, session.user_id)).status).toBe(200);
      expect(await balance(s.server, session.user_id, GEM())).toBe(10n);
    } finally {
      await T.stop_test_server(s.server);
    }
  });
});
