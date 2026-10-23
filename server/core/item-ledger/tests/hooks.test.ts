import * as GameContract from '../../../generated/contract/game_contract.ts';
import type { ItemBalanceChange } from '../index.ts';
import { balance, history, id, items, logs, request, set_balance, Source, start, stop, tx, user, type Env } from './helpers.ts';

let env: Env;

beforeAll(async () => {
  env = await start();
});

afterAll(() => {
  stop();
});

afterEach(() => {
  env.hooks.validate = null;
  env.hooks.after = null;
});

/** A GameError value: the game contract of the core test data has none of its own. */
const GAME_ERROR = 1001 as GameContract.GameError;

describe('hooks', () => {
  test('a GameError of validate_item_change is REJECTED with that GameError and the balance stays', async () => {
    const { user_id } = await user(env);
    env.hooks.validate = () => GAME_ERROR;
    expect(await tx(env, user_id, (ctx) => env.ledger.add_items(ctx, items(['[gold]', 5])))).toBe(GAME_ERROR);
    expect(await tx(env, user_id, (ctx) => env.ledger.exchange_items(ctx, [], items(['[gold]', 5])))).toBe(GAME_ERROR);
    env.hooks.validate = null;
    expect(await balance(env, user_id, '[gold]')).toBe(0n);
    expect(history(env, user_id)).toEqual([]);
  });

  test('the Convert replacement item is in both hook lists once, with the balance after the replacement', async () => {
    const { user_id } = await user(env);
    await set_balance(env, user_id, '[shard]', 9);
    await set_balance(env, user_id, '[dust]', 1);
    const seen: { hook: string; source: number; list: readonly ItemBalanceChange[] }[] = [];
    env.hooks.validate = (_ctx, source, list) => {
      seen.push({ hook: 'validate', source: source.source, list });
      return 'pass';
    };
    env.hooks.after = (_ctx, source, list) => { seen.push({ hook: 'after', source: source.source, list }); };
    expect(await tx(env, user_id, (ctx) => env.ledger.add_items(ctx, items(['[shard]', 3], ['[dust]', 2])))).toBe('OK');
    const list = [{ item_id: id('[shard]'), before: 9n, after: 10n }, { item_id: id('[dust]'), before: 1n, after: 7n }];
    expect(seen).toEqual([
      { hook: 'validate', source: Source.ITEM_CHANGE_SOURCE_REQUEST, list },
      { hook: 'after', source: Source.ITEM_CHANGE_SOURCE_REQUEST, list },
    ]);
  });

  test('add_items and exchange_items called inside another module content hook apply', async () => {
    const { user_id } = await user(env);
    const r = await request(env, user_id, (ctx) => env.storage.with_hook_change_source(ctx, Source.ITEM_CHANGE_SOURCE_LIVE_EVENT, '3:1', () => [
      env.ledger.add_items(ctx, items(['[gold]', 10])),
      env.ledger.exchange_items(ctx, items(['[gold]', 4]), items(['[potion]', 1])),
    ]));
    expect(r.out).toEqual(['OK', 'OK']);
    expect(await balance(env, user_id, '[gold]')).toBe(6n);
    expect(await balance(env, user_id, '[potion]')).toBe(1n);
  });

  test('write operations inside validate_item_change and after_item_change end the operation INTERNAL with an error log', async () => {
    const { user_id } = await user(env);
    await set_balance(env, user_id, '[gold]', 100);
    const writes: [string, (ctx: Parameters<NonNullable<Env['hooks']['validate']>>[0]) => unknown][] = [
      ['add_items', (ctx) => env.ledger.add_items(ctx, items(['[potion]', 1]))],
      ['subtract_items', (ctx) => env.ledger.subtract_items(ctx, items(['[gold]', 1]))],
      ['exchange_items', (ctx) => env.ledger.exchange_items(ctx, items(['[gold]', 1]), items(['[potion]', 1]))],
      ['revoke_items', (ctx) => env.ledger.revoke_items(ctx, items(['[gold]', 1]))],
    ];
    for (const hook of ['validate', 'after'] as const) {
      for (const [name, write] of writes) {
        const errors = (logs(env, 'error')).length;
        env.hooks.validate = null;
        env.hooks.after = null;
        if (hook === 'validate') {
          env.hooks.validate = (ctx) => {
            try { write(ctx); } catch { /* the hook swallows it; the operation still ends INTERNAL */ }
            return 'pass';
          };
        } else {
          env.hooks.after = (ctx) => { write(ctx); };
        }
        await expect(request(env, user_id, (ctx) => env.ledger.add_items(ctx, items(['[ticket]', 1]))), `${hook} ${name}`).rejects.toThrow();
        expect((logs(env, 'error')).length, `${hook} ${name}`).toBeGreaterThan(errors);
      }
    }
    env.hooks.validate = null;
    env.hooks.after = null;
    expect(await balance(env, user_id, '[ticket]')).toBe(0n);
    expect(await balance(env, user_id, '[gold]')).toBe(100n);
    expect(await balance(env, user_id, '[potion]')).toBe(0n);
  });

  test('get_balance and check_items inside the hooks answer the balance before in validate and after in after; the operation succeeds', async () => {
    const { user_id } = await user(env);
    await set_balance(env, user_id, '[gold]', 10);
    const seen: unknown[] = [];
    env.hooks.validate = (ctx) => {
      seen.push(['validate', env.ledger.get_balance(ctx, id('[gold]')), env.ledger.check_items(ctx, items(['[gold]', 11]))]);
      return 'pass';
    };
    env.hooks.after = (ctx) => { seen.push(['after', env.ledger.get_balance(ctx, id('[gold]')), env.ledger.check_items(ctx, items(['[gold]', 11]))]); };
    expect(await tx(env, user_id, (ctx) => env.ledger.add_items(ctx, items(['[gold]', 5])))).toBe('OK');
    expect(seen).toEqual([['validate', 10n, false], ['after', 15n, true]]);
    expect(await balance(env, user_id, '[gold]')).toBe(15n);
  });

  test('a validate_item_change output that is neither pass nor a GameError ends the operation INTERNAL with an error log', async () => {
    const { user_id } = await user(env);
    env.hooks.validate = (() => null) as unknown as NonNullable<Env['hooks']['validate']>;
    const errors = logs(env, 'error').length;
    await expect(request(env, user_id, (ctx) => env.ledger.add_items(ctx, items(['[gold]', 1])))).rejects.toThrow();
    expect(logs(env, 'error').length).toBe(errors + 1);
    env.hooks.validate = null;
    expect(await balance(env, user_id, '[gold]')).toBe(0n);
  });

  test('revoke_items does not call validate_item_change and calls after_item_change', async () => {
    const { user_id } = await user(env);
    await set_balance(env, user_id, '[gold]', 10);
    const seen: string[] = [];
    env.hooks.validate = () => {
      seen.push('validate');
      return GAME_ERROR;
    };
    env.hooks.after = () => { seen.push('after'); };
    expect(await tx(env, user_id, (ctx) => env.module.revoke_items(ctx, items(['[gold]', 3]), { source: Source.ITEM_CHANGE_SOURCE_ADMIN, ref: 'revoke_items' }))).toEqual([{ item_id: id('[gold]'), shortfall: 0n }]);
    expect(seen).toEqual(['after']);
  });
});
