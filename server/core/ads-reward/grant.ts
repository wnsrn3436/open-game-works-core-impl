/**
 * The grant order and the reward count of `ads-reward`. Both the callback and the DEV `FakeAdCallback` grant in
 * a user transaction they opened: the callback in an out-of-request change, `FakeAdCallback` in the cheat's ctx.
 */
import * as CoreContract from '../../generated/contract/core_contract.ts';
import * as GameData from '../../generated/data/game_data.ts';
import type { RequestCtx } from '../storage/index.ts';
import type { AdsAdapter } from './adapter.ts';
import type { AdsRewardModules, AdsRewardSettings } from './deps.ts';
import { set_state } from './tickets.ts';

/** `validate_ad_reward`: `pass` or a `GameError`. */
export type ValidateAdRewardHook = (ctx: RequestCtx, placement_id: number) => unknown;
/** `grant_ad_extra`: `pass` or a `GameError`. */
export type GrantAdExtraHook = (ctx: RequestCtx, placement_id: number, notify_id: string) => unknown;
/** `on_ad_rewarded` (after hook): none. */
export type OnAdRewardedHook = (ctx: RequestCtx, placement_id: number, notify_id: string) => unknown;

/** The hook slots `routing` fills after content `register` (`routing` `## API`). */
export interface AdsRewardHookSlots {
  validate_ad_reward: ValidateAdRewardHook | null;
  grant_ad_extra: GrantAdExtraHook | null;
  on_ad_rewarded: OnAdRewardedHook | null;
}

/** What one `ads-reward` instance holds. */
export interface AdsRewardCore {
  readonly settings: AdsRewardSettings;
  readonly m: AdsRewardModules;
  readonly data: GameData.DataSet;
  readonly hook_slots: AdsRewardHookSlots;
  /** The ads adapter `environments.<ENV>.adapters.ads` selects; null when there is none (yet). */
  adapter: AdsAdapter | null;
  readonly start_errors: string[];
}

export const PASS = 'pass';
const AD_REWARD = CoreContract.ItemChangeSource.ITEM_CHANGE_SOURCE_AD_REWARD;
const INTERNAL = CoreContract.CoreError.CORE_ERROR_INTERNAL;
const ONCE_KEY_PREFIX = 'ad:';

/** The count item of the placement, after the lazy reset at the ctx request time. */
function count_item(core: AdsRewardCore, ctx: RequestCtx, placement_id: number): CoreContract.AdRewardCountUserState | null {
  const { storage, time } = core.m;
  const item = storage.get_state(ctx, CoreContract.AdRewardCountUserState, BigInt(placement_id)) as CoreContract.AdRewardCountUserState | null;
  if (item === null) return null;
  if (item.reset_at !== 0n && time.now(ctx) >= item.reset_at) {
    const row = core.data.AdPlacementTable.get_row(placement_id);
    item.count = 0;
    item.reset_at = time.get_next_reset(row.reset, time.now(ctx));
  }
  return item;
}

/** `get_reward_count`: the grants of the placement in the current limit period. */
export function get_reward_count(core: AdsRewardCore, ctx: RequestCtx, placement_id: number): number {
  if (!core.data.AdPlacementTable.has_row(placement_id)) return 0;
  return count_item(core, ctx, placement_id)?.count ?? 0;
}

function add_reward_count(core: AdsRewardCore, ctx: RequestCtx, placement_id: number): void {
  const { storage, time } = core.m;
  let item = count_item(core, ctx, placement_id);
  if (item === null) {
    item = new CoreContract.AdRewardCountUserState();
    item.id = BigInt(placement_id);
    item.reset_at = time.get_next_reset(core.data.AdPlacementTable.get_row(placement_id).reset, time.now(ctx));
  }
  item.count += 1;
  storage.put_core_state(ctx, item);
}

function in_hook<T>(core: AdsRewardCore, ctx: RequestCtx, placement_id: number, fn: () => T): T {
  return core.m.storage.with_hook_change_source(ctx, AD_REWARD, String(placement_id), fn);
}

function error_log(core: AdsRewardCore, ctx: RequestCtx, message: string): void {
  core.m.logging.write({ kind: 'error', level: 'error', message, user_id: ctx.user_id, request_id: ctx.request_id || null, request: ctx.request_name || null, fields: { stack_trace: null } });
}

/**
 * Grant order steps 1 and 2 in one savepoint. `Granted` puts the reward list on the ticket; a failure is the reason
 * the savepoint was undone.
 */
function grant_in_savepoint(core: AdsRewardCore, ctx: RequestCtx, notify_id: string, row: GameData.AdPlacementRow): { granted: CoreContract.ItemAmount[] } | { failure: string } {
  let granted: CoreContract.ItemAmount[] = [];
  let failure = '';
  const result = core.m.storage.run_savepoint(ctx, () => {
    if (row.reward.length > 0) {
      const source = { source: AD_REWARD, ref: String(row.id), once_key: `${ONCE_KEY_PREFIX}${notify_id}` };
      const out = core.m.mailbox.grant_or_mail(ctx, row.reward, source, ctx.data.ReservedId.ad_reward_mail(), []);
      if (out.result === 'Granted') granted = row.reward;
      else if (out.result !== 'AlreadyApplied' && out.result !== 'Mailed') {
        failure = `grant_or_mail returned ${out.result}`;
        return INTERNAL;
      }
    }
    const hook = core.hook_slots.grant_ad_extra;
    if (row.extra_grant && hook !== null) {
      const out = in_hook(core, ctx, row.id, () => core.m.storage.check_hook_output('grant_ad_extra', hook(ctx, row.id, notify_id)));
      if (out !== PASS) {
        failure = `grant_ad_extra returned GameError ${String(out)}`;
        return out;
      }
    }
    return PASS;
  });
  return result === PASS ? { granted } : { failure };
}

/**
 * The grant order for the ticket (ctx user, reward notify ID) of a placement, after `claim_notify` returned
 * `FIRST`. A failed grant leaves the ticket `Failed`. A throw of `on_ad_rewarded` or of a store call throws, and the
 * caller's transaction rolls back.
 */
export function grant(core: AdsRewardCore, ctx: RequestCtx, notify_id: string, placement_id: number): 'Granted' | 'Failed' {
  const { storage, logging } = core.m;
  const db = storage.db(ctx);
  if (!core.data.AdPlacementTable.has_row(placement_id)) {
    set_state(db, ctx.user_id, notify_id, 'Failed', []);
    error_log(core, ctx, `ad reward ${notify_id} failed: placement ${String(placement_id)} is not in ad_placement`);
    return 'Failed';
  }
  const row = core.data.AdPlacementTable.get_row(placement_id);
  const step = grant_in_savepoint(core, ctx, notify_id, row);
  if ('failure' in step) {
    set_state(db, ctx.user_id, notify_id, 'Failed', []);
    error_log(core, ctx, `ad reward ${notify_id} of placement ${String(placement_id)} failed: ${step.failure}`);
    return 'Failed';
  }
  add_reward_count(core, ctx, placement_id);
  set_state(db, ctx.user_id, notify_id, 'Granted', step.granted);
  const after = core.hook_slots.on_ad_rewarded;
  if (after !== null) in_hook(core, ctx, placement_id, () => after(ctx, placement_id, notify_id));
  logging.track_core_event(ctx, 'core_ad_rewarded', [['placement_id', placement_id]]);
  return 'Granted';
}
