/**
 * auth's tables (`### table`) and every SQL statement on them. Enum columns hold element names. Writes that create
 * a row or count are one upsert statement (`storage` `### expiry`).
 */
import type { ColumnDefinition, DbHandle, SqlRow, Storage } from './deps.ts';

export interface TableDefinition {
  readonly name: string;
  readonly scope: 'user' | 'game';
  readonly columns: readonly ColumnDefinition[];
  readonly key: readonly string[];
  readonly expiry: string | null;
  readonly personal: boolean;
  readonly indexes: readonly (readonly string[])[];
}

const c = (name: string, type: ColumnDefinition['type']): ColumnDefinition => ({ name, type });

export const TABLES: readonly TableDefinition[] = [
  {
    name: 'auth_login_token',
    scope: 'user',
    columns: [c('user_id', 'int64'), c('token_hash', 'string'), c('previous_hash', 'string?'), c('session_id', 'string'), c('created_at', 'int64'), c('last_used_at', 'int64')],
    key: ['token_hash'],
    expiry: null,
    personal: false,
    indexes: [
      ['user_id', 'previous_hash'],
      ['user_id', 'session_id'],
    ],
  },
  {
    name: 'auth_social_link',
    scope: 'user',
    columns: [c('user_id', 'int64'), c('provider', 'string'), c('provider_account_id', 'string'), c('linked_at', 'int64')],
    key: ['provider', 'provider_account_id'],
    expiry: null,
    personal: true,
    indexes: [['user_id']],
  },
  {
    name: 'auth_terms_agreement',
    scope: 'user',
    columns: [c('user_id', 'int64'), c('item', 'string'), c('version', 'int32'), c('agreed_at', 'int64')],
    key: ['user_id', 'item', 'version'],
    expiry: null,
    personal: true,
    indexes: [],
  },
  {
    name: 'auth_age',
    scope: 'user',
    columns: [c('user_id', 'int64'), c('birth_year_month', 'int32'), c('confirmed_at', 'int64')],
    key: ['user_id'],
    expiry: null,
    personal: true,
    indexes: [],
  },
  {
    name: 'auth_consent_record',
    scope: 'user',
    columns: [c('user_id', 'int64'), c('seq', 'int64'), c('purpose', 'string'), c('value', 'string'), c('version', 'int32'), c('recorded_at', 'int64')],
    key: ['user_id', 'seq'],
    expiry: null,
    personal: true,
    indexes: [],
  },
  {
    name: 'auth_apple_token',
    scope: 'user',
    columns: [c('user_id', 'int64'), c('refresh_token', 'string'), c('updated_at', 'int64')],
    key: ['user_id'],
    expiry: null,
    personal: true,
    indexes: [],
  },
  {
    name: 'auth_deletion_code',
    scope: 'user',
    columns: [c('user_id', 'int64'), c('code_hash', 'string'), c('attempts', 'int32'), c('expires_at', 'int64')],
    key: ['user_id'],
    expiry: 'expires_at',
    personal: false,
    indexes: [],
  },
  {
    name: 'auth_deletion_ip_counter',
    scope: 'game',
    columns: [c('ip', 'string'), c('window_start', 'int64'), c('count', 'int64'), c('expires_at', 'int64')],
    key: ['ip', 'window_start'],
    expiry: 'expires_at',
    personal: false,
    indexes: [],
  },
];

/** `auth_dev_account`. The DEV code registers it. */
export const DEV_ACCOUNT_TABLE: TableDefinition = {
  name: 'auth_dev_account',
  scope: 'user',
  columns: [c('user_id', 'int64'), c('name', 'string')],
  key: ['name'],
  expiry: null,
  personal: false,
  indexes: [],
};

/** Registers a table: `user` scope tables without snapshot, `game` scope tables with no snapshot value. */
export function register(storage: Storage, table: TableDefinition): void {
  const snapshot = table.scope === 'user' ? false : null;
  storage.register_table(table.name, table.scope, table.columns, table.key, table.expiry, snapshot, table.personal ? 'user_id' : null, table.indexes);
}

function big(row: SqlRow, column: string): bigint {
  const value = row[column];
  if (typeof value === 'bigint') return value;
  if (typeof value === 'number' && Number.isSafeInteger(value)) return BigInt(value);
  throw new TypeError(`auth: column ${column} is not an integer`);
}

function int(row: SqlRow, column: string): number {
  return Number(big(row, column));
}

function str(row: SqlRow, column: string): string {
  const value = row[column];
  if (typeof value !== 'string') throw new TypeError(`auth: column ${column} is not a string`);
  return value;
}

// login token

export interface LoginTokenRow {
  readonly user_id: bigint;
  readonly token_hash: string;
  readonly previous_hash: string | null;
  readonly session_id: string;
  readonly created_at: bigint;
  readonly last_used_at: bigint;
}

