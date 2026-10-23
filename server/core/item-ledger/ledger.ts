/** The item-ledger operations: change order, recovery, group item, timed item, big item, history and hooks. */
import { AsyncLocalStorage } from 'node:async_hooks';
import * as CoreContract from '../../generated/contract/core_contract.ts';
import * as GameData from '../../generated/data/game_data.ts';
import type * as GameContract from '../../generated/contract/game_contract.ts';
import type { Logging, LogValue } from '../logging/index.ts';
import type { ServerTimeApi } from '../server-time/index.ts';
import type { FailureCode, RequestCtx, Storage } from '../storage/index.ts';
import { has_once_key, insert_history, put_once_key, select_history, source_name, type HistoryRow, type NewHistoryRow } from './history.ts';
import { amount_of, ceil_div, floor_div, item_info, max, min, write_big, type ItemInfo } from './items.ts';

const Source = CoreContract.ItemChangeSource;
type Source = CoreContract.ItemChangeSource;

export const ItemChangeResult = {
  OK: 'OK',
  ALREADY_APPLIED: 'ALREADY_APPLIED',
  NOT_ENOUGH: 'NOT_ENOUGH',
  LIMIT_EXCEEDED: 'LIMIT_EXCEEDED',
  UNKNOWN_ITEM: 'UNKNOWN_ITEM',
  INVALID_AMOUNT: 'INVALID_AMOUNT',
  UNSUPPORTED_ITEM: 'UNSUPPORTED_ITEM',
  REJECTED: 'REJECTED',
} as const;
export type ItemChangeResult = (typeof ItemChangeResult)[keyof typeof ItemChangeResult];

export const ItemAddPreview = {
  Applied: 'Applied',
  Converted: 'Converted',
  Discarded: 'Discarded',
  Mailed: 'Mailed',
} as const;
export type ItemAddPreview = (typeof ItemAddPreview)[keyof typeof ItemAddPreview];

/** The core `once_key` prefixes (`## API`). */
export const CORE_ONCE_KEY_PREFIXES: readonly string[] = [
  'ad:', 'admin:', 'attendance:', 'broadcast:', 'coupon:', 'gacha:', 'iap:', 'mail:', 'mission:', 'play_session_refund:', 'ranking:',
  'rating:', 'shop:',
];

/** A change source as the caller passes it: `ref` and `once_key` left out are the empty string. */
export interface ChangeSourceInput {
  readonly source?: Source;
  readonly ref?: string;
  readonly once_key?: string;
}

/** The change source the change is recorded with. */
export interface ChangeSource {
  readonly source: Source;
  readonly ref: string;
  readonly once_key: string;
}

/** True when `once_key` is a string that starts with a core `once_key` prefix: content code may not pass it. */
export function has_core_once_key_prefix(once_key: unknown): boolean {
  return typeof once_key === 'string' && CORE_ONCE_KEY_PREFIXES.some((p) => once_key.startsWith(p));
}

/**
 * Content code's change source: its `source` is not used. Outside a hook it is `Request` with `ref` the request name
 * when left out; in a hook it is the hook's change source with the hook's `ref` when left out. The caller refuses a
 * core `once_key` prefix first.
 */
export function content_change_source(ctx: RequestCtx, input: ChangeSourceInput | undefined): ChangeSource {
  const ref = input?.ref ?? '';
  const once_key = input?.once_key ?? '';
  const hook = ctx.hook_change_source;
  if (hook === null) return { source: Source.ITEM_CHANGE_SOURCE_REQUEST, ref: ref === '' ? ctx.request_name : ref, once_key };
  return { source: hook.source, ref: ref === '' ? hook.ref : ref, once_key };
}

/**
 * The response code of a failed change in a core `rpc` (`## error`): `NOT_ENOUGH` is `ITEM_NOT_ENOUGH`,
 * `LIMIT_EXCEEDED` is `ITEM_LIMIT_EXCEEDED`, a `GameError` is itself, and the rest is `INTERNAL`.
 */
export function change_failure_code(result: ItemChangeResult | GameContract.GameError): FailureCode {
  if (typeof result === 'number') return result;
  if (result === ItemChangeResult.NOT_ENOUGH) return CoreContract.CoreError.CORE_ERROR_ITEM_NOT_ENOUGH;
  if (result === ItemChangeResult.LIMIT_EXCEEDED) return CoreContract.CoreError.CORE_ERROR_ITEM_LIMIT_EXCEEDED;
  return CoreContract.CoreError.CORE_ERROR_INTERNAL;
}

/** Who calls a change operation: a core module (the module object) or content code (member `content`). */
export type Caller = 'core' | 'content';

/** The modules item-ledger depends on, by module name. */
export interface LedgerModules {
  readonly storage: Storage;
  readonly 'server-time': ServerTimeApi;
  readonly logging: Logging;
}

/** `get_recovery`'s output. */
export interface RecoveryTimes {
  readonly next_at: bigint;
  readonly cap_at: bigint;
}

/** One item of a hook's list. A timed item's balances are the remaining ms. */
export interface ItemBalanceChange {
  readonly item_id: number;
  readonly before: bigint;
  readonly after: bigint;
}

