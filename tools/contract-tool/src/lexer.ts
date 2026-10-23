/** Tokens of a proto file. Comments are kept as tokens so that the parser can attach leading comments. */

export type TokenKind = 'ident' | 'int' | 'float' | 'string' | 'symbol' | 'comment' | 'eof';

export interface Token {
  readonly kind: TokenKind;
  /** Source text. For `string`, the decoded value. For `comment`, the text after `//` (line comments only). */
  readonly text: string;
  readonly line: number;
  readonly column: number;
  /** For `comment`: true for a `//` comment, false for a block comment. */
  readonly lineComment: boolean;
  /** Line of the last character of the token. */
  readonly endLine: number;
}

export class SyntaxFailure extends Error {
  readonly line: number;
  readonly column: number;
  constructor(message: string, line: number, column: number) {
    super(message);
    this.line = line;
    this.column = column;
  }
}

const IDENT_START = /[A-Za-z_]/;
const IDENT_PART = /[A-Za-z0-9_]/;
const DIGIT = /[0-9]/;
const NUMBER_PART = /[A-Za-z0-9_.]/;

const ESCAPES: Readonly<Record<string, string>> = { a: '\x07', b: '\b', f: '\f', n: '\n', r: '\r', t: '\t', v: '\v', '\\': '\\', "'": "'", '"': '"', '?': '?' };

class Scanner {
  private index = 0;
  private line = 1;
  private column = 1;
  readonly tokens: Token[] = [];
  private readonly text: string;

  constructor(text: string) {
    this.text = text;
  }

  private peek(offset = 0): string {
    return this.text[this.index + offset] ?? '';
  }

  private advance(): string {
    const ch = this.text[this.index] ?? '';
    this.index += 1;
    if (ch === '\n') {
      this.line += 1;
      this.column = 1;
    } else {
      this.column += 1;
    }
    return ch;
  }

  private push(kind: TokenKind, text: string, line: number, column: number, lineComment = false): void {
    this.tokens.push({ kind, text, line, column, lineComment, endLine: this.line });
  }

  scan(): Token[] {
    while (this.index < this.text.length) this.scanOne();
    this.push('eof', '', this.line, this.column);
    return this.tokens;
  }

  private scanOne(): void {
    const ch = this.peek();
    const line = this.line;
    const column = this.column;
    if (/\s/.test(ch)) {
      this.advance();
    } else if (ch === '/' && this.peek(1) === '/') {
      this.lineComment(line, column);
    } else if (ch === '/' && this.peek(1) === '*') {
      this.blockComment(line, column);
    } else if (IDENT_START.test(ch)) {
      let text = '';
      while (IDENT_PART.test(this.peek())) text += this.advance();
      this.push('ident', text, line, column);
    } else if (DIGIT.test(ch) || (ch === '.' && DIGIT.test(this.peek(1)))) {
      this.number(line, column);
    } else if (ch === '"' || ch === "'") {
      this.push('string', this.string(ch, line, column), line, column);
    } else {
      this.push('symbol', this.advance(), line, column);
    }
  }

  private lineComment(line: number, column: number): void {
    this.advance();
    this.advance();
    let text = '';
    while (this.index < this.text.length && this.peek() !== '\n') text += this.advance();
    this.push('comment', text, line, column, true);
  }

  private blockComment(line: number, column: number): void {
    this.advance();
    this.advance();
    while (!(this.peek() === '*' && this.peek(1) === '/')) {
      if (this.index >= this.text.length) throw new SyntaxFailure('unterminated block comment', line, column);
      this.advance();
    }
    this.advance();
    this.advance();
    this.push('comment', '', line, column, false);
  }

  private number(line: number, column: number): void {
    let text = '';
    while (NUMBER_PART.test(this.peek()) || ((this.peek() === '+' || this.peek() === '-') && /[eE]$/.test(text) && !/^0[xX]/.test(text))) {
      text += this.advance();
    }
    const isFloat = !/^0[xX]/.test(text) && /[.eE]/.test(text);
    if (isFloat ? !/^([0-9]+\.?[0-9]*|\.[0-9]+)([eE][+-]?[0-9]+)?$/.test(text) : !/^(0[xX][0-9A-Fa-f]+|0[0-7]*|[1-9][0-9]*)$/.test(text)) {
      throw new SyntaxFailure(`bad number literal ${text}`, line, column);
    }
    this.push(isFloat ? 'float' : 'int', text, line, column);
  }

  private string(quote: string, line: number, column: number): string {
    this.advance();
    const bytes: number[] = [];
    const encoder = new TextEncoder();
    for (;;) {
      const ch = this.peek();
      if (ch === '' || ch === '\n') throw new SyntaxFailure('unterminated string', line, column);
      this.advance();
      if (ch === quote) break;
      if (ch !== '\\') {
        bytes.push(...encoder.encode(ch));
        continue;
      }
      bytes.push(...this.escape(encoder, line, column));
    }
    return new TextDecoder().decode(new Uint8Array(bytes));
  }

  private escape(encoder: TextEncoder, line: number, column: number): number[] {
    const ch = this.advance();
    const simple = ESCAPES[ch];
    if (simple !== undefined) return [...encoder.encode(simple)];
    if (ch === 'x' || ch === 'X') {
      let hex = '';
      while (hex.length < 2 && /[0-9A-Fa-f]/.test(this.peek())) hex += this.advance();
      if (hex === '') throw new SyntaxFailure('bad \\x escape', line, column);
      return [parseInt(hex, 16)];
    }
    if (/[0-7]/.test(ch)) {
      let oct = ch;
      while (oct.length < 3 && /[0-7]/.test(this.peek())) oct += this.advance();
      return [parseInt(oct, 8) & 0xff];
    }
    throw new SyntaxFailure(`bad escape \\${ch}`, line, column);
  }
}

export function tokenize(text: string): Token[] {
  return new Scanner(text).scan();
}
