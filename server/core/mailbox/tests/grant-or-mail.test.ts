import * as CoreContract from '../../../generated/contract/core_contract.ts';
import type { ChangeSourceInput } from '../../item-ledger/index.ts';
import type { GrantOrMailOutcome } from '../index.ts';
import {
  DAY_MS, GAME_ERROR, Source, advance_time, amount, balance, claim_mail, give, grant_or_mail, id, in_user, login, mail_entries, mail_ids, pairs,
  read_mail, read_mails, send, send_mail, start_mail_server, stop_all, take, touch, user_logs, type MailServer, type Sent,
} from './helpers.ts';

const PLAIN = '[mail_mailbox_plain]';

function key(once_key = ''): ChangeSourceInput {
  return { once_key };
}

function item_mails(list: readonly CoreContract.ItemMail[] | undefined): [bigint, CoreContract.ItemChangeSource, string, [number, bigint][]][] {
  return (list ?? []).map((mail) => [mail.mail_id, mail.source, mail.ref, pairs(mail.items)]);
}

function mailed(out: unknown): readonly bigint[] {
  const outcome = out as GrantOrMailOutcome;
  return outcome.result === 'Mailed' ? outcome.mail_ids : [];
}

/** Content code's `grant_or_mail` in a request of the user. */
function grant_in_request(ms: MailServer, user: { user_id: bigint }, items: readonly CoreContract.ItemAmount[], once_key = ''): Promise<Sent> {
  return send(ms, user, 'Test', (ctx) => ms.mailbox.content.grant_or_mail(ctx, items, key(once_key), id(PLAIN), []));
}

afterAll(() => {
  stop_all();
});

