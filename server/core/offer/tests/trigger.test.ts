import * as CoreContract from '../../../generated/contract/core_contract.ts';
import * as Testing from '../../testing/dev/index.ts';
import {
  GAME_ERROR,
  HOUR,
  MINUTE,
  START_TIME,
  UNKNOWN_OFFER_ID,
  at,
  by_id,
  consent,
  offer_id,
  request,
  set_offer,
  set_time,
  start,
  stop_all,
  stored,
  trigger,
  trigger_error_logs,
  triggered_events,
  user,
  view,
} from './helpers.ts';

afterEach(stop_all);

// `[offer_basic]`: duration 1h, cooldown 30m, max_triggers 3, no requirement, no active window.
const BASIC_DURATION = HOUR;
const BASIC_COOLDOWN = 30n * MINUTE;
// `[offer_locked]`: duration 1h, cooldown 10m, requirement Level(10).
const LOCKED_DURATION = HOUR;
const LOCKED_COOLDOWN = 10n * MINUTE;

describe('trigger_offer', () => {
  it('turns the offer on with OK, sends the row in the same response delta, and the offer is active until the end time', async () => {
    const s = await start();
    const u = await user(s);
    const id = offer_id('[offer_basic]');
    const result = await request(s, u, (ctx) => s.offer.trigger_offer(ctx, id));
    expect(result.value).toBe('OK');
    const row = { id: BigInt(id), started_at: START_TIME, trigger_count: 1, event_round: 0 };
    expect(result.delta).toEqual([row]);
    expect(await stored(s, u)).toEqual([row]);

    const ends_at = START_TIME + BASIC_DURATION;
    set_time(s, ends_at - 1n);
    expect(await view(s, u, id)).toEqual({ active: true, ends_at });
    set_time(s, ends_at);
    expect(await view(s, u, id)).toEqual({ active: false, ends_at });
  });

  it('returns UNKNOWN_OFFER with an error log for an ID value not in the offer table, and keeps the rows', async () => {
    const s = await start();
    const u = await user(s);
    const result = await request(s, u, (ctx) => s.offer.trigger_offer(ctx, UNKNOWN_OFFER_ID));
    expect(result.value).toBe('UNKNOWN_OFFER');
    expect(result.delta).toEqual([]);
    expect(await stored(s, u)).toEqual([]);
    const errors = trigger_error_logs(s);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatchObject({ level: 'error', user_id: String(u.user_id) });
  });

  it('returns false and 0 without a log from is_offer_active and get_offer_ends_at for an unknown offer', async () => {
    const s = await start();
    const u = await user(s);
    expect(await view(s, u, UNKNOWN_OFFER_ID)).toEqual({ active: false, ends_at: 0n });
    expect(trigger_error_logs(s)).toEqual([]);
  });

  it('returns UNAVAILABLE outside the active window of start_at and end_at, and keeps the rows', async () => {
    const s = await start();
    const u = await user(s);
    const id = offer_id('[offer_window]'); // start_at 2027-01-15T10:00:00Z, end_at 2027-01-15T12:00:00Z
    set_time(s, at('2027-01-15T10:00:00Z') - 1n);
    expect(await trigger(s, u, id)).toBe('UNAVAILABLE');
    expect(await stored(s, u)).toEqual([]);
    set_time(s, at('2027-01-15T12:00:00Z'));
    expect(await trigger(s, u, id)).toBe('UNAVAILABLE');
    expect(await stored(s, u)).toEqual([]);
    const v = await start();
    const w = await user(v);
    set_time(v, at('2027-01-15T10:00:00Z'));
    expect(await trigger(v, w, id)).toBe('OK');
  });

  it('returns ACTIVE while the offer is active and keeps the end time', async () => {
    const s = await start();
    const u = await user(s);
    const id = offer_id('[offer_basic]');
    expect(await trigger(s, u, id)).toBe('OK');
    const before = await stored(s, u);
    set_time(s, START_TIME + BASIC_DURATION - 1n);
    const result = await request(s, u, (ctx) => s.offer.trigger_offer(ctx, id));
    expect(result.value).toBe('ACTIVE');
    expect(result.delta).toEqual([]);
    expect(await stored(s, u)).toEqual(before);
    expect((await view(s, u, id)).ends_at).toBe(START_TIME + BASIC_DURATION);
  });

  it('returns COOLDOWN until the end time + cooldown, and OK at that time', async () => {
    const s = await start();
    const u = await user(s);
    const id = offer_id('[offer_basic]');
    expect(await trigger(s, u, id)).toBe('OK');
    const before = await stored(s, u);
    const ready_at = START_TIME + BASIC_DURATION + BASIC_COOLDOWN;
    set_time(s, ready_at - 1n);
    expect(await trigger(s, u, id)).toBe('COOLDOWN');
    expect(await stored(s, u)).toEqual(before);
    set_time(s, ready_at);
    expect(await trigger(s, u, id)).toBe('OK');
    expect(await stored(s, u)).toEqual([{ id: BigInt(id), started_at: ready_at, trigger_count: 2, event_round: 0 }]);
  });

  it('returns LIMIT_REACHED when trigger_count is max_triggers', async () => {
    const s = await start();
    const u = await user(s);
    const id = offer_id('[offer_basic]');
    let time = START_TIME;
    for (let count = 1; count <= 3; count += 1) {
      set_time(s, time);
      expect(await trigger(s, u, id)).toBe('OK');
      time += BASIC_DURATION + BASIC_COOLDOWN;
    }
    set_time(s, time);
    const before = await stored(s, u);
    expect(before).toEqual([{ id: BigInt(id), started_at: time - BASIC_DURATION - BASIC_COOLDOWN, trigger_count: 3, event_round: 0 }]);
    expect(await trigger(s, u, id)).toBe('LIMIT_REACHED');
    expect(await stored(s, u)).toEqual(before);
  });

  it('returns LOCKED when evaluate_requirement does not pass, and OK when it passes', async () => {
    const s = await start();
    const u = await user(s);
    const id = offer_id('[offer_locked]'); // requirement Level(10)
    s.judge = false;
    expect(await trigger(s, u, id)).toBe('LOCKED');
    expect(await stored(s, u)).toEqual([]);
    s.judge = true;
    expect(await trigger(s, u, id)).toBe('OK');
  });

  it('returns COOLDOWN, not LOCKED, inside the cooldown of an offer whose requirement does not pass', async () => {
    const s = await start();
    const u = await user(s);
    const id = offer_id('[offer_locked]');
    s.judge = true;
    expect(await trigger(s, u, id)).toBe('OK');
    const before = await stored(s, u);
    s.judge = false;
    set_time(s, START_TIME + LOCKED_DURATION);
    const result = await request(s, u, (ctx) => s.offer.trigger_offer(ctx, id));
    expect(result.value).toBe('COOLDOWN');
    expect(result.delta).toEqual([]);
    expect(await stored(s, u)).toEqual(before);
  });

  it('returns the element of the first step that holds', async () => {
    const s = await start();
    const u = await user(s);
    const basic = offer_id('[offer_basic]');
    const locked = offer_id('[offer_locked]');
    // active window before active: `[offer_window]` is outside its window even while its row is active.
    const window = offer_id('[offer_window]');
    await set_offer(s, u, window, START_TIME, 1);
    expect(await trigger(s, u, window)).toBe('UNAVAILABLE');
    // active before the limit: an active row at max_triggers.
    await set_offer(s, u, basic, START_TIME, 3);
    expect(await trigger(s, u, basic)).toBe('ACTIVE');
    // the limit before the cooldown: in the cooldown at max_triggers.
    set_time(s, START_TIME + BASIC_DURATION);
    expect(await trigger(s, u, basic)).toBe('LIMIT_REACHED');
    // the cooldown before the requirement: an ended row inside its cooldown whose requirement does not pass.
    s.judge = false;
    await set_offer(s, u, locked, START_TIME, 1);
    set_time(s, START_TIME + LOCKED_DURATION + LOCKED_COOLDOWN - 1n);
    expect(await trigger(s, u, locked)).toBe('COOLDOWN');
    // after the cooldown the same row reaches the requirement.
    set_time(s, START_TIME + LOCKED_DURATION + LOCKED_COOLDOWN);
    expect(await trigger(s, u, locked)).toBe('LOCKED');
    expect(await stored(s, u)).toEqual(by_id([
      { id: BigInt(basic), started_at: START_TIME, trigger_count: 3, event_round: 0 },
      { id: BigInt(window), started_at: START_TIME, trigger_count: 1, event_round: 0 },
      { id: BigInt(locked), started_at: START_TIME, trigger_count: 1, event_round: 0 },
    ]));
  });

  it('leaves no row when the handler ends with a GameError', async () => {
    const s = await start();
    const u = await user(s);
    const id = offer_id('[offer_basic]');
    let triggered: string | null = null;
    const result = await request(s, u, (ctx) => {
      triggered = s.offer.trigger_offer(ctx, id);
      return { failed: GAME_ERROR };
    });
    expect(triggered).toBe('OK');
    expect(result.code).toBe(GAME_ERROR);
    expect(result.delta).toEqual([]);
    expect(await stored(s, u)).toEqual([]);
    expect(await view(s, u, id)).toEqual({ active: false, ends_at: 0n });
    expect(await triggered_events(s)).toEqual([]);
  });
});

