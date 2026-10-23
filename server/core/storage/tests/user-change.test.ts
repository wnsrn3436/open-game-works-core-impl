import * as CoreContract from '../../../generated/contract/core_contract.ts';
import type { HookChangeSource, Storage, UserChangeFailure } from '../index.ts';
import type { RequestCtx } from '../request_ctx.ts';
import { core_settings, DB_KIND, gate, instance, lock_holder, new_db, new_user, raw_rows, request, settle, started, stop_all, TestClock, START_TIME } from './helpers.ts';
import { quest, QuestUserState } from './kinds.ts';

afterEach(() => {
  stop_all();
});

const GAME_ERROR = 1007;

interface Log {
  applied: { target: bigint; sender: bigint; payload: number[]; source: HookChangeSource | null }[];
  failed: { sender: bigint; target: bigint; failure: UserChangeFailure; source: HookChangeSource | null }[];
}

interface Behavior {
  apply?: 'pass' | 'reject' | 'throw';
}

/** Registers `gift`: apply puts a quest of the payload's first byte on the target; fail puts quest 999 on the sender. */
function gift(log: Log, behavior: Behavior = {}): (s: Storage) => void {
  return (s) => {
    s.content.register_user_change(
      'gift',
      (ctx, sender, payload) => {
        if (behavior.apply === 'throw') throw new Error('apply failure');
        if (behavior.apply === 'reject') return GAME_ERROR;
        s.put_state(ctx, quest(BigInt(payload[0] ?? 0), sender));
        log.applied.push({ target: ctx.user_id, sender, payload: [...payload], source: ctx.hook_change_source });
        return 'pass';
      },
      (ctx, target, _payload, failure) => {
        s.put_state(ctx, quest(999n, target));
        log.failed.push({ sender: ctx.user_id, target, failure, source: ctx.hook_change_source });
      },
    );
  };
}

function new_log(): Log {
  return { applied: [], failed: [] };
}

function change_rows(storage: Storage): { change_id: bigint; phase: string; attempts: number; next_attempt_at: bigint; fail_reason: string }[] {
  return storage.read_db().query('SELECT change_id, phase, attempts, next_attempt_at, fail_reason FROM user_change ORDER BY change_id') as never;
}

/**
 * Sends `gift` and, when the send commits, waits for its processing: `after_commit` functions run in order, so the
 * one registered after `send_user_change` runs once the change was processed.
 */
async function send(storage: Storage, sender: bigint, target: bigint, byte = 1, fail = false, more: (ctx: RequestCtx) => void = () => undefined): Promise<unknown> {
  const done = gate();
  const result = await request(storage, sender, (ctx) => {
    storage.send_user_change(ctx, target, 'gift', Uint8Array.from([byte]));
    more(ctx);
    storage.after_commit(ctx, done.open);
    return fail ? GAME_ERROR : 'sent';
  });
  if (!fail) await done.promise;
  return result;
}

