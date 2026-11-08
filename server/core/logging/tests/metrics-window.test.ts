/**
 * The alert window of `Metrics` (`### alert signal`) on its own: the signals judged from the running totals equal the
 * signals counted from every line written later than the judgement time − `logging.alertWindowMs`, also when the test
 * clock goes back between lines or between judgements, and writing a line does not cost more as the window holds more lines.
 */
import * as CoreContract from '../../../generated/contract/core_contract.ts';
import type { DbMetrics } from '../../storage/index.ts';
import type { Level, LogKind } from '../log_line.ts';
import { Metrics, type AlertSignal, type MetricsSettings } from '../metrics.ts';

const INTERNAL = CoreContract.CoreError.CORE_ERROR_INTERNAL;
const DB: DbMetrics = { sync_calls: 0, sync_wait_ms: 0, lock_failures: 0, connection_failures: 0, wal_archive_failing: false };

interface Line {
  readonly time: bigint;
  readonly kind: LogKind;
  readonly level: Level;
  readonly error_code: number;
  readonly duration_ms: number;
}

function settings_of(window_ms: bigint, min_requests: number, error_permille: number, slow_permille: number, error_log_count: number): MetricsSettings {
  return {
    duration_buckets_ms: [10],
    alert_window_ms: window_ms,
    alert_min_requests: min_requests,
    alert_error_ratio_permille: error_permille,
    alert_slow_request_ms: 10,
    alert_slow_ratio_permille: slow_permille,
    alert_error_log_count: error_log_count,
  };
}

interface Counts {
  readonly requests: number;
  readonly internal: number;
  readonly slow: number;
  readonly error_logs: number;
}

/** The counts of the lines written later than `now` − `window_ms`, from all lines written. */
function counts_of(lines: readonly Line[], now: bigint, window_ms: bigint, slow_request_ms: number): Counts {
  const in_window = lines.filter((line) => line.time > now - window_ms);
  const requests = in_window.filter((line) => line.kind === 'request');
  return {
    requests: requests.length,
    internal: requests.filter((line) => line.error_code === INTERNAL).length,
    slow: requests.filter((line) => line.duration_ms > slow_request_ms).length,
    error_logs: in_window.filter((line) => line.kind !== 'request' && line.level === 'error').length,
  };
}

/** The signals of `### alert signal` judged from the counts of the window. */
function expected_alerts(settings: MetricsSettings, counts: Counts): Record<AlertSignal, boolean> {
  const enough = counts.requests >= settings.alert_min_requests;
  return {
    error_ratio: enough && counts.internal * 1000 >= counts.requests * settings.alert_error_ratio_permille,
    slow_requests: enough && counts.slow * 1000 >= counts.requests * settings.alert_slow_ratio_permille,
    error_logs: counts.error_logs >= settings.alert_error_log_count,
    wal_archive: false,
  };
}

