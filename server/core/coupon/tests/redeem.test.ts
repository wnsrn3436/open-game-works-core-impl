import * as CoreContract from '../../../generated/contract/core_contract.ts';
import * as testing from '../../testing/dev/index.ts';
import { DAY_MS, E, START_AT, admin, balance, codes_of, create, gem, get_coupon, gold, item_id, mails, redeem, start, user, type TestServer } from './helpers.ts';

const servers: TestServer[] = [];

async function server(...args: Parameters<typeof start>): Promise<TestServer> {
  const started = await start(...args);
  servers.push(started);
  return started;
}

afterEach(async () => {
  for (const s of servers.splice(0)) await testing.stop_test_server(s);
});

function reward_mail_id(): number {
  return testing.load_data().data.ReservedId.coupon_reward_mail();
}

describe('RedeemCoupon', () => {
  it('gives a shared coupon to two users once each; the second use of a user is COUPON_ALREADY_REDEEMED', async () => {
    const s = await server();
    await create(s, { code: 'SHARED1' });
    const a = await user(s);
    const b = await user(s);
    expect((await redeem(a, 'SHARED1')).code).toBe(0);
    expect((await redeem(b, 'SHARED1')).code).toBe(0);
    expect((await redeem(a, 'SHARED1')).code).toBe(E.CORE_ERROR_COUPON_ALREADY_REDEEMED);
    expect(await balance(s, a, '[coupon_gold]')).toBe(100n);
    expect(await balance(s, b, '[coupon_gold]')).toBe(100n);
  });

  it('answers COUPON_USED_UP for a shared coupon at max_uses', async () => {
    const s = await server();
    const id = await create(s, { code: 'LIMITED2', max_uses: 2 });
    expect((await redeem(await user(s), 'LIMITED2')).code).toBe(0);
    expect((await redeem(await user(s), 'LIMITED2')).code).toBe(0);
    const late = await user(s);
    expect((await redeem(late, 'LIMITED2')).code).toBe(E.CORE_ERROR_COUPON_USED_UP);
    expect(await balance(s, late, '[coupon_gold]')).toBe(0n);
    expect(String((await get_coupon(s, id))['used_count'])).toBe('2');
  });

  it('gives a unique code to one user only; another code of the same coupon is COUPON_ALREADY_REDEEMED for that user', async () => {
    const s = await server();
    const id = await create(s, { kind: 'unique', count: 2 });
    const [first, second] = await codes_of(s, id);
    if (first === undefined || second === undefined) throw new Error('two codes expected');
    const a = await user(s);
    const b = await user(s);
    expect((await redeem(a, first)).code).toBe(0);
    expect((await redeem(b, first)).code).toBe(E.CORE_ERROR_COUPON_USED_UP);
    expect((await redeem(a, second)).code).toBe(E.CORE_ERROR_COUPON_ALREADY_REDEEMED);
    expect((await redeem(b, second)).code).toBe(0);
    expect(String((await get_coupon(s, id))['used_count'])).toBe('2');
    const listed = await admin(s, 'list_coupon_codes', { coupon_id: String(id), after_code: '', limit: 10 });
    const rows = listed.json['codes'] as { code: string; redeemed_by: string | null; redeemed_at: string | null }[];
    expect(rows.find((row) => row.code === first)?.redeemed_by).toBe(String(a.user_id));
    expect(rows.find((row) => row.code === first)?.redeemed_at).toBe(String(START_AT));
  });

  it('finds the coupon of the normalized code from input with lowercase letters, - and spaces', async () => {
    const s = await server();
    await create(s, { code: 'SPRING2026' });
    const session = await user(s);
    const ideographic_space = String.fromCodePoint(0x3000);
    expect((await redeem(session, ` spr-ing 20${ideographic_space}26 `)).code).toBe(0);
    expect(await balance(s, session, '[coupon_gold]')).toBe(100n);
  });

  it('answers COUPON_NOT_ACTIVE before start_at and from end_at, and COUPON_INVALID after disable_coupon', async () => {
    const s = await server();
    await create(s, { code: 'LATER1', start_at: START_AT + 1000n, end_at: START_AT + DAY_MS });
    const ending = await create(s, { code: 'ENDING1', start_at: START_AT - DAY_MS, end_at: START_AT + 1000n });
    const session = await user(s);
    expect((await redeem(session, 'LATER1')).code).toBe(E.CORE_ERROR_COUPON_NOT_ACTIVE);
    testing.set_time(s, START_AT + 1000n);
    expect((await redeem(session, 'ENDING1')).code).toBe(E.CORE_ERROR_COUPON_NOT_ACTIVE);
    expect(String((await get_coupon(s, ending))['used_count'])).toBe('0');
    const disabled = await create(s, { code: 'OFF1', start_at: START_AT, end_at: START_AT + DAY_MS });
    expect((await admin(s, 'disable_coupon', { coupon_id: String(disabled) })).status).toBe(200);
    expect((await redeem(session, 'OFF1')).code).toBe(E.CORE_ERROR_COUPON_INVALID);
    expect((await get_coupon(s, disabled))['disabled']).toBe(true);
    expect((await redeem(session, 'LATER1')).code).toBe(0);
  });

  it('answers COUPON_INVALID for an unknown code and a code outside the format', async () => {
    const s = await server();
    const session = await user(s);
    expect((await redeem(session, 'NOSUCHCODE')).code).toBe(E.CORE_ERROR_COUPON_INVALID);
    expect((await redeem(session, '')).code).toBe(E.CORE_ERROR_COUPON_INVALID);
    expect((await redeem(session, 'ÄÖÜ1')).code).toBe(E.CORE_ERROR_COUPON_INVALID);
  });

  it('grants with source Coupon and writes one audit line with request core/RedeemCoupon', async () => {
    const s = await server();
    const id = await create(s, { code: 'AUDIT1' });
    const session = await user(s);
    const { envelope, response } = await redeem(session, 'au-dit1');
    expect(response?.items.map((item) => [item.item_id, item.amount])).toEqual([[item_id('[coupon_gold]'), 100n]]);
    expect(envelope.item_changes).toHaveLength(1);
    expect(envelope.item_changes[0]?.source).toBe(CoreContract.ItemChangeSource.ITEM_CHANGE_SOURCE_COUPON);
    expect(envelope.item_changes[0]?.ref).toBe(String(id));
    await testing.wait_background(s);
    const lines = testing.read_logs(s, 'audit').filter((line) => line['request'] === 'core/RedeemCoupon');
    expect(lines).toHaveLength(1);
    expect(String(lines[0]?.['user_id'])).toBe(String(session.user_id));
    expect(lines[0]?.['args']).toEqual({ coupon_id: String(id), code: 'AUDIT1' });
  });

  it('calls on_coupon_redeemed once per successful redeem with the coupon ID, and its change comes in the same response', async () => {
    const calls: bigint[] = [];
    const s = await server({
      on_coupon_redeemed: (ctx, coupon_id, ledger) => {
        calls.push(coupon_id);
        const bonus = new CoreContract.ItemAmount();
        bonus.item_id = item_id('[coupon_gem]');
        bonus.amount = 1n;
        ledger.add_items(ctx, [bonus], { source: 0, ref: '', once_key: '' });
      },
    });
    const id = await create(s, { code: 'HOOK1' });
    const session = await user(s);
    const { envelope } = await redeem(session, 'HOOK1');
    expect(calls).toEqual([id]);
    const gem_change = envelope.item_changes.find((change) => change.item_id === item_id('[coupon_gem]'));
    expect(gem_change?.source).toBe(CoreContract.ItemChangeSource.ITEM_CHANGE_SOURCE_COUPON);
    expect(gem_change?.ref).toBe(String(id));
    expect(envelope.user_state?.entries.some((entry) => entry.kind === 'ItemBalanceUserState' && entry.id === BigInt(item_id('[coupon_gem]')))).toBe(true);
    expect((await redeem(session, 'HOOK1')).code).toBe(E.CORE_ERROR_COUPON_ALREADY_REDEEMED);
    expect((await redeem(session, 'NOSUCHCODE')).code).toBe(E.CORE_ERROR_COUPON_INVALID);
    expect(calls).toEqual([id]);
  });

  it('answers INTERNAL when on_coupon_redeemed throws and keeps the use record, used_count and items', async () => {
    let fail = true;
    const s = await server({
      on_coupon_redeemed: () => {
        if (fail) throw new Error('hook failure');
      },
    });
    const id = await create(s, { code: 'THROW1', max_uses: 1 });
    const session = await user(s);
    expect((await redeem(session, 'THROW1')).code).toBe(E.CORE_ERROR_INTERNAL);
    expect(await balance(s, session, '[coupon_gold]')).toBe(0n);
    expect(String((await get_coupon(s, id))['used_count'])).toBe('0');
    await testing.wait_background(s);
    expect(testing.read_logs(s, 'audit').filter((line) => line['request'] === 'core/RedeemCoupon')).toEqual([]);
    fail = false;
    expect((await redeem(session, 'THROW1')).code).toBe(0);
    expect(await balance(s, session, '[coupon_gold]')).toBe(100n);
  });

  it('mails the reward as [coupon_reward_mail] over max_amount, and the use record and used_count change', async () => {
    const s = await server();
    const id = await create(s, { code: 'FULL1', items: [gem(1n)] });
    const session = await user(s);
    await testing.call_dev(s, 'item-ledger', 'set_balance', [item_id('[coupon_gem]'), 5n], session.user_id);
    const { envelope, response, code } = await redeem(session, 'FULL1');
    expect(code).toBe(0);
    expect(response?.items).toEqual([]);
    expect(envelope.item_mails).toHaveLength(1);
    expect(envelope.item_mails[0]?.source).toBe(CoreContract.ItemChangeSource.ITEM_CHANGE_SOURCE_COUPON);
    const mailed = await mails(s, session);
    expect(mailed.map((mail) => mail.template_id)).toEqual([reward_mail_id()]);
    expect(mailed[0]?.attachments.map((item) => [item.item_id, item.amount])).toEqual([[item_id('[coupon_gem]'), 1n]]);
    expect(await balance(s, session, '[coupon_gem]')).toBe(5n);
    expect(String((await get_coupon(s, id))['used_count'])).toBe('1');
    expect((await redeem(session, 'FULL1')).code).toBe(E.CORE_ERROR_COUPON_ALREADY_REDEEMED);
  });

  it('mails the reward when the item-ledger validation hook rejects it, and the use record changes', async () => {
    const s = await server({ validate_item_change: () => 1000 });
    const id = await create(s, { code: 'REJECT1' });
    const session = await user(s);
    const { response, code } = await redeem(session, 'REJECT1');
    expect(code).toBe(0);
    expect(response?.items).toEqual([]);
    expect((await mails(s, session)).map((mail) => mail.template_id)).toEqual([reward_mail_id()]);
    expect(await balance(s, session, '[coupon_gold]')).toBe(0n);
    expect(String((await get_coupon(s, id))['used_count'])).toBe('1');
  });

  it('sends one [coupon_reward_mail] mail with items and extra_id for an extra_id coupon; claiming it calls grant_mail_extra', async () => {
    const extras: number[] = [];
    const s = await server({
      grant_mail_extra: (_ctx, extra_id) => {
        extras.push(extra_id);
        return 'pass';
      },
    });
    const id = await create(s, { code: 'EXTRA1', items: [gold(10n)], extra_id: 7 });
    const session = await user(s);
    const { response, code } = await redeem(session, 'EXTRA1');
    expect(code).toBe(0);
    expect(response?.items).toEqual([]);
    const mailed = await mails(s, session);
    expect(mailed).toHaveLength(1);
    expect(mailed[0]?.template_id).toBe(reward_mail_id());
    expect(mailed[0]?.extra_id).toBe(7);
    expect(mailed[0]?.attachments.map((item) => [item.item_id, item.amount])).toEqual([[item_id('[coupon_gold]'), 10n]]);
    expect(String((await get_coupon(s, id))['used_count'])).toBe('1');
    expect((await redeem(session, 'EXTRA1')).code).toBe(E.CORE_ERROR_COUPON_ALREADY_REDEEMED);
    const claim = new CoreContract.ClaimMailRequest();
    claim.mail_id = mailed[0]?.id ?? 0n;
    const claimed = await testing.send(session, 'core/ClaimMail', claim);
    expect(claimed.envelope.error).toBeNull();
    expect(extras).toEqual([7]);
    expect(await balance(s, session, '[coupon_gold]')).toBe(10n);
  });

  it('gives a max_uses 1 coupon to one of two concurrent requests', async () => {
    const s = await server();
    const id = await create(s, { code: 'RACE1', max_uses: 1 });
    const a = await user(s);
    const b = await user(s);
    const results = await Promise.all([redeem(a, 'RACE1'), redeem(b, 'RACE1')]);
    expect(results.map((result) => result.code).sort((x, y) => x - y)).toEqual([0, E.CORE_ERROR_COUPON_USED_UP]);
    expect((await balance(s, a, '[coupon_gold]')) + (await balance(s, b, '[coupon_gold]'))).toBe(100n);
    expect(String((await get_coupon(s, id))['used_count'])).toBe('1');
  });
});