export type ValidateItemChangeHook = (ctx: RequestCtx, source: ChangeSource, changes: readonly ItemBalanceChange[]) => 'pass' | GameContract.GameError;
export type AfterItemChangeHook = (ctx: RequestCtx, source: ChangeSource, changes: readonly ItemBalanceChange[]) => null | undefined;

/** The hook slots of `## hook` (member `hook_slots`). An empty slot does the `default`. */
export interface ItemLedgerHooks {
  validate_item_change: ValidateItemChangeHook | null;
  after_item_change: AfterItemChangeHook | null;
}

export interface ItemAddReplacement {
  readonly item_id: number;
  readonly applied: bigint;
  readonly overflow: bigint;
}

export interface ItemAddPreviewRow {
  readonly item_id: number;
  readonly outcome: ItemAddPreview;
  readonly applied: bigint;
  readonly overflow: bigint;
  readonly replacements: readonly ItemAddReplacement[];
}

export interface ItemShortfall {
  readonly item_id: number;
  readonly shortfall: bigint;
}

type ListOp = 'add' | 'subtract' | 'revoke' | 'check';

interface Parsed {
  readonly id: number;
  readonly amount: bigint;
  readonly info: ItemInfo;
}

interface RecoveryState {
  /** Stored A, or `initial_amount` when there is no row. */
  readonly A: bigint;
  /** Stored S, or the user's `created_at` / 0 when there is no row. */
  readonly S: bigint;
  /** The lazy balance at the request time. */
  readonly B: bigint;
  readonly n: bigint;
  /** C before the change. */
  readonly C: bigint;
  readonly row: boolean;
}

interface Cell {
  readonly info: ItemInfo;
  /** The balance before the change, recovery applied. Remaining ms for a timed item. */
  readonly before: bigint;
  /** The working balance (remaining ms for a timed item). */
  value: bigint;
  readonly rec: RecoveryState | null;
  touched: boolean;
}

/** One `ItemChange` and history row of an operation. */
interface Entry {
  readonly item_id: number;
  /** The reported change: amount units (`duration` units for a timed item). */
  readonly delta: bigint;
  /** The change of the cell value: equals `delta` except for a timed item, where it is ms. */
  readonly value_delta: bigint;
  readonly overflow: bigint;
  readonly shortfall: bigint;
  readonly source: Source;
  readonly ref: string;
  readonly once_key: string;
  /** False for a revoke row that changed nothing: it is only a history row. */
  readonly item_change: boolean;
}

/**
 * Takes a group item's amount from its members in `members` order, min(what is left, the member's balance) from each.
 * Returns what is left; more than 0 is `NOT_ENOUGH`. `check_items` and `Change` share it so both give the same result.
 */
function take_members(group: GameData.ItemGroupRow, amount: bigint, balance: (id: number) => bigint, take: (id: number, n: bigint) => void): bigint {
  let a = amount;
  for (const m of group.members) {
    if (a === 0n) break;
    const n = min(a, balance(m));
    if (n === 0n) continue;
    take(m, n);
    a -= n;
  }
  return a;
}

/** The lazy recovery balance at t (`recovery`). */
function lazy(A: bigint, S: bigint, C: bigint, t: bigint, row: GameData.ItemRecoveryRow): { B: bigint; n: bigint } {
  if (S === 0n || A >= C) return { B: A, n: 0n };
  const n = max(0n, floor_div(t - S, row.recovery_interval));
  if (n >= ceil_div(C - A, row.recovery_amount)) return { B: C, n };
  return { B: A + n * row.recovery_amount, n };
}

/** The failure of change order 3, thrown out of the calculation. */
class Failure extends Error {
  readonly result: ItemChangeResult;

  constructor(result: ItemChangeResult) {
    super(result);
    this.result = result;
  }
}

/** Input check failures by rank: a higher rank wins over the whole list. */
const INPUT_PROBLEMS = ['', ItemChangeResult.UNSUPPORTED_ITEM, ItemChangeResult.UNKNOWN_ITEM, ItemChangeResult.INVALID_AMOUNT] as const;

/** The rank in `INPUT_PROBLEMS` of one `ItemAmount`'s problem, 0 for none. */
function input_problem(id: number, amount: bigint | null, info: ItemInfo | null, seen: ReadonlySet<number>, op: ListOp): number {
  if (amount === null || amount < 1n || seen.has(id) || (info !== null && amount > info.amount_limit)) return 3;
  if (info === null) return 2;
  if (info.kind === 'group' && (op === 'add' || op === 'revoke')) return 1;
  if (info.kind === 'timed' && op === 'subtract') return 1;
  return 0;
}

export class Ledger {
  /** `item-ledger.historyRetentionMs`. */
  readonly retention_ms: bigint;
  readonly storage: Storage;
  readonly time: ServerTimeApi;
  readonly logging: Logging;
  readonly hooks: ItemLedgerHooks = { validate_item_change: null, after_item_change: null };
  /** True when the server instance has DEV code: source `Cheat` changes are allowed. */
  readonly cheat_open: boolean;
  private readonly hook_depth = new WeakMap<object, number>();
  private readonly hook_misuse = new WeakSet<object>();
  /** The `ItemInfo` cache, by `DataSet`. */
  private readonly item_cache = new WeakMap<GameData.DataSet, Map<number, ItemInfo | null>>();
  /** Recovery items by their `cap_bonus_item`, by `DataSet`. */
  private readonly dependent_cache = new WeakMap<GameData.DataSet, Map<number, number[]>>();

