/** Resolved contract: game contract and base proto types, `rpc`s and options, built from the parsed files. */
import type { EnumNode, FieldNode, FileNode, MessageNode, OptionNode, OptionValue, Pos, RpcNode } from './ast.ts';
import type { Diagnostics } from './diagnostics.ts';

export type Pkg = 'game' | 'ogw.core';
export type ScalarType = 'int32' | 'int64' | 'float' | 'double' | 'bool' | 'string' | 'bytes';
export type ServiceKind = 'Game' | 'Cheat' | 'Core' | 'CoreCheat';

export const SCALARS: ReadonlySet<string> = new Set<ScalarType>(['int32', 'int64', 'float', 'double', 'bool', 'string', 'bytes']);
export const OTHER_SCALARS: ReadonlySet<string> = new Set(['uint32', 'uint64', 'sint32', 'sint64', 'fixed32', 'fixed64', 'sfixed32', 'sfixed64']);

export type FieldType =
  | { readonly kind: 'scalar'; readonly scalar: ScalarType }
  | { readonly kind: 'enum'; readonly def: EnumDef }
  | { readonly kind: 'message'; readonly def: MessageDef }
  | { readonly kind: 'unresolved' };

/** Names of `(ogw.v)` limits that hold an integer. */
export const LIMIT_RULES = ['min', 'max', 'max_len', 'max_chars', 'min_count', 'max_count'] as const;
export type LimitRule = (typeof LIMIT_RULES)[number];

/** `(ogw.v)` of a field with `_key` options replaced by the core settings value. */
export interface FieldRules {
  limits: Partial<Record<LimitRule, bigint>>;
  table: string | null;
  unique: boolean;
  /** Limits written with a `_key` option: rule → core settings key. */
  keys: Partial<Record<LimitRule, string>>;
  /** Position of each rule as written. */
  at: Partial<Record<LimitRule | 'table' | 'unique', Pos>>;
}

export interface FieldDef {
  readonly node: FieldNode;
  readonly name: string;
  readonly number: number;
  readonly repeated: boolean;
  type: FieldType;
  readonly rules: FieldRules;
  readonly deprecated: boolean;
}

export interface SourceFile {
  readonly node: FileNode;
  readonly pkg: Pkg;
  /** Game contract file name (`service.proto`), or `core.proto` for the base proto. */
  readonly name: string;
  /** Import paths of the files this file imports. */
  readonly imports: Set<string>;
}

export interface MessageDef {
  readonly kind: 'message';
  readonly pkg: Pkg;
  readonly name: string;
  /** Null for a message the tool adds (module message not defined by the game). */
  readonly file: SourceFile | null;
  readonly node: MessageNode | null;
  readonly fields: FieldDef[];
  readonly isPublic: boolean;
  readonly converters: readonly { readonly value: bigint; readonly pos: Pos }[];
  readonly deprecated: boolean;
}

export interface EnumDef {
  readonly kind: 'enum';
  readonly pkg: Pkg;
  readonly name: string;
  readonly file: SourceFile | null;
  readonly node: EnumNode | null;
  readonly values: readonly { readonly name: string; readonly number: number; readonly pos: Pos; readonly deprecated: boolean }[];
  readonly deprecated: boolean;
}

export type TypeDef = MessageDef | EnumDef;

export interface RpcDef {
  readonly service: ServiceKind;
  readonly name: string;
  /** Request name: `<Name>`, `core/<Name>`, `cheat/<Name>`, `core/cheat/<Name>`. */
  readonly requestName: string;
  readonly node: RpcNode;
  readonly file: SourceFile;
  input: MessageDef | null;
  output: MessageDef | null;
  readonly silent: boolean;
  readonly retry: boolean;
  readonly sensitive: boolean;
  /** `(ogw.errors)` names as written, or null without the option. */
  readonly errors: readonly string[] | null;
  readonly errorsPos: Pos | null;
  /** Value after `changes:` of the last comment line, or null when the last line is not a `changes:` line. */
  readonly changes: string | null;
  readonly deprecated: boolean;
}

export interface CoreErrorsOption {
  readonly rpc: string;
  readonly names: readonly string[];
  readonly pos: Pos;
}

