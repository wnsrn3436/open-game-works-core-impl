import { StorageMisuse, type RawRow, type Storage } from '../index.ts';
import { DB_KIND, instance, lock_holder, new_user, PG_LOCK_SQL, raw_rows, request, stop_all } from './helpers.ts';
import { lock_key } from '../tx.ts';
import { boss, BossGameState, profile, quest, wallet } from './kinds.ts';

afterEach(() => {
  stop_all();
});

/** Module tables of the tests, as core modules register them. */
function tables(s: Storage): void {
  s.register_table(
    'test_note',
    'user',
    [
      { name: 'user_id', type: 'int64' },
      { name: 'slot', type: 'int32' },
      { name: 'text', type: 'string' },
      { name: 'blob', type: 'bytes?' },
      { name: 'flag', type: 'bool' },
      { name: 'big', type: 'int64?' },
    ],
    ['user_id', 'slot'],
    null,
    true,
    'user_id',
  );
  s.register_table('test_cache', 'user', [{ name: 'user_id', type: 'int64' }, { name: 'n', type: 'int64' }, { name: 'expires_at', type: 'int64' }], ['user_id'], 'expires_at', false);
  s.register_table('test_report', 'game', [{ name: 'report_id', type: 'int64' }, { name: 'reporter', type: 'int64' }, { name: 'body', type: 'string' }], ['report_id'], null, null, 'reporter');
  s.register_table('test_token', 'game', [{ name: 'token', type: 'string' }, { name: 'n', type: 'int64' }, { name: 'expires_at', type: 'int64' }], ['token'], 'expires_at', null);
}

function note(storage: Storage, ctx: Parameters<Parameters<Storage['run_request_transaction']>[2]>[0], slot: number, text: string): void {
  storage.db(ctx).query('INSERT INTO test_note (user_id, slot, text, blob, flag, big) VALUES ($1, $2, $3, $4, $5, $6)', [ctx.user_id, slot, text, Uint8Array.from([1, 2]), true, 2n ** 60n]);
}

function json_row(table: string, key: unknown[], value: Record<string, unknown>): RawRow {
  return { table, key: JSON.stringify(key), contract_version: 0n, value: new TextEncoder().encode(JSON.stringify(value)) };
}

async function rows_of(storage: Storage, user: bigint): Promise<RawRow[]> {
  const rows = await request(storage, user, (ctx) => storage.read_user_rows(ctx));
  if (typeof rows === 'string') throw new Error(rows);
  return rows;
}

