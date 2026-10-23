import { format_line, SecurityWindows, truncate_ip, type SecuritySummary } from '../log_line.ts';
import { annotation_problem, split_fields } from '../fields.ts';

describe('truncated IP', () => {
  it('keeps the first 24 bits of IPv4 and the first 48 bits of IPv6', () => {
    expect(truncate_ip('203.0.113.77')).toBe('203.0.113.0');
    expect(truncate_ip('::ffff:198.51.100.9')).toBe('198.51.100.0');
    expect(truncate_ip('2001:db8:85a3:8d3:1319:8a2e:370:7348')).toBe('2001:db8:85a3::');
    expect(truncate_ip('2001:db8::1')).toBe('2001:db8:0::');
    expect(truncate_ip('::1')).toBe('0:0:0::');
    expect(truncate_ip('64:ff9b::192.0.2.33')).toBe('64:ff9b:0::');
    expect(truncate_ip('fe80::1%eth0')).toBe('fe80:0:0::');
  });

  it('is the same when truncated again, and empty for a value that is not an IP', () => {
    for (const ip of ['203.0.113.77', '2001:db8:85a3:8d3::1']) expect(truncate_ip(truncate_ip(ip))).toBe(truncate_ip(ip));
    expect(truncate_ip('not-an-ip')).toBe('');
    expect(truncate_ip('')).toBe('');
  });
});

describe('security windows', () => {
  const WINDOW = 60_000n;

  it('writes the first line of a window, counts the rest, and summarizes them when the window ended', () => {
    const windows = new SecurityWindows(10);
    const ended: SecuritySummary[] = [];
    const written = [0n, 10n, 20n, 59_999n].map((t, i) => windows.admit(1_000n + t, WINDOW, 7n, ['10.0.0.0', '10.0.1.0', '10.0.0.0', '10.0.2.0'][i] as string, 'session_replaced', ended));
    expect(written).toEqual([true, false, false, false]);
    expect(windows.flush(1_000n + WINDOW - 1n)).toEqual([]);
    expect(windows.flush(1_000n + WINDOW)).toEqual([{ user_id: 7n, reason: 'session_replaced', count: 3, ips: ['10.0.1.0', '10.0.0.0', '10.0.2.0'] }]);
    expect(windows.flush(1_000n + 3n * WINDOW)).toEqual([]);
    expect(ended).toEqual([]);
  });

  it('keeps windows apart by group key and reason, and has no summary for a window of one line', () => {
    const windows = new SecurityWindows(10);
    const ended: SecuritySummary[] = [];
    expect(windows.admit(0n, WINDOW, 1n, '10.0.0.0', 'a', ended)).toBe(true);
    expect(windows.admit(1n, WINDOW, 1n, '10.0.0.0', 'b', ended)).toBe(true);
    expect(windows.admit(2n, WINDOW, 2n, '10.0.0.0', 'a', ended)).toBe(true);
    expect(windows.admit(3n, WINDOW, null, '10.0.0.0', 'a', ended)).toBe(true);
    expect(windows.admit(4n, WINDOW, null, '10.0.9.0', 'a', ended)).toBe(true);
    expect(windows.admit(5n, WINDOW, null, '10.0.0.0', 'a', ended)).toBe(false);
    expect(windows.flush(WINDOW + 10n)).toEqual([{ user_id: null, reason: 'a', count: 1, ips: ['10.0.0.0'] }]);
  });

  it('summarizes an ended window that was not flushed when a new line opens the next one', () => {
    const windows = new SecurityWindows(10);
    const ended: SecuritySummary[] = [];
    windows.admit(0n, WINDOW, 1n, '10.0.0.0', 'a', ended);
    windows.admit(1n, WINDOW, 1n, '10.0.0.0', 'a', ended);
    expect(windows.admit(WINDOW, WINDOW, 1n, '10.0.0.0', 'a', ended)).toBe(true);
    expect(ended).toEqual([{ user_id: 1n, reason: 'a', count: 1, ips: ['10.0.0.0'] }]);
  });

  it('keeps at most logging.maxRepeatedIps truncated IPs of a window and still counts every line', () => {
    const windows = new SecurityWindows(2);
    const ended: SecuritySummary[] = [];
    windows.admit(0n, WINDOW, 1n, '10.0.0.0', 'a', ended);
    for (let i = 1; i <= 1000; i += 1) windows.admit(BigInt(i), WINDOW, 1n, `10.${String(i >> 8)}.${String(i & 255)}.0`, 'a', ended);
    expect(windows.flush(WINDOW)).toEqual([{ user_id: 1n, reason: 'a', count: 1000, ips: ['10.0.1.0', '10.0.2.0'] }]);
  });
});

