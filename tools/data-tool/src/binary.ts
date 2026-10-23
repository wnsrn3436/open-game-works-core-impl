/** Protobuf encoding of the table binaries and the translation binaries (`data` tool.md `## processing`). */
import type { GenField, GenMessage, GenRow, GenTable, ProtoType, TargetTable } from './schema.ts';
import { refTargetType } from './schema.ts';
import { translationKey } from './translation.ts';
import type { ColumnType } from './types.ts';
import type { Value } from './values.ts';

const encoder = new TextEncoder();

export class Writer {
  private buf = new Uint8Array(256);
  private len = 0;

  private ensure(n: number): void {
    if (this.len + n <= this.buf.length) return;
    let size = this.buf.length * 2;
    while (size < this.len + n) size *= 2;
    const next = new Uint8Array(size);
    next.set(this.buf.subarray(0, this.len));
    this.buf = next;
  }

  byte(b: number): void {
    this.ensure(1);
    this.buf[this.len] = b;
    this.len += 1;
  }

  /** A varint of the 64-bit two's complement of a value. */
  varint(value: bigint): void {
    let v = BigInt.asUintN(64, value);
    while (v >= 0x80n) {
      this.byte(Number(v & 0x7fn) | 0x80);
      v >>= 7n;
    }
    this.byte(Number(v));
  }

  tag(field: number, wire: number): void {
    this.varint(BigInt(field * 8 + wire));
  }

  bytes(data: Uint8Array): void {
    this.varint(BigInt(data.length));
    this.ensure(data.length);
    this.buf.set(data, this.len);
    this.len += data.length;
  }

  raw(data: Uint8Array): void {
    this.ensure(data.length);
    this.buf.set(data, this.len);
    this.len += data.length;
  }

  float(v: number): void {
    const b = new Uint8Array(4);
    new DataView(b.buffer).setFloat32(0, v, true);
    this.raw(b);
  }

  double(v: number): void {
    const b = new Uint8Array(8);
    new DataView(b.buffer).setFloat64(0, v, true);
    this.raw(b);
  }

  finish(): Uint8Array {
    return this.buf.slice(0, this.len);
  }
}

/** Field numbers of `ogw.core.ItemAmount` in the base proto. */
export interface ItemAmountFields {
  item_id: number;
  amount: number;
  big_amount: number;
}

/** Turns values into what is encoded: ID values, enum values and built text. */
export interface Resolver {
  idValue(name: string): number;
  enumValue(type: string, element: string): number;
  tables: ReadonlyMap<string, GenTable>;
  itemAmount: ItemAmountFields | null;
}

const MAX_SAFE = 2n ** 53n - 1n;

/** A number value as an integer: ID names become ID values. */
export function intOf(v: Value | undefined, r: Resolver): bigint {
  if (v === undefined) return 0n;
  switch (v.k) {
    case 'int': return v.v;
    case 'idname': return BigInt(r.idValue(v.name));
    case 'req': return v.name === null ? 0n : BigInt(r.idValue(v.name));
    case 'bool': return v.v ? 1n : 0n;
    default: return 0n;
  }
}

function realOf(v: Value | undefined): number {
  return v?.k === 'float' ? v.v : v?.k === 'int' ? Number(v.v) : 0;
}

/** `string` text with every ID name replaced by its ID value. */
export function replaceIdNames(text: string, r: Resolver): string {
  return text.replace(/\[[a-z0-9_]+\]/g, (m) => String(r.idValue(m)));
}

function enumOf(v: Value | undefined, enumType: string, r: Resolver): number {
  return v?.k === 'enum' ? r.enumValue(enumType, v.element) : 0;
}

function textOf(v: Value | undefined, t: ColumnType, r: Resolver): string {
  if (v?.k !== 'text') return '';
  return t.k === 'string' ? replaceIdNames(v.v, r) : v.v;
}

function scalarIsDefault(p: ProtoType, v: Value | undefined, t: ColumnType, r: Resolver): boolean {
  if (typeof p === 'object') return 'enum' in p ? enumOf(v, p.enum, r) === 0 : false;
  if (p === 'string') return textOf(v, t, r) === '';
  if (p === 'float' || p === 'double') return Object.is(realOf(v), 0);
  return intOf(v, r) === 0n;
}

function vectorBytes(v: Value | undefined, elem: 'int' | 'float', size: number): Uint8Array {
  const w = new Writer();
  const parts = v?.k === 'vector' ? v.v : [];
  for (let i = 0; i < size; i += 1) {
    const x = parts[i] ?? 0;
    if (x === 0) continue;
    if (elem === 'int') {
      w.tag(i + 1, 0);
      w.varint(BigInt(x));
    } else {
      w.tag(i + 1, 5);
      w.float(x);
    }
  }
  return w.finish();
}

/** Writes one scalar of a field: the tag and the value. */
function writeScalar(w: Writer, number: number, p: ProtoType, v: Value | undefined, t: ColumnType, r: Resolver): void {
  const s = refTargetType(r.tables, t);
  if (typeof p === 'object' && 'message' in p) {
    w.tag(number, 2);
    w.bytes(s.k === 'vector' ? vectorBytes(v, s.elem, s.size) : new Uint8Array());
    return;
  }
  if (p === 'string') {
    w.tag(number, 2);
    w.bytes(encoder.encode(textOf(v, s, r)));
  } else if (p === 'float') {
    w.tag(number, 5);
    w.float(realOf(v));
  } else if (p === 'double') {
    w.tag(number, 1);
    w.double(realOf(v));
  } else {
    w.tag(number, 0);
    w.varint(typeof p === 'object' ? BigInt(enumOf(v, p.enum, r)) : intOf(v, r));
  }
}

