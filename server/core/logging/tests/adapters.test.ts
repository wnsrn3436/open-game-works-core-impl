import { generateKeyPairSync } from 'node:crypto';
import { create_fake_adapter } from '../dev/index.ts';
import { analytics_event, report_analytics_events, report_events, settle, start, start_server, stop_all, user } from './helpers.ts';

afterEach(() => {
  stop_all();
});

const signal = (): AbortSignal => new AbortController().signal;

/** The game settings secret names of analytics-ga4, which differ from their `environments.<ENV>.secrets` keys. */
const GA4_SECRET_NAMES = { 'environments.<ENV>.secrets.analytics': 'mp_secret', 'environments.<ENV>.secrets.analyticsServiceAccount': 'sa_key' };

function private_pem(): string {
  return generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({ type: 'pkcs8', format: 'pem' });
}

describe('fake analytics adapter', () => {
  it('records each call, uses the result and failure condition set until set again, and starts with delete_user_data true', async () => {
    const { adapter, controller } = create_fake_adapter('analytics');
    const event = { user_id: 1n, name: 'a', time_at: 2n, params: [] };
    expect(await adapter.send([event], signal())).toBeNull();
    expect(await adapter.delete_user_data(5n, signal())).toBe(true);
    controller.set_result('delete_user_data', false);
    controller.set_failure('send', 'rejected');
    expect(await adapter.send([event], signal())).toBe('rejected');
    expect(await adapter.send([], signal())).toBe('rejected');
    expect(await adapter.delete_user_data(6n, signal())).toBe(false);
    controller.set_result('delete_user_data', true);
    controller.set_failure('delete_user_data', 'timeout');
    expect(await adapter.delete_user_data(7n, AbortSignal.abort())).toBe(false);
    controller.set_failure('delete_user_data', null);
    controller.set_failure('send', null);
    expect(await adapter.delete_user_data(8n, signal())).toBe(true);
    expect(await adapter.send([event], signal())).toBeNull();
    expect(controller.calls()).toEqual([
      { operation: 'send', input: [event] },
      { operation: 'delete_user_data', input: 5n },
      { operation: 'send', input: [event] },
      { operation: 'send', input: [] },
      { operation: 'delete_user_data', input: 6n },
      { operation: 'delete_user_data', input: 7n },
      { operation: 'delete_user_data', input: 8n },
      { operation: 'send', input: [event] },
    ]);
  });

  it('throws for another adapter key, an unknown operation, a result of send and an unknown failure condition', () => {
    expect(() => create_fake_adapter('iap-apple')).toThrow();
    const { controller } = create_fake_adapter('analytics');
    expect(() => {
      controller.set_result('send', true);
    }).toThrow();
    expect(() => {
      controller.set_result('delete_user_data', 'yes');
    }).toThrow();
    expect(() => {
      controller.set_failure('flush', 'timeout');
    }).toThrow();
    expect(() => {
      controller.set_failure('send', 'broken' as 'timeout');
    }).toThrow();
  });

  it('ends a timeout call only when the time limit signal aborts, and fails communication_failure and rejected at once', async () => {
    const { adapter, controller } = create_fake_adapter('analytics');
    const event = { user_id: 1n, name: 'a', time_at: 2n, params: [] };
    controller.set_failure('send', 'timeout');
    controller.set_failure('delete_user_data', 'timeout');
    const limit = new AbortController();
    const ended: string[] = [];
    const sending = adapter.send([event], limit.signal).then((failure) => ended.push(`send ${String(failure)}`));
    const deleting = adapter.delete_user_data(3n, limit.signal).then((ok) => ended.push(`delete ${String(ok)}`));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(ended).toEqual([]);
    limit.abort();
    await Promise.all([sending, deleting]);
    expect(ended).toEqual(['send timeout', 'delete false']);
    controller.set_failure('send', 'communication_failure');
    controller.set_failure('delete_user_data', 'rejected');
    expect(await adapter.send([event], signal())).toBe('communication_failure');
    expect(await adapter.delete_user_data(4n, signal())).toBe(false);
  });
});

describe('analytics adapter at server start', () => {
  it('makes its own fake adapter with the DEV code when the server instance gives none', async () => {
    const server = await start({ fake_override: false });
    const user_id = await user(server);
    expect((await report_analytics_events(server, user_id, report_events([analytics_event('a', 1n)]))).code).toBe(0);
    await settle(server);
    expect(server.fake).toBeNull();
  });

  it('fails server start for fake without DEV code, an unknown adapter name, and analytics-ga4 without its secrets', async () => {
    expect(await start_server({ env: 'STG', analytics: 'fake', fake_override: false })).toMatch(/fake/);
    expect(await start_server({ analytics: 'analytics-mixpanel' })).toMatch(/analytics-mixpanel/);
    expect(await start_server({ env: 'STG', analytics: 'analytics-ga4', settings: GA4_SECRET_NAMES, secrets: { analytics: 'x' } })).toMatch(/secret/);
    // A server that reads the host secret store reads the secret named by game settings, not the key.
    expect(await start_server({ env: 'STG', analytics: 'analytics-ga4', settings: GA4_SECRET_NAMES, secrets: { analytics: 'x', analyticsServiceAccount: 'y' }, host_secrets: true })).toMatch(/secret/);
  });

  it('sends with analytics-ga4 through the outgoing HTTP adapter, with the api secret of --secret-file read by its key', async () => {
    const urls: URL[] = [];
    const server = await start({
      env: 'STG',
      analytics: 'analytics-ga4',
      settings: { ...GA4_SECRET_NAMES, 'environments.<ENV>.analyticsGa4.measurementId': 'G-STG' },
      secrets: { analytics: 'api-secret-value', analyticsServiceAccount: private_pem() },
      fetch: (url) => {
        urls.push(new URL(url));
        return Promise.resolve(new Response('', { status: 204 }));
      },
    });
    const user_id = await user(server);
    expect((await report_analytics_events(server, user_id, report_events([analytics_event('stage_clear', 1n)]))).code).toBe(0);
    await settle(server);
    expect(urls.map((url) => [url.origin + url.pathname, url.searchParams.get('measurement_id'), url.searchParams.get('api_secret')])).toEqual([
      ['https://www.google-analytics.com/mp/collect', 'G-STG', 'api-secret-value'],
    ]);
    expect(server.lines.join('\n')).not.toContain('api-secret-value');
  });

  it('reads the analytics-ga4 secrets of a server without --db from the host secret store by the names in game settings', async () => {
    const urls: URL[] = [];
    const server = await start({
      env: 'STG',
      analytics: 'analytics-ga4',
      settings: GA4_SECRET_NAMES,
      secrets: { mp_secret: 'host-secret-value', sa_key: private_pem(), analytics: 'file-secret-value' },
      host_secrets: true,
      fetch: (url) => {
        urls.push(new URL(url));
        return Promise.resolve(new Response('', { status: 204 }));
      },
    });
    const user_id = await user(server);
    await report_analytics_events(server, user_id, report_events([analytics_event('stage_clear', 1n)]));
    await settle(server);
    expect(urls.map((url) => url.searchParams.get('api_secret'))).toEqual(['host-secret-value']);
  });
});
