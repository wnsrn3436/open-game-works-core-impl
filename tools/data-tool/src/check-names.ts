/** `reserved_name`: names that clash with the generated code's language, its fixed types or the contract. */
import type { RunContext } from './context.ts';
import { filePlace, type Place } from './diag.ts';
import { cellPlace, cellText, flatPlace, flatText } from './model.ts';
import { enumValueName, tableTypeNames, VECTOR_MESSAGES } from './schema.ts';
import { parseColumnType } from './types.ts';
import { GDSCRIPT_KEYWORDS, GODOT_REFCOUNTED_MEMBERS, GODOT_VARIANT_TYPES, isGodotTypeName } from './godot-names.ts';

/** Class names of the Godot generated code and the client core classes it uses (`client-core` Godot `### generated code`). */
const GODOT_GENERATED_CLASSES: ReadonlySet<string> = new Set([
  'GameData', 'GameSetting', 'ReservedId', 'ReservedString', 'ReservedSound', 'GameDataDev', 'CoreContract', 'GameContract',
  'CoreCheatContract', 'GameCheatContract', 'ContractJsonDev', 'ContractMessage', 'ContractRequest', 'ContractKind',
]);

/**
 * Reserved words of TypeScript: ECMAScript reserved words, strict mode and module reserved words, `constructor`,
 * `prototype` and `__proto__` (`data` skill `### data check`). Contextual keywords such as `type` are not.
 */
export const TYPESCRIPT_RESERVED: ReadonlySet<string> = new Set([
  'break', 'case', 'catch', 'class', 'const', 'continue', 'debugger', 'default', 'delete', 'do', 'else', 'enum', 'export',
  'extends', 'false', 'finally', 'for', 'function', 'if', 'import', 'in', 'instanceof', 'new', 'null', 'return', 'super',
  'switch', 'this', 'throw', 'true', 'try', 'typeof', 'var', 'void', 'while', 'with', 'implements', 'interface', 'let',
  'package', 'private', 'protected', 'public', 'static', 'yield', 'await', 'constructor', 'prototype', '__proto__',
]);

/** Global names the server generated code uses (`data` skill `### data check`): a type with such a name would hide them. */
export const TYPESCRIPT_GLOBALS: ReadonlySet<string> = new Set([
  'Map', 'Number', 'Uint8Array', 'Object', 'Array', 'String', 'Boolean', 'Error', 'Set', 'Promise', 'BigInt',
]);

/** Names of the generated code that are not made from data. */
const FIXED_TYPES = [
  'Translation', 'TranslationEntry', 'TableNames', ...VECTOR_MESSAGES, 'DataSet', 'GameSettingAccessor',
  'ReservedIdAccessor', 'ReservedStringAccessor', 'ReservedSoundAccessor', 'Reader', 'TableReader', 'Fields', 'CoreContract',
];

function reservedWord(name: string): boolean {
  return TYPESCRIPT_RESERVED.has(name);
}

/**
 * A GDScript keyword or Variant built-in type name, or a member of `RefCounted`: a table, column, enum or accessor
 * name the Godot generated code declares as a field or a function.
 */
function godotWord(ctx: RunContext, name: string): boolean {
  return ctx.godot !== null && (GDSCRIPT_KEYWORDS.has(name) || GODOT_VARIANT_TYPES.has(name) || GODOT_REFCOUNTED_MEMBERS.has(name));
}

function checkWord(ctx: RunContext, name: string, what: string, place: Place): void {
  if (reservedWord(name) || godotWord(ctx, name)) ctx.diags.add('reserved_name', place, `${what} ${name} is a reserved word of the generated code`);
}

/** A type name of the Godot generated code that clashes with a GDScript or engine name, a generated class or a client core type. */
function godotTypeClash(ctx: RunContext, name: string): string | null {
  if (ctx.godot === null) return null;
  if (isGodotTypeName(name) || GODOT_GENERATED_CLASSES.has(name)) return `type name ${name} is a GDScript or engine name of the Godot generated code`;
  if (ctx.godot.coreTypes.has(name)) return `type name ${name} is a client core type name`;
  return null;
}

function tableNames(ctx: RunContext): void {
  for (const table of ctx.data.tables.values()) {
    checkWord(ctx, table.name, 'table name', filePlace(table.file));
    for (const col of table.columns) checkWord(ctx, col.name, 'column name', { file: table.file, line: 4, col: col.index + 1 });
  }
}

