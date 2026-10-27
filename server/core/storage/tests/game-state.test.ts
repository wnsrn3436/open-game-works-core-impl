import { StorageMisuse, type GameTx, type Storage } from '../index.ts';
import type { RequestCtx } from '../request_ctx.ts';
import { DB_KIND, instance, lock_holder, new_user, new_users, PG_LOCK_SQL, request, stop_all, type LockHolder } from './helpers.ts';
import type { HolderResult } from './lock_holder.ts';
import { lock_key } from '../tx.ts';
import { boss, BossGameState, deck, DeckUserState, profile, ProfileUserState, quest } from './kinds.ts';

afterEach(() => {
  stop_all();
});

const LOCK_WAIT_MS = 300;

function counter_table(s: Storage): void {
  s.register_table('test_counter', 'game', [{ name: 'id', type: 'int64' }, { name: 'n', type: 'int64' }], ['id'], null, null);
}

function hp(storage: Storage, ctx: RequestCtx, key: bigint): bigint {
  return (storage.get_game_state(ctx, BossGameState, key) as BossGameState | null)?.hp ?? 0n;
}

/** Locks the boss row and adds one to its hp. */
function hit(storage: Storage, ctx: RequestCtx, key: bigint): void {
  storage.content.lock_game_row(ctx, 'game_state', [BossGameState, key]);
  storage.put_game_state(ctx, boss(key, hp(storage, ctx, key) + 1n), 0n);
}

describe('game state', () => {
  it('a row one user transaction wrote is read by another user; two locked increments add 2', async () => {
    const { storage } = await instance();
    const a = await new_user(storage);
    const b = await new_user(storage);
    await request(storage, a, (ctx) => {
      storage.put_game_state(ctx, boss(1n, 10n), 0n);
    });
    expect(await request(storage, b, (ctx) => hp(storage, ctx, 1n))).toBe(10n);
    await Promise.all([request(storage, a, (ctx) => {
      hit(storage, ctx, 1n);
    }), request(storage, b, (ctx) => {
      hit(storage, ctx, 1n);
    })]);
    expect(await request(storage, a, (ctx) => hp(storage, ctx, 1n))).toBe(12n);
  });

  it('lock_game_row on a key with no row yet runs the two transactions one after the other', async () => {
    const { storage } = await instance();
    const a = await new_user(storage);
    const b = await new_user(storage);
    await Promise.all([request(storage, a, (ctx) => {
      hit(storage, ctx, 7n);
    }), request(storage, b, (ctx) => {
      hit(storage, ctx, 7n);
    })]);
    expect(await request(storage, a, (ctx) => hp(storage, ctx, 7n))).toBe(2n);
  });

  it('a row past its expiry is none for get_game_state and list_game_state, the sweep deletes it, and game state is in no delta', async () => {
    const { storage, clock } = await instance();
    const user = await new_user(storage);
    const now = clock.now();
    const taken = await request(storage, user, (ctx) => {
      storage.put_game_state(ctx, boss(1n, 1n), now + 1000n);
      storage.put_game_state(ctx, boss(2n, 2n), 0n);
      return storage.take_response_delta(ctx);
    });
    if (typeof taken === 'string') throw new Error(taken);
    expect(taken.delta.user_state.entries).toEqual([]);
    clock.advance(1000n);
    const read = await request(storage, user, (ctx) => [hp(storage, ctx, 1n), storage.list_game_state(ctx, BossGameState, -1n, 10).map((b) => (b as BossGameState).key)]);
    expect(read).toEqual([0n, [2n]]);
    expect(storage.read_db().query('SELECT "key" FROM game_state')).toHaveLength(2);
    expect((await storage.sweep_expired()).deleted).toBe(1);
    expect(storage.read_db().query('SELECT "key" FROM game_state')).toEqual([{ key: 2n }]);
  });

  it('list_game_state returns keys above the given key in order, up to the maximum', async () => {
    const { storage } = await instance();
    const user = await new_user(storage);
    const keys = await request(storage, user, (ctx) => {
      for (const key of [5n, 1n, 3n, 4n]) storage.put_game_state(ctx, boss(key, key), 0n);
      storage.delete_game_state(ctx, BossGameState, 4n);
      return storage.list_game_state(ctx, BossGameState, 1n, 2).map((b) => (b as BossGameState).key);
    });
    expect(keys).toEqual([3n, 5n]);
  });

  it('a content lock_game_row of a table other than game_state throws, also of a game scope table a module registered', async () => {
    const { storage } = await instance({ register: counter_table });
    const user = await new_user(storage);
    for (const table of ['user_state', 'user', 'user_change', 'other_table', 'test_counter']) {
      await expect(
        request(storage, user, (ctx) => {
          storage.content.lock_game_row(ctx, table, [1n]);
        }),
        table,
      ).rejects.toThrow(StorageMisuse);
    }
    await expect(
      request(storage, user, (ctx) => {
        storage.content.lock_game_row(ctx, 'game_state', [DeckUserState, 1n]);
      }),
    ).rejects.toThrow(StorageMisuse);
  });

  it('a core module lock_game_row of game_state or a base table throws; of a game scope table it locks', async () => {
    const { storage } = await instance({ register: counter_table });
    const user = await new_user(storage);
    for (const table of ['game_state', 'user', 'user_change', 'user_state', 'other_table']) {
      const key = table === 'game_state' ? [BossGameState, 1n] : [1n];
      await expect(request(storage, user, (ctx) => storage.lock_game_row(ctx, table, key)), table).rejects.toThrow(StorageMisuse);
    }
    expect(await request(storage, user, (ctx) => storage.lock_game_row(ctx, 'test_counter', [1n]) ?? 'locked')).toBe('locked');
  });

  it('a lock_game_row key that is not an array of the key column values throws, also for a table with one key column', async () => {
    const { storage } = await instance({ register: counter_table });
    const user = await new_user(storage);
    const wrong = (key: unknown) => (tx: GameTx): unknown => storage.lock_game_row(tx, 'test_counter', key as unknown[]);
    for (const key of [1n, [], [1n, 2n]]) await expect(storage.run_game_transaction(wrong(key))).rejects.toThrow();
    await expect(
      request(storage, user, (ctx) => {
        storage.content.lock_game_row(ctx, 'game_state', BossGameState as unknown as unknown[]);
      }),
    ).rejects.toThrow();
    expect(await storage.run_game_transaction((tx) => storage.lock_game_row(tx, 'test_counter', [1n]) ?? 'locked')).toBe('locked');
  });
});

