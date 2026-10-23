/** Requirement expressions and the `requirement` rows they become (`data` skill `### requirement expression`). */
import type { CheckCode, Place } from './diag.ts';
import { ID_NAME, parseInt64 } from './values.ts';
import { snakeOf } from './types.ts';

export type ReqNode =
  | { kind: 'cond'; type: string; args: string[] }
  | { kind: 'group'; logic: 'All' | 'Any'; children: ReqNode[] };

export type ReqParse = { ok: true; node: ReqNode } | { ok: false; message: string };

class Lexer {
  private pos = 0;
  private readonly text: string;

  constructor(text: string) {
    this.text = text;
  }

  peek(): string {
    this.skip();
    return this.text[this.pos] ?? '';
  }

  next(): string {
    const ch = this.peek();
    this.pos += 1;
    return ch;
  }

  /** A run of characters that are not punctuation or space. */
  word(): string {
    this.skip();
    const m = /^[^\s()&|,]+/.exec(this.text.slice(this.pos));
    const w = m ? m[0] : '';
    this.pos += w.length;
    return w;
  }

  done(): boolean {
    this.skip();
    return this.pos >= this.text.length;
  }

  private skip(): void {
    while (this.pos < this.text.length && /\s/.test(this.text[this.pos] as string)) this.pos += 1;
  }
}

function parseCond(lx: Lexer): ReqNode | string {
  const type = lx.word();
  if (!/^[A-Z][A-Za-z0-9]*$/.test(type)) return `${JSON.stringify(type)} is not a RequirementType element`;
  if (lx.next() !== '(') return `${type} is not followed by (`;
  const args: string[] = [];
  if (lx.peek() === ')') {
    lx.next();
    return { kind: 'cond', type, args };
  }
  for (;;) {
    const arg = lx.word();
    if (arg === '') return `${type} has an empty argument`;
    args.push(arg);
    const sep = lx.next();
    if (sep === ')') return { kind: 'cond', type, args };
    if (sep !== ',') return `${type} arguments are not separated by commas`;
  }
}

function parseTerm(lx: Lexer): ReqNode | string {
  if (lx.peek() !== '(') return parseCond(lx);
  lx.next();
  const inner = parseExpr(lx);
  if (typeof inner === 'string') return inner;
  if (lx.next() !== ')') return 'a parenthesis is not closed';
  return inner;
}

function parseExpr(lx: Lexer): ReqNode | string {
  const first = parseTerm(lx);
  if (typeof first === 'string') return first;
  const children = [first];
  let op = '';
  while (lx.peek() === '&' || lx.peek() === '|') {
    const o = lx.next();
    if (op !== '' && o !== op) return '& and | are mixed in one parenthesis';
    op = o;
    const t = parseTerm(lx);
    if (typeof t === 'string') return t;
    children.push(t);
  }
  return op === '' ? first : { kind: 'group', logic: op === '&' ? 'All' : 'Any', children };
}

/** Parses a non-empty requirement expression. */
export function parseRequirement(text: string): ReqParse {
  const lx = new Lexer(text);
  const node = parseExpr(lx);
  if (typeof node === 'string') return { ok: false, message: node };
  if (!lx.done()) return { ok: false, message: 'text after the expression' };
  return { ok: true, node };
}

/** The argument form of a `RequirementType` element (`data/requirement_types.csv`). */
export interface RequirementTypeForm {
  target: { kind: 'none' } | { kind: 'ref'; table: string } | { kind: 'enum'; enumType: string };
  value: boolean;
}

/** A `requirement` row the data tool makes. */
export interface ReqRow {
  name: string;
  type: string | null;
  /** The target argument: an ID name or an enum element; null when none. */
  target: string | null;
  targetForm: RequirementTypeForm['target'];
  value: bigint;
  children: string[];
  logic: 'All' | 'Any' | null;
  place: Place;
  /** Build targets of the cell the expression is in. */
  origin: Set<'Client' | 'Server'>;
}

export interface ReqProblem {
  code: CheckCode;
  message: string;
}

function condRow(node: Extract<ReqNode, { kind: 'cond' }>, forms: ReadonlyMap<string, RequirementTypeForm>, enumElements: (t: string) => ReadonlySet<string> | undefined): Omit<ReqRow, 'name' | 'children' | 'logic' | 'place' | 'origin'> | ReqProblem {
  const form = forms.get(node.type);
  if (!form) return { code: 'value_type', message: `${node.type} is not a RequirementType element with a requirement_types.csv row` };
  const want = (form.target.kind === 'none' ? 0 : 1) + (form.value ? 1 : 0);
  if (node.args.length !== want) return { code: 'value_type', message: `${node.type} takes ${String(want)} arguments` };
  const target = form.target.kind === 'none' ? null : (node.args[0] as string);
  const targetProblem = checkTarget(node.type, form.target, target, enumElements);
  if (targetProblem !== null) return targetProblem;
  const valueText = form.value ? (node.args[want - 1] as string) : '0';
  const value = parseInt64(valueText);
  if (value === null) return { code: 'value_type', message: `${node.type} value ${valueText} is not an int64 integer` };
  return { type: node.type, target, targetForm: form.target, value };
}

function checkTarget(type: string, form: RequirementTypeForm['target'], target: string | null, enumElements: (t: string) => ReadonlySet<string> | undefined): ReqProblem | null {
  if (form.kind === 'ref' && (target === null || !ID_NAME.test(target))) return { code: 'value_type', message: `${type} target ${String(target)} is not an ID name` };
  if (form.kind === 'enum' && !(enumElements(form.enumType)?.has(target ?? '') ?? false)) {
    return { code: 'value_type', message: `${type} target ${String(target)} is not an element of ${form.enumType}` };
  }
  return null;
}

/**
 * The rows of an expression, top row first, in pre-order, named `[req__<table>__<column>__<row key>__<n>]`.
 * A string is the problem with the expression.
 */
export function requirementRows(
  node: ReqNode, prefix: string, forms: ReadonlyMap<string, RequirementTypeForm>,
  enumElements: (t: string) => ReadonlySet<string> | undefined, place: Place, origin: Set<'Client' | 'Server'>,
): ReqRow[] | ReqProblem {
  const rows: ReqRow[] = [];
  const visit = (n: ReqNode): string | ReqProblem => {
    const name = `[${prefix}__${String(rows.length + 1)}]`;
    if (n.kind === 'cond') {
      const r = condRow(n, forms, enumElements);
      if ('code' in r) return r;
      rows.push({ ...r, name, children: [], logic: null, place, origin });
      return name;
    }
    const row: ReqRow = { name, type: null, target: null, targetForm: { kind: 'none' }, value: 0n, children: [], logic: n.logic, place, origin };
    rows.push(row);
    for (const c of n.children) {
      const child = visit(c);
      if (typeof child !== 'string') return child;
      row.children.push(child);
    }
    return name;
  };
  const top = visit(node);
  return typeof top === 'string' ? rows : top;
}

/** A row key part: an ID name's inner name, an integer (negative as `n` and the absolute value), or a snake_case enum element. */
export function rowKeyPart(kind: 'id' | 'int' | 'enum', text: string): string {
  if (kind === 'id') return text.replace(/^\[/, '').replace(/\]$/, '');
  if (kind === 'enum') return snakeOf(text);
  return text.startsWith('-') ? `n${text.slice(1)}` : text;
}
