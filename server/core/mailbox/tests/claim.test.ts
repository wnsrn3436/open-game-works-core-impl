import * as CoreContract from '../../../generated/contract/core_contract.ts';
import {
  CoreError, GAME_ERROR, PASS, Source, advance_time, amount, balance, claim_all, claim_mail, give, id, login, logs, mail_entries, mail_ids,
  pairs, plain, read_mail, read_mails, request_transaction, send_mail, start_mail_server, stop_all, user_logs, type MailServer, type Sent,
} from './helpers.ts';

function claimed_items(sent: Sent): [number, bigint][] {
  return pairs((sent.response as CoreContract.ClaimMailResponse).items);
}

function claim_all_response(sent: Sent): CoreContract.ClaimAllMailResponse {
  return sent.response as CoreContract.ClaimAllMailResponse;
}

function by_item_id(list: [number, bigint][]): [number, bigint][] {
  return [...list].sort(([a], [b]) => a - b);
}

afterAll(() => {
  stop_all();
});

describe('ReadMail and ClaimMail', () => {
  let ms: MailServer;

  beforeAll(async () => {
    ms = await start_mail_server();
  });

  test('marks a mail read once and answers MAIL_NOT_FOUND to a mail ID the user does not have', async () => {
    const user = await login(ms);
    const sent = await send_mail(ms, user.user_id, plain());
    const first = await read_mail(ms, user, sent.mail_id);
    expect(first.code).toBe(0);
    expect(mail_entries(first.delta?.user_state)).toEqual([[sent.mail_id, false]]);
    expect((await read_mails(ms, user.user_id))[0]?.read).toBe(true);
    const second = await read_mail(ms, user, sent.mail_id);
    expect(second.code).toBe(0);
    expect(mail_entries(second.delta?.user_state)).toEqual([]);
    expect((await read_mail(ms, user, sent.mail_id + 100n)).code).toBe(CoreError.CORE_ERROR_MAIL_NOT_FOUND);
  });

  test('grants the attachments with source Mail and removes the mail; a second claim is MAIL_NOT_FOUND', async () => {
    const user = await login(ms);
    const attachments = [amount('[item_mailbox_gold]', 10n), amount('[item_mailbox_gem]', 2n)];
    const sent = await send_mail(ms, user.user_id, plain({ attachments }));
    await read_mail(ms, user, sent.mail_id);
    const claimed = await claim_mail(ms, user, sent.mail_id);
    expect(claimed.code).toBe(0);
    expect(claimed_items(claimed)).toEqual(pairs(attachments));
    expect(mail_entries(claimed.delta?.user_state)).toEqual([[sent.mail_id, true]]);
    const changes = (claimed.delta?.item_changes ?? []).map((change) => [change.item_id, change.delta, change.source, change.ref]);
    expect(changes).toEqual([
      [id('[item_mailbox_gold]'), 10n, Source.ITEM_CHANGE_SOURCE_MAIL, sent.mail_id.toString()],
      [id('[item_mailbox_gem]'), 2n, Source.ITEM_CHANGE_SOURCE_MAIL, sent.mail_id.toString()],
    ]);
    expect(await balance(ms, user.user_id, '[item_mailbox_gold]')).toBe(10n);
    expect(await balance(ms, user.user_id, '[item_mailbox_gem]')).toBe(2n);
    expect(await read_mails(ms, user.user_id)).toHaveLength(0);
    expect(user_logs(ms, 'core', user.user_id).some((line) => line.message === 'mail claimed' && line.mail_id === sent.mail_id.toString())).toBe(true);

    const again = await claim_mail(ms, user, sent.mail_id);
    expect(again.code).toBe(CoreError.CORE_ERROR_MAIL_NOT_FOUND);
    expect(await balance(ms, user.user_id, '[item_mailbox_gold]')).toBe(10n);
  });

  test('removes a mail with neither attachments nor extra_id on ClaimMail', async () => {
    const user = await login(ms);
    const sent = await send_mail(ms, user.user_id, plain());
    const claimed = await claim_mail(ms, user, sent.mail_id);
    expect(claimed.code).toBe(0);
    expect(claimed_items(claimed)).toEqual([]);
    expect(await read_mails(ms, user.user_id)).toHaveLength(0);
  });

  test('keeps the mail and the balance when the attachments fail with ITEM_LIMIT_EXCEEDED', async () => {
    const user = await login(ms);
    await give(ms, user.user_id, [amount('[item_mailbox_gem]', 99n)]);
    const sent = await send_mail(ms, user.user_id, plain({ attachments: [amount('[item_mailbox_gold]', 1n), amount('[item_mailbox_gem]', 5n)] }));
    const claimed = await claim_mail(ms, user, sent.mail_id);
    expect(claimed.code).toBe(CoreError.CORE_ERROR_ITEM_LIMIT_EXCEEDED);
    expect(await mail_ids(ms, user.user_id)).toEqual([sent.mail_id]);
    expect(await balance(ms, user.user_id, '[item_mailbox_gem]')).toBe(99n);
    expect(await balance(ms, user.user_id, '[item_mailbox_gold]')).toBe(0n);
  });

  test('gives the attachments as they are in the ClaimMail items when a Discard item overflows', async () => {
    const user = await login(ms);
    await give(ms, user.user_id, [amount('[item_mailbox_shard]', 98n)]);
    const sent = await send_mail(ms, user.user_id, plain({ attachments: [amount('[item_mailbox_shard]', 5n)] }));
    const claimed = await claim_mail(ms, user, sent.mail_id);
    expect(claimed.code).toBe(0);
    expect(claimed_items(claimed)).toEqual([[id('[item_mailbox_shard]'), 5n]]);
    expect((claimed.delta?.item_changes ?? []).map((change) => [change.item_id, change.delta, change.overflow])).toEqual([[id('[item_mailbox_shard]'), 2n, 3n]]);
    expect(await balance(ms, user.user_id, '[item_mailbox_shard]')).toBe(100n);
  });

  test('removes a mail past its expires_at in the next request start without granting, and that ClaimMail is MAIL_NOT_FOUND', async () => {
    const user = await login(ms);
    const sent = await send_mail(ms, user.user_id, plain({ attachments: [amount('[item_mailbox_gold]', 3n)], expire_ms: 1000n }));
    advance_time(ms, 1000n);
    const claimed = await claim_mail(ms, user, sent.mail_id);
    expect(claimed.code).toBe(CoreError.CORE_ERROR_MAIL_NOT_FOUND);
    expect(await read_mails(ms, user.user_id)).toHaveLength(0);
    expect(await balance(ms, user.user_id, '[item_mailbox_gold]')).toBe(0n);
    // The request start change was committed: the next success response carries its delete.
    const next = await claim_all(ms, user);
    expect(mail_entries(next.delta?.pending_user_state)).toEqual([[sent.mail_id, true]]);
  });

  test('answers MAIL_EXPIRED to ClaimMail of a mail past its expires_at that request start did not remove, keeping the mail and the balance', async () => {
    const user = await login(ms);
    const sent = await send_mail(ms, user.user_id, plain({ attachments: [amount('[item_mailbox_gold]', 3n)], expire_ms: 1000n }));
    advance_time(ms, 1000n);
    const request = new CoreContract.ClaimMailRequest();
    request.mail_id = sent.mail_id;
    // No on_request_start: the request transaction finds the expired mail still stored.
    const claimed = await request_transaction(ms, user.user_id, 'core/ClaimMail', (ctx) => ms.mailbox.ClaimMail(ctx, request));
    expect(claimed.code).toBe(CoreError.CORE_ERROR_MAIL_EXPIRED);
    expect(await mail_ids(ms, user.user_id)).toEqual([sent.mail_id]);
    expect(await balance(ms, user.user_id, '[item_mailbox_gold]')).toBe(0n);
  });

  test('rolls back the attachments of a mail whose grant_mail_extra returns a GameError', async () => {
    const user = await login(ms);
    const sent = await send_mail(ms, user.user_id, plain({ attachments: [amount('[item_mailbox_gold]', 7n)], extra_id: 2 }));
    const calls: [number, bigint, CoreContract.ItemChangeSource | undefined, string | undefined][] = [];
    ms.extra = (ctx, extra_id, mail_id) => {
      calls.push([extra_id, mail_id, ctx.hook_change_source?.source, ctx.hook_change_source?.ref]);
      return GAME_ERROR;
    };
    try {
      expect((await claim_mail(ms, user, sent.mail_id)).code).toBe(GAME_ERROR);
    } finally {
      ms.extra = null;
    }
    expect(calls).toEqual([[2, sent.mail_id, Source.ITEM_CHANGE_SOURCE_MAIL, sent.mail_id.toString()]]);
    expect(await balance(ms, user.user_id, '[item_mailbox_gold]')).toBe(0n);
    expect(await mail_ids(ms, user.user_id)).toEqual([sent.mail_id]);
  });

  test('ends INTERNAL and keeps the mail when grant_mail_extra returns a number that is not a GameError', async () => {
    const user = await login(ms);
    const sent = await send_mail(ms, user.user_id, plain({ attachments: [amount('[item_mailbox_gold]', 3n)], extra_id: 5 }));
    for (const output of [999, CoreError.CORE_ERROR_MAIL_NOT_FOUND, 2 ** 60]) {
      ms.extra = (): unknown => output;
      let sent_claim: Sent;
      try {
        sent_claim = await claim_mail(ms, user, sent.mail_id);
      } finally {
        ms.extra = null;
      }
      expect(sent_claim.code).toBe(CoreError.CORE_ERROR_INTERNAL);
      expect(await mail_ids(ms, user.user_id)).toEqual([sent.mail_id]);
      expect(await balance(ms, user.user_id, '[item_mailbox_gold]')).toBe(0n);
    }
  });
});

