import * as CoreContract from '../../../generated/contract/core_contract.ts';
import { create_storage_dev } from '../dev/index.ts';
import { StorageMisuse, type GameTx, type Storage } from '../index.ts';
import type { RequestCtx } from '../request_ctx.ts';
import { FIELDS, fields, gate, instance, new_user, outside, raw_rows, request, settle, stop_all } from './helpers.ts';
import { quest, QuestUserState, wallet, WalletServerState } from './kinds.ts';

const GAME_ERROR = 1001;

afterEach(() => {
  stop_all();
});

function progress(value: unknown): bigint {
  return (value as QuestUserState | null)?.progress ?? -1n;
}

describe('user transaction', () => {
  it('runs two concurrent requests of one user one after the other, as if applied in turn', async () => {
    const { storage } = await instance();
    const user = await new_user(storage);
    const add = (id: string): Promise<unknown> =>
      storage.run_request_transaction(user, fields(id), (ctx) => {
        const before = progress(storage.get_state(ctx, QuestUserState, 1n));
        storage.put_state(ctx, quest(1n, before < 0n ? 1n : before + 1n));
        return 'ok';
      });
    expect(await Promise.all([add('a'), add('b')])).toEqual(['ok', 'ok']);
    expect(await request(storage, user, (ctx) => progress(storage.get_state(ctx, QuestUserState, 1n)))).toBe(2n);
  });

  it('leaves user_state, server_state and pending_delta as before a GameError or an exception', async () => {
    const { storage } = await instance();
    const user = await new_user(storage);
    await request(storage, user, (ctx) => {
      storage.put_state(ctx, quest(1n, 5n));
      storage.put_state(ctx, wallet(10n));
    });
    expect(await storage.run_user_transaction(user, (ctx) => (storage.put_state(ctx, quest(2n, 1n)), 'pass'))).toBe('COMMITTED');
    const before = ['user_state', 'server_state', 'pending_delta'].map((t) => raw_rows(storage, t, user));
    const change = (ctx: Parameters<Parameters<typeof storage.run_request_transaction>[2]>[0]): void => {
      storage.put_state(ctx, quest(1n, 6n));
      storage.put_state(ctx, quest(3n, 1n));
      storage.delete_state(ctx, QuestUserState, 2n);
      storage.put_state(ctx, wallet(11n));
      storage.take_response_delta(ctx);
    };
    expect(
      await request(storage, user, (ctx) => {
        change(ctx);
        return GAME_ERROR;
      }),
    ).toBe(GAME_ERROR);
    await expect(
      request(storage, user, (ctx) => {
        change(ctx);
        throw new Error('handler failure');
      }),
    ).rejects.toThrow('handler failure');
    expect(['user_state', 'server_state', 'pending_delta'].map((t) => raw_rows(storage, t, user))).toEqual(before);
  });

  it('reads in a transaction the values the transaction wrote', async () => {
    const { storage } = await instance();
    const user = await new_user(storage);
    const read = await request(storage, user, (ctx) => {
      storage.put_state(ctx, quest(7n, 3n));
      storage.put_state(ctx, wallet(4n));
      const first = progress(storage.get_state(ctx, QuestUserState, 7n));
      storage.delete_state(ctx, QuestUserState, 7n);
      return [first, storage.get_state(ctx, QuestUserState, 7n), (storage.get_state(ctx, WalletServerState, 0n) as WalletServerState).coins];
    });
    expect(read).toEqual([3n, null, 4n]);
  });

  it('read_db sees no row before commit and the row after it; a write through it throws', async () => {
    const { storage } = await instance();
    const user = await new_user(storage);
    const count = (): number => storage.read_db().query('SELECT item_id FROM user_state WHERE user_id = $1', [user]).length;
    // A number result is a failure code, so the count goes back in an object.
    const before_commit = await request(storage, user, (ctx) => {
      storage.put_state(ctx, quest(1n, 1n));
      return { rows: count() };
    });
    expect(before_commit).toEqual({ rows: 0 });
    expect(count()).toBe(1);
    expect(() => storage.read_db().query('DELETE FROM user_state WHERE user_id = $1', [user])).toThrow();
    expect(count()).toBe(1);
  });

  it('a CoreError from the request function leaves no write; a missing or withdrawn user is WITHDRAWN without a call', async () => {
    const { storage } = await instance();
    const user = await new_user(storage);
    expect(
      await request(storage, user, (ctx) => {
        storage.put_state(ctx, quest(1n, 1n));
        return CoreContract.CoreError.CORE_ERROR_INTERNAL;
      }),
    ).toBe(CoreContract.CoreError.CORE_ERROR_INTERNAL);
    expect(raw_rows(storage, 'user_state', user)).toEqual([]);
    let calls = 0;
    const count = (): string => {
      calls += 1;
      return 'called';
    };
    expect(await request(storage, 999_999n, count)).toBe('WITHDRAWN');
    await request(storage, user, (ctx) => {
      storage.delete_user(ctx);
    });
    expect(await request(storage, user, count)).toBe('WITHDRAWN');
    expect(calls).toBe(0);
  });

  it('applies an out-of-request change started during a request of the same user after that request commits', async () => {
    const { storage } = await instance();
    const user = await new_user(storage);
    let seen = -1n;
    let change: Promise<unknown> = Promise.resolve(null);
    await request(storage, user, (ctx) => {
      storage.put_state(ctx, quest(1n, 10n));
      change = outside(() =>
        storage.run_user_transaction(user, (c) => {
          seen = progress(storage.get_state(c, QuestUserState, 1n));
          storage.put_state(c, quest(1n, seen + 1n));
          return 'pass';
        }),
      );
    });
    expect(await change).toBe('COMMITTED');
    expect(seen).toBe(10n);
    expect(raw_rows(storage, 'pending_delta', user)).toHaveLength(1);
  });

  it('run_user_transaction of a withdrawn user and of a user ID without a user row is WITHDRAWN and makes no row', async () => {
    const { storage } = await instance();
    const user = await new_user(storage);
    await request(storage, user, (ctx) => {
      storage.delete_user(ctx);
    });
    const users = storage.read_db().query('SELECT user_id FROM "user"').length;
    for (const id of [user, 424_242n]) {
      expect(await storage.run_user_transaction(id, (ctx) => (storage.put_state(ctx, quest(1n, 1n)), 'pass'))).toBe('WITHDRAWN');
      expect(raw_rows(storage, 'user_state', id)).toEqual([]);
      expect(raw_rows(storage, 'pending_delta', id)).toEqual([]);
    }
    expect(storage.read_db().query('SELECT user_id FROM "user"')).toHaveLength(users);
  });

  it('run_rollback_transaction keeps no write and no pending delta', async () => {
    const { storage } = await instance();
    const user = await new_user(storage);
    let committed = false;
    const result = await storage.run_rollback_transaction(user, (ctx) => {
      storage.put_state(ctx, quest(1n, 1n));
      storage.put_state(ctx, wallet(1n));
      storage.after_commit(ctx, () => {
        committed = true;
      });
      return progress(storage.get_state(ctx, QuestUserState, 1n));
    });
    expect(result).toBe(1n);
    await settle();
    expect(committed).toBe(false);
    for (const table of ['user_state', 'server_state', 'pending_delta']) expect(raw_rows(storage, table, user)).toEqual([]);
  });

  it('throws when a transaction opens inside a transaction', async () => {
    const { storage } = await instance();
    const user = await new_user(storage);
    const other = await new_user(storage);
    const errors = await request(storage, user, (ctx) => {
      const out: string[] = [];
      for (const open of [
        () => storage.run_user_transaction(user, () => 'pass'),
        () => storage.run_user_transaction(other, () => 'pass'),
        () => storage.run_request_transaction(user, FIELDS, () => 'x'),
        () => storage.run_rollback_transaction(other, () => 'x'),
        () => storage.run_game_transaction(() => 'x'),
      ]) {
        try {
          void open();
          out.push('opened');
        } catch {
          out.push('threw');
        }
      }
      storage.put_state(ctx, quest(1n, 1n));
      return out;
    });
    expect(errors).toEqual(['threw', 'threw', 'threw', 'threw', 'threw']);
    const nested = await storage.run_game_transaction(() => {
      try {
        void storage.run_user_transaction(user, () => 'pass');
        return 'opened';
      } catch {
        return 'threw';
      }
    });
    expect(nested).toBe('threw');
  });

  it('throws on every operation with the ctx of an ended transaction and changes nothing', async () => {
    const { storage } = await instance();
    const user = await new_user(storage);
    let kept: Parameters<Parameters<typeof storage.run_request_transaction>[2]>[0] | null = null;
    await request(storage, user, (ctx) => {
      kept = ctx;
      storage.put_state(ctx, quest(1n, 1n));
    });
    const ctx = kept as unknown as Parameters<Parameters<typeof storage.run_request_transaction>[2]>[0];
    const before = raw_rows(storage, 'user_state', user);
    const calls: (() => unknown)[] = [
      () => storage.get_state(ctx, QuestUserState, 1n),
      () => storage.list_state(ctx, QuestUserState),
      () => {
        storage.put_state(ctx, quest(1n, 9n));
      },
      () => {
        storage.delete_state(ctx, QuestUserState, 1n);
      },
      () => storage.take_response_delta(ctx),
      () => storage.db(ctx).query('SELECT 1 AS one'),
      () => {
        storage.after_commit(ctx, () => undefined);
      },
      () => storage.random_u32(ctx),
      () => storage.run_savepoint(ctx, () => 'pass'),
    ];
    for (const call of calls) expect(call).toThrow();
    expect(raw_rows(storage, 'user_state', user)).toEqual(before);
  });
});

