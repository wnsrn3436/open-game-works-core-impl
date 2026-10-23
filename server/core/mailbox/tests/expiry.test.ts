import * as Tables from '../tables.ts';
import {
  DAY_MS, Source, advance_time, amount, claim_mail, give, id, in_user, login, mail_ids, peek, plain, read_mails, send_mail, start_mail_server, stop_all, touch,
  type MailServer,
} from './helpers.ts';

let ms: MailServer;

beforeAll(async () => {
  ms = await start_mail_server();
});

afterEach(() => {
  vi.restoreAllMocks();
});

afterAll(() => {
  stop_all();
});

function next_expires_at(user_id: bigint): Promise<bigint> {
  return peek(ms, user_id, (ctx) => Tables.read_next_expires_at(ms.storage.db(ctx), user_id));
}

/** Request start of the user, counting the `list_state` calls it makes. */
async function list_reads_in_request_start(user_id: bigint): Promise<number> {
  const list_state = vi.spyOn(ms.storage, 'list_state');
  await ms.mailbox.on_request_start(user_id);
  const count = list_state.mock.calls.length;
  list_state.mockRestore();
  return count;
}

describe('request start expiry bound', () => {
  test('does not read the MailUserState list of a user with no mail whose expires_at is not 0', async () => {
    const empty = await login(ms);
    expect(await list_reads_in_request_start(empty.user_id)).toBe(0);
    expect(await next_expires_at(empty.user_id)).toBe(0n);

    const user = await login(ms);
    await give(ms, user.user_id, [amount('[item_mailbox_gold]', 1000n)]);
    const items = [amount('[item_mailbox_gold]', 5n)];
    for (const n of [1, 2, 3]) {
      const out = await in_user(ms, user.user_id, (ctx) =>
        ms.mailbox.grant_or_mail(ctx, items, { source: Source.ITEM_CHANGE_SOURCE_IAP, ref: 'iap', once_key: `iap:expiry:${String(n)}` }, id('[mail_mailbox_plain]'), []),
      );
      expect(out.result).toBe('Mailed');
    }
    expect((await read_mails(ms, user.user_id)).map((mail) => mail.expires_at)).toEqual([0n, 0n, 0n]);
    expect(await next_expires_at(user.user_id)).toBe(0n);
    advance_time(ms, 100n * DAY_MS);
    expect(await list_reads_in_request_start(user.user_id)).toBe(0);
    expect(await read_mails(ms, user.user_id)).toHaveLength(3);
  });

  test('deletes only the first of two mails after it expires, and next_expires_at becomes the second expires_at', async () => {
    const user = await login(ms);
    // The later mail goes first, so the second send lowers next_expires_at.
    const later = await send_mail(ms, user.user_id, plain({ expire_ms: 5000n }));
    const sooner = await send_mail(ms, user.user_id, plain({ expire_ms: 1000n }));
    const mails = await read_mails(ms, user.user_id);
    const later_at = mails.find((mail) => mail.id === later.mail_id)?.expires_at ?? 0n;
    const sooner_at = mails.find((mail) => mail.id === sooner.mail_id)?.expires_at ?? 0n;
    expect(await next_expires_at(user.user_id)).toBe(sooner_at);

    advance_time(ms, 999n);
    expect(await list_reads_in_request_start(user.user_id)).toBe(0);
    expect(await mail_ids(ms, user.user_id)).toEqual([later.mail_id, sooner.mail_id]);

    advance_time(ms, 1n);
    expect(await list_reads_in_request_start(user.user_id)).toBe(1);
    expect(await mail_ids(ms, user.user_id)).toEqual([later.mail_id]);
    expect(await next_expires_at(user.user_id)).toBe(later_at);

    advance_time(ms, 4000n);
    await touch(ms, user);
    expect(await mail_ids(ms, user.user_id)).toEqual([]);
    expect(await next_expires_at(user.user_id)).toBe(0n);
  });

  test('keeps next_expires_at after a claim and lowers it to the mail left once it is reached', async () => {
    const user = await login(ms);
    const first = await send_mail(ms, user.user_id, plain({ expire_ms: 1000n }));
    const second = await send_mail(ms, user.user_id, plain({ expire_ms: 3000n }));
    const mails = await read_mails(ms, user.user_id);
    const first_at = mails.find((mail) => mail.id === first.mail_id)?.expires_at ?? 0n;
    const second_at = mails.find((mail) => mail.id === second.mail_id)?.expires_at ?? 0n;
    expect((await claim_mail(ms, user, first.mail_id)).code).toBe(0);
    expect(await next_expires_at(user.user_id)).toBe(first_at);
    advance_time(ms, 1000n);
    expect(await list_reads_in_request_start(user.user_id)).toBe(1);
    expect(await mail_ids(ms, user.user_id)).toEqual([second.mail_id]);
    expect(await next_expires_at(user.user_id)).toBe(second_at);
  });
});

describe('expiry settings at server start', () => {
  test('does not start with mailbox.defaultExpireMs 0 or over mailbox.maxExpireMs', async () => {
    await expect(start_mail_server({ settings: { 'mailbox.defaultExpireMs': 0 } })).rejects.toThrow(/mailbox\.defaultExpireMs/);
    await expect(
      start_mail_server({ settings: { 'mailbox.defaultExpireMs': Number(10n * DAY_MS) + 1, 'mailbox.maxExpireMs': Number(10n * DAY_MS) } }),
    ).rejects.toThrow(/mailbox\.maxExpireMs/);
    const equal = await start_mail_server({ settings: { 'mailbox.defaultExpireMs': Number(10n * DAY_MS), 'mailbox.maxExpireMs': Number(10n * DAY_MS) } });
    expect(equal.mailbox.complete_start()).toBeNull();
  });
});
