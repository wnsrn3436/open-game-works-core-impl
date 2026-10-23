/**
 * loot-table: rolls weighted reward tables defined in data with the ctx random, computes the probability of each
 * result from the same data, and gives the client the probabilities of public loot tables. Granting the rolled
 * items is the caller's job (`item-ledger`).
 */
import * as CoreContract from '../../generated/contract/core_contract.ts';
import * as GameData from '../../generated/data/game_data.ts';
import type { ItemLedger } from '../item-ledger/index.ts';
import type { RequestCtx, Storage } from '../storage/index.ts';

/** The `storage` operation loot-table calls. */
export type LootStorage = Pick<Storage, 'random_weighted'>;

/** The `item-ledger` operations loot-table calls. */
export type LootItemLedger = Pick<ItemLedger, 'amount_limit' | 'read_amount' | 'make_item_amount'>;

/** A `logging` log entry (`logging` `## API`); `write` adds `time`. */
export interface LootLogEntry {
  readonly kind: 'error';
  readonly level: 'error';
  readonly message: string;
  readonly user_id: bigint | null;
  readonly request_id: string | null;
  readonly request: string | null;
  readonly fields: Readonly<Record<string, string | number | boolean>>;
}

/** The `logging` operation loot-table calls. */
export interface LootLogging {
  write(entry: LootLogEntry): void;
}

/** The module input (`server-core` `## module`). */
export interface LootTableInput {
  readonly settings: Readonly<Record<string, unknown>>;
  readonly modules: Readonly<Record<string, unknown>>;
}

/** A `LootRollResult` failure element. */
export type LootRollFailure = 'UNKNOWN_TABLE' | 'INVALID_COUNT' | 'INVALID_INPUT' | 'AMOUNT_OVERFLOW';

/** A substitution list entry: `[from loot table ID value, to loot table ID value]`. */
export type LootSubstitution = readonly [number, number];

/** The result of one roll. */
export interface LootResult {
  /** Rolled loot table ID values in roll order; a substituted table is its to table. */
  readonly tables: number[];
  /** Picked entries `(table_id, order)` in pick order. */
  readonly entries: CoreContract.LootPathEntry[];
  /** The picked entries' items merged, by item ID value ascending. */
  readonly items: CoreContract.ItemAmount[];
}

/** The output of a `roll` that succeeds. */
export interface LootRollOk {
  readonly result: 'OK';
  /** One per roll, in roll order. */
  readonly results: LootResult[];
}

export interface LootTableModule {
  begin_start(): void;
  complete_start(): string | null;
  stop(): void;
  roll(ctx: RequestCtx, table_id: number, count: number, substitutions?: readonly LootSubstitution[]): LootRollOk | LootRollFailure;
  sum_items(results: readonly LootResult[]): CoreContract.ItemAmount[] | 'AMOUNT_OVERFLOW';
  get_rates(ctx: RequestCtx, table_id: number, substitutions?: readonly LootSubstitution[]): CoreContract.LootRate[];
  /** The core `rpc` `core/GetLootRates` handler. */
  GetLootRates(ctx: RequestCtx, request: CoreContract.GetLootRatesRequest): CoreContract.GetLootRatesResponse | CoreContract.CoreError;
}

/** The number of cached cycle check results per data; the cache is cleared when it is full. */
const CYCLE_CACHE_SIZE = 1024;

function integer_setting(settings: Readonly<Record<string, unknown>>, key: string, min: number): number {
  const value = settings[key];
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min) {
    throw new Error(`loot-table: setting ${key} is not an integer of at least ${String(min)}`);
  }
  return value;
}

function module_of<T>(modules: Readonly<Record<string, unknown>>, name: string, member: keyof T & string): T {
  const module = modules[name] as Record<string, unknown> | undefined | null;
  if (module === undefined || module === null || typeof module[member] !== 'function') throw new Error(`loot-table: module ${name} is not in the module input`);
  return module as T;
}

function path_entry(table_id: number, order: number): CoreContract.LootPathEntry {
  const entry = new CoreContract.LootPathEntry();
  entry.table_id = table_id;
  entry.order = order;
  return entry;
}

/** The entries of a table in roll order: `Guaranteed` by `order`, then `Weighted` by `order`. */
interface Entries {
  readonly guaranteed: readonly GameData.LootTableRow[];
  readonly weighted: readonly GameData.LootTableRow[];
  /** The `weight` sum of the `Weighted` entries. */
  readonly total: bigint;
}