describe('log line', () => {
  it('is one JSON object with the common fields first and int64 values as decimal strings', () => {
    const line = format_line(1_700_000_000_123n, 'warn', { kind: 'game', level: 'warn', message: 'boss cleared', user_id: 2n ** 60n, request_id: 'r', request: 'Fight', fields: null }, { stage: 3, big: 2n ** 62n, time: 'x' });
    expect(line).not.toContain('\n');
    const parsed = JSON.parse(line) as Record<string, unknown>;
    expect(Object.keys(parsed)).toEqual(['time', 'level', 'kind', 'user_id', 'request_id', 'request', 'message', 'stage', 'big']);
    expect(parsed).toEqual({
      time: 1_700_000_000_123,
      level: 'warn',
      kind: 'game',
      user_id: (2n ** 60n).toString(),
      request_id: 'r',
      request: 'Fight',
      message: 'boss cleared',
      stage: 3,
      big: (2n ** 62n).toString(),
    });
  });

  it('writes an integer number outside the safe integer range as its exact decimal string', () => {
    const parsed = JSON.parse(format_line(1n, 'info', { kind: 'game', level: null, message: 'm', user_id: null, request_id: null, request: null, fields: null }, { safe: 2 ** 53 - 1, low: -(2 ** 53 - 1), big: 2 ** 62, small: -(2 ** 63), real: 0.5, list: [2 ** 62, 1] })) as Record<string, unknown>;
    expect(parsed).toMatchObject({ safe: 2 ** 53 - 1, low: -(2 ** 53 - 1), big: '4611686018427387904', small: '-9223372036854775808', real: 0.5, list: ['4611686018427387904', 1] });
  });

  it('has null for a common field without a value', () => {
    expect(JSON.parse(format_line(1n, 'info', { kind: 'core', level: null, message: 'm', user_id: null, request_id: null, request: null, fields: null }, { module: 'logging' }))).toEqual({
      time: 1,
      level: 'info',
      kind: 'core',
      user_id: null,
      request_id: null,
      request: null,
      message: 'm',
      module: 'logging',
    });
  });
});

describe('field objects', () => {
  it('drops log fields that are not snake_case, common fields, or not an integer, a string or a bool', () => {
    const { kept, dropped } = split_fields({ stage: 3, name: 'a', ok: true, big: 5n, Bad: 1, user_id: 2, real: 1.5, list: [1], none: null });
    expect(kept).toEqual({ stage: 3, name: 'a', ok: true, big: 5n });
    expect(dropped.sort()).toEqual(['Bad', 'list', 'none', 'real', 'user_id']);
  });

  it('refuses annotations with a common field, a field routing writes, a key not in snake_case or a value of another type', () => {
    expect(annotation_problem({ stage: 'boss', retry_count: 2, cached: false })).toBeNull();
    for (const fields of [{ seed: '1' }, { error_code: 0 }, { request_body: 'x' }, { message: 'x' }, { camelCase: 1 }, { real: 0.5 }, { list: [] }]) {
      expect(annotation_problem(fields)).not.toBeNull();
    }
  });
});
