import { DB_KIND, instance, stop_all } from '../../storage/tests/helpers.ts';
import { index_name } from '../../storage/schema.ts';
import { DbHandle } from '../../storage/core.ts';
import type { Storage } from '../../storage/index.ts';
import { RECORD_BANNER_INDEX, RECORD_TABLE, RECORD_TIME_INDEX, list_latest, register_record_table } from '../records.ts';

afterEach(() => {
  stop_all();
});

function index_columns(storage: Storage, name: string): string[] {
  const db = storage.read_db();
  if (DB_KIND === 'sqlite') return db.query('SELECT name FROM pragma_index_info($1) ORDER BY seqno', [name]).map((r) => String(r.name));
  return db
    .query(
      'SELECT a.attname AS name FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey) ' +
        'WHERE c.relname = $1 ORDER BY array_position(i.indkey::int2[], a.attnum)',
      [name],
    )
    .map((r) => String(r.name));
}

/** The SQLite query plan details of the statements a function sends. */
function plan_of(storage: Storage, fn: (db: DbHandle) => void): string[] {
  const db = storage.read_db();
  const details: string[] = [];
  fn(
    new DbHandle(null, (sql, parameters) => {
      details.push(...db.query(`EXPLAIN QUERY PLAN ${sql}`, parameters).map((r) => String(r.detail)));
      return [];
    }),
  );
  return details;
}

describe('gacha draw record table', () => {
  it('has the indexes (user_id, banner_id, draw_seq) and (user_id, drawn_at); ListGachaHistory of one banner reads by the first', async () => {
    const { storage } = await instance({
      register: (s) => {
        register_record_table(s);
      },
    });
    expect(RECORD_BANNER_INDEX).toEqual(['user_id', 'banner_id', 'draw_seq']);
    expect(RECORD_TIME_INDEX).toEqual(['user_id', 'drawn_at']);
    const banner = index_name(RECORD_TABLE, ['user_id', 'banner_id', 'draw_seq']);
    const time = index_name(RECORD_TABLE, ['user_id', 'drawn_at']);
    expect(index_columns(storage, banner)).toEqual(['user_id', 'banner_id', 'draw_seq']);
    expect(index_columns(storage, time)).toEqual(['user_id', 'drawn_at']);
    if (DB_KIND === 'sqlite') {
      for (const cursor of [0n, 5n]) {
        const plan = plan_of(storage, (db) => list_latest(db, 1n, 0n, 7, cursor, 10));
        expect(plan.some((d) => d.includes(banner))).toBe(true);
      }
    }
  });
});
