import * as CoreContract from '../../../generated/contract/core_contract.ts';
import type { Storage, TakenDelta } from '../index.ts';
import type { RequestCtx } from '../request_ctx.ts';
import { instance, new_user, raw_rows, request, stop_all } from './helpers.ts';
import { profile, quest, QuestUserState, wallet } from './kinds.ts';

const GAME_ERROR = 1001;

afterEach(() => {
  stop_all();
});

interface Entry {
  kind: string;
  id: bigint;
  value: string | null;
}

function entries(delta: CoreContract.UserStateDelta): Entry[] {
  return delta.entries.map((e) => ({ kind: e.kind, id: e.id, value: e.deleted ? null : Buffer.from(e.value).toString('hex') }));
}

function hex(value: { encode(): Uint8Array }): string {
  return Buffer.from(value.encode()).toString('hex');
}

function change(item_id: number, ref: string): CoreContract.ItemChange {
  const c = new CoreContract.ItemChange();
  c.item_id = item_id;
  c.delta = 1n;
  c.source = CoreContract.ItemChangeSource.ITEM_CHANGE_SOURCE_ADMIN;
  c.ref = ref;
  return c;
}

function mail(mail_id: bigint, ref: string): CoreContract.ItemMail {
  const m = new CoreContract.ItemMail();
  m.mail_id = mail_id;
  m.source = CoreContract.ItemChangeSource.ITEM_CHANGE_SOURCE_ADMIN;
  m.ref = ref;
  return m;
}

function take(storage: Storage, user: bigint, fn: (ctx: RequestCtx) => void = () => undefined): Promise<TakenDelta> {
  return request(storage, user, (ctx) => {
    fn(ctx);
    return storage.take_response_delta(ctx);
  }) as Promise<TakenDelta>;
}

describe('UserState delta', () => {
  it('is the difference of the stored values before and after the transaction', async () => {
    const { storage } = await instance();
    const user = await new_user(storage);
    await request(storage, user, (ctx) => {
      for (const id of [1n, 2n, 3n, 4n, 5n]) storage.put_state(ctx, quest(id, 1n));
    });
    const taken = await take(storage, user, (ctx) => {
      storage.put_state(ctx, quest(1n, 2n));
      storage.put_state(ctx, quest(2n, 1n));
      storage.put_state(ctx, quest(3n, 9n));
      storage.delete_state(ctx, QuestUserState, 3n);
      storage.delete_state(ctx, QuestUserState, 4n);
      storage.put_state(ctx, quest(4n, 7n));
      storage.delete_state(ctx, QuestUserState, 5n);
      storage.put_state(ctx, quest(6n, 1n));
      storage.put_state(ctx, quest(7n, 1n));
      storage.delete_state(ctx, QuestUserState, 7n);
      storage.delete_state(ctx, QuestUserState, 8n);
      storage.put_state(ctx, profile(3n));
    });
    expect(entries(taken.delta.user_state)).toEqual([
      { kind: 'QuestUserState', id: 1n, value: hex(quest(1n, 2n)) },
      { kind: 'QuestUserState', id: 4n, value: hex(quest(4n, 7n)) },
      { kind: 'QuestUserState', id: 6n, value: hex(quest(6n, 1n)) },
      { kind: 'QuestUserState', id: 3n, value: null },
      { kind: 'QuestUserState', id: 5n, value: null },
      { kind: 'ProfileUserState', id: 0n, value: hex(profile(3n)) },
    ]);
    expect(taken.delta.user_state.full).toBe(false);
  });

  it('has no server state change', async () => {
    const { storage } = await instance();
    const user = await new_user(storage);
    const taken = await take(storage, user, (ctx) => {
      storage.put_state(ctx, wallet(5n));
    });
    expect(taken.delta.user_state.entries).toEqual([]);
    expect(await storage.run_user_transaction(user, (ctx) => (storage.put_state(ctx, wallet(6n)), 'pass'))).toBe('COMMITTED');
    expect(raw_rows(storage, 'pending_delta', user)).toEqual([]);
  });

  it('throws on a UserState write and on add_item_change after take_response_delta', async () => {
    const { storage } = await instance();
    const user = await new_user(storage);
    const outcomes = await request(storage, user, (ctx) => {
      storage.take_response_delta(ctx);
      return [
        () => {
          storage.put_state(ctx, quest(1n, 1n));
        },
        () => {
          storage.delete_state(ctx, QuestUserState, 1n);
        },
        () => {
          storage.add_item_change(ctx, change(1, 'x'));
        },
        () => {
          storage.add_item_mail(ctx, mail(1n, 'x'));
        },
        () => storage.take_response_delta(ctx),
      ].map((call) => {
        try {
          call();
          return 'ok';
        } catch {
          return 'threw';
        }
      });
    });
    expect(outcomes).toEqual(['threw', 'threw', 'threw', 'threw', 'threw']);
  });
});

