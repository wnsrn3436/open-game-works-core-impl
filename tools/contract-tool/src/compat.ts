/** Backward compatibility with the last PROD build and the contract version. */
import type { Pos } from './ast.ts';
import type { Diagnostics } from './diagnostics.ts';
import { reach, type EnumDef, type FieldDef, type FieldRules, type MessageDef, type Model, type Pkg, type RpcDef, type TypeDef } from './model.ts';
import { kindStore } from './rules/context.ts';
import { validatedMessages } from './rules/fields.ts';

function typeText(field: FieldDef): string {
  const t = field.type;
  const base = t.kind === 'scalar' ? t.scalar : t.kind === 'unresolved' ? field.node.type : `${t.def.pkg}.${t.def.name}`;
  return field.repeated ? `repeated ${base}` : base;
}

function posOf(def: TypeDef | null, fallback: Pos): Pos {
  return def?.node?.pos ?? fallback;
}

class Comparer {
  private readonly prev: Model;
  private readonly cur: Model;
  private readonly diagnostics: Diagnostics;
  private readonly pkgs: readonly Pkg[];

  constructor(prev: Model, cur: Model, diagnostics: Diagnostics, pkgs: readonly Pkg[]) {
    this.prev = prev;
    this.cur = cur;
    this.diagnostics = diagnostics;
    this.pkgs = pkgs;
  }

  run(): void {
    // A message is validated for old clients only when the previous build validated it, and it narrows only when it is still validated.
    const wasValidated = validatedMessages(this.prev);
    const validated = validatedMessages(this.cur);
    for (const pkg of this.pkgs) {
      for (const before of this.prev.types[pkg].values()) {
        const after = this.cur.types[pkg].get(before.name) ?? null;
        const at = before.node?.pos;
        if (at === undefined) continue;
        if (after?.kind !== before.kind) {
          this.diagnostics.error(posOf(after, at), `${before.kind} ${before.name} was removed or renamed`);
        } else if (before.kind === 'message' && after.kind === 'message') {
          this.message(before, after, wasValidated.has(before) && validated.has(after));
        } else if (before.kind === 'enum' && after.kind === 'enum') {
          this.enumeration(before, after);
        }
      }
    }
    this.rpcs();
    if (this.pkgs.includes('game')) this.coreErrors();
  }

  private message(before: MessageDef, after: MessageDef, validated: boolean): void {
    const at = after.node?.pos ?? before.node?.pos;
    if (at === undefined) return;
    for (const old of before.fields) this.field(after, old, validated, at);
    if (validated) {
      for (const field of after.fields) {
        if (!before.fields.some((f) => f.number === field.number)) this.newField(after, field);
      }
    }
    if (before.isPublic && !after.isPublic) this.diagnostics.error(at, `(ogw.public) was removed from ${after.name}`);
    for (const converter of before.converters) {
      if (!after.converters.some((c) => c.value === converter.value)) this.diagnostics.error(at, `(ogw.converters) ${String(converter.value)} was removed from ${after.name}`);
    }
  }

  private field(after: MessageDef, old: FieldDef, validated: boolean, at: Pos): void {
    const field = after.fields.find((f) => f.number === old.number);
    if (field === undefined) {
      const renumbered = after.fields.find((f) => f.name === old.name);
      if (renumbered) this.diagnostics.error(renumbered.node.pos, `field ${old.name} of ${after.name} changed its number ${String(old.number)}`);
      else this.diagnostics.error(at, `field ${String(old.number)} ${old.name} of ${after.name} was removed`);
      return;
    }
    if (field.name !== old.name) this.diagnostics.error(field.node.pos, `field ${String(old.number)} of ${after.name} was renamed from ${old.name} to ${field.name}`);
    if (typeText(field) !== typeText(old)) this.diagnostics.error(field.node.pos, `field ${field.name} of ${after.name} changed its type from ${typeText(old)} to ${typeText(field)}`);
    if (validated) this.narrowing(after, old.rules, field);
  }

  /** A validation option that accepts fewer values than before. */
  private narrowing(message: MessageDef, old: FieldRules, field: FieldDef): void {
    const now = field.rules;
    const narrower: string[] = [];
    const lowered = (rule: 'max' | 'max_len' | 'max_chars' | 'max_count'): boolean => {
      const a = old.limits[rule];
      const b = now.limits[rule];
      return b !== undefined && (a === undefined || b < a);
    };
    const raised = (rule: 'min' | 'min_count'): boolean => {
      const a = old.limits[rule];
      const b = now.limits[rule];
      return b !== undefined && (a === undefined ? rule === 'min' || b > 0n : b > a);
    };
    for (const rule of ['max', 'max_len', 'max_chars', 'max_count'] as const) if (lowered(rule)) narrower.push(rule);
    for (const rule of ['min', 'min_count'] as const) if (raised(rule)) narrower.push(rule);
    if (now.table !== null && now.table !== old.table) narrower.push('table');
    if (now.unique && !old.unique) narrower.push('unique');
    if (narrower.length > 0) this.diagnostics.error(field.node.pos, `field ${field.name} of ${message.name} narrows validation: ${narrower.join(', ')}`);
  }

