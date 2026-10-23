/** Name rules: name forms, unique names, enum values, names the generated code uses, field numbers. */
import type { Pos } from '../ast.ts';
import type { EnumDef, MessageDef, Pkg } from '../model.ts';
import { jsonName, PASCAL_CASE, RESERVED_FIELD_NAMES, SNAKE_CASE, TS_BUILTIN_TYPES, TS_RESERVED_WORDS, UPPER_SNAKE, upperSnake } from '../names.ts';
import { KIND_SUFFIXES, MODULE_MESSAGES, type CheckContext } from './context.ts';

const MAX_FIELD_NUMBER = 536870911;

/** Game types the generated code declares whether or not the contract defines them. */
const ALWAYS_DECLARED: ReadonlySet<string> = new Set(['GameError', ...MODULE_MESSAGES]);

function checkTypeName(ctx: CheckContext, name: string, pos: Pos, what: string, pkg: Pkg): void {
  if (!PASCAL_CASE.test(name)) ctx.diagnostics.error(pos, `${what} name ${name} is not PascalCase`);
  if (TS_BUILTIN_TYPES.has(name) || TS_RESERVED_WORDS.has(name)) ctx.diagnostics.error(pos, `${what} name ${name} is a name the generated TypeScript uses`);
  if (pkg === 'game' && ctx.dataNames.has(name)) ctx.diagnostics.error(pos, `${what} name ${name} is a message or enum name of the data proto`);
}

function checkFieldNumbers(ctx: CheckContext, def: MessageDef): void {
  const numbers = new Map<number, string>();
  const names = new Set<string>();
  // proto3 JSON name or proto name of an earlier field → that field. from_json reads a field by either name.
  const jsonNames = new Map<string, string>();
  for (const field of def.fields) {
    const pos = field.node.pos;
    if (field.number < 1 || field.number > MAX_FIELD_NUMBER || (field.number >= 19000 && field.number <= 19999)) {
      ctx.diagnostics.error(pos, `field number ${String(field.number)} is not allowed`);
    }
    const other = numbers.get(field.number);
    if (other !== undefined) ctx.diagnostics.error(pos, `field number ${String(field.number)} is already used by ${other}`);
    numbers.set(field.number, field.name);
    if (names.has(field.name)) ctx.diagnostics.error(pos, `field name ${field.name} is used twice`);
    names.add(field.name);
    const json = jsonName(field.name);
    const clash = [field.name, json].map((key) => jsonNames.get(key)).find((earlier) => earlier !== undefined && earlier !== field.name);
    if (clash !== undefined) ctx.diagnostics.error(pos, `field ${field.name} has JSON name ${json}, which conflicts with field ${clash}`);
    for (const key of [field.name, json]) {
      if (!jsonNames.has(key)) jsonNames.set(key, field.name);
    }
    const node = def.node;
    if (node?.reservedNumbers.some(([from, to]) => field.number >= from && field.number <= to) === true) {
      ctx.diagnostics.error(pos, `field number ${String(field.number)} is reserved`);
    }
    if (node?.reservedNames.includes(field.name) === true) ctx.diagnostics.error(pos, `field name ${field.name} is reserved`);
  }
}

function checkMessage(ctx: CheckContext, def: MessageDef): void {
  const pos = def.node?.pos;
  if (pos === undefined) return;
  checkTypeName(ctx, def.name, pos, 'message', def.pkg);
  checkFieldNumbers(ctx, def);
  for (const field of def.fields) {
    if (!SNAKE_CASE.test(field.name)) ctx.diagnostics.error(field.node.pos, `field name ${field.name} is not snake_case`);
    if (TS_RESERVED_WORDS.has(field.name) || RESERVED_FIELD_NAMES.has(field.name)) {
      ctx.diagnostics.error(field.node.pos, `field name ${field.name} is a name the generated TypeScript uses`);
    }
  }
}

function checkEnum(ctx: CheckContext, def: EnumDef, valueNames: Map<string, Pos>): void {
  const pos = def.node?.pos;
  if (pos === undefined) return;
  checkTypeName(ctx, def.name, pos, 'enum', def.pkg);
  for (const { suffix } of KIND_SUFFIXES) {
    if (def.name.endsWith(suffix)) ctx.diagnostics.error(pos, `enum name ${def.name} ends with ${suffix}`);
  }
  const prefix = `${upperSnake(def.name)}_`;
  const first = def.values[0];
  if (first?.name !== `${prefix}UNSPECIFIED` || first.number !== 0) ctx.diagnostics.error(first?.pos ?? pos, `first value of ${def.name} is ${prefix}UNSPECIFIED = 0`);
  const numbers = new Set<number>();
  for (const value of def.values) {
    const rest = value.name.slice(prefix.length);
    if (!value.name.startsWith(prefix) || !UPPER_SNAKE.test(rest)) ctx.diagnostics.error(value.pos, `enum value ${value.name} is not ${prefix}<VALUE> in UPPER_SNAKE`);
    if (numbers.has(value.number)) ctx.diagnostics.error(value.pos, `enum value number ${String(value.number)} is used twice in ${def.name}`);
    numbers.add(value.number);
    const other = valueNames.get(value.name);
    if (other !== undefined) ctx.diagnostics.error(value.pos, `enum value name ${value.name} is already used in ${other.file}:${String(other.line)}`);
    valueNames.set(value.name, value.pos);
  }
}

/** `<Name>Handler` and `<Name>Error`: the server code declares one for each game and game cheat `rpc`. */
function checkGeneratedTypeNames(ctx: CheckContext): void {
  const taken = new Map<string, string>();
  for (const rpc of ctx.model.rpcs) {
    if (rpc.service !== 'Game' && rpc.service !== 'Cheat') continue;
    for (const name of [`${rpc.name}Handler`, `${rpc.name}Error`]) {
      taken.set(name, rpc.name);
      if (TS_BUILTIN_TYPES.has(name)) ctx.diagnostics.error(rpc.node.pos, `rpc name ${rpc.name} makes ${name}, a name the generated TypeScript uses`);
    }
  }
  for (const def of ctx.model.types.game.values()) {
    const rpc = taken.get(def.name);
    if (rpc !== undefined && def.node) ctx.diagnostics.error(def.node.pos, `type name ${def.name} is the generated handler type name of rpc ${rpc}`);
  }
  // The game namespace declares these even when the contract does not define them; a defined one is reported above.
  for (const rpc of ctx.model.rpcs) {
    if (rpc.service !== 'Game') continue;
    for (const name of [`${rpc.name}Handler`, `${rpc.name}Error`]) {
      if (ALWAYS_DECLARED.has(name) && !ctx.model.types.game.has(name)) {
        ctx.diagnostics.error(rpc.node.pos, `rpc name ${rpc.name} makes ${name}, a type name the generated code always declares`);
      }
    }
  }
}

export function checkNames(ctx: CheckContext): void {
  for (const pkg of ['ogw.core', 'game'] as const) {
    const valueNames = new Map<string, Pos>();
    for (const def of ctx.model.types[pkg].values()) {
      if (def.kind === 'message') checkMessage(ctx, def);
      else checkEnum(ctx, def, valueNames);
    }
  }
  for (const rpc of ctx.model.rpcs) {
    if (!PASCAL_CASE.test(rpc.name)) ctx.diagnostics.error(rpc.node.pos, `rpc name ${rpc.name} is not PascalCase`);
  }
  checkGeneratedTypeNames(ctx);
}