  constructor(retention_ms: bigint, modules: LedgerModules, dev: boolean) {
    this.retention_ms = retention_ms;
    this.storage = modules.storage;
    this.time = modules['server-time'];
    this.logging = modules.logging;
    this.cheat_open = dev;
  }

  // ---- logs

  log(ctx: Pick<RequestCtx, 'user_id' | 'request_id' | 'request_name'> | null, level: 'info' | 'warn' | 'error', kind: 'error' | 'security' | 'audit' | 'core', message: string, fields: Record<string, LogValue> = {}): void {
    this.logging.write({
      kind, level, message, user_id: ctx?.user_id ?? null,
      request_id: ctx && ctx.request_id !== '' ? ctx.request_id : null,
      request: ctx && ctx.request_name !== '' ? ctx.request_name : null,
      fields: kind === 'core' ? { module: 'item-ledger', ...fields } : fields,
    });
  }

  private error(ctx: RequestCtx | null, message: string, fields: Record<string, LogValue> = {}): void {
    this.log(ctx, 'error', 'error', message, { stack_trace: null, ...fields });
  }

  // ---- reads

  info(ctx: { readonly data: GameData.DataSet }, id: number): ItemInfo | null {
    let m = this.item_cache.get(ctx.data);
    if (!m) {
      m = new Map();
      this.item_cache.set(ctx.data, m);
    }
    if (!m.has(id)) m.set(id, item_info(ctx.data, id));
    return m.get(id) ?? null;
  }

  /** The recovery items whose `cap_bonus_item` is the item. */
  dependents(data: GameData.DataSet, id: number): readonly number[] {
    let m = this.dependent_cache.get(data);
    if (!m) {
      m = new Map();
      for (const r of data.ItemRecoveryTable.all_rows()) {
        if (r.cap_bonus_item === 0) continue;
        const list = m.get(r.cap_bonus_item) ?? [];
        list.push(r.id);
        m.set(r.cap_bonus_item, list);
      }
      this.dependent_cache.set(data, m);
    }
    return m.get(id) ?? [];
  }

  private row(ctx: RequestCtx, id: number): CoreContract.ItemBalanceUserState | null {
    return this.storage.get_state(ctx, CoreContract.ItemBalanceUserState, BigInt(id)) as CoreContract.ItemBalanceUserState | null;
  }

  /** The stored balance of an item that is not a recovery, group or timed item. */
  stored_amount(ctx: RequestCtx, id: number): bigint {
    const r = this.row(ctx, id);
    if (!r) return 0n;
    return r.big_amount !== '' ? BigInt(r.big_amount) : r.amount;
  }

  recovery_state(ctx: RequestCtx, info: ItemInfo): RecoveryState {
    const rec = info.recovery as GameData.ItemRecoveryRow;
    const C = rec.recovery_cap + (rec.cap_bonus_item === 0 ? 0n : this.stored_amount(ctx, rec.cap_bonus_item));
    const r = this.row(ctx, info.id);
    let A: bigint;
    let S: bigint;
    if (r) {
      A = r.amount;
      S = r.recovery_started_at;
    } else {
      A = rec.initial_amount;
      S = 0n;
      if (A < C) {
        const user = this.storage.get_user_record(this.storage.db(ctx), ctx.user_id);
        S = user ? user.created_at : 0n;
      }
    }
    const { B, n } = lazy(A, S, C, this.time.now(ctx), rec);
    return { A, S, B, n, C, row: r !== null };
  }

  /** The remaining ms of a timed item. */
  remaining(ctx: RequestCtx, id: number): bigint {
    const r = this.row(ctx, id);
    return r ? max(0n, r.ends_at - this.time.now(ctx)) : 0n;
  }

  get_balance(ctx: RequestCtx, id: number): bigint {
    const info = this.info(ctx, id);
    if (!info) return 0n;
    switch (info.kind) {
      case 'recovery': return this.recovery_state(ctx, info).B;
      case 'group': return (info.group as GameData.ItemGroupRow).members.reduce((sum, m) => sum + this.get_balance(ctx, m), 0n);
      case 'timed': return this.remaining(ctx, id) > 0n ? 1n : 0n;
      default: return this.stored_amount(ctx, id);
    }
  }

  get_ends_at(ctx: RequestCtx, id: number): bigint {
    const info = this.info(ctx, id);
    if (!info || info.kind !== 'timed') return 0n;
    const r = this.row(ctx, id);
    return r && r.ends_at > this.time.now(ctx) ? r.ends_at : 0n;
  }

  get_recovery(ctx: RequestCtx, id: number): RecoveryTimes {
    const info = this.info(ctx, id);
    if (!info || info.kind !== 'recovery') return { next_at: 0n, cap_at: 0n };
    const rec = info.recovery as GameData.ItemRecoveryRow;
    const s = this.recovery_state(ctx, info);
    if (s.S === 0n || s.B >= s.C) return { next_at: 0n, cap_at: 0n };
    const start = s.S + s.n * rec.recovery_interval;
    return { next_at: start + rec.recovery_interval, cap_at: start + ceil_div(s.C - s.B, rec.recovery_amount) * rec.recovery_interval };
  }

