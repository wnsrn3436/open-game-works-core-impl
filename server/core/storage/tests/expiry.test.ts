import { start_test_server, stop_test_server } from '../../testing/dev/index.ts';
import type { Storage } from '../index.ts';
import { index_name, type TableDef } from '../schema.ts';
import { DB_KIND, instance, lock_holder, new_db, new_user, request, started, stop_all, storage_module, type DbTarget } from './helpers.ts';

/** Every table `register_table` accepted in this file, as `table_def` made it. */
const registered = vi.hoisted(() => [] as TableDef[]);

vi.mock('../schema.ts', async (original) => {
  const actual = await original<typeof import('../schema.ts')>();
  return {
    ...actual,
    table_def: (input: Parameters<typeof actual.table_def>[0]) => {
      const def = actual.table_def(input);
      if (typeof def !== 'string') registered.push(def);
      return def;
    },
  };
});

afterEach(() => {
  stop_all();
});


const EXPIRING = [
  { name: 'id', type: 'int64' },
  { name: 'kind', type: 'int64' },
  { name: 'at', type: 'int64' },
] as const;

function expiring_tables(indexes: readonly (readonly string[])[] | undefined): (s: Storage) => void {
  return (s) => {
    s.register_table('test_expiring', 'game', [...EXPIRING], ['id'], 'at', null, null, indexes);
    s.register_table('test_other', 'game', [...EXPIRING], ['id'], 'at', null);
  };
}

/** The first column of each index of the table (the primary key's left out). */
function leading_columns(storage: Storage, table: string): string[] {
  const db = storage.read_db();
  if (DB_KIND === 'sqlite') {
    const sql = `SELECT ii.name AS name FROM pragma_index_list($1) AS il, pragma_index_info(il.name) AS ii WHERE ii.seqno = 0 AND il.origin = 'c' ORDER BY ii.name`;
    return db.query(sql, [table]).map((r) => String(r.name));
  }
  const sql =
    'SELECT a.attname AS name FROM pg_index i JOIN pg_class t ON t.oid = i.indrelid JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = i.indkey[0] ' +
    'WHERE t.relname = $1 AND t.relnamespace = current_schema()::regnamespace AND NOT i.indisprimary ORDER BY a.attname';
  return db.query(sql, [table]).map((r) => String(r.name));
}

async function insert_rows(storage: Storage, table: string, rows: readonly (readonly [bigint, bigint])[]): Promise<void> {
  await storage.run_game_transaction((tx) => {
    for (const [id, at] of rows) storage.db(tx).query(`INSERT INTO ${table} (id, kind, at) VALUES ($1, 0, $2)`, [id, at]);
    return { inserted: true };
  });
}

async function with_instance<T>(db: DbTarget, register: (s: Storage) => void, fn: (storage: Storage) => Promise<T> | T): Promise<T> {
  const i = started({ db, register });
  try {
    return await fn(i.storage);
  } finally {
    i.stop();
  }
}

describe('sweep_expired batches', () => {
  it('with storage.sweepBatchSize 2, one sweep_expired deletes the 5 expired rows of a table and returns 5', async () => {
    const { storage, clock } = await instance({ settings: { 'storage.sweepBatchSize': 2 }, register: expiring_tables(undefined) });
    const now = clock.now();
    await insert_rows(storage, 'test_expiring', [
      [1n, now - 10n],
      [2n, now - 3n],
      [3n, now],
      [4n, now - 1n],
      [5n, now - 7n],
      [6n, now + 1n],
    ]);
    expect(await storage.sweep_expired()).toEqual({ deleted: 5, failed: [] });
    expect(storage.read_db().query('SELECT id FROM test_expiring')).toEqual([{ id: 6n }]);
  });

  it.runIf(DB_KIND === 'postgresql')(
    'PostgreSQL: a table locked by another session past storage.userLockWaitMs is the only table in the failed table list, and the expired rows of the other tables are deleted',
    async () => {
      const { db, storage, clock } = await instance({ settings: { 'storage.userLockWaitMs': 500 }, register: expiring_tables(undefined) });
      const now = clock.now();
      await insert_rows(storage, 'test_expiring', [[1n, now - 1n]]);
      await insert_rows(storage, 'test_other', [
        [1n, now - 1n],
        [2n, now - 2n],
      ]);
      const holder = await lock_holder(db);
      await holder.ok('BEGIN');
      await holder.ok('LOCK TABLE test_expiring IN EXCLUSIVE MODE');
      const result = await storage.sweep_expired();
      await holder.ok('ROLLBACK');
      expect(result.failed).toEqual([{ table: 'test_expiring', code: '55P03' }]);
      expect(result.deleted).toBe(2);
      expect(storage.read_db().query('SELECT id FROM test_other')).toEqual([]);
      expect(await storage.sweep_expired()).toEqual({ deleted: 1, failed: [] });
    },
  );

  it.runIf(DB_KIND === 'postgresql')('PostgreSQL: a delete that gets no free connection within storage.userLockWaitMs is in the failed table list with the empty DB error code', async () => {
    const { storage } = await instance({ settings: { 'storage.dbMaxConnections': 1, 'storage.userLockWaitMs': 500 } });
    const user = await new_user(storage);
    // The transaction of the user takes the only connection and keeps it past the sweep's wait with a statement that answers late.
    const first = request(storage, user, (ctx) => storage.db(ctx).query('SELECT pg_sleep(1.5)'));
    const result = await storage.sweep_expired();
    await first;
    expect(result).toEqual({ deleted: 0, failed: [{ table: 'game_state', code: '' }] });
  });
});

