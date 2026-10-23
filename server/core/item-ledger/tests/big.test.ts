import * as CoreCheatContract from '../../../dev/generated/contract/core_cheat_contract.ts';
import * as CoreContract from '../../../generated/contract/core_contract.ts';
import { balance, change_rows, fixture, history, id, items, put_row, request, row, send_set_item_balance, set_balance, start, stop, tx, user, type Env } from './helpers.ts';
import type { FixtureCase } from './helpers.ts';

const MAX = 2n ** 53n - 1n;

type DbValue = bigint | number | string | null;

/** The stored history columns of the user's rows, `seq` ascending, as the table has them. */
function raw_history(user_id: bigint): { delta: bigint; big_delta: string | null; balance_after: bigint; big_balance_after: string | null }[] {
  const rows = env.storage.read_db().query(
    'SELECT delta, big_delta, balance_after, big_balance_after FROM item_ledger_history WHERE user_id = $1 ORDER BY seq ASC', [user_id],
  ) as readonly Record<string, DbValue>[];
  const int64 = (v: DbValue | undefined): bigint => (typeof v === 'bigint' ? v : BigInt(v as number | string));
  const text = (v: DbValue | undefined): string | null => (v === null || v === undefined ? null : String(v));
  return rows.map((r) => ({ delta: int64(r['delta']), big_delta: text(r['big_delta']), balance_after: int64(r['balance_after']), big_balance_after: text(r['big_balance_after']) }));
}
const LIMIT_20 = 10n ** 20n - 1n;

let env: Env;

beforeAll(async () => {
  env = await start();
});

afterAll(() => {
  stop();
});

/** A case of core test fixture `item-big`: balances and amounts are big integer strings. */
interface BigInput {
  readonly item: string;
  readonly balance: string;
  readonly amount: string;
}

interface BigExpected {
  readonly outcome: string;
  readonly applied: string;
  readonly overflow: string;
  readonly result: string;
}