describe('lock_game_row waits', () => {
  /** Takes in the holder's open transaction what `lock_game_row(test_counter, [id])` locks. */
  async function hold_counter(holder: LockHolder, id: bigint): Promise<void> {
    if (DB_KIND === 'postgresql') await holder.ok(PG_LOCK_SQL, [lock_key('test_counter', [id])]);
  }

  /** The holder's transaction: on SQLite a write transaction, which holds the whole database. */
  async function begin_holder(holder: LockHolder): Promise<void> {
    await holder.ok(DB_KIND === 'postgresql' ? 'BEGIN' : 'BEGIN IMMEDIATE');
  }

  it('a user transaction that locks a game row another server instance holds is FAILED past the lock wait limit, and commits after it ends', async () => {
    const { db, storage } = await instance({ settings: { 'storage.userLockWaitMs': LOCK_WAIT_MS }, register: counter_table });
    const user = await new_user(storage);
    const holder = await lock_holder(db);
    await begin_holder(holder);
    await hold_counter(holder, 1n);
    const add = (): Promise<unknown> =>
      storage.run_user_transaction(user, (ctx) => {
        if (storage.lock_game_row(ctx, 'test_counter', [1n]) === 'FAILED') return 'pass';
        storage.db(ctx).query('INSERT INTO test_counter (id, n) VALUES (1, 1)');
        storage.put_state(ctx, quest(1n, 1n));
        return 'pass';
      });
    expect(await add()).toBe('FAILED');
    expect(storage.read_db().query('SELECT id FROM test_counter')).toEqual([]);
    expect(storage.read_db().query('SELECT item_id FROM user_state WHERE user_id = $1', [user])).toEqual([]);
    await holder.ok('COMMIT');
    expect(await add()).toBe('COMMITTED');
    expect(storage.read_db().query('SELECT n FROM test_counter WHERE id = 1')).toEqual([{ n: 1n }]);
  });

  it('a game transaction that locks a row another game transaction holds goes on after that one ends', async () => {
    const { db, storage } = await instance({ register: counter_table });
    const holder = await lock_holder(db);
    await begin_holder(holder);
    await hold_counter(holder, 1n);
    await holder.ok('INSERT INTO test_counter (id, n) VALUES (1, 1)');
    // The holder commits while this thread waits for the lock.
    const released = holder.run('COMMIT', [], 200);
    const result = await storage.run_game_transaction((tx) => {
      storage.lock_game_row(tx, 'test_counter', [1n]);
      const n = storage.db(tx).query('SELECT n FROM test_counter WHERE id = 1')[0]?.n ?? 0n;
      storage.db(tx).query('INSERT INTO test_counter (id, n) VALUES (1, $1) ON CONFLICT (id) DO UPDATE SET n = excluded.n', [(n as bigint) + 1n]);
      return 'added';
    });
    expect(await released).toEqual({ ok: true, rows: [] });
    expect(result).toBe('added');
    expect(storage.read_db().query('SELECT n FROM test_counter WHERE id = 1')).toEqual([{ n: 2n }]);
  });

  it.runIf(DB_KIND === 'postgresql')(
    'PostgreSQL: a game transaction that waits for a free connection and then for a game row lock is FAILED within one storage.userLockWaitMs',
    async () => {
      const lock_wait = 1500;
      const { db, storage } = await instance({ settings: { 'storage.dbMaxConnections': 1, 'storage.userLockWaitMs': lock_wait }, register: counter_table });
      const user = await new_user(storage);
      const holder_user = await lock_holder(db);
      const holder_row = await lock_holder(db);
      await holder_user.ok('BEGIN');
      await holder_user.ok('SELECT user_id FROM "user" WHERE user_id = $1 FOR UPDATE', [user]);
      await begin_holder(holder_row);
      await hold_counter(holder_row, 1n);
      // The user transaction takes the only connection and waits for its user lock; the game transaction waits for that connection.
      const first = request(storage, user, () => 'ran');
      await new Promise((resolve) => setTimeout(resolve, 50));
      const started = performance.now();
      const game = storage
        .run_game_transaction((tx) => storage.lock_game_row(tx, 'test_counter', [1n]) ?? 'locked')
        .then((result) => ({ result, waited: performance.now() - started }));
      // The user transaction commits halfway through the wait of the game transaction, which then takes the connection and waits for the row lock.
      await new Promise((resolve) => setTimeout(resolve, lock_wait / 2));
      await holder_user.ok('ROLLBACK');
      expect(await first).toBe('ran');
      const { result, waited } = await game;
      await holder_row.ok('ROLLBACK');
      expect(result).toBe('FAILED');
      expect(waited).toBeGreaterThanOrEqual(lock_wait - 50);
      expect(waited).toBeLessThan(lock_wait + lock_wait / 4);
      expect(await storage.run_game_transaction((tx) => storage.lock_game_row(tx, 'test_counter', [1n]) ?? 'locked')).toBe('locked');
    },
  );

  it.runIf(DB_KIND === 'postgresql')('PostgreSQL: a content lock_game_row past the lock wait limit throws and the request writes nothing', async () => {
    const { db, storage } = await instance({ settings: { 'storage.userLockWaitMs': LOCK_WAIT_MS } });
    const user = await new_user(storage);
    const holder = await lock_holder(db);
    await holder.ok('BEGIN');
    await holder.ok(PG_LOCK_SQL, [lock_key('game_state', ['boss_game_state', 1n])]);
    let threw = false;
    const result = await request(storage, user, (ctx) => {
      storage.put_state(ctx, quest(1n, 1n));
      try {
        storage.content.lock_game_row(ctx, 'game_state', [BossGameState, 1n]);
      } catch (error) {
        threw = true;
        throw error;
      }
      return 'locked';
    });
    await holder.ok('ROLLBACK');
    expect(threw).toBe(true);
    expect(result).toBe('FAILED');
    expect(storage.read_db().query('SELECT item_id FROM user_state WHERE user_id = $1', [user])).toEqual([]);
  });

  it.runIf(DB_KIND === 'postgresql')('PostgreSQL: of two user transactions that lock two game rows in opposite order, one is FAILED with no write and the other commits', async () => {
    const { db, storage } = await instance({ settings: { 'storage.userLockWaitMs': LOCK_WAIT_MS }, register: counter_table });
    const a = await new_user(storage);
    const b = await new_user(storage);
    // b's user transaction runs on another server instance: the user lock of b, then game row 2.
    const holder = await lock_holder(db);
    await holder.ok('BEGIN');
    await holder.ok('SELECT user_id FROM "user" WHERE user_id = $1 FOR UPDATE', [b]);
    await hold_counter(holder, 2n);
    let holder_lock: Promise<HolderResult> = Promise.resolve({ ok: false, code: 'not sent' });
    const result = await storage.run_user_transaction(a, (ctx) => {
      storage.lock_game_row(ctx, 'test_counter', [1n]);
      storage.put_state(ctx, quest(1n, 1n));
      // b asks for row 1 while a waits for row 2.
      holder_lock = holder.run(PG_LOCK_SQL, [lock_key('test_counter', [1n])], 50);
      if (storage.lock_game_row(ctx, 'test_counter', [2n]) === 'FAILED') return 'pass';
      storage.db(ctx).query('INSERT INTO test_counter (id, n) VALUES ($1, 1)', [a]);
      return 'pass';
    });
    const b_locked = (await holder_lock).ok;
    if (b_locked) {
      await holder.ok('INSERT INTO test_counter (id, n) VALUES ($1, 1)', [b]);
      await holder.ok('COMMIT');
    } else {
      await holder.ok('ROLLBACK');
    }
    expect(result === 'COMMITTED').toBe(!b_locked);
    const winner = result === 'COMMITTED' ? a : b;
    expect(storage.read_db().query('SELECT id FROM test_counter')).toEqual([{ id: winner }]);
    expect(storage.read_db().query('SELECT user_id FROM user_state WHERE user_id = $1', [a])).toEqual(result === 'COMMITTED' ? [{ user_id: a }] : []);
  });
});

