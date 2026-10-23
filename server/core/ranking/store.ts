/** The five `ranking` tables (`## behavior` table) and the parameter SQL on them. */
import type { DbHandle } from '../storage/index.ts';
import type { RankingStorage } from './deps.ts';

export const SCORE_TABLE = 'ranking_score';
export const SEASON_TABLE = 'ranking_season';
export const SHIFT_TABLE = 'ranking_season_shift';
export const GUILD_SCORE_TABLE = 'ranking_guild_score';
export const RETRY_TABLE = 'ranking_reward_retry';

export type SeasonStatus = 'Open' | 'Closing' | 'Retrying' | 'Closed';

/** Registers the five tables (`storage.register_table`). */
export function register_tables(storage: RankingStorage): void {
  storage.register_table(
    SCORE_TABLE,
    'game',
    [
      { name: 'board_id', type: 'int32' },
      { name: 'season', type: 'int64' },
      { name: 'user_id', type: 'int64' },
      { name: 'score', type: 'int64' },
      { name: 'reached_at', type: 'int64' },
      { name: 'display', type: 'string' },
    ],
    ['board_id', 'season', 'user_id'],
    null,
    null,
    'user_id',
    [
      ['board_id', 'season', 'score', 'reached_at', 'user_id'],
      ['user_id'],
    ],
  );
  storage.register_table(
    SEASON_TABLE,
    'game',
    [
      { name: 'board_id', type: 'int32' },
      { name: 'season', type: 'int64' },
      { name: 'status', type: 'string' },
      { name: 'end_at', type: 'int64' },
      { name: 'cursor_score', type: 'int64?' },
      { name: 'cursor_reached_at', type: 'int64?' },
      { name: 'cursor_entity_id', type: 'int64?' },
      { name: 'cursor_rank', type: 'int32' },
      { name: 'failed_count', type: 'int64' },
      { name: 'lease_owner', type: 'string' },
      { name: 'lease_until_at', type: 'int64' },
    ],
    ['board_id', 'season'],
    null,
    null,
    null,
    [['status', 'end_at']],
  );
  storage.register_table(
    SHIFT_TABLE,
    'game',
    [
      { name: 'board_id', type: 'int32' },
      { name: 'shift', type: 'int64' },
    ],
    ['board_id'],
    null,
    null,
  );
  storage.register_table(
    GUILD_SCORE_TABLE,
    'game',
    [
      { name: 'board_id', type: 'int32' },
      { name: 'season', type: 'int64' },
      { name: 'guild_id', type: 'int64' },
      { name: 'score', type: 'int64' },
      { name: 'reached_at', type: 'int64' },
    ],
    ['board_id', 'season', 'guild_id'],
    null,
    null,
    null,
    [
      ['board_id', 'season', 'score', 'reached_at', 'guild_id'],
      ['guild_id'],
    ],
  );
  storage.register_table(
    RETRY_TABLE,
    'game',
    [
      { name: 'board_id', type: 'int32' },
      { name: 'season', type: 'int64' },
      { name: 'user_id', type: 'int64' },
      { name: 'entry', type: 'bytes' },
      { name: 'attempts', type: 'int32' },
      { name: 'next_attempt_at', type: 'int64' },
    ],
    ['board_id', 'season', 'user_id'],
    null,
    null,
    'user_id',
    [['user_id']],
  );
}

function int64(value: unknown): bigint {
  if (typeof value === 'bigint') return value;
  if (typeof value === 'number') return BigInt(value);
  throw new TypeError(`ranking: ${String(value)} is not an int64 column value`);
}

function int32(value: unknown): number {
  if (typeof value === 'number') return value;
  if (typeof value === 'bigint') return Number(value);
  throw new TypeError(`ranking: ${String(value)} is not an int32 column value`);
}

function nullable_int64(value: unknown): bigint | null {
  return value === null ? null : int64(value);
}

// ---- season shift and season rows ----

export function read_shift(db: DbHandle, board_id: number): bigint {
  const row = db.query(`SELECT shift FROM ${SHIFT_TABLE} WHERE board_id = $1`, [board_id])[0];
  return row === undefined ? 0n : int64(row.shift);
}

export function bump_shift(db: DbHandle, board_id: number): void {
  db.query(`INSERT INTO ${SHIFT_TABLE} (board_id, shift) VALUES ($1, 1) ON CONFLICT (board_id) DO UPDATE SET shift = ${SHIFT_TABLE}.shift + 1`, [board_id]);
}

