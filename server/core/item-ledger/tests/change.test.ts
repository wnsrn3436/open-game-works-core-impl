import * as CoreContract from '../../../generated/contract/core_contract.ts';
import type { RequestCtx } from '../../storage/index.ts';
import type { ItemBalanceChange } from '../index.ts';
import {
  amount, balance, balance_entries, change_rows, flush, history, id, items, logs, put_row, request, row, set_balance, Source, start, stop, tx, user, type Env,
} from './helpers.ts';

const HOUR = 3_600_000n;

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

describe('add, subtract, exchange', () => {
  test('change balances, history, the ItemBalanceUserState delta and the response item_changes together', async () => {
    const { user_id } = await user(env);
    const add = await request(env, user_id, (ctx) => env.ledger.add_items(ctx, items(['[gold]', 100], ['[potion]', 2])), 'core/TestAdd');
    expect(add.out).toBe('OK');
    expect(change_rows(add.delta.item_changes)).toEqual([
      [id('[gold]'), 100n, 0n, Source.ITEM_CHANGE_SOURCE_REQUEST, 'core/TestAdd'], [id('[potion]'), 2n, 0n, Source.ITEM_CHANGE_SOURCE_REQUEST, 'core/TestAdd'],
    ]);
    expect(balance_entries(add.delta.user_state).map(([i, r]) => [i, r === 'deleted' ? r : r.amount])).toEqual([[id('[gold]'), 100n], [id('[potion]'), 2n]]);

    const sub = await request(env, user_id, (ctx) => env.ledger.subtract_items(ctx, items(['[gold]', 30])));
    expect(sub.out).toBe('OK');
    expect(change_rows(sub.delta.item_changes)).toEqual([[id('[gold]'), -30n, 0n, Source.ITEM_CHANGE_SOURCE_REQUEST, 'core/Test']]);

    const ex = await request(env, user_id, (ctx) => env.ledger.exchange_items(ctx, items(['[gold]', 20]), items(['[ticket]', 1])));
    expect(ex.out).toBe('OK');
    expect(change_rows(ex.delta.item_changes)).toEqual([
      [id('[gold]'), -20n, 0n, Source.ITEM_CHANGE_SOURCE_REQUEST, 'core/Test'], [id('[ticket]'), 1n, 0n, Source.ITEM_CHANGE_SOURCE_REQUEST, 'core/Test'],
    ]);
    expect(await balance(env, user_id, '[gold]')).toBe(50n);
    expect(await balance(env, user_id, '[ticket]')).toBe(1n);
    expect(history(env, user_id).map((h) => [h.item_id, h.delta, h.balance_after, h.source, h.ref])).toEqual([
      [id('[gold]'), 100n, 100n, 'ITEM_CHANGE_SOURCE_REQUEST', 'core/TestAdd'],
      [id('[potion]'), 2n, 2n, 'ITEM_CHANGE_SOURCE_REQUEST', 'core/TestAdd'],
      [id('[gold]'), -30n, 70n, 'ITEM_CHANGE_SOURCE_REQUEST', 'core/Test'],
      [id('[gold]'), -20n, 50n, 'ITEM_CHANGE_SOURCE_REQUEST', 'core/Test'],
      [id('[ticket]'), 1n, 1n, 'ITEM_CHANGE_SOURCE_REQUEST', 'core/Test'],
    ]);
    expect(history(env, user_id).every((h) => h.request_id !== null)).toBe(true);
    // The response of the user's next request has no pending change from these requests.
    expect((await flush(env, user_id)).item_changes).toEqual([]);
  });

  test('a failed operation changes no balance, history or delta, also when one item of the list fails', async () => {
    const { user_id } = await user(env);
    await set_balance(env, user_id, '[gold]', 10);
    const before = history(env, user_id).length;
    const r = await request(env, user_id, (ctx) => env.ledger.subtract_items(ctx, items(['[potion]', 0], ['[gold]', 5])));
    expect(r.out).toBe('INVALID_AMOUNT');
    const r2 = await request(env, user_id, (ctx) => env.ledger.add_items(ctx, items(['[gold]', 5], ['[ticket]', 6])));
    expect(r2.out).toBe('LIMIT_EXCEEDED');
    const r3 = await request(env, user_id, (ctx) => env.ledger.exchange_items(ctx, items(['[gold]', 11]), items(['[potion]', 1])));
    expect(r3.out).toBe('NOT_ENOUGH');
    for (const x of [r, r2, r3]) {
      expect(x.delta.item_changes).toEqual([]);
      expect(balance_entries(x.delta.user_state)).toEqual([]);
    }
    expect(await balance(env, user_id, '[gold]')).toBe(10n);
    expect(await balance(env, user_id, '[potion]')).toBe(0n);
    expect(history(env, user_id).length).toBe(before);
  });

  test('a balance does not go below 0: NOT_ENOUGH', async () => {
    const { user_id } = await user(env);
    expect(await tx(env, user_id, (ctx) => env.ledger.subtract_items(ctx, items(['[gold]', 1])))).toBe('NOT_ENOUGH');
    await set_balance(env, user_id, '[gold]', 3);
    expect(await tx(env, user_id, (ctx) => env.ledger.subtract_items(ctx, items(['[gold]', 4])))).toBe('NOT_ENOUGH');
    expect(await balance(env, user_id, '[gold]')).toBe(3n);
  });

  test('input check: INVALID_AMOUNT, UNKNOWN_ITEM with an error log', async () => {
    const { user_id } = await user(env);
    const unknown = new CoreContract.ItemAmount();
    unknown.item_id = 999999;
    unknown.amount = 1n;
    expect(await tx(env, user_id, (ctx) => env.ledger.add_items(ctx, [unknown]))).toBe('UNKNOWN_ITEM');
    expect(await tx(env, user_id, (ctx) => env.ledger.add_items(ctx, items(['[gold]', 1], ['[gold]', 2])))).toBe('INVALID_AMOUNT');
    expect(await tx(env, user_id, (ctx) => env.ledger.add_items(ctx, items(['[gold]', -1])))).toBe('INVALID_AMOUNT');
    expect(await tx(env, user_id, (ctx) => env.ledger.add_items(ctx, items(['[gold]', 2n ** 53n])))).toBe('INVALID_AMOUNT');
    expect((logs(env, 'error')).filter((l) => l['user_id'] !== undefined && l['user_id'] === user_id.toString()).length).toBeGreaterThanOrEqual(4);
  });

  test('get_balance, get_ends_at, get_recovery are 0 / 0 / (0, 0) for an unknown item ID value and for the kinds they do not cover', async () => {
    const { user_id } = await user(env);
    await set_balance(env, user_id, '[gold]', 5);
    await set_balance(env, user_id, '[energy]', 3);
    const out = await tx(env, user_id, (ctx) => ({
      unknown: [env.ledger.get_balance(ctx, 999999), env.ledger.get_ends_at(ctx, 999999), env.ledger.get_recovery(ctx, 999999)],
      gold: [env.ledger.get_ends_at(ctx, id('[gold]')), env.ledger.get_recovery(ctx, id('[gold]'))],
      energy_ends_at: env.ledger.get_ends_at(ctx, id('[energy]')),
      group: [env.ledger.get_ends_at(ctx, id('[gem]')), env.ledger.get_recovery(ctx, id('[gem]'))],
    }));
    const none = { next_at: 0n, cap_at: 0n };
    expect(out).toEqual({ unknown: [0n, 0n, none], gold: [0n, none], energy_ends_at: 0n, group: [0n, none] });
  });

  test('check_items is false on INVALID_AMOUNT and UNKNOWN_ITEM input', async () => {
    const { user_id } = await user(env);
    await set_balance(env, user_id, '[gold]', 5);
    const unknown = new CoreContract.ItemAmount();
    unknown.item_id = 999999;
    unknown.amount = 1n;
    const out = await tx(env, user_id, (ctx) => [
      env.ledger.check_items(ctx, items(['[gold]', 5])),
      env.ledger.check_items(ctx, items(['[gold]', 0])),
      env.ledger.check_items(ctx, items(['[gold]', -1])),
      env.ledger.check_items(ctx, items(['[gold]', 1], ['[gold]', 1])),
      env.ledger.check_items(ctx, items(['[gold]', 2n ** 53n])),
      env.ledger.check_items(ctx, [unknown]),
      env.ledger.check_items(ctx, [...items(['[gold]', 1]), unknown]),
    ]);
    expect(out).toEqual([true, false, false, false, false, false, false]);
  });

  test('check_add_items gives the input check of add_items with the server build data', () => {
    const unknown = new CoreContract.ItemAmount();
    unknown.item_id = 999999;
    unknown.amount = 1n;
    expect(env.module.check_add_items(items(['[gold]', 1], ['[potion]', 2]))).toBe('OK');
    expect(env.module.check_add_items(items(['[gold]', 0]))).toBe('INVALID_AMOUNT');
    expect(env.module.check_add_items(items(['[gold]', 1], ['[gold]', 1]))).toBe('INVALID_AMOUNT');
    expect(env.module.check_add_items([unknown])).toBe('UNKNOWN_ITEM');
    expect(env.module.check_add_items(items(['[gem]', 1]))).toBe('UNSUPPORTED_ITEM');
    expect(env.module.check_add_items([unknown, ...items(['[gem]', 1], ['[gold]', -1])])).toBe('INVALID_AMOUNT');
  });

  test('Reject is LIMIT_EXCEEDED, Discard fills max_amount and records the overflow in history and ItemChange', async () => {
    const { user_id } = await user(env);
    await set_balance(env, user_id, '[ticket]', 4);
    expect(await tx(env, user_id, (ctx) => env.ledger.add_items(ctx, items(['[ticket]', 2])))).toBe('LIMIT_EXCEEDED');
    expect(await balance(env, user_id, '[ticket]')).toBe(4n);
    await set_balance(env, user_id, '[potion]', 8);
    const r = await request(env, user_id, (ctx) => env.ledger.add_items(ctx, items(['[potion]', 5])));
    expect(r.out).toBe('OK');
    expect(change_rows(r.delta.item_changes)).toEqual([[id('[potion]'), 2n, 3n, Source.ITEM_CHANGE_SOURCE_REQUEST, 'core/Test']]);
    expect(await balance(env, user_id, '[potion]')).toBe(10n);
    const last = history(env, user_id).at(-1);
    expect([last?.delta, last?.balance_after, last?.overflow]).toEqual([2n, 10n, 3n]);
  });

  test('Convert fills max_amount and grants the overflow × convert_to amount to the replacement item right after it', async () => {
    const { user_id } = await user(env);
    await set_balance(env, user_id, '[shard]', 8);
    const r = await request(env, user_id, (ctx) => env.ledger.add_items(ctx, items(['[shard]', 5], ['[gold]', 1])));
    expect(r.out).toBe('OK');
    expect(change_rows(r.delta.item_changes)).toEqual([
      [id('[shard]'), 2n, 3n, Source.ITEM_CHANGE_SOURCE_REQUEST, 'core/Test'],
      [id('[dust]'), 6n, 0n, Source.ITEM_CHANGE_SOURCE_OVERFLOW, String(id('[shard]'))],
      [id('[gold]'), 1n, 0n, Source.ITEM_CHANGE_SOURCE_REQUEST, 'core/Test'],
    ]);
    expect(await balance(env, user_id, '[shard]')).toBe(10n);
    expect(await balance(env, user_id, '[dust]')).toBe(6n);
    const rows = history(env, user_id).slice(-3);
    expect(rows.map((h) => [h.item_id, h.source, h.ref, h.once_key])).toEqual([
      [id('[shard]'), 'ITEM_CHANGE_SOURCE_REQUEST', 'core/Test', ''],
      [id('[dust]'), 'ITEM_CHANGE_SOURCE_OVERFLOW', String(id('[shard]')), ''],
      [id('[gold]'), 'ITEM_CHANGE_SOURCE_REQUEST', 'core/Test', ''],
    ]);
    expect(new Set(rows.map((h) => h.request_id)).size).toBe(1);
    expect(new Set(rows.map((h) => h.time)).size).toBe(1);
  });

  test('a Reject replacement item over max_amount makes the whole operation LIMIT_EXCEEDED; a Discard one fills max_amount', async () => {
    const { user_id } = await user(env);
    await set_balance(env, user_id, '[badge_coin]', 10);
    await set_balance(env, user_id, '[ticket]', 5);
    const before = history(env, user_id).length;
    expect(await tx(env, user_id, (ctx) => env.ledger.add_items(ctx, items(['[badge_coin]', 1], ['[gold]', 1])))).toBe('LIMIT_EXCEEDED');
    expect(await balance(env, user_id, '[gold]')).toBe(0n);
    expect(history(env, user_id).length).toBe(before);
    await set_balance(env, user_id, '[shard]', 10);
    await set_balance(env, user_id, '[dust]', 45);
    expect(await tx(env, user_id, (ctx) => env.ledger.add_items(ctx, items(['[shard]', 4])))).toBe('OK');
    expect(await balance(env, user_id, '[dust]')).toBe(50n);
    const last = history(env, user_id).at(-1);
    expect([last?.item_id, last?.delta, last?.overflow]).toEqual([id('[dust]'), 5n, 3n]);
  });

  test('the second operation with the same once_key is ALREADY_APPLIED, also for the Convert grant, with an info log', async () => {
    const { user_id } = await user(env);
    await set_balance(env, user_id, '[shard]', 10);
    expect(await tx(env, user_id, (ctx) => env.ledger.add_items(ctx, items(['[shard]', 2]), { once_key: 'quest:1' }))).toBe('OK');
    expect(await balance(env, user_id, '[dust]')).toBe(4n);
    const before = history(env, user_id).length;
    expect(await tx(env, user_id, (ctx) => env.ledger.add_items(ctx, items(['[shard]', 2]), { once_key: 'quest:1' }))).toBe('ALREADY_APPLIED');
    expect(await tx(env, user_id, (ctx) => env.ledger.exchange_items(ctx, items(['[dust]', 1]), items(['[gold]', 1]), { once_key: 'quest:1' }))).toBe('ALREADY_APPLIED');
    expect(await balance(env, user_id, '[dust]')).toBe(4n);
    expect(history(env, user_id).length).toBe(before);
    expect(history(env, user_id).filter((h) => h.once_key === 'quest:1').map((h) => h.item_id)).toEqual([id('[shard]')]);
    expect((logs(env, 'core', 'info')).some((l) => l['once_key'] === 'quest:1' && l['module'] === 'item-ledger')).toBe(true);
  });

  test('exchange of the same item is one net change; a net change of 0 has no ItemChange and no history row', async () => {
    const { user_id } = await user(env);
    await set_balance(env, user_id, '[gold]', 10);
    const before = history(env, user_id).length;
    const zero = await request(env, user_id, (ctx) => env.ledger.exchange_items(ctx, items(['[gold]', 5]), items(['[gold]', 5], ['[potion]', 1])));
    expect(zero.out).toBe('OK');
    expect(change_rows(zero.delta.item_changes).map((c) => [c[0], c[1]])).toEqual([[id('[potion]'), 1n]]);
    expect(history(env, user_id).slice(before).map((h) => h.item_id)).toEqual([id('[potion]')]);
    const net = await request(env, user_id, (ctx) => env.ledger.exchange_items(ctx, items(['[gold]', 7]), items(['[gold]', 3])));
    expect(change_rows(net.delta.item_changes).map((c) => [c[0], c[1]])).toEqual([[id('[gold]'), -4n]]);
    expect(history(env, user_id).at(-1)?.delta).toBe(-4n);
    expect(await balance(env, user_id, '[gold]')).toBe(6n);
  });

  test('a balance saved over a smaller max_amount: Discard add keeps it with overflow, subtract lowers it, a timed Discard add keeps ends_at; a net 0 exchange is OK for Reject, Discard and Convert with no ItemChange or history', async () => {
    const { user_id } = await user(env);
    await put_row(env, user_id, '[potion]', { amount: 15n });
    const add = await request(env, user_id, (ctx) => env.ledger.add_items(ctx, items(['[potion]', 1])));
    expect(add.out).toBe('OK');
    expect(change_rows(add.delta.item_changes)).toEqual([[id('[potion]'), 0n, 1n, Source.ITEM_CHANGE_SOURCE_REQUEST, 'core/Test']]);
    expect(await balance(env, user_id, '[potion]')).toBe(15n);
    const sub = await request(env, user_id, (ctx) => env.ledger.subtract_items(ctx, items(['[potion]', 1])));
    expect(change_rows(sub.delta.item_changes)).toEqual([[id('[potion]'), -1n, 0n, Source.ITEM_CHANGE_SOURCE_REQUEST, 'core/Test']]);
    expect(await balance(env, user_id, '[potion]')).toBe(14n);

    const ends_at = env.server.clock.now() + 4n * HOUR;
    await put_row(env, user_id, '[boost_discard]', { ends_at });
    const timed = await request(env, user_id, (ctx) => env.ledger.add_items(ctx, items(['[boost_discard]', 1])));
    expect(timed.out).toBe('OK');
    expect(change_rows(timed.delta.item_changes)).toEqual([[id('[boost_discard]'), 0n, 1n, Source.ITEM_CHANGE_SOURCE_REQUEST, 'core/Test']]);
    expect((await row(env, user_id, '[boost_discard]'))?.ends_at).toBe(ends_at);

    await put_row(env, user_id, '[ticket]', { amount: 7n });
    await put_row(env, user_id, '[shard]', { amount: 12n });
    const before = history(env, user_id).length;
    for (const [name, b] of [['[ticket]', 7n], ['[potion]', 14n], ['[shard]', 12n]] as const) {
      const ex = await request(env, user_id, (ctx) => env.ledger.exchange_items(ctx, items([name, 1]), items([name, 1])));
      expect([name, ex.out, ex.delta.item_changes, balance_entries(ex.delta.user_state)]).toEqual([name, 'OK', [], []]);
      expect(await balance(env, user_id, name)).toBe(b);
    }
    expect(await balance(env, user_id, '[dust]')).toBe(0n);
    expect(history(env, user_id).length).toBe(before);
  });

  test('item_changes order: X Convert overflow then its Y grant over a net 0 Y; B, A then the group member; X then the group member; two Convert grants into one Discard item each after its item', async () => {
    const { user_id } = await user(env);
    await set_balance(env, user_id, '[badge_coin]', 10);
    await set_balance(env, user_id, '[ticket]', 2);
    const seen: { hook: string; list: readonly ItemBalanceChange[] }[] = [];
    env.hooks.validate = (_ctx, _source, list) => {
      seen.push({ hook: 'validate', list });
      return 'pass';
    };
    env.hooks.after = (_ctx, _source, list) => { seen.push({ hook: 'after', list }); };
    const yx = await request(env, user_id, (ctx) => env.ledger.exchange_items(ctx, items(['[ticket]', 1]), items(['[ticket]', 1], ['[badge_coin]', 1])));
    env.hooks.validate = null;
    env.hooks.after = null;
    expect(yx.out).toBe('OK');
    expect(change_rows(yx.delta.item_changes)).toEqual([
      [id('[badge_coin]'), 0n, 1n, Source.ITEM_CHANGE_SOURCE_REQUEST, 'core/Test'],
      [id('[ticket]'), 1n, 0n, Source.ITEM_CHANGE_SOURCE_OVERFLOW, String(id('[badge_coin]'))],
    ]);
    const list = [{ item_id: id('[badge_coin]'), before: 10n, after: 10n }, { item_id: id('[ticket]'), before: 2n, after: 3n }];
    expect(seen).toEqual([{ hook: 'validate', list }, { hook: 'after', list }]);

    await set_balance(env, user_id, '[gold]', 5);
    await set_balance(env, user_id, '[gem_paid]', 5);
    const bga = await request(env, user_id, (ctx) => env.ledger.exchange_items(ctx, items(['[gold]', 1], ['[gem]', 1]), items(['[potion]', 1])));
    expect(bga.out).toBe('OK');
    expect(change_rows(bga.delta.item_changes).map((c) => [c[0], c[1]])).toEqual([[id('[gold]'), -1n], [id('[potion]'), 1n], [id('[gem_paid]'), -1n]]);
    const gx = await request(env, user_id, (ctx) => env.ledger.subtract_items(ctx, items(['[gem]', 2], ['[gold]', 1])));
    expect(gx.out).toBe('OK');
    expect(change_rows(gx.delta.item_changes).map((c) => [c[0], c[1]])).toEqual([[id('[gold]'), -1n], [id('[gem_paid]'), -2n]]);

    await set_balance(env, user_id, '[ledger_convert_1]', 5);
    await set_balance(env, user_id, '[ledger_convert_2]', 5);
    await set_balance(env, user_id, '[ledger_convert_target]', 4);
    const before = history(env, user_id).length;
    const two = await request(env, user_id, (ctx) => env.ledger.exchange_items(ctx, items(['[ledger_convert_1]', 1]), items(['[ledger_convert_2]', 1], ['[ledger_convert_1]', 2])));
    expect(two.out).toBe('OK');
    const x1 = String(id('[ledger_convert_1]'));
    const x2 = String(id('[ledger_convert_2]'));
    expect(change_rows(two.delta.item_changes)).toEqual([
      [id('[ledger_convert_1]'), 0n, 1n, Source.ITEM_CHANGE_SOURCE_REQUEST, 'core/Test'],
      [id('[ledger_convert_target]'), 1n, 0n, Source.ITEM_CHANGE_SOURCE_OVERFLOW, x1],
      [id('[ledger_convert_2]'), 0n, 1n, Source.ITEM_CHANGE_SOURCE_REQUEST, 'core/Test'],
      [id('[ledger_convert_target]'), 0n, 1n, Source.ITEM_CHANGE_SOURCE_OVERFLOW, x2],
    ]);
    expect(history(env, user_id).slice(before).map((h) => [h.item_id, h.delta, h.overflow, h.source, h.ref])).toEqual([
      [id('[ledger_convert_1]'), 0n, 1n, 'ITEM_CHANGE_SOURCE_REQUEST', 'core/Test'],
      [id('[ledger_convert_target]'), 1n, 0n, 'ITEM_CHANGE_SOURCE_OVERFLOW', x1],
      [id('[ledger_convert_2]'), 0n, 1n, 'ITEM_CHANGE_SOURCE_REQUEST', 'core/Test'],
      [id('[ledger_convert_target]'), 0n, 1n, 'ITEM_CHANGE_SOURCE_OVERFLOW', x2],
    ]);
    expect(await balance(env, user_id, '[ledger_convert_target]')).toBe(5n);
  });

  test('a balance of 0 deletes the ItemBalanceUserState row', async () => {
    const { user_id } = await user(env);
    await set_balance(env, user_id, '[gold]', 5);
    const r = await request(env, user_id, (ctx) => env.ledger.subtract_items(ctx, items(['[gold]', 5])));
    expect(balance_entries(r.delta.user_state)).toEqual([[id('[gold]'), 'deleted']]);
    expect(await row(env, user_id, '[gold]')).toBeNull();
  });
});

