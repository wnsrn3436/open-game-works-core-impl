import type { DbMetrics } from '../storage/index.ts';
import type { Level, LogKind } from './log_line.ts';

/** A sample of a metric family (`### metrics`). */
export interface MetricSample {
  readonly name: string;
  readonly labels: Readonly<Record<string, string>>;
  readonly value: number;
}

/** A metric family: the output of `read_metrics` is an array of these (`### metrics`). */
export interface MetricFamily {
  readonly name: string;
  readonly type: 'counter' | 'gauge' | 'histogram';
  readonly samples: readonly MetricSample[];
}

/** The alert signals of `### alert signal`, in the order of their `ogw_alert_firing` samples. */
export const ALERT_SIGNALS = ['error_ratio', 'slow_requests', 'error_logs', 'wal_archive'] as const;
export type AlertSignal = (typeof ALERT_SIGNALS)[number];

/** The values of the `logging.metrics*` and `logging.alert*` settings. */
export interface MetricsSettings {
  /** `logging.metricsDurationBucketsMs` as given: any order, a value given twice is one bound. */
  readonly duration_buckets_ms: readonly number[];
  readonly alert_window_ms: bigint;
  readonly alert_min_requests: number;
  readonly alert_error_ratio_permille: number;
  readonly alert_slow_request_ms: number;
  readonly alert_slow_ratio_permille: number;
  readonly alert_error_log_count: number;
}

/** The counts of the log lines that the alert signals read. */
interface AlertCounts {
  requests: number;
  internal: number;
  slow: number;
  error_logs: number;
}

/** The counts of the log lines written at one `server-time.clock_now`. */
interface AlertSlot extends AlertCounts {
  readonly time: bigint;
}

/** The histogram of one `request` label: per bound (ascending) the count of values in it and below the previous bound. */
interface DurationHistogram {
  readonly in_bucket: number[];
  count: number;
  sum_ms: number;
}

/** A request line as the metrics read it. */
export interface RequestLine {
  /** The `request` field; `request_label` makes its label. */
  readonly request: string | null;
  readonly error_code: number;
  readonly duration_ms: number;
}

/**
 * The `request` label of a request line: `cheat` for a `request` field that starts with `cheat/` or `core/cheat/` (its
 * cheat name comes from the URL that the client chose), the empty string for null, otherwise the field.
 */
function request_label(request: string | null): string {
  if (request === null) return '';
  return request.startsWith('cheat/') || request.startsWith('core/cheat/') ? 'cheat' : request;
}

/** The label key of a label set of one or two values: the values joined by a byte no label value holds. */
function key_of(...values: readonly string[]): string {
  return values.join('\u0000');
}

/** The ms bound written in seconds in decimal for label `le`. */
function seconds_text(ms: number): string {
  return String(ms / 1000);
}

/**
 * The metrics and alert signals of one server instance (`### metrics`, `### alert signal`). `logging.write` hands it
 * each line it writes, with the `server-time.clock_now` of the write; `read` makes the families of `read_metrics`.
 */
export class Metrics {
  readonly #settings: MetricsSettings;
  readonly #bounds_ms: readonly number[];
  readonly #internal_code: number;
  /** `ogw_requests_total` by (request, error_code). */
  readonly #requests = new Map<string, { request: string; error_code: string; value: number }>();
  /** `ogw_request_duration_seconds` by request. */
  readonly #durations = new Map<string, DurationHistogram>();
  /** `ogw_log_lines_total` by (kind, level). */
  readonly #lines = new Map<string, { kind: string; level: string; value: number }>();
  /**
   * The alert slots of the lines written, ascending by time, from index `#head`: the slots before `#head` are dropped
   * and removed from the array when they are at least half of it, so dropping a slot is amortized O(1).
   */
  #slots: AlertSlot[] = [];
  #head = 0;
  /** The sums of the slots from `#head`. */
  #totals: AlertCounts = { requests: 0, internal: 0, slow: 0, error_logs: 0 };

