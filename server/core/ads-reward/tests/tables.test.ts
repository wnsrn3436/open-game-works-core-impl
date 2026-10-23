import { DB_KIND, instance, stop_all } from '../../storage/tests/helpers.ts';
import { index_name } from '../../storage/schema.ts';
import type { Storage } from '../../storage/index.ts';
import { register_tables, TICKET_TABLE } from '../tickets.ts';

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

describe('ads-reward tables', () => {
  it('give ads_reward_ticket the index (user_id, placement_id, state) that BeginAdReward replaces and counts tickets by', async () => {
    const { storage } = await instance({
      register: (s) => {
        register_tables(s);
      },
    });
    const name = index_name(TICKET_TABLE, ['user_id', 'placement_id', 'state']);
    expect(index_columns(storage, name)).toEqual(['user_id', 'placement_id', 'state']);
    if (DB_KIND === 'sqlite') {
      const plan = storage
        .read_db()
        .query(`EXPLAIN QUERY PLAN SELECT notify_id FROM ${TICKET_TABLE} WHERE user_id = $1 AND placement_id = $2 AND state = $3 AND expires_at > $4`, [1n, 2, 'Claimed', 0n])
        .map((r) => String(r.detail));
      expect(plan.some((d) => d.includes(name))).toBe(true);
    }
  });
});