  /** A new field of an existing validated message whose default value fails validation. */
  private newField(message: MessageDef, field: FieldDef): void {
    const { limits, table } = field.rules;
    const fails = table !== null || (limits.min ?? 0n) > 0n || (limits.max ?? 0n) < 0n || (limits.min_count ?? 0n) > 0n;
    if (fails) this.diagnostics.error(field.node.pos, `new field ${field.name} of existing message ${message.name} has a default value that fails validation`);
  }

  private enumeration(before: EnumDef, after: EnumDef): void {
    const at = after.node?.pos;
    if (at === undefined) return;
    for (const old of before.values) {
      const value = after.values.find((v) => v.name === old.name);
      if (value === undefined) {
        const renamed = after.values.find((v) => v.number === old.number);
        this.diagnostics.error(renamed?.pos ?? at, `enum value ${old.name} of ${after.name} was removed or renamed`);
      } else if (value.number !== old.number) {
        this.diagnostics.error(value.pos, `enum value ${old.name} of ${after.name} changed its number from ${String(old.number)} to ${String(value.number)}`);
      }
    }
  }

  private rpcs(): void {
    for (const old of this.prev.rpcs) {
      if (!this.pkgs.includes(old.file.pkg)) continue;
      const rpc = this.cur.rpcs.find((r) => r.service === old.service && r.name === old.name);
      if (rpc === undefined) {
        const service = this.cur.files.flatMap((f) => f.node.services).find((s) => s.name === old.service);
        this.diagnostics.error(service?.pos ?? old.node.pos, `rpc ${old.name} of service ${old.service} was removed or renamed`);
        continue;
      }
      this.rpc(old, rpc);
    }
  }

  private rpc(old: RpcDef, rpc: RpcDef): void {
    const at = rpc.node.pos;
    const name = (def: MessageDef | null): string => (def === null ? '?' : `${def.pkg}.${def.name}`);
    if (name(old.input) !== name(rpc.input) || name(old.output) !== name(rpc.output)) this.diagnostics.error(at, `rpc ${rpc.name} changed its request or response type`);
    if (old.silent !== rpc.silent) this.diagnostics.error(at, `rpc ${rpc.name} changed (ogw.silent)`);
    if (old.retry && !rpc.retry) this.diagnostics.error(at, `rpc ${rpc.name} removed (ogw.retry)`);
    const now = new Set(rpc.errors ?? []);
    for (const error of old.errors ?? []) {
      if (!now.has(error)) this.diagnostics.error(rpc.errorsPos ?? at, `rpc ${rpc.name} removed ${error} from (ogw.errors)`);
    }
  }

  private coreErrors(): void {
    for (const old of this.prev.coreErrors) {
      const now = this.cur.coreErrors.filter((o) => o.rpc === old.rpc);
      const names = new Set(now.flatMap((o) => o.names));
      const at = now[0]?.pos ?? this.cur.files.find((f) => f.name === 'service.proto')?.node.syntaxPos ?? old.pos;
      for (const error of old.names) {
        if (!names.has(error)) this.diagnostics.error(at, `(ogw.core_errors) of ${old.rpc} removed ${error}`);
      }
    }
  }
}

/** Reports changes from `prev` to `cur` that break backward compatibility, for the types and `rpc`s of `pkgs`. */
export function checkCompatibility(prev: Model, cur: Model, diagnostics: Diagnostics, pkgs: readonly Pkg[]): void {
  new Comparer(prev, cur, diagnostics, pkgs).run();
}

function rulesText(rules: FieldRules): string {
  const limits = Object.entries(rules.limits).sort(([a], [b]) => (a < b ? -1 : 1)).map(([k, v]) => `${k}=${String(v)}`);
  return [...limits, rules.table === null ? '' : `table=${rules.table}`, rules.unique ? 'unique' : ''].filter((s) => s !== '').join(',');
}

function definitionText(def: TypeDef): string {
  if (def.kind === 'enum') {
    const values = def.values.map((v) => `${v.name}=${String(v.number)}${v.deprecated ? ' deprecated' : ''}`);
    return `enum ${def.pkg}.${def.name}${def.deprecated ? ' deprecated' : ''} {${values.join(';')}}`;
  }
  const fields = [...def.fields].sort((a, b) => a.number - b.number)
    .map((f) => `${String(f.number)} ${f.name} ${typeText(f)} [${rulesText(f.rules)}]${f.deprecated ? ' deprecated' : ''}`);
  return `message ${def.pkg}.${def.name}${def.isPublic ? ' public' : ''}${def.deprecated ? ' deprecated' : ''} {${fields.join(';')}}`;
}

/** Definitions of the game kinds and what they reach, without comments and `(ogw.converters)`. */
export function kindDefinitions(model: Model): string {
  const kinds = [...model.types.game.values()].filter((d): d is MessageDef => d.kind === 'message' && kindStore(d) !== null);
  const kindLines = kinds.map((k) => `kind ${String(kindStore(k))} ${k.name}`).sort();
  const defs = reach(kinds).map(definitionText).sort();
  return [...kindLines, ...defs].join('\n');
}

/** Contract version: P when the kind definitions equal those of the last PROD build, P + 1 otherwise. */
export function contractVersion(prev: { model: Model; version: number } | null, cur: Model): number {
  if (prev === null) return 1;
  return kindDefinitions(prev.model) === kindDefinitions(cur) ? prev.version : prev.version + 1;
}
