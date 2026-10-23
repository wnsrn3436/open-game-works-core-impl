/**
 * `core-spec.json` (`core` command.md `## core spec file`) and the core data a game gets from it (`data` skill
 * `## core data`).
 */
import { parseColumnType, refsOf, enumsOf, type BuildTarget } from './types.ts';

export interface SpecColumn {
  description: string;
  target: BuildTarget;
  type: string;
  name: string;
}

export interface SpecTable {
  name: string;
  columns: SpecColumn[];
}

export interface SpecReserved {
  table: 'reserved_id' | 'reserved_string' | 'reserved_sound';
  id: string;
  requiredWhen: { path: string; value: unknown } | null;
  rowOf: string | null;
}

export interface SpecFormatArgument {
  name: string;
  kind: 'integer' | 'real' | 'string';
}

export interface SpecModule {
  name: string;
  side: 'client' | 'server';
  tables: SpecTable[];
  usedTables: string[];
  enums: { type: string; elements: string[] }[];
  invariants: Record<string, string>[];
  reserved: SpecReserved[];
  formatArguments: { text: string; arguments: SpecFormatArgument[] }[];
}

export interface CoreSpec {
  version: string;
  modules: SpecModule[];
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function strings(v: unknown): string[] | null {
  return Array.isArray(v) && v.every((x) => typeof x === 'string') ? v : null;
}

function readColumns(v: unknown): SpecColumn[] | null {
  if (!Array.isArray(v)) return null;
  const out: SpecColumn[] = [];
  for (const c of v as unknown[]) {
    if (!isObject(c) || typeof c.name !== 'string' || typeof c.type !== 'string' || typeof c.target !== 'string') return null;
    if (!['Client', 'Server', 'All', 'None'].includes(c.target)) return null;
    out.push({ description: typeof c.description === 'string' ? c.description : '', target: c.target as BuildTarget, type: c.type, name: c.name });
  }
  return out;
}

function readTables(v: unknown): SpecTable[] | null {
  if (!Array.isArray(v)) return null;
  const out: SpecTable[] = [];
  for (const t of v as unknown[]) {
    if (!isObject(t) || typeof t.name !== 'string') return null;
    const columns = readColumns(t.columns);
    if (columns === null) return null;
    out.push({ name: t.name, columns });
  }
  return out;
}

function readEnums(v: unknown): SpecModule['enums'] | null {
  if (!Array.isArray(v)) return null;
  const out: SpecModule['enums'] = [];
  for (const e of v as unknown[]) {
    const elements = isObject(e) ? strings(e.elements) : null;
    if (!isObject(e) || typeof e.type !== 'string' || elements === null) return null;
    out.push({ type: e.type, elements });
  }
  return out;
}

function readReserved(v: unknown): SpecReserved[] | null {
  if (!Array.isArray(v)) return null;
  const out: SpecReserved[] = [];
  for (const r of v as unknown[]) {
    if (!isObject(r) || typeof r.id !== 'string' || !['reserved_id', 'reserved_string', 'reserved_sound'].includes(String(r.table))) return null;
    const when = r.requiredWhen;
    if (when !== null && when !== undefined && !(isObject(when) && typeof when.path === 'string')) return null;
    out.push({
      table: r.table as SpecReserved['table'],
      id: r.id,
      requiredWhen: isObject(when) ? { path: when.path as string, value: when.value } : null,
      rowOf: typeof r.rowOf === 'string' ? r.rowOf : null,
    });
  }
  return out;
}

function readFormatArguments(v: unknown): SpecModule['formatArguments'] | null {
  if (!Array.isArray(v)) return null;
  const out: SpecModule['formatArguments'] = [];
  for (const f of v as unknown[]) {
    if (!isObject(f) || typeof f.text !== 'string' || !Array.isArray(f.arguments)) return null;
    const args: SpecFormatArgument[] = [];
    for (const a of f.arguments as unknown[]) {
      if (!isObject(a) || typeof a.name !== 'string' || !['integer', 'real', 'string'].includes(String(a.kind))) return null;
      args.push({ name: a.name, kind: a.kind as SpecFormatArgument['kind'] });
    }
    out.push({ text: f.text, arguments: args });
  }
  return out;
}

function readInvariants(v: unknown): Record<string, string>[] | null {
  if (!Array.isArray(v)) return null;
  const out: Record<string, string>[] = [];
  for (const i of v as unknown[]) {
    if (!isObject(i)) return null;
    const row: Record<string, string> = {};
    for (const [k, x] of Object.entries(i)) row[k] = typeof x === 'string' ? x : '';
    out.push(row);
  }
  return out;
}

function readModule(m: unknown): SpecModule | string {
  if (!isObject(m) || typeof m.name !== 'string') return 'a module is not an object with a name';
  const side = m.side;
  const fields = {
    tables: readTables(m.tables ?? []), usedTables: strings(m.usedTables ?? []), enums: readEnums(m.enums ?? []),
    invariants: readInvariants(m.invariants ?? []), reserved: readReserved(m.reserved ?? []), formatArguments: readFormatArguments(m.formatArguments ?? []),
  };
  if ((side !== 'client' && side !== 'server') || Object.values(fields).some((v) => v === null)) return `module ${m.name} does not have the core-spec.json form`;
  return { name: m.name, side, ...(fields as Omit<SpecModule, 'name' | 'side'>) };
}

/** Reads `core-spec.json`; a string is the reason it is not one. */
export function readCoreSpec(json: unknown): CoreSpec | string {
  if (!isObject(json) || !Array.isArray(json.modules)) return 'core-spec.json is not an object with modules';
  const modules: SpecModule[] = [];
  for (const m of json.modules as unknown[]) {
    const module = readModule(m);
    if (typeof module === 'string') return module;
    modules.push(module);
  }
  return { version: typeof json.version === 'string' ? json.version : '', modules };
}

/** The table the data tool builds from `requirement` cells; its header is the `core-spec.json` table of this name. */
export const REQUIREMENT_TABLE = 'requirement';

export interface CoreReserved extends SpecReserved {
  /** `reserved_id` rows: what the `target` cell holds (`data` skill `### reserved_id.csv`). */
  target: 'Client' | 'Server' | 'All';
}

/** Everything of `core-spec.json` the tool uses, with the core data of the game's modules. */
export interface CoreData {
  /** Every table of `core-spec.json`. */
  allTables: Map<string, { table: SpecTable; module: string }>;
  /** Elements of every enum `core-spec.json` gives elements for. */
  allEnums: Map<string, string[]>;
  /** Every reserved name of `core-spec.json`. */
  allReserved: CoreReserved[];
  /** Core data tables: their header goes into `data/tables/`. */
  tables: Set<string>;
  /** Core data enums and their elements, in `core-spec.json` module order and spec order inside a module. */
  enums: Map<string, string[]>;
  invariants: Record<string, string>[];
  /** Required reserved rows. */
  reserved: CoreReserved[];
  /** Format arguments of the texts core gives values to, by `text` of `core-spec.json`. */
  formatArguments: Map<string, SpecFormatArgument[]>;
  modules: Set<string>;
}

function mergeReserved(list: CoreReserved[], r: SpecReserved, side: 'client' | 'server'): void {
  const target = side === 'client' ? 'Client' : 'Server';
  const found = list.find((x) => x.table === r.table && x.id === r.id);
  if (!found) {
    list.push({ ...r, target });
    return;
  }
  if (found.target !== target) found.target = 'All';
  if (found.requiredWhen !== null && r.requiredWhen === null) found.requiredWhen = null;
  found.rowOf ??= r.rowOf;
}

function addTableClosure(data: CoreData, name: string): void {
  if (data.tables.has(name)) return;
  const entry = data.allTables.get(name);
  if (!entry || name === REQUIREMENT_TABLE) return;
  data.tables.add(name);
  for (const col of entry.table.columns) {
    const t = parseColumnType(col.type);
    if (t === null) continue;
    for (const ref of refsOf(t)) addTableClosure(data, ref.table);
  }
}

function collectAll(spec: CoreSpec, data: CoreData): void {
  for (const m of spec.modules) {
    for (const t of m.tables) data.allTables.set(t.name, { table: t, module: m.name });
    for (const e of m.enums) data.allEnums.set(e.type, e.elements);
    for (const r of m.reserved) mergeReserved(data.allReserved, r, m.side);
    for (const f of m.formatArguments) data.formatArguments.set(f.text, f.arguments);
  }
}

function collectUsed(spec: CoreSpec, data: CoreData): void {
  for (const m of spec.modules) {
    if (!data.modules.has(m.name)) continue;
    for (const t of m.tables) addTableClosure(data, t.name);
    for (const t of m.usedTables) addTableClosure(data, t);
    for (const r of m.reserved) {
      mergeReserved(data.reserved, r, m.side);
      if (r.rowOf !== null) addTableClosure(data, r.rowOf);
    }
    for (const e of m.enums) data.enums.set(e.type, e.elements);
    data.invariants.push(...m.invariants);
  }
}

/** The core data of the modules a game uses. */
export function coreDataOf(spec: CoreSpec, modules: readonly string[]): CoreData {
  const data: CoreData = {
    allTables: new Map(), allEnums: new Map(), allReserved: [], tables: new Set(), enums: new Map(),
    invariants: [], reserved: [], formatArguments: new Map(), modules: new Set(modules),
  };
  collectAll(spec, data);
  collectUsed(spec, data);
  for (const name of data.tables) {
    for (const col of (data.allTables.get(name)?.table.columns ?? [])) {
      const t = parseColumnType(col.type);
      for (const e of t === null ? [] : enumsOf(t)) {
        const elements = data.allEnums.get(e);
        if (elements && !data.enums.has(e)) data.enums.set(e, elements);
      }
    }
  }
  const order = spec.modules.flatMap((m) => m.enums.map((e) => e.type));
  data.enums = new Map([...data.enums].sort((a, b) => order.indexOf(a[0]) - order.indexOf(b[0])));
  return data;
}