describe('game transaction', () => {
  it('a failure code from the function rolls back and is returned; another result commits; a throw rolls back and throws', async () => {
    const { storage } = await instance();
    const user = await new_user(storage);
    const set_created = (at: bigint) => (tx: GameTx): void => {
      storage.db(tx).query('UPDATE "user" SET created_at = $1 WHERE user_id = $2', [at, user]);
    };
    const created = (): unknown => storage.read_db().query('SELECT created_at FROM "user" WHERE user_id = $1', [user])[0]?.created_at;
    const before = created();
    for (const code of [GAME_ERROR, CoreContract.CoreError.CORE_ERROR_INTERNAL]) {
      const result = await storage.run_game_transaction((tx) => {
        set_created(7n)(tx);
        return code;
      });
      expect(result).toBe(code);
      expect(created()).toBe(before);
    }
    await expect(
      storage.run_game_transaction((tx) => {
        set_created(7n)(tx);
        throw new Error('game tx failure');
      }),
    ).rejects.toThrow();
    expect(created()).toBe(before);
    expect(
      await storage.run_game_transaction((tx) => {
        set_created(8n)(tx);
        return 'done';
      }),
    ).toBe('done');
    expect(created()).toBe(8n);
  });

  it('after_commit of a game tx calls the function after commit, not after a failure code rollback', async () => {
    const { storage } = await instance();
    const calls: string[] = [];
    const done = gate();
    await storage.run_game_transaction((tx) => {
      storage.after_commit(tx, () => {
        calls.push('rolled back');
      });
      return GAME_ERROR;
    });
    await storage.run_game_transaction((tx) => {
      storage.after_commit(tx, () => {
        calls.push('a');
      });
      storage.after_commit(tx, () => {
        calls.push('b');
        done.open();
      });
    });
    await done.promise;
    await settle();
    expect(calls).toEqual(['a', 'b']);
  });
});