  /** Input check (change order 1): `INVALID_AMOUNT`, `UNKNOWN_ITEM`, `UNSUPPORTED_ITEM` in this order. */
  parse(ctx: { readonly data: GameData.DataSet }, list: readonly CoreContract.ItemAmount[], op: ListOp): Parsed[] | ItemChangeResult {
    const seen = new Set<number>();
    let worst = 0;
    const out: Parsed[] = [];
    for (const a of list) {
      const amount = amount_of(a);
      const info = this.info(ctx, a.item_id);
      worst = Math.max(worst, input_problem(a.item_id, amount, info, seen, op));
      seen.add(a.item_id);
      if (info !== null && amount !== null) out.push({ id: a.item_id, amount, info });
    }
    return worst === 0 ? out : (INPUT_PROBLEMS[worst] as ItemChangeResult);
  }

  check_items(ctx: RequestCtx, list: readonly CoreContract.ItemAmount[]): boolean {
    const parsed = this.parse(ctx, list, 'check');
    if (typeof parsed === 'string') return false;
    const left = new Map<number, bigint>();
    const balance = (id: number): bigint => left.get(id) ?? this.get_balance(ctx, id);
    for (const p of parsed) {
      if (p.info.kind === 'group') continue;
      const b = balance(p.id);
      if (b < p.amount) return false;
      left.set(p.id, b - p.amount);
    }
    for (const p of parsed) {
      if (p.info.kind !== 'group') continue;
      const rest = take_members(p.info.group as GameData.ItemGroupRow, p.amount, balance, (m, n) => left.set(m, balance(m) - n));
      if (rest > 0n) return false;
    }
    return true;
  }

  list_history(user_id: bigint, from: bigint, to: bigint, after: bigint, limit: number): HistoryRow[] {
    if (limit < 1) return [];
    return select_history(this.storage.read_db(), user_id, from, to, after, limit, this.time.clock_now());
  }

  // ---- change source, hooks

  /**
   * The change source of a write; throws on a source or `once_key` the caller may not pass. A core module's `source`
   * is used as given; content code's `source` is not used.
   */
  resolve(ctx: RequestCtx, input: ChangeSourceInput | undefined, caller: Caller): ChangeSource {
    const ref = input?.ref ?? '';
    const once_key = input?.once_key ?? '';
    if (caller === 'core') return { source: this.core_source(ctx, input?.source), ref, once_key };
    if (has_core_once_key_prefix(once_key)) {
      this.error(ctx, 'content code passed a once_key with a core once_key prefix');
      throw new Error('item-ledger: content once_key starts with a core once_key prefix');
    }
    return content_change_source(ctx, input);
  }

  /** The `source` a core module passed; throws on `Recovery`, `Overflow` and none. */
  private core_source(ctx: RequestCtx, given: Source | undefined): Source {
    const source = given ?? Source.ITEM_CHANGE_SOURCE_UNSPECIFIED;
    if (source !== Source.ITEM_CHANGE_SOURCE_RECOVERY && source !== Source.ITEM_CHANGE_SOURCE_OVERFLOW && source !== Source.ITEM_CHANGE_SOURCE_UNSPECIFIED) return source;
    this.error(ctx, `item change source ${source_name(source)} is not a source a caller passes`);
    throw new Error(`item-ledger: change source ${source_name(source)} is not for callers`);
  }

  /** Throws when a source `Cheat` change runs where the DEV code is not in the server instance. */
  check_cheat(ctx: RequestCtx, source: ChangeSource): void {
    if (source.source !== Source.ITEM_CHANGE_SOURCE_CHEAT || this.cheat_open) return;
    this.log(ctx, 'warn', 'security', 'item change with source Cheat where the DEV code is not in the server', { ip: null, reason: 'cheat_source_closed' });
    throw new Error('item-ledger: source Cheat change without the DEV code');
  }

  /** A write operation called from inside `validate_item_change` or `after_item_change` throws. */
  guard_write(ctx: RequestCtx, operation: string): void {
    if ((this.hook_depth.get(ctx) ?? 0) === 0) return;
    this.hook_misuse.add(ctx);
    this.error(ctx, `${operation} called inside an item-ledger hook`);
    throw new Error(`item-ledger: ${operation} inside an item-ledger hook`);
  }

  private call_hook<T>(ctx: RequestCtx, name: string, fn: () => T): T {
    this.hook_depth.set(ctx, (this.hook_depth.get(ctx) ?? 0) + 1);
    let out: T;
    try {
      out = fn();
    } catch (e) {
      if (!this.hook_misuse.has(ctx)) this.error(ctx, `hook ${name} threw`, { stack_trace: e instanceof Error ? (e.stack ?? e.message) : String(e) });
      throw e;
    } finally {
      const depth = (this.hook_depth.get(ctx) ?? 1) - 1;
      if (depth === 0) this.hook_depth.delete(ctx);
      else this.hook_depth.set(ctx, depth);
    }
    if (this.hook_misuse.has(ctx)) throw new Error(`item-ledger: write operation inside hook ${name}`);
    return out;
  }