describe('pending delta', () => {
  it('stores an out-of-request change, sends it with the next success response and deletes it; an error response keeps it', async () => {
    const { storage } = await instance();
    const user = await new_user(storage);
    expect(await storage.run_user_transaction(user, (ctx) => (storage.put_state(ctx, quest(1n, 1n)), 'pass'))).toBe('COMMITTED');
    expect(await storage.run_user_transaction(user, (ctx) => (storage.put_state(ctx, quest(1n, 2n)), storage.put_state(ctx, quest(2n, 1n)), 'pass'))).toBe('COMMITTED');
    expect(raw_rows(storage, 'pending_delta', user)).toHaveLength(2);
    expect(
      await request(storage, user, (ctx) => {
        storage.take_response_delta(ctx);
        return GAME_ERROR;
      }),
    ).toBe(GAME_ERROR);
    expect(raw_rows(storage, 'pending_delta', user)).toHaveLength(2);
    const taken = await take(storage, user, (ctx) => {
      storage.put_state(ctx, quest(2n, 5n));
    });
    expect(entries(taken.delta.pending_user_state)).toEqual([
      { kind: 'QuestUserState', id: 1n, value: hex(quest(1n, 2n)) },
      { kind: 'QuestUserState', id: 2n, value: hex(quest(2n, 5n)) },
    ]);
    expect(entries(taken.delta.user_state)).toEqual([{ kind: 'QuestUserState', id: 2n, value: hex(quest(2n, 5n)) }]);
    expect(raw_rows(storage, 'pending_delta', user)).toEqual([]);
    const next = await take(storage, user);
    expect(next.delta.pending_user_state.entries).toEqual([]);
  });

  it('puts the ItemChange and ItemMail of two out-of-request changes before the request ones, in sequence order', async () => {
    const { storage } = await instance();
    const user = await new_user(storage);
    for (const n of [1, 2]) {
      expect(
        await storage.run_user_transaction(user, (ctx) => {
          storage.add_item_change(ctx, change(n, `change-${String(n)}`));
          storage.add_item_mail(ctx, mail(BigInt(n), `mail-${String(n)}`));
          return 'pass';
        }),
      ).toBe('COMMITTED');
    }
    const taken = await take(storage, user, (ctx) => {
      storage.add_item_change(ctx, change(3, 'change-request'));
      storage.add_item_mail(ctx, mail(3n, 'mail-request'));
    });
    expect(taken.delta.item_changes.map((c) => c.ref)).toEqual(['change-1', 'change-2', 'change-request']);
    expect(taken.delta.item_mails.map((m) => m.ref)).toEqual(['mail-1', 'mail-2', 'mail-request']);
    expect(taken.delta.item_changes[0]?.encode()).toEqual(change(1, 'change-1').encode());
  });
});

