// grant_items, revoke_items and the `operation_id` rule.
import * as CoreContract from '../../../generated/contract/core_contract.ts';
import {
  admin,
  balance,
  BIG_GOLD,
  claim_all,
  claim_mail,
  get_user,
  GOLD,
  grant,
  id_value,
  items,
  login,
  logs,
  MISSING_USER,
  notice_mail,
  revoke,
  start,
  stop,
  withdraw,
  type Server,
} from './helpers.ts';

describe('grant_items and revoke_items', () => {
  let server: Server;
  beforeEach(async () => {
    server = await start();
  });
  afterEach(async () => {
    await stop(server);
  });

  it('answers 404 for a withdrawn user and a user that does not exist, with no balance change', async () => {
    const { user_id } = await login(server, 'leaver');
    await withdraw(server, user_id);
    expect((await grant(server, user_id, 'w1', items(GOLD, 5n))).status).toBe(404);
    expect((await get_user(server, user_id)).json.user_state).toEqual({});
    expect((await grant(server, MISSING_USER, 'w2', items(GOLD, 5n))).status).toBe(404);
    expect((await get_user(server, MISSING_USER)).status).toBe(404);
  });

  it('delivers the balance change in the target user\'s next successful response as pending delta', async () => {
    const { session, user_id } = await login(server, 'pending');
    const reply = await grant(server, user_id, 'p1', items(GOLD, 5n));
    expect(reply.status).toBe(200);
    expect(reply.json).toEqual({ result: 'OK' });
    const next = await claim_all(session);
    expect(next.code).toBe(0);
    const entries = next.envelope.pending_user_state?.entries ?? [];
    expect(entries.some((e) => e.kind === 'ItemBalanceUserState' && e.id === BigInt(id_value(GOLD)) && !e.deleted)).toBe(true);
    const change = next.envelope.item_changes.find((c) => c.item_id === id_value(GOLD));
    expect(change?.delta).toBe(5n);
    expect(change?.source).toBe(CoreContract.ItemChangeSource.ITEM_CHANGE_SOURCE_ADMIN);
    expect(change?.ref).toBe('grant_items');
    // Delivered once.
    expect((await claim_all(session)).envelope.pending_user_state?.entries ?? []).toEqual([]);
  });

  it('applies two grant_items with one operation_id once and answers both with the same output; a different input is 409', async () => {
    const { user_id } = await login(server, 'twice');
    const first = await grant(server, user_id, 'same', items(GOLD, 5n));
    const second = await grant(server, user_id, 'same', items(GOLD, 5n));
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(second.text).toBe(first.text);
    expect(await balance(server, user_id, GOLD)).toBe(5n);
    const other = await grant(server, user_id, 'same', items(GOLD, 6n));
    expect(other.status).toBe(409);
    expect(other.json.error).toBe('conflict');
    expect(await balance(server, user_id, GOLD)).toBe(5n);
  });

  it('applies grant_items and revoke_items with the same operation_id, with history once keys admin:<operation>:<operation_id>', async () => {
    const { session, user_id } = await login(server, 'both');
    const now = (await claim_all(session)).envelope.server_time_at;
    expect((await grant(server, user_id, 'x', items(GOLD, 10n))).status).toBe(200);
    expect((await revoke(server, user_id, 'x', items(GOLD, 3n))).status).toBe(200);
    expect(await balance(server, user_id, GOLD)).toBe(7n);
    const range = { from_at: String(now - 60000n), to_at: String(now + 60000n) };
    const history = await admin(server, 'list_item_history', { user_id, ...range, after_seq: '0', limit: 100 });
    expect(history.status).toBe(200);
    const keys = (history.json.entries as Record<string, unknown>[]).map((row) => row.once_key);
    expect(keys).toEqual(['admin:grant_items:x', 'admin:revoke_items:x']);
    // The audit lines item-ledger writes inside the handler function name the operator (logging.with_audit_actor).
    const revoked = logs(server, 'audit').filter((line) => line.message === 'items revoked');
    expect(revoked.map((line) => [line.actor, line.once_key])).toEqual([['ogw', 'admin:revoke_items:x']]);
  });

  it('keeps grant_items with operation_id mail:<mail ID> apart from that mail, whose ClaimMail still grants its attachments', async () => {
    const { session, user_id } = await login(server, 'mailkey');
    const sent = await admin(server, 'send_mail', { operation_id: 'm1', user_id, mail: notice_mail('hello', { attachments: items(GOLD, 4n) }) });
    expect(sent.status).toBe(200);
    const mail_id = String(sent.json.mail_id);
    expect((await grant(server, user_id, `mail:${mail_id}`, items(GOLD, 1n))).status).toBe(200);
    expect(await balance(server, user_id, GOLD)).toBe(1n);
    expect((await claim_mail(session, BigInt(mail_id))).code).toBe(0);
    expect(await balance(server, user_id, GOLD)).toBe(5n);
  });

  it('stops revoke_items at 0 and answers the shortfall', async () => {
    const { user_id } = await login(server, 'short');
    await grant(server, user_id, 'g', items(GOLD, 3n));
    const reply = await revoke(server, user_id, 'r', items(GOLD, 5n));
    expect(reply.status).toBe(200);
    expect(reply.json).toEqual({ result: 'OK', shortfall: [{ item_id: id_value(GOLD), amount: '2', big_amount: '' }] });
    expect(await balance(server, user_id, GOLD)).toBe(0n);
  });

  it('answers 409 with result UNKNOWN_ITEM for revoke_items of an item not in the item table, with no balance change', async () => {
    const { user_id } = await login(server, 'unknown');
    await grant(server, user_id, 'g', items(GOLD, 3n));
    const reply = await revoke(server, user_id, 'r', [{ item_id: 999999, amount: '1' }]);
    expect(reply.status).toBe(409);
    expect(reply.json).toEqual({ error: 'conflict', result: 'UNKNOWN_ITEM' });
    expect(await balance(server, user_id, GOLD)).toBe(3n);
  });

  it('grants and revokes a big amount of a big item; refuses a big_amount that is not a big integer and a big amount of an item that is not big', async () => {
    const { user_id } = await login(server, 'big');
    const big = items(BIG_GOLD, 0n, '12345678901234567890');
    expect((await grant(server, user_id, 'b1', big)).json).toEqual({ result: 'OK' });
    expect(await balance(server, user_id, BIG_GOLD)).toBe(12345678901234567890n);
    expect((await revoke(server, user_id, 'b2', big)).json).toEqual({ result: 'OK', shortfall: [{ item_id: id_value(BIG_GOLD), amount: '0', big_amount: '' }] });
    expect(await balance(server, user_id, BIG_GOLD)).toBe(0n);
    expect((await grant(server, user_id, 'b3', items(BIG_GOLD, 0n, '12x'))).status).toBe(400);
    const not_big = await grant(server, user_id, 'b4', items(GOLD, 0n, '9007199254740992'));
    expect(not_big.status).toBe(409);
    expect(not_big.json).toEqual({ error: 'conflict', result: 'INVALID_AMOUNT' });
    expect(await balance(server, user_id, GOLD)).toBe(0n);
  });

  it('answers a retry of revoke_items with the same operation_id with the stored output and revokes once', async () => {
    const { user_id } = await login(server, 'revoke2');
    await grant(server, user_id, 'g', items(GOLD, 9n));
    const first = await revoke(server, user_id, 'r', items(GOLD, 2n));
    expect((await revoke(server, user_id, 'r', items(GOLD, 2n))).text).toBe(first.text);
    expect(await balance(server, user_id, GOLD)).toBe(7n);
  });
});
