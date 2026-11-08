import { index_name } from '../../storage/schema.ts';
import type { RequestCtx } from '../../storage/index.ts';
import { HISTORY_SEQ_TABLE, HISTORY_TABLE, HISTORY_TIME_INDEX, ONCE_KEY_TABLE } from '../history.ts';
import { DB_KIND, advance_time, balance, history, id, items, request, start, stop, tx, user, type Env } from './helpers.ts';

const RETENTION = 3_600_000;

/** History kept for RETENTION, `once_key` for twice that. */
let env: Env;
/** `once_key` kept for RETENTION, history for twice that. */
let short_once: Env;

beforeAll(async () => {
  env = await start({ settings: { 'item-ledger.historyRetentionMs': RETENTION, 'item-ledger.onceKeyRetentionMs': 2 * RETENTION } });
  short_once = await start({ settings: { 'item-ledger.historyRetentionMs': 2 * RETENTION, 'item-ledger.onceKeyRetentionMs': RETENTION } });
});

afterAll(() => {
  stop();
});

function now(e: Env): bigint {
  return e.server.time.clock_now();
}

/** The committed rows of a table of the user, expired or not. */
function count(e: Env, table: string, user_id: bigint): number {
  return e.storage.read_db().query(`SELECT 1 AS found FROM ${table} WHERE user_id = $1`, [user_id]).length;
}

/** The committed history rows of the user, expired or not: `[seq, item_id, delta, expires_at]` in `seq` order. */
function raw_history(e: Env, user_id: bigint): [bigint, number, bigint, bigint][] {
  return e.storage
    .read_db()
    .query(`SELECT seq, item_id, delta, expires_at FROM ${HISTORY_TABLE} WHERE user_id = $1 ORDER BY seq ASC`, [user_id])
    .map((r) => [BigInt(r.seq as bigint), Number(r.item_id), BigInt(r.delta as bigint), BigInt(r.expires_at as bigint)]);
}

/** The `last_seq` of the user's history counter row; null when there is none. */
function counter(e: Env, user_id: bigint): bigint | null {
  const rows = e.storage.read_db().query(`SELECT last_seq FROM ${HISTORY_SEQ_TABLE} WHERE user_id = $1`, [user_id]);
  return rows.length === 0 ? null : BigInt(rows[0]?.last_seq as bigint);
}

