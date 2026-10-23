import { advance_time, balance, CoreError, history, id, items, logs, row, Source, start, stop, set_balance, tx, user, wait_background, type Env } from './helpers.ts';

const MINUTE = 60_000n;

let env: Env;

beforeAll(async () => {
  env = await start();
});

afterAll(() => {
  stop();
});

afterEach(() => {
  env.hooks.after = null;
});

function audits(lines: Record<string, unknown>[], user_id: bigint): Record<string, unknown>[] {
  return lines.filter((l) => l['user_id'] === user_id.toString());
}

describe('revoke_items', () => {
  test('does not go below 0, returns the shortfall, records it in history and writes an audit log per revoked item', async () => {
    const { user_id } = await user(env);
    await set_balance(env, user_id, '[gold]', 30);
    await set_balance(env, user_id, '[potion]', 2);
    const out = await tx(env, user_id, (ctx) => env.module.revoke_items(ctx, items(['[gold]', 50], ['[potion]', 1], ['[ticket]', 1]), {
      source: Source.ITEM_CHANGE_SOURCE_IAP_REFUND, ref: 'tx-1', once_key: 'iap:refund:tx-1',
    }));
    expect(out).toEqual([{ item_id: id('[gold]'), shortfall: 20n }, { item_id: id('[potion]'), shortfall: 0n }, { item_id: id('[ticket]'), shortfall: 1n }]);
    expect(await balance(env, user_id, '[gold]')).toBe(0n);
    expect(await balance(env, user_id, '[potion]')).toBe(1n);
    expect(history(env, user_id).slice(-3).map((h) => [h.item_id, h.delta, h.shortfall, h.source, h.ref, h.once_key])).toEqual([
      [id('[gold]'), -30n, 20n, 'ITEM_CHANGE_SOURCE_IAP_REFUND', 'tx-1', 'iap:refund:tx-1'],
      [id('[potion]'), -1n, 0n, 'ITEM_CHANGE_SOURCE_IAP_REFUND', 'tx-1', 'iap:refund:tx-1'],
      [id('[ticket]'), 0n, 1n, 'ITEM_CHANGE_SOURCE_IAP_REFUND', 'tx-1', 'iap:refund:tx-1'],
    ]);
    await wait_background(env);
    const lines = audits(logs(env, 'audit'), user_id);
    expect(lines.map((l) => [l['item_id'], l['revoked'], l['shortfall'], l['source'], l['ref'], l['once_key'], l['actor']])).toEqual([
      [id('[gold]'), '30', '20', 'ITEM_CHANGE_SOURCE_IAP_REFUND', 'tx-1', 'iap:refund:tx-1', 'system'],
      [id('[potion]'), '1', '0', 'ITEM_CHANGE_SOURCE_IAP_REFUND', 'tx-1', 'iap:refund:tx-1', 'system'],
    ]);
  });

  test('admin-api revoke_items: the audit actor is the operator name', async () => {
    const { user_id } = await user(env);
    await set_balance(env, user_id, '[gold]', 5);
    // As `admin-api` runs its admin operation: the operator in `logging.with_audit_actor`, an out-of-request change.
    const out = await env.logging.with_audit_actor('ogw', () => tx(env, user_id, (ctx) => env.module.revoke_items(ctx, items(['[gold]', 8]), {
      source: Source.ITEM_CHANGE_SOURCE_ADMIN, ref: 'revoke_items', once_key: 'admin:revoke_items:op-1',
    })));
    expect(out).toEqual([{ item_id: id('[gold]'), shortfall: 3n }]);
    expect(await balance(env, user_id, '[gold]')).toBe(0n);
    await wait_background(env);
    const lines = audits(logs(env, 'audit'), user_id).filter((l) => l['item_id'] === id('[gold]'));
    expect(lines.map((l) => [l['revoked'], l['shortfall'], l['source'], l['once_key'], l['actor']])).toEqual([['5', '3', 'ITEM_CHANGE_SOURCE_ADMIN', 'admin:revoke_items:op-1', 'ogw']]);
  });

  test('the second revoke_items with the same once_key is ALREADY_APPLIED and the balance stays', async () => {
    const { user_id } = await user(env);
    await set_balance(env, user_id, '[gold]', 10);
    const source = { source: Source.ITEM_CHANGE_SOURCE_ADMIN, ref: 'revoke_items', once_key: 'admin:revoke_items:x' };
    expect(await tx(env, user_id, (ctx) => env.module.revoke_items(ctx, items(['[gold]', 4]), source))).toEqual([{ item_id: id('[gold]'), shortfall: 0n }]);
    expect(await tx(env, user_id, (ctx) => env.module.revoke_items(ctx, items(['[gold]', 4]), source))).toBe('ALREADY_APPLIED');
    expect(await balance(env, user_id, '[gold]')).toBe(6n);
  });

  test('a revoke whose transaction rolls back leaves no audit line: a throwing after_item_change, and a caller that fails after it', async () => {
    const { user_id } = await user(env);
    await set_balance(env, user_id, '[gold]', 10);
    env.hooks.after = () => {
      throw new Error('after_item_change failed');
    };
    await expect(tx(env, user_id, (ctx) => env.module.revoke_items(ctx, items(['[gold]', 5]), { source: Source.ITEM_CHANGE_SOURCE_ADMIN, ref: 'revoke_items' }))).rejects.toThrow();
    env.hooks.after = null;
    // As `iap` when content `revoke_iap` fails after revoke_items: the out-of-request change ends with a failure code.
    const result = await env.storage.run_user_transaction(user_id, (ctx) => {
      env.module.revoke_items(ctx, items(['[gold]', 5]), { source: Source.ITEM_CHANGE_SOURCE_IAP_REFUND, ref: 'tx-2' });
      return CoreError.CORE_ERROR_INTERNAL;
    });
    expect(result).not.toBe('COMMITTED');
    await wait_background(env);
    expect(await balance(env, user_id, '[gold]')).toBe(10n);
    expect(audits(logs(env, 'audit'), user_id)).toEqual([]);
  });

  test('a committed revoke writes one audit line per revoked item at its commit, before an earlier after_commit function of its transaction ends', async () => {
    const { user_id } = await user(env);
    await set_balance(env, user_id, '[gold]', 10);
    await set_balance(env, user_id, '[potion]', 2);
    let open!: () => void;
    const gate = new Promise<void>((resolve) => {
      open = resolve;
    });
    await tx(env, user_id, (ctx) => {
      env.storage.after_commit(ctx, () => gate);
      return env.module.revoke_items(ctx, items(['[gold]', 4], ['[potion]', 3], ['[ticket]', 1]), { source: Source.ITEM_CHANGE_SOURCE_ADMIN, ref: 'revoke_items' });
    });
    const revoked = (): unknown[] => audits(logs(env, 'audit'), user_id).map((l) => [l['item_id'], l['revoked'], l['shortfall']]);
    expect(revoked()).toEqual([
      [id('[gold]'), '4', '0'],
      [id('[potion]'), '2', '1'],
    ]);
    open();
    await wait_background(env);
    expect(revoked()).toHaveLength(2);
  });

  test('a committed revoke keeps its audit lines when the server stops while an earlier after_commit function of its transaction still runs', async () => {
    const own = await start();
    const { user_id } = await user(own);
    await set_balance(own, user_id, '[gold]', 10);
    await set_balance(own, user_id, '[potion]', 2);
    let open!: () => void;
    const gate = new Promise<void>((resolve) => {
      open = resolve;
    });
    let later = false;
    await tx(own, user_id, (ctx) => {
      own.storage.after_commit(ctx, () => gate);
      const out = own.module.revoke_items(ctx, items(['[gold]', 4], ['[potion]', 3], ['[ticket]', 1]), { source: Source.ITEM_CHANGE_SOURCE_ADMIN, ref: 'revoke_items' });
      own.storage.after_commit(ctx, () => {
        later = true;
      });
      return out;
    });
    own.server.stop();
    open();
    await own.server.storage_dev?.wait_after_commit();
    // The stop dropped the after_commit function after the waiting one; the audit lines of the commit stay.
    expect(later).toBe(false);
    expect(audits(logs(own, 'audit'), user_id).map((l) => [l['item_id'], l['revoked'], l['shortfall'], l['actor']])).toEqual([
      [id('[gold]'), '4', '0', 'system'],
      [id('[potion]'), '2', '1', 'system'],
    ]);
  });

  test('a recovery item is revoked from its balance with the recovery reflected first, and its interval goes on', async () => {
    const created = env.server.clock.now();
    const { user_id } = await user(env);
    // [energy]: 2 per 5 minutes up to 10, initial_amount 0, so recovery starts at user creation.
    advance_time(env, 16n * MINUTE);
    expect(await balance(env, user_id, '[energy]')).toBe(6n);
    const out = await tx(env, user_id, (ctx) => env.module.revoke_items(ctx, items(['[energy]', 8]), { source: Source.ITEM_CHANGE_SOURCE_IAP_REFUND, ref: 'tx-3' }));
    expect(out).toEqual([{ item_id: id('[energy]'), shortfall: 2n }]);
    expect(history(env, user_id).map((h) => [h.source, h.delta, h.balance_after, h.shortfall])).toEqual([
      ['ITEM_CHANGE_SOURCE_RECOVERY', 6n, 6n, 0n],
      ['ITEM_CHANGE_SOURCE_IAP_REFUND', -6n, 0n, 2n],
    ]);
    const stored = await row(env, user_id, '[energy]');
    expect([stored?.amount, stored?.recovery_started_at]).toEqual([0n, created + 15n * MINUTE]);
    advance_time(env, 4n * MINUTE);
    expect(await balance(env, user_id, '[energy]')).toBe(2n);
  });
});
