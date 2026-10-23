import { createHash } from 'node:crypto';
import { canonical_json } from '../../storage/canonical_json.ts';
import { parseVersion } from '../../validation/helper.ts';
import {
  check_snapshot_value,
  game_state_snapshot,
  parse_game_state_snapshot,
  parse_user_snapshot,
  records_sha256,
  user_snapshot,
  with_key_field,
  type SnapshotSource,
} from '../snapshot.ts';

const SOURCE: SnapshotSource = {
  app_id: 'com.example.coretest',
  source_environment: 'PROD',
  exported_at: 1_800_000_000_000n,
  contract_version: 3,
  data_version: 'data-1',
  core_version: '1.2.3',
};

const ROWS = [
  { table: 'user_state', key: 'item_balance_user_state/5', contract_version: 2n, value: Uint8Array.from([8, 5, 16, 100]) },
  { table: 'server_state', key: 'x_server_state/0', contract_version: 3n, value: new Uint8Array(0) },
];

function bytes(value: unknown): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(value));
}

function snapshot(): Record<string, unknown> {
  return JSON.parse(JSON.stringify(user_snapshot(SOURCE, 42n, 1_700_000_000_000n, ROWS))) as Record<string, unknown>;
}

describe('snapshot form', () => {
  it('writes the snapshot table fields with their JSON types', () => {
    const s = snapshot();
    expect(Object.keys(s).sort()).toEqual(
      ['app_id', 'contract_version', 'core_version', 'data_version', 'exported_at', 'format', 'records', 'sha256', 'source_environment', 'source_user_id', 'user_created_at'].sort(),
    );
    expect(s['format']).toBe(1);
    expect(s['source_user_id']).toBe('42');
    expect(s['user_created_at']).toBe('1700000000000');
    expect(s['exported_at']).toBe('1800000000000');
    expect(s['contract_version']).toBe(3);
    expect(typeof s['data_version']).toBe('string');
    expect(s['records']).toEqual([
      { table: 'user_state', key: 'item_balance_user_state/5', contract_version: 2, value: Buffer.from([8, 5, 16, 100]).toString('base64') },
      { table: 'server_state', key: 'x_server_state/0', contract_version: 3, value: '' },
    ]);
  });

  it('makes sha256 from records with keys in byte order and no whitespace', () => {
    const s = snapshot();
    const text =
      '[{"contract_version":2,"key":"item_balance_user_state/5","table":"user_state","value":"CAUQZA=="},' +
      '{"contract_version":3,"key":"x_server_state/0","table":"server_state","value":""}]';
    expect(canonical_json(s['records'])).toBe(text);
    expect(s['sha256']).toBe(createHash('sha256').update(text, 'utf8').digest('hex'));
  });

  it('game state snapshot has no source_user_id and user_created_at', () => {
    const g = game_state_snapshot(SOURCE, []);
    expect(Object.keys(g)).not.toContain('source_user_id');
    expect(Object.keys(g)).not.toContain('user_created_at');
    expect(g.sha256).toBe(records_sha256([]));
  });
});

describe('snapshot parse', () => {
  it('reads back what it writes', () => {
    expect(parse_user_snapshot(bytes(snapshot()), parseVersion)).toEqual(snapshot());
  });

  it.each([
    ['format as a string', { format: '1' }],
    ['format 2', { format: 2 }],
    ['contract_version as a string', { contract_version: '3' }],
    ['exported_at as a JSON integer', { exported_at: 1_800_000_000_000 }],
    ['user_created_at not decimal', { user_created_at: '1e3' }],
    ['source_user_id beyond int64', { source_user_id: '9223372036854775808' }],
    ['core_version not major.minor.patch', { core_version: '1.2' }],
    ['core_version with a leading zero in major', { core_version: '01.0.0' }],
    ['core_version with a leading zero in minor', { core_version: '1.02.3' }],
    ['core_version with a leading zero in patch', { core_version: '0.0.00' }],
    ['a wrong sha256', { sha256: '0'.repeat(64) }],
    ['an unknown field', { extra: 1 }],
  ])('refuses %s', (_name, change) => {
    expect(parse_user_snapshot(bytes({ ...snapshot(), ...change }), parseVersion)).toBeNull();
  });

  it('refuses a missing field', () => {
    const s = snapshot();
    delete s['data_version'];
    expect(parse_user_snapshot(bytes(s), parseVersion)).toBeNull();
  });

  it('refuses records whose field names or types break the record form', () => {
    const base = snapshot();
    const bad = [
      [{ table: 'user_state', key: 'a/1', contract_version: '2', value: '' }],
      [{ table: 'user_state', key: 'a/1', contract_version: 2 }],
      [{ table: 'user_state', key: 'a/1', contract_version: 2, value: '', more: 1 }],
      [{ table: 'user_state', key: 'a/1', contract_version: 2, value: 'not base64!' }],
      [{ table: 1, key: 'a/1', contract_version: 2, value: '' }],
    ];
    for (const records of bad) expect(parse_user_snapshot(bytes({ ...base, records, sha256: records_sha256(records as never) }), parseVersion)).toBeNull();
  });

  it('takes a record value above 4.5M base64 characters, and refuses a long or short value that is not standard base64', () => {
    const long = Buffer.alloc(3_400_000, 0xab).toString('base64');
    expect(long.length).toBeGreaterThan(4_500_000);
    const with_value = (value: string) => {
      const records = [{ table: 'user_state', key: 'a/1', contract_version: 2, value }];
      return { ...snapshot(), records, sha256: records_sha256(records) };
    };
    expect(parse_user_snapshot(bytes(with_value(long)), parseVersion)).toEqual(with_value(long));
    expect(check_snapshot_value(with_value(long), false, parseVersion)).toBe(true);
    for (const value of [`${long.slice(0, -1)}!`, `${long}A`, 'AAA', 'AA-_', 'AA A', 'AAAA\n', 'QR==', '=AAA', 'AA=A']) {
      expect(parse_user_snapshot(bytes(with_value(value)), parseVersion)).toBeNull();
      expect(check_snapshot_value(with_value(value), false, parseVersion)).toBe(false);
    }
    expect(parse_user_snapshot(bytes(with_value('QQ==')), parseVersion)).not.toBeNull();
  });

  it('refuses a body that is not one JSON object', () => {
    expect(parse_user_snapshot(new TextEncoder().encode('[1]'), parseVersion)).toBeNull();
    expect(parse_user_snapshot(new TextEncoder().encode('{'), parseVersion)).toBeNull();
    expect(parse_user_snapshot(Uint8Array.from([0xff, 0xfe]), parseVersion)).toBeNull();
  });

  it('a game state snapshot body with user fields is not a game state snapshot', () => {
    expect(parse_game_state_snapshot(bytes(snapshot()), parseVersion)).toBeNull();
    const g = JSON.parse(JSON.stringify(game_state_snapshot(SOURCE, []))) as unknown;
    expect(parse_game_state_snapshot(bytes(g), parseVersion)).toEqual(g);
    expect(parse_user_snapshot(bytes(g), parseVersion)).toBeNull();
  });

  it('takes JSON whitespace around the snapshot', () => {
    expect(parse_user_snapshot(new TextEncoder().encode(` ${JSON.stringify(snapshot())}\n   `), parseVersion)).toEqual(snapshot());
  });
});