describe('user rows', () => {
  it('read_user_rows holds the snapshot tables and user_state, server_state rows only and changes nothing; replace_user_rows puts back the same', async () => {
    const { storage } = await instance({ register: tables });
    const user = await new_user(storage);
    const other = await new_user(storage);
    await request(storage, user, (ctx) => {
      storage.put_state(ctx, quest(2n, 1n));
      storage.put_state(ctx, profile(1n));
      storage.put_state(ctx, wallet(3n));
      note(storage, ctx, 2, 'b');
      note(storage, ctx, 1, 'a');
      storage.db(ctx).query('INSERT INTO test_cache (user_id, n, expires_at) VALUES ($1, 1, $2)', [ctx.user_id, 2n ** 62n]);
    });
    await storage.run_user_transaction(user, (ctx) => (storage.put_state(ctx, quest(5n, 5n)), 'pass'));
    const before = ['user_state', 'server_state', 'test_note', 'pending_delta'].map((t) => raw_rows(storage, t, user));
    const rows = await rows_of(storage, user);
    expect(rows.map((r) => [r.table, r.key])).toEqual([
      ['server_state', 'wallet_server_state/0'],
      ['test_note', '[1]'],
      ['test_note', '[2]'],
      ['user_state', 'profile_user_state/0'],
      ['user_state', 'quest_user_state/2'],
      ['user_state', 'quest_user_state/5'],
    ]);
    expect(JSON.parse(new TextDecoder().decode(rows[1]?.value))).toEqual({ slot: 1, text: 'a', blob: 'AQI=', flag: true, big: String(2n ** 60n) });
    expect(['user_state', 'server_state', 'test_note', 'pending_delta'].map((t) => raw_rows(storage, t, user))).toEqual(before);
    expect(await request(storage, other, (ctx) => ({ n: storage.replace_user_rows(ctx, rows) }))).toEqual({ n: 6 });
    expect(await rows_of(storage, other)).toEqual(rows);
    expect(raw_rows(storage, 'pending_delta', user)).toHaveLength(1);
    await storage.run_user_transaction(other, (ctx) => (storage.put_state(ctx, quest(6n, 6n)), 'pass'));
    await request(storage, other, (ctx) => {
      storage.replace_user_rows(ctx, rows);
    });
    expect(raw_rows(storage, 'pending_delta', other)).toEqual([]);
  });

  it('replace_user_rows stores null for a ? column missing from value and throws on a wrong raw row without a change', async () => {
    const { storage } = await instance({ register: tables });
    const user = await new_user(storage);
    await request(storage, user, (ctx) => {
      storage.replace_user_rows(ctx, [json_row('test_note', [1], { slot: 1, text: 'x', flag: false })]);
    });
    expect(storage.read_db().query('SELECT blob, big FROM test_note WHERE user_id = $1', [user])).toEqual([{ blob: null, big: null }]);
    const before = raw_rows(storage, 'test_note', user);
    const wrong = [
      json_row('test_note', [2], { slot: 2, text: 'x', flag: false, other: 1 }),
      json_row('test_note', [2], { slot: 2, flag: false }),
      json_row('test_note', [2], { slot: '2', text: 'x', flag: false }),
      json_row('test_note', [2], { slot: 2, text: 'x', flag: false, big: 5 }),
      json_row('test_note', [3], { slot: 2, text: 'x', flag: false }),
      json_row('test_note', [2], { user_id: '1', slot: 2, text: 'x', flag: false }),
      json_row('test_cache', [], { n: '1', expires_at: '1' }),
      { table: 'user_state', key: 'quest_user_state/x', contract_version: 1n, value: new Uint8Array(0) },
    ];
    for (const raw of wrong) {
      await expect(
        request(storage, user, (ctx) => {
          storage.replace_user_rows(ctx, [json_row('test_note', [5], { slot: 5, text: 'ok', flag: true }), raw]);
        }),
        raw.key,
      ).rejects.toThrow();
    }
    expect(raw_rows(storage, 'test_note', user)).toEqual(before);
  });

  it('replace_user_rows throws StorageMisuse without a change for a user_state or server_state key above int64, and takes int64 max', async () => {
    const { storage } = await instance({ register: tables });
    const user = await new_user(storage);
    await request(storage, user, (ctx) => {
      storage.put_state(ctx, quest(2n, 1n));
    });
    const rows = await rows_of(storage, user);
    const value = rows[0]?.value ?? new Uint8Array(0);
    for (const table of ['user_state', 'server_state']) {
      const above = { table, key: 'quest_user_state/9223372036854775808', contract_version: 1n, value };
      await expect(
        request(storage, user, (ctx) => {
          storage.replace_user_rows(ctx, [above]);
        }),
      ).rejects.toThrow(StorageMisuse);
      expect(await rows_of(storage, user)).toEqual(rows);
    }
    const max = { ...(rows[0] as RawRow), key: 'quest_user_state/9223372036854775807' };
    expect(await request(storage, user, (ctx) => ({ n: storage.replace_user_rows(ctx, [max]) }))).toEqual({ n: 1 });
    expect(await rows_of(storage, user)).toEqual([max]);
  });

  it('replace_user_rows throws StorageMisuse without a change for two raw rows with the same table and key', async () => {
    const { storage } = await instance({ register: tables });
    const user = await new_user(storage);
    await request(storage, user, (ctx) => {
      storage.put_state(ctx, quest(2n, 1n));
      note(storage, ctx, 1, 'kept');
    });
    const rows = await rows_of(storage, user);
    const state = rows.find((r) => r.table === 'user_state') as RawRow;
    const twice = [
      [json_row('test_note', [4], { slot: 4, text: 'a', flag: true }), json_row('test_note', [4], { slot: 4, text: 'b', flag: false })],
      [state, { ...state, value: quest(2n, 9n).encode() }],
      [{ ...state, table: 'server_state' }, { ...state, table: 'server_state' }],
    ];
    for (const list of twice) {
      await expect(
        request(storage, user, (ctx) => {
          storage.replace_user_rows(ctx, list);
        }),
      ).rejects.toThrow(StorageMisuse);
      expect(await rows_of(storage, user)).toEqual(rows);
    }
    // The same key in two tables is two rows.
    const both = [state, { ...state, table: 'server_state' }];
    expect(await request(storage, user, (ctx) => ({ n: storage.replace_user_rows(ctx, both) }))).toEqual({ n: 2 });
  });
});

