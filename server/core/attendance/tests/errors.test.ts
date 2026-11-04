import * as CoreContract from '../../../generated/contract/core_contract.ts';
import * as Testing from '../../testing/dev/index.ts';
import type { GrantOrMailOutcome } from '../../mailbox/index.ts';
import {
  DAY0,
  DAY_MS,
  E,
  HOUR_MS,
  REFUSED,
  START_AT,
  amount,
  at,
  balance,
  claim,
  day_number,
  id_of,
  mailbox_module,
  mails,
  ok,
  pairs,
  progress,
  progress_of,
  start,
  stop,
  user,
  type Env,
} from './helpers.ts';

const GOLD = '[attendance_gold]';
const GEM = '[attendance_gem]';

describe('ClaimAttendance failures', () => {
  let env: Env | undefined;
  afterEach(async () => {
    await stop(env);
    env = undefined;
  });

  it('answers ATTENDANCE_UNAVAILABLE outside the active window and keeps progress and balance', async () => {
    // `[attendance_window]`: start_at DAY0 + 1 day, end_at DAY0 + 2 days.
    env = await start();
    const session = await user(env);
    for (const time of [START_AT, DAY0 + DAY_MS - 1n, DAY0 + 2n * DAY_MS, DAY0 + 5n * DAY_MS]) {
      at(env, time);
      const result = await claim(session, '[attendance_window]');
      expect(result.code).toBe(E.CORE_ERROR_ATTENDANCE_UNAVAILABLE);
      expect(result.response).toBeNull();
      expect(result.envelope.item_changes).toEqual([]);
    }
    expect(await progress(env, session)).toEqual([]);
    expect(await balance(env, session, GOLD)).toBe(0n);
  });

  it('claims inside the active window', async () => {
    env = await start();
    const session = await user(env);
    at(env, DAY0 + DAY_MS);
    const result = await claim(session, '[attendance_window]');
    expect(result.code).toBe(0);
    expect(ok(result).day).toBe(1);
    expect(await balance(env, session, GOLD)).toBe(10n);
  });

  it('answers ATTENDANCE_LOCKED when evaluate_requirement does not pass and keeps progress and balance', async () => {
    // `[attendance_locked]` requires FlagA(), whose judge returns false.
    env = await start();
    const session = await user(env);
    const result = await claim(session, '[attendance_locked]');
    expect(result.code).toBe(E.CORE_ERROR_ATTENDANCE_LOCKED);
    expect(result.response).toBeNull();
    expect(result.envelope.item_changes).toEqual([]);
    expect(await progress(env, session)).toEqual([]);
    expect(await balance(env, session, GOLD)).toBe(0n);
  });

  it('answers INTERNAL and keeps progress and balance when grant_or_mail returns a failure value', async () => {
    env = await start();
    const session = await user(env);
    const mailbox = mailbox_module(env);
    const grant_or_mail = mailbox.grant_or_mail.bind(mailbox);
    const failures: GrantOrMailOutcome['result'][] = ['UNKNOWN_ITEM', 'INVALID_AMOUNT', 'UNSUPPORTED_ITEM', 'INVALID_INPUT'];
    for (const failure of failures) {
      // The real grant runs first, so the unchanged balance shows the failure rolls the grant back.
      let real: GrantOrMailOutcome | null = null;
      const spy = vi.spyOn(mailbox, 'grant_or_mail').mockImplementationOnce((...args) => {
        real = grant_or_mail(...args);
        return { result: failure } as GrantOrMailOutcome;
      });
      const failed = await claim(session, '[attendance_cycle]');
      expect(spy).toHaveBeenCalledTimes(1);
      spy.mockRestore();
      expect(real).toEqual({ result: 'Granted' });
      expect(failed.code).toBe(E.CORE_ERROR_INTERNAL);
      expect(failed.response).toBeNull();
      expect(failed.envelope.item_changes).toEqual([]);
      expect(await progress(env, session)).toEqual([]);
      expect(await balance(env, session, GOLD)).toBe(0n);
      expect(await mails(env, session)).toEqual([]);
    }

    const passed = await claim(session, '[attendance_cycle]');
    expect(ok(passed).day).toBe(1);
    expect(await balance(env, session, GOLD)).toBe(10n);
  });

  it('mails a reward over max_amount as [attendance_reward_mail] and saves the progress', async () => {
    // `[attendance_gem_daily]` gives 4 `[attendance_gem]` a day; its max_amount is 5 and its overflow Reject.
    env = await start();
    const session = await user(env);
    expect((await claim(session, '[attendance_gem_daily]')).code).toBe(0);
    expect(await balance(env, session, GEM)).toBe(4n);

    const next = START_AT + DAY_MS;
    at(env, next);
    const result = await claim(session, '[attendance_gem_daily]');
    expect(result.code).toBe(0);
    expect(ok(result).day).toBe(1);
    expect(ok(result).mailed).toBe(true);
    expect(ok(result).items).toEqual([]);
    expect(result.envelope.item_changes).toEqual([]);
    const calendar = id_of('[attendance_gem_daily]');
    const [item_mail] = result.envelope.item_mails;
    expect(result.envelope.item_mails).toHaveLength(1);
    expect(item_mail).toMatchObject({ source: CoreContract.ItemChangeSource.ITEM_CHANGE_SOURCE_ATTENDANCE, ref: `${String(calendar)}:1` });
    expect(pairs(item_mail?.items ?? [])).toEqual(pairs([amount(GEM, 4n)]));

    const template = Testing.load_data().data.ReservedId.attendance_reward_mail();
    const sent = await mails(env, session);
    expect(sent).toHaveLength(1);
    expect(sent[0]?.template_id).toBe(template);
    expect(sent[0]?.id).toBe(item_mail?.mail_id);
    expect(pairs(sent[0]?.attachments ?? [])).toEqual(pairs([amount(GEM, 4n)]));
    expect(await balance(env, session, GEM)).toBe(4n);
    expect(await progress_of(env, session, '[attendance_gem_daily]')).toMatchObject({ day: 1, claimed_day_number: day_number(env, next) });
  });

  it('mails a reward an item-ledger validation hook refused and saves the progress', async () => {
    env = await start({ hooks: { validate_item_change: () => REFUSED } });
    const session = await user(env);
    const result = await claim(session, '[attendance_cycle]');
    expect(result.code).toBe(0);
    expect(ok(result).mailed).toBe(true);
    expect(ok(result).items).toEqual([]);
    const sent = await mails(env, session);
    expect(sent).toHaveLength(1);
    expect(pairs(sent[0]?.attachments ?? [])).toEqual(pairs([amount(GOLD, 10n)]));
    expect(await balance(env, session, GOLD)).toBe(0n);
    expect(await progress_of(env, session, '[attendance_cycle]')).toMatchObject({ day: 1, claimed_day_number: day_number(env, START_AT) });

    // The next game day's claim mails again, under its own once_key.
    at(env, START_AT + DAY_MS + HOUR_MS);
    const next = await claim(session, '[attendance_cycle]');
    expect(next.response).toMatchObject({ day: 2, mailed: true });
    expect(await mails(env, session)).toHaveLength(2);
  });
});
