import { readFileSync } from 'node:fs';
import type { ColumnInput, Storage } from '../index.ts';
import { CORE_SCHEMA_VERSION, index_name, schema_lock } from '../schema.ts';
import { DB_KIND, lock_holder, new_db, new_user, request, start_instance, started, stop_all, type DbTarget, type LockHolder } from './helpers.ts';
import { quest, QuestUserState } from './kinds.ts';

afterEach(() => {
  stop_all();
});

type Table = { columns: ColumnInput[]; key?: string[]; indexes?: string[][] };

function with_table(table: Table): (s: Storage) => void {
  return (s) => {
    s.register_table('test_item', 'game', table.columns, table.key ?? ['id'], null, null, null, table.indexes);
  };
}

const V1: Table = { columns: [{ name: 'id', type: 'int64' }, { name: 'name', type: 'string' }] };
const V2: Table = { columns: [{ name: 'id', type: 'int64' }, { name: 'name', type: 'string' }, { name: 'extra', type: 'int64?' }] };

/** Starts, runs `fn`, stops. */
async function with_instance<T>(db: DbTarget, register: (s: Storage) => void, fn: (storage: Storage) => Promise<T> | T): Promise<T> {
  const i = started({ db, register });
  try {
    return await fn(i.storage);
  } finally {
    i.stop();
  }
}

function start_failure(db: DbTarget, register: (s: Storage) => void): string | null {
  const i = start_instance({ db, register });
  if (typeof i === 'string') return i;
  i.stop();
  return null;
}

async function insert(storage: Storage, sql: string, params: (bigint | string | null)[]): Promise<void> {
  await storage.run_game_transaction((tx) => storage.db(tx).query(sql, params));
}

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

function table_count(storage: Storage, name: string): number {
  const sql = DB_KIND === 'sqlite' ? `SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'table' AND name = $1` : 'SELECT COUNT(*) AS n FROM pg_tables WHERE schemaname = current_schema() AND tablename = $1';
  return Number(storage.read_db().query(sql, [name])[0]?.n);
}

