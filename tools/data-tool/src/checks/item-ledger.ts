/** Data checks of `item-ledger` `## data`: the item tables, the item kind rule and item list columns. */
import type { ModuleCheck, ModuleCheckInput } from '../module-check.ts';
import { cellPlace, column, rowPlace, type Column, type Row, type Table } from '../model.ts';
import { isItemAmountList, type ColumnType } from '../types.ts';
import type { Value } from '../values.ts';

const MAX_SAFE = 2n ** 53n - 1n;
const KIND_TABLES = ['item_recovery', 'item_group', 'item_timed', 'item_big'] as const;
const ITEM_TABLES: ReadonlySet<string> = new Set(['item', 'item_overflow', ...KIND_TABLES]);
/** Core table columns that `subtract_items` takes items from. */
const COST_COLUMNS: ReadonlySet<string> = new Set([
  'shop_product.cost', 'gacha_banner.single_cost', 'gacha_banner.multi_cost', 'gacha_banner.ticket_item', 'nickname_cost.cost',
]);

interface Item {
  readonly row: Row;
  readonly max_amount: bigint | null;
  readonly overflow: string | null;
}

function idName(v: Value | undefined): string | null {
  return v?.k === 'idname' ? v.name : null;
}

function int(v: Value | undefined): bigint | null {
  return v?.k === 'int' ? v.v : null;
}

function rows(input: ModuleCheckInput, name: string): { table: Table; rows: Row[] } | null {
  const table = input.data.tables.get(name);
  return table ? { table, rows: table.rows } : null;
}

/** Every `ref<item.id>` ID name in a value of a type, with nothing for the other parts. */
function itemRefs(type: ColumnType | null, v: Value | undefined): string[] {
  if (!type || !v) return [];
  switch (type.k) {
    case 'ref': return type.table === 'item' && type.column === 'id' && v.k === 'idname' ? [v.name] : [];
    case 'array':
    case 'array2': return v.k === 'list' ? v.items.flatMap((i) => itemRefs(type.elem, i)) : [];
    case 'bundle':
      if (v.k !== 'list') return [];
      return v.items.flatMap((i) => (i.k === 'tuple' ? type.fields.flatMap((f, n) => itemRefs(f.type, i.fields[n])) : []));
    default: return [];
  }
}

function hasItemRef(type: ColumnType | null): boolean {
  if (!type) return false;
  switch (type.k) {
    case 'ref': return type.table === 'item' && type.column === 'id';
    case 'array':
    case 'array2': return hasItemRef(type.elem);
    case 'bundle': return type.fields.some((f) => hasItemRef(f.type));
    default: return false;
  }
}

/** What the checks of one data set share: the items and the kind tables each item has a row in. */
interface Scope {
  readonly input: ModuleCheckInput;
  readonly items: ReadonlyMap<string, Item>;
  /** The kind tables each item has a row in. */
  readonly kinds: ReadonlyMap<string, readonly string[]>;
  /** The rows of `item_overflow` and the kind tables by ID name. */
  readonly kindRows: ReadonlyMap<string, ReadonlyMap<string, Row>>;
}

type Place = ReturnType<typeof cellPlace>;

/** The first kind table of an item, or null for an item in none. */
function kindOf(scope: Scope, id: string): string | null {
  return (scope.kinds.get(id) ?? [])[0] ?? null;
}

function isGroupTimedOrBig(scope: Scope, id: string): boolean {
  const k = kindOf(scope, id);
  return k === 'item_group' || k === 'item_timed' || k === 'item_big';
}

/** The place of a cell of a row, or of the row when the table has no such column. */
function placeOf(table: Table, row: Row, name: string): Place {
  const col = column(table, name);
  return col ? cellPlace(table, row, col) : rowPlace(table, row);
}

/** Every row of a table with an ID name `id`. */
function idRows(input: ModuleCheckInput, name: string): { table: Table; row: Row; id: string }[] {
  const t = rows(input, name);
  if (!t) return [];
  const out: { table: Table; row: Row; id: string }[] = [];
  for (const row of t.rows) {
    const id = idName(row.values.get('id'));
    if (id !== null) out.push({ table: t.table, row, id });
  }
  return out;
}

