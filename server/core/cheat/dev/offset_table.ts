// The cheat time offset of each user: table `cheat_time_offset`.
import type { DbHandle, Storage } from './deps.ts';

export const OFFSET_TABLE = 'cheat_time_offset';

const MAX_TIME = 1n << 63n;

export function register_offset_table(storage: Storage): void {
  storage.register_table(
    OFFSET_TABLE,
    'user',
    [
      { name: 'user_id', type: 'int64' },
      { name: 'offset_ms', type: 'int64' },
    ],
    ['user_id'],
    null,
    false,
  );
}

/** The offset of a user. 0 without a row. */
export function read_offset(db: DbHandle, user_id: bigint): bigint {
  const value = db.query(`SELECT offset_ms FROM ${OFFSET_TABLE} WHERE user_id = $1`, [user_id])[0]?.['offset_ms'];
  if (value === undefined || value === null) return 0n;
  return typeof value === 'bigint' ? value : BigInt(value as number | string);
}

/** Replaces the offset of a user. */
export function write_offset(db: DbHandle, user_id: bigint, offset_ms: bigint): void {
  db.query(
    `INSERT INTO ${OFFSET_TABLE} (user_id, offset_ms) VALUES ($1, $2) ON CONFLICT (user_id) DO UPDATE SET offset_ms = excluded.offset_ms`,
    [user_id, offset_ms],
  );
}

/** `clock_now` + offset is a time: 0 or more and under 2^63. */
export function is_offset_in_range(clock_now: bigint, offset_ms: bigint): boolean {
  const at = clock_now + offset_ms;
  return at >= 0n && at < MAX_TIME;
}
