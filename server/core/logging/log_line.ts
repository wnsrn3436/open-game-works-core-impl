import { isIPv4, isIPv6 } from 'node:net';

/** Log levels, lowest first. */
export const LEVELS = ['debug', 'info', 'warn', 'error'] as const;
export type Level = (typeof LEVELS)[number];

export type LogKind = 'request' | 'error' | 'security' | 'audit' | 'game' | 'core';

/** The common fields of every log line (`server-core` `## log`). */
export const COMMON_FIELDS: ReadonlySet<string> = new Set(['time', 'level', 'kind', 'user_id', 'request_id', 'request', 'message']);

/** A field value of a log line. `bigint` and an integer `number` outside the safe integer range are written as a decimal string. */
export type LogValue = bigint | number | string | boolean | null | readonly LogValue[];

export type LogFields = Readonly<Record<string, LogValue>>;

/**
 * A log entry `write` takes (`## API`). A missing value is null; `write` adds `time`.
 * - `fields`: the fields the kind adds (`### server log`) and the fields of the spec of the module that writes it.
 *   `request`: `error_code`, `duration_ms`, `client_version`, `platform`, `seed` and the fields of
 *   `take_request_log_annotation`. `security`: `ip` (`write` truncates it) and `reason`. `error`: `stack_trace`.
 *   `audit`: `actor` when the module gives one. `core`: `module`.
 * - `request` only: `min_level` (the minimum level of `take_request_log_annotation`), `request_body` (the request
 *   body bytes) and `sensitive` (`(ogw.sensitive)`). `write` sets the line's level and `request_body`.
 */
export interface LogEntry {
  readonly kind: LogKind;
  readonly level: Level | null;
  readonly message: string;
  readonly user_id: bigint | null;
  readonly request_id: string | null;
  readonly request: string | null;
  readonly fields: LogFields | null;
  readonly min_level?: Level | null;
  readonly request_body?: Uint8Array | null;
  readonly sensitive?: boolean | null;
}

export function is_level(value: unknown): value is Level {
  return typeof value === 'string' && (LEVELS as readonly string[]).includes(value);
}

export function higher_level(a: Level, b: Level): Level {
  return LEVELS.indexOf(a) >= LEVELS.indexOf(b) ? a : b;
}

function json_value(value: LogValue): unknown {
  if (typeof value === 'bigint') return value.toString();
  // JSON.stringify writes such a number as a different integer.
  if (typeof value === 'number' && Number.isInteger(value) && !Number.isSafeInteger(value)) return BigInt(value).toString();
  if (Array.isArray(value)) return (value as readonly LogValue[]).map(json_value);
  return value;
}

/** One log line: the common fields in their order, then the added fields. */
export function format_line(time: bigint, level: Level, entry: LogEntry, fields: LogFields): string {
  const line: Record<string, unknown> = {
    time: Number(time),
    level,
    kind: entry.kind,
    user_id: entry.user_id === null ? null : entry.user_id.toString(),
    request_id: entry.request_id,
    request: entry.request,
    message: entry.message,
  };
  for (const [key, value] of Object.entries(fields)) if (!COMMON_FIELDS.has(key)) line[key] = json_value(value);
  return JSON.stringify(line);
}

/** The eight 16-bit words of a valid IPv6 address. A trailing dotted IPv4 part is two words. */
function ipv6_words(ip: string): number[] {
  const text = ip.replace(/(\d+)\.(\d+)\.(\d+)\.(\d+)$/, (_, a: string, b: string, c: string, d: string) => {
    const hex = (x: string, y: string): string => ((Number(x) << 8) | Number(y)).toString(16);
    return `${hex(a, b)}:${hex(c, d)}`;
  });
  const read = (part: string | undefined): number[] => (part === undefined || part === '' ? [] : part.split(':').map((w) => parseInt(w, 16)));
  const [head, rest] = text.split('::');
  const first = read(head);
  if (rest === undefined) return first;
  const last = read(rest);
  return [...first, ...new Array<number>(8 - first.length - last.length).fill(0), ...last];
}

/**
 * The truncated IP (`server-core` `## log`): IPv4 keeps the first 24 bits, IPv6 the first 48 bits, the other bits
 * are 0. An IPv4-mapped IPv6 address is truncated as IPv4. Anything else is the empty string.
 */
export function truncate_ip(ip: string): string {
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(ip);
  const v4 = mapped ? (mapped[1] as string) : ip;
  if (isIPv4(v4)) return `${v4.split('.').slice(0, 3).join('.')}.0`;
  const address = ip.split('%')[0] as string;
  if (!isIPv6(address)) return '';
  return `${ipv6_words(address)
    .slice(0, 3)
    .map((w) => w.toString(16))
    .join(':')}::`;
}

/** The summary line of a finished `security` window: the lines of the window after the first. */
export interface SecuritySummary {
  readonly user_id: bigint | null;
  readonly reason: string;
  readonly count: number;
  readonly ips: readonly string[];
}

interface SecurityWindow {
  readonly user_id: bigint | null;
  readonly reason: string;
  readonly end: bigint;
  count: number;
  readonly ips: string[];
}

/**
 * The `security` log windows of one server instance (`### server log`): per group key (the user ID, or the truncated
 * IP when the request has no user) and `reason`, the first line of a window is written and the rest are counted.
 */
export class SecurityWindows {
  readonly #windows = new Map<string, SecurityWindow>();
  readonly #max_ips: number;

  /** `max_ips`: how many truncated IPs a window keeps (`logging.maxRepeatedIps`). */
  constructor(max_ips: number) {
    this.#max_ips = max_ips;
  }

  /**
   * Admits a `security` line at `now`. True when it is written: it opens a window. A line of an open window is
   * counted and false. A window that ended before `now` and was not flushed yet is summarized into `ended` and
   * replaced by a new one.
   */
  admit(now: bigint, window_ms: bigint, user_id: bigint | null, ip: string, reason: string, ended: SecuritySummary[]): boolean {
    const group = user_id === null ? `ip:${ip}` : `user:${user_id.toString()}`;
    const key = `${group}\n${reason}`;
    const open = this.#windows.get(key);
    if (open !== undefined && now < open.end) {
      open.count += 1;
      if (ip !== '' && open.ips.length < this.#max_ips && !open.ips.includes(ip)) open.ips.push(ip);
      return false;
    }
    if (open !== undefined) {
      const summary = summary_of(open);
      if (summary !== null) ended.push(summary);
    }
    this.#windows.set(key, { user_id, reason, end: now + window_ms, count: 0, ips: [] });
    return true;
  }

  /** Removes the windows that ended at `now` and returns the summaries of those with counted lines. */
  flush(now: bigint): SecuritySummary[] {
    const out: SecuritySummary[] = [];
    for (const [key, window] of this.#windows) {
      if (now < window.end) continue;
      this.#windows.delete(key);
      const summary = summary_of(window);
      if (summary !== null) out.push(summary);
    }
    return out;
  }

  clear(): void {
    this.#windows.clear();
  }
}

function summary_of(window: SecurityWindow): SecuritySummary | null {
  if (window.count === 0) return null;
  return { user_id: window.user_id, reason: window.reason, count: window.count, ips: window.ips };
}
