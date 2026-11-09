/** `fail_transaction` (`storage` `### transaction`): a transaction marked failed by a core module is `FAILED`. */
import { StorageMisuse, type GameTx, type Storage } from '../index.ts';
import type { RequestCtx } from '../request_ctx.ts';
import { instance, new_user, raw_rows, request, stop_all } from './helpers.ts';
import { BossGameState, quest, QuestUserState, wallet } from './kinds.ts';

afterEach(() => {
  stop_all();
});

const GAME_ERROR = 1001;
const INSERT = 'INSERT INTO test_counter (id, n) VALUES ($1, $2)';

function tables(s: Storage): void {
  s.register_table('test_counter', 'game', [{ name: 'id', type: 'int64' }, { name: 'n', type: 'int64' }], ['id'], null, null);
}

/** What a call throws, or null. */
function thrown(call: () => unknown): unknown {
  try {
    call();
    return null;
  } catch (error) {
    return error;
  }
}

function counter_ids(storage: Storage): unknown[] {
  return storage
    .read_db()
    .query('SELECT id FROM test_counter ORDER BY id')
    .map((row) => row['id']);
}

describe('fail_transaction', () => {
  it('in run_request_transaction after put_state: a later get_state throws, and the function that catches it and returns normally is FAILED with the put_state not saved', async () => {
    const { storage } = await instance();
    const user = await new_user(storage);
    const before = raw_rows(storage, 'user_state', user);
    let later: unknown = null;
    const result = await request(storage, user, (ctx) => {
      storage.put_state(ctx, quest(1n, 5n));
      storage.fail_transaction(ctx);
      later = thrown(() => storage.get_state(ctx, QuestUserState, 1n));
      return { done: true };
    });
    expect(later).toBeInstanceOf(Error);
    expect(later).not.toBeInstanceOf(StorageMisuse);
    expect(result).toBe('FAILED');
    expect(raw_rows(storage, 'user_state', user)).toEqual(before);
    expect(await request(storage, user, (ctx) => storage.get_state(ctx, QuestUserState, 1n))).toBeNull();
  });

  it('makes every later query and storage operation on the transaction throw a value that is not a StorageMisuse', async () => {
    const { storage } = await instance({ register: tables });
    const user = await new_user(storage);
    const errors: unknown[] = [];
    const result = await request(storage, user, (ctx) => {
      storage.fail_transaction(ctx);
      const calls: (() => unknown)[] = [
        () => storage.db(ctx),
        () => {
          storage.put_state(ctx, wallet(1n));
        },
        () => storage.list_state(ctx, QuestUserState),
        () => {
          storage.delete_state(ctx, QuestUserState, 1n);
        },
        () => storage.read_public_state(ctx, [user], QuestUserState),
        () => storage.take_response_delta(ctx),
        () => storage.lock_game_row(ctx, 'test_counter', [1n]),
        () => {
          storage.content.lock_game_row(ctx, 'game_state', [BossGameState, 1n]);
        },
        () => {
          storage.after_commit(ctx, () => undefined);
        },
        () => {
          storage.on_commit(ctx, () => undefined);
        },
        () => storage.run_savepoint(ctx, () => 'pass'),
        () => storage.run_read_only(ctx, () => 1),
        () => storage.random_u32(ctx),
      ];
      for (const call of calls) errors.push(thrown(call));
      return 'pass';
    });
    expect(result).toBe('FAILED');
    expect(errors).toHaveLength(13);
    for (const error of errors) {
      expect(error).toBeInstanceOf(Error);
      expect(error).not.toBeInstanceOf(StorageMisuse);
    }
  });

  it('a second fail_transaction on a transaction it already marked does nothing, and the transaction stays FAILED with no write', async () => {
    const { storage } = await instance({ register: tables });
    const user = await new_user(storage);
    const before = raw_rows(storage, 'user_state', user);
    let second: unknown = 'not called';
    const result = await request(storage, user, (ctx) => {
      storage.put_state(ctx, quest(1n, 5n));
      storage.fail_transaction(ctx);
      second = thrown(() => {
        storage.fail_transaction(ctx);
      });
      return { done: true };
    });
    expect(second).toBeNull();
    expect(result).toBe('FAILED');
    expect(raw_rows(storage, 'user_state', user)).toEqual(before);
    let game_second: unknown = 'not called';
    const game = await storage.run_game_transaction((tx: GameTx) => {
      storage.db(tx).query(INSERT, [1n, 1n]);
      storage.fail_transaction(tx);
      game_second = thrown(() => {
        storage.fail_transaction(tx);
      });
      return { inserted: true };
    });
    expect(game_second).toBeNull();
    expect(game).toBe('FAILED');
    expect(counter_ids(storage)).toEqual([]);
  });

  it('a query through a db handle taken before fail_transaction throws, and run_game_transaction is FAILED with no write, also when the function returns a value', async () => {
    const { storage } = await instance({ register: tables });
    let later: unknown = null;
    const result = await storage.run_game_transaction((tx: GameTx) => {
      const handle = storage.db(tx);
      handle.query(INSERT, [1n, 1n]);
      storage.fail_transaction(tx);
      later = thrown(() => handle.query('SELECT 1 AS one'));
      return { inserted: true };
    });
    expect(later).toBeInstanceOf(Error);
    expect(later).not.toBeInstanceOf(StorageMisuse);
    expect(result).toBe('FAILED');
    expect(counter_ids(storage)).toEqual([]);
  });

  it('is FAILED when the function throws, in each transaction operation, and no write remains', async () => {
    const { storage } = await instance({ register: tables });
    const user = await new_user(storage);
    const fail = (ctx_or_tx: RequestCtx | GameTx): never => {
      storage.db(ctx_or_tx).query(INSERT, [1n, 1n]);
      storage.fail_transaction(ctx_or_tx);
      throw new Error('after fail_transaction');
    };
    expect(await storage.run_user_transaction(user, (ctx) => fail(ctx))).toBe('FAILED');
    expect(await storage.run_request_transaction(user, { request_name: 'Test', request_id: 'r-2', silent: false, retry: false, session_id: '', client_version: '', platform: '' }, (ctx) => fail(ctx))).toBe('FAILED');
    expect(await storage.run_rollback_transaction(user, (ctx) => fail(ctx))).toBe('FAILED');
    expect(await storage.run_game_transaction((tx) => fail(tx))).toBe('FAILED');
    expect(counter_ids(storage)).toEqual([]);
  });

  it('comes before the other result rules: a GameError return, a pass of run_user_transaction and a run_rollback_transaction result are FAILED, and no pending_delta is written', async () => {
    const { storage } = await instance();
    const user = await new_user(storage);
    const pending = raw_rows(storage, 'pending_delta', user);
    expect(
      await request(storage, user, (ctx) => {
        storage.fail_transaction(ctx);
        return GAME_ERROR;
      }),
    ).toBe('FAILED');
    expect(
      await storage.run_user_transaction(user, (ctx) => {
        storage.put_state(ctx, quest(2n, 1n));
        storage.fail_transaction(ctx);
        return 'pass';
      }),
    ).toBe('FAILED');
    expect(
      await storage.run_rollback_transaction(user, (ctx) => {
        storage.fail_transaction(ctx);
        return { read: true };
      }),
    ).toBe('FAILED');
    expect(raw_rows(storage, 'pending_delta', user)).toEqual(pending);
  });

  it('comes before the statement failure rule: a function that throws the failure of its own failed statement after fail_transaction is FAILED instead of throwing it', async () => {
    const { storage } = await instance({ register: tables });
    await storage.run_game_transaction((tx) => {
      storage.db(tx).query(INSERT, [1n, 1n]);
      return { inserted: true };
    });
    let duplicate: unknown = null;
    const result = await storage.run_game_transaction((tx) => {
      storage.db(tx).query(INSERT, [2n, 1n]);
      try {
        storage.db(tx).query(INSERT, [1n, 2n]);
      } catch (error) {
        duplicate = error;
        storage.fail_transaction(tx);
        throw error;
      }
      return { inserted: true };
    });
    expect(duplicate).toBeInstanceOf(Error);
    expect(result).toBe('FAILED');
    expect(counter_ids(storage)).toEqual([1n]);
  });

  it('inside a run_savepoint function that then returns pass or a GameError: run_savepoint throws, and the request is FAILED with no write, also of before the savepoint', async () => {
    const { storage } = await instance();
    const user = await new_user(storage);
    const before = raw_rows(storage, 'user_state', user);
    for (const inner of ['pass', GAME_ERROR] as const) {
      let savepoint: unknown = null;
      const result = await request(storage, user, (ctx) => {
        storage.put_state(ctx, quest(1n, 1n));
        savepoint = thrown(() =>
          storage.run_savepoint(ctx, () => {
            storage.put_state(ctx, quest(2n, 1n));
            storage.fail_transaction(ctx);
            return inner;
          }),
        );
        return { done: true };
      });
      expect(savepoint).toBeInstanceOf(Error);
      expect(savepoint).not.toBeInstanceOf(StorageMisuse);
      expect(result).toBe('FAILED');
    }
    expect(raw_rows(storage, 'user_state', user)).toEqual(before);
  });

  it('does not call after_commit and on_commit functions registered before it', async () => {
    const { storage } = await instance();
    const user = await new_user(storage);
    const called: string[] = [];
    const result = await request(storage, user, (ctx) => {
      storage.after_commit(ctx, () => called.push('after'));
      storage.on_commit(ctx, () => called.push('on'));
      storage.fail_transaction(ctx);
      return { done: true };
    });
    expect(result).toBe('FAILED');
    await storage.wait_after_commit();
    expect(called).toEqual([]);
  });

  it('with an invalid ctx or game tx, or one whose transaction ended, throws a StorageMisuse; the next transaction of that user commits', async () => {
    const { storage } = await instance();
    const user = await new_user(storage);
    expect(thrown(() => {
        storage.fail_transaction({} as RequestCtx);
      })).toBeInstanceOf(StorageMisuse);
    expect(thrown(() => {
        storage.fail_transaction(null as unknown as RequestCtx);
      })).toBeInstanceOf(StorageMisuse);
    let kept: RequestCtx | null = null;
    expect(
      await request(storage, user, (ctx) => {
        kept = ctx;
        storage.fail_transaction(ctx);
        return { done: true };
      }),
    ).toBe('FAILED');
    expect(thrown(() => {
        storage.fail_transaction(kept as unknown as RequestCtx);
      })).toBeInstanceOf(StorageMisuse);
    expect(
      await request(storage, user, (ctx) => {
        storage.put_state(ctx, quest(3n, 1n));
        return { done: true };
      }),
    ).toEqual({ done: true });
    expect(await request(storage, user, (ctx) => storage.get_state(ctx, QuestUserState, 3n))).not.toBeNull();
  });

  it('is not a member of the content storage object', async () => {
    const { storage } = await instance();
    expect('fail_transaction' in storage.content).toBe(false);
  });
});