describe('game rows', () => {
  it('read_game_rows gives stored bytes and version unchanged; replace_game_rows then read_game_rows gives the same rows; one wrong row throws and changes nothing', async () => {
    const { storage } = await instance();
    const user = await new_user(storage);
    await request(storage, user, (ctx) => {
      storage.put_game_state(ctx, boss(2n, 20n), 0n);
      storage.put_game_state(ctx, boss(10n, 100n), 0n);
    });
    const read = (): RawRow[] => storage.read_game_rows(storage.read_db(), BossGameState, [10n, 2n, 99n]);
    const rows = read();
    expect(rows.map((r) => [r.key, r.contract_version])).toEqual([
      ['boss_game_state/10', 3n],
      ['boss_game_state/2', 3n],
    ]);
    expect(rows[1]?.value).toEqual(boss(2n, 20n).encode());
    const before = storage.read_db().query('SELECT * FROM game_state ORDER BY "key"');
    const changed = rows.map((r) => ({ ...r, contract_version: 1n, value: boss(0n, 7n).encode() }));
    await storage.run_game_transaction((tx) => {
      storage.replace_game_rows(tx, changed);
    });
    expect(read()).toEqual(changed);
    await storage.run_game_transaction((tx) => {
      storage.replace_game_rows(tx, rows);
    });
    expect(storage.read_db().query('SELECT kind, "key", value, contract_version, expires_at FROM game_state ORDER BY "key"')).toEqual(
      before.map((r) => ({ kind: r.kind, key: r.key, value: r.value, contract_version: r.contract_version, expires_at: r.expires_at })),
    );
    for (const wrong of [
      { ...rows[0], table: 'user_state' },
      { ...rows[0], key: 'ghost_game_state/1' },
      { ...rows[0], key: 'boss_game_state/-1' },
      { ...rows[0], key: 'boss_game_state' },
    ] as RawRow[]) {
      await expect(
        storage.run_game_transaction((tx) => {
          storage.replace_game_rows(tx, [changed[0] as RawRow, wrong]);
        }),
      ).rejects.toThrow();
    }
    expect(read()).toEqual(rows);
  });

  it('replace_game_rows throws StorageMisuse without a change for a key above int64, and takes int64 max', async () => {
    const { storage } = await instance();
    const user = await new_user(storage);
    await request(storage, user, (ctx) => {
      storage.put_game_state(ctx, boss(2n, 20n), 0n);
    });
    const [row] = storage.read_game_rows(storage.read_db(), BossGameState, [2n]);
    if (row === undefined) throw new Error('no boss_game_state/2 row');
    const before = storage.read_db().query('SELECT * FROM game_state ORDER BY "key"');
    await expect(
      storage.run_game_transaction((tx) => {
        storage.replace_game_rows(tx, [row, { ...row, key: 'boss_game_state/9223372036854775808' }]);
      }),
    ).rejects.toThrow(StorageMisuse);
    expect(storage.read_db().query('SELECT * FROM game_state ORDER BY "key"')).toEqual(before);
    const max = { ...row, key: 'boss_game_state/9223372036854775807' };
    expect(await storage.run_game_transaction((tx) => ({ n: storage.replace_game_rows(tx, [max]) }))).toEqual({ n: 1 });
    expect(storage.read_game_rows(storage.read_db(), BossGameState, [2n ** 63n - 1n])).toEqual([max]);
  });

  it('replace_game_rows throws StorageMisuse without a change for two raw rows with the same key', async () => {
    const { storage } = await instance();
    const user = await new_user(storage);
    await request(storage, user, (ctx) => {
      storage.put_game_state(ctx, boss(2n, 20n), 0n);
    });
    const [row] = storage.read_game_rows(storage.read_db(), BossGameState, [2n]);
    if (row === undefined) throw new Error('no boss_game_state/2 row');
    const before = storage.read_db().query('SELECT * FROM game_state ORDER BY "key"');
    const other = { ...row, key: 'boss_game_state/3' };
    await expect(
      storage.run_game_transaction((tx) => {
        storage.replace_game_rows(tx, [other, { ...row, value: boss(0n, 7n).encode() }, row]);
      }),
    ).rejects.toThrow(StorageMisuse);
    expect(storage.read_db().query('SELECT * FROM game_state ORDER BY "key"')).toEqual(before);
  });

  it('sample_game_rows gives live rows of the kind without repeats up to the maximum, all of them when fewer, and changes nothing', async () => {
    const { storage, clock } = await instance();
    const user = await new_user(storage);
    await request(storage, user, (ctx) => {
      for (let key = 1n; key <= 6n; key += 1n) storage.put_game_state(ctx, boss(key, key), 0n);
      storage.put_game_state(ctx, boss(7n, 7n), clock.now() + 10n);
    });
    clock.advance(10n);
    const sample = storage.sample_game_rows(storage.read_db(), BossGameState, 4);
    expect(sample).toHaveLength(4);
    expect(new Set(sample.map((r) => r.key)).size).toBe(4);
    expect(sample.every((r) => r.key !== 'boss_game_state/7')).toBe(true);
    expect([...sample.map((r) => r.key)].sort()).toEqual(sample.map((r) => r.key));
    expect(storage.sample_game_rows(storage.read_db(), BossGameState, 50).map((r) => r.key)).toEqual(['1', '2', '3', '4', '5', '6'].map((k) => `boss_game_state/${k}`));
    expect(storage.read_db().query('SELECT "key" FROM game_state')).toHaveLength(7);
    expect(storage.sample_game_rows(storage.read_db(), BossGameState, 0)).toEqual([]);
    const drawn = new Set<string>();
    for (let n = 0; n < 100; n += 1) for (const row of storage.sample_game_rows(storage.read_db(), BossGameState, 1)) drawn.add(row.key);
    expect([...drawn].sort()).toEqual(['1', '2', '3', '4', '5', '6'].map((k) => `boss_game_state/${k}`));
  });
});