describe('module tables', () => {
  it('are made with the registered columns and key; a ? column can be added and dropped from the definition across restarts', async () => {
    const db = await new_db();
    await with_instance(db, with_table(V1), async (s) => {
      await insert(s, 'INSERT INTO test_item (id, name) VALUES ($1, $2)', [1n, 'one']);
      await expect(insert(s, 'INSERT INTO test_item (id, name) VALUES ($1, $2)', [1n, 'dup'])).rejects.toThrow();
      await expect(insert(s, 'INSERT INTO test_item (id) VALUES ($1)', [2n])).rejects.toThrow();
    });
    await with_instance(db, with_table(V2), async (s) => {
      expect(s.read_db().query('SELECT id, name, extra FROM test_item')).toEqual([{ id: 1n, name: 'one', extra: null }]);
      await insert(s, 'INSERT INTO test_item (id, name, extra) VALUES ($1, $2, $3)', [2n, 'two', 22n]);
    });
    await with_instance(db, with_table(V1), async (s) => {
      await insert(s, 'INSERT INTO test_item (id, name) VALUES ($1, $2)', [3n, 'three']);
      expect(s.read_db().query('SELECT id, extra FROM test_item ORDER BY id')).toEqual([
        { id: 1n, extra: null },
        { id: 2n, extra: 22n },
        { id: 3n, extra: null },
      ]);
    });
    const definition = await with_instance(db, with_table(V1), (s) => JSON.parse(String(s.read_db().query(`SELECT definition FROM storage_schema WHERE name = 'test_item'`)[0]?.definition)) as unknown);
    expect(definition).toEqual({ scope: 'game', columns: [{ name: 'id', type: 'int64' }, { name: 'name', type: 'string' }, { name: 'extra', type: 'int64?' }], key: ['id'], indexes: [] });
    expect(start_failure(db, with_table({ columns: [{ name: 'id', type: 'int64' }, { name: 'extra', type: 'int64?' }] }))).toMatch(/name/);
    expect(start_failure(db, with_table({ columns: [{ name: 'id', type: 'int64' }, { name: 'name', type: 'int64' }] }))).toMatch(/name/);
    expect(start_failure(db, with_table({ columns: [{ name: 'id', type: 'int64' }, { name: 'name', type: 'string' }, { name: 'more', type: 'int64' }] }))).toMatch(/more/);
    expect(start_failure(db, with_table({ columns: [{ name: 'id', type: 'int64' }, { name: 'name', type: 'string' }], key: ['id', 'name'] }))).toMatch(/key/);
    expect(
      start_failure(db, (s) => {
        s.register_table('test_item', 'user', [{ name: 'user_id', type: 'int64' }, { name: 'id', type: 'int64' }, { name: 'name', type: 'string' }], ['user_id', 'id'], null, false);
      }),
    ).not.toBeNull();
  });

  it('have the registered indexes with their name and column order; an added index is made on restart and stays after a restart without it', async () => {
    const db = await new_db();
    const columns: ColumnInput[] = [{ name: 'id', type: 'int64' }, { name: 'a', type: 'int64' }, { name: 'b', type: 'string' }];
    await with_instance(db, with_table({ columns, indexes: [['b', 'a']] }), (s) => {
      expect(index_columns(s, index_name('test_item', ['b', 'a']))).toEqual(['b', 'a']);
    });
    await with_instance(db, with_table({ columns, indexes: [['b', 'a'], ['a']] }), (s) => {
      expect(index_columns(s, index_name('test_item', ['a']))).toEqual(['a']);
    });
    await with_instance(db, with_table({ columns, indexes: [['b', 'a']] }), (s) => {
      expect(index_columns(s, index_name('test_item', ['a']))).toEqual(['a']);
      expect(index_columns(s, index_name('test_item', ['b', 'a']))).toEqual(['b', 'a']);
    });
    expect(index_name('test_item', ['b', 'a'])).toMatch(/^ix_[0-9a-f]{16}$/);
    for (const indexes of [[['c']], [[]], [['a'], ['a']]]) {
      expect(start_failure(await new_db(), with_table({ columns, indexes }))).not.toBeNull();
    }
  });

  it('a wrong registration fails server start', async () => {
    const user_columns: ColumnInput[] = [{ name: 'user_id', type: 'int64' }, { name: 'n', type: 'int64' }, { name: 'at', type: 'int64' }, { name: 's', type: 'string' }];
    const wrong: ((s: Storage) => void)[] = [
      (s) => {
        s.register_table('test_a', 'game', [{ name: 'id', type: 'int64' }], ['id'], null, null);
        s.register_table('test_a', 'game', [{ name: 'id', type: 'int64' }], ['id'], null, null);
      },
      (s) => {
        s.register_table('Bad-Name', 'game', [{ name: 'id', type: 'int64' }], ['id'], null, null);
      },
      (s) => {
        s.register_table('user_state', 'game', [{ name: 'id', type: 'int64' }], ['id'], null, null);
      },
      (s) => {
        s.register_table('test_a', 'game', [{ name: 'id', type: 'int64' }], ['id'], null, false);
      },
      (s) => {
        s.register_table('test_a', 'user', user_columns, ['user_id'], null, null);
      },
      (s) => {
        s.register_table('test_a', 'user', user_columns, ['user_id'], null, false, 'nobody');
      },
      (s) => {
        s.register_table('test_a', 'user', user_columns, ['user_id', 'missing'], null, false);
      },
      (s) => {
        s.register_table('test_a', 'user', user_columns, ['user_id'], 'missing', false);
      },
      (s) => {
        s.register_table('test_a', 'user', user_columns, ['user_id'], 's', false);
      },
      (s) => {
        s.register_table('test_a', 'user', [{ name: 'n', type: 'int64' }, { name: 'user_id', type: 'int64' }], ['user_id'], null, false);
      },
      (s) => {
        s.register_table('test_a', 'user', user_columns, ['n'], null, true);
      },
      (s) => {
        s.register_table('test_a', 'game', [{ name: 'id', type: 'float' as 'int64' }], ['id'], null, null);
      },
      (s) => {
        s.register_table('test_a', 'game', [['id', 'int64'] as unknown as ColumnInput], ['id'], null, null);
      },
      (s) => {
        s.register_item_converter(() => 'FAILED');
        s.register_item_converter(() => 'FAILED');
      },
      (s) => {
        s.content.register_user_change('gift', () => 'pass', () => undefined);
        s.content.register_user_change('gift', () => 'pass', () => undefined);
      },
      (s) => {
        s.register_user_change('Gift.Box', () => 'pass', () => undefined);
      },
      // A content name has no dot, and a core module name is <module>.<snake_case>.
      (s) => {
        s.content.register_user_change('item-ledger.refund_gift', () => 'pass', () => undefined);
      },
      (s) => {
        s.register_user_change('gift_box', () => 'pass', () => undefined);
      },
    ];
    for (const register of wrong) expect(start_failure(await new_db(), register)).not.toBeNull();
    expect(
      start_failure(await new_db(), (s) => {
        s.register_table('test_a', 'user', user_columns, ['user_id'], 'at', true, 'user_id', [['n', 's']]);
        s.register_user_change('item-ledger.refund_gift', () => 'pass', () => undefined);
        s.content.register_user_change('gift_box', () => 'pass', () => undefined);
      }),
    ).toBeNull();
  });
});

