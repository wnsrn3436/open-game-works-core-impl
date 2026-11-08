/**
 * `read_metrics` (`### metrics`) and the alert signals (`### alert signal`): the families counted from the lines
 * `write` writes, the DB metrics of `storage.read_db_metrics`, and the alert window on the test clock. The `request`
 * lines here come from the test helper `request`, which gives `duration_ms` as `routing` would.
 */
import * as CoreContract from '../../../generated/contract/core_contract.ts';
import type { DbMetrics } from '../../storage/index.ts';
import { new_db } from '../../storage/tests/helpers.ts';
import { ALERT_SIGNALS, type MetricFamily, type MetricSample } from '../index.ts';
import { advance, CoreError, logs, new_user, request, start, stop_all, type Server } from './helpers.ts';

afterEach(() => {
  stop_all();
});

const INTERNAL = CoreError.CORE_ERROR_INTERNAL;
const DEFAULT_BUCKETS_MS = [5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000];

function family(families: readonly MetricFamily[], name: string): MetricFamily {
  const found = families.find((f) => f.name === name);
  if (found === undefined) throw new Error(`no metric family ${name}`);
  return found;
}

function matches(sample: MetricSample, labels: Readonly<Record<string, string>>): boolean {
  return Object.entries(labels).every(([key, value]) => sample.labels[key] === value);
}

/** The value of the one sample of `sample_name` with `labels` (a subset of its labels); undefined when there is none. */
function value_of(families: readonly MetricFamily[], family_name: string, sample_name: string, labels: Readonly<Record<string, string>> = {}): number | undefined {
  const samples = family(families, family_name).samples.filter((s) => s.name === sample_name && matches(s, labels));
  if (samples.length > 1) throw new Error(`${String(samples.length)} samples of ${sample_name} ${JSON.stringify(labels)}`);
  return samples[0]?.value;
}

function firing(families: readonly MetricFamily[], alert: string): number | undefined {
  return value_of(families, 'ogw_alert_firing', 'ogw_alert_firing', { alert });
}

const ok = (): CoreContract.ResyncResponse => new CoreContract.ResyncResponse();
const internal = (): never => {
  throw new Error('metrics test failure');
};

async function resync(server: Server, user_id: bigint, outcome: 'ok' | 'internal', duration_ms = 1): Promise<void> {
  const result = await request(server, user_id, 'Resync', outcome === 'ok' ? ok : internal, { duration_ms });
  expect(result.code).toBe(outcome === 'ok' ? 0 : INTERNAL);
}

