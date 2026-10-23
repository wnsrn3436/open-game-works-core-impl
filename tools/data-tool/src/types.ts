/** Column types of the CSV header (`data` skill `## type`). */

export type NumberKind = 'int' | 'long' | 'float' | 'double';
export type BuildTarget = 'Client' | 'Server' | 'All' | 'None';
export const BUILD_TARGETS: readonly BuildTarget[] = ['Client', 'Server', 'All', 'None'];

export type ColumnType =
  | { k: NumberKind; nullable: boolean }
  | { k: 'datetime' | 'duration' | 'reskey'; nullable: boolean }
  | { k: 'bool' }
  | { k: 'string' }
  | { k: 'id'; key: boolean }
  | { k: 'tstring'; keyCols: string[] }
  | { k: 'vector'; size: 2 | 3 | 4; elem: 'int' | 'float' }
  | { k: 'enum'; enumType: string; nullable: boolean }
  | { k: 'ref'; table: string; column: string; nullable: boolean }
  | { k: 'array'; elem: ColumnType }
  | { k: 'array2'; elem: ColumnType }
  | { k: 'bundle'; fields: BundleField[]; itemAmount: boolean }
  | { k: 'requirement'; keyCols: string[] | null };

export interface BundleField {
  name: string;
  type: ColumnType;
}

const SNAKE = /^[a-z][a-z0-9]*(_[a-z0-9]+)*$/;
const PASCAL = /^[A-Z][A-Za-z0-9]*$/;

export function isSnakeCase(name: string): boolean {
  return SNAKE.test(name);
}

export function isPascalCase(name: string): boolean {
  return PASCAL.test(name);
}

/** Types whose array elements are separated by commas. */
export function isCommaType(t: ColumnType): boolean {
  return ['int', 'long', 'float', 'double', 'bool', 'enum', 'id', 'ref', 'datetime', 'duration'].includes(t.k);
}

const NULLABLE_KINDS = new Set(['int', 'long', 'float', 'double', 'datetime', 'duration', 'reskey', 'enum', 'ref']);

