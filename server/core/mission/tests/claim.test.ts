import * as CoreContract from '../../../generated/contract/core_contract.ts';
import type * as GameContract from '../../../generated/contract/game_contract.ts';
import type { AnalyticsSendEvent } from '../../logging/index.ts';
import type { FakeAnalyticsController } from '../../logging/dev/adapters/fake.ts';
import { fake, read_logs, set_time, wait_background } from '../../testing/dev/index.ts';
import {
  BEAD, C, CODE, GEM, GOLD, M, REJECTED, add_ids, at, balance, claim, code_of, delta_kinds, delta_progress, id, item, mails, mission_row,
  modules_without, new_user, plain, progress, run, set_progress, start, state, stop_all, stored, type Sent, type Session, type TestServer,
} from './support.ts';

afterEach(stop_all);

const MISSION_SOURCE = CoreContract.ItemChangeSource.ITEM_CHANGE_SOURCE_MISSION;

function items_of(sent: Sent): CoreContract.ItemAmount[] {
  return (sent.response as CoreContract.ClaimMissionResponse | null)?.items ?? [];
}

/** A failed claim leaves the committed UserState as it was. */
async function expect_unchanged(s: TestServer, u: Session, request: () => Promise<Sent>, code: number): Promise<void> {
  const before = await state(s, u);
  expect(code_of(await request())).toBe(code);
  expect(await state(s, u)).toEqual(before);
}

