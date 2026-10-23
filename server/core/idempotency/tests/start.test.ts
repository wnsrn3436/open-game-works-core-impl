import { core_settings } from '../../storage/tests/helpers.ts';
import { new_db, start_server } from './helpers.ts';

async function start_failure(settings: Record<string, number>): Promise<string | null> {
  const started = start_server(await new_db(), settings);
  if (typeof started === 'string') return started;
  started.stop();
  return null;
}

describe('server start', () => {
  it('does not start when idempotency.responseRetentionMs equals 2 x session.signatureWindowMs', async () => {
    const window = { 'session.signatureWindowMs': 100_000, 'NetworkCore.maxRetryAgeMs': 1_000, 'NetworkCore.requestTimeoutMs': 1_000 };
    expect(await start_failure({ ...window, 'idempotency.responseRetentionMs': 200_000 })).toMatch(/idempotency\.responseRetentionMs/);
    expect(await start_failure({ ...window, 'idempotency.responseRetentionMs': 199_999 })).toMatch(/idempotency\.responseRetentionMs/);
    expect(await start_failure({ ...window, 'idempotency.responseRetentionMs': 200_001 })).toBeNull();
  });

  it('does not start when idempotency.responseRetentionMs equals NetworkCore.maxRetryAgeMs + NetworkCore.requestTimeoutMs', async () => {
    const retry = { 'session.signatureWindowMs': 1_000, 'NetworkCore.maxRetryAgeMs': 300_000, 'NetworkCore.requestTimeoutMs': 15_000 };
    expect(await start_failure({ ...retry, 'idempotency.responseRetentionMs': 315_000 })).toMatch(/idempotency\.responseRetentionMs/);
    expect(await start_failure({ ...retry, 'idempotency.responseRetentionMs': 315_001 })).toBeNull();
  });

  it('starts with the core settings defaults', async () => {
    const all = core_settings();
    const keys = ['session.signatureWindowMs', 'NetworkCore.maxRetryAgeMs', 'NetworkCore.requestTimeoutMs', 'idempotency.responseRetentionMs', 'idempotency.notifyRetentionMs'];
    const defaults = Object.fromEntries(keys.map((key) => [key, all[key] as number]));
    expect(await start_failure(defaults)).toBeNull();
  });
});