describe('max_triggers absent', () => {
  it('treats the int32 maximum as max_triggers: set_offer(…, 2^31−1) then trigger_offer gives LIMIT_REACHED and keeps the row', async () => {
    // `[shop_offer]`: duration 1h, cooldown 1m, no max_triggers, no requirement, no active window.
    const s = await start();
    const u = await user(s);
    const id = offer_id('[shop_offer]');
    const row = { id: BigInt(id), started_at: START_TIME - 2n * HOUR, trigger_count: 2 ** 31 - 1, event_round: 0 };
    await set_offer(s, u, id, row.started_at, row.trigger_count);
    const result = await request(s, u, (ctx) => s.offer.trigger_offer(ctx, id));
    expect(result.value).toBe('LIMIT_REACHED');
    expect(result.delta).toEqual([]);
    expect(await stored(s, u)).toEqual([row]);
    // One below the maximum still turns on.
    await set_offer(s, u, id, row.started_at, 2 ** 31 - 2);
    expect(await trigger(s, u, id)).toBe('OK');
    expect(await stored(s, u)).toEqual([{ ...row, started_at: START_TIME, trigger_count: 2 ** 31 - 1 }]);
  });
});

describe('get_offer_ends_at', () => {
  it('is 0 before the offer is ever turned on, and the last end time after the offer ends', async () => {
    const s = await start();
    const u = await user(s);
    const id = offer_id('[offer_basic]');
    expect(await view(s, u, id)).toEqual({ active: false, ends_at: 0n });
    expect(await trigger(s, u, id)).toBe('OK');
    set_time(s, START_TIME + 10n * HOUR);
    expect(await view(s, u, id)).toEqual({ active: false, ends_at: START_TIME + BASIC_DURATION });
  });
});