describe('lock_game_row and savepoints', () => {
  it.runIf(DB_KIND === 'postgresql')('PostgreSQL: a game row lock taken in a savepoint that returned a failure code is held until the transaction ends', async () => {
    const { db, storage } = await instance({ register: counter_table });
    const user = await new_user(storage);
    const holder = await lock_holder(db);
    await holder.ok(`SET lock_timeout = '${String(LOCK_WAIT_MS)}ms'`);
    const key = lock_key('test_counter', [1n]);
    for (const end of ['pass', 1007] as const) {
      let during: Promise<HolderResult> = Promise.resolve({ ok: false, code: 'not sent' });
      const result = await storage.run_user_transaction(user, (ctx) => {
        const undone = storage.run_savepoint(ctx, () => {
          storage.lock_game_row(ctx, 'test_counter', [1n]);
          return 1007;
        });
        if (undone !== 1007) throw new Error(String(undone));
        // Another server instance asks for the row while this transaction goes on after the savepoint.
        during = holder.run(PG_LOCK_SQL, [key], 50);
        storage.db(ctx).query(`SELECT pg_sleep(${String((LOCK_WAIT_MS * 3) / 1000)})`);
        storage.put_state(ctx, quest(1n, 1n));
        return end;
      });
      expect(result).toBe(end === 'pass' ? 'COMMITTED' : 'REJECTED');
      expect(await during).toEqual({ ok: false, code: '55P03' });
      // The lock ends with the transaction, by commit or by rollback.
      expect((await holder.run(PG_LOCK_SQL, [key])).ok).toBe(true);
    }
  });
});