describe('grant_or_mail', () => {
  let ms: MailServer;

  beforeAll(async () => {
    ms = await start_mail_server();
  });

  test('is Granted with no mail and no item_mails when the items can be granted', async () => {
    const user = await login(ms);
    const sent = await grant_in_request(ms, user, [amount('[item_mailbox_gold]', 5n)]);
    expect(sent.code).toBe(0);
    expect(sent.response).toEqual({ result: 'Granted' });
    expect(sent.delta?.item_mails).toEqual([]);
    expect(await read_mails(ms, user.user_id)).toHaveLength(0);
    expect(await balance(ms, user.user_id, '[item_mailbox_gold]')).toBe(5n);
  });

  test('is Granted for a list whose Discard item overflows, with the granted and overflowed amounts in item_changes', async () => {
    const user = await login(ms);
    await give(ms, user.user_id, [amount('[item_mailbox_shard]', 98n)]);
    await touch(ms, user);
    const sent = await grant_in_request(ms, user, [amount('[item_mailbox_shard]', 5n)]);
    expect(sent.response).toEqual({ result: 'Granted' });
    expect((sent.delta?.item_changes ?? []).map((change) => [change.item_id, change.delta, change.overflow, change.source, change.ref])).toEqual([
      [id('[item_mailbox_shard]'), 2n, 3n, Source.ITEM_CHANGE_SOURCE_REQUEST, 'Test'],
    ]);
    expect(sent.delta?.item_mails).toEqual([]);
    expect(await read_mails(ms, user.user_id)).toHaveLength(0);
  });

  test('mails a list of mailbox.maxAttachments items or fewer as one mail on LIMIT_EXCEEDED, then answers its once_key with the same mail', async () => {
    const user = await login(ms);
    await give(ms, user.user_id, [amount('[item_mailbox_gem]', 99n)]);
    const items = [amount('[item_mailbox_gem]', 5n), amount('[item_mailbox_gold]', 1n)];
    const first = await grant_in_request(ms, user, items, 'test:limit');
    expect(first.code).toBe(0);
    const ids = mailed(first.response);
    expect(ids).toHaveLength(1);
    const mail_id = ids[0] ?? 0n;
    expect(item_mails(first.delta?.item_mails)).toEqual([[mail_id, Source.ITEM_CHANGE_SOURCE_REQUEST, 'Test', pairs(items)]]);
    expect(await balance(ms, user.user_id, '[item_mailbox_gem]')).toBe(99n);
    expect(await balance(ms, user.user_id, '[item_mailbox_gold]')).toBe(0n);
    const [mail] = await read_mails(ms, user.user_id);
    expect(mail?.id).toBe(mail_id);
    expect(pairs(mail?.attachments ?? [])).toEqual(pairs(items));

    const second = await grant_in_request(ms, user, items, 'test:limit');
    expect(second.response).toEqual({ result: 'Mailed', mail_ids: [mail_id] });
    expect(second.delta?.item_mails).toEqual([]);
    expect(second.delta?.item_changes).toEqual([]);
    expect(await mail_ids(ms, user.user_id)).toEqual([mail_id]);
  });

  test('mails the list on REJECTED from validate_item_change', async () => {
    const user = await login(ms);
    ms.reject_items = GAME_ERROR;
    let sent: Sent;
    try {
      sent = await grant_in_request(ms, user, [amount('[item_mailbox_gold]', 2n)]);
    } finally {
      ms.reject_items = null;
    }
    expect(mailed(sent.response)).toHaveLength(1);
    expect(sent.delta?.item_mails).toHaveLength(1);
    expect(await balance(ms, user.user_id, '[item_mailbox_gold]')).toBe(0n);
    expect(await read_mails(ms, user.user_id)).toHaveLength(1);
  });

  test('brings the ItemMail of an out-of-request grant_or_mail in the next success response', async () => {
    const user = await login(ms);
    await give(ms, user.user_id, [amount('[item_mailbox_gem]', 99n)]);
    await touch(ms, user);
    const out = await grant_or_mail(ms, user.user_id, [amount('[item_mailbox_gem]', 3n)], { ref: 'gift' }, PLAIN);
    const mail_id = mailed(out)[0] ?? 0n;
    expect(out.result).toBe('Mailed');
    const next = await read_mail(ms, user, mail_id);
    expect(next.code).toBe(0);
    expect(item_mails(next.delta?.item_mails)).toEqual([[mail_id, Source.ITEM_CHANGE_SOURCE_REQUEST, 'gift', [[id('[item_mailbox_gem]'), 3n]]]]);
    expect(mail_entries(next.delta?.pending_user_state)).toEqual([[mail_id, false]]);
  });

  test('returns UNKNOWN_ITEM, INVALID_AMOUNT and UNSUPPORTED_ITEM without a mail', async () => {
    const user = await login(ms);
    const unknown = new CoreContract.ItemAmount();
    unknown.item_id = 999_999;
    unknown.amount = 1n;
    expect(await grant_or_mail(ms, user.user_id, [unknown], key(), PLAIN)).toEqual({ result: 'UNKNOWN_ITEM' });
    expect(await grant_or_mail(ms, user.user_id, [amount('[item_mailbox_gold]', 0n)], key(), PLAIN)).toEqual({ result: 'INVALID_AMOUNT' });
    expect(await grant_or_mail(ms, user.user_id, [amount('[item_mailbox_pack]', 1n)], key(), PLAIN)).toEqual({ result: 'UNSUPPORTED_ITEM' });
    expect(await read_mails(ms, user.user_id)).toHaveLength(0);
  });

  test('returns INVALID_INPUT of send_mail as it is and sends no mail', async () => {
    const user = await login(ms);
    await give(ms, user.user_id, [amount('[item_mailbox_gem]', 99n)]);
    const out = await in_user(ms, user.user_id, (ctx) =>
      ms.mailbox.content.grant_or_mail(ctx, [amount('[item_mailbox_gem]', 5n)], key(), id('[item_mailbox_gold]'), []),
    );
    expect(out).toEqual({ result: 'INVALID_INPUT' });
    expect(await read_mails(ms, user.user_id)).toHaveLength(0);
  });

  test('is AlreadyApplied for a change source whose once_key add_items already applied, and changes nothing', async () => {
    const user = await login(ms);
    const items = [amount('[item_mailbox_gold]', 1n)];
    expect(await grant_or_mail(ms, user.user_id, items, key('test:applied'), PLAIN)).toEqual({ result: 'Granted' });
    await touch(ms, user);
    const sent = await grant_in_request(ms, user, items, 'test:applied');
    expect(sent.response).toEqual({ result: 'AlreadyApplied' });
    expect(sent.delta?.item_mails).toEqual([]);
    expect(sent.delta?.item_changes).toEqual([]);
    expect(await balance(ms, user.user_id, '[item_mailbox_gold]')).toBe(1n);
    expect(await read_mails(ms, user.user_id)).toHaveLength(0);
  });
});

