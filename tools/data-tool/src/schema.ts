/**
 * The tables, enums and messages the data tool generates for a build target (`data` tool.md `## data proto`).
 * Tables are the data tables, the `core-spec.json` tables that data does not have, and the `requirement` table.
 */
import type { EnumElement } from './context.ts';
import { compareBytes } from './diag.ts';
import { pascal, parseColumnType, upperSnake, type BuildTarget, type ColumnType } from './types.ts';
import type { KeyPart } from './translation.ts';
import type { Value } from './values.ts';

export type Target = 'Client' | 'Server';
export const TARGETS: readonly Target[] = ['Client', 'Server'];

export interface GenColumn {
  name: string;
  description: string;
  target: BuildTarget;
  type: ColumnType;
}

export interface GenRow {
  values: Map<string, Value>;
  /** `tstring` cells: key parts of the translation key and the source text, by column name. */
  texts: Map<string, { parts: KeyPart[]; source: string }>;
  /** Build targets of the row; every target for tables whose rows are not split. */
  targets: ReadonlySet<Target>;
}

export interface GenTable {
  name: string;
  keyed: boolean;
  columns: GenColumn[];
  rows: GenRow[];
}

export interface GenEnum {
  type: string;
  /** Elements without `None`, in `value` order. */
  elements: EnumElement[];
}

export type ProtoType = 'int32' | 'int64' | 'float' | 'double' | 'bool' | 'string' | { enum: string } | { message: string };

export interface GenField {
  name: string;
  number: number;
  proto: ProtoType;
  repeated: boolean;
  comment: string;
  /** The column type the field holds; for an `Item` message field, the field type. */
  type: ColumnType;
}

export interface GenMessage {
  name: string;
  fields: GenField[];
}

/** One table of a build target. */
export interface TargetTable {
  table: GenTable;
  rowMessage: GenMessage;
  /** `<Table><Column>Item` and `<Table><Column>List` messages in column order. */
  extraMessages: GenMessage[];
  rows: GenRow[];
}

export interface TargetSchema {
  target: Target;
  enums: GenEnum[];
  tables: TargetTable[];
  usesItemAmount: boolean;
}

export const VECTOR_MESSAGES = ['Vector2Int', 'Vector3Int', 'Vector4Int', 'Vector2', 'Vector3', 'Vector4'] as const;

export function vectorMessage(size: number, elem: 'int' | 'float'): string {
  return `Vector${String(size)}${elem === 'int' ? 'Int' : ''}`;
}

export function inTarget(t: BuildTarget, target: Target): boolean {
  return t === 'All' || t === target;
}

/** The build targets a build target text holds: `All` both, `Client` or `Server` itself, anything else none. */
export function targetsOf(text: string): Set<Target> {
  if (text === 'All') return new Set(TARGETS);
  return text === 'Client' || text === 'Server' ? new Set([text]) : new Set();
}

/** Enum value name `<TYPE>_<ELEMENT>`. */
export function enumValueName(type: string, element: string): string {
  return `${upperSnake(type)}_${upperSnake(element)}`;
}

/** The column type of a `ref` target, following `ref` to `ref`; a `ref` that comes back stays a `ref`. */
export function refTargetType(tables: ReadonlyMap<string, GenTable>, t: ColumnType): ColumnType {
  const seen = new Set<string>();
  let type = t;
  while (type.k === 'ref' && !seen.has(`${type.table}.${type.column}`)) {
    seen.add(`${type.table}.${type.column}`);
    const { table, column } = type;
    const target = tables.get(table)?.columns.find((c) => c.name === column)?.type;
    if (!target) return { k: 'int', nullable: false };
    type = target;
  }
  return type;
}

