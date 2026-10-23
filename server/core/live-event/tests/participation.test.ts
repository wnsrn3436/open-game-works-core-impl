/** `join_event` and `get_participation` of `live-event`. */
import * as T from '../../testing/dev/index.ts';
import { DAY, EVENT, GAME_ERROR, S, entries, id_of, start, stop_all } from './helpers.ts';

afterEach(async () => {
  await stop_all();
});

describe('participation', () => {
  it('answers NOT_ACTIVE for join_event of an event that is not active and saves nothing', async () => {
    const env = await start(S - 1n);
    const alice = await T.login(env.server, 'alice');
    const once = id_of(EVENT.once);
    expect(await env.run(alice, (ctx) => env.live.join_event(ctx, once))).toBe('NOT_ACTIVE');
    T.set_time(env.server, S + DAY);
    expect(await env.run(alice, (ctx) => env.live.join_event(ctx, once))).toBe('NOT_ACTIVE');
    expect(await entries(env, alice.user_id)).toEqual([]);
    expect(await env.run(alice, (ctx) => env.live.get_participation(ctx, once))).toEqual({ round: 0, settled: false });
  });

  it('answers UNKNOWN_EVENT for join_event of an event ID value not in live_event', async () => {
    const env = await start(S);
    const alice = await T.login(env.server, 'alice');
    expect(await env.run(alice, (ctx) => env.live.join_event(ctx, 987_654))).toBe('UNKNOWN_EVENT');
    expect(await entries(env, alice.user_id)).toEqual([]);
    expect(await env.run(alice, (ctx) => env.live.get_participation(ctx, 987_654))).toEqual({ round: 0, settled: false });
  });

  it('keeps one participation for two join_event calls in the same round', async () => {
    const env = await start(S);
    const alice = await T.login(env.server, 'alice');
    const weekly = id_of(EVENT.weekly);
    expect(await env.run(alice, (ctx) => env.live.join_event(ctx, weekly))).toBe('OK');
    T.advance_time(env.server, 1_000n);
    expect(await env.run(alice, (ctx) => env.live.join_event(ctx, weekly))).toBe('OK');
    const saved = await entries(env, alice.user_id);
    expect(saved.length).toBe(1);
    expect(saved[0]).toMatchObject({ id: BigInt(weekly), round: 1, joined_at: S, settled: false });
    expect(await env.run(alice, (ctx) => env.live.get_participation(ctx, weekly))).toEqual({ round: 1, settled: false });
  });

  it('answers NOT_SETTLED while the previous round is not settled, and replaces a settled previous round', async () => {
    const env = await start(S);
    const alice = await T.login(env.server, 'alice');
    const weekly = id_of(EVENT.weekly);
    expect(await env.run(alice, (ctx) => env.live.join_event(ctx, weekly))).toBe('OK');
    T.set_time(env.server, S + 7n * DAY);
    // The settlement of round 1 fails in request start, so round 1 stays not settled.
    env.settle.impl = () => GAME_ERROR;
    expect(await env.run(alice, (ctx) => env.live.join_event(ctx, weekly))).toBe('NOT_SETTLED');
    expect((await entries(env, alice.user_id)).map((e) => [e.round, e.settled])).toEqual([[1, false]]);
    env.settle.impl = null;
    expect(await env.run(alice, (ctx) => env.live.join_event(ctx, weekly))).toBe('OK');
    const saved = await entries(env, alice.user_id);
    expect(saved.length).toBe(1);
    expect(saved[0]).toMatchObject({ id: BigInt(weekly), round: 2, joined_at: S + 7n * DAY, settled: false });
  });
});
