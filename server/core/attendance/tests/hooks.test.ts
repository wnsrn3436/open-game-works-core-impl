import * as CoreContract from '../../../generated/contract/core_contract.ts';
import * as Testing from '../../testing/dev/index.ts';
import type { AttendanceClaimHook } from '../index.ts';
import {
  DAY_MS,
  E,
  HOUR_MS,
  REFUSED,
  START_AT,
  amount,
  at,
  balance,
  claim,
  delta_values,
  id_of,
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

describe('attendance hooks', () => {
  let env: Env | undefined;
  afterEach(async () => {
    await stop(env);
    env = undefined;
  });

  it('validate_attendance_claim gets the calendar and the next day, and its GameError fails the claim without changes', async () => {
    const calls: [number, number][] = [];
    let verdict: 'pass' | typeof REFUSED = REFUSED;
    env = await start({
      hooks: {
        validate_attendance_claim: (_ctx, calendar_id, day) => {
          calls.push([calendar_id, day]);
          return verdict;
        },
      },
    });
    const session = await user(env);
    const calendar = id_of('[attendance_cycle]');
    const refused = await claim(session, '[attendance_cycle]');
    expect(refused.code).toBe(REFUSED);
    expect(refused.response).toBeNull();
    expect(refused.envelope.item_changes).toEqual([]);
    expect(await progress(env, session)).toEqual([]);
    expect(await balance(env, session, GOLD)).toBe(0n);

    verdict = 'pass';
    const passed = await claim(session, '[attendance_cycle]');
    expect(passed.code).toBe(0);
    expect(calls).toEqual([
      [calendar, 1],
      [calendar, 1],
    ]);
    // The hook is not called for a claim that fails before step 5.
    expect((await claim(session, '[attendance_cycle]')).code).toBe(E.CORE_ERROR_ATTENDANCE_ALREADY_CLAIMED);
    expect(calls).toHaveLength(2);
  });

  it('rolls back the reward when grant_attendance_extra returns a GameError', async () => {
    // Day 2 of `[attendance_extra]` gives 10 gold and has extra_grant true.
    const calls: [number, number][] = [];
    let verdict: 'pass' | typeof REFUSED = REFUSED;
    env = await start({
      hooks: {
        grant_attendance_extra: (_ctx, calendar_id, day) => {
          calls.push([calendar_id, day]);
          return verdict;
        },
      },
    });
    const session = await user(env);
    const calendar = id_of('[attendance_extra]');
    expect((await claim(session, '[attendance_extra]')).code).toBe(0);
    expect(calls).toEqual([]);
    expect(await balance(env, session, GOLD)).toBe(10n);

    at(env, START_AT + DAY_MS);
    const refused = await claim(session, '[attendance_extra]');
    expect(refused.code).toBe(REFUSED);
    expect(refused.envelope.item_changes).toEqual([]);
    expect(calls).toEqual([[calendar, 2]]);
    expect(await balance(env, session, GOLD)).toBe(10n);
    expect(await progress_of(env, session, '[attendance_extra]')).toMatchObject({ day: 1 });

    verdict = 'pass';
    const passed = await claim(session, '[attendance_extra]');
    expect(passed.code).toBe(0);
    expect(ok(passed).day).toBe(2);
    expect(pairs(ok(passed).items)).toEqual(pairs([amount(GOLD, 10n)]));
    expect(calls).toEqual([
      [calendar, 2],
      [calendar, 2],
    ]);
    expect(await balance(env, session, GOLD)).toBe(20n);
    expect(await progress_of(env, session, '[attendance_extra]')).toMatchObject({ day: 2 });
  });

  it('answers INTERNAL and keeps progress and items when validate_attendance_claim returns a wrong output form', async () => {
    let output: unknown = 999;
    env = await start({ hooks: { validate_attendance_claim: () => output as ReturnType<AttendanceClaimHook> } });
    const session = await user(env);
    for (const value of [999, 0, -1, 1000.5, Number.NaN, 'refused', null, undefined, false, {}]) {
      output = value;
      const failed = await claim(session, '[attendance_cycle]');
      expect(failed.code).toBe(E.CORE_ERROR_INTERNAL);
      expect(failed.response).toBeNull();
      expect(failed.envelope.item_changes).toEqual([]);
      expect(await progress(env, session)).toEqual([]);
      expect(await balance(env, session, GOLD)).toBe(0n);
    }

    output = 'pass';
    const passed = await claim(session, '[attendance_cycle]');
    expect(passed.code).toBe(0);
    expect(ok(passed).day).toBe(1);
    expect(await balance(env, session, GOLD)).toBe(10n);
  });

  it('answers INTERNAL and rolls back the reward when grant_attendance_extra returns a wrong output form', async () => {
    // Day 2 of `[attendance_extra]` gives 10 gold and has extra_grant true.
    let output: unknown = 'pass';
    env = await start({ hooks: { grant_attendance_extra: () => output as ReturnType<AttendanceClaimHook> } });
    const session = await user(env);
    expect((await claim(session, '[attendance_extra]')).code).toBe(0);
    expect(await balance(env, session, GOLD)).toBe(10n);

    at(env, START_AT + DAY_MS);
    for (const value of [999, 'refused', null, {}]) {
      output = value;
      const failed = await claim(session, '[attendance_extra]');
      expect(failed.code).toBe(E.CORE_ERROR_INTERNAL);
      expect(failed.response).toBeNull();
      expect(failed.envelope.item_changes).toEqual([]);
      expect(await balance(env, session, GOLD)).toBe(10n);
      expect(await progress_of(env, session, '[attendance_extra]')).toMatchObject({ day: 1 });
    }

    output = 'pass';
    expect((await claim(session, '[attendance_extra]')).code).toBe(0);
    expect(await balance(env, session, GOLD)).toBe(20n);
    expect(await progress_of(env, session, '[attendance_extra]')).toMatchObject({ day: 2 });
  });

  it('calls on_attendance_claimed once per successful claim, with its changes in the same response delta', async () => {
    const calls: [number, number][] = [];
    env = await start({
      hooks: {
        on_attendance_claimed: (ctx, calendar_id, day, ledger) => {
          calls.push([calendar_id, day]);
          ledger.add_items(ctx, [amount(GEM, 1n)], { source: 0, ref: '', once_key: '' });
        },
      },
    });
    const session = await user(env);
    const calendar = id_of('[attendance_cycle]');
    const first = await claim(session, '[attendance_cycle]');
    expect(first.code).toBe(0);
    expect(calls).toEqual([[calendar, 1]]);
    const balances = delta_values(first.envelope.user_state, 'ItemBalanceUserState', (bytes) => CoreContract.ItemBalanceUserState.decode(bytes));
    expect(balances.map((row) => [row.id, row.amount]).sort()).toEqual(
      [
        [BigInt(id_of(GOLD)), 10n],
        [BigInt(id_of(GEM)), 1n],
      ].sort(),
    );
    const gem_change = first.envelope.item_changes.find((change) => change.item_id === id_of(GEM));
    expect(gem_change).toMatchObject({ delta: 1n, source: CoreContract.ItemChangeSource.ITEM_CHANGE_SOURCE_ATTENDANCE, ref: `${String(calendar)}:1` });

    // Failed claims do not call the hook.
    expect((await claim(session, '[attendance_cycle]')).code).toBe(E.CORE_ERROR_ATTENDANCE_ALREADY_CLAIMED);
    expect((await claim(session, '[attendance_locked]')).code).toBe(E.CORE_ERROR_ATTENDANCE_LOCKED);
    expect((await claim(session, '[attendance_window]')).code).toBe(E.CORE_ERROR_ATTENDANCE_UNAVAILABLE);
    expect(calls).toEqual([[calendar, 1]]);

    at(env, START_AT + DAY_MS);
    expect((await claim(session, '[attendance_cycle]')).code).toBe(0);
    expect(calls).toEqual([
      [calendar, 1],
      [calendar, 2],
    ]);
    expect(await balance(env, session, GEM)).toBe(2n);
  });

  it('answers INTERNAL and keeps progress and items when on_attendance_claimed throws', async () => {
    let fail = true;
    env = await start({
      hooks: {
        on_attendance_claimed: (ctx, _calendar_id, _day, ledger) => {
          ledger.add_items(ctx, [amount(GEM, 1n)], { source: 0, ref: '', once_key: '' });
          if (fail) throw new Error('core test hook failure');
        },
      },
    });
    const session = await user(env);
    const failed = await claim(session, '[attendance_cycle]');
    expect(failed.code).toBe(E.CORE_ERROR_INTERNAL);
    expect(failed.response).toBeNull();
    expect(await progress(env, session)).toEqual([]);
    expect(await balance(env, session, GOLD)).toBe(0n);
    expect(await balance(env, session, GEM)).toBe(0n);

    fail = false;
    const passed = await claim(session, '[attendance_cycle]');
    expect(passed.code).toBe(0);
    expect(ok(passed).day).toBe(1);
    expect(await balance(env, session, GOLD)).toBe(10n);
  });

  it('answers INTERNAL and keeps progress and items when on_attendance_claimed returns a value', async () => {
    let output: unknown = 'pass';
    env = await start({
      hooks: {
        on_attendance_claimed: (ctx, _calendar_id, _day, ledger) => {
          ledger.add_items(ctx, [amount(GEM, 1n)], { source: 0, ref: '', once_key: '' });
          return output;
        },
      },
    });
    const session = await user(env);
    for (const value of ['pass', REFUSED, 0, false, {}]) {
      output = value;
      const failed = await claim(session, '[attendance_cycle]');
      expect(failed.code).toBe(E.CORE_ERROR_INTERNAL);
      expect(failed.response).toBeNull();
      expect(failed.envelope.item_changes).toEqual([]);
      expect(await progress(env, session)).toEqual([]);
      expect(await balance(env, session, GOLD)).toBe(0n);
      expect(await balance(env, session, GEM)).toBe(0n);
    }

    output = null;
    const passed = await claim(session, '[attendance_cycle]');
    expect(passed.code).toBe(0);
    expect(ok(passed).day).toBe(1);
    expect(await balance(env, session, GOLD)).toBe(10n);
    expect(await balance(env, session, GEM)).toBe(1n);

    output = undefined;
    at(env, START_AT + DAY_MS);
    expect((await claim(session, '[attendance_cycle]')).code).toBe(0);
    expect(await balance(env, session, GEM)).toBe(2n);
  });
});

describe('core analytics event core_attendance_claimed', () => {
  let env: Env | undefined;
  afterEach(async () => {
    await stop(env);
    env = undefined;
  });

  function consent(analytics: CoreContract.ConsentChoice): CoreContract.UpdateConsentRequest {
    const request = new CoreContract.UpdateConsentRequest();
    request.privacy_version = 1;
    request.ad_personalization = CoreContract.ConsentChoice.CONSENT_CHOICE_DENIED;
    request.analytics = analytics;
    request.tracking = CoreContract.TrackingStatus.TRACKING_STATUS_NOT_APPLICABLE;
    return request;
  }

  /** The `core_attendance_claimed` server events of the user as `[calendar_id, day]`, in stored order. */
  async function events(server: Env['server'], user_id: bigint): Promise<[number, number][]> {
    const result = await Testing.send_admin(server, 'list_server_events', {
      user_id: String(user_id),
      name: 'core_attendance_claimed',
      from_at: String(START_AT - HOUR_MS),
      to_at: String(START_AT + 10n * DAY_MS),
      limit: 100,
    });
    expect(result.status).toBe(200);
    const entries = (result.json as { entries: { name: string; params: string }[] }).entries;
    return entries.map((entry) => {
      expect(entry.name).toBe('core_attendance_claimed');
      const event = CoreContract.AnalyticsEvent.decode(Buffer.from(entry.params, 'base64'));
      if (event === null) throw new Error('undecodable params');
      const params = new Map(event.params.map((param) => [param.key, param]));
      expect([...params.keys()]).toEqual(['calendar_id', 'day']);
      for (const param of params.values()) expect(param.kind).toBe(CoreContract.AnalyticsParamKind.ANALYTICS_PARAM_KIND_INT);
      return [Number(params.get('calendar_id')?.int_value), Number(params.get('day')?.int_value)];
    });
  }

  it('is left by a successful claim of a user who allowed analytics only', async () => {
    // With privacy choices, a user allows analytics only by granting it.
    env = await start({ settings: { 'consent.privacyChoices': true } });
    const allowed = await user(env);
    expect((await Testing.send(allowed, 'core/UpdateConsent', consent(CoreContract.ConsentChoice.CONSENT_CHOICE_GRANTED))).envelope.error).toBeNull();
    const denied = await user(env);
    expect((await Testing.send(denied, 'core/UpdateConsent', consent(CoreContract.ConsentChoice.CONSENT_CHOICE_DENIED))).envelope.error).toBeNull();

    for (const session of [allowed, denied]) {
      expect((await claim(session, '[attendance_cycle]')).code).toBe(0);
      expect((await claim(session, '[attendance_cycle]')).code).toBe(E.CORE_ERROR_ATTENDANCE_ALREADY_CLAIMED);
      expect((await claim(session, '[attendance_locked]')).code).toBe(E.CORE_ERROR_ATTENDANCE_LOCKED);
    }
    at(env, START_AT + DAY_MS);
    for (const session of [allowed, denied]) expect((await claim(session, '[attendance_cycle]')).code).toBe(0);

    const calendar = id_of('[attendance_cycle]');
    expect(await events(env.server, allowed.user_id)).toEqual([
      [calendar, 1],
      [calendar, 2],
    ]);
    expect(await events(env.server, denied.user_id)).toEqual([]);
  });
});
