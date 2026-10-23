/**
 * UserState delta and pending delta (`storage` `### UserState delta`, `### pending delta`).
 */
import * as CoreContract from '../../generated/contract/core_contract.ts';
import type { DbValue } from './db/types.ts';
import { big, bytes, q, StorageMisuse, user_state_of, type FullState, type StorageCore, type TxState } from './core.ts';
import { same_bytes, type Kind } from './kinds.ts';
import { read_item, type StoredRow } from './state.ts';

/** The values a success response carries in `ResponseEnvelope`. */
export interface ResponseDelta {
  readonly user_state: CoreContract.UserStateDelta;
  readonly pending_user_state: CoreContract.UserStateDelta;
  readonly item_changes: CoreContract.ItemChange[];
  readonly item_mails: CoreContract.ItemMail[];
}

/** `take_response_delta`: the response delta and the `kind` column values of the unknown kind rows it skipped. */
export interface TakenDelta {
  readonly delta: ResponseDelta;
  readonly unknown_kinds: string[];
}

/** `read_full_state`'s output. */
export type FullStateResult = FullState;

/** A UserState item named by `kind` column value and item ID. */
interface ItemRef {
  readonly column: string;
  readonly item_id: bigint;
}

/** The JSON object of a `pending_delta` row's `delta`. Item IDs are decimal strings. */
interface PendingJson {
  items: [string, string][];
  item_changes: unknown[];
  item_mails: unknown[];
}

function delta_of(entries: CoreContract.UserStateEntry[], full: boolean): CoreContract.UserStateDelta {
  const delta = new CoreContract.UserStateDelta();
  delta.full = full;
  delta.entries = entries;
  return delta;
}

function entry(kind: Kind, item_id: bigint, value: Uint8Array | null): CoreContract.UserStateEntry {
  const e = new CoreContract.UserStateEntry();
  e.kind = kind.info.name;
  e.id = item_id;
  e.value = value ?? new Uint8Array(0);
  e.deleted = value === null;
  return e;
}

/** Entry order (`contract` `## UserState`): kind order, then upserts by item ID, then deletes by item ID. */
function order(entries: { kind: Kind; entry: CoreContract.UserStateEntry }[]): CoreContract.UserStateEntry[] {
  return [...entries]
    .sort((a, b) => a.kind.order - b.kind.order || Number(a.entry.deleted) - Number(b.entry.deleted) || (a.entry.id < b.entry.id ? -1 : a.entry.id > b.entry.id ? 1 : 0))
    .map((e) => e.entry);
}

function item_key(column: string, item_id: bigint): string {
  return `${column}\u0000${String(item_id)}`;
}

/** Items per statement of `stored_rows`: two parameters each, far under the parameter limits of both DBs. */
const ROWS_PER_READ = 300;

/** The stored `user_state` rows of many items of the transaction's user, one statement per `ROWS_PER_READ` items. */
function stored_rows(state: TxState, items: readonly ItemRef[]): Map<string, StoredRow> {
  const out = new Map<string, StoredRow>();
  for (let start = 0; start < items.length; start += ROWS_PER_READ) {
    const params: DbValue[] = [state.user_id];
    const terms = items.slice(start, start + ROWS_PER_READ).map((item) => {
      params.push(item.column, item.item_id);
      return `(kind = $${String(params.length - 1)} AND item_id = $${String(params.length)})`;
    });
    const rows = q(state, `SELECT kind, item_id, value, contract_version FROM user_state WHERE user_id = $1 AND (${terms.join(' OR ')})`, params);
    for (const row of rows) out.set(item_key(String(row.kind), big(row.item_id)), { value: bytes(row.value), version: big(row.contract_version) });
  }
  return out;
}

/** The stored bytes of an item now; a row of another contract version goes through the read conversion. */
function current_bytes(core: StorageCore, state: TxState, kind: Kind, item_id: bigint, row: StoredRow | null): Uint8Array | null {
  if (row === null) return null;
  if (row.version === core.kinds.version || core.converter === null) return row.value;
  return read_item(core, state, kind, item_id)?.encode() ?? null;
}

/** The UserState items whose stored bytes differ from before the transaction. */
export function changed_items(state: TxState): ItemRef[] {
  const touched = [...state.touched.values()];
  const now = stored_rows(state, touched);
  const out: ItemRef[] = [];
  for (const item of touched) {
    if (!same_bytes(item.initial, now.get(item_key(item.column, item.item_id))?.value ?? null)) out.push({ column: item.column, item_id: item.item_id });
  }
  return out;
}

/** Entries of items at their stored value now; items of unknown kinds are skipped and their columns returned. */
function entries_of(core: StorageCore, state: TxState, items: readonly ItemRef[]): { entries: CoreContract.UserStateEntry[]; unknown: string[] } {
  const known: { kind: Kind; item: ItemRef }[] = [];
  const unknown: string[] = [];
  const seen = new Set<string>();
  for (const item of items) {
    const key = item_key(item.column, item.item_id);
    if (seen.has(key)) continue;
    seen.add(key);
    const kind = core.kinds.of_column(item.column);
    if (kind?.info.store !== 'user_state') {
      unknown.push(item.column);
      continue;
    }
    known.push({ kind, item });
  }
  const rows = stored_rows(state, known.map((k) => k.item));
  const entries = known.map(({ kind, item }) => ({
    kind,
    entry: entry(kind, item.item_id, current_bytes(core, state, kind, item.item_id, rows.get(item_key(item.column, item.item_id)) ?? null)),
  }));
  return { entries: order(entries), unknown };
}