describe('core schema version', () => {
  it('a database whose base row is above this core release does not start and keeps the base row', async () => {
    const db = await new_db();
    await with_instance(db, () => undefined, async (s) => {
      await s.run_game_transaction((tx) => s.db(tx).query(`UPDATE storage_schema SET definition = $1 WHERE name = 'base'`, [String(CORE_SCHEMA_VERSION + 1)]));
    });
    const failure = start_failure(db, () => undefined);
    expect(failure).toContain(String(CORE_SCHEMA_VERSION + 1));
    expect(failure).toContain(String(CORE_SCHEMA_VERSION));
    expect(start_failure(db, () => undefined)).toContain(`version ${String(CORE_SCHEMA_VERSION + 1)}`);
  });

  it('core-schema-version holds the highest core schema version storage applies', () => {
    const text = readFileSync(new URL('../core-schema-version', import.meta.url), 'utf8');
    expect(text).toBe(`${String(CORE_SCHEMA_VERSION)}\n`);
  });
});

describe('server start on one empty database', () => {
  it('two instances started together both start with one set of tables and the registered definitions; a ? column one adds is added once', async () => {
    const db = await new_db();
    const a = start_instance({ db, register: with_table(V1) });
    const b = start_instance({ db, register: with_table(V2) });
    try {
      expect(typeof a).not.toBe('string');
      expect(typeof b).not.toBe('string');
      if (typeof a === 'string' || typeof b === 'string') return;
      for (const table of ['user', 'user_state', 'server_state', 'pending_delta', 'storage_schema', 'game_state', 'user_change', 'test_item']) expect(table_count(a.storage, table)).toBe(1);
      const rows = a.storage.read_db().query('SELECT name, definition FROM storage_schema ORDER BY name');
      expect(rows.map((r) => r.name)).toEqual(['base', 'test_item']);
      expect(JSON.parse(String(rows[1]?.definition))).toEqual({ scope: 'game', columns: [{ name: 'id', type: 'int64' }, { name: 'name', type: 'string' }, { name: 'extra', type: 'int64?' }], key: ['id'], indexes: [] });
    } finally {
      if (typeof a !== 'string') a.stop();
      if (typeof b !== 'string') b.stop();
    }
  });
});

/** Takes the schema lock on the holder's connection, as the schema step of another server instance does. */
async function hold_schema_lock(holder: LockHolder): Promise<void> {
  if (DB_KIND === 'sqlite') {
    await holder.ok('BEGIN IMMEDIATE');
    return;
  }
  const lock = schema_lock('postgresql');
  if (lock === null) throw new Error('PostgreSQL has a schema lock statement');
  await holder.ok('BEGIN');
  await holder.ok(lock.sql, lock.params);
}