describe('expiry index', () => {
  it('a table with an expiry column and no index starting with it has an index of that one column; one whose index list has such an index gets no other index', async () => {
    const db = await new_db();
    await with_instance(db, expiring_tables([['kind', 'at']]), (s) => {
      expect(leading_columns(s, 'test_expiring')).toEqual(['at', 'kind']);
      expect(leading_columns(s, 'test_other')).toEqual(['at']);
      const definition = JSON.parse(String(s.read_db().query(`SELECT definition FROM storage_schema WHERE name = 'test_other'`)[0]?.definition)) as { indexes: unknown };
      expect(definition.indexes).toEqual([['at']]);
    });
    await with_instance(await new_db(), expiring_tables([['at', 'kind']]), (s) => {
      expect(leading_columns(s, 'test_expiring')).toEqual(['at']);
      const definition = JSON.parse(String(s.read_db().query(`SELECT definition FROM storage_schema WHERE name = 'test_expiring'`)[0]?.definition)) as { indexes: unknown };
      expect(definition.indexes).toEqual([['at', 'kind']]);
    });
  });

  it('server start creates the expiry column index of a table whose storage_schema definition lacks it, and keeps one of that name made before', async () => {
    const db = await new_db();
    /** The `storage_schema` definition of `test_other` as a core that did not add the expiry column index wrote it, with or without the index. */
    const old_definition = (s: Storage, drop: boolean): Promise<unknown> =>
      s.run_game_transaction((tx) => {
        if (drop) s.db(tx).query(`DROP INDEX ${index_name('test_other', ['at'])}`);
        s.db(tx).query(`UPDATE storage_schema SET definition = $1 WHERE name = 'test_other'`, [JSON.stringify({ scope: 'game', columns: [...EXPIRING], key: ['id'], indexes: [] })]);
        return { written: true };
      });
    await with_instance(db, expiring_tables(undefined), async (s) => {
      await old_definition(s, true);
      expect(leading_columns(s, 'test_other')).toEqual([]);
    });
    await with_instance(db, expiring_tables(undefined), async (s) => {
      expect(leading_columns(s, 'test_other')).toEqual(['at']);
      // An operator made the index of the core's name before the upgrade (e.g. with CREATE INDEX CONCURRENTLY).
      await old_definition(s, false);
    });
    await with_instance(db, expiring_tables(undefined), (s) => {
      expect(leading_columns(s, 'test_other')).toEqual(['at']);
      const definition = JSON.parse(String(s.read_db().query(`SELECT definition FROM storage_schema WHERE name = 'test_other'`)[0]?.definition)) as { indexes: unknown };
      expect(definition.indexes).toEqual([['at']]);
    });
  });

  it('every table that the core modules of a test server register with an expiry column has an index starting with that column', async () => {
    registered.length = 0;
    const server = await start_test_server();
    try {
      const storage = storage_module(server);
      const expiring = registered.filter((def) => def.expiry !== null);
      expect(expiring.length).toBeGreaterThan(0);
      const missing = expiring.filter((def) => !leading_columns(storage, def.name).includes(def.expiry ?? '')).map((def) => def.name);
      expect(missing).toEqual([]);
    } finally {
      await stop_test_server(server);
    }
  });
});
