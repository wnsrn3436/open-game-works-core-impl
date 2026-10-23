import * as CoreContract from '../../../generated/contract/core_contract.ts';
import type { RequestCtx, Storage } from '../../storage/index.ts';
import { new_user, request, start, stop_all, type Instance } from './session_kit.ts';

afterEach(() => {
  stop_all();
});

function balance(id: bigint, amount: bigint): CoreContract.ItemBalanceUserState {
  const value = new CoreContract.ItemBalanceUserState();
  value.id = id;
  value.amount = amount;
  return value;
}

function item_change(item_id: number, delta: bigint): CoreContract.ItemChange {
  const change = new CoreContract.ItemChange();
  change.item_id = item_id;
  change.delta = delta;
  change.source = CoreContract.ItemChangeSource.ITEM_CHANGE_SOURCE_ADMIN;
  change.ref = 'grant-1';
  return change;
}

interface Entry {
  kind: string;
  id: bigint;
  value: string;
  deleted: boolean;
}

function entries(delta: CoreContract.UserStateDelta): Entry[] {
  return delta.entries.map((e) => ({ kind: e.kind, id: e.id, value: Buffer.from(e.value).toString('hex'), deleted: e.deleted }));
}

function entry(value: CoreContract.ItemBalanceUserState): Entry {
  return { kind: 'ItemBalanceUserState', id: value.id, value: Buffer.from(value.encode()).toString('hex'), deleted: false };
}

/** The stored rows of a user in a table, for before/after comparisons. */
function rows(storage: Storage, table: string, user_id: bigint): string[] {
  return storage
    .read_db()
    .query(`SELECT * FROM ${table} WHERE user_id = $1`, [user_id])
    .map((row) => JSON.stringify(row, (_, v: unknown) => (typeof v === 'bigint' ? String(v) : v instanceof Uint8Array ? Buffer.from(v).toString('hex') : v)))
    .sort();
}

/** An out-of-request change of the user (an admin grant): it leaves a pending delta. */
async function out_of_request(storage: Storage, user_id: bigint, fn: (ctx: RequestCtx) => void): Promise<void> {
  const result = await storage.run_user_transaction(user_id, (ctx) => {
    fn(ctx);
    return 'pass';
  });
  expect(result).toBe('COMMITTED');
}

/** `Resync` as `routing` runs it: the handler, then the response delta in the same request transaction. */
function resync(instance: Instance, user_id: bigint, full: boolean): Promise<{ response: CoreContract.ResyncResponse; delta: CoreContract.ResponseEnvelope }> {
  const message = new CoreContract.ResyncRequest();
  message.full = full;
  return request(instance.storage, user_id, 'core/Resync', (ctx) => {
    const response = instance.session.Resync(ctx, message);
    const taken = instance.storage.take_response_delta(ctx);
    const envelope = new CoreContract.ResponseEnvelope();
    envelope.user_state = taken.delta.user_state;
    envelope.pending_user_state = taken.delta.pending_user_state;
    envelope.item_changes = taken.delta.item_changes;
    envelope.item_mails = taken.delta.item_mails;
    return { response, delta: envelope };
  });
}

describe('Resync', () => {
  it('returns an empty response that carries the pending delta in pending_user_state and leaves the stored state as it is', async () => {
    const instance = await start();
    const { storage } = instance;
    const user = await new_user(storage);
    const granted = balance(7n, 50n);
    await out_of_request(storage, user, (ctx) => {
      storage.put_core_state(ctx, granted);
    });
    const user_state = rows(storage, 'user_state', user);
    const server_state = rows(storage, 'server_state', user);
    expect(rows(storage, 'pending_delta', user)).toHaveLength(1);

    const { response, delta } = await resync(instance, user, false);

    expect(response).toBeInstanceOf(CoreContract.ResyncResponse);
    expect(response.encode()).toHaveLength(0);
    expect(delta.pending_user_state?.full).toBe(false);
    expect(entries(delta.pending_user_state ?? new CoreContract.UserStateDelta())).toEqual([entry(granted)]);
    expect(delta.user_state?.full).toBe(false);
    expect(delta.user_state?.entries).toEqual([]);
    expect(rows(storage, 'user_state', user)).toEqual(user_state);
    expect(rows(storage, 'server_state', user)).toEqual(server_state);
  });

  it('with full true carries every UserState of the user as a full delta, the pending ItemChange, an empty pending_user_state, and leaves no pending delta row', async () => {
    const instance = await start();
    const { storage } = instance;
    const user = await new_user(storage);
    const other = await new_user(storage);
    const kept = balance(3n, 10n);
    await request(storage, user, 'Test', (ctx) => {
      storage.put_core_state(ctx, kept);
    });
    await request(storage, other, 'Test', (ctx) => {
      storage.put_core_state(ctx, balance(4n, 1n));
    });
    const granted = balance(7n, 50n);
    const change = item_change(7, 50n);
    await out_of_request(storage, user, (ctx) => {
      storage.put_core_state(ctx, granted);
      storage.add_item_change(ctx, change);
    });
    expect(rows(storage, 'pending_delta', user)).toHaveLength(1);
    const user_state = rows(storage, 'user_state', user);

    const { response, delta } = await resync(instance, user, true);

    expect(response).toBeInstanceOf(CoreContract.ResyncResponse);
    expect(delta.user_state?.full).toBe(true);
    expect(entries(delta.user_state ?? new CoreContract.UserStateDelta())).toEqual([entry(kept), entry(granted)]);
    expect(delta.pending_user_state?.entries).toEqual([]);
    expect(delta.item_changes.map((c) => Buffer.from(c.encode()).toString('hex'))).toEqual([Buffer.from(change.encode()).toString('hex')]);
    expect(rows(storage, 'pending_delta', user)).toEqual([]);
    expect(rows(storage, 'user_state', user)).toEqual(user_state);
  });

  it('with full false keeps nothing back: a second Resync has no pending delta', async () => {
    const instance = await start();
    const { storage } = instance;
    const user = await new_user(storage);
    await out_of_request(storage, user, (ctx) => {
      storage.put_core_state(ctx, balance(1n, 1n));
    });
    await resync(instance, user, false);
    const { delta } = await resync(instance, user, false);
    expect(delta.pending_user_state?.entries).toEqual([]);
    expect(delta.item_changes).toEqual([]);
  });
});