describe('after_commit', () => {
  it('calls the functions once in order after commit, not for a rollback, a rollback transaction or an undone savepoint', async () => {
    const { storage } = await instance();
    const user = await new_user(storage);
    const calls: string[] = [];
    const done = gate();
    await request(storage, user, (ctx) => {
      storage.after_commit(ctx, () => {
        calls.push('a');
      });
      storage.after_commit(ctx, () => {
        calls.push('b');
        throw new Error('after failure');
      });
      storage.run_savepoint(ctx, () => {
        storage.after_commit(ctx, () => {
          calls.push('undone');
        });
        return GAME_ERROR;
      });
      storage.put_state(ctx, quest(1n, 1n));
      storage.after_commit(ctx, () => {
        calls.push('c');
        done.open();
      });
    });
    await request(storage, user, (ctx) => {
      storage.after_commit(ctx, () => {
        calls.push('rolled back');
      });
      return GAME_ERROR;
    });
    await storage.run_rollback_transaction(user, (ctx) => {
      storage.after_commit(ctx, () => {
        calls.push('rollback transaction');
      });
    });
    await done.promise;
    await settle();
    expect(calls).toEqual(['a', 'b', 'c']);
    expect(raw_rows(storage, 'user_state', user)).toHaveLength(1);
  });
});