/** A deterministic pseudo-random sequence (mulberry32). */
function random_of(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function write(metrics: Metrics, line: Line): void {
  if (line.kind === 'request') metrics.line(line.time, 'request', line.level, { request: 'core/Resync', error_code: line.error_code, duration_ms: line.duration_ms });
  else metrics.line(line.time, line.kind, line.level, null);
}

/**
 * A judgement time at or after `latest_line`: on a clock that moved on from the latest line, or (the test clock went
 * back after a judgement) between the latest line and the latest judgement.
 */
function judgement_time(random: () => number, latest_line: bigint, latest_judged: bigint): bigint {
  if (random() < 0.5) return latest_line + BigInt(Math.floor(random() * 120));
  // Lines move `latest_line` past `latest_judged`; the span is then empty and the judgement stays at `latest_line`.
  const span = latest_judged > latest_line ? latest_judged - latest_line : 0n;
  return latest_line + BigInt(Math.floor(random() * Number(span + 1n)));
}

/**
 * A line at a time from `latest_line` that `roll` (at least 0.1) sets: mostly forward, sometimes the same ms, sometimes
 * back by up to the window and a bit more.
 */
function random_line(random: () => number, roll: number, latest_line: bigint): Line {
  const move = roll < 0.75 ? Math.floor(random() * 4) : roll < 0.95 ? 0 : -Math.floor(random() * 60);
  const time = latest_line + BigInt(move);
  const kind_roll = random();
  if (kind_roll < 0.6) return { time, kind: 'request', level: 'info', error_code: random() < 0.3 ? INTERNAL : 0, duration_ms: Math.floor(random() * 20) };
  return { time, kind: kind_roll < 0.8 ? 'error' : 'game', level: kind_roll < 0.9 ? 'error' : 'warn', error_code: 0, duration_ms: 0 };
}

describe('alert window', () => {
  it('judges each signal as counted from every line later than the judgement time − the window, with the test clock going back between lines and between judgements', () => {
    const window_ms = 50n;
    const all_settings: MetricsSettings[] = [];
    for (const min_requests of [0, 1, 3, 8]) {
      for (const permille of [0, 250, 500, 1000]) {
        for (const error_log_count of [1, 2, 4, 7]) all_settings.push(settings_of(window_ms, min_requests, permille, 1000 - permille, error_log_count));
      }
    }
    const random = random_of(7);
    const instances = all_settings.map((settings) => new Metrics(settings, INTERNAL));
    const lines: Line[] = [];
    /** The latest time of a line written: a judgement at or after it counts every line in its window. */
    let latest_line = 1000n;
    /** The latest judgement time. */
    let latest_judged = latest_line;
    let judged = 0;
    let judged_back = 0;
    for (let step = 0; step < 3000; step += 1) {
      const roll = random();
      if (roll < 0.1) {
        // A judgement at or after every line time written, which then counts every line in its window.
        const judgement = judgement_time(random, latest_line, latest_judged);
        expect(judgement >= latest_line).toBe(true);
        if (judgement < latest_judged) judged_back += 1;
        else latest_judged = judgement;
        const counts = counts_of(lines, judgement, window_ms, 10);
        for (const [index, metrics] of instances.entries()) {
          const settings = all_settings[index] as MetricsSettings;
          expect(metrics.alerts(judgement, DB)).toEqual(expected_alerts(settings, counts));
        }
        judged += 1;
        continue;
      }
      const line = random_line(random, roll, latest_line);
      if (line.time > latest_line) latest_line = line.time;
      lines.push(line);
      for (const metrics of instances) write(metrics, line);
    }
    expect(judged).toBeGreaterThan(100);
    expect(judged_back).toBeGreaterThan(50);
  });

  it('still counts a line in the window of a judgement made after a judgement at a later time, when the test clock went back', () => {
    const metrics = new Metrics(settings_of(100n, 0, 0, 0, 1), INTERNAL);
    metrics.line(1001n, 'error', 'error', null);
    expect(metrics.alerts(1050n, DB).error_logs).toBe(true);
    expect(metrics.alerts(2000n, DB).error_logs).toBe(false);
    expect(metrics.alerts(1050n, DB).error_logs).toBe(true);
    expect(metrics.alerts(1100n, DB).error_logs).toBe(true);
    expect(metrics.alerts(1101n, DB).error_logs).toBe(false);
  });

  it('drops the lines at the judgement time − the window and counts the line 1 ms later', () => {
    const metrics = new Metrics(settings_of(100n, 0, 0, 0, 2), INTERNAL);
    metrics.line(1001n, 'error', 'error', null);
    metrics.line(1002n, 'error', 'error', null);
    expect(metrics.alerts(1100n, DB).error_logs).toBe(true);
    expect(metrics.alerts(1101n, DB).error_logs).toBe(false);
    metrics.line(1050n, 'error', 'error', null);
    metrics.line(1060n, 'error', 'error', null);
    expect(metrics.alerts(1101n, DB).error_logs).toBe(true);
    expect(metrics.alerts(1150n, DB).error_logs).toBe(false);
  });

  it('writes a line at a cost that does not grow with the lines in the window', () => {
    const window_ms = 100_000;
    const metrics = new Metrics(settings_of(BigInt(window_ms), 1, 500, 500, 1), INTERNAL);
    const request = { request: 'core/Resync', error_code: 0, duration_ms: 1 };
    for (let t = 0; t < window_ms; t += 1) metrics.line(BigInt(t), 'request', 'info', request);
    // Each line below drops one slot of a full window. Copying the window on each drop costs about 0.4 ms per line at
    // this window on a laptop (2 s for these lines); dropping without a copy costs a few µs.
    const started = performance.now();
    for (let t = window_ms; t < window_ms + 5000; t += 1) metrics.line(BigInt(t), 'request', 'info', request);
    for (let i = 0; i < 1000; i += 1) metrics.alerts(BigInt(window_ms + 5000), DB);
    expect(performance.now() - started).toBeLessThan(300);
  });
});