describe('read_public_state', () => {
  it('returns committed public values of other users in user ID order, leaving out withdrawn users and users without a value', async () => {
    const { db, storage } = await instance();
    const reader = await new_user(storage);
    const [u1, u2, u3, u4] = (await new_users(storage, 4)) as [bigint, bigint, bigint, bigint];
    await request(storage, u1, (ctx) => {
      storage.put_state(ctx, profile(1n));
      storage.put_state(ctx, deck(2n, 20n));
      storage.put_state(ctx, deck(1n, 10n));
    });
    await request(storage, u2, (ctx) => {
      storage.put_state(ctx, profile(2n));
    });
    await request(storage, u3, (ctx) => {
      storage.put_state(ctx, profile(3n));
      storage.delete_user(ctx);
    });
    expect(
      await request(storage, u2, (ctx) => {
        storage.put_state(ctx, profile(98n));
        return 1001;
      }),
    ).toBe(1001);
    // PostgreSQL: another server instance has written u2's profile and not committed yet.
    const holder = DB_KIND === 'postgresql' ? await lock_holder(db) : null;
    await holder?.ok('BEGIN');
    await holder?.ok('UPDATE user_state SET value = $1 WHERE user_id = $2 AND kind = $3', [profile(99n).encode(), u2, 'profile_user_state']);
    const read = await request(storage, reader, (ctx) => {
      storage.put_state(ctx, profile(7n));
      const profiles = storage.read_public_state(ctx, [u4, u3, u2, u1, reader, u2], ProfileUserState);
      const decks = storage.read_public_state(ctx, [u2, u1], DeckUserState);
      return { profiles: profiles.map((p) => [p.user_id, (p.value as ProfileUserState).level]), decks: decks.map((d) => [d.user_id, (d.value as DeckUserState[]).map((x) => x.id)]), taken: storage.take_response_delta(ctx) };
    });
    await holder?.ok('ROLLBACK');
    if (typeof read === 'string') throw new Error(read);
    const expected: [bigint, bigint][] = [
      [reader, 7n],
      [u1, 1n],
      [u2, 2n],
    ];
    expect(read.profiles).toEqual(expected.sort((a, b) => (a[0] < b[0] ? -1 : 1)));
    expect(read.decks).toEqual([[u1, [1n, 2n]]]);
    expect(read.taken.delta.user_state.entries.map((e) => e.kind)).toEqual(['ProfileUserState']);
  });
});