function parse_pending(raw: Uint8Array): PendingJson {
  const value = JSON.parse(new TextDecoder().decode(raw)) as PendingJson;
  if (!Array.isArray(value.items) || !Array.isArray(value.item_changes) || !Array.isArray(value.item_mails)) throw new Error('storage: a pending_delta row is not a pending delta');
  return value;
}

function item_change(json: unknown): CoreContract.ItemChange {
  const change = CoreContract.ItemChange.from_json(json);
  if (change === null) throw new Error('storage: a pending_delta row holds an ItemChange that is not one');
  return change;
}

function item_mail(json: unknown): CoreContract.ItemMail {
  const mail = CoreContract.ItemMail.from_json(json);
  if (mail === null) throw new Error('storage: a pending_delta row holds an ItemMail that is not one');
  return mail;
}

/** Reads and deletes the user's pending delta rows, in `seq` order. */
function drain_pending(state: TxState): { items: ItemRef[]; item_changes: CoreContract.ItemChange[]; item_mails: CoreContract.ItemMail[] } {
  const rows = q(state, 'SELECT delta FROM pending_delta WHERE user_id = $1 ORDER BY seq', [state.user_id]);
  const items: ItemRef[] = [];
  const item_changes: CoreContract.ItemChange[] = [];
  const item_mails: CoreContract.ItemMail[] = [];
  for (const row of rows) {
    const pending = parse_pending(bytes(row.delta));
    for (const [column, id] of pending.items) items.push({ column, item_id: BigInt(id) });
    item_changes.push(...pending.item_changes.map(item_change));
    item_mails.push(...pending.item_mails.map(item_mail));
  }
  if (rows.length > 0) q(state, 'DELETE FROM pending_delta WHERE user_id = $1', [state.user_id]);
  return { items, item_changes, item_mails };
}

function unique_sorted(values: readonly string[]): string[] {
  return [...new Set(values)].sort();
}

/** Stores the delta of an out-of-request change as the user's next pending delta row (before commit). */
export function write_pending(core: StorageCore, state: TxState): void {
  if (state.ctx?.user_deleted === true) return;
  const items = changed_items(state);
  if (items.length === 0 && state.item_changes.length === 0 && state.item_mails.length === 0) return;
  const json: PendingJson = {
    items: items.map((i) => [i.column, String(i.item_id)]),
    item_changes: state.item_changes.map((c) => c.to_json()),
    item_mails: state.item_mails.map((m) => m.to_json()),
  };
  const last = q(state, 'SELECT MAX(seq) AS seq FROM pending_delta WHERE user_id = $1', [state.user_id])[0]?.seq ?? null;
  const seq = last === null ? 1n : big(last) + 1n;
  q(state, 'INSERT INTO pending_delta (user_id, seq, delta, created_at) VALUES ($1, $2, $3, $4)', [
    state.user_id,
    seq,
    new TextEncoder().encode(JSON.stringify(json)),
    core.time.clock_now(),
  ]);
}

function empty_delta(): ResponseDelta {
  return { user_state: delta_of([], false), pending_user_state: delta_of([], false), item_changes: [], item_mails: [] };
}

export function take_response_delta(core: StorageCore, ctx: unknown): TakenDelta {
  const state = user_state_of(core, ctx);
  if (state.taken) throw new StorageMisuse('storage: take_response_delta twice on one ctx');
  state.taken = true;
  if (state.ctx?.user_deleted === true) return { delta: empty_delta(), unknown_kinds: [] };
  if (state.full !== null) {
    const full = state.full;
    return {
      delta: {
        user_state: full.delta,
        pending_user_state: delta_of([], false),
        item_changes: [...full.item_changes, ...state.item_changes],
        item_mails: [...full.item_mails, ...state.item_mails],
      },
      unknown_kinds: full.unknown_kinds,
    };
  }
  const own = entries_of(core, state, changed_items(state));
  const pending = drain_pending(state);
  const queued = entries_of(core, state, pending.items);
  return {
    delta: {
      user_state: delta_of(own.entries, false),
      pending_user_state: delta_of(queued.entries, false),
      item_changes: [...pending.item_changes, ...state.item_changes],
      item_mails: [...pending.item_mails, ...state.item_mails],
    },
    unknown_kinds: unique_sorted([...own.unknown, ...queued.unknown]),
  };
}

export function read_full_state(core: StorageCore, ctx: unknown): FullStateResult {
  const state = user_state_of(core, ctx);
  if (state.taken) throw new StorageMisuse('storage: read_full_state after take_response_delta');
  // One statement reads every value; only a row of another contract version is read again for its conversion.
  const rows = q(state, 'SELECT kind, item_id, value, contract_version FROM user_state WHERE user_id = $1 ORDER BY kind, item_id', [state.user_id]);
  const entries: { kind: Kind; entry: CoreContract.UserStateEntry }[] = [];
  const unknown: string[] = [];
  for (const row of rows) {
    const column = String(row.kind);
    const kind = core.kinds.of_column(column);
    if (kind?.info.store !== 'user_state') {
      unknown.push(column);
      continue;
    }
    const item_id = big(row.item_id);
    const value = current_bytes(core, state, kind, item_id, { value: bytes(row.value), version: big(row.contract_version) });
    if (value !== null) entries.push({ kind, entry: entry(kind, item_id, value) });
  }
  const pending = drain_pending(state);
  const skipped = pending.items.filter((i) => core.kinds.of_column(i.column)?.info.store !== 'user_state').map((i) => i.column);
  const full: FullState = {
    delta: delta_of(order(entries), true),
    item_changes: pending.item_changes,
    item_mails: pending.item_mails,
    unknown_kinds: unique_sorted([...unknown, ...skipped]),
  };
  state.full = full;
  return full;
}