export function read_season_end(db: DbHandle, board_id: number, season: bigint): bigint | null {
  const row = db.query(`SELECT end_at FROM ${SEASON_TABLE} WHERE board_id = $1 AND season = $2`, [board_id, season])[0];
  return row === undefined ? null : int64(row.end_at);
}

/** Puts the `Open` row of a season; a key conflict writes nothing. */
export function insert_open_season(db: DbHandle, board_id: number, season: bigint, end_at: bigint): void {
  db.query(
    `INSERT INTO ${SEASON_TABLE} (board_id, season, status, end_at, cursor_score, cursor_reached_at, cursor_entity_id, cursor_rank, failed_count, lease_owner, lease_until_at) ` +
      `VALUES ($1, $2, 'Open', $3, NULL, NULL, NULL, 0, 0, '', 0) ON CONFLICT (board_id, season) DO NOTHING`,
    [board_id, season, end_at],
  );
}

/** Puts or changes a season row to `Closing` with a lease held by `owner` (`close_season_now`). */
export function close_season_row(db: DbHandle, board_id: number, season: bigint, end_at: bigint, owner: string, lease_until_at: bigint): void {
  db.query(
    `INSERT INTO ${SEASON_TABLE} (board_id, season, status, end_at, cursor_score, cursor_reached_at, cursor_entity_id, cursor_rank, failed_count, lease_owner, lease_until_at) ` +
      `VALUES ($1, $2, 'Closing', $3, NULL, NULL, NULL, 0, 0, $4, $5) ON CONFLICT (board_id, season) DO UPDATE SET ` +
      `status = 'Closing', end_at = $3, lease_owner = $4, lease_until_at = $5`,
    [board_id, season, end_at, owner, lease_until_at],
  );
}

// ---- score rows ----

/** One score row: `entity_id` is the user ID (user board) or the guild ID (guild board). */
export interface ScoreRow {
  readonly entity_id: bigint;
  readonly score: bigint;
  readonly reached_at: bigint;
  /** Empty for a guild board. */
  readonly display: string;
}

/** Where the score rows of a board are. */
export interface ScoreSource {
  readonly guild: boolean;
  readonly desc: boolean;
}

function table_of(source: ScoreSource): string {
  return source.guild ? GUILD_SCORE_TABLE : SCORE_TABLE;
}

function entity_of(source: ScoreSource): string {
  return source.guild ? 'guild_id' : 'user_id';
}

function columns_of(source: ScoreSource): string {
  return source.guild ? 'guild_id AS entity_id, score, reached_at' : 'user_id AS entity_id, score, reached_at, display';
}

/** The rank order: score, then the earlier reached time, then the smaller entity ID. */
function order_of(source: ScoreSource): string {
  return `score ${source.desc ? 'DESC' : 'ASC'}, reached_at ASC, ${entity_of(source)} ASC`;
}

/** Rows strictly ahead of the row `($s, $r, $e)` in the rank order (`after` false), or strictly after it. */
function beyond(source: ScoreSource, after: boolean, s: number): string {
  const better = source.desc !== after ? '>' : '<';
  const later = after ? '>' : '<';
  const e = entity_of(source);
  return `(score ${better} $${String(s)} OR (score = $${String(s)} AND (reached_at ${later} $${String(s + 1)} OR (reached_at = $${String(s + 1)} AND ${e} ${later} $${String(s + 2)}))))`;
}

function score_row(row: Record<string, unknown>): ScoreRow {
  return {
    entity_id: int64(row.entity_id),
    score: int64(row.score),
    reached_at: int64(row.reached_at),
    display: typeof row.display === 'string' ? row.display : '',
  };
}

export function read_score(db: DbHandle, source: ScoreSource, board_id: number, season: bigint, entity_id: bigint): ScoreRow | null {
  const row = db.query(
    `SELECT ${columns_of(source)} FROM ${table_of(source)} WHERE board_id = $1 AND season = $2 AND ${entity_of(source)} = $3`,
    [board_id, season, entity_id],
  )[0];
  return row === undefined ? null : score_row(row);
}

