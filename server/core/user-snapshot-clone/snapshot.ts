/**
 * The snapshot and game state snapshot JSON form (`### snapshot`, `### game state snapshot`): building, the
 * `sha256` of `records`, parsing an import body, and the `int64 key = 1` rewrite of a game state value.
 */
import { createHash } from 'node:crypto';
import { canonical_json, type RawRow } from '../storage/index.ts';
import type { Version } from '../validation/index.ts';

/** `validation.parse_version`: check 2 breaks when it cannot read `core_version`. */
export type ParseVersion = (text: string) => Version | null;

/** The snapshot format version this server writes and reads. */
export const SNAPSHOT_FORMAT = 1;

/** A record: a raw row as JSON. `value` is the standard base64 of the raw row bytes. */
export interface SnapshotRecord {
  readonly table: string;
  readonly key: string;
  readonly contract_version: number;
  readonly value: string;
}

/** The fields of a game state snapshot. A user snapshot adds `source_user_id` and `user_created_at`. */
export interface GameStateSnapshot {
  readonly format: number;
  readonly app_id: string;
  readonly source_environment: string;
  readonly exported_at: string;
  readonly contract_version: number;
  readonly data_version: string;
  readonly core_version: string;
  readonly records: readonly SnapshotRecord[];
  readonly sha256: string;
}

export interface UserSnapshot extends GameStateSnapshot {
  readonly source_user_id: string;
  readonly user_created_at: string;
}

/** What a snapshot says about the server that wrote it, besides its records. */
export interface SnapshotSource {
  readonly app_id: string;
  readonly source_environment: string;
  readonly exported_at: bigint;
  readonly contract_version: number;
  readonly data_version: string;
  readonly core_version: string;
}

type FieldType = 'integer' | 'string' | 'decimal' | 'records';

const GAME_STATE_FIELDS: Readonly<Record<string, FieldType>> = {
  format: 'integer',
  app_id: 'string',
  source_environment: 'string',
  exported_at: 'decimal',
  contract_version: 'integer',
  data_version: 'string',
  core_version: 'string',
  records: 'records',
  sha256: 'string',
};

const USER_FIELDS: Readonly<Record<string, FieldType>> = {
  ...GAME_STATE_FIELDS,
  source_user_id: 'decimal',
  user_created_at: 'decimal',
};

const RECORD_FIELDS: Readonly<Record<string, FieldType>> = { table: 'string', key: 'string', contract_version: 'integer', value: 'string' };

const DECIMAL = /^-?(0|[1-9][0-9]*)$/;
const INT64_MIN = -(2n ** 63n);
const INT64_MAX = 2n ** 63n - 1n;

/** `sha256`: the SHA-256 lowercase hex of the canonical JSON of `records`. */
export function records_sha256(records: readonly SnapshotRecord[]): string {
  return createHash('sha256').update(canonical_json(records), 'utf8').digest('hex');
}

/** A raw row as a record. */
export function record_of(row: RawRow): SnapshotRecord {
  return { table: row.table, key: row.key, contract_version: Number(row.contract_version), value: Buffer.from(row.value).toString('base64') };
}

/** A record as a raw row. */
export function raw_row_of(record: SnapshotRecord): RawRow {
  return { table: record.table, key: record.key, contract_version: BigInt(record.contract_version), value: new Uint8Array(Buffer.from(record.value, 'base64')) };
}

export function game_state_snapshot(source: SnapshotSource, rows: readonly RawRow[]): GameStateSnapshot {
  const records = rows.map(record_of);
  return {
    format: SNAPSHOT_FORMAT,
    app_id: source.app_id,
    source_environment: source.source_environment,
    exported_at: String(source.exported_at),
    contract_version: source.contract_version,
    data_version: source.data_version,
    core_version: source.core_version,
    records,
    sha256: records_sha256(records),
  };
}

export function user_snapshot(source: SnapshotSource, user_id: bigint, user_created_at: bigint, rows: readonly RawRow[]): UserSnapshot {
  const base = game_state_snapshot(source, rows);
  return { ...base, source_user_id: String(user_id), user_created_at: String(user_created_at) };
}

/** The UTF-8 byte length of the snapshot as JSON without whitespace. */
export function serialized_bytes(snapshot: GameStateSnapshot): number {
  return Buffer.byteLength(JSON.stringify(snapshot), 'utf8');
}

function is_type(value: unknown, type: FieldType): boolean {
  switch (type) {
    case 'integer':
      return typeof value === 'number' && Number.isSafeInteger(value);
    case 'string':
      return typeof value === 'string';
    case 'decimal': {
      if (typeof value !== 'string' || !DECIMAL.test(value)) return false;
      const n = BigInt(value);
      return n >= INT64_MIN && n <= INT64_MAX;
    }
    case 'records':
      return Array.isArray(value) && value.every(is_record);
  }
}