export function create_loot_table(input: LootTableInput): LootTableModule {
  const max_roll_count = integer_setting(input.settings, 'loot-table.maxRollCount', 1);
  const storage = module_of<LootStorage>(input.modules, 'storage', 'random_weighted');
  const logging = module_of<LootLogging>(input.modules, 'logging', 'write');
  const ledger = module_of<LootItemLedger>(input.modules, 'item-ledger', 'amount_limit');
  const entries_cache = new WeakMap<GameData.DataSet, Map<number, Entries>>();
  /** The cycle check result per first table and substitution list, so repeated rolls with one list check it once. */
  const cycle_cache = new WeakMap<GameData.DataSet, Map<string, number | null>>();

  function entries_of(data: GameData.DataSet, table_id: number): Entries {
    let by_table = entries_cache.get(data);
    if (by_table === undefined) {
      by_table = new Map();
      entries_cache.set(data, by_table);
    }
    const cached = by_table.get(table_id);
    if (cached !== undefined) return cached;
    const rows = [...data.LootTableTable.get_rows(table_id)].sort((a, b) => a.order - b.order);
    const weighted = rows.filter((r) => r.kind === GameData.LootEntryKind.Weighted);
    const made: Entries = {
      guaranteed: rows.filter((r) => r.kind === GameData.LootEntryKind.Guaranteed),
      weighted,
      total: weighted.reduce((sum, r) => sum + BigInt(r.weight), 0n),
    };
    by_table.set(table_id, made);
    return made;
  }

  /** The amount of an `ItemAmount` of the data or of a `LootResult`; both have only big integers in `big_amount`. */
  function amount_of(item: CoreContract.ItemAmount): bigint {
    const amount = ledger.read_amount(item);
    if (amount === null) throw new Error(`loot-table: item ${String(item.item_id)} has an amount that is not a big integer`);
    return amount;
  }

  /** Adds items to per-item sums. */
  function add_items(sums: Map<number, bigint>, items: readonly CoreContract.ItemAmount[]): void {
    for (const item of items) sums.set(item.item_id, (sums.get(item.item_id) ?? 0n) + amount_of(item));
  }

  /** Sums as `ItemAmount` by item ID value ascending, or the first item over its `item-ledger` amount limit. */
  function merged(sums: ReadonlyMap<number, bigint>): CoreContract.ItemAmount[] | { readonly over: number } {
    const ids = [...sums.keys()].sort((a, b) => a - b);
    for (const id of ids) if ((sums.get(id) as bigint) > ledger.amount_limit(id)) return { over: id };
    return ids.map((id) => ledger.make_item_amount(id, sums.get(id) as bigint));
  }

  function log_error(ctx: RequestCtx | null, message: string, fields: Record<string, string | number | boolean>): void {
    logging.write({
      kind: 'error',
      level: 'error',
      message,
      user_id: ctx?.user_id ?? null,
      request_id: ctx === null || ctx.request_id === '' ? null : ctx.request_id,
      request: ctx === null || ctx.request_name === '' ? null : ctx.request_name,
      fields,
    });
  }

  /**
   * Checks a first table and a substitution list before any random is used. Returns the substitution map, or the
   * failure and the log fields.
   */
  function prepare(
    data: GameData.DataSet,
    table_id: number,
    substitutions: readonly LootSubstitution[] | undefined,
  ): Map<number, number> | { readonly failure: 'UNKNOWN_TABLE' | 'INVALID_INPUT'; readonly message: string; readonly fields: Record<string, number> } {
    const known = (id: number): boolean => Number.isInteger(id) && data.LootTableTable.has_rows(id);
    if (!known(table_id)) return { failure: 'UNKNOWN_TABLE', message: 'loot table is not in loot_table', fields: { loot_table_id: table_id } };
    const subs = new Map<number, number>();
    for (const [from, to] of substitutions ?? []) {
      if (!known(from) || !known(to)) {
        return { failure: 'UNKNOWN_TABLE', message: 'substitution table is not in loot_table', fields: { loot_table_id: table_id, from_table_id: from, to_table_id: to } };
      }
      if (subs.has(from)) return { failure: 'INVALID_INPUT', message: 'substitution list has the same from table twice', fields: { loot_table_id: table_id, from_table_id: from } };
      subs.set(from, to);
    }
    // Without substitutions the graph is the data's, which the data check `cycle` keeps acyclic.
    if (subs.size === 0) return subs;
    const key = `${String(table_id)}|${[...subs].map(([from, to]) => `${String(from)}>${String(to)}`).join(',')}`;
    let by_key = cycle_cache.get(data);
    if (by_key === undefined) {
      by_key = new Map();
      cycle_cache.set(data, by_key);
    }
    let back = by_key.get(key);
    if (back === undefined) {
      back = cycle_from(data, table_id, subs);
      if (by_key.size >= CYCLE_CACHE_SIZE) by_key.clear();
      by_key.set(key, back);
    }
    if (back !== null) return { failure: 'INVALID_INPUT', message: 'substitution list makes a cycle', fields: { loot_table_id: table_id, cycle_table_id: back } };
    return subs;
  }

  /** A table on a cycle reachable from the first table in the graph with the substitutions applied, or `null`. */
  function cycle_from(data: GameData.DataSet, table_id: number, subs: ReadonlyMap<number, number>): number | null {
    const state = new Map<number, 1 | 2>();
    const visit = (rolled: number): number | null => {
      state.set(rolled, 1);
      const { guaranteed, weighted } = entries_of(data, rolled);
      for (const entry of [...guaranteed, ...weighted]) {
        if (entry.table === 0) continue;
        const next = subs.get(entry.table) ?? entry.table;
        const seen = state.get(next);
        if (seen === 1) return next;
        if (seen === undefined) {
          const found = visit(next);
          if (found !== null) return found;
        }
      }
      state.set(rolled, 2);
      return null;
    };
    return visit(subs.get(table_id) ?? table_id);
  }

  function roll(ctx: RequestCtx, table_id: number, count: number, substitutions?: readonly LootSubstitution[]): LootRollOk | LootRollFailure {
    if (!Number.isInteger(count) || count < 1 || count > max_roll_count) {
      log_error(ctx, 'roll count is out of range', { loot_table_id: table_id, count: Number.isFinite(count) ? count : String(count) });
      return 'INVALID_COUNT';
    }
    const data = ctx.data;
    const prepared = prepare(data, table_id, substitutions);
    if (!(prepared instanceof Map)) {
      log_error(ctx, prepared.message, prepared.fields);
      return prepared.failure;
    }
    const subs = prepared;
    const results: LootResult[] = [];
    for (let i = 0; i < count; i++) {
      const tables: number[] = [];
      const entries: CoreContract.LootPathEntry[] = [];
      const sums = new Map<number, bigint>();
      const roll_table = (about: number): void => {
        const rolled = subs.get(about) ?? about;
        tables.push(rolled);
        const { guaranteed, weighted } = entries_of(data, rolled);
        const picked = [...guaranteed];
        if (weighted.length > 0) picked.push(weighted[storage.random_weighted(ctx, weighted.map((r) => r.weight))] as GameData.LootTableRow);
        for (const entry of picked) {
          entries.push(path_entry(rolled, entry.order));
          add_items(sums, entry.items);
          if (entry.table !== 0) roll_table(entry.table);
        }
      };
      roll_table(table_id);
      const items = merged(sums);
      if (!Array.isArray(items)) {
        log_error(ctx, 'roll item amount is over the amount limit', { loot_table_id: table_id, item_id: items.over });
        return 'AMOUNT_OVERFLOW';
      }
      results.push({ tables, entries, items });
    }
    return { result: 'OK', results };
  }

  function sum_items(results: readonly LootResult[]): CoreContract.ItemAmount[] | 'AMOUNT_OVERFLOW' {
    const sums = new Map<number, bigint>();
    for (const result of results) add_items(sums, result.items);
    const items = merged(sums);
    if (Array.isArray(items)) return items;
    log_error(null, 'sum_items amount is over the amount limit', { item_id: items.over });
    return 'AMOUNT_OVERFLOW';
  }

  function get_rates(ctx: RequestCtx, table_id: number, substitutions?: readonly LootSubstitution[]): CoreContract.LootRate[] {
    const data = ctx.data;
    const prepared = prepare(data, table_id, substitutions);
    if (!(prepared instanceof Map)) {
      log_error(ctx, prepared.message, prepared.fields);
      return [];
    }
    const subs = prepared;
    const rates: CoreContract.LootRate[] = [];
    const walk = (about: number, path: readonly CoreContract.LootPathEntry[], numerator: bigint, denominator: bigint): void => {
      const rolled = subs.get(about) ?? about;
      const { guaranteed, weighted, total } = entries_of(data, rolled);
      const step = (entry: GameData.LootTableRow, n: bigint, d: bigint): void => {
        const rate = new CoreContract.LootRate();
        rate.path = [...path.map((p) => path_entry(p.table_id, p.order)), path_entry(rolled, entry.order)];
        rate.items = entry.items.map((item) => ledger.make_item_amount(item.item_id, amount_of(item)));
        rate.numerator = n;
        rate.denominator = d;
        rates.push(rate);
        if (entry.table !== 0) walk(entry.table, rate.path, n, d);
      };
      for (const entry of guaranteed) step(entry, numerator, denominator);
      for (const entry of weighted) step(entry, numerator * BigInt(entry.weight), denominator * total);
    };
    walk(table_id, [], 1n, 1n);
    return rates;
  }

  function GetLootRates(ctx: RequestCtx, request: CoreContract.GetLootRatesRequest): CoreContract.GetLootRatesResponse | CoreContract.CoreError {
    if (!ctx.data.PublicLootTableTable.has_row(request.loot_table_id)) return CoreContract.CoreError.CORE_ERROR_INVALID_REQUEST;
    const response = new CoreContract.GetLootRatesResponse();
    response.rates = get_rates(ctx, request.loot_table_id);
    return response;
  }

  return {
    begin_start: () => undefined,
    complete_start: () => null,
    stop: () => undefined,
    roll,
    sum_items,
    get_rates,
    GetLootRates,
  };
}