describe('ClaimMission', () => {
  it('grants the reward with source Mission and sets claimed, both in the delta of the same response', async () => {
    const s = await start();
    const u = await new_user(s);
    await add_ids(u, C.sum, 10n);
    const sent = await claim(u, M.sum_daily);
    expect(code_of(sent)).toBe(0);
    expect(plain(items_of(sent))).toEqual(plain([item(GOLD, 100n)]));

    const changes = sent.envelope.item_changes;
    expect(changes.map((c) => ({ item_id: c.item_id, delta: c.delta, source: c.source, ref: c.ref })))
      .toEqual([{ item_id: GOLD, delta: 100n, source: MISSION_SOURCE, ref: String(M.sum_daily) }]);
    expect(delta_kinds(sent)).toContain('ItemBalanceUserState');
    expect(delta_progress(sent).map((r) => ({ id: r.id, progress: r.progress, claimed: r.claimed })))
      .toEqual([{ id: BigInt(M.sum_daily), progress: 10n, claimed: true }]);

    expect(await balance(s, u, GOLD)).toBe(100n);
    expect(await progress(u, M.sum_daily)).toEqual({ progress: 10n, claimed: true });
    expect(s.hooks.validate_calls).toEqual([M.sum_daily]);
  });

  it('ends at each step with the error of its failure condition and keeps progress and balances', async () => {
    const s = await start();
    const u = await new_user(s);

    // 2. requirement not passed
    await add_ids(u, C.locked, 3n);
    await expect_unchanged(s, u, () => claim(u, M.locked), CODE.CORE_ERROR_MISSION_LOCKED);

    // 3. already claimed
    await add_ids(u, C.other, 5n);
    expect(code_of(await claim(u, M.other))).toBe(0);
    await expect_unchanged(s, u, () => claim(u, M.other), CODE.CORE_ERROR_MISSION_ALREADY_CLAIMED);

    // 4. not completed
    await add_ids(u, C.max, 9n);
    await expect_unchanged(s, u, () => claim(u, M.max), CODE.CORE_ERROR_MISSION_NOT_COMPLETED);

    // 5. validate_mission_claim rejects
    await add_ids(u, C.max, 10n);
    s.hooks.validate = REJECTED;
    await expect_unchanged(s, u, () => claim(u, M.max), REJECTED);
    expect(s.hooks.validate_calls.at(-1)).toBe(M.max);
    expect(await progress(u, M.max)).toEqual({ progress: 10n, claimed: false });
    s.hooks.validate = 'pass';
    expect(code_of(await claim(u, M.max))).toBe(0);
    expect(await balance(s, u, GOLD)).toBe(1n + 10n);

    // 1. outside the active window, even with progress at target
    expect(code_of(await set_progress(u, M.window, 3n, false))).toBe(0);
    await expect_unchanged(s, u, () => claim(u, M.window), CODE.CORE_ERROR_MISSION_UNAVAILABLE);
    set_time(s.server, at(2027, 1, 1, 12));
    expect(code_of(await claim(u, M.window))).toBe(0);
    expect(await balance(s, u, GOLD)).toBe(1n + 10n + 1n);
  });

  it('ends with INTERNAL at step 6 when grant_or_mail fails, and keeps progress, claimed, balances and mails', async () => {
    // Two attachments per mail split the three reward items of [mission_split] into two mails, and a mailbox_once_key
    // row of the second mail's once_key makes grant_or_mail INVALID_INPUT. Without `rating`, whose start check stops
    // a server below mailbox.maxAttachments 3 on the core test data, and `matchmaker`, which does not start without it.
    const s = await start({ settings: { 'mailbox.maxAttachments': 2 }, server_modules: modules_without('rating', 'matchmaker') });
    const u = await new_user(s);
    expect(mission_row(M.split).reward).toHaveLength(3);
    expect(await add_ids(u, C.split, 1n)).toEqual([M.split]);
    const second_key = `mission:${String(M.split)}:0:0:2`;
    const { sent } = await run(u, (ctx, _mission, storage) =>
      storage.db(ctx).query('INSERT INTO mailbox_once_key (user_id, once_key, mail_id) VALUES ($1, $2, $3)', [ctx.user_id, second_key, 999_999n]));
    expect(code_of(sent)).toBe(0);
    s.hooks.reject_items = true;
    await expect_unchanged(s, u, () => claim(u, M.split), CODE.CORE_ERROR_INTERNAL);
    expect(await progress(u, M.split)).toEqual({ progress: 1n, claimed: false });
    for (const item_id of [GOLD, GEM, BEAD]) expect(await balance(s, u, item_id)).toBe(0n);
    expect(await mails(s, u)).toEqual([]);
    expect(s.hooks.after_calls).toEqual([]);

    // Without that row the same claim mails the reward in two mails.
    const other = await new_user(s);
    await add_ids(other, C.split, 1n);
    const mailed = await claim(other, M.split);
    expect(code_of(mailed)).toBe(0);
    expect(mailed.envelope.item_mails).toHaveLength(2);
    expect(await progress(other, M.split)).toEqual({ progress: 1n, claimed: true });
  });

  it('judges the hook output with storage.check_hook_output: any GameError of 1000 or more, and a throw otherwise', async () => {
    const s = await start();
    const u = await new_user(s);
    await add_ids(u, C.other, 5n);
    const logs = (): string => JSON.stringify(read_logs(s.server));

    // A GameError value the generated GameError enum does not have is a GameError for mission, so routing turns it
    // into INTERNAL only because it is outside the core_errors of ClaimMission.
    s.hooks.validate = 5000 as GameContract.GameError;
    await expect_unchanged(s, u, () => claim(u, M.other), CODE.CORE_ERROR_INTERNAL);
    expect(logs()).toContain('returned GameError 5000');
    expect(logs()).not.toContain('hook validate_mission_claim returned');

    s.hooks.validate = 999 as GameContract.GameError;
    await expect_unchanged(s, u, () => claim(u, M.other), CODE.CORE_ERROR_INTERNAL);
    expect(logs()).toContain('hook validate_mission_claim returned 999, not pass or a GameError');

    s.hooks.validate = 'pass';
    expect(code_of(await claim(u, M.other))).toBe(0);
  });

  it('checks the steps in order: the requirement before claimed, claimed before target, target before the hook', async () => {
    const s = await start();
    const u = await new_user(s);
    expect(code_of(await set_progress(u, M.locked, 0n, true))).toBe(0);
    expect(code_of(await claim(u, M.locked))).toBe(CODE.CORE_ERROR_MISSION_LOCKED);
    s.hooks.gate = true;
    expect(code_of(await claim(u, M.locked))).toBe(CODE.CORE_ERROR_MISSION_ALREADY_CLAIMED);
    expect(code_of(await set_progress(u, M.max, 3n, false))).toBe(0);
    s.hooks.validate = REJECTED;
    expect(code_of(await claim(u, M.max))).toBe(CODE.CORE_ERROR_MISSION_NOT_COMPLETED);
    expect(s.hooks.validate_calls).toEqual([]);
  });

  it('mails the reward with [mission_reward_mail] and sets claimed when max_amount stops the grant', async () => {
    const s = await start();
    const u = await new_user(s);
    await add_ids(u, C.overflow, 1n);
    const sent = await claim(u, M.overflow);
    expect(code_of(sent)).toBe(0);
    expect(items_of(sent)).toEqual([]);
    expect(await balance(s, u, GEM)).toBe(0n);
    expect(await progress(u, M.overflow)).toEqual({ progress: 1n, claimed: true });
    expect(sent.envelope.item_mails.map((m) => ({ source: m.source, ref: m.ref, items: plain(m.items) })))
      .toEqual([{ source: MISSION_SOURCE, ref: String(M.overflow), items: plain([item(GEM, 100n)]) }]);
    const mail = await mails(s, u);
    expect(mail.map((m) => ({ template_id: m.template_id, attachments: plain(m.attachments) })))
      .toEqual([{ template_id: id('[mail_mission_reward_mail]'), attachments: plain([item(GEM, 100n)]) }]);
  });

  it('mails the reward and sets claimed when the item-ledger validation hook rejects the grant', async () => {
    const s = await start();
    const u = await new_user(s);
    await add_ids(u, C.other, 5n);
    s.hooks.reject_items = true;
    const sent = await claim(u, M.other);
    expect(code_of(sent)).toBe(0);
    expect(items_of(sent)).toEqual([]);
    expect(await balance(s, u, GOLD)).toBe(0n);
    expect(await progress(u, M.other)).toEqual({ progress: 5n, claimed: true });
    expect(sent.envelope.item_mails).toHaveLength(1);
    expect((await mails(s, u)).map((m) => plain(m.attachments))).toEqual([plain(mission_row(M.other).reward)]);
  });

  it('claims a locked mission with the progress kept while locked once the requirement passes', async () => {
    const s = await start();
    const u = await new_user(s);
    expect(await add_ids(u, C.locked, 2n)).toEqual([M.locked]);
    expect(await add_ids(u, C.locked, 5n)).toEqual([M.locked]);
    expect(await progress(u, M.locked)).toEqual({ progress: 3n, claimed: false });
    expect(code_of(await claim(u, M.locked))).toBe(CODE.CORE_ERROR_MISSION_LOCKED);
    s.hooks.gate = true;
    const sent = await claim(u, M.locked);
    expect(code_of(sent)).toBe(0);
    expect(plain(items_of(sent))).toEqual(plain([item(GOLD, 30n)]));
    expect(await balance(s, u, GOLD)).toBe(30n);
  });

  it('progresses and claims a mission with an empty requirement cell', async () => {
    const s = await start();
    const u = await new_user(s);
    expect(mission_row(M.open).requirement).toBe(0);
    expect(await add_ids(u, C.open, 3n)).toEqual([M.open]);
    const sent = await claim(u, M.open);
    expect(code_of(sent)).toBe(0);
    expect(plain(items_of(sent))).toEqual(plain([item(GOLD, 3n), item(GEM, 2n)]));
    expect(await balance(s, u, GOLD)).toBe(3n);
    expect(await balance(s, u, GEM)).toBe(2n);
  });
});

