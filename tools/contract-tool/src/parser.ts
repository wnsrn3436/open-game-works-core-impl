/** Parser of the proto files the contract tool reads: proto3 game contract and base proto, and the proto2 option file. */
import type {
  EnumNode, EnumValueNode, FieldNode, FileNode, ImportNode, Label, MessageNode, OptionField, OptionNode, OptionValue, Pos, RpcNode, ServiceNode,
} from './ast.ts';
import { SyntaxFailure, tokenize, type Token } from './lexer.ts';

export { SyntaxFailure };

interface CodeToken extends Token {
  /** `//` comment lines right above the token, without the first space. */
  readonly leading: readonly string[];
}

/** Code tokens with the leading comment of each. A comment on the line of earlier code is not leading. */
function withComments(tokens: readonly Token[]): CodeToken[] {
  const out: CodeToken[] = [];
  let block: string[] = [];
  let blockEnd = -1;
  let lastCodeLine = -1;
  for (const token of tokens) {
    if (token.kind === 'comment') {
      if (!token.lineComment) {
        block = [];
      } else if (token.line !== lastCodeLine) {
        if (block.length === 0 || token.line !== blockEnd + 1) block = [];
        block.push(token.text.startsWith(' ') ? token.text.slice(1) : token.text);
        blockEnd = token.line;
      }
      continue;
    }
    const leading = block.length > 0 && blockEnd === token.line - 1 ? block : [];
    out.push({ ...token, leading });
    block = [];
    lastCodeLine = token.endLine;
  }
  return out;
}

const MAX_FIELD_NUMBER = 536870911;

interface MessageParts {
  fields: FieldNode[];
  options: OptionNode[];
  nested: { name: string; pos: Pos; what: 'message' | 'enum' }[];
  oneofs: Pos[];
  extensions: Pos[];
  reservedNumbers: (readonly [number, number])[];
  reservedNames: string[];
}

class Parser {
  private index = 0;
  private readonly tokens: CodeToken[];
  private readonly display: string;

  constructor(text: string, display: string) {
    this.tokens = withComments(tokenize(text));
    this.display = display;
  }

  private peek(offset = 0): CodeToken {
    const token = this.tokens[Math.min(this.index + offset, this.tokens.length - 1)];
    if (token === undefined) throw new Error('no tokens');
    return token;
  }

  private next(): CodeToken {
    const token = this.peek();
    if (token.kind !== 'eof') this.index += 1;
    return token;
  }

  pos(token: Token = this.peek()): Pos {
    return { file: this.display, line: token.line, column: token.column };
  }

  private fail(message: string, token: Token = this.peek()): never {
    throw new SyntaxFailure(message, token.line, token.column);
  }

  private is(text: string): boolean {
    const token = this.peek();
    return (token.kind === 'symbol' || token.kind === 'ident') && token.text === text;
  }

  private accept(text: string): boolean {
    if (!this.is(text)) return false;
    this.next();
    return true;
  }

  private expect(text: string): CodeToken {
    if (!this.is(text)) this.fail(`expected "${text}" but found "${this.peek().text || 'end of file'}"`);
    return this.next();
  }

  private ident(): string {
    const token = this.peek();
    if (token.kind !== 'ident') this.fail(`expected a name but found "${token.text || 'end of file'}"`);
    return this.next().text;
  }

  /** A dotted name, optionally starting with `.`. */
  private fullIdent(): string {
    let text = this.accept('.') ? '.' : '';
    text += this.ident();
    while (this.is('.')) {
      this.next();
      text += `.${this.ident()}`;
    }
    return text;
  }

  private stringLiteral(): string {
    const token = this.peek();
    if (token.kind !== 'string') this.fail('expected a string');
    let text = this.next().text;
    while (this.peek().kind === 'string') text += this.next().text;
    return text;
  }

  private intLiteral(): bigint {
    const negative = this.accept('-');
    const token = this.peek();
    if (token.kind !== 'int') this.fail('expected an integer');
    this.next();
    const text = token.text;
    const value = /^0[xX]/.test(text) ? BigInt(text) : /^0[0-7]+$/.test(text) ? BigInt(`0o${text.slice(1)}`) : BigInt(text);
    return negative ? -value : value;
  }

  private smallInt(min: number, max: number, what: string): number {
    const token = this.peek();
    const value = this.intLiteral();
    if (value < BigInt(min) || value > BigInt(max)) this.fail(`${what} ${String(value)} is out of range`, token);
    return Number(value);
  }