/** The `item` rows, checking `max_amount`. */
function readItems(input: ModuleCheckInput, itemTable: { table: Table; rows: Row[] }): Map<string, Item> {
  const items = new Map<string, Item>();
  const maxCol = column(itemTable.table, 'max_amount');
  for (const { row, id } of idRows(input, 'item')) {
    const max = int(row.values.get('max_amount'));
    const ov = row.values.get('overflow');
    items.set(id, { row, max_amount: max, overflow: ov?.k === 'enum' ? ov.element : null });
    if (max !== null && maxCol && (max < 1n || max > MAX_SAFE)) {
      input.report('out_of_range', cellPlace(itemTable.table, row, maxCol), `item.max_amount ${max.toString()} of ${id} is not 1 to 2^53-1`);
    }
  }
  return items;
}

/** The rows of `item_overflow` and the kind tables, checking that each is an item. */
function readKinds(input: ModuleCheckInput, items: ReadonlyMap<string, Item>): Pick<Scope, 'kinds' | 'kindRows'> {
  const kinds = new Map<string, string[]>();
  const kindRows = new Map<string, Map<string, Row>>();
  for (const name of ['item_overflow', ...KIND_TABLES]) {
    const byId = new Map<string, Row>();
    kindRows.set(name, byId);
    for (const { table, row, id } of idRows(input, name)) {
      byId.set(id, row);
      if (!items.has(id)) input.report('ref_missing', rowPlace(table, row), `${name}.id ${id} is not in the item table`);
      if (name !== 'item_overflow') kinds.set(id, [...(kinds.get(id) ?? []), name]);
    }
  }
  return { kinds, kindRows };
}

/** The item kind rule: one kind table at most. */
function checkKindOverlap(scope: Scope): void {
  for (const name of KIND_TABLES) {
    for (const { table, row, id } of idRows(scope.input, name)) {
      if ((scope.kinds.get(id)?.length ?? 0) > 1) scope.input.report('out_of_range', rowPlace(table, row), `${id} is in more than one of ${KIND_TABLES.join(', ')}`);
    }
  }
}

/** `item_overflow`: a row for each `Convert` item, and the rules of each row. */
function checkOverflow(scope: Scope, itemTable: Table): void {
  const overflowCol = column(itemTable, 'overflow');
  const overflowRows = scope.kindRows.get('item_overflow') ?? new Map<string, Row>();
  if (overflowCol) {
    for (const [id, item] of scope.items) {
      if (item.overflow === 'Convert' && !overflowRows.has(id)) {
        scope.input.report('required_missing', cellPlace(itemTable, item.row, overflowCol), `${id} has overflow Convert and no item_overflow row`);
      }
    }
  }
  for (const { table, row, id } of idRows(scope.input, 'item_overflow')) checkOverflowRow(scope, table, row, id);
}

function checkOverflowRow(scope: Scope, table: Table, row: Row, id: string): void {
  const { input } = scope;
  const place = rowPlace(table, row);
  const item = scope.items.get(id);
  if (item && item.overflow !== 'Convert') input.report('out_of_range', place, `item_overflow row ${id} is not an item with overflow Convert`);
  if (isGroupTimedOrBig(scope, id)) input.report('out_of_range', place, `item_overflow row ${id} is a group, timed or big item`);
  const convertCol = column(table, 'convert_to');
  if (!convertCol) return;
  const cell = cellPlace(table, row, convertCol);
  const v = row.values.get('convert_to');
  if (v?.k === 'list' && v.items.length === 0) input.report('empty_required', cell, `item_overflow.convert_to of ${id} is empty`);
  for (const target of itemRefs(convertCol.type, v)) {
    if (target === id) input.report('cycle', cell, `item_overflow.convert_to of ${id} has ${id} itself`);
    if (scope.items.get(target)?.overflow === 'Convert') input.report('out_of_range', cell, `item_overflow.convert_to of ${id} has ${target}, an item with overflow Convert`);
    if (isGroupTimedOrBig(scope, target)) input.report('out_of_range', cell, `item_overflow.convert_to of ${id} has ${target}, a group, timed or big item`);
  }
}

/** `item_recovery`: the ranges of each row. */
function checkRecoveryRow(scope: Scope, table: Table, row: Row, id: string): void {
  const { input } = scope;
  const max = scope.items.get(id)?.max_amount ?? null;
  const interval = int(row.values.get('recovery_interval'));
  const amount = int(row.values.get('recovery_amount'));
  const cap = int(row.values.get('recovery_cap'));
  const initial = int(row.values.get('initial_amount'));
  if (interval !== null && interval < 1n) input.report('out_of_range', placeOf(table, row, 'recovery_interval'), `item_recovery.recovery_interval of ${id} is less than 1`);
  if (amount !== null && amount < 1n) input.report('out_of_range', placeOf(table, row, 'recovery_amount'), `item_recovery.recovery_amount of ${id} is less than 1`);
  if (cap !== null && (cap < 1n || (max !== null && cap > max))) input.report('out_of_range', placeOf(table, row, 'recovery_cap'), `item_recovery.recovery_cap of ${id} is not 1 to its max_amount`);
  if (initial !== null && (initial < 0n || (max !== null && initial > max))) {
    input.report('out_of_range', placeOf(table, row, 'initial_amount'), `item_recovery.initial_amount of ${id} is not 0 to its max_amount`);
  }
  checkCapBonus(scope, table, row, id, cap, max);
}