/** Writes the score row of a user (with its display) or a guild. */
export function write_score(db: DbHandle, source: ScoreSource, board_id: number, season: bigint, row: ScoreRow): void {
  if (source.guild) {
    db.query(
      `INSERT INTO ${GUILD_SCORE_TABLE} (board_id, season, guild_id, score, reached_at) VALUES ($1, $2, $3, $4, $5) ` +
        'ON CONFLICT (board_id, season, guild_id) DO UPDATE SET score = $4, reached_at = $5',
      [board_id, season, row.entity_id, row.score, row.reached_at],
    );
    return;
  }
  db.query(
    `INSERT INTO ${SCORE_TABLE} (board_id, season, user_id, score, reached_at, display) VALUES ($1, $2, $3, $4, $5, $6) ` +
      'ON CONFLICT (board_id, season, user_id) DO UPDATE SET score = $4, reached_at = $5, display = $6',
    [board_id, season, row.entity_id, row.score, row.reached_at, row.display],
  );
}

export function write_display(db: DbHandle, board_id: number, season: bigint, user_id: bigint, display: string): void {
  db.query(`UPDATE ${SCORE_TABLE} SET display = $4 WHERE board_id = $1 AND season = $2 AND user_id = $3`, [board_id, season, user_id, display]);
}

/** Rows of rank `offset` + 1 up to `offset` + `limit`, in rank order. */
export function read_page(db: DbHandle, source: ScoreSource, board_id: number, season: bigint, offset: number, limit: number): ScoreRow[] {
  if (limit <= 0) return [];
  return db
    .query(
      `SELECT ${columns_of(source)} FROM ${table_of(source)} WHERE board_id = $1 AND season = $2 ORDER BY ${order_of(source)} LIMIT $3 OFFSET $4`,
      [board_id, season, limit, offset],
    )
    .map(score_row);
}

/** How many rows are ahead of `row` in rank order, counting at most `limit` of them. Its rank is this + 1 below `limit`. */
export function count_ahead(db: DbHandle, source: ScoreSource, board_id: number, season: bigint, row: ScoreRow, limit: number): bigint {
  const result = db.query(
    `SELECT COUNT(*) AS n FROM (SELECT 1 FROM ${table_of(source)} WHERE board_id = $1 AND season = $2 AND ${beyond(source, false, 3)} LIMIT $6) AS ahead`,
    [board_id, season, row.score, row.reached_at, row.entity_id, limit],
  )[0];
  return result === undefined ? 0n : int64(result.n);
}

/** Up to `limit` rows after the cursor in rank order; from the first row when the cursor is null. */
export function read_after(db: DbHandle, source: ScoreSource, board_id: number, season: bigint, cursor: ScoreRow | null, limit: number): ScoreRow[] {
  const select = `SELECT ${columns_of(source)} FROM ${table_of(source)} WHERE board_id = $1 AND season = $2`;
  if (cursor === null) return db.query(`${select} ORDER BY ${order_of(source)} LIMIT $3`, [board_id, season, limit]).map(score_row);
  return db
    .query(`${select} AND ${beyond(source, true, 3)} ORDER BY ${order_of(source)} LIMIT $6`, [
      board_id,
      season,
      cursor.score,
      cursor.reached_at,
      cursor.entity_id,
      limit,
    ])
    .map(score_row);
}

/** `remove_user`: the user's score rows and retry rows of every board and season. */
export function delete_user_rows(db: DbHandle, user_id: bigint): void {
  db.query(`DELETE FROM ${SCORE_TABLE} WHERE user_id = $1`, [user_id]);
  db.query(`DELETE FROM ${RETRY_TABLE} WHERE user_id = $1`, [user_id]);
}

/** Guild disband: the guild's `ranking_guild_score` rows of every board and season. */
export function delete_guild_rows(db: DbHandle, guild_id: bigint): void {
  db.query(`DELETE FROM ${GUILD_SCORE_TABLE} WHERE guild_id = $1`, [guild_id]);
}

// ---- season job ----

/** A `ranking_season` row. */
export interface SeasonRow {
  readonly board_id: number;
  readonly season: bigint;
  readonly status: SeasonStatus;
  readonly end_at: bigint;
  readonly cursor: ScoreRow | null;
  readonly cursor_rank: number;
  readonly failed_count: bigint;
  readonly lease_owner: string;
  readonly lease_until_at: bigint;
}