describe('replace_game_rows lock', () => {
  const LOCK_WAIT_MS = 300;

  /** Another server instance's user transaction that took `lock_game_row(game_state, [BossGameState, key])`. */
  async function hold_boss(holder: Awaited<ReturnType<typeof lock_holder>>, key: bigint): Promise<void> {
    await holder.ok(DB_KIND === 'postgresql' ? 'BEGIN' : 'BEGIN IMMEDIATE');
    if (DB_KIND === 'postgresql') await holder.ok(PG_LOCK_SQL, [lock_key('game_state', ['boss_game_state', key])]);
  }

  it('waits for a user transaction that locked the row, so a value that transaction writes later does not cover it', async () => {
    const { db, storage } = await instance();
    const user = await new_user(storage);
    await request(storage, user, (ctx) => {
      storage.put_game_state(ctx, boss(1n, 1n), 0n);
    });
    const replacement = { table: 'game_state', key: 'boss_game_state/1', contract_version: 3n, value: boss(1n, 500n).encode() };
    const holder = await lock_holder(db);
    await hold_boss(holder, 1n);
    // The holder writes the value it read plus one after the replace has started, then commits.
    const written = holder.run('UPDATE game_state SET value = $1 WHERE kind = $2 AND "key" = $3', [boss(1n, 2n).encode(), 'boss_game_state', 1n], 150);
    const committed = holder.run('COMMIT', [], 0);
    const replaced = await storage.run_game_transaction((tx) => ({ n: storage.replace_game_rows(tx, [replacement]) }));
    expect(await written).toEqual({ ok: true, rows: [] });
    expect(await committed).toEqual({ ok: true, rows: [] });
    expect(replaced).toEqual({ n: 1 });
    expect(storage.read_game_rows(storage.read_db(), BossGameState, [1n])).toEqual([replacement]);
  });

  it.runIf(DB_KIND === 'postgresql')('PostgreSQL: is FAILED past the lock wait limit and changes no row', async () => {
    const { db, storage } = await instance({ settings: { 'storage.userLockWaitMs': LOCK_WAIT_MS } });
    const user = await new_user(storage);
    await request(storage, user, (ctx) => {
      storage.put_game_state(ctx, boss(1n, 1n), 0n);
      storage.put_game_state(ctx, boss(2n, 2n), 0n);
    });
    const before = storage.read_game_rows(storage.read_db(), BossGameState, [1n, 2n]);
    const holder = await lock_holder(db);
    await hold_boss(holder, 2n);
    const rows = [1n, 2n].map((key) => ({ table: 'game_state', key: `boss_game_state/${String(key)}`, contract_version: 3n, value: boss(key, 9n).encode() }));
    let inner: unknown = null;
    const result = await storage.run_game_transaction((tx) => {
      inner = storage.replace_game_rows(tx, rows);
      return { inner };
    });
    expect(inner).toBe('FAILED');
    expect(result).toBe('FAILED');
    expect(storage.read_game_rows(storage.read_db(), BossGameState, [1n, 2n])).toEqual(before);
    await holder.ok('ROLLBACK');
  });
});