  /** `validate_item_change`: null for `pass`, else the `GameError`. */
  validate(ctx: RequestCtx, source: ChangeSource, changes: readonly ItemBalanceChange[]): GameContract.GameError | null {
    const hook = this.hooks.validate_item_change;
    if (!hook) return null;
    const out: unknown = this.call_hook(ctx, 'validate_item_change', () => hook(ctx, source, changes));
    if (out === 'pass') return null;
    if (typeof out === 'number' && Number.isInteger(out) && out > 0) return out as GameContract.GameError;
    this.error(ctx, 'hook validate_item_change returned neither pass nor a GameError');
    throw new Error('item-ledger: validate_item_change output');
  }

  after(ctx: RequestCtx, source: ChangeSource, changes: readonly ItemBalanceChange[]): void {
    const hook = this.hooks.after_item_change;
    if (!hook) return;
    const out: unknown = this.call_hook(ctx, 'after_item_change', () => hook(ctx, source, changes));
    if (out === null || out === undefined) return;
    this.error(ctx, 'hook after_item_change returned a value');
    throw new Error('item-ledger: after_item_change output');
  }

  already_applied(ctx: RequestCtx, source: ChangeSource): boolean {
    if (source.once_key === '' || !has_once_key(this.storage.db(ctx), ctx.user_id, source.once_key, this.time.clock_now())) return false;
    this.log(ctx, 'info', 'core', 'item change with an applied once_key', { module: 'item-ledger', once_key: source.once_key });
    return true;
  }

  // ---- writes

  change(
    ctx: RequestCtx, operation: string, sub: readonly CoreContract.ItemAmount[], add: readonly CoreContract.ItemAmount[], input: ChangeSourceInput | undefined, caller: Caller,
  ): ItemChangeResult | GameContract.GameError {
    this.guard_write(ctx, operation);
    const source = this.resolve(ctx, input, caller);
    this.check_cheat(ctx, source);
    const subs = this.parse(ctx, sub, 'subtract');
    const adds = typeof subs === 'string' ? subs : this.parse(ctx, add, 'add');
    if (typeof subs === 'string' || typeof adds === 'string') {
      const result = (typeof subs === 'string' ? subs : adds) as ItemChangeResult;
      this.error(ctx, `${operation} input check failed: ${result}`, { result });
      return result;
    }
    if (this.already_applied(ctx, source)) return ItemChangeResult.ALREADY_APPLIED;
    const work = new Change(this, ctx);
    const computed = work.compute(subs, adds, source);
    if (computed !== null) return computed;
    const changes = work.balance_changes();
    const verdict = this.validate(ctx, source, changes);
    if (verdict !== null) return verdict;
    work.save(source);
    this.after(ctx, source, changes);
    return ItemChangeResult.OK;
  }

  /** `check_add_items`: change order 1 of `add_items` with the server build data. */
  check_add(data: GameData.DataSet, list: readonly CoreContract.ItemAmount[]): ItemChangeResult {
    const adds = this.parse({ data }, list, 'add');
    if (typeof adds !== 'string') return ItemChangeResult.OK;
    this.error(null, `check_add_items input check failed: ${adds}`, { result: adds });
    return adds;
  }

  preview(ctx: RequestCtx, list: readonly CoreContract.ItemAmount[]): ItemAddPreviewRow[] | ItemChangeResult {
    const adds = this.parse(ctx, list, 'add');
    if (typeof adds === 'string') {
      this.error(ctx, `preview_add_items input check failed: ${adds}`, { result: adds });
      return adds;
    }
    const work = new Change(this, ctx);
    const none: ChangeSource = { source: Source.ITEM_CHANGE_SOURCE_REQUEST, ref: '', once_key: '' };
    if (work.compute([], adds, none) !== null) {
      return adds.map((p) => ({ item_id: p.id, outcome: ItemAddPreview.Mailed, applied: 0n, overflow: 0n, replacements: [] }));
    }
    return adds.map((p) => {
      const own = work.entries.find((e) => e.item_id === p.id && e.source !== Source.ITEM_CHANGE_SOURCE_OVERFLOW);
      const replacements = work.replacements.get(p.id) ?? [];
      const applied = own?.delta ?? 0n;
      const overflow = own?.overflow ?? 0n;
      const rows = replacements.map((e) => ({ item_id: e.item_id, applied: e.delta, overflow: e.overflow }));
      let outcome: ItemAddPreview = ItemAddPreview.Applied;
      if (overflow > 0n) outcome = p.info.overflow === GameData.ItemOverflow.Convert && rows.every((r) => r.overflow === 0n) ? ItemAddPreview.Converted : ItemAddPreview.Discarded;
      return { item_id: p.id, outcome, applied, overflow, replacements: rows };
    });
  }

