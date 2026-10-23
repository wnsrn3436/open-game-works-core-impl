/**
 * The tables of `push` (`### table`), the stored form of push records, and the checks `queue_push` and
 * `schedule_push` share (`### schedule`).
 */
import { randomBytes } from 'node:crypto';
import { format_tokens, formatter_takes, is_big_integer, type ArgValue } from './format.ts';
import type { DbHandle, PushCore } from './core.ts';

export const T_DEVICE = 'push_device';
export const T_RECORD = 'push_record';
export const T_HELD = 'push_held';
export const T_LOCK = 'push_target_lock';

/** Registers the four tables (`storage.register_table`). */
export function register_tables(core: PushCore): void {
  const s = core.storage;
  s.register_table(T_DEVICE, 'game', [
    { name: 'user_id', type: 'int64' }, { name: 'device_token', type: 'string' }, { name: 'session_id', type: 'string' },
    { name: 'provider', type: 'string' }, { name: 'language', type: 'string' }, { name: 'timezone_offset_ms', type: 'int64' },
    { name: 'ad_allowed', type: 'bool' }, { name: 'night_allowed', type: 'bool' }, { name: 'updated_at', type: 'int64' },
  ], ['device_token'], null, null, 'user_id', [['user_id']]);
  s.register_table(T_RECORD, 'game', [
    { name: 'push_id', type: 'int64' }, { name: 'source', type: 'string' }, { name: 'message_id', type: 'int32' },
    { name: 'args', type: 'string' }, { name: 'send_at', type: 'int64' }, { name: 'target', type: 'string' },
    { name: 'target_user_id', type: 'int64?' }, { name: 'dedupe_key', type: 'string' }, { name: 'status', type: 'string' },
    { name: 'device_count', type: 'int64' }, { name: 'sent_count', type: 'int64' }, { name: 'invalid_count', type: 'int64' },
    { name: 'failed_count', type: 'int64' }, { name: 'consent_skipped_count', type: 'int64' }, { name: 'held_count', type: 'int64' },
    { name: 'cursor_user_id', type: 'int64' }, { name: 'lease_owner', type: 'string' }, { name: 'lease_until', type: 'int64' },
    { name: 'created_at', type: 'int64' }, { name: 'finished_at', type: 'int64?' }, { name: 'expires_at', type: 'int64?' },
  ], ['push_id'], 'expires_at', null, null, [['status', 'send_at'], ['target_user_id', 'status'], ['send_at']]);
  s.register_table(T_HELD, 'game', [
    { name: 'push_id', type: 'int64' }, { name: 'user_id', type: 'int64' }, { name: 'send_at', type: 'int64' }, { name: 'expires_at', type: 'int64' },
  ], ['push_id', 'user_id'], 'expires_at', null, null, [['send_at'], ['user_id']]);
  s.register_table(T_LOCK, 'game', [{ name: 'user_id', type: 'int64' }], ['user_id'], null, null);
}

/** A `PushArg` of content code: an integer or a string value under a name. */
export type PushArg = { readonly name: string; readonly int_value: bigint } | { readonly name: string; readonly text_value: string };

/** A `PushArg` as `schedule_push` takes it and as `push_record.args` stores it. */
export interface StoredArg {
  readonly name: string;
  readonly value: { readonly int_value: bigint } | { readonly text_value: string };
}

export type Target =
  | { readonly user_ids: readonly bigint[] }
  | { readonly filter: { readonly platforms: readonly string[]; readonly languages: readonly string[]; readonly active_within_ms: bigint } };

export type Status = 'SCHEDULED' | 'SENDING' | 'SENT' | 'CANCELED' | 'EXPIRED' | 'FAILED';

/** The `PushArg` list of content code in the stored form, or null when an element is not a `PushArg`. */
export function stored_args(args: unknown): StoredArg[] | null {
  if (!Array.isArray(args)) return null;
  const out: StoredArg[] = [];
  for (const arg of args as unknown[]) {
    if (typeof arg !== 'object' || arg === null) return null;
    const a = arg as Record<string, unknown>;
    const has_int = 'int_value' in a;
    const has_text = 'text_value' in a;
    if (typeof a.name !== 'string' || has_int === has_text) return null;
    if (has_int && typeof a.int_value === 'bigint') out.push({ name: a.name, value: { int_value: a.int_value } });
    else if (has_text && typeof a.text_value === 'string') out.push({ name: a.name, value: { text_value: a.text_value } });
    else return null;
  }
  return out;
}

/** The values of stored args by name. */
export function arg_values(args: readonly StoredArg[]): Map<string, ArgValue> {
  return new Map(args.map((a) => [a.name, 'int_value' in a.value ? a.value.int_value : a.value.text_value]));
}

/** JSON of a value with `bigint` as a decimal string: the field types of `schedule_push` written as JSON. */
export function to_json_text(value: unknown): string {
  return JSON.stringify(value, (_key, v: unknown) => (typeof v === 'bigint' ? v.toString() : v));
}

function big(value: unknown): bigint | null {
  if (typeof value === 'string' && /^-?[0-9]+$/.test(value)) return BigInt(value);
  return null;
}

/** `push_record.args` read back. */
export function parse_args(text: string): StoredArg[] {
  const out: StoredArg[] = [];
  for (const a of JSON.parse(text) as { name: string; value: { int_value?: string; text_value?: string } }[]) {
    const int_value = big(a.value.int_value);
    out.push(int_value === null ? { name: a.name, value: { text_value: a.value.text_value ?? '' } } : { name: a.name, value: { int_value } });
  }
  return out;
}