describe('on_commit', () => {
  it('calls the functions once in order in the turn of the commit, before the after_commit functions; not for a rollback, a rollback transaction or an undone savepoint', async () => {
    const { storage } = await instance();
    const user = await new_user(storage);
    const calls: string[] = [];
    const committed = await request(storage, user, (ctx) => {
      storage.after_commit(ctx, () => {
        calls.push('after');
      });
      storage.on_commit(ctx, () => {
        calls.push('a');
      });
      storage.on_commit(ctx, () => {
        calls.push('b');
        throw new Error('on_commit failure');
      });
      storage.run_savepoint(ctx, () => {
        storage.on_commit(ctx, () => {
          calls.push('undone');
        });
        return GAME_ERROR;
      });
      storage.on_commit(ctx, () => {
        calls.push('c');
      });
      storage.put_state(ctx, quest(1n, 1n));
      return 'ok';
    });
    // The on_commit functions ran at the commit, before the after_commit function registered first.
    expect(committed).toBe('ok');
    expect(calls).toEqual(['a', 'b', 'c', 'after']);
    await request(storage, user, (ctx) => {
      storage.on_commit(ctx, () => {
        calls.push('rolled back');
      });
      return GAME_ERROR;
    });
    await storage.run_rollback_transaction(user, (ctx) => {
      storage.on_commit(ctx, () => {
        calls.push('rollback transaction');
      });
    });
    await storage.run_game_transaction((tx) => {
      storage.on_commit(tx, () => {
        calls.push('game rolled back');
      });
      return GAME_ERROR;
    });
    await storage.run_game_transaction((tx) => {
      storage.on_commit(tx, () => {
        calls.push('game');
      });
    });
    expect(calls).toEqual(['a', 'b', 'c', 'after', 'game']);
    expect(raw_rows(storage, 'user_state', user)).toHaveLength(1);
  });

  it('a stop while an earlier after_commit function of a committed transaction still runs does not drop its on_commit function; a rolled back one is not called', async () => {
    const started = await instance();
    const storage = started.storage;
    const user = await new_user(storage);
    const calls: string[] = [];
    const held = gate();
    await request(storage, user, (ctx) => {
      storage.after_commit(ctx, () => held.promise);
      storage.on_commit(ctx, () => {
        calls.push('user');
      });
      storage.after_commit(ctx, () => {
        calls.push('later after');
      });
    });
    await storage.run_game_transaction((tx) => {
      storage.after_commit(tx, () => held.promise);
      storage.on_commit(tx, () => {
        calls.push('game');
      });
    });
    await request(storage, user, (ctx) => {
      storage.after_commit(ctx, () => held.promise);
      storage.on_commit(ctx, () => {
        calls.push('rolled back');
      });
      return GAME_ERROR;
    });
    started.stop();
    held.open();
    await create_storage_dev(storage).wait_after_commit();
    expect(calls).toEqual(['user', 'game']);
  });

  it('throws for a ctx or tx that is not open and for a value that is not a function', async () => {
    const { storage } = await instance();
    const user = await new_user(storage);
    let kept: RequestCtx | null = null;
    await request(storage, user, (ctx) => {
      kept = ctx;
      expect(() => {
        storage.on_commit(ctx, 'no function' as never);
      }).toThrow(StorageMisuse);
    });
    expect(() => {
      storage.on_commit(kept as unknown as RequestCtx, () => undefined);
    }).toThrow(StorageMisuse);
    expect(() => {
      storage.on_commit({} as GameTx, () => undefined);
    }).toThrow(StorageMisuse);
  });
});

describe('wait_after_commit', () => {
  it('waits until the after_commit functions and user change applies started so far, and the ones they start, have ended', async () => {
    const applied: bigint[] = [];
    const { storage } = await instance({
      register: (s) => {
        s.content.register_user_change(
          'gift',
          (_ctx, sender) => {
            applied.push(sender);
            return 'pass';
          },
          () => undefined,
        );
      },
    });
    const user = await new_user(storage);
    const other = await new_user(storage);
    const release = gate();
    const calls: string[] = [];
    await request(storage, user, (ctx) => {
      storage.after_commit(ctx, async () => {
        await release.promise;
        calls.push('slow');
      });
      storage.after_commit(ctx, () =>
        storage.run_game_transaction((tx) => {
          storage.after_commit(tx, () => {
            calls.push('chained');
          });
        }),
      );
      storage.send_user_change(ctx, other, 'gift', new Uint8Array([1]));
    });
    let waited = false;
    const waiting = create_storage_dev(storage)
      .wait_after_commit()
      .then(() => {
        waited = true;
      });
    await settle();
    expect(waited).toBe(false);
    release.open();
    await waiting;
    expect(calls).toEqual(['slow', 'chained']);
    expect(applied).toEqual([user]);
    expect(storage.read_db().query('SELECT change_id FROM user_change')).toEqual([]);
    await create_storage_dev(storage).wait_after_commit();
  });
});