  revoke(ctx: RequestCtx, list: readonly CoreContract.ItemAmount[], input: ChangeSourceInput | undefined, caller: Caller): ItemShortfall[] | ItemChangeResult {
    this.guard_write(ctx, 'revoke_items');
    const source = this.resolve(ctx, input, caller);
    this.check_cheat(ctx, source);
    const parsed = this.parse(ctx, list, 'revoke');
    if (typeof parsed === 'string') {
      this.error(ctx, `revoke_items input check failed: ${parsed}`, { result: parsed });
      return parsed;
    }
    if (this.already_applied(ctx, source)) return ItemChangeResult.ALREADY_APPLIED;
    const work = new Change(this, ctx);
    const out: ItemShortfall[] = [];
    for (const p of parsed) {
      const c = work.cell(p.id);
      c.touched = true;
      let delta: bigint;
      let value_delta: bigint;
      let shortfall: bigint;
      if (c.info.kind === 'timed') {
        const d = (c.info.timed as GameData.ItemTimedRow).duration;
        const x = min(c.value, p.amount * d);
        shortfall = floor_div(p.amount * d - x, d);
        delta = -(p.amount - shortfall);
        value_delta = -x;
      } else {
        const revoked = min(c.value, p.amount);
        shortfall = p.amount - revoked;
        delta = -revoked;
        value_delta = delta;
      }
      c.value += value_delta;
      work.entries.push({ item_id: p.id, delta, value_delta, overflow: 0n, shortfall, source: source.source, ref: source.ref, once_key: source.once_key, item_change: delta !== 0n });
      out.push({ item_id: p.id, shortfall });
    }
    const changes = work.balance_changes();
    work.save(source);
    const audits = work.entries.filter((e) => e.delta !== 0n).map((e) => ({
      item_id: e.item_id, revoked: (-e.delta).toString(), shortfall: e.shortfall.toString(),
      source: source_name(source.source), ref: source.ref, once_key: source.once_key,
    }));
    if (audits.length > 0) {
      // Only a committed revoke is audited, at its commit: a server stop does not drop an `on_commit` function. The
      // snapshot keeps the `logging.with_audit_actor` operator of this call.
      const in_this_context = AsyncLocalStorage.snapshot();
      const log = { user_id: ctx.user_id, request_id: ctx.request_id, request_name: ctx.request_name };
      this.storage.on_commit(ctx, () => {
        in_this_context(() => {
          for (const fields of audits) this.log(log, 'info', 'audit', 'items revoked', fields);
        });
      });
    }
    this.after(ctx, source, changes);
    return out;
  }
}

/** The per-item working values of change order 3. */
interface NetWork {
  /** Items in the order their `ItemChange`s are sent. */
  readonly order: number[];
  readonly net: Map<number, bigint>;
  readonly delta: Map<number, bigint>;
  readonly value_delta: Map<number, bigint>;
  readonly overflow: Map<number, bigint>;
  /** `Convert` items and their overflowed amount, in list order. */
  readonly convert: { id: number; n: bigint }[];
}

/** Adds `amount` to an item's net change, putting the item in `order` the first time. */
function note(work: NetWork, id: number, amount: bigint): void {
  if (!work.net.has(id)) work.order.push(id);
  work.net.set(id, (work.net.get(id) ?? 0n) + amount);
}

/** The `ItemChange` of an entry, with the big encoding pairs. */
function item_change(e: Entry): CoreContract.ItemChange {
  const change = new CoreContract.ItemChange();
  change.item_id = e.item_id;
  const d = write_big(e.delta);
  change.delta = d.small;
  change.big_delta = d.big;
  const o = write_big(e.overflow);
  change.overflow = o.small;
  change.big_overflow = o.big;
  change.source = e.source;
  change.ref = e.ref;
  return change;
}

/** The working state of one write operation. */
export class Change {
  readonly cells = new Map<number, Cell>();
  /** `ItemChange` and history rows in the order they are sent. */
  readonly entries: Entry[] = [];
  /** `Convert` replacement entries by the overflowed item. */
  readonly replacements = new Map<number, Entry[]>();
  readonly ledger: Ledger;
  readonly ctx: RequestCtx;
  readonly t: bigint;

  constructor(ledger: Ledger, ctx: RequestCtx) {
    this.ledger = ledger;
    this.ctx = ctx;
    this.t = ledger.time.now(ctx);
  }

  /** The cell of an item that is not a group item, loaded once. */
  cell(id: number): Cell {
    const found = this.cells.get(id);
    if (found) return found;
    const info = this.ledger.info(this.ctx, id);
    if (!info || info.kind === 'group') throw new Error(`item-ledger: item ${String(id)} has no balance of its own`);
    let before: bigint;
    let rec: RecoveryState | null = null;
    if (info.kind === 'recovery') {
      rec = this.ledger.recovery_state(this.ctx, info);
      before = rec.B;
    } else if (info.kind === 'timed') {
      before = this.ledger.remaining(this.ctx, id);
    } else {
      before = this.ledger.stored_amount(this.ctx, id);
    }
    const cell: Cell = { info, before, value: before, rec, touched: false };
    this.cells.set(id, cell);
    return cell;
  }

  /**
   * Change order 3 for subtract list `subs` and add list `adds`: null when every item fits, else the failure.
   * Fills `entries` and `replacements`.
   */
  compute(subs: readonly Parsed[], adds: readonly Parsed[], source: ChangeSource): ItemChangeResult | null {
    try {
      this.compute_or_throw(subs, adds, source);
      return null;
    } catch (e) {
      if (e instanceof Failure) return e.result;
      throw e;
    }
  }

