// Body rules, CIDR membership, canonical JSON and admin operation definitions, without a test server.
import { check_json_body, check_query, is_request_name, type BodyLimits } from '../body.ts';
import { check_definition } from '../definition.ts';
import { ip_in_cidrs } from '../ip.ts';
import { canonical_json } from '../../storage/canonical_json.ts';
import { parse_json, sha256_hex } from '../json.ts';
import type { FieldMap } from '../types.ts';

const LIMITS: BodyLimits = { max_string_bytes: 16, max_search_range_ms: 1000n, max_search_rows: 50 };

function body(fields: FieldMap, text: string): unknown {
  return check_json_body(fields, parse_json(new TextEncoder().encode(text)), LIMITS);
}

const USER: FieldMap = { user_id: { type: { kind: 'int64' } } };
const HISTORY: FieldMap = {
  user_id: { type: { kind: 'int64' } },
  from_at: { type: { kind: 'int64' } },
  to_at: { type: { kind: 'int64' } },
  after_seq: { type: { kind: 'int64' } },
  limit: { type: { kind: 'int32' } },
};

describe('body rules', () => {
  it('reads int64 from a JSON integer and a decimal integer string, past 2^53 without loss', () => {
    expect(body(USER, '{"user_id":7}')).toEqual({ user_id: 7n });
    expect(body(USER, '{"user_id":"7"}')).toEqual({ user_id: 7n });
    expect(body(USER, '{"user_id":9223372036854775807}')).toEqual({ user_id: 9223372036854775807n });
  });

  it('refuses unknown fields, missing fields, fractions, exponents and out of range int64', () => {
    expect(body(USER, '{"user_id":1,"other":1}')).toBeNull();
    expect(body(USER, '{}')).toBeNull();
    expect(body(USER, '{"user_id":1.5}')).toBeNull();
    expect(body(USER, '{"user_id":1.0}')).toBeNull();
    expect(body(USER, '{"user_id":1e3}')).toBeNull();
    expect(body(USER, '{"user_id":"1.0"}')).toBeNull();
    expect(body(USER, '{"user_id":9223372036854775808}')).toBeNull();
  });

  it('takes user_id from 1', () => {
    expect(body(USER, '{"user_id":0}')).toBeNull();
    expect(body(USER, '{"user_id":-3}')).toBeNull();
  });

  it('does not turn bool into an integer or a number string into an int32', () => {
    expect(body(USER, '{"user_id":true}')).toBeNull();
    const flag: FieldMap = { enabled: { type: { kind: 'bool' } } };
    expect(body(flag, '{"enabled":1}')).toBeNull();
    expect(body(flag, '{"enabled":"true"}')).toBeNull();
    expect(body(flag, '{"enabled":true}')).toEqual({ enabled: true });
    const count: FieldMap = { count: { type: { kind: 'int32' } } };
    expect(body(count, '{"count":"3"}')).toBeNull();
    expect(body(count, '{"count":2147483648}')).toBeNull();
    expect(body(count, '{"count":3}')).toEqual({ count: 3 });
  });

  it('refuses a body that is not one JSON object or not UTF-8', () => {
    expect(body(USER, '[{"user_id":1}]')).toBeNull();
    expect(body(USER, '')).toBeNull();
    expect(check_json_body(USER, parse_json(new Uint8Array([0x7b, 0xff, 0x7d])), LIMITS)).toBeNull();
  });

  it('keeps limit from 1 to admin-api.maxSearchRows and after_seq from 0', () => {
    const ok = '{"user_id":1,"from_at":0,"to_at":10,"after_seq":0,"limit":50}';
    expect(body(HISTORY, ok)).toEqual({ user_id: 1n, from_at: 0n, to_at: 10n, after_seq: 0n, limit: 50 });
    expect(body(HISTORY, ok.replace('"limit":50', '"limit":0'))).toBeNull();
    expect(body(HISTORY, ok.replace('"limit":50', '"limit":51'))).toBeNull();
    expect(body(HISTORY, ok.replace('"after_seq":0', '"after_seq":-1'))).toBeNull();
  });

  it('keeps to_at − from_at from 1 to admin-api.maxSearchRangeMs', () => {
    const range = (from: number, to: number): unknown => body(HISTORY, `{"user_id":1,"from_at":${String(from)},"to_at":${String(to)},"after_seq":0,"limit":1}`);
    expect(range(5, 6)).not.toBeNull();
    expect(range(0, 1000)).not.toBeNull();
    expect(range(5, 5)).toBeNull();
    expect(range(6, 5)).toBeNull();
    expect(range(0, 1001)).toBeNull();
  });

  it('keeps strings within admin-api.maxStringBytes bytes and operation_id not empty', () => {
    const fields: FieldMap = { operation_id: { type: { kind: 'string' } }, reason: { type: { kind: 'string' } } };
    expect(body(fields, '{"operation_id":"a","reason":"0123456789abcdef"}')).not.toBeNull();
    expect(body(fields, '{"operation_id":"a","reason":"0123456789abcdefg"}')).toBeNull();
    // 6 three-byte characters are 18 bytes.
    expect(body(fields, '{"operation_id":"a","reason":"가나다라마바"}')).toBeNull();
    expect(body(fields, '{"operation_id":"","reason":""}')).toBeNull();
  });

  it('takes a big_amount of items that is empty or a contract big integer', () => {
    const fields: FieldMap = {
      items: {
        type: {
          kind: 'array',
          element: { kind: 'object', fields: { item_id: { type: { kind: 'int32' } }, amount: { type: { kind: 'int64' } }, big_amount: { type: { kind: 'string' }, optional: true } } },
        },
      },
    };
    expect(body(fields, '{"items":[{"item_id":1,"amount":5}]}')).toEqual({ items: [{ item_id: 1, amount: 5n }] });
    expect(body(fields, '{"items":[{"item_id":1,"amount":0,"big_amount":"-90071992547409"}]}')).not.toBeNull();
    expect(body(fields, '{"items":[{"item_id":1,"amount":0,"big_amount":""}]}')).not.toBeNull();
    for (const bad of ['01', '1.5', '+5', '-0', '1e3', 'x']) {
      expect(body(fields, `{"items":[{"item_id":1,"amount":0,"big_amount":"${bad}"}]}`)).toBeNull();
    }
    expect(body(fields, '{"items":[{"item_id":1,"amount":5,"extra":1}]}')).toBeNull();
  });

  it('takes an object union with exactly one listed key and an enum with a listed element', () => {
    const fields: FieldMap = {
      value: { type: { kind: 'object_union', fields: { int_value: { kind: 'int64' }, text_value: { kind: 'string' } } } },
      color: { type: { kind: 'enum', elements: ['Red', 'Blue'] } },
    };
    expect(body(fields, '{"value":{"int_value":3},"color":"Red"}')).toEqual({ value: { int_value: 3n }, color: 'Red' });
    expect(body(fields, '{"value":{"int_value":3,"text_value":"a"},"color":"Red"}')).toBeNull();
    expect(body(fields, '{"value":{},"color":"Red"}')).toBeNull();
    expect(body(fields, '{"value":{"other":1},"color":"Red"}')).toBeNull();
    expect(body(fields, '{"value":{"text_value":"a"},"color":"Green"}')).toBeNull();
    expect(body(fields, '{"value":{"text_value":"a"},"color":"red"}')).toBeNull();
  });

  it('takes request names and MATCH_REQUEST as request_name', () => {
    for (const name of ['Login', 'core/Login', 'cheat/AddGold', 'core/cheat/DevLogin', 'MATCH_REQUEST']) expect(is_request_name(name)).toBe(true);
    for (const name of ['', '/Login', 'core/', 'core//Login', 'x/Login', 'Login Now']) expect(is_request_name(name)).toBe(false);
    expect(body({ request_name: { type: { kind: 'string' } } }, '{"request_name":"x/Login"}')).toBeNull();
  });

  it('reads the query string of a binary body operation and refuses a field given twice', () => {
    const fields: FieldMap = { target_user_id: { type: { kind: 'int64' } }, note: { type: { kind: 'string' }, optional: true } };
    expect(check_query(fields, new URLSearchParams('target_user_id=12'), LIMITS)).toEqual({ target_user_id: 12n });
    expect(check_query(fields, new URLSearchParams('target_user_id=12&target_user_id=13'), LIMITS)).toBeNull();
    expect(check_query(fields, new URLSearchParams('target_user_id=1.5'), LIMITS)).toBeNull();
    expect(check_query(fields, new URLSearchParams('target_user_id=12&other=1'), LIMITS)).toBeNull();
  });
});