/** `item_recovery.cap_bonus_item`: not a kind item, and `recovery_cap` + its `max_amount` within the recovery item's. */
function checkCapBonus(scope: Scope, table: Table, row: Row, id: string, cap: bigint | null, max: bigint | null): void {
  const { input } = scope;
  const bonus = idName(row.values.get('cap_bonus_item'));
  if (bonus === null) return;
  const at = placeOf(table, row, 'cap_bonus_item');
  if (kindOf(scope, bonus) !== null) input.report('out_of_range', at, `item_recovery.cap_bonus_item ${bonus} of ${id} is a recovery, group, timed or big item`);
  const bonusMax = scope.items.get(bonus)?.max_amount ?? null;
  if (cap !== null && bonusMax !== null && max !== null && cap + bonusMax > max) {
    input.report('out_of_range', at, `item_recovery.recovery_cap of ${id} plus the max_amount of ${bonus} is over its max_amount`);
  }
}

/** `item_group`: the members of each row and the group item's `max_amount`. */
function checkGroupRow(scope: Scope, table: Table, row: Row, id: string): void {
  const { input } = scope;
  const membersCol = column(table, 'members');
  if (!membersCol) return;
  const cell = cellPlace(table, row, membersCol);
  const members = itemRefs(membersCol.type, row.values.get('members'));
  if (members.length === 0) input.report('out_of_range', cell, `item_group.members of ${id} is empty`);
  if (new Set(members).size !== members.length) input.report('out_of_range', cell, `item_group.members of ${id} has an item twice`);
  const sum = memberMaxSum(scope, cell, id, members);
  const max = scope.items.get(id)?.max_amount ?? null;
  if (sum !== null && max !== null && members.length > 0 && (max !== sum || sum > MAX_SAFE)) {
    input.report('out_of_range', rowPlace(table, row), `max_amount of group item ${id} is not the sum ${sum.toString()} of its members' max_amount, or is over 2^53-1`);
  }
}

/** Checks each member item; the sum of their `max_amount`, or null when one is not known. */
function memberMaxSum(scope: Scope, cell: Place, id: string, members: readonly string[]): bigint | null {
  let sum: bigint | null = 0n;
  for (const m of members) {
    if (m === id) scope.input.report('out_of_range', cell, `item_group.members of ${id} has ${id} itself`);
    else if (kindOf(scope, m) !== null) scope.input.report('out_of_range', cell, `item_group.members of ${id} has ${m}, a recovery, group, timed or big item`);
    const mm = scope.items.get(m)?.max_amount ?? null;
    sum = sum === null || mm === null ? null : sum + mm;
  }
  return sum;
}

/** The `overflow` of a timed or big item: `Reject` or `Discard`. */
function checkRejectOrDiscard(scope: Scope, table: Table, row: Row, id: string, what: string): void {
  const item = scope.items.get(id);
  if (item && item.overflow !== null && item.overflow !== 'Reject' && item.overflow !== 'Discard') {
    scope.input.report('out_of_range', rowPlace(table, row), `${what} ${id} has overflow ${item.overflow}, not Reject or Discard`);
  }
}

/** `item_timed`: `duration` and the item's `max_amount` × `duration`. */
function checkTimedRow(scope: Scope, table: Table, row: Row, id: string): void {
  const item = scope.items.get(id);
  const duration = int(row.values.get('duration'));
  const place = placeOf(table, row, 'duration');
  if (duration !== null && duration < 1n) scope.input.report('out_of_range', place, `item_timed.duration of ${id} is less than 1`);
  if (duration !== null && item?.max_amount != null && item.max_amount * duration > MAX_SAFE) {
    scope.input.report('out_of_range', place, `max_amount × duration of timed item ${id} is over 2^53-1`);
  }
  checkRejectOrDiscard(scope, table, row, id, 'timed item');
}