describe('ClaimAllMail', () => {
  let ms: MailServer;

  beforeAll(async () => {
    ms = await start_mail_server();
  });

  test('claims every mail it can and leaves only the mails that failed', async () => {
    const user = await login(ms);
    await give(ms, user.user_id, [amount('[item_mailbox_gem]', 99n)]);
    const gold = await send_mail(ms, user.user_id, plain({ attachments: [amount('[item_mailbox_gold]', 5n)] }));
    const gem = await send_mail(ms, user.user_id, plain({ attachments: [amount('[item_mailbox_gem]', 5n)] }));
    const rejected = await send_mail(ms, user.user_id, plain({ attachments: [amount('[item_mailbox_gold]', 7n)], extra_id: 3 }));
    const empty = await send_mail(ms, user.user_id, plain());
    ms.extra = (_ctx, extra_id) => (extra_id === 3 ? GAME_ERROR : PASS);
    let sent: Sent;
    try {
      sent = await claim_all(ms, user);
    } finally {
      ms.extra = null;
    }
    expect(sent.code).toBe(0);
    const response = claim_all_response(sent);
    expect(response.mail_ids).toEqual([gold.mail_id, empty.mail_id]);
    expect(response.unclaimed_count).toBe(2);
    expect(pairs(response.items)).toEqual([[id('[item_mailbox_gold]'), 5n]]);
    expect(await mail_ids(ms, user.user_id)).toEqual([gem.mail_id, rejected.mail_id]);
    expect(await balance(ms, user.user_id, '[item_mailbox_gold]')).toBe(5n);
    expect(await balance(ms, user.user_id, '[item_mailbox_gem]')).toBe(99n);
    // Only the claimed mail's grant is in item_changes: the rolled back savepoints took theirs.
    expect((sent.delta?.item_changes ?? []).map((change) => [change.item_id, change.delta, change.ref])).toEqual([[id('[item_mailbox_gold]'), 5n, gold.mail_id.toString()]]);
  });

  test('ends INTERNAL and rolls back every mail of the request when a grant_mail_extra throws or returns neither pass nor a GameError', async () => {
    const user = await login(ms);
    const first = await send_mail(ms, user.user_id, plain({ attachments: [amount('[item_mailbox_gold]', 2n)] }));
    const second = await send_mail(ms, user.user_id, plain({ attachments: [amount('[item_mailbox_gem]', 1n)], extra_id: 4 }));
    const third = await send_mail(ms, user.user_id, plain({ attachments: [amount('[item_mailbox_shard]', 1n)] }));
    for (const extra of [
      (): never => {
        throw new Error('content hook failed');
      },
      (): unknown => 'granted',
      // Below 1000 is not a GameError, even when it equals a core failure code (18 is MAIL_NOT_FOUND).
      (): unknown => 999,
      (): unknown => CoreError.CORE_ERROR_MAIL_NOT_FOUND,
      (): unknown => 2 ** 60,
    ]) {
      ms.extra = extra;
      let sent: Sent;
      try {
        sent = await claim_all(ms, user);
      } finally {
        ms.extra = null;
      }
      expect(sent.code).toBe(CoreError.CORE_ERROR_INTERNAL);
      expect(await mail_ids(ms, user.user_id)).toEqual([first.mail_id, second.mail_id, third.mail_id]);
      expect(await balance(ms, user.user_id, '[item_mailbox_gold]')).toBe(0n);
      expect(await balance(ms, user.user_id, '[item_mailbox_gem]')).toBe(0n);
      expect(await balance(ms, user.user_id, '[item_mailbox_shard]')).toBe(0n);
    }
  });

  test('adds up the claimed attachments by item ID value in item ID value order; Discard overflow keeps the attachments', async () => {
    const user = await login(ms);
    await give(ms, user.user_id, [amount('[item_mailbox_shard]', 99n)]);
    await send_mail(ms, user.user_id, plain({ attachments: [amount('[item_mailbox_shard]', 2n), amount('[item_mailbox_gold]', 2n)] }));
    await send_mail(ms, user.user_id, plain({ attachments: [amount('[item_mailbox_gold]', 3n), amount('[item_mailbox_gem]', 1n)] }));
    const sent = await claim_all(ms, user);
    expect(sent.code).toBe(0);
    expect(pairs(claim_all_response(sent).items)).toEqual(
      by_item_id([
        [id('[item_mailbox_gold]'), 5n],
        [id('[item_mailbox_gem]'), 1n],
        [id('[item_mailbox_shard]'), 2n],
      ]),
    );
    expect(claim_all_response(sent).unclaimed_count).toBe(0);
    expect(await balance(ms, user.user_id, '[item_mailbox_shard]')).toBe(100n);
  });
});

