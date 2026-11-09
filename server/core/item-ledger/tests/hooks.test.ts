import * as CoreContract from '../../../generated/contract/core_contract.ts';
import * as GameContract from '../../../generated/contract/game_contract.ts';
import type { RequestCtx } from '../../storage/index.ts';
import type { ItemBalanceChange } from '../index.ts';
import { balance, change_rows, history, id, items, logs, request, set_balance, Source, start, stop, tx, user, type Env } from './helpers.ts';

/** A `[ticket]` balance row the failing transactions also write, to show that nothing of them is saved. */
function ticket_marker(): CoreContract.ItemBalanceUserState {
  const s = new CoreContract.ItemBalanceUserState();
  s.id = BigInt(id('[ticket]'));
  s.amount = 1n;
  return s;
}

let request_count = 0;

function request_fields(): { request_name: string; request_id: string; silent: boolean; retry: boolean; session_id: string; client_version: string; platform: string } {
  request_count += 1;
  return { request_name: 'core/TestHookFailure', request_id: `hook-failure-${String(request_count)}`, silent: false, retry: false, session_id: 'session-1', client_version: '1.0.0', platform: 'android' };
}

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

  test('an exchange subtracting 1 and adding 1 of X and adding 1 of Y passes both hooks a list with Y and not X', async () => {
    const { user_id } = await user(env);
    await set_balance(env, user_id, '[gold]', 5);
    const seen: { hook: string; list: readonly ItemBalanceChange[] }[] = [];
    env.hooks.validate = (_ctx, _source, list) => {
      seen.push({ hook: 'validate', list });
      return 'pass';
    };
    env.hooks.after = (_ctx, _source, list) => { seen.push({ hook: 'after', list }); };
    expect(await tx(env, user_id, (ctx) => env.ledger.exchange_items(ctx, items(['[gold]', 1]), items(['[gold]', 1], ['[potion]', 1])))).toBe('OK');
    const list = [{ item_id: id('[potion]'), before: 0n, after: 1n }];
    expect(seen).toEqual([{ hook: 'validate', list }, { hook: 'after', list }]);
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

  const writes: [string, (ctx: RequestCtx) => unknown][] = [
    ['add_items', (ctx) => env.ledger.add_items(ctx, items(['[potion]', 1]))],
    ['subtract_items', (ctx) => env.ledger.subtract_items(ctx, items(['[gold]', 1]))],
    ['exchange_items', (ctx) => env.ledger.exchange_items(ctx, items(['[gold]', 1]), items(['[potion]', 1]))],
    ['revoke_items', (ctx) => env.ledger.revoke_items(ctx, items(['[gold]', 1]))],
    ['set_balance', (ctx) => env.server.dev?.set_balance(ctx, id('[potion]'), 5n)],
  ];

  test('write operations inside validate_item_change and after_item_change, with a hook that lets the throw out, end the operation INTERNAL with one error log of item-ledger', async () => {
    const { user_id } = await user(env);
    await set_balance(env, user_id, '[gold]', 100);
    for (const hook of ['validate', 'after'] as const) {
      for (const [name, write] of writes) {
        const lines = env.server.lines.length;
        env.hooks.validate = null;
        env.hooks.after = null;
        if (hook === 'validate') {
          env.hooks.validate = (ctx) => {
            write(ctx);
            return 'pass';
          };
        } else {
          env.hooks.after = (ctx) => { write(ctx); };
        }
        await expect(request(env, user_id, (ctx) => env.ledger.add_items(ctx, items(['[ticket]', 1]))), `${hook} ${name}`).rejects.toThrow();
        const added = env.server.lines.slice(lines).map((line) => JSON.parse(line) as Record<string, unknown>);
        expect(added.map((line) => [line.kind, line.level]), `${hook} ${name}`).toEqual([['error', 'error']]);
      }
    }
    env.hooks.validate = null;
    env.hooks.after = null;
    expect(await balance(env, user_id, '[ticket]')).toBe(0n);
    expect(await balance(env, user_id, '[gold]')).toBe(100n);
    expect(await balance(env, user_id, '[potion]')).toBe(0n);
  });

  test('a write operation inside either hook throws without a log; a hook that catches it goes on, and the operation that called the hook applies', async () => {
    const { user_id } = await user(env);
    await set_balance(env, user_id, '[gold]', 100);
    let added = 0n;
    for (const hook of ['validate', 'after'] as const) {
      for (const [name, write] of writes) {
        const lines = env.server.lines.length;
        let thrown = false;
        const catching = (ctx: RequestCtx): void => {
          try {
            write(ctx);
          } catch {
            thrown = true;
          }
        };
        env.hooks.validate = null;
        env.hooks.after = null;
        if (hook === 'validate') {
          env.hooks.validate = (ctx) => {
            catching(ctx);
            return 'pass';
          };
        } else {
          env.hooks.after = (ctx) => { catching(ctx); };
        }
        const r = await request(env, user_id, (ctx) => env.ledger.add_items(ctx, items(['[gold]', 1])));
        added += 1n;
        expect(r.out, `${hook} ${name}`).toBe('OK');
        expect(thrown, `${hook} ${name}`).toBe(true);
        expect(change_rows(r.delta.item_changes).map((c) => c[0]), `${hook} ${name}`).toEqual([id('[gold]')]);
        expect(env.server.lines.length, `${hook} ${name}`).toBe(lines);
      }
    }
    env.hooks.validate = null;
    env.hooks.after = null;
    expect(await balance(env, user_id, '[gold]')).toBe(100n + added);
    expect(await balance(env, user_id, '[potion]')).toBe(0n);
  });

  test('a hook failure is FAILED also when the caller catches the throw: a request, an out-of-request change and a game of both hooks save nothing', async () => {
    const { user_id } = await user(env);
    await set_balance(env, user_id, '[gold]', 10);
    const failures: [string, () => void][] = [
      ['validate throws', () => { env.hooks.validate = () => { throw new Error('validate hook bug'); }; }],
      ['validate output', () => { env.hooks.validate = (() => 'yes') as unknown as NonNullable<Env['hooks']['validate']>; }],
      ['after throws', () => { env.hooks.after = () => { throw new Error('after hook bug'); }; }],
      ['after lets a write out', () => { env.hooks.after = (ctx) => { env.ledger.add_items(ctx, items(['[potion]', 1])); }; }],
    ];
    for (const [name, arm] of failures) {
      env.hooks.validate = null;
      env.hooks.after = null;
      arm();
      const lines = env.server.lines.length;
      const caught: unknown[] = [];
      const body = (ctx: RequestCtx): void => {
        env.storage.put_core_state(ctx, ticket_marker());
        try {
          env.ledger.add_items(ctx, items(['[gold]', 1]));
        } catch (error) {
          caught.push(error);
        }
      };
      const result = await env.storage.run_request_transaction(user_id, request_fields(), (ctx) => {
        body(ctx);
        return 'response';
      });
      expect(result, name).toBe('FAILED');
      const out = await env.storage.run_user_transaction(user_id, (ctx) => {
        body(ctx);
        return 'pass';
      });
      expect(out, name).toBe('FAILED');
      expect(caught, name).toHaveLength(2);
      const added = env.server.lines.slice(lines).map((line) => JSON.parse(line) as Record<string, unknown>);
      expect(added.map((line) => [line.kind, line.level]), name).toEqual([['error', 'error'], ['error', 'error']]);
    }
    env.hooks.validate = null;
    env.hooks.after = null;
    expect(await balance(env, user_id, '[gold]')).toBe(10n);
    expect(await balance(env, user_id, '[potion]')).toBe(0n);
    expect(await balance(env, user_id, '[ticket]')).toBe(0n);
    expect(history(env, user_id).filter((h) => h.item_id === id('[gold]')).map((h) => h.delta)).toEqual([10n]);
  });

  test('a hook failure on a transaction a core module already marked failed still leaves one error log and lets the hook throw out', async () => {
    const { user_id } = await user(env);
    const hook_error = new Error('after hook bug');
    env.hooks.after = (ctx) => {
      env.storage.fail_transaction(ctx);
      throw hook_error;
    };
    const lines = env.server.lines.length;
    let caught: unknown = null;
    const result = await env.storage.run_user_transaction(user_id, (ctx) => {
      try {
        env.ledger.add_items(ctx, items(['[gold]', 1]));
      } catch (error) {
        caught = error;
      }
      return 'pass';
    });
    expect(caught).toBe(hook_error);
    expect(result).toBe('FAILED');
    const added = env.server.lines.slice(lines).map((line) => JSON.parse(line) as Record<string, unknown>);
    expect(added.map((line) => [line.kind, line.level, line.message])).toEqual([['error', 'error', 'hook after_item_change threw']]);
    env.hooks.after = null;
    expect(await balance(env, user_id, '[gold]')).toBe(0n);
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

  test('a validate_item_change output that is neither pass nor a GameError ends the operation INTERNAL with one error log', async () => {
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