function login_token_row(row: SqlRow): LoginTokenRow {
  const previous = row.previous_hash;
  return {
    user_id: big(row, 'user_id'),
    token_hash: str(row, 'token_hash'),
    previous_hash: typeof previous === 'string' ? previous : null,
    session_id: str(row, 'session_id'),
    created_at: big(row, 'created_at'),
    last_used_at: big(row, 'last_used_at'),
  };
}

export function find_login_token(db: DbHandle, token_hash: string): LoginTokenRow | null {
  const rows = db.query('SELECT user_id, token_hash, previous_hash, session_id, created_at, last_used_at FROM auth_login_token WHERE token_hash = $1', [token_hash]);
  return rows[0] === undefined ? null : login_token_row(rows[0]);
}

export function insert_login_token(db: DbHandle, row: LoginTokenRow): void {
  db.query('INSERT INTO auth_login_token (user_id, token_hash, previous_hash, session_id, created_at, last_used_at) VALUES ($1, $2, $3, $4, $5, $6)', [
    row.user_id,
    row.token_hash,
    row.previous_hash,
    row.session_id,
    row.created_at,
    row.last_used_at,
  ]);
}

export function touch_login_token(db: DbHandle, token_hash: string, last_used_at: bigint, session_id: string | null): void {
  if (session_id === null) db.query('UPDATE auth_login_token SET last_used_at = $1 WHERE token_hash = $2', [last_used_at, token_hash]);
  else db.query('UPDATE auth_login_token SET last_used_at = $1, session_id = $2 WHERE token_hash = $3', [last_used_at, session_id, token_hash]);
}

export function delete_login_token(db: DbHandle, token_hash: string): void {
  db.query('DELETE FROM auth_login_token WHERE token_hash = $1', [token_hash]);
}

export function delete_next_login_tokens(db: DbHandle, user_id: bigint, previous_hash: string): void {
  db.query('DELETE FROM auth_login_token WHERE user_id = $1 AND previous_hash = $2', [user_id, previous_hash]);
}

export function login_tokens_of_session(db: DbHandle, user_id: bigint, session_id: string): LoginTokenRow[] {
  const rows = db.query('SELECT user_id, token_hash, previous_hash, session_id, created_at, last_used_at FROM auth_login_token WHERE user_id = $1 AND session_id = $2', [user_id, session_id]);
  return rows.map(login_token_row);
}

/** The latest `last_used_at` of the user's login token rows; null when there is none. */
export function last_token_use(db: DbHandle, user_id: bigint): bigint | null {
  const rows = db.query('SELECT MAX(last_used_at) AS last_used_at FROM auth_login_token WHERE user_id = $1', [user_id]);
  const value = rows[0]?.last_used_at;
  return value === null || value === undefined ? null : big(rows[0] as SqlRow, 'last_used_at');
}

// social link

/** The user of a social account, or null. */
export function find_social_link(db: DbHandle, provider: string, account_id: string): { user_id: bigint; linked_at: bigint } | null {
  const rows = db.query('SELECT user_id, linked_at FROM auth_social_link WHERE provider = $1 AND provider_account_id = $2', [provider, account_id]);
  const row = rows[0];
  return row === undefined ? null : { user_id: big(row, 'user_id'), linked_at: big(row, 'linked_at') };
}

/** Inserts a link unless a row of the same social account is there. */
export function insert_social_link(db: DbHandle, user_id: bigint, provider: string, account_id: string, linked_at: bigint): void {
  db.query('INSERT INTO auth_social_link (user_id, provider, provider_account_id, linked_at) VALUES ($1, $2, $3, $4) ON CONFLICT (provider, provider_account_id) DO NOTHING', [
    user_id,
    provider,
    account_id,
    linked_at,
  ]);
}

/** Providers linked to the user, as element names. */
export function linked_providers(db: DbHandle, user_id: bigint): string[] {
  const rows = db.query('SELECT provider FROM auth_social_link WHERE user_id = $1 ORDER BY provider', [user_id]);
  return rows.map((row) => str(row, 'provider'));
}

export function has_social_link(db: DbHandle, user_id: bigint): boolean {
  const rows = db.query('SELECT 1 AS one FROM auth_social_link WHERE user_id = $1 LIMIT 1', [user_id]);
  return rows.length > 0;
}

// terms

export function insert_agreement(db: DbHandle, user_id: bigint, item: string, version: number, agreed_at: bigint): void {
  db.query('INSERT INTO auth_terms_agreement (user_id, item, version, agreed_at) VALUES ($1, $2, $3, $4) ON CONFLICT (user_id, item, version) DO NOTHING', [user_id, item, version, agreed_at]);
}

export function has_agreement(db: DbHandle, user_id: bigint, item: string, version: number): boolean {
  const rows = db.query('SELECT 1 AS one FROM auth_terms_agreement WHERE user_id = $1 AND item = $2 AND version = $3', [user_id, item, version]);
  return rows.length > 0;
}

// age and consent