/** Writes a history row of `seq` directly, as rows written before the history counter existed. */
function put_raw_history(ctx: RequestCtx, e: Env, seq: bigint, item: string, delta: bigint, expires_at: bigint): void {
  e.storage.db(ctx).query(
    `INSERT INTO ${HISTORY_TABLE} (user_id, seq, time, item_id, delta, balance_after, overflow, shortfall, source, ref, once_key, request_id, ends_at_after, ` +
      'big_delta, big_balance_after, big_overflow, big_shortfall, expires_at) VALUES ($1, $2, $3, $4, $5, $6, 0, 0, $7, $8, $9, NULL, 0, NULL, NULL, NULL, NULL, $10)',
    [ctx.user_id, seq, ctx.request_time, id(item), delta, delta, 'ITEM_CHANGE_SOURCE_REQUEST', 'old', '', expires_at],
  );
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

  test('a history row past historyRetentionMs is deleted by the expiry cleanup; its once_key is kept until onceKeyRetentionMs', async () => {
    const { user_id } = await user(env);
    expect(await tx(env, user_id, (ctx) => env.ledger.add_items(ctx, items(['[gold]', 1]), { once_key: 'h:1' }))).toBe('OK');
    expect(history(env, user_id).length).toBe(1);
    advance_time(env, BigInt(RETENTION - 1));
    await env.storage.sweep_expired();
    expect(history(env, user_id).length).toBe(1);
    // Past the history retention: the row counts as absent before the sweep, and the sweep deletes it.
    advance_time(env, 1n);
    expect(history(env, user_id)).toEqual([]);
    expect(count(env, HISTORY_TABLE, user_id)).toBe(1);
    await env.storage.sweep_expired();
    expect(count(env, HISTORY_TABLE, user_id)).toBe(0);
    // The once_key is still kept, also after the sweep.
    expect(count(env, ONCE_KEY_TABLE, user_id)).toBe(1);
    advance_time(env, BigInt(RETENTION - 1));
    await env.storage.sweep_expired();
    expect(await tx(env, user_id, (ctx) => env.ledger.add_items(ctx, items(['[gold]', 1]), { once_key: 'h:1' }))).toBe('ALREADY_APPLIED');
    expect(await balance(env, user_id, '[gold]')).toBe(1n);
    // Past the once_key retention: absent before the sweep, deleted by it.
    advance_time(env, 1n);
    expect(count(env, ONCE_KEY_TABLE, user_id)).toBe(1);
    await env.storage.sweep_expired();
    expect(count(env, ONCE_KEY_TABLE, user_id)).toBe(0);
    expect(await tx(env, user_id, (ctx) => env.ledger.add_items(ctx, items(['[gold]', 1]), { once_key: 'h:1' }))).toBe('OK');
    expect(await balance(env, user_id, '[gold]')).toBe(2n);
  });

  test('a once_key past onceKeyRetentionMs is deleted by the expiry cleanup; its history row is kept until historyRetentionMs', async () => {
    const e = short_once;
    const { user_id } = await user(e);
    expect(await tx(e, user_id, (ctx) => e.ledger.add_items(ctx, items(['[gold]', 1]), { once_key: 'h:2' }))).toBe('OK');
    advance_time(e, BigInt(RETENTION - 1));
    await e.storage.sweep_expired();
    expect(await tx(e, user_id, (ctx) => e.ledger.add_items(ctx, items(['[gold]', 1]), { once_key: 'h:2' }))).toBe('ALREADY_APPLIED');
    advance_time(e, 1n);
    expect(count(e, ONCE_KEY_TABLE, user_id)).toBe(1);
    await e.storage.sweep_expired();
    expect(count(e, ONCE_KEY_TABLE, user_id)).toBe(0);
    const first = history(e, user_id);
    expect(first.length).toBe(1);
    expect(await tx(e, user_id, (ctx) => e.ledger.add_items(ctx, items(['[gold]', 1]), { once_key: 'h:2' }))).toBe('OK');
    // The first history row is still there; it goes at historyRetentionMs from its write.
    advance_time(e, BigInt(RETENTION - 1));
    await e.storage.sweep_expired();
    expect(history(e, user_id).map((h) => h.seq)).toEqual([first[0]?.seq, (first[0]?.seq ?? 0n) + 1n]);
    advance_time(e, 1n);
    await e.storage.sweep_expired();
    expect(history(e, user_id).map((h) => h.seq)).toEqual([(first[0]?.seq ?? 0n) + 1n]);
    expect(count(e, HISTORY_TABLE, user_id)).toBe(1);
  });

  test('the first change of a new user gives its first history row seq clock_now + 1, and the next rows continue by 1', async () => {
    const { user_id } = await user(env);
    const t = now(env);
    expect(counter(env, user_id)).toBeNull();
    expect(await tx(env, user_id, (ctx) => env.ledger.add_items(ctx, items(['[gold]', 1], ['[potion]', 1])))).toBe('OK');
    expect(history(env, user_id).map((h) => h.seq)).toEqual([t + 1n, t + 2n]);
    expect(counter(env, user_id)).toBe(t + 2n);
    advance_time(env, 1000n);
    expect(await tx(env, user_id, (ctx) => env.ledger.add_items(ctx, items(['[ticket]', 1])))).toBe('OK');
    expect(history(env, user_id).map((h) => [h.seq, h.item_id])).toEqual([[t + 1n, id('[gold]')], [t + 2n, id('[potion]')], [t + 3n, id('[ticket]')]]);
    expect(counter(env, user_id)).toBe(t + 3n);
  });

  test('when every history row has expired and is not swept, seq continues after the largest; after the sweep it is one more than the largest', async () => {
    const { user_id } = await user(env);
    const t = now(env);
    expect(await tx(env, user_id, (ctx) => env.ledger.add_items(ctx, items(['[gold]', 1], ['[potion]', 1])))).toBe('OK');
    const before = raw_history(env, user_id);
    expect(before.map((r) => r[0])).toEqual([t + 1n, t + 2n]);
    advance_time(env, BigInt(RETENTION));
    expect(history(env, user_id)).toEqual([]);
    expect(await tx(env, user_id, (ctx) => env.ledger.add_items(ctx, items(['[ticket]', 1])))).toBe('OK');
    const after = raw_history(env, user_id);
    // The expired rows keep their values; the new row comes after them.
    expect(after.slice(0, 2)).toEqual(before);
    expect(after.map((r) => [r[0], r[1]])).toEqual([[t + 1n, id('[gold]')], [t + 2n, id('[potion]')], [t + 3n, id('[ticket]')]]);
    expect(history(env, user_id).map((h) => h.seq)).toEqual([t + 3n]);
    // The sweep deletes every row; the next row's seq is one more than the largest seq the user had.
    advance_time(env, BigInt(RETENTION));
    await env.storage.sweep_expired();
    expect(count(env, HISTORY_TABLE, user_id)).toBe(0);
    expect(await tx(env, user_id, (ctx) => env.ledger.add_items(ctx, items(['[gold]', 1])))).toBe('OK');
    expect(history(env, user_id).map((h) => h.seq)).toEqual([t + 4n]);
  });

  test('a user with history rows of seq below clock_now and no history counter row continues from clock_now + 1; the earlier rows keep their values', async () => {
    const { user_id } = await user(env);
    const old_expiry = now(env) + 10n;
    await tx(env, user_id, (ctx) => {
      put_raw_history(ctx, env, 1n, '[gold]', 5n, old_expiry);
      put_raw_history(ctx, env, 2n, '[potion]', 3n, now(env) + BigInt(RETENTION));
      return null;
    });
    advance_time(env, 10n);
    // Row 1 has expired and is not swept, row 2 has not.
    const before = raw_history(env, user_id);
    expect(counter(env, user_id)).toBeNull();
    const t = now(env);
    expect(await tx(env, user_id, (ctx) => env.ledger.add_items(ctx, items(['[ticket]', 1], ['[gold]', 1])))).toBe('OK');
    const after = raw_history(env, user_id);
    expect(after.slice(0, 2)).toEqual(before);
    expect(after.slice(2).map((r) => [r[0], r[1]])).toEqual([[t + 1n, id('[ticket]')], [t + 2n, id('[gold]')]]);
    expect(env.module.list_history(user_id, 0n, 2n ** 62n, 2n, 100).map((h) => [h.seq, h.item_id])).toEqual([[t + 1n, id('[ticket]')], [t + 2n, id('[gold]')]]);
    expect(counter(env, user_id)).toBe(t + 2n);
  });

  test('a history row with the key of the next row makes the request INTERNAL also when the handler caught the throw; nothing changes', async () => {
    const { user_id } = await user(env);
    const t = now(env);
    expect(await tx(env, user_id, (ctx) => env.ledger.add_items(ctx, items(['[gold]', 1])))).toBe('OK');
    expect(counter(env, user_id)).toBe(t + 1n);
    await tx(env, user_id, (ctx) => {
      put_raw_history(ctx, env, t + 2n, '[potion]', 7n, now(env) + BigInt(RETENTION));
      return null;
    });
    const rows = raw_history(env, user_id);
    let thrown = false;
    const sent = request(env, user_id, (ctx) => {
      try {
        env.ledger.add_items(ctx, items(['[gold]', 2]), { once_key: 'h:conflict' });
      } catch {
        thrown = true;
      }
      return 'handled';
    });
    await expect(sent).rejects.toThrow('run_request_transaction: FAILED');
    expect(thrown).toBe(true);
    expect(await balance(env, user_id, '[gold]')).toBe(1n);
    expect(raw_history(env, user_id)).toEqual(rows);
    expect(counter(env, user_id)).toBe(t + 1n);
    expect(count(env, ONCE_KEY_TABLE, user_id)).toBe(0);
  });

  test('list_history gives the rows in the time range in seq order; a cursor of the last seq continues past rows of the same time', async () => {
    const { user_id } = await user(env);
    const s = now(env);
    const t0 = await tx(env, user_id, (ctx) => {
      for (let i = 0; i < 4; i += 1) env.ledger.add_items(ctx, items(['[gold]', 1], ['[potion]', 1]));
      return ctx.request_time;
    });
    advance_time(env, 1000n);
    await tx(env, user_id, (ctx) => env.ledger.add_items(ctx, items(['[ticket]', 1])));
    const all = env.module.list_history(user_id, 0n, 2n ** 62n, 0n, 100);
    expect(all.map((h) => h.seq)).toEqual([1n, 2n, 3n, 4n, 5n, 6n, 7n, 8n, 9n].map((n) => s + n));
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
    expect(seen).toEqual([1n, 2n, 3n, 4n, 5n, 6n, 7n, 8n].map((n) => s + n));
    // The end time is not in the range.
    expect(env.module.list_history(user_id, t0 + 1000n, t0 + 1001n, 0n, 100).map((h) => h.item_id)).toEqual([id('[ticket]')]);
    expect(env.module.list_history(user_id, t0, t0 + 1000n, 0n, 100).length).toBe(8);
    expect(env.module.list_history(user_id + 1000n, 0n, 2n ** 62n, 0n, 100)).toEqual([]);
  });
});