describe('read_metrics', () => {
  it('labels a request field that starts with cheat/ or core/cheat/ as cheat, and keeps any other request field, cheat elsewhere in it included', async () => {
    const server = await start();
    const write = (request: string): void => {
      server.logging.write({ kind: 'request', level: null, message: 'request', user_id: null, request_id: null, request, fields: { error_code: 0, duration_ms: 3, client_version: null, platform: null, seed: null } });
    };
    for (const request of ['cheat/a', 'core/cheat/b', 'cheat/', 'Cheater', 'core/cheatsheet', 'game/cheat/x', 'cheat']) write(request);
    const families = server.logging.read_metrics();
    const counts: Record<string, number> = {};
    for (const sample of family(families, 'ogw_requests_total').samples) counts[sample.labels.request ?? ''] = sample.value;
    expect(counts).toEqual({ cheat: 4, Cheater: 1, 'core/cheatsheet': 1, 'game/cheat/x': 1 });
    expect(value_of(families, 'ogw_request_duration_seconds', 'ogw_request_duration_seconds_count', { request: 'cheat' })).toBe(4);
    expect(logs(server, 'request').map((line) => line.request)).toEqual(['cheat/a', 'core/cheat/b', 'cheat/', 'Cheater', 'core/cheatsheet', 'game/cheat/x', 'cheat']);
  });

  it('counts request lines by request and error code, their durations in buckets, and log lines by kind and level, with no user ID or IP in a label', async () => {
    const server = await start();
    const user_id = await new_user(server);
    await resync(server, user_id, 'ok', 1);
    await resync(server, user_id, 'ok', 7);
    await resync(server, user_id, 'ok', 30);
    await resync(server, user_id, 'internal', 20_000);
    server.logging.write({ kind: 'security', level: 'warn', message: 'refused', user_id, request_id: null, request: 'core/Resync', fields: { ip: '203.0.113.7', reason: 'bad_signature' } });
    const families = server.logging.read_metrics();
    const request = { request: 'core/Resync' };
    expect(value_of(families, 'ogw_requests_total', 'ogw_requests_total', { ...request, error_code: '0' })).toBe(3);
    expect(value_of(families, 'ogw_requests_total', 'ogw_requests_total', { ...request, error_code: String(INTERNAL) })).toBe(1);
    expect(family(families, 'ogw_requests_total').samples).toHaveLength(2);
    const histogram = 'ogw_request_duration_seconds';
    expect(family(families, histogram).type).toBe('histogram');
    expect(value_of(families, histogram, `${histogram}_count`, request)).toBe(4);
    expect(value_of(families, histogram, `${histogram}_sum`, request)).toBeCloseTo((1 + 7 + 30 + 20_000) / 1000, 9);
    const buckets = family(families, histogram).samples.filter((s) => s.name === `${histogram}_bucket`);
    expect(buckets.map((s) => s.labels.le)).toEqual([...DEFAULT_BUCKETS_MS.map((ms) => String(ms / 1000)), '+Inf']);
    const expected = DEFAULT_BUCKETS_MS.map((bound) => [1, 7, 30, 20_000].filter((d) => d <= bound).length);
    expect(buckets.map((s) => s.value)).toEqual([...expected, 4]);
    expect(value_of(families, 'ogw_log_lines_total', 'ogw_log_lines_total', { kind: 'request', level: 'info' })).toBe(3);
    expect(value_of(families, 'ogw_log_lines_total', 'ogw_log_lines_total', { kind: 'request', level: 'error' })).toBe(1);
    expect(value_of(families, 'ogw_log_lines_total', 'ogw_log_lines_total', { kind: 'error', level: 'error' })).toBe(1);
    expect(value_of(families, 'ogw_log_lines_total', 'ogw_log_lines_total', { kind: 'security', level: 'warn' })).toBe(1);
    for (const f of families) {
      for (const sample of f.samples) {
        for (const value of Object.values(sample.labels)) {
          expect(value).not.toBe(user_id.toString());
          expect(value).not.toContain('203.0.113');
        }
      }
    }
  });

  it('counts the summary line of job logging_security_flush in ogw_log_lines_total, and not the grouped lines it summarizes', async () => {
    const window_ms = 1000n;
    const server = await start({ settings: { 'logging.securityRepeatWindowMs': Number(window_ms) } });
    const user_id = await new_user(server);
    for (const ip of ['203.0.113.7', '203.0.113.8', '198.51.100.4']) {
      server.logging.write({ kind: 'security', level: 'warn', message: 'refused', user_id, request_id: null, request: 'core/Resync', fields: { ip, reason: 'bad_signature' } });
    }
    const security_lines = { kind: 'security', level: 'warn' };
    expect(value_of(server.logging.read_metrics(), 'ogw_log_lines_total', 'ogw_log_lines_total', security_lines)).toBe(1);
    await advance(server, 2n * window_ms);
    expect(logs(server, 'security').map((line) => line.reason)).toEqual(['bad_signature', 'repeated']);
    expect(value_of(server.logging.read_metrics(), 'ogw_log_lines_total', 'ogw_log_lines_total', security_lines)).toBe(2);
  });

  it('gives each family its type, and a histogram one bucket per distinct bound in ascending order whatever the order given', async () => {
    const server = await start({ settings: { 'logging.metricsDurationBucketsMs': [500, 100, 100] } });
    const user_id = await new_user(server);
    await resync(server, user_id, 'ok', 100);
    await request(server, user_id, 'ReportClientErrors', () => new CoreContract.ReportClientErrorsResponse(), { duration_ms: 501 });
    const families = server.logging.read_metrics();
    expect(families.map((f) => [f.name, f.type])).toEqual([
      ['ogw_requests_total', 'counter'],
      ['ogw_request_duration_seconds', 'histogram'],
      ['ogw_log_lines_total', 'counter'],
      ['ogw_db_sync_calls_total', 'counter'],
      ['ogw_db_sync_wait_seconds_total', 'counter'],
      ['ogw_db_failures_total', 'counter'],
      ['ogw_db_wal_archive_failing', 'gauge'],
      ['ogw_alert_firing', 'gauge'],
    ]);
    const name = 'ogw_request_duration_seconds_bucket';
    for (const request of ['core/Resync', 'core/ReportClientErrors']) {
      const buckets = family(families, 'ogw_request_duration_seconds').samples.filter((s) => s.name === name && s.labels.request === request);
      expect(buckets.map((s) => s.labels.le)).toEqual(['0.1', '0.5', '+Inf']);
    }
    expect(value_of(families, 'ogw_request_duration_seconds', name, { request: 'core/Resync', le: '0.1' })).toBe(1);
    expect(value_of(families, 'ogw_request_duration_seconds', name, { request: 'core/ReportClientErrors', le: '0.5' })).toBe(0);
    expect(value_of(families, 'ogw_request_duration_seconds', name, { request: 'core/ReportClientErrors', le: '+Inf' })).toBe(1);
  });

  it('gives a request line without a request name the empty request label', async () => {
    const server = await start();
    server.logging.write({ kind: 'request', level: null, message: 'request', user_id: null, request_id: null, request: null, fields: { error_code: 0, duration_ms: 3, client_version: null, platform: null, seed: null } });
    const families = server.logging.read_metrics();
    expect(value_of(families, 'ogw_requests_total', 'ogw_requests_total', { request: '', error_code: '0' })).toBe(1);
  });

  it('has the DB metrics of the storage.read_db_metrics call it makes', async () => {
    const server = await start();
    const user_id = await new_user(server);
    await resync(server, user_id, 'ok');
    const original = server.storage.read_db_metrics.bind(server.storage);
    const seen: DbMetrics[] = [];
    const spy = vi.spyOn(server.storage, 'read_db_metrics').mockImplementation(() => {
      const metrics = { ...original(), sync_wait_ms: 1234 };
      seen.push(metrics);
      return metrics;
    });
    const families = server.logging.read_metrics();
    spy.mockRestore();
    expect(seen).toHaveLength(1);
    const db = seen[0] as DbMetrics;
    expect(value_of(families, 'ogw_db_sync_calls_total', 'ogw_db_sync_calls_total')).toBe(db.sync_calls);
    expect(value_of(families, 'ogw_db_sync_wait_seconds_total', 'ogw_db_sync_wait_seconds_total')).toBe(1.234);
    expect(value_of(families, 'ogw_db_failures_total', 'ogw_db_failures_total', { kind: 'lock' })).toBe(db.lock_failures);
    expect(value_of(families, 'ogw_db_failures_total', 'ogw_db_failures_total', { kind: 'connection' })).toBe(db.connection_failures);
    expect(value_of(families, 'ogw_db_wal_archive_failing', 'ogw_db_wal_archive_failing')).toBe(db.wal_archive_failing ? 1 : 0);
  });

  it('on SQLite before any DB failure has DB failures 0 for lock and connection, one sample of each DB family and WAL archive 0', async () => {
    const server = await start({ db: await new_db('sqlite') });
    const families = server.logging.read_metrics();
    expect(family(families, 'ogw_db_failures_total').samples).toEqual([
      { name: 'ogw_db_failures_total', labels: { kind: 'lock' }, value: 0 },
      { name: 'ogw_db_failures_total', labels: { kind: 'connection' }, value: 0 },
    ]);
    expect(family(families, 'ogw_db_sync_calls_total').samples).toHaveLength(1);
    expect(family(families, 'ogw_db_sync_wait_seconds_total').samples).toHaveLength(1);
    expect(family(families, 'ogw_db_wal_archive_failing').samples).toEqual([{ name: 'ogw_db_wal_archive_failing', labels: {}, value: 0 }]);
  });

  it('has a sample of every alert signal and no sample of the line families before any line', async () => {
    const server = await start();
    const families = server.logging.read_metrics();
    expect(family(families, 'ogw_alert_firing').samples).toEqual(ALERT_SIGNALS.map((alert) => ({ name: 'ogw_alert_firing', labels: { alert }, value: 0 })));
    expect(family(families, 'ogw_requests_total').samples).toEqual([]);
    expect(family(families, 'ogw_request_duration_seconds').samples).toEqual([]);
    expect(family(families, 'ogw_log_lines_total').samples).toEqual([]);
  });

  it('counts from the server start: a stopped server instance has no lines left', async () => {
    const server = await start();
    const user_id = await new_user(server);
    await resync(server, user_id, 'ok');
    server.logging.stop();
    expect(family(server.logging.read_metrics(), 'ogw_requests_total').samples).toEqual([]);
  });
});

