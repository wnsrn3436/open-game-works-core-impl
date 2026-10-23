/**
 * The module tables of `ads-reward` (`### table`): `ads_reward_ticket` and `ads_reward_ip_counter`.
 */
import * as CoreContract from '../../generated/contract/core_contract.ts';
import type { DbHandle } from '../storage/index.ts';
import type { AdsRewardStorage } from './deps.ts';

export const TICKET_TABLE = 'ads_reward_ticket';
export const IP_COUNTER_TABLE = 'ads_reward_ip_counter';

export type StoredState = 'Issued' | 'Claimed' | 'Granted' | 'Failed' | 'Replaced';
/** `Expired` is never stored: a ticket whose `expires_at` is reached is `Expired` whatever its `state`. */
export type TicketState = StoredState | 'Expired';

export interface Ticket {
  readonly placement_id: number;
  readonly state: TicketState;
  /** The granted list. */
  readonly items: CoreContract.ItemAmount[];
}

/** Registers both tables (`begin_start`). */
export function register_tables(storage: AdsRewardStorage): void {
  storage.register_table(
    TICKET_TABLE,
    'user',
    [
      { name: 'user_id', type: 'int64' },
      { name: 'notify_id', type: 'string' },
      { name: 'placement_id', type: 'int32' },
      { name: 'state', type: 'string' },
      { name: 'items', type: 'bytes' },
      { name: 'created_at', type: 'int64' },
      { name: 'expires_at', type: 'int64' },
    ],
    ['user_id', 'notify_id'],
    'expires_at',
    false,
    null,
    // `REPLACE` and `CLAIMED` select by (user ID, placement ID, state), which the key prefix cannot select.
    [['user_id', 'placement_id', 'state']],
  );
  storage.register_table(
    IP_COUNTER_TABLE,
    'game',
    [
      { name: 'ip', type: 'string' },
      { name: 'window_start', type: 'int64' },
      { name: 'count', type: 'int64' },
      { name: 'expires_at', type: 'int64' },
    ],
    ['ip', 'window_start'],
    'expires_at',
    null,
  );
}

const READ = `SELECT placement_id, state, items, expires_at FROM ${TICKET_TABLE} WHERE user_id = $1 AND notify_id = $2`;
const INSERT =
  `INSERT INTO ${TICKET_TABLE} (user_id, notify_id, placement_id, state, items, created_at, expires_at) ` +
  'VALUES ($1, $2, $3, $4, $5, $6, $7)';
const REPLACE = `UPDATE ${TICKET_TABLE} SET state = $3 WHERE user_id = $1 AND placement_id = $2 AND state = $4`;
const CLAIMED = `SELECT notify_id FROM ${TICKET_TABLE} WHERE user_id = $1 AND placement_id = $2 AND state = $3 AND expires_at > $4`;
const SET_STATE = `UPDATE ${TICKET_TABLE} SET state = $3, items = $4 WHERE user_id = $1 AND notify_id = $2`;
const CLAIM = `UPDATE ${TICKET_TABLE} SET state = $3 WHERE user_id = $1 AND notify_id = $2 AND state = $4 AND expires_at > $5`;

const STORED: ReadonlySet<string> = new Set<StoredState>(['Issued', 'Claimed', 'Granted', 'Failed', 'Replaced']);

export function encode_items(items: readonly CoreContract.ItemAmount[]): Uint8Array {
  const list = new CoreContract.ClaimAdRewardResponse();
  list.items = [...items];
  return list.encode();
}

function decode_items(bytes: unknown): CoreContract.ItemAmount[] {
  if (!(bytes instanceof Uint8Array)) throw new TypeError(`ads-reward: ${TICKET_TABLE}.items is not bytes`);
  const list = CoreContract.ClaimAdRewardResponse.decode(bytes);
  if (list === null) throw new TypeError(`ads-reward: ${TICKET_TABLE}.items does not decode`);
  return list.items;
}

/** The ticket of (user ID, reward notify ID), or null. `now` is `server-time.clock_now`. */
export function read_ticket(db: DbHandle, user_id: bigint, notify_id: string, now: bigint): Ticket | null {
  const row = db.query(READ, [user_id, notify_id])[0];
  if (row === undefined) return null;
  const state = String(row.state);
  if (!STORED.has(state)) throw new TypeError(`ads-reward: ${TICKET_TABLE}.state ${state} is not a ticket state`);
  const expires_at = row.expires_at as bigint;
  return {
    placement_id: Number(row.placement_id),
    state: expires_at <= now ? 'Expired' : (state as StoredState),
    items: decode_items(row.items),
  };
}

/** `BeginAdReward` 4: replaces the user's `Issued` ticket of the placement and writes a new `Issued` ticket. */
export function issue_ticket(db: DbHandle, user_id: bigint, notify_id: string, placement_id: number, now: bigint, ttl_ms: bigint): void {
  db.query(REPLACE, [user_id, placement_id, 'Replaced', 'Issued']);
  db.query(INSERT, [user_id, notify_id, placement_id, 'Issued', encode_items([]), now, now + ttl_ms]);
}

/** The number of the user's `Claimed` tickets of the placement that have not expired. */
export function count_claimed(db: DbHandle, user_id: bigint, placement_id: number, now: bigint): number {
  return db.query(CLAIMED, [user_id, placement_id, 'Claimed', now]).length;
}

export function set_state(db: DbHandle, user_id: bigint, notify_id: string, state: StoredState, items: readonly CoreContract.ItemAmount[]): void {
  db.query(SET_STATE, [user_id, notify_id, state, encode_items(items)]);
}

/** `wait_ad_reward`: an `Issued` ticket that has not expired becomes `Claimed`. */
export function claim_ticket(db: DbHandle, user_id: bigint, notify_id: string, now: bigint): void {
  db.query(CLAIM, [user_id, notify_id, 'Claimed', 'Issued', now]);
}

const READ_COUNT = `SELECT count FROM ${IP_COUNTER_TABLE} WHERE ip = $1 AND window_start = $2 AND expires_at > $3`;
const BUMP_COUNT =
  `INSERT INTO ${IP_COUNTER_TABLE} (ip, window_start, count, expires_at) VALUES ($1, $2, 1, $3) ` +
  `ON CONFLICT (ip, window_start) DO UPDATE SET count = ${IP_COUNTER_TABLE}.count + 1 RETURNING count`;

/** The failed callback count of the IP in the minute window, 0 without a row. */
export function read_ip_count(db: DbHandle, ip: string, window_start: bigint, now: bigint): bigint {
  const row = db.query(READ_COUNT, [ip, window_start, now])[0];
  return row === undefined ? 0n : (row.count as bigint);
}

/** Adds 1 to the failed callback count of the IP in the minute window in one upsert. */
export function bump_ip_count(db: DbHandle, ip: string, window_start: bigint, window_end: bigint): void {
  db.query(BUMP_COUNT, [ip, window_start, window_end]);
}