const SEASON_COLUMNS = 'board_id, season, status, end_at, cursor_score, cursor_reached_at, cursor_entity_id, cursor_rank, failed_count, lease_owner, lease_until_at';

function season_row(row: Record<string, unknown>): SeasonRow {
  const score = nullable_int64(row.cursor_score);
  const reached_at = nullable_int64(row.cursor_reached_at);
  const entity_id = nullable_int64(row.cursor_entity_id);
  return {
    board_id: int32(row.board_id),
    season: int64(row.season),
    status: String(row.status) as SeasonStatus,
    end_at: int64(row.end_at),
    cursor: score === null || reached_at === null || entity_id === null ? null : { entity_id, score, reached_at, display: '' },
    cursor_rank: int32(row.cursor_rank),
    failed_count: int64(row.failed_count),
    lease_owner: String(row.lease_owner),
    lease_until_at: int64(row.lease_until_at),
  };
}

export function read_season(db: DbHandle, board_id: number, season: bigint): SeasonRow | null {
  const row = db.query(`SELECT ${SEASON_COLUMNS} FROM ${SEASON_TABLE} WHERE board_id = $1 AND season = $2`, [board_id, season])[0];
  return row === undefined ? null : season_row(row);
}

/** Seasons to process at `now`: `Open` past its end, `Closing` or `Retrying` past its lease. `(board_id, season)` order. */
export function read_due_seasons(db: DbHandle, now: bigint): SeasonRow[] {
  return db
    .query(
      `SELECT ${SEASON_COLUMNS} FROM ${SEASON_TABLE} WHERE (status = 'Open' AND end_at <= $1) OR (status IN ('Closing', 'Retrying') AND lease_until_at <= $1) ` +
        'ORDER BY board_id ASC, season ASC',
      [now],
    )
    .map(season_row);
}

/**
 * Takes the lease of a season only when its `lease_owner` and `lease_until_at` are still those read, and an `Open`
 * season becomes `Closing`. The row after the change, or null when the lease was not taken.
 */
export function take_lease(db: DbHandle, seen: SeasonRow, owner: string, lease_until_at: bigint): SeasonRow | null {
  const row = db.query(
    `UPDATE ${SEASON_TABLE} SET lease_owner = $5, lease_until_at = $6, status = CASE WHEN status = 'Open' THEN 'Closing' ELSE status END ` +
      `WHERE board_id = $1 AND season = $2 AND lease_owner = $3 AND lease_until_at = $4 AND status <> 'Closed' RETURNING ${SEASON_COLUMNS}`,
    [seen.board_id, seen.season, seen.lease_owner, seen.lease_until_at, owner, lease_until_at],
  )[0];
  return row === undefined ? null : season_row(row);
}

/** Extends the lease when `owner` still holds it. False when it does not. */
export function extend_lease(db: DbHandle, board_id: number, season: bigint, owner: string, lease_until_at: bigint): boolean {
  return db.query(`UPDATE ${SEASON_TABLE} SET lease_until_at = $4 WHERE board_id = $1 AND season = $2 AND lease_owner = $3 RETURNING season`, [board_id, season, owner, lease_until_at]).length > 0;
}

/** Moves the cursor past `row` at `rank` and adds to `failed_count`, when `owner` still holds the lease. */
export function advance_cursor(db: DbHandle, board_id: number, season: bigint, owner: string, row: ScoreRow, rank: number, failed: number, lease_until_at: bigint): boolean {
  return (
    db.query(
      `UPDATE ${SEASON_TABLE} SET cursor_score = $4, cursor_reached_at = $5, cursor_entity_id = $6, cursor_rank = $7, failed_count = failed_count + $8, lease_until_at = $9 ` +
        'WHERE board_id = $1 AND season = $2 AND lease_owner = $3 RETURNING season',
      [board_id, season, owner, row.score, row.reached_at, row.entity_id, rank, failed, lease_until_at],
    ).length > 0
  );
}

export function add_failed(db: DbHandle, board_id: number, season: bigint, owner: string, failed: number): void {
  db.query(`UPDATE ${SEASON_TABLE} SET failed_count = failed_count + $4 WHERE board_id = $1 AND season = $2 AND lease_owner = $3`, [board_id, season, owner, failed]);
}

/**
 * Ends a season's pass when `owner` holds the lease: `Closed` without retry rows, else `Retrying` with
 * `lease_until_at` 0. The row after the change, or null when the lease is not held.
 */
