/**
 * The build after the check: ID values, build target split, data proto, generated code and binaries
 * (`data` tool.md `## processing`).
 */
import { forEachReference } from './check-refs.ts';
import type { RunContext } from './context.ts';
import { REQUIREMENT_TABLE, type SpecTable } from './corespec.ts';
import { compareBytes } from './diag.ts';
import { SYSTEM_SCHEMA } from './load.ts';
import { cellText, column, type Row, type Table } from './model.ts';
import { dataHash, protocolHash, protoText } from './proto.ts';
import { builtTextKey, intOf, replaceIdNames, tableBytes, translationBytes, type ItemAmountFields, type Resolver } from './binary.ts';
import { genColumns, inTarget, refTargetType, targetSchema, targetsOf, TARGETS, type GenEnum, type GenRow, type GenTable, type Target, type TargetSchema } from './schema.ts';
import { godotDataFiles } from './godotgen.ts';
import { gameDataDevTs, gameDataTs, type AccessorInput } from './tsgen.ts';
import { enumsOf, isCommaType, type BuildTarget, type ColumnType } from './types.ts';
import { flatText } from './model.ts';
import { keyPart, translationKey } from './translation.ts';
import { splitElements, splitVector, type Value } from './values.ts';

function rowTargets(table: Table, row: Row): ReadonlySet<Target> {
  if (table.name === 'game_setting' || table.name === 'reserved_id') {
    const col = column(table, 'target');
    return targetsOf(col ? cellText(row, col) : '');
  }
  if (table.name === 'remote_config_key') {
    const col = column(table, 'client');
    return targetsOf(col && cellText(row, col) === 'false' ? 'Server' : 'All');
  }
  return targetsOf('All');
}

function genRow(table: Table, row: Row): GenRow {
  const texts: GenRow['texts'] = new Map();
  for (const col of table.columns) {
    const t = col.type;
    if (t?.k !== 'tstring' || cellText(row, col) === '') continue;
    texts.set(col.name, { parts: t.keyCols.map((name) => keyPart(table, row, name)), source: cellText(row, col) });
  }
  return { values: new Map(row.values), texts, targets: rowTargets(table, row) };
}

/** The `requirement` rows with the build targets of `data` skill `### requirement expression`. */
function requirementTable(ctx: RunContext, spec: SpecTable): GenTable {
  const targets = new Map<string, Set<Target>>(ctx.requirementRows.map((r) => [r.name, new Set(r.origin)]));
  for (const table of ctx.data.tables.values()) {
    for (const row of table.rows) {
      for (const col of table.columns) {
        const v = row.values.get(col.name);
        const t = settingColumnType(ctx, table, row, col.name) ?? col.type;
        if (v === undefined || t === null) continue;
        const cellTargets = table.kind === 'system' && col.name === 'value' ? rowTargets(table, row) : targetsOf(col.target);
        forEachReference(v, t, (ref) => {
          const names = ref.kind === 'idname' ? [ref.name] : ref.kind === 'text' ? [...ref.text.matchAll(/\[req__[a-z0-9_]+\]/g)].map((m) => m[0]) : ref.kind === 'ref' && ref.value.k === 'idname' ? [ref.value.name] : [];
          for (const n of names) for (const x of cellTargets) targets.get(n)?.add(x);
        });
      }
    }
  }
  for (let changed = true; changed;) {
    changed = false;
    for (const r of ctx.requirementRows) {
      const own = targets.get(r.name) as Set<Target>;
      for (const c of r.children) {
        const child = targets.get(c);
        for (const x of own) if (child && !child.has(x)) { child.add(x); changed = true; }
      }
    }
  }
  const rows: GenRow[] = ctx.requirementRows.map((r) => {
    const values = new Map<string, Value>([
      ['id', { k: 'idname', name: r.name }],
      ['type', r.type === null ? { k: 'null' } : { k: 'enum', element: r.type }],
      ['target_id', r.target === null ? { k: 'int', v: 0n } : r.targetForm.kind === 'enum' ? { k: 'int', v: BigInt(enumValueIn(ctx, r.targetForm.enumType, r.target)) } : { k: 'idname', name: r.target }],
      ['value', { k: 'int', v: r.value }],
      ['children', { k: 'list', items: r.children.map((c) => ({ k: 'idname', name: c })) }],
      ['logic', r.logic === null ? { k: 'null' } : { k: 'enum', element: r.logic }],
    ]);
    return { values, texts: new Map(), targets: targets.get(r.name) ?? new Set() };
  });
  return { name: REQUIREMENT_TABLE, keyed: true, columns: genColumns(spec.columns), rows };
}

function enumValueIn(ctx: RunContext, type: string, element: string): number {
  return ctx.enums.get(type)?.find((e) => e.element === element)?.value ?? 0;
}

function settingColumnType(ctx: RunContext, table: Table, row: Row, col: string): ColumnType | null | undefined {
  if (table.name !== 'game_setting' || col !== 'value') return undefined;
  const id = table.columns[0];
  return id ? (ctx.settingTypes.get(cellText(row, id)) ?? null) : null;
}