describe('CIDR membership', () => {
  it('matches IPv4 and IPv6 networks', () => {
    expect(ip_in_cidrs('10.1.2.3', ['10.0.0.0/8'])).toBe(true);
    expect(ip_in_cidrs('11.1.2.3', ['10.0.0.0/8'])).toBe(false);
    expect(ip_in_cidrs('::ffff:10.1.2.3', ['10.0.0.0/8'])).toBe(true);
    expect(ip_in_cidrs('2001:db8::5', ['2001:db8::/32'])).toBe(true);
    expect(ip_in_cidrs('2001:db9::5', ['2001:db8::/32'])).toBe(false);
    expect(ip_in_cidrs('127.0.0.1', ['0.0.0.0/0'])).toBe(true);
    expect(ip_in_cidrs('127.0.0.1', ['127.0.0.1/32'])).toBe(true);
  });

  it('reads every spelling of an IPv4-mapped IPv6 address as its IPv4 address', () => {
    for (const ip of ['::ffff:10.1.2.3', '0:0:0:0:0:ffff:a01:203', '::ffff:a01:203']) {
      expect([ip, ip_in_cidrs(ip, ['10.0.0.0/8']), ip_in_cidrs(ip, ['11.0.0.0/8']), ip_in_cidrs(ip, ['::/0'])]).toEqual([ip, true, false, false]);
    }
    expect(ip_in_cidrs('::10.1.2.3', ['10.0.0.0/8'])).toBe(false);
    expect(ip_in_cidrs('fe80::1%eth0', ['fe80::/10'])).toBe(true);
  });

  it('reads an IPv4-mapped CIDR of prefix 96 or more as IPv4 and a shorter one as IPv6', () => {
    // prefix 104 = 10.0.0.0/8, prefix 96 = 0.0.0.0/0.
    for (const ip of ['10.1.2.3', '::ffff:10.1.2.3']) expect([ip, ip_in_cidrs(ip, ['::ffff:10.0.0.0/104'])]).toEqual([ip, true]);
    for (const ip of ['11.1.2.3', '::ffff:11.1.2.3']) expect([ip, ip_in_cidrs(ip, ['::ffff:10.0.0.0/104'])]).toEqual([ip, false]);
    for (const ip of ['8.8.8.8', '::ffff:8.8.8.8']) expect([ip, ip_in_cidrs(ip, ['::ffff:10.0.0.0/96'])]).toEqual([ip, true]);
    // prefix 95 and 8 also hold addresses outside ::ffff:0:0/96: no IPv4 client matches, an IPv6 address in range does.
    for (const cidr of ['::ffff:10.0.0.0/95', '::ffff:10.0.0.0/16', '::ffff:10.0.0.0/8']) {
      expect([cidr, ip_in_cidrs('10.1.2.3', [cidr]), ip_in_cidrs('203.0.113.5', [cidr]), ip_in_cidrs('::ffff:8.8.8.8', [cidr])]).toEqual([cidr, false, false, false]);
    }
    expect(ip_in_cidrs('::1', ['::ffff:10.0.0.0/8'])).toBe(true);
    expect(ip_in_cidrs('2001:db8::1', ['::ffff:10.0.0.0/8'])).toBe(false);
  });

  it('does not match across versions or with a CIDR that does not parse', () => {
    expect(ip_in_cidrs('127.0.0.1', ['::/0'])).toBe(false);
    expect(ip_in_cidrs('127.0.0.1', ['127.0.0.0/33', 'nonsense'])).toBe(false);
    expect(ip_in_cidrs('127.0.0.1', [])).toBe(false);
  });

  it('matches no IP for an entry without a prefix', () => {
    expect(ip_in_cidrs('127.0.0.1', ['127.0.0.1'])).toBe(false);
    expect(ip_in_cidrs('10.0.0.1', ['10.0.0.1'])).toBe(false);
    expect(ip_in_cidrs('2001:db8::5', ['2001:db8::5'])).toBe(false);
    expect(ip_in_cidrs('10.0.0.1', ['10.0.0.1', '10.0.0.1/32'])).toBe(true);
  });
});