describe('users', () => {
  it('scan_users leaves out withdrawn users, and with a version only gives users with a lower version row', async () => {
    const { storage } = await instance();
    const [a, b, c, d] = [await new_user(storage), await new_user(storage), await new_user(storage), await new_user(storage)];
    await request(storage, b, (ctx) => {
      storage.delete_user(ctx);
    });
    await request(storage, c, (ctx) => {
      storage.replace_user_rows(ctx, [{ table: 'server_state', key: 'wallet_server_state/0', contract_version: 1n, value: wallet(1n).encode() }]);
    });
    await request(storage, d, (ctx) => {
      storage.put_state(ctx, quest(1n, 1n));
    });
    const db = storage.read_db();
    expect(storage.scan_users(db, 0n, 10)).toEqual([a, c, d]);
    expect(storage.scan_users(db, a, 1)).toEqual([c]);
    expect(storage.scan_users(db, 0n, 10, 3n)).toEqual([c]);
    expect(storage.scan_users(db, 0n, 10, 4n)).toEqual([c, d]);
  });

  it('sample_users leaves out withdrawn users, gives no user twice, up to the maximum in user ID order, and all users when fewer', async () => {
    const { storage } = await instance();
    const users: bigint[] = [];
    for (let i = 0; i < 6; i += 1) users.push(await new_user(storage));
    const [, withdrawn] = users;
    await request(storage, withdrawn as bigint, (ctx) => {
      storage.delete_user(ctx);
    });
    const live = users.filter((u) => u !== withdrawn);
    const db = storage.read_db();
    expect(storage.sample_users(db, 50)).toEqual(live);
    expect(storage.sample_users(db, live.length)).toEqual(live);
    const seen = new Set<bigint>();
    for (let i = 0; i < 40; i += 1) {
      const sample = storage.sample_users(db, 2);
      expect(sample).toHaveLength(2);
      expect(new Set(sample).size).toBe(2);
      expect([...sample].sort((a, b) => (a < b ? -1 : 1))).toEqual(sample);
      for (const id of sample) {
        expect(live).toContain(id);
        seen.add(id);
      }
    }
    expect([...seen].sort((a, b) => (a < b ? -1 : 1))).toEqual(live);
    for (const max of [0, 1.5, -1]) expect(() => storage.sample_users(db, max)).toThrow();
  });

  it('delete_user deletes the user rows of registered user scope tables and sets withdrawn_at', async () => {
    const { storage, clock } = await instance({ register: tables });
    const user = await new_user(storage);
    await request(storage, user, (ctx) => {
      storage.put_state(ctx, quest(1n, 1n));
      storage.put_state(ctx, wallet(1n));
      note(storage, ctx, 1, 'a');
      storage.db(ctx).query('INSERT INTO test_cache (user_id, n, expires_at) VALUES ($1, 1, 1)', [ctx.user_id]);
    });
    await storage.run_user_transaction(user, (ctx) => (storage.put_state(ctx, quest(2n, 1n)), 'pass'));
    const taken = await request(storage, user, (ctx) => {
      storage.delete_user(ctx);
      return { deleted: ctx.user_deleted, taken: storage.take_response_delta(ctx) };
    });
    if (typeof taken === 'string') throw new Error(taken);
    expect(taken.deleted).toBe(true);
    expect(taken.taken.delta.user_state.entries).toEqual([]);
    expect(taken.taken.delta.pending_user_state.entries).toEqual([]);
    for (const table of ['user_state', 'server_state', 'pending_delta', 'test_note', 'test_cache']) expect(raw_rows(storage, table, user)).toEqual([]);
    expect(storage.get_user_record(storage.read_db(), user)?.withdrawn_at).toBe(clock.now());
  });

  it('set_user_created_at sets created_at and makes no delta and no pending delta', async () => {
    const { storage } = await instance();
    const user = await new_user(storage);
    const taken = await request(storage, user, (ctx) => {
      storage.set_user_created_at(ctx, 12345n);
      return storage.take_response_delta(ctx);
    });
    if (typeof taken === 'string') throw new Error(taken);
    expect(taken.delta.user_state.entries).toEqual([]);
    await storage.run_user_transaction(user, (ctx) => (storage.set_user_created_at(ctx, 777n), 'pass'));
    expect(storage.get_user_record(storage.read_db(), user)).toEqual({ created_at: 777n, withdrawn_at: null });
    expect(raw_rows(storage, 'pending_delta', user)).toEqual([]);
    expect(storage.get_user_record(storage.read_db(), 123_456n)).toBeNull();
  });

  it('export_user_rows gives the rows of tables with a personal data user column where it is the user, and no other table', async () => {
    const { storage } = await instance({ register: tables });
    const user = await new_user(storage);
    const other = await new_user(storage);
    await request(storage, user, (ctx) => {
      note(storage, ctx, 2, 'two');
      note(storage, ctx, 1, 'one');
      storage.db(ctx).query('INSERT INTO test_cache (user_id, n, expires_at) VALUES ($1, 1, 1)', [ctx.user_id]);
    });
    await request(storage, other, (ctx) => {
      note(storage, ctx, 1, 'other');
    });
    await storage.run_game_transaction((tx) => {
      storage.db(tx).query('INSERT INTO test_report (report_id, reporter, body) VALUES (1, $1, $2), (2, $3, $4)', [user, 'mine', other, 'theirs']);
    });
    const out = storage.export_user_rows(storage.read_db(), user);
    expect(Object.keys(out).sort()).toEqual(['test_note', 'test_report']);
    expect(out.test_note).toEqual([1, 2].map((slot) => ({ user_id: String(user), slot, text: slot === 1 ? 'one' : 'two', blob: 'AQI=', flag: true, big: String(2n ** 60n) })));
    expect(out.test_report).toEqual([{ report_id: '1', reporter: String(user), body: 'mine' }]);
  });
});