function writePackedElement(w: Writer, p: ProtoType, v: Value, r: Resolver): void {
  if (p === 'float') w.float(realOf(v));
  else if (p === 'double') w.double(realOf(v));
  else w.varint(typeof p === 'object' && 'enum' in p ? BigInt(enumOf(v, p.enum, r)) : intOf(v, r));
}

function isPackable(p: ProtoType): boolean {
  return p !== 'string' && !(typeof p === 'object' && 'message' in p);
}

function itemAmountBytes(v: Value, r: Resolver): Uint8Array {
  const f = r.itemAmount;
  const w = new Writer();
  if (f === null || v.k !== 'tuple') return w.finish();
  const id = intOf(v.fields[0], r);
  const amount = intOf(v.fields[1], r);
  if (id !== 0n) {
    w.tag(f.item_id, 0);
    w.varint(id);
  }
  const small = amount >= -MAX_SAFE && amount <= MAX_SAFE;
  if (small && amount !== 0n) {
    w.tag(f.amount, 0);
    w.varint(amount);
  }
  if (!small) {
    w.tag(f.big_amount, 2);
    w.bytes(encoder.encode(amount.toString()));
  }
  return w.finish();
}

function tupleBytes(m: GenMessage, v: Value, r: Resolver): Uint8Array {
  const w = new Writer();
  if (v.k !== 'tuple') return w.finish();
  for (const [i, f] of m.fields.entries()) {
    const fv = v.fields[i];
    if (fv === undefined || fv.k === 'null' || scalarIsDefault(f.proto, fv, f.type, r)) continue;
    writeScalar(w, f.number, f.proto, fv, f.type, r);
  }
  return w.finish();
}

function listBytes(m: GenMessage, v: Value, r: Resolver): Uint8Array {
  const w = new Writer();
  const f = m.fields[0] as GenField;
  if (v.k === 'list') writeRepeated(w, f.number, f.proto, v.items, f.type, r, null);
  return w.finish();
}

function writeRepeated(w: Writer, number: number, p: ProtoType, items: readonly Value[], elem: ColumnType, r: Resolver, extra: GenMessage | null): void {
  if (items.length === 0) return;
  if (isPackable(p)) {
    const inner = new Writer();
    for (const item of items) writePackedElement(inner, p, item, r);
    w.tag(number, 2);
    w.bytes(inner.finish());
    return;
  }
  for (const item of items) {
    if (typeof p === 'object' && 'message' in p && p.message === 'ogw.core.ItemAmount') {
      w.tag(number, 2);
      w.bytes(itemAmountBytes(item, r));
    } else if (extra?.name.endsWith('Item')) {
      w.tag(number, 2);
      w.bytes(tupleBytes(extra, item, r));
    } else if (extra?.name.endsWith('List')) {
      w.tag(number, 2);
      w.bytes(listBytes(extra, item, r));
    } else writeScalar(w, number, p, item, elem, r);
  }
}

/** The built translation key of a `tstring` cell; empty when the cell has no text. */
export function builtTextKey(table: string, column: string, row: GenRow, r: Resolver): string {
  const text = row.texts.get(column);
  if (!text) return '';
  const built = text.parts.map((p) => ({ ...p, text: p.kind === 'id' ? String(r.idValue(p.text)) : p.kind === 'enum' ? String(r.enumValue(p.enumType, p.text)) : p.text }));
  return translationKey(table, column, built);
}

function writeField(w: Writer, t: TargetTable, f: GenField, row: GenRow, r: Resolver): void {
  const v = row.values.get(f.name);
  const ct = f.type;
  if (ct.k === 'tstring') {
    const key = builtTextKey(t.table.name, f.name, row, r);
    if (key !== '') writeScalar(w, f.number, 'string', { k: 'text', v: key }, { k: 'reskey', nullable: false }, r);
    return;
  }
  if (f.repeated) {
    const extra = t.extraMessages.find((m) => typeof f.proto === 'object' && 'message' in f.proto && m.name === f.proto.message) ?? null;
    const elem = ct.k === 'array' || ct.k === 'array2' ? ct.elem : ct;
    writeRepeated(w, f.number, f.proto, v?.k === 'list' ? v.items : [], elem, r, extra);
    return;
  }
  if (v === undefined || v.k === 'null') {
    if (typeof f.proto === 'object' && 'message' in f.proto) writeScalar(w, f.number, f.proto, v, ct, r);
    return;
  }
  if (!scalarIsDefault(f.proto, v, ct, r)) writeScalar(w, f.number, f.proto, v, ct, r);
}

/** The row message bytes of a row. */
export function rowBytes(t: TargetTable, row: GenRow, r: Resolver): Uint8Array {
  const w = new Writer();
  for (const f of t.rowMessage.fields) writeField(w, t, f, row, r);
  return w.finish();
}

/** The table binary: `<Table>Table` with every row of the build target. */
export function tableBytes(t: TargetTable, r: Resolver): Uint8Array {
  const w = new Writer();
  for (const row of t.rows) {
    w.tag(1, 2);
    w.bytes(rowBytes(t, row, r));
  }
  return w.finish();
}

/** The translation binary: `Translation` with the entries in the given order. */
export function translationBytes(entries: readonly { key: string; text: string }[]): Uint8Array {
  const w = new Writer();
  for (const e of entries) {
    const inner = new Writer();
    if (e.key !== '') {
      inner.tag(1, 2);
      inner.bytes(encoder.encode(e.key));
    }
    if (e.text !== '') {
      inner.tag(2, 2);
      inner.bytes(encoder.encode(e.text));
    }
    w.tag(1, 2);
    w.bytes(inner.finish());
  }
  return w.finish();
}
