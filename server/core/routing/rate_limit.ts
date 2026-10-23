/**
 * The user counter and the IP counter of `### rate limit`: table `routing_rate_counter`, one game transaction per
 * increment, counted per minute window of `clock_now`.
 */
import type { ColumnInput, ServerTimeModule, SqlHandle, StorageModule } from './module_api.ts';

export const RATE_COUNTER_TABLE = 'routing_rate_counter';

/** The columns of `routing_rate_counter`. */
export const RATE_COUNTER_COLUMNS: readonly ColumnInput[] = [
  { name: 'kind', type: 'string' },
  { name: 'target', type: 'string' },
  { name: 'window_start', type: 'int64' },
  { name: 'count', type: 'int64' },
  { name: 'expires_at', type: 'int64' },
];

/** Registers `routing_rate_counter` (`### rate limit`): scope `game`, key `(kind, target, window_start)`, expiry `expires_at`. */
export function register_rate_counter(storage: StorageModule): void {
  storage.register_table(RATE_COUNTER_TABLE, 'game', RATE_COUNTER_COLUMNS, ['kind', 'target', 'window_start'], 'expires_at', null);
}

const MINUTE_MS = 60000n;

// One statement: concurrent increments of the same row do not overwrite each other, and the count after the
// increment comes back from the same statement.
const INCREMENT_SQL =
  'INSERT INTO routing_rate_counter (kind, target, window_start, count, expires_at) VALUES ($1, $2, $3, 1, $4) ' +
  'ON CONFLICT (kind, target, window_start) DO UPDATE SET count = routing_rate_counter.count + 1 RETURNING count';

export type CounterKind = 'user' | 'ip';

/** Adds one to the counter of the target in this minute window and returns the count after it, or `FAILED`. */
export function increment_counter(storage: StorageModule, server_time: ServerTimeModule, kind: CounterKind, target: string): Promise<bigint | 'FAILED'> {
  const window_start = server_time.get_window_start(MINUTE_MS, server_time.clock_now());
  return storage.run_game_transaction((tx) => {
    const rows = (storage.db(tx) as SqlHandle).query(INCREMENT_SQL, [kind, target, window_start, window_start + MINUTE_MS]);
    const count = rows[0]?.count;
    return typeof count === 'bigint' ? count : BigInt(count as number);
  });
}