export function birth_year_month(db: DbHandle, user_id: bigint): number | null {
  const rows = db.query('SELECT birth_year_month FROM auth_age WHERE user_id = $1', [user_id]);
  return rows[0] === undefined ? null : int(rows[0], 'birth_year_month');
}

export function insert_age(db: DbHandle, user_id: bigint, value: number, confirmed_at: bigint): void {
  db.query('INSERT INTO auth_age (user_id, birth_year_month, confirmed_at) VALUES ($1, $2, $3)', [user_id, value, confirmed_at]);
}

export interface ConsentRecord {
  readonly purpose: 'ad_personalization' | 'analytics' | 'tracking' | 'push_ad' | 'push_night';
  readonly value: string;
  readonly version: number;
}

/** Appends records in order: `seq` is the user's largest `seq` + 1. */
export function append_consent_records(db: DbHandle, user_id: bigint, records: readonly ConsentRecord[], recorded_at: bigint): void {
  if (records.length === 0) return;
  const rows = db.query('SELECT MAX(seq) AS seq FROM auth_consent_record WHERE user_id = $1', [user_id]);
  const last = rows[0]?.seq;
  let seq = last === null || last === undefined ? 0n : big(rows[0] as SqlRow, 'seq');
  for (const record of records) {
    seq += 1n;
    db.query('INSERT INTO auth_consent_record (user_id, seq, purpose, value, version, recorded_at) VALUES ($1, $2, $3, $4, $5, $6)', [
      user_id,
      seq,
      record.purpose,
      record.value,
      record.version,
      recorded_at,
    ]);
  }
}

// Apple refresh token

export function upsert_apple_token(db: DbHandle, user_id: bigint, refresh_token: string, updated_at: bigint): void {
  db.query(
    'INSERT INTO auth_apple_token (user_id, refresh_token, updated_at) VALUES ($1, $2, $3) ON CONFLICT (user_id) DO UPDATE SET refresh_token = excluded.refresh_token, updated_at = excluded.updated_at',
    [user_id, refresh_token, updated_at],
  );
}

export function apple_token(db: DbHandle, user_id: bigint): string | null {
  const rows = db.query('SELECT refresh_token FROM auth_apple_token WHERE user_id = $1', [user_id]);
  return rows[0] === undefined ? null : str(rows[0], 'refresh_token');
}

// deletion code

export function upsert_deletion_code(db: DbHandle, user_id: bigint, code_hash: string, expires_at: bigint): void {
  db.query(
    'INSERT INTO auth_deletion_code (user_id, code_hash, attempts, expires_at) VALUES ($1, $2, 0, $3) ON CONFLICT (user_id) DO UPDATE SET code_hash = excluded.code_hash, attempts = 0, expires_at = excluded.expires_at',
    [user_id, code_hash, expires_at],
  );
}

export function find_deletion_code(db: DbHandle, user_id: bigint): { code_hash: string; attempts: number; expires_at: bigint } | null {
  const rows = db.query('SELECT code_hash, attempts, expires_at FROM auth_deletion_code WHERE user_id = $1', [user_id]);
  const row = rows[0];
  return row === undefined ? null : { code_hash: str(row, 'code_hash'), attempts: int(row, 'attempts'), expires_at: big(row, 'expires_at') };
}

/** Adds one to `attempts` and returns the new value. */
export function count_deletion_attempt(db: DbHandle, user_id: bigint): number {
  const rows = db.query('UPDATE auth_deletion_code SET attempts = attempts + 1 WHERE user_id = $1 RETURNING attempts', [user_id]);
  return rows[0] === undefined ? 0 : int(rows[0], 'attempts');
}

export function delete_deletion_code(db: DbHandle, user_id: bigint): void {
  db.query('DELETE FROM auth_deletion_code WHERE user_id = $1', [user_id]);
}

/** Adds one to the IP counter of a minute window and returns the new count. */
export function count_deletion_ip(db: DbHandle, ip: string, window_start: bigint, expires_at: bigint): bigint {
  const rows = db.query(
    'INSERT INTO auth_deletion_ip_counter (ip, window_start, count, expires_at) VALUES ($1, $2, 1, $3) ON CONFLICT (ip, window_start) DO UPDATE SET count = auth_deletion_ip_counter.count + 1 RETURNING count',
    [ip, window_start, expires_at],
  );
  return rows[0] === undefined ? 0n : big(rows[0], 'count');
}

// dev account

export function find_dev_account(db: DbHandle, name: string): bigint | null {
  const rows = db.query('SELECT user_id FROM auth_dev_account WHERE name = $1', [name]);
  return rows[0] === undefined ? null : big(rows[0], 'user_id');
}

export function insert_dev_account(db: DbHandle, user_id: bigint, name: string): void {
  db.query('INSERT INTO auth_dev_account (user_id, name) VALUES ($1, $2) ON CONFLICT (name) DO NOTHING', [user_id, name]);
}