/** Every table the generated code has. */
export function genTables(ctx: RunContext): Map<string, GenTable> {
  const out = new Map<string, GenTable>();
  for (const table of ctx.data.tables.values()) {
    const columns = table.columns.filter((c) => c.type !== null).map((c) => ({ name: c.name, description: c.description, target: c.target, type: c.type as ColumnType }));
    out.set(table.name, { name: table.name, keyed: table.columns[0]?.type?.k === 'id' && table.columns[0].type.key, columns, rows: table.rows.map((r) => genRow(table, r)) });
  }
  for (const [name, { table }] of ctx.core.allTables) {
    if (name === REQUIREMENT_TABLE) out.set(name, requirementTable(ctx, table));
    else if (!out.has(name)) out.set(name, { name, keyed: table.columns[0]?.type === 'id(key)', columns: genColumns(table.columns), rows: [] });
  }
  for (const [name, schema] of Object.entries(SYSTEM_SCHEMA)) {
    if (!out.has(name)) out.set(name, { name, keyed: true, columns: genColumns(schema.map(([n, type, target]) => ({ name: n, type, target, description: '' }))), rows: [] });
  }
  return out;
}

/** Every enum the generated code has: data enums, `core-spec.json` enums, and `None`-only enums column types name. */
export function genEnums(ctx: RunContext, tables: ReadonlyMap<string, GenTable>): GenEnum[] {
  const out = new Map<string, GenEnum>();
  for (const [type, elements] of ctx.enums) out.set(type, { type, elements });
  for (const [type, elements] of ctx.core.allEnums) {
    if (!out.has(type)) out.set(type, { type, elements: elements.map((element, i) => ({ element, value: i + 1 })) });
  }
  for (const t of tables.values()) {
    for (const c of t.columns) for (const e of enumsOf(c.type)) if (!out.has(e)) out.set(e, { type: e, elements: [] });
  }
  return [...out.values()];
}

/** The built text of a `game_setting` value (`data` skill `### game_setting.csv`). */
function builtArrayText(v: Value, elem: ColumnType, raw: string, r: Resolver): string {
  if (v.k !== 'list') return '';
  const raws = splitElements(raw, elem);
  return v.items.map((item, i) => builtSettingText(item, elem, raws[i] ?? '', r)).join(isCommaType(elem) ? ',' : '\n');
}

function builtScalarText(v: Value, s: ColumnType, r: Resolver): string {
  if (v.k === 'float') return v.text;
  if (v.k === 'bool') return String(v.v);
  if (v.k === 'enum' && s.k === 'enum') return String(r.enumValue(s.enumType, v.element));
  if (v.k === 'text') return s.k === 'string' ? replaceIdNames(v.v, r) : v.v;
  return intOf(v, r).toString();
}

export function builtSettingText(v: Value, t: ColumnType, raw: string, r: Resolver): string {
  const s = refTargetType(r.tables, t);
  if (s.k === 'vector') return splitVector(raw).join(',');
  if (s.k === 'array') return builtArrayText(v, s.elem, raw, r);
  return builtScalarText(v, s, r);
}

/** Replaces the `value` of `game_setting` and `reserved_id` rows by their built text. */
function buildSettingValues(ctx: RunContext, tables: Map<string, GenTable>, r: Resolver): void {
  const settings = ctx.data.tables.get('game_setting');
  const gs = tables.get('game_setting');
  const id = settings?.columns[0];
  const value = settings ? column(settings, 'value') : undefined;
  if (!settings || !gs || !id || !value) return;
  for (const [i, row] of settings.rows.entries()) {
    const t = ctx.settingTypes.get(cellText(row, id));
    const v = row.values.get('value');
    const g = gs.rows[i];
    if (g && t && v) g.values.set('value', { k: 'text', v: t.k === 'requirement' ? String(intOf(v, r)) : builtSettingText(v, t, cellText(row, value), r) });
  }
}

function buildSystemValues(ctx: RunContext, tables: Map<string, GenTable>, r: Resolver): void {
  buildSettingValues(ctx, tables, r);
  const reserved = tables.get('reserved_id');
  for (const g of reserved?.rows ?? []) {
    const v = g.values.get('value');
    const text = v?.k === 'text' ? v.v : '';
    g.values.set('value', { k: 'text', v: text === '' ? '' : String(r.idValue(text)) });
  }
}

export interface BuildOutput {
  /** Generated files by path relative to the server folder, e.g. `generated/data/game_data.proto`. */
  server: Map<string, Uint8Array | string>;
  /** Godot client generated files by path relative to the Godot project, e.g. `generated/data/game_data.gd`. */
  client: Map<string, Uint8Array | string>;
  /** Data versions by build target. */
  versions: Record<Target, string>;
  /** Protocol hashes by build target. */
  protocols: Record<Target, string>;
  schemas: Record<Target, TargetSchema>;
}