describe('without grant_mail_extra', () => {
  let ms: MailServer;

  beforeAll(async () => {
    ms = await start_mail_server({ hook: false });
  });

  test('ClaimAllMail leaves a max_amount mail and an extra_id mail, counts them, claims the rest and succeeds', async () => {
    const user = await login(ms);
    await give(ms, user.user_id, [amount('[item_mailbox_gem]', 99n)]);
    const gold = await send_mail(ms, user.user_id, plain({ attachments: [amount('[item_mailbox_gold]', 4n)] }));
    const gem = await send_mail(ms, user.user_id, plain({ attachments: [amount('[item_mailbox_gem]', 2n)] }));
    const extra = await send_mail(ms, user.user_id, plain({ attachments: [amount('[item_mailbox_shard]', 1n)], extra_id: 9 }));
    const sent = await claim_all(ms, user);
    expect(sent.code).toBe(0);
    expect(claim_all_response(sent).mail_ids).toEqual([gold.mail_id]);
    expect(claim_all_response(sent).unclaimed_count).toBe(2);
    expect(await mail_ids(ms, user.user_id)).toEqual([gem.mail_id, extra.mail_id]);
    expect(await balance(ms, user.user_id, '[item_mailbox_shard]')).toBe(0n);
    expect(user_logs(ms, 'error', user.user_id).some((line) => String(line.message).includes('grant_mail_extra is not registered'))).toBe(true);
  });

  test('ClaimMail of an extra_id mail ends INTERNAL and keeps it', async () => {
    const user = await login(ms);
    const extra = await send_mail(ms, user.user_id, plain({ attachments: [amount('[item_mailbox_gold]', 1n)], extra_id: 9 }));
    expect((await claim_mail(ms, user, extra.mail_id)).code).toBe(CoreError.CORE_ERROR_INTERNAL);
    expect(await mail_ids(ms, user.user_id)).toEqual([extra.mail_id]);
    expect(await balance(ms, user.user_id, '[item_mailbox_gold]')).toBe(0n);
    expect(logs(ms, 'error').some((line) => line.user_id === user.user_id.toString() && String(line.message).includes('grant_mail_extra'))).toBe(true);
  });
});

describe('ClaimAllMail count limit', () => {
  let ms: MailServer;

  beforeAll(async () => {
    ms = await start_mail_server({ settings: { 'mailbox.maxClaimAllCount': 3 } });
  });

  test('claims the mailbox.maxClaimAllCount mails with the smallest IDs and leaves the biggest with unclaimed_count 1', async () => {
    const user = await login(ms);
    const ids: bigint[] = [];
    for (let i = 0; i < 4; i += 1) ids.push((await send_mail(ms, user.user_id, plain())).mail_id);
    const sent = await claim_all(ms, user);
    expect(claim_all_response(sent).mail_ids).toEqual(ids.slice(0, 3));
    expect(claim_all_response(sent).unclaimed_count).toBe(1);
    expect(await mail_ids(ms, user.user_id)).toEqual(ids.slice(3));
  });
});