function splitTop(text: string, sep: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (ch === '<' || ch === '{' || ch === '(') depth += 1;
    else if (ch === '>' || ch === '}' || ch === ')') depth -= 1;
    else if (ch === sep && depth === 0) {
      parts.push(text.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(text.slice(start));
  return parts;
}

function inner(text: string, head: string): string | null {
  return text.startsWith(`${head}<`) && text.endsWith('>') ? text.slice(head.length + 1, -1) : null;
}

function keyColumns(text: string): string[] | null {
  const cols = text.split(',').map((c) => c.trim());
  return cols.every(isSnakeCase) ? cols : null;
}

function parseBundle(body: string): ColumnType | null {
  if (!body.startsWith('{') || !body.endsWith('}')) return null;
  const fields: BundleField[] = [];
  for (const part of splitTop(body.slice(1, -1), ',')) {
    const colon = part.indexOf(':');
    if (colon < 0) return null;
    const name = part.slice(0, colon).trim();
    const type = parseColumnType(part.slice(colon + 1).trim());
    if (!isSnakeCase(name) || type === null || !isCommaType(type) || (type.k === 'id' && type.key)) return null;
    if (fields.some((f) => f.name === name)) return null;
    fields.push({ name, type });
  }
  if (fields.length === 0) return null;
  return { k: 'bundle', fields, itemAmount: isItemAmountFields(fields) };
}

/** Whether a column type is the item bundle list `array<{item_id: ref<item.id>, amount: long}>`. */
export function isItemAmountList(t: ColumnType | null): boolean {
  return t?.k === 'bundle' && t.itemAmount;
}

function isItemAmountFields(fields: readonly BundleField[]): boolean {
  const [first, second] = fields;
  if (fields.length !== 2 || first === undefined || second === undefined) return false;
  const ref = first.type;
  return first.name === 'item_id' && ref.k === 'ref' && ref.table === 'item' && ref.column === 'id' && !ref.nullable
    && second.name === 'amount' && second.type.k === 'long' && !second.type.nullable;
}

function parseArray(body: string): ColumnType | null {
  if (body.startsWith('{')) return parseBundle(body);
  const elem = parseColumnType(body);
  if (elem === null) return null;
  if (elem.k === 'array') {
    return isCommaType(elem.elem) ? { k: 'array2', elem: elem.elem } : null;
  }
  if (['array2', 'bundle', 'tstring', 'requirement'].includes(elem.k)) return null;
  return { k: 'array', elem };
}

function parseVector(text: string): ColumnType | null {
  const m = /^vector([234])<(int|float)>$/.exec(text);
  if (!m) return null;
  return { k: 'vector', size: Number(m[1]) as 2 | 3 | 4, elem: m[2] as 'int' | 'float' };
}

function parseWithArgs(text: string, nullable: boolean): ColumnType | null {
  const tstring = inner(text, 'tstring');
  if (tstring !== null) {
    const cols = keyColumns(tstring);
    return cols === null || nullable ? null : { k: 'tstring', keyCols: cols };
  }
  const requirement = inner(text, 'requirement');
  if (requirement !== null) {
    const cols = keyColumns(requirement);
    return cols === null || nullable ? null : { k: 'requirement', keyCols: cols };
  }
  const en = inner(text, 'enum');
  if (en !== null) return isPascalCase(en) ? { k: 'enum', enumType: en, nullable } : null;
  const ref = inner(text, 'ref');
  if (ref !== null) {
    const m = /^([a-z][a-z0-9_]*)\.([a-z][a-z0-9_]*)$/.exec(ref);
    return m ? { k: 'ref', table: m[1] as string, column: m[2] as string, nullable } : null;
  }
  const arr = inner(text, 'array');
  if (arr !== null) return nullable ? null : parseArray(arr);
  return nullable ? null : parseVector(text);
}

const NULLABLE_SIMPLE = new Set(['int', 'long', 'float', 'double', 'datetime', 'duration', 'reskey']);
const PLAIN_SIMPLE: Readonly<Record<string, ColumnType>> = {
  bool: { k: 'bool' }, string: { k: 'string' }, id: { k: 'id', key: false }, 'id(key)': { k: 'id', key: true },
  requirement: { k: 'requirement', keyCols: null },
};

function parseSimple(base: string, nullable: boolean): ColumnType | null | undefined {
  if (NULLABLE_SIMPLE.has(base)) return { k: base as NumberKind | 'datetime' | 'duration' | 'reskey', nullable };
  const plain = PLAIN_SIMPLE[base];
  if (plain === undefined) return undefined;
  return nullable ? null : structuredClone(plain);
}

/** Parses a header type cell; null when it is not a type of the `data` skill. */
export function parseColumnType(text: string): ColumnType | null {
  const nullable = text.endsWith('?');
  const base = nullable ? text.slice(0, -1) : text;
  const simple = parseSimple(base, nullable);
  if (simple !== undefined) return simple;
  const t = parseWithArgs(base, nullable);
  if (t !== null && nullable && !NULLABLE_KINDS.has(t.k)) return null;
  return t;
}

/** Whether a column of the type may hold the cell `null`. */
export function isNullable(t: ColumnType): boolean {
  return 'nullable' in t && t.nullable;
}

/** The type text in canonical form. */
export function typeText(t: ColumnType): string {
  const q = isNullable(t) ? '?' : '';
  switch (t.k) {
    case 'id': return t.key ? 'id(key)' : 'id';
    case 'tstring': return `tstring<${t.keyCols.join(',')}>`;
    case 'requirement': return t.keyCols === null ? 'requirement' : `requirement<${t.keyCols.join(',')}>`;
    case 'vector': return `vector${String(t.size)}<${t.elem}>`;
    case 'enum': return `enum<${t.enumType}>${q}`;
    case 'ref': return `ref<${t.table}.${t.column}>${q}`;
    case 'array': return `array<${typeText(t.elem)}>`;
    case 'array2': return `array<array<${typeText(t.elem)}>>`;
    case 'bundle': return `array<{${t.fields.map((f) => `${f.name}: ${typeText(f.type)}`).join(', ')}}>`;
    default: return `${t.k}${q}`;
  }
}

/** Enum types a column type uses. */
export function enumsOf(t: ColumnType): string[] {
  if (t.k === 'enum') return [t.enumType];
  if (t.k === 'array' || t.k === 'array2') return enumsOf(t.elem);
  if (t.k === 'bundle') return t.fields.flatMap((f) => enumsOf(f.type));
  if (t.k === 'requirement') return ['RequirementType', 'RequirementLogic'];
  return [];
}

/** `ref` targets a column type uses. */
/**
 * Whether a `ref` can reach a column of this type: one value, as a `ref` field's proto and generated type are its
 * target column's. A `ref` reaching a list, a `tstring` or a `requirement` is not one.
 */
export function isRefTargetType(t: ColumnType): boolean {
  return !['array', 'array2', 'bundle', 'tstring', 'requirement'].includes(t.k);
}

export function refsOf(t: ColumnType): { table: string; column: string }[] {
  if (t.k === 'ref') return [{ table: t.table, column: t.column }];
  if (t.k === 'array' || t.k === 'array2') return refsOf(t.elem);
  if (t.k === 'bundle') return t.fields.flatMap((f) => refsOf(f.type));
  return [];
}

/** PascalCase of a snake_case name: `item_overflow` → `ItemOverflow`. */
export function pascal(snake: string): string {
  return snake.split('_').map((w) => (w === '' ? '' : (w[0] as string).toUpperCase() + w.slice(1))).join('');
}

/** UPPER_SNAKE of a PascalCase name: `ItemCount` → `ITEM_COUNT`. */
export function upperSnake(name: string): string {
  return name
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1_$2')
    .toUpperCase();
}

/** snake_case of a PascalCase name: `ItemCount` → `item_count`. */
export function snakeOf(name: string): string {
  return upperSnake(name).toLowerCase();
}