  parseFile(importPath: string): FileNode {
    const first = this.peek();
    let syntax: string | null = null;
    const syntaxPos = this.pos(first);
    if (this.is('syntax') || this.is('edition')) {
      this.next();
      this.expect('=');
      syntax = this.stringLiteral();
      this.expect(';');
    }
    let pkg: string | null = null;
    let pkgPos = syntaxPos;
    const imports: ImportNode[] = [];
    const options: OptionNode[] = [];
    const messages: MessageNode[] = [];
    const enums: EnumNode[] = [];
    const services: ServiceNode[] = [];
    const extendsAt: Pos[] = [];
    while (this.peek().kind !== 'eof') {
      const token = this.peek();
      if (this.accept(';')) continue;
      if (this.accept('package')) {
        if (pkg !== null) this.fail('second package statement', token);
        pkgPos = this.pos(token);
        pkg = this.fullIdent();
        this.expect(';');
      } else if (this.accept('import')) {
        const modifier = this.accept('public') ? 'public' : this.accept('weak') ? 'weak' : 'none';
        imports.push({ path: this.stringLiteral(), modifier, pos: this.pos(token) });
        this.expect(';');
      } else if (this.is('option')) {
        options.push(this.optionStatement());
      } else if (this.is('message')) {
        messages.push(this.message());
      } else if (this.is('enum')) {
        enums.push(this.enumeration());
      } else if (this.is('service')) {
        services.push(this.service());
      } else if (this.accept('extend')) {
        extendsAt.push(this.pos(token));
        this.fullIdent();
        this.skipBlock();
      } else {
        this.fail(`unexpected "${token.text}"`);
      }
    }
    return { display: this.display, importPath, syntax, syntaxPos, pkg, pkgPos, imports, options, messages, enums, services, extends: extendsAt };
  }

  private skipBlock(): void {
    this.expect('{');
    let depth = 1;
    while (depth > 0) {
      const token = this.next();
      if (token.kind === 'eof') this.fail('unterminated block', token);
      if (token.kind === 'symbol' && token.text === '{') depth += 1;
      if (token.kind === 'symbol' && token.text === '}') depth -= 1;
    }
  }

  private optionName(): string {
    let name = '';
    for (;;) {
      if (this.accept('(')) {
        name += `(${this.fullIdent()})`;
        this.expect(')');
      } else {
        name += this.ident();
      }
      if (!this.accept('.')) break;
      name += '.';
    }
    return name;
  }

  private optionStatement(): OptionNode {
    const token = this.expect('option');
    const name = this.optionName();
    this.expect('=');
    const value = this.optionValue();
    this.expect(';');
    return { name, value, pos: this.pos(token) };
  }

  private optionValue(): OptionValue {
    const token = this.peek();
    if (this.is('{')) return this.messageLiteral();
    if (token.kind === 'string') return { kind: 'string', value: this.stringLiteral() };
    if (token.kind === 'int' || (this.is('-') && this.peek(1).kind === 'int')) return { kind: 'int', value: this.intLiteral() };
    if (token.kind === 'float' || (this.is('-') && this.peek(1).kind === 'float')) {
      const negative = this.accept('-');
      const value = Number(this.next().text);
      return { kind: 'float', value: negative ? -value : value };
    }
    if (token.kind === 'ident') {
      const text = this.fullIdent();
      if (text === 'true' || text === 'false') return { kind: 'bool', value: text === 'true' };
      return { kind: 'ident', text };
    }
    return this.fail('expected an option value');
  }

  private messageLiteral(): OptionValue {
    this.expect('{');
    const fields: OptionField[] = [];
    while (!this.accept('}')) {
      const token = this.peek();
      const name = this.ident();
      const colon = this.accept(':');
      if (!colon && !this.is('{')) this.fail('expected ":"');
      fields.push({ name, value: this.optionValue(), pos: this.pos(token) });
      if (!this.accept(',')) this.accept(';');
    }
    return { kind: 'message', fields };
  }

  private fieldOptions(): OptionNode[] {
    const options: OptionNode[] = [];
    if (!this.accept('[')) return options;
    do {
      const token = this.peek();
      const name = this.optionName();
      this.expect('=');
      options.push({ name, value: this.optionValue(), pos: this.pos(token) });
    } while (this.accept(','));
    this.expect(']');
    return options;
  }

  private message(): MessageNode {
    const token = this.expect('message');
    const name = this.ident();
    const parts: MessageParts = { fields: [], options: [], nested: [], oneofs: [], extensions: [], reservedNumbers: [], reservedNames: [] };
    this.expect('{');
    while (!this.accept('}')) this.messageElement(parts, null);
    return { name, comment: token.leading, pos: this.pos(token), ...parts };
  }

  private messageElement(parts: MessageParts, oneof: string | null): void {
    if (this.peek().kind === 'eof') this.fail('unterminated message');
    if (this.accept(';')) return;
    if (this.is('option')) parts.options.push(this.optionStatement());
    else if (this.is('reserved')) this.reserved(parts);
    else if (oneof !== null || !this.blockElement(parts)) parts.fields.push(this.field(oneof));
  }

  /** Nested message or enum, `oneof`, `extensions`, `extend`: recorded so that the rules can report them. */
  private blockElement(parts: MessageParts): boolean {
    const token = this.peek();
    const opensBlock = this.peek(2).text === '{';
    if ((this.is('message') || this.is('enum')) && this.peek(1).kind === 'ident' && opensBlock) {
      const what = this.is('message') ? 'message' : 'enum';
      const name = this.peek(1).text;
      if (what === 'message') this.message();
      else this.enumeration();
      parts.nested.push({ name, pos: this.pos(token), what });
    } else if (this.is('oneof') && opensBlock) {
      this.next();
      const name = this.ident();
      parts.oneofs.push(this.pos(token));
      this.expect('{');
      while (!this.accept('}')) this.messageElement(parts, name);
    } else if (this.is('extensions')) {
      parts.extensions.push(this.pos(token));
      this.skipStatement();
    } else if (this.is('extend') && opensBlock) {
      parts.extensions.push(this.pos(token));
      this.next();
      this.fullIdent();
      this.skipBlock();
    } else {
      return false;
    }
    return true;
  }