describe('extra grant', () => {
  it('rolls back the reward when grant_mission_extra returns a GameError, and grants both once it passes', async () => {
    const s = await start();
    const u = await new_user(s);
    await add_ids(u, C.extra, 1n);
    s.hooks.extra = REJECTED;
    const before = await state(s, u);
    const failed = await claim(u, M.extra);
    expect(code_of(failed)).toBe(REJECTED);
    expect(failed.envelope.item_changes).toEqual([]);
    expect(await state(s, u)).toEqual(before);
    expect(await balance(s, u, GOLD)).toBe(0n);
    expect(s.hooks.extra_calls).toEqual([M.extra]);

    s.hooks.extra = 'pass';
    expect(code_of(await claim(u, M.extra))).toBe(0);
    expect(await balance(s, u, GOLD)).toBe(5n);
    expect(await progress(u, M.extra)).toEqual({ progress: 1n, claimed: true });
  });

  it('claims a mission with only an extra grant through the hook', async () => {
    const s = await start();
    const u = await new_user(s);
    await add_ids(u, C.extra, 2n);
    const sent = await claim(u, M.extra_only);
    expect(code_of(sent)).toBe(0);
    expect(items_of(sent)).toEqual([]);
    expect(sent.envelope.item_changes).toEqual([]);
    expect(s.hooks.extra_calls).toContain(M.extra_only);
    expect(await progress(u, M.extra_only)).toEqual({ progress: 2n, claimed: true });
  });
});

