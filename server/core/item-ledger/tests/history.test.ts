import { index_name } from '../../storage/schema.ts';
import { HISTORY_TABLE, HISTORY_TIME_INDEX } from '../history.ts';
import { DB_KIND, advance_time, history, id, items, start, stop, tx, user, wait_background, type Env } from './helpers.ts';

const RETENTION = 3_600_000;

let env: Env;

beforeAll(async () => {
  env = await start({ settings: { 'item-ledger.historyRetentionMs': RETENTION } });
});

afterAll(() => {
  stop();
});

/** The committed history rows and `once_key` rows of the user, expired or not. */
function stored(user_id: bigint): number[] {
  const db = env.storage.read_db();
  return ['item_ledger_history', 'item_ledger_once_key'].map((table) => db.query(`SELECT 1 AS found FROM ${table} WHERE user_id = $1`, [user_id]).length);
}

/** The columns of an index of the DB, in index order. */
function index_columns(name: string): string[] {
  const db = env.storage.read_db();
  if (DB_KIND === 'sqlite') return db.query('SELECT name FROM pragma_index_info($1) ORDER BY seqno', [name]).map((r) => String(r.name));
  return db
    .query(
      'SELECT a.attname AS name FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey) ' +
        'WHERE c.relname = $1 ORDER BY array_position(i.indkey::int2[], a.attnum)',
      [name],
    )
    .map((r) => String(r.name));
}

describe('history', () => {
  test('the history table has the index (user_id, time) that list_history reads its time range by', () => {
    expect(HISTORY_TIME_INDEX).toEqual(['user_id', 'time']);
    expect(index_columns(index_name(HISTORY_TABLE, ['user_id', 'time']))).toEqual(['user_id', 'time']);
  });

  test('history and once_key rows past item-ledger.historyRetentionMs are removed', async () => {
    const { user_id } = await user(env);
    expect(await tx(env, user_id, (ctx) => env.ledger.add_items(ctx, items(['[gold]', 1]), { once_key: 'h:1' }))).toBe('OK');
    expect(history(env, user_id).length).toBe(1);
    advance_time(env, BigInt(RETENTION - 1));
    await wait_background(env);
    expect(history(env, user_id).length).toBe(1);
    expect(await tx(env, user_id, (ctx) => env.ledger.add_items(ctx, items(['[gold]', 1]), { once_key: 'h:1' }))).toBe('ALREADY_APPLIED');
    // Past the retention: the rows count as absent before the expiry sweep, and the sweep (`routing`'s job
    // `storage_sweep`) deletes them.
    advance_time(env, 1n);
    expect(history(env, user_id)).toEqual([]);
    expect(stored(user_id)).toEqual([1, 1]);
    expect((await env.storage.sweep_expired()).deleted).toBeGreaterThanOrEqual(2);
    expect(stored(user_id)).toEqual([0, 0]);
    expect(await tx(env, user_id, (ctx) => env.ledger.add_items(ctx, items(['[gold]', 1]), { once_key: 'h:1' }))).toBe('OK');
    expect(history(env, user_id).map((h) => h.seq)).toEqual([1n]);
  });

  test('list_history gives the rows in the time range in seq order; a cursor of the last seq continues past rows of the same time', async () => {
    const { user_id } = await user(env);
    const t0 = await tx(env, user_id, (ctx) => {
      for (let i = 0; i < 4; i += 1) env.ledger.add_items(ctx, items(['[gold]', 1], ['[potion]', 1]));
      return ctx.request_time;
    });
    advance_time(env, 1000n);
    await tx(env, user_id, (ctx) => env.ledger.add_items(ctx, items(['[ticket]', 1])));
    const all = env.module.list_history(user_id, 0n, 2n ** 62n, 0n, 100);
    expect(all.map((h) => h.seq)).toEqual([1n, 2n, 3n, 4n, 5n, 6n, 7n, 8n, 9n]);
    expect(all.slice(0, 8).every((h) => h.time === t0)).toBe(true);
    // Pages of 3 over rows that share one time.
    const seen: bigint[] = [];
    let cursor = 0n;
    for (let page = 0; page < 10; page += 1) {
      const rows = env.module.list_history(user_id, t0, t0 + 1n, cursor, 3);
      if (rows.length === 0) break;
      seen.push(...rows.map((h) => h.seq));
      cursor = rows.at(-1)?.seq ?? cursor;
    }
    expect(seen).toEqual([1n, 2n, 3n, 4n, 5n, 6n, 7n, 8n]);
    // The end time is not in the range.
    expect(env.module.list_history(user_id, t0 + 1000n, t0 + 1001n, 0n, 100).map((h) => h.item_id)).toEqual([id('[ticket]')]);
    expect(env.module.list_history(user_id, t0, t0 + 1000n, 0n, 100).length).toBe(8);
    expect(env.module.list_history(user_id + 1000n, 0n, 2n ** 62n, 0n, 100)).toEqual([]);
  });
});