describe('schema lock', () => {
  it('server start fails when another connection holds the schema lock over storage.schemaLockWaitMs, and starts when it is released within the wait', async () => {
    const db = await new_db();
    // The base tables first; on SQLite also the WAL journal the holder's connection joins.
    started({ db }).stop();
    const holder = await lock_holder(db);
    await hold_schema_lock(holder);
    const short_wait = 300;
    let at = performance.now();
    const failure = start_instance({ db, settings: { 'storage.schemaLockWaitMs': short_wait } });
    const failed_after = performance.now() - at;
    expect(failure).toEqual(expect.stringMatching(/^storage: the schema lock: /));
    expect(failed_after).toBeGreaterThanOrEqual(short_wait - 50);
    expect(failed_after).toBeLessThan(short_wait + 5000);

    // The holder's thread ends its transaction while server start blocks this thread.
    const release_after = 500;
    const long_wait = 20_000;
    const released = holder.run('COMMIT', [], release_after);
    at = performance.now();
    const second = start_instance({ db, settings: { 'storage.schemaLockWaitMs': long_wait } });
    const started_after = performance.now() - at;
    expect((await released).ok).toBe(true);
    if (typeof second === 'string') throw new Error(`server start failed: ${second}`);
    try {
      expect(started_after).toBeGreaterThanOrEqual(release_after - 50);
      expect(started_after).toBeLessThan(long_wait - 5000);
      expect(table_count(second.storage, 'storage_schema')).toBe(1);
    } finally {
      second.stop();
    }
  });

  it.runIf(DB_KIND === 'sqlite')(
    'SQLite: after a server start whose schema step waited with storage.schemaLockWaitMs, a transaction opens with busy timeout 0: it does not block the thread while another connection holds the write lock',
    async () => {
      const db = await new_db('sqlite');
      started({ db }).stop();
      const holder = await lock_holder(db);
      await hold_schema_lock(holder);
      const released = holder.run('COMMIT', [], 300);
      const lock_wait = 300;
      const second = start_instance({ db, settings: { 'storage.schemaLockWaitMs': 20_000, 'storage.userLockWaitMs': lock_wait } });
      expect((await released).ok).toBe(true);
      if (typeof second === 'string') throw new Error(`server start failed: ${second}`);
      try {
        const user = await new_user(second.storage);
        await hold_schema_lock(holder);
        // A timer runs during the wait only when BEGIN IMMEDIATE does not block the thread.
        let ticks = 0;
        const ticker = setInterval(() => {
          ticks += 1;
        }, 20);
        const at = performance.now();
        const result = await request(second.storage, user, () => 'ran');
        const waited = performance.now() - at;
        clearInterval(ticker);
        expect(result).toBe('FAILED');
        expect(waited).toBeGreaterThanOrEqual(lock_wait - 50);
        expect(waited).toBeLessThan(lock_wait + 2000);
        expect(ticks).toBeGreaterThanOrEqual(5);
        await holder.ok('COMMIT');
        expect(await request(second.storage, user, () => 'ran')).toBe('ran');
      } finally {
        second.stop();
      }
    },
  );
});

describe('values', () => {
  it('keeps int64 values above 2^53 and at the int64 limits, and keeps saved values across a restart', async () => {
    const db = await new_db();
    const big = [2n ** 53n + 1n, 2n ** 63n - 1n, -(2n ** 63n)];
    const register = with_table({ columns: [{ name: 'id', type: 'int64' }, { name: 'name', type: 'string' }, { name: 'n', type: 'int64' }] });
    let user = 0n;
    await with_instance(db, register, async (s) => {
      user = await new_user(s);
      await request(s, user, (ctx) => {
        for (const [i, v] of big.entries()) s.put_state(ctx, quest(BigInt(i), v));
      });
      for (const [i, v] of big.entries()) await insert(s, 'INSERT INTO test_item (id, name, n) VALUES ($1, $2, $3)', [v, String(i), v]);
    });
    await with_instance(db, register, async (s) => {
      expect(await request(s, user, (ctx) => s.list_state(ctx, QuestUserState).map((q) => (q as ReturnType<typeof quest>).progress))).toEqual(big);
      expect(s.read_db().query('SELECT id, n FROM test_item ORDER BY name').map((r) => [r.id, r.n])).toEqual(big.map((v) => [v, v]));
    });
  });
});

describe('string order', () => {
  it('string columns, made and added, order B, a, é, 가 and >= a picks a, é, 가; on PostgreSQL every text column has collation C', async () => {
    const db = await new_db();
    const texts = ['가', 'é', 'a', 'B'];
    await with_instance(db, with_table(V1), async (s) => {
      for (const [i, text] of texts.entries()) await insert(s, 'INSERT INTO test_item (id, name) VALUES ($1, $2)', [BigInt(i), text]);
    });
    const added: Table = { columns: [...V1.columns, { name: 'note', type: 'string?' }] };
    await with_instance(db, with_table(added), async (s) => {
      await insert(s, 'UPDATE test_item SET note = name', []);
      for (const column of ['name', 'note']) {
        const read = (sql: string, params: string[] = []): string[] => s.read_db().query(sql, params).map((r) => String(r[column]));
        expect(read(`SELECT ${column} FROM test_item ORDER BY ${column}`)).toEqual(['B', 'a', 'é', '가']);
        expect(read(`SELECT ${column} FROM test_item WHERE ${column} >= $1 ORDER BY ${column}`, ['a'])).toEqual(['a', 'é', '가']);
      }
      if (DB_KIND === 'postgresql') {
        const columns = s.read_db().query(`SELECT table_name, column_name, collation_name FROM information_schema.columns WHERE table_schema = current_schema() AND data_type = 'text'`);
        expect(columns.length).toBeGreaterThan(0);
        expect(columns.filter((c) => c.collation_name !== 'C')).toEqual([]);
      }
    });
  });
});