describe('on_mission_claimed', () => {
  it('runs once per successful claim with its mission ID, and its add_progress comes in the delta of the same response', async () => {
    const s = await start();
    const u = await new_user(s);
    s.hooks.after = 'count';
    await add_ids(u, C.other, 5n);
    await add_ids(u, C.after, 1n);
    await add_ids(u, C.max, 3n);

    expect(code_of(await claim(u, M.max))).toBe(CODE.CORE_ERROR_MISSION_NOT_COMPLETED);
    expect(s.hooks.after_calls).toEqual([]);

    const first = await claim(u, M.other);
    expect(code_of(first)).toBe(0);
    expect(s.hooks.after_calls).toEqual([M.other]);
    expect(delta_progress(first).map((r) => ({ id: r.id, progress: r.progress })))
      .toEqual([{ id: BigInt(M.other), progress: 5n }, { id: BigInt(M.tally), progress: 1n }].sort((a, b) => Number(a.id - b.id)));

    expect(code_of(await claim(u, M.other))).toBe(CODE.CORE_ERROR_MISSION_ALREADY_CLAIMED);
    const second = await claim(u, M.after);
    expect(code_of(second)).toBe(0);
    expect(s.hooks.after_calls).toEqual([M.other, M.after]);
    expect(await progress(u, M.tally)).toEqual({ progress: 2n, claimed: false });
  });

  it('turns a throwing hook into INTERNAL and keeps progress, claimed and items', async () => {
    const s = await start();
    const u = await new_user(s);
    await add_ids(u, C.other, 5n);
    s.hooks.after = 'throw';
    const before = await state(s, u);
    const sent = await claim(u, M.other);
    expect(code_of(sent)).toBe(CODE.CORE_ERROR_INTERNAL);
    expect(await state(s, u)).toEqual(before);
    expect(await stored(s, u, M.other)).not.toBeNull();
    expect(await progress(u, M.other)).toEqual({ progress: 5n, claimed: false });
    expect(await balance(s, u, GOLD)).toBe(0n);
  });
});

describe('analytics', () => {
  /** The `core_mission_claimed` events the fake analytics adapter received. */
  function claimed_events(s: TestServer): AnalyticsSendEvent[] {
    const controller = fake(s.server, 'analytics') as FakeAnalyticsController;
    const events = controller.calls().flatMap((c) => (c.operation === 'send' ? (c.input as readonly AnalyticsSendEvent[]) : []));
    return events.filter((e) => e.name === 'core_mission_claimed');
  }

  it('records core_mission_claimed with mission_id for a user who allows analytics, and nothing for a failed claim', async () => {
    const s = await start();
    const u = await new_user(s);
    await add_ids(u, C.other, 5n);
    expect(code_of(await claim(u, M.other))).toBe(0);
    expect(code_of(await claim(u, M.other))).toBe(CODE.CORE_ERROR_MISSION_ALREADY_CLAIMED);
    await add_ids(u, C.max, 3n);
    expect(code_of(await claim(u, M.max))).toBe(CODE.CORE_ERROR_MISSION_NOT_COMPLETED);
    await wait_background(s.server);
    const events = claimed_events(s);
    expect(events).toHaveLength(1);
    const params = events[0]?.params ?? [];
    expect(params.map((p) => ({ key: p.key, int_value: p.int_value }))).toEqual([{ key: 'mission_id', int_value: BigInt(M.other) }]);
  });

  it('records nothing for a user who has not allowed analytics, or for a failed claim', async () => {
    const s = await start({ settings: { 'consent.privacyChoices': true } });
    const u = await new_user(s);
    await add_ids(u, C.other, 5n);
    expect(code_of(await claim(u, M.other))).toBe(0);
    expect(code_of(await claim(u, M.other))).toBe(CODE.CORE_ERROR_MISSION_ALREADY_CLAIMED);
    await wait_background(s.server);
    expect(claimed_events(s)).toEqual([]);
  });
});