export function finish_pass(db: DbHandle, board_id: number, season: bigint, owner: string): SeasonRow | null {
  const status: SeasonStatus = count_retries(db, board_id, season) === 0n ? 'Closed' : 'Retrying';
  const reset = status === 'Retrying' ? ', lease_until_at = 0' : '';
  const row = db.query(`UPDATE ${SEASON_TABLE} SET status = $4${reset} WHERE board_id = $1 AND season = $2 AND lease_owner = $3 RETURNING ${SEASON_COLUMNS}`, [
    board_id,
    season,
    owner,
    status,
  ])[0];
  return row === undefined ? null : season_row(row);
}

export function close_season(db: DbHandle, board_id: number, season: bigint, owner: string): SeasonRow | null {
  const row = db.query(`UPDATE ${SEASON_TABLE} SET status = 'Closed' WHERE board_id = $1 AND season = $2 AND lease_owner = $3 RETURNING ${SEASON_COLUMNS}`, [
    board_id,
    season,
    owner,
  ])[0];
  return row === undefined ? null : season_row(row);
}

/** Closed seasons whose `end_at` is at or before `limit_at`. */
export function read_expired_seasons(db: DbHandle, limit_at: bigint): { board_id: number; season: bigint }[] {
  return db
    .query(`SELECT board_id, season FROM ${SEASON_TABLE} WHERE status = 'Closed' AND end_at <= $1 ORDER BY board_id ASC, season ASC`, [limit_at])
    .map((row) => ({ board_id: int32(row.board_id), season: int64(row.season) }));
}

/** Retention: the season's score rows of both entities, its retry rows and its `ranking_season` row. */
export function delete_season(db: DbHandle, board_id: number, season: bigint): void {
  for (const table of [SCORE_TABLE, GUILD_SCORE_TABLE, RETRY_TABLE, SEASON_TABLE]) {
    db.query(`DELETE FROM ${table} WHERE board_id = $1 AND season = $2`, [board_id, season]);
  }
}

// ---- retry rows ----

export interface RetryRow {
  readonly user_id: bigint;
  readonly entry: Uint8Array;
  readonly attempts: number;
}

/** Puts a retry row; a key conflict writes nothing. */
export function insert_retry(db: DbHandle, board_id: number, season: bigint, user_id: bigint, entry: Uint8Array, next_attempt_at: bigint): void {
  db.query(
    `INSERT INTO ${RETRY_TABLE} (board_id, season, user_id, entry, attempts, next_attempt_at) VALUES ($1, $2, $3, $4, 0, $5) ` +
      'ON CONFLICT (board_id, season, user_id) DO NOTHING',
    [board_id, season, user_id, entry, next_attempt_at],
  );
}

/** Retry rows due at `now`, `user_id` ascending. */
export function read_due_retries(db: DbHandle, board_id: number, season: bigint, now: bigint): RetryRow[] {
  return db
    .query(`SELECT user_id, entry, attempts FROM ${RETRY_TABLE} WHERE board_id = $1 AND season = $2 AND next_attempt_at <= $3 ORDER BY user_id ASC`, [board_id, season, now])
    .map((row) => ({ user_id: int64(row.user_id), entry: row.entry instanceof Uint8Array ? row.entry : new Uint8Array(), attempts: int32(row.attempts) }));
}

export function delete_retry(db: DbHandle, board_id: number, season: bigint, user_id: bigint): void {
  db.query(`DELETE FROM ${RETRY_TABLE} WHERE board_id = $1 AND season = $2 AND user_id = $3`, [board_id, season, user_id]);
}

export function update_retry(db: DbHandle, board_id: number, season: bigint, user_id: bigint, attempts: number, next_attempt_at: bigint): void {
  db.query(`UPDATE ${RETRY_TABLE} SET attempts = $4, next_attempt_at = $5 WHERE board_id = $1 AND season = $2 AND user_id = $3`, [
    board_id,
    season,
    user_id,
    attempts,
    next_attempt_at,
  ]);
}

export function count_retries(db: DbHandle, board_id: number, season: bigint): bigint {
  const row = db.query(`SELECT COUNT(*) AS n FROM ${RETRY_TABLE} WHERE board_id = $1 AND season = $2`, [board_id, season])[0];
  return row === undefined ? 0n : int64(row.n);
}
