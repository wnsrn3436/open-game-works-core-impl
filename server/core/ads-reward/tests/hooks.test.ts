import * as CoreContract from '../../../generated/contract/core_contract.ts';
import * as GameContract from '../../../generated/contract/game_contract.ts';
import * as GameData from '../../../generated/data/game_data.ts';
import type { RequestCtx } from '../../storage/request_ctx.ts';
import {
  amounts,
  BASIC,
  balance,
  balance_entry,
  begin,
  claim,
  data_with_placements,
  drive,
  error_of,
  GEM,
  hooks,
  item,
  notify_of,
  placement,
  reward_count,
  signed,
  start,
  T,
  T0,
  user,
} from './helpers.ts';

const { CoreError, ItemChangeSource } = CoreContract;

/** A Rewarded placement with `extra_grant` and a reward, after every ID value of the core test data. */
const EXTRA_ID = 900_001;
const extra_folder = (): string =>
  data_with_placements([placement({ id: EXTRA_ID, type: GameData.AdType.Rewarded, reward: [item(GEM(), 3n)], extra_grant: true })]);

interface ItemLedgerContent {
  add_items(ctx: RequestCtx, items: CoreContract.ItemAmount[], source: { source?: number; ref?: string; once_key?: string }): unknown;
}

describe('ads-reward hooks', () => {
  it('does not start when an ad_placement row has extra_grant and grant_ad_extra is not registered, and starts without such a row', async () => {
    const failed = await T.start_test_server(T0, undefined, undefined, undefined, undefined, { 'environments.<ENV>.adapters.ads': 'fake' }, hooks({}), undefined, undefined, extra_folder()).then(
      () => null,
      (error: unknown) => error as Error & { logs?: { level: string; message: string }[] },
    );
    expect(failed?.message).toMatch(/grant_ad_extra/);
    expect(failed?.logs?.some((l) => l.level === 'error' && l.message.includes('grant_ad_extra'))).toBe(true);
    const plain = await start();
    await T.stop_test_server(plain.server);
  });

  it('fails BeginAdReward with CORE_ERROR_INTERNAL and an error log when validate_ad_reward returns neither pass nor a GameError', async () => {
    for (const output of [999, 'ok', null]) {
      const s = await start({}, hooks({ validate_ad_reward: () => output }));
      try {
        const session = await user(s.server);
        expect(error_of(await begin(session, BASIC()))).toBe(CoreError.CORE_ERROR_INTERNAL);
        expect(T.read_logs(s.server, 'error', 'error').some((l) => JSON.stringify(l).includes('hook validate_ad_reward returned'))).toBe(true);
      } finally {
        await T.stop_test_server(s.server);
      }
    }
  });

  it('fails the callback with HTTP 500 and an error log, granting nothing, when grant_ad_extra returns neither pass nor a GameError', async () => {
    const s = await start({}, hooks({ grant_ad_extra: () => 'ok' }), extra_folder());
    try {
      const session = await user(s.server);
      const notify_id = await notify_of(session, EXTRA_ID);
      expect((await signed(s, notify_id, session.user_id)).status).toBe(500);
      expect(await balance(s.server, session.user_id, GEM())).toBe(0n);
      expect(await reward_count(s.server, session.user_id, EXTRA_ID)).toBeNull();
      expect(error_of(await drive(s.server, claim(session, notify_id)))).toBe(CoreError.CORE_ERROR_AD_REWARD_PENDING);
      expect(T.read_logs(s.server, 'error', 'error').some((l) => JSON.stringify(l).includes('hook grant_ad_extra returned'))).toBe(true);
    } finally {
      await T.stop_test_server(s.server);
    }
  });

  it('keeps item and the grant count when grant_ad_extra fails, leaves the ticket Failed, and does not process the reward notify ID again', async () => {
    let rewarded = 0;
    const s = await start(
      {},
      hooks({
        grant_ad_extra: () => GameContract.GameError.GAME_ERROR_CORE_TEST,
        on_ad_rewarded: () => {
          rewarded += 1;
        },
      }),
      extra_folder(),
    );
    try {
      const session = await user(s.server);
      const notify_id = await notify_of(session, EXTRA_ID);
      expect((await signed(s, notify_id, session.user_id)).status).toBe(200);
      expect(await balance(s.server, session.user_id, GEM())).toBe(0n);
      expect(await reward_count(s.server, session.user_id, EXTRA_ID)).toBeNull();
      expect(error_of(await claim(session, notify_id))).toBe(CoreError.CORE_ERROR_INTERNAL);
      expect(T.read_logs(s.server, 'error').length).toBeGreaterThanOrEqual(1);
      expect((await signed(s, notify_id, session.user_id)).status).toBe(200);
      expect(await balance(s.server, session.user_id, GEM())).toBe(0n);
      expect(error_of(await claim(session, notify_id))).toBe(CoreError.CORE_ERROR_INTERNAL);
      expect(rewarded).toBe(0);
    } finally {
      await T.stop_test_server(s.server);
    }
  });

  it('grants the reward and the grant_ad_extra changes of a placement with extra_grant', async () => {
    const extra: unknown[] = [];
    const s = await start({}, hooks({ grant_ad_extra: (_ctx: unknown, placement_id: number, notify_id: string) => (extra.push([placement_id, notify_id]), 'pass') }), extra_folder());
    try {
      const session = await user(s.server);
      const notify_id = await notify_of(session, EXTRA_ID);
      expect((await signed(s, notify_id, session.user_id)).status).toBe(200);
      expect(extra).toEqual([[EXTRA_ID, notify_id]]);
      expect(amounts((await claim(session, notify_id)).response?.items ?? [])).toEqual([[GEM(), 3n]]);
    } finally {
      await T.stop_test_server(s.server);
    }
  });

  it('calls on_ad_rewarded once per granted callback with its changes in the pending delta, not for DUPLICATE; a throw is HTTP 500 that changes nothing, and the same callback grants again', async () => {
    const seen: [number, string][] = [];
    let fail_next = false;
    let ledger: ItemLedgerContent | null = null;
    const register = (core: Record<string, unknown>): void => {
      ledger = core['item-ledger'] as ItemLedgerContent;
      hooks({
        on_ad_rewarded: (ctx: RequestCtx, placement_id: number, notify_id: string) => {
          if (fail_next) {
            fail_next = false;
            throw new Error('on_ad_rewarded fails');
          }
          seen.push([placement_id, notify_id]);
          ledger?.add_items(ctx, [item(GEM(), 1n)], {});
        },
      })(core);
    };
    const s = await start({}, register);
    try {
      const session = await user(s.server);
      const notify_id = await notify_of(session, BASIC());
      expect((await signed(s, notify_id, session.user_id)).status).toBe(200);
      expect((await signed(s, notify_id, session.user_id)).status).toBe(200);
      expect(seen).toEqual([[BASIC(), notify_id]]);
      const claimed = await claim(session, notify_id);
      expect(balance_entry(claimed.envelope.pending_user_state, GEM())).toBe(11n);
      const hook_change = claimed.envelope.item_changes.find((c) => c.delta === 1n);
      expect(hook_change?.source).toBe(ItemChangeSource.ITEM_CHANGE_SOURCE_AD_REWARD);

      const thrown = await notify_of(session, BASIC());
      fail_next = true;
      expect((await signed(s, thrown, session.user_id)).status).toBe(500);
      expect(await balance(s.server, session.user_id, GEM())).toBe(11n);
      expect((await reward_count(s.server, session.user_id, BASIC()))?.count).toBe(1);
      expect(error_of(await drive(s.server, claim(session, thrown)))).toBe(CoreError.CORE_ERROR_AD_REWARD_PENDING);
      expect((await signed(s, thrown, session.user_id)).status).toBe(200);
      expect(await balance(s.server, session.user_id, GEM())).toBe(22n);
      expect(seen).toHaveLength(2);
    } finally {
      await T.stop_test_server(s.server);
    }
  });
});
