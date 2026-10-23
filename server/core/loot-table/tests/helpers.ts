/**
 * A test server whose game `rpc` `RunCoreTest` runs a function the test gives inside the request, so loot-table
 * operations run on a real request ctx and its seeded random.
 */
import * as CoreContract from '../../../generated/contract/core_contract.ts';
import * as GameContract from '../../../generated/contract/game_contract.ts';
import * as GameData from '../../../generated/data/game_data.ts';
import type { RequestCtx, Storage } from '../../storage/index.ts';
import {
  load_data, login, read_logs, register_false_judges, register_required_hooks, send, start_test_server, stop_test_server,
} from '../../testing/dev/index.ts';
import type { LootResult, LootSubstitution, LootTableModule } from '../index.ts';

type TestServer = Awaited<ReturnType<typeof start_test_server>>;
type TestSession = Awaited<ReturnType<typeof login>>;

export interface LootServer {
  readonly server: TestServer;
  readonly session: TestSession;
  readonly loot: LootTableModule;
  readonly storage: Storage;
  /** Sends `RunCoreTest` with the seed and returns what `fn` returned inside the request. */
  run<T>(fn: (ctx: RequestCtx) => T, seed?: bigint): Promise<T>;
  /** The `error` log lines of the server. */
  error_logs(): Record<string, unknown>[];
  stop(): Promise<void>;
}

const { data, dev } = load_data();

/** The ID value of an ID name of the core test data. */
export function id(name: string): number {
  const value = dev.find_id_value(name);
  if (value === 0) throw new Error(`${name} is not in the core test data`);
  return value;
}

export { data };

export async function loot_server(settings: Record<string, unknown> = {}): Promise<LootServer> {
  let body: ((ctx: RequestCtx) => unknown) | null = null;
  let result: unknown = undefined;
  const got: { loot: LootTableModule | null; storage: Storage | null } = { loot: null, storage: null };
  const register = (core: Readonly<Record<string, unknown>>): void => {
    got.loot = core['loot-table'] as LootTableModule;
    got.storage = core.storage as Storage;
    const routing = core.routing as { register_handler(name: string, handler: GameContract.RunCoreTestHandler): void };
    routing.register_handler('RunCoreTest', (ctx) => {
      if (body !== null) result = body(ctx);
      return new GameContract.RunCoreTestResponse();
    });
    register_false_judges(core);
    register_required_hooks(core);
  };
  const server = await start_test_server(undefined, undefined, undefined, undefined, undefined, settings, register);
  const session = await login(server, 'loot');
  const { loot, storage } = got;
  if (loot === null || storage === null) throw new Error('register did not run');
  return {
    server,
    session,
    loot,
    storage,
    async run<T>(fn: (ctx: RequestCtx) => T, seed?: bigint): Promise<T> {
      body = fn;
      result = undefined;
      const request = new GameContract.RunCoreTestRequest();
      const { envelope } = await send(session, 'RunCoreTest', request, undefined, undefined, seed);
      body = null;
      if (envelope.error !== null) throw new Error(`RunCoreTest failed with code ${String(envelope.error.code)}`);
      return result as T;
    },
    error_logs: () => read_logs(server, 'error', 'error'),
    stop: () => stop_test_server(server),
  };
}

/** A loot table's rows in roll order: `Guaranteed` by `order`, then `Weighted` by `order`. */
function rows_in_roll_order(table_id: number): { guaranteed: GameData.LootTableRow[]; weighted: GameData.LootTableRow[] } {
  const rows = [...data.LootTableTable.get_rows(table_id)].sort((a, b) => a.order - b.order);
  return {
    guaranteed: rows.filter((r) => r.kind === GameData.LootEntryKind.Guaranteed),
    weighted: rows.filter((r) => r.kind === GameData.LootEntryKind.Weighted),
  };
}

export function path_key(path: readonly { table_id: number; order: number }[]): string {
  return path.map((p) => `${String(p.table_id)}:${String(p.order)}`).join('/');
}

/**
 * Walks `loot-table` `### roll order` from the first table with the result's picks and checks that `tables` and
 * `entries` are in that order: every `Guaranteed` entry, then one `Weighted` entry when the table has one, each
 * followed by its nested table. Returns the path of every picked entry.
 */
export function replay(first: number, result: LootResult, substitutions: readonly LootSubstitution[] = []): string[] {
  const subs = new Map(substitutions);
  const tables: number[] = [];
  const keys: string[] = [];
  let next = 0;
  const take = (rolled: number, row: GameData.LootTableRow, path: readonly CoreContract.LootPathEntry[]): void => {
    const entry = result.entries[next];
    if (entry === undefined || entry.table_id !== rolled || entry.order !== row.order) {
      throw new Error(`entry ${String(next)} is ${JSON.stringify(entry)}, not ${String(rolled)}:${String(row.order)}`);
    }
    next++;
    const here = [...path, entry];
    keys.push(path_key(here));
    if (row.table !== 0) walk(row.table, here);
  };
  const walk = (about: number, path: readonly CoreContract.LootPathEntry[]): void => {
    const rolled = subs.get(about) ?? about;
    tables.push(rolled);
    const { guaranteed, weighted } = rows_in_roll_order(rolled);
    for (const row of guaranteed) take(rolled, row, path);
    if (weighted.length > 0) {
      const entry = result.entries[next];
      const row = weighted.find((r) => entry !== undefined && entry.table_id === rolled && r.order === entry.order);
      if (row === undefined) throw new Error(`entry ${String(next)} is ${JSON.stringify(entry)}, not a Weighted entry of ${String(rolled)}`);
      take(rolled, row, path);
    }
  };
  walk(first, []);
  if (next !== result.entries.length) throw new Error(`${String(result.entries.length - next)} entries are left over`);
  if (JSON.stringify(tables) !== JSON.stringify(result.tables)) throw new Error(`tables ${JSON.stringify(result.tables)} are not ${JSON.stringify(tables)}`);
  return keys;
}

/** An `ItemAmount` as `[item ID value, amount]`. */
export function amounts(items: readonly CoreContract.ItemAmount[]): [number, bigint][] {
  return items.map((item) => [item.item_id, item.big_amount !== '' ? BigInt(item.big_amount) : item.amount]);
}

export function item(item_id: number, amount: bigint): CoreContract.ItemAmount {
  const made = new CoreContract.ItemAmount();
  made.item_id = item_id;
  if (amount <= 2n ** 53n - 1n) made.amount = amount;
  else made.big_amount = amount.toString();
  return made;
}

/** A `LootResult` that only has items, for `sum_items`. */
export function result_of(items: readonly CoreContract.ItemAmount[]): LootResult {
  return { tables: [], entries: [], items: [...items] };
}