function accessorInput(ctx: RunContext, target: Target, r: Resolver): AccessorInput & { reservedSounds: { name: string; idValue: number }[] } {
  const settings = ctx.data.tables.get('game_setting');
  const id = settings?.columns[0];
  const list: AccessorInput['settings'] = [];
  for (const row of settings?.rows ?? []) {
    const name = id ? cellText(row, id) : '';
    const type = ctx.settingTypes.get(name);
    if (type && settings && rowTargets(settings, row).has(target)) list.push({ name, idValue: r.idValue(name), type });
  }
  const names = (table: 'reserved_id' | 'reserved_string' | 'reserved_sound'): { name: string; idValue: number }[] => {
    const set = new Set(ctx.core.allReserved.filter((x) => x.table === table).map((x) => x.id));
    const t = ctx.data.tables.get(table);
    const tid = t?.columns[0];
    for (const row of t?.rows ?? []) if (tid) set.add(cellText(row, tid));
    return [...set].map((name) => ({ name, idValue: r.idValue(name) }));
  };
  return { settings: list, reservedIds: names('reserved_id'), reservedStrings: names('reserved_string'), reservedSounds: names('reserved_sound') };
}

function translationFiles(ctx: RunContext, schema: TargetSchema, r: Resolver): Map<string, Uint8Array> {
  const out = new Map<string, Uint8Array>();
  const language = schema.tables.find((t) => t.table.name === 'language');
  const byBuilt = new Map<string, { built: string; key: string; source: string }>();
  for (const t of schema.tables) {
    for (const f of t.rowMessage.fields.filter((x) => x.type.k === 'tstring')) {
      for (const row of t.rows) {
        const text = row.texts.get(f.name);
        const built = builtTextKey(t.table.name, f.name, row, r);
        if (text && !byBuilt.has(built)) byBuilt.set(built, { built, key: translationKey(t.table.name, f.name, text.parts), source: text.source });
      }
    }
  }
  const entries = [...byBuilt.values()].sort((a, b) => compareBytes(a.built, b.built));
  for (const row of language?.rows ?? []) {
    const code = row.values.get('code');
    if (code?.k !== 'text') continue;
    const file = ctx.data.translations.get(code.v);
    const texts = new Map((file?.records ?? []).map((x) => [flatText(x, 'key'), flatText(x, 'text')]));
    const list = entries.map((e) => ({ key: e.built, text: code.v === ctx.sourceLanguage ? e.source : (texts.get(e.key) ?? '') || e.source }));
    out.set(`translation_${code.v.toLowerCase()}.bin`, translationBytes(list));
  }
  return out;
}

function versionOf(proto: string, tables: ReadonlyMap<string, Uint8Array>): { version: string; protocol: string } {
  const protocol = protocolHash(new Map([['game_data.proto', proto]]));
  return { version: `${protocol}-${dataHash(tables)}`, protocol };
}

/** Builds every generation target of the server, with the data version of both build targets. */
export function build(ctx: RunContext, ids: ReadonlyMap<string, number>, itemAmount: ItemAmountFields | null): BuildOutput {
  const tables = genTables(ctx);
  const enums = genEnums(ctx, tables);
  const enumValues = new Map(enums.map((e) => [e.type, new Map(e.elements.map((x) => [x.element, x.value]))]));
  const r: Resolver = {
    idValue: (name) => ids.get(name) ?? 0,
    enumValue: (type, element) => enumValues.get(type)?.get(element) ?? 0,
    tables, itemAmount,
  };
  buildSystemValues(ctx, tables, r);
  const server = new Map<string, Uint8Array | string>();
  const client = new Map<string, Uint8Array | string>();
  const versions = {} as Record<Target, string>;
  const protocols = {} as Record<Target, string>;
  const schemas = {} as Record<Target, TargetSchema>;
  for (const target of TARGETS) {
    const schema = targetSchema(target, tables, enums);
    schemas[target] = schema;
    const proto = protoText(schema);
    const bins = new Map(schema.tables.map((t) => [`${t.table.name}.bin`, tableBytes(t, r)]));
    const v = versionOf(proto, bins);
    versions[target] = v.version;
    protocols[target] = v.protocol;
    if (target === 'Client') {
      client.set('generated/data/game_data.proto', proto);
      for (const [path, text] of godotDataFiles(schema, tables, ids, accessorInput(ctx, target, r))) client.set(path, text);
      for (const [name, bytes] of [...bins, ...translationFiles(ctx, schema, r)]) client.set(`build/data/${name}`, bytes);
      client.set('build/data/data_version', `${v.version}\n`);
      continue;
    }
    server.set('generated/data/game_data.proto', proto);
    server.set('generated/data/game_data.ts', gameDataTs(schema, tables, accessorInput(ctx, target, r)));
    server.set('dev/generated/data/game_data_dev.ts', gameDataDevTs(ids));
    for (const [name, bytes] of [...bins, ...translationFiles(ctx, schema, r)]) server.set(`build/data/${name}`, bytes);
    server.set('build/data/data_version', `${v.version}\n`);
  }
  server.set('build/data/client_data_version', `${versions.Client}\n`);
  return { server, client, versions, protocols, schemas };
}

/** Whether a build target column is in the target: exported for checks that look at build targets. */
export function columnInTarget(t: BuildTarget, target: Target): boolean {
  return inTarget(t, target);
}
