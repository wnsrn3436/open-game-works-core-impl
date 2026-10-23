/** `data/enums.csv` and `data/requirement_types.csv` (`data` skill `## enum and invariant`, `### requirement expression`). */
import type { EnumElement, RunContext } from './context.ts';
import { ENUMS_HEADER, REQUIREMENT_TYPES_HEADER } from './data.ts';
import { filePlace } from './diag.ts';
import { sameHeader } from './load.ts';
import { flatPlace, flatText, type FlatFile } from './model.ts';
import type { RequirementTypeForm } from './requirement.ts';
import { isPascalCase } from './types.ts';

function readEnumRow(ctx: RunContext, file: FlatFile, r: FlatFile['records'][number], out: Map<string, EnumElement[]>): void {
  const type = flatText(r, 'type');
  const element = flatText(r, 'element');
  const valueText = flatText(r, 'value');
  if (!isPascalCase(type)) ctx.diags.add('bad_name', flatPlace(file, r, 'type'), `enum type ${JSON.stringify(type)} is not PascalCase`);
  if (!isPascalCase(element)) ctx.diags.add('bad_name', flatPlace(file, r, 'element'), `enum element ${JSON.stringify(element)} is not PascalCase`);
  if (element === 'None') ctx.diags.add('reserved_name', flatPlace(file, r, 'element'), 'None is the element the data tool adds');
  if (!/^-?[0-9]+$/.test(valueText)) {
    ctx.diags.add('value_type', flatPlace(file, r, 'value'), `value ${JSON.stringify(valueText)} is not an integer`);
    return;
  }
  const value = Number(valueText);
  if (value < 1 || value > 2 ** 31 - 1) ctx.diags.add('out_of_range', flatPlace(file, r, 'value'), `value ${valueText} is not 1 or more int32`);
  const list = out.get(type) ?? [];
  if (list.some((e) => e.element === element)) ctx.diags.add('duplicate', flatPlace(file, r, 'element'), `${type}.${element} is in the file twice`);
  else if (list.some((e) => e.value === value)) ctx.diags.add('duplicate', flatPlace(file, r, 'value'), `${type} value ${valueText} is in the file twice`);
  else list.push({ element, value });
  out.set(type, list);
}

function checkCoreEnums(ctx: RunContext, file: FlatFile, out: Map<string, EnumElement[]>): void {
  for (const [type, elements] of ctx.core.enums) {
    const have = out.get(type) ?? [];
    const want = elements.map((element, i) => ({ element, value: i + 1 }));
    const same = have.length === want.length && want.every((w) => have.some((h) => h.element === w.element && h.value === w.value));
    if (!same) ctx.diags.add('structure', filePlace(file.file), `enum ${type} is not the core data ${want.map((w) => `${w.element}=${String(w.value)}`).join(', ')}`);
  }
}

/** Reads and checks `data/enums.csv` into the enum model. */
export function checkEnums(ctx: RunContext): Map<string, EnumElement[]> {
  const out = new Map<string, EnumElement[]>();
  const file = ctx.data.enums;
  if (file === null) return out;
  if (!sameHeader(file, ENUMS_HEADER)) {
    ctx.diags.add('structure', filePlace(file.file), `the header is not ${ENUMS_HEADER.join(',')}`);
    return out;
  }
  for (const r of file.records) readEnumRow(ctx, file, r, out);
  for (const list of out.values()) list.sort((a, b) => a.value - b.value);
  checkCoreEnums(ctx, file, out);
  return out;
}

function readForm(ctx: RunContext, file: FlatFile, r: FlatFile['records'][number]): RequirementTypeForm | null {
  const target = flatText(r, 'target');
  const value = flatText(r, 'value');
  if (value !== 'true' && value !== 'false') {
    ctx.diags.add('structure', flatPlace(file, r, 'value'), `value ${JSON.stringify(value)} is not true or false`);
    return null;
  }
  if (target === 'none') return { target: { kind: 'none' }, value: value === 'true' };
  const ref = /^ref<([a-z][a-z0-9_]*)\.id>$/.exec(target);
  if (ref) {
    if (!ctx.data.tables.has(ref[1] as string)) ctx.diags.add('ref_missing', flatPlace(file, r, 'target'), `table ${ref[1] as string} is not there`);
    return { target: { kind: 'ref', table: ref[1] as string }, value: value === 'true' };
  }
  const en = /^enum<([A-Z][A-Za-z0-9]*)>$/.exec(target);
  if (en) {
    if (!ctx.enums.has(en[1] as string)) ctx.diags.add('ref_missing', flatPlace(file, r, 'target'), `enum ${en[1] as string} is not there`);
    return { target: { kind: 'enum', enumType: en[1] as string }, value: value === 'true' };
  }
  ctx.diags.add('structure', flatPlace(file, r, 'target'), `target ${JSON.stringify(target)} is not none, ref<<table>.id> or enum<<Type>>`);
  return null;
}

/** Reads and checks `data/requirement_types.csv` into the argument form of each `RequirementType` element. */
export function checkRequirementTypes(ctx: RunContext): Map<string, RequirementTypeForm> {
  const out = new Map<string, RequirementTypeForm>();
  const file = ctx.data.requirementTypes;
  if (file === null) return out;
  if (!sameHeader(file, REQUIREMENT_TYPES_HEADER)) {
    ctx.diags.add('structure', filePlace(file.file), `the header is not ${REQUIREMENT_TYPES_HEADER.join(',')}`);
    return out;
  }
  const elements = new Set((ctx.enums.get('RequirementType') ?? []).map((e) => e.element));
  for (const r of file.records) {
    const element = flatText(r, 'element');
    if (!elements.has(element)) ctx.diags.add('ref_missing', flatPlace(file, r, 'element'), `${element} is not a RequirementType element`);
    if (out.has(element)) {
      ctx.diags.add('duplicate', flatPlace(file, r, 'element'), `${element} is in the file twice`);
      continue;
    }
    const form = readForm(ctx, file, r);
    if (form) out.set(element, form);
  }
  for (const e of elements) {
    if (!file.records.some((r) => flatText(r, 'element') === e)) ctx.diags.add('required_missing', filePlace(file.file), `RequirementType ${e} has no row`);
  }
  return out;
}