function has_fields(value: unknown, fields: Readonly<Record<string, FieldType>>): boolean {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const object = value as Record<string, unknown>;
  const names = Object.keys(object);
  if (names.length !== Object.keys(fields).length) return false;
  return names.every((name) => Object.hasOwn(fields, name) && is_type(object[name], fields[name] as FieldType));
}

/**
 * Whether a text is standard base64 with padding. `Buffer` skips characters outside the alphabet when it decodes, so
 * only a text that encodes back to itself is base64. Linear in the length: a backtracking regex runs out of stack on a
 * long value.
 */
function is_base64(text: string): boolean {
  return Buffer.from(text, 'base64').toString('base64') === text;
}

function is_record(value: unknown): boolean {
  return has_fields(value, RECORD_FIELDS) && is_base64((value as SnapshotRecord).value);
}

/** Whether a JSON value passes `import_user_snapshot` check 2 on the given snapshot fields. */
function passes_check(value: unknown, fields: Readonly<Record<string, FieldType>>, parse_version: ParseVersion): boolean {
  if (!has_fields(value, fields)) return false;
  const snapshot = value as GameStateSnapshot;
  if (snapshot.format !== SNAPSHOT_FORMAT || parse_version(snapshot.core_version) === null) return false;
  return records_sha256(snapshot.records) === snapshot.sha256;
}

/** `check_snapshot`: check 2 on a snapshot, or on a game state snapshot when `game_state` is true. */
export function check_snapshot_value(value: unknown, game_state: boolean, parse_version: ParseVersion): boolean {
  return passes_check(value, game_state ? GAME_STATE_FIELDS : USER_FIELDS, parse_version);
}

function parse_object(body: Uint8Array, fields: Readonly<Record<string, FieldType>>, parse_version: ParseVersion): unknown {
  let value: unknown;
  try {
    value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(body));
  } catch {
    return null;
  }
  return passes_check(value, fields, parse_version) ? value : null;
}

/** An import body as a user snapshot, or null when it breaks `import_user_snapshot` check 2. */
export function parse_user_snapshot(body: Uint8Array, parse_version: ParseVersion): UserSnapshot | null {
  return parse_object(body, USER_FIELDS, parse_version) as UserSnapshot | null;
}

/** An import body as a game state snapshot, or null when it breaks check 2 on the game state snapshot fields. */
export function parse_game_state_snapshot(body: Uint8Array, parse_version: ParseVersion): GameStateSnapshot | null {
  return parse_object(body, GAME_STATE_FIELDS, parse_version) as GameStateSnapshot | null;
}

function read_varint(bytes: Uint8Array, at: number): { value: bigint; next: number } | null {
  let value = 0n;
  for (let i = 0; i < 10; i += 1) {
    const b = bytes[at + i];
    if (b === undefined) return null;
    value |= BigInt(b & 0x7f) << BigInt(7 * i);
    if ((b & 0x80) === 0) return { value, next: at + i + 1 };
  }
  return null;
}

function write_varint(value: bigint, out: number[]): void {
  let v = BigInt.asUintN(64, value);
  while (v >= 0x80n) {
    out.push(Number((v & 0x7fn) | 0x80n));
    v >>= 7n;
  }
  out.push(Number(v));
}

/** The end of the field value that starts at `at` with wire type `wire`, or null when the bytes end early. */
function field_end(bytes: Uint8Array, wire: number, at: number): number | null {
  let end: number;
  if (wire === 0) {
    const value = read_varint(bytes, at);
    if (value === null) return null;
    end = value.next;
  } else if (wire === 1 || wire === 5) {
    end = at + (wire === 1 ? 8 : 4);
  } else if (wire === 2) {
    const length = read_varint(bytes, at);
    if (length === null || length.value > BigInt(bytes.length)) return null;
    end = length.next + Number(length.value);
  } else {
    return null;
  }
  return end > bytes.length ? null : end;
}

/**
 * The proto3 message bytes with field `int64 key = 1` set to `key` and every other field kept byte for byte, or
 * null when the bytes are not a proto3 message or field 1 is not a varint.
 */
export function with_key_field(bytes: Uint8Array, key: bigint): Uint8Array | null {
  // The kept fields are copied as `[start, end)` ranges: spreading a large field into `push` arguments overflows
  // the call stack.
  const kept: [number, number][] = [];
  let kept_length = 0;
  let at = 0;
  while (at < bytes.length) {
    const tag = read_varint(bytes, at);
    if (tag === null || tag.value >> 3n === 0n) return null;
    const wire = Number(tag.value & 7n);
    const end = field_end(bytes, wire, tag.next);
    if (end === null) return null;
    if (tag.value >> 3n !== 1n) {
      kept.push([at, end]);
      kept_length += end - at;
    } else if (wire !== 0) return null;
    at = end;
  }
  const head: number[] = [];
  if (key !== 0n) {
    head.push(0x08);
    write_varint(key, head);
  }
  const out = new Uint8Array(head.length + kept_length);
  out.set(head, 0);
  let offset = head.length;
  for (const [start, end] of kept) {
    out.set(bytes.subarray(start, end), offset);
    offset += end - start;
  }
  return out;
}
