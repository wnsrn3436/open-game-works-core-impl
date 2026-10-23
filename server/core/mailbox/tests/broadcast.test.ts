import type * as CoreContract from '../../../generated/contract/core_contract.ts';
import {
  DB_KIND, DAY_MS, START_AT, admin_broadcast, advance_time, claim_all, game, id, login, login_request, logs, mail_entries, plain, read_mails, start_mail_server,
  start_peer, stop_all, touch, user_logs, type MailServer, type Session,
} from './helpers.ts';

function admin_mail(fields: Record<string, unknown> = {}): Record<string, unknown> {
  return { template_id: id('[mail_mailbox_plain]'), attachments: [{ item_id: id('[item_mailbox_gold]'), amount: '1' }], ...fields };
}

async function broadcast(ms: MailServer, start_at: bigint, fields: Record<string, unknown> = {}): Promise<bigint> {
  const out = await admin_broadcast(ms, admin_mail(fields), start_at);
  if (out === 'INVALID_INPUT' || out.result !== 'OK') throw new Error(`broadcast_mail: ${JSON.stringify(out, (_, v: unknown) => (typeof v === 'bigint' ? String(v) : v))}`);
  return out.broadcast_id;
}

/** The user's mails made from broadcasts (the gold 1 attachment of `admin_mail`). */
async function broadcast_mails(ms: MailServer, session: Session): Promise<CoreContract.MailUserState[]> {
  return (await read_mails(ms, session.user_id)).filter((mail) => mail.attachments.some((item) => item.item_id === id('[item_mailbox_gold]')));
}

function broadcast_rows(ms: MailServer): Promise<bigint[]> {
  return game(ms, (tx) => ms.storage.db(tx).query('SELECT broadcast_id FROM mailbox_broadcast ORDER BY broadcast_id').map((row) => row.broadcast_id as bigint));
}

let ms: MailServer;

beforeEach(async () => {
  ms = await start_mail_server();
});

afterEach(() => {
  stop_all();
});

