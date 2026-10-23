/** Settlement of `live-event`: `on_request_start` and the hook `settle_live_event`. */
import * as CoreContract from '../../../generated/contract/core_contract.ts';
import * as CoreCheatContract from '../../../dev/generated/contract/core_cheat_contract.ts';
import * as GameContract from '../../../generated/contract/game_contract.ts';
import * as T from '../../testing/dev/index.ts';
import type { ItemLedgerContent } from '../../item-ledger/index.ts';
import { DAY, EVENT, GAME_ERROR, S, entries, envelope_entries, id_of, live_event_errors, put_entry, resync, start, stop_all } from './helpers.ts';

afterEach(async () => {
  await stop_all();
});

const UNKNOWN_EVENT = 987_654n;

function settled_of(list: readonly CoreContract.LiveEventEntryUserState[]): [bigint, number, boolean][] {
  return list.map((e) => [e.id, e.round, e.settled]);
}

describe('settlement', () => {
  it('settles an ended round once at the request start of the next request and carries the change in that response and in a login response', async () => {
    const env = await start(S);
    const alice = await T.login(env.server, 'alice');
    const bob = await T.login(env.server, 'bob');
    const once = BigInt(id_of(EVENT.once));
    for (const user of [alice, bob]) expect(await env.run(user, (ctx) => env.live.join_event(ctx, Number(once)))).toBe('OK');
    await resync(alice);
    expect(env.settle.calls).toEqual([]);
    T.set_time(env.server, S + DAY);
    const first = await resync(alice);
    expect(settled_of(envelope_entries(first))).toEqual([[once, 1, true]]);
    expect(env.settle.calls.map((c) => [c.event_id, c.round])).toEqual([[Number(once), 1]]);
    const second = await resync(alice);
    expect(envelope_entries(second)).toEqual([]);
    expect(env.settle.calls.length).toBe(1);

    const request = new CoreCheatContract.DevLoginRequest();
    request.account_name = 'bob';
    const { envelope } = await T.send_cheat(bob, 'core/cheat/DevLogin', request);
    expect(envelope.error).toBeNull();
    expect(settled_of(envelope_entries(envelope)).filter(([id]) => id === once)).toEqual([[once, 1, true]]);
    expect(env.settle.calls.length).toBe(2);
    expect(settled_of(await entries(env, bob.user_id))).toEqual([[once, 1, true]]);
  });

  it('calls settle_live_event in request start before the handler, whose get_participation is settled', async () => {
    const env = await start(S);
    const alice = await T.login(env.server, 'alice');
    const once = id_of(EVENT.once);
    expect(await env.run(alice, (ctx) => env.live.join_event(ctx, once))).toBe('OK');
    T.set_time(env.server, S + DAY);
    const order: string[] = [];
    env.settle.impl = () => {
      order.push('hook');
      return 'pass';
    };
    const { value, envelope } = await env.request(alice, (ctx) => {
      order.push('handler');
      return env.live.get_participation(ctx, once);
    });
    expect(order).toEqual(['hook', 'handler']);
    expect(value).toEqual({ round: 1, settled: true });
    expect(settled_of(envelope_entries(envelope))).toEqual([[BigInt(once), 1, true]]);
  });

  it('rolls back only the settlement when the hook returns a GameError, lets the request succeed and settles again at the next request', async () => {
    const env = await start(S);
    const alice = await T.login(env.server, 'alice');
    const once = BigInt(id_of(EVENT.once));
    expect(await env.run(alice, (ctx) => env.live.join_event(ctx, Number(once)))).toBe('OK');
    T.set_time(env.server, S + DAY);
    env.settle.impl = (ctx) => {
      const state = new GameContract.GuildTestUserState();
      state.changes = 9n;
      env.storage.put_state(ctx, state);
      return GAME_ERROR;
    };
    const errors = live_event_errors(env).length;
    const failed = await resync(alice);
    expect(failed.error).toBeNull();
    expect(envelope_entries(failed)).toEqual([]);
    expect(env.settle.calls.length).toBe(1);
    expect(live_event_errors(env).length).toBe(errors + 1);
    const state = await T.read_user_state(env.server, alice.user_id);
    expect(state.filter((e) => e.kind === 'GuildTestUserState')).toEqual([]);
    expect(settled_of(await entries(env, alice.user_id))).toEqual([[once, 1, false]]);

    env.settle.impl = null;
    const again = await resync(alice);
    expect(settled_of(envelope_entries(again))).toEqual([[once, 1, true]]);
    expect(env.settle.calls.length).toBe(2);
  });

  it('rolls back the settlement when the hook throws and still answers the request', async () => {
    const env = await start(S);
    const alice = await T.login(env.server, 'alice');
    const once = BigInt(id_of(EVENT.once));
    expect(await env.run(alice, (ctx) => env.live.join_event(ctx, Number(once)))).toBe('OK');
    T.set_time(env.server, S + DAY);
    env.settle.impl = () => {
      throw new Error('hook failure');
    };
    const errors = live_event_errors(env).length;
    expect((await resync(alice)).error).toBeNull();
    expect(live_event_errors(env).length).toBe(errors + 1);
    expect(settled_of(await entries(env, alice.user_id))).toEqual([[once, 1, false]]);
  });

  it('judges the hook output with storage.check_hook_output: a number under 1000 or another value is a wrong output form that rolls the settlement back', async () => {
    const env = await start(S);
    const alice = await T.login(env.server, 'alice');
    const once = BigInt(id_of(EVENT.once));
    expect(await env.run(alice, (ctx) => env.live.join_event(ctx, Number(once)))).toBe('OK');
    T.set_time(env.server, S + DAY);
    for (const output of [CoreContract.CoreError.CORE_ERROR_INTERNAL, 999, 'PASS', null]) {
      env.settle.impl = () => output as never;
      const errors = live_event_errors(env).length;
      expect((await resync(alice)).error).toBeNull();
      const added = live_event_errors(env).slice(errors).map((line) => String(line['message']));
      expect(added).toHaveLength(1);
      expect(added[0]).toContain('not pass or a GameError');
      expect(settled_of(await entries(env, alice.user_id))).toEqual([[once, 1, false]]);
    }
  });

  it('lists the participations once at request start and re-reads only the row of each later settlement', async () => {
    const env = await start(S);
    const alice = await T.login(env.server, 'alice');
    const events = [EVENT.once, EVENT.weekly, EVENT.daily, EVENT.no_settle].map((name) => id_of(name));
    for (const event_id of events) expect(await env.run(alice, (ctx) => env.live.join_event(ctx, event_id))).toBe('OK');
    await env.run(alice, (ctx) => {
      for (let i = 1n; i <= 5n; i++) {
        const entry = new CoreContract.LiveEventEntryUserState();
        entry.id = UNKNOWN_EVENT + i;
        entry.round = 1;
        entry.joined_at = S;
        entry.settled = true;
        put_entry(env.storage, ctx, entry);
      }
      return null;
    });
    T.set_time(env.server, S + DAY);
    const is_entry = (kind: unknown): boolean => kind === CoreContract.LiveEventEntryUserState;
    const list = vi.spyOn(env.storage, 'list_state');
    const get = vi.spyOn(env.storage, 'get_state');
    let listed: number[];
    let got: number;
    try {
      await resync(alice);
      listed = list.mock.calls.flatMap(([, kind], i) => (is_entry(kind) ? [(list.mock.results[i]?.value as unknown[]).length] : []));
      got = get.mock.calls.filter(([, kind]) => is_entry(kind)).length;
    } finally {
      list.mockRestore();
      get.mockRestore();
    }
    expect(listed).toEqual([9]);
    expect(got).toBe(3);
    expect(env.settle.calls.map((c) => c.event_id)).toEqual(events.slice(0, 3).sort((a, b) => a - b));
    const after = await entries(env, alice.user_id);
    expect(after.filter((e) => !e.settled)).toEqual([]);
  });

  it('settles an event whose settle is false without the hook', async () => {
    const env = await start(S);
    const alice = await T.login(env.server, 'alice');
    const no_settle = BigInt(id_of(EVENT.no_settle));
    expect(await env.run(alice, (ctx) => env.live.join_event(ctx, Number(no_settle)))).toBe('OK');
    T.set_time(env.server, S + DAY);
    const envelope = await resync(alice);
    expect(settled_of(envelope_entries(envelope))).toEqual([[no_settle, 1, true]]);
    expect(env.settle.calls).toEqual([]);
  });

  it('settles a participation of an event not in live_event without the hook and with one error log', async () => {
    const env = await start(S);
    const alice = await T.login(env.server, 'alice');
    await env.run(alice, (ctx) => {
      const entry = new CoreContract.LiveEventEntryUserState();
      entry.id = UNKNOWN_EVENT;
      entry.round = 1;
      entry.joined_at = S;
      entry.settled = false;
      put_entry(env.storage, ctx, entry);
      return null;
    });
    const errors = live_event_errors(env).length;
    const envelope = await resync(alice);
    expect(settled_of(envelope_entries(envelope))).toEqual([[UNKNOWN_EVENT, 1, true]]);
    expect(env.settle.calls).toEqual([]);
    expect(live_event_errors(env).length).toBe(errors + 1);
    await resync(alice);
    expect(live_event_errors(env).length).toBe(errors + 1);
  });

  it('follows the request time moved by the cheat time offset for the active check and the settlement', async () => {
    const env = await start(S - DAY);
    const alice = await T.login(env.server, 'alice');
    const once = BigInt(id_of(EVENT.once));
    const offset = async (ms: bigint): Promise<void> => {
      const request = new CoreCheatContract.SetTimeOffsetRequest();
      request.offset_ms = ms;
      const { envelope } = await T.send_cheat(alice, 'core/cheat/SetTimeOffset', request);
      expect(envelope.error).toBeNull();
    };
    expect(await env.run(alice, (ctx) => env.live.is_active(ctx, Number(once)))).toBe(false);
    await offset(DAY);
    expect(await env.run(alice, (ctx) => env.live.is_active(ctx, Number(once)))).toBe(true);
    expect(await env.run(alice, (ctx) => env.live.join_event(ctx, Number(once)))).toBe('OK');
    await resync(alice);
    expect(env.settle.calls).toEqual([]);
    await offset(2n * DAY);
    const envelope = await resync(alice);
    expect(settled_of(envelope_entries(envelope))).toEqual([[once, 1, true]]);
    expect(env.settle.calls.length).toBe(1);
  });

  it('records the ItemChange of an item settle_live_event grants with source LiveEvent and ref <event ID value>:<round>', async () => {
    const env = await start(S);
    const alice = await T.login(env.server, 'alice');
    const weekly = id_of(EVENT.weekly);
    const gold = id_of('[gold]');
    const ledger = env.core['item-ledger'] as ItemLedgerContent;
    env.settle.impl = (ctx) => {
      const item = new CoreContract.ItemAmount();
      item.item_id = gold;
      item.amount = 10n;
      const result = ledger.add_items(ctx, [item]);
      return result === 'OK' ? 'pass' : GAME_ERROR;
    };
    expect(await env.run(alice, (ctx) => env.live.join_event(ctx, weekly))).toBe('OK');
    T.set_time(env.server, S + 7n * DAY);
    const envelope = await resync(alice);
    const ref = `${String(weekly)}:1`;
    expect(env.settle.calls).toEqual([{ event_id: weekly, round: 1, hook_change_source: { source: CoreContract.ItemChangeSource.ITEM_CHANGE_SOURCE_LIVE_EVENT, ref } }]);
    expect(envelope.item_changes.map((c) => [c.item_id, c.delta, c.source, c.ref])).toEqual([[gold, 10n, CoreContract.ItemChangeSource.ITEM_CHANGE_SOURCE_LIVE_EVENT, ref]]);
  });
});
