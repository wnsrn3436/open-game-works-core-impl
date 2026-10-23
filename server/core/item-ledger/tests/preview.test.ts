import { balance, change_rows, history, id, items, request, row, set_balance, start, stop, tx, user, type Env } from './helpers.ts';

let env: Env;
let validated = 0;

beforeAll(async () => {
  env = await start();
  env.hooks.validate = () => {
    validated += 1;
    return 'pass';
  };
});

afterAll(() => {
  stop();
});

const MAX = 2n ** 53n - 1n;

describe('preview_add_items', () => {
  test('rows equal the ItemChanges of add_items in the same ctx and change nothing', async () => {
    const { user_id } = await user(env);
    await set_balance(env, user_id, '[ticket]', 1);
    await set_balance(env, user_id, '[potion]', 9);
    await set_balance(env, user_id, '[shard]', 9);
    await set_balance(env, user_id, '[dust]', 48);
    const list = items(['[ticket]', 2], ['[potion]', 3], ['[shard]', 3], ['[gold]', 7]);
    const before = history(env, user_id).length;
    const calls = validated;
    const r = await request(env, user_id, (ctx) => {
      const preview = env.ledger.preview_add_items(ctx, list);
      const again = env.ledger.preview_add_items(ctx, list);
      return { preview, again, calls: validated };
    });
    expect(r.out.preview).toEqual([
      { item_id: id('[ticket]'), outcome: 'Applied', applied: 2n, overflow: 0n, replacements: [] },
      { item_id: id('[potion]'), outcome: 'Discarded', applied: 1n, overflow: 2n, replacements: [] },
      { item_id: id('[shard]'), outcome: 'Discarded', applied: 1n, overflow: 2n, replacements: [{ item_id: id('[dust]'), applied: 2n, overflow: 2n }] },
      { item_id: id('[gold]'), outcome: 'Applied', applied: 7n, overflow: 0n, replacements: [] },
    ]);
    expect(r.out.again).toEqual(r.out.preview);
    expect(r.out.calls).toBe(calls);
    expect(r.delta.item_changes).toEqual([]);
    expect(history(env, user_id).length).toBe(before);
    expect(await balance(env, user_id, '[ticket]')).toBe(1n);

    const added = await request(env, user_id, (ctx) => {
      const preview = env.ledger.preview_add_items(ctx, list);
      return { preview, result: env.ledger.add_items(ctx, list) };
    });
    expect(added.out.result).toBe('OK');
    expect(change_rows(added.delta.item_changes).map((c) => [c[0], c[1], c[2]])).toEqual([
      [id('[ticket]'), 2n, 0n], [id('[potion]'), 1n, 2n], [id('[shard]'), 1n, 2n], [id('[dust]'), 2n, 2n], [id('[gold]'), 7n, 0n],
    ]);
  });

  test('Converted when every replacement amount fits', async () => {
    const { user_id } = await user(env);
    await set_balance(env, user_id, '[shard]', 10);
    const out = await tx(env, user_id, (ctx) => env.ledger.preview_add_items(ctx, items(['[shard]', 4])));
    expect(out).toEqual([{ item_id: id('[shard]'), outcome: 'Converted', applied: 0n, overflow: 4n, replacements: [{ item_id: id('[dust]'), applied: 8n, overflow: 0n }] }]);
  });

  test('preview does not use a once_key', async () => {
    const { user_id } = await user(env);
    await tx(env, user_id, (ctx) => env.ledger.add_items(ctx, items(['[gold]', 1]), { once_key: 'p:1' }));
    const out = await tx(env, user_id, (ctx) => env.ledger.preview_add_items(ctx, items(['[gold]', 1])));
    expect(out).toEqual([{ item_id: id('[gold]'), outcome: 'Applied', applied: 1n, overflow: 0n, replacements: [] }]);
  });

  test('a Reject item over max_amount makes every row Mailed; an earlier subtraction in the same ctx counts', async () => {
    const { user_id } = await user(env);
    await set_balance(env, user_id, '[ticket]', 5);
    const r = await request(env, user_id, (ctx) => {
      const full = env.ledger.preview_add_items(ctx, items(['[gold]', 1], ['[ticket]', 1]));
      env.ledger.subtract_items(ctx, items(['[ticket]', 1]));
      const after = env.ledger.preview_add_items(ctx, items(['[gold]', 1], ['[ticket]', 1]));
      return { full, after };
    });
    expect(r.out.full).toEqual([
      { item_id: id('[gold]'), outcome: 'Mailed', applied: 0n, overflow: 0n, replacements: [] },
      { item_id: id('[ticket]'), outcome: 'Mailed', applied: 0n, overflow: 0n, replacements: [] },
    ]);
    expect(r.out.after).toEqual([
      { item_id: id('[gold]'), outcome: 'Applied', applied: 1n, overflow: 0n, replacements: [] },
      { item_id: id('[ticket]'), outcome: 'Applied', applied: 1n, overflow: 0n, replacements: [] },
    ]);
  });

  test('a Convert item at max_amount + 2^53-1 with a Discard replacement of amount 2 at 0', async () => {
    const { user_id } = await user(env);
    await set_balance(env, user_id, '[shard]', 10);
    const out = await tx(env, user_id, (ctx) => env.ledger.preview_add_items(ctx, items(['[shard]', MAX])));
    expect(out).toEqual([{ item_id: id('[shard]'), outcome: 'Discarded', applied: 0n, overflow: MAX, replacements: [{ item_id: id('[dust]'), applied: 50n, overflow: 2n * MAX - 50n }] }]);
    expect(await row(env, user_id, '[dust]')).toBeNull();
  });

  test('failure values INVALID_AMOUNT and UNSUPPORTED_ITEM', async () => {
    const { user_id } = await user(env);
    expect(await tx(env, user_id, (ctx) => env.ledger.preview_add_items(ctx, items(['[gold]', 0])))).toBe('INVALID_AMOUNT');
    expect(await tx(env, user_id, (ctx) => env.ledger.preview_add_items(ctx, items(['[gem]', 1])))).toBe('UNSUPPORTED_ITEM');
  });
});
