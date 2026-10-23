import * as CoreContract from '../../../generated/contract/core_contract.ts';
import {
  CoreError, DAY_MS, Source, admin_broadcast, admin_send_mail, advance_time, amount, balance, claim_all, claim_mail, game, id, in_user, login,
  mail_entries, mail_ids, peek, plain, read_mail, read_mails, send, send_mail, start_mail_server, stop_all, user_logs, type MailServer,
} from './helpers.ts';

const INT = CoreContract.MailArgKind.MAIL_ARG_KIND_INT;
const TEXT = CoreContract.MailArgKind.MAIL_ARG_KIND_TEXT;

let ms: MailServer;

beforeAll(async () => {
  ms = await start_mail_server();
});

afterAll(() => {
  stop_all();
});

describe('send_mail', () => {
  test('makes a MailUserState delta in a request, and a pending delta of the target user out of request', async () => {
    const user = await login(ms);
    const sent = await send(ms, user, 'Test', (ctx) => ms.mailbox.content.send_mail(ctx, plain()));
    expect(sent.code).toBe(0);
    const out = sent.response as { result: string; mail_id: bigint };
    expect(out.result).toBe('OK');
    expect(mail_entries(sent.delta?.user_state)).toEqual([[out.mail_id, false]]);
    expect(await mail_ids(ms, user.user_id)).toEqual([out.mail_id]);

    const target = await login(ms);
    const outside = await send_mail(ms, target.user_id, plain());
    expect(outside.result).toBe('OK');
    const next = await read_mail(ms, target, outside.mail_id);
    expect(next.code).toBe(0);
    expect(mail_entries(next.delta?.pending_user_state)).toEqual([[outside.mail_id, false]]);
  });

  test('keeps integer and string MailArg with their kind and values, and refuses a value outside the kind', async () => {
    const user = await login(ms);
    const template_id = id('[mail_mailbox_notice]');
    const sent = await send_mail(ms, user.user_id, { template_id, args: [{ name: 'count', int_value: -5n }, { name: 'name', text_value: 'Kim' }] });
    expect(sent.result).toBe('OK');
    const [mail] = await read_mails(ms, user.user_id);
    expect(mail?.args.map((arg) => [arg.name, arg.kind, arg.int_value, arg.text_value])).toEqual([
      ['count', INT, -5n, ''],
      ['name', TEXT, 0n, 'Kim'],
    ]);

    const int_with_text = await send_mail(ms, user.user_id, { template_id, args: [{ name: 'count', int_value: 3n, text_value: 'x' }] });
    const text_with_int = await send_mail(ms, user.user_id, { template_id, args: [{ name: 'name', text_value: 'x', int_value: 2n, kind: TEXT }] });
    expect(int_with_text).toEqual({ result: 'INVALID_INPUT', mail_id: 0n });
    expect(text_with_int).toEqual({ result: 'INVALID_INPUT', mail_id: 0n });
    expect(await read_mails(ms, user.user_id)).toHaveLength(1);
  });

  test('answers ALREADY_SENT with the first mail ID to the second send_mail of a once_key', async () => {
    const user = await login(ms);
    const first = await send_mail(ms, user.user_id, plain({ once_key: 'test:welcome' }));
    const second = await send_mail(ms, user.user_id, plain({ once_key: 'test:welcome' }));
    expect(first.result).toBe('OK');
    expect(second).toEqual({ result: 'ALREADY_SENT', mail_id: first.mail_id });
    expect(await mail_ids(ms, user.user_id)).toEqual([first.mail_id]);
  });

  test('gives a mail sent after a claimed mail a bigger mail ID', async () => {
    const user = await login(ms);
    const first = await send_mail(ms, user.user_id, plain());
    expect((await claim_mail(ms, user, first.mail_id)).code).toBe(0);
    expect(await read_mails(ms, user.user_id)).toHaveLength(0);
    const second = await send_mail(ms, user.user_id, plain());
    expect(second.mail_id > first.mail_id).toBe(true);
  });

  test('refuses mail input over the limits, with a negative expire_ms, or failing item-ledger.check_add_items', async () => {
    const user = await login(ms);
    const template_id = id('[mail_mailbox_notice]');
    const inputs = [
      { template_id, args: [{ name: 'a', int_value: 1n }, { name: 'b', int_value: 2n }, { name: 'c', int_value: 3n }] },
      { template_id, args: [{ name: 'name', text_value: '가나다' }] },
      plain({ attachments: [amount('[item_mailbox_gold]', 1n), amount('[item_mailbox_gem]', 1n), amount('[item_mailbox_shard]', 1n), amount('[gold]', 1n)] }),
      plain({ expire_ms: -1n }),
      plain({ expire_ms: 10n * DAY_MS + 1n }),
      { template_id: id('[item_mailbox_gold]') },
      plain({ attachments: [amount('[item_mailbox_pack]', 1n)] }),
      plain({ attachments: [amount('[item_mailbox_gold]', 0n)] }),
      plain({ attachments: [amount('[item_mailbox_gold]', 1n), amount('[item_mailbox_gold]', 2n)] }),
    ];
    for (const input of inputs) expect((await send_mail(ms, user.user_id, input)).result).toBe('INVALID_INPUT');
    expect(await read_mails(ms, user.user_id)).toHaveLength(0);
    expect(user_logs(ms, 'error', user.user_id).filter((line) => line.message === 'send_mail input is invalid')).toHaveLength(inputs.length);
    expect((await send_mail(ms, user.user_id, plain({ expire_ms: 10n * DAY_MS }))).result).toBe('OK');
  });

  test('refuses no_expiry from content send_mail and from the admin send_mail and broadcast_mail', async () => {
    const user = await login(ms);
    expect((await send_mail(ms, user.user_id, plain({ no_expiry: true }))).result).toBe('INVALID_INPUT');
    const json = { template_id: id('[mail_mailbox_plain]'), no_expiry: true };
    expect(await admin_send_mail(ms, user.user_id, json)).toEqual({ result: 'INVALID_INPUT', mail_id: 0n });
    expect(await admin_broadcast(ms, json, 0n)).toEqual({ result: 'INVALID_INPUT', broadcast_id: 0n });
    expect(await read_mails(ms, user.user_id)).toHaveLength(0);
    expect(await game(ms, (tx) => ms.storage.db(tx).query('SELECT broadcast_id FROM mailbox_broadcast'))).toEqual([]);
    const later = await login(ms);
    expect((await claim_all(ms, later)).code).toBe(0);
    expect(await read_mails(ms, later.user_id)).toHaveLength(0);
  });

  test('throws on a core once_key prefix from content send_mail and grant_or_mail: the request is INTERNAL and nothing changes', async () => {
    const user = await login(ms);
    const by_send = await send(ms, user, 'Test', (ctx) => {
      ms.mailbox.content.send_mail(ctx, plain());
      return ms.mailbox.content.send_mail(ctx, plain({ once_key: 'mail:1' }));
    });
    expect(by_send.code).toBe(CoreError.CORE_ERROR_INTERNAL);
    const by_grant = await send(ms, user, 'Test', (ctx) => {
      ms.mailbox.content.send_mail(ctx, plain());
      return ms.mailbox.content.grant_or_mail(ctx, [amount('[item_mailbox_gold]', 5n)], { once_key: 'shop:1' }, id('[mail_mailbox_plain]'), []);
    });
    expect(by_grant.code).toBe(CoreError.CORE_ERROR_INTERNAL);
    expect(await read_mails(ms, user.user_id)).toHaveLength(0);
    expect(await balance(ms, user.user_id, '[item_mailbox_gold]')).toBe(0n);
    const refused = user_logs(ms, 'error', user.user_id).filter((line) => String(line.message).includes('core once_key prefix'));
    expect(refused).toHaveLength(2);
  });

  test('answers ALREADY_SENT with the claimed mail ID after mailbox.maxExpireMs, and its once_key row is in the user snapshot', async () => {
    const user = await login(ms);
    const first = await send_mail(ms, user.user_id, plain({ once_key: 'test:once_row' }));
    expect((await claim_mail(ms, user, first.mail_id)).code).toBe(0);
    advance_time(ms, 10n * DAY_MS + DAY_MS);
    expect((await claim_all(ms, user)).code).toBe(0);
    const again = await send_mail(ms, user.user_id, plain({ once_key: 'test:once_row' }));
    expect(again).toEqual({ result: 'ALREADY_SENT', mail_id: first.mail_id });
    expect(await read_mails(ms, user.user_id)).toHaveLength(0);

    // A user snapshot clone copies the snapshot rows of a user to another user.
    const rows = await peek(ms, user.user_id, (ctx) => ms.storage.read_user_rows(ctx));
    expect(rows.filter((row) => row.table === 'mailbox_once_key')).toHaveLength(1);
    const clone = await login(ms);
    await in_user(ms, clone.user_id, (ctx) => ms.storage.replace_user_rows(ctx, rows));
    expect(await send_mail(ms, clone.user_id, plain({ once_key: 'test:once_row' }))).toEqual({ result: 'ALREADY_SENT', mail_id: first.mail_id });
    expect(await read_mails(ms, clone.user_id)).toHaveLength(0);
  });

  test('gives content grant_or_mail inside a hook change source that source and ref', async () => {
    const user = await login(ms);
    await ms.storage.run_user_transaction(user.user_id, (ctx) => {
      ms.storage.with_hook_change_source(ctx, Source.ITEM_CHANGE_SOURCE_MAIL, '42', () =>
        ms.mailbox.content.grant_or_mail(ctx, [amount('[item_mailbox_gold]', 1n)], {}, id('[mail_mailbox_plain]'), []),
      );
      return 'pass';
    });
    const sent = await claim_all(ms, user);
    expect(sent.delta?.item_changes.map((change) => [change.source, change.ref])).toEqual([[Source.ITEM_CHANGE_SOURCE_MAIL, '42']]);
  });
});