  constructor(settings: MetricsSettings, internal_code: number) {
    this.#settings = settings;
    this.#bounds_ms = [...new Set(settings.duration_buckets_ms)].sort((a, b) => a - b);
    this.#internal_code = internal_code;
  }

  /** One written log line, at `now`. A `request` line also gives its request fields. */
  line(now: bigint, kind: LogKind, level: Level, request: RequestLine | null): void {
    const line_key = key_of(kind, level);
    const counted = this.#lines.get(line_key);
    if (counted === undefined) this.#lines.set(line_key, { kind, level, value: 1 });
    else counted.value += 1;
    const slot = this.#slot(now);
    const totals = this.#totals;
    if (kind === 'request' && request !== null) {
      this.#request(request);
      slot.requests += 1;
      totals.requests += 1;
      if (request.error_code === this.#internal_code) {
        slot.internal += 1;
        totals.internal += 1;
      }
      if (request.duration_ms > this.#settings.alert_slow_request_ms) {
        slot.slow += 1;
        totals.slow += 1;
      }
    } else if (level === 'error') {
      slot.error_logs += 1;
      totals.error_logs += 1;
    }
  }

  #request(line: RequestLine): void {
    const request = request_label(line.request);
    const error_code = String(line.error_code);
    const request_key = key_of(request, error_code);
    const counted = this.#requests.get(request_key);
    if (counted === undefined) this.#requests.set(request_key, { request, error_code, value: 1 });
    else counted.value += 1;
    let histogram = this.#durations.get(request);
    if (histogram === undefined) {
      histogram = { in_bucket: this.#bounds_ms.map(() => 0), count: 0, sum_ms: 0 };
      this.#durations.set(request, histogram);
    }
    const index = this.#bounds_ms.findIndex((bound) => line.duration_ms <= bound);
    if (index >= 0) histogram.in_bucket[index] = (histogram.in_bucket[index] ?? 0) + 1;
    histogram.count += 1;
    histogram.sum_ms += line.duration_ms;
  }

