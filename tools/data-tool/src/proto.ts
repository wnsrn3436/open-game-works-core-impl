/** The data proto `game_data.proto` of a build target (`data` tool.md `## data proto`). */
import { createHash } from 'node:crypto';
import { compareBytes } from './diag.ts';
import { enumValueName, tableTypeNames, VECTOR_MESSAGES, type GenField, type GenMessage, type ProtoType, type TargetSchema } from './schema.ts';
import { upperSnake } from './types.ts';

export function protoTypeName(p: ProtoType): string {
  if (typeof p === 'string') return p;
  return 'enum' in p ? p.enum : p.message;
}

function comment(text: string, indent: string): string[] {
  if (text === '') return [];
  return text.split(/\r?\n/).map((l) => `${indent}// ${l}`.trimEnd());
}

function fieldLine(f: GenField): string[] {
  return [...comment(f.comment, '  '), `  ${f.repeated ? 'repeated ' : ''}${protoTypeName(f.proto)} ${f.name} = ${String(f.number)};`];
}

function message(m: GenMessage): string[] {
  return [`message ${m.name} {`, ...m.fields.flatMap(fieldLine), '}', ''];
}

function vectorMessages(): string[] {
  const out: string[] = [];
  for (const name of VECTOR_MESSAGES) {
    const elem = name.endsWith('Int') ? 'int32' : 'float';
    const fields = ['x', 'y', 'z', 'w'].slice(0, Number(name[6])).map((n, i) => `  ${elem} ${n} = ${String(i + 1)};`);
    out.push(`message ${name} {`, ...fields, '}', '');
  }
  return out;
}

/** The text of `game_data.proto`. */
export function protoText(schema: TargetSchema): string {
  const lines = ['syntax = "proto3";', 'package ogw.data;'];
  if (schema.usesItemAmount) lines.push('import "ogw/core.proto";');
  lines.push('');
  for (const e of schema.enums) {
    lines.push(`enum ${e.type} {`, `  ${upperSnake(e.type)}_NONE = 0;`);
    for (const el of e.elements) lines.push(`  ${enumValueName(e.type, el.element)} = ${String(el.value)};`);
    lines.push('}', '');
  }
  lines.push(...vectorMessages());
  lines.push('message Translation {', '  repeated TranslationEntry entries = 1;', '}', '');
  lines.push('message TranslationEntry {', '  string key = 1;', '  string text = 2;', '}', '');
  const names = schema.tables.map((t) => t.table.name).sort(compareBytes);
  lines.push('message TableNames {', ...names.map((n, i) => `  bool ${n} = ${String(i + 1)};`), '}', '');
  for (const t of schema.tables) {
    lines.push(...message(t.rowMessage));
    for (const m of t.extraMessages) lines.push(...message(m));
    lines.push(`message ${tableTypeNames(t.table.name, []).table} {`, `  repeated ${t.rowMessage.name} rows = 1;`, '}', '');
  }
  return `${lines.join('\n').trimEnd()}\n`;
}

/**
 * The proto text without comments: comment-only lines go, other comments are cut. `protoText` writes only `//`
 * comments, and a column description inside one may hold `/*` or `*\/`, so only `//` comments are read.
 */
export function stripProtoComments(text: string): string {
  const out: string[] = [];
  for (const line of text.split('\n')) {
    const cut = line.replace(/\/\/.*$/, '').trimEnd();
    if (cut === '' && line.trim() !== '') continue;
    out.push(cut);
  }
  return out.join('\n');
}

export function sha256Hex(data: Uint8Array | string): string {
  return createHash('sha256').update(data).digest('hex');
}

/** The hash input: `<file name> <SHA-256>` and LF for each file in byte order of name. */
export function hashInput(files: ReadonlyMap<string, Uint8Array | string>): string {
  return [...files.keys()].sort(compareBytes).map((name) => `${name} ${sha256Hex(files.get(name) as Uint8Array | string)}\n`).join('');
}

/** Protocol hash of a build target: the hash of its data proto files without comments. */
export function protocolHash(protoFiles: ReadonlyMap<string, string>): string {
  const stripped = new Map([...protoFiles].map(([name, text]) => [name, stripProtoComments(text)]));
  return sha256Hex(hashInput(stripped));
}

/** Data hash of a build target: the hash of its table binaries. */
export function dataHash(tableFiles: ReadonlyMap<string, Uint8Array>): string {
  return sha256Hex(hashInput(tableFiles));
}