describe('synchronous transaction functions', () => {
  it('a transaction function that returns a promise throws and keeps no write', async () => {
    const { storage } = await instance();
    const user = await new_user(storage);
    await expect(
      request(storage, user, async (ctx) => {
        storage.put_state(ctx, quest(1n, 1n));
        await settle();
      }),
    ).rejects.toThrow();
    await expect(
      storage.run_game_transaction(async (tx) => {
        storage.db(tx).query('UPDATE "user" SET created_at = 1 WHERE user_id = $1', [user]);
        await settle();
      }),
    ).rejects.toThrow();
    expect(raw_rows(storage, 'user_state', user)).toEqual([]);
    expect(storage.read_db().query('SELECT created_at FROM "user" WHERE user_id = $1', [user])).not.toEqual([{ created_at: 1n }]);
  });
});

describe('savepoint', () => {
  it('a GameError or CoreError undoes only the savepoint changes; the transaction goes on and its delta has no undone item', async () => {
    const { storage } = await instance();
    const user = await new_user(storage);
    for (const code of [GAME_ERROR, CoreContract.CoreError.CORE_ERROR_INTERNAL]) {
      const result = await request(storage, user, (ctx) => {
        storage.put_state(ctx, quest(1n, BigInt(code)));
        const inner = storage.run_savepoint(ctx, () => {
          storage.put_state(ctx, quest(2n, 1n));
          storage.put_state(ctx, wallet(5n));
          const change = new CoreContract.ItemChange();
          change.item_id = 1;
          storage.add_item_change(ctx, change);
          return code;
        });
        const kept = storage.run_savepoint(ctx, () => {
          storage.put_state(ctx, quest(3n, BigInt(code)));
          return 'pass';
        });
        const taken = storage.take_response_delta(ctx);
        return { inner, kept, ids: taken.delta.user_state.entries.map((e) => e.id), changes: taken.delta.item_changes.length };
      });
      expect(result).toEqual({ inner: code, kept: 'pass', ids: [1n, 3n], changes: 0 });
    }
    const after = await request(storage, user, (ctx) => [storage.list_state(ctx, QuestUserState).map((q) => (q as QuestUserState).id), storage.get_state(ctx, WalletServerState, 0n)]);
    expect(after).toEqual([[1n, 3n], null]);
  });

  it('a savepoint that called delete_user and failed puts back the delta record, item_changes and item_mails of before it', async () => {
    const { storage } = await instance();
    const user = await new_user(storage);
    const result = await request(storage, user, (ctx) => {
      storage.put_state(ctx, quest(1n, 1n));
      const change = new CoreContract.ItemChange();
      change.item_id = 7;
      change.ref = 'before';
      storage.add_item_change(ctx, change);
      const mail = new CoreContract.ItemMail();
      mail.ref = 'before';
      storage.add_item_mail(ctx, mail);
      const inner = storage.run_savepoint(ctx, () => {
        storage.delete_user(ctx);
        return GAME_ERROR;
      });
      const deleted = ctx.user_deleted;
      const taken = storage.take_response_delta(ctx);
      return {
        inner,
        deleted,
        ids: taken.delta.user_state.entries.map((e) => e.id),
        changes: taken.delta.item_changes.map((c) => c.ref),
        mails: taken.delta.item_mails.map((m) => m.ref),
      };
    });
    expect(result).toEqual({ inner: GAME_ERROR, deleted: false, ids: [1n], changes: ['before'], mails: ['before'] });
    expect(storage.read_db().query('SELECT withdrawn_at FROM "user" WHERE user_id = $1', [user])).toEqual([{ withdrawn_at: null }]);
    expect(raw_rows(storage, 'user_state', user)).toHaveLength(1);
  });
});