describe('expiry', () => {
  it('the sweep deletes expired rows of user and game scope tables without a user lock; a row upserted on an expired key stays', async () => {
    const { db, storage, clock } = await instance({ register: tables });
    const user = await new_user(storage);
    const now = clock.now();
    await request(storage, user, (ctx) => {
      storage.db(ctx).query('INSERT INTO test_cache (user_id, n, expires_at) VALUES ($1, 1, $2)', [ctx.user_id, now + 5n]);
    });
    await storage.run_game_transaction((tx) => {
      storage.db(tx).query('INSERT INTO test_token (token, n, expires_at) VALUES ($1, 1, $2), ($3, 1, $4)', ['old', now + 5n, 'keep', now + 1000n]);
    });
    clock.advance(5n);
    await storage.run_game_transaction((tx) => {
      storage.db(tx).query('INSERT INTO test_token (token, n, expires_at) VALUES ($1, 2, $2) ON CONFLICT (token) DO UPDATE SET n = excluded.n, expires_at = excluded.expires_at', ['old', now + 1000n]);
    });
    // PostgreSQL: another server instance holds the user lock of the user while the sweep runs. SQLite has no row lock.
    const holder = DB_KIND === 'postgresql' ? await lock_holder(db) : null;
    await holder?.ok('BEGIN');
    await holder?.ok('SELECT user_id FROM "user" WHERE user_id = $1 FOR UPDATE', [user]);
    expect(await storage.sweep_expired()).toBe(1);
    await holder?.ok('ROLLBACK');
    expect(raw_rows(storage, 'test_cache', user)).toEqual([]);
    expect(storage.read_db().query('SELECT token, n FROM test_token ORDER BY token')).toEqual([
      { token: 'keep', n: 1n },
      { token: 'old', n: 2n },
    ]);
  });
});
