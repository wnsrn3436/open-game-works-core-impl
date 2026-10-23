/** Schedule, active window and round queries of `live-event`. */
import * as T from '../../testing/dev/index.ts';
import { DAY, EVENT, HOUR, S, SILENT_MARGIN_MS, id_of, in_transaction, live_event_errors, round, start, stop_all, type Env } from './helpers.ts';

afterEach(async () => {
  await stop_all();
});

function user(env: Env): Promise<T.TestSession> {
  return T.login(env.server, 'alice');
}

describe('schedule', () => {
  it('makes an event without repeat active at start_at and not active at end_at', async () => {
    const env = await start();
    const alice = await user(env);
    const once = id_of(EVENT.once);
    const active = async (at: bigint): Promise<boolean> => {
      T.set_time(env.server, at);
      return env.run(alice, (ctx) => env.live.is_active(ctx, once));
    };
    expect(await active(S - 1n)).toBe(false);
    expect(await active(S)).toBe(true);
    expect(await active(S + DAY - 1n)).toBe(true);
    expect(await active(S + DAY)).toBe(false);
    T.set_time(env.server, S);
    const events = await env.run(alice, (ctx) => env.live.get_active_events(ctx));
    expect(events).toContainEqual({ event_id: once, ...round(1, S, S + DAY) });
    const ids = events.map((e) => e.event_id);
    expect(ids).toEqual([...ids].sort((a, b) => a - b));
  });

  it('gives a silent request within server-time.silentMarginMs of the start the round, and a request without silent round 0', async () => {
    const env = await start();
    const alice = await user(env);
    const weekly = id_of(EVENT.weekly);
    const get = (silent: boolean) => in_transaction(env, alice.user_id, (ctx) => env.live.get_round(ctx, weekly), silent);
    T.set_time(env.server, S - (SILENT_MARGIN_MS - 1n));
    expect(await get(true)).toEqual(round(1, S, S + DAY));
    expect(await get(false)).toEqual(round(0, S, S + DAY));
    T.set_time(env.server, S + DAY - 1n);
    expect(await get(true)).toEqual(round(1, S, S + DAY));
    expect(await get(false)).toEqual(round(1, S, S + DAY));
    T.set_time(env.server, S + DAY);
    expect(await get(true)).toEqual(round(0, S + 7n * DAY, S + 8n * DAY));
    expect(await get(false)).toEqual(round(0, S + 7n * DAY, S + 8n * DAY));
  });

  it('answers is_in_active_window by start_at, end_at and live_event', async () => {
    const env = await start();
    const alice = await user(env);
    const window = (at: bigint, start_at: bigint | null, end_at: bigint | null, live_event: number | null) => {
      T.set_time(env.server, at);
      return env.run(alice, (ctx) => env.live.is_in_active_window(ctx, start_at, end_at, live_event));
    };
    const end = S + DAY;
    expect(await window(S - 1n, S, end, null)).toBe(false);
    expect(await window(S, S, end, null)).toBe(true);
    expect(await window(end - 1n, S, end, null)).toBe(true);
    expect(await window(end, S, end, null)).toBe(false);
    // live_event_no_settle has ended at S + 1 day.
    expect(await window(S + 2n * DAY, null, null, id_of(EVENT.no_settle))).toBe(false);
    expect(await window(S + 2n * DAY, null, null, null)).toBe(true);
    expect(await window(S, null, null, id_of(EVENT.no_settle))).toBe(true);
  });

  it('numbers the rounds of a repeated event and their times at the boundaries, with no round after repeat_until', async () => {
    const env = await start();
    const alice = await user(env);
    const weekly = id_of(EVENT.weekly);
    const at = (time: bigint) => {
      T.set_time(env.server, time);
      return env.run(alice, (ctx) => env.live.get_round(ctx, weekly));
    };
    expect(await at(S + 7n * DAY - 1n)).toEqual(round(0, S + 7n * DAY, S + 8n * DAY));
    expect(await at(S + 7n * DAY)).toEqual(round(2, S + 7n * DAY, S + 8n * DAY));
    expect(await at(S + 8n * DAY - 1n)).toEqual(round(2, S + 7n * DAY, S + 8n * DAY));
    expect(await at(S + 8n * DAY)).toEqual(round(0, S + 14n * DAY, S + 15n * DAY));
    expect(await at(S + 14n * DAY)).toEqual(round(3, S + 14n * DAY, S + 15n * DAY));
    expect(await at(S + 15n * DAY)).toEqual(round(0, 0n, 0n));
    expect(await at(S + 21n * DAY)).toEqual(round(0, 0n, 0n));
    expect(await at(S + 28n * DAY)).toEqual(round(0, 0n, 0n));
    const daily = id_of(EVENT.daily);
    T.set_time(env.server, S + 1000n * DAY + HOUR);
    expect(await env.run(alice, (ctx) => env.live.get_round(ctx, daily))).toEqual(round(1001, S + 1000n * DAY, S + 1000n * DAY + 12n * HOUR));
  });

  it('matches every case of the core test fixture live-event-round', async () => {
    const env = await start();
    const alice = await user(env);
    const fixture = JSON.parse(new TextDecoder().decode(T.read_core_fixture('live-event-round'))) as {
      cases: { name: string; input: { event: string; time: number }; expected: { round: number; start_at: number; end_at: number } }[];
    };
    expect(fixture.cases.length).toBeGreaterThan(0);
    for (const c of fixture.cases) {
      T.set_time(env.server, BigInt(c.input.time));
      const got = await env.run(alice, (ctx) => env.live.get_round(ctx, id_of(c.input.event)));
      expect({ name: c.name, ...got }).toEqual({ name: c.name, ...round(c.expected.round, BigInt(c.expected.start_at), BigInt(c.expected.end_at)) });
    }
  });

  it('answers (0, 0, 0) with one error log for get_round of an event ID value not in live_event', async () => {
    const env = await start(S);
    const alice = await user(env);
    const before = live_event_errors(env).length;
    expect(await env.run(alice, (ctx) => env.live.get_round(ctx, 987_654))).toEqual(round(0, 0n, 0n));
    expect(live_event_errors(env).length).toBe(before + 1);
    expect(await env.run(alice, (ctx) => env.live.is_active(ctx, 987_654))).toBe(false);
    expect(env.live.get_latest_round(987_654, S)).toEqual(round(0, 0n, 0n));
  });

  it('answers round_to_write and is_round_reset of an event not in live_event with the get_round result and its error log', async () => {
    const env = await start(S);
    const alice = await user(env);
    const messages = () => live_event_errors(env).map((line) => String(line['message']));
    const before = messages().length;
    await env.run(alice, (ctx) => env.live.get_round(ctx, 987_654));
    const get_round_log = messages().slice(before);
    expect(get_round_log).toHaveLength(1);
    expect(await env.run(alice, (ctx) => env.live.round_to_write(ctx, 987_654))).toBe(0);
    expect(await env.run(alice, (ctx) => env.live.is_round_reset(ctx, 987_654, 1))).toBe(false);
    expect(messages().slice(before + 1)).toEqual([get_round_log[0], get_round_log[0]]);
  });

  it('answers round_to_write and is_round_reset by the round reset rule', async () => {
    const env = await start();
    const alice = await user(env);
    const weekly = id_of(EVENT.weekly);
    const at = (time: bigint) => {
      T.set_time(env.server, time);
      return env.run(alice, (ctx) => ({
        write: env.live.round_to_write(ctx, weekly),
        none: env.live.round_to_write(ctx, 0),
        none_null: env.live.round_to_write(ctx, null),
        reset_none: env.live.is_round_reset(ctx, 0, 1),
        reset_same: env.live.is_round_reset(ctx, weekly, 1),
        reset_other: env.live.is_round_reset(ctx, weekly, 2),
      }));
    };
    expect(await at(S)).toEqual({ write: 1, none: 0, none_null: 0, reset_none: false, reset_same: false, reset_other: true });
    expect(await at(S + DAY)).toEqual({ write: 0, none: 0, none_null: 0, reset_none: false, reset_same: false, reset_other: false });
    expect(await at(S + 7n * DAY)).toEqual({ write: 2, none: 0, none_null: 0, reset_none: false, reset_same: true, reset_other: false });
  });

  it('answers get_latest_round from the given time, ended rounds included', async () => {
    const env = await start();
    const weekly = id_of(EVENT.weekly);
    const latest = (time: bigint) => env.live.get_latest_round(weekly, time);
    expect(latest(S - 1n)).toEqual(round(0, 0n, 0n));
    expect(latest(S)).toEqual(round(1, S, S + DAY));
    expect(latest(S + DAY)).toEqual(round(1, S, S + DAY));
    expect(latest(S + 7n * DAY - 1n)).toEqual(round(1, S, S + DAY));
    expect(latest(S + 7n * DAY)).toEqual(round(2, S + 7n * DAY, S + 8n * DAY));
    expect(latest(S + 22n * DAY)).toEqual(round(3, S + 14n * DAY, S + 15n * DAY));
    expect(env.live.get_latest_round(id_of(EVENT.once), S + 100n * DAY)).toEqual(round(1, S, S + DAY));
  });
});