describe('user change', () => {
  it('a committed send calls apply once and leaves a pending delta on the target; a rolled back send calls nothing', async () => {
    const log = new_log();
    const { storage } = await instance({ register: gift(log) });
    const sender = await new_user(storage);
    const target = await new_user(storage);
    expect(await send(storage, sender, target, 1, true)).toBe(GAME_ERROR);
    expect(await send(storage, sender, target, 2)).toBe('sent');
    expect(log.applied.map((a) => a.payload)).toEqual([[2]]);
    expect(raw_rows(storage, 'pending_delta', target)).toHaveLength(1);
    expect(change_rows(storage)).toEqual([]);
    expect(await storage.run_user_changes()).toBe(0);
    expect(log.applied).toHaveLength(1);
  });

  it('apply runs with the change source UserChange and ref <name>:<change_id>', async () => {
    const log = new_log();
    const { storage } = await instance({ register: gift(log) });
    const sender = await new_user(storage);
    const target = await new_user(storage);
    await send(storage, sender, target);
    expect(log.applied[0]?.source?.source).toBe(CoreContract.ItemChangeSource.ITEM_CHANGE_SOURCE_USER_CHANGE);
    expect(log.applied[0]?.source?.ref).toMatch(/^gift:[1-9][0-9]*$/);
  });

  it('a GameError from apply leaves no target change and calls fail once with rejected and the code; a withdrawn target calls fail with withdrawn; with a withdrawn sender only the row goes', async () => {
    const log = new_log();
    const { storage } = await instance({ register: gift(log, { apply: 'reject' }) });
    const sender = await new_user(storage);
    const target = await new_user(storage);
    await send(storage, sender, target);
    expect(raw_rows(storage, 'user_state', target)).toEqual([]);
    expect(log.failed.map((f) => [f.sender, f.target, f.failure])).toEqual([[sender, target, { reason: 'rejected', code: GAME_ERROR }]]);
    expect(log.failed[0]?.source?.ref).toMatch(/^gift:/);
    expect(await request(storage, sender, (ctx) => (storage.get_state(ctx, QuestUserState, 999n) as ReturnType<typeof quest>).progress)).toBe(target);

    const log2 = new_log();
    const second = await instance({ register: gift(log2) });
    const s2 = await new_user(second.storage);
    const t2 = await new_user(second.storage);
    await request(second.storage, t2, (ctx) => {
      second.storage.delete_user(ctx);
    });
    await send(second.storage, s2, t2);
    expect(log2.applied).toEqual([]);
    expect(log2.failed.map((f) => f.failure)).toEqual([{ reason: 'withdrawn' }]);

    const log3 = new_log();
    const third = await instance({ register: gift(log3) });
    const s3 = await new_user(third.storage);
    const t3 = await new_user(third.storage);
    await send(third.storage, s3, t3, 1, false, (ctx) => {
      third.storage.delete_user(ctx);
    });
    expect(log3.applied).toHaveLength(1);
    expect(change_rows(third.storage)).toEqual([]);

    const log4 = new_log();
    const fourth = await instance({ register: gift(log4) });
    const s4 = await new_user(fourth.storage);
    const t4 = await new_user(fourth.storage);
    await request(fourth.storage, t4, (ctx) => {
      fourth.storage.delete_user(ctx);
    });
    await send(fourth.storage, s4, t4, 1, false, (ctx) => {
      fourth.storage.delete_user(ctx);
    });
    expect(log4.applied).toEqual([]);
    expect(log4.failed).toEqual([]);
    expect(change_rows(fourth.storage)).toEqual([]);
  });

  it('a row committed before the server instance stopped is applied by the next run_user_changes; two instances on one row apply it once', async () => {
    const db = await new_db();
    const log = new_log();
    const first = started({ db, register: gift(log) });
    const sender = await new_user(first.storage);
    const target = await new_user(first.storage);
    await request(first.storage, sender, (ctx) => {
      first.storage.after_commit(ctx, () => {
        first.stop();
      });
      first.storage.send_user_change(ctx, target, 'gift', Uint8Array.from([3]));
    });
    await settle();
    expect(log.applied).toEqual([]);
    const a = started({ db, register: gift(log) });
    const b = started({ db, register: gift(log) });
    try {
      expect(change_rows(a.storage)).toHaveLength(1);
      const counts = await Promise.all([a.storage.run_user_changes(), b.storage.run_user_changes()]);
      expect(counts).toEqual([1, 1]);
      expect(log.applied.map((x) => x.payload)).toEqual([[3]]);
      expect(change_rows(a.storage)).toEqual([]);
    } finally {
      a.stop();
      b.stop();
    }
  });

  it('leaves rows of names this instance did not register, in phase apply and fail and more than the batch size, and applies the registered row after them', async () => {
    const log = new_log();
    const batch = 3;
    const { storage, clock } = await instance({ settings: { 'storage.userChangeBatchSize': batch }, register: gift(log) });
    const sender = await new_user(storage);
    const target = await new_user(storage);
    const now = clock.now();
    const insert =
      'INSERT INTO user_change (name, sender_id, target_id, payload, phase, fail_reason, fail_code, attempts, next_attempt_at, created_at) ' +
      'VALUES ($1, $2, $3, $4, $5, $6, $7, 0, $8, $8)';
    // Rows a server instance of another build sent, due before the registered row.
    await storage.run_game_transaction((tx) => {
      for (let i = 0; i < batch + 2; i += 1) {
        const fail = i % 2 === 1;
        storage.db(tx).query(insert, ['other_gift', sender, target, Uint8Array.from([9]), fail ? 'fail' : 'apply', fail ? 'rejected' : '', fail ? GAME_ERROR : 0, now - 1000n + BigInt(i)]);
      }
      storage.db(tx).query(insert, ['gift', sender, target, Uint8Array.from([5]), 'apply', '', 0, now]);
      return { inserted: true };
    });
    const others = (): unknown[] => storage.read_db().query("SELECT * FROM user_change WHERE name = 'other_gift' ORDER BY change_id");
    const before = others();
    expect(before).toHaveLength(batch + 2);
    expect(await storage.run_user_changes()).toBe(1);
    expect(log.applied.map((a) => a.payload)).toEqual([[5]]);
    expect(log.failed).toEqual([]);
    expect(others()).toEqual(before);
    expect(await storage.run_user_changes()).toBe(0);
    expect(others()).toEqual(before);
    expect(storage.read_db().query("SELECT change_id FROM user_change WHERE name = 'gift'")).toEqual([]);
  });

  it.runIf(DB_KIND === 'postgresql')('PostgreSQL: run_user_changes is FAILED, not a rejection, when the read connection fails after it picked the rows', async () => {
    const log = new_log();
    // A read statement waits for a lock up to `storage.userLockWaitMs`, then fails as a lock failure.
    const { db, storage, clock } = await instance({ settings: { 'storage.userLockWaitMs': 300, 'storage.dbAnswerWaitMs': 1000 }, register: gift(log) });
    const sender = await new_user(storage);
    const target = await new_user(storage);
    const insert =
      'INSERT INTO user_change (name, sender_id, target_id, payload, phase, fail_reason, fail_code, attempts, next_attempt_at, created_at) ' +
      "VALUES ('gift', $1, $2, $3, 'apply', '', 0, 0, $4, $4)";
    await storage.run_game_transaction((tx) => {
      for (let i = 1; i <= 3; i += 1) storage.db(tx).query(insert, [sender, target, Uint8Array.from([i]), clock.now() - 10n + BigInt(i)]);
      return { inserted: true };
    });
    // Another server instance holds the target's user lock, so the first row's apply waits while it locks user_change.
    const holder = await lock_holder(db);
    await holder.ok('BEGIN');
    await holder.ok('SELECT user_id FROM "user" WHERE user_id = $1 FOR UPDATE', [target]);
    // The rows are picked and the first row read before the promise is handed back.
    const run = storage.run_user_changes();
    await holder.ok('LOCK TABLE user_change IN ACCESS EXCLUSIVE MODE');
    const result = await run;
    await holder.ok('ROLLBACK');
    expect(result).toBe('FAILED');
    expect(log.applied).toEqual([]);
    expect(storage.read_db().query("SELECT change_id FROM user_change WHERE name = 'gift'")).toHaveLength(3);
  });

  it('a FAILED apply is tried again at the retry intervals and after the last attempt fail is called with failed', async () => {
    const log = new_log();
    const settings = core_settings();
    const initial = BigInt(Number(settings['storage.userChangeRetryInitialMs']));
    const factor = BigInt(Number(settings['storage.userChangeRetryFactorPermille']));
    const max_interval = BigInt(Number(settings['storage.userChangeRetryMaxIntervalMs']));
    const attempts = Number(settings['storage.userChangeRetryMaxAttempts']);
    const { storage, clock } = await instance({ register: gift(log, { apply: 'throw' }) });
    const sender = await new_user(storage);
    const target = await new_user(storage);
    await send(storage, sender, target);
    let interval = initial;
    for (let n = 1; n < attempts; n += 1) {
      const [row] = change_rows(storage);
      expect(row?.phase).toBe('apply');
      expect(row?.attempts).toBe(n);
      expect(row?.next_attempt_at).toBe(clock.now() + interval);
      expect(await storage.run_user_changes()).toBe(0);
      clock.advance(interval);
      expect(await storage.run_user_changes()).toBe(1);
      interval = (interval * factor) / 1000n;
      if (interval > max_interval) interval = max_interval;
    }
    expect(change_rows(storage)).toEqual([]);
    expect(log.failed.map((f) => f.failure)).toEqual([{ reason: 'failed' }]);
  });

  it('an apply output that is neither pass nor a failure code rolls back like a throw, is tried again and after the last attempt calls fail with failed', async () => {
    const log = new_log();
    const wrong: unknown[] = [undefined, null, 0, -1, 1.5, 2 ** 31, 'nope', {}];
    const settings = core_settings();
    const max_interval = BigInt(Number(settings['storage.userChangeRetryMaxIntervalMs']));
    const attempts = Number(settings['storage.userChangeRetryMaxAttempts']);
    let calls = 0;
    const { storage, clock } = await instance({
      register: (s) => {
        s.content.register_user_change(
          'bad',
          (ctx, _sender, payload) => {
            calls += 1;
            s.put_state(ctx, quest(5n, 5n));
            return wrong[payload[0] ?? 0] as never;
          },
          (_ctx, target, _payload, failure) => {
            log.failed.push({ sender: 0n, target, failure, source: null });
          },
        );
      },
    });
    const sender = await new_user(storage);
    const target = await new_user(storage);
    for (let i = 0; i < wrong.length; i += 1) {
      const done = gate();
      await request(storage, sender, (ctx) => {
        storage.send_user_change(ctx, target, 'bad', Uint8Array.from([i]));
        storage.after_commit(ctx, done.open);
      });
      await done.promise;
    }
    expect(calls).toBe(wrong.length);
    expect(change_rows(storage).map((r) => [r.phase, r.attempts, r.next_attempt_at, r.fail_reason])).toEqual(wrong.map(() => ['apply', 1, clock.now() + BigInt(Number(settings['storage.userChangeRetryInitialMs'])), '']));
    expect(raw_rows(storage, 'user_state', target)).toEqual([]);
    expect(log.failed).toEqual([]);
    for (let n = 1; n < attempts; n += 1) {
      clock.advance(max_interval);
      expect(await storage.run_user_changes()).toBe(wrong.length);
    }
    expect(calls).toBe(wrong.length * attempts);
    expect(change_rows(storage)).toEqual([]);
    expect(raw_rows(storage, 'user_state', target)).toEqual([]);
    expect(log.failed.map((f) => f.failure)).toEqual(wrong.map(() => ({ reason: 'failed' })));
  });

  it('a row that throws a non-DB error in run_user_changes does not stop the rows after it, and the error reaches the caller without an unhandled rejection', async () => {
    const log = new_log();
    const unhandled: unknown[] = [];
    const listen = (reason: unknown): void => {
      unhandled.push(reason);
    };
    process.on('unhandledRejection', listen);
    try {
      const { db, storage } = await instance({ register: gift(log, { apply: 'reject' }) });
      const sender = await new_user(storage);
      const target = await new_user(storage);
      // Moving the first row to phase fail throws a DB error that is not a DB failure.
      const holder = await lock_holder(db);
      if (DB_KIND === 'postgresql') {
        await holder.ok(`CREATE FUNCTION stop_update() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'stop'; END $$`);
        await holder.ok('CREATE TRIGGER stop_update BEFORE UPDATE ON user_change FOR EACH ROW WHEN (OLD.change_id = 1) EXECUTE FUNCTION stop_update()');
      } else {
        await holder.ok(`CREATE TRIGGER stop_update BEFORE UPDATE ON user_change WHEN OLD.change_id = 1 BEGIN SELECT RAISE(ABORT, 'stop'); END`);
      }
      // Both rows are due before they are processed after commit.
      const hold = gate();
      await request(storage, sender, (ctx) => {
        storage.after_commit(ctx, () => hold.promise);
        storage.send_user_change(ctx, target, 'gift', Uint8Array.from([1]));
        storage.send_user_change(ctx, target, 'gift', Uint8Array.from([2]));
      });
      const run = storage.run_user_changes();
      await expect(run).rejects.toThrow();
      expect(change_rows(storage).map((r) => [r.change_id, r.phase])).toEqual([[1n, 'apply']]);
      expect(log.failed.map((f) => f.failure)).toEqual([{ reason: 'rejected', code: GAME_ERROR }]);
      hold.open();
      await storage.wait_after_commit();
      await settle();
      expect(unhandled).toEqual([]);
    } finally {
      process.off('unhandledRejection', listen);
    }
  });

  it('a row whose processing throws outside its apply and fail functions is left out of later run_user_changes selections of that server instance, and the thrown error names its change_id', async () => {
    const log = new_log();
    const db = await new_db();
    const settings = { 'storage.userChangeBatchSize': 1 };
    const { storage } = await instance({ db, settings, register: gift(log, { apply: 'reject' }) });
    const sender = await new_user(storage);
    const target = await new_user(storage);
    // Moving row 1 to phase fail (the row's own write) throws.
    const holder = await lock_holder(db);
    if (DB_KIND === 'postgresql') {
      await holder.ok(`CREATE FUNCTION stop_update() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'stop'; END $$`);
      await holder.ok('CREATE TRIGGER stop_update BEFORE UPDATE ON user_change FOR EACH ROW WHEN (OLD.change_id = 1) EXECUTE FUNCTION stop_update()');
    } else {
      await holder.ok(`CREATE TRIGGER stop_update BEFORE UPDATE ON user_change WHEN OLD.change_id = 1 BEGIN SELECT RAISE(ABORT, 'stop'); END`);
    }
    // The rows are left to run_user_changes until the end of the test.
    const hold = gate();
    await request(storage, sender, (ctx) => {
      storage.after_commit(ctx, () => hold.promise);
      storage.send_user_change(ctx, target, 'gift', Uint8Array.from([1]));
      storage.send_user_change(ctx, target, 'gift', Uint8Array.from([2]));
    });
    const first = await storage.run_user_changes().then(
      () => null,
      (error: unknown) => error,
    );
    // `routing` logs the stack of the error `run_user_changes` throws.
    expect(first).toBeInstanceOf(Error);
    expect((first as Error).stack).toContain('change_id 1 ');
    expect(change_rows(storage).map((r) => [r.change_id, r.phase])).toEqual([
      [1n, 'apply'],
      [2n, 'apply'],
    ]);
    // With a batch of 1 the next run selects row 2, not row 1 again.
    expect(await storage.run_user_changes()).toBe(1);
    expect(log.failed.map((f) => f.failure)).toEqual([{ reason: 'rejected', code: GAME_ERROR }]);
    expect(change_rows(storage).map((r) => [r.change_id, r.phase])).toEqual([[1n, 'apply']]);
    expect(await storage.run_user_changes()).toBe(0);
    // Another server instance (another process) selects the row again.
    const other = await instance({ db, settings, register: gift(new_log(), { apply: 'reject' }) });
    await expect(other.storage.run_user_changes()).rejects.toThrow('change_id 1 ');
    hold.open();
    await storage.wait_after_commit();
    await settle();
  });

  it('with a cheat time offset the row is due at clock_now, and after a FAILED apply at clock_now plus the first retry interval', async () => {
    const log = new_log();
    const initial = BigInt(Number(core_settings()['storage.userChangeRetryInitialMs']));
    const clock = new TestClock(START_TIME);
    const { storage } = await instance({ clock, offset: () => 86_400_000n, register: gift(log, { apply: 'throw' }) });
    const sender = await new_user(storage);
    const target = await new_user(storage);
    const hold = gate();
    const done = gate();
    let request_time = 0n;
    await request(storage, sender, (ctx) => {
      request_time = ctx.request_time;
      storage.after_commit(ctx, () => hold.promise);
      storage.send_user_change(ctx, target, 'gift', Uint8Array.from([1]));
      storage.after_commit(ctx, done.open);
    });
    expect(request_time).toBe(START_TIME + 86_400_000n);
    expect(change_rows(storage)[0]?.next_attempt_at).toBe(START_TIME);
    hold.open();
    await done.promise;
    expect(change_rows(storage)[0]?.next_attempt_at).toBe(START_TIME + initial);
  });

  it('send_user_change throws for a name not registered, the user itself and a payload over the limit', async () => {
    const { storage } = await instance({ register: gift(new_log()) });
    const user = await new_user(storage);
    const other = await new_user(storage);
    const limit = Number(core_settings()['storage.userChangeMaxBytes']);
    const results = await request(storage, user, (ctx) =>
      [
        () => {
          storage.send_user_change(ctx, other, 'nope', new Uint8Array(1));
        },
        () => {
          storage.send_user_change(ctx, user, 'gift', new Uint8Array(1));
        },
        () => {
          storage.send_user_change(ctx, other, 'gift', new Uint8Array(limit + 1));
        },
        () => {
          storage.send_user_change(ctx, other, 'gift', new Uint8Array(limit));
        },
      ].map((call) => {
        try {
          call();
          return 'sent';
        } catch {
          return 'threw';
        }
      }),
    );
    expect(results).toEqual(['threw', 'threw', 'threw', 'sent']);
  });
});