describe('a failed statement', () => {
  function counter_table(s: Storage): void {
    s.register_table('test_counter', 'game', [{ name: 'id', type: 'int64' }, { name: 'n', type: 'int64' }], ['id'], null, null);
  }

  it('ends the transaction on both DBs: a function that catches it and goes on is FAILED and leaves no write', async () => {
    const { storage } = await instance({ register: counter_table });
    const user = await new_user(storage);
    const insert = 'INSERT INTO test_counter (id, n) VALUES ($1, 1)';
    const game = await storage.run_game_transaction((tx) => {
      storage.db(tx).query(insert, [1n]);
      try {
        storage.db(tx).query(insert, [1n]);
      } catch {
        // The caller goes on after the failed statement.
      }
      return { ok: true };
    });
    expect(game).toBe('FAILED');
    let after_called = false;
    const user_result = await request(storage, user, (ctx) => {
      storage.put_state(ctx, quest(1n, 1n));
      storage.db(ctx).query(insert, [2n]);
      storage.after_commit(ctx, () => {
        after_called = true;
      });
      try {
        storage.db(ctx).query(insert, [2n]);
      } catch {
        // The caller goes on after the failed statement.
      }
      return 'done';
    });
    expect(user_result).toBe('FAILED');
    const change = await storage.run_user_transaction(user, (ctx) => {
      try {
        storage.db(ctx).query('SELECT no_such_column FROM test_counter');
      } catch {
        // The caller goes on after the failed statement.
      }
      storage.put_state(ctx, quest(2n, 1n));
      return 'pass';
    });
    expect(change).toBe('FAILED');
    await create_storage_dev(storage).wait_after_commit();
    expect(after_called).toBe(false);
    expect(storage.read_db().query('SELECT id FROM test_counter')).toEqual([]);
    expect(raw_rows(storage, 'user_state', user)).toEqual([]);
    expect(raw_rows(storage, 'pending_delta', user)).toEqual([]);
    expect(await storage.run_game_transaction((tx) => storage.db(tx).query(insert, [3n]).length + 100)).toBe(100);
  });
});

describe('statements per delta', () => {
  /** Counts the statements of the transactions' connections while `fn` runs. */
  async function counted(storage: Storage, user: bigint, items: number, fn: (ctx: RequestCtx) => void): Promise<number> {
    let count = -1;
    const result = await request(storage, user, (ctx) => {
      for (let i = 1; i <= items; i += 1) storage.put_state(ctx, quest(BigInt(i), BigInt(items)));
      const conn = storage.db(ctx).owner?.conn as { query: (...args: unknown[]) => unknown };
      const query = conn.query;
      let n = 0;
      conn.query = (...args: unknown[]) => {
        n += 1;
        return query.apply(conn, args);
      };
      try {
        fn(ctx);
      } finally {
        conn.query = query;
      }
      count = n;
      return 'counted';
    });
    expect(result).toBe('counted');
    return count;
  }

  it('take_response_delta and read_full_state run as many statements for 50 items as for 2', async () => {
    const { storage } = await instance();
    const small = await new_user(storage);
    const large = await new_user(storage);
    const take = (ctx: RequestCtx): void => {
      storage.take_response_delta(ctx);
    };
    const full = (ctx: RequestCtx): void => {
      storage.read_full_state(ctx);
    };
    expect(await counted(storage, large, 50, take)).toBe(await counted(storage, small, 2, take));
    expect(await counted(storage, large, 50, full)).toBe(await counted(storage, small, 2, full));
    const delta = await request(storage, large, (ctx) => {
      for (let i = 1; i <= 50; i += 1) storage.put_state(ctx, quest(BigInt(i), 7n));
      return storage.take_response_delta(ctx).delta.user_state.entries.map((e) => QuestUserState.decode(e.value)?.progress);
    });
    expect(delta).toEqual(Array.from({ length: 50 }, () => 7n));
  });
});

describe('run_read_only', () => {
  it('a write in the function of a ctx or a game tx throws', async () => {
    const { storage } = await instance({ register: (s) => {
      s.register_table('test_counter', 'game', [{ name: 'id', type: 'int64' }, { name: 'n', type: 'int64' }], ['id'], null, null);
    } });
    const user = await new_user(storage);
    const outcomes = await request(storage, user, (ctx) =>
      [
        () => {
          storage.put_state(ctx, quest(1n, 1n));
        },
        () => {
          storage.delete_state(ctx, QuestUserState, 1n);
        },
        () => {
          storage.put_state(ctx, wallet(1n));
        },
        () => storage.db(ctx).query('INSERT INTO test_counter (id, n) VALUES (1, 1)'),
      ].map((write) => {
        try {
          storage.run_read_only(ctx, write);
          return 'wrote';
        } catch {
          return 'threw';
        }
      }),
    );
    expect(outcomes).toEqual(['threw', 'threw', 'threw', 'threw']);
    const game = await storage.run_game_transaction((tx) => {
      try {
        storage.run_read_only(tx, () => storage.db(tx).query('INSERT INTO test_counter (id, n) VALUES (1, 1)'));
        return 'wrote';
      } catch {
        return storage.run_read_only(tx, () => storage.db(tx).query('SELECT COUNT(*) AS n FROM test_counter')[0]?.n);
      }
    });
    expect(game).toBe(0n);
  });
});