describe('read_full_state', () => {
  it('returns the pending ItemChange and ItemMail in the order stored and deletes the pending delta rows', async () => {
    const { storage } = await instance();
    const user = await new_user(storage);
    for (const n of [1, 2]) {
      await storage.run_user_transaction(user, (ctx) => {
        storage.add_item_change(ctx, change(n, `c${String(n)}`));
        storage.add_item_mail(ctx, mail(BigInt(n), `m${String(n)}`));
        return 'pass';
      });
    }
    const full = await request(storage, user, (ctx) => storage.read_full_state(ctx));
    if (typeof full === 'string') throw new Error(full);
    expect(full.item_changes.map((c) => c.ref)).toEqual(['c1', 'c2']);
    expect(full.item_mails.map((m) => m.ref)).toEqual(['m1', 'm2']);
    expect(raw_rows(storage, 'pending_delta', user)).toEqual([]);
  });

  it('take_response_delta after it sends its full delta, an empty pending delta and its lists first; a UserState write after it throws', async () => {
    const { storage } = await instance();
    const user = await new_user(storage);
    await request(storage, user, (ctx) => {
      storage.put_state(ctx, quest(2n, 2n));
      storage.put_state(ctx, quest(1n, 1n));
      storage.put_state(ctx, profile(4n));
      storage.put_state(ctx, wallet(1n));
    });
    await storage.run_user_transaction(user, (ctx) => {
      storage.add_item_change(ctx, change(1, 'pending'));
      storage.put_state(ctx, quest(3n, 3n));
      return 'pass';
    });
    const result = await request(storage, user, (ctx) => {
      const full = storage.read_full_state(ctx);
      let threw = false;
      try {
        storage.put_state(ctx, quest(9n, 9n));
      } catch {
        threw = true;
      }
      storage.add_item_change(ctx, change(2, 'request'));
      return { full, threw, taken: storage.take_response_delta(ctx) };
    });
    if (typeof result === 'string') throw new Error(result);
    expect(result.threw).toBe(true);
    const delta = result.taken.delta;
    expect(delta.user_state).toBe(result.full.delta);
    expect(delta.user_state.full).toBe(true);
    expect(entries(delta.user_state)).toEqual([
      { kind: 'QuestUserState', id: 1n, value: hex(quest(1n, 1n)) },
      { kind: 'QuestUserState', id: 2n, value: hex(quest(2n, 2n)) },
      { kind: 'QuestUserState', id: 3n, value: hex(quest(3n, 3n)) },
      { kind: 'ProfileUserState', id: 0n, value: hex(profile(4n)) },
    ]);
    expect(delta.pending_user_state.entries).toEqual([]);
    expect(delta.item_changes.map((c) => c.ref)).toEqual(['pending', 'request']);
  });
});

describe('unknown kind rows', () => {
  it('are left out of the deltas, reported by kind column, kept, and read by read_user_rows', async () => {
    const { storage } = await instance();
    const user = await new_user(storage);
    const ghost = { table: 'user_state', key: 'ghost_user_state/1', contract_version: 3n, value: Uint8Array.from([8, 1]) };
    await request(storage, user, (ctx) => {
      storage.replace_user_rows(ctx, [ghost, { table: 'user_state', key: 'quest_user_state/1', contract_version: 3n, value: quest(1n, 1n).encode() }]);
    });
    const pending = (): Promise<unknown> =>
      request(storage, user, (ctx) => {
        const json = JSON.stringify({ items: [['ghost_user_state', '1'], ['quest_user_state', '1']], item_changes: [], item_mails: [] });
        storage.db(ctx).query('INSERT INTO pending_delta (user_id, seq, delta, created_at) VALUES ($1, $2, $3, $4)', [user, 1n, new TextEncoder().encode(json), 0n]);
      });
    await pending();
    const full = await request(storage, user, (ctx) => storage.read_full_state(ctx));
    if (typeof full === 'string') throw new Error(full);
    expect(full.unknown_kinds).toEqual(['ghost_user_state']);
    expect(entries(full.delta).map((e) => e.kind)).toEqual(['QuestUserState']);
    await pending();
    const taken = await take(storage, user);
    expect(taken.unknown_kinds).toEqual(['ghost_user_state']);
    expect(entries(taken.delta.pending_user_state)).toEqual([{ kind: 'QuestUserState', id: 1n, value: hex(quest(1n, 1n)) }]);
    const rows = await request(storage, user, (ctx) => storage.read_user_rows(ctx));
    if (typeof rows === 'string') throw new Error(rows);
    expect(rows.map((r) => r.key)).toContain('ghost_user_state/1');
    expect(rows.find((r) => r.key === 'ghost_user_state/1')?.value).toEqual(ghost.value);
    expect(raw_rows(storage, 'user_state', user)).toHaveLength(2);
  });
});