function enumNames(ctx: RunContext): void {
  const file = ctx.data.enums;
  if (file === null) return;
  const valueNames = new Map<string, string>();
  for (const [type, elements] of ctx.core.allEnums) {
    if (ctx.enums.has(type)) continue;
    for (const e of elements) valueNames.set(enumValueName(type, e), `${type}.${e}`);
  }
  for (const r of file.records) {
    const type = flatText(r, 'type');
    const element = flatText(r, 'element');
    checkWord(ctx, type, 'enum type', flatPlace(file, r, 'type'));
    // A Godot enum member is the CONSTANT_CASE of the element, which no GDScript keyword is.
    if (reservedWord(element)) ctx.diags.add('reserved_name', flatPlace(file, r, 'element'), `enum element ${element} is a reserved word of the generated code`);
    if (ctx.core.allEnums.has(type) && !ctx.core.enums.has(type)) ctx.diags.add('reserved_name', flatPlace(file, r, 'type'), `enum ${type} is a core enum of a module the game does not use`);
    for (const [name, label] of [[enumValueName(type, 'None'), `${type}.None`], [enumValueName(type, element), `${type}.${element}`]] as const) {
      const other = valueNames.get(name);
      if (other !== undefined && other !== label) ctx.diags.add('reserved_name', flatPlace(file, r, 'element'), `enum value name ${name} of ${label} is also the name of ${other}`);
      valueNames.set(name, label);
    }
  }
}

function accessorNames(ctx: RunContext): void {
  for (const name of ['game_setting', 'reserved_id', 'reserved_string', 'reserved_sound']) {
    const table = ctx.data.tables.get(name);
    const id = table?.columns[0];
    if (!table || !id) continue;
    for (const row of table.rows) {
      const inner = cellText(row, id).replace(/^\[/, '').replace(/\]$/, '');
      const place = cellPlace(table, row, id);
      if (/^[0-9]/.test(inner)) ctx.diags.add('reserved_name', place, `accessor name ${inner} starts with a digit`);
      checkWord(ctx, inner, 'accessor name', place);
    }
  }
}

/** Types the data tool makes from data, with the place of what made them. */
function madeTypes(ctx: RunContext): { name: string; place: Place }[] {
  const out: { name: string; place: Place }[] = [];
  for (const table of ctx.data.tables.values()) {
    const names = tableTypeNames(table.name, table.columns);
    out.push({ name: names.row, place: filePlace(table.file) }, { name: names.table, place: filePlace(table.file) });
    for (const col of table.columns) {
      const name = names.columns.get(col.name);
      if (name !== undefined) out.push({ name, place: { file: table.file, line: 4, col: col.index + 1 } });
    }
  }
  const file = ctx.data.enums;
  for (const type of ctx.enums.keys()) {
    const r = file?.records.find((x) => flatText(x, 'type') === type);
    out.push({ name: type, place: file && r ? flatPlace(file, r, 'type') : filePlace('data/enums.csv') });
  }
  return out;
}

/** Type names of core tables and enums that data does not have: the generated code has them too. */
function coreOnlyTypes(ctx: RunContext): Set<string> {
  const out = new Set<string>();
  for (const [name, { table }] of ctx.core.allTables) {
    if (ctx.data.tables.has(name)) continue;
    const names = tableTypeNames(name, table.columns.map((c) => ({ name: c.name, type: parseColumnType(c.type) })));
    out.add(names.row).add(names.table);
    for (const n of names.columns.values()) out.add(n);
  }
  for (const type of ctx.core.allEnums.keys()) if (!ctx.enums.has(type)) out.add(type);
  return out;
}

function typeNames(ctx: RunContext): void {
  const seen = new Map<string, Place>();
  const fixed = new Set([...FIXED_TYPES, ...coreOnlyTypes(ctx)]);
  for (const { name, place } of madeTypes(ctx)) {
    if (fixed.has(name)) ctx.diags.add('reserved_name', place, `type name ${name} is also a type of the generated code`);
    else if (ctx.protoNames.has(name)) ctx.diags.add('reserved_name', place, `type name ${name} is also a message or enum of the contract or the base proto`);
    else if (seen.has(name)) ctx.diags.add('reserved_name', place, `type name ${name} is made twice`);
    else if (reservedWord(name) || TYPESCRIPT_GLOBALS.has(name)) ctx.diags.add('reserved_name', place, `type name ${name} is a reserved word or a global name of the generated code`);
    else {
      const clash = godotTypeClash(ctx, name);
      if (clash !== null) ctx.diags.add('reserved_name', place, clash);
    }
    seen.set(name, place);
  }
}

/** Every `reserved_name` check that does not need the values. */
export function checkNames(ctx: RunContext): void {
  tableNames(ctx);
  enumNames(ctx);
  accessorNames(ctx);
  typeNames(ctx);
}