  private compute_or_throw(subs: readonly Parsed[], adds: readonly Parsed[], source: ChangeSource): void {
    const work: NetWork = { order: [], net: new Map(), delta: new Map(), value_delta: new Map(), overflow: new Map(), convert: [] };
    const groups: Parsed[] = [];
    for (const p of subs) {
      if (p.info.kind === 'group') groups.push(p);
      else note(work, p.id, -p.amount);
    }
    for (const p of adds) note(work, p.id, p.amount);
    for (const id of [...work.order]) this.apply_net(work, id);
    for (const g of groups) this.take_group(work, g);
    for (const id of work.order) {
      const c = this.cell(id);
      if (!work.delta.has(id)) work.delta.set(id, c.value - c.before);
      if (!work.value_delta.has(id)) work.value_delta.set(id, c.value - c.before);
    }
    for (const { id, n } of work.convert) this.replacements.set(id, this.convert(id, n));
    this.push_entries(work, source);
  }

  /** The `ItemChange` and history entries in `order`, each `Convert` item's replacements right after it. */
  private push_entries(work: NetWork, source: ChangeSource): void {
    for (const id of work.order) {
      const d = work.delta.get(id) ?? 0n;
      const o = work.overflow.get(id) ?? 0n;
      if (d !== 0n || o !== 0n) {
        this.entries.push({
          item_id: id, delta: d, value_delta: work.value_delta.get(id) ?? 0n, overflow: o, shortfall: 0n,
          source: source.source, ref: source.ref, once_key: source.once_key, item_change: true,
        });
      }
      this.entries.push(...(this.replacements.get(id) ?? []));
    }
  }

  /** Change order 3 for the net change of one item that is not a group item. */
  private apply_net(work: NetWork, id: number): void {
    const c = this.cell(id);
    c.touched = true;
    const d = work.net.get(id) ?? 0n;
    if (c.info.kind === 'timed') {
      const dur = (c.info.timed as GameData.ItemTimedRow).duration;
      const cap = c.info.max_amount * dur;
      let k = d;
      if (c.value + d * dur > cap) {
        if (c.info.overflow !== GameData.ItemOverflow.Discard) throw new Failure(ItemChangeResult.LIMIT_EXCEEDED);
        k = max(0n, floor_div(cap - c.value, dur));
      }
      c.value += k * dur;
      work.delta.set(id, k);
      work.value_delta.set(id, k * dur);
      work.overflow.set(id, d - k);
      return;
    }
    const next = c.value + d;
    if (d < 0n && next < 0n) throw new Failure(ItemChangeResult.NOT_ENOUGH);
    if (d < 0n || next <= c.info.balance_limit) {
      c.value = next;
      return;
    }
    if (c.info.overflow !== GameData.ItemOverflow.Discard && c.info.overflow !== GameData.ItemOverflow.Convert) throw new Failure(ItemChangeResult.LIMIT_EXCEEDED);
    const applied = min(d, max(0n, c.info.balance_limit - c.value));
    c.value += applied;
    work.overflow.set(id, d - applied);
    if (c.info.overflow === GameData.ItemOverflow.Convert) work.convert.push({ id, n: d - applied });
  }

  /** Subtracts a group item's amount from its members in `members` order. */
  private take_group(work: NetWork, g: Parsed): void {
    const rest = take_members(g.info.group as GameData.ItemGroupRow, g.amount, (m) => this.cell(m).value, (m, n) => {
      const c = this.cell(m);
      c.touched = true;
      c.value -= n;
      note(work, m, 0n);
    });
    if (rest > 0n) throw new Failure(ItemChangeResult.NOT_ENOUGH);
  }

  /** The `Convert` replacement grants of n overflowed amounts of an item, in `convert_to` order. */
  private convert(id: number, n: bigint): Entry[] {
    const list: Entry[] = [];
    for (const e of this.cell(id).info.convert_to) {
      const amount = (amount_of(e) ?? 0n) * n;
      const c = this.cell(e.item_id);
      c.touched = true;
      let applied = amount;
      if (c.value + amount > c.info.balance_limit) {
        if (c.info.overflow !== GameData.ItemOverflow.Discard) throw new Failure(ItemChangeResult.LIMIT_EXCEEDED);
        applied = min(amount, max(0n, c.info.balance_limit - c.value));
      }
      c.value += applied;
      list.push({
        item_id: e.item_id, delta: applied, value_delta: applied, overflow: amount - applied, shortfall: 0n,
        source: Source.ITEM_CHANGE_SOURCE_OVERFLOW, ref: String(id), once_key: '', item_change: true,
      });
    }
    return list;
  }

  /** The hooks' list: each item of `entries` once, with the balance before and after the whole operation. */
  balance_changes(): ItemBalanceChange[] {
    const seen = new Set<number>();
    const out: ItemBalanceChange[] = [];
    for (const e of this.entries) {
      if (seen.has(e.item_id)) continue;
      seen.add(e.item_id);
      const c = this.cell(e.item_id);
      out.push({ item_id: e.item_id, before: c.before, after: c.value });
    }
    return out;
  }

