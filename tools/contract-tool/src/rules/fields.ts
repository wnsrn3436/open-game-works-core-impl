/** Field rules: field validation declarations, time fields, big encoding pairs. */
import type { FieldDef, LimitRule, MessageDef, Model } from '../model.ts';
import { reach } from '../model.ts';
import { VALIDATED_MODULE_MESSAGES, type CheckContext } from './context.ts';

const INT32_MIN = -2147483648n;
const INT32_MAX = 2147483647n;
const INT64_MIN = -9223372036854775808n;
const INT64_MAX = 9223372036854775807n;

/** Messages that get a field validator: `rpc` requests and the validated module messages of the game. */
export function validatedRoots(model: Model): MessageDef[] {
  const roots: MessageDef[] = [];
  for (const rpc of model.rpcs) if (rpc.input) roots.push(rpc.input);
  for (const def of model.types.game.values()) {
    if (def.kind === 'message' && VALIDATED_MODULE_MESSAGES.has(def.name)) roots.push(def);
  }
  return roots;
}

/** Messages whose fields declare validation: the validated roots and the messages they reach. */
export function validatedMessages(model: Model): Set<MessageDef> {
  return new Set(reach(validatedRoots(model)).filter((d): d is MessageDef => d.kind === 'message'));
}

function isInteger(field: FieldDef): boolean {
  return field.type.kind === 'scalar' && (field.type.scalar === 'int32' || field.type.scalar === 'int64');
}

function scalarOf(field: FieldDef): string | null {
  return field.type.kind === 'scalar' ? field.type.scalar : null;
}

type RuleName = LimitRule | 'table' | 'unique';

function declared(field: FieldDef, rule: RuleName): boolean {
  if (rule === 'table') return field.rules.table !== null;
  if (rule === 'unique') return field.rules.unique;
  return field.rules.limits[rule] !== undefined;
}

/** Field types each option is for. */
const OPTION_TYPES: readonly { readonly rules: readonly RuleName[]; readonly fits: (field: FieldDef) => boolean; readonly message: string }[] = [
  { rules: ['min', 'max'], fits: isInteger, message: 'min and max are for integer fields' },
  { rules: ['max_len'], fits: (f) => scalarOf(f) === 'string' || scalarOf(f) === 'bytes', message: 'max_len is for string and bytes fields' },
  { rules: ['max_chars'], fits: (f) => scalarOf(f) === 'string', message: 'max_chars is for string fields' },
  { rules: ['min_count', 'max_count'], fits: (f) => f.repeated, message: 'min_count and max_count are for repeated fields' },
  { rules: ['unique'], fits: (f) => f.repeated, message: 'unique is for repeated fields' },
  { rules: ['unique'], fits: (f) => f.type.kind !== 'message', message: 'unique is not for message fields' },
  { rules: ['table'], fits: (f) => scalarOf(f) === 'int32', message: 'table is for int32 ID value fields' },
];

/** Each declared option fits the field type. */
function checkApplicable(ctx: CheckContext, def: MessageDef, field: FieldDef): void {
  for (const { rules, fits, message } of OPTION_TYPES) {
    const rule = rules.find((r) => declared(field, r));
    if (rule !== undefined && !fits(field)) ctx.diagnostics.error(field.rules.at[rule] ?? field.node.pos, message);
  }
  const table = field.rules.table;
  if (table !== null && def.pkg === 'game' && !ctx.tableNames.has(table)) {
    ctx.diagnostics.error(field.rules.at.table ?? field.node.pos, `table ${table} is not a table of the server build target`);
  }
}