  /**
   * The alert slot of `now`, kept in time order: the last slot when it has that time, a new last slot when `now` is
   * later, otherwise (the test clock went back) the slot of that time found or inserted by binary search. Old slots
   * are removed first.
   */
  #slot(now: bigint): AlertSlot {
    this.#prune(now);
    const slots = this.#slots;
    const last = slots.at(-1);
    if (last === undefined || last.time < now) {
      const slot: AlertSlot = { time: now, requests: 0, internal: 0, slow: 0, error_logs: 0 };
      slots.push(slot);
      return slot;
    }
    if (last.time === now) return last;
    let low = this.#head;
    let high = slots.length;
    while (low < high) {
      const mid = (low + high) >>> 1;
      if ((slots[mid]?.time ?? now) < now) low = mid + 1;
      else high = mid;
    }
    const found = slots[low];
    if (found !== undefined && found.time === now) return found;
    const slot: AlertSlot = { time: now, requests: 0, internal: 0, slow: 0, error_logs: 0 };
    slots.splice(low, 0, slot);
    return slot;
  }

  /**
   * Drops the slots at or before `now` − the alert window, subtracting them from the totals: no judgement at `now` or
   * later reads them.
   */
  #prune(now: bigint): void {
    const cutoff = now - this.#settings.alert_window_ms;
    const slots = this.#slots;
    const totals = this.#totals;
    let head = this.#head;
    for (let slot = slots[head]; slot !== undefined && slot.time <= cutoff; slot = slots[head]) {
      totals.requests -= slot.requests;
      totals.internal -= slot.internal;
      totals.slow -= slot.slow;
      totals.error_logs -= slot.error_logs;
      head += 1;
    }
    if (head * 2 >= slots.length) {
      this.#slots = slots.slice(head);
      this.#head = 0;
    } else {
      this.#head = head;
    }
  }

  /**
   * The alert signals judged at `now`: the kept lines written later than `now` − `logging.alertWindowMs`. A judgement
   * drops no slot: it takes the slots at or before its cutoff away from a copy of the totals, so a later judgement at
   * an earlier time (the test clock went back) still counts them. The next line drops them, and a judgement after that
   * does not count them even when its window holds their time.
   */
  alerts(now: bigint, db: DbMetrics): Record<AlertSignal, boolean> {
    const cutoff = now - this.#settings.alert_window_ms;
    let { requests, internal, slow, error_logs } = this.#totals;
    const slots = this.#slots;
    for (let index = this.#head, slot = slots[index]; slot !== undefined && slot.time <= cutoff; index += 1, slot = slots[index]) {
      requests -= slot.requests;
      internal -= slot.internal;
      slow -= slot.slow;
      error_logs -= slot.error_logs;
    }
    const s = this.#settings;
    const enough = requests >= s.alert_min_requests;
    return {
      error_ratio: enough && internal * 1000 >= requests * s.alert_error_ratio_permille,
      slow_requests: enough && slow * 1000 >= requests * s.alert_slow_ratio_permille,
      error_logs: error_logs >= s.alert_error_log_count,
      wal_archive: db.wal_archive_failing,
    };
  }

  /** The families of `read_metrics`, with the DB metrics of one `storage.read_db_metrics` call, judged at `now`. */
  read(now: bigint, db: DbMetrics): MetricFamily[] {
    const alerts = this.alerts(now, db);
    return [
      { name: 'ogw_requests_total', type: 'counter', samples: [...this.#requests.values()].map((c) => ({ name: 'ogw_requests_total', labels: { request: c.request, error_code: c.error_code }, value: c.value })) },
      { name: 'ogw_request_duration_seconds', type: 'histogram', samples: this.#duration_samples() },
      { name: 'ogw_log_lines_total', type: 'counter', samples: [...this.#lines.values()].map((c) => ({ name: 'ogw_log_lines_total', labels: { kind: c.kind, level: c.level }, value: c.value })) },
      { name: 'ogw_db_sync_calls_total', type: 'counter', samples: [{ name: 'ogw_db_sync_calls_total', labels: {}, value: db.sync_calls }] },
      { name: 'ogw_db_sync_wait_seconds_total', type: 'counter', samples: [{ name: 'ogw_db_sync_wait_seconds_total', labels: {}, value: db.sync_wait_ms / 1000 }] },
      {
        name: 'ogw_db_failures_total',
        type: 'counter',
        samples: [
          { name: 'ogw_db_failures_total', labels: { kind: 'lock' }, value: db.lock_failures },
          { name: 'ogw_db_failures_total', labels: { kind: 'connection' }, value: db.connection_failures },
        ],
      },
      { name: 'ogw_db_wal_archive_failing', type: 'gauge', samples: [{ name: 'ogw_db_wal_archive_failing', labels: {}, value: db.wal_archive_failing ? 1 : 0 }] },
      { name: 'ogw_alert_firing', type: 'gauge', samples: ALERT_SIGNALS.map((alert) => ({ name: 'ogw_alert_firing', labels: { alert }, value: alerts[alert] ? 1 : 0 })) },
    ];
  }

  #duration_samples(): MetricSample[] {
    const name = 'ogw_request_duration_seconds';
    const samples: MetricSample[] = [];
    for (const [request, histogram] of this.#durations) {
      let cumulative = 0;
      this.#bounds_ms.forEach((bound, index) => {
        cumulative += histogram.in_bucket[index] ?? 0;
        samples.push({ name: `${name}_bucket`, labels: { request, le: seconds_text(bound) }, value: cumulative });
      });
      samples.push({ name: `${name}_bucket`, labels: { request, le: '+Inf' }, value: histogram.count });
      samples.push({ name: `${name}_sum`, labels: { request }, value: histogram.sum_ms / 1000 });
      samples.push({ name: `${name}_count`, labels: { request }, value: histogram.count });
    }
    return samples;
  }

  /** Server stop: the metrics count from the next server start. */
  clear(): void {
    this.#requests.clear();
    this.#durations.clear();
    this.#lines.clear();
    this.#slots = [];
    this.#head = 0;
    this.#totals = { requests: 0, internal: 0, slow: 0, error_logs: 0 };
  }
}