describe('change source', () => {
  test('a caller source Recovery or Overflow changes nothing and throws without a log of item-ledger; a request that does not catch it is INTERNAL', async () => {
    const { user_id } = await user(env);
    for (const source of [Source.ITEM_CHANGE_SOURCE_RECOVERY, Source.ITEM_CHANGE_SOURCE_OVERFLOW]) {
      const lines = env.server.lines.length;
      await expect(request(env, user_id, (ctx) => env.module.add_items(ctx, items(['[gold]', 1]), { source }))).rejects.toThrow();
      expect(env.server.lines.length).toBe(lines);
    }
    expect(await balance(env, user_id, '[gold]')).toBe(0n);
  });

  test('a caller source Recovery or Overflow that the handler catches changed nothing, and the request goes on to commit its other changes', async () => {
    const { user_id } = await user(env);
    for (const source of [Source.ITEM_CHANGE_SOURCE_RECOVERY, Source.ITEM_CHANGE_SOURCE_OVERFLOW]) {
      const lines = env.server.lines.length;
      const r = await request(env, user_id, (ctx) => {
        let thrown = false;
        try {
          env.module.add_items(ctx, items(['[gold]', 1]), { source, once_key: `caught-${String(source)}` });
        } catch {
          thrown = true;
        }
        return [thrown, env.ledger.add_items(ctx, items(['[potion]', 1]))];
      });
      expect(r.out).toEqual([true, 'OK']);
      expect(change_rows(r.delta.item_changes).map((c) => c[0])).toEqual([id('[potion]')]);
      expect(env.server.lines.length).toBe(lines);
    }
    expect(await balance(env, user_id, '[gold]')).toBe(0n);
    expect(await balance(env, user_id, '[potion]')).toBe(2n);
    expect(history(env, user_id).map((h) => h.item_id)).toEqual([id('[potion]'), id('[potion]')]);
  });

  test('content code with once_key shop:1 changes nothing and throws without a log of item-ledger: INTERNAL when not caught; shop:<request ID> from shop applies', async () => {
    const { user_id } = await user(env);
    const lines = env.server.lines.length;
    await expect(request(env, user_id, (ctx) => env.ledger.add_items(ctx, items(['[gold]', 1]), { once_key: 'shop:1' }))).rejects.toThrow();
    expect(await balance(env, user_id, '[gold]')).toBe(0n);
    expect(history(env, user_id)).toEqual([]);
    expect(env.server.lines.length).toBe(lines);
    // The once_key table has no shop:1: the same key from shop applies.
    const r = await request(env, user_id, (ctx) => env.module.add_items(ctx, items(['[gold]', 1]), { source: Source.ITEM_CHANGE_SOURCE_SHOP, ref: '5', once_key: 'shop:1' }));
    expect(r.out).toBe('OK');
    const s = await request(env, user_id, (ctx) => env.module.add_items(ctx, items(['[gold]', 1]), { source: Source.ITEM_CHANGE_SOURCE_SHOP, ref: '5', once_key: `shop:${ctx.request_id}` }));
    expect(s.out).toBe('OK');
    expect(history(env, user_id).map((h) => [h.source, h.ref])).toEqual([['ITEM_CHANGE_SOURCE_SHOP', '5'], ['ITEM_CHANGE_SOURCE_SHOP', '5']]);
  });

  test('inside with_hook_change_source(ctx, LiveEvent, 7:2) content changes are LiveEvent 7:2 or the content ref; outside Request and the request name', async () => {
    const { user_id } = await user(env);
    const r = await request(env, user_id, (ctx) => [
      env.storage.with_hook_change_source(ctx, Source.ITEM_CHANGE_SOURCE_LIVE_EVENT, '7:2', () => env.ledger.add_items(ctx, items(['[gold]', 1]))),
      env.storage.with_hook_change_source(ctx, Source.ITEM_CHANGE_SOURCE_LIVE_EVENT, '7:2', () => env.ledger.exchange_items(ctx, items(['[gold]', 1]), items(['[potion]', 1]), { ref: 'content-ref' })),
      env.ledger.add_items(ctx, items(['[ticket]', 1])),
    ], 'core/TestHook');
    expect(r.out).toEqual(['OK', 'OK', 'OK']);
    expect(change_rows(r.delta.item_changes).map((c) => [c[0], c[3], c[4]])).toEqual([
      [id('[gold]'), Source.ITEM_CHANGE_SOURCE_LIVE_EVENT, '7:2'],
      [id('[gold]'), Source.ITEM_CHANGE_SOURCE_LIVE_EVENT, 'content-ref'],
      [id('[potion]'), Source.ITEM_CHANGE_SOURCE_LIVE_EVENT, 'content-ref'],
      [id('[ticket]'), Source.ITEM_CHANGE_SOURCE_REQUEST, 'core/TestHook'],
    ]);
    expect(history(env, user_id).map((h) => [h.source, h.ref])).toEqual([
      ['ITEM_CHANGE_SOURCE_LIVE_EVENT', '7:2'], ['ITEM_CHANGE_SOURCE_LIVE_EVENT', 'content-ref'], ['ITEM_CHANGE_SOURCE_LIVE_EVENT', 'content-ref'],
      ['ITEM_CHANGE_SOURCE_REQUEST', 'core/TestHook'],
    ]);
  });

  test('a core module call without a source changes nothing and throws without a log', async () => {
    const { user_id } = await user(env);
    const lines = env.server.lines.length;
    await expect(request(env, user_id, (ctx) => env.module.add_items(ctx, items(['[gold]', 1]), {}))).rejects.toThrow();
    expect(env.server.lines.length).toBe(lines);
    expect(await balance(env, user_id, '[gold]')).toBe(0n);
  });

  test('content add_items with a core once_key prefix that the handler catches: the request is OK with no change and no log of item-ledger', async () => {
    const { user_id } = await user(env);
    const lines = env.server.lines.length;
    const r = await request(env, user_id, (ctx) => {
      try {
        env.ledger.add_items(ctx, items(['[gold]', 1]), { once_key: 'mail:9' });
        return 'applied';
      } catch {
        return 'thrown';
      }
    });
    expect(r.out).toBe('thrown');
    expect(r.delta.item_changes).toEqual([]);
    expect(balance_entries(r.delta.user_state)).toEqual([]);
    expect(env.server.lines.length).toBe(lines);
    expect(await balance(env, user_id, '[gold]')).toBe(0n);
    expect(history(env, user_id)).toEqual([]);
  });

  test('a once_key with an unpaired surrogate, from content code or a core module, changes nothing and throws without a log', async () => {
    const { user_id } = await user(env);
    const calls: [string, (ctx: RequestCtx) => unknown][] = [
      ['content add_items', (ctx) => env.ledger.add_items(ctx, items(['[gold]', 1]), { once_key: 'a\uD800b' })],
      ['content subtract_items', (ctx) => env.ledger.subtract_items(ctx, items(['[gold]', 1]), { once_key: '\uDC00' })],
      ['content revoke_items', (ctx) => env.ledger.revoke_items(ctx, items(['[gold]', 1]), { once_key: 'x\uD83D' })],
      ['core add_items', (ctx) => env.module.add_items(ctx, items(['[gold]', 1]), { source: Source.ITEM_CHANGE_SOURCE_SHOP, ref: '1', once_key: 'shop:\uDFFF' })],
      ['core exchange_items', (ctx) => env.module.exchange_items(ctx, [], items(['[gold]', 1]), { source: Source.ITEM_CHANGE_SOURCE_SHOP, ref: '1', once_key: 'shop:\uD800' })],
    ];
    await set_balance(env, user_id, '[gold]', 3);
    for (const [name, call] of calls) {
      const lines = env.server.lines.length;
      const r = await request(env, user_id, (ctx) => {
        try {
          call(ctx);
          return 'applied';
        } catch {
          return 'thrown';
        }
      });
      expect(r.out, name).toBe('thrown');
      expect(r.delta.item_changes, name).toEqual([]);
      expect(env.server.lines.length, name).toBe(lines);
    }
    expect(await balance(env, user_id, '[gold]')).toBe(3n);
    // A well-formed surrogate pair has UTF-8 bytes and applies.
    const r = await request(env, user_id, (ctx) => env.ledger.add_items(ctx, items(['[gold]', 1]), { once_key: 'pair-\uD83D\uDE00' }));
    expect(r.out).toBe('OK');
  });

  test('content add_items with source Recovery outside with_hook_change_source records source Request', async () => {
    const { user_id } = await user(env);
    const r = await request(env, user_id, (ctx) => env.ledger.add_items(ctx, items(['[gold]', 1]), { source: Source.ITEM_CHANGE_SOURCE_RECOVERY }), 'core/TestRecovery');
    expect(r.out).toBe('OK');
    expect(change_rows(r.delta.item_changes)).toEqual([[id('[gold]'), 1n, 0n, Source.ITEM_CHANGE_SOURCE_REQUEST, 'core/TestRecovery']]);
    expect(history(env, user_id).map((h) => [h.item_id, h.source, h.ref])).toEqual([[id('[gold]'), 'ITEM_CHANGE_SOURCE_REQUEST', 'core/TestRecovery']]);
  });

  test('a ref content code passes is the ref, with source Request', async () => {
    const { user_id } = await user(env);
    const r = await request(env, user_id, (ctx) => env.ledger.add_items(ctx, [amount('[gold]', 1)], { ref: 'mine' }));
    expect(change_rows(r.delta.item_changes)[0]?.slice(3)).toEqual([Source.ITEM_CHANGE_SOURCE_REQUEST, 'mine']);
  });
});