describe('alert signals', () => {
  it('error_ratio fires at the INTERNAL share of the request lines in the alert window, and stops when they leave it', async () => {
    const window_ms = 60_000n;
    const server = await start({ settings: { 'logging.alertMinRequests': 4, 'logging.alertErrorRatioPermille': 250, 'logging.alertWindowMs': Number(window_ms) } });
    const user_id = await new_user(server);
    for (let i = 0; i < 3; i += 1) await resync(server, user_id, 'ok');
    expect(firing(server.logging.read_metrics(), 'error_ratio')).toBe(0);
    await resync(server, user_id, 'internal');
    expect(firing(server.logging.read_metrics(), 'error_ratio')).toBe(1);
    await advance(server, window_ms - 1n);
    expect(firing(server.logging.read_metrics(), 'error_ratio')).toBe(1);
    await advance(server, 1n);
    expect(firing(server.logging.read_metrics(), 'error_ratio')).toBe(0);
  });

  it('error_ratio and slow_requests do not fire below logging.alertMinRequests request lines', async () => {
    const server = await start({ settings: { 'logging.alertMinRequests': 3, 'logging.alertErrorRatioPermille': 1, 'logging.alertSlowRatioPermille': 1, 'logging.alertSlowRequestMs': 10 } });
    const user_id = await new_user(server);
    await resync(server, user_id, 'internal', 11);
    await resync(server, user_id, 'internal', 11);
    let families = server.logging.read_metrics();
    expect([firing(families, 'error_ratio'), firing(families, 'slow_requests')]).toEqual([0, 0]);
    await resync(server, user_id, 'ok', 10);
    families = server.logging.read_metrics();
    expect([firing(families, 'error_ratio'), firing(families, 'slow_requests')]).toEqual([1, 1]);
  });

  it('slow_requests fires when the share of request lines whose duration_ms is more than logging.alertSlowRequestMs reaches the ratio', async () => {
    const server = await start({ settings: { 'logging.alertMinRequests': 2, 'logging.alertSlowRatioPermille': 500, 'logging.alertSlowRequestMs': 100 } });
    const user_id = await new_user(server);
    await resync(server, user_id, 'ok', 100);
    await resync(server, user_id, 'ok', 100);
    expect(firing(server.logging.read_metrics(), 'slow_requests')).toBe(0);
    await resync(server, user_id, 'ok', 101);
    expect(firing(server.logging.read_metrics(), 'slow_requests')).toBe(0);
    await resync(server, user_id, 'ok', 101);
    expect(firing(server.logging.read_metrics(), 'slow_requests')).toBe(1);
  });

  it('error_logs fires at logging.alertErrorLogCount error lines that are not request lines', async () => {
    const server = await start({ settings: { 'logging.alertErrorLogCount': 3 } });
    const user_id = await new_user(server);
    const error_line = (): void => {
      server.logging.write({ kind: 'error', level: 'error', message: 'failed', user_id: null, request_id: null, request: null, fields: { stack_trace: null } });
    };
    error_line();
    error_line();
    for (let i = 0; i < 5; i += 1) {
      server.logging.write({ kind: 'request', level: null, message: 'request', user_id, request_id: null, request: 'core/Resync', fields: { error_code: INTERNAL, duration_ms: 1, client_version: null, platform: null, seed: null } });
    }
    server.logging.write({ kind: 'game', level: 'warn', message: 'warned', user_id: null, request_id: null, request: null, fields: {} });
    expect(firing(server.logging.read_metrics(), 'error_logs')).toBe(0);
    error_line();
    expect(firing(server.logging.read_metrics(), 'error_logs')).toBe(1);
  });

  it('error_logs counts a line in the alert window of a read_metrics after a read_metrics at a later time, when the test clock went back', async () => {
    const window_ms = 60_000n;
    const server = await start({ settings: { 'logging.alertErrorLogCount': 1, 'logging.alertWindowMs': Number(window_ms) } });
    server.logging.write({ kind: 'error', level: 'error', message: 'failed', user_id: null, request_id: null, request: null, fields: { stack_trace: null } });
    expect(firing(server.logging.read_metrics(), 'error_logs')).toBe(1);
    await advance(server, 2n * window_ms);
    expect(firing(server.logging.read_metrics(), 'error_logs')).toBe(0);
    await advance(server, -2n * window_ms + window_ms / 2n);
    expect(firing(server.logging.read_metrics(), 'error_logs')).toBe(1);
  });

  it('error_logs does not count a line that a later line dropped, when the test clock went back to a judgement in the window of the dropped line', async () => {
    const window_ms = 100n;
    const server = await start({ settings: { 'logging.alertErrorLogCount': 2, 'logging.alertWindowMs': Number(window_ms) } });
    const error_line = (): void => {
      server.logging.write({ kind: 'error', level: 'error', message: 'failed', user_id: null, request_id: null, request: null, fields: { stack_trace: null } });
    };
    // Relative to the first line at 1001: the second line at 2000, the judgement at 1050.
    error_line();
    await advance(server, 999n);
    error_line();
    await advance(server, -950n);
    expect(firing(server.logging.read_metrics(), 'error_logs')).toBe(0);
    // Two lines kept in that window fire it.
    error_line();
    expect(firing(server.logging.read_metrics(), 'error_logs')).toBe(1);
  });

  it('wal_archive is 0 while storage.read_db_metrics gives wal_archive_failing false, and 1 while it gives true', async () => {
    const server = await start();
    expect(firing(server.logging.read_metrics(), 'wal_archive')).toBe(0);
    const original = server.storage.read_db_metrics.bind(server.storage);
    const spy = vi.spyOn(server.storage, 'read_db_metrics').mockImplementation(() => ({ ...original(), wal_archive_failing: true }));
    const families = server.logging.read_metrics();
    spy.mockRestore();
    expect(firing(families, 'wal_archive')).toBe(1);
    expect(value_of(families, 'ogw_db_wal_archive_failing', 'ogw_db_wal_archive_failing')).toBe(1);
  });
});