  /** Change order 5: recovery records, balances, history, `ItemChange`s and `once_key`. */
  save(source: ChangeSource): void {
    const { ledger, ctx, t } = this;
    const recovery = this.recovery_items();
    const rows = this.recovery_rows(recovery);
    for (const c of this.cells.values()) {
      if (c.info.kind === 'recovery') {
        if (recovery.includes(c.info.id)) this.save_recovery(c);
      } else if (c.touched && c.value !== c.before) {
        this.save_balance(c);
      }
    }
    rows.push(...this.entry_rows());
    const db = ledger.storage.db(ctx);
    const expires = ledger.time.clock_now() + ledger.retention_ms;
    insert_history(db, ctx.user_id, t, ctx.request_id === '' ? null : ctx.request_id, expires, rows);
    for (const e of this.entries) if (e.item_change) ledger.storage.add_item_change(ctx, item_change(e));
    if (source.once_key !== '') put_once_key(db, ctx.user_id, source.once_key, expires);
  }

  /** The recovery items to reflect: the touched ones and those whose `cap_bonus_item` is touched. */
  private recovery_items(): number[] {
    const out: number[] = [];
    for (const c of [...this.cells.values()]) {
      if (!c.touched) continue;
      if (c.info.kind === 'recovery' && !out.includes(c.info.id)) out.push(c.info.id);
      for (const r of this.ledger.dependents(this.ctx.data, c.info.id)) if (!out.includes(r)) out.push(r);
    }
    return out;
  }

  /** The source `Recovery` history rows of the recovery reflection. */
  private recovery_rows(recovery: readonly number[]): NewHistoryRow[] {
    const rows: NewHistoryRow[] = [];
    for (const id of recovery) {
      const s = this.cell(id).rec as RecoveryState;
      if (s.B - s.A < 1n) continue;
      rows.push({
        item_id: id, delta: s.B - s.A, balance_after: s.B, overflow: 0n, shortfall: 0n,
        source: source_name(Source.ITEM_CHANGE_SOURCE_RECOVERY), ref: '', once_key: '', ends_at_after: 0n,
      });
    }
    return rows;
  }

  /** Stores a reflected recovery item's A and S after the change, unless they are what is stored. */
  private save_recovery(c: Cell): void {
    const { ledger, ctx, t } = this;
    const rec = c.info.recovery as GameData.ItemRecoveryRow;
    const s = c.rec as RecoveryState;
    const moved = s.B < s.C ? s.S + s.n * rec.recovery_interval : 0n;
    const bonus = rec.cap_bonus_item === 0 ? 0n : (this.cells.get(rec.cap_bonus_item)?.value ?? ledger.stored_amount(ctx, rec.cap_bonus_item));
    const cap = rec.recovery_cap + bonus;
    const started = c.value >= cap ? 0n : moved === 0n ? t : moved;
    if (s.row && c.value === s.A && started === s.S) return;
    const state = new CoreContract.ItemBalanceUserState();
    state.id = BigInt(c.info.id);
    const pair = write_big(c.value);
    state.amount = pair.small;
    state.big_amount = pair.big;
    state.recovery_started_at = started;
    ledger.storage.put_core_state(ctx, state);
  }

  /** Stores the changed balance of an item that is not a recovery item; 0 deletes the row. */
  private save_balance(c: Cell): void {
    const { ledger, ctx, t } = this;
    if (c.value === 0n) {
      ledger.storage.delete_core_state(ctx, CoreContract.ItemBalanceUserState, BigInt(c.info.id));
      return;
    }
    const state = new CoreContract.ItemBalanceUserState();
    state.id = BigInt(c.info.id);
    if (c.info.kind === 'timed') {
      state.ends_at = t + c.value;
    } else {
      const pair = write_big(c.value);
      state.amount = pair.small;
      state.big_amount = pair.big;
    }
    ledger.storage.put_core_state(ctx, state);
  }

  /** The history rows of `entries`, with the balance after each. */
  private entry_rows(): NewHistoryRow[] {
    const rows: NewHistoryRow[] = [];
    const running = new Map<number, bigint>();
    for (const e of this.entries) {
      const c = this.cell(e.item_id);
      const value = (running.get(e.item_id) ?? c.before) + e.value_delta;
      running.set(e.item_id, value);
      const timed = c.info.kind === 'timed';
      rows.push({
        item_id: e.item_id, delta: e.delta, balance_after: timed ? (value > 0n ? 1n : 0n) : value, overflow: e.overflow, shortfall: e.shortfall,
        source: source_name(e.source), ref: e.ref, once_key: e.once_key, ends_at_after: timed && value > 0n ? this.t + value : 0n,
      });
    }
    return rows;
  }

  /** Records a set balance (`set_balance`): no hooks. */
  set(id: number, value: bigint, source: ChangeSource): void {
    const c = this.cell(id);
    c.touched = true;
    const dur = c.info.kind === 'timed' ? (c.info.timed as GameData.ItemTimedRow).duration : 1n;
    const target = value * dur;
    const value_delta = target - c.value;
    c.value = target;
    const delta = c.info.kind === 'timed' ? floor_div(value_delta, dur) : value_delta;
    if (value_delta !== 0n) {
      this.entries.push({ item_id: id, delta, value_delta, overflow: 0n, shortfall: 0n, source: source.source, ref: source.ref, once_key: '', item_change: true });
    }
    this.save(source);
  }
}