export interface Model {
  readonly files: SourceFile[];
  /** Types by package, then name. */
  readonly types: Record<Pkg, Map<string, TypeDef>>;
  readonly rpcs: RpcDef[];
  readonly coreErrors: CoreErrorsOption[];
}

const SERVICE_PREFIX: Readonly<Record<ServiceKind, string>> = { Game: '', Cheat: 'cheat/', Core: 'core/', CoreCheat: 'core/cheat/' };

export function typeKey(def: TypeDef): string {
  return `${def.pkg}.${def.name}`;
}

function normalizeName(name: string): string {
  return name.replace(/\(\./g, '(');
}

function boolValue(option: OptionNode, diagnostics: Diagnostics): boolean {
  if (option.value.kind === 'bool') return option.value.value;
  diagnostics.error(option.pos, `option ${option.name} takes true or false`);
  return false;
}

function stringValue(option: OptionNode, diagnostics: Diagnostics): string | null {
  if (option.value.kind === 'string') return option.value.value;
  diagnostics.error(option.pos, `option ${option.name} takes a string`);
  return null;
}

/** Records use of a `(ogw.*)` option for the import check. */
interface OptionUse {
  coreOptions: boolean;
}

function isCoreOption(name: string): boolean {
  return name.startsWith('(ogw.');
}

const RULE_TYPES: Readonly<Record<string, 'int' | 'string' | 'bool'>> = {
  min: 'int', max: 'int', max_len: 'int', max_chars: 'int', min_count: 'int', max_count: 'int', table: 'string', unique: 'bool',
  min_key: 'string', max_key: 'string', max_len_key: 'string', max_chars_key: 'string', max_count_key: 'string',
};

export interface RawRule {
  readonly name: string;
  readonly value: bigint | string | boolean;
  readonly pos: Pos;
}

function ruleValue(name: string, value: OptionValue, pos: Pos, diagnostics: Diagnostics): RawRule | null {
  const kind = RULE_TYPES[name];
  if (kind === undefined) {
    diagnostics.error(pos, `(ogw.v) has no option ${name}`);
    return null;
  }
  if (kind === 'int' && value.kind === 'int') return { name, value: value.value, pos };
  if (kind === 'string' && value.kind === 'string') return { name, value: value.value, pos };
  if (kind === 'bool' && value.kind === 'bool') return { name, value: value.value, pos };
  diagnostics.error(pos, `(ogw.v) option ${name} takes ${kind === 'int' ? 'an integer' : kind === 'string' ? 'a string' : 'true or false'}`);
  return null;
}

/** `(ogw.v)` options of a field as written, in order. */
export function rawRules(options: readonly OptionNode[], diagnostics: Diagnostics): RawRule[] {
  const rules: RawRule[] = [];
  for (const option of options) {
    const name = normalizeName(option.name);
    if (name === '(ogw.v)') {
      if (option.value.kind !== 'message') {
        diagnostics.error(option.pos, '(ogw.v) takes a message value {...}');
        continue;
      }
      for (const field of option.value.fields) {
        const rule = ruleValue(field.name, field.value, field.pos, diagnostics);
        if (rule) rules.push(rule);
      }
    } else if (name.startsWith('(ogw.v).')) {
      const rule = ruleValue(name.slice('(ogw.v).'.length), option.value, option.pos, diagnostics);
      if (rule) rules.push(rule);
    }
  }
  const seen = new Set<string>();
  for (const rule of rules) {
    const base = rule.name.replace(/_key$/, '');
    if (seen.has(base)) diagnostics.error(rule.pos, `(ogw.v) sets ${base} twice`);
    seen.add(base);
  }
  return rules;
}

/** Field rules with `_key` options read from core settings; `allowKeys` is false for the game contract. */
export function resolveRules(raw: readonly RawRule[], settings: Readonly<Record<string, unknown>>, allowKeys: boolean, diagnostics: Diagnostics): FieldRules {
  const rules: FieldRules = { limits: {}, table: null, unique: false, keys: {}, at: {} };
  for (const rule of raw) {
    if (rule.name === 'table' && typeof rule.value === 'string') {
      rules.table = rule.value;
      rules.at.table = rule.pos;
    } else if (rule.name === 'unique' && typeof rule.value === 'boolean') {
      rules.unique = rule.value;
      rules.at.unique = rule.pos;
    } else if (rule.name.endsWith('_key') && typeof rule.value === 'string') {
      const base = rule.name.slice(0, -'_key'.length) as LimitRule;
      rules.at[base] = rule.pos;
      if (!allowKeys) {
        diagnostics.error(rule.pos, `game contract does not use the _key option ${rule.name}`);
        continue;
      }
      const value = settings[rule.value];
      if (typeof value !== 'number' || !Number.isInteger(value)) {
        diagnostics.error(rule.pos, `core settings key ${rule.value} of ${rule.name} is ${value === undefined ? 'missing' : 'not an integer'}`);
        continue;
      }
      rules.limits[base] = BigInt(value);
      rules.keys[base] = rule.value;
    } else if (typeof rule.value === 'bigint') {
      const base = rule.name as LimitRule;
      rules.limits[base] = rule.value;
      rules.at[base] = rule.pos;
    }
  }
  return rules;
}

/** Last comment line without trailing empty lines. */
function changesOf(comment: readonly string[]): string | null {
  const lines = comment.map((line) => line.trim());
  while (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
  const last = lines[lines.length - 1];
  if (last?.startsWith('changes:') !== true) return null;
  return last.slice('changes:'.length).trim();
}

export interface BuildInput {
  readonly files: readonly { readonly node: FileNode; readonly pkg: Pkg; readonly name: string }[];
  readonly settings: Readonly<Record<string, unknown>>;
}

class Builder {
  readonly model: Model = { files: [], types: { game: new Map(), 'ogw.core': new Map() }, rpcs: [], coreErrors: [] };
  private readonly diagnostics: Diagnostics;
  private readonly settings: Readonly<Record<string, unknown>>;
  private readonly uses = new Map<SourceFile, OptionUse>();
  private readonly byImport = new Map<string, SourceFile>();

  constructor(diagnostics: Diagnostics, settings: Readonly<Record<string, unknown>>) {
    this.diagnostics = diagnostics;
    this.settings = settings;
  }

  private use(file: SourceFile, name: string): void {
    if (!isCoreOption(name)) return;
    const use = this.uses.get(file);
    if (use) use.coreOptions = true;
  }

  build(input: BuildInput): Model {
    for (const { node, pkg, name } of input.files) {
      const file: SourceFile = { node, pkg, name, imports: new Set(node.imports.map((i) => i.path)) };
      this.model.files.push(file);
      this.uses.set(file, { coreOptions: false });
      this.byImport.set(node.importPath, file);
      this.declareTypes(file);
    }
    for (const file of this.model.files) this.define(file);
    for (const file of this.model.files) {
      const use = this.uses.get(file);
      if (use?.coreOptions === true && !file.imports.has('ogw/options.proto')) {
        this.diagnostics.error(file.node.syntaxPos, 'file uses a ogw option but does not import "ogw/options.proto"');
      }
    }
    return this.model;
  }

  private declareTypes(file: SourceFile): void {
    const types = this.model.types[file.pkg];
    const add = (def: TypeDef, pos: Pos): void => {
      const existing = types.get(def.name);
      if (existing) {
        const where = existing.file ? existing.file.node.display : 'the tool';
        this.diagnostics.error(pos, `type name ${def.name} is already used in ${where}`);
        return;
      }
      types.set(def.name, def);
    };
    const nodes = [...file.node.messages.map((node) => ({ node, what: 'message' as const })), ...file.node.enums.map((node) => ({ node, what: 'enum' as const }))]
      .sort((a, b) => a.node.pos.line - b.node.pos.line || a.node.pos.column - b.node.pos.column);
    for (const item of nodes) {
      if (item.what === 'message') {
        const node = item.node;
        add({ kind: 'message', pkg: file.pkg, name: node.name, file, node, fields: [], isPublic: false, converters: [], deprecated: false }, node.pos);
      } else {
        const node = item.node;
        add({ kind: 'enum', pkg: file.pkg, name: node.name, file, node, ...this.enumOptions(file, node) }, node.pos);
      }
    }
  }

  private enumOptions(file: SourceFile, node: EnumNode): Pick<EnumDef, 'values' | 'deprecated'> {
    const values = node.values.map((v) => ({ name: v.name, number: v.number, pos: v.pos, deprecated: this.onlyDeprecated(file, v.options, 'enum value') }));
    return { values, deprecated: this.onlyDeprecated(file, node.options, 'enum') };
  }

  /** The `deprecated` option of `options`, which may have no other option. */
  private onlyDeprecated(file: SourceFile, options: readonly OptionNode[], what: string): boolean {
    let deprecated = false;
    for (const option of options) {
      const name = normalizeName(option.name);
      this.use(file, name);
      if (name === 'deprecated') deprecated = boolValue(option, this.diagnostics);
      else this.diagnostics.error(option.pos, `option ${option.name} is not allowed on ${what}`);
    }
    return deprecated;
  }

  private define(file: SourceFile): void {
    for (const node of file.node.messages) this.defineMessage(file, node);
    for (const service of file.node.services) {
      this.onlyDeprecated(file, service.options, 'service');
      const kind = (['Game', 'Cheat', 'Core', 'CoreCheat'] as const).find((k) => k === service.name);
      for (const rpc of service.rpcs) this.defineRpc(file, kind ?? null, rpc);
    }
    for (const option of file.node.options) {
      const name = normalizeName(option.name);
      this.use(file, name);
      if (name === 'deprecated') {
        boolValue(option, this.diagnostics);
        continue;
      }
      if (name !== '(ogw.core_errors)') {
        this.diagnostics.error(option.pos, `file option ${option.name} is not allowed`);
        continue;
      }
      const text = stringValue(option, this.diagnostics);
      if (text === null) continue;
      const colon = text.indexOf(':');
      const rpc = colon < 0 ? text.trim() : text.slice(0, colon).trim();
      const names = colon < 0 ? [] : text.slice(colon + 1).split(',').map((n) => n.trim());
      this.model.coreErrors.push({ rpc, names, pos: option.pos });
      if (colon < 0) this.diagnostics.error(option.pos, '(ogw.core_errors) value is "<core rpc>:<GameError>,..."');
    }
  }

  private defineMessage(file: SourceFile, node: MessageNode): void {
    const def = this.model.types[file.pkg].get(node.name);
    if (def?.kind !== 'message' || def.node !== node) return;
    let isPublic = false;
    let deprecated = false;
    const converters: { value: bigint; pos: Pos }[] = [];
    for (const option of node.options) {
      const name = normalizeName(option.name);
      this.use(file, name);
      if (name === '(ogw.public)') isPublic = boolValue(option, this.diagnostics);
      else if (name === 'deprecated') deprecated = boolValue(option, this.diagnostics);
      else if (name === '(ogw.converters)') {
        if (option.value.kind === 'int') converters.push({ value: option.value.value, pos: option.pos });
        else this.diagnostics.error(option.pos, '(ogw.converters) takes an integer');
      } else this.diagnostics.error(option.pos, `option ${option.name} is not allowed on a message`);
    }
    Object.assign(def, { isPublic, deprecated, converters });
    for (const field of node.fields) def.fields.push(this.defineField(file, field));
  }

  private defineField(file: SourceFile, node: FieldNode): FieldDef {
    let deprecated = false;
    for (const option of node.options) {
      const name = normalizeName(option.name);
      this.use(file, name);
      if (name === 'deprecated') deprecated = boolValue(option, this.diagnostics);
      else if (name !== '(ogw.v)' && !name.startsWith('(ogw.v).')) this.diagnostics.error(option.pos, `option ${option.name} is not allowed on a field`);
    }
    const raw = rawRules(node.options, this.diagnostics);
    const rules = resolveRules(raw, this.settings, file.pkg === 'ogw.core', this.diagnostics);
    return {
      node, name: node.name, number: node.number, repeated: node.label === 'repeated',
      type: this.resolveType(file, node.type, node.typePos, node.isMap || node.isGroup), rules, deprecated,
    };
  }

  /** Resolves a type name written in `file`. Reports unknown types and types of files the file does not import. */
  resolveType(file: SourceFile, written: string, pos: Pos, skip = false): FieldType {
    if (skip) return { kind: 'unresolved' };
    if (SCALARS.has(written)) return { kind: 'scalar', scalar: written as ScalarType };
    if (OTHER_SCALARS.has(written)) {
      this.diagnostics.error(pos, `scalar type ${written} is not allowed; use int32, int64, float, double, bool, string or bytes`);
      return { kind: 'unresolved' };
    }
    const def = this.lookup(file, written);
    if (def === null) {
      this.diagnostics.error(pos, `unknown type ${written}`);
      return { kind: 'unresolved' };
    }
    const home = def.file;
    if (home !== null && home !== file && !file.imports.has(home.node.importPath)) {
      this.diagnostics.error(pos, `type ${written} is defined in ${home.node.importPath}, which this file does not import`);
    }
    return def.kind === 'message' ? { kind: 'message', def } : { kind: 'enum', def };
  }

  private lookup(file: SourceFile, written: string): TypeDef | null {
    const name = written.startsWith('.') ? written.slice(1) : written;
    for (const pkg of ['ogw.core', 'game'] as const) {
      if (name.startsWith(`${pkg}.`)) return this.model.types[pkg].get(name.slice(pkg.length + 1)) ?? null;
    }
    if (name.includes('.') || written.startsWith('.')) return null;
    return this.model.types[file.pkg].get(name) ?? null;
  }

  private defineRpc(file: SourceFile, service: ServiceKind | null, node: RpcNode): void {
    let silent = false;
    let retry = false;
    let sensitive = false;
    let deprecated = false;
    let errors: string[] | null = null;
    let errorsPos: Pos | null = null;
    for (const option of node.options) {
      const name = normalizeName(option.name);
      this.use(file, name);
      if (name === '(ogw.silent)') silent = boolValue(option, this.diagnostics);
      else if (name === '(ogw.retry)') retry = boolValue(option, this.diagnostics);
      else if (name === '(ogw.sensitive)') sensitive = boolValue(option, this.diagnostics);
      else if (name === 'deprecated') deprecated = boolValue(option, this.diagnostics);
      else if (name === '(ogw.errors)') {
        const text = stringValue(option, this.diagnostics);
        errors = text === null ? [] : text.split(',').map((n) => n.trim());
        errorsPos = option.pos;
      } else this.diagnostics.error(option.pos, `option ${option.name} is not allowed on an rpc`);
    }
    if (service === null) return;
    const input = this.resolveType(file, node.input, node.pos);
    const output = this.resolveType(file, node.output, node.pos);
    this.model.rpcs.push({
      service, name: node.name, requestName: `${SERVICE_PREFIX[service]}${node.name}`, node, file,
      input: input.kind === 'message' ? input.def : null, output: output.kind === 'message' ? output.def : null,
      silent, retry, sensitive, errors, errorsPos, changes: changesOf(node.comment), deprecated,
    });
    if (input.kind === 'enum' || output.kind === 'enum') this.diagnostics.error(node.pos, 'rpc request and response are messages');
  }
}

/** Builds the model. Type and option errors go to `diagnostics`; the model is still built with unresolved types. */
export function buildModel(input: BuildInput, diagnostics: Diagnostics): Model {
  return new Builder(diagnostics, input.settings).build(input);
}

/** Messages and enums reached from `roots` by field types, roots included, in reach order. */
export function reach(roots: Iterable<TypeDef>): TypeDef[] {
  const seen = new Set<TypeDef>();
  const order: TypeDef[] = [];
  const stack = [...roots].reverse();
  while (stack.length > 0) {
    const def = stack.pop();
    if (def === undefined || seen.has(def)) continue;
    seen.add(def);
    order.push(def);
    if (def.kind !== 'message') continue;
    for (const field of [...def.fields].reverse()) {
      if (field.type.kind === 'message' || field.type.kind === 'enum') stack.push(field.type.def);
    }
  }
  return order;
}

/** Types declared in the model in declaration order: by file, then as in the file. */
export function declaredTypes(model: Model, pkg: Pkg): TypeDef[] {
  return [...model.types[pkg].values()];
}