describe('core analytics event', () => {
  it('records core_offer_triggered for OK of a user who allowed analytics, and nothing for a user who did not', async () => {
    // With privacy choices, a user allows analytics only by granting it.
    const s = await start({ settings: { 'consent.privacyChoices': true } });
    const allowed = await user(s);
    expect((await Testing.send(allowed, 'core/UpdateConsent', consent(CoreContract.ConsentChoice.CONSENT_CHOICE_GRANTED))).envelope.error).toBeNull();
    const refused = await user(s);
    expect((await Testing.send(refused, 'core/UpdateConsent', consent(CoreContract.ConsentChoice.CONSENT_CHOICE_DENIED))).envelope.error).toBeNull();
    const id = offer_id('[offer_basic]');
    expect(await trigger(s, allowed, id)).toBe('OK');
    expect(await trigger(s, allowed, id)).toBe('ACTIVE');
    expect(await trigger(s, refused, id)).toBe('OK');
    const events = await triggered_events(s);
    expect(events).toHaveLength(1);
    expect(events[0]?.user_id).toBe(allowed.user_id);
    expect(events[0]?.params.map((p) => [p.key, p.kind, p.int_value])).toEqual([
      ['offer_id', CoreContract.AnalyticsParamKind.ANALYTICS_PARAM_KIND_INT, BigInt(id)],
      ['trigger_count', CoreContract.AnalyticsParamKind.ANALYTICS_PARAM_KIND_INT, 1n],
    ]);
  });
});