/** `item_big`: `max_digits` and the item's `max_amount`. `limit` is `item-ledger.bigMaxDigits` when the settings give it. */
function checkBigRow(scope: Scope, table: Table, row: Row, id: string, limit: unknown): void {
  const item = scope.items.get(id);
  const digits = int(row.values.get('max_digits'));
  if (digits !== null && (digits < 16n || (typeof limit === 'number' && digits > BigInt(limit)))) {
    scope.input.report('out_of_range', placeOf(table, row, 'max_digits'), `item_big.max_digits of ${id} is not 16 to item-ledger.bigMaxDigits`);
  }
  if (item?.max_amount != null && item.max_amount !== MAX_SAFE) scope.input.report('out_of_range', rowPlace(table, row), `max_amount of big item ${id} is not 2^53-1`);
  checkRejectOrDiscard(scope, table, row, id, 'big item');
}

function bigMaxDigits(input: ModuleCheckInput): unknown {
  const coreSettings = input.settings['core'];
  return typeof coreSettings === 'object' && coreSettings !== null ? (coreSettings as Record<string, unknown>)['item-ledger.bigMaxDigits'] : undefined;
}

/** Item columns of core tables (group items only in cost columns, timed items never in them) and item list cells. */
function checkItemColumns(scope: Scope): void {
  const bigRows = scope.kindRows.get('item_big') ?? new Map<string, Row>();
  for (const table of scope.input.data.tables.values()) {
    const core = scope.input.coreTables.has(table.name) && !ITEM_TABLES.has(table.name);
    for (const col of table.columns) {
      const list = isItemAmountList(col.type);
      if (core && hasItemRef(col.type)) checkCoreItemColumn(scope, table, col);
      if (list) for (const row of table.rows) checkItemList(scope.input, table, row, col, row.values.get(col.name), scope.items, bigRows);
    }
  }
}

function checkCoreItemColumn(scope: Scope, table: Table, col: Column): void {
  const cost = COST_COLUMNS.has(`${table.name}.${col.name}`);
  const kind = cost ? 'item_timed' : 'item_group';
  for (const row of table.rows) {
    for (const id of itemRefs(col.type, row.values.get(col.name))) {
      if (!(scope.kinds.get(id)?.includes(kind) ?? false)) continue;
      const message = cost ? `${table.name}.${col.name} is a cost column and has timed item ${id}` : `${table.name}.${col.name} is not a cost column and has group item ${id}`;
      scope.input.report('out_of_range', cellPlace(table, row, col), message);
    }
  }
}

export const check: ModuleCheck = (input) => {
  const itemTable = rows(input, 'item');
  if (!itemTable) return;
  const items = readItems(input, itemTable);
  const scope: Scope = { input, items, ...readKinds(input, items) };
  checkKindOverlap(scope);
  checkOverflow(scope, itemTable.table);
  for (const { table, row, id } of idRows(input, 'item_recovery')) checkRecoveryRow(scope, table, row, id);
  for (const { table, row, id } of idRows(input, 'item_group')) checkGroupRow(scope, table, row, id);
  for (const { table, row, id } of idRows(input, 'item_timed')) checkTimedRow(scope, table, row, id);
  const limit = bigMaxDigits(input);
  for (const { table, row, id } of idRows(input, 'item_big')) checkBigRow(scope, table, row, id, limit);
  checkItemColumns(scope);
};

/** An item list cell: no item twice, every amount 1 or more and at most the item's amount limit. */
function checkItemList(input: ModuleCheckInput, table: Table, row: Row, col: Column, v: Value | undefined, items: ReadonlyMap<string, Item>, bigRows: ReadonlyMap<string, Row>): void {
  if (v?.k !== 'list') return;
  const place = cellPlace(table, row, col);
  const seen = new Set<string>();
  for (const entry of v.items) {
    if (entry.k !== 'tuple') continue;
    const id = idName(entry.fields[0]);
    const amount = int(entry.fields[1]);
    if (id === null || amount === null) continue;
    if (seen.has(id)) input.report('value_type', place, `${table.name}.${col.name} has ${id} twice`);
    seen.add(id);
    if (amount < 1n) {
      input.report('value_type', place, `${table.name}.${col.name} has amount ${amount.toString()} of ${id}, less than 1`);
      continue;
    }
    if (!items.has(id)) continue;
    const digits = int(bigRows.get(id)?.values.get('max_digits'));
    const limit = digits !== null ? 10n ** digits - 1n : MAX_SAFE;
    if (amount > limit) input.report('out_of_range', place, `${table.name}.${col.name} has amount ${amount.toString()} of ${id}, over its amount limit`);
  }
}