describe('grant_or_mail expiry', () => {
  let ms: MailServer;

  beforeAll(async () => {
    ms = await start_mail_server();
  });

  test('sends a mail that never expires for source Iap, and a mail of mailbox.defaultExpireMs for the other sources', async () => {
    const user = await login(ms);
    await give(ms, user.user_id, [amount('[item_mailbox_gold]', 1000n)]);
    const items = [amount('[item_mailbox_gold]', 5n)];
    const iap = await in_user(ms, user.user_id, (ctx) =>
      ms.mailbox.grant_or_mail(ctx, items, { source: Source.ITEM_CHANGE_SOURCE_IAP, ref: 'iap-test', once_key: 'iap:test:1' }, id(PLAIN), []),
    );
    const other = await in_user(ms, user.user_id, (ctx) =>
      ms.mailbox.grant_or_mail(ctx, items, { source: Source.ITEM_CHANGE_SOURCE_SHOP, ref: 'shop-test' }, id(PLAIN), []),
    );
    const iap_id = mailed(iap)[0] ?? 0n;
    const other_id = mailed(other)[0] ?? 0n;
    const mails = await read_mails(ms, user.user_id);
    const iap_mail = mails.find((mail) => mail.id === iap_id);
    const other_mail = mails.find((mail) => mail.id === other_id);
    expect(iap_mail?.expires_at).toBe(0n);
    expect(other_mail?.expires_at).toBe((other_mail?.sent_at ?? 0n) + DAY_MS);

    advance_time(ms, DAY_MS);
    await touch(ms, user);
    expect(await mail_ids(ms, user.user_id)).toEqual([iap_id]);
    advance_time(ms, 10n * DAY_MS);
    await take(ms, user.user_id, [amount('[item_mailbox_gold]', 10n)]);
    const claimed = await claim_mail(ms, user, iap_id);
    expect(claimed.code).toBe(0);
    expect(await balance(ms, user.user_id, '[item_mailbox_gold]')).toBe(995n);
    expect(await read_mails(ms, user.user_id)).toHaveLength(0);
  });
});

