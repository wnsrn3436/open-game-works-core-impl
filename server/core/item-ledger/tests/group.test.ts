import { balance, change_rows, history, id, items, request, set_balance, Source, start, stop, tx, user, type Env } from './helpers.ts';

let env: Env;

beforeAll(async () => {
  env = await start();
});

afterAll(() => {
  stop();
});

describe('group item', () => {
  test('get_balance is the sum of the members; subtracting takes from the members in members order, one ItemChange and history row each', async () => {
    const { user_id } = await user(env);
    await set_balance(env, user_id, '[gem_paid]', 3);
    await set_balance(env, user_id, '[gem_free]', 10);
    expect(await balance(env, user_id, '[gem]')).toBe(13n);
    const before = history(env, user_id).length;
    const r = await request(env, user_id, (ctx) => env.ledger.subtract_items(ctx, items(['[gem]', 5])));
    expect(r.out).toBe('OK');
    expect(change_rows(r.delta.item_changes).map((c) => [c[0], c[1]])).toEqual([[id('[gem_paid]'), -3n], [id('[gem_free]'), -2n]]);
    expect(history(env, user_id).slice(before).map((h) => [h.item_id, h.delta, h.balance_after])).toEqual([[id('[gem_paid]'), -3n, 0n], [id('[gem_free]'), -2n, 8n]]);
    expect(await balance(env, user_id, '[gem]')).toBe(8n);
  });

  test('a cost of another module from a group item takes from the members', async () => {
    const { user_id } = await user(env);
    await set_balance(env, user_id, '[gem_paid]', 2);
    await set_balance(env, user_id, '[gem_free]', 2);
    const shop = await tx(env, user_id, (ctx) => env.module.subtract_items(ctx, items(['[gem]', 3]), { source: Source.ITEM_CHANGE_SOURCE_SHOP, ref: '7' }));
    expect(shop).toBe('OK');
    expect(history(env, user_id).slice(-2).map((h) => [h.item_id, h.delta, h.source, h.ref])).toEqual([
      [id('[gem_paid]'), -2n, 'ITEM_CHANGE_SOURCE_SHOP', '7'], [id('[gem_free]'), -1n, 'ITEM_CHANGE_SOURCE_SHOP', '7'],
    ]);
  });

  test('members summing to less than the amount is NOT_ENOUGH and nothing changes', async () => {
    const { user_id } = await user(env);
    await set_balance(env, user_id, '[gem_paid]', 3);
    await set_balance(env, user_id, '[gem_free]', 1);
    const before = history(env, user_id).length;
    expect(await tx(env, user_id, (ctx) => env.ledger.subtract_items(ctx, items(['[gem]', 5])))).toBe('NOT_ENOUGH');
    expect(await balance(env, user_id, '[gem_paid]')).toBe(3n);
    expect(await balance(env, user_id, '[gem_free]')).toBe(1n);
    expect(history(env, user_id).length).toBe(before);
  });

  test('a group item and its member in one list: the member amount first, one net ItemChange; check_items gives the same result', async () => {
    const { user_id } = await user(env);
    await set_balance(env, user_id, '[gem_paid]', 5);
    await set_balance(env, user_id, '[gem_free]', 4);
    const list = items(['[gem]', 6], ['[gem_free]', 2]);
    expect(await tx(env, user_id, (ctx) => env.ledger.check_items(ctx, list))).toBe(true);
    const r = await request(env, user_id, (ctx) => env.ledger.subtract_items(ctx, list));
    expect(r.out).toBe('OK');
    expect(change_rows(r.delta.item_changes).map((c) => [c[0], c[1]])).toEqual([[id('[gem_free]'), -3n], [id('[gem_paid]'), -5n]]);
    const more = items(['[gem]', 2], ['[gem_free]', 1]);
    expect(await tx(env, user_id, (ctx) => env.ledger.check_items(ctx, more))).toBe(false);
    expect(await tx(env, user_id, (ctx) => env.ledger.subtract_items(ctx, more))).toBe('NOT_ENOUGH');
    const exact = items(['[gem]', 1]);
    expect(await tx(env, user_id, (ctx) => env.ledger.check_items(ctx, exact))).toBe(true);
    expect(await tx(env, user_id, (ctx) => env.ledger.subtract_items(ctx, exact))).toBe('OK');
  });

  test('adding, revoking or set_balance of a group item is UNSUPPORTED_ITEM and nothing changes; check_add_items for a mail attachment is UNSUPPORTED_ITEM', async () => {
    const { user_id } = await user(env);
    await set_balance(env, user_id, '[gem_paid]', 1);
    expect(await tx(env, user_id, (ctx) => env.ledger.add_items(ctx, items(['[gem]', 1])))).toBe('UNSUPPORTED_ITEM');
    expect(await tx(env, user_id, (ctx) => env.ledger.exchange_items(ctx, items(['[gem_paid]', 1]), items(['[gem]', 1])))).toBe('UNSUPPORTED_ITEM');
    expect(await tx(env, user_id, (ctx) => env.ledger.revoke_items(ctx, items(['[gem]', 1])))).toBe('UNSUPPORTED_ITEM');
    expect(await set_balance(env, user_id, '[gem]', 1)).toBe('UNSUPPORTED_ITEM');
    expect(await balance(env, user_id, '[gem]')).toBe(1n);
    // `mailbox.send_mail` checks attachments with `check_add_items` and answers `INVALID_INPUT` on a failure element.
    expect(env.module.check_add_items(items(['[gem]', 1]))).toBe('UNSUPPORTED_ITEM');
    expect(env.module.check_add_items(items(['[gem_paid]', 1], ['[gold]', 2]))).toBe('OK');
  });
});
