import * as CoreContract from '../../../generated/contract/core_contract.ts';
import * as CoreCheatContract from '../../../dev/generated/contract/core_cheat_contract.ts';
import {
  balance, balance_entries, change_rows, DB_KIND, flush, id, items, request, send_set_item_balance, set_balance, Source, start, start_peer, stop, tx, user, type Env,
} from './helpers.ts';

let env: Env;

beforeAll(async () => {
  env = await start();
});

afterAll(() => {
  stop();
});

describe('delivery and storage', () => {
  test('an out-of-request change comes in the pending delta and item_changes of the next success response', async () => {
    const { user_id } = await user(env);
    expect(await tx(env, user_id, (ctx) => env.module.add_items(ctx, items(['[gold]', 7]), { source: Source.ITEM_CHANGE_SOURCE_ADMIN, ref: 'grant_items', once_key: 'admin:grant_items:d1' }))).toBe('OK');
    expect(await tx(env, user_id, (ctx) => env.module.subtract_items(ctx, items(['[gold]', 2]), { source: Source.ITEM_CHANGE_SOURCE_ADMIN, ref: 'x' }))).toBe('OK');
    const envelope = await flush(env, user_id);
    expect(change_rows(envelope.item_changes)).toEqual([
      [id('[gold]'), 7n, 0n, Source.ITEM_CHANGE_SOURCE_ADMIN, 'grant_items'], [id('[gold]'), -2n, 0n, Source.ITEM_CHANGE_SOURCE_ADMIN, 'x'],
    ]);
    const rows = balance_entries(envelope.pending_user_state);
    expect(rows.map(([i, r]) => [i, r === 'deleted' ? r : r.amount])).toEqual([[id('[gold]'), 5n]]);
    expect((await flush(env, user_id)).item_changes).toEqual([]);
  });

  test('SetItemBalance in a request: the response delta and item_changes come after the pending ones', async () => {
    const { user_id } = await user(env);
    await tx(env, user_id, (ctx) => env.module.add_items(ctx, items(['[potion]', 1]), { source: Source.ITEM_CHANGE_SOURCE_ADMIN, ref: 'p' }));
    const req = new CoreCheatContract.SetItemBalanceRequest();
    req.item_id = id('[gold]');
    req.balance = 9n;
    const { code, delta: envelope } = await send_set_item_balance(env, user_id, req);
    expect(code).toBe(0);
    if (envelope === null) throw new Error('no delta');
    expect(change_rows(envelope.item_changes).map((c) => [c[0], c[1], c[3]])).toEqual([
      [id('[potion]'), 1n, Source.ITEM_CHANGE_SOURCE_ADMIN], [id('[gold]'), 9n, Source.ITEM_CHANGE_SOURCE_CHEAT],
    ]);
    expect(balance_entries(envelope.user_state).map(([i]) => i)).toEqual([id('[gold]')]);
  });

  test('content code writing ItemBalanceUserState directly is refused', async () => {
    const { user_id } = await user(env);
    await set_balance(env, user_id, '[gold]', 3);
    const state = new CoreContract.ItemBalanceUserState();
    state.id = BigInt(id('[gold]'));
    state.amount = 100n;
    await expect(request(env, user_id, (ctx) => {
      env.storage.put_state(ctx, state);
    })).rejects.toThrow();
    await expect(request(env, user_id, (ctx) => {
      env.storage.delete_state(ctx, CoreContract.ItemBalanceUserState, BigInt(id('[gold]')));
    })).rejects.toThrow();
    expect(await balance(env, user_id, '[gold]')).toBe(3n);
  });

  test('two concurrent changes of the same user subtract the same balance once each', async () => {
    const { user_id } = await user(env);
    await set_balance(env, user_id, '[gold]', 10);
    // On PostgreSQL also from a second server instance on the database, as from a second server process. (A SQLite
    // write transaction holds the whole file, and a second connection in this process would block the first.)
    const peer = DB_KIND === 'postgresql' ? await start_peer(env) : env;
    const subtract = (on: Env, n: number): Promise<unknown> => request(on, user_id, (ctx) => on.ledger.subtract_items(ctx, items(['[gold]', n]))).then((r) => r.out);
    const outcomes = await Promise.all([subtract(env, 6), subtract(peer, 6), subtract(env, 3)]);
    expect(outcomes.filter((r) => r === 'OK').length).toBe(2);
    expect(outcomes.filter((r) => r === 'NOT_ENOUGH').length).toBe(1);
    expect(await balance(env, user_id, '[gold]')).toBe(1n);
  });
});