/** The proto type of a scalar column type (not an array). */
export function scalarProto(tables: ReadonlyMap<string, GenTable>, t: ColumnType): ProtoType {
  const s = refTargetType(tables, t);
  switch (s.k) {
    case 'int': case 'id': case 'requirement': return 'int32';
    case 'long': case 'datetime': case 'duration': return 'int64';
    case 'float': return 'float';
    case 'double': return 'double';
    case 'bool': return 'bool';
    case 'enum': return { enum: s.enumType };
    case 'vector': return { message: vectorMessage(s.size, s.elem) };
    default: return 'string';
  }
}

/** The `<Table><Column>Item` or `<Table><Column>List` type a column makes; null when it makes none. */
export function columnTypeName(table: string, column: string, type: ColumnType | null): string | null {
  if (type?.k === 'bundle' && !type.itemAmount) return `${pascal(table)}${pascal(column)}Item`;
  if (type?.k === 'array2') return `${pascal(table)}${pascal(column)}List`;
  return null;
}

/** The type names the data tool generates for a table: `<Table>Row`, `<Table>Table` and the types of its columns by column name. */
export function tableTypeNames(table: string, columns: readonly { name: string; type: ColumnType | null }[]): { row: string; table: string; columns: Map<string, string> } {
  const out = new Map<string, string>();
  for (const c of columns) {
    const name = columnTypeName(table, c.name, c.type);
    if (name !== null) out.set(c.name, name);
  }
  return { row: `${pascal(table)}Row`, table: `${pascal(table)}Table`, columns: out };
}

function fieldOf(tables: ReadonlyMap<string, GenTable>, table: GenTable, col: GenColumn, number: number, extra: GenMessage[]): GenField {
  const base = { name: col.name, number, comment: col.description, type: col.type };
  const t = col.type;
  const message = columnTypeName(table.name, col.name, t) ?? '';
  if (t.k === 'array') return { ...base, proto: scalarProto(tables, t.elem), repeated: true };
  if (t.k === 'array2') {
    extra.push({ name: message, fields: [{ name: 'values', number: 1, proto: scalarProto(tables, t.elem), repeated: true, comment: '', type: t.elem }] });
    return { ...base, proto: { message }, repeated: true };
  }
  if (t.k === 'bundle') {
    if (t.itemAmount) return { ...base, proto: { message: 'ogw.core.ItemAmount' }, repeated: true };
    extra.push({
      name: message,
      fields: t.fields.map((f, i) => ({ name: f.name, number: i + 1, proto: scalarProto(tables, f.type), repeated: false, comment: '', type: f.type })),
    });
    return { ...base, proto: { message }, repeated: true };
  }
  return { ...base, proto: scalarProto(tables, t), repeated: false };
}

/** The schema of a build target. Tables in byte order of name, enums in byte order of type. */
export function targetSchema(target: Target, tables: ReadonlyMap<string, GenTable>, enums: readonly GenEnum[]): TargetSchema {
  const out: TargetTable[] = [];
  let usesItemAmount = false;
  for (const name of [...tables.keys()].sort(compareBytes)) {
    const table = tables.get(name) as GenTable;
    const extra: GenMessage[] = [];
    const fields: GenField[] = [];
    for (const col of table.columns.filter((c) => inTarget(c.target, target))) {
      const field = fieldOf(tables, table, col, fields.length + 1, extra);
      if (typeof field.proto === 'object' && 'message' in field.proto && field.proto.message === 'ogw.core.ItemAmount') usesItemAmount = true;
      fields.push(field);
    }
    out.push({
      table, rowMessage: { name: tableTypeNames(name, []).row, fields }, extraMessages: extra,
      rows: table.rows.filter((r) => r.targets.has(target)),
    });
  }
  return { target, enums: [...enums].sort((a, b) => compareBytes(a.type, b.type)), tables: out, usesItemAmount };
}

/** Columns of a header given as `core-spec.json` columns. */
export function genColumns(columns: readonly { name: string; description: string; target: BuildTarget; type: string }[]): GenColumn[] {
  return columns.map((c) => ({ name: c.name, description: c.description, target: c.target, type: parseColumnType(c.type) ?? { k: 'string' } }));
}
