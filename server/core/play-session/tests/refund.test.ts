import * as CoreContract from '../../../generated/contract/core_contract.ts';
import { read_user_state, set_time, type TestSession } from '../../testing/dev/index.ts';
import {
  CoreError,
  GOLD,
  INSTANT,
  TIMED,
  amount,
  continue_session,
  finish,
  harness,
  item_ledger,
  opened,
  play_session,
  player,
  start,
  stop_all,
  type Harness,
} from './helpers.ts';

const SOURCE = CoreContract.ItemChangeSource;

afterEach(async () => {
  await stop_all();
});

async function gold_balance(h: Harness, s: TestSession): Promise<bigint> {
  const gold = h.id(GOLD);
  const state = (await read_user_state(h.server, s.user_id)).find((e) => e.kind === 'ItemBalanceUserState' && e.item_id === BigInt(gold));
  if (state === undefined) return 0n;
  return (state.value as { amount: bigint }).amount;
}

describe('refund_entry', () => {
  it('adds the items inside apply_play_session with source PlaySessionRefund and ref play_session_id, and a second refund is ALREADY_APPLIED', async () => {
    const results: unknown[] = [];
    let gold = 0;
    const h = await harness({
      apply: (core, ctx, record) => {
        results.push(play_session(core).refund_entry(ctx, record, [amount(gold, 7n)]));
        results.push(play_session(core).refund_entry(ctx, record, [amount(gold, 7n)]));
        return 'pass';
      },
    });
    gold = h.id(GOLD);
    const s = await player(h);
    const started = await opened(s, h.id(INSTANT));
    const out = await finish(s, started.play_session_id);
    expect(out.code).toBe(0);
    expect(results).toEqual(['OK', 'ALREADY_APPLIED']);
    expect(await gold_balance(h, s)).toBe(7n);
    const changes = out.envelope.item_changes;
    expect(changes.length).toBe(1);
    expect(changes[0]?.item_id).toBe(gold);
    expect(changes[0]?.delta).toBe(7n);
    expect(changes[0]?.source).toBe(SOURCE.ITEM_CHANGE_SOURCE_PLAY_SESSION_REFUND);
    expect(changes[0]?.ref).toBe(started.play_session_id);
  });

  it('throws outside of apply_play_session and the request is INTERNAL', async () => {
    let gold = 0;
    const h = await harness({
      prepare: (core, ctx, mode_id, level_id) => {
        if (level_id === 1) {
          const record = { play_session_id: crypto.randomUUID(), mode_id, level_id, started_at: ctx.request_time, options: new Uint8Array(0), loadout: new Uint8Array(0), continues: [], finished_at: 0n };
          play_session(core).refund_entry(ctx, record, [amount(gold, 1n)]);
        }
        return new Uint8Array(0);
      },
      continue: (core, ctx, record) => {
        play_session(core).refund_entry(ctx, record, [amount(gold, 1n)]);
        return 'pass';
      },
      verify: (core, ctx, record) => {
        play_session(core).refund_entry(ctx, record, [amount(gold, 1n)]);
        return 'pass';
      },
    });
    gold = h.id(GOLD);
    const s = await player(h);
    expect((await start(s, h.id(TIMED), new Uint8Array(0), 1)).code).toBe(CoreError.CORE_ERROR_INTERNAL);
    const started = await opened(s, h.id(INSTANT));
    expect((await finish(s, started.play_session_id)).code).toBe(CoreError.CORE_ERROR_INTERNAL);
    const timed = await opened(s, h.id(TIMED));
    expect((await continue_session(s, timed.play_session_id)).code).toBe(CoreError.CORE_ERROR_INTERNAL);
    expect(await gold_balance(h, s)).toBe(0n);
  });
});

describe('change source of the hooks', () => {
  it('records PlaySession with ref play_session_id for content item changes in prepare, continue and apply, and PlaySessionRefund for refund_entry', async () => {
    let gold = 0;
    const h = await harness({
      prepare: (core, ctx) => {
        expect(item_ledger(core).add_items(ctx, [amount(gold, 10n)], {})).toBe('OK');
        expect(item_ledger(core).subtract_items(ctx, [amount(gold, 2n)], {})).toBe('OK');
        return new Uint8Array(0);
      },
      continue: (core, ctx) => {
        expect(item_ledger(core).subtract_items(ctx, [amount(gold, 3n)], {})).toBe('OK');
        return 'pass';
      },
      apply: (core, ctx, record) => {
        expect(item_ledger(core).add_items(ctx, [amount(gold, 5n)], {})).toBe('OK');
        expect(play_session(core).refund_entry(ctx, record, [amount(gold, 2n)])).toBe('OK');
        return 'pass';
      },
    });
    gold = h.id(GOLD);
    const s = await player(h);
    const out = await start(s, h.id(TIMED));
    const started = out.response;
    if (started === null) throw new Error(`StartPlaySession failed with ${String(out.code)}`);
    const id = started.play_session_id;
    expect(out.envelope.item_changes.map((c) => [c.source, c.ref, c.delta])).toEqual([
      [SOURCE.ITEM_CHANGE_SOURCE_PLAY_SESSION, id, 10n],
      [SOURCE.ITEM_CHANGE_SOURCE_PLAY_SESSION, id, -2n],
    ]);
    const cont = await continue_session(s, id);
    expect(cont.envelope.item_changes.map((c) => [c.source, c.ref, c.delta])).toEqual([[SOURCE.ITEM_CHANGE_SOURCE_PLAY_SESSION, id, -3n]]);
    set_time(h.server, started.started_at + h.data.PlaySessionModeTable.get_row(h.id(TIMED)).min_duration);
    const done = await finish(s, id);
    expect(done.envelope.item_changes.map((c) => [c.source, c.ref, c.delta])).toEqual([
      [SOURCE.ITEM_CHANGE_SOURCE_PLAY_SESSION, id, 5n],
      [SOURCE.ITEM_CHANGE_SOURCE_PLAY_SESSION_REFUND, id, 2n],
    ]);
    expect(await gold_balance(h, s)).toBe(12n);
  });
});