/** `push_record.target` read back. */
export function parse_target(text: string): Target {
  const json = JSON.parse(text) as { user_ids?: string[]; filter?: { platforms: string[]; languages: string[]; active_within_ms: string } };
  if (json.user_ids !== undefined) return { user_ids: json.user_ids.map((id) => BigInt(id)) };
  const f = json.filter ?? { platforms: [], languages: [], active_within_ms: '0' };
  return { filter: { platforms: f.platforms, languages: f.languages, active_within_ms: BigInt(f.active_within_ms) } };
}

/**
 * The `queue_push` checks of a message and its args that do not depend on time (`### schedule`): the message is a
 * `push_message` row; the args' name set is the format argument name set of its `title` and `body` in every
 * supported language; each argument's formatter takes the `PushArg` value kind; a `compact` string is a contract
 * big integer. Returns null when they pass, or the reason.
 */
export function check_message(core: PushCore, message_id: number, args: readonly StoredArg[]): string | null {
  const table = core.server.data.PushMessageTable;
  if (!Number.isSafeInteger(message_id) || !table.has_row(message_id)) return `message ${String(message_id)} is not a push_message row`;
  const values = arg_values(args);
  if (values.size !== args.length) return 'args has a name twice';
  const row = table.get_row(message_id);
  for (const language of core.settings.supported_languages) {
    const reason = check_language(core, language, [row.title, row.body], values);
    if (reason !== null) return reason;
  }
  return null;
}

/** The `check_message` checks of one language's `title` and `body`. */
function check_language(core: PushCore, language: string, keys: readonly string[], values: ReadonlyMap<string, ArgValue>): string | null {
  const names = new Set<string>();
  for (const key of keys) {
    const text = core.translations.text(language, key);
    if (text === null) return `no ${language} translation of ${key}`;
    for (const token of format_tokens(text)) {
      names.add(token.name);
      const value = values.get(token.name);
      if (value === undefined) return `args has no ${token.name}`;
      const kind = typeof value === 'bigint' ? 'integer' : 'string';
      if (!formatter_takes(token.formatter, kind)) return `{${token.name}:${token.formatter ?? ''}} in ${language} does not take ${kind}`;
      if (token.formatter === 'compact' && typeof value === 'string' && !is_big_integer(value)) return `compact {${token.name}} is not a big integer`;
    }
  }
  for (const name of values.keys()) if (!names.has(name)) return `args has ${name}, which the ${language} text does not have`;
  return null;
}

/** A new push ID: a secure random positive int64 below 2^62 that no `push_record` row has. */
export function new_push_id(db: DbHandle): bigint {
  for (;;) {
    const id = (randomBytes(8).readBigUInt64BE() >> 2n) || 1n;
    if (db.query(`SELECT 1 AS x FROM ${T_RECORD} WHERE push_id = $1`, [id]).length === 0) return id;
  }
}

/** The values of a new `push_record` row before its first send. */
export interface NewRecord {
  readonly source: 'handler' | 'operator';
  readonly message_id: number;
  readonly args: readonly StoredArg[];
  readonly send_at: bigint;
  readonly target: Target;
  readonly dedupe_key: string;
}

/** Inserts a `SCHEDULED` record and returns its push ID. */
export function insert_record(core: PushCore, db: DbHandle, record: NewRecord): bigint {
  const push_id = new_push_id(db);
  const target_user_id = 'user_ids' in record.target && record.target.user_ids.length === 1 ? record.target.user_ids[0] ?? null : null;
  db.query(
    `INSERT INTO ${T_RECORD} (push_id, source, message_id, args, send_at, target, target_user_id, dedupe_key, status, device_count, sent_count,
       invalid_count, failed_count, consent_skipped_count, held_count, cursor_user_id, lease_owner, lease_until, created_at, finished_at, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'SCHEDULED', 0, 0, 0, 0, 0, 0, 0, '', 0, $9, NULL, NULL)`,
    [push_id, record.source, record.message_id, to_json_text(record.args), record.send_at, to_json_text(record.target), target_user_id, record.dedupe_key, core.time.clock_now()],
  );
  return push_id;
}

/** Ends records with a final status: `finished_at` now and `expires_at` after `push.recordRetentionMs`. */
export function finish_sql(where: string): string {
  return `UPDATE ${T_RECORD} SET status = $1, finished_at = $2, expires_at = $3 WHERE ${where}`;
}

export function finish_params(core: PushCore, status: Status): [Status, bigint, bigint] {
  const now = core.time.clock_now();
  return [status, now, now + core.settings.record_retention_ms];
}

const RECORD_COLUMNS = [
  'push_id', 'source', 'message_id', 'send_at', 'target_user_id', 'dedupe_key', 'status', 'device_count', 'sent_count', 'invalid_count',
  'failed_count', 'consent_skipped_count', 'held_count', 'cursor_user_id', 'lease_until', 'created_at', 'finished_at',
] as const;

/** The SELECT list of a push record as `get_push` and `list_pushes` give it. */
export const RECORD_SELECT = [...RECORD_COLUMNS, 'args', 'target'].join(', ');

/** A push record as an admin output object: the `push_record` columns but `lease_owner` and `expires_at`. */
export function record_output(row: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const c of RECORD_COLUMNS) out[c] = row[c] ?? null;
  out.args = JSON.parse(row.args as string) as unknown;
  out.target = JSON.parse(row.target as string) as unknown;
  return out;
}