describe('input_sha256', () => {
  it('serializes keys in byte order without whitespace and int64 as digits', () => {
    const input = { user_id: 12n, operation_id: 'op', items: [{ item_id: 3, amount: 9007199254740993n }] };
    expect(canonical_json(input)).toBe('{"items":[{"amount":9007199254740993,"item_id":3}],"operation_id":"op","user_id":12}');
    expect(sha256_hex(canonical_json(input))).toBe(sha256_hex(canonical_json({ operation_id: 'op', user_id: 12n, items: [{ amount: 9007199254740993n, item_id: 3 }] })));
  });
});

describe('admin operation definitions', () => {
  const operation = (extra: Record<string, unknown> = {}): Record<string, unknown> => ({
    name: 'game_x',
    role: 'ops',
    body: 'json',
    max_body_bytes: null,
    input: { user_id: { type: { kind: 'int64' }, optional: false } },
    user_target: null,
    handler: () => ({}),
    prepare: null,
    audit_args: null,
    ...extra,
  });
  const errors = (module: string, raw: Record<string, unknown>): string[] => {
    const checked = check_definition(module, raw);
    return Array.isArray(checked) ? checked : [];
  };

  it('takes the TypeScript form of an admin operation', () => {
    expect(errors('game', operation())).toEqual([]);
    expect(errors('game', operation({ user_target: 'user_id' }))).toEqual([]);
    expect(errors('game-update', operation({ name: 'put_file', role: 'release', body: 'binary', max_body_bytes: 10, input: { sha256: { type: { kind: 'string' }, optional: false } } }))).toEqual([]);
  });

  it('refuses a role outside read, ops, economy, release and a role read operation with operation_id', () => {
    expect(errors('game', operation({ role: 'privacy' }))).toHaveLength(1);
    expect(errors('game', operation({ role: undefined }))).toHaveLength(1);
    expect(errors('game', operation({ role: 'read', input: { operation_id: { type: { kind: 'string' }, optional: false } } }))).toHaveLength(1);
  });

  it('refuses a content admin operation whose name does not start with game_', () => {
    expect(errors('game', operation({ name: 'reset_all' }))).toHaveLength(1);
    expect(errors('auth', operation({ name: 'reset_all' }))).toEqual([]);
  });

  it('refuses a wrong form: no input field map, no handler, a binary body without a byte limit, a user_target that is not int64', () => {
    expect(errors('game', operation({ input: undefined }))).toHaveLength(1);
    expect(errors('game', operation({ input: { user_id: { type: 'int64', required: true } } }))).toHaveLength(1);
    expect(errors('game', operation({ handler: undefined }))).toHaveLength(1);
    expect(errors('game', operation({ body: 'binary' }))).toHaveLength(1);
    expect(errors('game', operation({ user_target: 'other' }))).toHaveLength(1);
  });
});