describe('game state key rewrite', () => {
  it('sets field 1 and keeps every other field byte for byte', () => {
    // key = 5, hp = 300, damages = [1, 2] packed, and an unknown field 9 of wire type 5.
    const value = Uint8Array.from([0x08, 0x05, 0x10, 0xac, 0x02, 0x1a, 0x02, 0x01, 0x02, 0x4d, 1, 2, 3, 4]);
    const rewritten = with_key_field(value, 77n);
    expect(rewritten).toEqual(Uint8Array.from([0x08, 77, 0x10, 0xac, 0x02, 0x1a, 0x02, 0x01, 0x02, 0x4d, 1, 2, 3, 4]));
    expect(with_key_field(value, 0n)).toEqual(Uint8Array.from([0x10, 0xac, 0x02, 0x1a, 0x02, 0x01, 0x02, 0x4d, 1, 2, 3, 4]));
    expect(with_key_field(Uint8Array.from([0x10, 0x01]), 300n)).toEqual(Uint8Array.from([0x08, 0xac, 0x02, 0x10, 0x01]));
  });

  it('rewrites a value with a length-delimited field of 1,000,000 bytes', () => {
    const size = 1_000_000;
    // key = 5, then field 2 (wire type 2) of `size` bytes: the length 1,000,000 is the varint c0 84 3d.
    const value = new Uint8Array(2 + 1 + 3 + size);
    value.set([0x08, 0x05, 0x12, 0xc0, 0x84, 0x3d], 0);
    value.fill(0x5a, 6);
    const rewritten = with_key_field(value, 7n);
    expect(rewritten).not.toBeNull();
    expect(rewritten?.length).toBe(value.length);
    expect(rewritten?.subarray(0, 2)).toEqual(Uint8Array.from([0x08, 0x07]));
    expect(Buffer.from(rewritten?.subarray(2) ?? []).equals(Buffer.from(value.subarray(2)))).toBe(true);
  });

  it('refuses bytes that are not a proto3 message', () => {
    expect(with_key_field(Uint8Array.from([0x10]), 1n)).toBeNull();
    expect(with_key_field(Uint8Array.from([0x1a, 0x05, 0x01]), 1n)).toBeNull();
    expect(with_key_field(Uint8Array.from([0x0a, 0x00]), 1n)).toBeNull();
  });
});

describe('check_snapshot', () => {
  it('runs check 2 on a JSON value: the user snapshot table, or the game state snapshot table', () => {
    const g = JSON.parse(JSON.stringify(game_state_snapshot(SOURCE, ROWS))) as Record<string, unknown>;
    expect(check_snapshot_value(snapshot(), false, parseVersion)).toBe(true);
    expect(check_snapshot_value(g, true, parseVersion)).toBe(true);
    expect(check_snapshot_value(snapshot(), true, parseVersion)).toBe(false);
    expect(check_snapshot_value(g, false, parseVersion)).toBe(false);
    expect(check_snapshot_value({ ...snapshot(), exported_at: 1 }, false, parseVersion)).toBe(false);
    expect(check_snapshot_value({ ...g, sha256: '0'.repeat(64) }, true, parseVersion)).toBe(false);
    expect(check_snapshot_value('{}', false, parseVersion)).toBe(false);
  });
});