describe('grant_or_mail pieces', () => {
  let ms: MailServer;

  beforeAll(async () => {
    ms = await start_mail_server({ settings: { 'mailbox.maxAttachments': 1 } });
  });

  test('mails a list longer than mailbox.maxAttachments as one mail and one ItemMail per piece, the same mails on the second call', async () => {
    const user = await login(ms);
    await give(ms, user.user_id, [amount('[item_mailbox_gem]', 99n)]);
    await touch(ms, user);
    const items = [amount('[item_mailbox_gem]', 5n), amount('[item_mailbox_gold]', 1n), amount('[item_mailbox_shard]', 2n)];
    const first = await grant_in_request(ms, user, items, 'test:pieces');
    expect(first.code).toBe(0);
    const ids = mailed(first.response);
    expect(ids).toHaveLength(3);
    expect((first.delta?.item_mails ?? []).map((mail) => [mail.mail_id, pairs(mail.items)])).toEqual(ids.map((mail_id, k) => [mail_id, pairs([items[k] as CoreContract.ItemAmount])]));
    const mails = await read_mails(ms, user.user_id);
    expect(ids.map((mail_id) => pairs(mails.find((mail) => mail.id === mail_id)?.attachments ?? []))).toEqual(items.map((item) => pairs([item])));

    const second = await grant_in_request(ms, user, items, 'test:pieces');
    expect(second.response).toEqual({ result: 'Mailed', mail_ids: ids });
    expect(second.delta?.item_mails).toEqual([]);
    expect(await read_mails(ms, user.user_id)).toHaveLength(3);
  });

  test('is INVALID_INPUT with one error log and sends no mail when the once_key of a later piece already has a mail', async () => {
    const user = await login(ms);
    await give(ms, user.user_id, [amount('[item_mailbox_gem]', 99n)]);
    const sent = await send_mail(ms, user.user_id, { template_id: id(PLAIN), once_key: 'test:clash:3' });
    expect(sent.result).toBe('OK');
    const before = await mail_ids(ms, user.user_id);
    const items = [amount('[item_mailbox_gem]', 5n), amount('[item_mailbox_gold]', 1n), amount('[item_mailbox_shard]', 2n)];
    const logged = user_logs(ms, 'error', user.user_id).length;
    const out = await grant_or_mail(ms, user.user_id, items, key('test:clash'), PLAIN);
    expect(out).toEqual({ result: 'INVALID_INPUT' });
    expect(await mail_ids(ms, user.user_id)).toEqual(before);
    expect(await balance(ms, user.user_id, '[item_mailbox_gold]')).toBe(0n);
    const errors = user_logs(ms, 'error', user.user_id).slice(logged);
    expect(errors.map((line) => [line.level, line.message, line.once_key])).toEqual([['error', 'grant_or_mail once_key of a later piece already has a mail', 'test:clash']]);

    const fresh = await grant_or_mail(ms, user.user_id, items, key('test:clash:3:x'), PLAIN);
    expect(mailed(fresh)).toHaveLength(3);
  });

  test('cancel_mail_by_once_key removes the mails left of two pieces, returns their attachments in mail ID order, and makes delete deltas', async () => {
    const user = await login(ms);
    await give(ms, user.user_id, [amount('[item_mailbox_gem]', 99n)]);
    const items = [amount('[item_mailbox_gem]', 5n), amount('[item_mailbox_gold]', 1n), amount('[item_mailbox_shard]', 2n)];
    const out = await grant_or_mail(ms, user.user_id, items, key('test:cancel'), PLAIN);
    const ids = mailed(out);
    expect(ids).toHaveLength(3);
    // The gold piece is claimed: it is not in the list.
    expect((await claim_mail(ms, user, ids[1] ?? 0n)).code).toBe(0);

    const cancelled = await send(ms, user, 'Test', (ctx) => ms.mailbox.cancel_mail_by_once_key(ctx, 'test:cancel'));
    expect(cancelled.code).toBe(0);
    expect(pairs(cancelled.response as CoreContract.ItemAmount[])).toEqual(pairs([items[0], items[2]] as CoreContract.ItemAmount[]));
    expect(mail_entries(cancelled.delta?.user_state)).toEqual([
      [ids[0], true],
      [ids[2], true],
    ]);
    expect(await read_mails(ms, user.user_id)).toHaveLength(0);
    // One info line per removed mail; none for the claimed piece.
    const cancel_logs = user_logs(ms, 'core', user.user_id).filter((line) => line.message === 'mail cancelled');
    expect(cancel_logs.map((line) => [line.level, line.module, line.mail_id, line.once_key])).toEqual([
      ['info', 'mailbox', ids[0]?.toString(), 'test:cancel'],
      ['info', 'mailbox', ids[2]?.toString(), 'test:cancel'],
    ]);

    const again = await grant_or_mail(ms, user.user_id, items, key('test:cancel'), PLAIN);
    expect(again).toEqual({ result: 'Mailed', mail_ids: ids });
    expect(await read_mails(ms, user.user_id)).toHaveLength(0);
  });
});