describe('broadcast', () => {
  test('becomes a mail once in the first request in its window, in that response delta, also for a user made after its start and in Login', async () => {
    const early = await login(ms);
    await touch(ms, early);
    await broadcast(ms, START_AT + 1000n);
    expect(mail_entries((await touch(ms, early)).delta?.pending_user_state)).toEqual([]);
    expect(await broadcast_mails(ms, early)).toHaveLength(0);

    advance_time(ms, 1000n);
    const first = await touch(ms, early);
    const made = await broadcast_mails(ms, early);
    expect(made).toHaveLength(1);
    expect(made[0]?.sent_at).toBe(START_AT + 1000n);
    expect(mail_entries(first.delta?.pending_user_state)).toEqual([[made[0]?.id ?? 0n, false]]);
    const second = await touch(ms, early);
    expect(mail_entries(second.delta?.pending_user_state)).toEqual([]);
    expect(await broadcast_mails(ms, early)).toHaveLength(1);

    const late = await login_request(ms);
    expect(late.sent.code).toBe(0);
    const late_mails = await broadcast_mails(ms, late.session);
    expect(late_mails).toHaveLength(1);
    expect(mail_entries(late.sent.delta?.pending_user_state)).toEqual([[late_mails[0]?.id ?? 0n, false]]);
    expect(mail_entries((await touch(ms, late.session)).delta?.pending_user_state)).toEqual([]);
  });

  test('makes only the broadcasts the user has not got when several are active, in one request start', async () => {
    const user = await login(ms);
    const first = await broadcast(ms, START_AT);
    await touch(ms, user);
    expect(await broadcast_mails(ms, user)).toHaveLength(1);
    const second = await broadcast(ms, START_AT);
    const third = await broadcast(ms, START_AT);
    const sent = await touch(ms, user);
    const mails = await broadcast_mails(ms, user);
    expect(mails).toHaveLength(3);
    expect(mail_entries(sent.delta?.pending_user_state)).toEqual(mails.slice(1).map((mail) => [mail.id, false]));
    const keys = await game(ms, (tx) =>
      ms.storage
        .db(tx)
        .query('SELECT once_key FROM mailbox_once_key WHERE user_id = $1 ORDER BY mail_id', [user.user_id])
        .map((row) => row.once_key),
    );
    expect(keys).toEqual([first, second, third].map((broadcast_id) => `broadcast:${broadcast_id.toString()}`));
    expect(mail_entries((await touch(ms, user)).delta?.pending_user_state)).toEqual([]);
  });

  test('lets the request succeed when on_request_start fails', async () => {
    const user = await login(ms);
    const broadcast_id = await broadcast(ms, START_AT);
    await game(ms, (tx) => ms.storage.db(tx).query('UPDATE mailbox_broadcast SET mail = $1 WHERE broadcast_id = $2', ['{', broadcast_id]));
    const sent = await claim_all(ms, user);
    expect(sent.code).toBe(0);
    expect(await broadcast_mails(ms, user)).toHaveLength(0);
    expect(user_logs(ms, 'error', user.user_id).some((line) => line.message === 'mailbox request start failed')).toBe(true);
  });

  test('skips with an error log a broadcast whose mail is not a valid mail input', async () => {
    const user = await login(ms);
    const broken = await broadcast(ms, START_AT);
    await broadcast(ms, START_AT);
    const bad = JSON.stringify({ template_id: id('[item_mailbox_gold]') });
    await game(ms, (tx) => ms.storage.db(tx).query('UPDATE mailbox_broadcast SET mail = $1 WHERE broadcast_id = $2', [bad, broken]));
    expect((await touch(ms, user)).code).toBe(0);
    expect(await broadcast_mails(ms, user)).toHaveLength(1);
    expect(user_logs(ms, 'error', user.user_id).some((line) => String(line.message).includes('the broadcast is skipped') && line.broadcast_id === broken.toString())).toBe(true);
  });

  test('gives no mail to a user whose first request comes after cancel_broadcast, and keeps the mail made before', async () => {
    const before = await login(ms);
    const broadcast_id = await broadcast(ms, START_AT);
    await touch(ms, before);
    expect(await broadcast_mails(ms, before)).toHaveLength(1);
    expect(await game(ms, (tx) => ms.mailbox.cancel_broadcast(tx, broadcast_id))).toBe(true);
    const after = await login(ms);
    expect((await claim_all(ms, after)).code).toBe(0);
    expect(await broadcast_mails(ms, after)).toHaveLength(0);
    await touch(ms, before);
    expect(await broadcast_mails(ms, before)).toHaveLength(1);
  });

  test('gives a broadcast after an expired and swept broadcast a bigger ID, and its mail to a user who got the swept one', async () => {
    const user = await login(ms);
    const old_id = await broadcast(ms, START_AT, { expire_ms: '1000' });
    await touch(ms, user);
    expect(await broadcast_mails(ms, user)).toHaveLength(1);
    advance_time(ms, DAY_MS);
    expect(await ms.storage.sweep_expired()).not.toBe('FAILED');
    expect(await broadcast_rows(ms)).toEqual([]);
    const new_id = await broadcast(ms, START_AT + DAY_MS);
    expect(new_id > old_id).toBe(true);
    await touch(ms, user);
    // The mail of the old broadcast expired after its 1000 ms; the new broadcast made a new mail.
    expect((await broadcast_mails(ms, user)).map((mail) => mail.sent_at)).toEqual([START_AT + DAY_MS]);
  });

  test('gives two broadcast_mail at the same time different IDs; cancel_broadcast of an unknown ID is false', async () => {
    // Two server instances on PostgreSQL. On SQLite the transactions of one thread's instances cannot overlap
    // (`BEGIN IMMEDIATE` waits synchronously), so the two run on one instance there.
    const peer = DB_KIND === 'postgresql' ? await start_peer(ms) : ms;
    const [a, b] = await Promise.all([admin_broadcast(ms, admin_mail(), START_AT), admin_broadcast(peer, admin_mail(), START_AT)]);
    if (a === 'INVALID_INPUT' || b === 'INVALID_INPUT') throw new Error('broadcast_mail input');
    expect([a.result, b.result]).toEqual(['OK', 'OK']);
    expect(a.broadcast_id).not.toBe(b.broadcast_id);
    expect(await broadcast_rows(ms)).toHaveLength(2);
    expect(await game(ms, (tx) => ms.mailbox.cancel_broadcast(tx, 999n))).toBe(false);
  });

  test('with expire_ms 0 ends at its start + mailbox.defaultExpireMs', async () => {
    await broadcast(ms, START_AT);
    const inside = await login(ms);
    await touch(ms, inside);
    expect(await broadcast_mails(ms, inside)).toHaveLength(1);
    advance_time(ms, DAY_MS - 1n);
    const last = await login(ms);
    await touch(ms, last);
    expect(await broadcast_mails(ms, last)).toHaveLength(1);
    advance_time(ms, 1n);
    const outside = await login(ms);
    expect((await claim_all(ms, outside)).code).toBe(0);
    expect(await broadcast_mails(ms, outside)).toHaveLength(0);
  });

  test('refuses a broadcast_mail whose once_key is not empty and makes no broadcast row', async () => {
    expect(await admin_broadcast(ms, admin_mail({ once_key: 'x' }), START_AT)).toEqual({ result: 'INVALID_INPUT', broadcast_id: 0n });
    expect(await game(ms, (tx) => ms.mailbox.broadcast_mail(tx, plain({ once_key: 'y' }), START_AT))).toEqual({ result: 'INVALID_INPUT', broadcast_id: 0n });
    expect(await broadcast_rows(ms)).toEqual([]);
    expect(logs(ms, 'error').filter((line) => line.message === 'broadcast_mail input is invalid')).toHaveLength(2);
    const user = await login(ms);
    expect((await claim_all(ms, user)).code).toBe(0);
    expect(await read_mails(ms, user.user_id)).toHaveLength(0);
  });

  test('mail_input_from_json answers INVALID_INPUT to JSON that is not the mail input form', () => {
    expect(ms.mailbox.mail_input_from_json({ template_id: 1, unknown: 1 })).toBe('INVALID_INPUT');
    expect(ms.mailbox.mail_input_from_json({ template_id: 1, expire_ms: '9' })).toMatchObject({ template_id: 1, expire_ms: 9n });
  });
});