  /** Skips to the `;` that ends the statement. */
  private skipStatement(): void {
    while (!this.accept(';')) {
      if (this.peek().kind === 'eof') this.fail('expected ";"');
      this.next();
    }
  }

  private reserved(parts: MessageParts): void {
    this.expect('reserved');
    do {
      if (this.peek().kind === 'string') {
        parts.reservedNames.push(this.stringLiteral());
        continue;
      }
      const from = this.smallInt(1, MAX_FIELD_NUMBER, 'reserved number');
      let to = from;
      if (this.accept('to')) to = this.accept('max') ? MAX_FIELD_NUMBER : this.smallInt(1, MAX_FIELD_NUMBER, 'reserved number');
      parts.reservedNumbers.push([from, to]);
    } while (this.accept(','));
    this.expect(';');
  }

  private field(oneof: string | null): FieldNode {
    const start = this.peek();
    let label: Label = 'none';
    if (this.is('repeated') || this.is('optional') || this.is('required')) {
      const next = this.peek(1);
      if (next.kind === 'ident' || (next.kind === 'symbol' && next.text === '.')) label = this.next().text as Label;
    }
    const typeToken = this.peek();
    let type: string;
    let isMap = false;
    let isGroup = false;
    if (this.is('map') && this.peek(1).text === '<') {
      this.next();
      this.expect('<');
      const key = this.fullIdent();
      this.expect(',');
      const value = this.fullIdent();
      this.expect('>');
      type = `map<${key}, ${value}>`;
      isMap = true;
    } else if (this.is('group')) {
      this.next();
      type = 'group';
      isGroup = true;
    } else {
      type = this.fullIdent();
    }
    const name = this.ident();
    this.expect('=');
    const number = this.smallInt(0, MAX_FIELD_NUMBER, 'field number');
    const options = this.fieldOptions();
    if (isGroup) this.skipBlock();
    else this.expect(';');
    return { name, number, label, type, isMap, isGroup, oneof, options, comment: start.leading, pos: this.pos(start), typePos: this.pos(typeToken) };
  }

  private enumeration(): EnumNode {
    const token = this.expect('enum');
    const name = this.ident();
    const values: EnumValueNode[] = [];
    const options: OptionNode[] = [];
    this.expect('{');
    while (!this.accept('}')) {
      if (this.peek().kind === 'eof') this.fail('unterminated enum');
      if (this.accept(';')) continue;
      if (this.is('option')) {
        options.push(this.optionStatement());
      } else if (this.is('reserved')) {
        this.skipStatement();
      } else {
        const valueToken = this.peek();
        const valueName = this.ident();
        this.expect('=');
        const number = this.smallInt(-2147483648, 2147483647, 'enum value');
        const valueOptions = this.fieldOptions();
        this.expect(';');
        values.push({ name: valueName, number, options: valueOptions, pos: this.pos(valueToken) });
      }
    }
    return { name, values, options, comment: token.leading, pos: this.pos(token) };
  }

  private service(): ServiceNode {
    const token = this.expect('service');
    const name = this.ident();
    const rpcs: RpcNode[] = [];
    const options: OptionNode[] = [];
    this.expect('{');
    while (!this.accept('}')) {
      if (this.peek().kind === 'eof') this.fail('unterminated service');
      if (this.accept(';')) continue;
      if (this.is('option')) options.push(this.optionStatement());
      else rpcs.push(this.rpc());
    }
    return { name, rpcs, options, pos: this.pos(token) };
  }

  /** `stream` before a type name. A type named `stream` is not a stream. */
  private acceptStream(): boolean {
    if (!this.is('stream') || this.peek(1).text === ')' || this.peek(1).text === '.') return false;
    this.next();
    return true;
  }

  private rpc(): RpcNode {
    const token = this.expect('rpc');
    const name = this.ident();
    this.expect('(');
    const inputStream = this.acceptStream();
    const input = this.fullIdent();
    this.expect(')');
    this.expect('returns');
    this.expect('(');
    const outputStream = this.acceptStream();
    const output = this.fullIdent();
    this.expect(')');
    const options: OptionNode[] = [];
    if (this.accept('{')) {
      while (!this.accept('}')) {
        if (this.peek().kind === 'eof') this.fail('unterminated rpc');
        if (this.accept(';')) continue;
        options.push(this.optionStatement());
      }
    } else {
      this.expect(';');
    }
    return { name, input, output, inputStream, outputStream, options, comment: token.leading, pos: this.pos(token) };
  }
}

/** Parses one proto file. Throws `SyntaxFailure` with the position of the first syntax error. */
export function parseProto(text: string, display: string, importPath: string): FileNode {
  return new Parser(text, display).parseFile(importPath);
}