describe('big item', () => {
  test('core test fixture item-big: preview_add_items rows and the add_items result', async () => {
    for (const c of fixture('item-big') as FixtureCase<BigInput, BigExpected>[]) {
      const { user_id } = await user(env);
      const bal = BigInt(c.input.balance);
      if (bal > 0n) await put_row(env, user_id, c.input.item, bal > MAX ? { big_amount: bal.toString() } : { amount: bal });
      const list = items([c.input.item, c.input.amount]);
      const out = await tx(env, user_id, (ctx) => ({ preview: env.ledger.preview_add_items(ctx, list), result: env.ledger.add_items(ctx, list) }));
      expect(out.preview, c.name).toEqual([{ item_id: id(c.input.item), outcome: c.expected.outcome, applied: BigInt(c.expected.applied), overflow: BigInt(c.expected.overflow), replacements: [] }]);
      expect(out.result, c.name).toBe(c.expected.result);
      expect(await balance(env, user_id, c.input.item), c.name).toBe(bal + BigInt(c.expected.applied));
    }
  });

  test('past 2^53-1 the balance, big_amount, big_delta and the history big columns carry the value; back at or under 2^53-1 the big fields are empty', async () => {
    const { user_id } = await user(env);
    const up = await request(env, user_id, (ctx) => env.ledger.add_items(ctx, items(['[big_gold]', MAX + 10n])));
    expect(up.out).toBe('OK');
    const change = up.delta.item_changes[0] as CoreContract.ItemChange;
    expect([change.delta, change.big_delta]).toEqual([0n, (MAX + 10n).toString()]);
    const stored = await row(env, user_id, '[big_gold]');
    expect([stored?.amount, stored?.big_amount]).toEqual([0n, (MAX + 10n).toString()]);
    expect(await balance(env, user_id, '[big_gold]')).toBe(MAX + 10n);
    const h = history(env, user_id).at(-1);
    expect([h?.delta, h?.balance_after]).toEqual([MAX + 10n, MAX + 10n]);

    const down = await request(env, user_id, (ctx) => env.ledger.subtract_items(ctx, items(['[big_gold]', 20])));
    expect(down.out).toBe('OK');
    const back = await row(env, user_id, '[big_gold]');
    expect([back?.amount, back?.big_amount]).toEqual([MAX - 10n, '']);
    const c2 = down.delta.item_changes[0] as CoreContract.ItemChange;
    expect([c2.delta, c2.big_delta]).toEqual([-20n, '']);
    expect(raw_history(user_id)).toEqual([
      { delta: 0n, big_delta: (MAX + 10n).toString(), balance_after: 0n, big_balance_after: (MAX + 10n).toString() },
      { delta: -20n, big_delta: null, balance_after: MAX - 10n, big_balance_after: null },
    ]);
  });

  test('over the balance limit Reject is LIMIT_EXCEEDED, Discard fills 10^max_digits - 1; an amount over 10^max_digits - 1 is INVALID_AMOUNT', async () => {
    const { user_id } = await user(env);
    await put_row(env, user_id, '[big_gold]', { big_amount: (LIMIT_20 - 1n).toString() });
    const r = await request(env, user_id, (ctx) => env.ledger.add_items(ctx, items(['[big_gold]', 5])));
    expect(change_rows(r.delta.item_changes).map((c) => [c[1], c[2]])).toEqual([[1n, 4n]]);
    expect(await balance(env, user_id, '[big_gold]')).toBe(LIMIT_20);
    await put_row(env, user_id, '[big_gem]', { big_amount: (10n ** 30n - 2n).toString() });
    expect(await tx(env, user_id, (ctx) => env.ledger.add_items(ctx, items(['[big_gem]', 2])))).toBe('LIMIT_EXCEEDED');
    expect(await tx(env, user_id, (ctx) => env.ledger.add_items(ctx, items(['[big_gold]', LIMIT_20 + 1n])))).toBe('INVALID_AMOUNT');
    expect(await tx(env, user_id, (ctx) => env.ledger.revoke_items(ctx, items(['[big_gold]', LIMIT_20 + 1n])))).toBe('INVALID_AMOUNT');
  });

  test('DEV SetItemBalance big_balance sets a big item balance; a big_balance that is not a big integer is INVALID_REQUEST', async () => {
    const { user_id } = await user(env);
    const req = new CoreCheatContract.SetItemBalanceRequest();
    req.item_id = id('[big_gold]');
    req.big_balance = '12345678901234567890';
    expect((await send_set_item_balance(env, user_id, req)).code).toBe(0);
    expect(await balance(env, user_id, '[big_gold]')).toBe(12345678901234567890n);
    req.big_balance = '12x';
    expect((await send_set_item_balance(env, user_id, req)).code).toBe(CoreContract.CoreError.CORE_ERROR_INVALID_REQUEST);
    expect(await balance(env, user_id, '[big_gold]')).toBe(12345678901234567890n);
    expect(await set_balance(env, user_id, '[big_gold]', LIMIT_20 + 1n)).toBe('INVALID_AMOUNT');
  });

  test('amount_limit, read_amount and make_item_amount on the module object read and write the big encoding pair', () => {
    expect(env.module.amount_limit(id('[big_gold]'))).toBe(LIMIT_20);
    expect(env.module.amount_limit(id('[gold]'))).toBe(MAX);
    expect(env.module.amount_limit(999_999)).toBe(0n);
    const small = env.module.make_item_amount(id('[gold]'), MAX);
    expect([small.item_id, small.amount, small.big_amount]).toEqual([id('[gold]'), MAX, '']);
    const big = env.module.make_item_amount(id('[big_gold]'), MAX + 1n);
    expect([big.item_id, big.amount, big.big_amount]).toEqual([id('[big_gold]'), 0n, (MAX + 1n).toString()]);
    expect(env.module.read_amount(small)).toBe(MAX);
    expect(env.module.read_amount(big)).toBe(MAX + 1n);
    big.big_amount = '12x';
    expect(env.module.read_amount(big)).toBeNull();
    const content = env.ledger as unknown as Record<string, unknown>;
    expect(['amount_limit', 'read_amount', 'make_item_amount'].filter((name) => name in content)).toEqual([]);
  });
});
