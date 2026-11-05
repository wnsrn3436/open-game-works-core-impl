// send_mail, broadcast_mail and cancel_broadcast.
import { admin, audits, claim_all, get_user, GOLD, id_value, items, login, notice_mail, start, stop, type Server } from './helpers.ts';

describe('mail operations', () => {
  let server: Server;
  afterEach(async () => {
    await stop(server);
  });

  it('makes no broadcast mail for a user who had not received it before cancel_broadcast', async () => {
    server = await start();
    const { session } = await login(server, 'late');
    const now = (await claim_all(session)).envelope.server_time_at;
    const broadcast = await admin(server, 'broadcast_mail', { operation_id: 'b', mail: notice_mail('all'), start_at: String(now) });
    expect(broadcast.status).toBe(200);
    const broadcast_id = String(broadcast.json.broadcast_id);
    expect(broadcast_id).toMatch(/^[1-9][0-9]*$/);
    expect((await admin(server, 'cancel_broadcast', { broadcast_id })).status).toBe(200);
    const next = await claim_all(session);
    expect(next.code).toBe(0);
    expect(next.envelope.pending_user_state?.entries.filter((e) => e.kind === 'MailUserState') ?? []).toEqual([]);
    expect((await admin(server, 'cancel_broadcast', { broadcast_id: '987654' })).status).toBe(404);
  });

  it('answers 400 for send_mail and broadcast_mail with attachments over the limit', async () => {
    // 3: the core test data has a rating_tier season_reward of 3 items, and rating does not start below that.
    server = await start({ settings: { 'mailbox.maxAttachments': 3 } });
    const { user_id } = await login(server, 'limits');
    const attachments = [...items(GOLD, 1n), ...items('[admin_big_gold]', 1n), ...items('[gold]', 1n), ...items(GOLD, 2n)];
    expect((await admin(server, 'send_mail', { operation_id: 's', user_id, mail: notice_mail('x', { attachments }) })).status).toBe(400);
    expect((await admin(server, 'broadcast_mail', { operation_id: 'b', mail: notice_mail('x', { attachments }), start_at: '0' })).status).toBe(400);
    expect((await admin(server, 'send_mail', { operation_id: 's', user_id, mail: notice_mail('x', { no_expiry: true }) })).status).toBe(400);
    expect((await admin(server, 'send_mail', { operation_id: 's', user_id, mail: { template_id: 'x' } })).status).toBe(400);
  });

  it('sends a JSON integer int_value past 2^53 exactly, and keeps it in the audit args as a decimal string', async () => {
    server = await start();
    const { user_id } = await login(server, 'exact');
    const template = String(id_value('[mail_admin_notice]'));
    const text = `{"operation_id":"x","user_id":${user_id},"mail":{"template_id":${template},"args":[{"name":"n","value":{"int_value":9007199254740993}}]}}`;
    const sent = await admin(server, 'send_mail', text);
    expect(sent.status).toBe(200);
    const mails = (await get_user(server, user_id)).json.user_state as Record<string, Record<string, unknown>[]>;
    expect(mails.mail_user_state?.[0]?.args).toEqual([{ name: 'n', kind: 'MAIL_ARG_KIND_INT', int_value: '9007199254740993' }]);
    const args = audits(server, 'send_mail')[0]?.args as Record<string, unknown>;
    expect(args.user_id).toBe(user_id);
    expect(args.mail).toEqual({ template_id: Number(template), args: [{ name: 'n', value: { int_value: '9007199254740993' } }] });
  });

  it('answers the first mail ID to a second send_mail with another operation_id and the same once_key', async () => {
    server = await start();
    const { user_id } = await login(server, 'once');
    const first = await admin(server, 'send_mail', { operation_id: 'one', user_id, mail: notice_mail('a', { once_key: 'welcome' }) });
    const second = await admin(server, 'send_mail', { operation_id: 'two', user_id, mail: notice_mail('a', { once_key: 'welcome' }) });
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(second.json.mail_id).toBe(first.json.mail_id);
  });
});
