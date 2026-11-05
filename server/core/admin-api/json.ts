/**
 * JSON of admin requests and responses: a body parse that keeps each number's source text, and the output form
 * (`int64` as decimal strings, bytes as standard base64). The canonical form of `input_sha256` is `storage`'s.
 */
import { createHash } from 'node:crypto';

/** A JSON number of a parsed body, kept as its source text so that `1.0`, `1e3` and integers past 2^53 stay apart. */
export class JsonNumber {
  readonly source: string;

  constructor(source: string) {
    this.source = source;
  }
}

const UTF8 = new TextDecoder('utf-8', { fatal: true });
const ENCODER = new TextEncoder();

/** A text that is not JSON, or an object with a member name twice. Thrown inside the parser only. */
class NotJson extends Error {}

const WHITESPACE = new Set([' ', '\t', '\n', '\r']);
const NUMBER = /-?(0|[1-9][0-9]*)(\.[0-9]+)?([eE][+-]?[0-9]+)?/y;
const LITERALS: readonly (readonly [string, unknown])[] = [['true', true], ['false', false], ['null', null]];

/**
 * A JSON text parser that keeps each number as a `JsonNumber` and refuses an object with the same member name twice,
 * which `JSON.parse` would keep the last of.
 */
class Parser {
  readonly #text: string;
  #at = 0;

  constructor(text: string) {
    this.#text = text;
  }

  document(): unknown {
    const value = this.#value();
    this.#skip();
    if (this.#at !== this.#text.length) throw new NotJson();
    return value;
  }

  #skip(): void {
    while (WHITESPACE.has(this.#text[this.#at] ?? '')) this.#at += 1;
  }

  #value(): unknown {
    this.#skip();
    const c = this.#text[this.#at];
    if (c === '{') return this.#object();
    if (c === '[') return this.#array();
    if (c === '"') return this.#string();
    for (const [word, value] of LITERALS) {
      if (this.#text.startsWith(word, this.#at)) {
        this.#at += word.length;
        return value;
      }
    }
    NUMBER.lastIndex = this.#at;
    const match = NUMBER.exec(this.#text);
    if (match === null) throw new NotJson();
    this.#at += match[0].length;
    return new JsonNumber(match[0]);
  }

  /** A string token, decoded by `JSON.parse`, which also refuses bad escapes and control characters. */
  #string(): string {
    const start = this.#at;
    let at = start + 1;
    for (;;) {
      const c = this.#text[at];
      if (c === undefined) throw new NotJson();
      if (c === '"') break;
      at += c === '\\' ? 2 : 1;
    }
    this.#at = at + 1;
    return JSON.parse(this.#text.slice(start, this.#at)) as string;
  }

  #expect(c: string): void {
    this.#skip();
    if (this.#text[this.#at] !== c) throw new NotJson();
    this.#at += 1;
  }

  /** True and past `c` when the next token is `c`. */
  #take(c: string): boolean {
    this.#skip();
    if (this.#text[this.#at] !== c) return false;
    this.#at += 1;
    return true;
  }

  #object(): Record<string, unknown> {
    this.#at += 1;
    const out: Record<string, unknown> = {};
    if (this.#take('}')) return out;
    do {
      this.#skip();
      if (this.#text[this.#at] !== '"') throw new NotJson();
      const key = this.#string();
      if (Object.hasOwn(out, key)) throw new NotJson();
      this.#expect(':');
      // An own data property also for `__proto__`, as `JSON.parse` makes it.
      Object.defineProperty(out, key, { value: this.#value(), enumerable: true, writable: true, configurable: true });
    } while (this.#take(','));
    this.#expect('}');
    return out;
  }

  #array(): unknown[] {
    this.#at += 1;
    const out: unknown[] = [];
    if (this.#take(']')) return out;
    do out.push(this.#value());
    while (this.#take(','));
    this.#expect(']');
    return out;
  }
}

/**
 * Parses a UTF-8 JSON body with numbers as `JsonNumber`. Null when the bytes are not UTF-8 JSON, when an object has
 * the same member name twice, or when the nesting is deeper than the parser's stack.
 */
export function parse_json(bytes: Uint8Array): unknown {
  try {
    return new Parser(UTF8.decode(bytes)).document();
  } catch {
    return null;
  }
}

/** A JSON object that is not an array and not a `JsonNumber`. */
export function is_plain_object(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) && !(value instanceof JsonNumber);
}

const INTEGER = /^-?(0|[1-9][0-9]*)$/;

/** True when the text is a decimal integer without fraction, exponent or leading zeros. */
export function is_integer_text(text: string): boolean {
  return INTEGER.test(text);
}

/** True when the text holds no U+0000 (a DB text parameter cannot hold it) and no unpaired surrogate. */
export function is_clean_text(text: string): boolean {
  return !text.includes('\u0000') && text.isWellFormed();
}

/**
 * A parsed value with `JsonNumber` replaced: safe integers by `number`, other integers by `bigint`. Undefined when a
 * number anywhere in it has a fraction or an exponent, or a string or member name anywhere in it is not clean text,
 * which the body rules refuse.
 */
export function plain_json(value: unknown): unknown {
  if (typeof value === 'string') return is_clean_text(value) ? value : undefined;
  if (value instanceof JsonNumber) {
    if (!is_integer_text(value.source)) return undefined;
    const big = BigInt(value.source);
    return big >= BigInt(Number.MIN_SAFE_INTEGER) && big <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(big) : big;
  }
  if (Array.isArray(value)) {
    const items = value.map(plain_json);
    return items.includes(undefined) ? undefined : items;
  }
  if (is_plain_object(value)) {
    const entries = Object.entries(value).map(([k, v]) => [k, plain_json(v)] as const);
    return entries.some(([k, v]) => v === undefined || !is_clean_text(k)) ? undefined : Object.fromEntries(entries);
  }
  return value;
}

export function sha256_hex(data: string | Uint8Array): string {
  return createHash('sha256').update(data).digest('hex');
}

/** A value made JSON-safe for a response or log: `bigint` as a decimal string, bytes as standard base64. */
export function output_json(value: unknown): unknown {
  if (typeof value === 'bigint') return value.toString();
  if (value instanceof Uint8Array) return Buffer.from(value).toString('base64');
  if (Array.isArray(value)) return value.map(output_json);
  if (typeof value === 'object' && value !== null) {
    return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined).map(([k, v]) => [k, output_json(v)]));
  }
  return value;
}

export function utf8_bytes(text: string): Uint8Array {
  return ENCODER.encode(text);
}

export function utf8_length(text: string): number {
  return Buffer.byteLength(text, 'utf8');
}
