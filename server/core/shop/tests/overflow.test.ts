import * as CoreContract from '../../../generated/contract/core_contract.ts';
import { E, amount_in, balance, buy, data, id, mails, purchase_row, set_balance, shop_change, snapshot, start, stop_all, user } from './helpers.ts';

const SHOP = CoreContract.ItemChangeSource.ITEM_CHANGE_SOURCE_SHOP;

afterEach(async () => {
  await stop_all();
});

describe('max_amount overflow', () => {
  it.each([false, true])('mails the whole reward with [shop_grant_mail] when a Reject item overflows (accept_loss %s)', async (accept_loss) => {
    const server = await start();
    const session = await user(server);
    await set_balance(server, session, '[shop_gold]', 1000n);
    // [shop_capped] has max_amount 5 and overflow Reject.
    await set_balance(server, session, '[shop_capped]', 4n);
    const { code, response, envelope } = await buy(session, '[shop_reject_pack]', 1, accept_loss);
    expect(code).toBe(0);
    expect(response?.mailed).toBe(true);
    expect(response?.items).toEqual([]);
    expect(await balance(server, session, '[shop_gold]')).toBe(990n);
    expect(await balance(server, session, '[shop_capped]')).toBe(4n);
    expect(await balance(server, session, '[shop_gem]')).toBe(0n);
    expect(envelope.item_mails.length).toBe(1);
    const mail = envelope.item_mails[0];
    if (mail === undefined) throw new Error('no ItemMail');
    expect(mail.source).toBe(SHOP);
    expect(mail.ref).toBe(String(id('[shop_reject_pack]')));
    expect(amount_in(mail.items, '[shop_capped]')).toBe(3n);
    expect(amount_in(mail.items, '[shop_gem]')).toBe(2n);
    const sent = await mails(server, session);
    expect(sent.length).toBe(1);
    expect(sent[0]?.template_id).toBe(data().ReservedId.shop_grant_mail());
    expect(sent[0]?.id).toBe(mail.mail_id);
    expect((await purchase_row(server, session, '[shop_reject_pack]'))?.count).toBe(1);
  });

  it.each([
    ['a Discard item', '[shop_discard_pack]', '[shop_discard]', 4n],
    ['the Convert replacement item', '[shop_convert_pack]', '[shop_shard]', 9n],
  ] as const)('answers SHOP_OVERFLOW_LOSS without accept_loss when %s overflows, and changes nothing', async (_what, product, item, start_balance) => {
    const server = await start();
    const session = await user(server);
    await set_balance(server, session, '[shop_gold]', 1000n);
    await set_balance(server, session, item, start_balance);
    if (product === '[shop_convert_pack]') await set_balance(server, session, '[shop_convert]', 5n);
    const before = await snapshot(server, session);
    const { code } = await buy(session, product);
    expect(code).toBe(E.CORE_ERROR_SHOP_OVERFLOW_LOSS);
    expect(await snapshot(server, session)).toEqual(before);
  });

  it('gives up to max_amount with accept_loss and reports the discarded amount in overflow (Discard)', async () => {
    const server = await start();
    const session = await user(server);
    await set_balance(server, session, '[shop_gold]', 1000n);
    await set_balance(server, session, '[shop_discard]', 4n);
    const { code, envelope } = await buy(session, '[shop_discard_pack]', 1, true);
    expect(code).toBe(0);
    expect(await balance(server, session, '[shop_discard]')).toBe(5n);
    const change = shop_change(envelope, '[shop_discard]');
    expect(change?.delta).toBe(1n);
    expect(change?.overflow).toBe(2n);
    expect(await balance(server, session, '[shop_gold]')).toBe(990n);
  });

  it('gives up to max_amount with accept_loss and reports the discarded amount in overflow (Convert replacement)', async () => {
    const server = await start();
    const session = await user(server);
    await set_balance(server, session, '[shop_gold]', 1000n);
    // [shop_convert] is full: the 3 bought convert to 6 [shop_shard]; [shop_shard] (max 10, Discard) takes 1 of them.
    await set_balance(server, session, '[shop_convert]', 5n);
    await set_balance(server, session, '[shop_shard]', 9n);
    const { code, envelope } = await buy(session, '[shop_convert_pack]', 1, true);
    expect(code).toBe(0);
    expect(await balance(server, session, '[shop_shard]')).toBe(10n);
    // The replacement's ItemChange has source Overflow and the overflowing item as ref, right after the Shop one.
    const convert = envelope.item_changes.findIndex((c) => c.item_id === id('[shop_convert]') && c.source === CoreContract.ItemChangeSource.ITEM_CHANGE_SOURCE_SHOP);
    const shard = envelope.item_changes[convert + 1];
    expect(convert).not.toBe(-1);
    expect(shard?.item_id).toBe(id('[shop_shard]'));
    expect(shard?.source).toBe(CoreContract.ItemChangeSource.ITEM_CHANGE_SOURCE_OVERFLOW);
    expect(shard?.ref).toBe(String(id('[shop_convert]')));
    expect(shard?.delta).toBe(1n);
    expect(shard?.overflow).toBe(5n);
  });

  it('sells without accept_loss when a Convert item overflows and every replacement fits', async () => {
    const server = await start();
    const session = await user(server);
    await set_balance(server, session, '[shop_gold]', 1000n);
    await set_balance(server, session, '[shop_convert]', 4n);
    // 4 + 3 = 7 over max 5: 2 convert to 4 [shop_shard], which fit in max 10.
    const { code, response } = await buy(session, '[shop_convert_pack]');
    expect(code).toBe(0);
    expect(response?.mailed).toBe(false);
    expect(await balance(server, session, '[shop_convert]')).toBe(5n);
    expect(await balance(server, session, '[shop_shard]')).toBe(4n);
  });
});
