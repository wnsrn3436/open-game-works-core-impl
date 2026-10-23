/**
 * `IapPurchaseUserState` (`### purchase count, pass, daily reward`): the purchase count of the limit period, the pass
 * end day and the last daily reward claim day of a product.
 */
import * as CoreContract from '../../generated/contract/core_contract.ts';
import type * as GameData from '../../generated/data/game_data.ts';
import type { RequestCtx } from '../storage/index.ts';
import { is_pass, ProductType, type IapContext } from './context.ts';

function stored(c: IapContext, ctx: RequestCtx, product_id: number): CoreContract.IapPurchaseUserState | null {
  return c.m.storage.get_state(ctx, CoreContract.IapPurchaseUserState, BigInt(product_id)) as CoreContract.IapPurchaseUserState | null;
}

function copy(row: CoreContract.IapPurchaseUserState): CoreContract.IapPurchaseUserState {
  const out = new CoreContract.IapPurchaseUserState();
  out.id = row.id;
  out.count = row.count;
  out.reset_at = row.reset_at;
  out.pass_end_day = row.pass_end_day;
  out.daily_claimed_day = row.daily_claimed_day;
  out.event_round = row.event_round;
  return out;
}

/**
 * The product's row read by `offer.read_purchase_limit`, with the `live-event` round reset for `Consumable` only, and
 * the `write_reset_at` to write when the count goes up. The view is not saved; a later write of the row saves it.
 */
function read_limit(c: IapContext, ctx: RequestCtx, product: GameData.IapProductRow): { row: CoreContract.IapPurchaseUserState; write_reset_at: bigint } {
  const found = stored(c, ctx, product.id);
  const row = found === null ? new CoreContract.IapPurchaseUserState() : copy(found);
  row.id = BigInt(product.id);
  const live_event = product.type === ProductType.Consumable ? product.live_event : 0;
  const read = c.m.offer.read_purchase_limit(ctx, product.offer, product.reset, live_event, row.count, row.reset_at, row.event_round);
  row.count = read.count;
  row.reset_at = read.reset_at;
  row.event_round = read.event_round;
  return { row, write_reset_at: read.write_reset_at };
}

/** The product's row read by `read_limit`. */
export function read_purchase(c: IapContext, ctx: RequestCtx, product: GameData.IapProductRow): CoreContract.IapPurchaseUserState {
  return read_limit(c, ctx, product).row;
}

/** The purchase count of the current limit period. */
export function purchase_count(c: IapContext, ctx: RequestCtx, product: GameData.IapProductRow): number {
  return read_purchase(c, ctx, product).count;
}

/**
 * Adds one to the purchase count (grant order 8) and, for a pass, extends `pass_end_day`. Returns the row's
 * `reset_at` and `event_round` after the write, for the payment record.
 */
export function add_purchase(c: IapContext, ctx: RequestCtx, product: GameData.IapProductRow): { reset_at: bigint; event_round: number; count: number } {
  const { row, write_reset_at } = read_limit(c, ctx, product);
  row.reset_at = write_reset_at;
  row.count += 1;
  row.event_round = c.m.live_event.round_to_write(ctx, product.live_event);
  if (is_pass(product)) {
    const today = c.m.time.get_day_number(c.m.time.now(ctx));
    row.pass_end_day = (row.pass_end_day > today ? row.pass_end_day : today) + BigInt(product.pass_days);
  }
  c.m.storage.put_core_state(ctx, row);
  return { reset_at: row.reset_at, event_round: row.event_round, count: row.count };
}

/**
 * Takes one grant back: the purchase count goes down by one only when the row read by the limit period rules has
 * the grant's `reset_at` and `event_round`; with `with_pass`, a pass loses `pass_days`. Neither goes below 0.
 */
export function remove_purchase(c: IapContext, ctx: RequestCtx, product: GameData.IapProductRow, reset_at: bigint, event_round: number, with_pass: boolean): void {
  const row = read_purchase(c, ctx, product);
  let changed = false;
  if (row.reset_at === reset_at && row.event_round === event_round && row.count > 0) {
    row.count -= 1;
    changed = true;
  }
  if (with_pass && is_pass(product) && row.pass_end_day > 0n) {
    const end = row.pass_end_day - BigInt(product.pass_days);
    row.pass_end_day = end > 0n ? end : 0n;
    changed = true;
  }
  if (changed) c.m.storage.put_core_state(ctx, row);
}

/** Pass active: today < `pass_end_day`. */
export function pass_active(c: IapContext, ctx: RequestCtx, product: GameData.IapProductRow): boolean {
  const found = stored(c, ctx, product.id);
  return found !== null && c.m.time.get_day_number(c.m.time.now(ctx)) < found.pass_end_day;
}

/** Writes `daily_claimed_day` (`ClaimIapDaily`). */
export function set_daily_claimed(c: IapContext, ctx: RequestCtx, product: GameData.IapProductRow, day: bigint): void {
  const row = read_purchase(c, ctx, product);
  row.daily_claimed_day = day;
  c.m.storage.put_core_state(ctx, row);
}