/** Declared values are in range and in order. */
function checkRanges(ctx: CheckContext, field: FieldDef): void {
  const { limits, at } = field.rules;
  const error = (rule: LimitRule, message: string): void => {
    ctx.diagnostics.error(at[rule] ?? field.node.pos, message);
  };
  const scalar = scalarOf(field);
  const [low, high] = scalar === 'int32' ? [INT32_MIN, INT32_MAX] : [INT64_MIN, INT64_MAX];
  for (const rule of ['min', 'max'] as const) {
    const value = limits[rule];
    if (value !== undefined && (value < low || value > high)) error(rule, `${rule} ${String(value)} is out of the ${scalar ?? 'field'} range`);
  }
  for (const rule of ['max_len', 'max_chars', 'min_count', 'max_count'] as const) {
    const value = limits[rule];
    if (value !== undefined && (value < 0n || value > INT32_MAX)) error(rule, `${rule} ${String(value)} is out of range 0 to 2147483647`);
  }
  for (const [low, high] of [['min', 'max'], ['min_count', 'max_count']] as const) {
    const a = limits[low];
    const b = limits[high];
    if (a !== undefined && b !== undefined && a > b) error(low, `${low} is greater than ${high}`);
  }
}

/** A field of a validated message declares the options its type needs. */
function checkDeclared(ctx: CheckContext, def: MessageDef, field: FieldDef): void {
  const { limits, table } = field.rules;
  const scalar = scalarOf(field);
  const missing: string[] = [];
  if (field.repeated && limits.max_count === undefined) missing.push('max_count');
  if (scalar === 'string' && limits.max_len === undefined && limits.max_chars === undefined) missing.push('max_len or max_chars');
  if (scalar === 'bytes' && limits.max_len === undefined) missing.push('max_len');
  if (isInteger(field) && table === null && (limits.min === undefined || limits.max === undefined)) missing.push('min and max, or table');
  if (missing.length > 0) ctx.diagnostics.error(field.node.pos, `field ${field.name} of ${def.name} is validated and declares (ogw.v) ${missing.join(', ')}`);
}

function checkFieldForm(ctx: CheckContext, def: MessageDef, field: FieldDef): void {
  const scalar = scalarOf(field);
  if ((field.name.endsWith('_at') || field.name.endsWith('_ms')) && scalar !== 'int64') {
    ctx.diagnostics.error(field.node.pos, `field ${field.name} is a time or duration and is int64`);
  }
  if (field.name.startsWith('big_') && scalar === 'string') {
    const pair = def.fields.find((f) => f.name === field.name.slice('big_'.length));
    if (pair === undefined || scalarOf(pair) !== 'int64' || pair.repeated !== field.repeated) {
      ctx.diagnostics.error(field.node.pos, `big encoding field ${field.name} needs int64 ${field.name.slice('big_'.length)} in the same message`);
    }
  }
}

/** Fields that `root` reaches whose `table` option names a table not in `tableNames`. */
export function missingTables(root: MessageDef, tableNames: ReadonlySet<string>): { def: MessageDef; field: FieldDef; table: string }[] {
  const missing: { def: MessageDef; field: FieldDef; table: string }[] = [];
  for (const def of reach([root])) {
    if (def.kind !== 'message') continue;
    for (const field of def.fields) {
      const table = field.rules.table;
      if (table !== null && !tableNames.has(table)) missing.push({ def, field, table });
    }
  }
  return missing;
}

/** A game validator checks every `table` its message reaches, base proto messages included. */
function checkReachedTables(ctx: CheckContext): void {
  for (const root of validatedRoots(ctx.model)) {
    if (root.pkg !== 'game' || root.node === null) continue;
    for (const { def, field, table } of missingTables(root, ctx.tableNames)) {
      if (def.pkg === 'game') continue;
      ctx.diagnostics.error(root.node.pos, `${root.name} reaches ${def.name}.${field.name} with table ${table}, which is not a table of the server build target`);
    }
  }
}

export function checkFields(ctx: CheckContext): void {
  checkReachedTables(ctx);
  const validated = validatedMessages(ctx.model);
  for (const pkg of ['ogw.core', 'game'] as const) {
    for (const def of ctx.model.types[pkg].values()) {
      if (def.kind !== 'message' || def.node === null) continue;
      for (const field of def.fields) {
        checkApplicable(ctx, def, field);
        checkRanges(ctx, field);
        checkFieldForm(ctx, def, field);
        if (validated.has(def)) checkDeclared(ctx, def, field);
      }
    }
  }
}
